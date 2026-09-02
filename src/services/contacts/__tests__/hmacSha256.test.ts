import { hmacSha256Hex } from '../hmacSha256';
import { opaquePeerId, resetOpaquePeerIdForTests } from '../opaquePeerId';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const OTHER = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const Z32 = /[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/;

describe('hmacSha256Hex', () => {
  it('matches RFC 4231 test case 2', () => {
    const key = Buffer.from('Jefe', 'utf8').toString('hex');
    const message = 'what do ya want for nothing?';
    expect(hmacSha256Hex(key, message)).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });
});

describe('opaquePeerId', () => {
  afterEach(() => {
    resetOpaquePeerIdForTests();
  });

  it('is 16 hex chars and never a 52-char z32 pubky', () => {
    const id = opaquePeerId(OWNER, PEER);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toMatch(Z32);
    expect(id).not.toBe(PEER);
    expect(opaquePeerId(OWNER, PEER)).toBe(id);
  });

  it('does not correlate the same peer across owners', () => {
    expect(opaquePeerId(OWNER, PEER)).not.toBe(opaquePeerId(OTHER, PEER));
  });
});
