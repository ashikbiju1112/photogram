import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";
import { useAuth } from "../hooks/useAuth";



export default function ChatLayout() {
  //const [user, setUser] = useState(null);
  //const [loading, setLoading] = useState(true);

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeUser, setActiveUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [typing, setTyping] = useState(false);
//const typingChannel = supabase.channel("typing");
const [onlineUsers, setOnlineUsers] = useState({});
const [typingUser, setTypingUser] = useState(null);
//const { userr } = useAuth(); // ✅ REQUIRED
const { user, loading, isBanned, bannedUntil, role } = useAuth();






  const [recording, setRecording] = useState(false);
const [mediaRecorder, setMediaRecorder] = useState(null);
const [audioChunks, setAudioChunks] = useState([]);



  const receiverId = user?.id; // temporary
  //const isAdmin = user?.email === "gamingwithtoxic0@gmail.com";
  const isAdmin = role === "admin";



/*useEffect(() => {
  if (!user) return;
  fetchConversations();
}, [user]);*/

/*useEffect(() => {
  console.log("USER:", user);
}, [user]);*/


  
/* useEffect(() => {
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
  }, []);*/




/*useEffect(() => {
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
}, [user]);*/
  useEffect(() => {
  if (loading || !user?.id) return;

  // 1️⃣ Fetch conversations after login
  fetchConversations();

  // 2️⃣ Create presence channel
  const presenceChannel = supabase.channel("online", {
    config: { presence: { key: user.id } },
  });

  // 3️⃣ Listen for online users
  presenceChannel.on("presence", { event: "sync" }, () => {
    const state = presenceChannel.presenceState();
    if (!state) return;

    const online = {};
    Object.keys(state).forEach((id) => {
      online[id] = true;
    });

    setOnlineUsers(online);
  });

  // 4️⃣ Subscribe once
  presenceChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await presenceChannel.track({ online: true });
    }
  });

  // 5️⃣ Cleanup on unmount or user change
  return () => {
    supabase.removeChannel(presenceChannel);
  };
}, [loading, user?.id]);









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
  console.log("OPEN CONVERSATION WITH:", otherUser);

  // 1️⃣ Find shared conversation
  const { data: shared, error } = await supabase
    .from("participants")
    .select("conversation_id")
    .eq("user_id", user.id);

  if (error) {
    console.error("Fetch participants error:", error);
    return;
  }

  const myConversationIds = shared.map(p => p.conversation_id);

  if (myConversationIds.length > 0) {
    const { data: existing } = await supabase
      .from("participants")
      .select("conversation_id")
      .in("conversation_id", myConversationIds)
      .eq("user_id", otherUser.id)
      .limit(1);

    if (existing && existing.length > 0) {
      const conversationId = existing[0].conversation_id;
      setActiveConversation(conversationId);
      setActiveUser(otherUser);
      fetchMessages(conversationId);
      return;
    }
  }

  // 2️⃣ Create new conversation
  const { data: newConvo, error: convoError } = await supabase
    .from("conversations")
    .insert({})
    .select()
    .single();

  if (convoError) {
    console.error("Conversation create error:", convoError);
    return;
  }

  // 3️⃣ Add participants
  const { error: partError } = await supabase
    .from("participants")
    .insert([
      { conversation_id: newConvo.id, user_id: user.id },
      { conversation_id: newConvo.id, user_id: otherUser.id },
    ]);

  if (partError) {
    console.error("Insert participants error:", partError);
    return;
  }

  setActiveConversation(newConvo.id);
  setActiveUser(otherUser);
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
  const { data, error } = await supabase
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
        profiles!inner (
          id,
          username,
          avatar_url
        )
      )
    )
  `)
  .eq("user_id", user.id);


  if (error) {
    console.error("fetchConversations error:", error);
    return;
  }

  // ✅ Deduplicate by conversation_id
  const uniqueMap = new Map();
  data.forEach(item => {
    if (!uniqueMap.has(item.conversation_id)) {
      uniqueMap.set(item.conversation_id, item);
    }
  });

  setConversations([...uniqueMap.values()]);
  const sorted = [...uniqueMap.values()].sort((a, b) => {
  const aLast = a.conversations.messages?.[0]?.created_at || 0;
  const bLast = b.conversations.messages?.[0]?.created_at || 0;
  return new Date(bLast) - new Date(aLast);
});

setConversations(sorted);

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
async function deleteConversation(conversationId) {
  await supabase
    .from("participants")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id);

  setConversations(prev =>
    prev.filter(c => c.conversation_id !== conversationId)
  );

  setActiveConversation(null);
  setActiveUser(null);
}

async function createGroup(name, memberIds) {
  const { data: convo } = await supabase
    .from("conversations")
    .insert({ is_group: true, name })
    .select()
    .single();

  const rows = memberIds.map(id => ({
    conversation_id: convo.id,
    user_id: id,
  }));

  await supabase.from("participants").insert(rows);
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
      ?.map(p => p.profiles)
      ?.find(p => p?.id && p.id !== user.id);

    const lastMessage = convo.messages
      ?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

    const unreadCount = convo.messages?.filter(
      m => !m.read && m.receiver_id === user.id
    ).length;

    const isDeleted = !otherUser;

    return (
      <button
        key={convo.id}
        className="conversation-item"
        disabled={isDeleted}
        onClick={() => {
          if (isDeleted) return;
          setActiveConversation(convo.id);
          setActiveUser(otherUser);
          fetchMessages(convo.id);
        }}
      >
        <div className="avatar-wrapper">
          <img
            src={otherUser?.avatar_url || "/avatar.png"}
            width={36}
          />
          {otherUser?.id && onlineUsers[otherUser.id] && (
            <span className="online-dot" />
          )}
        </div>

        <div className="conversation-info">
          <div className="name">
            {otherUser?.username || "Deleted User"}
          </div>

          <div className="preview">
            {lastMessage?.content || "No messages yet"}
          </div>
        </div>

        {unreadCount > 0 && (
          <span className="unread-badge">{unreadCount}</span>
        )}
      </button>
    );
  })}
</div>


</aside>



      <main className="chat-window">
        <div className="chat-header">
  {activeConversation && activeUser ? (
    <div className="chat-header-user">
      <img
        src={activeUser.avatar_url || "/avatar.png"}
        alt="avatar"
      />

      <div>
        <div className="username">
          {activeUser.username}
        </div>

        <div className="status">
          {onlineUsers[activeUser.id] ? "Online" : "Offline"}
        </div>
      </div>
    </div>
  ) : activeConversation ? (
    <div className="chat-header-user">
      <div>
        <div className="username">Deleted User</div>
        <div className="status">User no longer available</div>
      </div>
    </div>
  ) : (
    <div className="chat-header-empty">
      Select a chat
    </div>
  )}
</div>







            
{!activeConversation ? (
  conversations.length === 0 ? (
    <div style={{ padding: 40, textAlign: "center", opacity: 0.7 }}>
      <h3>No conversations yet</h3>
      <p>Search for a user to start chatting</p>
    </div>
  ) : (
    <div style={{ padding: 20, opacity: 0.6 }}>
      Select a chat to start messaging
    </div>
  )
) : (
  <div className="messages">
  {messages.length === 0 ? (
    <div className="empty-chat">
      No messages yet
    </div>
  ) : (
    messages.map((msg) => {
      const isMe = msg.sender_id === user.id;
      return (
        <div key={msg.id} className={`msg ${isMe ? "right" : "left"}`}>
          {msg.content}
        </div>
      );
    })
  )}
</div>

)}



{typingUser && (
  <div style={{ padding: 6, fontSize: 12, opacity: 0.7 }}>
    {typingUser} is typing…
  </div>
)}



        <div className="chat-input">
  <input
    value={text}
    disabled={!activeUser}
    placeholder={
      activeUser
        ? "Message..."
        : "You cannot message this user"
    }
    onChange={(e) => {
      setText(e.target.value);

      if (!activeConversation || !activeUser) return;

      supabase.channel(`typing-${activeConversation}`).send({
        type: "broadcast",
        event: "typing",
        payload: {
          userId: user.id,
          username: user.username,
        },
      });
    }}
  />

  <button
    className="send"
    disabled={!activeUser || !text.trim()}
    onClick={sendMessage}
  >
    ➤
  </button>
</div>



      </main>
    </div>
  );
}
