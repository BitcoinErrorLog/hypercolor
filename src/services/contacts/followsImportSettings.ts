import type { PubkyKey } from '../../types';

/**
 * Per-owner follows-import consent and local block list.
 * Default is off — no homeserver follows listing and no Nexus read until the
 * user confirms the consent sheet.
 *
 * Consent is persisted per owner and survives sign-out/reconnect for that
 * same identity. In-memory caches are dropped on identity change so the next
 * read re-checks MMKV (fail closed if persistence is missing).
 *
 * MMKV is loaded lazily so unit tests that never touch persistence do not
 * need a native store.
 */
const FLAG_PREFIX = 'followsImportEnabled:';
const BLOCKED_PREFIX = 'blocked:';
const CLEANUP_PENDING_PREFIX = 'blockCleanupPending:';

const memEnabled = new Map<string, boolean>();
const memBlocked = new Map<string, Set<string>>();
const memCleanupPending = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

let mmkvStore: {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
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

function readBlocked(ownerPubky: PubkyKey): Set<string> {
  const cached = memBlocked.get(ownerPubky);
  if (cached) return cached;
  let next = new Set<string>();
  try {
    const raw = storage()?.getString(`${BLOCKED_PREFIX}${ownerPubky}`);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        next = new Set(parsed.filter((item): item is string => typeof item === 'string'));
      }
    }
  } catch {
    next = new Set<string>();
  }
  memBlocked.set(ownerPubky, next);
  return next;
}

function writeBlocked(ownerPubky: PubkyKey, blocked: Set<string>): void {
  memBlocked.set(ownerPubky, blocked);
  try {
    storage()?.set(`${BLOCKED_PREFIX}${ownerPubky}`, JSON.stringify([...blocked]));
  } catch {
    // Memory remains the source of truth for this session.
  }
  notify();
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

  isBlocked(ownerPubky: PubkyKey, pubky: PubkyKey): boolean {
    if (!ownerPubky || !pubky) return false;
    return readBlocked(ownerPubky).has(pubky);
  },

  block(ownerPubky: PubkyKey, pubky: PubkyKey): void {
    if (!ownerPubky || !pubky) return;
    const blocked = new Set(readBlocked(ownerPubky));
    blocked.add(pubky);
    writeBlocked(ownerPubky, blocked);
  },

  unblock(ownerPubky: PubkyKey, pubky: PubkyKey): void {
    if (!ownerPubky || !pubky) return;
    const blocked = new Set(readBlocked(ownerPubky));
    blocked.delete(pubky);
    writeBlocked(ownerPubky, blocked);
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
   * defaults off). Does not wipe MMKV — reconnecting the same owner
   * keeps their consent.
   */
  clearSessionMemory(): void {
    memEnabled.clear();
    memBlocked.clear();
    memCleanupPending.clear();
    notify();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Test-only: drop in-memory caches. Does not wipe MMKV. */
  resetForTests(): void {
    memEnabled.clear();
    memBlocked.clear();
    memCleanupPending.clear();
    listeners.clear();
  },
};
