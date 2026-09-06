import type { GroupChannel } from '../types/group';
import { filterConversationsByPrefs, type ChatListFilter } from './chatList';

export type { ChatListFilter };

export type ChannelMode = 'private' | 'public';

export type ChannelListItem = GroupChannel & { unreadCount: number };

export function filterChannelsByMode(
  channels: readonly ChannelListItem[],
  mode: ChannelMode,
): ChannelListItem[] {
  return channels.filter(channel => (mode === 'public' ? channel.isPublic : !channel.isPublic));
}

export function filterChannelsByPrefs(
  channels: readonly ChannelListItem[],
  prefs: Record<string, { muted: boolean; archived: boolean }>,
  filter: ChatListFilter,
): ChannelListItem[] {
  return filterConversationsByPrefs(
    channels.map(channel => ({ ...channel, conversationId: channel.channelId })),
    prefs,
    filter,
  );
}

/** Public homeserver/index reads are gated until the user opts in. */
export function publicListVisible(optedIn: boolean): boolean {
  return optedIn;
}

export function mayReadPublicGraph(optedIn: boolean): boolean {
  return optedIn;
}

/** Public-substrate writes that are not already on a viewed public channel. */
export function mayWritePublicGraph(optedIn: boolean): boolean {
  return optedIn;
}

export function withUnreadCounts(
  channels: readonly GroupChannel[],
  unreadByChannel: Readonly<Record<string, number>>,
): ChannelListItem[] {
  return channels.map(channel => ({
    ...channel,
    unreadCount: unreadByChannel[channel.channelId] ?? 0,
  }));
}

export function parseChannelMode(value: unknown): ChannelMode {
  return value === 'public' ? 'public' : 'private';
}
