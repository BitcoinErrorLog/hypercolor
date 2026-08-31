import { NEXUS_FETCH_INIT } from '../../lib/nexus-http';
import { createNexusClient, type NexusClientApi } from '../NexusClient';

const USER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER_A = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';
const PEER_B = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const PEER_C = 'uds5oirjz5uocsyixua8zzwc9b3ix99e1ia93cusy5q6kwqwpcqo';

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: () => null },
    json: async () => body,
    text: async () => text,
  } as unknown as Response;
}

describe('NexusClient', () => {
  it('parses followers / following / friends JSON arrays', async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url.includes('/followers')) return jsonResponse(200, [PEER_A, PEER_B]);
      if (url.includes('/following')) return jsonResponse(200, [PEER_C]);
      if (url.includes('/friends')) return jsonResponse(200, [PEER_A]);
      return jsonResponse(404, {});
    });
    const client: NexusClientApi = createNexusClient({
      baseUrl: 'https://nexus.staging.pubky.app',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await expect(client.followers(USER)).resolves.toEqual({ ok: true, value: [PEER_A, PEER_B] });
    await expect(client.following(USER)).resolves.toEqual({ ok: true, value: [PEER_C] });
    await expect(client.friends(USER)).resolves.toEqual({ ok: true, value: [PEER_A] });
    expect(fetchFn).toHaveBeenCalledWith(
      `https://nexus.staging.pubky.app/v0/user/${USER}/followers?skip=0&limit=200`,
      NEXUS_FETCH_INIT,
    );
  });

  it('sends Nexus fetches with no-referrer', async () => {
    const fetchFn = jest.fn(async () => jsonResponse(200, []));
    const client = createNexusClient({
      baseUrl: 'https://nexus.example',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await client.following(USER, { skip: 0, limit: 8 });
    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ referrerPolicy: 'no-referrer' }),
    );
  });

  it('rejects graph lists that are not valid pubkys instead of typing them as PubkyKey', async () => {
    const client = createNexusClient({
      fetchFn: (async () =>
        jsonResponse(200, ['../etc/passwd', 'not-a-pubky', USER])) as unknown as typeof fetch,
    });
    const result = await client.following(USER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('decode');
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
