jest.mock('../PaykitLinkNative', () => ({
  PaykitLinkNative: {
    putPublic: jest.fn(),
    getReceiverMarker: jest.fn(),
  },
}));
jest.mock('../../homeserverOrigin', () => ({
  resolveHomeserverOrigin: async () => 'https://homeserver.example',
}));
jest.mock('../../StorageService', () => ({
  StorageService: {
    getLink: jest.fn(),
    recordPeerChatKindsV: jest.fn(),
    getChatKindsAdvertiseRetry: jest.fn(),
    saveChatKindsAdvertiseRetry: jest.fn(),
    recordChatKindsAdvertiseRetryFailure: jest.fn(),
    clearChatKindsAdvertiseRetry: jest.fn(),
  },
}));

import { PaykitLinkNative } from '../PaykitLinkNative';
import { StorageService } from '../../StorageService';
import {
  drainChatKindsAdvertiseRetry,
  persistPeerChatKindsVFromMarker,
  putChatKindsVReceiverJson,
  resetChatKindsUpgradeReplayedForTests,
} from '../chatKindsAdvertisement';
import { buildCapabilityDocument, capabilityPubkyUrl } from '../../../types/receiverMarker';

const OWNER = 'a'.repeat(52);
const PEER = 'b'.repeat(52);
const marker = { noisePublicKey: 'n'.repeat(52) };
const mockedNative = jest.mocked(PaykitLinkNative);
const mockedStorage = jest.mocked(StorageService);
const response = (status: number, body?: string) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => body ?? '',
});

describe('key-bound capability advertisement', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    resetChatKindsUpgradeReplayedForTests();
    jest.clearAllMocks();
  });

  it('GETs the capability document, validates the marker, and PUTs only the new path', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, buildCapabilityDocument())) as unknown as typeof fetch;
    mockedNative.getReceiverMarker.mockResolvedValue(marker);
    mockedNative.putPublic.mockResolvedValue(undefined);
    await putChatKindsVReceiverJson('alias', OWNER, marker.noisePublicKey);
    expect(mockedNative.putPublic).toHaveBeenCalledWith(
      'alias',
      capabilityPubkyUrl(OWNER, marker.noisePublicKey),
      buildCapabilityDocument(),
      'https://homeserver.example',
    );
  });

  it('retains PUBLISH_UNKNOWN after an ambiguous PUT', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(404)) as unknown as typeof fetch;
    mockedNative.getReceiverMarker.mockResolvedValue(marker);
    mockedNative.putPublic.mockRejectedValue(new Error('timeout'));
    await expect(
      putChatKindsVReceiverJson('alias', OWNER, marker.noisePublicKey),
    ).resolves.toBeUndefined();
    expect(mockedStorage.saveChatKindsAdvertiseRetry).toHaveBeenCalledWith(
      expect.objectContaining({ ownerPubky: OWNER, noisePublicKey: marker.noisePublicKey }),
    );
  });

  it('does not write when the marker key changed', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(404)) as unknown as typeof fetch;
    mockedNative.getReceiverMarker.mockResolvedValue({ noisePublicKey: 'other'.repeat(13) });
    await putChatKindsVReceiverJson('alias', OWNER, marker.noisePublicKey);
    expect(mockedNative.putPublic).not.toHaveBeenCalled();
  });

  it('preserves stored v1 when capability transport fails', async () => {
    mockedStorage.getLink.mockResolvedValue({ chatKindsV: 1 } as never);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(
      persistPeerChatKindsVFromMarker(OWNER, PEER, marker, async () => undefined),
    ).resolves.toBe(1);
    expect(mockedStorage.recordPeerChatKindsV).not.toHaveBeenCalled();
  });

  it('preserves stored v1 when legacy fallback transport fails', async () => {
    mockedStorage.getLink.mockResolvedValue({ chatKindsV: 1 } as never);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(404))
      .mockRejectedValueOnce(new Error('offline')) as unknown as typeof fetch;
    await expect(
      persistPeerChatKindsVFromMarker(OWNER, PEER, marker, async () => undefined),
    ).resolves.toBe(1);
    expect(mockedStorage.recordPeerChatKindsV).not.toHaveBeenCalled();
  });

  it('persists zero when legacy fallback confirms the document is absent', async () => {
    mockedStorage.getLink.mockResolvedValue({ chatKindsV: 1 } as never);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(404)) as unknown as typeof fetch;
    await expect(
      persistPeerChatKindsVFromMarker(OWNER, PEER, marker, async () => undefined),
    ).resolves.toBe(0);
    expect(mockedStorage.recordPeerChatKindsV).toHaveBeenCalledWith(OWNER, PEER, 0);
  });

  it('retains PUBLISH_UNKNOWN when post-PUT reconciliation is unavailable', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(404))
      .mockRejectedValueOnce(new Error('offline')) as unknown as typeof fetch;
    mockedNative.getReceiverMarker.mockResolvedValue(marker);
    mockedNative.putPublic.mockResolvedValue(undefined);
    await putChatKindsVReceiverJson('alias', OWNER, marker.noisePublicKey);
    expect(mockedStorage.saveChatKindsAdvertiseRetry).toHaveBeenCalledWith(
      expect.objectContaining({ ownerPubky: OWNER, noisePublicKey: marker.noisePublicKey }),
    );
    expect(mockedStorage.clearChatKindsAdvertiseRetry).not.toHaveBeenCalled();
  });

  it('retains PUBLISH_UNKNOWN when post-PUT reconciliation is unparseable', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, 'not-json')) as unknown as typeof fetch;
    mockedNative.getReceiverMarker.mockResolvedValue(marker);
    mockedNative.putPublic.mockResolvedValue(undefined);
    await putChatKindsVReceiverJson('alias', OWNER, marker.noisePublicKey);
    expect(mockedStorage.saveChatKindsAdvertiseRetry).toHaveBeenCalledWith(
      expect.objectContaining({ ownerPubky: OWNER, noisePublicKey: marker.noisePublicKey }),
    );
    expect(mockedStorage.clearChatKindsAdvertiseRetry).not.toHaveBeenCalled();
  });

  it('rebounds a retry to the active alias without resetting attempts', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'old',
      noisePublicKey: marker.noisePublicKey,
      nextRetryAt: 0,
      attempts: 2,
    });
    global.fetch = jest
      .fn()
      .mockResolvedValue(response(200, buildCapabilityDocument())) as unknown as typeof fetch;
    await drainChatKindsAdvertiseRetry(OWNER, 'current');
    expect(mockedStorage.saveChatKindsAdvertiseRetry).toHaveBeenCalledWith(
      expect.objectContaining({ sessionAlias: 'current' }),
    );
    expect(mockedStorage.clearChatKindsAdvertiseRetry).toHaveBeenCalledWith(OWNER);
  });

  it('records a transient failure after a bounded capability GET timeout', async () => {
    jest.useFakeTimers();
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'alias',
      noisePublicKey: marker.noisePublicKey,
      nextRetryAt: 0,
      attempts: 0,
    });
    mockedStorage.recordChatKindsAdvertiseRetryFailure.mockResolvedValue(1);
    global.fetch = jest.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;

    const drain = drainChatKindsAdvertiseRetry(OWNER, 'alias');
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(15_000);
    await drain;

    expect(mockedStorage.recordChatKindsAdvertiseRetryFailure).toHaveBeenCalledWith(
      OWNER,
      expect.any(Number),
    );
    const nextRetryAt = mockedStorage.recordChatKindsAdvertiseRetryFailure.mock.calls[0]?.[1];
    expect(nextRetryAt).toBe(Date.now() + 15_000);
    expect(mockedStorage.clearChatKindsAdvertiseRetry).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('clears the retry after an asynchronous capability success without changing marker state', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'alias',
      noisePublicKey: marker.noisePublicKey,
      nextRetryAt: 0,
      attempts: 1,
    });
    global.fetch = jest
      .fn()
      .mockResolvedValue(response(200, buildCapabilityDocument())) as unknown as typeof fetch;

    await drainChatKindsAdvertiseRetry(OWNER, 'alias');

    expect(mockedStorage.clearChatKindsAdvertiseRetry).toHaveBeenCalledWith(OWNER);
    expect(mockedNative.getReceiverMarker).not.toHaveBeenCalled();
    expect(mockedNative.putPublic).not.toHaveBeenCalled();
  });
});
