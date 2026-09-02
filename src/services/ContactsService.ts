import { PROFILE_HYDRATE_CONCURRENCY } from '../flags/config';
import type { Contact, PubkyKey } from '../types';
import { isValidPubky, parsePubky } from '../utils/pubkyId';
import { createNexusClient, type NexusClientApi, type NexusResult } from './NexusClient';
import { PubkyService, type HomeserverListResult } from './PubkyService';
import { StorageService } from './StorageService';
import { FollowsImportSettings } from './contacts/followsImportSettings';

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
  /** GET a homeserver path. Used to re-check Nexus following ids. */
  get?: (url: string) => Promise<string | null>;
  isBlocked?: (ownerPubky: PubkyKey, pubky: PubkyKey) => boolean;
  onManualAdd?: (ownerPubky: PubkyKey, pubky: PubkyKey) => void;
  nexus: NexusClientApi;
  storage: {
    upsertContact: typeof StorageService.upsertContact;
    getContact: typeof StorageService.getContact;
    getAllContacts: typeof StorageService.getAllContacts;
    setContactRelationshipFlags: typeof StorageService.setContactRelationshipFlags;
    deleteContact?: typeof StorageService.deleteContact;
    deleteFollowSuggestions?: typeof StorageService.deleteFollowSuggestions;
  };
};

export type ImportFollowsResult =
  | { ok: true; imported: number; followees: PubkyKey[] }
  | { ok: false; imported: 0; followees: []; message: string };

export type ImportFollowsRefreshResult =
  | { skipped: true; imported: 0; followees: []; usedNexusFallback: false }
  | (ImportFollowsResult & { skipped: false; usedNexusFallback: boolean });

export type SyncRelationshipsResult = {
  following: number;
  followers: number;
  friends: number;
  nexusReachable: boolean;
  nexusError: string | null;
};

export type AddContactResult =
  | { ok: true; contact: Contact }
  | {
      ok: false;
      reason: 'invalid-pubky' | 'not-found' | 'duplicate' | 'self' | 'error';
      message: string;
      details?: string;
    };

const DEFAULT_PAGE = 200;

function followDocumentUrl(ownerPubky: PubkyKey, followee: PubkyKey): string {
  return `pubky://${ownerPubky}${PUBKY_APP_FOLLOWS_SEGMENT}${followee}`;
}

async function persistFollowees(
  deps: ContactsServiceDeps,
  ownerPubky: PubkyKey,
  followees: PubkyKey[],
): Promise<void> {
  await mapPool(followees, PROFILE_HYDRATE_CONCURRENCY, async followee => {
    const existing = await deps.storage.getContact(followee, ownerPubky);
    const profile = await deps.getProfile(followee);
    const contact = mergeContact(ownerPubky, followee, existing, {
      isFollowing: true,
      profile,
    });
    await deps.storage.upsertContact(contact);
  });
}

function skipFollowee(
  deps: ContactsServiceDeps,
  ownerPubky: PubkyKey,
  followee: PubkyKey,
  seen: Set<string>,
): boolean {
  if (!followee || followee === ownerPubky || seen.has(followee)) return true;
  if (deps.isBlocked?.(ownerPubky, followee)) return true;
  return false;
}

export function createContactsService(deps: ContactsServiceDeps) {
  const service = {
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
        if (!followee || skipFollowee(deps, ownerPubky, followee, seen)) continue;
        seen.add(followee);
        followees.push(followee);
      }

      await persistFollowees(deps, ownerPubky, followees);
      return { ok: true, imported: followees.length, followees };
    },

    /**
     * Homeserver listing first. Only if that listing fails does this ask Nexus
     * for **following** (never followers) and re-check each id against the
     * homeserver follow document.
     */
    async importFollowsWithNexusFallback(
      ownerPubky: PubkyKey,
    ): Promise<ImportFollowsResult & { usedNexusFallback: boolean }> {
      const listed = await deps.list(followsDirUrl(ownerPubky));
      if (listed.ok) {
        const followees: PubkyKey[] = [];
        const seen = new Set<string>();
        for (const url of listed.urls) {
          const followee = parseFolloweeFromUrl(url);
          if (!followee || skipFollowee(deps, ownerPubky, followee, seen)) continue;
          seen.add(followee);
          followees.push(followee);
        }
        await persistFollowees(deps, ownerPubky, followees);
        return { ok: true, imported: followees.length, followees, usedNexusFallback: false };
      }

      const followingResult = await collectAllPages(query =>
        deps.nexus.following(ownerPubky, query),
      );
      if (followingResult.error !== null) {
        return {
          ok: false,
          imported: 0,
          followees: [],
          message: listed.message,
          usedNexusFallback: true,
        };
      }

      const confirmed: PubkyKey[] = [];
      const seen = new Set<string>();
      for (const candidate of followingResult.ids) {
        if (skipFollowee(deps, ownerPubky, candidate, seen)) continue;
        seen.add(candidate);
        if (!deps.get) continue;
        const document = await deps.get(followDocumentUrl(ownerPubky, candidate));
        if (document == null || document.length === 0) continue;
        confirmed.push(candidate);
      }

      await persistFollowees(deps, ownerPubky, confirmed);
      return {
        ok: true,
        imported: confirmed.length,
        followees: confirmed,
        usedNexusFallback: true,
      };
    },

    /**
     * Product gate: no homeserver follows read and no Nexus request unless the
     * per-owner consent flag is already on.
     */
    async refreshFollowsIfEnabled(
      ownerPubky: PubkyKey,
      followsImportEnabled: boolean,
    ): Promise<ImportFollowsRefreshResult> {
      if (!followsImportEnabled) {
        return { skipped: true, imported: 0, followees: [], usedNexusFallback: false };
      }
      const result = await service.importFollowsWithNexusFallback(ownerPubky);
      return { ...result, skipped: false };
    },

    async stopUsingFollows(ownerPubky: PubkyKey): Promise<void> {
      const rows = await deps.storage.getAllContacts(ownerPubky);
      if (deps.storage.deleteFollowSuggestions) {
        await deps.storage.deleteFollowSuggestions(ownerPubky);
      } else {
        for (const row of rows) {
          if (!row.addedManually && deps.storage.deleteContact) {
            await deps.storage.deleteContact(ownerPubky, row.pubky);
          }
        }
      }
      for (const row of rows) {
        if (!row.addedManually) continue;
        await deps.storage.setContactRelationshipFlags(ownerPubky, row.pubky, {
          isFollowing: false,
          isFollower: false,
          isMutual: false,
        });
      }
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
      if (pubky === ownerPubky) {
        return {
          ok: false,
          reason: 'self',
          message: 'You cannot add your own pubky.',
        };
      }
      try {
        const existing = await deps.storage.getContact(pubky, ownerPubky);
        if (existing?.addedManually) {
          return {
            ok: false,
            reason: 'duplicate',
            message: 'This pubky is already in your contacts.',
          };
        }
        const homeserver = await deps.getHomeserver(pubky);
        if (!homeserver) {
          return {
            ok: false,
            reason: 'not-found',
            message: 'No homeserver found for that pubky. Check the key and try again.',
          };
        }
        const profile = await deps.getProfile(pubky);
        const contact = mergeContact(ownerPubky, pubky, existing, {
          addedManually: true,
          homeserver,
          profile,
        });
        await deps.storage.upsertContact(contact);
        deps.onManualAdd?.(ownerPubky, pubky);
        return { ok: true, contact };
      } catch (err) {
        return {
          ok: false,
          reason: 'error',
          message: 'Could not add that contact.',
          details: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
  return service;
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
  get: url => PubkyService.get(url),
  isBlocked: (owner, pubky) => FollowsImportSettings.isBlocked(owner, pubky),
  onManualAdd: (owner, pubky) => FollowsImportSettings.unblock(owner, pubky),
  nexus: createNexusClient(),
  storage: {
    upsertContact: c => StorageService.upsertContact(c),
    getContact: (pubky, owner) => StorageService.getContact(pubky, owner),
    getAllContacts: owner => StorageService.getAllContacts(owner),
    setContactRelationshipFlags: (owner, pubky, flags) =>
      StorageService.setContactRelationshipFlags(owner, pubky, flags),
    deleteContact: (owner, pubky) => StorageService.deleteContact(owner, pubky),
    deleteFollowSuggestions: owner => StorageService.deleteFollowSuggestions(owner),
  },
});
