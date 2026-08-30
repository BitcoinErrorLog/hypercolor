import {
  signIn as rnSignIn,
  signOut as rnSignOut,
  put as rnPut,
  get as rnGet,
  deleteFile as rnDeleteFile,
  list as rnList,
  getHomeserver as rnGetHomeserver,
  setEventListener,
  removeEventListener,
} from '@synonymdev/react-native-pubky';
import { computeInboxKid } from '../utils/PubkyNoiseModule';
import { KeyStore } from './KeyStore';
import type { UserProfile, PubkyKey } from '../types';

/**
 * PubkyService — homeserver interaction layer.
 *
 * Hypercolor uses a delegated AppKey (from pubky-ring) for all signing.
 * The root Ed25519 secret key is never held or used here.
 *
 * Publishes a KeyBinding on the homeserver after delegation so contacts
 * can discover our InboxKey, TransportKey, and AppKey via PKARR.
 */

export const DEFAULT_HOMESERVER = 'https://demo.pubky.app';

export type HomeserverListResult = { ok: true; urls: string[] } | { ok: false; message: string };

const APP_PATH = '/pub/hypercolor.app/v1';
const APP_ID = 'hypercolor';

// ─── Path builders ────────────────────────────────────────────────────────────

function profilePath(pubky: PubkyKey): string {
  return `pubky://${pubky}${APP_PATH}/profile.json`;
}

function contactPath(ownerPubky: PubkyKey, contactPubky: PubkyKey): string {
  return `pubky://${ownerPubky}${APP_PATH}/contacts/${contactPubky}.json`;
}

function outboxPath(senderPubky: PubkyKey, recipientPubky: PubkyKey, cursorMs: number): string {
  return `pubky://${senderPubky}${APP_PATH}/outbox/${recipientPubky}/${cursorMs}.bin`;
}

function outboxPrefixPath(senderPubky: PubkyKey, recipientPubky: PubkyKey): string {
  return `pubky://${senderPubky}${APP_PATH}/outbox/${recipientPubky}/`;
}

function channelOutboxPath(senderPubky: PubkyKey, channelId: string, cursorMs: number): string {
  return `pubky://${senderPubky}${APP_PATH}/channels/${channelId}/outbox/${cursorMs}.bin`;
}

function keyBindingPath(pubky: PubkyKey): string {
  return `pubky://${pubky}${APP_PATH}/keybinding.json`;
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

  // ── Outbox ─────────────────────────────────────────────────────────────────

  async publishOutboxEnvelope(
    senderPubky: PubkyKey,
    recipientPubky: PubkyKey,
    envelopeBase64: string,
  ): Promise<{ url: string; cursorMs: number }> {
    const appSk = await getAppSkOrThrow();
    const cursorMs = Date.now();
    const url = outboxPath(senderPubky, recipientPubky, cursorMs);
    unwrap(await rnPut(url, envelopeBase64, appSk));
    return { url, cursorMs };
  },

  async publishChannelEnvelope(
    senderPubky: PubkyKey,
    channelId: string,
    envelopeBase64: string,
  ): Promise<{ url: string; cursorMs: number }> {
    const appSk = await getAppSkOrThrow();
    const cursorMs = Date.now();
    const url = channelOutboxPath(senderPubky, channelId, cursorMs);
    unwrap(await rnPut(url, envelopeBase64, appSk));
    return { url, cursorMs };
  },

  async listOutboxAfter(
    senderPubky: PubkyKey,
    recipientPubky: PubkyKey,
    afterCursorMs: number,
  ): Promise<string[]> {
    try {
      const prefix = outboxPrefixPath(senderPubky, recipientPubky);
      const urls = unwrap(await rnList(prefix));
      return urls.filter(url => {
        const cursorStr = url.split('/').pop()?.replace('.bin', '');
        const cursor = parseInt(cursorStr ?? '0', 10);
        return cursor > afterCursorMs;
      });
    } catch {
      return [];
    }
  },

  async fetchEnvelope(_pubky: PubkyKey, url: string): Promise<string | null> {
    try {
      return unwrap(await rnGet(url));
    } catch {
      return null;
    }
  },

  async deleteEnvelope(_pubky: PubkyKey, url: string): Promise<void> {
    const appSk = await getAppSkOrThrow();
    unwrap(await rnDeleteFile(url, appSk));
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

  // ── KeyBinding (PUBKY_CRYPTO_SPEC §6.8) ───────────────────────────────────

  /**
   * Publishes a KeyBinding JSON to the homeserver after delegation.
   * This is how contacts discover our InboxKey, TransportKey, and AppKey.
   *
   * Per spec, KeyBinding should be discoverable via PKARR. Since we don't
   * have full PKARR publishing from JS, we publish it as a JSON document
   * on the homeserver at a well-known path, and contacts fetch it via
   * `getContactKeyBinding()`.
   */
  async publishKeyBinding(pubky: PubkyKey): Promise<void> {
    const appSk = await getAppSkOrThrow();
    const inboxKeypair = await KeyStore.getInboxKeypair();
    const transportKeypair = await KeyStore.getTransportKeypair();
    const appKeypair = await KeyStore.getAppKeypair();
    const appCert = await KeyStore.getAppCert();

    if (!inboxKeypair) throw new Error('No inbox keypair in KeyStore');

    const inboxKid = await computeInboxKid(inboxKeypair.publicKey);

    const keyBinding: KeyBindingDocument = {
      version: 1,
      app_id: APP_ID,
      peerid: pubky,
      inbox_keys: [
        {
          x25519_pub: inboxKeypair.publicKey,
          kid: inboxKid,
          key_version: 0,
        },
      ],
      transport_keys: transportKeypair
        ? [{ x25519_pub: transportKeypair.publicKey, key_version: 0 }]
        : [],
      app_keys:
        appKeypair && appCert
          ? [
              {
                ed25519_pub: appKeypair.publicKey,
                cert_id: appCert.certIdHex,
                cert_body: appCert.certBodyHex,
                cert_sig: appCert.sigHex,
              },
            ]
          : [],
      published_at: Math.floor(Date.now() / 1000),
    };

    const url = keyBindingPath(pubky);
    unwrap(await rnPut(url, JSON.stringify(keyBinding), appSk));
  },

  /**
   * Fetches a contact's KeyBinding to discover their InboxKey.
   * Falls back to the legacy `/inbox_key` path if no KeyBinding is found.
   */
  async getContactInboxKey(pubky: PubkyKey): Promise<string | null> {
    // Try KeyBinding first (spec-compliant discovery)
    try {
      const raw = await PubkyService.get(keyBindingPath(pubky));
      if (raw) {
        const kb = JSON.parse(raw) as KeyBindingDocument;
        if (kb.inbox_keys?.length > 0) {
          return kb.inbox_keys[0]!.x25519_pub;
        }
      }
    } catch {
      // Fall through to legacy path
    }

    // Legacy fallback: direct inbox_key publish
    try {
      const url = `pubky://${pubky}${APP_PATH}/inbox_key`;
      return unwrap(await rnGet(url));
    } catch {
      return null;
    }
  },

  /**
   * Publishes our X25519 inbox public key to the homeserver (legacy path).
   * New code should use `publishKeyBinding()` instead — this is kept for
   * backward compatibility with older clients.
   */
  async publishInboxKey(pubky: PubkyKey): Promise<void> {
    const appSk = await getAppSkOrThrow();
    const inboxKeypair = await KeyStore.getInboxKeypair();
    if (!inboxKeypair) throw new Error('No inbox keypair in KeyStore.');
    const url = `pubky://${pubky}${APP_PATH}/inbox_key`;
    unwrap(await rnPut(url, inboxKeypair.publicKey, appSk));
  },

  // ── SSE / event listeners ──────────────────────────────────────────────────

  async setEventListener(callback: (eventData: string) => void): Promise<void> {
    unwrap(await setEventListener(callback));
  },

  async removeEventListener(): Promise<void> {
    unwrap(await removeEventListener());
  },
};

// ─── KeyBinding document shape ────────────────────────────────────────────────

interface KeyBindingDocument {
  version: number;
  app_id: string;
  peerid: string;
  inbox_keys: Array<{
    x25519_pub: string;
    kid: string;
    key_version: number;
  }>;
  transport_keys: Array<{
    x25519_pub: string;
    key_version: number;
  }>;
  app_keys: Array<{
    ed25519_pub: string;
    cert_id: string;
    cert_body: string;
    cert_sig: string;
  }>;
  published_at: number;
}
