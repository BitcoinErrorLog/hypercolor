import { COPY } from '../copy/uxCopy';
import type { PubkyKey } from '../types';
import { PUBKY_ID_LENGTH, parsePubky } from './pubkyId';

const PUBKY_APP_HOST = /(^|\.)pubky\.app$/i;
const BARE_PUBKY_PREFIX = /^pubky/i;

export type ContactQrParseResult = { ok: true; pubky: PubkyKey } | { ok: false; message: string };

function reject(): ContactQrParseResult {
  return { ok: false, message: COPY.notAPubkyQr };
}

function accept(raw: string): ContactQrParseResult | null {
  const pubky = parsePubky(raw);
  return pubky ? { ok: true, pubky } : null;
}

function extractZ32FromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  for (const part of parts) {
    const decoded = decodeURIComponent(part);
    const stripped = decoded.replace(/^pk:/i, '');
    const asPubky = accept(stripped);
    if (asPubky?.ok) return asPubky.pubky;
    const compact = BARE_PUBKY_PREFIX.test(stripped)
      ? stripped.replace(BARE_PUBKY_PREFIX, '')
      : stripped;
    const compactOk = accept(compact);
    if (compactOk?.ok) return compactOk.pubky;
  }
  return null;
}

/**
 * Accepts scanned identity payloads:
 * - `pubky://<52-char z32>` (canonical)
 * - `pubky<52-char z32>` (Pubky App compact)
 * - bare 52-char z32
 * - a pubky.app profile URL whose path contains the z32
 */
export function parseContactQrPayload(raw: string): ContactQrParseResult {
  const value = raw.trim();
  if (!value) return reject();

  const asCanonical = accept(value);
  if (asCanonical) return asCanonical;

  if (BARE_PUBKY_PREFIX.test(value) && !value.toLowerCase().startsWith('pubky://')) {
    const rest = value.replace(BARE_PUBKY_PREFIX, '').replace(/^\/+/, '');
    const compact = accept(rest.slice(0, PUBKY_ID_LENGTH));
    if (compact) return compact;
  }

  try {
    const url = new URL(value);
    if (PUBKY_APP_HOST.test(url.hostname)) {
      const fromPath = extractZ32FromPath(url.pathname);
      if (fromPath) return { ok: true, pubky: fromPath };
    }
  } catch {
    // not a URL
  }

  return reject();
}
