import type { PubkyKey } from '../types';

/**
 * z-base-32 alphabet used by pubky identifiers (Phil Zimmermann's
 * z-base-32 — not RFC 4648). Verified against pubky-app-specs
 * (`marketplace.rs` / `PubkyId`): length 52, this charset only.
 * Notably excludes 0, 2, l, v.
 */
export const PUBKY_ZBASE32_ALPHABET = 'ybndrfg8ejkmcpqxot1uwisza345h769';

export const PUBKY_ID_LENGTH = 52;

const Z_BASE32_CHAR = new Set(PUBKY_ZBASE32_ALPHABET.split(''));

const PUBKY_URI_PREFIX = 'pubky://';

/**
 * Strips a `pubky://` prefix and any path, returning the raw z-base-32
 * key candidate (not yet validated).
 */
export function normalizePubkyInput(raw: string): string {
  let value = raw.trim();
  if (value.toLowerCase().startsWith(PUBKY_URI_PREFIX)) {
    value = value.slice(PUBKY_URI_PREFIX.length);
  }
  const slash = value.indexOf('/');
  if (slash !== -1) {
    value = value.slice(0, slash);
  }
  return value.toLowerCase();
}

/**
 * True when `value` is a 52-character z-base-32 pubky (after normalizing
 * a pasted `pubky://` URI).
 */
export function isValidPubky(value: string): value is PubkyKey {
  const key = normalizePubkyInput(value);
  if (key.length !== PUBKY_ID_LENGTH) return false;
  for (const ch of key) {
    if (!Z_BASE32_CHAR.has(ch)) return false;
  }
  return true;
}

export function parsePubky(value: string): PubkyKey | null {
  const key = normalizePubkyInput(value);
  return isValidPubky(key) ? key : null;
}
