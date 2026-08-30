jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in TrustEngine tests');
  },
}));

import { setDbForTests } from '../../db';
import { runMigrations } from '../../db/migrations';
import { openMemoryDb } from '../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../StorageService';
import { TrustEngine } from '../TrustEngine';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

describe('TrustEngine social-graph scoring', () => {
  beforeEach(async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    setDbForTests(null);
    jest.restoreAllMocks();
  });

  async function seed(flags: {
    isMutual?: boolean;
    isFollowing?: boolean;
    isFollower?: boolean;
  }): Promise<void> {
    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: flags.isFollowing ?? false,
      isFollower: flags.isFollower ?? false,
      isMutual: flags.isMutual ?? false,
      addedManually: false,
      firstSeenAt: 1_700_000_000_000,
    });
  }

  it('awards 0.25 for a mutual follow', async () => {
    await seed({ isMutual: true, isFollowing: true, isFollower: true });
    const explanation = await TrustEngine.explain(PEER, OWNER);
    expect(explanation.reasons.find(r => r.code === 'mutual')?.contribution).toBe(0.25);
    expect(explanation.score).toBeGreaterThanOrEqual(0.25);
  });

  it('awards 0.15 for following-only', async () => {
    await seed({ isFollowing: true });
    const explanation = await TrustEngine.explain(PEER, OWNER);
    expect(explanation.reasons.find(r => r.code === 'following')?.contribution).toBe(0.15);
    expect(explanation.reasons.find(r => r.code === 'mutual')).toBeUndefined();
  });

  it('awards 0.05 for a follower who is not followed back', async () => {
    await seed({ isFollower: true });
    const explanation = await TrustEngine.explain(PEER, OWNER);
    expect(explanation.reasons.find(r => r.code === 'follower')?.contribution).toBe(0.05);
  });
});
