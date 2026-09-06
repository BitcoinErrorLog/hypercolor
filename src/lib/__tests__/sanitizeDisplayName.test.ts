import { initialsFromDisplayName, sanitizeDisplayName } from '../sanitizeDisplayName';

describe('sanitizeDisplayName', () => {
  it('strips bidi and format chars then caps length', () => {
    expect(sanitizeDisplayName(`Ada\u202Eevil`)).toBe('Adaevil');
    expect(sanitizeDisplayName('  Cedar   Example  ')).toBe('Cedar Example');
    expect(sanitizeDisplayName('a'.repeat(40)).length).toBe(32);
  });

  it('does not let a spoofed name become empty initials', () => {
    expect(initialsFromDisplayName('\u200B')).toBe('?');
    expect(initialsFromDisplayName('Ada Lovelace')).toBe('AL');
  });
});
