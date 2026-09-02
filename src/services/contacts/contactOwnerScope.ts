import type { Contact, PubkyKey } from '../../types';

export function contactsForOwner(
  ownerPubky: PubkyKey | null,
  contacts: Record<PubkyKey, Contact>,
): Contact[] {
  if (!ownerPubky) return [];
  return Object.values(contacts).filter(row => row.ownerPubky === ownerPubky);
}

export function replaceOwnerContactMap(
  ownerPubky: PubkyKey,
  rows: Contact[],
): Record<PubkyKey, Contact> {
  const next: Record<PubkyKey, Contact> = {};
  for (const row of rows) {
    if (row.ownerPubky !== ownerPubky) continue;
    next[row.pubky] = row;
  }
  return next;
}

export function canUpsertOwnedContact(storeOwner: PubkyKey | null, contact: Contact): boolean {
  return !storeOwner || contact.ownerPubky === storeOwner;
}
