import { contactPrimaryText, contactSecondaryText } from '../contactIdentity';

const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

describe('contactIdentity', () => {
  it('uses the typed name for added contacts and shortPubky otherwise', () => {
    expect(
      contactPrimaryText({
        pubky: ALICE,
        displayName: 'Alice',
        addedManually: true,
      }),
    ).toBe('Alice');
    expect(
      contactPrimaryText({
        pubky: ALICE,
        displayName: 'Alice',
        addedManually: false,
      }),
    ).toBe('pxnu33…i1jy');
    expect(
      contactSecondaryText({
        pubky: ALICE,
        displayName: 'Alice',
        addedManually: false,
      }),
    ).toBe('claims to be Alice');
  });
});
