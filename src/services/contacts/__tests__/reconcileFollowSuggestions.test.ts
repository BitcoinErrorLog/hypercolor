jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in reconcileFollowSuggestions tests');
  },
}));

jest.mock('../../../services/KeyStore', () => ({
  KeyStore: {
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../../services/attachments/fileIo', () => ({
  deleteCacheFiles: jest.fn().mockResolvedValue(undefined),
  cachePathsForAttachment: () => [],
}));

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../StorageService';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const BOB = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';
const CARA = 'uds5oirjz5uocsyixua8zzwc9b3ix99e1ia93cusy5q6kwqwpcqo';

describe('StorageService.reconcileFollowSuggestions', () => {
  beforeEach(async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
  });

  afterEach(() => {
    setDbForTests(null);
  });

  it('deletes stale suggestions and clears following on retained manual contacts', async () => {
    await StorageService.upsertContact({
      pubky: BOB,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: true,
      isFollower: false,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 1,
    });
    await StorageService.upsertContact({
      pubky: CARA,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: true,
      isFollower: true,
      isMutual: true,
      addedManually: true,
      firstSeenAt: 1,
    });
    await StorageService.upsertContact({
      pubky: ALICE,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: true,
      isFollower: false,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 1,
    });

    await StorageService.reconcileFollowSuggestions(OWNER, [ALICE]);

    expect(await StorageService.getContact(BOB, OWNER)).toBeNull();
    expect(await StorageService.getContact(ALICE, OWNER)).toEqual(
      expect.objectContaining({ isFollowing: true, addedManually: false }),
    );
    expect(await StorageService.getContact(CARA, OWNER)).toEqual(
      expect.objectContaining({
        addedManually: true,
        isFollowing: false,
        isMutual: false,
        isFollower: true,
      }),
    );
  });
});
