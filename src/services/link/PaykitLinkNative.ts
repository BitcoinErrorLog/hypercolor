import { NativeModules } from 'react-native';

/**
 * PaykitLinkNative — typed bridge to the PaykitLinkModule Rust UniFFI native
 * module implementing official Paykit Encrypted Links (Noise XX over pubky
 * homeserver outboxes).
 *
 * This file defines the FIXED contract the native side exposes. Snapshots,
 * sessions, and markers are opaque JSON strings owned by the Rust layer; the
 * TypeScript state machine never parses them, it only persists and passes
 * them back.
 *
 * Contract semantics the state machine relies on:
 * - `acceptLink` resolves ONLY when an inbound handshake from the peer is
 *   queued (it consumes handshake message 1 and answers, or completes an
 *   already-advanced exchange); it REJECTS when there is nothing inbound.
 * - `advanceHandshake` is safe to call with an already-established snapshot:
 *   it reports `status: 'established'` without corrupting state, which is how
 *   snapshots returned by `acceptLink` are classified.
 * - `receivePrivateMessages` advances the link's read checkpoint past every
 *   returned message — callers MUST persist messages before the snapshot.
 */

/** One advance step of a Noise XX handshake. */
export interface LinkAdvanceResult {
  status: 'pending' | 'established';
  snapshot: string;
}

/** The advanced link snapshot after a successful send. */
export interface LinkSendResult {
  snapshot: string;
}

/**
 * One inbound Private Application Message. `rawJson` is the full wire
 * envelope; `kind`/`eventId` are best-effort hints extracted by the native
 * layer (`null` when the payload does not parse as a known envelope shape).
 */
export interface LinkInboundMessage {
  rawJson: string;
  kind: string | null;
  eventId: string | null;
}

/** Drained inbound messages plus the advanced link snapshot. */
export interface LinkReceiveResult {
  messages: LinkInboundMessage[];
  snapshot: string;
}

export interface PaykitLinkNativeApi {
  /** True when the native module is linked into this build. */
  isAvailable(): boolean;
  /** Generates a fresh receiver-scoped Noise secret key (hex). */
  generateReceiverSecret(): Promise<string>;
  /** Derives the receiver Noise public key (hex) from the secret. */
  receiverPublicKey(secretHex: string): Promise<string>;
  /** Signs in to the homeserver; returns the exported session JSON. */
  signinWithSecret(secretKeyHex: string): Promise<string>;
  /** Revalidates a persisted session; returns the refreshed exported session JSON. */
  restoreSession(exportedSession: string): Promise<string>;
  /** Publishes this account's receiver marker under the app/runtime path. */
  publishReceiverMarker(
    session: string,
    receiverSecretHex: string,
    app: string,
    runtime: string,
  ): Promise<void>;
  /** Fetches a peer's receiver marker JSON, or `null` when the peer has not enabled messaging. */
  getReceiverMarker(
    session: string,
    peerPubky: string,
    app: string,
    runtime: string,
  ): Promise<string | null>;
  /** Starts an outbound Noise XX handshake; returns the handshake snapshot JSON. */
  initiateLink(
    session: string,
    receiverSecretHex: string,
    peerPubky: string,
    peerMarkerJson: string,
  ): Promise<string>;
  /**
   * Answers a queued inbound handshake; returns a handshake or established
   * snapshot JSON. Rejects when the peer has nothing inbound to answer.
   */
  acceptLink(session: string, receiverSecretHex: string, peerPubky: string): Promise<string>;
  /** Advances a handshake by one poll step. */
  advanceHandshake(session: string, handshakeSnapshot: string): Promise<LinkAdvanceResult>;
  /** Restores an established link; returns the in-memory link handle id. */
  restoreLink(session: string, establishedSnapshot: string): Promise<string>;
  /** Sends one Private Application Message over an established link. */
  sendPrivateMessageJson(linkHandle: string, rawJson: string): Promise<LinkSendResult>;
  /** Drains pending inbound messages on an established link. */
  receivePrivateMessages(linkHandle: string): Promise<LinkReceiveResult>;
}

const { PaykitLinkModule } = NativeModules;

function requireModule() {
  if (PaykitLinkModule == null) {
    throw new Error('PaykitLinkModule native module is not available');
  }
  return PaykitLinkModule;
}

export const PaykitLinkNative: PaykitLinkNativeApi = {
  isAvailable(): boolean {
    return PaykitLinkModule != null;
  },

  generateReceiverSecret(): Promise<string> {
    return requireModule().generateReceiverSecret();
  },

  receiverPublicKey(secretHex: string): Promise<string> {
    return requireModule().receiverPublicKey(secretHex);
  },

  signinWithSecret(secretKeyHex: string): Promise<string> {
    return requireModule().signinWithSecret(secretKeyHex);
  },

  restoreSession(exportedSession: string): Promise<string> {
    return requireModule().restoreSession(exportedSession);
  },

  publishReceiverMarker(
    session: string,
    receiverSecretHex: string,
    app: string,
    runtime: string,
  ): Promise<void> {
    return requireModule().publishReceiverMarker(session, receiverSecretHex, app, runtime);
  },

  getReceiverMarker(
    session: string,
    peerPubky: string,
    app: string,
    runtime: string,
  ): Promise<string | null> {
    return requireModule().getReceiverMarker(session, peerPubky, app, runtime);
  },

  initiateLink(
    session: string,
    receiverSecretHex: string,
    peerPubky: string,
    peerMarkerJson: string,
  ): Promise<string> {
    return requireModule().initiateLink(session, receiverSecretHex, peerPubky, peerMarkerJson);
  },

  acceptLink(session: string, receiverSecretHex: string, peerPubky: string): Promise<string> {
    return requireModule().acceptLink(session, receiverSecretHex, peerPubky);
  },

  advanceHandshake(session: string, handshakeSnapshot: string): Promise<LinkAdvanceResult> {
    return requireModule().advanceHandshake(session, handshakeSnapshot);
  },

  restoreLink(session: string, establishedSnapshot: string): Promise<string> {
    return requireModule().restoreLink(session, establishedSnapshot);
  },

  sendPrivateMessageJson(linkHandle: string, rawJson: string): Promise<LinkSendResult> {
    return requireModule().sendPrivateMessageJson(linkHandle, rawJson);
  },

  receivePrivateMessages(linkHandle: string): Promise<LinkReceiveResult> {
    return requireModule().receivePrivateMessages(linkHandle);
  },
};
