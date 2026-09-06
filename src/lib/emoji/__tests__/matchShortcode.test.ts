import { readFileSync } from 'fs';
import { join } from 'path';
import {
  applyEmojiAtShortcode,
  matchShortcodeTail,
  replaceClosedShortcodes,
} from '../matchShortcode';

describe('emoji shortcodes', () => {
  it('autocompletes :thu to thumbsup', () => {
    const match = matchShortcodeTail('hi :thu');
    expect(match?.suggestions.some(entry => entry.names.includes('thumbsup'))).toBe(true);
    expect(applyEmojiAtShortcode('hi :thu', '👍')).toBe('hi 👍');
  });

  it('replaces closed :name: tokens from the bundled table', () => {
    expect(replaceClosedShortcodes('hello :fire:')).toBe('hello 🔥');
    expect(replaceClosedShortcodes('nope :not_an_emoji:')).toBe('nope :not_an_emoji:');
  });
});

describe('emoji dataset license', () => {
  it('reproduces the Unicode copyright and permission notice', () => {
    const src = readFileSync(join(__dirname, '../dataset.ts'), 'utf8');
    expect(src).toContain('Copyright © 1991–2025 Unicode, Inc.');
    expect(src).toContain('UNICODE LICENSE V3');
    expect(src).toContain('this permission notice appear with all copies');
  });
});
