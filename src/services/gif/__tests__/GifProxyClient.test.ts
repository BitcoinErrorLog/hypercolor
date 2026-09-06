import { GIF_MAX_BYTES, fetchGifBytes, searchGifs } from '../GifProxyClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GifProxyClient', () => {
  it('maps 503 not configured', async () => {
    const result = await searchGifs('cat', 8, async () =>
      jsonResponse(503, { error: 'not configured' }),
    );
    expect(result).toEqual({ ok: false, reason: 'not-configured', message: 'not configured' });
  });

  it('drops non-proxy preview urls and oversized advertised gifs', async () => {
    const result = await searchGifs('cat', 8, async () =>
      jsonResponse(200, {
        results: [
          {
            id: 'ok1',
            preview: { url: 'https://hypercolor.app/api/gif/p', w: 10, h: 10 },
            gif: { url: 'https://hypercolor.app/api/gif/g', w: 10, h: 10, bytes: 12 },
          },
          {
            id: 'evil',
            preview: { url: 'https://evil.test/x.gif', w: 10, h: 10 },
            gif: { url: 'https://hypercolor.app/api/gif/g', w: 10, h: 10, bytes: 12 },
          },
          {
            id: 'huge',
            preview: { url: 'https://hypercolor.app/api/gif/p', w: 10, h: 10 },
            gif: {
              url: 'https://hypercolor.app/api/gif/g',
              w: 10,
              h: 10,
              bytes: GIF_MAX_BYTES + 1,
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.results.map(hit => hit.id)).toEqual(['ok1']);
  });

  it('rejects fetch bodies over 8 MiB and non-GIF magic', async () => {
    const tooBig = await fetchGifBytes(
      'abc',
      async () => new Response(new Uint8Array(6), { status: 413 }),
    );
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.reason).toBe('too-large');
    const notGif = await fetchGifBytes(
      'abc',
      async () =>
        new Response(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]), {
          status: 200,
          headers: { 'content-type': 'image/gif' },
        }),
    );
    expect(notGif.ok).toBe(false);
  });

  it('rejects oversized Content-Length before buffering the body', async () => {
    let read = false;
    const stub = {
      status: 200,
      ok: true,
      headers: new Headers({
        'content-type': 'image/gif',
        'content-length': String(GIF_MAX_BYTES + 1),
      }),
      body: {
        getReader() {
          read = true;
          throw new Error('must not read body after oversized Content-Length');
        },
      },
      arrayBuffer: async () => {
        throw new Error('must not buffer after oversized Content-Length');
      },
    } as unknown as Response;
    const result = await fetchGifBytes('abc', async () => stub);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-large');
    expect(read).toBe(false);
  });

  it('aborts a body stream that exceeds the cap without Content-Length', async () => {
    const chunk = new Uint8Array(64 * 1024);
    const oversize = GIF_MAX_BYTES + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let sent = 0;
        while (sent < oversize) {
          const n = Math.min(chunk.byteLength, oversize - sent);
          controller.enqueue(chunk.subarray(0, n));
          sent += n;
        }
        controller.close();
      },
    });
    const result = await fetchGifBytes(
      'abc',
      async () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'image/gif' },
        }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-large');
  });

  it('rejects a GIF prefix that is not 87a or 89a and a non-gif content-type', async () => {
    const badVersion = await fetchGifBytes(
      'abc',
      async () =>
        new Response(new Uint8Array([0x47, 0x49, 0x46, 0x00, 0x00, 0x00]), {
          status: 200,
          headers: { 'content-type': 'image/gif' },
        }),
    );
    expect(badVersion.ok).toBe(false);
    const gif89a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const wrongType = await fetchGifBytes(
      'abc',
      async () =>
        new Response(gif89a, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
    );
    expect(wrongType.ok).toBe(false);
  });
});
