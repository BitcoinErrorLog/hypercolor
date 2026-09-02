import { StorageService } from './StorageService';
import { Telemetry } from './Telemetry';
import type { DeliveryQueueItem } from '../types';

/**
 * RetryQueue — persistent exponential-backoff retry queue for Pubky outbox
 * deliveries.
 *
 * Items survive app restarts because they live in SQLite. The queue is
 * drained by LinkService.drainRetries (and after syncInbox).
 *
 * Backoff schedule (capped at 30 minutes):
 *   attempt 1 → 30 s
 *   attempt 2 → 1 min
 *   attempt 3 → 2 min
 *   attempt 4 → 4 min
 *   attempt N → min(2^N × 15 s, 1800 s)
 */

const MAX_ATTEMPTS = 10;

function nextRetryMs(attempts: number): number {
  const delayMs = Math.min(15_000 * Math.pow(2, attempts), 30 * 60 * 1000);
  return Date.now() + delayMs;
}

export const RetryQueue = {
  /**
   * True when one more failure would permanently drop the item. Callers that
   * must write a terminal outcome in the same transaction as the dequeue
   * consult this instead of `recordFailure`.
   */
  wouldDrop(currentAttempts: number): boolean {
    return currentAttempts + 1 >= MAX_ATTEMPTS;
  },
  /**
   * The backoff schedule above, as a timestamp, for callers that schedule
   * their own periodic work against the same curve instead of standing up a
   * second cadence. Used by the Encrypted-Link handshake stepper.
   */
  nextAttemptAt(attempts: number): number {
    return nextRetryMs(attempts);
  },

  /**
   * Adds a delivery item to the persistent queue.
   */
  async enqueue(
    item: Omit<DeliveryQueueItem, 'attempts' | 'nextRetryAt' | 'createdAt'>,
  ): Promise<void> {
    const now = Date.now();
    await StorageService.enqueue({
      ...item,
      attempts: 0,
      nextRetryAt: now, // eligible immediately on first try
      createdAt: now,
    });
  },

  /**
   * Returns up to `limit` items that are due for retry right now.
   */
  async getDue(limit = 10): Promise<DeliveryQueueItem[]> {
    return StorageService.dequeue(limit);
  },

  /**
   * Records a failed attempt and schedules the next retry.
   * Removes the item permanently if max attempts exceeded.
   * Returns `true` when the item was permanently dropped.
   */
  async recordFailure(id: string, currentAttempts: number): Promise<boolean> {
    if (currentAttempts + 1 >= MAX_ATTEMPTS) {
      await StorageService.removeFromQueue(id);
      Telemetry.record('delivery_failed_permanent');
      return true;
    }
    await StorageService.incrementAttempt(id, nextRetryMs(currentAttempts + 1));
    return false;
  },

  /**
   * Reschedules `next_retry_at` WITHOUT incrementing attempts. Use when the
   * link is not ready (still handshaking / peer offline) so a drain does not
   * burn a retry. `recordFailure` is reserved for actual send failures.
   */
  async defer(id: string, currentAttempts: number): Promise<void> {
    await StorageService.deferQueueItem(id, nextRetryMs(currentAttempts));
  },

  /**
   * Removes an item from the queue after successful delivery.
   */
  async recordSuccess(id: string): Promise<void> {
    await StorageService.removeFromQueue(id);
  },
};
