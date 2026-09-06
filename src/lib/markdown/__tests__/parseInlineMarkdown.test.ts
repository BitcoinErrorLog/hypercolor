import { parseInlineMarkdown } from '../parseInlineMarkdown';
import { sanitizeHref } from '../sanitizeHref';

describe('sanitizeHref', () => {
  it('allows https and rejects javascript/data/relative', () => {
    expect(sanitizeHref('https://example.com/x')).toBe('https://example.com/x');
    expect(sanitizeHref('javascript:alert(1)')).toBeNull();
    expect(sanitizeHref('data:text/html,hi')).toBeNull();
    expect(sanitizeHref('/local')).toBeNull();
    expect(sanitizeHref('https://user:pass@evil.test')).toBeNull();
  });
});

describe('parseInlineMarkdown', () => {
  it('tokenizes bold italic code and https links; leaves injection as text', () => {
    const nodes = parseInlineMarkdown(
      '**a** *b* `c` [ok](https://example.com) [bad](javascript:alert(1))',
    );
    expect(nodes).toEqual([
      { type: 'bold', value: 'a' },
      { type: 'text', value: ' ' },
      { type: 'italic', value: 'b' },
      { type: 'text', value: ' ' },
      { type: 'code', value: 'c' },
      { type: 'text', value: ' ' },
      { type: 'link', value: 'ok', href: 'https://example.com/' },
      { type: 'text', value: ' [bad](javascript:alert(1))' },
    ]);
  });
});
