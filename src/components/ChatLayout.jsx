import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";
import { useAuth } from "../hooks/useAuth";

export default function ChatLayout() {
  const { user, loading, isBanned, bannedUntil, role } = useAuth();

  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeUser, setActiveUser] = useState(null);

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  const [onlineUsers, setOnlineUsers] = useState({});
  const [typingUser, setTypingUser] = useState(null);

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  /* --------------------------------------------------
     AUTH & PRESENCE
  -------------------------------------------------- */

  useEffect(() => {
    if (!user?.id || loading) return;

    fetchConversations();

    const presence = supabase.channel("online", {
      config: { presence: { key: user.id } },
    });

    presence.on("presence", { event: "sync" }, () => {
      const state = presence.presenceState();
      const online = {};
      Object.keys(state).forEach(id => (online[id] = true));
      setOnlineUsers(online);
    });

    presence.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        await presence.track({ online: true });
      }
    });

    return () => supabase.removeChannel(presence);
  }, [user?.id, loading]);

  /* --------------------------------------------------
     CONVERSATIONS
  -------------------------------------------------- */

  async function fetchConversations() {
    const { data, error } = await supabase
      .from("conversations")
      .select(`
        id,
        messages (
          id, content, created_at, read, receiver_id, sender_id
        ),
        participants (
          user_id,
          profiles (id, username, avatar_url)
        )
      `);

    if (error) return console.error(error);

    const cleaned = data
      .filter(c =>
        c.participants?.some(p => p.user_id === user.id)
      )
      .map(c => {
        const otherUser = c.participants
          .map(p => p.profiles)
          .find(p => p?.id !== user.id);

        const lastMessage = [...(c.messages || [])]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

        return {
          conversation_id: c.id,
          otherUser,
          lastMessage,
          lastMessageTime: lastMessage?.created_at,
        };
      })
      .filter(c => c.otherUser);

    cleaned.sort(
      (a, b) =>
        new Date(b.lastMessageTime || 0) -
        new Date(a.lastMessageTime || 0)
    );

    setConversations(cleaned);
  }

  /* --------------------------------------------------
     OPEN CONVERSATION
  -------------------------------------------------- */

  async function openConversation(otherUser) {
    const { data: existing } = await supabase
      .from("participants")
      .select("conversation_id")
      .eq("user_id", user.id);

    const ids = existing?.map(p => p.conversation_id);

    let convoId = null;

    if (ids?.length) {
      const { data } = await supabase
        .from("participants")
        .select("conversation_id")
        .in("conversation_id", ids)
        .eq("user_id", otherUser.id)
        .single();

      convoId = data?.conversation_id;
    }

    if (!convoId) {
      const { data: convo } = await supabase
        .from("conversations")
        .insert({})
        .select()
        .single();

      await supabase.from("participants").insert([
        { conversation_id: convo.id, user_id: user.id },
        { conversation_id: convo.id, user_id: otherUser.id },
      ]);

      convoId = convo.id;
    }

    setActiveConversation(convoId);
    setActiveUser(otherUser);
  }

  /* --------------------------------------------------
     FETCH + REALTIME MESSAGES
  -------------------------------------------------- */

  useEffect(() => {
    if (!activeConversation) return;

    fetchMessages(activeConversation);

    const channel = supabase
      .channel(`chat:${activeConversation}`)
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

    const typing = supabase
      .channel(`typing:${activeConversation}`)
      .on("broadcast", { event: "typing" }, payload => {
        if (payload.payload.userId !== user.id) {
          setTypingUser(payload.payload.username);
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(
            () => setTypingUser(null),
            1500
          );
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(typing);
    };
  }, [activeConversation]);

  async function fetchMessages(convoId) {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convoId)
      .order("created_at");

    setMessages(data || []);
  }

  /* --------------------------------------------------
     OPTIMISTIC SEND
  -------------------------------------------------- */

  async function sendMessage() {
    if (!text.trim()) return;

    const tempId = crypto.randomUUID();

    setMessages(prev => [
      ...prev,
      {
        id: tempId,
        content: text,
        sender_id: user.id,
        created_at: new Date().toISOString(),
        pending: true,
      },
    ]);

    setText("");

    const { error } = await supabase.from("messages").insert({
      conversation_id: activeConversation,
      sender_id: user.id,
      receiver_id: activeUser.id,
      content: text,
    });

    setMessages(prev =>
      prev.map(m =>
        m.id === tempId ? { ...m, pending: false, failed: !!error } : m
      )
    );
  }

  /* --------------------------------------------------
     SCROLL CONTROL
  -------------------------------------------------- */

  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* --------------------------------------------------
     RENDER
  -------------------------------------------------- */

  if (loading) return <div>Loading…</div>;
  if (!user) return <div>Not authenticated</div>;
  if (isBanned)
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2>🚫 You are banned</h2>
        {bannedUntil && <p>Until {new Date(bannedUntil).toLocaleString()}</p>}
      </div>
    );

  return (
    <div className="chat-app">
      <aside className="sidebar">
        <strong>Photogram</strong>
        <UserSearch onSelect={openConversation} />

        {conversations.map(c => (
          <button
            key={c.conversation_id}
            onClick={() => {
              setActiveConversation(c.conversation_id);
              setActiveUser(c.otherUser);
            }}
            className={
              activeConversation === c.conversation_id ? "active" : ""
            }
          >
            <img src={c.otherUser.avatar_url || "/avatar.png"} width={36} />
            <span>{c.otherUser.username}</span>
          </button>
        ))}
      </aside>

      <main className="chat-window">
        <div className="messages">
          {messages.map(m => (
            <div
              key={m.id}
              className={`msg ${m.sender_id === user.id ? "right" : "left"}`}
            >
              {m.content}
              {m.pending && <span className="pending">⏳</span>}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {typingUser && <div className="typing">{typingUser} typing…</div>}

        <div className="chat-input">
          <input
            value={text}
            onChange={e => {
              setText(e.target.value);
              supabase.channel(`typing:${activeConversation}`).send({
                type: "broadcast",
                event: "typing",
                payload: { userId: user.id, username: user.username },
              });
            }}
            placeholder="Message…"
          />
          <button onClick={sendMessage}>➤</button>
        </div>
      </main>
    </div>
  );
}
