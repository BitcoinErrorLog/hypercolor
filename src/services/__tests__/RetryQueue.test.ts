import { RetryQueue } from '../RetryQueue';
import { StorageService } from '../StorageService';
import { Telemetry } from '../Telemetry';
import type { DeliveryQueueItem } from '../../types';

jest.mock('../StorageService', () => ({
  StorageService: {
    enqueue: jest.fn(),
    dequeue: jest.fn(),
    removeFromQueue: jest.fn(),
    incrementAttempt: jest.fn(),
    deferQueueItem: jest.fn(),
  },
}));

jest.mock('../Telemetry', () => ({
  Telemetry: {
    record: jest.fn(),
  },
}));

const mockedStorage = jest.mocked(StorageService);
const mockedTelemetry = jest.mocked(Telemetry);

const NOW = 1_700_000_000_000;

describe('RetryQueue', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('enqueue', () => {
    it('persists the item with zero attempts, immediately eligible', async () => {
      await RetryQueue.enqueue({
        id: 'q1',
        messageId: 'm1',
        recipientPubky: 'peer-a',
        payload: 'cipher',
      } as Omit<DeliveryQueueItem, 'attempts' | 'nextRetryAt' | 'createdAt'>);

      expect(mockedStorage.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'q1',
          attempts: 0,
          nextRetryAt: NOW,
          createdAt: NOW,
        }),
      );
    });
  });

  describe('getDue', () => {
    it('delegates to storage with the default limit of 10', async () => {
      const due = [{ id: 'q1' } as DeliveryQueueItem];
      mockedStorage.dequeue.mockResolvedValue(due);

      await expect(RetryQueue.getDue()).resolves.toBe(due);
      expect(mockedStorage.dequeue).toHaveBeenCalledWith(10);
    });

    it('passes an explicit limit through', async () => {
      mockedStorage.dequeue.mockResolvedValue([]);
      await RetryQueue.getDue(3);
      expect(mockedStorage.dequeue).toHaveBeenCalledWith(3);
    });
  });

  describe('recordFailure backoff schedule', () => {
    it('schedules the first retry 30 seconds out', async () => {
      await RetryQueue.recordFailure('q1', 0);

      expect(mockedStorage.incrementAttempt).toHaveBeenCalledWith('q1', NOW + 30_000);
      expect(mockedStorage.removeFromQueue).not.toHaveBeenCalled();
    });

    it('doubles the delay per attempt (attempt 3 -> 2 minutes)', async () => {
      await RetryQueue.recordFailure('q1', 2);

      expect(mockedStorage.incrementAttempt).toHaveBeenCalledWith('q1', NOW + 120_000);
    });

    it('caps the delay at 30 minutes', async () => {
      await RetryQueue.recordFailure('q1', 8);

      expect(mockedStorage.incrementAttempt).toHaveBeenCalledWith('q1', NOW + 1_800_000);
    });

    it('drops the item permanently after the 10th attempt and records telemetry', async () => {
      await expect(RetryQueue.recordFailure('q1', 9)).resolves.toBe(true);

      expect(mockedStorage.removeFromQueue).toHaveBeenCalledWith('q1');
      expect(mockedStorage.incrementAttempt).not.toHaveBeenCalled();
      expect(mockedTelemetry.record).toHaveBeenCalledWith('delivery_failed_permanent');
    });

    it('returns false when the item is rescheduled', async () => {
      await expect(RetryQueue.recordFailure('q1', 0)).resolves.toBe(false);
    });
  });

  describe('wouldDrop', () => {
    it('is true only when one more failure would permanently drop the item', () => {
      expect(RetryQueue.wouldDrop(8)).toBe(false);
      expect(RetryQueue.wouldDrop(9)).toBe(true);
    });
  });

  describe('defer', () => {
    it('reschedules next_retry_at without incrementing attempts', async () => {
      await RetryQueue.defer('q1', 2);

      expect(mockedStorage.deferQueueItem).toHaveBeenCalledWith('q1', NOW + 60_000);
      expect(mockedStorage.incrementAttempt).not.toHaveBeenCalled();
      expect(mockedStorage.removeFromQueue).not.toHaveBeenCalled();
    });
  });

  describe('recordSuccess', () => {
    it('removes the item from the queue', async () => {
      await RetryQueue.recordSuccess('q1');

      expect(mockedStorage.removeFromQueue).toHaveBeenCalledWith('q1');
    });
  });
});
