import { getHomeserver as rnGetHomeserver, resolveHttps } from '@synonymdev/react-native-pubky';
import { KeyStore } from './KeyStore';

/** Official Pubky staging homeserver (same pubkey as pubky-app / hypercolor-web). */
export const STAGING_HOMESERVER_PUBKY = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';
export const STAGING_HOMESERVER_ORIGIN = 'https://homeserver.staging.pubky.app';

/**
 * Owner pubky from a `pubky://{owner}/…` URL. Null when the URL is not a
 * pubky URI.
 */
export function parsePubkyOwner(url: string): string | null {
  const match = /^pubky:\/\/([^/]+)/.exec(url);
  return match?.[1] ?? null;
}

function unwrapText(result: { isOk(): boolean; value?: string }): string | null {
  if (!result.isOk() || typeof result.value !== 'string' || result.value.length === 0) {
    return null;
  }
  return result.value;
}

async function originFromHomeserverHint(hint: string): Promise<string | null> {
  const trimmed = hint.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }
  const resolved = await resolveHttps(trimmed);
  if (resolved.isOk() && resolved.value?.https_records?.length) {
    const rec = resolved.value.https_records[0];
    if (rec?.target) {
      const host = rec.target.replace(/\.$/, '');
      if (host && host !== '.') {
        const port = rec.port && rec.port !== 443 ? `:${rec.port}` : '';
        return `https://${host}${port}`;
      }
    }
  }
  if (trimmed === STAGING_HOMESERVER_PUBKY) {
    return STAGING_HOMESERVER_ORIGIN;
  }
  return null;
}

/**
 * Resolve the HTTPS origin for an owner's homeserver. Addressing only —
 * no session secret. Ring stores a homeserver pubkey in KeyStore; pkarr
 * HTTPS records turn that into a host.
 */
export async function resolveHomeserverOrigin(ownerPubky: string): Promise<string> {
  const candidates: string[] = [];
  try {
    const hs = unwrapText(await rnGetHomeserver(ownerPubky));
    if (hs) candidates.push(hs);
  } catch {
    // pkarr miss — try the stored handoff homeserver next.
  }
  const stored = KeyStore.getHomeserver();
  if (stored && !candidates.includes(stored)) candidates.push(stored);

  for (const candidate of candidates) {
    const origin = await originFromHomeserverHint(candidate);
    if (origin) return origin;
  }
  throw new Error('Could not resolve homeserver address');
}
