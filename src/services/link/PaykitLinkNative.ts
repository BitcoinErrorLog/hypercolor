import { NativeModules } from 'react-native';
import { formatAuthFlowCapabilities } from '../../types/link';

/**
 * PaykitLinkNative — typed JS bridge to the PaykitLinkModule native
 * implementation (Swift/Kotlin, built later).
 *
 * Design principle: secret material NEVER crosses the JS bridge. Native owns
 * keychain storage for the receiver Noise secret and the homeserver bearer.
 * JS references those only by opaque alias. Snapshots cross the bridge ONLY
 * as AEAD ciphertext (base64) encrypted natively under a per-install device
 * key, with AAD binding
 * `{ownerPubky, peerPubky, localReceiverPath, remoteReceiverPath, role}`.
 * TypeScript must never parse a snapshot — persist it and pass it back.
 *
 * `signinWithSecret` / `signupWithSecret` are the sole exceptions that accept
 * a secret: they are the **dev/e2e-only** test-harness path and are gated out
 * of release native builds (`BuildConfig.DEBUG` on Android, `#if DEBUG` on
 * iOS). Production uses `startAuthFlow` / `awaitAuthApproval`.
 *
 * Every method (except sync `isAvailable`) can reject with a {@link LinkNativeError}.
 */

export const LINK_NATIVE_ERROR_CODES = [
  'network',
  'auth',
  'protocol',
  'consumed',
  'validation',
  'unavailable',
  'auth_flow_cancelled',
] as const;

export type LinkNativeErrorCode = (typeof LINK_NATIVE_ERROR_CODES)[number];

/** Typed rejection from the native module (or the JS wrapper). */
export type LinkNativeError = {
  code: LinkNativeErrorCode;
  message: string;
};

export function isLinkNativeErrorCode(value: unknown): value is LinkNativeErrorCode {
  return (
    typeof value === 'string' && (LINK_NATIVE_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function isLinkNativeError(err: unknown): err is LinkNativeError {
  if (typeof err !== 'object' || err === null) return false;
  const rec = err as { code?: unknown; message?: unknown };
  return isLinkNativeErrorCode(rec.code) && typeof rec.message === 'string';
}

export function createLinkNativeError(code: LinkNativeErrorCode, message: string): LinkNativeError {
  return { code, message };
}

/**
 * Coarse static messages mirroring the native bridge (`PaykitLinkModule`
 * `staticMessage`). Unknown / untyped rejections must never forward raw
 * native exception text to JS logs or UI — it can contain filesystem paths
 * or key material.
 */
const COARSE_NATIVE_MESSAGES: Record<LinkNativeErrorCode, string> = {
  network: 'network error',
  auth: 'authentication failed',
  protocol: 'protocol error',
  consumed: 'resource consumed',
  validation: 'validation failed',
  unavailable: 'unavailable',
  auth_flow_cancelled: 'auth flow cancelled',
};

export function toLinkNativeError(err: unknown): LinkNativeError {
  // Already a typed error: created by this wrapper or by the native bridge,
  // which sends only coarse static messages.
  if (isLinkNativeError(err)) return err;
  if (typeof err === 'object' && err !== null) {
    const rec = err as { code?: unknown; userInfo?: { code?: unknown } };
    if (isLinkNativeErrorCode(rec.code)) {
      return { code: rec.code, message: COARSE_NATIVE_MESSAGES[rec.code] };
    }
    if (isLinkNativeErrorCode(rec.userInfo?.code)) {
      return { code: rec.userInfo.code, message: COARSE_NATIVE_MESSAGES[rec.userInfo.code] };
    }
  }
  return { code: 'protocol', message: COARSE_NATIVE_MESSAGES.protocol };
}

export interface ReceiverKeyResult {
  receiverAlias: string;
  noisePublicKey: string;
}

export interface AuthFlowStart {
  flowId: string;
  authorizationUrl: string;
}

export interface AuthSessionResult {
  sessionAlias: string;
  pubky: string;
}

export interface RestoredSession {
  pubky: string;
}

export interface ReceiverMarker {
  noisePublicKey: string;
  capabilitiesJson: string;
}

export interface LinkInitiateResult {
  linkId: string;
  snapshot: string;
}

export type LinkProbeResult =
  | { result: 'none' }
  | { result: 'pending'; linkId: string; snapshot: string }
  | { result: 'established'; linkId: string; snapshot: string };

export interface LinkAdvanceResult {
  status: 'pending' | 'established';
  snapshot: string;
}

export interface LinkRestoreHandshakeResult {
  linkId: string;
  status: 'pending' | 'established';
}

export interface LinkRestoreResult {
  linkId: string;
}

export interface LinkSendResult {
  snapshot: string;
}

/**
 * One inbound Private Application Message. `event_id` is NOT a native field —
 * parse it from `rawJson` in TypeScript.
 */
export interface LinkInboundMessage {
  version: number | null;
  kind: string | null;
  rawJson: string;
}

export interface LinkReceiveResult {
  messages: LinkInboundMessage[];
  snapshot: string;
}

/** Native XChaCha20-Poly1305 attachment ciphertext (base64url, no padding). */
export interface AttachmentCiphertext {
  nonceB64: string;
  ciphertextB64: string;
  algorithm: string;
}

export interface PaykitLinkNativeApi {
  /** True when the native module is linked into this build. */
  isAvailable(): boolean;
  /** Generates a receiver Noise secret natively and stores it under an alias. */
  generateReceiverKey(): Promise<ReceiverKeyResult>;
  getReceiverPublicKey(receiverAlias: string): Promise<string>;
  startAuthFlow(capabilities: string, relayUrl?: string): Promise<AuthFlowStart>;
  /**
   * Suspend until Ring approves `flowId`. Native admits one owner lease per
   * live flow. A second call while that owner is reserved, awaiting, committing,
   * or still settling a cancellation is rejected (`validation` / "already awaiting") —
   * there is no retry-in-place. Only that owner may prune cancellation or
   * surfaced state. Cancel-before-await rejects `auth_flow_cancelled` and that
   * caller is the owner who prunes the tombstone. Bridge/module invalidation
   * and coroutine-scope teardown reject `unavailable` (not
   * `auth_flow_cancelled`) and never persist: persist + JS resolve are one
   * lock-linearized commit while the owner slot is still teardown-visible as
   * `committing(lease)`. If invalidation wins that race, native writes nothing
   * and does not resolve. If the commit wins, teardown must not roll back the
   * adopted session. After invalidation, a later
   * `startAuthFlow` / `awaitAuthApproval` / `cancelAuthFlow` rejects
   * `unavailable` immediately. After a failed, cancelled, torn-down, or
   * successful await the native flow is gone; start a new `startAuthFlow`
   * to try again. Close is exact-once: the admitted owner closes after the
   * FFI wait settles.
   */
  awaitAuthApproval(flowId: string): Promise<AuthSessionResult>;
  /**
   * Android: stop the Ring-auth foreground keepalive if `flowId` still owns
   * it. A stale id must not stop a newer attempt. No-op when the native
   * method is missing (iOS / older builds).
   */
  stopAuthKeepalive(flowId: string): Promise<void>;
  /**
   * Retire `flowId`'s native waiter. Paykit FFI has no auth-flow cancel
   * primitive. Native discard cancels the await job, drops a not-yet-awaited
   * flow so its relay subscription stops, stops keepalive, and marks a
   * tombstone the await owner (lease) must observe. A wait already spawned
   * by `awaitApproval` runs to completion inside Paykit and cannot be
   * aborted; after that FFI await returns, native must not persist, must
   * `close()` the handle exactly once (the admitted owner closes; idle /
   * cancel-before-await close immediately), and rejects `auth_flow_cancelled`.
   * Module invalidation rejects `unavailable` instead — teardown is not a
   * user cancel. `clearAllNativeSecrets` (sign-out) cancels admitted owners
   * the same way and also rejects `auth_flow_cancelled`: it is a user discard,
   * not module teardown, so a later `startAuthFlow` still succeeds. Idle
   * flows close immediately; owners close exactly once in their finally.
   * Cancel-before-await rejects the later `awaitAuthApproval`
   * with `auth_flow_cancelled`. A duplicate await of a live owner is
   * `validation` / "already awaiting" and cannot consume the tombstone.
   * Unknown ids and a second cancel are no-ops. A flow whose approval was
   * already surfaced to JS is left untouched. After invalidation this method
   * rejects `unavailable`. No-op when the native method is missing (older
   * builds).
   */
  cancelAuthFlow(flowId: string): Promise<void>;
  /**
   * Dev/e2e only — release native builds reject with `unavailable` /
   * "secret import is disabled in release builds". Signs in with an
   * identity secret; native stores the bearer under `sessionAlias`.
   * The secret is not persisted in JS.
   */
  signinWithSecret(identitySecretHex: string): Promise<AuthSessionResult>;
  /**
   * Dev/e2e only — release native builds reject with `unavailable` /
   * "secret import is disabled in release builds". Signs up a fresh
   * identity on a homeserver with a raw 32-byte secret (64-char hex).
   * Native stores the bearer under `sessionAlias`. The secret is not
   * persisted in JS.
   */
  signupWithSecret(
    identitySecretHex: string,
    homeserverPublicKey: string,
    signupToken?: string,
  ): Promise<AuthSessionResult>;
  /**
   * Native loads and refreshes the bearer. Rejects with `auth` iff the
   * session is revoked or expired; `network` keeps the alias usable.
   */
  restoreSession(sessionAlias: string): Promise<RestoredSession>;
  signOutSession(sessionAlias: string): Promise<void>;
  /**
   * Deletes every native-owned PaykitLink secret on this device (receiver
   * Noise secrets, session bearers, snapshot key, and attachment-key
   * Keychain items). Per-owner tagging is not stored natively, so this
   * wipes the entire app store. Used on sign-out / account switch.
   * Live auth flows: idle handles close immediately; admitted owners are
   * cancelled and close exactly once after FFI settles; in-flight
   * `awaitAuthApproval` rejects `auth_flow_cancelled` and must not persist.
   */
  clearAllNativeSecrets(): Promise<void>;
  publishReceiverMarker(
    sessionAlias: string,
    receiverAlias: string,
    receiverPath: string,
  ): Promise<void>;
  getReceiverMarker(peerPubky: string, receiverPath: string): Promise<ReceiverMarker | null>;
  removeReceiverMarker(sessionAlias: string, receiverPath: string): Promise<void>;
  initiateLink(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
  ): Promise<LinkInitiateResult>;
  /**
   * Atomic inbound probe. `none` is NOT an error — nothing inbound, prior
   * state must be left untouched.
   */
  probeInboundLink(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
  ): Promise<LinkProbeResult>;
  advanceHandshake(linkId: string): Promise<LinkAdvanceResult>;
  restoreHandshake(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
    snapshot: string,
  ): Promise<LinkRestoreHandshakeResult>;
  restoreLink(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
    snapshot: string,
  ): Promise<LinkRestoreResult>;
  sendPrivateMessageJson(linkId: string, rawJson: string): Promise<LinkSendResult>;
  receivePrivateMessages(linkId: string): Promise<LinkReceiveResult>;
  clearLinkOutbox(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
  ): Promise<number>;
  closeLink(linkId: string): Promise<void>;
  /**
   * Owner homeserver PUT using the Paykit ChatSession for `sessionAlias`
   * (same session as Encrypted Links / `publishReceiverMarker`).
   * `homeserverOrigin` is the resolved HTTPS origin (no secret). Native
   * sends the homeserver cookie secret extracted from
   * `ChatSession.exportSession()` (`<pubkey>:<cookie_secret>`).
   */
  putPublic(
    sessionAlias: string,
    url: string,
    content: string,
    homeserverOrigin: string,
  ): Promise<void>;
  deletePublic(sessionAlias: string, url: string, homeserverOrigin: string): Promise<void>;
  /** Random 32-byte attachment key, base64url (no padding). */
  generateAttachmentKey(): Promise<string>;
  attachmentEncrypt(
    plaintextB64: string,
    keyB64: string,
    aad?: string | null,
  ): Promise<AttachmentCiphertext>;
  /** Returns plaintext as base64url (no padding). Auth failure is `protocol`. */
  attachmentDecrypt(
    ciphertextB64: string,
    keyB64: string,
    nonceB64: string,
    aad?: string | null,
  ): Promise<string>;
}

const { PaykitLinkModule } = NativeModules;

function requireModule(): Record<string, (...args: unknown[]) => unknown> {
  if (PaykitLinkModule == null) {
    throw createLinkNativeError('unavailable', 'PaykitLinkModule native module is not available');
  }
  return PaykitLinkModule as Record<string, (...args: unknown[]) => unknown>;
}

async function invoke<T>(method: string, ...args: unknown[]): Promise<T> {
  const mod = requireModule();
  const fn = mod[method];
  if (typeof fn !== 'function') {
    throw createLinkNativeError('unavailable', `PaykitLinkModule.${method} is not available`);
  }
  try {
    return (await fn(...args)) as T;
  } catch (err) {
    throw toLinkNativeError(err);
  }
}

export const PaykitLinkNative: PaykitLinkNativeApi = {
  isAvailable(): boolean {
    return PaykitLinkModule != null;
  },

  generateReceiverKey(): Promise<ReceiverKeyResult> {
    return invoke('generateReceiverKey');
  },

  getReceiverPublicKey(receiverAlias: string): Promise<string> {
    return invoke('getReceiverPublicKey', receiverAlias);
  },

  startAuthFlow(capabilities: string, relayUrl?: string): Promise<AuthFlowStart> {
    let canonical: string;
    try {
      canonical = formatAuthFlowCapabilities(capabilities);
    } catch {
      return Promise.reject(createLinkNativeError('validation', COARSE_NATIVE_MESSAGES.validation));
    }
    return invoke('startAuthFlow', canonical, relayUrl ?? null);
  },

  awaitAuthApproval(flowId: string): Promise<AuthSessionResult> {
    return invoke('awaitAuthApproval', flowId);
  },

  stopAuthKeepalive(flowId: string): Promise<void> {
    if (PaykitLinkModule == null || typeof PaykitLinkModule.stopAuthKeepalive !== 'function') {
      return Promise.resolve();
    }
    return invoke('stopAuthKeepalive', flowId);
  },

  cancelAuthFlow(flowId: string): Promise<void> {
    if (PaykitLinkModule == null || typeof PaykitLinkModule.cancelAuthFlow !== 'function') {
      return Promise.resolve();
    }
    return invoke('cancelAuthFlow', flowId);
  },

  signinWithSecret(identitySecretHex: string): Promise<AuthSessionResult> {
    return invoke('signinWithSecret', identitySecretHex);
  },

  signupWithSecret(
    identitySecretHex: string,
    homeserverPublicKey: string,
    signupToken?: string,
  ): Promise<AuthSessionResult> {
    return invoke('signupWithSecret', identitySecretHex, homeserverPublicKey, signupToken ?? null);
  },

  restoreSession(sessionAlias: string): Promise<RestoredSession> {
    return invoke('restoreSession', sessionAlias);
  },

  signOutSession(sessionAlias: string): Promise<void> {
    return invoke('signOutSession', sessionAlias);
  },

  clearAllNativeSecrets(): Promise<void> {
    return invoke('clearAllNativeSecrets');
  },

  publishReceiverMarker(
    sessionAlias: string,
    receiverAlias: string,
    receiverPath: string,
  ): Promise<void> {
    return invoke('publishReceiverMarker', sessionAlias, receiverAlias, receiverPath);
  },

  getReceiverMarker(peerPubky: string, receiverPath: string): Promise<ReceiverMarker | null> {
    return invoke('getReceiverMarker', peerPubky, receiverPath);
  },

  removeReceiverMarker(sessionAlias: string, receiverPath: string): Promise<void> {
    return invoke('removeReceiverMarker', sessionAlias, receiverPath);
  },

  initiateLink(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
  ): Promise<LinkInitiateResult> {
    return invoke(
      'initiateLink',
      sessionAlias,
      receiverAlias,
      peerPubky,
      peerNoisePublicKey,
      localReceiverPath,
      remoteReceiverPath,
    );
  },

  probeInboundLink(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
  ): Promise<LinkProbeResult> {
    return invoke(
      'probeInboundLink',
      sessionAlias,
      receiverAlias,
      peerPubky,
      peerNoisePublicKey,
      localReceiverPath,
      remoteReceiverPath,
    );
  },

  advanceHandshake(linkId: string): Promise<LinkAdvanceResult> {
    return invoke('advanceHandshake', linkId);
  },

  restoreHandshake(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
    snapshot: string,
  ): Promise<LinkRestoreHandshakeResult> {
    return invoke(
      'restoreHandshake',
      sessionAlias,
      receiverAlias,
      peerPubky,
      peerNoisePublicKey,
      localReceiverPath,
      remoteReceiverPath,
      snapshot,
    );
  },

  restoreLink(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
    snapshot: string,
  ): Promise<LinkRestoreResult> {
    return invoke(
      'restoreLink',
      sessionAlias,
      receiverAlias,
      peerPubky,
      peerNoisePublicKey,
      localReceiverPath,
      remoteReceiverPath,
      snapshot,
    );
  },

  sendPrivateMessageJson(linkId: string, rawJson: string): Promise<LinkSendResult> {
    return invoke('sendPrivateMessageJson', linkId, rawJson);
  },

  receivePrivateMessages(linkId: string): Promise<LinkReceiveResult> {
    return invoke('receivePrivateMessages', linkId);
  },

  clearLinkOutbox(
    sessionAlias: string,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
  ): Promise<number> {
    return invoke(
      'clearLinkOutbox',
      sessionAlias,
      receiverAlias,
      peerPubky,
      peerNoisePublicKey,
      localReceiverPath,
      remoteReceiverPath,
    );
  },

  closeLink(linkId: string): Promise<void> {
    return invoke('closeLink', linkId);
  },

  putPublic(
    sessionAlias: string,
    url: string,
    content: string,
    homeserverOrigin: string,
  ): Promise<void> {
    return invoke('putPublic', sessionAlias, url, content, homeserverOrigin);
  },

  deletePublic(sessionAlias: string, url: string, homeserverOrigin: string): Promise<void> {
    return invoke('deletePublic', sessionAlias, url, homeserverOrigin);
  },

  generateAttachmentKey(): Promise<string> {
    return invoke('generateAttachmentKey');
  },

  attachmentEncrypt(
    plaintextB64: string,
    keyB64: string,
    aad?: string | null,
  ): Promise<AttachmentCiphertext> {
    return invoke('attachmentEncrypt', plaintextB64, keyB64, aad ?? null);
  },

  attachmentDecrypt(
    ciphertextB64: string,
    keyB64: string,
    nonceB64: string,
    aad?: string | null,
  ): Promise<string> {
    return invoke('attachmentDecrypt', ciphertextB64, keyB64, nonceB64, aad ?? null);
  },
};
