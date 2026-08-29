import { NativeModules } from 'react-native';

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
 * `signinWithSecret` is the sole exception that accepts a secret: it is the
 * dev/e2e test-harness path. Production uses `startAuthFlow` / `awaitAuthApproval`.
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

export function toLinkNativeError(err: unknown): LinkNativeError {
  if (isLinkNativeError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (typeof err === 'object' && err !== null) {
    const rec = err as { code?: unknown; userInfo?: { code?: unknown } };
    if (isLinkNativeErrorCode(rec.code)) return { code: rec.code, message };
    if (isLinkNativeErrorCode(rec.userInfo?.code)) {
      return { code: rec.userInfo.code, message };
    }
  }
  return { code: 'protocol', message };
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

export interface PaykitLinkNativeApi {
  /** True when the native module is linked into this build. */
  isAvailable(): boolean;
  /** Generates a receiver Noise secret natively and stores it under an alias. */
  generateReceiverKey(): Promise<ReceiverKeyResult>;
  getReceiverPublicKey(receiverAlias: string): Promise<string>;
  startAuthFlow(capabilities: string, relayUrl?: string): Promise<AuthFlowStart>;
  awaitAuthApproval(flowId: string): Promise<AuthSessionResult>;
  /**
   * Dev/e2e only. Signs in with an identity secret; native stores the bearer
   * under `sessionAlias`. The secret is not persisted in JS.
   */
  signinWithSecret(identitySecretHex: string): Promise<AuthSessionResult>;
  /**
   * Native loads and refreshes the bearer. Rejects with `auth` iff the
   * session is revoked or expired; `network` keeps the alias usable.
   */
  restoreSession(sessionAlias: string): Promise<RestoredSession>;
  signOutSession(sessionAlias: string): Promise<void>;
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
    return relayUrl === undefined
      ? invoke('startAuthFlow', capabilities)
      : invoke('startAuthFlow', capabilities, relayUrl);
  },

  awaitAuthApproval(flowId: string): Promise<AuthSessionResult> {
    return invoke('awaitAuthApproval', flowId);
  },

  signinWithSecret(identitySecretHex: string): Promise<AuthSessionResult> {
    return invoke('signinWithSecret', identitySecretHex);
  },

  restoreSession(sessionAlias: string): Promise<RestoredSession> {
    return invoke('restoreSession', sessionAlias);
  },

  signOutSession(sessionAlias: string): Promise<void> {
    return invoke('signOutSession', sessionAlias);
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
};
