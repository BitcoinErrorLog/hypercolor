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

/**
 * How this row first entered the local contacts table.
 * Homeserver follows and Nexus graph updates set the relationship flags;
 * `addedManually` stays true if the user pasted/scanned the pubky.
 */
export type ContactSource = 'follow' | 'manual' | 'mesh';

export interface Contact {
  pubky: PubkyKey;
  /** Account that owns this row. v6 forbids empty-owner leftovers. */
  ownerPubky: PubkyKey;
  displayName?: string;
  avatarHash?: string;
  homeserver?: string;
  trustScore: number;
  /** I follow them (homeserver `/pub/pubky.app/follows/` or Nexus following). */
  isFollowing: boolean;
  /** They follow me (Nexus followers). */
  isFollower: boolean;
  /** Mutual follow (Nexus friends, or isFollowing && isFollower). */
  isMutual: boolean;
  /** User added this pubky via paste/QR (eligible for inbox probing). */
  addedManually: boolean;
  firstSeenAt: number;
  lastInteractionAt?: number;
}

export type MessageRequestStatus = 'pending' | 'accepted' | 'declined';

export interface MessageRequest {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  createdAt: number;
  updatedAt: number;
  status: MessageRequestStatus;
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
  MessageRequests: undefined;
  Settings: undefined;
  EnableMessaging: undefined;
};

export type {
  GroupChannel,
  GroupMember,
  GroupMessage,
  GroupMemberRole,
  GroupMemberStatus,
} from './group';

export type {
  AttachmentRecord,
  AttachmentResolveState,
  ChatAttachmentEnvelope,
} from './attachment';
export {
  ATTACHMENT_ALGORITHM,
  CHAT_ATTACHMENT_KIND,
  attachmentKeyRef,
  isAttachmentKind,
} from './attachment';
