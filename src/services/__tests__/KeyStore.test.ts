/**
 * KeyStore MMKV coverage: CSPRNG secret, HKDF → base64url 16-UTF-8-byte
 * (96-bit) encryption key, encrypted canary readiness, no plaintext
 * placeholder, and one-time migration from the legacy truncated key.
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
        if (mockUndecryptableIds.has(config.id)) {
          return undefined;
        }
        if (mockVerifyFail.id === config.id && mockVerifyFail.key === key) {
          return undefined;
        }
        return data!.get(key);
      },
      contains: (key: string) => {
        if (mockUndecryptableIds.has(config.id)) return false;
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
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const a = bytes[i]!;
    const b = remaining > 1 ? bytes[i + 1]! : 0;
    const c = remaining > 2 ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    b64 += alphabet[(triple >> 18) & 63];
    b64 += alphabet[(triple >> 12) & 63];
    if (remaining > 1) b64 += alphabet[(triple >> 6) & 63];
    if (remaining > 2) b64 += alphabet[triple & 63];
  }
  return b64.slice(0, 16);
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
  mockUndecryptableIds.clear();
  mockVerifyFail.id = null;
  mockVerifyFail.key = null;
  mockMmkvById.clear();
}

describe('KeyStore MMKV encryption key', () => {
  beforeEach(resetMocks);

  it('generates a 32-byte CSPRNG secret and opens MMKV with a 96-bit HKDF key', async () => {
    const { initKeyStore } = await freshKeyStore();
    await initKeyStore();

    const stored = mockKeychainStore.get(MMKV_KEY_SERVICE);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    const currentOpens = mockCreateMMKVCalls.filter(c => c.id === STORE_ID_CURRENT);
    expect(currentOpens.length).toBeGreaterThan(0);
    expect(currentOpens.every(c => c.encryptionKey === derivedKey(stored as string))).toBe(true);
    expect(currentOpens.every(c => c.encryptionKey?.length === 16)).toBe(true);
    expect(
      currentOpens.every(
        c => new TextEncoder().encode(c.encryptionKey as string).byteLength === 16,
      ),
    ).toBe(true);
    expect(currentOpens.every(c => c.encryptionKey !== stored)).toBe(true);
    expect(mockCreateMMKVCalls.every(c => c.encryptionKey != null)).toBe(true);
  });

  it('derives a 16-UTF-8-byte (96-bit) MMKV key for a fixed vector', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    const { initKeyStore } = await freshKeyStore();
    await initKeyStore();
    const key = mockCreateMMKVCalls.find(c => c.id === STORE_ID_CURRENT)?.encryptionKey;
    expect(key).toBe(derivedKey(SECRET_HEX));
    expect(key).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(new TextEncoder().encode(key as string).byteLength).toBe(16);
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

  it('treats a legacy raw-hex pending Ring handoff as already expired (expiresAt=0)', async () => {
    const { initKeyStore, getPendingRingHandoff, getPendingRingHandoffExpiresAt } =
      await freshKeyStore();
    await initKeyStore();
    mockKeychainStore.set('hypercolor-ring-pending', 'deadbeef');
    await expect(getPendingRingHandoff()).resolves.toBe('deadbeef');
    await expect(getPendingRingHandoffExpiresAt()).resolves.toBe(0);
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

  it('keeps the sign-out-incomplete owner across KeyStore.clearIfPubky', async () => {
    const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
    const {
      initKeyStore,
      setPubky,
      markSignOutIncomplete,
      isSignOutIncomplete,
      getSignOutIncompleteOwner,
      clearIfPubky,
      clearSignOutIncomplete,
    } = await freshKeyStore();
    await initKeyStore();
    setPubky(OWNER);
    markSignOutIncomplete(OWNER);
    expect(isSignOutIncomplete()).toBe(true);
    expect(getSignOutIncompleteOwner()).toBe(OWNER);
    await clearIfPubky(OWNER);
    expect(isSignOutIncomplete()).toBe(true);
    expect(getSignOutIncompleteOwner()).toBe(OWNER);
    clearSignOutIncomplete();
    expect(isSignOutIncomplete()).toBe(false);
    expect(getSignOutIncompleteOwner()).toBeNull();
  });

  it('rejects a non-pubky sign-out-incomplete marker', async () => {
    const { initKeyStore, markSignOutIncomplete, getSignOutIncompleteOwner, isSignOutIncomplete } =
      await freshKeyStore();
    await initKeyStore();
    expect(() => markSignOutIncomplete('1')).toThrow(/owner is required/);
    expect(isSignOutIncomplete()).toBe(false);
    expect(getSignOutIncompleteOwner()).toBeNull();
  });

  it('compare-and-clears identity only while KeyStore still names that owner', async () => {
    const { initKeyStore, setPubky, getPubky, clearIfPubky } = await freshKeyStore();
    await initKeyStore();
    setPubky('pubky-a');
    await expect(clearIfPubky('pubky-b')).resolves.toBe(false);
    expect(getPubky()).toBe('pubky-a');
    await expect(clearIfPubky('pubky-a')).resolves.toBe(true);
    expect(getPubky()).toBeNull();
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
    expect(() => ks.deleteSessionSecret()).toThrow(ks.KeyStoreNotReady);
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

  it('treats a discarded MMKV file as ready-and-empty (pubky is gone too)', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    const ks = await freshKeyStore();
    await ks.initKeyStore();
    expect(ks.isInitialized()).toBe(true);
    expect(ks.getPubky()).toBeNull();
    expect(ks.readLinkSession()).toEqual({ ok: true, alias: null });
    await expect(ks.hasPersistedSession()).resolves.toBe(false);
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBe('v2-hkdf');
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

  it('keeps the legacy store when a copied key does not round-trip and wipes the destination', async () => {
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
    expect(mockMmkvById.get(STORE_ID_CURRENT)?.size ?? 0).toBe(0);
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
    expect(mockMmkvById.get(STORE_ID_CURRENT)?.size ?? 0).toBe(0);
  });

  it('skips listed legacy keys whose getString is undefined rather than failing init', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    mockMmkvById.set(STORE_ID_LEGACY, new Map([['link_session', 'alias-legacy']]));
    mockUndecryptableIds.add(STORE_ID_LEGACY);

    const ks = await freshKeyStore();
    await ks.initKeyStore();
    expect(ks.isInitialized()).toBe(true);
    expect(ks.getPubky()).toBeNull();
    expect(ks.readLinkSession()).toEqual({ ok: true, alias: null });
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBe('v2-hkdf');
    expect(mockMmkvById.get(STORE_ID_LEGACY)?.get('link_session')).toBe('alias-legacy');
  });

  it('overwrites a mismatched canary instead of bricking init', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    mockKeychainStore.set(MMKV_GENERATION_SERVICE, 'v2-hkdf');
    mockMmkvById.set(
      STORE_ID_CURRENT,
      new Map([
        ['keystore.canary', 'old-canary'],
        ['pubky', 'owner-pk'],
      ]),
    );
    const ks = await freshKeyStore();
    await ks.initKeyStore();
    expect(ks.isInitialized()).toBe(true);
    expect(ks.getPubky()).toBe('owner-pk');
    expect(mockMmkvById.get(STORE_ID_CURRENT)?.get('keystore.canary')).toBe(
      'hypercolor-keystore-ready-v1',
    );
  });

  it('retries migration on boot 2 after verify fails on boot 1; legacy and session stay intact', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    mockMmkvById.set(
      STORE_ID_LEGACY,
      new Map([
        ['pubky', 'owner-pk'],
        ['link_session', 'alias-legacy'],
      ]),
    );
    mockVerifyFail.id = STORE_ID_CURRENT;
    mockVerifyFail.key = 'link_session';

    const boot1 = await freshKeyStore();
    await boot1.initKeyStore();
    expect(boot1.getLinkSession()).toBe('alias-legacy');
    expect(boot1.getPubky()).toBe('owner-pk');
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBeUndefined();
    expect(mockMmkvById.get(STORE_ID_LEGACY)?.get('link_session')).toBe('alias-legacy');
    expect(mockMmkvById.get(STORE_ID_CURRENT)?.size ?? 0).toBe(0);

    mockVerifyFail.id = null;
    mockVerifyFail.key = null;
    const boot2 = await freshKeyStore();
    await boot2.initKeyStore();
    expect(boot2.getLinkSession()).toBe('alias-legacy');
    expect(boot2.getPubky()).toBe('owner-pk');
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBe('v2-hkdf');
    expect(mockMmkvById.get(STORE_ID_LEGACY)?.size ?? 0).toBe(0);
  });

  it('commits on boot 2 after a kill between copy+canary and the generation mark', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    mockMmkvById.set(
      STORE_ID_CURRENT,
      new Map([
        ['pubky', 'owner-pk'],
        ['link_session', 'alias-legacy'],
        ['keystore.canary', 'hypercolor-keystore-ready-v1'],
      ]),
    );
    mockMmkvById.set(
      STORE_ID_LEGACY,
      new Map([
        ['pubky', 'owner-pk'],
        ['link_session', 'alias-legacy'],
      ]),
    );
    const ks = await freshKeyStore();
    await ks.initKeyStore();
    expect(ks.getLinkSession()).toBe('alias-legacy');
    expect(ks.getPubky()).toBe('owner-pk');
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBe('v2-hkdf');
    expect(mockMmkvById.get(STORE_ID_LEGACY)?.size ?? 0).toBe(0);
  });

  it('marks v2 on boot 2 after a kill between legacy.clearAll and the generation mark', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    mockMmkvById.set(
      STORE_ID_CURRENT,
      new Map([
        ['pubky', 'owner-pk'],
        ['link_session', 'alias-legacy'],
        ['keystore.canary', 'hypercolor-keystore-ready-v1'],
      ]),
    );
    mockMmkvById.set(STORE_ID_LEGACY, new Map());
    const ks = await freshKeyStore();
    await ks.initKeyStore();
    expect(ks.getLinkSession()).toBe('alias-legacy');
    expect(ks.getPubky()).toBe('owner-pk');
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBe('v2-hkdf');
  });

  it('preserves the session alias across two boots when link_session failed to copy on boot 1', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, SECRET_HEX);
    mockMmkvById.set(
      STORE_ID_LEGACY,
      new Map([
        ['pubky', 'owner-pk'],
        ['link_session', 'alias-legacy'],
      ]),
    );
    mockVerifyFail.id = STORE_ID_CURRENT;
    mockVerifyFail.key = 'link_session';

    const boot1 = await freshKeyStore();
    await boot1.initKeyStore();
    expect(boot1.getLinkSession()).toBe('alias-legacy');
    expect(boot1.getPubky()).toBe('owner-pk');
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBeUndefined();

    mockVerifyFail.id = null;
    mockVerifyFail.key = null;
    const boot2 = await freshKeyStore();
    await boot2.initKeyStore();
    expect(boot2.getLinkSession()).toBe('alias-legacy');
    expect(boot2.readLinkSession()).toEqual({ ok: true, alias: 'alias-legacy' });
    expect(mockKeychainStore.get(MMKV_GENERATION_SERVICE)).toBe('v2-hkdf');
  });
});
