import { useEffect, useRef, useState ,useMemo} from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";
import { useAuth } from "../hooks/useAuth";
import StatusUploader from "./StatusUploader";

import nacl from "tweetnacl";
import {
  encodeUTF8,
  decodeUTF8,
  encodeBase64,
  decodeBase64
} from "tweetnacl-util";

/* 🔐 ENCRYPT */
function encrypt(text, key) {
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.secretbox(
    decodeUTF8(text),
    nonce,
    key
  );

  return encodeBase64(nonce) + ":" + encodeBase64(encrypted);
}

/* 🔓 DECRYPT */
function decrypt(payload, key) {
  if (!payload) return "";

  const [n, e] = payload.split(":");
  const decrypted = nacl.secretbox.open(
    decodeBase64(e),
    decodeBase64(n),
    key
  );

  return decrypted ? encodeUTF8(decrypted) : "🔒 Unable to decrypt";
}




const PAGE_SIZE = 30;

export default function ChatLayout() {
 const { user, loading, isBanned, bannedUntil, role } = useAuth();
const isAdmin = role === "admin";


  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState("");
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeUser, setActiveUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [typingUserId, setTypingUserId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
const [page, setPage] = useState(0);

  const messagesEndRef = useRef(null);
  const typingTimeout = useRef(null);
  const [oldestTimestamp, setOldestTimestamp] = useState(null);
const [reactions, setReactions] = useState({});
const [replyTo, setReplyTo] = useState(null);

  const [selectedMessage, setSelectedMessage] = useState(null);
let pressTimer;



/* ===================== 🔐 SHARED ENCRYPTION KEY ===================== */
const sharedKey = useMemo(() => {
  if (!activeConversation) return null;

  return nacl
    .hash(new TextEncoder().encode(activeConversation))
    .slice(0, 32);
}, [activeConversation]);




  /* ===================== PRESENCE ===================== */

async function react(messageId, emoji) {
  await supabase.from("message_reactions").upsert({
    message_id: messageId,
    user_id: user.id,
    emoji,
  });
}


function onPress(msg) {
  pressTimer = setTimeout(() => {
    setSelectedMessage(msg);
  }, 400);
}

function cancelPress() {
  clearTimeout(pressTimer);
}


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


//
useEffect(() => {
  if (!user?.id) return;

  const callChannel = supabase
    .channel("calls")
    .on(
      "postgres_changes",
      { event: "INSERT", table: "calls" },
      payload => {
        if (payload.new.caller_id !== user.id) {
          alert("📞 Incoming call");
        }
      }
    )
    .subscribe();

  return () => supabase.removeChannel(callChannel);
}, [user?.id]);







/* ===================== GROUP CREATION ===================== */

async function createGroup(name, members) {
  const { data: convo } = await supabase
    .from("conversations")
    .insert({ is_group: true, name })
    .select()
    .single();

  await supabase.from("participants").insert([
    { conversation_id: convo.id, user_id: user.id, role: "admin" },
    ...members.map(u => ({
      conversation_id: convo.id,
      user_id: u.id,
      role: "member",
    })),
  ]);
}


 /* ====================== PIN CHAT ===================== */

async function pinChat(conversationId) {
  await supabase
    .from("conversations")
    .update({ pinned: true })
    .eq("id", conversationId);
}

 /* ===================== SEARCH MESSAGES ===================== */


 /*async function searchMessages(q) {
  if (!q) return loadMessages(true);

  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", activeConversation)
    .ilike("content", `%${q}%`);

  setMessages(data || []);
}*/


async function searchMessages() {
  alert("🔒 Search not available for encrypted chats");
}



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

    cleaned.sort((a, b) => {
  // 1️⃣ pinned first
  if (a.pinned !== b.pinned) return b.pinned - a.pinned;

  // 2️⃣ newest message next
  return new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0);
});

setConversations(cleaned);

  }

  /* ===================== LOAD MESSAGES ===================== */

  async function loadMessages(initial = false) {
  if (!activeConversation || !user?.id) return;

  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", activeConversation)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  // 🔥 cursor-based pagination
  if (!initial && oldestTimestamp) {
    query = query.lt("created_at", oldestTimestamp);
  }

  const { data, error } = await query;

  if (error || !data) return;

  if (data.length === 0) {
    setHasMore(false);
    return;
  }

  const reversed = [...data].reverse();

  setMessages(prev =>
    initial ? reversed : [...reversed, ...prev]
  );

  // 👇 update cursor to OLDEST loaded message
  setOldestTimestamp(reversed[0].created_at);
}





  /* ===================== REALTIME ===================== */

  /* ===================== REALTIME (ONLY ONE) ===================== */

useEffect(() => {
  if (!activeConversation || !user?.id) return;

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
}, [activeConversation, user?.id]);

useEffect(() => {
  if (!activeConversation) return;

  setMessages([]);
  setHasMore(true);
  setOldestTimestamp(null);
  loadMessages(true);
}, [activeConversation]);

// ✅ MARK MESSAGES AS READ (✔✔ Seen)
useEffect(() => {
  if (!activeConversation || !user?.id) return;

  supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", activeConversation)
    .neq("sender_id", user.id)   // not my messages
    .is("read_at", null);        // only unread ones
}, [activeConversation, user?.id]);


  /* ===================== SEND MESSAGE ===================== */

  async function sendMessage() {
    if (user.is_muted && new Date(user.muted_until) > new Date()) {
  alert("You are muted");
  return;
}

    if (!text.trim() || !activeConversation || !activeUser) return;

    const messageId = crypto.randomUUID();
    if (!sharedKey) return;

const encryptedText = encrypt(text, sharedKey);

    const content = encryptedText;
    

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




/* ====================Reaction================== */
  async function react(messageId, emoji) {
  await supabase.from("message_reactions").upsert({
    message_id: messageId,
    user_id: user.id,
    emoji,
  });
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

  async function openOrCreateConversation(otherUser) {
  if (!user?.id || !otherUser?.id) return null;

  // 🔑 1️⃣ Always compute the SAME key for the same 2 users
  const conversationKey = [user.id, otherUser.id].sort().join("_");

  // 🔍 2️⃣ Try to find existing conversation
  const { data: existing, error: findError } = await supabase
    .from("conversations")
    .select("id")
    .eq("conversation_key", conversationKey)
    .single();

  if (existing) {
    return existing.id; // ✅ reuse old conversation
  }

  // 🆕 3️⃣ Create conversation ONLY if not exists
  const { data: convo, error: insertError } = await supabase
    .from("conversations")
    .insert({ conversation_key: conversationKey }) // 👈 THIS IS WHERE IT GOES
    .select()
    .single();

  if (insertError) {
    console.error("Conversation create error:", insertError);
    return null;
  }

  // 👥 4️⃣ Insert participants ONCE
  await supabase.from("participants").insert([
    { conversation_id: convo.id, user_id: user.id },
    { conversation_id: convo.id, user_id: otherUser.id },
  ]);

  return convo.id;
}

//

useEffect(() => {
  if (!activeConversation || !user?.id) return;

  supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", activeConversation)
    .neq("sender_id", user.id)
    .is("read_at", null);
}, [activeConversation]);


   /* ====================Reaction================== */
async function react(messageId, emoji) {
  await supabase.from("message_reactions").upsert({
    message_id: messageId,
    user_id: user.id,
    emoji,
  });
}


//

async function startVideoCall() {
  await supabase.from("calls").insert({
    conversation_id: activeConversation,
    caller_id: user.id,
    type: "video",
    status: "ringing",
  });
}

async function startVoiceCall() {
  await supabase.from("calls").insert({
    conversation_id: activeConversation,
    caller_id: user.id,
    type: "voice",
    status: "ringing",
  });
}

async function deleteMessage(messageId) {
  await supabase
    .from("messages")
    .update({
      content: "⚠️ Message removed by admin",
      deleted_by_admin: true,
      deleted_at: new Date().toISOString(),
    })
    .eq("id", messageId);
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
        <StatusUploader />
        <UserSearch
  onSelect={async otherUser => {
    const convoId = await openOrCreateConversation(otherUser);
    setActiveConversation(convoId);
    setActiveUser(otherUser);
    setSidebarOpen(false);
  }}
/>
<div className="conversation-list">
    {conversations.map(convo => (
      <div
        key={convo.id}
        className="conversation-item"
        onClick={() => openConversation(convo)}
      >
        <span>{convo.other?.username}</span>

        {/* 📌 PIN BUTTON */}
        <button
          onClick={(e) => {
            e.stopPropagation(); // IMPORTANT
            pinChat(convo.id);
          }}
          title="Pin chat"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            marginLeft: "auto",
          }}
        >
          📌
        </button>
      </div>
    ))}
  </div><p>{decryptedText}</p>

      </aside>


      <main className="chat-window">
        {!activeConversation ? (
          <div className="empty-chat">
            <h2>💬 Start a conversation</h2>
            <p>Select a user from the left</p>
          </div>
        ) : (
          <>
          {/* 🔝 CHAT HEADER */}
  <div className="chat-header">
    <div className="chat-header-user">
      <img
        src={activeUser?.avatar_url || "/avatar.png"}
        alt=""
        width={36}
        height={36}
      />
      <div>
        <div className="username">{activeUser?.username}</div>
        {onlineUsers[activeUser?.id] && (
          <div className="status">online</div>
        )}
      </div>
    </div>
<input
  placeholder="Search messages..."
  onChange={e => searchMessages(e.target.value)}
/>

    <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
      {/* 📞 Optional voice */}
      <button onClick={startVoiceCall}>📞</button>

      {/* 📹 VIDEO CALL */}
      <button onClick={startVideoCall}>📹</button>
    </div>
  </div>
            <div
              className="messages"
              onScroll={e => {
  if (e.target.scrollTop === 0 && hasMore) {
    loadMessages(false);
  }
}}

            >
              {messages.map(msg => {
  const isMe = msg.sender_id === user.id;

  return (
    <div key={msg.id} className={`msg ${isMe ? "right" : "left"}`}>

      {/* 💬 MESSAGE BUBBLE */}
      <div onDoubleClick={() => react(msg.id, "❤️")}>
        <div
          onMouseDown={() => onPress(msg)}
          onMouseUp={cancelPress}
          onTouchStart={() => onPress(msg)}
          onTouchEnd={cancelPress}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span>{sharedKey ? decrypt(msg.content, sharedKey) : "🔒"}</span>

          {/* 🗑 ADMIN DELETE */}
          {isAdmin && (
            <button
              onClick={() => deleteMessage(msg.id)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "red",
              }}
              title="Delete message"
            >
              🗑
            </button>
          )}
        </div>
        {reactions[msg.id] && (
  <div style={{ fontSize: 12, marginTop: 4 }}>
    {Object.entries(reactions[msg.id]).map(([emoji, count]) => (
      <span key={emoji} style={{ marginRight: 6 }}>
        {emoji} {count}
      </span>
    ))}
  </div>)}
      </div>

                    <div className="time">
                      {isMe && (
    msg.read_at
      ? "✔✔ "
      : msg.delivered_at
      ? "✔ "
      : "⏳ "
  )}

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
              <button onClick={startVideoCall}>📹</button>

            </div>
          </>
        )}
      </main>
    </div>
  );
}
