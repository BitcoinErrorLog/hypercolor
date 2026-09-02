import type { PubkyKey } from '../../types';
import { StorageService } from '../StorageService';

/**
 * Per-owner follows-import consent and local block list.
 * Default is off — no homeserver follows listing and no Nexus read until the
 * user confirms the consent sheet.
 *
 * Consent is persisted per owner in MMKV and survives sign-out/reconnect
 * for that same identity.
 *
 * The block deny list is owner-scoped SQLite (`blocked_peers`). A leftover
 * MMKV `blocked:{owner}` blob is migrated forward once: read, INSERT OR
 * IGNORE, then delete the MMKV key only after the SQL commit. Read failure
 * or malformed persisted data is a distinct `unavailable` state — never an
 * empty set — and every Encrypted-Link choke fails closed on it.
 *
 * MMKV is loaded lazily so unit tests that never touch persistence do not
 * need a native store.
 */
const FLAG_PREFIX = 'followsImportEnabled:';
const BLOCKED_PREFIX = 'blocked:';
const CLEANUP_PENDING_PREFIX = 'blockCleanupPending:';

export type PeerDenyState = 'denied' | 'clear' | 'unavailable';

type OwnerDenyCache = { status: 'unavailable' } | { status: 'available'; peers: Set<string> };

const memEnabled = new Map<string, boolean>();
const memDeny = new Map<string, OwnerDenyCache>();
const memCleanupPending = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

let mmkvStore: {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove?(key: string): void;
} | null = null;
let mmkvTried = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function storage(): typeof mmkvStore {
  if (mmkvTried) return mmkvStore;
  mmkvTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    mmkvStore = createMMKV({ id: 'hypercolor-contacts-privacy' });
  } catch {
    mmkvStore = null;
  }
  return mmkvStore;
}

function readEnabled(ownerPubky: PubkyKey): boolean {
  const cached = memEnabled.get(ownerPubky);
  if (cached !== undefined) return cached;
  try {
    const raw = storage()?.getString(`${FLAG_PREFIX}${ownerPubky}`);
    const enabled = raw === '1';
    memEnabled.set(ownerPubky, enabled);
    return enabled;
  } catch {
    memEnabled.set(ownerPubky, false);
    return false;
  }
}

function writeEnabled(ownerPubky: PubkyKey, enabled: boolean): void {
  memEnabled.set(ownerPubky, enabled);
  try {
    storage()?.set(`${FLAG_PREFIX}${ownerPubky}`, enabled ? '1' : '0');
  } catch {
    // Memory remains the source of truth for this session.
  }
  notify();
}

function denyFromCache(ownerPubky: PubkyKey, pubky: PubkyKey): PeerDenyState {
  const cached = memDeny.get(ownerPubky);
  if (!cached) return 'unavailable';
  if (cached.status === 'unavailable') return 'unavailable';
  return cached.peers.has(pubky) ? 'denied' : 'clear';
}

function markUnavailable(ownerPubky: PubkyKey): OwnerDenyCache {
  const next: OwnerDenyCache = { status: 'unavailable' };
  memDeny.set(ownerPubky, next);
  notify();
  return next;
}

function markAvailable(ownerPubky: PubkyKey, peers: Set<string>): OwnerDenyCache {
  const next: OwnerDenyCache = { status: 'available', peers };
  memDeny.set(ownerPubky, next);
  notify();
  return next;
}

function removeMmkvKey(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.remove?.(key);
  } catch {
    // Leftover key re-migrates with INSERT OR IGNORE.
  }
}

/**
 * Read-once MMKV deny blob → SQL. Deletes the MMKV key only after the
 * inserts commit. Malformed JSON or a read error fail closed (throw).
 */
async function migrateMmkvBlocked(ownerPubky: PubkyKey): Promise<void> {
  const store = storage();
  if (!store) return;
  let raw: string | undefined;
  try {
    raw = store.getString(`${BLOCKED_PREFIX}${ownerPubky}`);
  } catch {
    throw new Error('deny list unavailable');
  }
  if (raw === undefined || raw === '') return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('deny list unavailable');
  }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('deny list unavailable');
  }
  const peers = parsed.filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
  await StorageService.insertBlockedPeers(ownerPubky, peers);
  removeMmkvKey(`${BLOCKED_PREFIX}${ownerPubky}`);
}

async function loadOwnerDeny(ownerPubky: PubkyKey): Promise<OwnerDenyCache> {
  const cached = memDeny.get(ownerPubky);
  if (cached) return cached;
  try {
    await migrateMmkvBlocked(ownerPubky);
    const peers = await StorageService.listBlockedPeers(ownerPubky);
    if (!Array.isArray(peers)) throw new Error('deny list unavailable');
    return markAvailable(ownerPubky, new Set(peers));
  } catch {
    return markUnavailable(ownerPubky);
  }
}

function readCleanupPending(ownerPubky: PubkyKey): Set<string> {
  const cached = memCleanupPending.get(ownerPubky);
  if (cached) return cached;
  let next = new Set<string>();
  try {
    const raw = storage()?.getString(`${CLEANUP_PENDING_PREFIX}${ownerPubky}`);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        next = new Set(parsed.filter((item): item is string => typeof item === 'string'));
      }
    }
  } catch {
    next = new Set<string>();
  }
  memCleanupPending.set(ownerPubky, next);
  return next;
}

function writeCleanupPending(ownerPubky: PubkyKey, pending: Set<string>): void {
  memCleanupPending.set(ownerPubky, pending);
  try {
    storage()?.set(`${CLEANUP_PENDING_PREFIX}${ownerPubky}`, JSON.stringify([...pending]));
  } catch {
    // Memory remains the source of truth for this session.
  }
  notify();
}

export const FollowsImportSettings = {
  getFollowsImportEnabled(ownerPubky: PubkyKey): boolean {
    if (!ownerPubky) return false;
    return readEnabled(ownerPubky);
  },

  setFollowsImportEnabled(ownerPubky: PubkyKey, enabled: boolean): void {
    if (!ownerPubky) return;
    writeEnabled(ownerPubky, enabled);
  },

  /**
   * Known denied only. Cache miss / read failure is `false` here so UI does
   * not show Unblock for every peer; chokes use {@link isPeerDenied}.
   */
  isBlocked(ownerPubky: PubkyKey, pubky: PubkyKey): boolean {
    if (!ownerPubky || !pubky) return false;
    return denyFromCache(ownerPubky, pubky) === 'denied';
  },

  /**
   * Fail-closed choke: true when the peer is denied OR deny state cannot
   * be read. Cache miss is unavailable until {@link hydrate} / a write.
   */
  isPeerDenied(ownerPubky: PubkyKey, pubky: PubkyKey): boolean {
    if (!ownerPubky || !pubky) return false;
    const state = denyFromCache(ownerPubky, pubky);
    return state === 'denied' || state === 'unavailable';
  },

  getDenyState(ownerPubky: PubkyKey, pubky: PubkyKey): PeerDenyState {
    if (!ownerPubky || !pubky) return 'unavailable';
    return denyFromCache(ownerPubky, pubky);
  },

  async hydrate(ownerPubky: PubkyKey): Promise<PeerDenyState> {
    if (!ownerPubky) return 'unavailable';
    const cache = await loadOwnerDeny(ownerPubky);
    return cache.status === 'unavailable' ? 'unavailable' : 'clear';
  },

  async resolveDenyState(ownerPubky: PubkyKey, pubky: PubkyKey): Promise<PeerDenyState> {
    if (!ownerPubky || !pubky) return 'unavailable';
    const cache = await loadOwnerDeny(ownerPubky);
    if (cache.status === 'unavailable') return 'unavailable';
    return cache.peers.has(pubky) ? 'denied' : 'clear';
  },

  /**
   * Persist the deny. Throws if the durable write does not commit. Does not
   * mutate the in-memory set until SQL succeeds.
   */
  async block(ownerPubky: PubkyKey, pubky: PubkyKey): Promise<void> {
    if (!ownerPubky || !pubky) {
      throw new Error('Could not persist block.');
    }
    await StorageService.insertBlockedPeer(ownerPubky, pubky);
    let peers: string[];
    try {
      peers = await StorageService.listBlockedPeers(ownerPubky);
    } catch {
      markUnavailable(ownerPubky);
      return;
    }
    markAvailable(ownerPubky, new Set(peers));
  },

  async unblock(ownerPubky: PubkyKey, pubky: PubkyKey): Promise<void> {
    if (!ownerPubky || !pubky) {
      throw new Error('Could not persist unblock.');
    }
    await StorageService.deleteBlockedPeer(ownerPubky, pubky);
    let peers: string[];
    try {
      peers = await StorageService.listBlockedPeers(ownerPubky);
    } catch {
      markUnavailable(ownerPubky);
      return;
    }
    markAvailable(ownerPubky, new Set(peers));
  },

  isBlockCleanupPending(ownerPubky: PubkyKey, pubky: PubkyKey): boolean {
    if (!ownerPubky || !pubky) return false;
    return readCleanupPending(ownerPubky).has(pubky);
  },

  markBlockCleanupPending(ownerPubky: PubkyKey, pubky: PubkyKey): void {
    if (!ownerPubky || !pubky) return;
    const pending = new Set(readCleanupPending(ownerPubky));
    pending.add(pubky);
    writeCleanupPending(ownerPubky, pending);
  },

  clearBlockCleanupPending(ownerPubky: PubkyKey, pubky: PubkyKey): void {
    if (!ownerPubky || !pubky) return;
    const pending = new Set(readCleanupPending(ownerPubky));
    pending.delete(pubky);
    writeCleanupPending(ownerPubky, pending);
  },

  /**
   * Drop in-memory caches so the next lookup re-reads persistence (or
   * fails closed for deny). Does not wipe MMKV consent or SQLite deny
   * rows — reconnecting the same owner keeps both.
   */
  clearSessionMemory(): void {
    memEnabled.clear();
    memDeny.clear();
    memCleanupPending.clear();
    notify();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Test-only: drop in-memory caches and MMKV handle. Does not wipe SQL. */
  resetForTests(): void {
    memEnabled.clear();
    memDeny.clear();
    memCleanupPending.clear();
    listeners.clear();
    mmkvTried = false;
    mmkvStore = null;
  },
};
