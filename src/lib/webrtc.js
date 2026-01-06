export function createPeerConnection(onIce) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.onicecandidate = e => {
    if (e.candidate) onIce(e.candidate);
  };

  return pc;
}
