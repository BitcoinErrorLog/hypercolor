import type { PubkyKey } from '../../types';

/**
 * Per-owner follows-import consent and local block list.
 * Default is off — no homeserver follows listing and no Nexus read until the
 * user confirms the consent sheet.
 *
 * MMKV is loaded lazily so unit tests that never touch persistence do not
 * need a native store.
 */
const FLAG_PREFIX = 'followsImportEnabled:';
const BLOCKED_PREFIX = 'blocked:';

const memEnabled = new Map<string, boolean>();
const memBlocked = new Map<string, Set<string>>();

let mmkvStore: {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
} | null = null;
let mmkvTried = false;

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

  /** Test-only: drop in-memory caches. Does not wipe MMKV. */
  resetForTests(): void {
    memEnabled.clear();
    memBlocked.clear();
  },
};
