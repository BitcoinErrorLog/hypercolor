import { parseDmConversationId } from '../../types/link';

export type AttachmentKeyBinding = {
  peerPubky: string;
  conversationId: string;
};

export function attachmentKeyBinding(row: {
  senderPubky: string;
  conversationId?: string | null;
  channelId?: string | null;
}): AttachmentKeyBinding | undefined {
  if (row.channelId) {
    return { peerPubky: row.senderPubky, conversationId: row.channelId };
  }
  if (row.conversationId) {
    const parsed = parseDmConversationId(row.conversationId);
    if (!parsed) return undefined;
    return { peerPubky: parsed.counterpartyPubky, conversationId: row.conversationId };
  }
  return undefined;
}
