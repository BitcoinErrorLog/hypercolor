import type { ChannelMode } from './channelList';

export type SettingsSection = 'backup' | 'payments';

export function settingsRouteParams(section: SettingsSection): { section: SettingsSection } {
  return { section };
}

export function channelsRouteParams(mode: ChannelMode): { mode: ChannelMode } {
  return { mode };
}

export const PROFILE_BACKUP_ROUTE = {
  name: 'Settings' as const,
  params: settingsRouteParams('backup'),
};

export const PROFILE_TIP_ENDPOINTS_ROUTE = {
  name: 'Settings' as const,
  params: settingsRouteParams('payments'),
};

export const PUBLIC_CHANNELS_ROUTE = {
  name: 'Main' as const,
  params: { screen: 'Channels' as const, params: channelsRouteParams('public') },
};
