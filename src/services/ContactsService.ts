import { PROFILE_HYDRATE_CONCURRENCY } from '../flags/config';
import type { Contact, PubkyKey } from '../types';
import { isValidPubky, parsePubky } from '../utils/pubkyId';
import { createNexusClient, type NexusClientApi, type NexusResult } from './NexusClient';
import { PubkyService, type HomeserverListResult } from './PubkyService';
import { StorageService } from './StorageService';
import { FollowsImportSettings } from './contacts/followsImportSettings';
import { unblockPeer } from './contacts/blockPeer';
import { CONTACTS_COPY } from '../ui/contacts/contactsCopy';

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
  /** Fail-closed choke for import skip (denied or deny-state unavailable). */
  isPeerDenied?: (ownerPubky: PubkyKey, pubky: PubkyKey) => boolean;
  /**
   * Lift deny + terminal declined after the user confirmed Unblock.
   * Called only after a successful contact persist (fail closed).
   */
  onConfirmedUnblock?: (ownerPubky: PubkyKey, pubky: PubkyKey) => void | Promise<void>;
  /** Authoritative consent lookup. Fail closed when omitted. */
  isFollowsImportEnabled: (ownerPubky: PubkyKey) => boolean;
  setFollowsImportEnabled: (ownerPubky: PubkyKey, enabled: boolean) => void;
  nexus: NexusClientApi;
  storage: {
    upsertContact: typeof StorageService.upsertContact;
    getContact: typeof StorageService.getContact;
    getAllContacts: typeof StorageService.getAllContacts;
    setContactRelationshipFlags: typeof StorageService.setContactRelationshipFlags;
    deleteContact?: typeof StorageService.deleteContact;
    deleteFollowSuggestions?: typeof StorageService.deleteFollowSuggestions;
    reconcileFollowSuggestions?: typeof StorageService.reconcileFollowSuggestions;
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

export type AddManualContactOptions = {
  /** Set only after the Unblock-and-add confirmation sheet. */
  confirmUnblock?: boolean;
};

export type AddContactResult =
  | { ok: true; contact: Contact }
  | {
      ok: false;
      reason: 'invalid-pubky' | 'not-found' | 'duplicate' | 'self' | 'error' | 'blocked';
      message: string;
      details?: string;
    };

const DEFAULT_PAGE = 200;
const IMPORT_OFF_MESSAGE = 'Follows import is off.';

function followDocumentUrl(ownerPubky: PubkyKey, followee: PubkyKey): string {
  return `pubky://${ownerPubky}${PUBKY_APP_FOLLOWS_SEGMENT}${followee}`;
}

function consentOn(deps: ContactsServiceDeps, ownerPubky: PubkyKey): boolean {
  if (!ownerPubky) return false;
  return deps.isFollowsImportEnabled(ownerPubky) === true;
}

function withOwnerLock<T>(
  locks: Map<string, Promise<unknown>>,
  ownerPubky: PubkyKey,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(ownerPubky) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    ownerPubky,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function cancelledNexusPage(): NexusResult<PubkyKey[]> {
  return { ok: false, kind: 'http', status: null, message: IMPORT_OFF_MESSAGE };
}

const CONSENT_OFF_RELATIONSHIPS: SyncRelationshipsResult = {
  following: 0,
  followers: 0,
  friends: 0,
  nexusReachable: false,
  nexusError: IMPORT_OFF_MESSAGE,
};

function skipFollowee(
  deps: ContactsServiceDeps,
  ownerPubky: PubkyKey,
  followee: PubkyKey,
  seen: Set<string>,
): boolean {
  if (!followee || followee === ownerPubky || seen.has(followee)) return true;
  if (deps.isPeerDenied?.(ownerPubky, followee) ?? deps.isBlocked?.(ownerPubky, followee)) {
    return true;
  }
  return false;
}

export function createContactsService(deps: ContactsServiceDeps) {
  const importGeneration = new Map<string, number>();
  const ownerLocks = new Map<string, Promise<unknown>>();

  function currentGeneration(ownerPubky: PubkyKey): number {
    return importGeneration.get(ownerPubky) ?? 0;
  }

  function bumpGeneration(ownerPubky: PubkyKey): number {
    const next = currentGeneration(ownerPubky) + 1;
    importGeneration.set(ownerPubky, next);
    return next;
  }

  function writeStillValid(ownerPubky: PubkyKey, generation: number): boolean {
    return consentOn(deps, ownerPubky) && currentGeneration(ownerPubky) === generation;
  }

  function stillFetching(ownerPubky: PubkyKey, generation: number): () => boolean {
    return () => writeStillValid(ownerPubky, generation);
  }

  function guardedNexusPage(
    ownerPubky: PubkyKey,
    generation: number,
    fetchPage: (query: { skip: number; limit: number }) => Promise<NexusResult<PubkyKey[]>>,
  ): (query: { skip: number; limit: number }) => Promise<NexusResult<PubkyKey[]>> {
    return query => {
      if (!writeStillValid(ownerPubky, generation)) {
        return Promise.resolve(cancelledNexusPage());
      }
      return fetchPage(query);
    };
  }

  async function hydrateFollowees(
    ownerPubky: PubkyKey,
    generation: number,
    followees: PubkyKey[],
  ): Promise<Contact[] | null> {
    const hydrated: Contact[] = [];
    await mapPool(followees, PROFILE_HYDRATE_CONCURRENCY, async followee => {
      if (!writeStillValid(ownerPubky, generation)) return;
      const existing = await deps.storage.getContact(followee, ownerPubky);
      if (!writeStillValid(ownerPubky, generation)) return;
      const profile = await deps.getProfile(followee);
      if (!writeStillValid(ownerPubky, generation)) return;
      hydrated.push(
        mergeContact(ownerPubky, followee, existing, {
          isFollowing: true,
          profile,
        }),
      );
    });
    if (!writeStillValid(ownerPubky, generation)) return null;
    return hydrated;
  }

  async function persistIfCurrent(
    ownerPubky: PubkyKey,
    generation: number,
    followees: PubkyKey[],
    reconcile: boolean,
  ): Promise<boolean> {
    const hydrated = await hydrateFollowees(ownerPubky, generation, followees);
    if (hydrated === null) return false;
    return withOwnerLock(ownerLocks, ownerPubky, async () => {
      if (!writeStillValid(ownerPubky, generation)) return false;
      for (const contact of hydrated) {
        if (!writeStillValid(ownerPubky, generation)) return false;
        await deps.storage.upsertContact(contact);
      }
      if (reconcile && deps.storage.reconcileFollowSuggestions) {
        if (!writeStillValid(ownerPubky, generation)) return false;
        await deps.storage.reconcileFollowSuggestions(ownerPubky, followees);
      }
      return writeStillValid(ownerPubky, generation);
    });
  }

  const service = {
    async importFollows(ownerPubky: PubkyKey): Promise<ImportFollowsResult> {
      if (!consentOn(deps, ownerPubky)) {
        return { ok: false, imported: 0, followees: [], message: IMPORT_OFF_MESSAGE };
      }
      const generation = currentGeneration(ownerPubky);
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

      const wrote = await persistIfCurrent(ownerPubky, generation, followees, true);
      if (!wrote) {
        return { ok: false, imported: 0, followees: [], message: IMPORT_OFF_MESSAGE };
      }
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
      if (!consentOn(deps, ownerPubky)) {
        return {
          ok: false,
          imported: 0,
          followees: [],
          message: IMPORT_OFF_MESSAGE,
          usedNexusFallback: false,
        };
      }
      const generation = currentGeneration(ownerPubky);
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
        const wrote = await persistIfCurrent(ownerPubky, generation, followees, true);
        if (!wrote) {
          return {
            ok: false,
            imported: 0,
            followees: [],
            message: IMPORT_OFF_MESSAGE,
            usedNexusFallback: false,
          };
        }
        return { ok: true, imported: followees.length, followees, usedNexusFallback: false };
      }

      if (!consentOn(deps, ownerPubky)) {
        return {
          ok: false,
          imported: 0,
          followees: [],
          message: IMPORT_OFF_MESSAGE,
          usedNexusFallback: false,
        };
      }

      const still = stillFetching(ownerPubky, generation);
      const followingResult = await collectAllPages(
        guardedNexusPage(ownerPubky, generation, query => deps.nexus.following(ownerPubky, query)),
        still,
      );
      if (!writeStillValid(ownerPubky, generation)) {
        return {
          ok: false,
          imported: 0,
          followees: [],
          message: IMPORT_OFF_MESSAGE,
          usedNexusFallback: false,
        };
      }
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
        if (!writeStillValid(ownerPubky, generation)) break;
        const document = await deps.get(followDocumentUrl(ownerPubky, candidate));
        if (document == null || document.length === 0) continue;
        confirmed.push(candidate);
      }

      const wrote = await persistIfCurrent(ownerPubky, generation, confirmed, false);
      if (!wrote) {
        return {
          ok: false,
          imported: 0,
          followees: [],
          message: IMPORT_OFF_MESSAGE,
          usedNexusFallback: true,
        };
      }
      return {
        ok: true,
        imported: confirmed.length,
        followees: confirmed,
        usedNexusFallback: true,
      };
    },

    /**
     * Product gate: no homeserver follows read and no Nexus request unless the
     * persisted per-owner consent flag is on at call time. Caller booleans
     * are ignored.
     */
    async refreshFollowsIfEnabled(ownerPubky: PubkyKey): Promise<ImportFollowsRefreshResult> {
      if (!consentOn(deps, ownerPubky)) {
        return { skipped: true, imported: 0, followees: [], usedNexusFallback: false };
      }
      const generation = currentGeneration(ownerPubky);
      const result = await service.importFollowsWithNexusFallback(ownerPubky);
      if (!writeStillValid(ownerPubky, generation)) {
        return { skipped: true, imported: 0, followees: [], usedNexusFallback: false };
      }
      return { ...result, skipped: false };
    },

    async stopUsingFollows(ownerPubky: PubkyKey): Promise<void> {
      deps.setFollowsImportEnabled(ownerPubky, false);
      bumpGeneration(ownerPubky);
      await withOwnerLock(ownerLocks, ownerPubky, async () => {
        const rows = await deps.storage.getAllContacts(ownerPubky);
        try {
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
        } catch (err) {
          const details = err instanceof Error ? err.message : String(err);
          throw new Error(`Could not stop using follows. ${details}`);
        }
      });
    },

    async syncRelationships(ownerPubky: PubkyKey): Promise<SyncRelationshipsResult> {
      if (!consentOn(deps, ownerPubky)) {
        return { ...CONSENT_OFF_RELATIONSHIPS };
      }
      const generation = currentGeneration(ownerPubky);
      const still = stillFetching(ownerPubky, generation);

      const followingResult = await collectAllPages(
        guardedNexusPage(ownerPubky, generation, query => deps.nexus.following(ownerPubky, query)),
        still,
      );
      if (!writeStillValid(ownerPubky, generation)) {
        return { ...CONSENT_OFF_RELATIONSHIPS };
      }
      if (followingResult.error !== null) {
        return {
          following: followingResult.ids.length,
          followers: 0,
          friends: 0,
          nexusReachable: false,
          nexusError: followingResult.error,
        };
      }

      const followersResult = await collectAllPages(
        guardedNexusPage(ownerPubky, generation, query => deps.nexus.followers(ownerPubky, query)),
        still,
      );
      if (!writeStillValid(ownerPubky, generation)) {
        return { ...CONSENT_OFF_RELATIONSHIPS };
      }
      if (followersResult.error !== null) {
        return {
          following: followingResult.ids.length,
          followers: followersResult.ids.length,
          friends: 0,
          nexusReachable: false,
          nexusError: followersResult.error,
        };
      }

      const friendsResult = await collectAllPages(
        guardedNexusPage(ownerPubky, generation, query => deps.nexus.friends(ownerPubky, query)),
        still,
      );
      if (!writeStillValid(ownerPubky, generation)) {
        return { ...CONSENT_OFF_RELATIONSHIPS };
      }
      if (friendsResult.error !== null) {
        return {
          following: followingResult.ids.length,
          followers: followersResult.ids.length,
          friends: friendsResult.ids.length,
          nexusReachable: false,
          nexusError: friendsResult.error,
        };
      }

      const following = new Set(followingResult.ids);
      const followers = new Set(followersResult.ids);
      const friends = new Set(friendsResult.ids);
      const followingAuthoritative = followingResult.authoritative;

      const wrote = await withOwnerLock(ownerLocks, ownerPubky, async () => {
        if (!writeStillValid(ownerPubky, generation)) return false;
        const existingRows = await deps.storage.getAllContacts(ownerPubky);
        if (!writeStillValid(ownerPubky, generation)) return false;
        const everyone = new Set<PubkyKey>([
          ...followingResult.ids,
          ...followersResult.ids,
          ...friendsResult.ids,
          ...existingRows.map(row => row.pubky),
        ]);

        const seen = new Set<string>();
        await mapPool([...everyone], PROFILE_HYDRATE_CONCURRENCY, async peer => {
          if (!writeStillValid(ownerPubky, generation)) return;
          if (skipFollowee(deps, ownerPubky, peer, seen)) return;
          seen.add(peer);
          const existing = await deps.storage.getContact(peer, ownerPubky);
          if (!writeStillValid(ownerPubky, generation)) return;
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
          if (!writeStillValid(ownerPubky, generation)) return;
          await deps.storage.setContactRelationshipFlags(ownerPubky, peer, {
            isFollowing,
            isFollower,
            isMutual,
          });
        });
        return writeStillValid(ownerPubky, generation);
      });

      if (!wrote) {
        return { ...CONSENT_OFF_RELATIONSHIPS };
      }

      return {
        following: following.size,
        followers: followers.size,
        friends: friends.size,
        nexusReachable: true,
        nexusError: null,
      };
    },

    async addManualContact(
      ownerPubky: PubkyKey,
      rawPubky: string,
      options?: AddManualContactOptions,
    ): Promise<AddContactResult> {
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
      const blocked = deps.isBlocked?.(ownerPubky, pubky) === true;
      if (blocked && options?.confirmUnblock !== true) {
        return {
          ok: false,
          reason: 'blocked',
          message: CONTACTS_COPY.blockedAddMessage,
        };
      }
      try {
        const existing = await deps.storage.getContact(pubky, ownerPubky);
        if (existing?.addedManually && !blocked) {
          return {
            ok: false,
            reason: 'duplicate',
            message: 'This pubky is already in your contacts.',
          };
        }
        if (existing?.addedManually && blocked) {
          await deps.onConfirmedUnblock?.(ownerPubky, pubky);
          return { ok: true, contact: existing };
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
        if (blocked && options?.confirmUnblock === true) {
          await deps.onConfirmedUnblock?.(ownerPubky, pubky);
        }
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
  shouldFetch: () => boolean,
): Promise<{ ids: PubkyKey[]; error: string | null; authoritative: boolean }> {
  const ids: PubkyKey[] = [];
  let skip = 0;
  for (;;) {
    if (!shouldFetch()) {
      return { ids, error: IMPORT_OFF_MESSAGE, authoritative: false };
    }
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
  isPeerDenied: (owner, pubky) => FollowsImportSettings.isPeerDenied(owner, pubky),
  onConfirmedUnblock: async (owner, pubky) => {
    // Lazy: createContactsService unit tests must not load LinkService.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LinkService } = require('./link/LinkService') as typeof import('./link/LinkService');
    await unblockPeer({
      ownerPubky: owner,
      peerPubky: pubky,
      persistUnblock: (o, p) => FollowsImportSettings.unblock(o, p),
      releaseDeclinedRequest: (o, p) => LinkService.releaseDeclinedRequest(o, p),
      clearCleanupPending: (o, p) => FollowsImportSettings.clearBlockCleanupPending(o, p),
    });
  },
  isFollowsImportEnabled: owner => FollowsImportSettings.getFollowsImportEnabled(owner),
  setFollowsImportEnabled: (owner, enabled) =>
    FollowsImportSettings.setFollowsImportEnabled(owner, enabled),
  nexus: createNexusClient(),
  storage: {
    upsertContact: c => StorageService.upsertContact(c),
    getContact: (pubky, owner) => StorageService.getContact(pubky, owner),
    getAllContacts: owner => StorageService.getAllContacts(owner),
    setContactRelationshipFlags: (owner, pubky, flags) =>
      StorageService.setContactRelationshipFlags(owner, pubky, flags),
    deleteContact: (owner, pubky) => StorageService.deleteContact(owner, pubky),
    deleteFollowSuggestions: owner => StorageService.deleteFollowSuggestions(owner),
    reconcileFollowSuggestions: (owner, followees) =>
      StorageService.reconcileFollowSuggestions(owner, followees),
  },
});
