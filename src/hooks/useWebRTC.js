import { useState, useEffect, useRef, useCallback } from 'react';

// TURN server credentials from static-auth-secret
const TURN_USERNAME = 'user'; // A generic username, as static-auth-secret is used
const TURN_PASSWORD = '43871edb5bb8d27414e4ba071b230d2cd1f88b8f2876fbc5801c5b2c8a8bd382'; // Your static-auth-secret

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:turn.zaidlab.xyz:3478', // Ensure this matches your Cloudflare Tunnel and Coturn setup
    username: TURN_USERNAME,
    credential: TURN_PASSWORD,
  },
  // You might need a TCP TURN entry as well, depending on network restrictions
  // {
  //   urls: 'turn:turn.zaidlab.xyz:3478?transport=tcp',
  //   username: TURN_USERNAME,
  //   credential: TURN_PASSWORD,
  // }
];

const useWebRTC = (localStream, signalingService) => {
  const [peerConnection, setPeerConnection] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  // Ref to ensure peer connection is created only once or managed properly
  const pcRef = useRef(null);

  // Cleanup function used in multiple places
  const closeCurrentConnection = useCallback(() => {
    if (pcRef.current) {
      console.log('useWebRTC: Closing existing PeerConnection.');
      pcRef.current.getSenders().forEach(sender => {
        if (sender.track && sender.track.readyState === 'live') { // Check if track is live
          sender.track.stop(); // Stop tracks associated with this PC
        }
      });
      pcRef.current.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
    setIsConnected(false);
    setIsConnecting(false);
    setPeerConnection(null); // Also update state if you use it elsewhere
  }, []);


  // Initialize PeerConnection
  const initializePeerConnection = useCallback(() => {
    // If localStream is not yet available, don't proceed.
    if (!localStream) {
      console.warn('useWebRTC: Local stream not available for PeerConnection initialization.');
      if (pcRef.current) { // If a PC exists (e.g. from a previous attempt with a stream that's now gone)
        closeCurrentConnection();
      }
      return null;
    }

    // If a PeerConnection already exists, close it before creating a new one to ensure clean state.
    // This might happen if initializePeerConnection is called again for some reason.
    if (pcRef.current) {
      console.log('useWebRTC: PeerConnection already exists. Closing it before re-initializing.');
      closeCurrentConnection();
    }
    
    console.log('useWebRTC: Initializing new PeerConnection with ICE servers:', ICE_SERVERS);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && signalingService) {
        console.log('useWebRTC: Sending ICE candidate:', event.candidate);
        signalingService.sendSignal({ type: 'candidate', candidate: event.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`useWebRTC: ICE connection state changed to: ${pc.iceConnectionState}`);
      switch (pc.iceConnectionState) {
        case 'connected':
          setIsConnecting(false);
          setIsConnected(true);
          console.log('useWebRTC: Peers connected!');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          setIsConnected(false);
          setIsConnecting(false);
          // Consider cleanup or retry logic here
          break;
        case 'checking':
          setIsConnecting(true);
          break;
        default:
          break;
      }
    };

    pc.ontrack = (event) => {
      console.log('useWebRTC: Remote track received:', event.streams[0]);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    // Add local tracks to the peer connection
    localStream.getTracks().forEach(track => {
      console.log('useWebRTC: Adding local track:', track);
      pc.addTrack(track, localStream);
    });
    
    setPeerConnection(pc); // Keep state in sync if needed, though pcRef is primary
    return pc;
  }, [localStream, signalingService, closeCurrentConnection]); // Added closeCurrentConnection


  // Function to create an offer
  const createOffer = async () => {
    const currentPC = pcRef.current; // Work with a stable reference
    if (!currentPC || !signalingService) {
        console.error('useWebRTC: PeerConnection or signaling service not available for createOffer. PC:', currentPC, 'Signaling:', !!signalingService);
        return;
    }
    try {
      console.log('useWebRTC: Creating offer...');
      const offer = await currentPC.createOffer();
      await currentPC.setLocalDescription(offer);
      console.log('useWebRTC: Offer created and set as local description. Sending offer.');
      signalingService.sendSignal({ type: 'offer', sdp: currentPC.localDescription });
    } catch (error) {
      console.error('useWebRTC: Error creating offer:', error);
    }
  };

  // Function to handle a received offer and create an answer
  const handleOffer = async (offerSdp) => {
    const currentPC = pcRef.current; // Work with a stable reference
    if (!currentPC || !signalingService) {
        console.error('useWebRTC: PeerConnection or signaling service not available for handleOffer. PC:', currentPC, 'Signaling:', !!signalingService);
        return;
    }
    try {
      console.log('useWebRTC: Received offer. Setting remote description.');
      await currentPC.setRemoteDescription(new RTCSessionDescription(offerSdp));
      console.log('useWebRTC: Creating answer...');
      const answer = await currentPC.createAnswer();
      await currentPC.setLocalDescription(answer);
      console.log('useWebRTC: Answer created and set as local description. Sending answer.');
      signalingService.sendSignal({ type: 'answer', sdp: currentPC.localDescription });
    } catch (error) {
      console.error('useWebRTC: Error handling offer:', error);
    }
  };

  // Function to handle a received answer
  const handleAnswer = async (answerSdp) => {
    const currentPC = pcRef.current; // Work with a stable reference
    if (!currentPC) {
        console.error('useWebRTC: PeerConnection not available for handleAnswer. PC:', currentPC);
        return;
    }
    try {
      console.log('useWebRTC: Received answer. Setting remote description.');
      await currentPC.setRemoteDescription(new RTCSessionDescription(answerSdp));
    } catch (error) {
      console.error('useWebRTC: Error handling answer:', error);
    }
  };

  // Function to handle a received ICE candidate
  const handleCandidate = async (candidate) => {
    const currentPC = pcRef.current; // Work with a stable reference
    if (!currentPC) {
        console.error('useWebRTC: PeerConnection not available for handleCandidate. PC:', currentPC);
        return;
    }
    try {
      if (candidate) {
        console.log('useWebRTC: Received ICE candidate. Adding candidate.');
        await currentPC.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('useWebRTC: Error adding received ICE candidate:', error);
    }
  };
  
  // Expose closeCurrentConnection as closeConnection for external use
  const closeConnection = closeCurrentConnection;

  useEffect(() => {
    // This effect is primarily for cleanup when the component unmounts
    return () => {
      closeConnection(); // Use the consistent cleanup function
    };
  }, [closeConnection]); // Dependency on closeConnection (which itself is a useCallback)


  return {
    // peerConnection: pcRef.current, // Avoid exposing pcRef directly if state is managed internally
    remoteStream,
    isConnecting,
    isConnected,
    initializePeerConnection,
    createOffer,
    handleOffer,
    handleAnswer,
    handleCandidate,
    closeConnection, // Expose the cleanup function
  };
};

export default useWebRTC;
