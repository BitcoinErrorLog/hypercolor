import type { GroupFanoutOutcome } from '../types/group';
import { COPY } from '../copy/uxCopy';
import { shortPubky } from './shortPubky';

export function sentToNofM(sent: number, total: number): string {
  return `Sent to ${sent} of ${total}`;
}

export function sendingNofM(sent: number, total: number): string {
  return `Sending · ${sent} of ${total} sent`;
}

export function notDeliveredBlocked(name: string): string {
  return `Not delivered to ${name} (blocked)`;
}

/**
 * Aggregate label for a private-group fan-out. Derived only from persisted
 * per-recipient outcomes, never from drain order.
 *
 * | State | Label |
 * | all pending, or pending with zero sent | Sending |
 * | mixed sent + pending | Sending · N of M sent |
 * | all sent | Sent |
 * | mixed sent + failed (terminal) | Sent to N of M |
 * | all failed, single blocked | Not delivered to {name} (blocked) |
 * | all failed otherwise | Not delivered |
 */
export function formatGroupFanoutAggregate(
  outcomes: readonly Pick<GroupFanoutOutcome, 'recipientPubky' | 'status' | 'reason'>[],
  names: ReadonlyMap<string, string> = new Map(),
): string {
  const total = outcomes.length;
  const sent = outcomes.filter(row => row.status === 'sent').length;
  const pending = outcomes.some(row => row.status === 'pending');
  if (pending) {
    if (sent === 0) return COPY.sending;
    return sendingNofM(sent, total);
  }
  if (total === 0 || sent === total) return COPY.sent;
  const blockedFailed = outcomes.filter(row => row.status === 'failed' && row.reason === 'blocked');
  if (sent === 0 && blockedFailed.length === 1) {
    const peer = blockedFailed[0]!.recipientPubky;
    return notDeliveredBlocked(names.get(peer) ?? shortPubky(peer));
  }
  if (sent === 0) return COPY.notDelivered;
  return sentToNofM(sent, total);
}

export function groupDeliveryFromOutcomes(
  outcomes: readonly Pick<GroupFanoutOutcome, 'status'>[],
): 'sent' | 'failed' {
  if (outcomes.length === 0) return 'sent';
  if (outcomes.some(row => row.status === 'pending')) return 'sent';
  if (outcomes.every(row => row.status === 'failed')) return 'failed';
  return 'sent';
}
