import type { PubkyKey } from './index';

/**
 * Wire contracts and state types for Paykit Encrypted Links messaging
 * (Noise XX over pubky homeserver outboxes).
 *
 * Ported from the proven mp-dm state machine, adapted to this app's
 * conventions: timestamps are Unix milliseconds (not ISO strings) and
 * persistence is SQLite via StorageService.
 */

// ─── Message kinds ──────────────────────────────────────────────────────────

/** Private Application Message kind for one chat message. */
export const CHAT_MESSAGE_KIND = 'chat.message.v0';

/** Reserved kind for delivery/read receipts. No receipt logic exists yet. */
export const CHAT_RECEIPT_KIND = 'chat.receipt.v0';

/** Reserved kind for message reactions. No reaction logic exists yet. */
export const CHAT_REACTION_KIND = 'chat.reaction.v0';

// ─── Chat message envelope ──────────────────────────────────────────────────

/**
 * `chat.message.v0` — one direct message carried as a Paykit Private
 * Application Message over an Encrypted Link.
 *
 * - `version`/`kind`: the Paykit envelope contract. Unknown kinds are legal
 *   on a shared link and are skipped by receivers, never treated as errors.
 * - `event_id`: sender-minted UUID; receivers dedupe by it (crash replay
 *   after a restored snapshot is expected and must be idempotent).
 * - `sent_at`: sender's wall clock, Unix milliseconds. Display ordering only.
 * - `body`: the message text, trimmed, non-empty.
 */
export interface ChatMessageEnvelope {
  version: 1;
  kind: typeof CHAT_MESSAGE_KIND;
  event_id: string;
  sent_at: number;
  body: string;
}

/**
 * Ceiling on the SERIALIZED envelope size in bytes — the Noise transport
 * rejects larger payloads, so the build path fails loudly instead of letting
 * the crypto layer produce a less useful error. Same 1000-byte contract the
 * mp-dm web app ships with.
 */
export const LINK_MESSAGE_MAX_BYTES = 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds and validates a sendable `chat.message.v0` envelope. Enforces the
 * serialized byte ceiling (JSON escaping and multi-byte UTF-8 count against
 * the budget) and throws on invalid input instead of truncating — the send
 * path never silently drops content.
 */
export function buildChatMessageEnvelope(input: {
  eventId: string;
  sentAt: number;
  body: string;
}): {
  envelope: ChatMessageEnvelope;
  json: string;
  byteSize: number;
} {
  if (!UUID_PATTERN.test(input.eventId)) {
    throw new Error(`chat.message.v0 event_id must be a UUID, got "${input.eventId}"`);
  }
  if (!Number.isInteger(input.sentAt) || input.sentAt <= 0) {
    throw new Error('chat.message.v0 sent_at must be a positive Unix-millisecond integer');
  }
  const body = input.body.trim();
  if (body.length === 0) {
    throw new Error('chat.message.v0 body must not be empty');
  }
  const envelope: ChatMessageEnvelope = {
    version: 1,
    kind: CHAT_MESSAGE_KIND,
    event_id: input.eventId,
    sent_at: input.sentAt,
    body,
  };
  const json = JSON.stringify(envelope);
  const byteSize = new TextEncoder().encode(json).byteLength;
  if (byteSize > LINK_MESSAGE_MAX_BYTES) {
    throw new Error(
      `chat.message.v0 is too long: ${byteSize} bytes serialized, limit ${LINK_MESSAGE_MAX_BYTES}`,
    );
  }
  return { envelope, json, byteSize };
}

/**
 * Decodes one received Private Application Message as a `chat.message.v0`.
 * Returns `null` for payloads that are not a valid chat message (unknown
 * kinds are legal on a shared link and are skipped, never errors).
 */
export function decodeChatMessageEnvelope(rawJson: string): ChatMessageEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  if (candidate.kind !== CHAT_MESSAGE_KIND) return null;
  if (typeof candidate.event_id !== 'string' || !UUID_PATTERN.test(candidate.event_id)) return null;
  if (typeof candidate.sent_at !== 'number' || !Number.isInteger(candidate.sent_at)) return null;
  if (candidate.sent_at <= 0) return null;
  if (typeof candidate.body !== 'string' || candidate.body.trim().length === 0) return null;
  return {
    version: 1,
    kind: CHAT_MESSAGE_KIND,
    event_id: candidate.event_id,
    sent_at: candidate.sent_at,
    body: candidate.body,
  };
}

// ─── Conversation identity ──────────────────────────────────────────────────

const DM_CONVERSATION_PREFIX = 'dm:';
const PUBKY_LENGTH = 52; // z-base-32 Ed25519 public key

/**
 * Local conversation id for the DM thread with one counterparty. There is
 * exactly one DM conversation per counterparty pair per device — the
 * counterparty pubky IS the conversation identity.
 */
export function buildDmConversationId(counterpartyPubky: PubkyKey): string {
  return `${DM_CONVERSATION_PREFIX}${counterpartyPubky}`;
}

/** Splits a `dm:{counterpartyPubky}` conversation id; `null` when the shape does not match. */
export function parseDmConversationId(
  conversationId: string,
): { counterpartyPubky: PubkyKey } | null {
  if (!conversationId.startsWith(DM_CONVERSATION_PREFIX)) return null;
  const counterpartyPubky = conversationId.slice(DM_CONVERSATION_PREFIX.length);
  if (counterpartyPubky.length !== PUBKY_LENGTH) return null;
  return { counterpartyPubky };
}

// ─── Link state types ───────────────────────────────────────────────────────

/**
 * The truthful conversation transport states, mirroring mp-dm:
 *
 * - `needs-enable`: THIS device has no messaging session or no provisioned
 *   receiver (secret + published marker) — the user must enable messaging.
 * - `not-enrolled`: the counterparty has published no receiver marker — no
 *   handshake can even start, and the UI must say so, never fake delivery.
 * - `handshaking-initiator`: our Noise XX message 1 is queued; sends stay
 *   pending until the counterparty's runtime reads and answers it.
 * - `handshaking-responder`: an inbound handshake is being answered and
 *   completion needs the initiator to come back online for the final round.
 * - `ready`: the link is established; sends/receives are live.
 * - `error`: the native module is unavailable or the state machine hit an
 *   unexpected failure; nothing was silently swallowed.
 */
export type LinkStatus =
  | 'needs-enable'
  | 'not-enrolled'
  | 'handshaking-initiator'
  | 'handshaking-responder'
  | 'ready'
  | 'error';

export type LinkRole = 'initiator' | 'responder';

/** Persisted link lifecycle — in-progress handshakes and established links. */
export type StoredLinkStatus = 'handshaking' | 'established';

export type LinkMessageDirection = 'sent' | 'received';

/**
 * Outbound delivery lifecycle for one message. `delivered` and `read` are
 * driven by the reserved receipt kind and stay unused until receipt logic
 * ships; received messages persist as `delivered` on arrival.
 */
export type LinkDeliveryState = 'sending' | 'sent' | 'delivered' | 'read';

// ─── Storage row shapes ─────────────────────────────────────────────────────

/**
 * One messaging receiver per account. `secretRef` names the KeyStore
 * keychain entry holding the receiver Noise secret — the secret itself is
 * NEVER stored in SQLite.
 */
export interface LinkReceiver {
  ownerPubky: PubkyKey;
  secretRef: string;
  app: string;
  runtime: string;
  markerPublished: boolean;
  updatedAt: number;
}

export type LinkReceiverInput = Omit<LinkReceiver, 'updatedAt'>;

/**
 * One Encrypted Link (or in-progress handshake) per counterparty. The
 * snapshot JSON serializes UNENCRYPTED and contains Noise key material —
 * device-local only; never sync, export, or log it.
 */
export interface LinkRecord {
  peerPubky: PubkyKey;
  role: LinkRole;
  status: StoredLinkStatus;
  snapshot: string;
  updatedAt: number;
}

export type LinkRecordInput = Omit<LinkRecord, 'updatedAt'>;

/**
 * Device-local message history (plaintext bodies — never log them). Keyed by
 * the sender-minted `event_id` so replayed deliveries (expected after a
 * snapshot restore) dedupe idempotently instead of duplicating.
 */
export interface LinkMessage {
  eventId: string;
  conversationId: string;
  peerPubky: PubkyKey;
  direction: LinkMessageDirection;
  kind: string;
  rawJson: string;
  body: string;
  /** Sender wall clock from the envelope (Unix ms, display ordering only). */
  sentAt: number;
  /** Local arrival time (Unix ms); `null` for sent messages. */
  receivedAt: number | null;
  deliveryState: LinkDeliveryState;
}
