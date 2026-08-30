import type { PubkyKey } from './index';
import type { LinkDeliveryState } from './link';
import { LINK_MESSAGE_MAX_BYTES, parseLinkSentAt } from './link';
import { CHAT_ATTACHMENT_KIND } from './attachment';

/**
 * Wire contracts and local row types for M3 group chat.
 *
 * ## Private groups — pairwise fan-out (option a)
 *
 * There is NO shared group key and NO new native/FFI surface. A private
 * group message is a Private Application Message carried over each
 * member's existing 1:1 Paykit Encrypted Link via
 * `sendPrivateMessageJson`. The receiver routes by `channel_id`.
 *
 * Pairwise fan-out has NO cryptographic removal cutoff. A removed
 * member can still transmit to any peer who keeps the 1:1 Encrypted
 * Link. Removal is receive-side POLICY: compliant receivers reject
 * content from removed/non-members and do not add it to group history.
 * There is no group secret to rotate. Senders also stop including a
 * removed member in future fan-out, and the remove op is fanned out
 * to the removed subject so their local roster converges.
 *
 * ## Trust model
 *
 * Encrypted Links authenticate the *sender* as the 1:1 counterparty
 * (Noise XX). Group kinds do not carry a trusted sender field —
 * authorship is the link peer (`senderPubky` from LinkService).
 *
 * Authorization is evaluated against the *receiver's* local channel
 * and membership state, keyed by that authenticated `senderPubky`.
 * Authorize first; persist to `group_messages` only if authorized.
 * Rejected events may be recorded only as a seen/dedup marker. They
 * MUST NOT appear in group history or the UI.
 *
 * Private `channel_id` is founder-bound: `{founderPubky}:{uuid}`.
 * Event identity is sender-scoped: dedup key is
 * `(owner_pubky, channel_id, sender_pubky, event_id)`.
 * Reaction / edit / delete targets are `(channel_id, target_author_pubky,
 * target_event_id)`.
 *
 * - `chat.group.membership.v0` `create` on an unknown `channel_id`:
 *   accepted only when the authenticated sender equals the founder
 *   encoded in `channel_id`. The channel row is insert-if-absent;
 *   founder/admin metadata is never overwritten. A later `create` for
 *   an already-known channel is admin-only (name refresh) or ignored.
 * - `add` / `remove` / a subsequent `create`: applied only when the
 *   sender is an *active admin* in the local membership table.
 * - `leave`: the sender may only mark themselves removed. A leave
 *   naming a different `subject_pubky` is rejected.
 * - Content (`message` / `reaction` / `edit` / `delete`): the channel
 *   must be a known *private* channel locally and the sender must be
 *   an *active member*. Edit/delete also require
 *   `target_author_pubky === sender` and the same `channel_id` as the
 *   target. Cross-channel target references are rejected.
 * - Reactions / edits / deletes whose target is not yet present are
 *   deferred in a bounded store (per-sender quota + TTL) only after
 *   membership admission. They apply when the matching target arrives.
 *
 * Unknown kinds stay on `link_stream_items` unprocessed (M1 rule).
 * Malformed *known* group kinds are rejected (not applied) and marked
 * processed so they cannot wedged-retry.
 *
 * ## Public channels
 *
 * Separate from private groups. Plaintext files on the author's
 * homeserver under `/pub/hypercolor.app/v1/public-channels/…`.
 * No Encrypted Links, no fan-out, no encryption. Authorship on read is
 * the path owner (`pubky://{author}/…`). See path helpers below.
 *
 * Nexus does not index chat URIs today. Discovery is invite links
 * (`hypercolor://join-public?channel=…`) and known channel ids — not tags.
 */

export const GROUP_MESSAGE_KIND = 'chat.group.message.v0';
export const GROUP_REACTION_KIND = 'chat.group.reaction.v0';
export const GROUP_EDIT_KIND = 'chat.group.edit.v0';
export const GROUP_DELETE_KIND = 'chat.group.delete.v0';
export const GROUP_MEMBERSHIP_KIND = 'chat.group.membership.v0';
export const PUBLIC_CHANNEL_MESSAGE_KIND = 'chat.public.message.v0';

export const GROUP_WIRE_KINDS = [
  GROUP_MESSAGE_KIND,
  GROUP_REACTION_KIND,
  GROUP_EDIT_KIND,
  GROUP_DELETE_KIND,
  GROUP_MEMBERSHIP_KIND,
] as const;

export type GroupWireKind = (typeof GROUP_WIRE_KINDS)[number];

export type GroupMembershipOp = 'add' | 'remove' | 'create' | 'leave';

export type GroupMemberRole = 'admin' | 'member';
export type GroupMemberStatus = 'active' | 'removed';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBKY_LENGTH = 52;

export function isGroupWireKind(kind: string): kind is GroupWireKind {
  return (GROUP_WIRE_KINDS as readonly string[]).includes(kind);
}

export function isGroupEventId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// ─── Public channel paths ───────────────────────────────────────────────────

/**
 * Public-channel homeserver namespace (world-readable `/pub`).
 *
 * ```
 * pubky://{author}/pub/hypercolor.app/v1/public-channels/{host}/{localId}/meta.json
 * pubky://{author}/pub/hypercolor.app/v1/public-channels/{host}/{localId}/messages/{sentAt}-{eventId}.json
 * ```
 *
 * `{host}` is the creator's pubky. `{localId}` is a UUID. The composite
 * channel id stored locally and in invite links is `{host}:{localId}`.
 *
 * Messages live on *each author's* homeserver (the path owner). Readers
 * list+get the host plus any locally-known authors. Tag-based / Nexus
 * discovery is future work (Nexus does not index chat URIs).
 */
export const PUBLIC_CHANNEL_PATH_PREFIX = '/pub/hypercolor.app/v1/public-channels';

export const PUBLIC_CHANNEL_DEEP_LINK = 'hypercolor://join-public';

/** Per-member private-group fan-out item in the shared `delivery_queue`. */
export const LINK_GROUP_FANOUT_PAYLOAD_TYPE = 'link.group.fanout';

/**
 * Founder-bound channel id: `{founderPubky}:{uuid}`.
 * Used by private groups (founder) and public channels (host).
 */
export function buildFounderBoundChannelId(founderPubky: PubkyKey, localId: string): string {
  return `${founderPubky}:${localId}`;
}

export function parseFounderBoundChannelId(
  channelId: string,
): { founderPubky: PubkyKey; localId: string } | null {
  const colon = channelId.indexOf(':');
  if (colon !== PUBKY_LENGTH) return null;
  const founderPubky = channelId.slice(0, colon);
  const localId = channelId.slice(colon + 1);
  if (founderPubky.length !== PUBKY_LENGTH) return null;
  if (!UUID_PATTERN.test(localId)) return null;
  return { founderPubky, localId };
}

export function buildPrivateChannelId(founderPubky: PubkyKey, localId: string): string {
  return buildFounderBoundChannelId(founderPubky, localId);
}

export function parsePrivateChannelId(
  channelId: string,
): { founderPubky: PubkyKey; localId: string } | null {
  return parseFounderBoundChannelId(channelId);
}

export function buildPublicChannelId(hostPubky: PubkyKey, localId: string): string {
  return buildFounderBoundChannelId(hostPubky, localId);
}

export function parsePublicChannelId(
  channelId: string,
): { hostPubky: PubkyKey; localId: string } | null {
  const parsed = parseFounderBoundChannelId(channelId);
  if (!parsed) return null;
  return { hostPubky: parsed.founderPubky, localId: parsed.localId };
}

export function publicChannelMetaUrl(hostPubky: PubkyKey, localId: string): string {
  return `pubky://${hostPubky}${PUBLIC_CHANNEL_PATH_PREFIX}/${hostPubky}/${localId}/meta.json`;
}

export function publicChannelMessagesPrefix(
  authorPubky: PubkyKey,
  hostPubky: PubkyKey,
  localId: string,
): string {
  return `pubky://${authorPubky}${PUBLIC_CHANNEL_PATH_PREFIX}/${hostPubky}/${localId}/messages/`;
}

export function publicChannelMessageUrl(
  authorPubky: PubkyKey,
  hostPubky: PubkyKey,
  localId: string,
  sentAt: number,
  eventId: string,
): string {
  return `${publicChannelMessagesPrefix(authorPubky, hostPubky, localId)}${sentAt}-${eventId}.json`;
}

export function buildPublicChannelInvite(hostPubky: PubkyKey, localId: string): string {
  return `${PUBLIC_CHANNEL_DEEP_LINK}?channel=${buildPublicChannelId(hostPubky, localId)}`;
}

/**
 * Accepts a composite id (`host:uuid`), an invite URL
 * (`hypercolor://join-public?channel=host:uuid` or `?channel=uuid&host=host`),
 * or a bare `host:uuid`.
 */
export function parsePublicChannelRef(
  input: string,
): { hostPubky: PubkyKey; localId: string } | null {
  const trimmed = input.trim();
  const direct = parsePublicChannelId(trimmed);
  if (direct) return direct;

  if (trimmed.startsWith(PUBLIC_CHANNEL_DEEP_LINK)) {
    const queryIndex = trimmed.indexOf('?');
    if (queryIndex === -1) return null;
    const params = new URLSearchParams(trimmed.slice(queryIndex + 1));
    const channel = params.get('channel');
    const host = params.get('host');
    if (channel && host) {
      if (host.length !== PUBKY_LENGTH || !UUID_PATTERN.test(channel)) return null;
      return { hostPubky: host, localId: channel };
    }
    if (channel) return parsePublicChannelId(channel);
  }
  return null;
}

// ─── Wire envelopes ─────────────────────────────────────────────────────────

export interface GroupMessageEnvelope {
  version: 1;
  kind: typeof GROUP_MESSAGE_KIND;
  channel_id: string;
  event_id: string;
  sent_at: number;
  body: string;
  reply_to?: string;
}

export interface GroupReactionEnvelope {
  version: 1;
  kind: typeof GROUP_REACTION_KIND;
  channel_id: string;
  event_id: string;
  target_event_id: string;
  target_author_pubky: string;
  emoji: string;
  sent_at: number;
}

export interface GroupEditEnvelope {
  version: 1;
  kind: typeof GROUP_EDIT_KIND;
  channel_id: string;
  event_id: string;
  target_event_id: string;
  target_author_pubky: string;
  body: string;
  sent_at: number;
}

export interface GroupDeleteEnvelope {
  version: 1;
  kind: typeof GROUP_DELETE_KIND;
  channel_id: string;
  event_id: string;
  target_event_id: string;
  target_author_pubky: string;
  sent_at: number;
}

export interface GroupMembershipEnvelope {
  version: 1;
  kind: typeof GROUP_MEMBERSHIP_KIND;
  channel_id: string;
  event_id: string;
  sent_at: number;
  op: GroupMembershipOp;
  subject_pubky?: string;
  name?: string;
  members?: string[];
}

export type GroupEnvelope =
  | GroupMessageEnvelope
  | GroupReactionEnvelope
  | GroupEditEnvelope
  | GroupDeleteEnvelope
  | GroupMembershipEnvelope;

export interface PublicChannelMeta {
  version: 1;
  channel_id: string;
  name: string;
  created_by: PubkyKey;
  created_at: number;
}

export interface PublicChannelMessageDocument {
  version: 1;
  kind: typeof PUBLIC_CHANNEL_MESSAGE_KIND;
  channel_id: string;
  event_id: string;
  sent_at: number;
  body: string;
  author: PubkyKey;
  reply_to?: string;
}

// ─── Local rows ─────────────────────────────────────────────────────────────

export interface GroupChannel {
  ownerPubky: PubkyKey;
  channelId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  createdBy: PubkyKey;
  isPublic: boolean;
  lastMessageAt: number | null;
  membershipEpoch: number;
}

export interface GroupMember {
  ownerPubky: PubkyKey;
  channelId: string;
  memberPubky: PubkyKey;
  role: GroupMemberRole;
  addedAt: number;
  removedAt: number | null;
  status: GroupMemberStatus;
}

export interface GroupMessage {
  ownerPubky: PubkyKey;
  channelId: string;
  eventId: string;
  senderPubky: PubkyKey;
  kind: string;
  body: string;
  rawJson: string;
  sentAt: number;
  receivedAt: number | null;
  deliveryState: LinkDeliveryState;
  replyToEventId: string | null;
  targetEventId: string | null;
  targetAuthorPubky: PubkyKey | null;
  editedAt: number | null;
  deleted: boolean;
}

/** Bounded deferred reaction / edit / delete waiting for its target. */
export interface GroupDeferredEvent {
  ownerPubky: PubkyKey;
  channelId: string;
  senderPubky: PubkyKey;
  eventId: string;
  kind: string;
  body: string;
  rawJson: string;
  sentAt: number;
  receivedAt: number;
  targetEventId: string;
  targetAuthorPubky: PubkyKey;
}

export class GroupServiceError extends Error {
  readonly code: GroupServiceErrorCode;

  constructor(code: GroupServiceErrorCode, message: string) {
    super(message);
    this.name = 'GroupServiceError';
    this.code = code;
  }
}

export type GroupServiceErrorCode =
  | 'member-cap'
  | 'not-admin'
  | 'not-author'
  | 'not-member'
  | 'not-found'
  | 'invalid-input'
  | 'public-only'
  | 'private-only';

// ─── Peek / decode ──────────────────────────────────────────────────────────

export function peekEnvelopeKind(rawJson: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : null;
}

function asRecord(rawJson: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function readChannelId(candidate: Record<string, unknown>): string | null {
  if (typeof candidate.channel_id !== 'string') return null;
  if (candidate.channel_id.length === 0 || candidate.channel_id.length > 200) return null;
  return candidate.channel_id;
}

function readEventId(candidate: Record<string, unknown>): string | null {
  if (typeof candidate.event_id !== 'string' || !UUID_PATTERN.test(candidate.event_id)) {
    return null;
  }
  return candidate.event_id;
}

function readTargetEventId(candidate: Record<string, unknown>): string | null {
  if (typeof candidate.target_event_id !== 'string') return null;
  if (!UUID_PATTERN.test(candidate.target_event_id)) return null;
  return candidate.target_event_id;
}

function readTargetAuthorPubky(candidate: Record<string, unknown>): string | null {
  if (typeof candidate.target_author_pubky !== 'string') return null;
  if (candidate.target_author_pubky.length !== PUBKY_LENGTH) return null;
  return candidate.target_author_pubky;
}

function assertSerializedSize(json: string, kind: string): number {
  const byteSize = new TextEncoder().encode(json).byteLength;
  if (byteSize > LINK_MESSAGE_MAX_BYTES) {
    throw new GroupServiceError(
      'invalid-input',
      `${kind} is too long: ${byteSize} bytes serialized, limit ${LINK_MESSAGE_MAX_BYTES}`,
    );
  }
  return byteSize;
}

export function buildGroupMessageEnvelope(input: {
  channelId: string;
  eventId: string;
  sentAt: number;
  body: string;
  replyTo?: string;
}): { envelope: GroupMessageEnvelope; json: string; byteSize: number } {
  if (!UUID_PATTERN.test(input.eventId)) {
    throw new GroupServiceError('invalid-input', `${GROUP_MESSAGE_KIND} event_id must be a UUID`);
  }
  if (!Number.isInteger(input.sentAt) || input.sentAt <= 0) {
    throw new GroupServiceError(
      'invalid-input',
      `${GROUP_MESSAGE_KIND} sent_at must be a positive Unix-millisecond integer`,
    );
  }
  const body = input.body.trim();
  if (body.length === 0) {
    throw new GroupServiceError('invalid-input', `${GROUP_MESSAGE_KIND} body must not be empty`);
  }
  if (input.replyTo !== undefined && !UUID_PATTERN.test(input.replyTo)) {
    throw new GroupServiceError('invalid-input', `${GROUP_MESSAGE_KIND} reply_to must be a UUID`);
  }
  const envelope: GroupMessageEnvelope = {
    version: 1,
    kind: GROUP_MESSAGE_KIND,
    channel_id: input.channelId,
    event_id: input.eventId,
    sent_at: input.sentAt,
    body,
  };
  if (input.replyTo !== undefined) {
    envelope.reply_to = input.replyTo;
  }
  const json = JSON.stringify(envelope);
  const byteSize = assertSerializedSize(json, GROUP_MESSAGE_KIND);
  return { envelope, json, byteSize };
}

export function buildGroupReactionEnvelope(input: {
  channelId: string;
  eventId: string;
  targetEventId: string;
  targetAuthorPubky: string;
  emoji: string;
  sentAt: number;
}): { envelope: GroupReactionEnvelope; json: string; byteSize: number } {
  const emoji = input.emoji.trim();
  if (!UUID_PATTERN.test(input.eventId) || !UUID_PATTERN.test(input.targetEventId)) {
    throw new GroupServiceError('invalid-input', `${GROUP_REACTION_KIND} ids must be UUIDs`);
  }
  if (input.targetAuthorPubky.length !== PUBKY_LENGTH) {
    throw new GroupServiceError(
      'invalid-input',
      `${GROUP_REACTION_KIND} target_author_pubky is invalid`,
    );
  }
  if (!Number.isInteger(input.sentAt) || input.sentAt <= 0) {
    throw new GroupServiceError('invalid-input', `${GROUP_REACTION_KIND} sent_at is invalid`);
  }
  if (emoji.length === 0 || emoji.length > 32) {
    throw new GroupServiceError('invalid-input', `${GROUP_REACTION_KIND} emoji is invalid`);
  }
  const envelope: GroupReactionEnvelope = {
    version: 1,
    kind: GROUP_REACTION_KIND,
    channel_id: input.channelId,
    event_id: input.eventId,
    target_event_id: input.targetEventId,
    target_author_pubky: input.targetAuthorPubky,
    emoji,
    sent_at: input.sentAt,
  };
  const json = JSON.stringify(envelope);
  return { envelope, json, byteSize: assertSerializedSize(json, GROUP_REACTION_KIND) };
}

export function buildGroupEditEnvelope(input: {
  channelId: string;
  eventId: string;
  targetEventId: string;
  targetAuthorPubky: string;
  body: string;
  sentAt: number;
}): { envelope: GroupEditEnvelope; json: string; byteSize: number } {
  const body = input.body.trim();
  if (!UUID_PATTERN.test(input.eventId) || !UUID_PATTERN.test(input.targetEventId)) {
    throw new GroupServiceError('invalid-input', `${GROUP_EDIT_KIND} ids must be UUIDs`);
  }
  if (input.targetAuthorPubky.length !== PUBKY_LENGTH) {
    throw new GroupServiceError(
      'invalid-input',
      `${GROUP_EDIT_KIND} target_author_pubky is invalid`,
    );
  }
  if (!Number.isInteger(input.sentAt) || input.sentAt <= 0) {
    throw new GroupServiceError('invalid-input', `${GROUP_EDIT_KIND} sent_at is invalid`);
  }
  if (body.length === 0) {
    throw new GroupServiceError('invalid-input', `${GROUP_EDIT_KIND} body must not be empty`);
  }
  const envelope: GroupEditEnvelope = {
    version: 1,
    kind: GROUP_EDIT_KIND,
    channel_id: input.channelId,
    event_id: input.eventId,
    target_event_id: input.targetEventId,
    target_author_pubky: input.targetAuthorPubky,
    body,
    sent_at: input.sentAt,
  };
  const json = JSON.stringify(envelope);
  return { envelope, json, byteSize: assertSerializedSize(json, GROUP_EDIT_KIND) };
}

export function buildGroupDeleteEnvelope(input: {
  channelId: string;
  eventId: string;
  targetEventId: string;
  targetAuthorPubky: string;
  sentAt: number;
}): { envelope: GroupDeleteEnvelope; json: string; byteSize: number } {
  if (!UUID_PATTERN.test(input.eventId) || !UUID_PATTERN.test(input.targetEventId)) {
    throw new GroupServiceError('invalid-input', `${GROUP_DELETE_KIND} ids must be UUIDs`);
  }
  if (input.targetAuthorPubky.length !== PUBKY_LENGTH) {
    throw new GroupServiceError(
      'invalid-input',
      `${GROUP_DELETE_KIND} target_author_pubky is invalid`,
    );
  }
  if (!Number.isInteger(input.sentAt) || input.sentAt <= 0) {
    throw new GroupServiceError('invalid-input', `${GROUP_DELETE_KIND} sent_at is invalid`);
  }
  const envelope: GroupDeleteEnvelope = {
    version: 1,
    kind: GROUP_DELETE_KIND,
    channel_id: input.channelId,
    event_id: input.eventId,
    target_event_id: input.targetEventId,
    target_author_pubky: input.targetAuthorPubky,
    sent_at: input.sentAt,
  };
  const json = JSON.stringify(envelope);
  return { envelope, json, byteSize: assertSerializedSize(json, GROUP_DELETE_KIND) };
}

export function buildGroupMembershipEnvelope(input: {
  channelId: string;
  eventId: string;
  sentAt: number;
  op: GroupMembershipOp;
  subjectPubky?: string;
  name?: string;
  members?: string[];
}): { envelope: GroupMembershipEnvelope; json: string; byteSize: number } {
  if (!UUID_PATTERN.test(input.eventId)) {
    throw new GroupServiceError(
      'invalid-input',
      `${GROUP_MEMBERSHIP_KIND} event_id must be a UUID`,
    );
  }
  if (!Number.isInteger(input.sentAt) || input.sentAt <= 0) {
    throw new GroupServiceError('invalid-input', `${GROUP_MEMBERSHIP_KIND} sent_at is invalid`);
  }
  const envelope: GroupMembershipEnvelope = {
    version: 1,
    kind: GROUP_MEMBERSHIP_KIND,
    channel_id: input.channelId,
    event_id: input.eventId,
    sent_at: input.sentAt,
    op: input.op,
  };
  if (input.subjectPubky !== undefined) envelope.subject_pubky = input.subjectPubky;
  if (input.name !== undefined) envelope.name = input.name;
  if (input.members !== undefined) envelope.members = input.members;
  const json = JSON.stringify(envelope);
  return { envelope, json, byteSize: assertSerializedSize(json, GROUP_MEMBERSHIP_KIND) };
}

/**
 * Packs as many `members` into a create envelope as the 1000-byte Noise
 * ceiling allows. Remainder must be announced as individual `add` ops
 * (a 50-member roster cannot fit in one PAM).
 */
export function packMembershipCreate(input: {
  channelId: string;
  eventId: string;
  sentAt: number;
  name: string;
  members: string[];
}): { json: string; envelope: GroupMembershipEnvelope; overflow: string[] } {
  let included = [...input.members];
  let overflow: string[] = [];
  for (;;) {
    try {
      const built = buildGroupMembershipEnvelope({
        channelId: input.channelId,
        eventId: input.eventId,
        sentAt: input.sentAt,
        op: 'create',
        name: input.name,
        members: included,
      });
      return { json: built.json, envelope: built.envelope, overflow };
    } catch (err) {
      if (!(err instanceof GroupServiceError) || err.code !== 'invalid-input') throw err;
      if (included.length === 0) {
        const built = buildGroupMembershipEnvelope({
          channelId: input.channelId,
          eventId: input.eventId,
          sentAt: input.sentAt,
          op: 'create',
          name: input.name,
        });
        return { json: built.json, envelope: built.envelope, overflow: input.members };
      }
      const moved = included.pop();
      if (moved === undefined) throw err;
      overflow = [moved, ...overflow];
    }
  }
}

export function decodeGroupEnvelope(rawJson: string): GroupEnvelope | null {
  const candidate = asRecord(rawJson);
  if (!candidate) return null;
  if (candidate.version !== 1) return null;
  if (typeof candidate.kind !== 'string' || !isGroupWireKind(candidate.kind)) return null;
  const channelId = readChannelId(candidate);
  const eventId = readEventId(candidate);
  const sentAt = parseLinkSentAt(candidate.sent_at);
  if (channelId === null || eventId === null || sentAt === null) return null;

  switch (candidate.kind) {
    case GROUP_MESSAGE_KIND: {
      if (typeof candidate.body !== 'string' || candidate.body.trim().length === 0) return null;
      const envelope: GroupMessageEnvelope = {
        version: 1,
        kind: GROUP_MESSAGE_KIND,
        channel_id: channelId,
        event_id: eventId,
        sent_at: sentAt,
        body: candidate.body,
      };
      if (typeof candidate.reply_to === 'string') {
        if (!UUID_PATTERN.test(candidate.reply_to)) return null;
        envelope.reply_to = candidate.reply_to;
      }
      return envelope;
    }
    case GROUP_REACTION_KIND: {
      const targetEventId = readTargetEventId(candidate);
      const targetAuthor = readTargetAuthorPubky(candidate);
      if (targetEventId === null || targetAuthor === null) return null;
      if (typeof candidate.emoji !== 'string' || candidate.emoji.trim().length === 0) return null;
      return {
        version: 1,
        kind: GROUP_REACTION_KIND,
        channel_id: channelId,
        event_id: eventId,
        target_event_id: targetEventId,
        target_author_pubky: targetAuthor,
        emoji: candidate.emoji,
        sent_at: sentAt,
      };
    }
    case GROUP_EDIT_KIND: {
      const targetEventId = readTargetEventId(candidate);
      const targetAuthor = readTargetAuthorPubky(candidate);
      if (targetEventId === null || targetAuthor === null) return null;
      if (typeof candidate.body !== 'string' || candidate.body.trim().length === 0) return null;
      return {
        version: 1,
        kind: GROUP_EDIT_KIND,
        channel_id: channelId,
        event_id: eventId,
        target_event_id: targetEventId,
        target_author_pubky: targetAuthor,
        body: candidate.body,
        sent_at: sentAt,
      };
    }
    case GROUP_DELETE_KIND: {
      const targetEventId = readTargetEventId(candidate);
      const targetAuthor = readTargetAuthorPubky(candidate);
      if (targetEventId === null || targetAuthor === null) return null;
      return {
        version: 1,
        kind: GROUP_DELETE_KIND,
        channel_id: channelId,
        event_id: eventId,
        target_event_id: targetEventId,
        target_author_pubky: targetAuthor,
        sent_at: sentAt,
      };
    }
    case GROUP_MEMBERSHIP_KIND: {
      if (
        candidate.op !== 'add' &&
        candidate.op !== 'remove' &&
        candidate.op !== 'create' &&
        candidate.op !== 'leave'
      ) {
        return null;
      }
      const envelope: GroupMembershipEnvelope = {
        version: 1,
        kind: GROUP_MEMBERSHIP_KIND,
        channel_id: channelId,
        event_id: eventId,
        sent_at: sentAt,
        op: candidate.op,
      };
      if (typeof candidate.subject_pubky === 'string') {
        envelope.subject_pubky = candidate.subject_pubky;
      }
      if (typeof candidate.name === 'string') {
        envelope.name = candidate.name;
      }
      if (Array.isArray(candidate.members)) {
        const members: string[] = [];
        for (const item of candidate.members) {
          if (typeof item !== 'string' || item.length === 0) return null;
          members.push(item);
        }
        envelope.members = members;
      }
      return envelope;
    }
    default:
      return null;
  }
}

export function decodePublicChannelMeta(raw: string): PublicChannelMeta | null {
  const candidate = asRecord(raw);
  if (!candidate) return null;
  if (candidate.version !== 1) return null;
  if (typeof candidate.channel_id !== 'string') return null;
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) return null;
  if (typeof candidate.created_by !== 'string') return null;
  if (typeof candidate.created_at !== 'number' || !Number.isInteger(candidate.created_at)) {
    return null;
  }
  return {
    version: 1,
    channel_id: candidate.channel_id,
    name: candidate.name.trim(),
    created_by: candidate.created_by,
    created_at: candidate.created_at,
  };
}

export function decodePublicChannelMessage(
  raw: string,
  pathOwner: PubkyKey,
): PublicChannelMessageDocument | null {
  const candidate = asRecord(raw);
  if (!candidate) return null;
  if (candidate.version !== 1) return null;
  if (candidate.kind !== PUBLIC_CHANNEL_MESSAGE_KIND) return null;
  if (typeof candidate.channel_id !== 'string') return null;
  if (typeof candidate.event_id !== 'string' || !UUID_PATTERN.test(candidate.event_id)) return null;
  const sentAt = parseLinkSentAt(candidate.sent_at);
  if (sentAt === null) return null;
  if (typeof candidate.body !== 'string' || candidate.body.trim().length === 0) return null;
  if (typeof candidate.author !== 'string') return null;
  if (candidate.author !== pathOwner) return null;
  const doc: PublicChannelMessageDocument = {
    version: 1,
    kind: PUBLIC_CHANNEL_MESSAGE_KIND,
    channel_id: candidate.channel_id,
    event_id: candidate.event_id,
    sent_at: sentAt,
    body: candidate.body,
    author: candidate.author,
  };
  if (typeof candidate.reply_to === 'string') {
    if (!UUID_PATTERN.test(candidate.reply_to)) return null;
    doc.reply_to = candidate.reply_to;
  }
  return doc;
}

export function groupMessageBody(envelope: GroupEnvelope): string {
  switch (envelope.kind) {
    case GROUP_MESSAGE_KIND:
    case GROUP_EDIT_KIND:
      return envelope.body;
    case GROUP_REACTION_KIND:
      return envelope.emoji;
    case GROUP_DELETE_KIND:
      return '';
    case GROUP_MEMBERSHIP_KIND:
      return envelope.op;
    default:
      return '';
  }
}

export function groupTargetEventId(envelope: GroupEnvelope): string | null {
  switch (envelope.kind) {
    case GROUP_REACTION_KIND:
    case GROUP_EDIT_KIND:
    case GROUP_DELETE_KIND:
      return envelope.target_event_id;
    default:
      return null;
  }
}

export function groupTargetAuthorPubky(envelope: GroupEnvelope): string | null {
  switch (envelope.kind) {
    case GROUP_REACTION_KIND:
    case GROUP_EDIT_KIND:
    case GROUP_DELETE_KIND:
      return envelope.target_author_pubky;
    default:
      return null;
  }
}

export function groupReplyToEventId(envelope: GroupEnvelope): string | null {
  return envelope.kind === GROUP_MESSAGE_KIND && envelope.reply_to !== undefined
    ? envelope.reply_to
    : null;
}

/** Timeline bubbles: admitted messages and applied membership ops. Never edits/deletes/seen. */
export function isGroupTimelineVisible(message: { kind: string }): boolean {
  return (
    message.kind === GROUP_MESSAGE_KIND ||
    message.kind === PUBLIC_CHANNEL_MESSAGE_KIND ||
    message.kind === GROUP_MEMBERSHIP_KIND ||
    message.kind === CHAT_ATTACHMENT_KIND
  );
}
