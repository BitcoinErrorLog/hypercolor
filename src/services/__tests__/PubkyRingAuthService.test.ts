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

jest.mock('../KeyStore', () => ({
  KeyStore: {
    setPendingRingHandoff: jest.fn(),
    getPendingRingHandoff: (...args: unknown[]) => mockGetPendingRingHandoff(...args),
    getPendingRingHandoffExpiresAt: (...args: unknown[]) =>
      mockGetPendingRingHandoffExpiresAt(...args),
    clearPendingRingHandoff: jest.fn(),
    setAppKeypair: jest.fn(),
    setAppCert: jest.fn(),
    setInboxKeypair: jest.fn(),
    setTransportKeypair: jest.fn(),
    setPubky: jest.fn(),
    setHomeserver: jest.fn(),
    setSessionSecret: jest.fn(),
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
  ExpiredDelegationError,
  StaleDelegationRequestError,
  isExpiredDelegationError,
} from '../PubkyRingAuthService';
import { RING_GRANT_CAPABILITIES } from '../../types/link';
import { pubkyZ32ToHex } from '../../utils/pubkyId';
import { ENABLE_AUTH_TTL_MS } from '../../copy/uxCopy';

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

let mockPersistedHandoffSk: string | null = null;
let mockPersistedHandoffExpiresAt: number | null = null;

beforeEach(() => {
  mockPersistedHandoffSk = null;
  mockPersistedHandoffExpiresAt = null;
  mockGetPendingRingHandoff.mockImplementation(async () => mockPersistedHandoffSk);
  mockGetPendingRingHandoffExpiresAt.mockImplementation(async () => mockPersistedHandoffExpiresAt);
  jest
    .mocked(KeyStore.setPendingRingHandoff)
    .mockImplementation(async (sk: string, expiresAt: number) => {
      mockPersistedHandoffSk = sk;
      mockPersistedHandoffExpiresAt = expiresAt;
    });
  jest.mocked(KeyStore.clearPendingRingHandoff).mockImplementation(async () => {
    mockPersistedHandoffSk = null;
    mockPersistedHandoffExpiresAt = null;
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

  beforeEach(async () => {
    await cancelPendingDelegation();
    jest.mocked(KeyStore.clearPendingRingHandoff).mockClear();
    jest.mocked(KeyStore.setPendingRingHandoff).mockClear();
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

    expect(result.url).toBe(buildPaykitConnectUrl(deviceId, ephemeralPk));
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + ENABLE_AUTH_TTL_MS);
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(KeyStore.clearPendingRingHandoff).not.toHaveBeenCalled();
    expect(KeyStore.setPendingRingHandoff).toHaveBeenCalledWith('ephemeral-sk', expect.any(Number));
  });

  it('opens Ring on this device when it is installed and still returns the URL', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    const result = await requestDelegation(deviceId);

    expect(result.url).toBe(buildPaykitConnectUrl(deviceId, ephemeralPk));
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
    expect(second.url).toBe(buildPaykitConnectUrl('hypercolor-other', 'pk-2'));
    expect(x25519GenerateKeypair).toHaveBeenCalledTimes(2);
    expect(KeyStore.setPendingRingHandoff).toHaveBeenLastCalledWith(
      'ephemeral-sk-2',
      expect.any(Number),
    );
  });

  it('discards a stale requestDelegation when a newer generation finishes first', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    const firstKey = deferred<{ secretKey: string; publicKey: string }>();
    const secondKey = deferred<{ secretKey: string; publicKey: string }>();
    (x25519GenerateKeypair as jest.Mock)
      .mockImplementationOnce(() => firstKey.promise)
      .mockImplementationOnce(() => secondKey.promise);

    const first = requestDelegation('device-a');
    const second = requestDelegation('device-b');

    secondKey.resolve({ secretKey: 'sk-b', publicKey: 'pk-b' });
    const secondResult = await second;
    expect(secondResult.url).toBe(buildPaykitConnectUrl('device-b', 'pk-b'));
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

    firstKey.resolve({ secretKey: 'sk-a', publicKey: 'pk-a' });
    await expect(first).rejects.toBeInstanceOf(StaleDelegationRequestError);
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');
    expect(getPendingDelegationSnapshot()?.url).toBe(secondResult.url);
    expect(KeyStore.setPendingRingHandoff).not.toHaveBeenCalledWith('sk-a');
    expect(Linking.openURL).not.toHaveBeenCalledWith(buildPaykitConnectUrl('device-a', 'pk-a'));
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

function ringCallbackUrl(pubky: string): string {
  return (
    `hypercolor://ring-callback?pubky=${encodeURIComponent(pubky)}` +
    `&request_id=${encodeURIComponent(RING_REQUEST_ID)}` +
    `&mode=secure_handoff` +
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
    expect(result).toEqual({ pubky: RING_PUBKY_Z32, homeserver: RING_HOMESERVER_Z32 });
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
    const pending = handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));
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
    const setAppGate = deferred<void>();
    const setAppStarted = deferred<void>();
    jest.mocked(KeyStore.setAppKeypair).mockImplementation(async () => {
      setAppStarted.resolve();
      await setAppGate.promise;
    });
    const callback = handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));
    await setAppStarted.promise;

    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: 'sk-b',
      publicKey: 'pk-b',
    });
    const next = await requestDelegation('hypercolor-b');
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');

    setAppGate.resolve();
    await expect(callback).resolves.toEqual({
      pubky: RING_PUBKY_Z32,
      homeserver: RING_HOMESERVER_Z32,
    });
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

  it('enforces TTL on cold-start KeyStore fallback and still completes when unexpired', async () => {
    const sk = await resolvePendingEphemeralSk();
    const unexpired = Date.now() + ENABLE_AUTH_TTL_MS;
    await cancelPendingDelegation();
    mockPersistedHandoffSk = sk;
    mockPersistedHandoffExpiresAt = unexpired;
    const result = await handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));
    expect(result).toEqual({ pubky: RING_PUBKY_Z32, homeserver: RING_HOMESERVER_Z32 });
  });

  it('still completes a legacy raw-hex handoff with no persisted TTL', async () => {
    const sk = await resolvePendingEphemeralSk();
    await cancelPendingDelegation();
    mockPersistedHandoffSk = sk;
    mockPersistedHandoffExpiresAt = null;
    const result = await handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));
    expect(result).toEqual({ pubky: RING_PUBKY_Z32, homeserver: RING_HOMESERVER_Z32 });
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
    const setAppGate = deferred<void>();
    const setAppStarted = deferred<void>();
    jest.mocked(KeyStore.setAppKeypair).mockImplementation(async () => {
      setAppStarted.resolve();
      await setAppGate.promise;
    });
    const callback = handleRingCallback(ringCallbackUrl(RING_PUBKY_Z32));
    await setAppStarted.promise;

    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: 'sk-b',
      publicKey: 'pk-b',
    });
    const next = await requestDelegation('hypercolor-b');
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');

    mockGetPendingRingHandoff.mockImplementation(async () => {
      throw new Error('keystore unavailable');
    });

    setAppGate.resolve();
    await expect(callback).resolves.toEqual({
      pubky: RING_PUBKY_Z32,
      homeserver: RING_HOMESERVER_Z32,
    });
    expect(await resolvePendingEphemeralSk()).toBe('sk-b');
    expect(getPendingDelegationSnapshot()?.url).toBe(next.url);
    expect(mockPersistedHandoffSk).toBe('sk-b');
  });
});
