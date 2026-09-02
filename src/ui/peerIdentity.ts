import { claimsToBe } from '../copy/uxCopy';
import { shortPubky } from './shortPubky';

export type PeerContactHint = {
  displayName?: string;
  addedManually: boolean;
} | null;

/**
 * Display name only for contacts the user added or accepted. Everyone else
 * is `shortPubky`, with a self-asserted name as secondary `claims to be`.
 */
export function peerIdentity(
  pubky: string,
  contact: PeerContactHint,
  accepted = false,
): { title: string; subtitle: string | null } {
  const name = contact?.displayName?.trim();
  const trusted = Boolean(contact && (contact.addedManually || accepted) && name);
  if (trusted && name) {
    return { title: name, subtitle: null };
  }
  return {
    title: shortPubky(pubky),
    subtitle: name ? claimsToBe(name) : null,
  };
}
