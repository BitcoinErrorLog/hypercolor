import { KeyStore } from '../services/KeyStore';
import { useAuthStore } from './authStore';

/**
 * After `KeyStore.initKeyStore()`, restore `isAuthenticated` from the
 * persisted Welcome identity (delegated AppKey + pubky). Does not create a
 * Paykit homeserver session — that comes from `LinkService.enable()`.
 */
export async function hydratePersistedAuth(): Promise<boolean> {
  if (!(await KeyStore.hasPersistedSession())) return false;
  const pubky = KeyStore.getPubky();
  const homeserver = KeyStore.getHomeserver();
  if (!pubky || !homeserver) return false;
  useAuthStore.getState().setAuthenticated(pubky, homeserver);
  return true;
}
