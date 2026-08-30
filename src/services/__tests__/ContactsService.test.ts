jest.mock('../PubkyService', () => ({
  PubkyService: {
    list: jest.fn(),
    getProfile: jest.fn(),
    getHomeserver: jest.fn(),
  },
}));
jest.mock('../StorageService', () => ({
  StorageService: {
    upsertContact: jest.fn(),
    getContact: jest.fn(),
    getAllContacts: jest.fn(),
  },
}));

import type { Contact, PubkyKey } from '../../types';
import {
  createContactsService,
  parseFolloweeFromUrl,
  followsDirUrl,
  PUBKY_APP_FOLLOWS_SEGMENT,
} from '../ContactsService';
import type { NexusClientApi, NexusResult } from '../NexusClient';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const BOB = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';
const CARA = 'uds5oirjz5uocsyixua8zzwc9b3ix99e1ia93cusy5q6kwqwpcqo';

function ok<T>(value: T): NexusResult<T> {
  return { ok: true, value };
}

function http404(): NexusResult<never> {
  return { ok: false, kind: 'http', status: 404, message: 'not found' };
}

function http500(message: string): NexusResult<never> {
  return { ok: false, kind: 'http', status: 500, message };
}

function makeNexus(overrides: Partial<NexusClientApi> = {}): NexusClientApi {
  return {
    followers: jest.fn(async () => ok([])),
    following: jest.fn(async () => ok([])),
    friends: jest.fn(async () => ok([])),
    user: jest.fn(async () => ok({})),
    ...overrides,
  };
}

function makeStorage(seed: Contact[] = []) {
  const rows = new Map<string, Contact>();
  for (const c of seed) rows.set(c.pubky, c);
  return {
    rows,
    upsertContact: jest.fn(async (c: Contact) => {
      const prev = rows.get(c.pubky);
      rows.set(c.pubky, {
        ...c,
        isFollowing: (prev?.isFollowing ?? false) || c.isFollowing,
        isFollower: (prev?.isFollower ?? false) || c.isFollower,
        isMutual: (prev?.isMutual ?? false) || c.isMutual,
        addedManually: (prev?.addedManually ?? false) || c.addedManually,
      });
    }),
    getContact: jest.fn(async (pubky: PubkyKey) => rows.get(pubky) ?? null),
    getAllContacts: jest.fn(async () => [...rows.values()]),
    setContactRelationshipFlags: jest.fn(
      async (
        _owner: PubkyKey,
        pubky: PubkyKey,
        flags: { isFollowing: boolean; isFollower: boolean; isMutual: boolean },
      ) => {
        const row = rows.get(pubky);
        if (row) {
          rows.set(pubky, { ...row, ...flags });
        }
      },
    ),
  };
}

describe('parseFolloweeFromUrl', () => {
  it('parses the followee pubky from a homeserver list URL', () => {
    expect(parseFolloweeFromUrl(`pubky://${OWNER}${PUBKY_APP_FOLLOWS_SEGMENT}${ALICE}`)).toBe(
      ALICE,
    );
    expect(parseFolloweeFromUrl(`/pub/pubky.app/follows/${BOB}/`)).toBe(BOB);
    expect(followsDirUrl(OWNER)).toBe(`pubky://${OWNER}/pub/pubky.app/follows/`);
  });

  it('rejects non-follow paths and invalid ids', () => {
    expect(parseFolloweeFromUrl(`pubky://${OWNER}/pub/pubky.app/profile.json`)).toBeNull();
    expect(parseFolloweeFromUrl(`pubky://${OWNER}/pub/pubky.app/follows/not-a-key`)).toBeNull();
  });
});

describe('ContactsService.importFollows', () => {
  it('imports followees from listed paths and hydrates profiles', async () => {
    const storage = makeStorage();
    const getProfile = jest.fn(async (pubky: PubkyKey) =>
      pubky === ALICE ? { displayName: 'Alice', avatarHash: 'img://alice' } : null,
    );
    const service = createContactsService({
      list: async () => ({
        ok: true,
        urls: [
          `pubky://${OWNER}/pub/pubky.app/follows/${ALICE}`,
          `pubky://${OWNER}/pub/pubky.app/follows/${BOB}`,
          `pubky://${OWNER}/pub/pubky.app/follows/${BOB}`,
          `pubky://${OWNER}/pub/pubky.app/mutes/${CARA}`,
        ],
      }),
      getProfile,
      getHomeserver: async () => 'https://hs',
      nexus: makeNexus(),
      storage,
    });

    const result = await service.importFollows(OWNER);

    expect(result).toEqual(expect.objectContaining({ ok: true, imported: 2 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.followees.sort()).toEqual([ALICE, BOB].sort());
    }
    expect(storage.rows.get(ALICE)).toEqual(
      expect.objectContaining({
        ownerPubky: OWNER,
        isFollowing: true,
        isFollower: false,
        displayName: 'Alice',
        avatarHash: 'img://alice',
      }),
    );
    expect(storage.rows.get(BOB)).toEqual(
      expect.objectContaining({
        isFollowing: true,
        isFollower: false,
      }),
    );
    expect(storage.rows.get(BOB)?.displayName).toBeUndefined();
  });

  it('tolerates missing profiles (404 → null) without failing the import', async () => {
    const storage = makeStorage();
    const service = createContactsService({
      list: async () => ({
        ok: true,
        urls: [`pubky://${OWNER}/pub/pubky.app/follows/${ALICE}`],
      }),
      getProfile: async () => null,
      getHomeserver: async () => null,
      nexus: makeNexus(),
      storage,
    });

    await expect(service.importFollows(OWNER)).resolves.toEqual({
      ok: true,
      imported: 1,
      followees: [ALICE],
    });
    expect(storage.rows.get(ALICE)?.isFollowing).toBe(true);
  });
});

describe('ContactsService.syncRelationships', () => {
  it('merges Nexus followers / friends into relationship flags', async () => {
    const storage = makeStorage([
      {
        pubky: ALICE,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: false,
        isMutual: false,
        addedManually: false,
        firstSeenAt: 1,
      },
    ]);
    const nexus = makeNexus({
      following: jest.fn(async () => ok([ALICE])),
      followers: jest.fn(async () => ok([ALICE, BOB])),
      friends: jest.fn(async () => ok([ALICE])),
    });
    const service = createContactsService({
      list: async () => ({ ok: true, urls: [] }),
      getProfile: async () => null,
      getHomeserver: async () => null,
      nexus,
      storage,
    });

    const result = await service.syncRelationships(OWNER);

    expect(result).toEqual({
      following: 1,
      followers: 2,
      friends: 1,
      nexusReachable: true,
      nexusError: null,
    });
    expect(storage.rows.get(ALICE)).toEqual(
      expect.objectContaining({ isFollowing: true, isFollower: true, isMutual: true }),
    );
    expect(storage.rows.get(BOB)).toEqual(
      expect.objectContaining({ isFollowing: false, isFollower: true, isMutual: false }),
    );
  });

  it('treats Nexus 404 as an empty graph and keeps homeserver follows', async () => {
    const storage = makeStorage([
      {
        pubky: ALICE,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: false,
        isMutual: false,
        addedManually: false,
        firstSeenAt: 1,
      },
    ]);
    const service = createContactsService({
      list: async () => ({ ok: true, urls: [] }),
      getProfile: async () => null,
      getHomeserver: async () => null,
      nexus: makeNexus({
        following: jest.fn(async () => http404()),
        followers: jest.fn(async () => http404()),
        friends: jest.fn(async () => http404()),
      }),
      storage,
    });

    const result = await service.syncRelationships(OWNER);
    expect(result.nexusReachable).toBe(true);
    expect(storage.rows.get(ALICE)?.isFollowing).toBe(true);
    expect(storage.rows.get(ALICE)?.isFollower).toBe(false);
  });

  it('skips the write phase when a Nexus page errors mid-pagination', async () => {
    const storage = makeStorage([
      {
        pubky: ALICE,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: true,
        isMutual: true,
        addedManually: false,
        firstSeenAt: 1,
      },
    ]);
    let followingCalls = 0;
    const nexus = makeNexus({
      following: jest.fn(async () => {
        followingCalls += 1;
        if (followingCalls === 1) {
          return ok(Array.from({ length: 200 }, (_, i) => `f${i}`.padEnd(52, 'a')));
        }
        return http500('Nexus exploded');
      }),
      followers: jest.fn(async () => ok([ALICE])),
      friends: jest.fn(async () => ok([ALICE])),
    });
    const service = createContactsService({
      list: async () => ({ ok: true, urls: [] }),
      getProfile: async () => null,
      getHomeserver: async () => null,
      nexus,
      storage,
    });

    const result = await service.syncRelationships(OWNER);
    expect(result.nexusReachable).toBe(false);
    expect(result.nexusError).toContain('exploded');
    expect(storage.rows.get(ALICE)).toEqual(
      expect.objectContaining({ isFollowing: true, isFollower: true, isMutual: true }),
    );
    expect(storage.setContactRelationshipFlags).not.toHaveBeenCalled();
  });

  it('revokes isFollowing when the Nexus following endpoint is authoritative', async () => {
    const storage = makeStorage([
      {
        pubky: ALICE,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: false,
        isMutual: false,
        addedManually: false,
        firstSeenAt: 1,
      },
    ]);
    const service = createContactsService({
      list: async () => ({ ok: true, urls: [] }),
      getProfile: async () => null,
      getHomeserver: async () => null,
      nexus: makeNexus({
        following: jest.fn(async () => ok([])),
        followers: jest.fn(async () => ok([])),
        friends: jest.fn(async () => ok([])),
      }),
      storage,
    });

    await service.syncRelationships(OWNER);
    expect(storage.rows.get(ALICE)?.isFollowing).toBe(false);
  });
});

describe('ContactsService.importFollows failures', () => {
  it('surfaces a homeserver list failure instead of treating it as zero follows', async () => {
    const storage = makeStorage();
    const service = createContactsService({
      list: async () => ({ ok: false, message: 'homeserver timeout' }),
      getProfile: async () => null,
      getHomeserver: async () => null,
      nexus: makeNexus(),
      storage,
    });

    await expect(service.importFollows(OWNER)).resolves.toEqual({
      ok: false,
      imported: 0,
      followees: [],
      message: 'homeserver timeout',
    });
    expect(storage.upsertContact).not.toHaveBeenCalled();
  });
});
