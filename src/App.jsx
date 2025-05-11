import React, { useState, useEffect, useRef } from 'react';
import LocalVideoView from './components/ChatView/LocalVideoView';
import signalingService from './services/signalingService';
import useWebRTC from './hooks/useWebRTC';
import './App.css';

// Generate a simple unique ID for this client for now
const MY_USER_ID = `user_${Math.random().toString(36).substr(2, 9)}`;

function App() {
  const [localStream, setLocalStream] = useState(null);
  const [error, setError] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [chatPartnerId, setChatPartnerId] = useState(null); // For future use

  const remoteVideoRef = useRef(null);

  // Initialize signaling service and WebRTC hook
  useEffect(() => {
    signalingService.initialize(MY_USER_ID, handleSignalMessage, handlePaired);
    return () => {
      signalingService.leaveChannel(); // General cleanup for any active channel
      signalingService.leaveWaitingPool(); // Specific cleanup for waiting pool
    };
  }, []); // Empty dependency array means this runs once on mount and cleans up on unmount
  
  const {
    // peerConnection, // Direct access if needed, but usually through methods
    remoteStream,
    // isConnecting, // WebRTC connection status
    // isConnected,  // WebRTC connection status
    initializePeerConnection,
    createOffer,
    handleOffer,
    handleAnswer,
    handleCandidate,
    closeConnection,
  } = useWebRTC(localStream, signalingService);


  // Get local media stream
  useEffect(() => {
    const getMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
      } catch (err) {
        console.error("Error accessing media devices.", err);
        setError(`Error accessing media devices: ${err.name} - ${err.message}.`);
      }
    };
    getMedia();
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      closeConnection(); // Close WebRTC connection on unmount
    };
  }, []); // Run once on mount

  // Effect to set remote stream to video element
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const handleSignalMessage = (signal) => {
    console.log('App: Received signal:', signal);
    if (!localStream) {
      console.warn("App: Received signal but local stream is not ready yet.");
      // Potentially queue the signal or wait for localStream
      return;
    }
    
    // Ensure peer connection is initialized before handling signals
    // This might be called multiple times but initializePeerConnection is idempotent
    const pc = initializePeerConnection(); 
    if (!pc) {
        console.error("App: PeerConnection could not be initialized.");
        return;
    }

    switch (signal.type) {
      case 'offer':
        handleOffer(signal.sdp);
        setChatPartnerId(signal.from); // Assuming 'from' contains the partner's ID
        break;
      case 'answer':
        handleAnswer(signal.sdp);
        break;
      case 'candidate':
        handleCandidate(signal.candidate);
        break;
      // Add other signal types like 'user-joined', 'user-left', 'paired' as needed
      case 'paired': // Example: a custom signal from matchmaking
        console.log('App: Paired with user:', signal.partnerId);
        setChatPartnerId(signal.partnerId);
        // The offering client (e.g., determined by matchmaking) would call createOffer
        // For simplicity, let's assume this client is the one to make the offer if it's paired.
        // In a real app, one client would be designated as the offerer.
        // This case is now handled by onPairedCallback
        // if (signal.shouldOffer) { 
        //      createOffer();
        // }
        break;
      default:
        console.warn('App: Unknown signal type received:', signal.type);
    }
  };

  const handlePaired = ({ partnerId, chatRoomId, shouldOffer }) => {
    console.log(`App: Paired with ${partnerId}. Joining room: ${chatRoomId}. Should offer: ${shouldOffer}`);
    setChatPartnerId(partnerId);
    setIsSearching(false); // No longer searching once paired

    // Signaling service already joins the chat room internally upon pairing.
    // We just need to initialize peer connection and potentially offer.
    const pc = initializePeerConnection();
    if (pc && shouldOffer) {
      console.log("App: Designated to create offer.");
      createOffer();
    } else if (pc) {
      console.log("App: Waiting for offer from partner.");
    }
  };

  const handleStartSearch = () => {
    if (!localStream) {
      setError("Cannot start search: Local media (camera/microphone) is not available.");
      return;
    }
    // Reset previous connection state if any
    handleStopSearchOrChat(); 

    setIsSearching(true);
    setError(null);
    console.log('App: Starting search...');
    signalingService.joinWaitingPool();
    
    // Matchmaking is now handled by presence updates in signalingService.
    // No need for setTimeout or naive offer creation here.
    
    // Initialize peer connection early, so it's ready when pairing happens
    // initializePeerConnection(); // This is now called within handleSignalMessage or handlePaired
  };
  
  const handleStopSearchOrChat = () => {
    setIsSearching(false);
    setChatPartnerId(null);
    signalingService.leaveChatRoom(); // Renamed from leaveChannel for clarity
    signalingService.leaveWaitingPool();
    closeConnection(); // Close WebRTC peer connection
    console.log('App: Stopped search/chat.');
  };


  if (error) {
    return <div style={{ color: 'red', padding: '20px', border: '1px solid red', margin: '20px' }}>{error}</div>;
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>ArabConnect Video Chat (User ID: {MY_USER_ID})</h1>
      </header>
      <main>
        <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '20px' }}>
          <LocalVideoView stream={localStream} />
          <div>
            <h2>Remote Video</h2>
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '320px', height: '240px', border: '1px solid black', backgroundColor: '#333' }} />
          </div>
        </div>
        {!isSearching && !chatPartnerId && (
          <button onClick={handleStartSearch} disabled={!localStream}>
            Start Search for Partner
          </button>
        )}
        {(isSearching || chatPartnerId) && (
            <button onClick={handleStopSearchOrChat}>
                Stop Search / End Chat
            </button>
        )}
        {isSearching && !chatPartnerId && <p>Searching for a partner...</p>}
        {chatPartnerId && <p>Connected with: {chatPartnerId}</p>}
      </main>
    </div>
  );
}

export default App;
