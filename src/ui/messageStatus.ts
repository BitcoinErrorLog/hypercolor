import type { LinkDeliveryState, LinkStatus } from '../types/link';
import { COPY } from '../copy/uxCopy';

export type OutboundStatusWord =
  | typeof COPY.queued
  | typeof COPY.sent
  | typeof COPY.failed
  | typeof COPY.inboxClosed
  | typeof COPY.offline
  | typeof COPY.needsEnable
  | typeof COPY.connectionChangedRetry
  | typeof COPY.reconnectUnavailable
  | typeof COPY.restoring
  | typeof COPY.delivered
  | typeof COPY.read;

/**
 * Outbound bubble status. Receipts drive Delivered and Read.
 */
export function formatDeliveryState(
  state: LinkDeliveryState | string,
  receiptsEnabled = true,
): OutboundStatusWord {
  if (!receiptsEnabled && (state === 'delivered' || state === 'read')) {
    return COPY.sent;
  }
  switch (state) {
    case 'sending':
      return COPY.queued;
    case 'failed':
      return COPY.failed;
    case 'delivered':
      return COPY.delivered;
    case 'read':
      return COPY.read;
    case 'sent':
      return COPY.sent;
    default:
      return COPY.sent;
  }
}

/** Per-peer Encrypted Link status for a thread header. Empty when the link is live. */
export function formatLinkStatus(status: LinkStatus | null | undefined): OutboundStatusWord | null {
  if (!status) return null;
  switch (status) {
    case 'needs-enable':
      return COPY.needsEnable;
    case 'session-offline':
      return COPY.offline;
    case 'not-enrolled':
      return COPY.inboxClosed;
    case 'handshaking-initiator':
    case 'handshaking-responder':
      return COPY.queued;
    case 'error':
      return COPY.connectionChangedRetry;
    case 'reconnect_required':
      return COPY.reconnectUnavailable;
    case 'restoring':
      return COPY.restoring;
    case 'native-missing':
    case 'ready':
    case 'message-request':
      return null;
    default:
      return null;
  }
}
