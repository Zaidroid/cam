import { supabase } from './supabaseClient';

// This will be expanded significantly
// For now, it's a placeholder structure

class SignalingService {
  constructor() {
    this.client = supabase;
    this.currentChannel = null;
    this.onSignalMessage = null; // Callback for when a signal message is received
    this.myId = null; // Will be set upon initialization, e.g., user ID
    this.waitingPoolChannel = null;
    this.onPairedCallback = null; // Callback when paired with another user
  }

  // Initialize with user ID and callbacks
  initialize(userId, onSignalMessageCallback, onPairedCallback) {
    this.myId = userId;
    this.onSignalMessage = onSignalMessageCallback;
    this.onPairedCallback = onPairedCallback;
    console.log(`SignalingService initialized for user: ${this.myId}`);
  }

  joinWaitingPool() {
    if (this.waitingPoolChannel) {
      console.log('SignalingService: Already in or joining waiting pool.');
      return;
    }
    const poolName = 'public:waiting_pool';
    console.log(`SignalingService: Joining ${poolName}`);
    this.waitingPoolChannel = this.client.channel(poolName, {
      config: { presence: { key: this.myId } },
    });

    this.waitingPoolChannel
      .on('presence', { event: 'sync' }, () => {
        if (!this.waitingPoolChannel) return; // Channel might have been left

        const presenceState = this.waitingPoolChannel.presenceState();
        console.log(`SignalingService: Presence update on ${poolName}:`, presenceState);
        
        const otherUsers = Object.keys(presenceState).filter(id => id !== this.myId);
        
        if (otherUsers.length > 0 && !this.currentChannel) { // Not already in a chat
          const partnerId = otherUsers[0]; // Simplistic: pick the first one
          console.log(`SignalingService: Found potential partner ${partnerId} in waiting pool.`);
          
          // Leave waiting pool and initiate pairing
          // This is a very basic client-side matchmaking.
          // A more robust solution would use a server function to coordinate.
          this.leaveWaitingPool(); // Important to leave before joining new room
          
          const chatRoomId = `private:chat_room_${[this.myId, partnerId].sort().join('_')}`;
          this.joinChatRoom(chatRoomId);

          // Notify app that we are paired and who should offer
          // Simple rule: user with lexicographically smaller ID offers
          const shouldOffer = this.myId < partnerId;
          if (this.onPairedCallback) {
            this.onPairedCallback({ partnerId, chatRoomId, shouldOffer });
          }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`SignalingService: Successfully subscribed to ${poolName}`);
          await this.waitingPoolChannel.track({ joined_at: new Date().toISOString() });
        } else {
          console.error(`SignalingService: Failed to subscribe to ${poolName}: ${status}`);
        }
      });
  }

  leaveWaitingPool() {
    if (this.waitingPoolChannel) {
      console.log('SignalingService: Leaving waiting pool.');
      this.client.removeChannel(this.waitingPoolChannel);
      this.waitingPoolChannel = null;
    }
  }
  
  // Join a specific chat room channel
  joinChatRoom(channelName) {
    if (this.currentChannel && this.currentChannel.topic === channelName) {
        console.log(`SignalingService: Already in channel ${channelName}`);
        return;
    }
    if (this.currentChannel) {
      this.leaveChatRoom(); // Leave previous chat room if any
    }
    
    // Ensure we are not in the waiting pool anymore
    this.leaveWaitingPool();

    console.log(`SignalingService: Joining chat room ${channelName}`);
    this.currentChannel = this.client.channel(channelName, {
      config: {
        presence: { key: this.myId }, // Announce presence in the chat room
      },
    });

    this.currentChannel
      .on('broadcast', { event: 'webrtc_signal' }, ({ payload }) => {
        if (payload.from && payload.from === this.myId) {
          return;
        }
        console.log('SignalingService: Received webrtc_signal:', payload);
        if (this.onSignalMessage) {
          this.onSignalMessage(payload);
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`SignalingService: Successfully subscribed to ${channelName}`);
          // Track presence
          await this.currentChannel.track({ online_at: new Date().toISOString(), user_id: this.myId });
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`SignalingService: Error subscribing to channel ${channelName}`);
        } else if (status === 'TIMED_OUT') {
          console.warn(`SignalingService: Subscription to ${channelName} timed out`);
        }
      });
  }

  // Send a signaling message
  sendSignal(signalData) {
    if (!this.currentChannel) {
      console.error('SignalingService: Not connected to any channel. Cannot send signal.');
      return;
    }
    console.log('SignalingService: Sending signal:', signalData);
    this.currentChannel.send({
      type: 'broadcast',
      event: 'webrtc_signal',
      payload: { ...signalData, from: this.myId }, // Add sender's ID
    });
  }

  // Leave the current channel
  leaveChannel() {
    if (this.currentChannel) {
      console.log(`SignalingService: Leaving channel ${this.currentChannel.topic}`);
      this.client.removeChannel(this.currentChannel);
      this.currentChannel = null;
    }
  }

  // More methods will be added for matchmaking, etc.
}

// Export a singleton instance
const signalingServiceInstance = new SignalingService();
export default signalingServiceInstance;
