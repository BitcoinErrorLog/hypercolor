import type { Contact } from '../../types';

type RelationshipChip = 'Mutual' | 'Following' | 'Follower';
type RelationshipLabel = RelationshipChip | 'No relationship';

/**
 * Following / Mutual / Follower chips exist only after follows import is on.
 * Mutual replaces Following; Follower is omitted when Mutual is shown.
 */
export function relationshipChips(
  contact: Pick<Contact, 'isMutual' | 'isFollowing' | 'isFollower'>,
  followsImportEnabled: boolean,
): RelationshipChip[] {
  if (!followsImportEnabled) return [];
  const chips: RelationshipChip[] = [];
  if (contact.isMutual) chips.push('Mutual');
  else if (contact.isFollowing) chips.push('Following');
  if (contact.isFollower && !contact.isMutual) chips.push('Follower');
  return chips;
}

export function relationshipLabel(
  contact: Pick<Contact, 'isMutual' | 'isFollowing' | 'isFollower'>,
  followsImportEnabled: boolean,
): RelationshipLabel {
  const chips = relationshipChips(contact, followsImportEnabled);
  return chips[0] ?? 'No relationship';
}

export function isContactRow(contact: Pick<Contact, 'addedManually'>): boolean {
  return contact.addedManually;
}

export function isSuggestionRow(contact: Pick<Contact, 'addedManually'>): boolean {
  return !contact.addedManually;
}

export function partitionContacts(contacts: Contact[]): {
  contacts: Contact[];
  suggestions: Contact[];
} {
  const added: Contact[] = [];
  const suggestions: Contact[] = [];
  for (const row of contacts) {
    if (isContactRow(row)) added.push(row);
    else suggestions.push(row);
  }
  return { contacts: added, suggestions };
}
