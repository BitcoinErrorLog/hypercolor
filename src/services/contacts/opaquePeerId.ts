import type { PubkyKey } from '../../types';
import { hmacSha256Hex } from './hmacSha256';

/**
 * Per-install opaque correlation id for logs. HMAC-SHA-256 of the peer
 * pubky under a random install salt, truncated to 16 hex chars.
 *
 * Threat model:
 * - Logs alone (no salt): recovering a random 52-character z32 identity
 *   by preimage search is infeasible.
 * - Logs plus the device-local MMKV salt plus a candidate identity set
 *   (contacts, public graph, a suspect list): dictionary matching is
 *   cheap and exact. Treat this as log correlation, never as a secret
 *   or a security decision.
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

/** Stable per-install id for a peer. Hex, 16 chars — never a 52-char z32 pubky. */
export function opaquePeerId(pubky: PubkyKey): string {
  const salt = installSalt();
  if (!salt) return 'unavailable';
  return hmacSha256Hex(salt, pubky).slice(0, 16);
}

/** Test-only: drop cached salt so the next lookup re-reads MMKV. */
export function resetOpaquePeerIdForTests(): void {
  memorySalt = null;
  mmkvTried = false;
  mmkvStore = null;
}
