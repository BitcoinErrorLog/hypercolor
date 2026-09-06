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
});
