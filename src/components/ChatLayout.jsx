import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";
import { useAuth } from "../hooks/useAuth";



export default function ChatLayout() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeUser, setActiveUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [typing, setTyping] = useState(false);
//const typingChannel = supabase.channel("typing");
const [onlineUsers, setOnlineUsers] = useState({});
const [typingUser, setTypingUser] = useState(null);
const { userr } = useAuth(); // ✅ REQUIRED






  const [recording, setRecording] = useState(false);
const [mediaRecorder, setMediaRecorder] = useState(null);
const [audioChunks, setAudioChunks] = useState([]);



  const receiverId = user?.id; // temporary
  const isAdmin = user?.email === "gamingwithtoxic0@gmail.com";
const { isBanned, bannedUntil } = useAuth();



/*useEffect(() => {
  if (!user) return;
  fetchConversations();
}, [user]);*/

useEffect(() => {
  console.log("USER:", user);
}, [user]);


  
 useEffect(() => {
    // Initial session
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);




useEffect(() => {
  if (!user) return;

  fetchConversations();

  const presenceChannel = supabase.channel("online", {
    config: {
      presence: { key: user.id },
    },
  });

  presenceChannel.on("presence", { event: "sync" }, () => {
    const state = presenceChannel.presenceState();
    const online = {};

    Object.keys(state).forEach((id) => {
      online[id] = true;
    });

    setOnlineUsers(online);
  });

  presenceChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await presenceChannel.track({ online: true });
    }
  });

  return () => {
    supabase.removeChannel(presenceChannel);
  };
}, [user]);






/*useEffect(() => {
  if (!activeConversation) return;

  const channel = supabase
    .channel(`typing-${activeConversation}`)
    .on("broadcast", { event: "typing" }, (payload) => {
      if (payload.payload.userId !== user.id) {
        setTyping(true);
        setTimeout(() => setTyping(false), 1000);
      }
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [activeConversation]);*/



async function openConversation(otherUser) {
  // find existing conversation between both users
  const { data: convo } = await supabase
    .from("participants")
    .select("conversation_id")
    .in("user_id", [user.id, otherUser.id]);

  if (convo?.length >= 2) {
    const conversationId = convo[0].conversation_id;
    setActiveConversation(conversationId);
    fetchMessages(conversationId);
    return;
  }

  // create new conversation
  const { data: newConvo } = await supabase
    .from("conversations")
    .insert({})
    .select()
    .single();

  await supabase.from("participants").insert([
    { conversation_id: newConvo.id, user_id: user.id },
    { conversation_id: newConvo.id, user_id: otherUser.id },
  ]);

  setActiveConversation(newConvo.id);
  fetchMessages(newConvo.id);
}

//meassage


async function startRecording() {
  if (!navigator.mediaDevices || !user) {
    alert("Audio recording not supported");
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = async () => {
    const audioBlob = new Blob(chunks, { type: "audio/webm" });

    const filePath = `${user.id}/voice-${Date.now()}.webm`;

    const { error } = await supabase.storage
      .from("chat-files")
      .upload(filePath, audioBlob);

    if (error) {
      console.error(error);
      return;
    }

    const { data } = supabase.storage
      .from("chat-files")
      .getPublicUrl(filePath);

    await supabase.from("messages").insert({
  conversation_id: activeConversation,
  sender_id: user.id,
  audio_url: data.publicUrl,
});

  };

  recorder.start();
  setMediaRecorder(recorder);
  setRecording(true);
}

function stopRecording() {
  if (mediaRecorder) {
    mediaRecorder.stop();
    setRecording(false);
  }
}
useEffect(() => {
    if (!user || !messages.length) return;

    supabase
      .from("messages")
      .update({ read: true })
      .eq("receiver_id", user.id)
      .eq("read", false);
  }, [messages, user]);

useEffect(() => {
  const el = document.querySelector(".messages");
  if (el) el.scrollTop = el.scrollHeight;
}, [messages]);


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
      (payload) => {
        setMessages((prev) =>
  prev.some((m) => m.id === payload.new.id)
    ? prev
    : [...prev, payload.new]
);

      }
    )
    .subscribe();
const typingChannel = supabase
    .channel(`typing-${activeConversation}`)
    .on("broadcast", { event: "typing" }, (payload) => {
      if (payload.payload.userId !== user.id) {
        setTypingUser(payload.payload.username);

        // auto clear after 1.5s
        setTimeout(() => setTypingUser(null), 1500);
      }
    })
    .subscribe();

  return () =>{ supabase.removeChannel(msgChannel);
  supabase.removeChannel(typingChannel);};
}, [activeConversation]);


if (loading) {
  return <div style={{ padding: 20 }}>Loading session…</div>;
}

if (!user) {
  return <div style={{ padding: 20 }}>Not authenticated</div>;
}
if (userr?.is_banned) {
  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h2>🚫 You are banned</h2>
      <p>Contact support if this is a mistake.</p>
    </div>
  );
}



if (isBanned) {
  return (
    <div style={{ textAlign: "center", padding: 40 }}>
      <h2>🚫 You are banned</h2>
      {bannedUntil && (
        <p>Banned until: {new Date(bannedUntil).toLocaleString()}</p>
      )}
    </div>
  );
}


async function fetchConversations() {
  const { data } = await supabase
    .from("participants")
    .select(`
      conversation_id,
      conversations (
        id,
        messages (
          id,
          content,
          created_at,
          read,
          receiver_id
        ),
        participants (
          user_id,
          profiles (
            id,
            username,
            avatar_url
          )
        )
      )
    `)
    .eq("user_id", user.id);

  setConversations(data || []);
}






  async function fetchMessages(conversationId) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at");

  setMessages(data || []);
}



  async function sendMessage() {
  if (!text.trim() || !activeConversation) return;

  await supabase.from("messages").insert({
    conversation_id: activeConversation,
    sender_id: user.id,
    content: text,
  });

  setText("");
}





  return (
    <div className="chat-app">
      <aside className="sidebar">
  <div className="sidebar-header">
    <strong>Photogram</strong>
  </div>

  <UserSearch onSelect={openConversation} />

  <div className="conversation-list">
  {conversations.map((item) => {
    const convo = item.conversations;

    const otherUser = convo.participants
      .map(p => p.profiles)
      .find(p => p.id !== user.id);

    const lastMessage =
      convo.messages?.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      )[0];
      const unreadCount = convo.messages?.filter(
  m => !m.read && m.receiver_id === user.id
).length;


    return (
      <button
        key={convo.id}
        className="conversation-item"
        onClick={() => {
          setActiveConversation(convo.id);
          setActiveUser(otherUser);
          fetchMessages(convo.id);
        }}
      >
        <img
          src={otherUser?.avatar_url || "/avatar.png"}
          width={36}
        />
        <div>
          <div className="name">{otherUser?.username}</div>
          <div className="preview">
  {lastMessage?.content || "No messages yet"}
</div>

{unreadCount > 0 && (
  <span className="unread-badge">{unreadCount}</span>
)}

        </div>
      </button>
    );
  })}
</div>


</aside>



      <main className="chat-window">
        <div className="chat-header">
  {activeUser ? (
    <div className="chat-header-user">
      <img
        src={activeUser.avatar_url || "/avatar.png"}
        alt="avatar"
      />
      <div>
        <div className="username">{activeUser.username}</div>
        <div className="status">
  {onlineUsers[activeUser?.id] && <span className="online-dot" />}
  {typing
    ? "Typing…"
    : onlineUsers[activeUser?.id]
    ? "Online"
    : "Offline"}
</div>




      </div>
    </div>
  ) : (
    <div className="chat-header-empty">
      Select a chat
    </div>
  )}
</div>






            {!activeConversation ? (
  <div style={{ padding: 20, opacity: 0.6 }}>
    Select a chat to start messaging
  </div>
) : (
  <div className="messages">
    {messages.map((msg, i) => {
      const isMe = msg.sender_id === user?.id;

      return (
        <div key={msg.id} className={isMe ? "msg right" : "msg left"}>
  {msg.content}

  {isAdmin && (
    <button
      onClick={() =>
        supabase.from("messages").delete().eq("id", msg.id)
      }
      style={{
        marginLeft: 8,
        fontSize: 10,
        color: "red",
        background: "none",
        border: "none",
        cursor: "pointer",
      }}
    >
      Delete
    </button>
  )}
</div>

      );
    })}
  </div>
)}



{typingUser && (
  <div style={{ padding: 6, fontSize: 12, opacity: 0.7 }}>
    {typingUser} is typing…
  </div>
)}



        <div className="chat-input">
  <button
    className={recording ? "mic recording" : "mic"}
    onMouseDown={startRecording}
    onMouseUp={stopRecording}
  >
    🎙
  </button>

  <input
  value={text}
  placeholder="Message..."
  onChange={(e) => {
  setText(e.target.value);

  if (!activeConversation) return;

  supabase.channel(`typing-${activeConversation}`).send({
    type: "broadcast",
    event: "typing",
    payload: {
      userId: user.id,
      username: user.email.split("@")[0], // or username from profile
    },
  });
}}

/>


  <button className="send" onClick={sendMessage}>
    ➤
  </button>
</div>


      </main>
    </div>
  );
}
