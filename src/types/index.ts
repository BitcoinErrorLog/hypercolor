// ─── Core Identity Types ───────────────────────────────────────────────────

export type PubkyKey = string; // z-base-32 encoded Ed25519 public key

export interface UserProfile {
  pubky: PubkyKey;
  displayName: string;
  avatarHash?: string;
  status?: string;
  updatedAt: number;
}

// ─── Messaging Types ───────────────────────────────────────────────────────

export type MessageId = string; // SHA-256 hex of (sender + recipient + content + timestamp)

export type DeliveryStatus = 'pending' | 'sent_mesh' | 'sent_pubky' | 'delivered' | 'failed';

export type DeliveryPath = 'mesh' | 'pubky' | 'queued';

export interface Message {
  id: MessageId;
  threadId: string;
  senderPubky: PubkyKey;
  recipientPubky?: PubkyKey; // null for channel messages
  channelId?: string;
  content: string;
  createdAt: number;
  deliveryStatus: DeliveryStatus;
  deliveryPath?: DeliveryPath;
}

// ─── Thread / Channel Types ────────────────────────────────────────────────

export interface Thread {
  id: string;
  participantPubky: PubkyKey;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
  sb2ContextId?: string; // SB2 thread context ID (hex, 32 bytes) — stored per thread
}

export interface Channel {
  id: string;
  name: string;
  memberCount: number;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
  channelInboxPkHex?: string; // X25519 inbox public key for SealedBlob channel encryption
}

export interface ChannelMember {
  channelId: string;
  pubky: PubkyKey;
  joinedAt: number;
  displayName?: string;
}

// ─── Contact Types ─────────────────────────────────────────────────────────

export interface Contact {
  pubky: PubkyKey;
  displayName?: string;
  avatarHash?: string;
  homeserver?: string;
  trustScore: number;
  firstSeenAt: number;
  lastInteractionAt?: number;
}

// ─── Delivery Queue Types ──────────────────────────────────────────────────

export interface DeliveryQueueItem {
  id: string;
  messageId: MessageId;
  recipientPubky: PubkyKey;
  payload: string; // JSON serialized OutboxEnvelope
  attempts: number;
  nextRetryAt: number;
  createdAt: number;
}

// ─── Mesh Peer Types ───────────────────────────────────────────────────────

export interface MeshPeer {
  pubkyHash: string; // 16-byte truncated hash, hex
  pubky?: PubkyKey; // resolved after handshake
  rssi?: number;
  lastSeenAt: number;
  connected: boolean;
}

// ─── Navigation Types ──────────────────────────────────────────────────────

export type AuthStackParamList = {
  Welcome: undefined;
  /** Shown while waiting for pubky-ring callback after opening the deep link */
  AwaitingRingAuth: undefined;
};

export type MainTabParamList = {
  Chats: undefined;
  Channels: undefined;
  Contacts: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Thread: { threadId: string; participantPubky: PubkyKey };
  ChannelScreen: { channelId: string };
  ContactSearch: undefined;
  Settings: undefined;
  EnableMessaging: undefined;
};
