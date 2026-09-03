import { closeAndDeleteSqliteDatabase } from '../db';
import type { PubkyKey } from '../types';
import { KeyStore } from './KeyStore';
import { PaykitLinkNative } from './link/PaykitLinkNative';
import { activeOwnerAtCommit, paintNeedsSignIn, SIGNING_OUT } from './paintedOwner';
import { readInterruptedSignOutAlias, readInterruptedSignOutOwner } from './signOutMarker';
import { StorageService } from './StorageService';

/** Distinct boot launches whose wipe failed before Welcome offers a coarse reset. */
export const BOOT_WIPE_FAILURES_BEFORE_RESET = 2;

/**
 * Counter key for an interrupted-sign-out marker whose owner row is
 * missing/invalid: the failure cannot be attributed to an owner, so it is
 * stamped on this opaque sentinel. Never a valid pubky, so the MMKV half of
 * the counter refuses it and only the SQL journal half lands.
 */
export const UNKNOWN_MARKER_OWNER = 'interrupted-sign-out-owner-unknown';

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
 * "distinct launches", owner-stamped like the markers. A marker whose
 * owner cannot be read counts under {@link UNKNOWN_MARKER_OWNER} so the
 * reset hatch still opens instead of looping Welcome forever.
 */
export async function recordBootWipeFailure(): Promise<void> {
  const owner = await readInterruptedSignOutOwner();
  const counterKey = owner ?? UNKNOWN_MARKER_OWNER;
  const next = (await wipeFailureCount(counterKey)) + 1;
  try {
    KeyStore.setSignOutWipeFailureCount(counterKey, next);
  } catch {
    // SQL journal may still land.
  }
  try {
    await StorageService.persistSignOutWipeFailureCount(counterKey, next);
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
  const counterKey = owner ?? UNKNOWN_MARKER_OWNER;
  return (await wipeFailureCount(counterKey)) >= BOOT_WIPE_FAILURES_BEFORE_RESET;
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
 * A marker with no readable owner resets only when nothing is live or
 * painted (any live owner is foreign to {@link UNKNOWN_MARKER_OWNER});
 * owner-scoped steps (alias sign-out, native wipe, identity clear) are
 * skipped because there is no owner to scope them to.
 */
export async function resetAppDataAfterFailedWipe(): Promise<void> {
  if (!(await shouldOfferResetAfterFailedWipe())) {
    throw new ResetAppDataError();
  }
  const owner = await readInterruptedSignOutOwner();
  const counterKey = owner ?? UNKNOWN_MARKER_OWNER;
  if (foreignLiveOwner(counterKey)) throw new ResetAppDataError();

  const alias = owner ? await readInterruptedSignOutAlias(owner) : null;
  // Capture before clearIfPubky removes PUBKY_KEY — otherwise the native
  // wipe gate can never fire on a successful identity clear.
  const namedOwner = owner !== null && KeyStore.getPubky() === owner;

  try {
    closeAndDeleteSqliteDatabase();
    if (alias) {
      await PaykitLinkNative.signOutSession(alias);
    }
    if (namedOwner) {
      await PaykitLinkNative.clearAllNativeSecrets();
    }
    if (owner) {
      await KeyStore.clearIfPubky(owner);
    }
  } catch {
    throw new ResetAppDataError();
  }

  if (owner === null || KeyStore.getSignOutIncompleteOwner() === owner) {
    // Ownerless journal marker: MMKV can hold at most a stale invalid
    // literal (a valid MMKV owner would have been read above) — clear it.
    KeyStore.clearSignOutIncomplete();
  }
  KeyStore.clearSignOutWipeFailures(counterKey);
  paintNeedsSignIn();
}
