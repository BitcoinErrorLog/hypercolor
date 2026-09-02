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
 * Legacy keychain service that once held the receiver Noise secret in JS.
 * Native now owns that secret; this name is only used to wipe leftover v3
 * entries on `KeyStore.clear()`. Do not read or write secrets here.
 */
const LEGACY_LINK_RECEIVER_SECRET_SERVICE = 'hypercolor-link-receiver-secret';
const RING_PENDING_SERVICE = 'hypercolor-ring-pending';
const ATTACHMENT_KEY_SERVICE_PREFIX = 'hypercolor-attachment-key';

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

  // Generate a random 32-byte key, store it in the keychain.
  // Fail closed: `index.js` polyfills react-native-get-random-values, so a
  // missing CSPRNG means the runtime is broken — never fall back to
  // Math.random() for key material.
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error(
      'KeyStore: crypto.getRandomValues is unavailable; refusing to generate the MMKV encryption key without a CSPRNG',
    );
  }
  const randomBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(randomBytes);
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

// Receiver Noise secrets live in the NATIVE keychain and are referenced from
// JS only by opaque alias (SQLite `link_receivers.receiver_alias`). The
// homeserver bearer is likewise native-owned (`sessionAlias` in MMKV below).

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

// ─── Link session alias (sync, MMKV — opaque native handle, not a bearer) ────

export function setLinkSession(sessionAlias: string): void {
  store().set(LINK_SESSION_KEY, sessionAlias);
}

export function getLinkSession(): string | null {
  return store().getString(LINK_SESSION_KEY) ?? null;
}

export function deleteLinkSession(): void {
  store().remove(LINK_SESSION_KEY);
}

// ─── Pending Ring handoff (OS Keychain — survives process death) ─────────────

/**
 * Ephemeral X25519 secret used to decrypt `hypercolor://ring-callback`.
 * Must live in Keychain, not only a JS var: iOS may kill Hypercolor while
 * Ring is in the foreground. `expiresAt` is persisted so cold-start
 * redemption can still enforce the handoff TTL.
 */
type PendingRingHandoffRecord = {
  ephemeralSkHex: string;
  expiresAt: number | null;
};

function parsePendingRingHandoff(password: string): PendingRingHandoffRecord | null {
  if (password.length === 0) return null;
  try {
    const parsed = JSON.parse(password) as { ephemeralSkHex?: unknown; expiresAt?: unknown };
    if (typeof parsed?.ephemeralSkHex === 'string' && parsed.ephemeralSkHex.length > 0) {
      const expiresAt =
        typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt)
          ? parsed.expiresAt
          : null;
      return { ephemeralSkHex: parsed.ephemeralSkHex, expiresAt };
    }
  } catch {
    // Legacy entries stored the raw hex secret as the password.
  }
  return { ephemeralSkHex: password, expiresAt: null };
}

export async function setPendingRingHandoff(
  ephemeralSkHex: string,
  expiresAt: number,
): Promise<void> {
  await Keychain.setGenericPassword(
    KEYCHAIN_USERNAME,
    JSON.stringify({ ephemeralSkHex, expiresAt }),
    {
      service: RING_PENDING_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

export async function getPendingRingHandoff(): Promise<string | null> {
  const record = await readPendingRingHandoff();
  return record?.ephemeralSkHex ?? null;
}

export async function getPendingRingHandoffExpiresAt(): Promise<number | null> {
  const record = await readPendingRingHandoff();
  return record?.expiresAt ?? null;
}

async function readPendingRingHandoff(): Promise<PendingRingHandoffRecord | null> {
  const result = await Keychain.getGenericPassword({ service: RING_PENDING_SERVICE });
  if (result === false) return null;
  return parsePendingRingHandoff(result.password);
}

export async function clearPendingRingHandoff(): Promise<void> {
  await Keychain.resetGenericPassword({ service: RING_PENDING_SERVICE });
}

// ─── Attachment AEAD material (OS Keychain, keyed by owner + sender + event) ─

export interface AttachmentSecretMaterial {
  key: string;
  nonce: string;
  algorithm: string;
  thumbnail?: { key: string; nonce: string };
}

export interface AttachmentSecretRef {
  senderPubky: string;
  eventId: string;
}

const ATTACHMENT_INDEX_PREFIX = 'attachment_key_services:';
/** DEBUG-only MMKV slot when unsigned iOS sim keychain returns -34018. */
const DEBUG_ATTACHMENT_PREFIX = 'debug.attachment:';

function isUnsignedSimKeychainError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /entitlement isn't present|errSecMissingEntitlement|-34018/i.test(message);
}

function debugAttachmentStoreKey(service: string): string {
  return `${DEBUG_ATTACHMENT_PREFIX}${service}`;
}

export function attachmentKeyService(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): string {
  return `${ATTACHMENT_KEY_SERVICE_PREFIX}:${ownerPubky}:${senderPubky}:${eventId}`;
}

function attachmentIndexKey(ownerPubky: string): string {
  return `${ATTACHMENT_INDEX_PREFIX}${ownerPubky}`;
}

function readAttachmentServiceIndex(ownerPubky: string): string[] {
  try {
    const raw = store().getString(attachmentIndexKey(ownerPubky));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function writeAttachmentServiceIndex(ownerPubky: string, services: readonly string[]): void {
  store().set(attachmentIndexKey(ownerPubky), JSON.stringify([...new Set(services)]));
}

function rememberAttachmentService(ownerPubky: string, service: string): void {
  const current = readAttachmentServiceIndex(ownerPubky);
  if (current.includes(service)) return;
  writeAttachmentServiceIndex(ownerPubky, [...current, service]);
}

function forgetAttachmentService(ownerPubky: string, service: string): void {
  writeAttachmentServiceIndex(
    ownerPubky,
    readAttachmentServiceIndex(ownerPubky).filter(item => item !== service),
  );
}

/**
 * Stores the attachment key/nonce that arrived over the Encrypted Link.
 * Ciphertext is world-readable; this material is the only secret.
 * One Keychain service per (owner, sender, event) — a shared (owner, event)
 * service would let a group peer overwrite another sender's key.
 */
export async function setAttachmentSecret(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
  material: AttachmentSecretMaterial,
): Promise<void> {
  const service = attachmentKeyService(ownerPubky, senderPubky, eventId);
  const payload = JSON.stringify(material);
  try {
    await Keychain.setGenericPassword(KEYCHAIN_USERNAME, payload, {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (err) {
    if (!__DEV__ || !isUnsignedSimKeychainError(err)) throw err;
    store().set(debugAttachmentStoreKey(service), payload);
  }
  rememberAttachmentService(ownerPubky, service);
}

export async function getAttachmentSecret(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): Promise<AttachmentSecretMaterial | null> {
  const service = attachmentKeyService(ownerPubky, senderPubky, eventId);
  try {
    const result = await Keychain.getGenericPassword({ service });
    if (result !== false) {
      return JSON.parse(result.password) as AttachmentSecretMaterial;
    }
  } catch {
    // Unsigned-sim keychain miss — try the DEBUG fallback below.
  }
  if (__DEV__) {
    const raw = store().getString(debugAttachmentStoreKey(service));
    if (raw) {
      return JSON.parse(raw) as AttachmentSecretMaterial;
    }
  }
  return null;
}

export async function deleteAttachmentSecretByService(
  ownerPubky: string,
  service: string,
): Promise<boolean> {
  try {
    await Keychain.resetGenericPassword({ service });
  } catch {
    if (!__DEV__) return false;
  }
  if (__DEV__) {
    store().remove(debugAttachmentStoreKey(service));
  }
  forgetAttachmentService(ownerPubky, service);
  return true;
}

export async function deleteAttachmentSecret(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): Promise<boolean> {
  return deleteAttachmentSecretByService(
    ownerPubky,
    attachmentKeyService(ownerPubky, senderPubky, eventId),
  );
}

/**
 * Deletes the listed attachment key services. Returns service names whose
 * deletion failed so the caller can journal them in `pending_cleanup`.
 */
export async function deleteAttachmentSecrets(
  ownerPubky: string,
  refs: readonly AttachmentSecretRef[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const ref of refs) {
    const service = attachmentKeyService(ownerPubky, ref.senderPubky, ref.eventId);
    const ok = await deleteAttachmentSecretByService(ownerPubky, service);
    if (!ok) failed.push(service);
  }
  return failed;
}

/**
 * Wipes every attachment service recorded for this owner (MMKV index).
 * Returns service names that could not be deleted.
 */
export async function clearAttachmentSecretsForOwner(ownerPubky: string): Promise<string[]> {
  const services = readAttachmentServiceIndex(ownerPubky);
  const failed: string[] = [];
  for (const service of services) {
    const ok = await deleteAttachmentSecretByService(ownerPubky, service);
    if (!ok) failed.push(service);
  }
  if (failed.length === 0) {
    store().remove(attachmentIndexKey(ownerPubky));
  }
  return failed;
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
  const owner = getPubky();
  if (owner) {
    await clearAttachmentSecretsForOwner(owner);
  }
  await Promise.all([
    deleteAppKeypair(),
    Keychain.resetGenericPassword({ service: INBOX_KEY_SERVICE }),
    Keychain.resetGenericPassword({ service: TRANSPORT_KEY_SERVICE }),
    Keychain.resetGenericPassword({ service: APP_CERT_SERVICE }),
    Keychain.resetGenericPassword({ service: LEGACY_LINK_RECEIVER_SECRET_SERVICE }),
    Keychain.resetGenericPassword({ service: RING_PENDING_SERVICE }),
  ]);
  if (owner) {
    store().remove(attachmentIndexKey(owner));
  }
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
  // Link session alias (Paykit Encrypted Links — native owns the bearer)
  setLinkSession,
  getLinkSession,
  deleteLinkSession,
  setPendingRingHandoff,
  getPendingRingHandoff,
  getPendingRingHandoffExpiresAt,
  clearPendingRingHandoff,
  setAttachmentSecret,
  getAttachmentSecret,
  deleteAttachmentSecret,
  deleteAttachmentSecretByService,
  deleteAttachmentSecrets,
  clearAttachmentSecretsForOwner,
  attachmentKeyService,
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
