export const NEXUS_MAX_BODY_BYTES = 256 * 1024;

export const NEXUS_FETCH_INIT: RequestInit = { referrerPolicy: 'no-referrer' };

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export async function readNexusResponseText(
  response: Response,
  maxBytes: number = NEXUS_MAX_BODY_BYTES,
): Promise<{ ok: true; text: string } | { ok: false; reason: 'too-large' }> {
  const headerLen = Number(response.headers.get('content-length'));
  if (Number.isFinite(headerLen) && headerLen > maxBytes) {
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {
        // already closed
      }
    }
    return { ok: false, reason: 'too-large' };
  }

  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder().decode(merged) };
  }

  const text = await response.text();
  if (utf8ByteLength(text) > maxBytes) {
    return { ok: false, reason: 'too-large' };
  }
  return { ok: true, text };
}

export function parseNexusJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; reason: 'not-json' } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'not-json' };
  }
}
