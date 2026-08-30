import type { PubkyKey } from '../../types';
import {
  attachmentKeyRef,
  decodeAttachmentEnvelope,
  type ChatAttachmentEnvelope,
} from '../../types/attachment';
import { buildDmConversationId, type LinkMessage } from '../../types/link';
import { CHAT_ATTACHMENT_KIND } from '../../types/attachment';
import { KeyStore } from '../KeyStore';
import { StorageService } from '../StorageService';

/**
 * Persists one inbound `chat.attachment.v0` access message. Does not download
 * or decrypt ciphertext. Keys go to KeyStore; SQLite gets metadata + key_ref.
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
  const envelope = decodeAttachmentEnvelope(input.rawJson);
  if (!envelope) return null;

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
  if (!channel || channel.isPublic) return;
  const member = await StorageService.getGroupMember(
    input.ownerPubky,
    channelId,
    input.senderPubky,
  );
  if (!member || member.status !== 'active') return;

  await storeSecrets(input.ownerPubky, envelope);
  await StorageService.saveAttachment({
    ownerPubky: input.ownerPubky,
    eventId: envelope.event_id,
    conversationId: null,
    channelId,
    senderPubky: input.senderPubky,
    direction: 'received',
    location: envelope.location,
    keyRef: attachmentKeyRef(input.ownerPubky, envelope.event_id),
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
    rawJson: input.rawJson,
    sentAt: envelope.sent_at,
    receivedAt: input.receivedAt,
    deliveryState: 'delivered',
    replyToEventId: null,
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
  if (await StorageService.hasAttachment(input.ownerPubky, envelope.event_id)) {
    return null;
  }

  await storeSecrets(input.ownerPubky, envelope);
  await StorageService.saveAttachment({
    ownerPubky: input.ownerPubky,
    eventId: envelope.event_id,
    conversationId: buildDmConversationId(input.peerPubky),
    channelId: null,
    senderPubky: input.senderPubky,
    direction: 'received',
    location: envelope.location,
    keyRef: attachmentKeyRef(input.ownerPubky, envelope.event_id),
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
    rawJson: input.rawJson,
    body: attachmentPreviewBody(envelope),
    sentAt: envelope.sent_at,
    receivedAt: input.receivedAt,
    deliveryState: 'delivered',
  };
  await StorageService.saveLinkMessage(row);
  return row;
}

async function storeSecrets(ownerPubky: PubkyKey, envelope: ChatAttachmentEnvelope): Promise<void> {
  await KeyStore.setAttachmentSecret(ownerPubky, envelope.event_id, {
    key: envelope.key,
    nonce: envelope.nonce,
    algorithm: envelope.algorithm,
    ...(envelope.thumbnail
      ? { thumbnail: { key: envelope.thumbnail.key, nonce: envelope.thumbnail.nonce } }
      : {}),
  });
}

export function attachmentPreviewBody(
  envelope: Pick<ChatAttachmentEnvelope, 'contentType' | 'size'>,
): string {
  return `[attachment] ${envelope.contentType} (${envelope.size})`;
}
