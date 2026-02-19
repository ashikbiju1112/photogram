import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import "./chat.css";
import UserSearch from "./UserSearch";
import { useAuth } from "../hooks/useAuth";
import StatusUploader from "./StatusUploader";
import { createPeerConnection } from "../lib/webrtc";
import nacl from "tweetnacl";
import {
  encodeUTF8,
  decodeUTF8,
  encodeBase64,
  decodeBase64
} from "tweetnacl-util";

/* 🔐 ENCRYPTION FUNCTIONS */
function encrypt(text, key) {
  if (!text || !key) return text;
  try {
    const nonce = nacl.randomBytes(24);
    const encrypted = nacl.secretbox(
      decodeUTF8(text),
      nonce,
      key
    );
    return encodeBase64(nonce) + ":" + encodeBase64(encrypted);
  } catch (error) {
    console.error("Encryption error:", error);
    return text;
  }
}

function decrypt(payload, key) {
  if (!payload || !key) return payload;
  try {
    const [n, e] = payload.split(":");
    if (!n || !e) return "🔒 Encrypted message";
    
    const decrypted = nacl.secretbox.open(
      decodeBase64(e),
      decodeBase64(n),
      key
    );
    return decrypted ? encodeUTF8(decrypted) : "🔒 Unable to decrypt";
  } catch (error) {
    console.error("Decryption error:", error);
    return "🔒 Encrypted message";
  }
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
  return msgDate.toLocaleDateString(undefined, { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

const PAGE_SIZE = 30;

export default function ChatLayout() {
  const { user, loading, isBanned, bannedUntil, role } = useAuth();
  const isAdmin = role === "admin";

  // State management
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState("");
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeUser, setActiveUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [typingInConversation, setTypingInConversation] = useState({});
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [oldestTimestamp, setOldestTimestamp] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [lastReadAt, setLastReadAt] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCallId, setActiveCallId] = useState(null);
  const [callType, setCallType] = useState(null);
  const [callStatus, setCallStatus] = useState(null);
  const [callDuration, setCallDuration] = useState("00:00");
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [messageReactions, setMessageReactions] = useState({});
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [storyViewer, setStoryViewer] = useState(null);
  const [userStories, setUserStories] = useState([]);
  const [showStoryViewer, setShowStoryViewer] = useState(false);
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showProfileSidebar, setShowProfileSidebar] = useState(false);
  const [activeProfile, setActiveProfile] = useState(null);
  const [chatSettings, setChatSettings] = useState({
    wallpaper: null,
    mute: false,
    pin: false,
    archive: false
  });
  const [isFetchingConversations, setIsFetchingConversations] = useState(false);

  // Refs
  const messagesEndRef = useRef(null);
  const typingTimeout = useRef(null);
  const loadingRef = useRef(false);
  const atBottomRef = useRef(true);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const fileInputRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceTimerRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const storyTimerRef = useRef(null);
  const callTimerRef = useRef(null);

  /* ===================== ENCRYPTION KEY - Deterministic ===================== */
  const sharedKey = useMemo(() => {
    if (!activeConversation || !user?.id || !activeUser?.id) return null;
    
    // Sort user IDs to ensure same key for both participants
    const sortedUserIds = [user.id, activeUser.id].sort().join('_');
    const keyMaterial = `${activeConversation}_${sortedUserIds}`;
    return nacl
      .hash(new TextEncoder().encode(keyMaterial))
      .slice(0, 32);
  }, [activeConversation, user?.id, activeUser?.id]);

  /* ===================== SCROLL MANAGEMENT ===================== */
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

  /* ===================== PRESENCE MANAGEMENT ===================== */
  useEffect(() => {
    if (loading || !user?.id) return;

    fetchConversations();

    const presenceChannel = supabase.channel("online", {
      config: { presence: { key: user.id } },
    });

    presenceChannel
      .on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState() || {};
        const online = {};
        Object.keys(state).forEach(id => (online[id] = true));
        setOnlineUsers(online);
      })
      .subscribe(async status => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => supabase.removeChannel(presenceChannel);
  }, [loading, user?.id]);

  /* ===================== CALL MANAGEMENT ===================== */
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

    if (!ice[role].some(c => c.candidate === candidate.candidate)) {
      ice[role].push(candidate);
    }

    await supabase
      .from("calls")
      .update({ ice_candidates: ice })
      .eq("id", callId);
  }

  /* ===================== FETCH CONVERSATIONS - OPTIMIZED with RPC ===================== */
  async function fetchConversations() {
    if (isFetchingConversations) return;
    setIsFetchingConversations(true);

    try {
      // First, get all conversations the user is part of with basic info
      const { data: userConversations, error: convError } = await supabase
        .rpc('get_user_conversations', { user_id: user.id });

      if (convError) throw convError;

      // Then, for each conversation, get only the last message efficiently
      const conversationsWithDetails = await Promise.all(
        userConversations.map(async (convo) => {
          // Get participants for this conversation
          const { data: participants } = await supabase
            .from("participants")
            .select(`
              user_id,
              role,
              joined_at,
              profiles!participants_user_id_fkey (
                id,
                username,
                avatar_url,
                bio,
                last_seen
              )
            `)
            .eq("conversation_id", convo.id);

          // Get only the last message using a separate efficient query
          const { data: lastMessages } = await supabase
            .from("messages")
            .select("id, content, created_at, sender_id, read_at, type, media_url")
            .eq("conversation_id", convo.id)
            .order("created_at", { ascending: false })
            .limit(1);

          // Get unread count efficiently
          const { count: unreadCount } = await supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("conversation_id", convo.id)
            .is("read_at", null)
            .neq("sender_id", user.id);

          const otherParticipant = participants?.find(
            p => p.user_id !== user.id && p.profiles
          );

          if (!otherParticipant && !convo.is_group) return null;

          const otherUser = otherParticipant?.profiles;
          const lastMessage = lastMessages?.[0];

          // Decrypt last message preview if it's text
          let messagePreview = '';
          if (lastMessage) {
            if (lastMessage.type === 'text') {
              const previewKey = useMemo(() => {
                if (!activeConversation || !user?.id || !otherUser?.id) return null;
                const sortedIds = [user.id, otherUser.id].sort().join('_');
                const material = `${convo.id}_${sortedIds}`;
                return nacl.hash(new TextEncoder().encode(material)).slice(0, 32);
              }, [convo.id, user?.id, otherUser?.id]);
              
              messagePreview = decrypt(lastMessage.content, previewKey) || '💬 Message';
            } else {
              messagePreview = lastMessage.type === 'image' ? '📷 Photo' :
                              lastMessage.type === 'voice' ? '🎤 Voice message' :
                              '📎 File';
            }
          }

          return {
            id: convo.id,
            participants,
            otherUser,
            lastMessage,
            lastMessagePreview: messagePreview,
            lastMessageTime: convo.last_message_at || lastMessage?.created_at,
            unreadCount: unreadCount || 0,
            pinned: convo.pinned ?? false,
            muted: convo.muted ?? false,
            archived: convo.archived ?? false,
            isGroup: convo.is_group ?? false,
            groupName: convo.name,
            groupAvatar: convo.avatar_url,
          };
        })
      );

      const cleaned = conversationsWithDetails
        .filter(Boolean)
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return b.pinned - a.pinned;
          return new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0);
        });

      setConversations(cleaned);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      setIsFetchingConversations(false);
    }
  }

  /* ===================== LOAD MESSAGES ===================== */
  async function loadMessages(initial = false, conversationId = activeConversation) {
    if (loadingRef.current || !conversationId || !user?.id) return;
    
    loadingRef.current = true;

    let query = supabase
      .from("messages")
      .select(`
        *,
        sender:sender_id(username, avatar_url),
        reactions:message_reactions(
          emoji,
          user_id,
          profiles:user_id(username, avatar_url)
        )
      `)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (!initial && oldestTimestamp) {
      query = query.lt("created_at", oldestTimestamp);
    }

    const { data, error } = await query;

    if (error || !data) {
      loadingRef.current = false;
      return;
    }

    if (data.length === 0) {
      setHasMore(false);
      loadingRef.current = false;
      return;
    }

    const reversed = [...data].reverse();
    setMessages(prev => initial ? reversed : [...reversed, ...prev]);
    setOldestTimestamp(reversed[0].created_at);
    
    // Mark messages as read in background
    supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .neq("sender_id", user.id)
      .is("read_at", null)
      .then(() => {
        // Update local unread counts
        setConversations(prev => prev.map(c => 
          c.id === conversationId ? { ...c, unreadCount: 0 } : c
        ));
      });

    loadingRef.current = false;
  }

  /* ===================== LOAD MESSAGES ON CONVERSATION CHANGE ===================== */
  useEffect(() => {
    if (!activeConversation) return;

    setMessages([]);
    setHasMore(true);
    setOldestTimestamp(null);
    loadMessages(true, activeConversation);
  }, [activeConversation]);

  /* ===================== REALTIME SUBSCRIPTIONS ===================== */
  useEffect(() => {
    if (!activeConversation || !user?.id) return;

    const msgChannel = supabase
      .channel(`messages-${activeConversation}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${activeConversation}`,
        },
        payload => {
          setMessages(prev =>
            prev.some(m => m.id === payload.new.id)
              ? prev
              : [...prev, payload.new]
          );
          
          // Update conversation list locally without refetch
          setConversations(prev => prev.map(c => 
            c.id === activeConversation 
              ? { 
                  ...c, 
                  lastMessage: payload.new,
                  lastMessageTime: payload.new.created_at,
                  unreadCount: payload.new.sender_id !== user.id ? c.unreadCount + 1 : c.unreadCount
                }
              : c
          ));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${activeConversation}`,
        },
        payload => {
          setMessages(prev =>
            prev.map(m => m.id === payload.new.id ? payload.new : m)
          );
        }
      )
      .subscribe();

    const typingChannel = supabase
      .channel(`typing-${activeConversation}`)
      .on("broadcast", { event: "typing" }, payload => {
        const { userId, conversationId } = payload.payload;
        if (userId === user.id) return;

        setTypingInConversation(prev => ({
          ...prev,
          [conversationId]: true,
        }));

        setTimeout(() => {
          setTypingInConversation(prev => {
            const copy = { ...prev };
            delete copy[conversationId];
            return copy;
          });
        }, 1500);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(typingChannel);
    };
  }, [activeConversation, user?.id]);

  /* ===================== CALL REALTIME ===================== */
  useEffect(() => {
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
          const call = payload.new;
          if (
            call.status === "ringing" &&
            call.participants?.includes(user.id) &&
            call.caller_id !== user.id
          ) {
            setIncomingCall(call);
            setCallType(call.type);
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [user?.id]);

  useEffect(() => {
    if (!activeCallId) return;

    const channel = supabase
      .channel(`call-${activeCallId}`)
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
            setCallStatus("connected");
          }
          if (call.status === "ended") {
            cleanupCall();
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [activeCallId]);

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

          const remoteRole = payload.new.caller_id === user.id ? "callee" : "caller";

          for (const candidate of ice?.[remoteRole] || []) {
            try {
              if (!pcRef.current?.remoteDescription) continue;
              await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
              console.warn("ICE add failed", e);
            }
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [activeCallId, user?.id]);

  /* ===================== CALL DURATION TIMER ===================== */
  const startCallTimer = useCallback(() => {
    const startTime = Date.now();
    callTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      setCallDuration(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);
  }, []);

  /* ===================== MESSAGE ACTIONS ===================== */
  async function sendMessage(type = "text", mediaUrl = null) {
    if (user?.is_muted && new Date(user.muted_until) > new Date()) {
      alert("You are muted");
      return;
    }

    if ((type === "text" && !text.trim()) || !activeConversation || !activeUser) return;

    const messageId = crypto.randomUUID();
    const isSpam = /(http|https|www\.)/i.test(text);
    let content = text;

    if (type === "text" && sharedKey) {
      content = encrypt(text, sharedKey);
    }

    const newMessage = {
      id: messageId,
      conversation_id: activeConversation,
      sender_id: user.id,
      receiver_id: activeUser.id,
      content,
      type,
      media_url: mediaUrl,
      created_at: new Date().toISOString(),
      pending: true,
      reactions: [],
      sender: {
        username: user.username,
        avatar_url: user.avatar_url
      }
    };

    // Optimistic update
    setMessages(prev => [...prev, newMessage]);
    setText("");

    const { error } = await supabase.from("messages").insert({
      ...newMessage,
      flagged: isSpam,
    });

    if (error) {
      setMessages(prev =>
        prev.map(m => m.id === messageId ? { ...m, failed: true } : m)
      );
    } else {
      // Update local conversation state
      setMessages(prev =>
        prev.map(m => m.id === messageId ? { ...m, pending: false } : m)
      );
      
      setConversations(prev => prev.map(c => 
        c.id === activeConversation 
          ? { 
              ...c, 
              lastMessage: { ...newMessage, pending: false },
              lastMessageTime: newMessage.created_at,
              lastMessagePreview: type === 'text' ? text : 
                                type === 'image' ? '📷 Photo' :
                                type === 'voice' ? '🎤 Voice message' : '📎 File'
            }
          : c
      ));
    }

    // Update last message time in background
    supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", activeConversation);
  }

  async function reactToMessage(messageId, emoji) {
    const { error } = await supabase.from("message_reactions").upsert({
      message_id: messageId,
      user_id: user.id,
      emoji,
    }, { onConflict: 'message_id,user_id' });

    if (!error) {
      setMessageReactions(prev => ({
        ...prev,
        [messageId]: [...(prev[messageId] || []), { emoji, user_id: user.id }]
      }));
    }
  }

  async function deleteMessage(messageId) {
    if (!isAdmin) return;

    await supabase
      .from("messages")
      .update({
        content: "⚠️ Message removed",
        deleted_by_admin: true,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", messageId);

    setMessages(prev =>
      prev.map(m => m.id === messageId 
        ? { ...m, content: "⚠️ Message removed", deleted_by_admin: true }
        : m
      )
    );
  }

  async function deleteForMe(messageId) {
    setMessages(prev => prev.filter(m => m.id !== messageId));
  }

  /* ===================== CALL FUNCTIONS ===================== */
  async function acceptCall() {
    if (!incomingCall?.id) return;

    const callId = incomingCall.id;
    const type = incomingCall.type;

    setIncomingCall(null);
    setActiveCallId(callId);
    setCallType(type);
    setCallStatus("connecting");

    pcRef.current = createPeerConnection({
      localVideoRef,
      remoteVideoRef,
      onIceCandidate: async (candidate) => {
        await pushIceCandidate("callee", candidate, callId);
      },
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: type === "video",
      audio: true,
    });

    stream.getTracks().forEach(track =>
      pcRef.current.addTrack(track, stream)
    );

    if (incomingCall.offer) {
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(incomingCall.offer)
      );
    }

    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);

    await supabase
      .from("calls")
      .update({ status: "accepted", answer })
      .eq("id", callId);

    setCallStatus("connected");
    startCallTimer();
  }

  async function rejectCall() {
    if (!incomingCall?.id) return;

    await supabase
      .from("calls")
      .update({ status: "rejected" })
      .eq("id", incomingCall.id);

    setIncomingCall(null);
    setCallType(null);
  }

  async function startVoiceCall() {
    const { data, error } = await supabase
      .from("calls")
      .insert({
        conversation_id: activeConversation,
        caller_id: user.id,
        type: "voice",
        status: "ringing",
        participants: [user.id, activeUser.id],
      })
      .select()
      .single();

    if (error) return;

    setActiveCallId(data.id);
    setCallType("voice");
    setCallStatus("ringing");

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

  async function startVideoCall() {
    const { data, error } = await supabase
      .from("calls")
      .insert({
        conversation_id: activeConversation,
        caller_id: user.id,
        type: "video",
        status: "ringing",
        participants: [user.id, activeUser.id],
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      return;
    }

    const callId = data.id;
    setActiveCallId(callId);
    setCallType("video");
    setCallStatus("ringing");

    pcRef.current = createPeerConnection({
      localVideoRef,
      remoteVideoRef,
      onIceCandidate: candidate => {
        pushIceCandidate("caller", candidate, callId);
      },
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    stream.getTracks().forEach(track =>
      pcRef.current.addTrack(track, stream)
    );

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    await supabase
      .from("calls")
      .update({ offer })
      .eq("id", callId);
  }

  function toggleMute() {
    if (pcRef.current) {
      const senders = pcRef.current.getSenders();
      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = !sender.track.enabled;
          setIsMuted(!sender.track.enabled);
        }
      });
    }
  }

  function toggleVideo() {
    if (pcRef.current) {
      const senders = pcRef.current.getSenders();
      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'video') {
          sender.track.enabled = !sender.track.enabled;
          setIsVideoOff(!sender.track.enabled);
        }
      });
    }
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

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    localVideoRef.current?.srcObject
      ?.getTracks()
      .forEach(t => t.stop());

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    setActiveCallId(null);
    setCallType(null);
    setCallStatus(null);
    setCallDuration("00:00");
    setIsMuted(false);
    setIsVideoOff(false);
  }

  /* ===================== CONVERSATION MANAGEMENT ===================== */
  async function openOrCreateConversation(otherUser) {
    if (!user?.id || !otherUser?.id) return null;

    const conversationKey = [user.id, otherUser.id].sort().join("_");

    const { data: existing, error: findError } = await supabase
      .from("conversations")
      .select("id")
      .eq("conversation_key", conversationKey)
      .single();

    if (existing) return existing.id;

    const { data: convo, error: insertError } = await supabase
      .from("conversations")
      .insert({ conversation_key: conversationKey })
      .select()
      .single();

    if (insertError) {
      console.error("Conversation create error:", insertError);
      return null;
    }

    await supabase.from("participants").insert([
      { conversation_id: convo.id, user_id: user.id, role: "admin", joined_at: new Date() },
      { conversation_id: convo.id, user_id: otherUser.id, role: "member", joined_at: new Date() },
    ]);

    // Add to conversations list optimistically
    const newConvo = {
      id: convo.id,
      participants: [
        { user_id: user.id, profiles: user },
        { user_id: otherUser.id, profiles: otherUser }
      ],
      otherUser,
      lastMessage: null,
      lastMessagePreview: 'No messages yet',
      lastMessageTime: null,
      unreadCount: 0,
      pinned: false,
      muted: false,
      archived: false,
      isGroup: false
    };

    setConversations(prev => [newConvo, ...prev]);

    return convo.id;
  }

  function openConversation(convo) {
    if (!convo?.id || !convo.otherUser) {
      console.warn("Invalid conversation object", convo);
      return;
    }

    setActiveConversation(convo.id);
    setActiveUser(convo.otherUser);
    setLastReadAt(new Date().toISOString());
    setSidebarOpen(false);
  }

  async function createGroup(name, members) {
    const { data: convo } = await supabase
      .from("conversations")
      .insert({ is_group: true, name })
      .select()
      .single();

    await supabase.from("participants").insert([
      { conversation_id: convo.id, user_id: user.id, role: "admin", joined_at: new Date() },
      ...members.map(u => ({
        conversation_id: convo.id,
        user_id: u.id,
        role: "member",
        joined_at: new Date(),
      })),
    ]);

    fetchConversations();
  }

  async function updateChatSettings(conversationId, settings) {
    await supabase
      .from("conversations")
      .update(settings)
      .eq("id", conversationId);

    setConversations(prev => prev.map(c => 
      c.id === conversationId ? { ...c, ...settings } : c
    ));
    
    setChatSettings(prev => ({ ...prev, ...settings }));
  }

  /* ===================== TYPING HANDLER ===================== */
  function handleTyping(e) {
    setText(e.target.value);

    if (!activeConversation || typingTimeout.current) return;

    typingTimeout.current = setTimeout(() => {
      typingTimeout.current = null;
    }, 800);

    supabase.channel(`typing-${activeConversation}`).send({
      type: "broadcast",
      event: "typing",
      payload: {
        userId: user.id,
        conversationId: activeConversation
      },
    });
  }

  /* ===================== MEDIA UPLOAD ===================== */
  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `${user.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('chat-media')
      .getPublicUrl(filePath);

    const type = file.type.startsWith('image/') ? 'image' : 'file';
    await sendMessage(type, publicUrl);
  }

  /* ===================== STORIES ===================== */
  async function fetchUserStories(userId) {
    const { data, error } = await supabase
      .from('stories')
      .select('*')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (!error) {
      setUserStories(data || []);
    }
  }

  async function uploadStory(file) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `stories/${user.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('stories')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Story upload error:', uploadError);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('stories')
      .getPublicUrl(filePath);

    const { error: insertError } = await supabase
      .from('stories')
      .insert({
        user_id: user.id,
        media_url: publicUrl,
        type: file.type.startsWith('image/') ? 'image' : 'video',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });

    if (insertError) {
      console.error('Story insert error:', insertError);
    }
  }

  function viewStory(userId) {
    setStoryViewer(userId);
    setShowStoryViewer(true);
    setCurrentStoryIndex(0);
    fetchUserStories(userId);
  }

  /* ===================== VOICE NOTES ===================== */
  async function startVoiceRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks = [];

      mediaRecorder.ondataavailable = event => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        if (voiceTimerRef.current) {
          clearInterval(voiceTimerRef.current);
          voiceTimerRef.current = null;
        }

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const fileName = `${crypto.randomUUID()}.webm`;
        const filePath = `voice-notes/${user.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(filePath, audioBlob);

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('chat-media')
            .getPublicUrl(filePath);

          await sendMessage('voice', publicUrl);
        }

        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        setRecordingTime(0);
      };

      voiceRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);

      const startTime = Date.now();
      voiceTimerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, 60000);

    } catch (error) {
      console.error('Voice recording error:', error);
    }
  }

  function stopVoiceRecording() {
    if (voiceRecorderRef.current?.state === 'recording') {
      voiceRecorderRef.current.stop();
    }
  }

  useEffect(() => {
    return () => {
      if (voiceTimerRef.current) {
        clearInterval(voiceTimerRef.current);
      }
    };
  }, []);

  /* ===================== MESSAGE SELECTION ===================== */
  function toggleMessageSelection(messageId) {
    setSelectedMessages(prev => {
      if (prev.includes(messageId)) {
        return prev.filter(id => id !== messageId);
      } else {
        return [...prev, messageId];
      }
    });
  }

  function clearSelection() {
    setSelectedMessages([]);
    setIsSelectionMode(false);
  }

  async function deleteSelectedMessages() {
    if (!isAdmin) return;

    for (const messageId of selectedMessages) {
      await deleteMessage(messageId);
    }
    clearSelection();
  }

  /* ===================== CLICK OUTSIDE HANDLER ===================== */
  useEffect(() => {
    function handleClickOutside(event) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  /* ===================== RENDER MESSAGE ===================== */
  const MessageRow = useCallback(({ message, isMe, showDate, showNewDivider }) => {
    const decryptedContent = useMemo(() => {
      if (message.type === 'text' && message.content && !message.deleted_by_admin) {
        return decrypt(message.content, sharedKey);
      }
      return message.content;
    }, [message, sharedKey]);

    const reactions = messageReactions[message.id] || [];

    return (
      <div 
        key={message.id} 
        className={`msg ${isMe ? 'right' : 'left'} ${selectedMessages.includes(message.id) ? 'selected' : ''}`}
        onClick={() => isSelectionMode && toggleMessageSelection(message.id)}
        onDoubleClick={() => !isSelectionMode && setReplyTo(message)}
      >
        {showDate && (
          <div className="date-separator">
            {getDateLabel(message.created_at)}
          </div>
        )}

        {showNewDivider && (
          <div className="new-messages">New messages</div>
        )}

        <div className="message-content">
          {message.type === 'text' && (
            <span>{message.deleted_by_admin ? message.content : decryptedContent}</span>
          )}

          {message.type === 'image' && (
            <img 
              src={message.media_url} 
              alt="Shared image" 
              className="message-image"
              onClick={() => window.open(message.media_url, '_blank')}
            />
          )}

          {message.type === 'voice' && (
            <audio controls src={message.media_url} className="voice-note" />
          )}

          {message.type === 'file' && (
            <a href={message.media_url} target="_blank" rel="noopener noreferrer" className="file-attachment">
              📎 Download file
            </a>
          )}

          {reactions.length > 0 && (
            <div className="message-reactions">
              {reactions.map((r, i) => (
                <span key={i} className="reaction-emoji" title={r.profiles?.username}>
                  {r.emoji}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="message-footer">
          {!isMe && message.sender && (
            <span className="sender-name">{message.sender.username}</span>
          )}
          <span className="time">
            {isMe && (message.pending ? '⏳ ' : message.read_at ? '✔✔ ' : '✔ ')}
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        {isSelectionMode && (
          <input 
            type="checkbox" 
            className="message-select"
            checked={selectedMessages.includes(message.id)}
            onChange={() => toggleMessageSelection(message.id)}
          />
        )}
      </div>
    );
  }, [sharedKey, messageReactions, isSelectionMode, selectedMessages]);

  /* ===================== GUARDS ===================== */
  if (loading) return <div className="loading-screen">Loading Photogram...</div>;
  if (!user) return <div className="error-screen">Not authenticated</div>;

  if (isBanned) {
    return (
      <div className="banned-screen">
        <div className="banned-content">
          <h2>🚫 You have been banned</h2>
          {bannedUntil ? (
            <p>Banned until: {new Date(bannedUntil).toLocaleString()}</p>
          ) : (
            <p>This ban is permanent</p>
          )}
          <button onClick={() => supabase.auth.signOut()} className="logout-btn">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  /* ===================== UI RENDER ===================== */
  return (
    <div className="chat-app">
      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-header-left">
            <img src="/photogram-logo.png" alt="Photogram" className="sidebar-logo" />
            <strong>Photogram</strong>
          </div>
          <div className="sidebar-header-right">
            <button className="theme-toggle" onClick={() => {
              const themes = ['dark', 'light', 'blue', 'purple', 'instagram'];
              const current = document.body.dataset.theme || 'dark';
              const next = themes[(themes.indexOf(current) + 1) % themes.length];
              document.body.dataset.theme = next;
            }} title="Change theme">
              🎨
            </button>
            <button className="close-sidebar" onClick={() => setSidebarOpen(false)}>✕</button>
          </div>
        </div>

        <div className="sidebar-search-container">
          <input
            className="sidebar-search"
            placeholder="Search or start new chat"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="sidebar-tabs">
          <button className="tab active">Chats</button>
          <button className="tab">Status</button>
          <button className="tab">Calls</button>
          <button className="tab">Archive</button>
        </div>

        <StatusUploader onStoryUpload={uploadStory} />

        <UserSearch
          onSelect={async otherUser => {
            const convoId = await openOrCreateConversation(otherUser);
            setActiveConversation(convoId);
            setActiveUser(otherUser);
            setSidebarOpen(false);
          }}
        />

        <div className="conversation-list">
          {conversations
            .filter(c => !c.archived || search)
            .filter(c => c.otherUser?.username?.toLowerCase().includes(search.toLowerCase()) || 
                        c.groupName?.toLowerCase().includes(search.toLowerCase()))
            .map(convo => {
              const isGroup = convo.isGroup;
              const name = isGroup ? convo.groupName : convo.otherUser?.username;
              const avatar = isGroup ? convo.groupAvatar : convo.otherUser?.avatar_url;
              const isOnline = !isGroup && onlineUsers[convo.otherUser?.id];
              const isTyping = typingInConversation[convo.id];

              return (
                <div
                  key={convo.id}
                  className={`conversation-item ${activeConversation === convo.id ? 'active' : ''} ${convo.pinned ? 'pinned' : ''}`}
                  onClick={() => openConversation(convo)}
                >
                  <div className="avatar-wrapper" onClick={(e) => {
                    e.stopPropagation();
                    if (!isGroup && convo.otherUser) {
                      viewStory(convo.otherUser.id);
                    }
                  }}>
                    {isGroup ? (
                      <div className="group-avatar">
                        {convo.participants?.slice(0, 3).map(p => (
                          <img
                            key={p.user_id}
                            src={p.profiles?.avatar_url || '/default-avatar.png'}
                            alt=""
                          />
                        ))}
                      </div>
                    ) : (
                      <>
                        <img
                          className="avatar"
                          src={avatar || '/default-avatar.png'}
                          alt={name}
                        />
                        {isOnline && <span className="online-dot" title="Online" />}
                      </>
                    )}
                    {convo.unreadCount > 0 && (
                      <span className="unread-badge">{convo.unreadCount}</span>
                    )}
                  </div>

                  <div className="chat-info">
                    <div className="chat-header-row">
                      <span className="name">{name}</span>
                      <span className="time">
                        {convo.lastMessageTime &&
                          new Date(convo.lastMessageTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                      </span>
                    </div>

                    <div className="chat-preview-row">
                      <span className="preview">
                        {isTyping ? (
                          <span className="typing-text">typing...</span>
                        ) : convo.lastMessagePreview ? (
                          convo.lastMessagePreview
                        ) : (
                          'No messages yet'
                        )}
                      </span>

                      <div className="chat-icons">
                        {convo.muted && <span className="muted-icon" title="Muted">🔕</span>}
                        {convo.pinned && <span className="pinned-icon" title="Pinned">📌</span>}
                      </div>
                    </div>
                  </div>

                  <button
                    className="conversation-menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveProfile(convo);
                      setShowProfileSidebar(true);
                    }}
                    title="Chat options"
                  >
                    ⋮
                  </button>
                </div>
              );
            })}
        </div>
      </aside>

      {/* MAIN CHAT WINDOW */}
      <main className="chat-window">
        {!activeConversation ? (
          <div className="empty-chat">
            <div className="empty-chat-content">
              <img src="/photogram-logo-large.png" alt="Photogram" className="empty-logo" />
              <h2>Welcome to Photogram</h2>
              <p>Select a chat to start messaging</p>
              <button className="new-chat-btn" onClick={() => setSidebarOpen(true)}>
                Start new chat
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* CHAT HEADER */}
            <div className="chat-header">
              <button className="mobile-menu" onClick={() => setSidebarOpen(true)}>
                ☰
              </button>

              <button
                className="mobile-back"
                onClick={() => {
                  setActiveConversation(null);
                  setActiveUser(null);
                  setMessages([]);
                }}
              >
                ←
              </button>

              <div className="chat-header-user" onClick={() => setShowProfileSidebar(true)}>
                <img
                  src={activeUser?.avatar_url || '/default-avatar.png'}
                  alt={activeUser?.username}
                  className="chat-header-avatar"
                />
                <div>
                  <div className="username">{activeUser?.username}</div>
                  {onlineUsers[activeUser?.id] && (
                    <div className="status">online</div>
                  )}
                </div>
              </div>

              <div className="chat-header-actions">
                <button className="search-btn" title="Search messages" disabled>
                  🔍
                </button>
                <button className="voice-call-btn" onClick={startVoiceCall} title="Voice call">
                  📞
                </button>
                <button className="video-call-btn" onClick={startVideoCall} title="Video call">
                  📹
                </button>
                <button 
                  className="menu-btn" 
                  onClick={() => setShowProfileSidebar(true)}
                  title="Chat info"
                >
                  ⋮
                </button>
              </div>
            </div>

            {/* MESSAGES */}
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
                  const showNewDivider = lastReadAt &&
                    !isMe &&
                    !newDividerShown &&
                    new Date(msg.created_at) > new Date(lastReadAt);

                  if (showNewDivider) newDividerShown = true;

                  return (
                    <MessageRow
                      key={msg.id}
                      message={msg}
                      isMe={isMe}
                      showDate={showDate}
                      showNewDivider={showNewDivider}
                    />
                  );
                });
              })()}

              <div ref={messagesEndRef} />
            </div>

            {/* TYPING INDICATOR */}
            {typingInConversation[activeConversation] && (
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            )}

            {/* REPLY PREVIEW */}
            {replyTo && (
              <div className="reply-preview">
                <div className="reply-content">
                  <span className="replying-to">Replying to</span>
                  <p className="reply-text">
                    {replyTo.type === 'text' 
                      ? decrypt(replyTo.content, sharedKey)
                      : replyTo.type === 'image' 
                        ? '📷 Photo'
                        : replyTo.type === 'voice'
                          ? '🎤 Voice message'
                          : '📎 File'
                    }
                  </p>
                </div>
                <button className="close-reply" onClick={() => setReplyTo(null)}>✕</button>
              </div>
            )}

            {/* CHAT INPUT */}
            <div className="chat-input-container">
              <div className="chat-input-actions">
                <button className="emoji-btn" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                  😊
                </button>
                <button className="attach-btn" onClick={() => fileInputRef.current?.click()}>
                  📎
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                  accept="image/*,video/*,.pdf,.doc,.docx"
                />
                {!isRecording ? (
                  <button className="voice-btn" onClick={startVoiceRecording}>
                    🎤
                  </button>
                ) : (
                  <button className="voice-btn recording" onClick={stopVoiceRecording}>
                    ⏹️ {recordingTime}s
                  </button>
                )}
              </div>

              <input
                className="chat-input"
                value={text}
                onChange={handleTyping}
                onKeyPress={e => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
              />

              <button 
                className="send-btn"
                onClick={() => sendMessage()}
                disabled={!text.trim()}
              >
                ➤
              </button>
            </div>

            {/* EMOJI PICKER */}
            {showEmojiPicker && (
              <div className="emoji-picker" ref={emojiPickerRef}>
                {['😊', '😂', '❤️', '👍', '😢', '🔥', '🎉', '😍'].map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => {
                      setText(prev => prev + emoji);
                      setShowEmojiPicker(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* PROFILE SIDEBAR */}
      {showProfileSidebar && activeUser && (
        <div className="profile-sidebar">
          <div className="profile-header">
            <h3>Chat Info</h3>
            <button onClick={() => setShowProfileSidebar(false)}>✕</button>
          </div>

          <div className="profile-content">
            <img
              src={activeUser?.avatar_url || '/default-avatar.png'}
              alt={activeUser?.username}
              className="profile-avatar-large"
            />

            <h2 className="profile-name">{activeUser?.username}</h2>
            {activeUser?.bio && <p className="profile-bio">{activeUser.bio}</p>}

            <div className="profile-stats">
              <div className="stat">
                <span className="stat-value">{messages.length}</span>
                <span className="stat-label">Messages</span>
              </div>
              <div className="stat">
                <span className="stat-value">
                  {onlineUsers[activeUser?.id] ? 'Online' : 'Offline'}
                </span>
                <span className="stat-label">Status</span>
              </div>
            </div>

            <div className="profile-actions">
              <button className="profile-action" onClick={startVoiceCall}>
                📞 Voice Call
              </button>
              <button className="profile-action" onClick={startVideoCall}>
                📹 Video Call
              </button>
              <button className="profile-action" onClick={() => viewStory(activeUser?.id)}>
                📸 View Story
              </button>
            </div>

            <div className="chat-settings">
              <h4>Chat Settings</h4>
              
              <label className="setting-item">
                <span>Mute notifications</span>
                <input
                  type="checkbox"
                  checked={chatSettings.mute}
                  onChange={e => updateChatSettings(activeConversation, { muted: e.target.checked })}
                />
              </label>

              <label className="setting-item">
                <span>Pin chat</span>
                <input
                  type="checkbox"
                  checked={chatSettings.pin}
                  onChange={e => updateChatSettings(activeConversation, { pinned: e.target.checked })}
                />
              </label>

              <label className="setting-item">
                <span>Archive chat</span>
                <input
                  type="checkbox"
                  checked={chatSettings.archive}
                  onChange={e => updateChatSettings(activeConversation, { archived: e.target.checked })}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* INCOMING CALL OVERLAY - WhatsApp Style */}
      {incomingCall && (
        <div className="call-overlay">
          <div className="call-card">
            <div className="call-header">
              <img
                src={activeUser?.avatar_url || '/default-avatar.png'}
                alt="Caller"
                className="caller-avatar"
              />
              <h2>Incoming {incomingCall.type} call</h2>
              <p>{activeUser?.username} is calling you</p>
              <div className="call-type-badge">
                <span>{incomingCall.type === 'video' ? '📹' : '📞'}</span>
                <span>{incomingCall.type === 'video' ? 'Video Call' : 'Voice Call'}</span>
              </div>
            </div>
            <div className="call-actions">
              <button className="accept-call" onClick={acceptCall}>
                <span>📞</span> Accept
              </button>
              <button className="reject-call" onClick={rejectCall}>
                <span>❌</span> Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE CALL UI - WhatsApp Style */}
      {activeCallId && (
        <div className="active-call">
          <div className="call-status-bar">
            <div className="call-status-left">
              <span>Calling</span>
              <strong>{activeUser?.username}</strong>
            </div>
            <div className="call-timer">{callDuration}</div>
            <div className="call-quality">
              <span className="dot"></span>
              <span>Excellent</span>
            </div>
          </div>

          {callType === 'video' ? (
            <div className="video-container">
              <video 
                ref={localVideoRef} 
                autoPlay 
                muted 
                playsInline 
                className="local-video" 
              />
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                className="remote-video" 
              />
            </div>
          ) : (
            <div className="voice-call-container">
              <img 
                src={activeUser?.avatar_url || '/default-avatar.png'} 
                alt={activeUser?.username}
                className="voice-call-avatar"
              />
              <h2 className="voice-call-name">{activeUser?.username}</h2>
              <p className="voice-call-status">
                {callStatus === 'ringing' ? 'Ringing...' : 
                 callStatus === 'connecting' ? 'Connecting...' : 
                 'Connected'}
              </p>
              {callStatus === 'connected' && (
                <div className="voice-wave">
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              )}
            </div>
          )}

          <div className="call-controls">
            <button 
              className={`call-control-btn ${isMuted ? 'mic-off' : ''}`}
              onClick={toggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
            
            {callType === 'video' && (
              <button 
                className={`call-control-btn ${isVideoOff ? 'video-off' : ''}`}
                onClick={toggleVideo}
                title={isVideoOff ? 'Turn on video' : 'Turn off video'}
              >
                {isVideoOff ? '📹' : '🎥'}
              </button>
            )}
            
            <button 
              className="end-call-btn"
              onClick={endCall}
              title="End call"
            >
              📞
            </button>
          </div>
        </div>
      )}

      {/* STORY VIEWER - Instagram Style */}
      {showStoryViewer && userStories.length > 0 && (
        <div className="story-viewer">
          <button className="close-story" onClick={() => setShowStoryViewer(false)}>
            ✕
          </button>
          
          <div className="story-container">
            <div className="story-progress">
              {userStories.map((_, index) => (
                <div
                  key={index}
                  className={`progress-bar ${index === currentStoryIndex ? 'active' : ''} ${index < currentStoryIndex ? 'viewed' : ''}`}
                />
              ))}
            </div>

            <div className="story-content">
              {userStories[currentStoryIndex]?.type === 'image' ? (
                <img
                  src={userStories[currentStoryIndex].media_url}
                  alt="Story"
                  className="story-media"
                />
              ) : (
                <video
                  src={userStories[currentStoryIndex].media_url}
                  autoPlay
                  loop
                  className="story-media"
                />
              )}
            </div>

            <button
              className="story-prev"
              onClick={() => setCurrentStoryIndex(prev => Math.max(0, prev - 1))}
              disabled={currentStoryIndex === 0}
            >
              ‹
            </button>
            <button
              className="story-next"
              onClick={() => setCurrentStoryIndex(prev => Math.min(userStories.length - 1, prev + 1))}
              disabled={currentStoryIndex === userStories.length - 1}
            >
              ›
            </button>
          </div>
        </div>
      )}

      {/* SELECTION MODE BAR */}
      {isSelectionMode && (
        <div className="selection-bar">
          <span>{selectedMessages.length} selected</span>
          <button onClick={clearSelection}>Cancel</button>
          {isAdmin && (
            <button onClick={deleteSelectedMessages} className="delete-selected">
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}