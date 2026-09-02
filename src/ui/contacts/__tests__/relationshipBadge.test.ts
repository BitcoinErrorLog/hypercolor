import type { Contact } from '../../../types';
import {
  isContactRow,
  isSuggestionRow,
  partitionContacts,
  relationshipChips,
  relationshipLabel,
} from '../relationshipBadge';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const BOB = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';

function contact(patch: Partial<Contact> & { pubky: string }): Contact {
  return {
    ownerPubky: OWNER,
    trustScore: 0,
    isFollowing: false,
    isFollower: false,
    isMutual: false,
    addedManually: false,
    firstSeenAt: 1,
    ...patch,
  };
}

describe('relationshipChips', () => {
  it('returns no chips when follows import is off', () => {
    expect(
      relationshipChips(contact({ pubky: ALICE, isMutual: true, isFollowing: true }), false),
    ).toEqual([]);
    expect(relationshipLabel(contact({ pubky: ALICE, isFollowing: true }), false)).toBe(
      'No relationship',
    );
  });

  it('shows Mutual instead of Following after import', () => {
    expect(
      relationshipChips(
        contact({ pubky: ALICE, isMutual: true, isFollowing: true, isFollower: true }),
        true,
      ),
    ).toEqual(['Mutual']);
  });

  it('shows Following and Follower after import', () => {
    expect(relationshipChips(contact({ pubky: ALICE, isFollowing: true }), true)).toEqual([
      'Following',
    ]);
    expect(relationshipChips(contact({ pubky: ALICE, isFollower: true }), true)).toEqual([
      'Follower',
    ]);
  });
});

describe('partitionContacts', () => {
  it('counts only added contacts toward the contact list', () => {
    const added = contact({ pubky: ALICE, addedManually: true });
    const suggestion = contact({ pubky: BOB, isFollowing: true });
    const { contacts, suggestions } = partitionContacts([added, suggestion]);
    expect(contacts.map(c => c.pubky)).toEqual([ALICE]);
    expect(suggestions.map(c => c.pubky)).toEqual([BOB]);
    expect(isContactRow(added)).toBe(true);
    expect(isSuggestionRow(suggestion)).toBe(true);
  });
});
