/**
 * KeyStore MMKV key-derivation coverage: the device MMKV encryption key must
 * come from a CSPRNG and fail closed when one is unavailable (never
 * Math.random()).
 */

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

jest.mock('react-native-mmkv', () => ({
  createMMKV: jest.fn((config: { id: string; encryptionKey?: string }) => {
    mockCreateMMKVCalls.push(config);
    const data = new Map<string, string>();
    return {
      set: (key: string, value: string) => {
        data.set(key, value);
      },
      getString: (key: string) => data.get(key),
      contains: (key: string) => data.has(key),
      remove: (key: string) => {
        data.delete(key);
      },
    };
  }),
}));

const MMKV_KEY_SERVICE = 'hypercolor-mmkv-encryption-key';

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

describe('KeyStore MMKV encryption key', () => {
  beforeEach(() => {
    mockKeychainStore.clear();
    mockCreateMMKVCalls.length = 0;
  });

  it('generates a 32-byte CSPRNG key, persists it in the keychain, and opens MMKV with it', async () => {
    const { initKeyStore } = await freshKeyStore();
    await initKeyStore();

    const stored = mockKeychainStore.get(MMKV_KEY_SERVICE);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(mockCreateMMKVCalls).toEqual([{ id: 'hypercolor-keystore', encryptionKey: stored }]);
  });

  it('reuses the keychain-stored key without needing a CSPRNG', async () => {
    const existing = 'ab'.repeat(32);
    mockKeychainStore.set(MMKV_KEY_SERVICE, existing);

    const restore = removeCsprng();
    try {
      const { initKeyStore } = await freshKeyStore();
      await initKeyStore();
    } finally {
      restore();
    }

    expect(mockCreateMMKVCalls).toEqual([{ id: 'hypercolor-keystore', encryptionKey: existing }]);
  });

  it('fails closed when no CSPRNG is available and no key exists yet', async () => {
    const restore = removeCsprng();
    try {
      const { initKeyStore } = await freshKeyStore();
      await expect(initKeyStore()).rejects.toThrow(/CSPRNG/);
    } finally {
      restore();
    }

    // Nothing persisted: no weak key may ever reach the keychain or MMKV.
    expect(mockKeychainStore.has(MMKV_KEY_SERVICE)).toBe(false);
    expect(mockCreateMMKVCalls).toEqual([]);
  });
});

describe('KeyStore session and Ring pending', () => {
  beforeEach(() => {
    mockKeychainStore.clear();
    mockCreateMMKVCalls.length = 0;
  });

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

  it('treats a missing AppCert expiresAt as no expiry', async () => {
    const { initKeyStore, setAppCert, isAppCertValid } = await freshKeyStore();
    await initKeyStore();
    await setAppCert({ certBodyHex: 'aa', sigHex: 'bb', certIdHex: 'cc' });
    await expect(isAppCertValid()).resolves.toBe(true);
  });

  it('falls back to MMKV for attachment secrets when unsigned-sim keychain rejects', async () => {
    mockKeychainStore.set(MMKV_KEY_SERVICE, 'ab'.repeat(32));
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

  it('keeps the sign-out-incomplete owner across KeyStore.clear', async () => {
    const {
      initKeyStore,
      setPubky,
      markSignOutIncomplete,
      isSignOutIncomplete,
      getSignOutIncompleteOwner,
      clear,
      clearSignOutIncomplete,
    } = await freshKeyStore();
    await initKeyStore();
    setPubky('pubky-owner');
    markSignOutIncomplete('pubky-owner');
    expect(isSignOutIncomplete()).toBe(true);
    expect(getSignOutIncompleteOwner()).toBe('pubky-owner');
    await clear();
    expect(isSignOutIncomplete()).toBe(true);
    expect(getSignOutIncompleteOwner()).toBe('pubky-owner');
    clearSignOutIncomplete();
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
