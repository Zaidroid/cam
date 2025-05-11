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

  async leaveWaitingPool() { // Made async
    if (this.waitingPoolChannel) {
      const channelToLeave = this.waitingPoolChannel;
      this.waitingPoolChannel = null; // Nullify early to prevent re-entry from presence
      console.log('SignalingService: Attempting to leave waiting pool.');
      try {
        await channelToLeave.unsubscribe();
        console.log('SignalingService: Successfully unsubscribed from waiting pool.');
      } catch (err) {
        console.error('SignalingService: Error unsubscribing from waiting pool:', err);
        // Potentially throw err or handle as needed
      }
      // removeChannel is synchronous
      this.client.removeChannel(channelToLeave);
      console.log('SignalingService: Waiting pool channel instance removed.');
      // isPairingInProgress should be managed by the calling context (App.jsx) or upon successful room join
    } else {
      console.log('SignalingService: No waiting pool channel to leave or already left.');
    }
  }
  
  async joinChatRoom(channelName) { // Made async
    if (this.currentChannel && this.currentChannel.topic === channelName) {
      console.log(`SignalingService: Already in channel ${channelName}`);
      this.isPairingInProgress = false; // Already in room, so pairing is complete/moot
      return; // Or return success
    }
    if (this.currentChannel) {
      await this.leaveChannel(); // Ensure previous chat room is left, made leaveChannel async
    }
    
    console.log(`SignalingService: Joining chat room ${channelName}`);
    this.currentChannel = this.client.channel(channelName, {
      config: { presence: { key: this.myId } },
    });

    // Setup handlers BEFORE subscribing
    this.currentChannel.on('broadcast', { event: 'webrtc_signal' }, ({ payload }) => {
      if (payload.from && payload.from === this.myId) {
        return;
      }
      console.log('SignalingService: Received webrtc_signal:', payload);
      if (this.onSignalMessage) {
        this.onSignalMessage(payload);
      }
    });

    // Make subscription awaitable
    const subscribeStatus = await new Promise((resolve) => {
      this.currentChannel.subscribe((status, err) => {
        if (err) {
          console.error(`SignalingService: Subscription error for ${channelName}:`, err.message);
          resolve('CHANNEL_ERROR'); // Treat error as a status
          return;
        }
        // Resolve only on final states or if already subscribed
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          resolve(status);
        } else if (status === 'CLOSED') {
            console.warn(`SignalingService: Channel ${channelName} was closed during subscription.`);
            resolve('CLOSED'); // Potentially a state to handle
        }
      });
    });

    if (subscribeStatus === 'SUBSCRIBED') {
      console.log(`SignalingService: Successfully subscribed to ${channelName}`);
      this.isPairingInProgress = false; 
      await this.currentChannel.track({ online_at: new Date().toISOString(), user_id: this.myId });
    } else {
      console.error(`SignalingService: Failed to subscribe to ${channelName}: ${subscribeStatus}`);
      this.isPairingInProgress = false; 
      this.currentChannel = null; // Ensure currentChannel is null if subscription failed
      throw new Error(`Failed to subscribe to chat room: ${subscribeStatus}`);
    }
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
  async leaveChannel() { // Made async
    if (this.currentChannel) {
      const channelToLeave = this.currentChannel;
      this.currentChannel = null; // Nullify early
      this.isPairingInProgress = false; // Reset pairing flag generally when leaving a chat
      console.log(`SignalingService: Attempting to leave channel ${channelToLeave.topic}`);
      try {
        await channelToLeave.unsubscribe();
        console.log(`SignalingService: Successfully unsubscribed from ${channelToLeave.topic}`);
      } catch (err) {
        console.error(`SignalingService: Error unsubscribing from ${channelToLeave.topic}:`, err);
      }
      this.client.removeChannel(channelToLeave);
      console.log(`SignalingService: Chat channel instance removed for ${channelToLeave.topic}.`);
    } else {
        console.log('SignalingService: No current chat channel to leave.');
    }
  }
}

// Export a singleton instance
const signalingServiceInstance = new SignalingService();
export default signalingServiceInstance;
