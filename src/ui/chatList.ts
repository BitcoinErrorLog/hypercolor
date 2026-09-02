import { parseDmConversationId } from '../types/link';

export function isDmConversation(row: { conversationId: string }): boolean {
  return parseDmConversationId(row.conversationId) !== null;
}

export function filterDmConversations<T extends { conversationId: string }>(rows: T[]): T[] {
  return rows.filter(isDmConversation);
}

export function requestsBadgeCount(pending: number): number | null {
  return pending > 0 ? pending : null;
}
