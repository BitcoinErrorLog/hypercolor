type MmkvStore = {
  set: (key: string, value: string) => void;
  getString: (key: string) => string | undefined;
  remove: (key: string) => void;
};

const PENDING_JOIN = 'pending_public_join';

let store: MmkvStore | null = null;
let memory: string | null = null;
let hydrated = false;

function meta(): MmkvStore {
  if (!store) {
    // Lazy so GroupService tests do not load native MMKV.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    store = createMMKV({ id: 'hypercolor-ux-meta' });
  }
  return store;
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const stored = meta().getString(PENDING_JOIN);
    if (typeof stored === 'string' && stored.length > 0) {
      memory = stored;
    }
  } catch {
    // Native MMKV is absent in some unit tests; memory-only is enough there.
  }
}

export function setDeferredPublicJoin(ref: string): void {
  hydrate();
  memory = ref;
  try {
    meta().set(PENDING_JOIN, ref);
  } catch {
    // Keep the in-memory copy when persistence is unavailable.
  }
}

export function peekDeferredPublicJoin(): string | null {
  hydrate();
  return memory;
}

export function takeDeferredPublicJoin(): string | null {
  hydrate();
  const value = memory;
  memory = null;
  try {
    meta().remove(PENDING_JOIN);
  } catch {
    // Memory already cleared.
  }
  return value;
}

export function resetDeferredPublicJoinForTests(): void {
  memory = null;
  hydrated = false;
  try {
    if (store) store.remove(PENDING_JOIN);
  } catch {
    // Test harness without MMKV.
  }
  store = null;
}

/** Drop the in-memory copy so the next peek hydrates from persistence. */
export function forgetDeferredPublicJoinMemoryForTests(): void {
  memory = null;
  hydrated = false;
  store = null;
}
