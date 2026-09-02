import {
  PROFILE_BACKUP_ROUTE,
  PROFILE_TIP_ENDPOINTS_ROUTE,
  PUBLIC_CHANNELS_ROUTE,
} from '../exposurePaths';

describe('exposurePaths', () => {
  it('routes Profile Encrypted backup to Settings section=backup', () => {
    expect(PROFILE_BACKUP_ROUTE).toEqual({
      name: 'Settings',
      params: { section: 'backup' },
    });
  });

  it('routes Profile My tip endpoints to Settings section=payments', () => {
    expect(PROFILE_TIP_ENDPOINTS_ROUTE).toEqual({
      name: 'Settings',
      params: { section: 'payments' },
    });
  });

  it('opens public topics as Channels mode=public', () => {
    expect(PUBLIC_CHANNELS_ROUTE).toEqual({
      name: 'Main',
      params: { screen: 'Channels', params: { mode: 'public' } },
    });
  });
});
