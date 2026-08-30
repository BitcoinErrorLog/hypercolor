import {
  signIn as rnSignIn,
  signOut as rnSignOut,
  put as rnPut,
  get as rnGet,
  deleteFile as rnDeleteFile,
  list as rnList,
  getHomeserver as rnGetHomeserver,
} from '@synonymdev/react-native-pubky';
import { KeyStore } from './KeyStore';
import { LinkService } from './link/LinkService';
import type { UserProfile, PubkyKey } from '../types';

/**
 * PubkyService — homeserver interaction layer.
 *
 * Hypercolor uses a delegated AppKey (from pubky-ring) for all signing.
 * The root Ed25519 secret key is never held or used here.
 *
 * Profile / follows / public-channel / attachment / backup writes use
 * generic put/get/list. Encrypted DMs go through Paykit Encrypted Links,
 * not the research-era outbox/KeyBinding paths (removed in M6).
 */

export const DEFAULT_HOMESERVER = 'https://demo.pubky.app';

export type HomeserverListResult = { ok: true; urls: string[] } | { ok: false; message: string };

const APP_PATH = '/pub/hypercolor.app/v1';

// ─── Path builders ────────────────────────────────────────────────────────────

function profilePath(pubky: PubkyKey): string {
  return `pubky://${pubky}${APP_PATH}/profile.json`;
}

function contactPath(ownerPubky: PubkyKey, contactPubky: PubkyKey): string {
  return `pubky://${ownerPubky}${APP_PATH}/contacts/${contactPubky}.json`;
}

function unwrap<T>(result: { isOk(): boolean; value?: T; error?: Error }): T {
  if (!result.isOk()) {
    throw result.error ?? new Error('Unknown pubky operation error');
  }
  return result.value as T;
}

async function getAppSkOrThrow(): Promise<string> {
  // Check AppCert validity before using AppKey
  const certValid = await KeyStore.isAppCertValid();
  if (!certValid) {
    throw new Error('AppCert has expired. Re-authorize Hypercolor with pubky-ring.');
  }

  const keypair = await KeyStore.getAppKeypair();
  if (!keypair) {
    throw new Error('No delegated AppKey found. Connect Hypercolor to pubky-ring first.');
  }
  return keypair.secretKey;
}

// ─── PubkyService ─────────────────────────────────────────────────────────────

export const PubkyService = {
  // ── Auth ──────────────────────────────────────────────────────────────────

  async signIn(): Promise<string> {
    const appSk = await getAppSkOrThrow();
    const session = unwrap(await rnSignIn(appSk));
    KeyStore.setSessionSecret(session.session_secret);
    return session.pubky;
  },

  async signOut(): Promise<void> {
    const sessionSecret = KeyStore.getSessionSecret();
    if (sessionSecret) {
      try {
        unwrap(await rnSignOut(sessionSecret));
      } catch {
        // Best-effort
      }
    }
    // Full messaging teardown (KeyStore attachment keys, cache, SQL) while
    // the current-owner identity is still readable. Identity clear is last.
    await LinkService.clearSession();
    await KeyStore.clear();
  },

  // ── Profile ────────────────────────────────────────────────────────────────

  async publishProfile(pubky: PubkyKey, profile: Omit<UserProfile, 'pubky'>): Promise<void> {
    const appSk = await getAppSkOrThrow();
    const payload = JSON.stringify({ ...profile, pubky });
    unwrap(await rnPut(profilePath(pubky), payload, appSk));
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

  // ── Contacts ───────────────────────────────────────────────────────────────

  async publishContact(ownerPubky: PubkyKey, contactPubky: PubkyKey): Promise<void> {
    const appSk = await getAppSkOrThrow();
    const payload = JSON.stringify({ pubky: contactPubky, addedAt: Date.now() });
    unwrap(await rnPut(contactPath(ownerPubky, contactPubky), payload, appSk));
  },

  // ── Generic put/get/delete/list ────────────────────────────────────────────

  async put(url: string, content: string): Promise<void> {
    const appSk = await getAppSkOrThrow();
    unwrap(await rnPut(url, content, appSk));
  },

  async get(url: string): Promise<string | null> {
    try {
      return unwrap(await rnGet(url));
    } catch {
      return null;
    }
  },

  async delete(url: string): Promise<void> {
    const appSk = await getAppSkOrThrow();
    unwrap(await rnDeleteFile(url, appSk));
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
