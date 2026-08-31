import { StorageService } from '../StorageService';
import { requiresAcceptedPeer, type GroupEnvelope, type GroupPeerTrust } from '../../types/group';
import type { PubkyKey } from '../../types';

/**
 * Accept gate for inbound group fan-out.
 *
 * Deliberately its own module rather than part of `applyGroupInbound`: the two
 * answer different questions, and a suite that mocks the apply module must not
 * silently blank the gate. `authorizeInbound` asks what the *recipient's* own
 * channel and roster rows permit; this asks whether the recipient ever said
 * yes to the Encrypted-Link peer carrying the envelope.
 *
 * Returning `true` means the caller must leave the carrying
 * `link_stream_items` row unprocessed — the same deferral the DM path already
 * uses for held chat items, so accept replays it and decline deletes it.
 *
 * The rule itself is {@link requiresAcceptedPeer} in `types/group.ts`, beside
 * the documented group trust model. This resolves it against stored state.
 */
export async function isGroupInboundGated(input: {
  ownerPubky: PubkyKey;
  envelope: GroupEnvelope;
  peerTrust: GroupPeerTrust;
}): Promise<boolean> {
  const { ownerPubky, envelope, peerTrust } = input;
  if (peerTrust === 'accepted') return false;
  const channel = await StorageService.getGroupChannel(ownerPubky, envelope.channel_id);
  return requiresAcceptedPeer({
    envelope,
    ownerPubky,
    channelKnownLocally: channel !== null,
  });
}
