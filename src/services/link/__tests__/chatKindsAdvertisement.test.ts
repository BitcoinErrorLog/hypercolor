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

    mockedNative.putPublic.mockClear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => existing,
    }) as unknown as typeof fetch;

    await putChatKindsVReceiverJson('alias', OWNER, 'abc');
    expect(mockedNative.putPublic).not.toHaveBeenCalled();
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
