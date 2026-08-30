import { createNexusClient, type NexusClientApi } from '../NexusClient';

const USER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('NexusClient', () => {
  it('parses followers / following / friends JSON arrays', async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url.includes('/followers')) return jsonResponse(200, ['aaa', 'bbb']);
      if (url.includes('/following')) return jsonResponse(200, ['ccc']);
      if (url.includes('/friends')) return jsonResponse(200, ['ddd']);
      return jsonResponse(404, {});
    });
    const client: NexusClientApi = createNexusClient({
      baseUrl: 'https://nexus.staging.pubky.app',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await expect(client.followers(USER)).resolves.toEqual({ ok: true, value: ['aaa', 'bbb'] });
    await expect(client.following(USER)).resolves.toEqual({ ok: true, value: ['ccc'] });
    await expect(client.friends(USER)).resolves.toEqual({ ok: true, value: ['ddd'] });
    expect(fetchFn).toHaveBeenCalledWith(
      `https://nexus.staging.pubky.app/v0/user/${USER}/followers?skip=0&limit=200`,
    );
  });

  it('returns a typed http failure on non-200', async () => {
    const client = createNexusClient({
      fetchFn: (async () => jsonResponse(500, { error: 'boom' })) as unknown as typeof fetch,
    });
    const result = await client.followers(USER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('http');
      expect(result.status).toBe(500);
    }
  });

  it('returns a typed network failure without throwing', async () => {
    const client = createNexusClient({
      fetchFn: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    const result = await client.friends(USER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('network');
      expect(result.message).toContain('offline');
    }
  });

  it('returns a typed decode failure for a non-array list body', async () => {
    const client = createNexusClient({
      fetchFn: (async () => jsonResponse(200, { follower_ids: ['x'] })) as unknown as typeof fetch,
    });
    const result = await client.followers(USER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('decode');
  });
});
