/**
 * KeyStore MMKV coverage: CSPRNG secret, HKDF 16-byte encryption key,
 * encrypted canary readiness, no plaintext placeholder, and one-time
 * migration from the legacy truncated key.
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

const mockKeychainStore = new Map<string, string>();

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async ({ service }: { service: string }) => {
    const password = mockKeychainStore.get(service);
    return password === undefined ? false : { username: 'identity', password };
  }),
  setGenericPassword: jest.fn(
    async (_username: string, password: string, options: { service: string }) => {
      mockKeychainStore.set(options.service, password);
      return { service: options.service };
    },
  ),
  resetGenericPassword: jest.fn(async ({ service }: { service: string }) => {
    mockKeychainStore.delete(service);
    return true;
  }),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
}));

const mockCreateMMKVCalls: Array<{ id: string; encryptionKey?: string }> = [];
const mockMmkvThrowOnGet = { current: false };
const mockUndecryptable = { current: false };
const mockUndecryptableIds = new Set<string>();
const mockVerifyFail = { id: null as string | null, key: null as string | null };
const mockMmkvById = new Map<string, Map<string, string>>();

jest.mock('react-native-mmkv', () => ({
  createMMKV: jest.fn((config: { id: string; encryptionKey?: string }) => {
    mockCreateMMKVCalls.push(config);
    let data = mockMmkvById.get(config.id);
    if (!data) {
      data = new Map<string, string>();
      mockMmkvById.set(config.id, data);
    }
    return {
      set: (key: string, value: string) => {
        data!.set(key, value);
      },
      getString: (key: string) => {
        if (mockMmkvThrowOnGet.current) {
          throw new Error('mmkv read failed');
        }
        if (mockUndecryptable.current || mockUndecryptableIds.has(config.id)) {
          return undefined;
        }
        if (mockVerifyFail.id === config.id && mockVerifyFail.key === key) {
          return undefined;
        }
        return data!.get(key);
      },
      contains: (key: string) => {
        if (mockUndecryptable.current || mockUndecryptableIds.has(config.id)) return false;
        return data!.has(key);
      },
      remove: (key: string) => {
        data!.delete(key);
      },
      getAllKeys: () => [...data!.keys()],
      clearAll: () => {
        data!.clear();
      },
    };
  }),
}));

const MMKV_KEY_SERVICE = 'hypercolor-mmkv-encryption-key';
const MMKV_GENERATION_SERVICE = 'hypercolor-mmkv-store-generation';
const MMKV_HKDF_INFO = 'hypercolor-keystore-mmkv-v1';
const STORE_ID_LEGACY = 'hypercolor-keystore';
const STORE_ID_CURRENT = 'hypercolor-keystore-v2';
const SECRET_HEX = 'ab'.repeat(32);

function derivedKey(secretHex: string): string {
  const ikm = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    ikm[i] = Number.parseInt(secretHex.slice(i * 2, i * 2 + 2), 16);
  }
  const bytes = hkdf(sha256, ikm, undefined, MMKV_HKDF_INFO, 16);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]!);
  }
  return s;
}

type KeyStoreModule = typeof import('../KeyStore');

async function freshKeyStore(): Promise<KeyStoreModule> {
  let mod: KeyStoreModule | null = null;
  await jest.isolateModulesAsync(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../KeyStore') as KeyStoreModule;
  });
  if (mod === null) throw new Error('failed to load KeyStore module');
  return mod;
}

function removeCsprng(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  return () => {
    if (original) {
      Object.defineProperty(globalThis, 'crypto', original);
    }
  };
}

function resetMocks(): void {
  mockKeychainStore.clear();
  mockCreateMMKVCalls.length = 0;
  mockMmkvThrowOnGet.current = false;
  mockUndecryptable.current = false;
  mockUndecryptableIds.clear();
  mockVerifyFail.id = null;
  mockVerifyFail.key = null;
  mockMmkvById.clear();
}

describe('KeyStore MMKV encryption key', () => {
  beforeEach(resetMocks);

  it('generates a 32-byte CSPRNG secret and opens MMKV with a 16-byte HKDF key', async () => {
    const { initKeyStore } = await freshKeyStore();
    await initKeyStore();

    const stored = mockKeychainStore.get(MMKV_KEY_SERVICE);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    const currentOpens = mockCreateMMKVCalls.filter(c => c.id === STORE_ID_CURRENT);
    expect(currentOpens.length).toBeGreaterThan(0);
    expect(currentOpens.every(c => c.encryptionKey === derivedKey(stored as string))).toBe(true);
    expect(currentOpens.every(c => c.encryptionKey?.length === 16)).toBe(true);
    expect(currentOpens.every(c => c.encryptionKey !== stored)).toBe(true);
    expect(mockCreateMMKVCalls.every(c => c.encryptionKey != null)).toBe(true);
  });

  it('reuses the keychain-stored secret without needing a CSPRNG', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);

    const restore = removeCsprng();
    try {
      const { initKeyStore } = await freshKeyStore();
      await initKeyStore();
    } finally {
      restore();
    }

    const currentOpens = mockCreateMMKVCalls.filter(c => c.id === STORE_ID_CURRENT);
    expect(currentOpens.every(c => c.encryptionKey === derivedKey(SECRET_HEX))).toBe(true);
  });

  it('fails closed when no CSPRNG is available and no key exists yet', async () => {
    const restore = removeCsprng();
    try {
      const { initKeyStore } = await freshKeyStore();
      await expect(initKeyStore()).rejects.toThrow(/CSPRNG/);
    } finally {
      restore();
    }

    expect(mockKeychainStore.has(MMKV_KEY_SERVICE)).toBe(false);
    expect(mockCreateMMKVCalls).toEqual([]);
  });
});

describe('KeyStore session and Ring pending', () => {
  beforeEach(resetMocks);

  it('persists the pending Ring ephemeral SK and expiry in Keychain', async () => {
    const {
      initKeyStore,
      setPendingRingHandoff,
      getPendingRingHandoff,
      getPendingRingHandoffExpiresAt,
      clearPendingRingHandoff,
    } = await freshKeyStore();
    await initKeyStore();
    const expiresAt = 1_700_000_000_000;
    await setPendingRingHandoff('deadbeef', expiresAt);
    await expect(getPendingRingHandoff()).resolves.toBe('deadbeef');
    await expect(getPendingRingHandoffExpiresAt()).resolves.toBe(expiresAt);
    expect(JSON.parse(mockKeychainStore.get('hypercolor-ring-pending') as string)).toEqual({
      ephemeralSkHex: 'deadbeef',
      expiresAt,
    });
    await clearPendingRingHandoff();
    await expect(getPendingRingHandoff()).resolves.toBeNull();
    await expect(getPendingRingHandoffExpiresAt()).resolves.toBeNull();
  });

  it('reads a legacy raw-hex pending Ring handoff without an expiry', async () => {
    const { initKeyStore, getPendingRingHandoff, getPendingRingHandoffExpiresAt } =
      await freshKeyStore();
    await initKeyStore();
    mockKeychainStore.set('hypercolor-ring-pending', 'deadbeef');
    await expect(getPendingRingHandoff()).resolves.toBe('deadbeef');
    await expect(getPendingRingHandoffExpiresAt()).resolves.toBeNull();
  });

  it('treats a JSON handoff with an unreadable expiresAt as already expired', async () => {
    const { initKeyStore, getPendingRingHandoff, getPendingRingHandoffExpiresAt } =
      await freshKeyStore();
    await initKeyStore();
    mockKeychainStore.set(
      'hypercolor-ring-pending',
      JSON.stringify({ ephemeralSkHex: 'deadbeef' }),
    );
    await expect(getPendingRingHandoff()).resolves.toBe('deadbeef');
    await expect(getPendingRingHandoffExpiresAt()).resolves.toBe(0);
  });

  it('treats a missing AppCert expiresAt as no expiry', async () => {
    const { initKeyStore, setAppCert, isAppCertValid } = await freshKeyStore();
    await initKeyStore();
    await setAppCert({ certBodyHex: 'aa', sigHex: 'bb', certIdHex: 'cc' });
    await expect(isAppCertValid()).resolves.toBe(true);
  });

  it('falls back to MMKV for attachment secrets when unsigned-sim keychain rejects', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    const { initKeyStore, setAttachmentSecret, getAttachmentSecret } = await freshKeyStore();
    await initKeyStore();
    const Keychain = jest.requireMock('react-native-keychain') as {
      setGenericPassword: jest.Mock;
    };
    Keychain.setGenericPassword.mockImplementation(
      async (_username: string, _password: string, options: { service: string }) => {
        if (options.service.startsWith('hypercolor-attachment-key')) {
          throw new Error("Internal error when a required entitlement isn't present.");
        }
        mockKeychainStore.set(options.service, _password);
        return { service: options.service };
      },
    );
    await setAttachmentSecret('owner', 'sender', 'event-1', {
      key: 'attach-key',
      nonce: 'attach-nonce',
      algorithm: 'XChaCha20Poly1305',
    });
    await expect(getAttachmentSecret('owner', 'sender', 'event-1')).resolves.toEqual({
      key: 'attach-key',
      nonce: 'attach-nonce',
      algorithm: 'XChaCha20Poly1305',
    });
    Keychain.setGenericPassword.mockImplementation(
      async (_username: string, password: string, options: { service: string }) => {
        mockKeychainStore.set(options.service, password);
        return { service: options.service };
      },
    );
  });

  it('reports a persisted Welcome session from AppKey + pubky', async () => {
    const { initKeyStore, setAppKeypair, setPubky, hasPersistedSession } = await freshKeyStore();
    await initKeyStore();
    await expect(hasPersistedSession()).resolves.toBe(false);
    await setAppKeypair({ secretKey: 'sk', publicKey: 'pk' });
    setPubky('pubky-owner');
    await expect(hasPersistedSession()).resolves.toBe(true);
  });
});

describe('KeyStore link-session readiness', () => {
  beforeEach(resetMocks);

  it('isInitialized is false before init and throws KeyStoreNotReady from accessors', async () => {
    const ks = await freshKeyStore();
    expect(ks.isInitialized()).toBe(false);
    expect(ks.readLinkSession()).toEqual({ ok: false });
    expect(ks.getLinkSession()).toBeNull();
    expect(ks.deleteLinkSessionIfAlias('any')).toBe(false);
    expect(() => ks.setLinkSession('alias-a')).toThrow(ks.KeyStoreNotReady);
    expect(() => ks.getPubky()).toThrow(ks.KeyStoreNotReady);
    expect(() => ks.setPubky('pk')).toThrow(ks.KeyStoreNotReady);
    expect(() => ks.getHomeserver()).toThrow(ks.KeyStoreNotReady);
    expect(() => ks.setHomeserver('hs')).toThrow(ks.KeyStoreNotReady);
    expect(() => ks.getSessionSecret()).toThrow(ks.KeyStoreNotReady);
    expect(() => ks.setSessionSecret('secret')).toThrow(ks.KeyStoreNotReady);
    await expect(ks.clear()).rejects.toThrow(ks.KeyStoreNotReady);
    await expect(ks.hasPersistedSession()).resolves.toBe(false);
    await expect(
      ks.setAttachmentSecret('owner', 'sender', 'event-1', {
        key: 'k',
        nonce: 'n',
        algorithm: 'XChaCha20Poly1305',
      }),
    ).rejects.toThrow(ks.KeyStoreNotReady);
    expect(mockCreateMMKVCalls).toEqual([]);

    await ks.initKeyStore();
    expect(ks.isInitialized()).toBe(true);
    expect(ks.readLinkSession()).toEqual({ ok: true, alias: null });
    expect(ks.getLinkSession()).toBeNull();
  });

  it('distinguishes empty from a readable alias and compare-and-deletes only a match', async () => {
    const ks = await freshKeyStore();
    await ks.initKeyStore();
    ks.setLinkSession('alias-a');
    expect(ks.readLinkSession()).toEqual({ ok: true, alias: 'alias-a' });
    expect(ks.deleteLinkSessionIfAlias('alias-b')).toBe(false);
    expect(ks.getLinkSession()).toBe('alias-a');
    expect(ks.deleteLinkSessionIfAlias('alias-a')).toBe(true);
    expect(ks.readLinkSession()).toEqual({ ok: true, alias: null });
  });

  it('treats an undecryptable store (getString always undefined) as not ready', async () => {
    mockUndecryptable.current = true;
    const ks = await freshKeyStore();
    await expect(ks.initKeyStore()).rejects.toThrow(ks.KeyStoreNotReady);
    expect(ks.isInitialized()).toBe(false);
    expect(ks.readLinkSession()).toEqual({ ok: false });
    expect(ks.getLinkSession()).toBeNull();
    expect(() => ks.setLinkSession('alias-a')).toThrow(ks.KeyStoreNotReady);
    expect(() => ks.getPubky()).toThrow(ks.KeyStoreNotReady);
    expect(ks.deleteLinkSessionIfAlias('alias-a')).toBe(false);
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBeUndefined();
    expect(mockMmkvById.get(STORE_ID_LEGACY)?.size ?? 0).toBe(0);
  });

  it('ready-empty with canary and no alias is a successful empty read', async () => {
    const ks = await freshKeyStore();
    await ks.initKeyStore();
    expect(ks.isInitialized()).toBe(true);
    expect(ks.readLinkSession()).toEqual({ ok: true, alias: null });
    expect(mockMmkvById.get(STORE_ID_CURRENT)?.get('keystore.canary')).toBe(
      'hypercolor-keystore-ready-v1',
    );
  });

  it('stays uninitialized when init fails closed without a CSPRNG', async () => {
    const restore = removeCsprng();
    try {
      const ks = await freshKeyStore();
      await expect(ks.initKeyStore()).rejects.toThrow(/CSPRNG/);
      expect(ks.isInitialized()).toBe(false);
      expect(ks.readLinkSession()).toEqual({ ok: false });
    } finally {
      restore();
    }
  });
});

describe('KeyStore MMKV key migration', () => {
  beforeEach(resetMocks);

  it('copies legacy truncated-key entries into the HKDF store after round-trip verify', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    const legacy = new Map<string, string>([
      ['pubky', 'owner-pk'],
      ['link_session', 'alias-legacy'],
      ['keystore.canary', 'hypercolor-keystore-ready-v1'],
    ]);
    mockMmkvById.set(STORE_ID_LEGACY, legacy);

    const ks = await freshKeyStore();
    await ks.initKeyStore();
    expect(ks.isInitialized()).toBe(true);
    expect(ks.getPubky()).toBe('owner-pk');
    expect(ks.getLinkSession()).toBe('alias-legacy');
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBe('v2-hkdf');
    expect(mockMmkvById.get(STORE_ID_LEGACY)?.size ?? 0).toBe(0);
    expect(mockMmkvById.get(STORE_ID_CURRENT)?.get('pubky')).toBe('owner-pk');
  });

  it('keeps the legacy store when a copied key does not round-trip', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    mockMmkvById.set(
      STORE_ID_LEGACY,
      new Map([
        ['pubky', 'owner-pk'],
        ['link_session', 'alias-legacy'],
      ]),
    );
    mockVerifyFail.id = STORE_ID_CURRENT;
    mockVerifyFail.key = 'pubky';

    const ks = await freshKeyStore();
    await ks.initKeyStore();
    mockVerifyFail.id = null;
    mockVerifyFail.key = null;
    expect(ks.isInitialized()).toBe(true);
    expect(ks.getPubky()).toBe('owner-pk');
    expect(ks.getLinkSession()).toBe('alias-legacy');
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBeUndefined();
    expect(mockMmkvById.get(STORE_ID_LEGACY)?.get('pubky')).toBe('owner-pk');
  });

  it('keeps the legacy store when destination canary install fails after copy', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    mockMmkvById.set(STORE_ID_LEGACY, new Map([['link_session', 'alias-legacy']]));
    mockVerifyFail.id = STORE_ID_CURRENT;
    mockVerifyFail.key = 'keystore.canary';

    const ks = await freshKeyStore();
    await ks.initKeyStore();
    mockVerifyFail.id = null;
    mockVerifyFail.key = null;
    expect(ks.isInitialized()).toBe(true);
    expect(ks.getLinkSession()).toBe('alias-legacy');
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBeUndefined();
    expect(mockMmkvById.get(STORE_ID_LEGACY)?.get('link_session')).toBe('alias-legacy');
  });

  it('fails closed when legacy keys are listed but do not decrypt', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    mockMmkvById.set(STORE_ID_LEGACY, new Map([['link_session', 'alias-legacy']]));
    mockUndecryptableIds.add(STORE_ID_LEGACY);

    const ks = await freshKeyStore();
    await expect(ks.initKeyStore()).rejects.toThrow(ks.KeyStoreNotReady);
    expect(ks.isInitialized()).toBe(false);
    expect(ks.readLinkSession()).toEqual({ ok: false });
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBeUndefined();
    expect(mockMmkvById.get(STORE_ID_LEGACY)?.get('link_session')).toBe('alias-legacy');
  });
});
