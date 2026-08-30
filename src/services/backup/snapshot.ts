import type { Contact, MessageRequest, PubkyKey } from '../../types';
import type { AttachmentRecord } from '../../types/attachment';
import type { GroupChannel, GroupMember, GroupMessage } from '../../types/group';
import type { LinkMessage } from '../../types/link';
import type { PaymentRequestRecord, TipEndpointRecord } from '../../types/payment';

/** Current on-disk / on-wire backup snapshot version. */
export const OWNER_BACKUP_VERSION = 1 as const;

/**
 * Owner-scoped encrypted-backup payload. Device-bound secrets are excluded:
 * receiver alias, session alias, link snapshots, attachment content keys,
 * and attachment plaintext/cache paths.
 */
export type OwnerBackupSnapshot = {
  version: typeof OWNER_BACKUP_VERSION;
  ownerPubky: PubkyKey;
  exportedAt: number;
  contacts: Contact[];
  messageRequests: MessageRequest[];
  linkMessages: LinkMessage[];
  readCursors: Array<{ conversationId: string; lastReadAt: number }>;
  groupChannels: GroupChannel[];
  groupMembers: GroupMember[];
  groupMessages: GroupMessage[];
  paymentRequests: PaymentRequestRecord[];
  tipEndpoints: TipEndpointRecord[];
  attachments: AttachmentRecord[];
};
