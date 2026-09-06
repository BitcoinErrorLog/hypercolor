jest.mock('react-native', () => ({
  Linking: {
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
}));

jest.mock('@synonymdev/react-native-pubky', () => ({
  get: jest.fn(),
}));

jest.mock('../../utils/PubkyNoiseModule', () => ({
  x25519GenerateKeypair: jest.fn(),
  sb2VerifySignature: jest.fn(),
  sb2Decrypt: jest.fn(),
}));

const mockGetPendingRingHandoff = jest.fn();
const mockGetPendingRingHandoffExpiresAt = jest.fn();
const mockGetPendingRingHandoffCombined = jest.fn();

jest.mock('../KeyStore', () => ({
  KeyStore: {
    setPendingRingHandoff: jest.fn(),
    getPendingRingHandoff: (...args: unknown[]) => mockGetPendingRingHandoff(...args),
    getPendingRingHandoffExpiresAt: (...args: unknown[]) =>
      mockGetPendingRingHandoffExpiresAt(...args),
    getPendingRingHandoffCombined: (...args: unknown[]) =>
      mockGetPendingRingHandoffCombined(...args),
    clearPendingRingHandoff: jest.fn(),
    setAppKeypair: jest.fn(),
    setAppCert: jest.fn(),
    setInboxKeypair: jest.fn(),
    setTransportKeypair: jest.fn(),
    setPubky: jest.fn(),
    setHomeserver: jest.fn(),
    deleteSessionSecret: jest.fn(),
  },
}));

jest.mock('../link/PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(() => false),
    startAuthFlow: jest.fn(),
    awaitAuthApproval: jest.fn(),
    cancelAuthFlow: jest.fn(),
    stopAuthKeepalive: jest.fn(),
    signOutSession: jest.fn(),
  },
}));

jest.mock('../link/LinkService', () => ({
  LinkService: {
    adoptApprovedSession: jest.fn(),
    provisionReceiverAfterConnect: jest.fn(),
    signOutSessionQuiet: jest.fn(),
    rollbackAdoptedSession: jest.fn(),
  },
}));
import { Linking } from 'react-native';
import { get as rnGet } from '@synonymdev/react-native-pubky';
import {
  x25519GenerateKeypair,
  sb2Decrypt,
  sb2VerifySignature,
} from '../../utils/PubkyNoiseModule';
import { KeyStore } from '../KeyStore';
import {
  buildPaykitConnectUrl,
  cancelPendingDelegation,
  certFromHandoffAppKey,
  getPendingDelegationSnapshot,
  handleRingCallback,
  requestDelegation,
  resolvePendingEphemeralSk,
  parsePubkyauthAuthorizationUrl,
  parseQueryParams,
  ExpiredDelegationError,
  StaleDelegationRequestError,
  BindingMismatchError,
  ProvisionReceiverFailedError,
  CombinedFlowRestartRequiredError,
  UpdatePubkyRingError,
  isExpiredDelegationError,
  COMBINED_HANDOFF_MODE,
} from '../PubkyRingAuthService';
import { RING_GRANT_CAPABILITIES } from '../../types/link';
import { pubkyZ32ToHex } from '../../utils/pubkyId';
import { ENABLE_AUTH_TTL_MS } from '../../copy/uxCopy';
import { PaykitLinkNative } from '../link/PaykitLinkNative';
import { LinkService } from '../link/LinkService';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(pred: () => boolean, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (pred()) return;
    await Promise.resolve();
  }
  throw new Error('timed out waiting for condition');
}

/** Attach a rejection handler immediately so Node 24 does not crash on unhandledRejection. */
function started<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

let mockPersistedHandoffSk: string | null = null;
let mockPersistedHandoffExpiresAt: number | null = null;
let mockPersistedHandoffCombined = false;

beforeEach(() => {
  mockPersistedHandoffSk = null;
  mockPersistedHandoffExpiresAt = null;
  mockPersistedHandoffCombined = false;
  mockGetPendingRingHandoff.mockImplementation(async () => mockPersistedHandoffSk);
  mockGetPendingRingHandoffExpiresAt.mockImplementation(async () => mockPersistedHandoffExpiresAt);
  mockGetPendingRingHandoffCombined.mockImplementation(async () => mockPersistedHandoffCombined);
  jest
    .mocked(KeyStore.setPendingRingHandoff)
    .mockImplementation(async (sk: string, expiresAt: number, opts?: { combined?: boolean }) => {
      mockPersistedHandoffSk = sk;
      mockPersistedHandoffExpiresAt = expiresAt;
      mockPersistedHandoffCombined = opts?.combined === true;
    });
  jest.mocked(KeyStore.clearPendingRingHandoff).mockImplementation(async () => {
    mockPersistedHandoffSk = null;
    mockPersistedHandoffExpiresAt = null;
    mockPersistedHandoffCombined = false;
  });
});

describe('PubkyRingAuthService AppCert', () => {
  it('does not copy the 5-minute handoff TTL onto the AppCert', () => {
    const cert = certFromHandoffAppKey({
      ed25519_sk: 'sk',
      ed25519_pk: 'pk',
      cert_id: 'id',
      cert_body: 'body',
      cert_sig: 'sig',
    });
    expect(cert).toEqual({
      certBodyHex: 'body',
      sigHex: 'sig',
      certIdHex: 'id',
    });
    expect(cert).not.toHaveProperty('expiresAt');
  });
});

describe('resolvePendingEphemeralSk', () => {
  it('reads the Keychain-persisted SK after process death', async () => {
    mockGetPendingRingHandoff.mockResolvedValue('persisted-sk');
    await expect(resolvePendingEphemeralSk()).resolves.toBe('persisted-sk');
  });
});

describe('requestDelegation', () => {
  const deviceId = 'hypercolor-sim';
  const ephemeralPk = 'aabbcc';
  const authSecret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const authRelay = 'https://httprelay.pubky.app/link/';

  function authUrl(): string {
    return (
      `pubkyauth:///?caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}` +
      `&secret=${authSecret}` +
      `&relay=${encodeURIComponent(authRelay)}`
    );
  }

  function expectedConnectUrl(id: string, pk: string): string {
    return buildPaykitConnectUrl(id, pk, { secret: authSecret, relay: authRelay });
  }

  beforeEach(async () => {
    await cancelPendingDelegation();
    jest.mocked(KeyStore.clearPendingRingHandoff).mockClear();
    jest.mocked(KeyStore.setPendingRingHandoff).mockClear();
    jest.mocked(PaykitLinkNative.isAvailable).mockReturnValue(true);
    jest.mocked(PaykitLinkNative.startAuthFlow).mockImplementation(async () => ({
      flowId: `flow-req-${Date.now()}-${Math.random()}`,
      authorizationUrl: authUrl(),
    }));
    jest.mocked(PaykitLinkNative.cancelAuthFlow).mockResolvedValue(undefined);
    jest.mocked(PaykitLinkNative.stopAuthKeepalive).mockResolvedValue(undefined);
    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: 'ephemeral-sk',
      publicKey: ephemeralPk,
    });
    (Linking.openURL as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cancelPendingDelegation();
  });

  it('builds a paykit-connect URL with callback, ephemeralPk, and caps', () => {
    const url = buildPaykitConnectUrl(deviceId, ephemeralPk);
    expect(url.startsWith('pubkyring://paykit-connect?')).toBe(true);
    expect(url).toContain(`deviceId=${encodeURIComponent(deviceId)}`);
    expect(url).toContain(`callback=${encodeURIComponent('hypercolor://ring-callback')}`);
    expect(url).toContain(`ephemeralPk=${encodeURIComponent(ephemeralPk)}`);
    expect(url).toContain(`caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}`);
  });

  it('returns { url } and still shows a QR-only path when Ring is not installed', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

    const result = await requestDelegation(deviceId);

    expect(result.url).toBe(expectedConnectUrl(deviceId, ephemeralPk));
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + ENABLE_AUTH_TTL_MS);
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(KeyStore.clearPendingRingHandoff).not.toHaveBeenCalled();
    expect(KeyStore.setPendingRingHandoff).toHaveBeenCalledWith(
      'ephemeral-sk',
      expect.any(Number),
      {
        combined: true,
      },
    );
  });

  it('refuses Connect when Paykit native is missing', async () => {
    jest.mocked(PaykitLinkNative.isAvailable).mockReturnValue(false);
    await expect(requestDelegation(deviceId)).rejects.toThrow(
      'Paykit native module is required for Connect',
    );
    expect(x25519GenerateKeypair).not.toHaveBeenCalled();
  });

  it('opens Ring on this device when it is installed and still returns the URL', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    const result = await requestDelegation(deviceId);

    expect(result.url).toBe(expectedConnectUrl(deviceId, ephemeralPk));
    expect(Linking.openURL).toHaveBeenCalledWith(result.url);
  });

  it('mints a new keypair on every Connect instead of reusing a live URL', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
    (x25519GenerateKeypair as jest.Mock)
      .mockResolvedValueOnce({ secretKey: 'ephemeral-sk-1', publicKey: 'pk-1' })
      .mockResolvedValueOnce({ secretKey: 'ephemeral-sk-2', publicKey: 'pk-2' });
    const first = await requestDelegation(deviceId);
    const second = await requestDelegation('hypercolor-other');
    expect(second.url).not.toBe(first.url);
    expect(second.url).toBe(expectedConnectUrl('hypercolor-other', 'pk-2'));
    expect(x25519GenerateKeypair).toHaveBeenCalledTimes(2);
    expect(KeyStore.setPendingRingHandoff).toHaveBeenLastCalledWith(
      'ephemeral-sk-2',
      expect.any(Number),
      { combined: true },
    );
  });

  it('discards a stale requestDelegation when a newer generation finishes first', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    const firstAuth = deferred<{ flowId: string; authorizationUrl: string }>();
    const secondAuth = deferred<{ flowId: string; authorizationUrl: string }>();
    jest
      .mocked(PaykitLinkNative.startAuthFlow)
      .mockImplementationOnce(() => firstAuth.promise)
      .mockImplementationOnce(() => secondAuth.promise);
    // Newer request leaves startAuthFlow first, so it consumes the first keypair stub.
    (x25519GenerateKeypair as jest.Mock)
      .mockResolvedValueOnce({ secretKey: 'sk-b', publicKey: 'pk-b' })
      .mockResolvedValueOnce({ secretKey: 'sk-a', publicKey: 'pk-a' });

    const first = started(requestDelegation('device-a'));
    await waitUntil(() => jest.mocked(PaykitLinkNative.startAuthFlow).mock.calls.length >= 1);
    const second = started(requestDelegation('device-b'));
    await waitUntil(() => jest.mocked(PaykitLinkNative.startAuthFlow).mock.calls.length >= 2);

    secondAuth.resolve({ flowId: 'flow-b', authorizationUrl: authUrl() });
    const secondResult = await second;
    expect(secondResult.url).toBe(expectedConnectUrl('device-b', 'pk-b'));
    expect(secondResult.generation).toBeGreaterThan(0);
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');
    expect(getPendingDelegationSnapshot()).toEqual(
      expect.objectContaining({
        url: secondResult.url,
        generation: secondResult.generation,
      }),
    );
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenCalledWith(secondResult.url);

    firstAuth.resolve({ flowId: 'flow-a', authorizationUrl: authUrl() });
    await expect(first).rejects.toBeInstanceOf(StaleDelegationRequestError);
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');
    expect(getPendingDelegationSnapshot()?.url).toBe(secondResult.url);
    expect(KeyStore.setPendingRingHandoff).not.toHaveBeenCalledWith('sk-a', expect.any(Number), {
      combined: true,
    });
    expect(Linking.openURL).not.toHaveBeenCalledWith(expectedConnectUrl('device-a', 'pk-a'));
  });

  it('cancel during an in-flight request leaves no KeyStore secret and no _pending', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
    const setGate = deferred<void>();
    const setStarted = deferred<string>();
    jest
      .mocked(KeyStore.setPendingRingHandoff)
      .mockImplementation(async (sk: string, expiresAt: number) => {
        setStarted.resolve(sk);
        await setGate.promise;
        mockPersistedHandoffSk = sk;
        mockPersistedHandoffExpiresAt = expiresAt;
      });

    const pending = requestDelegation(deviceId);
    await setStarted.promise;
    const cancel = cancelPendingDelegation();
    setGate.resolve();
    await expect(pending).rejects.toBeInstanceOf(StaleDelegationRequestError);
    await cancel;

    expect(mockPersistedHandoffSk).toBeNull();
    expect(getPendingDelegationSnapshot()).toBeNull();
    await expect(resolvePendingEphemeralSk()).rejects.toThrow(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  });

  it('cancel then a new request keeps only the newest secret', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
    const setGate = deferred<void>();
    const setStarted = deferred<string>();
    jest
      .mocked(KeyStore.setPendingRingHandoff)
      .mockImplementation(async (sk: string, expiresAt: number) => {
        setStarted.resolve(sk);
        await setGate.promise;
        mockPersistedHandoffSk = sk;
        mockPersistedHandoffExpiresAt = expiresAt;
      });
    (x25519GenerateKeypair as jest.Mock).mockResolvedValueOnce({
      secretKey: 'sk-cancelled',
      publicKey: 'pk-cancelled',
    });

    const cancelled = requestDelegation(deviceId);
    await setStarted.promise;
    const cancel = cancelPendingDelegation();
    setGate.resolve();
    await expect(cancelled).rejects.toBeInstanceOf(StaleDelegationRequestError);
    await cancel;

    jest
      .mocked(KeyStore.setPendingRingHandoff)
      .mockImplementation(async (sk: string, expiresAt: number) => {
        mockPersistedHandoffSk = sk;
        mockPersistedHandoffExpiresAt = expiresAt;
      });
    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: 'sk-newest',
      publicKey: 'pk-newest',
    });
    const newest = await requestDelegation('hypercolor-newest');

    expect(mockPersistedHandoffSk).toBe('sk-newest');
    expect(await resolvePendingEphemeralSk()).toBe('sk-newest');
    expect(getPendingDelegationSnapshot()).toEqual(
      expect.objectContaining({
        url: newest.url,
        generation: newest.generation,
      }),
    );
    expect(KeyStore.setPendingRingHandoff).not.toHaveBeenLastCalledWith('sk-cancelled');
  });

  it('request A, request B, then cancel leaves nothing', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
    const setGate = deferred<void>();
    const setStarted = deferred<string>();
    jest
      .mocked(KeyStore.setPendingRingHandoff)
      .mockImplementation(async (sk: string, expiresAt: number) => {
        setStarted.resolve(sk);
        await setGate.promise;
        mockPersistedHandoffSk = sk;
        mockPersistedHandoffExpiresAt = expiresAt;
      });
    (x25519GenerateKeypair as jest.Mock)
      .mockResolvedValueOnce({ secretKey: 'sk-a', publicKey: 'pk-a' })
      .mockResolvedValueOnce({ secretKey: 'sk-b', publicKey: 'pk-b' });

    const first = requestDelegation('device-a');
    await setStarted.promise;
    const second = requestDelegation('device-b');
    const cancel = cancelPendingDelegation();
    setGate.resolve();
    await expect(first).rejects.toBeInstanceOf(StaleDelegationRequestError);
    await expect(second).rejects.toBeInstanceOf(StaleDelegationRequestError);
    await cancel;

    expect(mockPersistedHandoffSk).toBeNull();
    expect(getPendingDelegationSnapshot()).toBeNull();
    await expect(resolvePendingEphemeralSk()).rejects.toThrow(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  });

  it('surfaces StaleDelegationRequestError when KeyStore get rejects during discard', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
    const setGate = deferred<void>();
    const setStarted = deferred<string>();
    jest
      .mocked(KeyStore.setPendingRingHandoff)
      .mockImplementation(async (sk: string, expiresAt: number) => {
        setStarted.resolve(sk);
        await setGate.promise;
        mockPersistedHandoffSk = sk;
        mockPersistedHandoffExpiresAt = expiresAt;
      });
    mockGetPendingRingHandoff.mockImplementation(async () => {
      throw new Error('keystore unavailable');
    });

    const pending = requestDelegation(deviceId);
    await setStarted.promise;
    const cancel = cancelPendingDelegation();
    setGate.resolve();
    await expect(pending).rejects.toBeInstanceOf(StaleDelegationRequestError);
    await cancel;
    expect(KeyStore.clearPendingRingHandoff).toHaveBeenCalled();
  });
});

const RING_PUBKY_Z32 = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
const RING_HOMESERVER_Z32 = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';
const RING_REQUEST_ID = 'req-handoff-1';
const AUTH_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const AUTH_RELAY = 'https://httprelay.pubky.app/link/';

function pubkyauthUrl(): string {
  return (
    `pubkyauth:///?caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}` +
    `&secret=${AUTH_SECRET}` +
    `&relay=${encodeURIComponent(AUTH_RELAY)}`
  );
}

function ringCallbackUrl(pubky: string, mode: string = COMBINED_HANDOFF_MODE): string {
  return (
    `hypercolor://ring-callback?pubky=${encodeURIComponent(pubky)}` +
    `&request_id=${encodeURIComponent(RING_REQUEST_ID)}` +
    `&mode=${encodeURIComponent(mode)}` +
    `&homeserver=${encodeURIComponent(RING_HOMESERVER_Z32)}`
  );
}

const HANDOFF_PAYLOAD = {
  version: 3,
  pubky: RING_PUBKY_Z32,
  noise_keypairs: [{ epoch: 0, public_key: 'npk', secret_key: 'nsk' }],
  inbox_keypair: { public_key: 'ipk', secret_key: 'isk' },
  app_key: {
    ed25519_sk: 'ask',
    ed25519_pk: 'apk',
    cert_id: 'cid',
    cert_body: 'cbody',
    cert_sig: 'csig',
  },
};

describe('handleRingCallback z32 owner pubky', () => {
  const ephemeralSk = 'ephemeral-sk-hex';

  beforeEach(async () => {
    await cancelPendingDelegation();
    jest.mocked(PaykitLinkNative.isAvailable).mockReturnValue(true);
    jest.mocked(PaykitLinkNative.startAuthFlow).mockResolvedValue({
      flowId: 'flow-z32',
      authorizationUrl: pubkyauthUrl(),
    });
    jest.mocked(PaykitLinkNative.awaitAuthApproval).mockResolvedValue({
      sessionAlias: 'alias-1',
      pubky: RING_PUBKY_Z32,
    });
    jest.mocked(PaykitLinkNative.cancelAuthFlow).mockResolvedValue(undefined);
    jest.mocked(PaykitLinkNative.stopAuthKeepalive).mockResolvedValue(undefined);
    jest.mocked(LinkService.adoptApprovedSession).mockResolvedValue({
      alias: 'alias-1',
      pubky: RING_PUBKY_Z32,
    });
    jest.mocked(LinkService.provisionReceiverAfterConnect).mockResolvedValue({
      pubky: RING_PUBKY_Z32,
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'npk',
      receiverRole: 'active',
    });
    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: ephemeralSk,
      publicKey: 'ephemeral-pk-hex',
    });
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
    await requestDelegation('hypercolor-z32-test');

    (rnGet as jest.Mock).mockResolvedValue({
      isOk: () => true,
      value: JSON.stringify({ sb2: 'envelope-b64' }),
    });
    (sb2VerifySignature as jest.Mock).mockResolvedValue(true);
    (sb2Decrypt as jest.Mock).mockResolvedValue({
      plaintext: Buffer.from(JSON.stringify(HANDOFF_PAYLOAD), 'utf8').toString('hex'),
    });
  });

  afterEach(async () => {
    jest.mocked(PaykitLinkNative.isAvailable).mockReturnValue(false);
    await cancelPendingDelegation();
  });

  it('converts the callback z32 pubky to hex before SB2 verify/decrypt', async () => {
    const ownerPeeridHex = pubkyZ32ToHex(RING_PUBKY_Z32);
    const storagePath = `/pub/paykit.app/v0/handoff/${RING_REQUEST_ID}`;

    const result = await handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));

    expect(ownerPeeridHex).toHaveLength(64);
    expect(ownerPeeridHex).toMatch(/^[0-9a-f]+$/);
    expect(sb2VerifySignature).toHaveBeenCalledWith('envelope-b64', ownerPeeridHex, storagePath);
    expect(sb2Decrypt).toHaveBeenCalledWith(
      'envelope-b64',
      ephemeralSk,
      ownerPeeridHex,
      storagePath,
    );
    expect(rnGet).toHaveBeenCalledWith(
      `pubky://${RING_PUBKY_Z32}/pub/paykit.app/v0/handoff/${RING_REQUEST_ID}`,
    );
    expect(KeyStore.setPubky).toHaveBeenCalledWith(RING_PUBKY_Z32);
    expect(KeyStore.setHomeserver).toHaveBeenCalledWith(RING_HOMESERVER_Z32);
    expect(result).toEqual({
      pubky: RING_PUBKY_Z32,
      homeserver: RING_HOMESERVER_Z32,
      kind: 'combined',
      receiverPublished: true,
    });
  });

  it('rejects a callback after cancel without storing keys', async () => {
    await cancelPendingDelegation();
    jest.mocked(KeyStore.setAppKeypair).mockClear();
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toThrow(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
  });

  it('decrypts with the replacement keypair and rejects the superseded secret', async () => {
    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: 'ephemeral-sk-replacement',
      publicKey: 'ephemeral-pk-replacement',
    });
    await requestDelegation('hypercolor-replacement');
    const result = await handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));
    expect(sb2Decrypt).toHaveBeenCalledWith(
      'envelope-b64',
      'ephemeral-sk-replacement',
      pubkyZ32ToHex(RING_PUBKY_Z32),
      `/pub/paykit.app/v0/handoff/${RING_REQUEST_ID}`,
    );
    expect(result.pubky).toBe(RING_PUBKY_Z32);
  });

  it('rejects a replayed callback after success', async () => {
    await handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toThrow(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  });

  it('does not persist keys when cancel races an in-flight callback', async () => {
    let resolveGet!: (value: { isOk: () => boolean; value: string }) => void;
    (rnGet as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveGet = resolve;
        }),
    );
    jest.mocked(KeyStore.setAppKeypair).mockClear();
    const pending = started(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32)));
    await waitUntil(() => typeof resolveGet === 'function');
    await cancelPendingDelegation();
    resolveGet({
      isOk: () => true,
      value: JSON.stringify({ sb2: 'envelope-b64' }),
    });
    await expect(pending).rejects.toThrow(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
  });

  it('rejects a malformed pubky with a clean error instead of a hex radix crash', async () => {
    await expect(handleRingCallback(ringCallbackUrl('tf'))).rejects.toThrow(
      'Invalid callback URL — pubky is not a 52-character z-base-32 key.',
    );
    expect(sb2VerifySignature).not.toHaveBeenCalled();
    expect(sb2Decrypt).not.toHaveBeenCalled();
    expect(rnGet).not.toHaveBeenCalled();
  });

  it('does not wipe a newer generation handoff from an older callback tail', async () => {
    const approval = deferred<{ sessionAlias: string; pubky: string }>();
    jest.mocked(PaykitLinkNative.awaitAuthApproval).mockReturnValue(approval.promise);
    const callback = started(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32)));
    await waitUntil(() => jest.mocked(PaykitLinkNative.awaitAuthApproval).mock.calls.length > 0);

    jest.mocked(PaykitLinkNative.awaitAuthApproval).mockResolvedValue({
      sessionAlias: 'alias-b',
      pubky: RING_PUBKY_Z32,
    });
    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: 'sk-b',
      publicKey: 'pk-b',
    });
    const next = await requestDelegation('hypercolor-b');
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');

    approval.resolve({ sessionAlias: 'alias-1', pubky: RING_PUBKY_Z32 });
    await expect(callback).rejects.toThrow(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');
    expect(getPendingDelegationSnapshot()?.url).toBe(next.url);
    expect(mockPersistedHandoffSk).toBe('sk-b');
  });

  it('rejects a callback after the handoff TTL without storing keys', async () => {
    jest.mocked(KeyStore.setAppKeypair).mockClear();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + ENABLE_AUTH_TTL_MS + 1);
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toBeInstanceOf(
      ExpiredDelegationError,
    );
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('rejects a cold-start callback instead of keys-only legacy', async () => {
    const sk = await resolvePendingEphemeralSk();
    const unexpired = Date.now() + ENABLE_AUTH_TTL_MS;
    await cancelPendingDelegation();
    mockPersistedHandoffSk = sk;
    mockPersistedHandoffExpiresAt = unexpired;
    mockPersistedHandoffCombined = true;
    jest.mocked(KeyStore.setAppKeypair).mockClear();
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toBeInstanceOf(
      CombinedFlowRestartRequiredError,
    );
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
    expect(LinkService.adoptApprovedSession).not.toHaveBeenCalled();
  });

  it('rejects a legacy raw-hex handoff with no persisted TTL as expired', async () => {
    const sk = await resolvePendingEphemeralSk();
    await cancelPendingDelegation();
    mockPersistedHandoffSk = sk;
    mockPersistedHandoffExpiresAt = null;
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toBeInstanceOf(
      ExpiredDelegationError,
    );
  });

  it('fails closed when a Keychain read error hides the handoff TTL', async () => {
    const sk = await resolvePendingEphemeralSk();
    await cancelPendingDelegation();
    mockPersistedHandoffSk = sk;
    mockPersistedHandoffExpiresAt = Date.now() + ENABLE_AUTH_TTL_MS;
    let reads = 0;
    mockGetPendingRingHandoff.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) return sk;
      throw new Error('keystore unavailable');
    });
    jest.mocked(KeyStore.setAppKeypair).mockClear();
    const expired = await handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32)).then(
      () => {
        throw new Error('expected expiry');
      },
      err => err,
    );
    expect(isExpiredDelegationError(expired)).toBe(true);
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
    expect(rnGet).not.toHaveBeenCalled();
  });

  it('fails closed when the persisted expiresAt cannot be read', async () => {
    const sk = await resolvePendingEphemeralSk();
    await cancelPendingDelegation();
    mockPersistedHandoffSk = sk;
    mockGetPendingRingHandoffExpiresAt.mockRejectedValue(new Error('keystore unavailable'));
    jest.mocked(KeyStore.setAppKeypair).mockClear();
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toBeInstanceOf(
      ExpiredDelegationError,
    );
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
    expect(mockPersistedHandoffSk).toBeNull();
  });

  it('does not clear a newer generation handoff when KeyStore read fails', async () => {
    const approval = deferred<{ sessionAlias: string; pubky: string }>();
    jest.mocked(PaykitLinkNative.awaitAuthApproval).mockReturnValue(approval.promise);
    const callback = started(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32)));
    await waitUntil(() => jest.mocked(PaykitLinkNative.awaitAuthApproval).mock.calls.length > 0);

    jest.mocked(PaykitLinkNative.awaitAuthApproval).mockResolvedValue({
      sessionAlias: 'alias-b',
      pubky: RING_PUBKY_Z32,
    });
    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: 'sk-b',
      publicKey: 'pk-b',
    });
    const next = await requestDelegation('hypercolor-b');
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');

    mockGetPendingRingHandoff.mockImplementation(async () => {
      throw new Error('keystore unavailable');
    });

    approval.resolve({ sessionAlias: 'alias-1', pubky: RING_PUBKY_Z32 });
    await expect(callback).rejects.toThrow(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');
    expect(getPendingDelegationSnapshot()?.url).toBe(next.url);
    expect(mockPersistedHandoffSk).toBe('sk-b');
  });

  it('never persists session_secret', async () => {
    (sb2Decrypt as jest.Mock).mockResolvedValue({
      plaintext: Buffer.from(
        JSON.stringify({ ...HANDOFF_PAYLOAD, session_secret: 'unused-root-secret' }),
        'utf8',
      ).toString('hex'),
    });
    await handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));
    expect(KeyStore.deleteSessionSecret).toHaveBeenCalled();
  });
});

describe('parsePubkyauthAuthorizationUrl', () => {
  it('parses empty-authority pubkyauth URLs by hand', () => {
    const parsed = parsePubkyauthAuthorizationUrl(pubkyauthUrl());
    expect(parsed.secret).toHaveLength(43);
    expect(parsed.relay).toBe(AUTH_RELAY);
    expect(parsed.caps).toBe(RING_GRANT_CAPABILITIES);
  });

  it('rejects a missing secret', () => {
    expect(() =>
      parsePubkyauthAuthorizationUrl(
        `pubkyauth:///?caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}&relay=${encodeURIComponent(AUTH_RELAY)}`,
      ),
    ).toThrow('pubkyauth URL is missing caps, secret, or relay');
  });

  it('rejects caps that do not match RING_GRANT_CAPABILITIES', () => {
    expect(() =>
      parsePubkyauthAuthorizationUrl(
        `pubkyauth:///?caps=${encodeURIComponent('/pub/other/:rw')}&secret=${AUTH_SECRET}&relay=${encodeURIComponent(AUTH_RELAY)}`,
      ),
    ).toThrow('pubkyauth caps do not match RING_GRANT_CAPABILITIES');
  });

  it('keeps a literal plus in mode instead of treating it as a space', () => {
    const params = parseQueryParams(
      'pubky=abc&request_id=req-1&mode=secure_handoff+pubkyauth&homeserver=hs',
    );
    expect(params.get('mode')).toBe(COMBINED_HANDOFF_MODE);
  });

  it('rejects a non-https or non-allowlisted relay', () => {
    expect(() =>
      parsePubkyauthAuthorizationUrl(
        `pubkyauth:///?caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}&secret=${AUTH_SECRET}&relay=${encodeURIComponent('http://httprelay.pubky.app/link/')}`,
      ),
    ).toThrow('pubkyauth relay must be https');
    expect(() =>
      parsePubkyauthAuthorizationUrl(
        `pubkyauth:///?caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}&secret=${AUTH_SECRET}&relay=${encodeURIComponent('https://evil.example/link/')}`,
      ),
    ).toThrow('pubkyauth relay host is not allowlisted');
  });
});

describe('combined grant', () => {
  const ephemeralSk = 'ephemeral-sk-hex';
  const deviceId = 'hypercolor-abc123';

  beforeEach(async () => {
    await cancelPendingDelegation();
    jest.mocked(PaykitLinkNative.isAvailable).mockReturnValue(true);
    jest.mocked(PaykitLinkNative.startAuthFlow).mockResolvedValue({
      flowId: 'flow-1',
      authorizationUrl: pubkyauthUrl(),
    });
    jest.mocked(PaykitLinkNative.awaitAuthApproval).mockResolvedValue({
      sessionAlias: 'alias-1',
      pubky: RING_PUBKY_Z32,
    });
    jest.mocked(PaykitLinkNative.cancelAuthFlow).mockResolvedValue(undefined);
    jest.mocked(PaykitLinkNative.stopAuthKeepalive).mockResolvedValue(undefined);
    jest.mocked(KeyStore.setAppKeypair).mockResolvedValue(undefined);
    jest.mocked(LinkService.rollbackAdoptedSession).mockResolvedValue(undefined);
    jest.mocked(LinkService.adoptApprovedSession).mockResolvedValue({
      alias: 'alias-1',
      pubky: RING_PUBKY_Z32,
    });
    jest.mocked(LinkService.provisionReceiverAfterConnect).mockResolvedValue({
      pubky: RING_PUBKY_Z32,
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'npk',
      receiverRole: 'active',
    });
    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: ephemeralSk,
      publicKey: 'ephemeral-pk-hex',
    });
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
    (rnGet as jest.Mock).mockResolvedValue({
      isOk: () => true,
      value: JSON.stringify({ sb2: 'envelope-b64' }),
    });
    (sb2VerifySignature as jest.Mock).mockResolvedValue(true);
    (sb2Decrypt as jest.Mock).mockResolvedValue({
      plaintext: Buffer.from(JSON.stringify(HANDOFF_PAYLOAD), 'utf8').toString('hex'),
    });
  });

  afterEach(async () => {
    jest.mocked(PaykitLinkNative.isAvailable).mockReturnValue(false);
    await cancelPendingDelegation();
  });

  it('embeds secret(43)+relay+v=2 on the paykit-connect QR after startAuthFlow', async () => {
    const result = await requestDelegation(deviceId);
    expect(PaykitLinkNative.startAuthFlow).toHaveBeenCalledWith(RING_GRANT_CAPABILITIES);
    const startOrder = jest.mocked(PaykitLinkNative.startAuthFlow).mock.invocationCallOrder[0]!;
    const keyOrder = jest.mocked(x25519GenerateKeypair).mock.invocationCallOrder[0]!;
    expect(startOrder).toBeLessThan(keyOrder);
    expect(result.url).toContain(`secret=${encodeURIComponent(AUTH_SECRET)}`);
    expect(AUTH_SECRET).toHaveLength(43);
    expect(result.url).toContain(`relay=${encodeURIComponent(AUTH_RELAY)}`);
    expect(result.url).toContain('v=2');
    expect(deviceId).toMatch(/^hypercolor-[0-9a-f]+$/);
    expect(result.url).toContain(`deviceId=${encodeURIComponent(deviceId)}`);
  });

  it('adopts session then keys then receiver and never stores session_secret', async () => {
    const order: string[] = [];
    jest.mocked(LinkService.adoptApprovedSession).mockImplementation(async () => {
      order.push('session');
      return { alias: 'alias-1', pubky: RING_PUBKY_Z32 };
    });
    jest.mocked(KeyStore.setAppKeypair).mockImplementation(async () => {
      order.push('keys');
    });
    jest.mocked(LinkService.provisionReceiverAfterConnect).mockImplementation(async () => {
      order.push('receiver');
      return {
        pubky: RING_PUBKY_Z32,
        receiverPath: 'hypercolor/wallet',
        noisePublicKey: 'npk',
        receiverRole: 'active',
      };
    });
    await requestDelegation(deviceId);
    const result = await handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));
    expect(order).toEqual(['session', 'keys', 'receiver']);
    expect(result).toEqual({
      pubky: RING_PUBKY_Z32,
      homeserver: RING_HOMESERVER_Z32,
      kind: 'combined',
      receiverPublished: true,
    });
    expect(KeyStore.deleteSessionSecret).toHaveBeenCalled();
  });

  it('locator-only at deadline persists nothing', async () => {
    jest
      .mocked(PaykitLinkNative.awaitAuthApproval)
      .mockImplementation(() => new Promise(() => undefined));
    await requestDelegation(deviceId);
    const snapshot = getPendingDelegationSnapshot();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue((snapshot?.expiresAt ?? 0) + 1);
    jest.mocked(KeyStore.setAppKeypair).mockClear();
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toBeInstanceOf(
      ExpiredDelegationError,
    );
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
    expect(LinkService.adoptApprovedSession).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('drops plaintext when /session adopt fails', async () => {
    jest.mocked(LinkService.adoptApprovedSession).mockRejectedValue(new Error('session failed'));
    await requestDelegation(deviceId);
    jest.mocked(KeyStore.setAppKeypair).mockClear();
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toThrow(
      'session failed',
    );
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
    expect(LinkService.signOutSessionQuiet).toHaveBeenCalledWith('alias-1');
    expect(LinkService.provisionReceiverAfterConnect).not.toHaveBeenCalled();
  });

  it('keeps session+keys and throws Retry-publish when provisionReceiver fails', async () => {
    jest
      .mocked(LinkService.provisionReceiverAfterConnect)
      .mockRejectedValue(new Error('put failed'));
    await requestDelegation(deviceId);
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toBeInstanceOf(
      ProvisionReceiverFailedError,
    );
    expect(LinkService.adoptApprovedSession).toHaveBeenCalled();
    expect(KeyStore.setAppKeypair).toHaveBeenCalled();
  });

  it('cancel disposes the native auth flow and signs out a late handle', async () => {
    const approval = deferred<{ sessionAlias: string; pubky: string }>();
    jest.mocked(PaykitLinkNative.awaitAuthApproval).mockReturnValue(approval.promise);
    await requestDelegation(deviceId);
    const pending = started(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32)));
    await waitUntil(() => jest.mocked(PaykitLinkNative.awaitAuthApproval).mock.calls.length > 0);
    expect(PaykitLinkNative.awaitAuthApproval).toHaveBeenCalledWith('flow-1');
    await cancelPendingDelegation();
    expect(PaykitLinkNative.cancelAuthFlow).toHaveBeenCalledWith('flow-1');
    approval.resolve({ sessionAlias: 'alias-late', pubky: RING_PUBKY_Z32 });
    await expect(pending).rejects.toThrow(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
    expect(LinkService.signOutSessionQuiet).toHaveBeenCalledWith('alias-late');
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
  });

  it('rejects mixed identities (callback vs session vs payload)', async () => {
    jest.mocked(PaykitLinkNative.awaitAuthApproval).mockResolvedValue({
      sessionAlias: 'alias-1',
      pubky: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await requestDelegation(deviceId);
    jest.mocked(KeyStore.setAppKeypair).mockClear();
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toBeInstanceOf(
      BindingMismatchError,
    );
    expect(LinkService.signOutSessionQuiet).toHaveBeenCalled();
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
  });

  it('rolls back the session when adoptHandoff fails', async () => {
    jest.mocked(KeyStore.setAppKeypair).mockRejectedValue(new Error('mmkv write failed'));
    await requestDelegation(deviceId);
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toThrow(
      'mmkv write failed',
    );
    expect(LinkService.rollbackAdoptedSession).toHaveBeenCalledWith('alias-1');
  });

  it('does not dispose the admitted flow on a duplicate already-awaiting callback', async () => {
    const approval = deferred<{ sessionAlias: string; pubky: string }>();
    let awaits = 0;
    jest.mocked(PaykitLinkNative.awaitAuthApproval).mockImplementation(async () => {
      awaits += 1;
      if (awaits === 1) return approval.promise;
      throw { code: 'validation', message: 'validation failed' };
    });
    await requestDelegation(deviceId);
    const first = started(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32)));
    await waitUntil(() => jest.mocked(PaykitLinkNative.awaitAuthApproval).mock.calls.length > 0);
    jest.mocked(PaykitLinkNative.cancelAuthFlow).mockClear();
    await expect(handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32))).rejects.toMatchObject({
      code: 'validation',
    });
    expect(PaykitLinkNative.cancelAuthFlow).not.toHaveBeenCalled();
    approval.resolve({ sessionAlias: 'alias-1', pubky: RING_PUBKY_Z32 });
    await expect(first).resolves.toMatchObject({ kind: 'combined' });
  });

  it('rejects a combined flow that still sends secure_handoff', async () => {
    await requestDelegation(deviceId);
    jest.mocked(PaykitLinkNative.cancelAuthFlow).mockClear();
    await expect(
      handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32, 'secure_handoff')),
    ).rejects.toBeInstanceOf(UpdatePubkyRingError);
    expect(PaykitLinkNative.cancelAuthFlow).toHaveBeenCalledWith('flow-1');
    expect(KeyStore.setAppKeypair).not.toHaveBeenCalled();
  });

  it('accepts an unencoded plus in the combined mode query', async () => {
    await requestDelegation(deviceId);
    const url =
      `hypercolor://ring-callback?pubky=${encodeURIComponent(RING_PUBKY_Z32)}` +
      `&request_id=${encodeURIComponent(RING_REQUEST_ID)}` +
      `&mode=secure_handoff+pubkyauth` +
      `&homeserver=${encodeURIComponent(RING_HOMESERVER_Z32)}`;
    await expect(handleRingCallback(url)).resolves.toMatchObject({ kind: 'combined' });
  });
});
