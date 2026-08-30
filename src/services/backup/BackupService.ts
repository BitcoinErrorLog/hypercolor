import { Buffer } from 'buffer';
import { KeyStore } from '../KeyStore';
import { PubkyService } from '../PubkyService';
import { StorageService } from '../StorageService';
import { PaykitLinkNative } from '../link/PaykitLinkNative';
import { fromBase64Url, toBase64Url } from '../attachments/fileIo';
import { OWNER_BACKUP_VERSION, type OwnerBackupSnapshot } from './snapshot';

export type { OwnerBackupSnapshot } from './snapshot';
export { OWNER_BACKUP_VERSION } from './snapshot';

/**
 * Multi-device backup uses a random 32-byte recovery code (native
 * `generateAttachmentKey`), not a user passphrase.
 *
 * There is no vetted PBKDF2/scrypt on this stack without a new dependency.
 * Stretching a low-entropy passphrase with iterated SHA would be hand-rolled
 * crypto. The recovery code is shown once and must be written down / stored
 * in Ring. Ciphertext is AEAD-bound to the backup path.
 *
 * Device-bound secrets are never included: receiver Noise alias, session
 * alias, link snapshots, attachment content keys. After restore, history
 * is local again; live links re-handshake; attachments without keys show
 * as unavailable-from-backup until re-shared.
 */

const BACKUP_PATH_SUFFIX = '/pub/hypercolor.app/v1/backup/latest';

export function backupLatestUrl(ownerPubky: string): string {
  return `pubky://${ownerPubky}${BACKUP_PATH_SUFFIX}`;
}

export const BackupService = {
  /**
   * Collect owner-scoped data, encrypt under a fresh recovery code, upload
   * ciphertext to the owner's homeserver. Returns the recovery code once.
   */
  async exportBackup(): Promise<{ recoveryCode: string; path: string }> {
    const owner = requireOwner();
    const snapshot = await StorageService.collectOwnerBackup(owner);
    const path = backupLatestUrl(owner);
    const recoveryCode = await PaykitLinkNative.generateAttachmentKey();
    const plaintextB64 = utf8ToBase64Url(JSON.stringify(snapshot));
    const cipher = await PaykitLinkNative.attachmentEncrypt(plaintextB64, recoveryCode, path);
    const blob = JSON.stringify({
      version: 1,
      algorithm: cipher.algorithm,
      nonceB64: cipher.nonceB64,
      ciphertextB64: cipher.ciphertextB64,
    });
    await PubkyService.put(path, blob);
    return { recoveryCode, path };
  },

  /**
   * Download, AAD-decrypt, validate version/owner, import with upsert /
   * insert-or-ignore semantics.
   */
  async restoreBackup(recoveryCode: string): Promise<void> {
    const owner = requireOwner();
    const code = recoveryCode.trim();
    if (code.length === 0) {
      throw new Error('Recovery code is required');
    }
    const path = backupLatestUrl(owner);
    const raw = await PubkyService.get(path);
    if (!raw) {
      throw new Error('No backup found on this account');
    }
    const blob = parseBackupBlob(raw);
    const plaintextB64 = await PaykitLinkNative.attachmentDecrypt(
      blob.ciphertextB64,
      code,
      blob.nonceB64,
      path,
    );
    const snapshot = parseSnapshot(base64UrlToUtf8(plaintextB64));
    if (snapshot.ownerPubky !== owner) {
      throw new Error('Backup belongs to a different account');
    }
    await StorageService.importOwnerBackup(owner, snapshot);
  },
};

function requireOwner(): string {
  const owner = KeyStore.getPubky();
  if (!owner) throw new Error('BackupService: no active account');
  return owner;
}

function utf8ToBase64Url(text: string): string {
  return toBase64Url(Buffer.from(text, 'utf8').toString('base64'));
}

function base64UrlToUtf8(b64url: string): string {
  return Buffer.from(fromBase64Url(b64url), 'base64').toString('utf8');
}

function parseBackupBlob(raw: string): {
  ciphertextB64: string;
  nonceB64: string;
} {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Backup blob is not valid JSON');
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Backup blob is malformed');
  }
  const rec = value as Record<string, unknown>;
  if (rec.version !== 1) {
    throw new Error(`Unsupported backup blob version: ${String(rec.version)}`);
  }
  if (typeof rec.ciphertextB64 !== 'string' || typeof rec.nonceB64 !== 'string') {
    throw new Error('Backup blob is missing ciphertext');
  }
  return { ciphertextB64: rec.ciphertextB64, nonceB64: rec.nonceB64 };
}

function parseSnapshot(json: string): OwnerBackupSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Backup snapshot is not valid JSON');
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Backup snapshot is malformed');
  }
  const rec = value as OwnerBackupSnapshot;
  if (rec.version !== OWNER_BACKUP_VERSION) {
    throw new Error(`Unsupported backup snapshot version: ${String(rec.version)}`);
  }
  if (typeof rec.ownerPubky !== 'string' || rec.ownerPubky.length === 0) {
    throw new Error('Backup snapshot is missing owner');
  }
  if (!Array.isArray(rec.contacts) || !Array.isArray(rec.linkMessages)) {
    throw new Error('Backup snapshot is missing required collections');
  }
  return rec;
}
