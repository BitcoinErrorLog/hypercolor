import { Linking } from 'react-native';
import { get as rnGet } from '@synonymdev/react-native-pubky';
import { x25519GenerateKeypair, sb2VerifySignature, sb2Decrypt } from '../utils/PubkyNoiseModule';
import { parsePubky, pubkyZ32ToHex } from '../utils/pubkyId';
import { RING_GRANT_CAPABILITIES } from '../types/link';
import { KeyStore, type AppCert } from './KeyStore';
import { ENABLE_AUTH_TTL_MS } from '../copy/uxCopy';
import { PaykitLinkNative } from './link/PaykitLinkNative';
import { LinkService } from './link/LinkService';

/**
 * PubkyRingAuthService
 *
 * Combined paykit-connect + pubkyauth (one Ring sheet):
 *  1. startAuthFlow (scoped RING_GRANT_CAPABILITIES) first; parse secret/relay.
 *  2. Mint ephemeral X25519; QR is pubkyring://paykit-connect with secret, relay, v=2.
 *  3. Ring posts the scoped AuthToken, then opens hypercolor://ring-callback.
 *  4. Decrypt the SB2 handoff in memory; awaitAuthApproval; bind pubky;
 *     adoptApprovedSession → adoptHandoff (UKD keys) → provisionReceiver.
 *
 * Legacy: no auth flow started (native missing). Same callback, persist keys
 * only. session_secret is never stored.
 */

export class StaleDelegationRequestError extends Error {
  override readonly name = 'StaleDelegationRequestError';
  constructor() {
    super('Stale delegation request');
  }
}

export class ExpiredDelegationError extends Error {
  override readonly name = 'ExpiredDelegationError';
  constructor() {
    super('Authorization expired');
  }
}

export class BindingMismatchError extends Error {
  override readonly name = 'BindingMismatchError';
  constructor(message = 'Handoff pubky does not match the approved session') {
    super(message);
  }
}

export class ProvisionReceiverFailedError extends Error {
  override readonly name = 'ProvisionReceiverFailedError';
  readonly pubky: string;
  readonly homeserver: string;
  constructor(pubky: string, homeserver: string, cause?: string) {
    super(cause ?? 'Failed to publish receiver');
    this.pubky = pubky;
    this.homeserver = homeserver;
  }
}

export function isStaleDelegationRequestError(err: unknown): boolean {
  return err instanceof StaleDelegationRequestError;
}

export function isExpiredDelegationError(err: unknown): boolean {
  return err instanceof ExpiredDelegationError;
}

export function isProvisionReceiverFailedError(err: unknown): err is ProvisionReceiverFailedError {
  return err instanceof ProvisionReceiverFailedError;
}

export function isBindingMismatchError(err: unknown): boolean {
  return err instanceof BindingMismatchError;
}

export type PendingDelegationSnapshot = {
  url: string;
  expiresAt: number;
  generation: number;
};

export type DelegationRequest = PendingDelegationSnapshot;

export type PubkyauthAuthorizationParts = {
  caps: string;
  secret: string;
  relay: string;
};

/**
 * Parse `pubkyauth:///?caps=&secret=&relay=` by hand. Empty authority;
 * `new URL` is not used (RN/web parsers disagree).
 */
export function parsePubkyauthAuthorizationUrl(raw: string): PubkyauthAuthorizationParts {
  if (typeof raw !== 'string' || !raw.startsWith('pubkyauth:')) {
    throw new Error('pubkyauth URL is missing');
  }
  const qIndex = raw.indexOf('?');
  if (qIndex < 0) {
    throw new Error('pubkyauth URL is missing a query');
  }
  const query = raw.slice(qIndex + 1);
  const hash = query.indexOf('#');
  const q = hash >= 0 ? query.slice(0, hash) : query;
  const params = new Map<string, string>();
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? decodeURIComponent(part) : decodeURIComponent(part.slice(0, eq));
    const value = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    params.set(key, value);
  }
  const caps = params.get('caps') ?? '';
  const secret = params.get('secret') ?? '';
  const relay = params.get('relay') ?? '';
  if (!caps || !secret || !relay) {
    throw new Error('pubkyauth URL is missing caps, secret, or relay');
  }
  return { caps, secret, relay };
}

interface PendingHandoff {
  ephemeralSkHex: string;
  startedAt: number;
  url: string;
  generation: number;
  authFlowId: string | null;
  canceled: boolean;
}

const trackedFlows = new Map<string, { canceled: boolean }>();

let _pending: PendingHandoff | null = null;
let delegationGeneration = 0;
let writeChain: Promise<void> = Promise.resolve();

async function disposeAuthFlow(flowId: string | null | undefined): Promise<void> {
  if (!flowId) return;
  const tracked = trackedFlows.get(flowId);
  if (tracked) tracked.canceled = true;
  try {
    await PaykitLinkNative.stopAuthKeepalive(flowId);
  } catch {
    // Keepalive stop must not mask cancel.
  }
  try {
    await PaykitLinkNative.cancelAuthFlow(flowId);
  } catch {
    // Native cancel is best-effort.
  }
}

export async function cancelPendingDelegation(): Promise<void> {
  delegationGeneration += 1;
  const work = writeChain.then(async () => {
    const flowId = _pending?.authFlowId ?? null;
    if (_pending) _pending.canceled = true;
    _pending = null;
    await disposeAuthFlow(flowId);
    await KeyStore.clearPendingRingHandoff();
  });
  writeChain = work.then(
    () => undefined,
    () => undefined,
  );
  await work;
}

export function getPendingDelegationSnapshot(): PendingDelegationSnapshot | null {
  if (!_pending?.url) return null;
  return {
    url: _pending.url,
    expiresAt: _pending.startedAt + ENABLE_AUTH_TTL_MS,
    generation: _pending.generation,
  };
}

export function buildPaykitConnectUrl(
  deviceId: string,
  ephemeralPkHex: string,
  auth?: { secret: string; relay: string },
): string {
  const callbackUrl = encodeURIComponent('hypercolor://ring-callback');
  let url =
    `pubkyring://paykit-connect` +
    `?deviceId=${encodeURIComponent(deviceId)}` +
    `&callback=${callbackUrl}` +
    `&ephemeralPk=${encodeURIComponent(ephemeralPkHex)}` +
    `&caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}`;
  if (auth) {
    url +=
      `&secret=${encodeURIComponent(auth.secret)}` +
      `&relay=${encodeURIComponent(auth.relay)}` +
      `&v=2`;
  }
  return url;
}

async function discardOwnWrite(
  myGen: number,
  ephemeralSkHex: string,
  flowId: string | null,
): Promise<void> {
  if (_pending?.generation === myGen) {
    _pending = null;
  }
  await disposeAuthFlow(flowId);
  let persisted: string | null = null;
  let readFailed = false;
  try {
    persisted = await KeyStore.getPendingRingHandoff();
  } catch {
    readFailed = true;
  }
  if (shouldClearHandoff(readFailed, persisted, ephemeralSkHex)) {
    try {
      await KeyStore.clearPendingRingHandoff();
    } catch {
      // Best-effort: never strand this generation's secret.
    }
  }
}

async function clearMatchingHandoff(ephemeralSkHex: string): Promise<void> {
  const work = writeChain.then(async () => {
    if (_pending?.ephemeralSkHex === ephemeralSkHex) {
      const flowId = _pending.authFlowId;
      _pending = null;
      await disposeAuthFlow(flowId);
    }
    let persisted: string | null = null;
    let readFailed = false;
    try {
      persisted = await KeyStore.getPendingRingHandoff();
    } catch {
      readFailed = true;
    }
    if (shouldClearHandoff(readFailed, persisted, ephemeralSkHex)) {
      try {
        await KeyStore.clearPendingRingHandoff();
      } catch {
        // Best-effort KeyStore clear.
      }
    }
  });
  writeChain = work.then(
    () => undefined,
    () => undefined,
  );
  await work;
}

function shouldClearHandoff(
  readFailed: boolean,
  persisted: string | null,
  ephemeralSkHex: string,
): boolean {
  if (persisted === ephemeralSkHex) return true;
  if (!readFailed) return false;
  return _pending == null || _pending.ephemeralSkHex === ephemeralSkHex;
}

async function pendingHandoffExpiresAt(ephemeralSkHex: string): Promise<number | null> {
  if (_pending?.ephemeralSkHex === ephemeralSkHex) {
    return _pending.startedAt + ENABLE_AUTH_TTL_MS;
  }
  try {
    const persisted = await KeyStore.getPendingRingHandoff();
    if (persisted !== ephemeralSkHex) return null;
    try {
      return await KeyStore.getPendingRingHandoffExpiresAt();
    } catch {
      return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * Generates an ephemeral X25519 keypair and builds the paykit-connect deep link.
 * Starts the scoped pubkyauth flow first when Paykit native is linked so the
 * QR can carry `secret`+`relay`+`v=2`. Concurrent stale generations never
 * persist `_pending`, never open Ring, and never return a URL.
 */
export async function requestDelegation(deviceId: string): Promise<DelegationRequest> {
  const myGen = ++delegationGeneration;
  const previousFlowId = _pending?.authFlowId ?? null;
  if (previousFlowId) {
    void disposeAuthFlow(previousFlowId);
  }

  let authFlowId: string | null = null;
  let authParts: PubkyauthAuthorizationParts | null = null;
  if (PaykitLinkNative.isAvailable()) {
    const started = await PaykitLinkNative.startAuthFlow(RING_GRANT_CAPABILITIES);
    if (myGen !== delegationGeneration) {
      await disposeAuthFlow(started.flowId);
      throw new StaleDelegationRequestError();
    }
    authParts = parsePubkyauthAuthorizationUrl(started.authorizationUrl);
    authFlowId = started.flowId;
    trackedFlows.set(started.flowId, { canceled: false });
  }

  const { secretKey: ephemeralSkHex, publicKey: ephemeralPkHex } = await x25519GenerateKeypair();

  let result: DelegationRequest | null = null;
  let stale = false;

  const write = writeChain.then(async () => {
    if (myGen !== delegationGeneration) {
      stale = true;
      await disposeAuthFlow(authFlowId);
      return;
    }
    const url = buildPaykitConnectUrl(
      deviceId,
      ephemeralPkHex,
      authParts ? { secret: authParts.secret, relay: authParts.relay } : undefined,
    );
    const startedAt = Date.now();
    _pending = {
      ephemeralSkHex,
      startedAt,
      url,
      generation: myGen,
      authFlowId,
      canceled: false,
    };
    await KeyStore.setPendingRingHandoff(ephemeralSkHex, startedAt + ENABLE_AUTH_TTL_MS);
    if (myGen !== delegationGeneration) {
      await discardOwnWrite(myGen, ephemeralSkHex, authFlowId);
      stale = true;
      return;
    }
    const canOpen = await Linking.canOpenURL('pubkyring://');
    if (myGen !== delegationGeneration) {
      await discardOwnWrite(myGen, ephemeralSkHex, authFlowId);
      stale = true;
      return;
    }
    if (canOpen) {
      await Linking.openURL(url);
    }
    if (myGen !== delegationGeneration) {
      await discardOwnWrite(myGen, ephemeralSkHex, authFlowId);
      stale = true;
      return;
    }
    result = { url, expiresAt: startedAt + ENABLE_AUTH_TTL_MS, generation: myGen };
  });
  writeChain = write.then(
    () => undefined,
    () => undefined,
  );
  await write;
  if (stale || !result) {
    throw new StaleDelegationRequestError();
  }
  return result;
}

export function certFromHandoffAppKey(appKey: NonNullable<HandoffPayload['app_key']>): AppCert {
  return {
    certBodyHex: appKey.cert_body,
    sigHex: appKey.cert_sig,
    certIdHex: appKey.cert_id,
  };
}

export async function resolvePendingEphemeralSk(): Promise<string> {
  if (_pending?.ephemeralSkHex) return _pending.ephemeralSkHex;
  const persisted = await KeyStore.getPendingRingHandoff();
  if (persisted) return persisted;
  throw new Error(
    'No pending delegation request. Call requestDelegation() before handling the callback.',
  );
}

export interface DelegationResult {
  pubky: string;
  homeserver: string;
  kind: 'combined' | 'legacy';
  receiverPublished: boolean;
}

interface HandoffPayload {
  version: number;
  pubky: string;
  session_secret?: string;
  capabilities?: string[];
  device_id?: string;
  noise_keypairs: Array<{
    epoch: number;
    public_key: string;
    secret_key: string;
  }>;
  noise_seed?: string;
  inbox_keypair: {
    public_key: string;
    secret_key: string;
  };
  app_key?: {
    ed25519_sk: string;
    ed25519_pk: string;
    cert_id: string;
    cert_body: string;
    cert_sig: string;
  };
  created_at?: number;
  expires_at?: number;
}

function parseCallback(url: string): {
  pubky: string;
  requestId: string;
  homeserver: string;
} {
  const parsed = new URL(url);
  const pubkyParam = parsed.searchParams.get('pubky');
  const requestId = parsed.searchParams.get('request_id');
  const mode = parsed.searchParams.get('mode');
  const homeserver = parsed.searchParams.get('homeserver');

  if (!pubkyParam || !requestId || !homeserver) {
    throw new Error('Invalid callback URL — missing required params.');
  }
  if (mode !== 'secure_handoff' && mode !== 'secure_handoff+pubkyauth') {
    throw new Error(`Unsupported handoff mode: ${mode}`);
  }
  const pubky = parsePubky(pubkyParam);
  if (!pubky) {
    throw new Error('Invalid callback URL — pubky is not a 52-character z-base-32 key.');
  }
  return { pubky, requestId, homeserver };
}

async function decryptHandoffInMemory(
  pubky: string,
  requestId: string,
  ephemeralSkHex: string,
): Promise<HandoffPayload> {
  const ownerPeeridHex = pubkyZ32ToHex(pubky);
  const handoffUrl = `pubky://${pubky}/pub/paykit.app/v0/handoff/${requestId}`;
  const getResult = await rnGet(handoffUrl);
  if (!getResult.isOk() || !getResult.value) {
    throw new Error('Handoff not found.');
  }

  const handoffJson = JSON.parse(getResult.value) as { sb2?: string };
  if (!handoffJson.sb2) {
    throw new Error('Handoff response is missing the "sb2" field.');
  }
  const envelopeBase64 = handoffJson.sb2;
  const storagePath = `/pub/paykit.app/v0/handoff/${requestId}`;

  const isValid = await sb2VerifySignature(envelopeBase64, ownerPeeridHex, storagePath);
  if (!isValid) {
    throw new Error('Handoff SB2 signature verification failed — possible tampering.');
  }

  const decryptResult = await sb2Decrypt(
    envelopeBase64,
    ephemeralSkHex,
    ownerPeeridHex,
    storagePath,
  );
  const payloadJson = Buffer.from(decryptResult.plaintext, 'hex').toString('utf8');
  const payload = JSON.parse(payloadJson) as HandoffPayload;

  if (!payload.app_key) {
    throw new Error(
      'pubky-ring handoff does not include an app_key. ' +
        'Ensure pubky-ring supports AppKey delegation (v3 handoff).',
    );
  }
  return payload;
}

/**
 * Persist UKD keys. Never stores `session_secret` (scoped pubkyauth is the
 * write credential). Drops any leftover MMKV session_secret.
 */
export async function adoptHandoff(
  pubky: string,
  homeserver: string,
  payload: HandoffPayload,
  ephemeralSkHex: string,
): Promise<void> {
  if (!payload.app_key) {
    throw new Error('Handoff is missing app_key');
  }
  await KeyStore.setAppKeypair({
    secretKey: payload.app_key.ed25519_sk,
    publicKey: payload.app_key.ed25519_pk,
  });
  await KeyStore.setAppCert(certFromHandoffAppKey(payload.app_key));
  await KeyStore.setInboxKeypair({
    secretKey: payload.inbox_keypair.secret_key,
    publicKey: payload.inbox_keypair.public_key,
  });
  const transportKeypair = payload.noise_keypairs[0];
  if (transportKeypair) {
    await KeyStore.setTransportKeypair({
      secretKey: transportKeypair.secret_key,
      publicKey: transportKeypair.public_key,
    });
  }
  KeyStore.setPubky(pubky);
  KeyStore.setHomeserver(homeserver);
  KeyStore.deleteSessionSecret();
  await clearMatchingHandoff(ephemeralSkHex);
}

async function awaitAuthWithDeadline(
  flowId: string,
  deadlineMs: number,
): Promise<{ sessionAlias: string; pubky: string }> {
  const remaining = Math.max(0, deadlineMs - Date.now());
  if (remaining === 0) {
    throw new ExpiredDelegationError();
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ExpiredDelegationError());
    }, remaining);
  });
  try {
    return await Promise.race([PaykitLinkNative.awaitAuthApproval(flowId), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Called when the app receives the `hypercolor://ring-callback?...` deep link.
 * Combined path decrypts in memory, awaits the tracked auth flow, then
 * session → keys → receiver. Legacy (no auth flow) persists keys only.
 */
export async function handleRingCallback(url: string): Promise<DelegationResult> {
  const { pubky, requestId, homeserver } = parseCallback(url);

  const ephemeralSkHex = await resolvePendingEphemeralSk();
  const expiresAt = await pendingHandoffExpiresAt(ephemeralSkHex);
  if (expiresAt == null || Date.now() >= expiresAt) {
    await clearMatchingHandoff(ephemeralSkHex);
    throw new ExpiredDelegationError();
  }

  const payload = await decryptHandoffInMemory(pubky, requestId, ephemeralSkHex);

  const latestSk = _pending?.ephemeralSkHex ?? (await KeyStore.getPendingRingHandoff());
  if (latestSk !== ephemeralSkHex) {
    throw new Error(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  }
  const expiresAtLate = await pendingHandoffExpiresAt(ephemeralSkHex);
  if (expiresAtLate == null || Date.now() >= expiresAtLate) {
    await clearMatchingHandoff(ephemeralSkHex);
    throw new ExpiredDelegationError();
  }
  if (_pending?.canceled) {
    throw new Error(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  }

  const flowId = _pending?.authFlowId ?? null;
  if (!flowId) {
    await adoptHandoff(pubky, homeserver, payload, ephemeralSkHex);
    return { pubky, homeserver, kind: 'legacy', receiverPublished: false };
  }

  let session: { sessionAlias: string; pubky: string };
  try {
    session = await awaitAuthWithDeadline(flowId, expiresAtLate);
  } catch (err) {
    await disposeAuthFlow(flowId);
    throw err;
  }

  const tracked = trackedFlows.get(flowId);
  if (tracked?.canceled || _pending?.canceled) {
    await LinkService.signOutSessionQuiet(session.sessionAlias);
    throw new Error(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  }

  if (session.pubky !== pubky || payload.pubky !== pubky) {
    await LinkService.signOutSessionQuiet(session.sessionAlias);
    throw new BindingMismatchError();
  }

  try {
    await LinkService.adoptApprovedSession(session.sessionAlias, session.pubky);
  } catch (err) {
    await LinkService.signOutSessionQuiet(session.sessionAlias);
    throw err;
  }

  await adoptHandoff(pubky, homeserver, payload, ephemeralSkHex);

  try {
    await LinkService.provisionReceiverAfterConnect();
  } catch (err) {
    throw new ProvisionReceiverFailedError(
      pubky,
      homeserver,
      err instanceof Error ? err.message : 'Failed to publish receiver',
    );
  }

  return { pubky, homeserver, kind: 'combined', receiverPublished: true };
}

export const PubkyRingAuthService = {
  requestDelegation,
  buildPaykitConnectUrl,
  parsePubkyauthAuthorizationUrl,
  handleRingCallback,
  cancelPendingDelegation,
  getPendingDelegationSnapshot,
  adoptHandoff,
  isStaleDelegationRequestError,
  isExpiredDelegationError,
  isProvisionReceiverFailedError,
  isBindingMismatchError,
};
