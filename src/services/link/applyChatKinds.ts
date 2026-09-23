import { v4 as uuidv4 } from 'uuid';
import type { PubkyKey } from '../../types';
import { CHAT_ATTACHMENT_KIND } from '../../types/attachment';
import {
  CHAT_MESSAGE_KIND,
  CHAT_REACTION_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_TAG_KIND,
  buildDmConversationId,
} from '../../types/link';
import { GROUP_REACTION_KIND } from '../../types/group';
import { isPaykitPaymentKind } from '../../types/payment';
import {
  buildChatReceiptEnvelope,
  buildChatTagEnvelope,
  parseChatDeleteV0,
  parseChatReceiptV0,
  parseChatTagV0,
  normalizeChatTagLabel,
  type ChatKindParseCtx,
  type ChatTagEnvelope,
} from '../../types/chatKindValidation';
import { StorageService } from '../StorageService';
import { KeyStore } from '../KeyStore';
import { cachePathsForAttachment, deleteCacheFiles } from '../attachments/fileIo';
import type { DeliveryQueueItem } from '../../types';
import {
  DM_PENDING_TOMBSTONE_QUOTA_PER_SENDER,
  DM_PENDING_TOMBSTONE_TTL_MS,
} from '../../flags/config';

export { parseChatReceiptV0, parseChatTagV0 };

const LINK_CONTROL_PAYLOAD_TYPE = 'link.chat.control';
export type InboundDeleteResult = 'applied' | 'deferred' | 'rejected' | 'unprocessed';

export async function applyInboundTagOrReceipt(input: {
  ownerPubky: PubkyKey;
  senderPubky: PubkyKey;
  rawJson: string;
  peerTrust: 'accepted' | 'gated';
  kindHint: string | null;
}): Promise<'processed' | 'unprocessed'> {
  const ctx: ChatKindParseCtx = {
    senderPubky: input.senderPubky,
    ownerPubky: input.ownerPubky,
    peerTrust: input.peerTrust,
  };
  const kind = input.kindHint;
  if (kind === CHAT_TAG_KIND || kind === CHAT_REACTION_KIND || kind === GROUP_REACTION_KIND) {
    return applyTagish(input.ownerPubky, input.senderPubky, input.rawJson, ctx, kind);
  }
  if (kind === CHAT_RECEIPT_KIND) {
    const parsed = parseChatReceiptV0(input.rawJson, ctx);
    if ('error' in parsed) {
      if (parsed.error === 'unknown-kind' || parsed.error === 'gated-peer') return 'unprocessed';
      return 'processed';
    }
    const envelope = parsed.ok;
    if (envelope.channel_id) {
      const member = await StorageService.getGroupMember(
        input.ownerPubky,
        envelope.channel_id,
        input.senderPubky,
      );
      if (member?.status !== 'active') return 'processed';
    }
    for (const eventId of envelope.event_ids) {
      const author = await resolveReceiptAuthor(
        input.ownerPubky,
        eventId,
        envelope.channel_id,
        input.senderPubky,
      );
      if (!author || author === input.senderPubky) continue;
      const target = envelope.channel_id
        ? await StorageService.getGroupMessage(
            input.ownerPubky,
            envelope.channel_id,
            author,
            eventId,
          )
        : await StorageService.getLinkMessageByEventId(input.ownerPubky, author, eventId);
      if (target?.deleted || target?.deliveryState === 'unsent') continue;
      await StorageService.applyMonotonicDelivery({
        ownerPubky: input.ownerPubky,
        authorPubky: author,
        eventId,
        status: envelope.status,
        ...(envelope.channel_id ? { channelId: envelope.channel_id } : {}),
      });
    }
    return 'processed';
  }
  return 'unprocessed';
}

export async function applyInboundDelete(input: {
  ownerPubky: PubkyKey;
  senderPubky: PubkyKey;
  peerPubky: PubkyKey;
  rawJson: string;
  peerTrust: 'accepted' | 'gated';
}): Promise<InboundDeleteResult> {
  if (input.senderPubky !== input.peerPubky) return 'rejected';
  const parsed = parseChatDeleteV0(input.rawJson, {
    senderPubky: input.senderPubky,
    ownerPubky: input.ownerPubky,
    peerTrust: input.peerTrust,
  });
  if ('error' in parsed) {
    if (parsed.error === 'unknown-kind' || parsed.error === 'gated-peer') return 'unprocessed';
    return 'rejected';
  }
  const target = await StorageService.getLinkMessageByEventId(
    input.ownerPubky,
    input.senderPubky,
    parsed.ok.target_event_id,
  );
  if (!target) {
    const conflictingTarget = await StorageService.getLinkMessageByEventId(
      input.ownerPubky,
      input.ownerPubky,
      parsed.ok.target_event_id,
    );
    if (conflictingTarget) return 'rejected';
    if (
      await StorageService.getPaymentRequestByEventId(
        input.ownerPubky,
        input.senderPubky,
        parsed.ok.target_event_id,
      )
    ) {
      return 'rejected';
    }
    await StorageService.savePendingChatDelete({
      ownerPubky: input.ownerPubky,
      peerPubky: input.peerPubky,
      senderPubky: input.senderPubky,
      targetEventId: parsed.ok.target_event_id,
      deleteEventId: parsed.ok.event_id,
      rawJson: input.rawJson,
      sentAt: parsed.ok.sent_at,
      receivedAt: Date.now(),
      ttlMs: DM_PENDING_TOMBSTONE_TTL_MS,
      quota: DM_PENDING_TOMBSTONE_QUOTA_PER_SENDER,
    });
    return 'deferred';
  }
  if (target.senderPubky !== input.senderPubky) return 'rejected';
  if (isPaykitPaymentKind(target.kind)) return 'rejected';
  const attachment =
    target.kind === CHAT_ATTACHMENT_KIND
      ? await StorageService.getAttachment(input.ownerPubky, input.senderPubky, target.eventId)
      : null;
  const attachmentBinding =
    target.kind === CHAT_ATTACHMENT_KIND
      ? {
          peerPubky: input.peerPubky,
          conversationId:
            attachment?.channelId ||
            attachment?.conversationId ||
            target.conversationId ||
            buildDmConversationId(input.peerPubky),
        }
      : undefined;
  const attachmentKeyService =
    target.kind === CHAT_ATTACHMENT_KIND
      ? KeyStore.attachmentKeyService(
          input.ownerPubky,
          input.senderPubky,
          target.eventId,
          attachmentBinding,
        )
      : undefined;
  const attachmentCachePaths = attachment ? cachePathsForAttachment(attachment) : [];
  const redacted = JSON.stringify({
    kind: target.kind === CHAT_ATTACHMENT_KIND ? CHAT_ATTACHMENT_KIND : CHAT_MESSAGE_KIND,
    event_id: target.eventId,
    sent_at: target.sentAt,
    deleted: true,
  });
  const tombstoned = await StorageService.tombstoneLinkMessage({
    ownerPubky: input.ownerPubky,
    peerPubky: input.peerPubky,
    senderPubky: input.senderPubky,
    eventId: target.eventId,
    redactedRawJson: redacted,
    ...(attachmentKeyService ? { attachmentKeyService } : {}),
    ...(attachment ? { attachmentCachePaths } : {}),
  });
  if (!tombstoned) {
    await StorageService.savePendingChatDelete({
      ownerPubky: input.ownerPubky,
      peerPubky: input.peerPubky,
      senderPubky: input.senderPubky,
      targetEventId: target.eventId,
      deleteEventId: parsed.ok.event_id,
      rawJson: input.rawJson,
      sentAt: parsed.ok.sent_at,
      receivedAt: Date.now(),
      ttlMs: DM_PENDING_TOMBSTONE_TTL_MS,
      quota: DM_PENDING_TOMBSTONE_QUOTA_PER_SENDER,
    });
    return 'deferred';
  }
  if (target.kind === CHAT_ATTACHMENT_KIND) {
    let keyDeleted = false;
    try {
      keyDeleted = await KeyStore.deleteAttachmentSecret(
        input.ownerPubky,
        input.senderPubky,
        target.eventId,
        attachmentBinding,
      );
    } catch {
      keyDeleted = false;
    }
    if (!keyDeleted) {
      await StorageService.journalAttachmentKeyCleanup(input.ownerPubky, attachmentKeyService!);
    } else if (typeof StorageService.completePendingCleanup === 'function') {
      await StorageService.completePendingCleanup(
        input.ownerPubky,
        'keystore',
        attachmentKeyService!,
      );
    }
    if (attachment) {
      const paths = cachePathsForAttachment(attachment);
      try {
        await deleteCacheFiles(paths);
        if (typeof StorageService.completePendingCleanup === 'function') {
          for (const path of paths) {
            await StorageService.completePendingCleanup(input.ownerPubky, 'cache', path);
          }
        }
      } catch {
        await StorageService.journalAttachmentCacheCleanup(input.ownerPubky, paths);
      }
    }
  }
  return 'applied';
}

export async function applyPendingChatDeletesForTarget(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  senderPubky: PubkyKey;
  targetEventId: string;
}): Promise<void> {
  const pending = await StorageService.listPendingChatDeletes(
    input.ownerPubky,
    input.peerPubky,
    input.senderPubky,
    input.targetEventId,
  );
  for (const item of pending) {
    const result = await applyInboundDelete({
      ...input,
      rawJson: item.rawJson,
      peerTrust: 'accepted',
    });
    if (result !== 'deferred') {
      await StorageService.deletePendingChatDelete(
        input.ownerPubky,
        input.peerPubky,
        input.senderPubky,
        input.targetEventId,
        item.deleteEventId,
      );
    }
  }
}

async function resolveReceiptAuthor(
  ownerPubky: PubkyKey,
  eventId: string,
  channelId: string | undefined,
  receiptSender: PubkyKey,
): Promise<string | null> {
  if (channelId) {
    const member = await StorageService.getGroupMember(ownerPubky, channelId, receiptSender);
    if (member?.status !== 'active') return null;
    const rows = await StorageService.listGroupMessages(ownerPubky, channelId, 400);
    const hit = rows.find(row => row.eventId === eventId);
    return hit?.senderPubky ?? null;
  }
  const expected = buildDmConversationId(receiptSender);
  const own = await StorageService.getLinkMessageByEventId(ownerPubky, ownerPubky, eventId);
  if (own?.conversationId === expected) return ownerPubky;
  const fromPeer = await StorageService.getLinkMessageByEventId(ownerPubky, receiptSender, eventId);
  if (fromPeer?.conversationId === expected) return fromPeer.senderPubky ?? null;
  return null;
}

async function applyTagish(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  rawJson: string,
  ctx: ChatKindParseCtx,
  kind: string,
): Promise<'processed' | 'unprocessed'> {
  if (kind === CHAT_TAG_KIND) {
    const parsed = parseChatTagV0(rawJson, ctx);
    if ('error' in parsed) {
      if (parsed.error === 'unknown-kind' || parsed.error === 'gated-peer') return 'unprocessed';
      return 'processed';
    }
    const tagResult = await applyTagEnvelope(ownerPubky, senderPubky, parsed.ok, senderPubky);
    if (tagResult === 'deferred') return 'unprocessed';
    return 'processed';
  }

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    return 'processed';
  }
  const emoji = typeof value.emoji === 'string' ? value.emoji : null;
  const label = emoji ? normalizeChatTagLabel(emoji) : null;
  const targetEventId = typeof value.target_event_id === 'string' ? value.target_event_id : null;
  const targetAuthor =
    typeof value.target_author_pubky === 'string' ? value.target_author_pubky : null;
  const channelId = typeof value.channel_id === 'string' ? value.channel_id : undefined;
  const sentAt = typeof value.sent_at === 'number' ? value.sent_at : Date.now();
  if (!label || !targetEventId || !targetAuthor) {
    return 'processed';
  }
  const alias: ChatTagEnvelope = {
    version: 1,
    kind: CHAT_TAG_KIND,
    event_id: typeof value.event_id === 'string' ? value.event_id : uuidv4(),
    sent_at: sentAt,
    target_event_id: targetEventId,
    target_author_pubky: targetAuthor,
    label,
    op: 'add',
    ...(channelId ? { channel_id: channelId } : {}),
  };
  const tagResult = await applyTagEnvelope(ownerPubky, senderPubky, alias, senderPubky);
  return tagResult === 'deferred' ? 'unprocessed' : 'processed';
}

type TagApplyResult = 'applied' | 'deferred' | 'rejected';

async function applyTagEnvelope(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: ChatTagEnvelope,
  dmPeerPubky?: PubkyKey,
): Promise<TagApplyResult> {
  if (envelope.channel_id) {
    const member = await StorageService.getGroupMember(
      ownerPubky,
      envelope.channel_id,
      senderPubky,
    );
    if (member?.status !== 'active') return 'rejected';
    const target = await StorageService.getGroupMessage(
      ownerPubky,
      envelope.channel_id,
      envelope.target_author_pubky,
      envelope.target_event_id,
    );
    if (!target) {
      await StorageService.saveGroupDeferred({
        ownerPubky,
        channelId: envelope.channel_id,
        senderPubky,
        eventId: envelope.event_id,
        kind: CHAT_TAG_KIND,
        body: envelope.label,
        rawJson: JSON.stringify(envelope),
        sentAt: envelope.sent_at,
        receivedAt: Date.now(),
        targetEventId: envelope.target_event_id,
        targetAuthorPubky: envelope.target_author_pubky,
      });
      return 'applied';
    }
    if (target.deleted) return 'rejected';
  } else {
    const expectedConversation = buildDmConversationId(
      dmPeerPubky ?? (senderPubky === ownerPubky ? envelope.target_author_pubky : senderPubky),
    );
    const target = await StorageService.getLinkMessageByEventId(
      ownerPubky,
      envelope.target_author_pubky,
      envelope.target_event_id,
    );
    if (!target) {
      await StorageService.savePendingChatTag({
        ownerPubky,
        peerPubky: dmPeerPubky ?? senderPubky,
        senderPubky,
        targetEventId: envelope.target_event_id,
        tagEventId: envelope.event_id,
        rawJson: JSON.stringify(envelope),
        sentAt: envelope.sent_at,
        receivedAt: Date.now(),
        ttlMs: DM_PENDING_TOMBSTONE_TTL_MS,
        quota: DM_PENDING_TOMBSTONE_QUOTA_PER_SENDER,
      });
      return 'applied';
    }
    if (target.deleted) return 'rejected';
    if (target.conversationId !== expectedConversation) return 'rejected';
  }

  const conversationId = envelope.channel_id
    ? null
    : buildDmConversationId(
        dmPeerPubky ?? (senderPubky === ownerPubky ? envelope.target_author_pubky : senderPubky),
      );
  const scopeConversation = envelope.channel_id ? null : conversationId;

  if (envelope.op === 'remove') {
    await StorageService.deleteChatTag({
      ownerPubky,
      scopeKey: envelope.channel_id ?? scopeConversation ?? buildDmConversationId(senderPubky),
      targetEventId: envelope.target_event_id,
      targetAuthorPubky: envelope.target_author_pubky,
      taggerPubky: senderPubky,
      label: envelope.label,
    });
    return 'applied';
  }
  await StorageService.upsertChatTag({
    ownerPubky,
    conversationId: scopeConversation,
    channelId: envelope.channel_id ?? null,
    targetEventId: envelope.target_event_id,
    targetAuthorPubky: envelope.target_author_pubky,
    taggerPubky: senderPubky,
    label: envelope.label,
    createdAt: envelope.sent_at,
  });
  return 'applied';
}

export async function applyLocalTag(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: ChatTagEnvelope,
  dmPeerPubky?: PubkyKey,
): Promise<void> {
  await applyTagEnvelope(ownerPubky, senderPubky, envelope, dmPeerPubky);
}

export async function applyDeferredChatTag(event: {
  ownerPubky: PubkyKey;
  senderPubky: PubkyKey;
  rawJson: string;
}): Promise<void> {
  const parsed = parseChatTagV0(event.rawJson, {
    senderPubky: event.senderPubky,
    ownerPubky: event.ownerPubky,
    peerTrust: 'accepted',
  });
  if ('error' in parsed) return;
  await applyTagEnvelope(event.ownerPubky, event.senderPubky, parsed.ok);
}

export async function applyPendingChatTagsForTarget(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  senderPubky: PubkyKey;
  targetEventId: string;
}): Promise<void> {
  const pending = await StorageService.listPendingChatTags(
    input.ownerPubky,
    input.peerPubky,
    input.senderPubky,
    input.targetEventId,
  );
  for (const item of pending) {
    const parsed = parseChatTagV0(item.rawJson, {
      senderPubky: input.senderPubky,
      ownerPubky: input.ownerPubky,
      peerTrust: 'accepted',
    });
    if ('error' in parsed) {
      await StorageService.deletePendingChatTag(
        input.ownerPubky,
        input.peerPubky,
        input.senderPubky,
        input.targetEventId,
        item.tagEventId,
      );
      continue;
    }
    await applyTagEnvelope(input.ownerPubky, input.senderPubky, parsed.ok, input.peerPubky);
    await StorageService.deletePendingChatTag(
      input.ownerPubky,
      input.peerPubky,
      input.senderPubky,
      input.targetEventId,
      item.tagEventId,
    );
  }
}

export function controlRetryPayload(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  eventId: string,
  rawJson: string,
  kind: string,
): Record<string, string> {
  return {
    type: LINK_CONTROL_PAYLOAD_TYPE,
    ownerPubky,
    peerPubky,
    senderPubky: ownerPubky,
    kind,
    eventId,
    rawJson,
  };
}

export function buildOutboundTag(input: {
  targetEventId: string;
  targetAuthorPubky: string;
  label: string;
  op: 'add' | 'remove';
  channelId?: string;
}): { eventId: string; json: string; sentAt: number; envelope: ChatTagEnvelope } {
  const eventId = uuidv4();
  const sentAt = Date.now();
  const built = buildChatTagEnvelope({
    eventId,
    sentAt,
    targetEventId: input.targetEventId,
    targetAuthorPubky: input.targetAuthorPubky,
    label: input.label,
    op: input.op,
    ...(input.channelId ? { channelId: input.channelId } : {}),
  });
  return { eventId, json: built.json, sentAt, envelope: built.envelope };
}

export function buildOutboundReceipt(input: {
  status: 'delivered' | 'read';
  eventIds: string[];
  channelId?: string;
}): { eventId: string; json: string; sentAt: number } {
  const eventId = uuidv4();
  const sentAt = Date.now();
  const built = buildChatReceiptEnvelope({
    eventId,
    sentAt,
    status: input.status,
    eventIds: input.eventIds,
    ...(input.channelId ? { channelId: input.channelId } : {}),
  });
  return { eventId, json: built.json, sentAt };
}

export function queueItemForPeer(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  eventId: string,
  rawJson: string,
  kind: string,
  channelId?: string,
): DeliveryQueueItem {
  const ts = Date.now();
  const payload = channelId
    ? {
        type: 'link.group.fanout',
        ownerPubky,
        peerPubky,
        senderPubky: ownerPubky,
        kind,
        eventId,
        channelId,
        rawJson,
      }
    : controlRetryPayload(ownerPubky, peerPubky, eventId, rawJson, kind);
  return {
    id: uuidv4(),
    messageId: eventId,
    recipientPubky: peerPubky,
    payload: JSON.stringify(payload),
    attempts: 0,
    nextRetryAt: ts,
    createdAt: ts,
  };
}
