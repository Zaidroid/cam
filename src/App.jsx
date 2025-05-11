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
  const [chatPartnerId, setChatPartnerId] = useState(null); 
  const [pendingPairingData, setPendingPairingData] = useState(null); // To hold pairing data if localStream isn't ready

  const remoteVideoRef = useRef(null);

  // Initialize signaling service
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

  // Effect to process pending pairing data once localStream is available
  useEffect(() => {
    if (localStream && pendingPairingData) {
      console.log("App: localStream and pendingPairingData ready, proceeding with WebRTC setup.");
      const { partnerId, chatRoomId, shouldOffer } = pendingPairingData;
      
      // Signaling service should have already joined chatRoomId via handlePaired.
      // Now, initialize WebRTC connection.
      const pc = initializePeerConnection();
      if (pc && shouldOffer) {
        console.log("App: Designated to create offer (from useEffect).");
        createOffer();
      } else if (pc) {
        console.log("App: Waiting for offer from partner (from useEffect).");
      }
      // else: pc is null, initializePeerConnection logged a warning, error should be shown.
      
      setPendingPairingData(null); // Clear pending data
      // signalingService.isPairingInProgress should be reset by signalingService itself
      // once it successfully subscribes to the chat room or if it fails.
    }
  }, [localStream, pendingPairingData, initializePeerConnection, createOffer]);


  const handleSignalMessage = (signal) => {
    console.log('App: Received signal:', signal);
    if (!localStream && !['offer', 'answer', 'candidate'].includes(signal.type)) {
      // Allow non-WebRTC signals even if localStream isn't ready (e.g. pairing messages)
      // But for actual WebRTC SDP/ICE, localStream (and thus peerConnection) is needed.
    } else if (!localStream && ['offer', 'answer', 'candidate'].includes(signal.type)) {
      console.warn("App: Received WebRTC signal but local stream is not ready yet. Ignoring.");
      return;
    }
    
    // Initialize PC only if we have a local stream and it's a relevant signal type
    let pc = null;
    if (localStream && ['offer', 'answer', 'candidate'].includes(signal.type)) {
        pc = initializePeerConnection(); 
        if (!pc) {
            console.error("App: PeerConnection could not be initialized for WebRTC signal.");
            return;
        }
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
    console.log(`App: Paired callback triggered for partner ${partnerId}, room ${chatRoomId}, shouldOffer: ${shouldOffer}`);
    
    // App tells signaling service to transition channels
    signalingService.leaveWaitingPool(); 
    signalingService.joinChatRoom(chatRoomId); 

    setChatPartnerId(partnerId); // Update UI state
    setIsSearching(false); 

    if (!localStream) {
      console.warn("App: localStream not ready when handlePaired called. Setting pendingPairingData.");
      setError("Preparing video chat... If this persists, check camera/mic permissions.");
      setPendingPairingData({ partnerId, chatRoomId, shouldOffer });
      // isPairingInProgress in signalingService remains true
      return;
    }

    // If localStream is already available
    console.log("App: localStream available in handlePaired. Proceeding with WebRTC setup.");
    const pc = initializePeerConnection();
    if (pc && shouldOffer) {
      console.log("App: Designated to create offer (from handlePaired direct).");
      createOffer();
    } else if (pc) {
      console.log("App: Waiting for offer from partner (from handlePaired direct).");
    }
    // If pc is null here, initializePeerConnection would have logged a warning.
    // signalingService.isPairingInProgress will be set to false by the service itself
    // upon successful subscription to chatRoom or on error.
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
    signalingService.leaveChannel(); // Corrected method name
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
