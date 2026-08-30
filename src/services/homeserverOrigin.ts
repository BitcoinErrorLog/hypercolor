import { getHomeserver as rnGetHomeserver, resolveHttps } from '@synonymdev/react-native-pubky';
import { KeyStore } from './KeyStore';

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
  if (!resolved.isOk() || !resolved.value?.https_records?.length) return null;
  const rec = resolved.value.https_records[0];
  if (!rec?.target) return null;
  const host = rec.target.replace(/\.$/, '');
  if (!host || host === '.') return null;
  const port = rec.port && rec.port !== 443 ? `:${rec.port}` : '';
  return `https://${host}${port}`;
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
