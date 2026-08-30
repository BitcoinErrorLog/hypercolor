import { DEFAULT_NEXUS_BASE_URL } from '../flags/config';
import type { PubkyKey } from '../types';

/**
 * Nexus is a PUBLIC social-graph aggregator. Use it only for followers /
 * following / friends / public profile details — never for messages.
 *
 * Verified against nexus-webapi `endpoints.rs` + live staging:
 *   GET /v0/user/{id}/followers  → JSON array of pubky strings
 *   GET /v0/user/{id}/following  → JSON array of pubky strings
 *   GET /v0/user/{id}/friends    → JSON array of pubky strings
 *   GET /v0/user/{id}            → UserView object
 *
 * Empty friends (and an unindexed user) return HTTP 404 from Nexus.
 * Callers that want "no one" should treat 404 as an empty list.
 */

export type NexusErrorKind = 'http' | 'network' | 'decode';

export type NexusFailure = {
  ok: false;
  kind: NexusErrorKind;
  status: number | null;
  message: string;
};

export type NexusSuccess<T> = { ok: true; value: T };
export type NexusResult<T> = NexusSuccess<T> | NexusFailure;

export type NexusListQuery = {
  skip?: number;
  limit?: number;
};

export type NexusUserView = {
  details?: {
    id?: string;
    name?: string;
    image?: string;
    bio?: string;
    status?: string;
  };
};

export interface NexusClientApi {
  followers(pubky: PubkyKey, query?: NexusListQuery): Promise<NexusResult<PubkyKey[]>>;
  following(pubky: PubkyKey, query?: NexusListQuery): Promise<NexusResult<PubkyKey[]>>;
  friends(pubky: PubkyKey, query?: NexusListQuery): Promise<NexusResult<PubkyKey[]>>;
  user(pubky: PubkyKey): Promise<NexusResult<NexusUserView>>;
}

export type NexusClientOptions = {
  baseUrl?: string;
  fetchFn?: typeof fetch;
};

const DEFAULT_PAGE = 200;

function readConfiguredNexusBaseUrl(): string {
  try {
    // Lazy so unit tests that pass an explicit baseUrl never load MMKV.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const flags = require('../flags') as { AppConfig: { getNexusBaseUrl: () => string } };
    return flags.AppConfig.getNexusBaseUrl();
  } catch {
    return DEFAULT_NEXUS_BASE_URL;
  }
}

export function createNexusClient(options: NexusClientOptions = {}): NexusClientApi {
  const fetchFn = options.fetchFn ?? fetch;

  function currentBaseUrl(): string {
    return (options.baseUrl ?? readConfiguredNexusBaseUrl()).replace(/\/+$/, '');
  }

  async function getJson<T>(
    path: string,
    parse: (body: unknown) => T | null,
  ): Promise<NexusResult<T>> {
    const url = `${currentBaseUrl()}${path}`;
    let response: Response;
    try {
      response = await fetchFn(url);
    } catch (err) {
      return {
        ok: false,
        kind: 'network',
        status: null,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const text = await response.text();
        if (text) detail = text.slice(0, 240);
      } catch {
        // status text is enough
      }
      return {
        ok: false,
        kind: 'http',
        status: response.status,
        message: `Nexus ${path} returned ${response.status}: ${detail}`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      return {
        ok: false,
        kind: 'decode',
        status: response.status,
        message: err instanceof Error ? err.message : 'Nexus response was not JSON',
      };
    }

    const value = parse(body);
    if (value === null) {
      return {
        ok: false,
        kind: 'decode',
        status: response.status,
        message: `Nexus ${path} returned an unexpected JSON shape`,
      };
    }
    return { ok: true, value };
  }

  function listPath(
    kind: 'followers' | 'following' | 'friends',
    pubky: PubkyKey,
    query?: NexusListQuery,
  ): string {
    const skip = query?.skip ?? 0;
    const limit = query?.limit ?? DEFAULT_PAGE;
    return `/v0/user/${encodeURIComponent(pubky)}/${kind}?skip=${skip}&limit=${limit}`;
  }

  return {
    followers(pubky, query) {
      return getJson(listPath('followers', pubky, query), parsePubkyList);
    },
    following(pubky, query) {
      return getJson(listPath('following', pubky, query), parsePubkyList);
    },
    friends(pubky, query) {
      return getJson(listPath('friends', pubky, query), parsePubkyList);
    },
    user(pubky) {
      return getJson(`/v0/user/${encodeURIComponent(pubky)}`, parseUserView);
    },
  };
}

function parsePubkyList(body: unknown): PubkyKey[] | null {
  if (!Array.isArray(body)) return null;
  const out: PubkyKey[] = [];
  for (const item of body) {
    if (typeof item !== 'string' || item.length === 0) return null;
    out.push(item);
  }
  return out;
}

function parseUserView(body: unknown): NexusUserView | null {
  if (typeof body !== 'object' || body === null) return null;
  return body as NexusUserView;
}

/** Default client against configured Nexus. Inject {@link createNexusClient} in tests. */
export const NexusClient = createNexusClient();
