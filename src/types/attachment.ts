import { LINK_MESSAGE_MAX_BYTES } from './link';

/**
 * Access PAM for an encrypted attachment. Ciphertext lives at `location` on
 * the sender's homeserver (world-readable `/pub`). The key/nonce travel only
 * over the Encrypted Link. AAD at encrypt/decrypt time MUST equal `location`.
 *
 * Optional `channel_id` routes the access message into a private group.
 * Public channels are rejected at send time — there is no Encrypted Link
 * to carry the key without publishing it.
 */
export const CHAT_ATTACHMENT_KIND = 'chat.attachment.v0';

export const ATTACHMENT_ALGORITHM = 'XChaCha20Poly1305';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBKY_LENGTH = 52;
const ATTACHMENTS_PATH_PREFIX = '/pub/hypercolor.app/v1/attachments/';

export type AttachmentResolveState = 'pending' | 'uploading' | 'resolving' | 'ready' | 'failed';

export interface AttachmentThumbnailAccess {
  location: string;
  key: string;
  nonce: string;
}

export interface ChatAttachmentEnvelope {
  version: 1;
  kind: typeof CHAT_ATTACHMENT_KIND;
  event_id: string;
  sent_at: number;
  location: string;
  key: string;
  nonce: string;
  algorithm: string;
  contentType: string;
  size: number;
  channel_id?: string;
  thumbnail?: AttachmentThumbnailAccess;
}

export interface AttachmentRecord {
  ownerPubky: string;
  eventId: string;
  conversationId: string | null;
  channelId: string | null;
  senderPubky: string;
  direction: 'sent' | 'received';
  location: string;
  keyRef: string;
  contentType: string;
  size: number;
  thumbnailLocation: string | null;
  localCachePath: string | null;
  createdAt: number;
  updatedAt: number;
  deliveryState: 'sending' | 'sent' | 'delivered' | 'failed';
  resolveState: AttachmentResolveState;
}

/** Keychain handle for one attachment's key/nonce material. */
export function attachmentKeyRef(ownerPubky: string, eventId: string): string {
  return `att:${ownerPubky}:${eventId}`;
}

export function isAttachmentKind(kind: string): boolean {
  return kind === CHAT_ATTACHMENT_KIND;
}

export function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

/**
 * Canonical homeserver URL for one attachment ciphertext.
 * This exact string is stored as `location` and bound as AEAD AAD.
 */
export function buildAttachmentLocation(ownerPubky: string, attachmentId: string): string {
  if (ownerPubky.length !== PUBKY_LENGTH) {
    throw new Error(
      `attachment location owner must be a 52-character pubky, got ${ownerPubky.length}`,
    );
  }
  if (!UUID_PATTERN.test(attachmentId)) {
    throw new Error(`attachment id must be a UUID, got "${attachmentId}"`);
  }
  return `pubky://${ownerPubky}${ATTACHMENTS_PATH_PREFIX}${attachmentId}`;
}

export function buildAttachmentThumbLocation(ownerPubky: string, attachmentId: string): string {
  return `${buildAttachmentLocation(ownerPubky, attachmentId)}.thumb`;
}

export function serializedEnvelopeBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Builds a sendable `chat.attachment.v0` envelope. If the optional thumbnail
 * (or `channel_id`) pushes the serialized JSON over {@link LINK_MESSAGE_MAX_BYTES},
 * the thumbnail is dropped. Throws if the envelope still exceeds the budget.
 */
export function buildAttachmentEnvelope(input: {
  eventId: string;
  sentAt: number;
  location: string;
  key: string;
  nonce: string;
  algorithm: string;
  contentType: string;
  size: number;
  channelId?: string;
  thumbnail?: AttachmentThumbnailAccess;
}): {
  envelope: ChatAttachmentEnvelope;
  json: string;
  byteSize: number;
  thumbnailIncluded: boolean;
} {
  if (!UUID_PATTERN.test(input.eventId)) {
    throw new Error(`chat.attachment.v0 event_id must be a UUID, got "${input.eventId}"`);
  }
  if (!Number.isInteger(input.sentAt) || input.sentAt <= 0) {
    throw new Error('chat.attachment.v0 sent_at must be a positive Unix-millisecond integer');
  }
  if (input.location.trim().length === 0) {
    throw new Error('chat.attachment.v0 location must not be empty');
  }
  if (input.key.trim().length === 0 || input.nonce.trim().length === 0) {
    throw new Error('chat.attachment.v0 key and nonce are required');
  }
  if (!Number.isInteger(input.size) || input.size <= 0) {
    throw new Error('chat.attachment.v0 size must be a positive integer');
  }
  const contentType = input.contentType.trim();
  if (contentType.length === 0) {
    throw new Error('chat.attachment.v0 contentType must not be empty');
  }

  const base: ChatAttachmentEnvelope = {
    version: 1,
    kind: CHAT_ATTACHMENT_KIND,
    event_id: input.eventId,
    sent_at: input.sentAt,
    location: input.location,
    key: input.key,
    nonce: input.nonce,
    algorithm: input.algorithm,
    contentType,
    size: input.size,
  };
  if (input.channelId !== undefined && input.channelId.length > 0) {
    base.channel_id = input.channelId;
  }

  let envelope: ChatAttachmentEnvelope = base;
  let thumbnailIncluded = false;
  if (input.thumbnail) {
    const withThumb: ChatAttachmentEnvelope = { ...base, thumbnail: input.thumbnail };
    if (serializedEnvelopeBytes(withThumb) <= LINK_MESSAGE_MAX_BYTES) {
      envelope = withThumb;
      thumbnailIncluded = true;
    }
  }

  const json = JSON.stringify(envelope);
  const byteSize = new TextEncoder().encode(json).byteLength;
  if (byteSize > LINK_MESSAGE_MAX_BYTES) {
    throw new Error(
      `chat.attachment.v0 is too long: ${byteSize} bytes serialized, limit ${LINK_MESSAGE_MAX_BYTES}`,
    );
  }
  return { envelope, json, byteSize, thumbnailIncluded };
}

export function decodeAttachmentEnvelope(rawJson: string): ChatAttachmentEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  if (candidate.kind !== CHAT_ATTACHMENT_KIND) return null;
  if (typeof candidate.event_id !== 'string' || !UUID_PATTERN.test(candidate.event_id)) return null;
  if (
    typeof candidate.sent_at !== 'number' ||
    !Number.isInteger(candidate.sent_at) ||
    candidate.sent_at <= 0
  ) {
    return null;
  }
  if (typeof candidate.location !== 'string' || candidate.location.trim().length === 0) return null;
  if (typeof candidate.key !== 'string' || candidate.key.trim().length === 0) return null;
  if (typeof candidate.nonce !== 'string' || candidate.nonce.trim().length === 0) return null;
  if (typeof candidate.algorithm !== 'string' || candidate.algorithm.trim().length === 0)
    return null;
  if (typeof candidate.contentType !== 'string' || candidate.contentType.trim().length === 0)
    return null;
  if (
    typeof candidate.size !== 'number' ||
    !Number.isInteger(candidate.size) ||
    candidate.size <= 0
  ) {
    return null;
  }

  const envelope: ChatAttachmentEnvelope = {
    version: 1,
    kind: CHAT_ATTACHMENT_KIND,
    event_id: candidate.event_id,
    sent_at: candidate.sent_at,
    location: candidate.location,
    key: candidate.key,
    nonce: candidate.nonce,
    algorithm: candidate.algorithm,
    contentType: candidate.contentType,
    size: candidate.size,
  };

  if (typeof candidate.channel_id === 'string' && candidate.channel_id.length > 0) {
    envelope.channel_id = candidate.channel_id;
  }

  if (candidate.thumbnail !== undefined) {
    if (typeof candidate.thumbnail !== 'object' || candidate.thumbnail === null) return null;
    const thumb = candidate.thumbnail as Record<string, unknown>;
    if (typeof thumb.location !== 'string' || thumb.location.trim().length === 0) return null;
    if (typeof thumb.key !== 'string' || thumb.key.trim().length === 0) return null;
    if (typeof thumb.nonce !== 'string' || thumb.nonce.trim().length === 0) return null;
    envelope.thumbnail = { location: thumb.location, key: thumb.key, nonce: thumb.nonce };
  }

  return envelope;
}

export class AttachmentError extends Error {
  readonly code:
    | 'too-large'
    | 'validation'
    | 'unavailable'
    | 'protocol'
    | 'network'
    | 'not-found'
    | 'unsupported-target'
    | 'decrypt-failed';

  constructor(code: AttachmentError['code'], message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
  }
}
