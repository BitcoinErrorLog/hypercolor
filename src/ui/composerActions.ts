import { COPY } from '../copy/uxCopy';
import { LINK_MESSAGE_MAX_BYTES } from '../types/link';

export type ComposerSurface = 'dm' | 'private-group' | 'public-topic';

export type ComposerActionId = 'photo' | 'file' | 'request-payment' | 'send-tip' | 'send-tip-list';

export type ComposerActionItem = {
  id: ComposerActionId;
  label: string;
  disabled: boolean;
  reason: string | null;
};

export type ComposerGate = {
  messagingEnabled: boolean;
  inboxClosed: boolean;
  hasTipEndpoints: boolean;
};

export function draftByteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function draftExceedsByteCap(text: string, cap: number = LINK_MESSAGE_MAX_BYTES): boolean {
  return draftByteSize(text) > cap;
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
      disabled: photoReason !== null,
      reason: photoReason,
    },
    {
      id: 'file',
      label: COPY.composerFile,
      disabled: photoReason !== null,
      reason: photoReason,
    },
    {
      id: 'request-payment',
      label: COPY.composerRequestPayment,
      disabled: payReason !== null,
      reason: payReason,
    },
    {
      id: 'send-tip',
      label: COPY.composerSendTip,
      disabled: sendTipReason !== null,
      reason: sendTipReason,
    },
    {
      id: 'send-tip-list',
      label: COPY.composerSendTipList,
      disabled: listReason !== null,
      reason: listReason,
    },
  ];
}
