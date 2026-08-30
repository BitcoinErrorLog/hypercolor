import { PROFILE_HYDRATE_CONCURRENCY } from '../flags/config';
import type { Contact, PubkyKey } from '../types';
import { isValidPubky, parsePubky } from '../utils/pubkyId';
import { createNexusClient, type NexusClientApi, type NexusResult } from './NexusClient';
import { PubkyService, type HomeserverListResult } from './PubkyService';
import { StorageService } from './StorageService';

/**
 * pubky.app follows directory, verified against pubky-app-specs
 * `SPEC.md` (PubkyAppFollow) and `src/models/follow.rs`:
 *   URI: /pub/pubky.app/follows/:user_id
 *   Full: pubky://<owner>/pub/pubky.app/follows/<followee-pubky>
 * The followee pubky IS the record id.
 */
export const PUBKY_APP_FOLLOWS_SEGMENT = '/pub/pubky.app/follows/';

export function followsDirUrl(ownerPubky: PubkyKey): string {
  return `pubky://${ownerPubky}${PUBKY_APP_FOLLOWS_SEGMENT}`;
}

/**
 * Parses a followee pubky out of a homeserver list URL.
 * Accepts `pubky://…/pub/pubky.app/follows/<id>` or a path-only form.
 */
export function parseFolloweeFromUrl(url: string): PubkyKey | null {
  const cleaned = (url.split('?')[0] ?? url).replace(/\/+$/, '');
  const idx = cleaned.indexOf(PUBKY_APP_FOLLOWS_SEGMENT);
  if (idx === -1) return null;
  const rest = cleaned.slice(idx + PUBKY_APP_FOLLOWS_SEGMENT.length);
  const followee = (rest.split('/')[0] ?? '').toLowerCase();
  return isValidPubky(followee) ? followee : null;
}

export type ContactsServiceDeps = {
  list: (urlPrefix: string) => Promise<HomeserverListResult>;
  getProfile: (pubky: PubkyKey) => Promise<{
    displayName: string;
    avatarHash?: string;
  } | null>;
  getHomeserver: (pubky: PubkyKey) => Promise<string | null>;
  nexus: NexusClientApi;
  storage: {
    upsertContact: typeof StorageService.upsertContact;
    getContact: typeof StorageService.getContact;
    getAllContacts: typeof StorageService.getAllContacts;
    setContactRelationshipFlags: typeof StorageService.setContactRelationshipFlags;
  };
};

export type ImportFollowsResult =
  | { ok: true; imported: number; followees: PubkyKey[] }
  | { ok: false; imported: 0; followees: []; message: string };

export type SyncRelationshipsResult = {
  following: number;
  followers: number;
  friends: number;
  nexusReachable: boolean;
  nexusError: string | null;
};

export type AddContactResult =
  | { ok: true; contact: Contact }
  | { ok: false; reason: 'invalid-pubky' | 'not-found' | 'error'; message: string };

const DEFAULT_PAGE = 200;

export function createContactsService(deps: ContactsServiceDeps) {
  return {
    async importFollows(ownerPubky: PubkyKey): Promise<ImportFollowsResult> {
      const listed = await deps.list(followsDirUrl(ownerPubky));
      if (!listed.ok) {
        return { ok: false, imported: 0, followees: [], message: listed.message };
      }
      const urls = listed.urls;
      const followees: PubkyKey[] = [];
      const seen = new Set<string>();
      for (const url of urls) {
        const followee = parseFolloweeFromUrl(url);
        if (!followee || followee === ownerPubky || seen.has(followee)) continue;
        seen.add(followee);
        followees.push(followee);
      }

      await mapPool(followees, PROFILE_HYDRATE_CONCURRENCY, async followee => {
        const existing = await deps.storage.getContact(followee, ownerPubky);
        const profile = await deps.getProfile(followee);
        const contact = mergeContact(ownerPubky, followee, existing, {
          isFollowing: true,
          profile,
        });
        await deps.storage.upsertContact(contact);
      });

      return { ok: true, imported: followees.length, followees };
    },

    async syncRelationships(ownerPubky: PubkyKey): Promise<SyncRelationshipsResult> {
      const [followingResult, followersResult, friendsResult] = await Promise.all([
        collectAllPages(query => deps.nexus.following(ownerPubky, query)),
        collectAllPages(query => deps.nexus.followers(ownerPubky, query)),
        collectAllPages(query => deps.nexus.friends(ownerPubky, query)),
      ]);

      const nexusError =
        followingResult.error ?? followersResult.error ?? friendsResult.error ?? null;
      if (nexusError !== null) {
        return {
          following: followingResult.ids.length,
          followers: followersResult.ids.length,
          friends: friendsResult.ids.length,
          nexusReachable: false,
          nexusError,
        };
      }

      const following = new Set(followingResult.ids);
      const followers = new Set(followersResult.ids);
      const friends = new Set(friendsResult.ids);
      const existingRows = await deps.storage.getAllContacts(ownerPubky);
      const everyone = new Set<PubkyKey>([
        ...followingResult.ids,
        ...followersResult.ids,
        ...friendsResult.ids,
        ...existingRows.map(row => row.pubky),
      ]);
      const followingAuthoritative = followingResult.authoritative;

      await mapPool([...everyone], PROFILE_HYDRATE_CONCURRENCY, async peer => {
        const existing = await deps.storage.getContact(peer, ownerPubky);
        const isFollowing = followingAuthoritative
          ? following.has(peer) || friends.has(peer)
          : following.has(peer) || friends.has(peer) || (existing?.isFollowing ?? false);
        const isFollower = followers.has(peer) || friends.has(peer);
        const isMutual = friends.has(peer) || (isFollowing && isFollower);
        const contact = mergeContact(ownerPubky, peer, existing, {
          isFollowing,
          isFollower,
          isMutual,
        });
        await deps.storage.upsertContact(contact);
        await deps.storage.setContactRelationshipFlags(ownerPubky, peer, {
          isFollowing,
          isFollower,
          isMutual,
        });
      });

      return {
        following: following.size,
        followers: followers.size,
        friends: friends.size,
        nexusReachable: nexusError === null,
        nexusError,
      };
    },

    async addManualContact(ownerPubky: PubkyKey, rawPubky: string): Promise<AddContactResult> {
      const pubky = parsePubky(rawPubky);
      if (!pubky) {
        return {
          ok: false,
          reason: 'invalid-pubky',
          message: 'Not a valid 52-character z-base-32 pubky.',
        };
      }
      try {
        const homeserver = await deps.getHomeserver(pubky);
        if (!homeserver) {
          return {
            ok: false,
            reason: 'not-found',
            message: 'No homeserver found for that pubky. Check the key and try again.',
          };
        }
        const profile = await deps.getProfile(pubky);
        const existing = await deps.storage.getContact(pubky, ownerPubky);
        const contact = mergeContact(ownerPubky, pubky, existing, {
          addedManually: true,
          homeserver,
          profile,
        });
        await deps.storage.upsertContact(contact);
        return { ok: true, contact };
      } catch (err) {
        return {
          ok: false,
          reason: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

function mergeContact(
  ownerPubky: PubkyKey,
  pubky: PubkyKey,
  existing: Contact | null,
  patch: {
    isFollowing?: boolean;
    isFollower?: boolean;
    isMutual?: boolean;
    addedManually?: boolean;
    homeserver?: string;
    profile?: { displayName: string; avatarHash?: string } | null;
  },
): Contact {
  const isFollowing = patch.isFollowing ?? existing?.isFollowing ?? false;
  const isFollower = patch.isFollower ?? existing?.isFollower ?? false;
  const isMutual = patch.isMutual ?? (isFollowing && isFollower);
  const contact: Contact = {
    pubky,
    ownerPubky,
    trustScore: existing?.trustScore ?? 0,
    isFollowing,
    isFollower,
    isMutual,
    addedManually: patch.addedManually === true || (existing?.addedManually ?? false),
    firstSeenAt: existing?.firstSeenAt ?? Date.now(),
  };
  const displayName = patch.profile?.displayName ?? existing?.displayName;
  if (displayName) contact.displayName = displayName;
  const avatarHash = patch.profile?.avatarHash ?? existing?.avatarHash;
  if (avatarHash) contact.avatarHash = avatarHash;
  const homeserver = patch.homeserver ?? existing?.homeserver;
  if (homeserver) contact.homeserver = homeserver;
  if (existing?.lastInteractionAt !== undefined) {
    contact.lastInteractionAt = existing.lastInteractionAt;
  }
  return contact;
}

async function collectAllPages(
  fetchPage: (query: { skip: number; limit: number }) => Promise<NexusResult<PubkyKey[]>>,
): Promise<{ ids: PubkyKey[]; error: string | null; authoritative: boolean }> {
  const ids: PubkyKey[] = [];
  let skip = 0;
  for (;;) {
    const page = await fetchPage({ skip, limit: DEFAULT_PAGE });
    if (!page.ok) {
      if (page.kind === 'http' && page.status === 404) {
        return { ids, error: null, authoritative: false };
      }
      return { ids, error: page.message, authoritative: false };
    }
    ids.push(...page.value);
    if (page.value.length < DEFAULT_PAGE) return { ids, error: null, authoritative: true };
    skip += DEFAULT_PAGE;
  }
}

async function mapPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  async function run(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await worker(items[i]!);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => run()));
}

export const ContactsService = createContactsService({
  list: url => PubkyService.list(url),
  getProfile: async pubky => {
    const profile = await PubkyService.getProfile(pubky);
    if (!profile) return null;
    return {
      displayName: profile.displayName,
      ...(profile.avatarHash !== undefined ? { avatarHash: profile.avatarHash } : {}),
    };
  },
  getHomeserver: pubky => PubkyService.getHomeserver(pubky),
  nexus: createNexusClient(),
  storage: {
    upsertContact: c => StorageService.upsertContact(c),
    getContact: (pubky, owner) => StorageService.getContact(pubky, owner),
    getAllContacts: owner => StorageService.getAllContacts(owner),
    setContactRelationshipFlags: (owner, pubky, flags) =>
      StorageService.setContactRelationshipFlags(owner, pubky, flags),
  },
});
