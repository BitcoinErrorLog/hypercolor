import {
  signOut as rnSignOut,
  get as rnGet,
  list as rnList,
  getHomeserver as rnGetHomeserver,
} from '@synonymdev/react-native-pubky';
import { KeyStore } from './KeyStore';
import { LinkService } from './link/LinkService';
import { clearDeferredPublicJoin } from '../stores/deferredPublicJoin';
import { StorageService } from './StorageService';
import {
  claimWipeInFlight,
  ensureSignOutPaint,
  invalidateSignOutRestore,
  paintNeedsSignIn,
  pendingWipeInFlight,
  restorePaintedOwner,
  waitForWipeInFlight,
  WIPE_WAIT_TIMEOUT_MS,
  WipeWaitTimeoutError,
} from './paintedOwner';
import {
  resetAppDataAfterFailedWipe,
  shouldOfferResetAfterFailedWipe,
} from './resetAfterFailedWipe';
import { readInterruptedSignOutAlias, readInterruptedSignOutOwner } from './signOutMarker';
import { useAuthStore } from '../stores/authStore';
import type { UserProfile, PubkyKey } from '../types';

/**
 * PubkyService — homeserver interaction layer.
 *
 * Owner writes (attachments, backup, public channels, profile, contacts)
 * go through the Paykit ChatSession created by `LinkService.enable()` /
 * `startAuthFlow`. AppCert is UKD signing only — it does not authorize
 * homeserver PUT.
 *
 * Public reads use react-native-pubky get/list (no session). Encrypted DMs
 * stay on Paykit Encrypted Links.
 */

export type HomeserverListResult = { ok: true; urls: string[] } | { ok: false; message: string };

const APP_PATH = '/pub/hypercolor.app/v1';

/** Fixed log string when the interrupted-sign-out marker cannot be read. */
export const INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE = 'interrupted sign-out marker unreadable';

// ─── Path builders ────────────────────────────────────────────────────────────

function profilePath(pubky: PubkyKey): string {
  return `pubky://${pubky}${APP_PATH}/profile.json`;
}

function unwrap<T>(result: { isOk(): boolean; value?: T; error?: Error }): T {
  if (!result.isOk()) {
    throw result.error ?? new Error('Unknown pubky operation error');
  }
  return result.value as T;
}

async function finishIdentityClear(owner: PubkyKey): Promise<void> {
  let identityCleared = false;
  try {
    await KeyStore.clearIfPubky(owner);
    identityCleared = true;
    if (KeyStore.getSignOutIncompleteOwner() === owner) {
      KeyStore.clearSignOutIncomplete();
    }
    KeyStore.clearSignOutWipeFailures(owner);
    try {
      await StorageService.clearSignOutIncompleteJournal(owner);
    } catch {
      // Journal clear is best-effort once the wipe completed.
    }
    try {
      await StorageService.clearSignOutWipeFailureCount(owner);
    } catch {
      // Counter clear is best-effort once the wipe completed.
    }
  } catch (err) {
    try {
      KeyStore.markSignOutIncomplete(owner);
    } catch {
      // Boot still has the SQL journal or getPubky().
    }
    if (identityCleared) {
      // Identity is gone but marker/counter clear failed — force Welcome so
      // the user is not stuck authenticated with no owner until next boot.
      try {
        useAuthStore.getState().clearSession();
      } catch {
        // Store may already be cold.
      }
      paintNeedsSignIn();
    }
    throw err;
  }
}

// ─── PubkyService ─────────────────────────────────────────────────────────────

export const PubkyService = {
  // ── Auth ──────────────────────────────────────────────────────────────────

  async signOut(): Promise<void> {
    while (pendingWipeInFlight()) {
      await waitForWipeInFlight();
    }
    const release = claimWipeInFlight();
    try {
      let previousOwner = KeyStore.getPubky();
      if (!previousOwner) {
        // Mid-failure finishIdentityClear may have cleared identity while
        // leaving the interrupted marker — fall back to the marker owner.
        previousOwner = await readInterruptedSignOutOwner();
      }
      if (!previousOwner) {
        throw new Error('sign-out requires an owner');
      }
      const generation = ensureSignOutPaint();
      try {
        const sessionSecret = KeyStore.getSessionSecret();
        if (sessionSecret) {
          try {
            unwrap(await rnSignOut(sessionSecret));
          } catch {
            // Best-effort
          }
        }
        // Full messaging teardown while the current-owner identity is still
        // readable. Identity clear runs only after a zero-error wipe.
        await LinkService.clearSession({ owner: previousOwner });
        clearDeferredPublicJoin(previousOwner);
      } catch (err) {
        restorePaintedOwner(previousOwner, generation);
        throw err;
      }
      await finishIdentityClear(previousOwner);
      paintNeedsSignIn();
    } finally {
      release();
    }
  },

  async hasInterruptedSignOut(): Promise<boolean> {
    try {
      if (KeyStore.isSignOutIncomplete()) return true;
      return await StorageService.hasSignOutIncompleteJournal();
    } catch (err) {
      throw err instanceof Error ? err : new Error(INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE);
    }
  },

  async completeInterruptedSignOut(): Promise<void> {
    while (pendingWipeInFlight()) {
      await waitForWipeInFlight();
    }
    // Claim before any marker await so concurrent boot + sign-in cannot
    // both enter and inflate the boot-wipe failure counter.
    const release = claimWipeInFlight();
    try {
      const owner = await readInterruptedSignOutOwner();
      if (!owner) return;
      const alias = await readInterruptedSignOutAlias(owner);
      ensureSignOutPaint();
      invalidateSignOutRestore();
      await LinkService.clearSession({ owner, alias, restorable: false });
      await finishIdentityClear(owner);
      paintNeedsSignIn();
    } finally {
      release();
    }
  },

  /**
   * Sign-in paths wait here so a boot wipe cannot clear a freshly written
   * identity. Shows the existing Welcome loading state while it awaits.
   * Races completion against {@link WIPE_WAIT_TIMEOUT_MS}; timeout rejects
   * retryable and does not clear the in-flight gate.
   */
  async awaitSignOutWipe(): Promise<void> {
    await waitForWipeInFlight();
    let interrupted: boolean;
    try {
      interrupted = await PubkyService.hasInterruptedSignOut();
    } catch {
      throw new Error(INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE);
    }
    if (!interrupted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        PubkyService.completeInterruptedSignOut(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new WipeWaitTimeoutError());
          }, WIPE_WAIT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  },

  shouldOfferResetAfterFailedWipe,
  resetAppDataAfterFailedWipe,

  // ── Profile ────────────────────────────────────────────────────────────────

  async publishProfile(pubky: PubkyKey, profile: Omit<UserProfile, 'pubky'>): Promise<void> {
    const payload = JSON.stringify({ ...profile, pubky });
    await PubkyService.put(profilePath(pubky), payload);
  },

  async getProfile(pubky: PubkyKey): Promise<UserProfile | null> {
    try {
      const raw = unwrap(await rnGet(profilePath(pubky)));
      return JSON.parse(raw) as UserProfile;
    } catch {
      return PubkyService.getPubkyAppProfile(pubky);
    }
  },

  /**
   * Reads the official pubky.app profile (`/pub/pubky.app/profile.json`,
   * fields `name` / `image` per pubky-app-specs). Used to hydrate contacts
   * imported from homeserver follows. 404 / missing → null.
   */
  async getPubkyAppProfile(pubky: PubkyKey): Promise<UserProfile | null> {
    const raw = await PubkyService.get(`pubky://${pubky}/pub/pubky.app/profile.json`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as {
        name?: unknown;
        image?: unknown;
        status?: unknown;
      };
      if (typeof parsed.name !== 'string' || parsed.name.length === 0) return null;
      const profile: UserProfile = {
        pubky,
        displayName: parsed.name,
        updatedAt: Date.now(),
      };
      if (typeof parsed.image === 'string' && parsed.image.length > 0) {
        profile.avatarHash = parsed.image;
      }
      if (typeof parsed.status === 'string' && parsed.status.length > 0) {
        profile.status = parsed.status;
      }
      return profile;
    } catch {
      return null;
    }
  },

  // ── Discovery ──────────────────────────────────────────────────────────────

  async getHomeserver(pubky: PubkyKey): Promise<string | null> {
    try {
      return unwrap(await rnGetHomeserver(pubky));
    } catch {
      return null;
    }
  },

  // ── Generic put/get/delete/list ────────────────────────────────────────────

  async put(url: string, content: string): Promise<void> {
    await LinkService.putOwnerDocument(url, content);
  },

  async get(url: string): Promise<string | null> {
    try {
      return unwrap(await rnGet(url));
    } catch {
      return null;
    }
  },

  async delete(url: string): Promise<void> {
    await LinkService.deleteOwnerDocument(url);
  },

  async list(urlPrefix: string): Promise<HomeserverListResult> {
    try {
      return { ok: true, urls: unwrap(await rnList(urlPrefix)) };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
