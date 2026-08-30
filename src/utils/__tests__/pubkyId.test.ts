import { isValidPubky, normalizePubkyInput, parsePubky, PUBKY_ID_LENGTH } from '../pubkyId';

const VALID = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';

describe('pubkyId', () => {
  it('accepts a 52-character z-base-32 pubky', () => {
    expect(isValidPubky(VALID)).toBe(true);
    expect(parsePubky(VALID)).toBe(VALID);
  });

  it('strips a pubky:// prefix and path', () => {
    expect(normalizePubkyInput(`pubky://${VALID}/pub/pubky.app/profile.json`)).toBe(VALID);
    expect(parsePubky(`pubky://${VALID}/pub/pubky.app/follows/x`)).toBe(VALID);
  });

  it('rejects wrong length and forbidden charset (0, 2, l, v)', () => {
    expect(isValidPubky('short')).toBe(false);
    expect(isValidPubky('a'.repeat(PUBKY_ID_LENGTH))).toBe(true);
    expect(isValidPubky('0'.repeat(PUBKY_ID_LENGTH))).toBe(false);
    expect(isValidPubky('2'.repeat(PUBKY_ID_LENGTH))).toBe(false);
    expect(isValidPubky('l'.repeat(PUBKY_ID_LENGTH))).toBe(false);
    expect(isValidPubky('v'.repeat(PUBKY_ID_LENGTH))).toBe(false);
  });
});
