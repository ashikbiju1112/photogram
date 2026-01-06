import { useEffect, useRef } from "react";
import { initWebRTC } from "../lib/webrtc";

export default function VideoCall() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    initWebRTC(localVideoRef, remoteVideoRef);
  }, []);

  return (
    <div className="video-call">
      {/* Local Camera */}
      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className="local-video"
      />

      {/* Remote Camera */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="remote-video"
      />
    </div>
  );
}
