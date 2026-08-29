import { v4 as uuidv4 } from 'uuid';
import { PaykitLinkNative, isLinkNativeError, type PaykitLinkNativeApi } from './PaykitLinkNative';
import {
  CHAT_MESSAGE_KIND,
  LINK_RECEIVER_PATH,
  buildChatMessageEnvelope,
  decodeLinkEnvelope,
} from '../../types/link';

export type LiveProofConfig = {
  homeserverPubky: string;
  signupTokenA: string;
  signupTokenB: string;
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

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 60_000;
const DEFAULT_RECEIVE_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

type Party = {
  label: 'A' | 'B';
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
  const a = tokenA.trim();
  const b = tokenB.trim();
  if (a.length > 0 && b.length > 0) return { signupTokenA: a, signupTokenB: b };
  if (a.includes(',')) {
    const parts = a
      .split(',')
      .map(part => part.trim())
      .filter(part => part.length > 0);
    const first = parts[0];
    const second = parts[1];
    if (first !== undefined && second !== undefined) {
      return { signupTokenA: first, signupTokenB: second };
    }
  }
  return null;
}

function defaultRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function identitySecretHex(randomBytes: (size: number) => Uint8Array): string {
  return toHex(randomBytes(32));
}

function errorMessage(err: unknown): string {
  if (isLinkNativeError(err)) return `[${err.code}] ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function requireText(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${name} is required`);
  return trimmed;
}

function requirePartyField(value: string | null, name: string): string {
  if (value === null || value.length === 0) throw new Error(`${name} is missing`);
  return value;
}

/**
 * Two-party Encrypted-Link proof against the real native module.
 * Never touches {@link LinkService}, KeyStore, or SQLite.
 * Never throws — failures are recorded on the report.
 */
export async function runLinkLiveProof(
  config: LiveProofConfig,
  deps: LiveProofDeps = {},
): Promise<LiveProofReport> {
  const native = deps.native ?? PaykitLinkNative;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const randomBytes = deps.randomBytes ?? defaultRandomBytes;
  const handshakeTimeoutMs = deps.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const receiveTimeoutMs = deps.receiveTimeoutMs ?? DEFAULT_RECEIVE_TIMEOUT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const steps: LiveProofStep[] = [];
  const partyA: Party = emptyParty('A');
  const partyB: Party = emptyParty('B');

  const record = async (step: string, body: () => Promise<string>): Promise<boolean> => {
    const started = now();
    try {
      const detail = await body();
      const entry: LiveProofStep = { step, ok: true, detail, elapsedMs: now() - started };
      steps.push(entry);
      console.log('[liveproof]', JSON.stringify(entry));
      return true;
    } catch (err) {
      const entry: LiveProofStep = {
        step,
        ok: false,
        detail: errorMessage(err),
        elapsedMs: now() - started,
      };
      steps.push(entry);
      console.log('[liveproof]', JSON.stringify(entry));
      return false;
    }
  };

  const failed = (): LiveProofReport => ({ ok: false, steps });

  try {
    if (
      !(await record('native-available', async () => {
        if (!native.isAvailable()) {
          throw new Error('PaykitLinkModule native module is not available');
        }
        return 'available';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('validate-config', async () => {
        requireText(config.homeserverPubky, 'homeserverPubky');
        requireText(config.signupTokenA, 'signupTokenA');
        requireText(config.signupTokenB, 'signupTokenB');
        return 'ok';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('generate-identities', async () => {
        partyA.secretHex = identitySecretHex(randomBytes);
        partyB.secretHex = identitySecretHex(randomBytes);
        if (partyA.secretHex.length !== 64 || partyB.secretHex.length !== 64) {
          throw new Error('identity secrets must be 32-byte hex (64 chars)');
        }
        if (partyA.secretHex === partyB.secretHex) {
          throw new Error('generated identical identity secrets');
        }
        return 'two 32-byte secrets';
      }))
    ) {
      return failed();
    }

    if (!(await signupParty(record, native, config, partyA, config.signupTokenA))) return failed();
    if (!(await signupParty(record, native, config, partyB, config.signupTokenB))) return failed();
    if (!(await provisionParty(record, native, partyA))) return failed();
    if (!(await provisionParty(record, native, partyB))) return failed();

    if (
      !(await record('read-marker-b', async () => {
        const marker = await native.getReceiverMarker(
          requirePartyField(partyB.pubky, 'B.pubky'),
          LINK_RECEIVER_PATH,
        );
        if (marker === null) throw new Error('B receiver marker not published');
        if (marker.noisePublicKey !== partyB.noisePublicKey) {
          throw new Error('B marker noise key does not match provisioned receiver');
        }
        return marker.noisePublicKey;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('read-marker-a', async () => {
        const marker = await native.getReceiverMarker(
          requirePartyField(partyA.pubky, 'A.pubky'),
          LINK_RECEIVER_PATH,
        );
        if (marker === null) throw new Error('A receiver marker not published');
        if (marker.noisePublicKey !== partyA.noisePublicKey) {
          throw new Error('A marker noise key does not match provisioned receiver');
        }
        return marker.noisePublicKey;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('initiate-a', async () => {
        const initiated = await native.initiateLink(
          requirePartyField(partyA.sessionAlias, 'A.sessionAlias'),
          requirePartyField(partyA.receiverAlias, 'A.receiverAlias'),
          requirePartyField(partyB.pubky, 'B.pubky'),
          requirePartyField(partyB.noisePublicKey, 'B.noisePublicKey'),
          LINK_RECEIVER_PATH,
          LINK_RECEIVER_PATH,
        );
        partyA.handshakeLinkId = initiated.linkId;
        return initiated.linkId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('establish', async () => {
        return establishBoth(
          native,
          partyA,
          partyB,
          now,
          sleep,
          handshakeTimeoutMs,
          pollIntervalMs,
        );
      }))
    ) {
      return failed();
    }

    const outboundA = buildChatMessageEnvelope({
      eventId: uuidv4(),
      sentAt: now(),
      body: 'liveproof-a',
    });

    if (
      !(await record('send-a', async () => {
        await native.sendPrivateMessageJson(
          requirePartyField(partyA.establishedLinkId, 'A.establishedLinkId'),
          outboundA.json,
        );
        return outboundA.envelope.event_id;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('receive-b', async () => {
        return receiveExpected(
          native,
          partyB,
          outboundA.envelope.event_id,
          outboundA.envelope.body,
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
        );
      }))
    ) {
      return failed();
    }

    const outboundB = buildChatMessageEnvelope({
      eventId: uuidv4(),
      sentAt: now(),
      body: 'liveproof-b-reply',
    });

    if (
      !(await record('send-b', async () => {
        await native.sendPrivateMessageJson(
          requirePartyField(partyB.establishedLinkId, 'B.establishedLinkId'),
          outboundB.json,
        );
        return outboundB.envelope.event_id;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('receive-a', async () => {
        return receiveExpected(
          native,
          partyA,
          outboundB.envelope.event_id,
          outboundB.envelope.body,
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
        );
      }))
    ) {
      return failed();
    }
  } finally {
    await cleanupParties(record, native, partyA, partyB);
  }

  return { ok: steps.every(step => step.ok), steps };
}

function emptyParty(label: 'A' | 'B'): Party {
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

async function signupParty(
  record: (step: string, body: () => Promise<string>) => Promise<boolean>,
  native: PaykitLinkNativeApi,
  config: LiveProofConfig,
  party: Party,
  signupToken: string,
): Promise<boolean> {
  return record(`signup-${party.label.toLowerCase()}`, async () => {
    const session = await native.signupWithSecret(
      party.secretHex,
      config.homeserverPubky,
      signupToken,
    );
    party.sessionAlias = session.sessionAlias;
    party.pubky = session.pubky;
    return session.pubky;
  });
}

async function provisionParty(
  record: (step: string, body: () => Promise<string>) => Promise<boolean>,
  native: PaykitLinkNativeApi,
  party: Party,
): Promise<boolean> {
  return record(`provision-${party.label.toLowerCase()}`, async () => {
    const generated = await native.generateReceiverKey();
    party.receiverAlias = generated.receiverAlias;
    party.noisePublicKey = generated.noisePublicKey;
    await native.publishReceiverMarker(
      requirePartyField(party.sessionAlias, `${party.label}.sessionAlias`),
      generated.receiverAlias,
      LINK_RECEIVER_PATH,
    );
    return `${LINK_RECEIVER_PATH} ${generated.noisePublicKey}`;
  });
}

async function establishBoth(
  native: PaykitLinkNativeApi,
  partyA: Party,
  partyB: Party,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<string> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (partyA.establishedLinkId === null && partyA.handshakeLinkId !== null) {
      const advanced = await native.advanceHandshake(partyA.handshakeLinkId);
      if (advanced.status === 'established') {
        partyA.establishedLinkId = partyA.handshakeLinkId;
      }
    }

    if (partyB.establishedLinkId === null) {
      if (partyB.handshakeLinkId !== null) {
        const advanced = await native.advanceHandshake(partyB.handshakeLinkId);
        if (advanced.status === 'established') {
          partyB.establishedLinkId = partyB.handshakeLinkId;
        }
      } else {
        const probed = await native.probeInboundLink(
          requirePartyField(partyB.sessionAlias, 'B.sessionAlias'),
          requirePartyField(partyB.receiverAlias, 'B.receiverAlias'),
          requirePartyField(partyA.pubky, 'A.pubky'),
          requirePartyField(partyA.noisePublicKey, 'A.noisePublicKey'),
          LINK_RECEIVER_PATH,
          LINK_RECEIVER_PATH,
        );
        if (probed.result === 'pending') {
          partyB.handshakeLinkId = probed.linkId;
        } else if (probed.result === 'established') {
          partyB.establishedLinkId = probed.linkId;
        }
      }
    }

    if (partyA.establishedLinkId !== null && partyB.establishedLinkId !== null) {
      return `A=${partyA.establishedLinkId} B=${partyB.establishedLinkId}`;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `handshake timed out after ${timeoutMs}ms (A=${partyA.establishedLinkId ?? 'pending'}, B=${partyB.establishedLinkId ?? 'pending'})`,
  );
}

async function receiveExpected(
  native: PaykitLinkNativeApi,
  party: Party,
  eventId: string,
  body: string,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<string> {
  const deadline = now() + timeoutMs;
  const seen: string[] = [];
  while (now() < deadline) {
    const received = await native.receivePrivateMessages(
      requirePartyField(party.establishedLinkId, `${party.label}.establishedLinkId`),
    );
    for (const item of received.messages) {
      const decoded = decodeLinkEnvelope(item.rawJson);
      if (decoded === null) {
        seen.push(item.kind ?? 'undecodable');
        continue;
      }
      seen.push(`${decoded.kind}:${decoded.event_id}`);
      if (decoded.kind !== CHAT_MESSAGE_KIND) continue;
      if (decoded.event_id !== eventId) continue;
      if (decoded.body !== body) {
        throw new Error(`body mismatch: expected "${body}", got "${decoded.body}"`);
      }
      return `${decoded.kind} ${decoded.event_id}`;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `did not receive ${CHAT_MESSAGE_KIND} ${eventId} within ${timeoutMs}ms; seen=[${seen.join(', ')}]`,
  );
}

async function cleanupParties(
  record: (step: string, body: () => Promise<string>) => Promise<boolean>,
  native: PaykitLinkNativeApi,
  partyA: Party,
  partyB: Party,
): Promise<void> {
  await record('cleanup-close', async () => {
    const ids = [
      partyA.establishedLinkId,
      partyB.establishedLinkId,
      partyA.handshakeLinkId,
      partyB.handshakeLinkId,
    ].filter((id, index, all): id is string => id !== null && all.indexOf(id) === index);
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
    for (const party of [partyA, partyB]) {
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
    for (const party of [partyA, partyB]) {
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
