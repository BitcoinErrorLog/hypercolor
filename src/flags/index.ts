import { createMMKV, type MMKV } from 'react-native-mmkv';
import { DEFAULT_NEXUS_BASE_URL, WOT_AUTO_ACCEPT_TRUST_THRESHOLD } from './config';

export {
  ATTACHMENT_AEAD_TAG_BYTES,
  ATTACHMENT_CIPHERTEXT_BUDGET_MARGIN,
  ATTACHMENT_CIPHERTEXT_MAX_CHARS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_THUMBNAIL_CIPHERTEXT_MAX_CHARS,
  ATTACHMENT_THUMBNAIL_MAX_BYTES,
  DEFAULT_NEXUS_BASE_URL,
  GROUP_DEFERRED_QUOTA_PER_SENDER,
  GROUP_DEFERRED_TTL_MS,
  PRIVATE_GROUP_MEMBER_CAP,
  PROFILE_HYDRATE_CONCURRENCY,
  WOT_AUTO_ACCEPT_TRUST_THRESHOLD,
  attachmentCiphertextBudgetChars,
} from './config';

const NEXUS_URL_KEY = 'config:nexus_base_url';
const WOT_THRESHOLD_KEY = 'config:wot_auto_accept_trust_threshold';

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

/**
 * Runtime-overridable config that lives next to feature flags.
 * Defaults are the staging constants above; tests should inject a
 * {@link createNexusClient} instead of mutating this.
 */
export const AppConfig = {
  getNexusBaseUrl(): string {
    try {
      const stored = getStorage().getString(NEXUS_URL_KEY);
      return stored && stored.length > 0 ? stored : DEFAULT_NEXUS_BASE_URL;
    } catch {
      return DEFAULT_NEXUS_BASE_URL;
    }
  },

  setNexusBaseUrl(url: string): void {
    getStorage().set(NEXUS_URL_KEY, url);
  },

  getWotAutoAcceptTrustThreshold(): number {
    try {
      const stored = getStorage().getNumber(WOT_THRESHOLD_KEY);
      return typeof stored === 'number' && stored >= 0 && stored <= 1
        ? stored
        : WOT_AUTO_ACCEPT_TRUST_THRESHOLD;
    } catch {
      return WOT_AUTO_ACCEPT_TRUST_THRESHOLD;
    }
  },

  setWotAutoAcceptTrustThreshold(value: number): void {
    getStorage().set(WOT_THRESHOLD_KEY, value);
  },
};
