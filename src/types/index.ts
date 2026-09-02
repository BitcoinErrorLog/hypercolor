import type { NavigatorScreenParams } from '@react-navigation/native';

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

export type MessageId = string;

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
  /** I follow them (homeserver `/pub/pubky.app/follows/` document). */
  isFollowing: boolean;
  /**
   * They follow me. Display / sort only — never written from Nexus.
   * The inbound auto-accept gate must not treat this as evidence.
   */
  isFollower: boolean;
  /**
   * Mutual follow. Display / sort only from graph import.
   * Unused by `wotGate` accept; import never sets it from Nexus.
   */
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
  payload: string; // JSON serialized link / group retry payload
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
  /**
   * Waiting for `hypercolor://ring-callback`.
   * `ringAuthUrl` is the `pubkyring://paykit-connect…` link shown as QR + copy.
   */
  AwaitingRingAuth: { ringAuthUrl: string };
};

export type MainTabParamList = {
  Chats: undefined;
  Channels: undefined;
  Contacts: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
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
  ATTACHMENT_KEY_PLACEHOLDER,
  CHAT_ATTACHMENT_KIND,
  attachmentKeyRef,
  isAttachmentKind,
} from './attachment';

export type {
  PaymentRequestRecord,
  PaymentStatus,
  PaymentDirection,
  TipEndpointRecord,
} from './payment';
export {
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
  isPaykitPaymentKind,
} from './payment';
