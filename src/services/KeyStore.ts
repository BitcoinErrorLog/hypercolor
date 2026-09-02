import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import * as Keychain from 'react-native-keychain';
import { createMMKV, type MMKV } from 'react-native-mmkv';
import { isValidPubky } from '../utils/pubkyId';

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
 * Encrypted MMKV (never opened without a 16-UTF-8-byte derived key):
 *   - pubky (root Ed25519 public key, z-base32)
 *   - homeserver URL
 *   - session_secret
 *   - link_session alias
 *
 * The MMKV encryption key is 96 bits, not 128. Nitro marshals
 * `encryptionKey` as UTF-8 (`arg.asString().utf8()`) and MMKVCore keeps
 * the first 16 bytes, so a 16-unit latin-1 string becomes ~24 UTF-8 bytes
 * and is truncated. HKDF-SHA256 still produces 16 bytes; those are
 * encoded as base64url and truncated to 16 single-byte characters.
 *
 * Readiness is a positive canary on the encrypted instance. MMKV encrypts
 * the whole file with one AES key: a wrong key discards the instance
 * (`OnErrorDiscard`) and continues as empty-and-writable. `installCanary`
 * then succeeds and the store reports ready-and-empty — `pubky` is gone
 * too, so `hasPersistedSession()` is false. Unreadable is
 * indistinguishable from a fresh install. The canary cannot detect a
 * wrong key; it only asserts that *this* instance round-trips a known
 * value. `getString` returning `undefined` is not an error channel.
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
 * entries on `KeyStore.clear()` / `KeyStore.clearIfPubky()`. Do not read or write secrets here.
 */
const LEGACY_LINK_RECEIVER_SECRET_SERVICE = 'hypercolor-link-receiver-secret';
const RING_PENDING_SERVICE = 'hypercolor-ring-pending';
const ATTACHMENT_KEY_SERVICE_PREFIX = 'hypercolor-attachment-key';

// ─── MMKV metadata keys ───────────────────────────────────────────────────────

const PUBKY_KEY = 'pubky';
const HOMESERVER_KEY = 'homeserver';
const SESSION_SECRET_KEY = 'session_secret';
const LINK_SESSION_KEY = 'link_session';
const SIGN_OUT_INCOMPLETE_KEY = 'sign_out_incomplete_owner';
const SIGN_OUT_INCOMPLETE_ALIAS_KEY = 'sign_out_incomplete_alias';
const SIGN_OUT_WIPE_FAILURES_KEY = 'sign_out_wipe_failures';
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
const ATTACHMENT_INDEX_PREFIX = 'attachment_key_services:';
/** DEBUG-only MMKV slot when unsigned iOS sim keychain returns -34018. */
const DEBUG_ATTACHMENT_PREFIX = 'debug.attachment:';
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

let _store: MMKV | null = null;
let _mmkvKeyPromise: Promise<void> | null = null;
/** True only after encrypted init verified the canary on the instance we hold. */
let _initialized = false;
/** Cached canary probe for `_store` only. Cleared when `_store` is cleared. */
let _canaryOk = false;

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

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const a = bytes[i]!;
    const b = remaining > 1 ? bytes[i + 1]! : 0;
    const c = remaining > 2 ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64URL_ALPHABET[(triple >> 18) & 63];
    out += BASE64URL_ALPHABET[(triple >> 12) & 63];
    if (remaining > 1) out += BASE64URL_ALPHABET[(triple >> 6) & 63];
    if (remaining > 2) out += BASE64URL_ALPHABET[triple & 63];
  }
  return out;
}

/**
 * 96-bit MMKV encryption key derived from the 32-byte keychain secret.
 * HKDF-SHA256 mixes the full secret into 16 bytes, then base64url and
 * take exactly 16 characters — 16 single-byte UTF-8 code points, which
 * is the MMKV 16-byte cap under nitro's UTF-8 marshalling. A 64-char hex
 * string was previously truncated to 16 ASCII chars (~64 bits).
 */
function deriveMmkvEncryptionKey(secretHex: string): string {
  const ikm = hexToBytes32(secretHex);
  const keyBytes = hkdf(sha256, ikm, undefined, MMKV_HKDF_INFO, MMKV_KEY_BYTE_LENGTH);
  const key = bytesToBase64Url(keyBytes).slice(0, MMKV_KEY_BYTE_LENGTH);
  assertMmkvEncryptionKeyLength(key);
  return key;
}

/** First 16 chars of the stored hex — the key MMKV actually used before HKDF. */
function legacyTruncatedMmkvKey(secretHex: string): string {
  if (secretHex.length < MMKV_KEY_BYTE_LENGTH) {
    throw new Error('KeyStore: legacy MMKV key is shorter than 16 UTF-8 bytes');
  }
  const truncated = secretHex.slice(0, MMKV_KEY_BYTE_LENGTH);
  assertMmkvEncryptionKeyLength(truncated);
  return truncated;
}

function assertMmkvEncryptionKeyLength(key: string): void {
  if (utf8ByteLength(key) !== MMKV_KEY_BYTE_LENGTH) {
    throw new Error(
      'KeyStore: MMKV encryptionKey must be exactly 16 UTF-8 bytes (96-bit; MMKV 16-byte key cap under UTF-8 marshalling)',
    );
  }
}

function openMmkv(id: string, encryptionKey: string): MMKV {
  assertMmkvEncryptionKeyLength(encryptionKey);
  return createMMKV({ id, encryptionKey });
}

function readCanary(instance: MMKV): string | undefined {
  return instance.getString(MMKV_CANARY_KEY);
}

function probeCanary(instance: MMKV): boolean {
  return readCanary(instance) === MMKV_CANARY_VALUE;
}

function canaryIsVerified(instance: MMKV): boolean {
  if (_store === instance && _canaryOk) return true;
  const ok = probeCanary(instance);
  if (_store === instance) _canaryOk = ok;
  return ok;
}

function installCanary(instance: MMKV): boolean {
  if (probeCanary(instance)) return true;
  try {
    instance.set(MMKV_CANARY_KEY, MMKV_CANARY_VALUE);
  } catch {
    return false;
  }
  return probeCanary(instance);
}

function isMigratableMmkvKey(key: string): boolean {
  return (
    key === PUBKY_KEY ||
    key === HOMESERVER_KEY ||
    key === SESSION_SECRET_KEY ||
    key === LINK_SESSION_KEY ||
    key.startsWith(ATTACHMENT_INDEX_PREFIX) ||
    key.startsWith(DEBUG_ATTACHMENT_PREFIX)
  );
}

function snapshotMigratableEntries(instance: MMKV): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of instance.getAllKeys()) {
    if (!isMigratableMmkvKey(key)) continue;
    const value = instance.getString(key);
    if (typeof value === 'string') out.set(key, value);
  }
  return out;
}

function entriesMatch(entries: Map<string, string>, dest: MMKV): boolean {
  for (const [key, value] of entries) {
    if (dest.getString(key) !== value) return false;
  }
  return true;
}

function copyAndVerify(entries: Map<string, string>, dest: MMKV): boolean {
  try {
    for (const [key, value] of entries) {
      dest.set(key, value);
    }
    return entriesMatch(entries, dest);
  } catch {
    return false;
  }
}

function clearStoreBestEffort(instance: MMKV): void {
  try {
    instance.clearAll();
  } catch {
    // Best-effort purge; leftover ciphertext must not block boot.
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
 * copies the legacy truncated-key store only after every key round-trips,
 * and installs the destination canary only after that verification. The
 * canary is the commit marker: it is never left on a store whose copy has
 * not verified. On any verification failure the destination is wiped so
 * no canary and no partial copy survive, and the legacy store stays
 * readable. A boot that finds a canary on `current` before the generation
 * is marked v2 re-verifies every remaining legacy key before committing.
 */
async function openEncryptedStore(secretHex: string): Promise<MMKV> {
  const derivedKey = deriveMmkvEncryptionKey(secretHex);
  const current = openMmkv(STORE_ID_CURRENT, derivedKey);
  const generation = await readStoreGeneration();

  if (generation === MMKV_GENERATION_V2) {
    try {
      const leftover = openMmkv(STORE_ID_LEGACY, legacyTruncatedMmkvKey(secretHex));
      clearStoreBestEffort(leftover);
    } catch {
      // Legacy file may already be gone.
    }
    if (!installCanary(current)) {
      throw new KeyStoreNotReady('initKeyStore');
    }
    return current;
  }

  const legacy = openMmkv(STORE_ID_LEGACY, legacyTruncatedMmkvKey(secretHex));
  const legacySnap = snapshotMigratableEntries(legacy);

  if (probeCanary(current)) {
    if (legacySnap.size === 0) {
      await markStoreGenerationV2();
      return current;
    }
    if (entriesMatch(legacySnap, current)) {
      await markStoreGenerationV2();
      clearStoreBestEffort(legacy);
      return current;
    }
    clearStoreBestEffort(current);
  }

  if (legacySnap.size > 0) {
    const copied = copyAndVerify(legacySnap, current);
    const verified = copied && entriesMatch(legacySnap, current);
    if (verified && installCanary(current)) {
      await markStoreGenerationV2();
      clearStoreBestEffort(legacy);
      return current;
    }
    clearStoreBestEffort(current);
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
    _canaryOk = false;
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
      _canaryOk = true;
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
    _canaryOk = false;
    throw err;
  }
}

/**
 * True only when the encrypted instance is held and the canary has been
 * verified on that instance. False before init and after a failed/hung
 * init. MMKV cannot produce a per-key undecryptable store: a wrong key
 * discards the whole file, so this returns true for ready-and-empty
 * (and `getPubky()` is then null).
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

// ─── Sign-out incomplete markers (survive clearIfPubky) ───────────────────────

/**
 * Survives `clearIfPubky()` so boot can complete the wipe before painting
 * any owner. Cleared only after a zero-error wipe. Marker reads/writes go
 * through `requireStore` so they throw `KeyStoreNotReady` before init.
 */
export function markSignOutIncomplete(ownerPubky: string): void {
  if (!isValidPubky(ownerPubky)) {
    throw new Error('KeyStore.markSignOutIncomplete: owner is required');
  }
  requireStore('markSignOutIncomplete').set(SIGN_OUT_INCOMPLETE_KEY, ownerPubky);
}

export function isSignOutIncomplete(): boolean {
  return getSignOutIncompleteOwner() !== null;
}

export function getSignOutIncompleteOwner(): string | null {
  const value = requireStore('getSignOutIncompleteOwner').getString(SIGN_OUT_INCOMPLETE_KEY);
  if (typeof value !== 'string' || value.length === 0) return null;
  return isValidPubky(value) ? value : null;
}

export function markSignOutIncompleteAlias(alias: string): void {
  if (!alias || alias.length === 0) {
    throw new Error('KeyStore.markSignOutIncompleteAlias: alias is required');
  }
  requireStore('markSignOutIncompleteAlias').set(SIGN_OUT_INCOMPLETE_ALIAS_KEY, alias);
}

export function getSignOutIncompleteAlias(): string | null {
  const value = requireStore('getSignOutIncompleteAlias').getString(SIGN_OUT_INCOMPLETE_ALIAS_KEY);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function clearSignOutIncomplete(): void {
  const store = requireStore('clearSignOutIncomplete');
  store.remove(SIGN_OUT_INCOMPLETE_KEY);
  store.remove(SIGN_OUT_INCOMPLETE_ALIAS_KEY);
}

export function setSignOutWipeFailureCount(ownerPubky: string, count: number): void {
  if (!isValidPubky(ownerPubky) || !Number.isInteger(count) || count < 0) {
    throw new Error('KeyStore.setSignOutWipeFailureCount: owner and count required');
  }
  requireStore('setSignOutWipeFailureCount').set(
    SIGN_OUT_WIPE_FAILURES_KEY,
    `${ownerPubky}:${count}`,
  );
}

export function getSignOutWipeFailureCount(ownerPubky: string): number {
  const raw = requireStore('getSignOutWipeFailureCount').getString(SIGN_OUT_WIPE_FAILURES_KEY);
  if (typeof raw !== 'string' || !raw.startsWith(`${ownerPubky}:`)) return 0;
  const n = Number(raw.slice(ownerPubky.length + 1));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function clearSignOutWipeFailures(ownerPubky: string): void {
  const store = requireStore('clearSignOutWipeFailures');
  const raw = store.getString(SIGN_OUT_WIPE_FAILURES_KEY);
  if (typeof raw === 'string' && raw.startsWith(`${ownerPubky}:`)) {
    store.remove(SIGN_OUT_WIPE_FAILURES_KEY);
  }
}

/**
 * Compare-and-clear: wipe identity material only while KeyStore still names
 * `expectedPubky`. Returns false without touching another owner's secrets.
 * The sign-out-incomplete marker is not removed.
 */
export async function clearIfPubky(expectedPubky: string): Promise<boolean> {
  if (getPubky() !== expectedPubky) return false;
  await clearAttachmentSecretsForOwner(expectedPubky);
  if (getPubky() !== expectedPubky) return false;
  const mmkv = requireStore('clearIfPubky');
  await Promise.all([
    deleteAppKeypair(),
    Keychain.resetGenericPassword({ service: INBOX_KEY_SERVICE }),
    Keychain.resetGenericPassword({ service: TRANSPORT_KEY_SERVICE }),
    Keychain.resetGenericPassword({ service: APP_CERT_SERVICE }),
    Keychain.resetGenericPassword({ service: LEGACY_LINK_RECEIVER_SECRET_SERVICE }),
    Keychain.resetGenericPassword({ service: RING_PENDING_SERVICE }),
  ]);
  if (getPubky() !== expectedPubky) return false;
  mmkv.remove(attachmentIndexKey(expectedPubky));
  mmkv.remove(PUBKY_KEY);
  mmkv.remove(HOMESERVER_KEY);
  mmkv.remove(SESSION_SECRET_KEY);
  mmkv.remove(LINK_SESSION_KEY);
  return true;
}

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
  // Sign-out incomplete markers
  markSignOutIncomplete,
  isSignOutIncomplete,
  getSignOutIncompleteOwner,
  markSignOutIncompleteAlias,
  getSignOutIncompleteAlias,
  clearSignOutIncomplete,
  setSignOutWipeFailureCount,
  getSignOutWipeFailureCount,
  clearSignOutWipeFailures,
  // Session
  hasPersistedSession,
  clear,
  clearIfPubky,
};
