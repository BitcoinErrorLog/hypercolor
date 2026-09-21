import { RING_GRANT_CAPABILITIES, capabilitiesCoverRingGrant } from '../types/link';

export const ALLOWED_PUBKYAUTH_RELAY_HOST = 'httprelay.pubky.app';

export type PubkyauthAuthorizationParts = {
  caps: string;
  secret: string;
  relay: string;
};

/**
 * Parse a query string by hand. `new URL` is not used (RN/web parsers disagree).
 */
export function parseQueryParams(rawQuery: string): Map<string, string> {
  const hash = rawQuery.indexOf('#');
  const q = hash >= 0 ? rawQuery.slice(0, hash) : rawQuery;
  const params = new Map<string, string>();
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? decodeURIComponent(part) : decodeURIComponent(part.slice(0, eq));
    const value = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1));
    params.set(key, value);
  }
  return params;
}

export function assertAllowedPubkyauthRelay(relay: string): void {
  let parsed: URL;
  try {
    parsed = new URL(relay);
  } catch {
    throw new Error('pubkyauth relay URL is invalid');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('pubkyauth relay must be https');
  }
  if (parsed.hostname !== ALLOWED_PUBKYAUTH_RELAY_HOST) {
    throw new Error('pubkyauth relay host is not allowlisted');
  }
}

/**
 * Parse `pubkyauth:///?caps=&secret=&relay=` by hand. Empty authority;
 * `new URL` is not used (RN/web parsers disagree). Caps must *cover*
 * RING_GRANT (F9), not match the joined string by equality.
 */
export function parsePubkyauthAuthorizationUrl(raw: string): PubkyauthAuthorizationParts {
  if (typeof raw !== 'string' || !raw.startsWith('pubkyauth:')) {
    throw new Error('pubkyauth URL is missing');
  }
  const qIndex = raw.indexOf('?');
  if (qIndex < 0) {
    throw new Error('pubkyauth URL is missing a query');
  }
  const params = parseQueryParams(raw.slice(qIndex + 1));
  const caps = params.get('caps') ?? '';
  const secret = params.get('secret') ?? '';
  const relay = params.get('relay') ?? '';
  if (!caps || !secret || !relay) {
    throw new Error('pubkyauth URL is missing caps, secret, or relay');
  }
  if (!capabilitiesCoverRingGrant(caps)) {
    throw new Error('pubkyauth caps do not cover RING_GRANT_CAPABILITIES');
  }
  assertAllowedPubkyauthRelay(relay);
  return { caps, secret, relay };
}

export { RING_GRANT_CAPABILITIES };
