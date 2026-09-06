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
