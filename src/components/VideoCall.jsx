// src/components/VideoCall.jsx

import { useRef } from "react";

export default function VideoCall({ localVideoRef, remoteVideoRef }) {
  return (
    <div className="call-overlay">
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
  );
}

