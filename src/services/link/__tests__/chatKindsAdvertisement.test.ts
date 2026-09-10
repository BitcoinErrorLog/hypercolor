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
  },
}));

import { PaykitLinkNative } from '../PaykitLinkNative';
import { StorageService } from '../../StorageService';
import {
  persistPeerChatKindsVFromMarker,
  putChatKindsVReceiverJson,
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
    expect(chatKindsAdvertiseRetryPending(OWNER)).toBe(true);
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
});
