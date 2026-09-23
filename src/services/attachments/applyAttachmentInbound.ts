import type { PubkyKey } from '../../types';
import {
  attachmentKeyRef,
  CHAT_ATTACHMENT_KIND,
  decodeAttachmentEnvelope,
  decodePersistedAttachmentEnvelope,
  isAttachmentKeyPlaceholder,
  isAttachmentLocationBoundToSender,
  redactAttachmentEnvelope,
  type ChatAttachmentEnvelope,
} from '../../types/attachment';
import { buildDmConversationId, type LinkMessage } from '../../types/link';
import { KeyStore } from '../KeyStore';
import { StorageService } from '../StorageService';

/**
 * Persists one inbound `chat.attachment.v0` access message. Does not download
 * or decrypt ciphertext. Keys go to KeyStore first; SQLite gets metadata +
 * a redacted `raw_json` (key/nonce replaced with `__keystore__`).
 *
 * Location must be `pubky://{authenticatedSender}/pub/hypercolor.app/v1/attachments/{uuid}`.
 * Rejected envelopes are marked seen and never persisted.
 *
 * With `channel_id`: persist a group_messages row only if the sender is an
 * active member of a known private channel (same policy as group content).
 * Without `channel_id`: persist a DM link_messages row.
 *
 * Returns the DM row when one was created; otherwise null.
 */
export async function applyAttachmentInbound(input: {
  ownerPubky: PubkyKey;
  senderPubky: PubkyKey;
  peerPubky: PubkyKey;
  rawJson: string;
  receivedAt: number;
}): Promise<LinkMessage | null> {
  const envelope =
    decodeAttachmentEnvelope(input.rawJson) ?? decodePersistedAttachmentEnvelope(input.rawJson);
  if (!envelope) {
    return null;
  }
  if (!isAttachmentLocationBoundToSender(envelope.location, input.senderPubky)) {
    if (envelope.channel_id) {
      await StorageService.markGroupEventSeen(
        input.ownerPubky,
        envelope.channel_id,
        input.senderPubky,
        envelope.event_id,
        input.receivedAt,
      );
    }
    return null;
  }

  if (envelope.channel_id) {
    await persistGroupAttachment(input, envelope);
    return null;
  }
  return persistDmAttachment(input, envelope);
}

async function persistGroupAttachment(
  input: {
    ownerPubky: PubkyKey;
    senderPubky: PubkyKey;
    receivedAt: number;
    rawJson: string;
  },
  envelope: ChatAttachmentEnvelope,
): Promise<void> {
  const channelId = envelope.channel_id;
  if (!channelId) return;
  if (
    await StorageService.hasGroupEvent(
      input.ownerPubky,
      channelId,
      input.senderPubky,
      envelope.event_id,
    )
  ) {
    return;
  }
  const channel = await StorageService.getGroupChannel(input.ownerPubky, channelId);
  if (!channel || channel.isPublic) {
    await StorageService.markGroupEventSeen(
      input.ownerPubky,
      channelId,
      input.senderPubky,
      envelope.event_id,
      input.receivedAt,
    );
    return;
  }
  const member = await StorageService.getGroupMember(
    input.ownerPubky,
    channelId,
    input.senderPubky,
  );
  if (!member || member.status !== 'active') {
    await StorageService.markGroupEventSeen(
      input.ownerPubky,
      channelId,
      input.senderPubky,
      envelope.event_id,
      input.receivedAt,
    );
    return;
  }

  await storeSecrets(input.ownerPubky, input.senderPubky, envelope, {
    peerPubky: input.senderPubky,
    conversationId: channelId,
  });
  const persistJson = JSON.stringify(redactAttachmentEnvelope(envelope));
  await StorageService.saveAttachment({
    ownerPubky: input.ownerPubky,
    eventId: envelope.event_id,
    conversationId: null,
    channelId,
    senderPubky: input.senderPubky,
    direction: 'received',
    location: envelope.location,
    keyRef: attachmentKeyRef(input.ownerPubky, input.senderPubky, envelope.event_id),
    contentType: envelope.contentType,
    size: envelope.size,
    thumbnailLocation: envelope.thumbnail?.location ?? null,
    localCachePath: null,
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
    deliveryState: 'delivered',
    resolveState: 'pending',
  });
  await StorageService.saveGroupMessage({
    ownerPubky: input.ownerPubky,
    channelId,
    eventId: envelope.event_id,
    senderPubky: input.senderPubky,
    kind: CHAT_ATTACHMENT_KIND,
    body: attachmentPreviewBody(envelope),
    rawJson: persistJson,
    sentAt: envelope.sent_at,
    receivedAt: input.receivedAt,
    deliveryState: 'delivered',
    replyToEventId: null,
    replyToAuthorPubky: null,
    targetEventId: null,
    targetAuthorPubky: null,
    editedAt: null,
    deleted: false,
  });
  await StorageService.touchGroupChannel(input.ownerPubky, channelId, envelope.sent_at);
}

async function persistDmAttachment(
  input: {
    ownerPubky: PubkyKey;
    senderPubky: PubkyKey;
    peerPubky: PubkyKey;
    receivedAt: number;
    rawJson: string;
  },
  envelope: ChatAttachmentEnvelope,
): Promise<LinkMessage | null> {
  if (
    await StorageService.hasLinkMessage(
      input.ownerPubky,
      input.senderPubky,
      CHAT_ATTACHMENT_KIND,
      envelope.event_id,
    )
  ) {
    return null;
  }
  if (await StorageService.hasAttachment(input.ownerPubky, input.senderPubky, envelope.event_id)) {
    return null;
  }

  await storeSecrets(input.ownerPubky, input.senderPubky, envelope, {
    peerPubky: input.peerPubky,
    conversationId: buildDmConversationId(input.peerPubky),
  });
  const persistJson = JSON.stringify(redactAttachmentEnvelope(envelope));
  await StorageService.saveAttachment({
    ownerPubky: input.ownerPubky,
    eventId: envelope.event_id,
    conversationId: buildDmConversationId(input.peerPubky),
    channelId: null,
    senderPubky: input.senderPubky,
    direction: 'received',
    location: envelope.location,
    keyRef: attachmentKeyRef(input.ownerPubky, input.senderPubky, envelope.event_id),
    contentType: envelope.contentType,
    size: envelope.size,
    thumbnailLocation: envelope.thumbnail?.location ?? null,
    localCachePath: null,
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
    deliveryState: 'delivered',
    resolveState: 'pending',
  });

  const row: LinkMessage = {
    ownerPubky: input.ownerPubky,
    eventId: envelope.event_id,
    conversationId: buildDmConversationId(input.peerPubky),
    peerPubky: input.peerPubky,
    senderPubky: input.senderPubky,
    direction: 'received',
    kind: CHAT_ATTACHMENT_KIND,
    rawJson: persistJson,
    body: attachmentPreviewBody(envelope),
    sentAt: envelope.sent_at,
    receivedAt: input.receivedAt,
    deliveryState: 'delivered',
  };
  await StorageService.saveLinkMessage(row);
  return row;
}

async function storeSecrets(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: ChatAttachmentEnvelope,
  binding: { peerPubky: string; conversationId: string },
): Promise<void> {
  if (isAttachmentKeyPlaceholder(envelope.key)) return;
  await KeyStore.setAttachmentSecret(
    ownerPubky,
    senderPubky,
    envelope.event_id,
    {
      key: envelope.key,
      nonce: envelope.nonce,
      algorithm: envelope.algorithm,
      ...(envelope.thumbnail && !isAttachmentKeyPlaceholder(envelope.thumbnail.key)
        ? { thumbnail: { key: envelope.thumbnail.key, nonce: envelope.thumbnail.nonce } }
        : {}),
    },
    binding,
  );
}

export function attachmentPreviewBody(
  envelope: Pick<ChatAttachmentEnvelope, 'contentType' | 'size'>,
): string {
  return `[attachment] ${envelope.contentType} (${envelope.size})`;
}
