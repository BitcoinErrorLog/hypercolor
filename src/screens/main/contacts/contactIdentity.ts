import type { Contact } from '../../../types';
import { claimsToBe } from '../../../copy/uxCopy';
import { shortPubky } from '../../../ui/shortPubky';
import { isContactRow } from '../../../ui/contacts/relationshipBadge';

/**
 * Open-question default (§G.2): display name is primary only for contacts the
 * user added. Everyone else is `shortPubky`, with a claimed name as secondary.
 */
export function contactPrimaryText(
  contact: Pick<Contact, 'pubky' | 'displayName' | 'addedManually'> & { nickname?: string },
): string {
  const nickname = contact.nickname?.trim();
  if (nickname) return nickname;
  if (isContactRow(contact) && contact.displayName && contact.displayName.length > 0) {
    return contact.displayName;
  }
  return shortPubky(contact.pubky);
}

export function contactSecondaryText(
  contact: Pick<Contact, 'pubky' | 'displayName' | 'addedManually'> & { nickname?: string },
): string | null {
  if (contact.nickname?.trim()) return shortPubky(contact.pubky);
  if (isContactRow(contact)) {
    return shortPubky(contact.pubky);
  }
  if (contact.displayName && contact.displayName.length > 0) {
    return claimsToBe(contact.displayName);
  }
  return null;
}
