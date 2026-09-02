import type { PubkyKey } from '../../types';
import { CONTACTS_COPY } from '../../ui/contacts/contactsCopy';

export const BLOCK_CLEANUP_PENDING_MESSAGE = CONTACTS_COPY.blockedCleanupPending;

export type BlockPeerOutcome =
  | { blocked: true; cleanup: 'complete' }
  | { blocked: true; cleanup: 'pending'; message: string; details: string };

/**
 * Block a peer for one owner. Persist the owner-scoped deny list first;
 * that write is terminal even if later cleanup fails. Decline (Encrypted
 * Link wipe + `message_requests.status = declined`) and contact deletion
 * are retryable. Callers must report cleanup-pending honestly rather than
 * "block failed" when the deny is already stored.
 */
export async function blockPeer(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  persistBlock: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => void;
  declineMessageRequest: (peerPubky: PubkyKey) => Promise<void>;
  deleteContact: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => Promise<void>;
  persistCleanupPending?: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => void;
  clearCleanupPending?: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => void;
}): Promise<BlockPeerOutcome> {
  const { ownerPubky, peerPubky } = input;
  if (!ownerPubky || !peerPubky) {
    throw new Error('Could not block this pubky.');
  }
  input.persistBlock(ownerPubky, peerPubky);
  try {
    await input.declineMessageRequest(peerPubky);
    await input.deleteContact(ownerPubky, peerPubky);
    input.clearCleanupPending?.(ownerPubky, peerPubky);
    return { blocked: true, cleanup: 'complete' };
  } catch (err) {
    input.persistCleanupPending?.(ownerPubky, peerPubky);
    return {
      blocked: true,
      cleanup: 'pending',
      message: BLOCK_CLEANUP_PENDING_MESSAGE,
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reverse a block for one owner. Release the terminal `declined` row first
 * so a throw leaves the deny in place (fail closed). Then drop the MMKV
 * deny. No chats, link, or contact data is restored; the peer may send a
 * new message request.
 *
 * Decline is sticky in `upsertMessageRequest` (declined cannot be
 * overwritten). The existing status set is `pending | accepted | declined`;
 * deleting the declined row returns the peer to "no request", which is how
 * inbound creates a new `pending` request and how outbound send proceeds
 * without treating them as declined. Do not invent a fourth status, and do
 * not promote to `accepted` — Unblock does not skip the WoT queue.
 */
export async function unblockPeer(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  persistUnblock: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => void;
  releaseDeclinedRequest: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => Promise<void>;
  clearCleanupPending?: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => void;
}): Promise<void> {
  const { ownerPubky, peerPubky } = input;
  if (!ownerPubky || !peerPubky) {
    throw new Error('Could not unblock this pubky.');
  }
  await input.releaseDeclinedRequest(ownerPubky, peerPubky);
  input.persistUnblock(ownerPubky, peerPubky);
  input.clearCleanupPending?.(ownerPubky, peerPubky);
}
