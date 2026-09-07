import {
  CHAT_DELETE_KIND,
  CHAT_EDIT_KIND,
  CHAT_MESSAGE_KIND,
  CHAT_PIN_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_TAG_KIND,
  CHAT_TYPING_KIND,
  LINK_MESSAGE_MAX_BYTES,
  PUBKY_APP_DM_KIND,
} from '../../types/link';
import { CHAT_ATTACHMENT_KIND } from '../../types/attachment';
import { GROUP_INVITE_KIND, isGroupWireKind, peekEnvelopeKind } from '../../types/group';
import { isPaykitPaymentKind } from '../../types/payment';

export function inboundRawJsonUtf8Bytes(rawJson: string): number {
  return new TextEncoder().encode(rawJson).byteLength;
}

export function isKnownInboundChatKind(kind: string | null): boolean {
  if (!kind) return false;
  return (
    kind === CHAT_MESSAGE_KIND ||
    kind === PUBKY_APP_DM_KIND ||
    kind === CHAT_ATTACHMENT_KIND ||
    kind === CHAT_TAG_KIND ||
    kind === CHAT_RECEIPT_KIND ||
    kind === CHAT_TYPING_KIND ||
    kind === CHAT_EDIT_KIND ||
    kind === CHAT_DELETE_KIND ||
    kind === CHAT_PIN_KIND ||
    kind === GROUP_INVITE_KIND ||
    isPaykitPaymentKind(kind) ||
    isGroupWireKind(kind)
  );
}

/**
 * Known chat kinds that exceed {@link LINK_MESSAGE_MAX_BYTES} are consumed
 * (snapshot / seen) but never persisted. Unknown kinds keep the M1 rule:
 * store on the stream, leave unprocessed.
 */
export function shouldDropOversizedKnownInbound(
  rawJson: string,
  kindHint?: string | null,
): boolean {
  const kind = kindHint && kindHint.length > 0 ? kindHint : peekEnvelopeKind(rawJson);
  if (!isKnownInboundChatKind(kind)) return false;
  return inboundRawJsonUtf8Bytes(rawJson) > LINK_MESSAGE_MAX_BYTES;
}
