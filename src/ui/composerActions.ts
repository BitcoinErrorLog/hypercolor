import type { IconName } from './primitives';
import { COPY } from '../copy/uxCopy';
import { buildChatMessageEnvelope, LINK_MESSAGE_MAX_BYTES } from '../types/link';
import { buildGroupMessageEnvelope, buildPublicChannelMessageDocument } from '../types/group';

export type ComposerSurface = 'dm' | 'private-group' | 'public-topic';

export type ComposerActionId = 'photo' | 'file' | 'request-payment' | 'send-tip' | 'send-tip-list';

export type ComposerActionItem = {
  id: ComposerActionId;
  label: string;
  icon: IconName;
  disabled: boolean;
  reason: string | null;
};

export type ComposerGate = {
  messagingEnabled: boolean;
  inboxClosed: boolean;
  hasTipEndpoints: boolean;
};

export type DraftEnvelopeContext = {
  surface: ComposerSurface;
  channelId?: string;
  authorPubky?: string;
  replyToEventId?: string;
  replyToAuthorPubky?: string;
};

const PROBE_EVENT_ID = '00000000-0000-4000-8000-000000000000';
const PROBE_SENT_AT = 1_700_000_000_000;
const PROBE_PUBKY = 'y'.repeat(52);

const ACTION_ICONS: Record<ComposerActionId, IconName> = {
  photo: 'image-outline',
  file: 'document-text-outline',
  'request-payment': 'card-outline',
  'send-tip': 'arrow-up-circle-outline',
  'send-tip-list': 'list-outline',
};

function optionalReplyFields(ctx: DraftEnvelopeContext): {
  replyTo?: string;
  replyToAuthor?: string;
} {
  const extra: { replyTo?: string; replyToAuthor?: string } = {};
  if (ctx.replyToEventId) extra.replyTo = ctx.replyToEventId;
  if (ctx.replyToAuthorPubky) extra.replyToAuthor = ctx.replyToAuthorPubky;
  return extra;
}

function serializeDraft(body: string, ctx: DraftEnvelopeContext): number {
  if (ctx.surface === 'dm') {
    return buildChatMessageEnvelope({
      eventId: PROBE_EVENT_ID,
      sentAt: PROBE_SENT_AT,
      body,
    }).byteSize;
  }
  if (ctx.surface === 'public-topic') {
    return buildPublicChannelMessageDocument({
      channelId: ctx.channelId ?? 'public-probe',
      eventId: PROBE_EVENT_ID,
      sentAt: PROBE_SENT_AT,
      body,
      author: ctx.authorPubky && ctx.authorPubky.length === 52 ? ctx.authorPubky : PROBE_PUBKY,
      ...optionalReplyFields(ctx),
    }).byteSize;
  }
  return buildGroupMessageEnvelope({
    channelId: ctx.channelId ?? 'group-probe',
    eventId: PROBE_EVENT_ID,
    sentAt: PROBE_SENT_AT,
    body,
    ...optionalReplyFields(ctx),
  }).byteSize;
}

/** UTF-8 size of the serialized envelope the send path would emit. */
export function draftEnvelopeByteSize(text: string, ctx: DraftEnvelopeContext): number {
  const body = text.trim();
  if (body.length === 0) return 0;
  try {
    return serializeDraft(body, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('too long')) return LINK_MESSAGE_MAX_BYTES + 1;
    throw err;
  }
}

export function draftExceedsByteCap(text: string, ctx: DraftEnvelopeContext): boolean {
  return draftEnvelopeByteSize(text, ctx) > LINK_MESSAGE_MAX_BYTES;
}

function messagingReason(gate: ComposerGate): string | null {
  if (!gate.messagingEnabled) return COPY.enableMessagingReason;
  if (gate.inboxClosed) return COPY.inboxClosed;
  return null;
}

function attachReason(surface: ComposerSurface, gate: ComposerGate): string | null {
  const messaging = messagingReason(gate);
  if (messaging) return messaging;
  if (surface === 'public-topic') return COPY.attachmentsPublicUnsupported;
  return null;
}

function paymentReason(surface: ComposerSurface, gate: ComposerGate): string | null {
  if (surface !== 'dm') return COPY.paymentsDmOnly;
  return messagingReason(gate);
}

function tipReason(surface: ComposerSurface, gate: ComposerGate): string | null {
  const payment = paymentReason(surface, gate);
  if (payment) return payment;
  if (!gate.hasTipEndpoints) return COPY.noTipDestinations;
  return null;
}

/** Every implemented composer action, in contract order, with disabled reasons. */
export function composerActionItems(
  surface: ComposerSurface,
  gate: ComposerGate,
): ComposerActionItem[] {
  const photoReason = attachReason(surface, gate);
  const payReason = paymentReason(surface, gate);
  const sendTipReason = tipReason(surface, gate);
  const listReason = paymentReason(surface, gate);
  return [
    {
      id: 'photo',
      label: COPY.composerPhoto,
      icon: ACTION_ICONS.photo,
      disabled: photoReason !== null,
      reason: photoReason,
    },
    {
      id: 'file',
      label: COPY.composerFile,
      icon: ACTION_ICONS.file,
      disabled: photoReason !== null,
      reason: photoReason,
    },
    {
      id: 'request-payment',
      label: COPY.composerRequestPayment,
      icon: ACTION_ICONS['request-payment'],
      disabled: payReason !== null,
      reason: payReason,
    },
    {
      id: 'send-tip',
      label: COPY.composerSendTip,
      icon: ACTION_ICONS['send-tip'],
      disabled: sendTipReason !== null,
      reason: sendTipReason,
    },
    {
      id: 'send-tip-list',
      label: COPY.composerSendTipList,
      icon: ACTION_ICONS['send-tip-list'],
      disabled: listReason !== null,
      reason: listReason,
    },
  ];
}
