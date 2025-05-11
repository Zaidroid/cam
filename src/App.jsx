import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [pendingPairingData, setPendingPairingData] = useState(null);
  const [queuedSignals, setQueuedSignals] = useState([]);

  const remoteVideoRef = useRef(null);
  
  const {
    remoteStream,
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
      closeConnection();
    };
  }, [closeConnection]); // Added closeConnection as it's a stable callback from useWebRTC

  // Effect to set remote stream to video element
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Centralized WebRTC signal processing logic
  const processWebRTCSignal = useCallback((signal) => {
    console.log('App: Processing WebRTC signal:', signal.type);
    const pc = initializePeerConnection(); // initializePeerConnection is from useWebRTC, depends on localStream
    if (!pc) {
      console.error("App: PeerConnection could not be initialized for WebRTC signal. LocalStream might still be null in useWebRTC's scope.", signal);
      setError("Failed to initialize video connection. Please try again or check permissions.");
      return;
    }

    switch (signal.type) {
      case 'offer':
        handleOffer(signal.sdp);
        if (!chatPartnerId) setChatPartnerId(signal.from); 
        break;
      case 'answer':
        handleAnswer(signal.sdp);
        break;
      case 'candidate':
        handleCandidate(signal.candidate);
        break;
      default:
        console.warn('App: Unknown signal type in processWebRTCSignal:', signal.type);
    }
  }, [initializePeerConnection, handleOffer, handleAnswer, handleCandidate, chatPartnerId, setChatPartnerId]); // localStream is an indirect dependency via initializePeerConnection

  // Effect to process queued signals once localStream is available in App's state
  useEffect(() => {
    if (localStream && queuedSignals.length > 0) {
      console.log(`App: localStream ready. Processing ${queuedSignals.length} queued signal(s).`);
      const signalsToProcess = [...queuedSignals];
      setQueuedSignals([]); 
      signalsToProcess.forEach(signal => processWebRTCSignal(signal));
    }
  }, [localStream, queuedSignals, processWebRTCSignal]);
  
  // Effect to process pending pairing data once localStream is available
  useEffect(() => {
    if (localStream && pendingPairingData) {
      console.log("App: localStream & pendingPairingData ready. Processing WebRTC setup for pairing.");
      const { partnerId, chatRoomId, shouldOffer } = pendingPairingData;
      
      // Note: signalingService.joinChatRoom was already called in handlePaired
      const pc = initializePeerConnection();
      if (pc && shouldOffer) {
        console.log("App: Designated to create offer (from pending pairing data).");
        createOffer();
      } else if (pc) {
        console.log("App: Waiting for offer from partner (from pending pairing data).");
      } else {
         console.error("App: PC initialization failed during pending pairing processing.");
         setError("Failed to set up video connection after pairing.");
      }
      setPendingPairingData(null);
      // isPairingInProgress is managed by signalingService
    }
  }, [localStream, pendingPairingData, initializePeerConnection, createOffer]);

  // Initial handler for signals from signalingService
  const handleSignalMessage = useCallback((signal) => {
    console.log('App: Received signal from Supabase:', signal);
    if (['offer', 'answer', 'candidate'].includes(signal.type)) {
      if (!localStream) { // Check localStream state directly in App.jsx
        console.warn("App: WebRTC signal received, but localStream (App state) not ready. Queueing signal.");
        setQueuedSignals(prev => [...prev, signal]);
        return;
      }
      processWebRTCSignal(signal);
    } else if (signal.type === 'paired') {
      console.warn("App: 'paired' signal received via generic onSignalMessage. Should be via onPairedCallback.");
      // Potentially call handlePaired if this path is ever hit, though it shouldn't be.
      // handlePaired(signal); 
    } else {
      console.warn('App: Unknown or non-WebRTC signal type received in handleSignalMessage:', signal.type);
    }
  }, [localStream, processWebRTCSignal, setQueuedSignals]); // Dependencies

  const handlePaired = useCallback(async ({ partnerId, chatRoomId, shouldOffer }) => {
    console.log(`App: Paired callback triggered for partner ${partnerId}, room ${chatRoomId}, shouldOffer: ${shouldOffer}`);
    
    try {
      await signalingService.leaveWaitingPool(); 
      await signalingService.joinChatRoom(chatRoomId); 
    } catch (err) {
      console.error("App: Error during channel transition in handlePaired:", err);
      setError(`Failed to switch to chat room: ${err.message}. Please try searching again.`);
      setIsSearching(false); 
      setChatPartnerId(null);
      if (signalingService) signalingService.isPairingInProgress = false;
      return;
    }

    setChatPartnerId(partnerId); 
    setIsSearching(false); 

    if (!localStream) { // Check localStream state directly
      console.warn("App: localStream (App state) not ready when handlePaired called. Setting pendingPairingData.");
      setError("Preparing video chat... If this persists, check camera/mic permissions.");
      setPendingPairingData({ partnerId, chatRoomId, shouldOffer });
      return;
    }

    console.log("App: localStream available in handlePaired. Proceeding with WebRTC setup.");
    const pc = initializePeerConnection();
    if (pc && shouldOffer) {
      console.log("App: Designated to create offer (from handlePaired direct).");
      createOffer();
    } else if (pc) {
      console.log("App: Waiting for offer from partner (from handlePaired direct).");
    } else {
        console.error("App: PC initialization failed in handlePaired direct.");
        setError("Failed to set up video connection after pairing.");
    }
  }, [localStream, initializePeerConnection, createOffer, setError, setChatPartnerId, setIsSearching, setPendingPairingData]); // Dependencies

  // Initialize signaling service - moved handlePaired and handleSignalMessage to useCallback
  useEffect(() => {
    signalingService.initialize(MY_USER_ID, handleSignalMessage, handlePaired);
    return () => {
      // Ensure these are called if the service exists
      if (signalingService) {
        signalingService.leaveChannel(); 
        signalingService.leaveWaitingPool();
      }
    };
  }, [handleSignalMessage, handlePaired]); // Now depends on memoized handlers


  const handleStartSearch = async () => { // Made async
    if (!localStream) {
      setError("Cannot start search: Local media (camera/microphone) is not available.");
      return;
    }
    await handleStopSearchOrChat(); // Added await
    setIsSearching(true);
    setError(null);
    console.log('App: Starting search...');
    signalingService.joinWaitingPool();
  };
  
  const handleStopSearchOrChat = useCallback(async () => { // Made async
    setIsSearching(false);
    setChatPartnerId(null);
    setPendingPairingData(null); 
    setQueuedSignals([]); 
    if (signalingService) {
        await signalingService.leaveChannel(); // Added await
        await signalingService.leaveWaitingPool(); // Added await
        signalingService.isPairingInProgress = false; 
    }
    closeConnection(); 
    console.log('App: Stopped search/chat.');
  }, [closeConnection, signalingService]); // Added signalingService to dependencies


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
