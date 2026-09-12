jest.mock('../PaykitLinkNative', () => ({
  PaykitLinkNative: {
    putPublic: jest.fn(),
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
  persistPeerChatKindsVFromMarker,
  putChatKindsVReceiverJson,
  drainChatKindsAdvertiseRetry,
  chatKindsAdvertiseRetryPending,
  resetChatKindsUpgradeReplayedForTests,
} from '../chatKindsAdvertisement';
import { CHAT_KINDS_V_KEY, receiverJsonPubkyUrl } from '../../../types/receiverMarker';

const OWNER = 'a'.repeat(52);
const PEER = 'b'.repeat(52);

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedStorage = jest.mocked(StorageService);

describe('chat_kinds_v advertisement RMW', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    resetChatKindsUpgradeReplayedForTests();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('PUTs the GET document plus chat_kinds_v and skips PUT when GET fails', async () => {
    const existing = '{"noisePublicKey":"abc","capabilities":{"privatePayments":true},"keep":true}';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => existing,
    }) as unknown as typeof fetch;
    mockedNative.putPublic.mockResolvedValue(undefined);

    await putChatKindsVReceiverJson('alias', OWNER, 'abc');

    expect(mockedNative.putPublic).toHaveBeenCalledTimes(1);
    const body = mockedNative.putPublic.mock.calls[0]?.[2] as string;
    expect(body).toContain('"keep":true');
    expect(body).toContain(`"${CHAT_KINDS_V_KEY}":1`);
    expect(mockedNative.putPublic.mock.calls[0]?.[1]).toBe(receiverJsonPubkyUrl(OWNER));
    expect(chatKindsAdvertiseRetryPending(OWNER)).toBe(false);

    mockedNative.putPublic.mockClear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => existing,
    }) as unknown as typeof fetch;

    await putChatKindsVReceiverJson('alias', OWNER, 'abc');
    expect(mockedNative.putPublic).not.toHaveBeenCalled();
    expect(chatKindsAdvertiseRetryPending(OWNER)).toBe(true);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => existing,
    }) as unknown as typeof fetch;
    await putChatKindsVReceiverJson('alias', OWNER, 'abc');
    expect(mockedNative.putPublic).toHaveBeenCalledTimes(1);
    expect(chatKindsAdvertiseRetryPending(OWNER)).toBe(false);
  });

  it('skips PUT when a re-GET shows a different noisePublicKey', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '{"noisePublicKey":"abc"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '{"noisePublicKey":"other"}',
      }) as unknown as typeof fetch;
    mockedNative.putPublic.mockResolvedValue(undefined);

    await putChatKindsVReceiverJson('alias', OWNER, 'abc');
    expect(mockedNative.putPublic).not.toHaveBeenCalled();
    expect(chatKindsAdvertiseRetryPending(OWNER)).toBe(false);
    expect(mockedStorage.clearChatKindsAdvertiseRetry).toHaveBeenCalledWith(OWNER);
  });

  it('keeps the published marker usable when the additive PUT fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"noisePublicKey":"abc","keep":true}',
    }) as unknown as typeof fetch;
    mockedNative.putPublic.mockRejectedValue(new Error('network'));

    await expect(putChatKindsVReceiverJson('alias', OWNER, 'abc')).resolves.toBeUndefined();
    expect(chatKindsAdvertiseRetryPending(OWNER)).toBe(true);
  });

  it('does not immediately drain a transient failure before the base delay', async () => {
    const now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"noisePublicKey":"abc","keep":true}',
    }) as unknown as typeof fetch;
    mockedNative.putPublic.mockRejectedValueOnce(new Error('network'));

    await putChatKindsVReceiverJson('alias', OWNER, 'abc');

    expect(mockedStorage.saveChatKindsAdvertiseRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPubky: OWNER,
        sessionAlias: 'alias',
        noisePublicKey: 'abc',
        nextRetryAt: now + 15_000,
      }),
    );
    const retry = {
      ownerPubky: OWNER,
      sessionAlias: 'alias',
      noisePublicKey: 'abc',
      nextRetryAt: now + 15_000,
      attempts: 0,
    };
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue(retry);

    await drainChatKindsAdvertiseRetry(OWNER, 'alias');
    expect(mockedNative.putPublic).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(now + 15_000);
    mockedNative.putPublic.mockResolvedValue(undefined);
    await drainChatKindsAdvertiseRetry(OWNER, 'alias');
    expect(mockedNative.putPublic).toHaveBeenCalledTimes(2);
  });

  it('does not persist 0 over a stored v1 when the HTTP GET fails', async () => {
    mockedStorage.getLink.mockResolvedValue({
      chatKindsV: 1,
    } as never);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    const next = await persistPeerChatKindsVFromMarker(
      OWNER,
      PEER,
      { noisePublicKey: 'n', capabilitiesJson: '{}' },
      async () => undefined,
    );

    expect(next).toBe(1);
    expect(mockedStorage.recordPeerChatKindsV).not.toHaveBeenCalled();
  });

  it('replaces a stale retry alias with the current owner alias', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'stale-alias',
      noisePublicKey: 'abc',
      nextRetryAt: 0,
      attempts: 2,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"noisePublicKey":"abc","keep":true}',
    }) as unknown as typeof fetch;
    mockedNative.putPublic.mockResolvedValue(undefined);

    await drainChatKindsAdvertiseRetry(OWNER, 'current-alias');

    expect(mockedNative.putPublic).toHaveBeenCalledWith(
      'current-alias',
      receiverJsonPubkyUrl(OWNER),
      expect.any(String),
      'https://homeserver.example',
    );
  });

  it('increments transient failures with exponential backoff', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'current-alias',
      noisePublicKey: 'abc',
      nextRetryAt: 0,
      attempts: 2,
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    await drainChatKindsAdvertiseRetry(OWNER, 'current-alias');

    expect(mockedStorage.recordChatKindsAdvertiseRetryFailure).toHaveBeenCalledWith(
      OWNER,
      expect.any(Number),
    );
    expect(mockedStorage.recordChatKindsAdvertiseRetryFailure.mock.calls[0]?.[1]).toBeGreaterThan(
      Date.now() + 59_900,
    );
  });

  it('clears a successful retry', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'current-alias',
      noisePublicKey: 'abc',
      nextRetryAt: 0,
      attempts: 2,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"noisePublicKey":"abc"}',
    }) as unknown as typeof fetch;
    mockedNative.putPublic.mockResolvedValue(undefined);

    await drainChatKindsAdvertiseRetry(OWNER, 'current-alias');

    expect(mockedStorage.clearChatKindsAdvertiseRetry).toHaveBeenCalledWith(OWNER);
  });

  it('clears a retry at the maximum attempt count', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'current-alias',
      noisePublicKey: 'abc',
      nextRetryAt: 0,
      attempts: 9,
    });
    mockedStorage.recordChatKindsAdvertiseRetryFailure.mockResolvedValue(10);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    await drainChatKindsAdvertiseRetry(OWNER, 'current-alias');

    expect(mockedStorage.clearChatKindsAdvertiseRetry).toHaveBeenCalledWith(OWNER);
  });

  it('clears terminal auth failures', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'current-alias',
      noisePublicKey: 'abc',
      nextRetryAt: 0,
      attempts: 2,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"noisePublicKey":"abc"}',
    }) as unknown as typeof fetch;
    mockedNative.putPublic.mockRejectedValue({ code: 'auth', message: 'expired' });

    await drainChatKindsAdvertiseRetry(OWNER, 'current-alias');

    expect(mockedNative.putPublic).toHaveBeenCalledWith(
      'current-alias',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
    expect(mockedStorage.clearChatKindsAdvertiseRetry).toHaveBeenCalledWith(OWNER);
    expect(mockedStorage.recordChatKindsAdvertiseRetryFailure).not.toHaveBeenCalled();
  });

  it('retries an unstructured receiver 404 instead of treating it as terminal', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'current-alias',
      noisePublicKey: 'abc',
      nextRetryAt: 0,
      attempts: 2,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"noisePublicKey":"abc"}',
    }) as unknown as typeof fetch;
    mockedNative.putPublic.mockRejectedValue({ status: 404, message: 'receiver not found' });
    mockedStorage.recordChatKindsAdvertiseRetryFailure.mockResolvedValue(3);

    await drainChatKindsAdvertiseRetry(OWNER, 'current-alias');

    expect(mockedStorage.recordChatKindsAdvertiseRetryFailure).toHaveBeenCalled();
    expect(mockedStorage.clearChatKindsAdvertiseRetry).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid alias', 'invalid_alias'],
    ['consumed alias', 'consumed'],
  ])('clears an explicitly terminal %s error', async (_label, code) => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'current-alias',
      noisePublicKey: 'abc',
      nextRetryAt: 0,
      attempts: 2,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"noisePublicKey":"abc"}',
    }) as unknown as typeof fetch;
    mockedNative.putPublic.mockRejectedValue({ code, message: 'unstructured native failure' });

    await drainChatKindsAdvertiseRetry(OWNER, 'current-alias');

    expect(mockedStorage.clearChatKindsAdvertiseRetry).toHaveBeenCalledWith(OWNER);
    expect(mockedStorage.recordChatKindsAdvertiseRetryFailure).not.toHaveBeenCalled();
  });

  it('does not send a stale alias without a current owner alias', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: OWNER,
      sessionAlias: 'stale-alias',
      noisePublicKey: 'abc',
      nextRetryAt: 0,
      attempts: 2,
    });

    await drainChatKindsAdvertiseRetry(OWNER);

    expect(mockedNative.putPublic).not.toHaveBeenCalled();
    expect(mockedStorage.clearChatKindsAdvertiseRetry).toHaveBeenCalledWith(OWNER);
  });

  it('rejects a retry row owned by another identity without a public PUT', async () => {
    mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
      ownerPubky: PEER,
      sessionAlias: 'foreign-alias',
      noisePublicKey: 'abc',
      nextRetryAt: 0,
      attempts: 2,
    });

    await drainChatKindsAdvertiseRetry(OWNER, 'current-alias');

    expect(mockedNative.putPublic).not.toHaveBeenCalled();
    expect(mockedStorage.clearChatKindsAdvertiseRetry).toHaveBeenCalledWith(OWNER);
  });
});
