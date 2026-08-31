import {
  formatPaymentDisplayText,
  formatTipIdentifierDisplay,
  payloadPreview,
  stripBidiAndC1,
} from '../displaySanitize';

describe('formatPaymentDisplayText', () => {
  it('strips bidi and C1 controls, truncates, and wraps first-strong isolation', () => {
    const raw = `pay \u202Eevil\u202C \u0098ref${'x'.repeat(80)}`;
    const shown = formatPaymentDisplayText(raw);
    expect(shown.startsWith('\u2068')).toBe(true);
    expect(shown.endsWith('\u2069')).toBe(true);
    expect(shown).not.toContain('\u202E');
    expect(shown).not.toContain('\u202C');
    expect(shown).not.toContain('\u0098');
    expect(shown).toContain('…');
    expect([...shown].length).toBeLessThanOrEqual(64 + 3);
  });

  it('keeps the raw value unused — display helpers do not mutate input', () => {
    const raw = 'invoice-\u20662026';
    const shown = formatPaymentDisplayText(raw);
    expect(raw).toBe('invoice-\u20662026');
    expect(shown).toBe('\u2068invoice-2026\u2069');
  });

  it('sanitizes tip identifiers and payload previews', () => {
    expect(formatTipIdentifierDisplay('btc-\u200Elightning-\u200Fbolt11')).toBe(
      '\u2068btc-lightning-bolt11\u2069',
    );
    expect(payloadPreview(`lnbc${'1'.repeat(80)}`)).toHaveLength(37);
  });
});

describe('stripBidiAndC1', () => {
  it('strips zero-width characters and the tag block', () => {
    expect(stripBidiAndC1('ab\u200Bcd\u200Cef\u200Dgh\uFEFFij')).toBe('abcdefghij');
    expect(stripBidiAndC1(`ab${String.fromCodePoint(0xe0061)}cd`)).toBe('abcd');
  });
});
