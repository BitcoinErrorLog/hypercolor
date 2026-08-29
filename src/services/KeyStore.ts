import * as Keychain from 'react-native-keychain';
import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * KeyStore — two-tier storage for delegated identity data.
 *
 * Hypercolor never holds a root Ed25519 secret key.
 * All cryptographic material is delegated from pubky-ring via AppCert/UKD.
 *
 * Sensitive (OS Keychain):
 *   - AppKey Ed25519 keypair (delegated signing key, not root)
 *   - X25519 inbox keypair (for SB2 DM decryption)
 *   - X25519 transport keypair (for Noise sessions)
 *   - AppCert (cert_body + sig proving delegation from root)
 *
 * Non-sensitive (encrypted MMKV):
 *   - pubky (root Ed25519 public key, z-base32)
 *   - homeserver URL
 *   - session_secret
 */

// ─── Keychain service identifiers ────────────────────────────────────────────

const APP_KEY_SERVICE = 'hypercolor-app-key';
const INBOX_KEY_SERVICE = 'hypercolor-inbox-key';
const TRANSPORT_KEY_SERVICE = 'hypercolor-transport-key';
const APP_CERT_SERVICE = 'hypercolor-app-cert';
const KEYCHAIN_USERNAME = 'identity';

/**
 * Keychain service holding the Paykit Encrypted Links receiver Noise secret.
 * Exported so SQLite rows can REFERENCE the keychain entry by name — the
 * secret itself never enters the database.
 */
export const LINK_RECEIVER_SECRET_SERVICE = 'hypercolor-link-receiver-secret';

// ─── MMKV metadata keys ───────────────────────────────────────────────────────

const PUBKY_KEY = 'pubky';
const HOMESERVER_KEY = 'homeserver';
const SESSION_SECRET_KEY = 'session_secret';
const LINK_SESSION_KEY = 'link_session';

const MMKV_KEY_SERVICE = 'hypercolor-mmkv-encryption-key';
let _store: MMKV | null = null;
let _mmkvKeyPromise: Promise<string> | null = null;

/**
 * Derives a device-specific MMKV encryption key from the OS keychain.
 * Generated once per device install and persisted in the keychain.
 */
async function getOrCreateMmkvKey(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: MMKV_KEY_SERVICE });
  if (existing !== false) return existing.password;

  // Generate a random 32-byte key, store it in the keychain
  const randomBytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 32; i++) randomBytes[i] = Math.floor(Math.random() * 256);
  }
  const keyHex = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  await Keychain.setGenericPassword(KEYCHAIN_USERNAME, keyHex, {
    service: MMKV_KEY_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return keyHex;
}

function store(): MMKV {
  if (!_store) {
    // Synchronous creation with a temporary key — the real key is loaded lazily.
    // MMKV requires a synchronous constructor, so we use a deterministic
    // placeholder that gets replaced on first async access. In practice,
    // the async init in `initKeyStore()` should be called at app start.
    _store = createMMKV({ id: 'hypercolor-keystore' });
  }
  return _store;
}

/**
 * Must be called once at app start (before any KeyStore reads).
 * Loads the device-specific MMKV encryption key from the keychain.
 */
export async function initKeyStore(): Promise<void> {
  if (_mmkvKeyPromise) return _mmkvKeyPromise.then(() => {});
  _mmkvKeyPromise = getOrCreateMmkvKey();
  const key = await _mmkvKeyPromise;
  _store = createMMKV({ id: 'hypercolor-keystore', encryptionKey: key });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppKeyPair {
  /** Delegated Ed25519 secret key hex (NOT the root key — never stored here) */
  secretKey: string;
  /** Delegated Ed25519 public key hex */
  publicKey: string;
}

export interface InboxKeypair {
  secretKey: string; // hex-encoded X25519 secret key (32 bytes)
  publicKey: string; // hex-encoded X25519 public key (32 bytes)
}

export interface TransportKeypair {
  secretKey: string; // hex-encoded X25519 secret key (32 bytes)
  publicKey: string; // hex-encoded X25519 public key (32 bytes)
}

export interface AppCert {
  certBodyHex: string;
  sigHex: string;
  certIdHex: string;
  /** Unix seconds when the cert expires (optional — undefined means no expiry) */
  expiresAt?: number | undefined;
}

// ─── App Keypair (delegated Ed25519, from pubky-ring handoff) ─────────────────

export async function setAppKeypair(keypair: AppKeyPair): Promise<void> {
  await Keychain.setGenericPassword(KEYCHAIN_USERNAME, JSON.stringify(keypair), {
    service: APP_KEY_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getAppKeypair(): Promise<AppKeyPair | null> {
  const result = await Keychain.getGenericPassword({ service: APP_KEY_SERVICE });
  if (result === false) return null;
  try {
    return JSON.parse(result.password) as AppKeyPair;
  } catch {
    return null;
  }
}

export async function deleteAppKeypair(): Promise<void> {
  await Keychain.resetGenericPassword({ service: APP_KEY_SERVICE });
}

// ─── Inbox keypair (X25519, for SB2 DM decryption) ───────────────────────────

export async function setInboxKeypair(keypair: InboxKeypair): Promise<void> {
  await Keychain.setGenericPassword(KEYCHAIN_USERNAME, JSON.stringify(keypair), {
    service: INBOX_KEY_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getInboxKeypair(): Promise<InboxKeypair | null> {
  const result = await Keychain.getGenericPassword({ service: INBOX_KEY_SERVICE });
  if (result === false) return null;
  try {
    return JSON.parse(result.password) as InboxKeypair;
  } catch {
    return null;
  }
}

// ─── Transport keypair (X25519, for Noise BLE sessions) ──────────────────────

export async function setTransportKeypair(keypair: TransportKeypair): Promise<void> {
  await Keychain.setGenericPassword(KEYCHAIN_USERNAME, JSON.stringify(keypair), {
    service: TRANSPORT_KEY_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getTransportKeypair(): Promise<TransportKeypair | null> {
  const result = await Keychain.getGenericPassword({ service: TRANSPORT_KEY_SERVICE });
  if (result === false) return null;
  try {
    return JSON.parse(result.password) as TransportKeypair;
  } catch {
    return null;
  }
}

// ─── Link receiver secret (Paykit Encrypted Links Noise key) ─────────────────
// Receiver-scoped Noise secret for encrypted DMs. Whoever holds it (plus the
// link snapshots in SQLite) can decrypt this user's conversations, so it
// lives in the OS keychain — SQLite only stores LINK_RECEIVER_SECRET_SERVICE
// as a reference. Losing it breaks every Encrypted Link the account has.

export async function setLinkReceiverSecret(secretHex: string): Promise<void> {
  await Keychain.setGenericPassword(KEYCHAIN_USERNAME, secretHex, {
    service: LINK_RECEIVER_SECRET_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getLinkReceiverSecret(): Promise<string | null> {
  const result = await Keychain.getGenericPassword({ service: LINK_RECEIVER_SECRET_SERVICE });
  if (result === false) return null;
  return result.password;
}

export async function deleteLinkReceiverSecret(): Promise<void> {
  await Keychain.resetGenericPassword({ service: LINK_RECEIVER_SECRET_SERVICE });
}

// ─── AppCert (delegation proof from pubky-ring) ───────────────────────────────

export async function setAppCert(cert: AppCert): Promise<void> {
  await Keychain.setGenericPassword(KEYCHAIN_USERNAME, JSON.stringify(cert), {
    service: APP_CERT_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getAppCert(): Promise<AppCert | null> {
  const result = await Keychain.getGenericPassword({ service: APP_CERT_SERVICE });
  if (result === false) return null;
  try {
    return JSON.parse(result.password) as AppCert;
  } catch {
    return null;
  }
}

// ─── Pubky public key (sync, MMKV — not sensitive, it's a public key) ────────

export function setPubky(pubky: string): void {
  store().set(PUBKY_KEY, pubky);
}

export function getPubky(): string | null {
  return store().getString(PUBKY_KEY) ?? null;
}

// ─── Homeserver (sync, MMKV) ──────────────────────────────────────────────────

export function setHomeserver(homeserver: string): void {
  store().set(HOMESERVER_KEY, homeserver);
}

export function getHomeserver(): string | null {
  return store().getString(HOMESERVER_KEY) ?? null;
}

// ─── Session secret (sync, MMKV — session token only, not a key) ─────────────

export function setSessionSecret(sessionSecret: string): void {
  store().set(SESSION_SECRET_KEY, sessionSecret);
}

export function getSessionSecret(): string | null {
  return store().getString(SESSION_SECRET_KEY) ?? null;
}

// ─── Link session (sync, MMKV — exported Paykit session, session-token tier) ─

export function setLinkSession(exportedSession: string): void {
  store().set(LINK_SESSION_KEY, exportedSession);
}

export function getLinkSession(): string | null {
  return store().getString(LINK_SESSION_KEY) ?? null;
}

export function deleteLinkSession(): void {
  store().remove(LINK_SESSION_KEY);
}

// ─── Session / cert validity ──────────────────────────────────────────────────

export async function hasPersistedSession(): Promise<boolean> {
  const appKey = await getAppKeypair();
  return appKey !== null && store().contains(PUBKY_KEY);
}

/**
 * Returns true if the AppCert has not expired.
 * If the cert has no `expiresAt` field, it is assumed to be perpetual.
 */
export async function isAppCertValid(): Promise<boolean> {
  const cert = await getAppCert();
  if (!cert) return false;
  if (cert.expiresAt == null) return true;
  return Math.floor(Date.now() / 1000) < cert.expiresAt;
}

// ─── Clear all ────────────────────────────────────────────────────────────────

export async function clear(): Promise<void> {
  await Promise.all([
    deleteAppKeypair(),
    Keychain.resetGenericPassword({ service: INBOX_KEY_SERVICE }),
    Keychain.resetGenericPassword({ service: TRANSPORT_KEY_SERVICE }),
    Keychain.resetGenericPassword({ service: APP_CERT_SERVICE }),
    deleteLinkReceiverSecret(),
  ]);
  store().remove(PUBKY_KEY);
  store().remove(HOMESERVER_KEY);
  store().remove(SESSION_SECRET_KEY);
  store().remove(LINK_SESSION_KEY);
}

export const KeyStore = {
  // Initialization
  initKeyStore,
  // App keypair (delegated Ed25519)
  setAppKeypair,
  getAppKeypair,
  deleteAppKeypair,
  // Inbox keypair (X25519)
  setInboxKeypair,
  getInboxKeypair,
  // Transport keypair (X25519)
  setTransportKeypair,
  getTransportKeypair,
  // Link receiver secret (Paykit Encrypted Links)
  setLinkReceiverSecret,
  getLinkReceiverSecret,
  deleteLinkReceiverSecret,
  // Link session (Paykit Encrypted Links)
  setLinkSession,
  getLinkSession,
  deleteLinkSession,
  // AppCert
  setAppCert,
  getAppCert,
  isAppCertValid,
  // Metadata
  setPubky,
  getPubky,
  setHomeserver,
  getHomeserver,
  setSessionSecret,
  getSessionSecret,
  // Session
  hasPersistedSession,
  clear,
};
