import type { PubkyKey } from '../../types';

export const BLOCK_CLEANUP_PENDING_MESSAGE = 'Blocked; cleanup pending. Retry.';

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
}): Promise<BlockPeerOutcome> {
  const { ownerPubky, peerPubky } = input;
  if (!ownerPubky || !peerPubky) {
    throw new Error('Could not block this pubky.');
  }
  input.persistBlock(ownerPubky, peerPubky);
  try {
    await input.declineMessageRequest(peerPubky);
    await input.deleteContact(ownerPubky, peerPubky);
    return { blocked: true, cleanup: 'complete' };
  } catch (err) {
    return {
      blocked: true,
      cleanup: 'pending',
      message: BLOCK_CLEANUP_PENDING_MESSAGE,
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reverse a block for one owner: drop the MMKV deny and remove the
 * terminal `declined` message-request row so a re-add can start clean.
 *
 * Decline is sticky in `upsertMessageRequest` (declined cannot be
 * overwritten). The existing status set is `pending | accepted | declined`;
 * deleting the declined row returns the peer to "no request", which is how
 * inbound creates a new `pending` request and how outbound send proceeds
 * without treating them as declined. Do not invent a fourth status, and do
 * not promote to `accepted` — manual add does not skip the WoT queue.
 */
export async function unblockPeer(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  persistUnblock: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => void;
  releaseDeclinedRequest: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => Promise<void>;
}): Promise<void> {
  const { ownerPubky, peerPubky } = input;
  if (!ownerPubky || !peerPubky) {
    throw new Error('Could not unblock this pubky.');
  }
  input.persistUnblock(ownerPubky, peerPubky);
  await input.releaseDeclinedRequest(ownerPubky, peerPubky);
}
