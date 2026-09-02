import type { Contact } from '../../../types';
import { shortPubky } from '../../../ui/contacts/shortPubky';
import { isContactRow } from '../../../ui/contacts/relationshipBadge';

/**
 * Open-question default (§G.2): display name is primary only for contacts the
 * user added. Everyone else is `shortPubky`, with a claimed name as secondary.
 */
export function contactPrimaryText(
  contact: Pick<Contact, 'pubky' | 'displayName' | 'addedManually'>,
): string {
  if (isContactRow(contact) && contact.displayName && contact.displayName.length > 0) {
    return contact.displayName;
  }
  return shortPubky(contact.pubky);
}

export function contactSecondaryText(
  contact: Pick<Contact, 'pubky' | 'displayName' | 'addedManually'>,
): string | null {
  if (isContactRow(contact)) {
    return shortPubky(contact.pubky);
  }
  if (contact.displayName && contact.displayName.length > 0) {
    return `claims to be ${contact.displayName}`;
  }
  return null;
}
