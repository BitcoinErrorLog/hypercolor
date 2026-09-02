import { KeyStore } from '../services/KeyStore';
import { PubkyService } from '../services/PubkyService';
import { paintNeedsSignIn, resetPaintOverlayForBoot } from '../services/paintedOwner';
import { useAuthStore } from './authStore';

const INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE = 'interrupted sign-out marker unreadable';

/**
 * After `KeyStore.initKeyStore()`, restore `isAuthenticated` from the
 * persisted Welcome identity (delegated AppKey + pubky). Does not create a
 * Paykit homeserver session — that comes from `LinkService.enable()`.
 * Completes an interrupted sign-out before painting any owner.
 */
export async function hydratePersistedAuth(): Promise<boolean> {
  let interrupted: boolean;
  try {
    interrupted = await PubkyService.hasInterruptedSignOut();
  } catch {
    console.warn(INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE);
    paintNeedsSignIn();
    return false;
  }
  if (interrupted) {
    try {
      await PubkyService.completeInterruptedSignOut();
    } catch {
      // Wipe failed: keep identity, keep markers, leave signing-out paint.
    }
    return false;
  }
  resetPaintOverlayForBoot();
  if (!(await KeyStore.hasPersistedSession())) return false;
  const pubky = KeyStore.getPubky();
  const homeserver = KeyStore.getHomeserver();
  if (!pubky || !homeserver) return false;
  useAuthStore.getState().setAuthenticated(pubky, homeserver);
  return true;
}
