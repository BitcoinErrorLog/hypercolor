import { createMMKV, type MMKV } from 'react-native-mmkv';

// ─── Feature Flag Definitions ──────────────────────────────────────────────
// All Pubky-dependent paths are gated here. Set to false to disable a feature
// without touching any other code.

export type FeatureFlagKey =
  | 'pubky_identity' // Phase 1: Pubky auth and identity
  | 'pubky_inbox' // Phase 4: Async encrypted delivery
  | 'mesh_transport' // Phase 3: BLE peer discovery and delivery
  | 'channel_messaging' // Phase 5: Group channels
  | 'invite_links' // Phase 5: Deep link invites
  | 'trust_scoring' // Phase 6: Soft trust scores
  | 'telemetry'; // Phase 6: Privacy-preserving counters

// Default values — all features start enabled; individual flags can be toggled
// via Settings or a remote kill switch.
const DEFAULTS: Record<FeatureFlagKey, boolean> = {
  pubky_identity: true,
  pubky_inbox: true,
  mesh_transport: true,
  channel_messaging: true,
  invite_links: true,
  trust_scoring: false, // starts off, enabled in Phase 6
  telemetry: false, // starts off, enabled in Phase 6
};

const FLAG_PREFIX = 'feature_flag:';

let _storage: MMKV | null = null;

function getStorage(): MMKV {
  if (!_storage) {
    _storage = createMMKV({ id: 'feature-flags' });
  }
  return _storage;
}

export const FeatureFlags = {
  /**
   * Returns the current value of a feature flag.
   * Falls back to the compiled default if never explicitly set.
   */
  get(key: FeatureFlagKey): boolean {
    const storage = getStorage();
    const stored = storage.getBoolean(`${FLAG_PREFIX}${key}`);
    return stored !== undefined ? stored : (DEFAULTS[key] ?? false);
  },

  /**
   * Overrides a feature flag value at runtime (persisted across restarts).
   */
  set(key: FeatureFlagKey, value: boolean): void {
    getStorage().set(`${FLAG_PREFIX}${key}`, value);
  },

  /**
   * Resets all flags to their compiled defaults.
   */
  reset(): void {
    const storage = getStorage();
    (Object.keys(DEFAULTS) as FeatureFlagKey[]).forEach(key => {
      storage.remove(`${FLAG_PREFIX}${key}`);
    });
  },

  /**
   * Returns a snapshot of all current flag values.
   */
  getAll(): Record<FeatureFlagKey, boolean> {
    return (Object.keys(DEFAULTS) as FeatureFlagKey[]).reduce(
      (acc, key) => {
        acc[key] = FeatureFlags.get(key);
        return acc;
      },
      {} as Record<FeatureFlagKey, boolean>,
    );
  },
};
