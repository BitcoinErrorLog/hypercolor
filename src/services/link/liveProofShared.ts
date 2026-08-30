import { PaykitLinkNative, isLinkNativeError, type PaykitLinkNativeApi } from './PaykitLinkNative';
import { LINK_RECEIVER_PATH } from '../../types/link';
import { LinkService, type LinkEnableFlow } from './LinkService';
import { StorageService } from '../StorageService';
import { KeyStore } from '../KeyStore';

export type LiveProofConfig = {
  homeserverPubky: string;
  signupTokenA: string;
  signupTokenB: string;
};

export type ThreePartyLiveProofConfig = LiveProofConfig & {
  signupTokenC: string;
};

export type LiveProofStep = {
  step: string;
  ok: boolean;
  detail: string;
  elapsedMs: number;
};

export type LiveProofReport = {
  ok: boolean;
  steps: LiveProofStep[];
};

export type LiveProofDeps = {
  native?: PaykitLinkNativeApi;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  randomBytes?: (size: number) => Uint8Array;
  handshakeTimeoutMs?: number;
  receiveTimeoutMs?: number;
  pollIntervalMs?: number;
};

export type NamedLiveProofRow = 'native' | 'p0' | 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6';

export type NamedLiveProofConfig = {
  homeserverPubky: string;
  signupTokenA: string;
  signupTokenB: string;
  signupTokenC?: string;
  rows: NamedLiveProofRow[];
};

export type LiveProofLinkApi = {
  adoptHarnessSession: (sessionAlias: string, pubky: string) => Promise<void>;
  provisionHarnessReceiver: () => Promise<{
    pubky: string;
    receiverPath: string;
    noisePublicKey: string;
  }>;
  ensureLinkWith: (peerPubky: string) => Promise<string>;
  sendDm: (
    peerPubky: string,
    body: string,
  ) => Promise<{ eventId: string; body: string; deliveryState: string }>;
  syncInbox: (peers?: string[]) => Promise<Array<{ eventId: string; body: string }>>;
  sendPreparedMessage: (input: {
    peerPubky: string;
    kind: string;
    eventId: string;
    rawJson: string;
    body: string;
    sentAt: number;
  }) => Promise<{ eventId: string; body: string; deliveryState: string }>;
};

export type ProductLiveProofDeps = LiveProofDeps & {
  link?: LiveProofLinkApi;
};

export type RingKeyStoreApi = Pick<
  typeof KeyStore,
  'isAppCertValid' | 'getPubky' | 'getLinkSession' | 'setPubky'
>;

export type AuthLiveProofDeps = ProductLiveProofDeps & {
  /**
   * Parent attaches this so the pubkyauth URL is opened on-device as-is
   * (`Linking.openURL(authorizationUrl)`). Do not wrap the URL.
   */
  openAuthUrl?: (url: string) => Promise<void>;
  enable?: () => Promise<LinkEnableFlow>;
  keyStore?: RingKeyStoreApi;
};

export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 60_000;
export const DEFAULT_RECEIVE_TIMEOUT_MS = 30_000;
export const DEFAULT_POLL_INTERVAL_MS = 500;
const MIN_REDACT_SECRET_LENGTH = 4;

/**
 * Defense-in-depth redaction for live-proof logs and step details. Strips
 * known signup tokens, generated identity secrets, recovery codes, and the
 * inlined `EXPO_PUBLIC_LIVEPROOF` env blob so neither console output nor the
 * report echoes credentials. Public values (pubkys, Noise keys) are kept.
 */
export function redactLiveProofForLog(text: string, secrets: readonly string[] = []): string {
  let out = text;
  const envKeys = ['EXPO_PUBLIC_LIVEPROOF', 'EXPO_PUBLIC_LIVEPROOF_ROWS'] as const;
  const extra: string[] = [];
  for (const key of envKeys) {
    const env = process.env[key];
    if (typeof env === 'string' && env.length > 0) extra.push(env);
  }
  for (const secret of [...secrets, ...extra]) {
    const trimmed = secret.trim();
    if (trimmed.length < MIN_REDACT_SECRET_LENGTH) continue;
    out = out.split(trimmed).join('[redacted]');
  }
  return out;
}

export type ProofPartyLabel = 'A' | 'B' | 'C';

export type ProofParty = {
  label: ProofPartyLabel;
  secretHex: string;
  sessionAlias: string | null;
  pubky: string | null;
  receiverAlias: string | null;
  noisePublicKey: string | null;
  handshakeLinkId: string | null;
  establishedLinkId: string | null;
};

export function parseLiveProofTokens(
  tokenA: string,
  tokenB: string,
): { signupTokenA: string; signupTokenB: string } | null {
  const parsed = parseLiveProofTokenList(tokenA, tokenB);
  if (!parsed) return null;
  return { signupTokenA: parsed.signupTokenA, signupTokenB: parsed.signupTokenB };
}

export function parseLiveProofTokenList(
  tokenA: string,
  tokenB = '',
  tokenC = '',
): { signupTokenA: string; signupTokenB: string; signupTokenC?: string } | null {
  const fromA = tokenA
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  const b = tokenB.trim();
  const c = tokenC.trim();
  if (fromA.length >= 3) {
    return { signupTokenA: fromA[0]!, signupTokenB: fromA[1]!, signupTokenC: fromA[2]! };
  }
  if (fromA.length === 2 && b.length === 0) {
    const result: { signupTokenA: string; signupTokenB: string; signupTokenC?: string } = {
      signupTokenA: fromA[0]!,
      signupTokenB: fromA[1]!,
    };
    if (c.length > 0) result.signupTokenC = c;
    return result;
  }
  const a = (fromA[0] ?? tokenA).trim();
  if (a.length > 0 && b.length > 0) {
    const result: { signupTokenA: string; signupTokenB: string; signupTokenC?: string } = {
      signupTokenA: a,
      signupTokenB: b,
    };
    if (c.length > 0) result.signupTokenC = c;
    return result;
  }
  return null;
}

export function parseNamedLiveProofRows(raw: string | undefined): NamedLiveProofRow[] {
  if (raw === undefined || raw.trim().length === 0) return ['p0'];
  const allowed: readonly NamedLiveProofRow[] = ['native', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const rows: NamedLiveProofRow[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim().toLowerCase() as NamedLiveProofRow;
    if ((allowed as readonly string[]).includes(trimmed) && !rows.includes(trimmed)) {
      rows.push(trimmed);
    }
  }
  return rows.length > 0 ? rows : ['p0'];
}

/**
 * These bytes become real identity secrets (`signupWithSecret`), so they are
 * key material. Fail closed when no CSPRNG is available — `index.js`
 * polyfills react-native-get-random-values, so this should never trigger in
 * the app runtime. Never fall back to Math.random().
 */
export function defaultRandomBytes(size: number): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error(
      'liveProof: crypto.getRandomValues is unavailable; identity secrets require a CSPRNG',
    );
  }
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function identitySecretHex(randomBytes: (size: number) => Uint8Array): string {
  return toHex(randomBytes(32));
}

export function errorMessage(err: unknown): string {
  if (isLinkNativeError(err)) return `[${err.code}] ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function requireText(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${name} is required`);
  return trimmed;
}

export function requirePartyField(value: string | null, name: string): string {
  if (value === null || value.length === 0) throw new Error(`${name} is missing`);
  return value;
}

export function emptyParty(label: ProofPartyLabel): ProofParty {
  return {
    label,
    secretHex: '',
    sessionAlias: null,
    pubky: null,
    receiverAlias: null,
    noisePublicKey: null,
    handshakeLinkId: null,
    establishedLinkId: null,
  };
}

export type LiveProofRecorder = {
  steps: LiveProofStep[];
  record: (step: string, body: () => Promise<string>) => Promise<boolean>;
  failed: () => LiveProofReport;
  report: () => LiveProofReport;
};

export function createLiveProofRecorder(
  now: () => number,
  redactSecrets: string[],
): LiveProofRecorder {
  const steps: LiveProofStep[] = [];
  return {
    steps,
    record: async (step, body) => {
      const started = now();
      try {
        const detail = redactLiveProofForLog(await body(), redactSecrets);
        const entry: LiveProofStep = { step, ok: true, detail, elapsedMs: now() - started };
        steps.push(entry);
        console.log('[liveproof]', JSON.stringify(entry));
        return true;
      } catch (err) {
        const entry: LiveProofStep = {
          step,
          ok: false,
          detail: redactLiveProofForLog(errorMessage(err), redactSecrets),
          elapsedMs: now() - started,
        };
        steps.push(entry);
        console.log('[liveproof]', JSON.stringify(entry));
        return false;
      }
    },
    failed: () => ({ ok: false, steps }),
    report: () => ({ ok: steps.every(step => step.ok), steps }),
  };
}

export function defaultLinkApi(): LiveProofLinkApi {
  return {
    adoptHarnessSession: (sessionAlias, pubky) =>
      LinkService.adoptHarnessSession(sessionAlias, pubky),
    provisionHarnessReceiver: () => LinkService.provisionHarnessReceiver(),
    ensureLinkWith: peer => LinkService.ensureLinkWith(peer),
    sendDm: (peer, body) => LinkService.sendDm(peer, body),
    syncInbox: peers => LinkService.syncInbox(peers),
    sendPreparedMessage: input => LinkService.sendPreparedMessage(input),
  };
}

export function resolveClock(deps: LiveProofDeps): {
  native: PaykitLinkNativeApi;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  randomBytes: (size: number) => Uint8Array;
  handshakeTimeoutMs: number;
  receiveTimeoutMs: number;
  pollIntervalMs: number;
} {
  return {
    native: deps.native ?? PaykitLinkNative,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? defaultSleep,
    randomBytes: deps.randomBytes ?? defaultRandomBytes,
    handshakeTimeoutMs: deps.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
    receiveTimeoutMs: deps.receiveTimeoutMs ?? DEFAULT_RECEIVE_TIMEOUT_MS,
    pollIntervalMs: deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  };
}

export async function generatePartySecrets(
  parties: ProofParty[],
  randomBytes: (size: number) => Uint8Array,
  redactSecrets: string[],
): Promise<string> {
  for (const party of parties) {
    party.secretHex = identitySecretHex(randomBytes);
    if (party.secretHex.length !== 64) {
      throw new Error('identity secrets must be 32-byte hex (64 chars)');
    }
    redactSecrets.push(party.secretHex);
  }
  const unique = new Set(parties.map(party => party.secretHex));
  if (unique.size !== parties.length) {
    throw new Error('generated identical identity secrets');
  }
  return `${parties.length} 32-byte secrets`;
}

export async function signupParty(
  record: (step: string, body: () => Promise<string>) => Promise<boolean>,
  native: PaykitLinkNativeApi,
  homeserverPubky: string,
  party: ProofParty,
  signupToken: string,
): Promise<boolean> {
  return record(`signup-${party.label.toLowerCase()}`, async () => {
    const session = await native.signupWithSecret(party.secretHex, homeserverPubky, signupToken);
    party.sessionAlias = session.sessionAlias;
    party.pubky = session.pubky;
    return session.pubky;
  });
}

export async function adoptAndProvision(
  record: (step: string, body: () => Promise<string>) => Promise<boolean>,
  link: LiveProofLinkApi,
  party: ProofParty,
): Promise<boolean> {
  const adopted = await record(`adopt-${party.label.toLowerCase()}`, async () => {
    await link.adoptHarnessSession(
      requirePartyField(party.sessionAlias, `${party.label}.sessionAlias`),
      requirePartyField(party.pubky, `${party.label}.pubky`),
    );
    return requirePartyField(party.pubky, `${party.label}.pubky`);
  });
  if (!adopted) return false;
  return record(`provision-${party.label.toLowerCase()}`, async () => {
    const provisioned = await link.provisionHarnessReceiver();
    party.noisePublicKey = provisioned.noisePublicKey;
    return `${provisioned.receiverPath} ${provisioned.noisePublicKey}`;
  });
}

export async function switchToParty(link: LiveProofLinkApi, party: ProofParty): Promise<void> {
  await link.adoptHarnessSession(
    requirePartyField(party.sessionAlias, `${party.label}.sessionAlias`),
    requirePartyField(party.pubky, `${party.label}.pubky`),
  );
}

export async function establishProductLink(
  link: LiveProofLinkApi,
  storage: Pick<typeof StorageService, 'getLink'>,
  partyA: ProofParty,
  partyB: ProofParty,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<string> {
  const pubkyA = requirePartyField(partyA.pubky, 'A.pubky');
  const pubkyB = requirePartyField(partyB.pubky, 'B.pubky');
  await switchToParty(link, partyA);
  await link.ensureLinkWith(pubkyB);
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await switchToParty(link, partyB);
    await link.syncInbox([pubkyA]);
    const linkB = await storage.getLink(pubkyB, pubkyA);
    await switchToParty(link, partyA);
    await link.ensureLinkWith(pubkyB);
    const linkA = await storage.getLink(pubkyA, pubkyB);
    if (linkA?.status === 'established' && linkB?.status === 'established') {
      return `A=${linkA.status} B=${linkB.status}`;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`product handshake timed out after ${timeoutMs}ms`);
}

export async function pollUntil<T>(
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
  attempt: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = now() + timeoutMs;
  let last: T | undefined;
  while (now() < deadline) {
    last = await attempt();
    if (accept(last)) return last;
    await sleep(pollIntervalMs);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

export async function cleanupNativeParties(
  record: (step: string, body: () => Promise<string>) => Promise<boolean>,
  native: PaykitLinkNativeApi,
  parties: readonly ProofParty[],
): Promise<void> {
  await record('cleanup-close', async () => {
    const ids = parties
      .flatMap(party => [party.establishedLinkId, party.handshakeLinkId])
      .filter((id, index, all): id is string => id !== null && all.indexOf(id) === index);
    const closed: string[] = [];
    const errors: string[] = [];
    for (const linkId of ids) {
      try {
        await native.closeLink(linkId);
        closed.push(linkId);
      } catch (err) {
        errors.push(`${linkId}: ${errorMessage(err)}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`closed ${closed.length}; failed: ${errors.join('; ')}`);
    }
    return `closed ${closed.length}`;
  });

  await record('cleanup-markers', async () => {
    const errors: string[] = [];
    for (const party of parties) {
      if (party.sessionAlias === null) continue;
      try {
        await native.removeReceiverMarker(party.sessionAlias, LINK_RECEIVER_PATH);
      } catch (err) {
        errors.push(`${party.label}: ${errorMessage(err)}`);
      }
    }
    if (errors.length > 0) throw new Error(errors.join('; '));
    return 'removed';
  });

  await record('cleanup-signout', async () => {
    const errors: string[] = [];
    for (const party of parties) {
      if (party.sessionAlias === null) continue;
      try {
        await native.signOutSession(party.sessionAlias);
      } catch (err) {
        errors.push(`${party.label}: ${errorMessage(err)}`);
      }
    }
    if (errors.length > 0) throw new Error(errors.join('; '));
    return 'signed out';
  });
}

export async function cleanupProductParties(
  record: (step: string, body: () => Promise<string>) => Promise<boolean>,
  native: PaykitLinkNativeApi,
  storage: Pick<typeof StorageService, 'clearAccountData'>,
  parties: readonly ProofParty[],
): Promise<void> {
  await cleanupNativeParties(record, native, parties);
  await record('cleanup-sql', async () => {
    const errors: string[] = [];
    for (const party of parties) {
      if (party.pubky === null) continue;
      try {
        await storage.clearAccountData(party.pubky);
      } catch (err) {
        errors.push(`${party.label}: ${errorMessage(err)}`);
      }
    }
    if (errors.length > 0) throw new Error(errors.join('; '));
    return `cleared ${parties.filter(party => party.pubky !== null).length}`;
  });
  await record('cleanup-native-secrets', async () => {
    await native.clearAllNativeSecrets();
    return 'cleared';
  });
}

/** Paste/QR contact so WoT auto-accepts inbound from that peer. */
export async function addPastedContact(
  storage: Pick<typeof StorageService, 'upsertContact'>,
  ownerPubky: string,
  contactPubky: string,
  now: () => number,
): Promise<void> {
  await storage.upsertContact({
    pubky: contactPubky,
    ownerPubky,
    trustScore: 0,
    isFollowing: false,
    isFollower: false,
    isMutual: false,
    addedManually: true,
    firstSeenAt: now(),
  });
}

/**
 * Owner writes (attachments / backup) require a Ring-delegated AppCert.
 * Fail fast before signup so P3/P5 do not spend tokens then hit the
 * generic AppCert throw.
 */
export async function requireRingAppCert(
  keyStore: RingKeyStoreApi,
): Promise<{ pubky: string; sessionAlias: string | null }> {
  const valid = await keyStore.isAppCertValid();
  if (!valid) {
    throw new Error(
      'Ring AppCert is missing or expired. Run p6 (startAuthFlow / awaitAuthApproval) before this row, then re-authorize Hypercolor with pubky-ring.',
    );
  }
  const pubky = keyStore.getPubky();
  if (!pubky || pubky.trim().length === 0) {
    throw new Error(
      'Ring AppCert is valid but no pubky is stored. Re-authorize Hypercolor with pubky-ring.',
    );
  }
  return { pubky, sessionAlias: keyStore.getLinkSession() };
}
