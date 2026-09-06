import { ATTACHMENT_MAX_BYTES } from '../../flags/config';

export const GIF_PROXY_ORIGIN = 'https://hypercolor.app';
export const GIF_SEARCH_PATH = '/api/gif/search';
export const GIF_FETCH_PATH = '/api/gif/fetch';
export const GIF_MAX_BYTES = ATTACHMENT_MAX_BYTES;

export type GifProxyHit = {
  id: string;
  preview: { url: string; w: number; h: number };
  gif: { url: string; w: number; h: number; bytes: number };
};

export type GifSearchResult =
  | { ok: true; results: GifProxyHit[] }
  | { ok: false; reason: 'not-configured' | 'error'; message: string };

function isProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === GIF_PROXY_ORIGIN && parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function parseHit(raw: unknown): GifProxyHit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.length === 0 || row.id.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(row.id)) return null;
  const preview = row.preview as Record<string, unknown> | undefined;
  const gif = row.gif as Record<string, unknown> | undefined;
  if (!preview || !gif) return null;
  if (typeof preview.url !== 'string' || typeof gif.url !== 'string') return null;
  if (!isProxyUrl(preview.url) || !isProxyUrl(gif.url)) return null;
  const pw = asPositiveInt(preview.w);
  const ph = asPositiveInt(preview.h);
  const gw = asPositiveInt(gif.w);
  const gh = asPositiveInt(gif.h);
  const bytes = asPositiveInt(gif.bytes);
  if (!pw || !ph || !gw || !gh || !bytes) return null;
  if (bytes > GIF_MAX_BYTES) return null;
  return {
    id: row.id,
    preview: { url: preview.url, w: pw, h: ph },
    gif: { url: gif.url, w: gw, h: gh, bytes },
  };
}

export async function searchGifs(
  q: string,
  limit = 12,
  fetchImpl: typeof fetch = fetch,
): Promise<GifSearchResult> {
  const query = q.trim();
  if (query.length === 0) return { ok: true, results: [] };
  const capped = Math.min(24, Math.max(1, Math.floor(limit)));
  const url = `${GIF_PROXY_ORIGIN}${GIF_SEARCH_PATH}?q=${encodeURIComponent(query)}&limit=${capped}`;
  try {
    const res = await fetchImpl(url);
    if (res.status === 503)
      return { ok: false, reason: 'not-configured', message: 'not configured' };
    if (!res.ok) return { ok: false, reason: 'error', message: `search failed (${res.status})` };
    const json: unknown = await res.json();
    if (typeof json !== 'object' || json === null) {
      return { ok: false, reason: 'error', message: 'invalid search payload' };
    }
    const resultsRaw = (json as { results?: unknown }).results;
    if (!Array.isArray(resultsRaw)) {
      return { ok: false, reason: 'error', message: 'invalid search payload' };
    }
    const results: GifProxyHit[] = [];
    for (const item of resultsRaw) {
      const hit = parseHit(item);
      if (hit) results.push(hit);
    }
    return { ok: true, results };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'search failed',
    };
  }
}

export type GifFetchResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; reason: 'not-configured' | 'too-large' | 'error'; message: string };

const GIF_MAGIC = [0x47, 0x49, 0x46];

export async function fetchGifBytes(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GifFetchResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return { ok: false, reason: 'error', message: 'invalid gif id' };
  }
  const url = `${GIF_PROXY_ORIGIN}${GIF_FETCH_PATH}?id=${encodeURIComponent(id)}`;
  try {
    const res = await fetchImpl(url);
    if (res.status === 503)
      return { ok: false, reason: 'not-configured', message: 'not configured' };
    if (res.status === 413) return { ok: false, reason: 'too-large', message: 'gif exceeds 8 MiB' };
    if (!res.ok) return { ok: false, reason: 'error', message: `fetch failed (${res.status})` };
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength > GIF_MAX_BYTES) {
      return { ok: false, reason: 'too-large', message: 'gif exceeds 8 MiB' };
    }
    if (
      buffer.byteLength < 6 ||
      buffer[0] !== GIF_MAGIC[0] ||
      buffer[1] !== GIF_MAGIC[1] ||
      buffer[2] !== GIF_MAGIC[2]
    ) {
      return { ok: false, reason: 'error', message: 'response is not a GIF' };
    }
    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/gif';
    return {
      ok: true,
      bytes: buffer,
      contentType: contentType === 'image/gif' ? contentType : 'image/gif',
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'fetch failed',
    };
  }
}
