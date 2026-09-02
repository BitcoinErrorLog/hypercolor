import type { PubkyKey } from '../types';
import { isValidPubky } from '../utils/pubkyId';
import { KeyStore } from './KeyStore';
import { StorageService } from './StorageService';

/**
 * Owner recorded on the interrupted-sign-out marker. MMKV is preferred;
 * the SQL journal is the durable fallback when MMKV is the failing store
 * or still holds a pre-owner literal from an unreleased build.
 */
export async function readInterruptedSignOutOwner(): Promise<PubkyKey | null> {
  const fromMmkv = KeyStore.getSignOutIncompleteOwner();
  if (fromMmkv) return fromMmkv;
  const fromJournal = await StorageService.getSignOutIncompleteJournalOwner();
  if (fromJournal && isValidPubky(fromJournal)) return fromJournal;
  return null;
}

/**
 * Native session alias persisted next to the marker owner so a boot wipe
 * can call `signOutSession` without KeyStore still naming that owner.
 */
export async function readInterruptedSignOutAlias(owner: PubkyKey): Promise<string | null> {
  const fromMmkv = KeyStore.getSignOutIncompleteAlias();
  if (typeof fromMmkv === 'string' && fromMmkv.length > 0) return fromMmkv;
  return StorageService.getSignOutIncompleteJournalAlias(owner);
}
