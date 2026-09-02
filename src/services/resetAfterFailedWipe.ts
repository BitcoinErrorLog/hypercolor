import { closeAndDeleteSqliteDatabase } from '../db';
import type { PubkyKey } from '../types';
import { KeyStore } from './KeyStore';
import { PaykitLinkNative } from './link/PaykitLinkNative';
import { activeOwnerAtCommit, paintNeedsSignIn, SIGNING_OUT } from './paintedOwner';
import { readInterruptedSignOutAlias, readInterruptedSignOutOwner } from './signOutMarker';
import { StorageService } from './StorageService';

/** Distinct boot launches whose wipe failed before Welcome offers a coarse reset. */
export const BOOT_WIPE_FAILURES_BEFORE_RESET = 2;

export class ResetAppDataError extends Error {
  readonly code = 'reset-app-data-failed';
  readonly retryable = true;

  constructor() {
    super('reset-app-data-failed');
    this.name = 'ResetAppDataError';
  }
}

export function isResetAppDataError(err: unknown): err is ResetAppDataError {
  if (err instanceof ResetAppDataError) return true;
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 'reset-app-data-failed';
}

async function wipeFailureCount(owner: PubkyKey): Promise<number> {
  let journal = 0;
  try {
    journal = await StorageService.getSignOutWipeFailureCount(owner);
  } catch {
    journal = 0;
  }
  return Math.max(KeyStore.getSignOutWipeFailureCount(owner), journal);
}

/**
 * Count a boot-path wipe failure. In-app sign-out and same-launch
 * `awaitSignOutWipe` retries must not call this — the counter is
 * "distinct launches", owner-stamped like the markers.
 */
export async function recordBootWipeFailure(): Promise<void> {
  const owner = await readInterruptedSignOutOwner();
  if (!owner) return;
  const next = (await wipeFailureCount(owner)) + 1;
  try {
    KeyStore.setSignOutWipeFailureCount(owner, next);
  } catch {
    // SQL journal may still land.
  }
  try {
    await StorageService.persistSignOutWipeFailureCount(owner, next);
  } catch {
    // MMKV half may still have landed.
  }
}

export async function shouldOfferResetAfterFailedWipe(): Promise<boolean> {
  try {
    if (!KeyStore.isSignOutIncomplete() && !(await StorageService.hasSignOutIncompleteJournal())) {
      return false;
    }
  } catch {
    return false;
  }
  const owner = await readInterruptedSignOutOwner();
  if (!owner) return false;
  return (await wipeFailureCount(owner)) >= BOOT_WIPE_FAILURES_BEFORE_RESET;
}

function foreignLiveOwner(markerOwner: PubkyKey): boolean {
  const live = KeyStore.getPubky();
  if (typeof live === 'string' && live.length > 0 && live !== markerOwner) return true;
  const painted = activeOwnerAtCommit();
  return painted !== SIGNING_OUT && painted !== null && painted !== markerOwner;
}

/**
 * Coarse last-resort wipe after repeated boot retries. Destructive steps
 * run first; markers and the failure counter clear last and only on
 * zero-error. Never runs against a different live owner than the marker.
 */
export async function resetAppDataAfterFailedWipe(): Promise<void> {
  if (!(await shouldOfferResetAfterFailedWipe())) {
    throw new ResetAppDataError();
  }
  const owner = await readInterruptedSignOutOwner();
  if (!owner) throw new ResetAppDataError();
  if (foreignLiveOwner(owner)) throw new ResetAppDataError();

  const alias = await readInterruptedSignOutAlias(owner);

  try {
    closeAndDeleteSqliteDatabase();
    await KeyStore.clearIfPubky(owner);
    if (alias) {
      await PaykitLinkNative.signOutSession(alias);
    }
    if (KeyStore.getPubky() === owner) {
      await PaykitLinkNative.clearAllNativeSecrets();
    }
  } catch {
    throw new ResetAppDataError();
  }

  if (KeyStore.getSignOutIncompleteOwner() === owner) {
    KeyStore.clearSignOutIncomplete();
  }
  KeyStore.clearSignOutWipeFailures(owner);
  paintNeedsSignIn();
}
