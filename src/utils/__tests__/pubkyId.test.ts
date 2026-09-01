import {
  isValidPubky,
  normalizePubkyInput,
  parsePubky,
  PUBKY_ID_LENGTH,
  pubkyZ32ToHex,
} from '../pubkyId';

const VALID = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';

/** pkarr `PublicKey.from` vector (`pubky-sdk` bindings/js/pkg/tests/keys.ts). */
const PKARR_Z32 = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
const PKARR_HEX = '3326b0f07db3ab1f085adf52f5928e7fda002dd4c2c5822146865ed6ba1ec4bf';

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

  it('decodes a pkarr z-base-32 pubky to 32-byte hex', () => {
    expect(pubkyZ32ToHex(PKARR_Z32)).toBe(PKARR_HEX);
    expect(pubkyZ32ToHex(`pubky://${PKARR_Z32}/pub/paykit.app/v0/handoff/x`)).toBe(PKARR_HEX);
  });

  it('throws a clean error for malformed z-base-32 instead of hex-radix failure', () => {
    expect(() => pubkyZ32ToHex('tf')).toThrow(/52-character z-base-32/);
    expect(() => pubkyZ32ToHex('0'.repeat(PUBKY_ID_LENGTH))).toThrow(/52-character z-base-32/);
  });
});
