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
import { x25519GenerateKeypair } from '../../utils/PubkyNoiseModule';
import { KeyStore } from '../KeyStore';
import {
  buildPaykitConnectUrl,
  certFromHandoffAppKey,
  requestDelegation,
  resolvePendingEphemeralSk,
} from '../PubkyRingAuthService';
import { RING_GRANT_CAPABILITIES } from '../../types/link';

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
