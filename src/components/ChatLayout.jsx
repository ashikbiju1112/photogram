import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";
import { useAuth } from "../hooks/useAuth";

const PAGE_SIZE = 30;

export default function ChatLayout() {
  const { user, loading, isBanned, bannedUntil, role } = useAuth();

  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState("");
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeUser, setActiveUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [typingUserId, setTypingUserId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimeout = useRef(null);
  const mediaRecorderRef = useRef(null);

  /* ---------------- PRESENCE (SAFE) ---------------- */

  useEffect(() => {
    if (loading || !user?.id) return;

    const presenceChannel = supabase.channel("online", {
      config: { presence: { key: user.id } },
    });

    presenceChannel.on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState() || {};
      const online = {};
      Object.keys(state).forEach(id => (online[id] = true));
      setOnlineUsers(online);
    });

    presenceChannel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ online: true });
      }
    });

    fetchConversations();

    return () => supabase.removeChannel(presenceChannel);
  }, [loading, user?.id]);

  /* ---------------- FETCH CONVERSATIONS (OPTIMIZED) ---------------- */

  async function fetchConversations() {
    const { data, error } = await supabase
      .from("participants")
      .select(`
        conversation_id,
        conversations (
          id,
          is_group,
          name,
          participants (
            profiles (
              id,
              username,
              avatar_url
            )
          ),
          messages (
            id,
            content,
            created_at,
            read,
            sender_id,
            receiver_id
          )
        )
      `)
      .eq("user_id", user.id);

    if (error) {
      console.error(error);
      return;
    }

    const mapped = data
      .map(row => {
        const convo = row.conversations;

        const otherUser = convo.participants
          .map(p => p.profiles)
          .find(p => p.id !== user.id);

        const lastMessage = convo.messages
          ?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

        return {
          id: convo.id,
          otherUser,
          lastMessage,
          lastMessageTime: lastMessage?.created_at,
        };
      })
      .filter(c => c.otherUser)
      .sort(
        (a, b) =>
          new Date(b.lastMessageTime || 0) -
          new Date(a.lastMessageTime || 0)
      );

    setConversations(mapped);
  }

  /* ---------------- FETCH PAGINATED MESSAGES ---------------- */

  async function loadMessages(reset = false) {
    if (!activeConversation) return;

    const from = reset ? 0 : messages.length;
    const to = from + PAGE_SIZE - 1;

    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", activeConversation)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (!data) return;

    setHasMore(data.length === PAGE_SIZE);

    setMessages(prev =>
      reset
        ? data.reverse()
        : [...data.reverse(), ...prev]
    );
  }

  useEffect(() => {
    if (!activeConversation) return;
    setMessages([]);
    setHasMore(true);
    loadMessages(true);
  }, [activeConversation]);

  /* ---------------- REALTIME (RECONCILED) ---------------- */

  useEffect(() => {
    if (!activeConversation) return;

    const msgChannel = supabase
      .channel(`messages-${activeConversation}`)
      .on(
        "postgres_changes",
        { event: "INSERT", table: "messages" },
        payload => {
          setMessages(prev => {
            const exists = prev.some(
              m =>
                m.created_at === payload.new.created_at &&
                m.sender_id === payload.new.sender_id &&
                m.content === payload.new.content
            );
            return exists ? prev : [...prev, payload.new];
          });

          fetchConversations();
        }
      )
      .subscribe();

    const typingChannel = supabase
      .channel(`typing-${activeConversation}`)
      .on("broadcast", { event: "typing" }, payload => {
        if (payload.payload.userId !== user.id) {
          setTypingUserId(payload.payload.userId);
          setTimeout(() => setTypingUserId(null), 1200);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(typingChannel);
    };
  }, [activeConversation]);

  /* ---------------- SEND MESSAGE (OPTIMISTIC + CLEAN) ---------------- */

  async function sendMessage() {
    if (!text.trim() || !activeConversation || !activeUser) return;

    const tempId = crypto.randomUUID();
    const content = text;

    setMessages(prev => [
      ...prev,
      {
        id: tempId,
        content,
        sender_id: user.id,
        receiver_id: activeUser.id,
        created_at: new Date().toISOString(),
        pending: true,
      },
    ]);

    setText("");

    const { error } = await supabase.from("messages").insert({
      conversation_id: activeConversation,
      sender_id: user.id,
      receiver_id: activeUser.id,
      content,
    });

    if (error) {
      setMessages(prev =>
        prev.map(m =>
          m.id === tempId ? { ...m, failed: true } : m
        )
      );
    }
  }

  /* ---------------- TYPING (DEBOUNCED + SAFE) ---------------- */

  function handleTyping(e) {
    setText(e.target.value);

    if (!activeConversation || typingTimeout.current) return;

    typingTimeout.current = setTimeout(() => {
      typingTimeout.current = null;
    }, 800);

    supabase.channel(`typing-${activeConversation}`).send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user.id },
    });
  }

  /* ---------------- AUDIO (FIXED CLEANUP) ---------------- */

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];

    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());

      const blob = new Blob(chunks, { type: "audio/webm" });
      const path = `${user.id}/voice-${Date.now()}.webm`;

      await supabase.storage.from("chat-files").upload(path, blob);
      const { data } = supabase.storage.from("chat-files").getPublicUrl(path);

      await supabase.from("messages").insert({
        conversation_id: activeConversation,
        sender_id: user.id,
        audio_url: data.publicUrl,
      });
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  /* ---------------- AUTO SCROLL (SMART) ---------------- */

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ---------------- GUARDS ---------------- */

  if (loading) return <div>Loading…</div>;
  if (!user) return <div>Not authenticated</div>;

  if (isBanned)
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2>🚫 You are banned</h2>
        {bannedUntil && <p>{new Date(bannedUntil).toLocaleString()}</p>}
      </div>
    );

  /* ---------------- UI ---------------- */

  return (
    <div className="chat-app">
      <aside className={`sidebar ${sidebarOpen ? "open" : "hidden"}`}>
        <strong>Photogram</strong>
        <UserSearch
          onSelect={u => {
            setActiveUser(u);
            setActiveConversation(u.conversation_id);
            setSidebarOpen(false);
          }}
        />
      </aside>

      <main className="chat-window">
        {!activeConversation ? (
          <div className="empty-chat">Select a chat</div>
        ) : (
          <>
            <div
              className="messages"
              ref={messagesContainerRef}
              onScroll={e => {
                if (e.target.scrollTop === 0 && hasMore) loadMessages();
              }}
            >
              {messages.map(msg => {
                const isMe = msg.sender_id === user.id;
                return (
                  <div key={msg.id} className={`msg ${isMe ? "right" : "left"}`}>
                    {msg.content}
                    <div className="time">
                      {isMe && (msg.failed ? "❌ " : msg.read ? "✔✔ " : "✔ ")}
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {typingUserId && <div>typing…</div>}

            <div className="chat-input">
              <input value={text} onChange={handleTyping} />
              <button onClick={sendMessage}>➤</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
