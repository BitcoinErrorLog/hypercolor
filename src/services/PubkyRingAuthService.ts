import { Linking } from 'react-native';
import { get as rnGet } from '@synonymdev/react-native-pubky';
import { x25519GenerateKeypair, sb2VerifySignature, sb2Decrypt } from '../utils/PubkyNoiseModule';
import { parsePubky, pubkyZ32ToHex } from '../utils/pubkyId';
import { RING_GRANT_CAPABILITIES } from '../types/link';
import { KeyStore, type AppCert } from './KeyStore';
import { COPY, ENABLE_AUTH_TTL_MS } from '../copy/uxCopy';
import { PaykitLinkNative } from './link/PaykitLinkNative';
import { LinkService } from './link/LinkService';

/**
 * PubkyRingAuthService
 *
 * Combined paykit-connect + pubkyauth (one Ring sheet):
 *  1. startAuthFlow (scoped RING_GRANT_CAPABILITIES) first; parse secret/relay.
 *  2. Mint ephemeral X25519; QR is pubkyring://paykit-connect with secret, relay, v=2.
 *  3. Ring posts the scoped AuthToken, then opens hypercolor://ring-callback
 *     with mode=secure_handoff+pubkyauth.
 *  4. Decrypt the SB2 handoff in memory; awaitAuthApproval; bind pubky;
 *     adoptApprovedSession → adoptHandoff (UKD keys) → provisionReceiver.
 *
 * Ring rejects QR without secret/relay. A cold start that lost in-memory
 * flowId never falls back to keys-only; the user must scan again.
 * session_secret is never stored.
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

export class CombinedFlowRestartRequiredError extends Error {
  override readonly name = 'CombinedFlowRestartRequiredError';
  constructor(message: string = COPY.connectScanAgain) {
    super(message);
  }
}

export class UpdatePubkyRingError extends Error {
  override readonly name = 'UpdatePubkyRingError';
  constructor(message = COPY.updatePubkyRing) {
    super(message);
  }
}

export const COMBINED_HANDOFF_MODE = 'secure_handoff+pubkyauth';
export const ALLOWED_PUBKYAUTH_RELAY_HOST = 'httprelay.pubky.app';

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

export function isCombinedFlowRestartRequiredError(err: unknown): boolean {
  return err instanceof CombinedFlowRestartRequiredError;
}

export function isUpdatePubkyRingError(err: unknown): boolean {
  return err instanceof UpdatePubkyRingError;
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
 * Parse a query string by hand. `new URL` is not used (RN/web parsers disagree).
 */
export function parseQueryParams(rawQuery: string): Map<string, string> {
  const hash = rawQuery.indexOf('#');
  const q = hash >= 0 ? rawQuery.slice(0, hash) : rawQuery;
  const params = new Map<string, string>();
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? decodeURIComponent(part) : decodeURIComponent(part.slice(0, eq));
    // Do not treat `+` as space: Ring sends `mode=secure_handoff+pubkyauth`.
    const value = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1));
    params.set(key, value);
  }
  return params;
}

export function assertAllowedPubkyauthRelay(relay: string): void {
  let parsed: URL;
  try {
    parsed = new URL(relay);
  } catch {
    throw new Error('pubkyauth relay URL is invalid');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('pubkyauth relay must be https');
  }
  if (parsed.hostname !== ALLOWED_PUBKYAUTH_RELAY_HOST) {
    throw new Error('pubkyauth relay host is not allowlisted');
  }
}

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
  const params = parseQueryParams(raw.slice(qIndex + 1));
  const caps = params.get('caps') ?? '';
  const secret = params.get('secret') ?? '';
  const relay = params.get('relay') ?? '';
  if (!caps || !secret || !relay) {
    throw new Error('pubkyauth URL is missing caps, secret, or relay');
  }
  if (caps !== RING_GRANT_CAPABILITIES) {
    throw new Error('pubkyauth caps do not match RING_GRANT_CAPABILITIES');
  }
  assertAllowedPubkyauthRelay(relay);
  return { caps, secret, relay };
}

interface PendingHandoff {
  ephemeralSkHex: string;
  startedAt: number;
  url: string;
  generation: number;
  authFlowId: string | null;
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
  trackedFlows.delete(flowId);
}

function isDuplicateAwaitError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const rec = err as { code?: unknown; message?: unknown };
  if (rec.code === 'validation') return true;
  return typeof rec.message === 'string' && rec.message.includes('already awaiting');
}

export async function cancelPendingDelegation(): Promise<void> {
  delegationGeneration += 1;
  const work = writeChain.then(async () => {
    const flowId = _pending?.authFlowId ?? null;
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

  if (!PaykitLinkNative.isAvailable()) {
    throw new Error('Paykit native module is required for Connect');
  }
  const started = await PaykitLinkNative.startAuthFlow(RING_GRANT_CAPABILITIES);
  if (myGen !== delegationGeneration) {
    await disposeAuthFlow(started.flowId);
    throw new StaleDelegationRequestError();
  }
  const authParts = parsePubkyauthAuthorizationUrl(started.authorizationUrl);
  const authFlowId = started.flowId;
  trackedFlows.set(started.flowId, { canceled: false });

  const { secretKey: ephemeralSkHex, publicKey: ephemeralPkHex } = await x25519GenerateKeypair();

  let result: DelegationRequest | null = null;
  let stale = false;

  const write = writeChain.then(async () => {
    if (myGen !== delegationGeneration) {
      stale = true;
      await disposeAuthFlow(authFlowId);
      return;
    }
    const url = buildPaykitConnectUrl(deviceId, ephemeralPkHex, {
      secret: authParts.secret,
      relay: authParts.relay,
    });
    const startedAt = Date.now();
    _pending = {
      ephemeralSkHex,
      startedAt,
      url,
      generation: myGen,
      authFlowId,
    };
    await KeyStore.setPendingRingHandoff(ephemeralSkHex, startedAt + ENABLE_AUTH_TTL_MS, {
      combined: true,
    });
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
  mode: string;
} {
  if (typeof url !== 'string' || !url.startsWith('hypercolor:')) {
    throw new Error('Invalid callback URL — missing required params.');
  }
  const qIndex = url.indexOf('?');
  if (qIndex < 0) {
    throw new Error('Invalid callback URL — missing required params.');
  }
  const params = parseQueryParams(url.slice(qIndex + 1));
  const pubkyParam = params.get('pubky');
  const requestId = params.get('request_id');
  const mode = params.get('mode');
  const homeserver = params.get('homeserver');

  if (!pubkyParam || !requestId || !homeserver) {
    throw new Error('Invalid callback URL — missing required params.');
  }
  if (mode !== COMBINED_HANDOFF_MODE && mode !== 'secure_handoff') {
    throw new Error(`Unsupported handoff mode: ${mode}`);
  }
  const pubky = parsePubky(pubkyParam);
  if (!pubky) {
    throw new Error('Invalid callback URL — pubky is not a 52-character z-base-32 key.');
  }
  return { pubky, requestId, homeserver, mode };
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
    // Accepted limitation: Paykit FFI `awaitApproval` is not abortable. If this
    // JS timeout wins, `disposeAuthFlow` still cancels the native job/tombstone,
    // but the in-flight UniFFI poll may continue until the relay times out.
    return await Promise.race([PaykitLinkNative.awaitAuthApproval(flowId), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Called when the app receives the `hypercolor://ring-callback?...` deep link.
 * Combined path decrypts in memory, awaits the tracked auth flow, then
 * session → keys → receiver. Lost in-memory flowId never adopts keys-only.
 */
export async function handleRingCallback(url: string): Promise<DelegationResult> {
  const { pubky, requestId, homeserver, mode } = parseCallback(url);
  const entryGeneration = delegationGeneration;

  const ephemeralSkHex = await resolvePendingEphemeralSk();
  if (entryGeneration !== delegationGeneration) {
    throw new Error(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  }
  const expiresAt = await pendingHandoffExpiresAt(ephemeralSkHex);
  if (expiresAt == null || Date.now() >= expiresAt) {
    await clearMatchingHandoff(ephemeralSkHex);
    throw new ExpiredDelegationError();
  }

  const payload = await decryptHandoffInMemory(pubky, requestId, ephemeralSkHex);
  if (entryGeneration !== delegationGeneration) {
    throw new Error(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  }

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
  if (entryGeneration !== delegationGeneration) {
    throw new Error(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  }

  const flowId = _pending?.authFlowId ?? null;
  const persistedCombined = await KeyStore.getPendingRingHandoffCombined();
  if (!flowId) {
    await clearMatchingHandoff(ephemeralSkHex);
    throw new CombinedFlowRestartRequiredError(
      persistedCombined ? COPY.connectScanAgain : COPY.updatePubkyRing,
    );
  }

  if (mode !== COMBINED_HANDOFF_MODE) {
    await disposeAuthFlow(flowId);
    throw new UpdatePubkyRingError();
  }

  let session: { sessionAlias: string; pubky: string };
  try {
    session = await awaitAuthWithDeadline(flowId, expiresAtLate);
  } catch (err) {
    if (isDuplicateAwaitError(err)) {
      throw err;
    }
    await disposeAuthFlow(flowId);
    throw err;
  }
  if (entryGeneration !== delegationGeneration) {
    await LinkService.signOutSessionQuiet(session.sessionAlias);
    throw new Error(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  }

  const tracked = trackedFlows.get(flowId);
  if (tracked?.canceled) {
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
  if (entryGeneration !== delegationGeneration) {
    await LinkService.rollbackAdoptedSession(session.sessionAlias);
    throw new Error(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  }

  try {
    await adoptHandoff(pubky, homeserver, payload, ephemeralSkHex);
  } catch (err) {
    await LinkService.rollbackAdoptedSession(session.sessionAlias);
    throw err;
  }

  try {
    await LinkService.provisionReceiverAfterConnect();
  } catch (err) {
    throw new ProvisionReceiverFailedError(
      pubky,
      homeserver,
      err instanceof Error ? err.message : 'Failed to publish receiver',
    );
  }

  trackedFlows.delete(flowId);
  return { pubky, homeserver, kind: 'combined', receiverPublished: true };
}

export const PubkyRingAuthService = {
  requestDelegation,
  buildPaykitConnectUrl,
  parsePubkyauthAuthorizationUrl,
  parseQueryParams,
  handleRingCallback,
  cancelPendingDelegation,
  getPendingDelegationSnapshot,
  adoptHandoff,
  isStaleDelegationRequestError,
  isExpiredDelegationError,
  isProvisionReceiverFailedError,
  isBindingMismatchError,
  isCombinedFlowRestartRequiredError,
  isUpdatePubkyRingError,
};
