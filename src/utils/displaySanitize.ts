/**
 * Display-only sanitization for payment_reference and tip identifiers.
 * Raw values stay in storage for wire fidelity.
 *
 * Strips C1 controls (U+007F–U+009F) and Unicode bidi / isolate controls
 * (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F), then truncates and wraps
 * the result in first-strong isolation (U+2068 … U+2069).
 */

const FIRST_STRONG_ISOLATE = '\u2068';
const POP_DIRECTIONAL_ISOLATE = '\u2069';

export const PAYMENT_DISPLAY_MAX_CHARS = 64;
export const TIP_IDENTIFIER_DISPLAY_MAX_CHARS = 48;

function isStrippedDisplayCodePoint(code: number): boolean {
  if (code < 0x20) return true;
  if (code >= 0x7f && code <= 0x9f) return true;
  if (code === 0x200b || code === 0x200c || code === 0x200d) return true;
  if (code === 0x200e || code === 0x200f) return true;
  if (code === 0xfeff) return true;
  if (code >= 0x202a && code <= 0x202e) return true;
  if (code >= 0x2066 && code <= 0x2069) return true;
  if (code >= 0xe0000 && code <= 0xe007f) return true;
  return false;
}

export function stripBidiAndC1(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code === undefined || isStrippedDisplayCodePoint(code)) continue;
    out += ch;
  }
  return out;
}

export function truncateWithEllipsis(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) return value;
  return `${chars.slice(0, maxChars).join('')}…`;
}

export function isolateFirstStrong(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

export function formatPaymentDisplayText(
  raw: string,
  maxChars: number = PAYMENT_DISPLAY_MAX_CHARS,
): string {
  return isolateFirstStrong(truncateWithEllipsis(stripBidiAndC1(raw), maxChars));
}

export function formatTipIdentifierDisplay(raw: string): string {
  return formatPaymentDisplayText(raw, TIP_IDENTIFIER_DISPLAY_MAX_CHARS);
}

export function payloadPreview(payload: string, maxChars = 36): string {
  return truncateWithEllipsis(stripBidiAndC1(payload), maxChars);
}
