import { groupedPubky, shortPubky, contactRowAccessLabel } from '../shortPubky';

const PUBKY = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

describe('shortPubky', () => {
  it('abbreviates a z32 pubky', () => {
    expect(shortPubky(PUBKY)).toBe('pxnu33…i1jy');
  });

  it('groups characters for accessible names', () => {
    expect(groupedPubky(PUBKY)).toBe('pxnu 33x7 … i1jy');
  });
});

describe('contactRowAccessLabel', () => {
  it('does not promote a claimed name as the primary identity for suggestions', () => {
    expect(
      contactRowAccessLabel({
        addedManually: false,
        displayName: 'Bob',
        pubky: PUBKY,
        primary: 'pxnu33…i1jy',
        secondary: 'claims to be Bob',
      }),
    ).toBe('Open suggestion pxnu33…i1jy, claims to be Bob, identifier pxnu 33x7 … i1jy');
  });

  it('uses the typed name for a manual contact', () => {
    expect(
      contactRowAccessLabel({
        addedManually: true,
        displayName: 'Alice',
        pubky: PUBKY,
        primary: 'Alice',
        secondary: 'pxnu33…i1jy',
      }),
    ).toBe('Open contact Alice, identifier pxnu 33x7 … i1jy');
  });
});
