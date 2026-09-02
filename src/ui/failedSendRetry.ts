import { StorageService } from '../services/StorageService';

/** Event ids whose delivery_queue row is still present and can actually retry. */
export async function eventIdsWithDeliveryQueue(eventIds: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(eventIds.filter(id => id.length > 0))];
  const entries = await Promise.all(
    unique.map(async id => [id, await StorageService.hasQueueItemForMessage(id)] as const),
  );
  return new Set(entries.filter(([, queued]) => queued).map(([id]) => id));
}
