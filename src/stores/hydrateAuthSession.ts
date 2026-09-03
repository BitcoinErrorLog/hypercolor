import { KeyStore } from '../services/KeyStore';
import { PubkyService } from '../services/PubkyService';
import { paintNeedsSignIn, resetPaintOverlayForBoot } from '../services/paintedOwner';
import { recordBootWipeFailure } from '../services/resetAfterFailedWipe';
import { useAuthStore } from './authStore';

const INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE = 'interrupted sign-out marker unreadable';

export type InterruptedSignOutBootResult = 'none' | 'wiped' | 'wipe-failed' | 'unreadable';

/**
 * Consume an interrupted sign-out marker before boot reconcile / auth paint.
 * Marker reads go through KeyStore.requireStore (throws KeyStoreNotReady
 * before init). Call once after `KeyStore.initKeyStore()` and before
 * report-only reconcile + normal hydrate.
 */
export async function consumeInterruptedSignOutAtBoot(): Promise<InterruptedSignOutBootResult> {
  let interrupted: boolean;
  try {
    interrupted = await PubkyService.hasInterruptedSignOut();
  } catch {
    console.warn(INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE);
    paintNeedsSignIn();
    return 'unreadable';
  }
  if (!interrupted) return 'none';
  try {
    await PubkyService.completeInterruptedSignOut();
    return 'wiped';
  } catch {
    await recordBootWipeFailure();
    return 'wipe-failed';
  }
}

/**
 * After `KeyStore.initKeyStore()`, interrupted-sign-out consume, and
 * report-only boot reconcile, restore `isAuthenticated` from the persisted
 * Welcome identity (delegated AppKey + pubky). Does not create a Paykit
 * homeserver session — that comes from `LinkService.enable()`.
 *
 * App owns {@link consumeInterruptedSignOutAtBoot} (once per process,
 * before reconcile). This hydrate only refuses to paint when a marker
 * remains — it must not re-consume or double-count boot wipe failures.
 */
export async function hydratePersistedAuth(): Promise<boolean> {
  if (!KeyStore.isInitialized()) return false;
  let interrupted: boolean;
  try {
    interrupted = await PubkyService.hasInterruptedSignOut();
  } catch {
    console.warn(INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE);
    paintNeedsSignIn();
    return false;
  }
  if (interrupted) return false;
  // Only clear the overlay when we are about to paint a live session.
  // A successful consume leaves needs-sign-in; resetting here would wipe it
  // (HEAD hydrate returned early on wipe !== 'none' and never reset).
  if (!(await KeyStore.hasPersistedSession())) return false;
  const pubky = KeyStore.getPubky();
  const homeserver = KeyStore.getHomeserver();
  if (!pubky || !homeserver) return false;
  resetPaintOverlayForBoot();
  useAuthStore.getState().setAuthenticated(pubky, homeserver);
  return true;
}
