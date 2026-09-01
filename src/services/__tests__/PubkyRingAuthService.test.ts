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

jest.mock('../KeyStore', () => ({
  KeyStore: {
    setPendingRingHandoff: jest.fn(),
    getPendingRingHandoff: (...args: unknown[]) => mockGetPendingRingHandoff(...args),
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
  certFromHandoffAppKey,
  handleRingCallback,
  requestDelegation,
  resolvePendingEphemeralSk,
} from '../PubkyRingAuthService';
import { RING_GRANT_CAPABILITIES } from '../../types/link';
import { pubkyZ32ToHex } from '../../utils/pubkyId';

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

  beforeEach(() => {
    (x25519GenerateKeypair as jest.Mock).mockResolvedValue({
      secretKey: 'ephemeral-sk',
      publicKey: ephemeralPk,
    });
    (Linking.openURL as jest.Mock).mockResolvedValue(undefined);
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

    expect(result).toEqual({ url: buildPaykitConnectUrl(deviceId, ephemeralPk) });
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(KeyStore.clearPendingRingHandoff).not.toHaveBeenCalled();
    expect(KeyStore.setPendingRingHandoff).toHaveBeenCalledWith('ephemeral-sk');
  });

  it('opens Ring on this device when it is installed and still returns the URL', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    const result = await requestDelegation(deviceId);

    expect(result.url).toBe(buildPaykitConnectUrl(deviceId, ephemeralPk));
    expect(Linking.openURL).toHaveBeenCalledWith(result.url);
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

  it('rejects a malformed pubky with a clean error instead of a hex radix crash', async () => {
    await expect(handleRingCallback(ringCallbackUrl('tf'))).rejects.toThrow(
      'Invalid callback URL — pubky is not a 52-character z-base-32 key.',
    );
    expect(sb2VerifySignature).not.toHaveBeenCalled();
    expect(sb2Decrypt).not.toHaveBeenCalled();
    expect(rnGet).not.toHaveBeenCalled();
  });
});
