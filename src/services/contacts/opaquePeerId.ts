import type { PubkyKey } from '../../types';

/**
 * Per-install opaque correlation id for logs. Not a pubky prefix and not
 * reversible to the peer identity without the install salt.
 *
 * Salt lives in MMKV (KeyStore-free). Hash is FNV-1a 64-bit of
 * `salt || pubky` — log correlation only, never a security decision.
 */
const SALT_KEY = 'peer-log-salt';

let mmkvStore: {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
} | null = null;
let mmkvTried = false;
let memorySalt: string | null = null;

function storage(): typeof mmkvStore {
  if (mmkvTried) return mmkvStore;
  mmkvTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    mmkvStore = createMMKV({ id: 'hypercolor-log-correlation' });
  } catch {
    mmkvStore = null;
  }
  return mmkvStore;
}

function randomSaltHex(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Crypto = require('expo-crypto') as typeof import('expo-crypto');
    const bytes = Crypto.getRandomBytes(16);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    try {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  }
}

function installSalt(): string | null {
  if (memorySalt) return memorySalt;
  const store = storage();
  try {
    const existing = store?.getString(SALT_KEY);
    if (existing && existing.length >= 16) {
      memorySalt = existing;
      return memorySalt;
    }
  } catch {
    // Fall through to mint.
  }
  const minted = randomSaltHex();
  if (!minted) return null;
  memorySalt = minted;
  try {
    store?.set(SALT_KEY, minted);
  } catch {
    // Process-local salt still correlates this session's logs.
  }
  return memorySalt;
}

function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

/** Stable per-install id for a peer. Hex, 16 chars — never a 52-char z32 pubky. */
export function opaquePeerId(pubky: PubkyKey): string {
  const salt = installSalt();
  if (!salt) return 'unavailable';
  return fnv1a64Hex(`${salt}\0${pubky}`);
}

/** Test-only: drop cached salt so the next lookup re-reads MMKV. */
export function resetOpaquePeerIdForTests(): void {
  memorySalt = null;
  mmkvTried = false;
  mmkvStore = null;
}
