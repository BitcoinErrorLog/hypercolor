import { BUNDLED_EMOJI, emojiByShortName, type EmojiEntry } from './dataset';

const SHORTCODE_TAIL = /(^|[\s(])(:([a-z0-9_+-]{1,32}))$/i;

export type ShortcodeMatch = {
  prefix: string;
  query: string;
  start: number;
  suggestions: EmojiEntry[];
};

export function matchShortcodeTail(draft: string, limit = 8): ShortcodeMatch | null {
  const match = SHORTCODE_TAIL.exec(draft);
  if (!match || match.index === undefined) return null;
  const query = (match[3] ?? '').toLowerCase();
  if (query.length === 0) return null;
  const prefix = draft.slice(0, match.index + (match[1]?.length ?? 0));
  const start = prefix.length;
  const suggestions = BUNDLED_EMOJI.filter(entry =>
    entry.names.some(name => name.startsWith(query) || name.includes(query)),
  ).slice(0, limit);
  if (suggestions.length === 0) return null;
  return { prefix, query, start, suggestions };
}

export function applyEmojiAtShortcode(draft: string, glyph: string): string {
  const match = matchShortcodeTail(draft, 24);
  if (!match) return `${draft}${glyph}`;
  return `${match.prefix}${glyph}`;
}

export function replaceClosedShortcodes(draft: string): string {
  return draft.replace(/:([a-z0-9_+-]{1,32}):/gi, (all, name: string) => {
    const entry = emojiByShortName(name);
    return entry ? entry.glyph : all;
  });
}
