import { claimsToBe } from '../copy/uxCopy';
import { shortPubky } from './shortPubky';

export type PeerContactHint = {
  displayName?: string;
  nickname?: string;
  addedManually: boolean;
} | null;

/**
 * Local nickname always wins as the title (owner-assigned). The pubky stays
 * as subtitle so a nickname cannot spoof another contact's identity.
 * Otherwise display name only for contacts the user added or accepted.
 */
export function peerIdentity(
  pubky: string,
  contact: PeerContactHint,
  accepted = false,
): { title: string; subtitle: string | null } {
  const nickname = contact?.nickname?.trim();
  if (nickname) {
    return { title: nickname, subtitle: shortPubky(pubky) };
  }
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
