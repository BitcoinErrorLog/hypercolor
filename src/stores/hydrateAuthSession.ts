import { KeyStore } from '../services/KeyStore';
import { PubkyService } from '../services/PubkyService';
import { resetPaintOverlayForBoot } from '../services/paintedOwner';
import { useAuthStore } from './authStore';

/**
 * After `KeyStore.initKeyStore()`, restore `isAuthenticated` from the
 * persisted Welcome identity (delegated AppKey + pubky). Does not create a
 * Paykit homeserver session — that comes from `LinkService.enable()`.
 * Completes an interrupted sign-out before painting any owner.
 */
export async function hydratePersistedAuth(): Promise<boolean> {
  if (await PubkyService.hasInterruptedSignOut()) {
    await PubkyService.completeInterruptedSignOut();
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
