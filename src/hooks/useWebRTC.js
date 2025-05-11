import { useState, useEffect, useRef, useCallback } from 'react';

// Placeholder for TURN server credentials - replace with your actual credentials
// It's best to load these from environment variables in a real app
const TURN_USERNAME = 'your_turn_username'; // Replace this
const TURN_PASSWORD = 'your_turn_password'; // Replace this

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

  // Initialize PeerConnection
  const initializePeerConnection = useCallback(() => {
    if (!localStream) {
      console.warn('useWebRTC: Local stream not available yet.');
      return null;
    }
    if (pcRef.current) {
        console.log('useWebRTC: PeerConnection already exists.');
        return pcRef.current;
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
    
    setPeerConnection(pc);
    return pc;
  }, [localStream, signalingService]);


  // Function to create an offer
  const createOffer = async () => {
    if (!pcRef.current || !signalingService) {
        console.error('useWebRTC: PeerConnection or signaling service not available for createOffer');
        return;
    }
    try {
      console.log('useWebRTC: Creating offer...');
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      console.log('useWebRTC: Offer created and set as local description. Sending offer.');
      signalingService.sendSignal({ type: 'offer', sdp: pcRef.current.localDescription });
    } catch (error) {
      console.error('useWebRTC: Error creating offer:', error);
    }
  };

  // Function to handle a received offer and create an answer
  const handleOffer = async (offerSdp) => {
    if (!pcRef.current || !signalingService) {
        console.error('useWebRTC: PeerConnection or signaling service not available for handleOffer');
        return;
    }
    try {
      console.log('useWebRTC: Received offer. Setting remote description.');
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(offerSdp));
      console.log('useWebRTC: Creating answer...');
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      console.log('useWebRTC: Answer created and set as local description. Sending answer.');
      signalingService.sendSignal({ type: 'answer', sdp: pcRef.current.localDescription });
    } catch (error) {
      console.error('useWebRTC: Error handling offer:', error);
    }
  };

  // Function to handle a received answer
  const handleAnswer = async (answerSdp) => {
    if (!pcRef.current) {
        console.error('useWebRTC: PeerConnection not available for handleAnswer');
        return;
    }
    try {
      console.log('useWebRTC: Received answer. Setting remote description.');
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answerSdp));
    } catch (error) {
      console.error('useWebRTC: Error handling answer:', error);
    }
  };

  // Function to handle a received ICE candidate
  const handleCandidate = async (candidate) => {
    if (!pcRef.current) {
        console.error('useWebRTC: PeerConnection not available for handleCandidate');
        return;
    }
    try {
      if (candidate) {
        console.log('useWebRTC: Received ICE candidate. Adding candidate.');
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('useWebRTC: Error adding received ICE candidate:', error);
    }
  };
  
  // Cleanup
  const closeConnection = useCallback(() => {
    if (pcRef.current) {
      console.log('useWebRTC: Closing PeerConnection.');
      pcRef.current.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      pcRef.current.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
    setIsConnected(false);
    setIsConnecting(false);
    setPeerConnection(null);
  }, []);

  useEffect(() => {
    // This effect is primarily for cleanup when the component unmounts or dependencies change
    return () => {
      closeConnection();
    };
  }, [closeConnection]);


  return {
    peerConnection: pcRef.current, // Expose the ref's current value
    remoteStream,
    isConnecting,
    isConnected,
    initializePeerConnection, // Allow manual initialization if needed
    createOffer,
    handleOffer,
    handleAnswer,
    handleCandidate,
    closeConnection,
  };
};

export default useWebRTC;
