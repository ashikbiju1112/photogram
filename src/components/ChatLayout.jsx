import { useEffect, useRef, useState ,useMemo} from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";
import { useAuth } from "../hooks/useAuth";
import StatusUploader from "./StatusUploader";
import { FixedSizeList as List } from "react-window";
import { createPeerConnection, getLocalStream } from "../lib/webrtc";



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

function getDateLabel(dateStr) {
  const msgDate = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (msgDate.toDateString() === today.toDateString())
    return "Today";
  if (msgDate.toDateString() === yesterday.toDateString())
    return "Yesterday";

  return msgDate.toLocaleDateString();
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
  const [incomingCall, setIncomingCall] = useState(null);
const [activeCallId, setActiveCallId] = useState(null);

const localVideoRef = useRef(null);
const remoteVideoRef = useRef(null);

const pcRef = useRef(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const messagesEndRef = useRef(null);
  const typingTimeout = useRef(null);
  const [oldestTimestamp, setOldestTimestamp] = useState(null);
const [reactions, setReactions] = useState({});
const [replyTo, setReplyTo] = useState(null);

  const [selectedMessage, setSelectedMessage] = useState(null);
let pressTimer;

const [lastReadAt, setLastReadAt] = useState(null);

const loadingRef = useRef(false);


/* ===================== 🔐 SHARED ENCRYPTION KEY ===================== */
const sharedKey = useMemo(() => {
  if (!activeConversation) return null;

  return nacl
    .hash(new TextEncoder().encode(activeConversation))
    .slice(0, 32);
}, [activeConversation]);

useEffect(() => {
  console.log("sharedKey (ChatLayout):", sharedKey);
}, [sharedKey]);

 /*====================Change Role====================*/
 async function changeRole(userId, role) {
  await supabase
    .from("participants")
    .update({ role })
    .eq("conversation_id", activeConversation)
    .eq("user_id", userId);
}


const atBottomRef = useRef(true);

useEffect(() => {
  const el = messagesEndRef.current?.parentElement;
  if (!el) return;

  const onScroll = () => {
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  el.addEventListener("scroll", onScroll);
  return () => el.removeEventListener("scroll", onScroll);
}, []);

useEffect(() => {
  if (atBottomRef.current) {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }
}, [messages]);


useEffect(() => {
  conversations.forEach(c => {
    if (!c.otherUser) {
      console.warn("⚠️ Broken conversation:", c);
    }
  });
}, [conversations]);




  /* ===================== PRESENCE ===================== */




function onPress(msg) {
  setReplyTo(msg);
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




//pushIceCandidate

  /*async function pushIceCandidate(role, candidate, callId) {
    const { data, error } = await supabase
      .from("calls")
      .select("ice_candidates")
      .eq("id", callId)
      .single();

    if (error) {
      console.error("ICE read error", error);
      return;
    }

    const ice = data.ice_candidates || { caller: [], callee: [] };

    // 🔴 Prevent duplicates (IMPORTANT)
    if (!ice[role].some(c => c.candidate === candidate.candidate)) {
      ice[role].push(candidate);
    }

    await supabase
      .from("calls")
      .update({ ice_candidates: ice })
      .eq("id", callId);
  }*/


      async function pushIceCandidate(role, candidate, callId) {
  const { data, error } = await supabase
    .from("calls")
    .select("ice_candidates")
    .eq("id", callId)
    .single();

  if (error) {
    console.error("ICE read error", error);
    return;
  }

  const ice = data.ice_candidates ?? {};
ice.caller = ice.caller ?? [];
ice.callee = ice.callee ?? [];


  // 🔒 Prevent duplicates safely
  if (!ice[role].some(c => c.candidate === candidate.candidate)) {
    ice[role].push(candidate);
  }

  await supabase
    .from("calls")
    .update({ ice_candidates: ice })
    .eq("id", callId);
}




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


useEffect(() => {
  console.log("🟢 realtime calls channel active"); // 👈 HERE
  if (!user?.id) return;

  const channel = supabase
    .channel("incoming-calls")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "calls",
      },
      payload => {
        console.log("📞 RAW CALL INSERT:", payload.new); // 👈 HERE
        const call = payload.new;

        // 🔥 critical guard
        if (
  call.status === "ringing" &&
  call.participants?.includes(user.id) &&
  call.caller_id !== user.id
) {
  console.log("📞 Incoming call:", call);
  setIncomingCall(call);
}


      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [user?.id]);


  /* ===================== FETCH CONVERSATIONS ===================== */

  async function fetchConversations() {
    const { data, error } = await supabase
      .from("participants")
      .select(`
        conversation_id,
        conversations:conversation_id (
          id,
          pinned,
          participants (
            user_id,
            profiles!participants_user_id_fkey (
              id,
              username,
              avatar_url
            )
          ),
          messages (
            id,
            content,
            created_at,
            sender_id,
            receiver_id,
            read_at
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
  const otherUser =
  convo.participants
    ?.map(p => p.profiles)
    ?.find(p => p && p.id !== user.id) ?? null;

  const unreadCount = convo.messages?.filter(
    m => !m.read_at && m.sender_id !== user.id
  ).length || 0;

  const lastMessage = convo.messages
    ?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

  return {
    id: convo.id,
    otherUser,
    lastMessage,
    lastMessageTime: lastMessage?.created_at,
    unreadCount, // ✅ ADD THIS
    pinned: convo.pinned ?? false,
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
    if (loadingRef.current) return;
  loadingRef.current = true;
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
  loadingRef.current = false;
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
    const isSpam = /(http|https|www\.)/i.test(text);

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
  content: encryptedText,
  flagged: isSpam,
});

    if (error) {
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId ? { ...m, failed: true } : m
        )
      );
    }
  }
async function acceptCall() {
  if (!incomingCall || !incomingCall.id) {
    console.warn("acceptCall: incomingCall is null");
    return;
  }

  const callId = incomingCall.id;
  const callType = incomingCall.type;
  const offer = incomingCall.offer;

  setIncomingCall(null);
  setActiveCallId(callId);

  pcRef.current = createPeerConnection({
    localVideoRef,
    remoteVideoRef,
    onIceCandidate: async (candidate) => {
      await pushIceCandidate("callee", candidate, callId);
    },
  });

  const stream = await navigator.mediaDevices.getUserMedia({
    video: callType === "video",
    audio: true,
  });

  stream.getTracks().forEach(track =>
    pcRef.current.addTrack(track, stream)
  );

  if (offer) {
    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(offer)
    );
  }

  const answer = await pcRef.current.createAnswer();
  await pcRef.current.setLocalDescription(answer);

  await supabase
    .from("calls")
    .update({ status: "accepted", answer })
    .eq("id", callId);
}


useEffect(() => {
  console.log("incomingCall:", incomingCall);
}, [incomingCall]);


useEffect(() => {
  if (!activeCallId) return;

  const channel = supabase
    .channel("call-answer")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "calls",
        filter: `id=eq.${activeCallId}`,
      },
      async (payload) => {
        const call = payload.new;

        if (call.answer && pcRef.current) {
          await pcRef.current.setRemoteDescription(
            new RTCSessionDescription(call.answer)
          );
        }
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [activeCallId]);



async function rejectCall() {
  if (!incomingCall?.id) {
    console.warn("rejectCall: incomingCall is null");
    return;
  }

  await supabase
    .from("calls")
    .update({ status: "rejected" })
    .eq("id", incomingCall.id);

  setIncomingCall(null);
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
  if (!convo?.id) {
    console.warn("Invalid conversation object", convo);
    return;
  }

  if (!convo.otherUser) {
    console.warn("Conversation has no otherUser", convo);
    alert("⚠️ Cannot open this chat (user data missing)");
    return;
  }

  setActiveConversation(convo.id);
  setActiveUser(convo.otherUser);
  setLastReadAt(new Date().toISOString());
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


//




  useEffect(() => {
    if (!activeCallId) return;

    const channel = supabase
      .channel(`ice-sync-${activeCallId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "calls",
          filter: `id=eq.${activeCallId}`,
        },
        async (payload) => {
          if (!pcRef.current) return;

          const ice = payload.new.ice_candidates;
          if (!ice) return;

          const remoteRole =
            payload.new.caller_id === user.id
              ? "callee"
              : "caller";

          for (const candidate of ice?.[remoteRole] || []) {
  try {
    if (!pcRef.current) return;
    if (!pcRef.current.remoteDescription) {
      console.warn("ICE skipped: remoteDescription not ready");
      return;
    }
    await pcRef.current.addIceCandidate(
      new RTCIceCandidate(candidate)
    );
  } catch (e) {
    console.warn("ICE add failed", e);
  }
}

        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeCallId, user?.id]);



/*===================== Voice Call =====================*/
useEffect(() => {
  if (!activeCallId) return;

  const channel = supabase
    .channel("call-ended")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "calls",
        filter: `id=eq.${activeCallId}`,
      },
      (payload) => {
        if (payload.new.status === "ended") {
          cleanupCall();
        }
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [activeCallId]);







async function startVoiceCall() {
  const { data, error } = await supabase
    .from("calls")
    .insert({
  conversation_id: activeConversation,
  caller_id: user.id,
  type: "voice",
  status: "ringing",
  participants: [user.id, activeUser.id], // 🔥 IMPORTANT
})

    .select()
    .single();

  if (error) return;

  setActiveCallId(data.id);

  pcRef.current = createPeerConnection({
    localVideoRef,
    remoteVideoRef,
    onIceCandidate: candidate =>
      pushIceCandidate("caller", candidate, data.id),
  });

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });

  stream.getTracks().forEach(track =>
    pcRef.current.addTrack(track, stream)
  );

  const offer = await pcRef.current.createOffer();
  await pcRef.current.setLocalDescription(offer);

  await supabase
    .from("calls")
    .update({ offer })
    .eq("id", data.id);
}





async function startVideoCall(e) {
  e?.preventDefault();
  e?.stopPropagation();

  // 1️⃣ Create call row
  const { data, error } = await supabase
    .from("calls")
    .insert({
  conversation_id: activeConversation,
  caller_id: user.id,
  type: "video",
  status: "ringing",
  participants: [user.id, activeUser.id], // 🔥 IMPORTANT
})

    .select()
    .single();

  if (error) {
    console.error(error);
    return;
  }

  const callId = data.id;
  setActiveCallId(callId);

  // 2️⃣ Create PeerConnection (FIXED)
  pcRef.current = createPeerConnection({
    localVideoRef,
    remoteVideoRef,
    onIceCandidate: candidate => {
  pushIceCandidate("caller", candidate, callId);
},

  });

  // 3️⃣ Media
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });

  stream.getTracks().forEach(track =>
    pcRef.current.addTrack(track, stream)
  );
console.log("pcRef.current created for callId:", callId);
  // 4️⃣ Offer
  const offer = await pcRef.current.createOffer();
  await pcRef.current.setLocalDescription(offer);

  // 5️⃣ Save offer
  await supabase
    .from("calls")
    .update({ offer })
    .eq("id", callId);
}

async function endCall() {
  await supabase
    .from("calls")
    .update({ status: "ended" })
    .eq("id", activeCallId);

  cleanupCall();
}

function cleanupCall() {
  if (pcRef.current) {
    pcRef.current.close();
    pcRef.current = null;
  }

  localVideoRef.current?.srcObject
    ?.getTracks()
    .forEach(t => t.stop());

  if (localVideoRef.current) localVideoRef.current.srcObject = null;
  if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

  setActiveCallId(null);
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
        <strong>Photogram<span style={{ fontSize: 14, opacity: 0.7 }}>Chats</span></strong>
        <StatusUploader />
        <UserSearch
  onSelect={async otherUser => {
    const convoId = await openOrCreateConversation(otherUser);
    setActiveConversation(convoId);
    setActiveUser(otherUser);
    setSidebarOpen(false);
  }}
/><button
  className="theme-toggle"
  onClick={() => {
    const themes = ["dark", "blue", "purple"];
    const current = document.body.dataset.theme || "dark";
    const next = themes[(themes.indexOf(current) + 1) % themes.length];
    document.body.dataset.theme = next;
  }}
>
  🎨
</button>

<div className="conversation-list">
    {conversations
  .filter(convo => convo.otherUser) // 🔥 CRITICAL
  .map(convo => (

      <div
  key={convo.id}
  className={`conversation-item ${convo.unreadCount ? "unread" : ""}`}
  onClick={() => openConversation(convo)}
>
  <img
    className="avatar"
    src={convo.otherUser?.avatar_url || "/avatar.png"}
    alt=""
  />

  <div className="chat-meta">
    <div className="row">
      <span className="name">{convo.otherUser?.username}</span>
      <span className="time">
        {convo.lastMessageTime &&
          new Date(convo.lastMessageTime).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
      </span>
    </div>

    <div className="row">
      <span className="preview">
        {convo.lastMessage ? "🔒 Encrypted message" : "No messages yet"}
      </span>

      {convo.unreadCount > 0 && (
        <span className="unread-badge">{convo.unreadCount}</span>
      )}
    </div>
  </div>
</div>


    ))}
  </div>

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
    <button
  className="mobile-menu"
  onClick={() => setSidebarOpen(true)}
>
  ☰
</button>

    <button
  className="mobile-back"
  onClick={() => {
    setActiveConversation(null);
    setActiveUser(null);
  }}
>
  ←
</button>

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
      <button
  type="button"
  onClick={(e) => {
    e.preventDefault();
    e.stopPropagation();
    startVoiceCall();
  }}
>
  📞
</button>


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
  {(() => {
    let lastDate = null;
    let newDividerShown = false;

    return messages.map(msg => {
      const msgDate = new Date(msg.created_at).toDateString();
      const showDate = msgDate !== lastDate;
      lastDate = msgDate;

      const isMe = msg.sender_id === user.id;

      const showNewDivider =
        lastReadAt &&
        !isMe &&
        !newDividerShown &&
        new Date(msg.created_at) > new Date(lastReadAt);

      if (showNewDivider) newDividerShown = true;

      return (
        <div key={msg.id} className={`msg ${isMe ? "right" : "left"}`}>
          
          {showDate && (
            <div className="date-separator">
              {getDateLabel(msg.created_at)}
            </div>
          )}

          {showNewDivider && (
            <div className="new-messages">New messages</div>
          )}

          {/* 💬 MESSAGE BUBBLE */}
          <div onDoubleClick={() => react(msg.id, "❤️")}>
            <div
              onMouseDown={() => onPress(msg)}
              onTouchStart={() => onPress(msg)}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>
                {(() => {
                  try {
                    if (!sharedKey) return "🔒 Encrypted message";
                    return decrypt(msg.content, sharedKey);
                  } catch {
                    return "🔒 Encrypted message";
                  }
                })()}
              </span>

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
                >
                  🗑
                </button>
              )}
            </div>
          </div>

          <div className="time">
            {isMe && (msg.pending ? "⏳ " : msg.read_at ? "✔✔ " : "✔ ")}
            {new Date(msg.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      );
    });
  })()}

  <div ref={messagesEndRef} />
</div>


            {typingUserId && <div className="typing-indicator">
    <span></span>
    <span></span>
    <span></span>
  </div>}{replyTo && (
  <div className="reply-preview">
    <span>Replying to:</span>
    <p>
      {decrypt(replyTo.content, sharedKey)}
    </p>
    <button onClick={() => setReplyTo(null)}>✕</button>
  </div>
)}



            <div className="chat-input">
              <input value={text} onChange={handleTyping} />
              <button onClick={sendMessage}>➤</button>
              <button onClick={startVideoCall}>📹</button>

            </div>
          </>
        )}
      </main>{incomingCall?.id && (
  <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(255,0,0,0.8)",
      zIndex: 99999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontSize: 24,
    }}>
    <h2>Incoming {incomingCall.type} call</h2>
    <button onClick={acceptCall}>Accept</button>
    <button onClick={rejectCall}>Reject</button>
  </div>
)}



    </div>
  );
}
