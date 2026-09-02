import {
  PROFILE_BACKUP_ROUTE,
  PROFILE_TIP_ENDPOINTS_ROUTE,
  PUBLIC_CHANNELS_ROUTE,
  channelsRouteParams,
  settingsRouteParams,
} from '../exposurePaths';

describe('exposurePaths', () => {
  it('routes Profile Encrypted backup to Settings section=backup', () => {
    expect(PROFILE_BACKUP_ROUTE).toEqual({
      name: 'Settings',
      params: { section: 'backup' },
    });
    expect(settingsRouteParams('backup')).toEqual({ section: 'backup' });
  });

  it('routes Profile My tip endpoints to Settings section=payments', () => {
    expect(PROFILE_TIP_ENDPOINTS_ROUTE).toEqual({
      name: 'Settings',
      params: { section: 'payments' },
    });
    expect(settingsRouteParams('payments')).toEqual({ section: 'payments' });
  });

  it('opens public topics as Channels mode=public', () => {
    expect(channelsRouteParams('public')).toEqual({ mode: 'public' });
    expect(PUBLIC_CHANNELS_ROUTE).toEqual({
      name: 'Main',
      params: { screen: 'Channels', params: { mode: 'public' } },
    });
  });
});
