import { WOT_AUTO_ACCEPT_TRUST_THRESHOLD } from '../../flags/config';

/**
 * WoT gate for newly discovered inbound Encrypted Links.
 *
 * This is a REQUEST filter, not a delivery block. Accepted / already-
 * established conversations always receive. Trust scores never block
 * delivery for those peers (see TrustEngine).
 *
 * Policy (relationship / trust → decision):
 *
 * | isMutual | isFollowing | addedManually | trust >= threshold | decision     |
 * |----------|-------------|---------------|--------------------|--------------|
 * | true     | *           | *             | *                  | auto-accept  |
 * | false    | true        | *             | *                  | auto-accept  |
 * | false    | false       | true          | *                  | auto-accept  |
 * | false    | false       | false         | true               | auto-accept  |
 * | false    | false       | false         | false              | request      |
 *
 * `addedManually` is the paste/QR add path: the user already chose this
 * pubky as a contact, same intent as following them.
 */
export type WotDecision = 'auto-accept' | 'request';

export type WotInput = {
  isMutual: boolean;
  isFollowing: boolean;
  addedManually: boolean;
  trustScore: number;
};

export function classifyInboundPeer(
  input: WotInput,
  threshold: number = WOT_AUTO_ACCEPT_TRUST_THRESHOLD,
): WotDecision {
  if (input.isMutual || input.isFollowing || input.addedManually) return 'auto-accept';
  if (input.trustScore >= threshold) return 'auto-accept';
  return 'request';
}

export function wotInputFromContact(
  contact: {
    isMutual: boolean;
    isFollowing: boolean;
    addedManually: boolean;
    trustScore: number;
  } | null,
): WotInput {
  if (!contact) {
    return { isMutual: false, isFollowing: false, addedManually: false, trustScore: 0 };
  }
  return {
    isMutual: contact.isMutual,
    isFollowing: contact.isFollowing,
    addedManually: contact.addedManually,
    trustScore: contact.trustScore,
  };
}
