export async function initWebRTC(localVideoRef, remoteVideoRef) {
  // 1️⃣ Get camera + mic
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  // 2️⃣ Show local video
  localVideoRef.current.srcObject = stream;

  // 3️⃣ Create PeerConnection
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  // 4️⃣ Send tracks
  stream.getTracks().forEach(track =>
    pc.addTrack(track, stream)
  );

  // 5️⃣ Receive remote video
  pc.ontrack = event => {
    remoteVideoRef.current.srcObject = event.streams[0];
  };

  // ⛔ signaling (offer/answer) will be added later
  return pc;
}
