import { parseDmConversationId } from '../types/link';

export function isDmConversation(row: { conversationId: string }): boolean {
  return parseDmConversationId(row.conversationId) !== null;
}

export function filterDmConversations<T extends { conversationId: string }>(rows: T[]): T[] {
  return rows.filter(isDmConversation);
}

export type ChatListFilter = 'inbox' | 'archived' | 'muted';

export function filterConversationsByPrefs<T extends { conversationId: string }>(
  rows: T[],
  prefs: Record<string, { muted: boolean; archived: boolean }>,
  filter: ChatListFilter,
): T[] {
  return rows.filter(row => {
    const pref = prefs[row.conversationId];
    if (filter === 'archived') return Boolean(pref?.archived);
    if (filter === 'muted') return Boolean(pref?.muted) && !pref?.archived;
    return !pref?.archived;
  });
}
