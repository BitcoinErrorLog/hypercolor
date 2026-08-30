import type { PubkyKey } from './index';

/**
 * Wire contracts and state types for Paykit Encrypted Links messaging
 * (Noise XX over pubky homeserver outboxes).
 *
 * ## Wire interop: divergence and compatibility
 *
 * This app EMITS `chat.message.v0` with epoch-millisecond `sent_at` (Unix ms).
 * That is a deliberate divergence from the web reference
 * (`pubky_app.dm.v0` + ISO-8601 `sent_at` in `.ai-review-refs/dm-contracts.ts`):
 * mobile already used epoch-ms throughout SQLite and the UI, and changing the
 * emit shape would break any hypercolor-to-hypercolor messages already on the
 * wire.
 *
 * DECODE is compatible with BOTH:
 *   - kind `chat.message.v0` or `pubky_app.dm.v0`
 *   - `sent_at` as a positive integer (epoch ms) OR an ISO-8601 datetime string
 *
 * Both normalize into the same internal model (`sent_at: number` epoch ms).
 * Unknown kinds are stored on `link_stream_items` and left unprocessed — they
 * must never be skipped past the native read checkpoint without a durable row.
 */

// ─── Receiver path ──────────────────────────────────────────────────────────

/**
 * Official Paykit receiver path for this app. Paykit only allows
 * `{app}/wallet` or `{app}/server` — `hypercolor/mobile` is invalid.
 */
export const LINK_RECEIVER_PATH = 'hypercolor/wallet';

/** Encrypted Links grant (DMs, receiver marker). */
export const PAYKIT_MESSAGING_CAPABILITY = '/pub/paykit/:rw';

/** Owner writes: attachments, backup, public channels under `/pub/hypercolor.app/v1/`. */
export const HYPERCOLOR_WRITE_CAPABILITY = '/pub/hypercolor.app/v1/:rw';

/**
 * One Ring grant for DMs + owner writes. Requested by Enable Messaging
 * (`startAuthFlow`) and advertised on Welcome `paykit-connect` as `caps=`.
 */
export const RING_GRANT_CAPABILITIES = `${PAYKIT_MESSAGING_CAPABILITY},${HYPERCOLOR_WRITE_CAPABILITY}`;

const RECEIVER_PATH_PATTERN = /^[a-z0-9][a-z0-9.-]*\/(wallet|server)$/;

/** True when `path` is an official Paykit receiver path (`{app}/wallet|server`). */
export function isValidReceiverPath(path: string): boolean {
  return RECEIVER_PATH_PATTERN.test(path);
}

/**
 * The single validation site for receiver paths. Throws a typed validation
 * error shape when the path is not `{app}/wallet` or `{app}/server`.
 */
export function assertValidReceiverPath(path: string): string {
  if (!isValidReceiverPath(path)) {
    throw new Error(
      `Invalid Paykit receiver path "${path}"; official paykit allows {app}/wallet or {app}/server`,
    );
  }
  return path;
}

/** Use a stored path if it is official; otherwise fall back to this app's path. */
export function coerceReceiverPath(path: string): string {
  return isValidReceiverPath(path) ? path : LINK_RECEIVER_PATH;
}

// ─── Message kinds ──────────────────────────────────────────────────────────

/** Private Application Message kind this app emits. */
export const CHAT_MESSAGE_KIND = 'chat.message.v0';

/**
 * Web-reference DM kind. This app does not emit it, but the decoder accepts
 * it so a web peer on the same Encrypted Link is interoperable.
 */
export const PUBKY_APP_DM_KIND = 'pubky_app.dm.v0';

/** Reserved kind for delivery/read receipts. No receipt logic exists yet. */
export const CHAT_RECEIPT_KIND = 'chat.receipt.v0';

/** Reserved kind for message reactions. No reaction logic exists yet. */
export const CHAT_REACTION_KIND = 'chat.reaction.v0';

export type LinkWireKind = typeof CHAT_MESSAGE_KIND | typeof PUBKY_APP_DM_KIND;

// ─── Chat message envelope ──────────────────────────────────────────────────

/**
 * `chat.message.v0` — one direct message carried as a Paykit Private
 * Application Message over an Encrypted Link.
 *
 * - `version`/`kind`: the Paykit envelope contract. Unknown kinds are legal
 *   on a shared link; they are stored on the stream table, never treated as
 *   errors, and never skipped past the read checkpoint.
 * - `event_id`: sender-minted UUID; receivers dedupe by
 *   `(owner_pubky, sender_pubky, kind, event_id)`.
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

/** Normalized inbound envelope after dual-kind / dual-timestamp decode. */
export interface DecodedLinkEnvelope {
  version: 1;
  kind: LinkWireKind;
  event_id: string;
  /** Always epoch milliseconds after decode. */
  sent_at: number;
  body: string;
}

/**
 * Ceiling on the SERIALIZED envelope size in bytes — the Noise transport
 * rejects larger payloads, so the build path fails loudly instead of letting
 * the crypto layer produce a less useful error. Same 1000-byte contract the
 * web reference ships with.
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
 * Parses `sent_at` in either on-the-wire form: a positive epoch-ms integer
 * or an ISO-8601 datetime string. Returns `null` when neither matches.
 */
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseLinkSentAt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && ISO_DATETIME_PATTERN.test(value)) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms) && ms > 0) return ms;
  }
  return null;
}

function decodeEnvelopeOfKind(
  rawJson: string,
  expectedKind: LinkWireKind,
): DecodedLinkEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  if (candidate.kind !== expectedKind) return null;
  if (typeof candidate.event_id !== 'string' || !UUID_PATTERN.test(candidate.event_id)) return null;
  const sentAt = parseLinkSentAt(candidate.sent_at);
  if (sentAt === null) return null;
  if (typeof candidate.body !== 'string' || candidate.body.trim().length === 0) return null;
  return {
    version: 1,
    kind: expectedKind,
    event_id: candidate.event_id,
    sent_at: sentAt,
    body: candidate.body,
  };
}

/**
 * Decodes one received Private Application Message as a `chat.message.v0`.
 * Accepts epoch-ms or ISO-8601 `sent_at`. Returns `null` for other kinds.
 */
export function decodeChatMessageEnvelope(rawJson: string): ChatMessageEnvelope | null {
  const decoded = decodeEnvelopeOfKind(rawJson, CHAT_MESSAGE_KIND);
  if (!decoded) return null;
  return {
    version: 1,
    kind: CHAT_MESSAGE_KIND,
    event_id: decoded.event_id,
    sent_at: decoded.sent_at,
    body: decoded.body,
  };
}

/**
 * Decodes one received Private Application Message as `pubky_app.dm.v0`
 * (web reference). Accepts epoch-ms or ISO-8601 `sent_at`.
 */
export function decodePubkyAppDmEnvelope(rawJson: string): DecodedLinkEnvelope | null {
  return decodeEnvelopeOfKind(rawJson, PUBKY_APP_DM_KIND);
}

/**
 * Dual-kind decoder used by the receive path. Returns `null` for payloads
 * that are neither a valid chat message nor a valid web DM.
 */
export function decodeLinkEnvelope(rawJson: string): DecodedLinkEnvelope | null {
  return (
    decodeEnvelopeOfKind(rawJson, CHAT_MESSAGE_KIND) ??
    decodeEnvelopeOfKind(rawJson, PUBKY_APP_DM_KIND)
  );
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

/** Navigation params for the official DM thread (`threadId` = conversation id). */
export function threadRouteParams(participantPubky: PubkyKey): {
  threadId: string;
  participantPubky: PubkyKey;
} {
  return { threadId: buildDmConversationId(participantPubky), participantPubky };
}

/**
 * Inbox row for one `dm:{peer}` conversation. Unread counts only messages
 * that have already arrived on this device after the local read cursor.
 */
export interface LinkConversationSummary {
  conversationId: string;
  participantPubky: PubkyKey;
  lastMessage: string;
  lastMessageAt: number;
  lastKind: string;
  unreadCount: number;
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
 * The truthful conversation transport states:
 *
 * - `needs-enable`: THIS device has no messaging session or no provisioned
 *   receiver (alias + published marker) — the user must enable messaging.
 * - `session-offline`: a persisted session alias exists but restore failed
 *   with a transient `network` error; the alias is kept.
 * - `native-missing`: the Paykit native module is not linked into this build.
 * - `not-enrolled`: the counterparty has published no receiver marker — no
 *   handshake can even start, and the UI must say so, never fake delivery.
 * - `handshaking-initiator`: our Noise XX message 1 is queued; sends stay
 *   pending until the counterparty's runtime reads and answers it.
 * - `handshaking-responder`: an inbound handshake is being answered and
 *   completion needs the initiator to come back online for the final round.
 * - `ready`: the link is established; sends/receives are live.
 * - `message-request`: an inbound link was discovered and held by the WoT
 *   gate as a pending message request. Handshake state is persisted, but
 *   the conversation must not surface in the main inbox until accepted.
 * - `error`: the state machine hit an unexpected failure; nothing was
 *   silently swallowed.
 */
export type LinkStatus =
  | 'needs-enable'
  | 'session-offline'
  | 'native-missing'
  | 'not-enrolled'
  | 'handshaking-initiator'
  | 'handshaking-responder'
  | 'ready'
  | 'message-request'
  | 'error';

export type LinkRole = 'initiator' | 'responder';

/** Persisted link lifecycle — in-progress handshakes and established links. */
export type StoredLinkStatus = 'handshaking' | 'established';

export type LinkMessageDirection = 'sent' | 'received';

/**
 * Outbound delivery lifecycle for one message. `delivered` and `read` are
 * driven by the reserved receipt kind and stay unused until receipt logic
 * ships; received messages persist as `delivered` on arrival. `failed` is
 * set when the retry queue permanently drops an outbound item.
 */
export type LinkDeliveryState = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

// ─── Storage row shapes ─────────────────────────────────────────────────────

/**
 * One messaging receiver per account. `receiverAlias` is an opaque handle
 * the native layer minted — the Noise secret NEVER enters JS.
 */
export interface LinkReceiver {
  ownerPubky: PubkyKey;
  receiverAlias: string;
  receiverPath: string;
  markerPublished: boolean;
  updatedAt: number;
}

export type LinkReceiverInput = Omit<LinkReceiver, 'updatedAt'>;

/**
 * One Encrypted Link (or in-progress handshake) per (owner, counterparty).
 * `snapshot` is opaque AEAD ciphertext produced natively under a per-install
 * device key. TypeScript must never parse it — persist and pass it back.
 */
export interface LinkRecord {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  role: LinkRole;
  status: StoredLinkStatus;
  snapshot: string;
  remoteNoisePublicKey: string;
  localReceiverPath: string;
  remoteReceiverPath: string;
  consecutiveFailures: number;
  updatedAt: number;
}

export type LinkRecordInput = Omit<LinkRecord, 'updatedAt'>;

/**
 * Device-local message history (plaintext bodies — never log them). Dedup
 * key is `(owner_pubky, sender_pubky, kind, event_id)` so a peer cannot
 * suppress another sender's message by reusing a UUID.
 */
export interface LinkMessage {
  ownerPubky: PubkyKey;
  eventId: string;
  conversationId: string;
  peerPubky: PubkyKey;
  senderPubky: PubkyKey;
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

/**
 * Every inbound Private Application Message, persisted BEFORE the advanced
 * snapshot so unknown kinds cannot be skipped past the native cursor.
 */
export interface LinkStreamItem {
  id: string;
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  kind: string | null;
  rawJson: string;
  receivedAt: number;
  processed: boolean;
}

export type LinkStreamItemInput = Omit<LinkStreamItem, 'processed'>;
