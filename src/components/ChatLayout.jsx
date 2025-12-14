import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";


export default function ChatLayout() {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [user, setUser] = useState(null);
  const [typing, setTyping] = useState(false);
  const typingChannel = supabase.channel("typing");
  
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeUser, setActiveUser] = useState(null);
  const [conversations, setConversations] = useState([]);





  const [recording, setRecording] = useState(false);
const [mediaRecorder, setMediaRecorder] = useState(null);
const [audioChunks, setAudioChunks] = useState([]);



  const receiverId = user?.id; // temporary

if (loading) {
  return <div style={{ padding: 20 }}>Loading session…</div>;
}

if (!user) {
  return <div style={{ padding: 20 }}>Not authenticated</div>;
}




  
 useEffect(() => {
  // 1️⃣ Restore session on refresh
  supabase.auth.getSession().then(({ data }) => {
    setUser(data.session?.user ?? null);
    setLoading(false);
  });

  // 2️⃣ Listen to auth changes
  const { data: listener } = supabase.auth.onAuthStateChange(
    (_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    }
  );

  return () => {
    listener.subscription.unsubscribe();
  };
}, []);

useEffect(() => {
  if (!user) return;

  fetchConversations();

  const msgChannel = supabase
    .channel("messages-channel")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        setMessages((prev) => [...prev, payload.new]);
      }
    )
    .subscribe();

  typingChannel
    .on("broadcast", { event: "typing" }, (payload) => {
      setTyping(payload.payload.typing);
    })
    .subscribe();

  const presence = supabase.channel("online", {
    config: { presence: { key: user.id } },
  });

  presence.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await presence.track({ online: true });
    }
  });

  return () => {
    supabase.removeChannel(msgChannel);
    supabase.removeChannel(typingChannel);
    supabase.removeChannel(presence);
  };
}, [user]);


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

  const channel = supabase
    .channel(`messages-${activeConversation}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        table: "messages",
        filter: `conversation_id=eq.${activeConversation}`,
      },
      (payload) => {
        setMessages((prev) => [...prev, payload.new]);
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [activeConversation]);



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
          created_at
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
        <div className="status">Active now</div>
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
        </div>
      );
    })}
  </div>
)}



{typing && (
  <div style={{ padding: 6, fontSize: 12, opacity: 0.7 }}>
    Typing…
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
    onChange={(e) => setText(e.target.value)}
  />

  <button className="send" onClick={sendMessage}>
    ➤
  </button>
</div>


      </main>
    </div>
  );
}
