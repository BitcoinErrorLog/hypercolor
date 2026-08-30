import {
  signOut as rnSignOut,
  get as rnGet,
  list as rnList,
  getHomeserver as rnGetHomeserver,
} from '@synonymdev/react-native-pubky';
import { KeyStore } from './KeyStore';
import { LinkService } from './link/LinkService';
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

// ─── PubkyService ─────────────────────────────────────────────────────────────

export const PubkyService = {
  // ── Auth ──────────────────────────────────────────────────────────────────

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

  // ── Contacts ───────────────────────────────────────────────────────────────

  async publishContact(ownerPubky: PubkyKey, contactPubky: PubkyKey): Promise<void> {
    const payload = JSON.stringify({ pubky: contactPubky, addedAt: Date.now() });
    await PubkyService.put(contactPath(ownerPubky, contactPubky), payload);
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
