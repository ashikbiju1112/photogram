// src/lib/webrtc.js

export function createPeerConnection({ 
  localVideoRef, 
  remoteVideoRef,
  onIceCandidate 
}) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  // 🔹 Receive remote stream
  pc.ontrack = (event) => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = event.streams[0];
    }
  };

  // 🔹 ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      onIceCandidate(event.candidate);
    }
  };

  return pc;
}

export async function getLocalStream(localVideoRef, pc) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  if (localVideoRef.current) {
    localVideoRef.current.srcObject = stream;
  }

  stream.getTracks().forEach(track =>
    pc.addTrack(track, stream)
  );

  return stream;
}
