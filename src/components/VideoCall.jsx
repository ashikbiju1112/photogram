// src/components/VideoCall.jsx

import { useRef } from "react";

export default function VideoCall() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  return (
    <div className="video-call">
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
