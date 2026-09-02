type MmkvStore = {
  set: (key: string, value: string) => void;
  getString: (key: string) => string | undefined;
  remove: (key: string) => void;
};

export const DEFERRED_PUBLIC_JOIN_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_JOIN_PREFIX = 'pending_public_join:';
const LEGACY_PENDING_JOIN = 'pending_public_join';

export type DeferredPublicJoinRecord = {
  ref: string;
  createdAt: number;
  redirected: boolean;
  dismissed: boolean;
};

let store: MmkvStore | null = null;
let unsigned: DeferredPublicJoinRecord | null = null;
const memoryByOwner = new Map<string, DeferredPublicJoinRecord>();
let hydratedOwners = new Set<string>();
let legacyCleared = false;

function meta(): MmkvStore {
  if (!store) {
    // Lazy so GroupService tests do not load native MMKV.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    store = createMMKV({ id: 'hypercolor-ux-meta' });
  }
  return store;
}

function ownerKey(ownerPubky: string): string {
  return `${PENDING_JOIN_PREFIX}${ownerPubky}`;
}

function nowMs(): number {
  return Date.now();
}

function isLive(record: DeferredPublicJoinRecord, now = nowMs()): boolean {
  const age = now - record.createdAt;
  if (age < 0 || age >= DEFERRED_PUBLIC_JOIN_TTL_MS) return false;
  return !record.dismissed;
}

function parseRecord(raw: string | undefined): DeferredPublicJoinRecord | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const value = JSON.parse(raw) as Partial<DeferredPublicJoinRecord>;
    if (typeof value.ref !== 'string' || value.ref.length === 0) return null;
    if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null;
    return {
      ref: value.ref,
      createdAt: value.createdAt,
      redirected: value.redirected === true,
      dismissed: value.dismissed === true,
    };
  } catch {
    return null;
  }
}

function dropLegacyGlobal(): void {
  if (legacyCleared) return;
  legacyCleared = true;
  try {
    meta().remove(LEGACY_PENDING_JOIN);
  } catch {
    // Native MMKV is absent in some unit tests.
  }
}

function persist(ownerPubky: string, record: DeferredPublicJoinRecord): void {
  memoryByOwner.set(ownerPubky, record);
  hydratedOwners.add(ownerPubky);
  try {
    meta().set(ownerKey(ownerPubky), JSON.stringify(record));
  } catch {
    // Keep the in-memory copy when persistence is unavailable.
  }
}

function removeOwner(ownerPubky: string): void {
  memoryByOwner.delete(ownerPubky);
  hydratedOwners.add(ownerPubky);
  try {
    meta().remove(ownerKey(ownerPubky));
  } catch {
    // Memory already cleared.
  }
}

function hydrateOwner(ownerPubky: string): DeferredPublicJoinRecord | null {
  dropLegacyGlobal();
  if (hydratedOwners.has(ownerPubky)) {
    return memoryByOwner.get(ownerPubky) ?? null;
  }
  hydratedOwners.add(ownerPubky);
  try {
    const stored = parseRecord(meta().getString(ownerKey(ownerPubky)));
    if (!stored || !isLive(stored)) {
      if (stored) {
        try {
          meta().remove(ownerKey(ownerPubky));
        } catch {
          // Expired record already unusable.
        }
      }
      return null;
    }
    memoryByOwner.set(ownerPubky, stored);
    return stored;
  } catch {
    return memoryByOwner.get(ownerPubky) ?? null;
  }
}

function liveOrDrop(
  ownerPubky: string | null | undefined,
  record: DeferredPublicJoinRecord | null,
): DeferredPublicJoinRecord | null {
  if (!record) return null;
  if (isLive(record)) return record;
  if (ownerPubky) removeOwner(ownerPubky);
  else unsigned = null;
  return null;
}

export function setDeferredPublicJoin(ref: string, ownerPubky?: string | null): void {
  dropLegacyGlobal();
  const record: DeferredPublicJoinRecord = {
    ref,
    createdAt: nowMs(),
    redirected: false,
    dismissed: false,
  };
  if (!ownerPubky) {
    unsigned = record;
    return;
  }
  unsigned = null;
  persist(ownerPubky, record);
}

/** Unsigned taps stay in memory until the user confirms Join. They are not
 * persisted under whichever identity signs in next. */
export function bindDeferredPublicJoinToOwner(ownerPubky: string): void {
  dropLegacyGlobal();
  hydrateOwner(ownerPubky);
}

export function peekDeferredPublicJoin(ownerPubky?: string | null): string | null {
  dropLegacyGlobal();
  if (!ownerPubky) {
    const record = liveOrDrop(null, unsigned);
    return record?.ref ?? null;
  }
  const record = liveOrDrop(ownerPubky, hydrateOwner(ownerPubky));
  if (!record || record.dismissed) return null;
  return record.ref;
}

/** Invite still waiting for an explicit Join/Dismiss, including after the one allowed redirect. */
export function peekDeferredPublicInvite(ownerPubky: string): string | null {
  const record = liveOrDrop(ownerPubky, hydrateOwner(ownerPubky));
  if (record && !record.dismissed) return record.ref;
  const unsignedRecord = liveOrDrop(null, unsigned);
  return unsignedRecord?.ref ?? null;
}

/** Returns true once per stored ref so launch cannot hijack every cold start. */
export function consumeDeferredPublicJoinRedirect(ownerPubky: string): boolean {
  const record = liveOrDrop(ownerPubky, hydrateOwner(ownerPubky));
  if (!record || record.dismissed || record.redirected) return false;
  persist(ownerPubky, { ...record, redirected: true });
  return true;
}

export function dismissDeferredPublicJoin(ownerPubky: string): void {
  const record = liveOrDrop(ownerPubky, hydrateOwner(ownerPubky));
  if (record) {
    persist(ownerPubky, { ...record, dismissed: true });
    return;
  }
  unsigned = null;
}

export function takeDeferredPublicJoin(ownerPubky?: string | null): string | null {
  dropLegacyGlobal();
  if (!ownerPubky) {
    const record = liveOrDrop(null, unsigned);
    unsigned = null;
    return record?.ref ?? null;
  }
  const record = liveOrDrop(ownerPubky, hydrateOwner(ownerPubky));
  if (record && !record.dismissed) {
    removeOwner(ownerPubky);
    return record.ref;
  }
  const unsignedRecord = liveOrDrop(null, unsigned);
  unsigned = null;
  return unsignedRecord?.ref ?? null;
}

export function clearDeferredPublicJoin(ownerPubky?: string | null): void {
  unsigned = null;
  if (ownerPubky) {
    removeOwner(ownerPubky);
    return;
  }
  memoryByOwner.clear();
  hydratedOwners = new Set();
}

export function resetDeferredPublicJoinForTests(): void {
  unsigned = null;
  memoryByOwner.clear();
  hydratedOwners = new Set();
  legacyCleared = false;
  try {
    if (store) {
      store.remove(LEGACY_PENDING_JOIN);
    }
  } catch {
    // Test harness without MMKV.
  }
  store = null;
}

/** Drop in-memory copies so the next peek hydrates from persistence. */
export function forgetDeferredPublicJoinMemoryForTests(): void {
  unsigned = null;
  memoryByOwner.clear();
  hydratedOwners = new Set();
  legacyCleared = false;
  store = null;
}
