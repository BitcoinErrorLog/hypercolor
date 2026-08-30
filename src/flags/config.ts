/**
 * Compile-time defaults. This file must stay free of react-native-mmkv
 * (and any other native module) so unit tests can import it.
 */

/**
 * Public Nexus aggregator (staging). Used only for the public social graph
 * (followers / following / friends). Never for messages.
 */
export const DEFAULT_NEXUS_BASE_URL = 'https://nexus.staging.pubky.app';

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
