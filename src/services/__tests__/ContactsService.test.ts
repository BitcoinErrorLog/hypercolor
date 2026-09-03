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
const OWNER_B = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';

const consentOn = {
  isFollowsImportEnabled: () => true,
  setFollowsImportEnabled: jest.fn(),
};

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
    deleteContact: jest.fn(async (_owner: PubkyKey, pubky: PubkyKey) => {
      rows.delete(pubky);
    }),
    deleteFollowSuggestions: jest.fn(async () => {
      for (const [key, row] of [...rows.entries()]) {
        if (!row.addedManually) rows.delete(key);
      }
    }),
    reconcileFollowSuggestions: jest.fn(async (_owner: PubkyKey, followees: PubkyKey[]) => {
      const keep = new Set(followees);
      for (const [key, row] of [...rows.entries()]) {
        if (keep.has(key)) continue;
        if (!row.addedManually) rows.delete(key);
        else rows.set(key, { ...row, isFollowing: false, isMutual: false });
      }
    }),
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
      ...consentOn,
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
      ...consentOn,
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
      ...consentOn,
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
      ...consentOn,
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
      ...consentOn,
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
      ...consentOn,
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
      ...consentOn,
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

function baseDeps(overrides: Partial<Parameters<typeof createContactsService>[0]> = {}) {
  const storage =
    (overrides.storage as ReturnType<typeof makeStorage> | undefined) ?? makeStorage();
  const nexus = (overrides.nexus as NexusClientApi | undefined) ?? makeNexus();
  return {
    storage,
    nexus,
    service: createContactsService({
      list: async () => ({ ok: true as const, urls: [] }),
      getProfile: async () => null,
      getHomeserver: async () => 'https://hs',
      get: async () => '{"created_at":1}',
      isBlocked: () => false,
      ...consentOn,
      ...overrides,
      nexus,
      storage,
    }),
  };
}

describe('ContactsService.refreshFollowsIfEnabled', () => {
  it('does not read homeserver follows or Nexus when import is off', async () => {
    const list = jest.fn(
      async (): Promise<{ ok: true; urls: string[] }> => ({
        ok: true,
        urls: [],
      }),
    );
    const nexus = makeNexus();
    const { service } = baseDeps({ list, nexus, isFollowsImportEnabled: () => false });

    const result = await service.refreshFollowsIfEnabled(OWNER);

    expect(result).toEqual({
      skipped: true,
      imported: 0,
      followees: [],
      usedNexusFallback: false,
    });
    expect(list).not.toHaveBeenCalled();
    expect(nexus.following).not.toHaveBeenCalled();
    expect(nexus.followers).not.toHaveBeenCalled();
    expect(nexus.friends).not.toHaveBeenCalled();
  });

  it('ignores a caller who would force an import while consent is off', async () => {
    const list = jest.fn(
      async (): Promise<{ ok: true; urls: string[] }> => ({
        ok: true,
        urls: [`pubky://${OWNER}/pub/pubky.app/follows/${ALICE}`],
      }),
    );
    const nexus = makeNexus();
    const { service } = baseDeps({ list, nexus, isFollowsImportEnabled: () => false });
    const result = await service.refreshFollowsIfEnabled(OWNER);
    expect(result.skipped).toBe(true);
    expect(list).not.toHaveBeenCalled();
    expect(nexus.following).not.toHaveBeenCalled();
    expect(nexus.followers).not.toHaveBeenCalled();
    expect(nexus.friends).not.toHaveBeenCalled();
  });

  it('reads the homeserver listing after opt-in and never asks Nexus who follows you', async () => {
    const list = jest.fn(async () => ({
      ok: true as const,
      urls: [`pubky://${OWNER}/pub/pubky.app/follows/${ALICE}`],
    }));
    const nexus = makeNexus();
    const { service } = baseDeps({ list, nexus });

    const result = await service.refreshFollowsIfEnabled(OWNER);

    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.imported).toBe(1);
    }
    expect(list).toHaveBeenCalled();
    expect(nexus.following).not.toHaveBeenCalled();
    expect(nexus.followers).not.toHaveBeenCalled();
    expect(nexus.friends).not.toHaveBeenCalled();
  });

  it('does not read owner B follows or Nexus after owner A consented', async () => {
    const enabled = new Map<string, boolean>([[OWNER, true]]);
    const list = jest.fn(async (url: string) => ({
      ok: true as const,
      urls: url.includes(OWNER) ? [`pubky://${OWNER}/pub/pubky.app/follows/${ALICE}`] : [],
    }));
    const nexus = makeNexus();
    const { service } = baseDeps({
      list,
      nexus,
      isFollowsImportEnabled: owner => enabled.get(owner) === true,
    });

    await service.refreshFollowsIfEnabled(OWNER);
    list.mockClear();
    (nexus.following as jest.Mock).mockClear();
    (nexus.followers as jest.Mock).mockClear();
    (nexus.friends as jest.Mock).mockClear();

    const result = await service.refreshFollowsIfEnabled(OWNER_B);
    expect(result.skipped).toBe(true);
    expect(list).not.toHaveBeenCalled();
    expect(nexus.following).not.toHaveBeenCalled();
    expect(nexus.followers).not.toHaveBeenCalled();
    expect(nexus.friends).not.toHaveBeenCalled();
  });
});

describe('ContactsService.importFollowsWithNexusFallback', () => {
  it('asks Nexus following only when the homeserver listing fails, then re-checks documents', async () => {
    const get = jest.fn(async (url: string) => (url.includes(ALICE) ? '{"created_at":1}' : null));
    const nexus = makeNexus({
      following: jest.fn(async () => ok([ALICE, BOB])),
    });
    const { service, storage } = baseDeps({
      list: async () => ({ ok: false, message: 'homeserver timeout' }),
      get,
      nexus,
    });

    const result = await service.importFollowsWithNexusFallback(OWNER);

    expect(result).toEqual(
      expect.objectContaining({ ok: true, imported: 1, usedNexusFallback: true }),
    );
    expect(nexus.following).toHaveBeenCalled();
    expect(nexus.followers).not.toHaveBeenCalled();
    expect(nexus.friends).not.toHaveBeenCalled();
    expect(storage.rows.get(ALICE)?.isFollowing).toBe(true);
    expect(storage.rows.get(BOB)).toBeUndefined();
    expect(storage.reconcileFollowSuggestions).not.toHaveBeenCalled();
  });
});

describe('ContactsService.addManualContact', () => {
  it('rejects an invalid pubky', async () => {
    const { service } = baseDeps();
    await expect(service.addManualContact(OWNER, 'not-a-key')).resolves.toEqual({
      ok: false,
      reason: 'invalid-pubky',
      message: 'Not a valid 52-character z-base-32 pubky.',
    });
  });

  it('rejects adding yourself', async () => {
    const { service } = baseDeps();
    await expect(service.addManualContact(OWNER, OWNER)).resolves.toEqual({
      ok: false,
      reason: 'self',
      message: 'You cannot add your own pubky.',
    });
  });

  it('rejects a duplicate added contact', async () => {
    const storage = makeStorage([
      {
        pubky: ALICE,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: false,
        isFollower: false,
        isMutual: false,
        addedManually: true,
        firstSeenAt: 1,
      },
    ]);
    const { service } = baseDeps({ storage });
    await expect(service.addManualContact(OWNER, ALICE)).resolves.toEqual({
      ok: false,
      reason: 'duplicate',
      message: 'This pubky is already in your contacts.',
    });
  });

  it('promotes a suggestion to an added contact', async () => {
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
    const { service } = baseDeps({ storage });
    const result = await service.addManualContact(OWNER, ALICE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contact.addedManually).toBe(true);
  });

  it('rejects a pubky with no homeserver', async () => {
    const { service } = baseDeps({
      getHomeserver: async () => null,
    });
    await expect(service.addManualContact(OWNER, ALICE)).resolves.toEqual({
      ok: false,
      reason: 'not-found',
      message: 'No homeserver found for that pubky. Check the key and try again.',
    });
  });
});

describe('ContactsService.stopUsingFollows', () => {
  it('removes suggestions and clears relationship flags on added contacts', async () => {
    const storage = makeStorage([
      {
        pubky: ALICE,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: true,
        isMutual: true,
        addedManually: true,
        firstSeenAt: 1,
      },
      {
        pubky: BOB,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: false,
        isMutual: false,
        addedManually: false,
        firstSeenAt: 1,
      },
    ]);
    const { service } = baseDeps({ storage });
    await service.stopUsingFollows(OWNER);
    expect(storage.rows.get(BOB)).toBeUndefined();
    expect(storage.rows.get(ALICE)).toEqual(
      expect.objectContaining({
        addedManually: true,
        isFollowing: false,
        isFollower: false,
        isMutual: false,
      }),
    );
  });

  it('flips consent off before deleting suggestions', async () => {
    const order: string[] = [];
    const storage = makeStorage([
      {
        pubky: BOB,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: false,
        isMutual: false,
        addedManually: false,
        firstSeenAt: 1,
      },
    ]);
    storage.deleteFollowSuggestions = jest.fn(async () => {
      order.push('delete');
      for (const [key, row] of [...storage.rows.entries()]) {
        if (!row.addedManually) storage.rows.delete(key);
      }
    });
    const setFollowsImportEnabled = jest.fn((_owner: string, enabled: boolean) => {
      order.push(enabled ? 'on' : 'off');
    });
    const { service } = baseDeps({ storage, setFollowsImportEnabled });
    await service.stopUsingFollows(OWNER);
    expect(order[0]).toBe('off');
    expect(order).toContain('delete');
    expect(order.indexOf('off')).toBeLessThan(order.indexOf('delete'));
  });

  it('still flips consent off when suggestion deletion fails', async () => {
    const storage = makeStorage();
    storage.deleteFollowSuggestions = jest.fn(async () => {
      throw new Error('sqlite locked');
    });
    const setFollowsImportEnabled = jest.fn();
    const { service } = baseDeps({ storage, setFollowsImportEnabled });
    await expect(service.stopUsingFollows(OWNER)).rejects.toThrow(/Could not stop using follows/);
    expect(setFollowsImportEnabled).toHaveBeenCalledWith(OWNER, false);
  });

  it('discards an in-flight import that finishes after stop', async () => {
    let releaseList!: () => void;
    const listBarrier = new Promise<void>(resolve => {
      releaseList = resolve;
    });
    let markListed!: () => void;
    const listed = new Promise<void>(resolve => {
      markListed = resolve;
    });
    const list = jest.fn(async () => {
      markListed();
      await listBarrier;
      return {
        ok: true as const,
        urls: [`pubky://${OWNER}/pub/pubky.app/follows/${ALICE}`],
      };
    });
    const storage = makeStorage();
    let enabled = true;
    const { service } = baseDeps({
      list,
      storage,
      isFollowsImportEnabled: () => enabled,
      setFollowsImportEnabled: () => {
        enabled = false;
      },
    });

    const importP = service.importFollowsWithNexusFallback(OWNER);
    await listed;
    await service.stopUsingFollows(OWNER);
    releaseList();
    const result = await importP;
    expect(result.ok).toBe(false);
    expect(storage.rows.get(ALICE)).toBeUndefined();
    expect(storage.upsertContact).not.toHaveBeenCalled();
  });
});

describe('ContactsService privacy gates', () => {
  it('does not list follows or call Nexus from importFollows when consent is off', async () => {
    const list = jest.fn(async () => ({
      ok: true as const,
      urls: [`pubky://${OWNER}/pub/pubky.app/follows/${ALICE}`],
    }));
    const nexus = makeNexus();
    const { service } = baseDeps({ list, nexus, isFollowsImportEnabled: () => false });
    const result = await service.importFollows(OWNER);
    expect(result.ok).toBe(false);
    expect(list).not.toHaveBeenCalled();
    expect(nexus.following).not.toHaveBeenCalled();
    expect(nexus.followers).not.toHaveBeenCalled();
    expect(nexus.friends).not.toHaveBeenCalled();
  });

  it('does not call Nexus from syncRelationships when consent is off', async () => {
    const nexus = makeNexus();
    const { service } = baseDeps({ nexus, isFollowsImportEnabled: () => false });
    const result = await service.syncRelationships(OWNER);
    expect(result).toEqual({
      following: 0,
      followers: 0,
      friends: 0,
      nexusReachable: false,
      nexusError: 'Follows import is off.',
    });
    expect(nexus.following).not.toHaveBeenCalled();
    expect(nexus.followers).not.toHaveBeenCalled();
    expect(nexus.friends).not.toHaveBeenCalled();
  });

  it('does not call Nexus following from the fallback importer when consent is off', async () => {
    const list = jest.fn(async () => ({ ok: false as const, message: 'homeserver timeout' }));
    const nexus = makeNexus();
    const { service } = baseDeps({ list, nexus, isFollowsImportEnabled: () => false });
    await service.importFollowsWithNexusFallback(OWNER);
    expect(list).not.toHaveBeenCalled();
    expect(nexus.following).not.toHaveBeenCalled();
    expect(nexus.followers).not.toHaveBeenCalled();
    expect(nexus.friends).not.toHaveBeenCalled();
  });
});

describe('ContactsService authoritative follows refresh', () => {
  it('removes stale follow suggestions after a complete homeserver listing', async () => {
    const storage = makeStorage([
      {
        pubky: BOB,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: false,
        isMutual: false,
        addedManually: false,
        firstSeenAt: 1,
      },
      {
        pubky: CARA,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: false,
        isMutual: true,
        addedManually: true,
        firstSeenAt: 1,
      },
    ]);
    const { service } = baseDeps({
      storage,
      list: async () => ({
        ok: true as const,
        urls: [`pubky://${OWNER}/pub/pubky.app/follows/${ALICE}`],
      }),
    });
    const result = await service.importFollows(OWNER);
    expect(result.ok).toBe(true);
    expect(storage.rows.get(ALICE)?.isFollowing).toBe(true);
    expect(storage.rows.get(BOB)).toBeUndefined();
    expect(storage.rows.get(CARA)).toEqual(
      expect.objectContaining({
        addedManually: true,
        isFollowing: false,
        isMutual: false,
      }),
    );
  });

  it('does not prune on a failed homeserver listing', async () => {
    const storage = makeStorage([
      {
        pubky: BOB,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: false,
        isMutual: false,
        addedManually: false,
        firstSeenAt: 1,
      },
    ]);
    const { service } = baseDeps({
      storage,
      list: async () => ({ ok: false as const, message: 'timeout' }),
    });
    await service.importFollows(OWNER);
    expect(storage.rows.get(BOB)?.isFollowing).toBe(true);
    expect(storage.reconcileFollowSuggestions).not.toHaveBeenCalled();
  });
});

describe('ContactsService mid-flight consent revocation', () => {
  function fullPage(prefix: string): PubkyKey[] {
    return Array.from({ length: 200 }, (_, i) => `${prefix}${i}`.padEnd(52, 'a') as PubkyKey);
  }

  it('stops Nexus page 2, followers, friends, and writes after revoke during following page 1', async () => {
    let releasePage1!: () => void;
    const page1Held = new Promise<void>(resolve => {
      releasePage1 = resolve;
    });
    let markPage1!: () => void;
    const page1Seen = new Promise<void>(resolve => {
      markPage1 = resolve;
    });
    let enabled = true;
    const storage = makeStorage();
    const nexus = makeNexus({
      following: jest.fn(async (_owner: PubkyKey, query?: { skip?: number }) => {
        if ((query?.skip ?? 0) === 0) {
          markPage1();
          await page1Held;
          return ok(fullPage('f'));
        }
        return ok([ALICE]);
      }),
      followers: jest.fn(async () => ok([BOB])),
      friends: jest.fn(async () => ok([CARA])),
    });
    const { service } = baseDeps({
      storage,
      nexus,
      isFollowsImportEnabled: () => enabled,
      setFollowsImportEnabled: () => {
        enabled = false;
      },
    });

    const syncP = service.syncRelationships(OWNER);
    await page1Seen;
    await service.stopUsingFollows(OWNER);
    releasePage1();
    const result = await syncP;

    expect(result).toEqual({
      following: 0,
      followers: 0,
      friends: 0,
      nexusReachable: false,
      nexusError: 'Follows import is off.',
    });
    expect(nexus.following).toHaveBeenCalledTimes(1);
    expect(nexus.followers).not.toHaveBeenCalled();
    expect(nexus.friends).not.toHaveBeenCalled();
    expect(storage.upsertContact).not.toHaveBeenCalled();
    expect(storage.setContactRelationshipFlags).not.toHaveBeenCalled();
  });

  it('does not request Nexus following page 2 after revoke during fallback import', async () => {
    let releasePage1!: () => void;
    const page1Held = new Promise<void>(resolve => {
      releasePage1 = resolve;
    });
    let markPage1!: () => void;
    const page1Seen = new Promise<void>(resolve => {
      markPage1 = resolve;
    });
    let enabled = true;
    const get = jest.fn(async () => '{"created_at":1}');
    const nexus = makeNexus({
      following: jest.fn(async (_owner: PubkyKey, query?: { skip?: number }) => {
        if ((query?.skip ?? 0) === 0) {
          markPage1();
          await page1Held;
          return ok(fullPage('n'));
        }
        return ok([ALICE]);
      }),
    });
    const { service, storage } = baseDeps({
      list: async () => ({ ok: false, message: 'homeserver timeout' }),
      get,
      nexus,
      isFollowsImportEnabled: () => enabled,
      setFollowsImportEnabled: () => {
        enabled = false;
      },
    });

    const importP = service.importFollowsWithNexusFallback(OWNER);
    await page1Seen;
    await service.stopUsingFollows(OWNER);
    releasePage1();
    const result = await importP;

    expect(result.ok).toBe(false);
    expect(nexus.following).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(storage.upsertContact).not.toHaveBeenCalled();
  });

  it('stops follow-document GETs when generation is bumped mid-loop', async () => {
    let enabled = true;
    let stop = async (): Promise<void> => undefined;
    const get = jest.fn(async (url: string) => {
      if (url.includes(ALICE)) await stop();
      return '{"created_at":1}';
    });
    const nexus = makeNexus({
      following: jest.fn(async () => ok([ALICE, BOB, CARA])),
    });
    const { service } = baseDeps({
      list: async () => ({ ok: false, message: 'homeserver timeout' }),
      get,
      nexus,
      isFollowsImportEnabled: () => enabled,
      setFollowsImportEnabled: () => {
        enabled = false;
      },
    });
    stop = () => service.stopUsingFollows(OWNER);

    const result = await service.importFollowsWithNexusFallback(OWNER);
    expect(result.ok).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls.some(call => String(call[0]).includes(BOB))).toBe(false);
    expect(get.mock.calls.some(call => String(call[0]).includes(CARA))).toBe(false);
  });

  it('completes stopUsingFollows while profile hydration is stalled', async () => {
    let markProfile!: () => void;
    const profileStarted = new Promise<void>(resolve => {
      markProfile = resolve;
    });
    let enabled = true;
    const { service, storage } = baseDeps({
      list: async () => ({
        ok: true as const,
        urls: [`pubky://${OWNER}/pub/pubky.app/follows/${ALICE}`],
      }),
      getProfile: async () => {
        markProfile();
        await new Promise<never>(() => undefined);
        return null;
      },
      isFollowsImportEnabled: () => enabled,
      setFollowsImportEnabled: () => {
        enabled = false;
      },
    });

    const importP = service.importFollows(OWNER);
    await profileStarted;
    await Promise.race([
      service.stopUsingFollows(OWNER),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('stopUsingFollows hung on profile hydration')), 1000);
      }),
    ]);
    expect(enabled).toBe(false);
    expect(storage.rows.get(ALICE)).toBeUndefined();
    void importP;
  });

  it('persists the contact before lifting the deny on confirmed unblock-and-add', async () => {
    const order: string[] = [];
    const onConfirmedUnblock = jest.fn(async () => {
      order.push('unblock');
    });
    const storage = makeStorage();
    storage.upsertContact = jest.fn(async (c: Contact) => {
      order.push('upsert');
      storage.rows.set(c.pubky, c);
    });
    const { service } = baseDeps({
      storage,
      isBlocked: () => true,
      onConfirmedUnblock,
    });
    const result = await service.addManualContact(OWNER, ALICE, { confirmUnblock: true });
    expect(result.ok).toBe(true);
    expect(onConfirmedUnblock).toHaveBeenCalledWith(OWNER, ALICE);
    expect(order).toEqual(['upsert', 'unblock']);
  });

  it('does not lift the deny when confirmed unblock-and-add fails to persist', async () => {
    const blocked = new Set<string>([ALICE]);
    const declined = new Set<string>([ALICE]);
    const onConfirmedUnblock = jest.fn(async () => {
      blocked.delete(ALICE);
      declined.delete(ALICE);
    });
    const storage = makeStorage();
    storage.upsertContact = jest.fn(async (_c: Contact): Promise<void> => {
      throw new Error('sqlite locked');
    });
    const { service } = baseDeps({
      storage,
      isBlocked: () => blocked.has(ALICE),
      onConfirmedUnblock,
    });
    const result = await service.addManualContact(OWNER, ALICE, { confirmUnblock: true });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        reason: 'error',
        message: 'Could not add that contact.',
      }),
    );
    expect(onConfirmedUnblock).not.toHaveBeenCalled();
    expect(blocked.has(ALICE)).toBe(true);
    expect(declined.has(ALICE)).toBe(true);
  });

  it('refuses to add a blocked pubky until Unblock is confirmed', async () => {
    const onConfirmedUnblock = jest.fn();
    const storage = makeStorage();
    const { service } = baseDeps({
      storage,
      isBlocked: () => true,
      onConfirmedUnblock,
    });
    await expect(service.addManualContact(OWNER, ALICE)).resolves.toEqual({
      ok: false,
      reason: 'blocked',
      message: 'This pubky is blocked.',
    });
    expect(onConfirmedUnblock).not.toHaveBeenCalled();
    expect(storage.upsertContact).not.toHaveBeenCalled();
  });
});

describe('ContactsService.syncRelationships deny list', () => {
  it('does not re-upsert a denied peer that still appears in the Nexus graph', async () => {
    const storage = makeStorage();
    const nexus = makeNexus({
      following: jest.fn(async () => ok([ALICE])),
      followers: jest.fn(async () => ok([])),
      friends: jest.fn(async () => ok([])),
    });
    const { service } = baseDeps({
      storage,
      nexus,
      isPeerDenied: (_owner, peer) => peer === ALICE,
      isFollowsImportEnabled: () => true,
    });
    await service.syncRelationships(OWNER);
    expect(storage.upsertContact).not.toHaveBeenCalled();
    expect(storage.setContactRelationshipFlags).not.toHaveBeenCalled();
  });
});
