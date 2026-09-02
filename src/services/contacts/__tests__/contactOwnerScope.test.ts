import type { Contact } from '../../../types';
import {
  canUpsertOwnedContact,
  contactsForOwner,
  replaceOwnerContactMap,
} from '../contactOwnerScope';

const OWNER_A = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const OWNER_B = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const BOB = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';

function contact(ownerPubky: string, pubky: string, displayName: string): Contact {
  return {
    pubky,
    ownerPubky,
    displayName,
    trustScore: 0,
    isFollowing: false,
    isFollower: false,
    isMutual: false,
    addedManually: true,
    firstSeenAt: 1,
  };
}

describe('contact owner scope', () => {
  it('does not let owner B see owner A contacts after replace', () => {
    const alice = contact(OWNER_A, ALICE, 'Alice');
    const bob = contact(OWNER_B, BOB, 'Bob');
    const afterA = replaceOwnerContactMap(OWNER_A, [alice, bob]);
    expect(contactsForOwner(OWNER_A, afterA).map(c => c.pubky)).toEqual([ALICE]);
    expect(contactsForOwner(OWNER_B, afterA)).toEqual([]);

    const afterSwitch = replaceOwnerContactMap(OWNER_B, [bob]);
    expect(contactsForOwner(OWNER_B, afterSwitch).map(c => c.pubky)).toEqual([BOB]);
    expect(contactsForOwner(OWNER_A, afterSwitch)).toEqual([]);
    expect(afterSwitch[ALICE]).toBeUndefined();
  });

  it('rejects upserts that belong to a previous owner', () => {
    expect(canUpsertOwnedContact(OWNER_B, contact(OWNER_A, ALICE, 'Alice'))).toBe(false);
    expect(canUpsertOwnedContact(OWNER_B, contact(OWNER_B, BOB, 'Bob'))).toBe(true);
    expect(canUpsertOwnedContact(null, contact(OWNER_A, ALICE, 'Alice'))).toBe(true);
  });

  it('returns no contacts when signed out', () => {
    const map = replaceOwnerContactMap(OWNER_A, [contact(OWNER_A, ALICE, 'Alice')]);
    expect(contactsForOwner(null, map)).toEqual([]);
  });
});
