import { groupedPubky, shortPubky } from '../shortPubky';

const PUBKY = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

describe('shortPubky', () => {
  it('abbreviates a z32 pubky', () => {
    expect(shortPubky(PUBKY)).toBe('pxnu33…i1jy');
  });

  it('groups characters for accessible names', () => {
    expect(groupedPubky(PUBKY)).toBe('pxnu 33x7 … i1jy');
  });
});
