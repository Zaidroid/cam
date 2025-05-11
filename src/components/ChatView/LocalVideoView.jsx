import React, { useEffect, useRef, useState } from 'react';

const LocalVideoView = () => {
  const videoRef = useRef(null);
  const [mediaStream, setMediaStream] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const getMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setMediaStream(stream);
      } catch (err) {
        console.error("Error accessing media devices.", err);
        setError(`Error accessing media devices: ${err.name} - ${err.message}. Please ensure you have a camera and microphone connected and have granted permission.`);
      }
    };

    getMedia();

    // Cleanup function to stop media tracks when component unmounts
    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [mediaStream]); // Re-run if mediaStream changes (e.g., to stop old stream if a new one was somehow initiated)

  if (error) {
    return <div style={{ color: 'red', padding: '20px', border: '1px solid red', margin: '20px' }}>{error}</div>;
  }

  return (
    <div>
      <h2>My Video</h2>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '320px', height: '240px', border: '1px solid black' }} />
    </div>
  );
};

export default LocalVideoView;
