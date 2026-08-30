/**
 * Compile-time defaults. This file must stay free of react-native-mmkv
 * (and any other native module) so unit tests can import it.
 */

/**
 * Official production Nexus (pubky-knowledge-base / shipped Pubky docs).
 * Used only for the public social graph (followers / following / friends).
 * Never for messages. Override with `EXPO_PUBLIC_NEXUS_URL` or
 * `AppConfig.setNexusBaseUrl` — do not invent a host.
 */
export const PRODUCTION_NEXUS_BASE_URL = 'https://nexus.pubky.app';

function readEnvNexusBaseUrl(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_NEXUS_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/+$/, '');
  }
  return undefined;
}

export const DEFAULT_NEXUS_BASE_URL = readEnvNexusBaseUrl() ?? PRODUCTION_NEXUS_BASE_URL;

/**
 * Legacy WoT numeric threshold, still readable via AppConfig so existing
 * overrides are not dead. The inbound gate no longer auto-accepts a
 * never-interacted stranger on composite trust; see wotGate.ts.
 */
export const WOT_AUTO_ACCEPT_TRUST_THRESHOLD = 0.5;

/** Bounded concurrency when hydrating pubky.app profiles during follows import. */
export const PROFILE_HYDRATE_CONCURRENCY = 4;

/**
 * Hard cap on private-group membership, including the creator.
 * Pairwise fan-out is O(n) Noise writes; 50 is the product limit (dossier §9).
 * Public channels are uncapped (homeserver read, no Encrypted Link fan-out).
 */
export const PRIVATE_GROUP_MEMBER_CAP = 50;

/**
 * Max deferred reaction/edit/delete rows kept per (owner, channel, sender).
 * Admission (membership) is checked before a row can consume this quota.
 * Oldest rows (by received_at, then sent_at) are evicted when the cap is hit.
 */
export const GROUP_DEFERRED_QUOTA_PER_SENDER = 32;

/**
 * Deferred reaction/edit/delete rows older than this are dropped and
 * recorded as seen so they cannot refill the quota by replay.
 */
export const GROUP_DEFERRED_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * v1 ciphertext is read/written as a base64 string across the RN JSON bridge.
 * 8 MiB plaintext is a conservative cap (~10.7 MiB base64). Chunking and
 * large-media streaming are future work — do not raise this without a
 * chunked native transfer.
 */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

/** Separate receive-side cap for encrypted JPEG thumbnails. */
export const ATTACHMENT_THUMBNAIL_MAX_BYTES = 256 * 1024;

/**
 * XChaCha20-Poly1305 authentication tag. The 24-byte nonce travels in the
 * access PAM, not in the homeserver blob.
 */
export const ATTACHMENT_AEAD_TAG_BYTES = 16;

/**
 * Slack on top of the 4/3 base64url expansion of (plaintext + tag).
 * Covers padding/rounding when the blob is transported as a JS string.
 */
export const ATTACHMENT_CIPHERTEXT_BUDGET_MARGIN = 64;

/**
 * Max characters of the fetched ciphertext string for a given plaintext cap.
 * ciphertext_chars ≈ ceil((plaintext + 16-byte tag) × 4/3) + margin.
 */
export function attachmentCiphertextBudgetChars(plaintextCap: number): number {
  return (
    Math.ceil(((plaintextCap + ATTACHMENT_AEAD_TAG_BYTES) * 4) / 3) +
    ATTACHMENT_CIPHERTEXT_BUDGET_MARGIN
  );
}

export const ATTACHMENT_CIPHERTEXT_MAX_CHARS =
  attachmentCiphertextBudgetChars(ATTACHMENT_MAX_BYTES);

export const ATTACHMENT_THUMBNAIL_CIPHERTEXT_MAX_CHARS = attachmentCiphertextBudgetChars(
  ATTACHMENT_THUMBNAIL_MAX_BYTES,
);
