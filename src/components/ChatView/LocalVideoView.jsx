import React, { useEffect, useRef } from 'react';

const LocalVideoView = ({ stream }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!stream) {
    return <div>Loading local video...</div>;
  }

  return (
    <div>
      <h2>My Video</h2>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '320px', height: '240px', border: '1px solid black' }} />
    </div>
  );
};

export default LocalVideoView;
