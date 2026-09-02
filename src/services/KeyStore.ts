import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
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
 * Encrypted MMKV (never opened without a 16-byte derived key):
 *   - pubky (root Ed25519 public key, z-base32)
 *   - homeserver URL
 *   - session_secret
 *   - link_session alias
 *
 * Readiness is a positive canary on the encrypted instance, not the
 * absence of a throw: `react-native-mmkv` `getString` returns `undefined`
 * for both missing and undecryptable values.
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
const MMKV_CANARY_KEY = 'keystore.canary';
const MMKV_CANARY_VALUE = 'hypercolor-keystore-ready-v1';
const MMKV_HKDF_INFO = 'hypercolor-keystore-mmkv-v1';
const MMKV_KEY_BYTE_LENGTH = 16;
const MMKV_SECRET_HEX_LENGTH = 64;
const STORE_ID_LEGACY = 'hypercolor-keystore';
const STORE_ID_CURRENT = 'hypercolor-keystore-v2';
const MMKV_KEY_SERVICE = 'hypercolor-mmkv-encryption-key';
const MMKV_GENERATION_SERVICE = 'hypercolor-mmkv-store-generation';
const MMKV_GENERATION_V2 = 'v2-hkdf';

let _store: MMKV | null = null;
let _mmkvKeyPromise: Promise<void> | null = null;
/** True only after encrypted init verified the canary on the instance we hold. */
let _initialized = false;

export const KEYSTORE_NOT_READY_CODE = 'KeyStoreNotReady' as const;

export class KeyStoreNotReady extends Error {
  readonly code = KEYSTORE_NOT_READY_CODE;
  constructor(operation: string) {
    super(`KeyStore.${operation}: encrypted store is not ready`);
    this.name = 'KeyStoreNotReady';
  }
}

export function isKeyStoreNotReady(err: unknown): err is KeyStoreNotReady {
  return err instanceof KeyStoreNotReady;
}

function hexToBytes32(hex: string): Uint8Array {
  if (hex.length !== MMKV_SECRET_HEX_LENGTH || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('KeyStore: MMKV secret must be 32-byte hex');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

/**
 * 16-byte MMKV encryption key derived from the 32-byte keychain secret.
 * `react-native-mmkv` uses at most 16 bytes; a 64-char hex string was
 * silently truncated to 16 ASCII chars (~64 bits). HKDF-SHA256 mixes the
 * full secret into 16 bytes. The JS string is 16 latin-1 code units so
 * the call-site length equals the library maximum.
 */
function deriveMmkvEncryptionKey(secretHex: string): string {
  const ikm = hexToBytes32(secretHex);
  const keyBytes = hkdf(sha256, ikm, undefined, MMKV_HKDF_INFO, MMKV_KEY_BYTE_LENGTH);
  const key = bytesToLatin1(keyBytes);
  assertMmkvEncryptionKeyLength(key);
  return key;
}

/** First 16 chars of the stored hex — the key MMKV actually used before HKDF. */
function legacyTruncatedMmkvKey(secretHex: string): string {
  if (secretHex.length < MMKV_KEY_BYTE_LENGTH) {
    throw new Error('KeyStore: legacy MMKV key is shorter than 16 bytes');
  }
  const truncated = secretHex.slice(0, MMKV_KEY_BYTE_LENGTH);
  assertMmkvEncryptionKeyLength(truncated);
  return truncated;
}

function assertMmkvEncryptionKeyLength(key: string): void {
  if (key.length !== MMKV_KEY_BYTE_LENGTH) {
    throw new Error('KeyStore: MMKV encryptionKey must be exactly 16 bytes');
  }
}

function openMmkv(id: string, encryptionKey: string): MMKV {
  assertMmkvEncryptionKeyLength(encryptionKey);
  return createMMKV({ id, encryptionKey });
}

function readCanary(instance: MMKV): string | undefined {
  try {
    return instance.getString(MMKV_CANARY_KEY);
  } catch {
    return undefined;
  }
}

function canaryIsVerified(instance: MMKV): boolean {
  return readCanary(instance) === MMKV_CANARY_VALUE;
}

function installCanary(instance: MMKV): boolean {
  const existing = readCanary(instance);
  if (existing === MMKV_CANARY_VALUE) return true;
  if (existing !== undefined) return false;
  try {
    instance.set(MMKV_CANARY_KEY, MMKV_CANARY_VALUE);
  } catch {
    return false;
  }
  return canaryIsVerified(instance);
}

function snapshotStringEntries(instance: MMKV): Map<string, string> | null {
  let keys: string[];
  try {
    keys = instance.getAllKeys();
  } catch {
    return null;
  }
  const out = new Map<string, string>();
  for (const key of keys) {
    let value: string | undefined;
    try {
      value = instance.getString(key);
    } catch {
      return null;
    }
    if (value === undefined) return null;
    out.set(key, value);
  }
  return out;
}

function copyAndVerify(entries: Map<string, string>, dest: MMKV): boolean {
  try {
    for (const [key, value] of entries) {
      dest.set(key, value);
    }
    for (const [key, value] of entries) {
      if (dest.getString(key) !== value) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function readStoreGeneration(): Promise<string | null> {
  const existing = await Keychain.getGenericPassword({ service: MMKV_GENERATION_SERVICE });
  if (existing === false) return null;
  return existing.password;
}

async function markStoreGenerationV2(): Promise<void> {
  await Keychain.setGenericPassword(KEYCHAIN_USERNAME, MMKV_GENERATION_V2, {
    service: MMKV_GENERATION_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Derives a device-specific MMKV encryption secret from the OS keychain.
 * Generated once per device install and persisted in the keychain as 32-byte hex.
 * The MMKV `encryptionKey` is HKDF-derived from this secret, never the hex itself.
 */
async function getOrCreateMmkvSecretHex(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: MMKV_KEY_SERVICE });
  if (existing !== false) return existing.password;

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

/**
 * Open the encrypted store. Prefer the HKDF-keyed v2 id. One-time migration
 * copies the legacy truncated-key store only after every key (and the
 * canary) round-trips. Migration failure keeps the legacy store readable.
 */
async function openEncryptedStore(secretHex: string): Promise<MMKV> {
  const derivedKey = deriveMmkvEncryptionKey(secretHex);
  const current = openMmkv(STORE_ID_CURRENT, derivedKey);
  const generation = await readStoreGeneration();

  if (generation === MMKV_GENERATION_V2) {
    if (!installCanary(current)) {
      throw new KeyStoreNotReady('initKeyStore');
    }
    return current;
  }

  const legacy = openMmkv(STORE_ID_LEGACY, legacyTruncatedMmkvKey(secretHex));
  const legacySnap = snapshotStringEntries(legacy);

  if (canaryIsVerified(current)) {
    await markStoreGenerationV2();
    try {
      legacy.clearAll();
    } catch {
      // Current store is source of truth; leftover legacy must not block.
    }
    return current;
  }

  if (legacySnap === null) {
    // Listed keys that do not decrypt: not empty. Fail closed.
    throw new KeyStoreNotReady('initKeyStore');
  }

  if (legacySnap.size > 0) {
    const copied = copyAndVerify(legacySnap, current);
    if (copied && installCanary(current)) {
      let verified = canaryIsVerified(current);
      for (const [key, value] of legacySnap) {
        if (current.getString(key) !== value) verified = false;
      }
      if (verified) {
        await markStoreGenerationV2();
        try {
          legacy.clearAll();
        } catch {
          // Current store is source of truth.
        }
        return current;
      }
    }
    if (!installCanary(legacy)) {
      throw new KeyStoreNotReady('initKeyStore');
    }
    return legacy;
  }

  if (!installCanary(current)) {
    throw new KeyStoreNotReady('initKeyStore');
  }
  await markStoreGenerationV2();
  return current;
}

function requireStore(operation: string): MMKV {
  if (!_initialized || !_store || !canaryIsVerified(_store)) {
    throw new KeyStoreNotReady(operation);
  }
  return _store;
}

/**
 * Must be called once at app start (before any KeyStore reads).
 * Loads the device-specific MMKV encryption secret from the keychain,
 * opens the encrypted instance, and verifies the canary. Never creates
 * an unencrypted placeholder.
 */
export async function initKeyStore(): Promise<void> {
  if (_initialized && _store && canaryIsVerified(_store)) return;
  if (!_mmkvKeyPromise) {
    _mmkvKeyPromise = (async () => {
      const secretHex = await getOrCreateMmkvSecretHex();
      const instance = await openEncryptedStore(secretHex);
      if (!canaryIsVerified(instance)) {
        throw new KeyStoreNotReady('initKeyStore');
      }
      _store = instance;
      _initialized = true;
    })();
  }
  try {
    await _mmkvKeyPromise;
    if (!_initialized || !_store || !canaryIsVerified(_store)) {
      throw new KeyStoreNotReady('initKeyStore');
    }
  } catch (err) {
    _mmkvKeyPromise = null;
    _initialized = false;
    _store = null;
    throw err;
  }
}

/**
 * True only when the encrypted instance is held and the canary reads back
 * exactly. False before init, after a failed/hung init, and when the
 * store is present but undecryptable (`getString` → `undefined`).
 */
export function isInitialized(): boolean {
  return _initialized && _store !== null && canaryIsVerified(_store);
}

export type LinkSessionRead = { ok: true; alias: string | null } | { ok: false };

/**
 * Distinguishes "encrypted store readable and empty" from "not
 * initialised / unreadable". Requires the canary in this process.
 * Never infers readiness from `null`.
 */
export function readLinkSession(): LinkSessionRead {
  if (!isInitialized() || !_store) return { ok: false };
  try {
    if (!canaryIsVerified(_store)) return { ok: false };
    const value = _store.getString(LINK_SESSION_KEY);
    return { ok: true, alias: value ?? null };
  } catch {
    return { ok: false };
  }
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
  requireStore('setPubky').set(PUBKY_KEY, pubky);
}

export function getPubky(): string | null {
  return requireStore('getPubky').getString(PUBKY_KEY) ?? null;
}

// ─── Homeserver (sync, MMKV) ──────────────────────────────────────────────────

export function setHomeserver(homeserver: string): void {
  requireStore('setHomeserver').set(HOMESERVER_KEY, homeserver);
}

export function getHomeserver(): string | null {
  return requireStore('getHomeserver').getString(HOMESERVER_KEY) ?? null;
}

// ─── Session secret (sync, MMKV — session token only, not a key) ─────────────

export function setSessionSecret(sessionSecret: string): void {
  requireStore('setSessionSecret').set(SESSION_SECRET_KEY, sessionSecret);
}

export function getSessionSecret(): string | null {
  return requireStore('getSessionSecret').getString(SESSION_SECRET_KEY) ?? null;
}

// ─── Link session alias (sync, MMKV — opaque native handle, not a bearer) ────

export function setLinkSession(sessionAlias: string): void {
  requireStore('setLinkSession').set(LINK_SESSION_KEY, sessionAlias);
}

export function getLinkSession(): string | null {
  const read = readLinkSession();
  if (!read.ok) return null;
  return read.alias;
}

export function deleteLinkSession(): void {
  if (!isInitialized()) return;
  requireStore('deleteLinkSession').remove(LINK_SESSION_KEY);
}

/**
 * Compare-and-delete the link-session slot. Returns true only when the
 * stored alias matched and was removed. A different working alias is left
 * untouched.
 */
export function deleteLinkSessionIfAlias(alias: string): boolean {
  const read = readLinkSession();
  if (!read.ok || read.alias !== alias) return false;
  requireStore('deleteLinkSessionIfAlias').remove(LINK_SESSION_KEY);
  return true;
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
          : 0;
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
    const raw = requireStore('readAttachmentServiceIndex').getString(
      attachmentIndexKey(ownerPubky),
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch (err) {
    if (isKeyStoreNotReady(err)) throw err;
    return [];
  }
}

function writeAttachmentServiceIndex(ownerPubky: string, services: readonly string[]): void {
  requireStore('writeAttachmentServiceIndex').set(
    attachmentIndexKey(ownerPubky),
    JSON.stringify([...new Set(services)]),
  );
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
  requireStore('setAttachmentSecret');
  const service = attachmentKeyService(ownerPubky, senderPubky, eventId);
  const payload = JSON.stringify(material);
  try {
    await Keychain.setGenericPassword(KEYCHAIN_USERNAME, payload, {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (err) {
    if (!__DEV__ || !isUnsignedSimKeychainError(err)) throw err;
    requireStore('setAttachmentSecret').set(debugAttachmentStoreKey(service), payload);
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
    const raw = requireStore('getAttachmentSecret').getString(debugAttachmentStoreKey(service));
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
  requireStore('deleteAttachmentSecretByService');
  try {
    await Keychain.resetGenericPassword({ service });
  } catch {
    if (!__DEV__) return false;
  }
  if (__DEV__) {
    requireStore('deleteAttachmentSecretByService').remove(debugAttachmentStoreKey(service));
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
    requireStore('clearAttachmentSecretsForOwner').remove(attachmentIndexKey(ownerPubky));
  }
  return failed;
}

// ─── Session / cert validity ──────────────────────────────────────────────────

export async function hasPersistedSession(): Promise<boolean> {
  if (!isInitialized()) return false;
  const appKey = await getAppKeypair();
  return appKey !== null && requireStore('hasPersistedSession').contains(PUBKY_KEY);
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
  const mmkv = requireStore('clear');
  let owner: string | null = null;
  try {
    owner = mmkv.getString(PUBKY_KEY) ?? null;
  } catch {
    owner = null;
  }
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
    mmkv.remove(attachmentIndexKey(owner));
  }
  mmkv.remove(PUBKY_KEY);
  mmkv.remove(HOMESERVER_KEY);
  mmkv.remove(SESSION_SECRET_KEY);
  mmkv.remove(LINK_SESSION_KEY);
}

export const KeyStore = {
  // Initialization
  initKeyStore,
  isInitialized,
  readLinkSession,
  KeyStoreNotReady,
  isKeyStoreNotReady,
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
  deleteLinkSessionIfAlias,
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
