import { PUBKY_ID_LENGTH, parsePubky } from './pubkyId';
import type { PubkyKey } from '../types';

/**
 * Canonical identity QR / share payload: `pubky://` + a 52-character
 * z-base-32 public key (Phil Zimmermann z-base-32; charset excludes 0, 2, l, v).
 * Example: `pubky://operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo`
 */
export const PUBKY_URI_SCHEME = 'pubky://';

export function canonicalPubkyUri(pubky: PubkyKey | string): string {
  const parsed = parsePubky(pubky);
  if (!parsed || parsed.length !== PUBKY_ID_LENGTH) {
    throw new Error('canonicalPubkyUri requires a 52-character z-base-32 pubky');
  }
  return `${PUBKY_URI_SCHEME}${parsed}`;
}
