import { ATTACHMENT_MAX_BYTES, ATTACHMENT_THUMBNAIL_MAX_BYTES } from '../flags/config';
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

/**
 * Written in place of key/nonce (and thumbnail key/nonce) in every durable
 * `raw_json` copy. The real material lives only in the OS KeyStore.
 */
export const ATTACHMENT_KEY_PLACEHOLDER = '__keystore__';

/** 32-byte key as unpadded base64url (32 × 4/3 → 43). */
export const ATTACHMENT_KEY_B64URL_LENGTH = 43;

/** 24-byte XChaCha20 nonce as unpadded base64url (24 × 4/3 → 32). */
export const ATTACHMENT_NONCE_B64URL_LENGTH = 32;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBKY_LENGTH = 52;
const ATTACHMENTS_PATH_PREFIX = '/pub/hypercolor.app/v1/attachments/';
const BASE64URL_UNPADDED = /^[A-Za-z0-9_-]+$/;

export type AttachmentResolveState =
  | 'pending'
  | 'uploading'
  | 'resolving'
  | 'ready'
  | 'failed'
  | 'unavailable-from-backup';

export interface AttachmentThumbnailAccess {
  location: string;
  key: string;
  nonce: string;
  /** Additive; older peers may omit. Receive-side still enforces the thumbnail cap. */
  size?: number;
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

export interface ParsedAttachmentLocation {
  ownerPubky: string;
  attachmentId: string;
}

export interface AttachmentKeyRefParts {
  ownerPubky: string;
  senderPubky: string;
  eventId: string;
}

/**
 * Keychain handle for one attachment's key/nonce material.
 * Sender-scoped so a group peer cannot overwrite another sender's secret
 * by reusing `event_id`.
 */
export function attachmentKeyRef(ownerPubky: string, senderPubky: string, eventId: string): string {
  return `att:${ownerPubky}:${senderPubky}:${eventId}`;
}

export function parseAttachmentKeyRef(keyRef: string): AttachmentKeyRefParts | null {
  if (!keyRef.startsWith('att:')) return null;
  const parts = keyRef.slice(4).split(':');
  if (parts.length !== 3) return null;
  const [ownerPubky, senderPubky, eventId] = parts;
  if (!ownerPubky || !senderPubky || !eventId) return null;
  if (ownerPubky.length !== PUBKY_LENGTH || senderPubky.length !== PUBKY_LENGTH) return null;
  if (!UUID_PATTERN.test(eventId)) return null;
  return { ownerPubky, senderPubky, eventId };
}

export function isAttachmentKind(kind: string): boolean {
  return kind === CHAT_ATTACHMENT_KIND;
}

export function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

export function isCanonicalAttachmentKey(value: string): boolean {
  return value.length === ATTACHMENT_KEY_B64URL_LENGTH && BASE64URL_UNPADDED.test(value);
}

export function isCanonicalAttachmentNonce(value: string): boolean {
  return value.length === ATTACHMENT_NONCE_B64URL_LENGTH && BASE64URL_UNPADDED.test(value);
}

export function isAttachmentKeyPlaceholder(value: string): boolean {
  return value === ATTACHMENT_KEY_PLACEHOLDER;
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

/**
 * Strict parse of `pubky://{52-char-pubky}/pub/hypercolor.app/v1/attachments/{uuid}`.
 * Thumbnail URLs (`.thumb` suffix) are rejected here — use
 * {@link isValidAttachmentThumbnailLocation}.
 */
export function parseAttachmentLocation(location: string): ParsedAttachmentLocation | null {
  const prefix = `pubky://`;
  if (!location.startsWith(prefix)) return null;
  const rest = location.slice(prefix.length);
  if (rest.length < PUBKY_LENGTH + ATTACHMENTS_PATH_PREFIX.length + 36) return null;
  const ownerPubky = rest.slice(0, PUBKY_LENGTH);
  if (ownerPubky.length !== PUBKY_LENGTH) return null;
  const afterOwner = rest.slice(PUBKY_LENGTH);
  if (!afterOwner.startsWith(ATTACHMENTS_PATH_PREFIX)) return null;
  const attachmentId = afterOwner.slice(ATTACHMENTS_PATH_PREFIX.length);
  if (!UUID_PATTERN.test(attachmentId)) return null;
  return { ownerPubky, attachmentId };
}

export function isAttachmentLocationBoundToSender(location: string, senderPubky: string): boolean {
  const parsed = parseAttachmentLocation(location);
  return parsed !== null && parsed.ownerPubky === senderPubky;
}

export function isValidAttachmentThumbnailLocation(
  mainLocation: string,
  thumbnailLocation: string,
): boolean {
  return thumbnailLocation === `${mainLocation}.thumb`;
}

export function serializedEnvelopeBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function redactAttachmentEnvelope(envelope: ChatAttachmentEnvelope): ChatAttachmentEnvelope {
  const redacted: ChatAttachmentEnvelope = {
    ...envelope,
    key: ATTACHMENT_KEY_PLACEHOLDER,
    nonce: ATTACHMENT_KEY_PLACEHOLDER,
  };
  if (envelope.thumbnail) {
    redacted.thumbnail = {
      ...envelope.thumbnail,
      key: ATTACHMENT_KEY_PLACEHOLDER,
      nonce: ATTACHMENT_KEY_PLACEHOLDER,
    };
  }
  return redacted;
}

export function redactAttachmentRawJson(rawJson: string): string {
  const envelope = decodePersistedAttachmentEnvelope(rawJson) ?? decodeAttachmentEnvelope(rawJson);
  if (!envelope) return rawJson;
  return JSON.stringify(redactAttachmentEnvelope(envelope));
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
  if (!parseAttachmentLocation(input.location)) {
    throw new Error('chat.attachment.v0 location must be the canonical sender-owned path');
  }
  if (!isCanonicalAttachmentKey(input.key) || !isCanonicalAttachmentNonce(input.nonce)) {
    throw new Error('chat.attachment.v0 key/nonce must be canonical unpadded base64url');
  }
  if (input.algorithm !== ATTACHMENT_ALGORITHM) {
    throw new Error(`chat.attachment.v0 algorithm must be ${ATTACHMENT_ALGORITHM}`);
  }
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > ATTACHMENT_MAX_BYTES) {
    throw new Error(`chat.attachment.v0 size must be a positive integer ≤ ${ATTACHMENT_MAX_BYTES}`);
  }
  const contentType = input.contentType.trim();
  if (contentType.length === 0) {
    throw new Error('chat.attachment.v0 contentType must not be empty');
  }
  if (input.thumbnail) {
    if (!isValidAttachmentThumbnailLocation(input.location, input.thumbnail.location)) {
      throw new Error('chat.attachment.v0 thumbnail.location must be location + ".thumb"');
    }
    if (
      !isCanonicalAttachmentKey(input.thumbnail.key) ||
      !isCanonicalAttachmentNonce(input.thumbnail.nonce)
    ) {
      throw new Error('chat.attachment.v0 thumbnail key/nonce must be canonical base64url');
    }
    if (
      input.thumbnail.size !== undefined &&
      (!Number.isInteger(input.thumbnail.size) ||
        input.thumbnail.size <= 0 ||
        input.thumbnail.size > ATTACHMENT_THUMBNAIL_MAX_BYTES)
    ) {
      throw new Error(
        `chat.attachment.v0 thumbnail.size must be a positive integer ≤ ${ATTACHMENT_THUMBNAIL_MAX_BYTES}`,
      );
    }
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
  return decodeAttachmentEnvelopeInternal(rawJson, false);
}

/** Persisted copies may carry {@link ATTACHMENT_KEY_PLACEHOLDER} instead of live keys. */
export function decodePersistedAttachmentEnvelope(rawJson: string): ChatAttachmentEnvelope | null {
  return decodeAttachmentEnvelopeInternal(rawJson, true);
}

function decodeAttachmentEnvelopeInternal(
  rawJson: string,
  allowPlaceholderKeys: boolean,
): ChatAttachmentEnvelope | null {
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
  if (typeof candidate.location !== 'string' || !parseAttachmentLocation(candidate.location)) {
    return null;
  }
  if (
    typeof candidate.key !== 'string' ||
    !isAcceptableKeyMaterial(candidate.key, allowPlaceholderKeys)
  ) {
    return null;
  }
  if (
    typeof candidate.nonce !== 'string' ||
    !isAcceptableNonceMaterial(candidate.nonce, allowPlaceholderKeys)
  ) {
    return null;
  }
  if (candidate.algorithm !== ATTACHMENT_ALGORITHM) return null;
  if (typeof candidate.contentType !== 'string' || candidate.contentType.trim().length === 0) {
    return null;
  }
  if (
    typeof candidate.size !== 'number' ||
    !Number.isInteger(candidate.size) ||
    candidate.size <= 0 ||
    candidate.size > ATTACHMENT_MAX_BYTES
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
    if (typeof thumb.location !== 'string') return null;
    if (!isValidAttachmentThumbnailLocation(envelope.location, thumb.location)) return null;
    if (
      typeof thumb.key !== 'string' ||
      !isAcceptableKeyMaterial(thumb.key, allowPlaceholderKeys)
    ) {
      return null;
    }
    if (
      typeof thumb.nonce !== 'string' ||
      !isAcceptableNonceMaterial(thumb.nonce, allowPlaceholderKeys)
    ) {
      return null;
    }
    const thumbnail: AttachmentThumbnailAccess = {
      location: thumb.location,
      key: thumb.key,
      nonce: thumb.nonce,
    };
    if (thumb.size !== undefined) {
      if (
        typeof thumb.size !== 'number' ||
        !Number.isInteger(thumb.size) ||
        thumb.size <= 0 ||
        thumb.size > ATTACHMENT_THUMBNAIL_MAX_BYTES
      ) {
        return null;
      }
      thumbnail.size = thumb.size;
    }
    envelope.thumbnail = thumbnail;
  }

  return envelope;
}

function isAcceptableKeyMaterial(value: string, allowPlaceholder: boolean): boolean {
  if (isCanonicalAttachmentKey(value)) return true;
  return allowPlaceholder && isAttachmentKeyPlaceholder(value);
}

function isAcceptableNonceMaterial(value: string, allowPlaceholder: boolean): boolean {
  if (isCanonicalAttachmentNonce(value)) return true;
  return allowPlaceholder && isAttachmentKeyPlaceholder(value);
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
