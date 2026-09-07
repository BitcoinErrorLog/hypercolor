import {
  CHAT_DELETE_KIND,
  CHAT_EDIT_KIND,
  CHAT_PIN_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_TAG_KIND,
  CHAT_TYPING_KIND,
  LINK_MESSAGE_MAX_BYTES,
  isLinkSentAtUnixMs,
  parseLinkSentAt,
} from './link';
import { GROUP_INVITE_KIND, parseFounderBoundChannelId } from './group';

export const LWW_SENT_AT_CLAMP_MS = 5 * 60 * 1000;
export const CHAT_TAG_LABEL_MAX_UTF8 = 32;
export const CHAT_RECEIPT_EVENT_IDS_CAP = 16;
export const CHAT_TAG_LIVE_PER_TAGGER_TARGET = 20;
export const CHAT_TAG_OPS_PER_MINUTE = 100;

export const LINK_V1_CONTROL_KINDS = [
  CHAT_TAG_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_TYPING_KIND,
  CHAT_EDIT_KIND,
  CHAT_DELETE_KIND,
  CHAT_PIN_KIND,
  GROUP_INVITE_KIND,
] as const;

export type ChatKindReason =
  | 'not-json'
  | 'oversized'
  | 'unknown-kind'
  | 'wrong-kind'
  | 'bad-version'
  | 'bad-event-id'
  | 'bad-sent-at'
  | 'bad-channel-id'
  | 'bad-target-id'
  | 'bad-pubky'
  | 'invalid-label'
  | 'invalid-op'
  | 'invalid-status'
  | 'invalid-event-ids'
  | 'event-ids-cap'
  | 'invalid-state'
  | 'empty-body'
  | 'invalid-mentions'
  | 'reply-fields-mismatch'
  | 'cross-context'
  | 'wrong-author'
  | 'not-member'
  | 'not-admin'
  | 'not-editable'
  | 'not-deletable'
  | 'gated-peer'
  | 'expired';

export type ChatKindParseCtx = {
  senderPubky: string;
  ownerPubky: string;
  peerTrust: 'accepted' | 'gated';
  nowMs?: number;
};

export type ChatKindParseResult<T> = { ok: T } | { error: ChatKindReason };

export type ChatTagOp = 'add' | 'remove';
export type ChatReceiptStatus = 'delivered' | 'read';

export interface ChatTagEnvelope {
  version: 1;
  kind: typeof CHAT_TAG_KIND;
  event_id: string;
  sent_at: number;
  target_event_id: string;
  target_author_pubky: string;
  label: string;
  op: ChatTagOp;
  channel_id?: string;
}

export interface ChatReceiptEnvelope {
  version: 1;
  kind: typeof CHAT_RECEIPT_KIND;
  event_id: string;
  sent_at: number;
  status: ChatReceiptStatus;
  event_ids: string[];
  channel_id?: string;
}

export const CHAT_KIND_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBKY_LENGTH = 52;
const WORD_LABEL = /^[a-z0-9_]{1,32}$/;

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function serializedUtf8Bytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

export function isChatKindUuid(value: string): boolean {
  return CHAT_KIND_UUID_PATTERN.test(value);
}

export function isChatKindPubky(value: string): boolean {
  return value.length === PUBKY_LENGTH;
}

function graphemeCount(value: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)].length;
  }
  return Array.from(value).length;
}

function isEmojiGraphemeLabel(value: string): boolean {
  if (graphemeCount(value) !== 1) return false;
  if (WORD_LABEL.test(value)) return false;
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(value);
}

/** NFC-trim; one emoji grapheme or `/^[a-z0-9_]{1,32}$/`; UTF-8 ≤ 32. */
export function normalizeChatTagLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const label = raw.normalize('NFC').trim();
  if (label.length === 0) return null;
  if (utf8Bytes(label) > CHAT_TAG_LABEL_MAX_UTF8) return null;
  if (WORD_LABEL.test(label) || isEmojiGraphemeLabel(label)) return label;
  return null;
}

export function dmScopeKey(peerPubky: string): string {
  return `dm:${peerPubky}`;
}

export function tagScopeKey(
  channelId: string | undefined,
  conversationId: string | undefined,
): string {
  return channelId ?? conversationId ?? '';
}

type CommonFields = {
  event_id: string;
  sent_at: number;
  channel_id?: string;
};

function parseObject(raw: string): { error: ChatKindReason } | { value: Record<string, unknown> } {
  if (utf8Bytes(raw) > LINK_MESSAGE_MAX_BYTES) return { error: 'oversized' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: 'not-json' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'not-json' };
  }
  return { value: value as Record<string, unknown> };
}

function parseCommon(
  candidate: Record<string, unknown>,
  expectedKind: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<CommonFields> {
  if (ctx.peerTrust === 'gated') return { error: 'gated-peer' };
  if (candidate.version !== 1) return { error: 'bad-version' };
  if (typeof candidate.kind !== 'string') return { error: 'unknown-kind' };
  if (candidate.kind !== expectedKind) {
    if ((LINK_V1_CONTROL_KINDS as readonly string[]).includes(candidate.kind)) {
      return { error: 'wrong-kind' };
    }
    return { error: 'unknown-kind' };
  }
  if (typeof candidate.event_id !== 'string' || !isChatKindUuid(candidate.event_id)) {
    return { error: 'bad-event-id' };
  }
  const sentAt = parseLinkSentAt(candidate.sent_at);
  if (sentAt === null || !isLinkSentAtUnixMs(sentAt)) return { error: 'bad-sent-at' };
  const nowMs = ctx.nowMs ?? Date.now();
  if (sentAt > nowMs + LWW_SENT_AT_CLAMP_MS) return { error: 'bad-sent-at' };
  if (candidate.channel_id !== undefined) {
    if (typeof candidate.channel_id !== 'string') return { error: 'bad-channel-id' };
    if (!parseFounderBoundChannelId(candidate.channel_id)) return { error: 'bad-channel-id' };
  }
  const common: CommonFields = {
    event_id: candidate.event_id,
    sent_at: sentAt,
  };
  if (typeof candidate.channel_id === 'string') common.channel_id = candidate.channel_id;
  return { ok: common };
}

export function parseChatTagV0(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<ChatTagEnvelope> {
  const parsed = parseObject(raw);
  if ('error' in parsed) return parsed;
  const common = parseCommon(parsed.value, CHAT_TAG_KIND, ctx);
  if ('error' in common) return common;
  const candidate = parsed.value;
  if (typeof candidate.target_event_id !== 'string' || !isChatKindUuid(candidate.target_event_id)) {
    return { error: 'bad-target-id' };
  }
  if (
    typeof candidate.target_author_pubky !== 'string' ||
    !isChatKindPubky(candidate.target_author_pubky)
  ) {
    return { error: 'bad-pubky' };
  }
  const label = normalizeChatTagLabel(candidate.label);
  if (label === null) return { error: 'invalid-label' };
  if (candidate.op !== 'add' && candidate.op !== 'remove') return { error: 'invalid-op' };
  const envelope: ChatTagEnvelope = {
    version: 1,
    kind: CHAT_TAG_KIND,
    event_id: common.ok.event_id,
    sent_at: common.ok.sent_at,
    target_event_id: candidate.target_event_id,
    target_author_pubky: candidate.target_author_pubky,
    label,
    op: candidate.op,
  };
  if (common.ok.channel_id) envelope.channel_id = common.ok.channel_id;
  return { ok: envelope };
}

export function parseChatReceiptV0(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<ChatReceiptEnvelope> {
  const parsed = parseObject(raw);
  if ('error' in parsed) return parsed;
  const common = parseCommon(parsed.value, CHAT_RECEIPT_KIND, ctx);
  if ('error' in common) return common;
  const candidate = parsed.value;
  if (candidate.status !== 'delivered' && candidate.status !== 'read') {
    return { error: 'invalid-status' };
  }
  if (!Array.isArray(candidate.event_ids)) return { error: 'invalid-event-ids' };
  if (candidate.event_ids.length > CHAT_RECEIPT_EVENT_IDS_CAP) return { error: 'event-ids-cap' };
  if (candidate.event_ids.length < 1) return { error: 'invalid-event-ids' };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of candidate.event_ids) {
    if (typeof id !== 'string' || !isChatKindUuid(id)) return { error: 'invalid-event-ids' };
    if (seen.has(id)) return { error: 'invalid-event-ids' };
    seen.add(id);
    ids.push(id);
  }
  const envelope: ChatReceiptEnvelope = {
    version: 1,
    kind: CHAT_RECEIPT_KIND,
    event_id: common.ok.event_id,
    sent_at: common.ok.sent_at,
    status: candidate.status,
    event_ids: ids,
  };
  if (common.ok.channel_id) envelope.channel_id = common.ok.channel_id;
  return { ok: envelope };
}

export function buildChatTagEnvelope(input: {
  eventId: string;
  sentAt: number;
  targetEventId: string;
  targetAuthorPubky: string;
  label: string;
  op: ChatTagOp;
  channelId?: string;
}): { envelope: ChatTagEnvelope; json: string; byteSize: number } {
  const label = normalizeChatTagLabel(input.label);
  if (!isChatKindUuid(input.eventId) || !isChatKindUuid(input.targetEventId)) {
    throw new Error('chat.tag.v0 ids must be UUIDs');
  }
  if (!isChatKindPubky(input.targetAuthorPubky)) {
    throw new Error('chat.tag.v0 target_author_pubky is invalid');
  }
  if (!isLinkSentAtUnixMs(input.sentAt)) {
    throw new Error('chat.tag.v0 sent_at is invalid');
  }
  if (label === null) {
    throw new Error('chat.tag.v0 label is invalid');
  }
  if (input.channelId !== undefined && !parseFounderBoundChannelId(input.channelId)) {
    throw new Error('chat.tag.v0 channel_id is invalid');
  }
  const envelope: ChatTagEnvelope = {
    version: 1,
    kind: CHAT_TAG_KIND,
    event_id: input.eventId,
    sent_at: input.sentAt,
    target_event_id: input.targetEventId,
    target_author_pubky: input.targetAuthorPubky,
    label,
    op: input.op,
  };
  if (input.channelId) envelope.channel_id = input.channelId;
  const json = JSON.stringify(envelope);
  const byteSize = utf8Bytes(json);
  if (byteSize > LINK_MESSAGE_MAX_BYTES) {
    throw new Error(`chat.tag.v0 is too long: ${byteSize} bytes`);
  }
  return { envelope, json, byteSize };
}

export function buildChatReceiptEnvelope(input: {
  eventId: string;
  sentAt: number;
  status: ChatReceiptStatus;
  eventIds: string[];
  channelId?: string;
}): { envelope: ChatReceiptEnvelope; json: string; byteSize: number } {
  const unique = [...new Set(input.eventIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!isChatKindUuid(input.eventId)) {
    throw new Error('chat.receipt.v0 event_id must be a UUID');
  }
  if (!isLinkSentAtUnixMs(input.sentAt)) {
    throw new Error('chat.receipt.v0 sent_at is invalid');
  }
  if (unique.length < 1) {
    throw new Error('chat.receipt.v0 event_ids must not be empty');
  }
  if (unique.length > CHAT_RECEIPT_EVENT_IDS_CAP) {
    throw new Error('chat.receipt.v0 event_ids exceed cap');
  }
  if (unique.some(id => !isChatKindUuid(id))) {
    throw new Error('chat.receipt.v0 event_ids must be UUIDs');
  }
  if (input.channelId !== undefined && !parseFounderBoundChannelId(input.channelId)) {
    throw new Error('chat.receipt.v0 channel_id is invalid');
  }
  const envelope: ChatReceiptEnvelope = {
    version: 1,
    kind: CHAT_RECEIPT_KIND,
    event_id: input.eventId,
    sent_at: input.sentAt,
    status: input.status,
    event_ids: unique,
  };
  if (input.channelId) envelope.channel_id = input.channelId;
  const json = JSON.stringify(envelope);
  const byteSize = utf8Bytes(json);
  if (byteSize > LINK_MESSAGE_MAX_BYTES) {
    throw new Error(`chat.receipt.v0 is too long: ${byteSize} bytes`);
  }
  return { envelope, json, byteSize };
}

/** Spec byte-proof fixtures (kinds-v1.md, re-run 2026-09-05). */
export const CHAT_KIND_BYTE_PROOF_FIXTURES = {
  uuid: '01234567-89ab-cdef-0123-456789abcdef',
  pubky: 'a'.repeat(52),
  sentAt: 1_757_000_000_000,
} as const;

export function chatKindByteProofChannelId(): string {
  return `${CHAT_KIND_BYTE_PROOF_FIXTURES.pubky}:${CHAT_KIND_BYTE_PROOF_FIXTURES.uuid}`;
}
