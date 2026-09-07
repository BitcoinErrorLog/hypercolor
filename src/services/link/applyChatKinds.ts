import { v4 as uuidv4 } from 'uuid';
import type { PubkyKey } from '../../types';
import {
  CHAT_REACTION_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_TAG_KIND,
  buildDmConversationId,
} from '../../types/link';
import { GROUP_REACTION_KIND } from '../../types/group';
import {
  buildChatReceiptEnvelope,
  buildChatTagEnvelope,
  normalizeChatTagLabel,
  parseChatReceiptV0,
  parseChatTagV0,
  type ChatKindParseCtx,
  type ChatTagEnvelope,
} from '../../types/chatKindValidation';
import { StorageService } from '../StorageService';
import type { DeliveryQueueItem } from '../../types';

export { parseChatReceiptV0, parseChatTagV0 };

const LINK_RETRY_PAYLOAD_TYPE = 'link.chat.message';

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
    for (const eventId of envelope.event_ids) {
      const author = await resolveReceiptAuthor(
        input.ownerPubky,
        eventId,
        envelope.channel_id,
        input.senderPubky,
      );
      if (!author || author === input.senderPubky) continue;
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

async function resolveReceiptAuthor(
  ownerPubky: PubkyKey,
  eventId: string,
  channelId: string | undefined,
  receiptSender: PubkyKey,
): Promise<string | null> {
  if (channelId) {
    const rows = await StorageService.listGroupMessages(ownerPubky, channelId, 400);
    const hit = rows.find(row => row.eventId === eventId);
    return hit?.senderPubky ?? null;
  }
  const own = await StorageService.getLinkMessageByEventId(ownerPubky, ownerPubky, eventId);
  if (own) return ownerPubky;
  const fromPeer = await StorageService.getLinkMessageByEventId(ownerPubky, receiptSender, eventId);
  return fromPeer?.senderPubky ?? null;
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
    await applyTagEnvelope(ownerPubky, senderPubky, parsed.ok, senderPubky);
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
  await applyTagEnvelope(ownerPubky, senderPubky, alias, senderPubky);
  return 'processed';
}

async function applyTagEnvelope(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: ChatTagEnvelope,
  dmPeerPubky?: PubkyKey,
): Promise<void> {
  if (envelope.channel_id) {
    const member = await StorageService.getGroupMember(
      ownerPubky,
      envelope.channel_id,
      senderPubky,
    );
    if (member?.status !== 'active') return;
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
      return;
    }
    if (target.deleted) return;
  } else {
    const target = await StorageService.getLinkMessageByEventId(
      ownerPubky,
      envelope.target_author_pubky,
      envelope.target_event_id,
    );
    if (!target) return;
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
    return;
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

export function controlRetryPayload(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  eventId: string,
  rawJson: string,
  kind: string,
): Record<string, string> {
  return {
    type: LINK_RETRY_PAYLOAD_TYPE,
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
