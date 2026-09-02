import type { PubkyKey } from '../../types';

/**
 * Block a peer for one owner: persist the deny list, close the Encrypted
 * Link (decline is the existing terminal inbound-deny), then drop the
 * contact row so they leave the inbox probe set.
 *
 * Does not change wire formats or crypto. Relies on
 * `LinkService.declineMessageRequest` to wipe native link/outbox state
 * and persist `message_requests.status = declined`, which
 * `syncPeerLocked` already refuses.
 */
export async function blockPeer(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  persistBlock: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => void;
  declineMessageRequest: (peerPubky: PubkyKey) => Promise<void>;
  deleteContact: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => Promise<void>;
}): Promise<void> {
  const { ownerPubky, peerPubky } = input;
  if (!ownerPubky || !peerPubky) {
    throw new Error('Could not block this pubky.');
  }
  input.persistBlock(ownerPubky, peerPubky);
  await input.declineMessageRequest(peerPubky);
  await input.deleteContact(ownerPubky, peerPubky);
}

/**
 * Local inbox probe set used by LinkService.collectInboxCandidates:
 * contacts ∪ existing Encrypted-Link peers. After a successful block
 * the peer must be in neither collection.
 */
export function localInboxProbeSet(
  contacts: { pubky: PubkyKey }[],
  links: { peerPubky: PubkyKey }[],
): PubkyKey[] {
  const seen = new Set<string>();
  const out: PubkyKey[] = [];
  for (const contact of contacts) {
    if (seen.has(contact.pubky)) continue;
    seen.add(contact.pubky);
    out.push(contact.pubky);
  }
  for (const link of links) {
    if (seen.has(link.peerPubky)) continue;
    seen.add(link.peerPubky);
    out.push(link.peerPubky);
  }
  return out;
}
