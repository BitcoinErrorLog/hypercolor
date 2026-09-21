import { Linking } from 'react-native';
import { RING_GRANT_CAPABILITIES } from '../types/link';
import { parsePubky } from '../utils/pubkyId';
import { KeyStore } from './KeyStore';
import { COPY, ENABLE_AUTH_TTL_MS } from '../copy/uxCopy';
import { PaykitLinkNative, isLinkNativeError } from './link/PaykitLinkNative';
import { LinkService } from './link/LinkService';
import {
  BindingMismatchError,
  isBindingMismatchError,
  isScopesDeclinedError,
  rejectIfOwnerMismatch,
  requireRingGrantCoverage,
  revokeUncommittedAlias,
  ScopesDeclinedError,
} from './adoptSessionGates';
import {
  ALLOWED_PUBKYAUTH_RELAY_HOST,
  assertAllowedPubkyauthRelay,
  parsePubkyauthAuthorizationUrl,
  parseQueryParams,
} from './pubkyauthUrl';

/**
 * PubkyRingAuthService
 *
 * Standard Ring `pubkyauth://` ceremony (stock Pubky Ring):
 *  1. `startAuthFlow(RING_GRANT_CAPABILITIES)` mints `pubkyauth:///?caps=&secret=&relay=`.
 *  2. Present that raw URL (QR + Open Pubky Ring). Do not wrap paykit-connect.
 *  3. `awaitAuthApproval` starts immediately; Ring posts the AuthToken to httprelay.
 *  4. F2 + F7 gates, then adopt the session alias and provision the receiver.
 *     No AppKey / AppCert / inbox / transport from Ring.
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

export type PendingDelegationSnapshot = {
  url: string;
  expiresAt: number;
  generation: number;
};

export type DelegationRequest = PendingDelegationSnapshot;

export type DelegationResult =
  | {
      kind: 'adopted';
      pubky: string;
      homeserver: string;
      receiverPublished: boolean;
    }
  | {
      kind: 'confirm';
      pubky: string;
      homeserver: string;
      sessionAlias: string;
    };

interface PendingAuthFlow {
  flowId: string;
  startedAt: number;
  authorizationUrl: string;
  generation: number;
  awaitPromise: Promise<{ sessionAlias: string; pubky: string }>;
}

interface PendingConfirm {
  flowId: string;
  sessionAlias: string;
  pubky: string;
  homeserver: string;
  generation: number;
}

const trackedFlows = new Map<string, { canceled: boolean }>();

let _pending: PendingAuthFlow | null = null;
let _pendingConfirm: PendingConfirm | null = null;
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

function isAuthDenied(err: unknown): boolean {
  return isLinkNativeError(err) && (err.code === 'auth' || err.code === 'validation');
}

export async function cancelPendingDelegation(): Promise<void> {
  delegationGeneration += 1;
  const work = writeChain.then(async () => {
    const flowId = _pending?.flowId ?? null;
    const awaitPromise = _pending?.awaitPromise;
    const confirm = _pendingConfirm;
    _pending = null;
    _pendingConfirm = null;
    await disposeAuthFlow(flowId);
    if (awaitPromise) {
      void awaitPromise
        .then(session => LinkService.signOutSessionQuiet(session.sessionAlias))
        .catch(() => undefined);
    }
    if (confirm) {
      await revokeUncommittedAlias(confirm.sessionAlias);
    }
    try {
      await KeyStore.clearPendingRingHandoff();
    } catch {
      // Leftover RING_PENDING from a prior build is hygiene, not product state.
    }
  });
  writeChain = work.then(
    () => undefined,
    () => undefined,
  );
  await work;
}

export function getPendingDelegationSnapshot(): PendingDelegationSnapshot | null {
  if (!_pending?.authorizationUrl) return null;
  return {
    url: _pending.authorizationUrl,
    expiresAt: _pending.startedAt + ENABLE_AUTH_TTL_MS,
    generation: _pending.generation,
  };
}

async function awaitAuthWithDeadline(
  pending: PendingAuthFlow,
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
    return await Promise.race([pending.awaitPromise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function adoptAndProvision(
  sessionAlias: string,
  pubky: string,
  homeserver: string,
): Promise<DelegationResult> {
  try {
    await LinkService.adoptApprovedSession(sessionAlias, pubky);
  } catch (err) {
    await LinkService.signOutSessionQuiet(sessionAlias);
    throw err;
  }
  KeyStore.setHomeserver(homeserver);
  try {
    await LinkService.provisionReceiverAfterConnect();
  } catch (err) {
    if (isAuthDenied(err) || isScopesDeclinedError(err)) {
      await revokeUncommittedAlias(sessionAlias);
      throw new ScopesDeclinedError();
    }
    throw new ProvisionReceiverFailedError(
      pubky,
      homeserver,
      err instanceof Error ? err.message : 'Failed to publish receiver',
    );
  }
  return { kind: 'adopted', pubky, homeserver, receiverPublished: true };
}

/**
 * Mint a raw `pubkyauth://` URL and start `awaitAuthApproval` immediately.
 * `deviceId` is unused (stock Ring has no paykit-connect device field).
 */
export async function requestDelegation(_deviceId?: string): Promise<DelegationRequest> {
  const myGen = ++delegationGeneration;
  const previousFlowId = _pending?.flowId ?? null;
  const previousAwait = _pending?.awaitPromise;
  const previousConfirm = _pendingConfirm;
  if (previousFlowId) {
    void disposeAuthFlow(previousFlowId);
  }
  if (previousAwait) {
    void previousAwait
      .then(session => LinkService.signOutSessionQuiet(session.sessionAlias))
      .catch(() => undefined);
  }
  _pendingConfirm = null;
  if (previousConfirm) {
    await revokeUncommittedAlias(previousConfirm.sessionAlias);
  }

  if (!PaykitLinkNative.isAvailable()) {
    throw new Error(COPY.couldNotStartAuthorization);
  }
  const started = await PaykitLinkNative.startAuthFlow(RING_GRANT_CAPABILITIES);
  if (myGen !== delegationGeneration) {
    await disposeAuthFlow(started.flowId);
    throw new StaleDelegationRequestError();
  }
  try {
    parsePubkyauthAuthorizationUrl(started.authorizationUrl);
  } catch (err) {
    await disposeAuthFlow(started.flowId);
    throw err;
  }
  const authFlowId = started.flowId;
  trackedFlows.set(started.flowId, { canceled: false });
  const awaitPromise = PaykitLinkNative.awaitAuthApproval(started.flowId).catch(err => {
    if (isDuplicateAwaitError(err)) throw err;
    throw err;
  });

  let result: DelegationRequest | null = null;
  let stale = false;

  const write = writeChain.then(async () => {
    if (myGen !== delegationGeneration) {
      stale = true;
      await disposeAuthFlow(authFlowId);
      return;
    }
    const startedAt = Date.now();
    _pending = {
      flowId: authFlowId,
      startedAt,
      authorizationUrl: started.authorizationUrl,
      generation: myGen,
      awaitPromise,
    };
    if (myGen !== delegationGeneration) {
      _pending = null;
      await disposeAuthFlow(authFlowId);
      stale = true;
      return;
    }
    const canOpen = await Linking.canOpenURL('pubkyauth://');
    if (myGen !== delegationGeneration) {
      _pending = null;
      await disposeAuthFlow(authFlowId);
      stale = true;
      return;
    }
    if (canOpen) {
      await Linking.openURL(started.authorizationUrl);
    }
    if (myGen !== delegationGeneration) {
      _pending = null;
      await disposeAuthFlow(authFlowId);
      stale = true;
      return;
    }
    result = {
      url: started.authorizationUrl,
      expiresAt: startedAt + ENABLE_AUTH_TTL_MS,
      generation: myGen,
    };
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

export async function watchPendingApproval(): Promise<DelegationResult> {
  const pending = _pending;
  if (!pending) {
    throw new Error('No pending delegation request. Call requestDelegation() first.');
  }
  const myGen = pending.generation;
  const deadline = pending.startedAt + ENABLE_AUTH_TTL_MS;

  let session: { sessionAlias: string; pubky: string };
  try {
    session = await awaitAuthWithDeadline(pending, deadline);
  } catch (err) {
    if (isExpiredDelegationError(err)) {
      await disposeAuthFlow(pending.flowId);
      void pending.awaitPromise
        .then(late => LinkService.signOutSessionQuiet(late.sessionAlias))
        .catch(() => undefined);
    } else if (!isDuplicateAwaitError(err)) {
      await disposeAuthFlow(pending.flowId);
    }
    throw err;
  }

  if (myGen !== delegationGeneration) {
    await LinkService.signOutSessionQuiet(session.sessionAlias);
    throw new StaleDelegationRequestError();
  }
  const tracked = trackedFlows.get(pending.flowId);
  if (tracked?.canceled) {
    await LinkService.signOutSessionQuiet(session.sessionAlias);
    throw new StaleDelegationRequestError();
  }

  const pubky = parsePubky(session.pubky);
  if (!pubky) {
    await LinkService.signOutSessionQuiet(session.sessionAlias);
    throw new Error('Approved session pubky is not a 52-character z-base-32 key.');
  }

  let binding: 'match' | 'fresh';
  try {
    binding = await rejectIfOwnerMismatch(session.sessionAlias, pubky);
  } catch (err) {
    throw err;
  }

  const inspected = await requireRingGrantCoverage(session.sessionAlias);
  if (myGen !== delegationGeneration) {
    await LinkService.signOutSessionQuiet(session.sessionAlias);
    throw new StaleDelegationRequestError();
  }

  try {
    await PaykitLinkNative.stopAuthKeepalive(pending.flowId);
  } catch {
    // Keepalive stop must not mask adopt.
  }

  if (binding === 'fresh') {
    _pendingConfirm = {
      flowId: pending.flowId,
      sessionAlias: session.sessionAlias,
      pubky,
      homeserver: inspected.origin,
      generation: myGen,
    };
    return {
      kind: 'confirm',
      pubky,
      homeserver: inspected.origin,
      sessionAlias: session.sessionAlias,
    };
  }

  const adopted = await adoptAndProvision(session.sessionAlias, pubky, inspected.origin);
  if (_pending?.generation === myGen) {
    _pending = null;
  }
  trackedFlows.delete(pending.flowId);
  return adopted;
}

export async function confirmFreshIdentity(): Promise<DelegationResult> {
  const confirm = _pendingConfirm;
  if (!confirm) {
    throw new Error('No pending identity to confirm.');
  }
  if (confirm.generation !== delegationGeneration) {
    await revokeUncommittedAlias(confirm.sessionAlias);
    _pendingConfirm = null;
    throw new StaleDelegationRequestError();
  }
  _pendingConfirm = null;
  if (_pending?.generation === confirm.generation) {
    _pending = null;
  }
  const adopted = await adoptAndProvision(confirm.sessionAlias, confirm.pubky, confirm.homeserver);
  trackedFlows.delete(confirm.flowId);
  return adopted;
}

export async function rejectFreshIdentity(): Promise<void> {
  const confirm = _pendingConfirm;
  _pendingConfirm = null;
  if (!confirm) return;
  if (_pending?.generation === confirm.generation) {
    _pending = null;
  }
  await revokeUncommittedAlias(confirm.sessionAlias);
}

export const PubkyRingAuthService = {
  requestDelegation,
  parsePubkyauthAuthorizationUrl,
  parseQueryParams,
  assertAllowedPubkyauthRelay,
  cancelPendingDelegation,
  getPendingDelegationSnapshot,
  watchPendingApproval,
  confirmFreshIdentity,
  rejectFreshIdentity,
  isStaleDelegationRequestError,
  isExpiredDelegationError,
  isProvisionReceiverFailedError,
  isBindingMismatchError,
  isScopesDeclinedError,
};

export {
  ALLOWED_PUBKYAUTH_RELAY_HOST,
  BindingMismatchError,
  ScopesDeclinedError,
  parsePubkyauthAuthorizationUrl,
  parseQueryParams,
  assertAllowedPubkyauthRelay,
};
