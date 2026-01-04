import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";
import { useAuth } from "../hooks/useAuth";

const PAGE_SIZE = 30;

export default function ChatLayout() {
  const { user, loading, isBanned, bannedUntil } = useAuth();

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
  const typingTimeout = useRef(null);

  /* ===================== PRESENCE ===================== */

  useEffect(() => {
    if (loading || !user?.id) return;

    fetchConversations();

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

    return () => supabase.removeChannel(presenceChannel);
  }, [loading, user?.id]);

  /* ===================== FETCH CONVERSATIONS ===================== */

  async function fetchConversations() {
    const { data, error } = await supabase
      .from("participants")
      .select(`
        conversation_id,
        conversations (
          id,
          participants (
            profiles (id, username, avatar_url)
          ),
          messages (
            id, content, created_at, sender_id, receiver_id
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
          id: convo.id,
          otherUser,
          lastMessage,
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

  /* ===================== LOAD MESSAGES ===================== */

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
      reset ? data.reverse() : [...data.reverse(), ...prev]
    );
  }

  useEffect(() => {
    if (!activeConversation) return;
    setMessages([]);
    setHasMore(true);
    loadMessages(true);
  }, [activeConversation]);

  /* ===================== REALTIME ===================== */

  useEffect(() => {
    if (!activeConversation) return;

    const msgChannel = supabase
      .channel(`messages-${activeConversation}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          table: "messages",
          filter: `conversation_id=eq.${activeConversation}`,
        },
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

  /* ===================== SEND MESSAGE ===================== */

  async function sendMessage() {
    if (!text.trim() || !activeConversation || !activeUser) return;

    const messageId = crypto.randomUUID();
    const content = text;

    setMessages(prev => [
      ...prev,
      {
        id: messageId,
        content,
        sender_id: user.id,
        receiver_id: activeUser.id,
        created_at: new Date().toISOString(),
        pending: true,
      },
    ]);

    setText("");

    const { error } = await supabase.from("messages").insert({
      id: messageId,
      conversation_id: activeConversation,
      sender_id: user.id,
      receiver_id: activeUser.id,
      content,
    });

    if (error) {
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId ? { ...m, failed: true } : m
        )
      );
    }
  }

  /* ===================== TYPING ===================== */

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

  /* ===================== HELPERS ===================== */

  function openConversation(convo) {
    setActiveConversation(convo.id);
    setActiveUser(convo.otherUser);
    setSidebarOpen(false);
  }

  async function openOrCreateConversation(userProfile) {
    const { data: shared } = await supabase
      .from("participants")
      .select("conversation_id")
      .eq("user_id", user.id);

    const ids = (shared || []).map(p => p.conversation_id);

    if (ids.length) {
      const { data: existing } = await supabase
        .from("participants")
        .select("conversation_id")
        .in("conversation_id", ids)
        .eq("user_id", userProfile.id)
        .limit(1);

      if (existing?.length) return existing[0].conversation_id;
    }

    const { data: convo } = await supabase
      .from("conversations")
      .insert({})
      .select()
      .single();

    await supabase.from("participants").insert([
      { conversation_id: convo.id, user_id: user.id },
      { conversation_id: convo.id, user_id: userProfile.id },
    ]);

    return convo.id;
  }

  /* ===================== AUTOSCROLL ===================== */

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ===================== GUARDS ===================== */

  if (loading) return <div>Loading…</div>;
  if (!user) return <div>Not authenticated</div>;

  if (isBanned)
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2>🚫 You are banned</h2>
        {bannedUntil && <p>{new Date(bannedUntil).toLocaleString()}</p>}
      </div>
    );

  /* ===================== UI ===================== */

  return (
    <div className="chat-app">
      <aside className={`sidebar ${sidebarOpen ? "open" : "hidden"}`}>
        <strong>Photogram</strong>
        <UserSearch
          onSelect={async userProfile => {
            const convoId = await openOrCreateConversation(userProfile);
            openConversation({ id: convoId, otherUser: userProfile });
          }}
        />
      </aside>

      <main className="chat-window">
        {!activeConversation ? (
          <div className="empty-chat">
            <h2>💬 Start a conversation</h2>
            <p>Select a user from the left</p>
          </div>
        ) : (
          <>
            <div
              className="messages"
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
                      {isMe && (msg.failed ? "❌ " : "✔ ")}
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
