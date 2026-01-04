import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";
import { useAuth } from "../hooks/useAuth";

export default function ChatLayout() {
  const { user, loading, isBanned, bannedUntil, role } = useAuth();

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeUser, setActiveUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [typingUser, setTypingUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const typingTimeout = useRef(null);

  const isAdmin = role === "admin";

  /* ---------------- AUTH / PRESENCE ---------------- */

  useEffect(() => {
    if (loading || !user?.id) return;

    fetchConversations();

    const presenceChannel = supabase.channel("online", {
      config: { presence: { key: user.id } },
    });

    presenceChannel.on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      const online = {};
      Object.keys(state || {}).forEach(id => (online[id] = true));
      setOnlineUsers(online);
    });

    presenceChannel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ online: true });
      }
    });

    return () => supabase.removeChannel(presenceChannel);
  }, [loading, user?.id]);

  /* ---------------- FETCH CONVERSATIONS (FIXED) ---------------- */

  async function fetchConversations() {
    const { data, error } = await supabase
      .from("participants")
      .select(`
        conversation_id,
        conversations (
          id,
          is_group,
          name,
          messages (
            id,
            content,
            created_at,
            read,
            sender_id,
            receiver_id
          ),
          participants (
            profiles (
              id,
              username,
              avatar_url
            )
          )
        )
      `)
      .eq("user_id", user.id);

    if (error) {
      console.error(error);
      return;
    }

    const cleaned = data
      .map(row => {
        const convo = row.conversations;
        const otherUser = convo.participants
          .map(p => p.profiles)
          .find(p => p.id !== user.id);

        const lastMessage = convo.messages
          ?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

        return {
          conversation_id: convo.id,
          conversations: { ...convo, messages: lastMessage ? [lastMessage] : [] },
          otherUser,
          lastMessageTime: lastMessage?.created_at,
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(b.lastMessageTime || 0) -
          new Date(a.lastMessageTime || 0)
      );

    setConversations(cleaned);
  }

  /* ---------------- FETCH MESSAGES ---------------- */

  useEffect(() => {
    if (!activeConversation) return;

    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", activeConversation)
      .order("created_at")
      .then(({ data }) => setMessages(data || []));
  }, [activeConversation]);

  /* ---------------- REALTIME ---------------- */

  useEffect(() => {
    if (!activeConversation) return;

    const msgChannel = supabase
      .channel(`messages-${activeConversation}`)
      .on(
        "postgres_changes",
        { event: "INSERT", table: "messages" },
        payload => {
          setMessages(prev =>
            prev.some(m => m.id === payload.new.id)
              ? prev
              : [...prev, payload.new]
          );
        }
      )
      .subscribe();

    const typingChannel = supabase
      .channel(`typing-${activeConversation}`)
      .on("broadcast", { event: "typing" }, payload => {
        if (payload.payload.userId !== user.id) {
          setTypingUser(payload.payload.username);
          setTimeout(() => setTypingUser(null), 1200);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(typingChannel);
    };
  }, [activeConversation]);

  /* ---------------- OPTIMISTIC SEND ---------------- */

  async function sendMessage() {
    if (!text.trim() || !activeConversation || !activeUser) return;

    const tempId = crypto.randomUUID();
    const messageText = text;

    setMessages(prev => [
      ...prev,
      {
        id: tempId,
        content: messageText,
        sender_id: user.id,
        receiver_id: activeUser.id,
        created_at: new Date().toISOString(),
        read: false,
        status: "pending",
      },
    ]);

    setText("");

    const { error } = await supabase.from("messages").insert({
      conversation_id: activeConversation,
      sender_id: user.id,
      receiver_id: activeUser.id,
      content: messageText,
    });

    if (error) {
      setMessages(prev =>
        prev.map(m =>
          m.id === tempId ? { ...m, status: "failed" } : m
        )
      );
    }
  }

  /* ---------------- TYPING DEBOUNCE ---------------- */

  function handleTyping(e) {
    setText(e.target.value);

    if (!activeConversation || typingTimeout.current) return;

    typingTimeout.current = setTimeout(
      () => (typingTimeout.current = null),
      800
    );

    supabase.channel(`typing-${activeConversation}`).send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user.id, username: user.username },
    });
  }

  /* ---------------- AUDIO RECORDING FIX ---------------- */

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
    setRecording(true);
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  /* ---------------- UI GUARDS ---------------- */

  if (loading) return <div>Loading…</div>;
  if (!user) return <div>Not authenticated</div>;

  if (isBanned)
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2>🚫 You are banned</h2>
        {bannedUntil && <p>{new Date(bannedUntil).toLocaleString()}</p>}
      </div>
    );

  /* ---------------- RENDER ---------------- */

  return (
    <div className="chat-app">
      <aside className={`sidebar ${sidebarOpen ? "open" : "hidden"}`}>
        <strong>Photogram</strong>
        <UserSearch onSelect={u => {
          setActiveUser(u);
          setSidebarOpen(false);
        }} />
      </aside>

      <main className="chat-window">
        {!activeConversation ? (
          <div className="empty-chat">Select a chat</div>
        ) : (
          <>
            <div className="messages">
              {messages.map(msg => {
                const isMe = msg.sender_id === user.id;
                return (
                  <div key={msg.id} className={`msg ${isMe ? "right" : "left"}`}>
                    {msg.content}
                    <div className="time">
                      {isMe && (msg.read ? "✔✔ " : "✔ ")}
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {typingUser && <div>{typingUser} is typing…</div>}

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
