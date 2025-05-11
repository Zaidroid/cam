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
    this.isPairingInProgress = false; // Flag to prevent multiple pairing attempts
  }

  // Initialize with user ID and callbacks
  initialize(userId, onSignalMessageCallback, onPairedCallback) {
    this.myId = userId;
    this.onSignalMessage = onSignalMessageCallback;
    this.onPairedCallback = onPairedCallback;
    this.isPairingInProgress = false; // Reset on init
    console.log(`SignalingService initialized for user: ${this.myId}`);
  }

  joinWaitingPool() {
    if (this.waitingPoolChannel || this.isPairingInProgress) {
      console.log('SignalingService: Already in/joining waiting pool or pairing in progress.');
      return;
    }
    const poolName = 'public:waiting_pool';
    console.log(`SignalingService: Joining ${poolName}`);
    this.waitingPoolChannel = this.client.channel(poolName, {
      config: { presence: { key: this.myId } },
    });

    this.waitingPoolChannel
      .on('presence', { event: 'sync' }, () => {
        if (!this.waitingPoolChannel || this.isPairingInProgress) return;

        const presenceState = this.waitingPoolChannel.presenceState();
        console.log(`SignalingService: Presence update on ${poolName}:`, presenceState);
        
        const otherUsers = Object.keys(presenceState).filter(id => id !== this.myId);
        
        if (otherUsers.length > 0 && !this.currentChannel) { 
          this.isPairingInProgress = true; // Set flag
          const partnerId = otherUsers[0]; 
          console.log(`SignalingService: Found potential partner ${partnerId}. Notifying app.`);
          
          const chatRoomId = `private:chat_room_${[this.myId, partnerId].sort().join('_')}`;
          const shouldOffer = this.myId < partnerId;

          if (this.onPairedCallback) {
            // App.jsx will call leaveWaitingPool and joinChatRoom
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
      // It's good practice to unsubscribe before removing the channel
      this.waitingPoolChannel.unsubscribe()
        .then(() => console.log('SignalingService: Unsubscribed from waiting pool.'))
        .catch(err => console.error('SignalingService: Error unsubscribing from waiting pool:', err))
        .finally(() => {
          this.client.removeChannel(this.waitingPoolChannel);
          this.waitingPoolChannel = null;
          // Reset pairing flag if we are leaving the pool for reasons other than successful pairing
          // However, App.jsx should manage isPairingInProgress reset more explicitly if needed
        });
    }
  }
  
  // Join a specific chat room channel
  joinChatRoom(channelName) {
    if (this.currentChannel && this.currentChannel.topic === channelName) {
        console.log(`SignalingService: Already in channel ${channelName}`);
        return;
    }
    if (this.currentChannel) {
      this.leaveChannel(); // Leave previous chat room if any
    }
    
    console.log(`SignalingService: Joining chat room ${channelName}`);
    this.currentChannel = this.client.channel(channelName, {
      config: {
        presence: { key: this.myId }, 
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
          this.isPairingInProgress = false; // Successfully joined chat room, reset pairing flag
          await this.currentChannel.track({ online_at: new Date().toISOString(), user_id: this.myId });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`SignalingService: Error/Timeout subscribing to ${channelName}: ${status}`);
          this.isPairingInProgress = false; // Reset pairing flag on error
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
      payload: { ...signalData, from: this.myId }, 
    });
  }

  // Leave the current chat channel
  leaveChannel() {
    if (this.currentChannel) {
      console.log(`SignalingService: Leaving channel ${this.currentChannel.topic}`);
      this.currentChannel.unsubscribe()
      .then(() => console.log(`SignalingService: Unsubscribed from ${this.currentChannel.topic}`))
      .catch(err => console.error(`SignalingService: Error unsubscribing from ${this.currentChannel.topic}:`, err))
      .finally(() => {
        this.client.removeChannel(this.currentChannel);
        this.currentChannel = null;
        this.isPairingInProgress = false; // Reset pairing flag
      });
    }
  }
}

// Export a singleton instance
const signalingServiceInstance = new SignalingService();
export default signalingServiceInstance;
