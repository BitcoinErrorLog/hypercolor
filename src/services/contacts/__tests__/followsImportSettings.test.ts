import { FollowsImportSettings } from '../followsImportSettings';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
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

  it('stores a local block list per owner', () => {
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    FollowsImportSettings.block(OWNER, PEER);
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(true);
    FollowsImportSettings.unblock(OWNER, PEER);
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
  });
});
