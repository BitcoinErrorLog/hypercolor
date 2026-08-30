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
