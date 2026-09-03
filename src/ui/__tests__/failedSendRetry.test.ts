import { StorageService } from '../../services/StorageService';
import { eventIdsWithDeliveryQueue } from '../failedSendRetry';

jest.mock('../../services/StorageService', () => ({
  StorageService: {
    hasQueueItemForMessage: jest.fn(),
  },
}));

describe('eventIdsWithDeliveryQueue', () => {
  it('keeps only event ids that still have a delivery-queue row', async () => {
    jest
      .mocked(StorageService.hasQueueItemForMessage)
      .mockImplementation(async id => id === 'keep');
    await expect(eventIdsWithDeliveryQueue(['keep', 'drop', 'keep', ''])).resolves.toEqual(
      new Set(['keep']),
    );
  });
});
