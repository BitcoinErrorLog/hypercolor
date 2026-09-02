import { createHmac, createHash } from 'crypto';
import { hmacSha256Hex, sha256Hex } from '../hmacSha256';
import { opaquePeerId, resetOpaquePeerIdForTests } from '../opaquePeerId';

const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const Z32 = /[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/;

describe('hmacSha256Hex', () => {
  it('matches Node crypto HMAC-SHA-256', () => {
    const key = '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b';
    const message = 'Hi There';
    expect(hmacSha256Hex(key, message)).toBe(
      createHmac('sha256', Buffer.from(key, 'hex')).update(message, 'utf8').digest('hex'),
    );
  });

  it('matches RFC 4231 test case 2', () => {
    const key = Buffer.from('Jefe', 'utf8').toString('hex');
    const message = 'what do ya want for nothing?';
    expect(hmacSha256Hex(key, message)).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('hashes UTF-8 the same as Node SHA-256', () => {
    expect(sha256Hex('')).toBe(createHash('sha256').update('', 'utf8').digest('hex'));
    expect(sha256Hex('abc')).toBe(createHash('sha256').update('abc', 'utf8').digest('hex'));
  });
});

describe('opaquePeerId', () => {
  afterEach(() => {
    resetOpaquePeerIdForTests();
  });

  it('is 16 hex chars and never a 52-char z32 pubky', () => {
    const id = opaquePeerId(PEER);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toMatch(Z32);
    expect(id).not.toBe(PEER);
    expect(opaquePeerId(PEER)).toBe(id);
  });
});
