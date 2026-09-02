import { FollowsImportSettings } from '../followsImportSettings';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const OWNER_B = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

describe('FollowsImportSettings', () => {
  beforeEach(() => {
    FollowsImportSettings.resetForTests();
  });

  it('defaults follows import off', () => {
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER)).toBe(false);
  });

  it('persists an opt-in and can turn it off again', () => {
    FollowsImportSettings.setFollowsImportEnabled(OWNER, true);
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER)).toBe(true);
    FollowsImportSettings.setFollowsImportEnabled(OWNER, false);
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER)).toBe(false);
  });

  it('scopes consent per owner', () => {
    FollowsImportSettings.setFollowsImportEnabled(OWNER, true);
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER_B)).toBe(false);
  });

  it('stores a local block list per owner', () => {
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    FollowsImportSettings.block(OWNER, PEER);
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(true);
    FollowsImportSettings.unblock(OWNER, PEER);
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
  });

  it('persists cleanup-pending per owner until cleared', () => {
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER, PEER)).toBe(false);
    FollowsImportSettings.markBlockCleanupPending(OWNER, PEER);
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER, PEER)).toBe(true);
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER_B, PEER)).toBe(false);
    FollowsImportSettings.clearBlockCleanupPending(OWNER, PEER);
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER, PEER)).toBe(false);
  });

  it('fail-closes consent lookups after session memory is cleared', () => {
    FollowsImportSettings.setFollowsImportEnabled(OWNER, true);
    FollowsImportSettings.clearSessionMemory();
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER)).toBe(false);
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER_B)).toBe(false);
  });
});
