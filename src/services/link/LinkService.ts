import { v4 as uuidv4 } from 'uuid';
import {
  PaykitLinkNative,
  createLinkNativeError,
  isLinkNativeError,
  toLinkNativeError,
  type LinkNativeError,
  type LinkProbeResult,
  type ReceiverMarker,
} from './PaykitLinkNative';
import { StorageService } from '../StorageService';
import { KeyStore } from '../KeyStore';
import { parsePubkyOwner, resolveHomeserverOrigin } from '../homeserverOrigin';
import { RetryQueue } from '../RetryQueue';
import { isConnectDelegationInFlight } from '../../ui/connectDelegationStart';
import {
  RING_GRANT_CAPABILITIES,
  formatAuthFlowCapabilities,
  LINK_RECEIVER_PATH,
  assertValidReceiverPath,
  buildChatMessageEnvelope,
  buildDmConversationId,
  CHAT_MESSAGE_KIND,
  coerceReceiverPath,
  decodeLinkEnvelope,
  type LinkMessage,
  type LinkReceiver,
  type LinkRecord,
  type LinkRole,
  type LinkStatus,
  type LinkStreamItem,
  type LinkStreamItemInput,
} from '../../types/link';
import type { DeliveryQueueItem, PubkyKey } from '../../types';
import {
  decodeGroupEnvelope,
  isGroupWireKind,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  peekEnvelopeKind,
  type GroupPeerTrust,
} from '../../types/group';
import { applyGroupInbound } from '../group/applyGroupInbound';
import { isGroupInboundGated } from '../group/groupInboundGate';
import { classifyInboundPeer, wotInputFromContact } from './wotGate';
import {
  attachmentKeyRef,
  CHAT_ATTACHMENT_KIND,
  decodeAttachmentEnvelope,
  isAttachmentLocationBoundToSender,
  redactAttachmentRawJson,
} from '../../types/attachment';
import { applyAttachmentInbound } from '../attachments/applyAttachmentInbound';
import { reconstructAttachmentWireJson } from '../attachments/redaction';
import { applyPaymentInbound } from '../payments/applyPaymentInbound';
import { isPaykitPaymentKind } from '../../types/payment';
import { shouldDropOversizedKnownInbound } from './inboundEnvelope';

/**
 * LinkService — end-to-end-encrypted DMs over official Paykit Encrypted
 * Links (Noise XX over pubky homeserver outboxes), via PaykitLinkNative v2.
 *
 * Secret material never crosses the JS bridge. Snapshots are opaque AEAD
 * ciphertext — this file persists them and passes them back, and never
 * parses them.
 *
 * ## Product wiring (v1)
 *
 * - `LinkService.enable()` — one `startAuthFlow` with
 *   `/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw`. That Paykit session is
 *   used for Encrypted Links and owner homeserver writes. Welcome
 *   `paykit-connect` is identity/UKD AppCert only.
 * - App startup / `AppState` `'active'` (App.tsx):
 *     `await LinkService.recoverPendingSends();`
 *     `await LinkService.drainRetries();`
 *     `await LinkService.syncInbox();`
 * - Foreground interval: `startLinkRetryDrain()` (30s).
 * - ThreadScreen / ChatsScreen send and render through this service.
 */

/** Discriminator for this transport's items in the shared `delivery_queue`. */
export const LINK_RETRY_PAYLOAD_TYPE = 'link.chat.message';

export { LINK_GROUP_FANOUT_PAYLOAD_TYPE };

/**
 * Consecutive handshake advance/restore failures before the wedged wipe.
 * Established links never increment this on `network`; only `protocol`
 * (decrypt) failures wipe an established session.
 */
export const HANDSHAKE_FAILURE_LIMIT = 5;

/**
 * Handshaking links one periodic tick may step. Mirrors the delivery queue's
 * `RetryQueue.getDue` bound so the tick's fan-out is capped the same way
 * rather than scaling with however many stale handshakes exist on the device.
 */
export const HANDSHAKE_ADVANCE_BATCH_LIMIT = 10;

/**
 * Unproductive handshake steps against one peer before the handshake is
 * declared unestablishable: an advance that returned `pending`, or a wipe of a
 * still-unestablished handshake. A `pending` advance is not a native error, so
 * it never increments `consecutiveFailures` and {@link HANDSHAKE_FAILURE_LIMIT}
 * never trips on a peer that simply stops answering — this is the bound that
 * does.
 *
 * On the shared retry backoff (30s, 1m, 2m, … capped at 30m) ten steps is about
 * two hours of unattended stepping. At the limit the link row and its outbox are
 * dropped, every queued send to that peer surfaces as `failed`, and the durable
 * budget keeps the peer out of all timer and sync work until the user acts.
 */
export const HANDSHAKE_PENDING_ADVANCE_LIMIT = 10;

export const LINK_RETRY_DRAIN_INTERVAL_MS = 30_000;

/**
 * How long one tick phase may hold the tick before it is released and the next
 * phase runs anyway. Shorter than the interval so a wedged phase costs at most
 * one skipped round rather than the rest of the session: an awaited native call
 * that never settles — the hazard already documented for the keystore in
 * `App.tsx` — otherwise latches the tick's in-flight flag for the lifetime of
 * the process, and no fresh interval can clear a module-level flag.
 */
export const LINK_RETRY_TICK_PHASE_TIMEOUT_MS = 20_000;

export type LinkEnableFlow = {
  authorizationUrl: string;
  awaitEnabled: () => Promise<{ pubky: string; receiverPath: string; noisePublicKey: string }>;
  /**
   * Marks the flow cancelled and fires native `cancelAuthFlow(flowId)` so
   * the waiter is retired even if `awaitEnabled` never ran. A session that
   * already resolved from an in-flight `awaitEnabled` is still signed out by
   * that function's post-approval cancelled check. Use only for user/OS
   * cancel, expiry, or a superseded attempt. Does not change
   * {@link awaitEnabled}'s approval-order checks.
   */
  cancel: () => void;
  /**
   * Stops the Android auth keepalive without cancelling approval.
   * A later approved session is still adopted. Call this when UI already
   * observed `enabled` status; do not call {@link LinkEnableFlow.cancel}
   * in that case. Does not change {@link awaitEnabled}'s approval path.
   */
  releaseKeepalive: () => void;
};

/**
 * Device-level messaging enablement (not a per-peer {@link LinkStatus}).
 * Used by the Ring-auth enable surface.
 */
export type LinkEnableStatus = 'native-missing' | 'needs-enable' | 'session-offline' | 'enabled';

interface LinkRetryPayload {
  type: typeof LINK_RETRY_PAYLOAD_TYPE;
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  senderPubky: PubkyKey;
  kind: string;
  eventId: string;
  rawJson: string;
}

interface GroupFanoutRetryPayload {
  type: typeof LINK_GROUP_FANOUT_PAYLOAD_TYPE;
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  senderPubky: PubkyKey;
  kind: string;
  eventId: string;
  channelId: string;
  rawJson: string;
}

type AnyLinkRetryPayload = LinkRetryPayload | GroupFanoutRetryPayload;

type ActiveSession = { alias: string; pubky: string };
type LiveHandle =
  | { status: 'established'; linkId: string }
  | { status: 'handshaking'; linkId: string; role: LinkRole };
type SessionLookup = ActiveSession | { status: 'offline' } | null;
type EnsureOutcome = LinkStatus | 'idle';

/**
 * Why we are touching a link. Two independent policies hang off this, and
 * conflating them is what let a hostile peer farm periodic work:
 *
 * - `user` — a deliberate action (thread open, send, payment, attachment,
 *   group fan-out). May initiate. CLEARS the durable handshake abuse budget:
 *   the user choosing to talk to this peer is out-of-band evidence that the
 *   peer is not merely a hostile stranger, and it is the documented escape
 *   from exhaustion, so exhaustion can never be a permanent denial state.
 *   An attacker cannot manufacture these; they are bounded by the user.
 * - `queued` — background re-delivery of an ALREADY-persisted user send. May
 *   initiate (the send has to be able to establish), but must NOT clear the
 *   budget: a timer replaying one stuck item would otherwise refresh the
 *   budget forever and the send would never surface as `failed`.
 * - `background` — periodic tick, inbox sync. Must never initiate, never
 *   clears, and is refused outright for an exhausted peer.
 */
type LinkIntent = 'user' | 'queued' | 'background';

function mayInitiate(intent: LinkIntent): boolean {
  return intent !== 'background';
}

let session: ActiveSession | null = null;
let restoreInFlight: Promise<SessionLookup> | null = null;
const liveHandles = new Map<string, LiveHandle>();
const queues = new Map<string, Promise<unknown>>();
let drainTimer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;
let drainInFlight: Promise<void> | null = null;
const inboxSyncListeners = new Set<(ownerPubky: PubkyKey) => void>();
/** In-flight enable / persistThenAdopt / Connect generations. */
let authCommitGenerations = 0;
/** Latch: native boot reconcile runs at most once per JS process. */
let bootReconcileDone = false;

function beginAuthCommitGeneration(): () => void {
  authCommitGenerations += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    authCommitGenerations -= 1;
  };
}

export const LinkService = {
  // ── Session ───────────────────────────────────────────────────────────────

  /**
   * Dev/e2e only — production uses {@link enable} (Ring pubkyauth).
   * Signs in with an identity secret; native stores the bearer under an
   * alias. The secret is not persisted in JS.
   */
  async signinWithSecret(identitySecretHex: string): Promise<{ pubky: string }> {
    const { sessionAlias, pubky } = await PaykitLinkNative.signinWithSecret(identitySecretHex);
    await persistThenAdopt(sessionAlias);
    KeyStore.setPubky(pubky);
    session = { alias: sessionAlias, pubky };
    return { pubky };
  },

  /**
   * Attempts to silently resume the messaging session after an app restart.
   * `true` only when a session is live afterwards. An `auth` rejection
   * (revoked/expired) deletes the stored alias; a `network` rejection keeps
   * the alias and is reported as `session-offline` from {@link ensureLinkWith}.
   */
  async restorePersistedSession(): Promise<boolean> {
    try {
      await StorageService.retryPendingCleanup();
    } catch {
      // Cleanup journal is best-effort; session restore still proceeds.
    }
    const lookup = await sessionOrRestore();
    return isActiveSession(lookup);
  },

  /**
   * Once-per-process boot reconcile. Must run only after
   * `initKeyStore()` has installed a real encrypted store — never from
   * AppState `active`, never while enable/Connect is in flight.
   */
  async reconcileAdoptedSessionsAtBoot(): Promise<void> {
    await reconcileNativeSessions();
  },

  hasSession(): boolean {
    return session !== null;
  },

  /**
   * Device-level enablement: native module, restored session, and a
   * published receiver marker. Does not probe any counterparty.
   */
  async getEnableStatus(): Promise<LinkEnableStatus> {
    if (!PaykitLinkNative.isAvailable()) return 'native-missing';
    try {
      const lookup = await sessionOrRestore();
      if (lookup && 'status' in lookup && lookup.status === 'offline') return 'session-offline';
      if (!isActiveSession(lookup)) return 'needs-enable';
      const receiver = await StorageService.getLinkReceiver(lookup.pubky);
      if (!receiver?.markerPublished) return 'needs-enable';
      return 'enabled';
    } catch (err) {
      if (isLinkNativeError(err) && err.code === 'unavailable') return 'native-missing';
      throw err;
    }
  },

  /**
   * Sign-out / account-switch teardown: close native link handles, sign the
   * native session out, wipe every native-owned secret (receivers, sessions,
   * snapshot key), and drop every account-scoped Encrypted-Link row.
   */
  async clearSession(): Promise<void> {
    stopLinkRetryDrain();
    const owner = session?.pubky ?? KeyStore.getPubky();
    const alias = session?.alias ?? KeyStore.getLinkSession();
    let markerPath = LINK_RECEIVER_PATH;
    if (owner) {
      const receiver = await StorageService.getLinkReceiver(owner);
      if (receiver) markerPath = coerceReceiverPath(receiver.receiverPath);
      const links = await StorageService.getAllLinks(owner);
      for (const link of links) {
        const live = liveHandles.get(linkKey(owner, link.peerPubky));
        if (live) await closeQuietly(live.linkId);
      }
      const items = await StorageService.listDeliveryQueue();
      for (const item of items) {
        const payload = parseRetryPayload(item.payload);
        if (payload?.ownerPubky === owner) {
          await StorageService.removeFromQueue(item.id);
        }
      }
      await StorageService.clearAccountData(owner);
    }
    if (alias) {
      try {
        await PaykitLinkNative.removeReceiverMarker(alias, markerPath);
      } catch {
        // Best-effort: peers should stop handshaking into a dead inbox.
      }
      try {
        await PaykitLinkNative.signOutSession(alias);
      } catch {
        // Native may already have dropped the bearer.
      }
    }
    try {
      await PaykitLinkNative.clearAllNativeSecrets();
    } catch {
      // Best-effort: leftover receiver/session aliases must not survive a switch.
    }
    session = null;
    liveHandles.clear();
    queues.clear();
    KeyStore.deleteLinkSession();
  },

  /**
   * Live-proof / test harness: adopt an already-created native session
   * (`signupWithSecret`) without signing in again and without wiping
   * other parties' live handles. Used to switch A/B/C on one process.
   */
  async adoptHarnessSession(sessionAlias: string, pubky: string): Promise<void> {
    if (!__DEV__) {
      throw createLinkNativeError(
        'unavailable',
        'adoptHarnessSession is disabled in release builds',
      );
    }
    const alias = sessionAlias.trim();
    const id = pubky.trim();
    if (alias.length === 0 || id.length === 0) {
      throw new Error('LinkService.adoptHarnessSession: sessionAlias and pubky are required');
    }
    await persistThenAdopt(alias);
    KeyStore.setPubky(id);
    session = { alias, pubky: id };
  },

  /**
   * Live-proof / test harness: publish the receiver marker for the
   * adopted session (same path as {@link enable} after Ring auth).
   */
  async provisionHarnessReceiver(): Promise<{
    pubky: string;
    receiverPath: string;
    noisePublicKey: string;
  }> {
    if (!session) {
      throw new Error('LinkService.provisionHarnessReceiver: no adopted session');
    }
    return provisionReceiver(session.alias, session.pubky);
  },

  // ── Enable flow ───────────────────────────────────────────────────────────

  /**
   * Ring-based enable: one startAuthFlow with
   * `/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw`. The caller presents
   * `authorizationUrl` (QR / open Ring), then `awaitEnabled`.
   * Android starts a foreground keepalive in `startAuthFlow` (before Ring
   * is launched) and stops it from `awaitEnabled` finally / `cancel`.
   */
  async enable(): Promise<LinkEnableFlow> {
    if (!PaykitLinkNative.isAvailable()) {
      throw createLinkNativeError('unavailable', 'PaykitLinkModule native module is not available');
    }
    const release = beginAuthCommitGeneration();
    try {
      const { flowId, authorizationUrl } = await PaykitLinkNative.startAuthFlow(
        formatAuthFlowCapabilities(RING_GRANT_CAPABILITIES),
      );
      let cancelled = false;
      const stopKeepalive = async () => {
        try {
          await PaykitLinkNative.stopAuthKeepalive(flowId);
        } catch {
          // Keepalive stop must not mask auth success, cancellation, or failure.
        }
      };
      const cancelNativeFlow = async () => {
        try {
          await PaykitLinkNative.cancelAuthFlow(flowId);
        } catch {
          // Native cancel must not mask JS cancellation or a later enable().
        }
      };
      return {
        authorizationUrl,
        cancel: () => {
          cancelled = true;
          release();
          void stopKeepalive();
          void cancelNativeFlow();
        },
        releaseKeepalive: () => {
          void stopKeepalive();
        },
        awaitEnabled: async () => {
          try {
            if (cancelled) {
              throw new Error('LinkService.enable: the messaging enable flow was cancelled');
            }
            const { sessionAlias, pubky } = await PaykitLinkNative.awaitAuthApproval(flowId);
            if (cancelled) {
              try {
                await PaykitLinkNative.signOutSession(sessionAlias);
              } catch {
                // Detached flow: drop the unused session.
              }
              throw new Error('LinkService.enable: the messaging enable flow was cancelled');
            }
            await persistThenAdopt(sessionAlias);
            KeyStore.setPubky(pubky);
            session = { alias: sessionAlias, pubky };
            return provisionReceiver(sessionAlias, pubky);
          } finally {
            release();
            await stopKeepalive();
          }
        },
      };
    } catch (err) {
      release();
      throw err;
    }
  },

  /**
   * Owner homeserver PUT via the Paykit ChatSession from `enable()` /
   * `startAuthFlow`. Attachments, backup, public channels, profile, and
   * contacts all go through this. AppCert is not used.
   */
  async putOwnerDocument(url: string, content: string): Promise<void> {
    const alias = requireSessionAlias();
    const owner = parsePubkyOwner(url) ?? requireOwner();
    const origin = await resolveHomeserverOrigin(owner);
    await PaykitLinkNative.putPublic(alias, url, content, origin);
  },

  async deleteOwnerDocument(url: string): Promise<void> {
    const alias = requireSessionAlias();
    const owner = parsePubkyOwner(url) ?? requireOwner();
    const origin = await resolveHomeserverOrigin(owner);
    await PaykitLinkNative.deletePublic(alias, url, origin);
  },

  // ── Links ─────────────────────────────────────────────────────────────────

  async ensureLinkWith(peerPubky: PubkyKey): Promise<LinkStatus> {
    return withQueue(peerPubky, async () => {
      try {
        const outcome = await ensureLinkLocked(peerPubky, 'user', false);
        return outcome === 'idle' ? 'error' : outcome;
      } catch (err) {
        if (isLinkNativeError(err) && err.code === 'unavailable') return 'native-missing';
        console.warn(`[LinkService] ensureLinkWith failed for ${peerPubky}:`, errorMessage(err));
        return 'error';
      }
    });
  },

  /**
   * Read-only persisted Encrypted Link state for display. Does not
   * initiate or resume a handshake.
   */
  async getLinkStatus(peerPubky: PubkyKey): Promise<LinkStatus | null> {
    const owner = KeyStore.getPubky();
    if (!owner) return 'needs-enable';
    try {
      const record = await StorageService.getLink(owner, peerPubky);
      if (!record) return null;
      if (record.status === 'established') return 'ready';
      return record.role === 'initiator' ? 'handshaking-initiator' : 'handshaking-responder';
    } catch {
      return 'error';
    }
  },

  // ── Send ──────────────────────────────────────────────────────────────────

  /**
   * Sends one `chat.message.v0` DM.
   *
   * Persistence protocol (nonce-safe):
   *  1. Atomic: persist `link_messages` (`sending`) AND enqueue the exact
   *     serialized envelope in the retry queue — BEFORE any native send.
   *  2. Native send of that exact `rawJson`.
   *  3. Atomic: persist the new snapshot + delivery `sent` + dequeue.
   *
   * A crash between (1) and (3) leaves a `sending` row whose queued rawJson
   * {@link recoverPendingSends} replays verbatim (never re-serialized).
   */
  async sendDm(peerPubky: PubkyKey, body: string): Promise<LinkMessage> {
    return withQueue(peerPubky, async () => {
      const outcome = await ensureLinkLocked(peerPubky, 'user', false);
      if (
        outcome !== 'ready' &&
        outcome !== 'handshaking-initiator' &&
        outcome !== 'handshaking-responder'
      ) {
        throw new Error(
          `LinkService.sendDm: cannot send to ${peerPubky} — link status is '${outcome}'`,
        );
      }
      const ownerForRequest = requireOwner();
      const pending = await StorageService.getMessageRequest(ownerForRequest, peerPubky);
      if (pending?.status === 'pending') {
        await StorageService.upsertMessageRequest({
          ...pending,
          status: 'accepted',
          updatedAt: Date.now(),
        });
      }

      const ownerPubky = requireOwner();
      const { envelope, json } = buildChatMessageEnvelope({
        eventId: uuidv4(),
        sentAt: Date.now(),
        body,
      });
      return dispatchPreparedDm({
        ownerPubky,
        peerPubky,
        outcome,
        kind: CHAT_MESSAGE_KIND,
        eventId: envelope.event_id,
        rawJson: json,
        body: envelope.body,
        sentAt: envelope.sent_at,
      });
    });
  },

  /**
   * Sends a caller-built PAM (e.g. `chat.attachment.v0`) over a 1:1 link
   * using the same nonce-safe persist protocol as {@link sendDm}.
   */
  async sendPreparedMessage(input: {
    peerPubky: PubkyKey;
    kind: string;
    eventId: string;
    rawJson: string;
    body: string;
    sentAt: number;
  }): Promise<LinkMessage> {
    return withQueue(input.peerPubky, async () => {
      const outcome = await ensureLinkLocked(input.peerPubky, 'user', false);
      if (
        outcome !== 'ready' &&
        outcome !== 'handshaking-initiator' &&
        outcome !== 'handshaking-responder'
      ) {
        throw new Error(
          `LinkService.sendPreparedMessage: cannot send to ${input.peerPubky} — link status is '${outcome}'`,
        );
      }
      const ownerForRequest = requireOwner();
      const pending = await StorageService.getMessageRequest(ownerForRequest, input.peerPubky);
      if (pending?.status === 'pending') {
        await StorageService.upsertMessageRequest({
          ...pending,
          status: 'accepted',
          updatedAt: Date.now(),
        });
      }
      return dispatchPreparedDm({
        ownerPubky: requireOwner(),
        peerPubky: input.peerPubky,
        outcome,
        kind: input.kind,
        eventId: input.eventId,
        rawJson: input.rawJson,
        body: input.body,
        sentAt: input.sentAt,
      });
    });
  },

  /**
   * Serializes work against the same per-peer queue used for inbound apply
   * and native send. Payment local transitions MUST run inside this.
   */
  async withPeerQueue<T>(peerPubky: PubkyKey, operation: () => Promise<T>): Promise<T> {
    return withQueue(peerPubky, operation);
  },

  /**
   * Attempt delivery of an already-persisted send intent. Does not take the
   * peer queue — caller must already hold {@link withPeerQueue}. A not-ready
   * link or send failure leaves the queued item for {@link drainRetries}.
   */
  async attemptPersistedSend(input: {
    peerPubky: PubkyKey;
    kind: string;
    eventId: string;
    queueId: string;
    rawJson: string;
  }): Promise<'sent' | 'queued'> {
    let outcome: EnsureOutcome;
    try {
      outcome = await ensureLinkLocked(input.peerPubky, 'user', false);
    } catch {
      return 'queued';
    }
    if (
      outcome !== 'ready' &&
      outcome !== 'handshaking-initiator' &&
      outcome !== 'handshaking-responder'
    ) {
      return 'queued';
    }
    const ownerForRequest = requireOwner();
    const pending = await StorageService.getMessageRequest(ownerForRequest, input.peerPubky);
    if (pending?.status === 'pending') {
      await StorageService.upsertMessageRequest({
        ...pending,
        status: 'accepted',
        updatedAt: Date.now(),
      });
    }
    if (outcome !== 'ready') return 'queued';
    try {
      const ownerPubky = requireOwner();
      const handle = requireEstablishedHandle(ownerPubky, input.peerPubky);
      const wireJson = await wireJsonForNativeSend(
        input.kind,
        input.rawJson,
        ownerPubky,
        ownerPubky,
        input.eventId,
      );
      const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, wireJson);
      await StorageService.finalizeLinkSend({
        ownerPubky,
        peerPubky: input.peerPubky,
        senderPubky: ownerPubky,
        kind: input.kind,
        eventId: input.eventId,
        snapshot,
        queueId: input.queueId,
      });
      return 'sent';
    } catch (err) {
      console.warn(
        `[LinkService] Persisted send failed for ${input.peerPubky}:`,
        errorMessage(err),
      );
      return 'queued';
    }
  },

  /**
   * Sends an already-persisted PAM JSON over a 1:1 Encrypted Link.
   * Used by GroupService pairwise fan-out. The caller MUST persist the
   * exact `rawJson` in `delivery_queue` first (nonce-safe). Returns
   * `queued` when the link is not ready or the send fails — the queue
   * item stays for {@link drainRetries} / {@link recoverPendingSends}.
   */
  async sendPersistedLinkJson(input: {
    peerPubky: PubkyKey;
    queueId: string;
    kind: string;
    eventId: string;
    rawJson: string;
    channelId: string;
  }): Promise<'sent' | 'queued'> {
    return withQueue(input.peerPubky, async () => {
      let outcome: EnsureOutcome;
      try {
        outcome = await ensureLinkLocked(input.peerPubky, 'user', false);
      } catch (err) {
        if (isTransientLinkError(err)) return 'queued';
        return 'queued';
      }
      if (outcome !== 'ready') return 'queued';
      try {
        const ownerPubky = requireOwner();
        const handle = requireEstablishedHandle(ownerPubky, input.peerPubky);
        const wireJson = await wireJsonForNativeSend(
          input.kind,
          input.rawJson,
          ownerPubky,
          ownerPubky,
          input.eventId,
        );
        const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, wireJson);
        await StorageService.finalizeGroupFanoutSend({
          ownerPubky,
          peerPubky: input.peerPubky,
          snapshot,
          queueId: input.queueId,
        });
        return 'sent';
      } catch (err) {
        console.warn(
          `[LinkService] Group fan-out send failed for ${input.peerPubky}:`,
          errorMessage(err),
        );
        return 'queued';
      }
    });
  },

  /**
   * Replays exact queued rawJson for items whose row is still `sending`.
   * Intended call site: app startup / foreground (see file header).
   */
  async recoverPendingSends(): Promise<void> {
    if (!KeyStore.isInitialized()) return;
    await reconcilePaymentPendingSends();
    const items = await StorageService.listDeliveryQueue();
    for (const item of items) {
      const payload = parseRetryPayload(item.payload);
      if (!payload || !isCurrentOwner(payload.ownerPubky)) continue;
      if (payload.type === LINK_RETRY_PAYLOAD_TYPE) {
        const row = await StorageService.getLinkMessage(
          payload.ownerPubky,
          payload.senderPubky,
          payload.kind,
          payload.eventId,
        );
        if (!row || !isRetryableDeliveryState(row.deliveryState)) continue;
      }
      await deliverQueuedPayload(item, payload);
    }
  },

  /**
   * Drains due link-kind retry items. Not-ready links defer without burning
   * an attempt. Permanent drops set delivery state `failed`.
   * Intended call sites: `syncInbox`, `startLinkRetryDrain`, AppState active.
   *
   * Self-serializing: the tick, `syncInbox`, and AppState-active recovery all
   * call this, and two passes running against one `RetryQueue.getDue`
   * snapshot each could otherwise pick up the same item. Callers still get a
   * real pass — they chain behind the running one rather than joining it.
   */
  async drainRetries(): Promise<void> {
    const previous = drainInFlight ?? Promise.resolve();
    const next = previous.then(drainDueRetries, drainDueRetries);
    const tracked = next.catch(() => undefined);
    drainInFlight = tracked;
    try {
      await next;
    } finally {
      if (drainInFlight === tracked) drainInFlight = null;
    }
  },

  /**
   * Steps every still-handshaking link owned by the active session.
   *
   * Noise XX needs one advance per party per message. A responder that has
   * answered with message 2 still has to read message 3, and only its own
   * session can do that — the counterparty's handshake handle lives in
   * another process on another device. `drainRetries` alone is not enough:
   * it reaches `ensureLinkLocked` only for peers that happen to have a due
   * `delivery_queue` item, so a handshake with nothing queued never steps
   * and both sides stay wedged at `handshaking-initiator` /
   * `handshaking-responder`.
   *
   * Never initiates: a periodic tick answers and completes handshakes, it
   * does not start new ones (same policy as {@link syncInbox}). The
   * `background` intent is threaded all the way through the failure path, so
   * even a wedged link's recovery cannot write Noise message 1 from a
   * background timer.
   *
   * Bounded, not exhaustive. Link rows are created by inbound probing as well
   * as by the user (`adoptInboundHandshake` from {@link syncInbox}), so a peer
   * who writes message 1 and never answers message 3 would otherwise cost
   * homeserver IO on every tick forever. Only links whose durable budget is due
   * are stepped, at most {@link HANDSHAKE_ADVANCE_BATCH_LIMIT} per run, and a
   * handshake still unestablished after
   * {@link HANDSHAKE_PENDING_ADVANCE_LIMIT} steps is abandoned. Because the
   * budget outlives the link row, deleting and re-adopting the row does not buy
   * the peer a fresh allowance.
   */
  async advancePendingLinks(): Promise<void> {
    const lookup = await sessionOrRestore();
    if (!isActiveSession(lookup)) return;
    const links = await StorageService.getDueHandshakingLinks(
      lookup.pubky,
      HANDSHAKE_ADVANCE_BATCH_LIMIT,
    );
    for (const link of links) {
      try {
        await withQueue(link.peerPubky, () =>
          ensureLinkLocked(link.peerPubky, 'background', false),
        );
      } catch (err) {
        console.warn(
          `[LinkService] Handshake advance failed for ${link.peerPubky}:`,
          errorMessage(err),
        );
      }
    }
  },

  /** @deprecated Use {@link drainRetries}. */
  async retryPendingSends(): Promise<void> {
    await LinkService.drainRetries();
  },

  // ── Receive ───────────────────────────────────────────────────────────────

  /**
   * Inbox sync across known counterparties: advances existing handshakes and
   * answers queued inbound ones WITHOUT initiating. Persists every inbound
   * raw item on `link_stream_items` BEFORE the advanced snapshot, then routes
   * known kinds into `link_messages`.
   *
   * Encrypted Links cannot enumerate unknown inbound handshakes
   * (`probeInboundLink` is per-peer). The candidate set this method probes
   * is therefore assembled from people we already know:
   *   - my follows (`isFollowing`)
   *   - my followers (`isFollower`)
   *   - friends (`isMutual`)
   *   - manually-added contacts (`addedManually`)
   *   - existing Encrypted-Link peers
   * All of those live in `contacts` / `links` and are deduped here.
   *
   * When `peers` is omitted, that candidate set is collected automatically.
   * Tests and callers that already have a list can still pass it explicitly.
   *
   * Newly discovered inbound links (`probe` → pending/established with no
   * prior row) go through the WoT gate: only a prior routed conversation
   * (`hasPriorRoutedConversation`) auto-accepts for compatibility. Follow,
   * mutual follow, and manual add do not skip the queue — everyone else
   * lands as a pending MESSAGE REQUEST until explicitly accepted.
   */
  async syncInbox(peers?: PubkyKey[]): Promise<LinkMessage[]> {
    const ownerPubky = requireOwner();
    const candidates = peers !== undefined ? peers : await collectInboxCandidates(ownerPubky);
    const received: LinkMessage[] = [];
    for (const peerPubky of new Set(candidates)) {
      try {
        const batch = await withQueue(peerPubky, () => syncPeerLocked(peerPubky));
        received.push(...batch);
      } catch (err) {
        console.warn(`[LinkService] Inbox sync failed for ${peerPubky}:`, errorMessage(err));
      }
    }
    try {
      await LinkService.drainRetries();
    } catch (err) {
      console.warn('[LinkService] drainRetries after syncInbox failed:', errorMessage(err));
    }
    notifyInboxSynced(ownerPubky);
    return received;
  },

  /**
   * Fired after every {@link syncInbox} attempt (including an empty candidate
   * set). Used by ChatsScreen to refresh the pending-request badge.
   */
  subscribeInboxSynced(listener: (ownerPubky: PubkyKey) => void): () => void {
    inboxSyncListeners.add(listener);
    return () => {
      inboxSyncListeners.delete(listener);
    };
  },

  async markRead(conversationId: string, readAt: number = Date.now()): Promise<void> {
    const owner = KeyStore.getPubky();
    if (!owner) return;
    await StorageService.setLinkReadCursor(owner, conversationId, readAt);
  },

  /**
   * Deduped probe set: follows + followers + friends + manual contacts +
   * existing link peers. See {@link syncInbox}.
   */
  async collectInboxCandidates(): Promise<PubkyKey[]> {
    return collectInboxCandidates(requireOwner());
  },

  /**
   * Promotes a pending message request to a normal conversation and routes
   * any stream items that were held while it was gated.
   *
   * Decline is terminal. The requests UI only lists `pending` rows, inbound
   * from a declined peer is rejected without creating a new request, and
   * this method refuses to reverse a decline. Nothing from before the
   * decline can replay: held items, deferred rows, and seen markers were
   * deleted at decline time.
   */
  async acceptMessageRequest(peerPubky: PubkyKey): Promise<LinkMessage[]> {
    return withQueue(peerPubky, async () => {
      const ownerPubky = requireOwner();
      const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
      if (existing?.status === 'declined') {
        throw new Error('Cannot accept a declined message request');
      }
      const ts = Date.now();
      await StorageService.upsertMessageRequest({
        ownerPubky,
        peerPubky,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        status: 'accepted',
      });
      return syncPeerLocked(peerPubky);
    });
  },

  /**
   * Declines a message request: close the link, clear the outbox, drop
   * held stream/message rows, drop that sender's `group_deferred_events`
   * and `group_seen_events`, and persist `declined`.
   *
   * Already-persisted `group_messages` in shared channels stay: decline is
   * a 1:1 inbox action (see `docs/DECISIONS.md`). A stranger-exploit create
   * never applied, so that shape still leaves no group rows.
   */
  async declineMessageRequest(peerPubky: PubkyKey): Promise<void> {
    return withQueue(peerPubky, async () => {
      const ownerPubky = requireOwner();
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      if (stored) await wipeLinkState(stored);
      await StorageService.deleteLinkStreamItemsForPeer(ownerPubky, peerPubky);
      await StorageService.deleteLinkMessagesForPeer(ownerPubky, peerPubky);
      await StorageService.deleteGroupDeferredForSender(ownerPubky, peerPubky);
      await StorageService.deleteGroupSeenEventsForSender(ownerPubky, peerPubky);
      const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
      const ts = Date.now();
      await StorageService.upsertMessageRequest({
        ownerPubky,
        peerPubky,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        status: 'declined',
      });
    });
  },
};

/**
 * Foreground/interval hook for the wiring step. Call from App.tsx /
 * RootNavigator when the app is active; dispose on background / unmount.
 */
export function startLinkRetryDrain(intervalMs = LINK_RETRY_DRAIN_INTERVAL_MS): () => void {
  stopLinkRetryDrain();
  drainTimer = setInterval(() => {
    void linkRetryTick();
  }, intervalMs);
  return stopLinkRetryDrain;
}

/**
 * The two phases of a tick, in order. Handshakes advance first, then delivery
 * takes whatever the transition to `ready` unblocked — draining first would
 * defer every queued send for another interval.
 *
 * Each phase remembers its own outstanding run, which is what makes overlap
 * impossible without making the tick block on it: a phase whose previous run
 * has not settled is skipped rather than started twice.
 */
const tickPhases: { label: string; run: () => Promise<void>; inFlight: Promise<void> | null }[] = [
  { label: 'Handshake advance', run: () => LinkService.advancePendingLinks(), inFlight: null },
  { label: 'Retry drain', run: () => LinkService.drainRetries(), inFlight: null },
];

/**
 * One foreground tick.
 *
 * Structurally unlatchable. Every awaited phase runs under
 * {@link LINK_RETRY_TICK_PHASE_TIMEOUT_MS}, so a native call that never settles
 * or rejects — the hazard `App.tsx` already documents for the keystore — cannot
 * hold `tickInFlight` past one round. A module-level flag held by a wedged await
 * silences the tick for the lifetime of the process, and restarting the interval
 * from {@link startLinkRetryDrain} cannot clear it, which is how a device kept
 * live timers while doing no link work at all for minutes.
 *
 * Releasing the tick does not let two ticks run the same work: the abandoned
 * phase keeps its slot until it settles, per-peer `withQueue` serialization
 * still orders every handshake step, and `drainRetries` self-serializes.
 */
async function linkRetryTick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    for (const phase of tickPhases) {
      await runTickPhase(phase);
    }
  } finally {
    tickInFlight = false;
  }
}

async function runTickPhase(phase: (typeof tickPhases)[number]): Promise<void> {
  if (phase.inFlight) {
    console.warn(`[LinkService] ${phase.label} tick skipped: previous run has not settled`);
    return;
  }
  const started = phase.run().catch(err => {
    console.warn(`[LinkService] ${phase.label} tick failed:`, errorMessage(err));
  });
  phase.inFlight = started;
  void started.then(() => {
    if (phase.inFlight === started) phase.inFlight = null;
  });
  await settleWithin(started, LINK_RETRY_TICK_PHASE_TIMEOUT_MS, phase.label);
}

/** Waits for `work`, giving up on WAITING (never on the work) after `budgetMs`. */
async function settleWithin(work: Promise<void>, budgetMs: number, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<'expired'>(resolve => {
    timer = setTimeout(() => resolve('expired'), budgetMs);
  });
  try {
    const outcome = await Promise.race([work.then(() => 'settled' as const), expiry]);
    if (outcome === 'expired') {
      console.warn(
        `[LinkService] ${label} tick exceeded ${budgetMs}ms; releasing the tick while it finishes`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

export function stopLinkRetryDrain(): void {
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
}

/** Test seam: live per-peer queue map size (must be 0 after a settled op). */
export function linkQueueEntryCountForTests(): number {
  return queues.size;
}

/**
 * Test / harness: drop in-memory session, handles, and queues without
 * native sign-out or SQL wipe. Does not touch other owners' SQLite rows.
 */
export function resetLinkServiceHarnessState(): void {
  session = null;
  liveHandles.clear();
  queues.clear();
  bootReconcileDone = false;
  authCommitGenerations = 0;
}

// ─── Session internals ────────────────────────────────────────────────────────

async function sessionOrRestore(): Promise<SessionLookup> {
  if (session) return session;
  restoreInFlight ??= restoreFromKeyStore();
  try {
    return await restoreInFlight;
  } finally {
    restoreInFlight = null;
  }
}

async function restoreFromKeyStore(): Promise<SessionLookup> {
  const stored = KeyStore.getLinkSession();
  if (!stored) return null;
  try {
    const { pubky } = await PaykitLinkNative.restoreSession(stored);
    session = { alias: stored, pubky };
    return session;
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'auth') {
      KeyStore.deleteLinkSession();
      return null;
    }
    if (isLinkNativeError(err) && err.code === 'unavailable') {
      throw err;
    }
    // network (and unknown) — keep the alias, surface a transient status
    console.warn('[LinkService] Session restore failed transiently:', errorMessage(err));
    return { status: 'offline' };
  }
}

function isActiveSession(lookup: SessionLookup): lookup is ActiveSession {
  return lookup !== null && !('status' in lookup);
}

/**
 * JS is the reconciler: write KeyStore first, then native adopt (marker
 * delete only). A valid bearer therefore cannot exist with neither a
 * pending marker nor a KeyStore reference.
 *
 * Production enable/signin fail closed on `adoptAuthSession` `unavailable`
 * (no silent restore). The restore fallback is `__DEV__`-only so a
 * JS-only OTA against an older native binary cannot keep a KeyStore alias.
 * Rollback is alias-scoped: never drop a different working alias.
 */
async function persistThenAdopt(sessionAlias: string): Promise<void> {
  const release = beginAuthCommitGeneration();
  try {
    const previous = KeyStore.isInitialized() ? KeyStore.getLinkSession() : null;
    KeyStore.setLinkSession(sessionAlias);
    try {
      await PaykitLinkNative.adoptAuthSession(sessionAlias);
    } catch (err) {
      if (__DEV__ && isLinkNativeError(err) && err.code === 'unavailable') {
        try {
          await PaykitLinkNative.restoreSession(sessionAlias);
          return;
        } catch (restoreErr) {
          rollbackLinkSession(sessionAlias, previous);
          try {
            await PaykitLinkNative.signOutSession(sessionAlias);
          } catch {
            // Native may already have dropped the bearer.
          }
          throw restoreErr;
        }
      }
      rollbackLinkSession(sessionAlias, previous);
      try {
        await PaykitLinkNative.signOutSession(sessionAlias);
      } catch {
        // Adopt failed: drop the unusable pending bearer.
      }
      throw err;
    }
  } finally {
    release();
  }
}

function rollbackLinkSession(sessionAlias: string, previous: string | null): void {
  const deleted = KeyStore.deleteLinkSessionIfAlias(sessionAlias);
  if (deleted && previous && previous !== sessionAlias) {
    KeyStore.setLinkSession(previous);
  }
}

async function reconcileNativeSessions(): Promise<void> {
  if (bootReconcileDone) return;
  if (!PaykitLinkNative.isAvailable()) return;
  if (!KeyStore.isInitialized()) return;
  if (authCommitGenerations > 0) return;
  if (isConnectDelegationInFlight()) return;
  const read = KeyStore.readLinkSession();
  if (!read.ok) return;
  bootReconcileDone = true;
  await PaykitLinkNative.reconcileAdoptedSessions(read.alias);
}

// ─── Enable internals ─────────────────────────────────────────────────────────

async function provisionReceiver(
  sessionAlias: string,
  pubky: PubkyKey,
): Promise<{ pubky: string; receiverPath: string; noisePublicKey: string }> {
  const receiverPath = assertValidReceiverPath(LINK_RECEIVER_PATH);
  const existing = await StorageService.getLinkReceiver(pubky);
  let receiverAlias: string;
  let noisePublicKey: string;
  if (existing) {
    try {
      receiverAlias = existing.receiverAlias;
      noisePublicKey = await PaykitLinkNative.getReceiverPublicKey(receiverAlias);
    } catch (err) {
      if (!isUnusableReceiverAliasError(err)) throw err;
      await StorageService.deleteLinkReceiver(pubky);
      const minted = await mintReceiver(pubky, receiverPath);
      receiverAlias = minted.receiverAlias;
      noisePublicKey = minted.noisePublicKey;
    }
  } else {
    const minted = await mintReceiver(pubky, receiverPath);
    receiverAlias = minted.receiverAlias;
    noisePublicKey = minted.noisePublicKey;
  }
  await PaykitLinkNative.publishReceiverMarker(sessionAlias, receiverAlias, receiverPath);
  await StorageService.upsertLinkReceiver({
    ownerPubky: pubky,
    receiverAlias,
    receiverPath,
    markerPublished: true,
  });
  return { pubky, receiverPath, noisePublicKey };
}

async function mintReceiver(
  pubky: PubkyKey,
  receiverPath: string,
): Promise<{ receiverAlias: string; noisePublicKey: string }> {
  const generated = await PaykitLinkNative.generateReceiverKey();
  await StorageService.upsertLinkReceiver({
    ownerPubky: pubky,
    receiverAlias: generated.receiverAlias,
    receiverPath,
    markerPublished: false,
  });
  return generated;
}

/** Native rejects a JS-keychain leftover or deleted alias — regenerate. */
function isUnusableReceiverAliasError(err: unknown): boolean {
  if (!isLinkNativeError(err)) return false;
  if (err.code === 'validation' || err.code === 'protocol') return true;
  return /not found/i.test(err.message);
}

// ─── State machine internals ──────────────────────────────────────────────────

/**
 * Handshake abuse budget recovery policy, in one place so it cannot drift:
 *
 * A `user` intent clears the budget before any handshake work is dispatched, so
 * a peer is never permanently denied — one deliberate send or thread open
 * restores a full allowance, whether or not a handshake handle is already live.
 * Every other intent is refused outright once the budget is exhausted, BEFORE
 * the marker fetch and inbound probe, so an exhausted peer costs zero homeserver
 * IO and cannot be re-adopted by timer or sync activity however many times it
 * rewrites Noise message 1.
 *
 * The gate deliberately sits after the established branches: an exhausted
 * budget must never interfere with a link that actually completed.
 */
async function ensureLinkLocked(
  peerPubky: PubkyKey,
  intent: LinkIntent,
  alreadyRecovered: boolean,
): Promise<EnsureOutcome> {
  if (!PaykitLinkNative.isAvailable()) return 'native-missing';

  const lookup = await sessionOrRestore();
  if (lookup && 'status' in lookup && lookup.status === 'offline') return 'session-offline';
  if (!isActiveSession(lookup)) return 'needs-enable';
  const activeSession = lookup;
  const ownerPubky = activeSession.pubky;
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  if (!receiver?.markerPublished) return 'needs-enable';
  const localPath = assertValidReceiverPath(coerceReceiverPath(receiver.receiverPath));

  const key = linkKey(ownerPubky, peerPubky);
  const live = liveHandles.get(key);
  if (live?.status === 'established') return 'ready';

  // Above the live-handle dispatch on purpose. A handshake in progress keeps a
  // handle in memory for as long as the app stays foregrounded, and clearing
  // below that branch made the documented recovery unreachable in exactly the
  // case that needs it: the peer whose budget the handshake itself ran down.
  if (intent === 'user') {
    await StorageService.clearHandshakeBudget(ownerPubky, peerPubky);
  }

  if (live?.status === 'handshaking') {
    return advanceLiveHandshake(
      activeSession,
      receiver,
      ownerPubky,
      peerPubky,
      live,
      intent,
      alreadyRecovered,
    );
  }

  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  if (stored?.status === 'established') {
    return restoreEstablished(activeSession, receiver, stored, intent, alreadyRecovered);
  }

  if (intent !== 'user' && (await isHandshakeBudgetExhausted(ownerPubky, peerPubky))) {
    return 'idle';
  }

  if (stored?.status === 'handshaking') {
    return restoreAndAdvanceHandshake(activeSession, receiver, stored, intent, alreadyRecovered);
  }

  const marker = await PaykitLinkNative.getReceiverMarker(peerPubky, localPath);
  if (marker === null) return mayInitiate(intent) ? 'not-enrolled' : 'idle';

  let inbound: Extract<LinkProbeResult, { result: 'pending' | 'established' }> | null;
  try {
    inbound = await probeInbound(activeSession, receiver, ownerPubky, peerPubky, marker, localPath);
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'protocol') {
      await clearPeerOutboxBestEffort(
        activeSession,
        receiver,
        peerPubky,
        marker.noisePublicKey,
        localPath,
        LINK_RECEIVER_PATH,
      );
      if (!mayInitiate(intent)) return 'idle';
      return initiateHandshake(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        marker,
        localPath,
        intent,
        alreadyRecovered,
      );
    }
    throw err;
  }
  if (inbound !== null) {
    return adoptInboundHandshake(ownerPubky, peerPubky, marker, localPath, inbound);
  }

  if (!mayInitiate(intent)) return 'idle';

  return initiateHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    marker,
    localPath,
    intent,
    alreadyRecovered,
  );
}

async function restoreEstablished(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  intent: LinkIntent,
  alreadyRecovered: boolean,
): Promise<EnsureOutcome> {
  const localPath = coerceReceiverPath(stored.localReceiverPath);
  const remotePath = coerceReceiverPath(stored.remoteReceiverPath);
  try {
    const { linkId } = await PaykitLinkNative.restoreLink(
      activeSession.alias,
      receiver.receiverAlias,
      stored.peerPubky,
      stored.remoteNoisePublicKey,
      localPath,
      remotePath,
      stored.snapshot,
    );
    liveHandles.set(linkKey(stored.ownerPubky, stored.peerPubky), {
      status: 'established',
      linkId,
    });
    await StorageService.resetLinkConsecutiveFailures(stored.ownerPubky, stored.peerPubky);
    return 'ready';
  } catch (err) {
    return handleLinkFailure(err, stored, intent, alreadyRecovered);
  }
}

async function restoreAndAdvanceHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  intent: LinkIntent,
  alreadyRecovered: boolean,
): Promise<EnsureOutcome> {
  const localPath = coerceReceiverPath(stored.localReceiverPath);
  const remotePath = coerceReceiverPath(stored.remoteReceiverPath);
  try {
    const restored = await PaykitLinkNative.restoreHandshake(
      activeSession.alias,
      receiver.receiverAlias,
      stored.peerPubky,
      stored.remoteNoisePublicKey,
      localPath,
      remotePath,
      stored.snapshot,
    );
    liveHandles.set(linkKey(stored.ownerPubky, stored.peerPubky), {
      status: 'handshaking',
      linkId: restored.linkId,
      role: stored.role,
    });
    if (restored.status === 'established') {
      // Awaited inside the try on purpose: a bare `return` of the promise
      // would settle outside this frame and skip the catch below, so a failed
      // transport restore would escape `ensureLinkLocked` as a raw native
      // error instead of being classified.
      return await completeEstablished(
        activeSession,
        receiver,
        stored.ownerPubky,
        stored.peerPubky,
        stored.role,
        stored.snapshot,
        stored.remoteNoisePublicKey,
        localPath,
        remotePath,
        restored.linkId,
      );
    }
    return advanceLiveHandshake(
      activeSession,
      receiver,
      stored.ownerPubky,
      stored.peerPubky,
      { status: 'handshaking', linkId: restored.linkId, role: stored.role },
      intent,
      alreadyRecovered,
    );
  } catch (err) {
    const current = await StorageService.getLink(stored.ownerPubky, stored.peerPubky);
    return handleLinkFailure(err, current ?? stored, intent, alreadyRecovered);
  }
}

async function advanceLiveHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  live: Extract<LiveHandle, { status: 'handshaking' }>,
  intent: LinkIntent,
  alreadyRecovered: boolean,
): Promise<EnsureOutcome> {
  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  try {
    const result = await PaykitLinkNative.advanceHandshake(live.linkId);
    if (result.status === 'established') {
      const remoteKey = stored?.remoteNoisePublicKey ?? '';
      const localPath = coerceReceiverPath(stored?.localReceiverPath ?? receiver.receiverPath);
      const remotePath = coerceReceiverPath(stored?.remoteReceiverPath ?? LINK_RECEIVER_PATH);
      // Awaited inside the try: see `restoreAndAdvanceHandshake`. Without it
      // the catch below never sees a failed `restoreLink`, which is the one
      // case where the row read above is already stale.
      return await completeEstablished(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        live.role,
        result.snapshot,
        remoteKey,
        localPath,
        remotePath,
        live.linkId,
      );
    }

    // `pending` is a real Noise XX step, not a failure — but it is also the
    // shape of a peer that answered once and went silent, so it has to cost
    // something. What it costs is decided in one place: see the charge policy on
    // `chargeHandshakeBudget`. Charged BEFORE persisting the snapshot: a crash
    // between the two loses a handshake step, never a charge.
    const budget = await chargeHandshakeBudget(ownerPubky, peerPubky, {
      reason: 'pending-advance',
      intent,
    });
    await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, result.snapshot, 'handshaking');

    if (budget.exhausted) {
      return abandonUnestablishedLink(
        stored ?? fallbackLinkRecord(ownerPubky, peerPubky, receiver, live.role),
      );
    }

    if (live.role === 'initiator' && ownerPubky < peerPubky) {
      const marker = await PaykitLinkNative.getReceiverMarker(peerPubky, LINK_RECEIVER_PATH);
      if (marker) {
        const inbound = await probeInbound(
          activeSession,
          receiver,
          ownerPubky,
          peerPubky,
          marker,
          LINK_RECEIVER_PATH,
        );
        if (inbound !== null) {
          await closeQuietly(live.linkId);
          liveHandles.delete(linkKey(ownerPubky, peerPubky));
          return adoptInboundHandshake(ownerPubky, peerPubky, marker, LINK_RECEIVER_PATH, inbound);
        }
      }
    }

    return roleStatus(live.role);
  } catch (err) {
    // Re-read: `completeEstablished` persists `established` before restoring
    // the transport handle, so the row read above can be stale by exactly one
    // transition. Charging handshake failures against a row that is already
    // established would wipe a live link.
    const current = await StorageService.getLink(ownerPubky, peerPubky);
    const fallback = current ?? fallbackLinkRecord(ownerPubky, peerPubky, receiver, live.role);
    return handleLinkFailure(err, fallback, intent, alreadyRecovered);
  }
}

function fallbackLinkRecord(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  receiver: LinkReceiver,
  role: LinkRole,
): LinkRecord {
  return {
    ownerPubky,
    peerPubky,
    role,
    status: 'handshaking',
    snapshot: '',
    remoteNoisePublicKey: '',
    localReceiverPath: receiver.receiverPath,
    remoteReceiverPath: LINK_RECEIVER_PATH,
    consecutiveFailures: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Why a handshake step is being charged. The whole charge policy lives in
 * {@link chargeHandshakeBudget} so the two call sites cannot drift apart.
 */
type HandshakeCharge =
  /** An advance that returned `pending`: throttled, see below. */
  | { reason: 'pending-advance'; intent: LinkIntent }
  /** A wipe of a still-unestablished handshake: never throttled, see below. */
  | { reason: 'unestablished-wipe' };

/**
 * Charges one unproductive handshake step against this peer and returns the
 * resulting budget.
 *
 * Lives in `link_handshake_budgets`, NOT on the link row, because every caller
 * that could charge it (`pending` advance, protocol wipe, failure-limit wipe)
 * is followed by a path that deletes the link row. A counter on the row was
 * reset by the very failure that should have charged it, which let a peer cycle
 * message 1 → pending → malformed message 3 → wipe → re-adoption for a fresh
 * budget every 30–60s. Safe to read-modify-write: all link work for a peer runs
 * inside `withQueue(peer)`.
 *
 * Charge policy — the budget bounds UNATTENDED, REPEATED work, because that is
 * the only cost a peer who never completes can impose:
 *
 * - A `pending` advance charges at most once per backoff window. Charging
 *   closes the window, so the first step in a window costs one unit and every
 *   later step by any caller in that window is free. Without this the cost
 *   scaled with how many callers happened to step the handshake — the tick, a
 *   queued-delivery retry, a thread open and an inbox sync all land inside the
 *   same 30s window — so a handshake converging normally consumed half the
 *   allowance, and one with a queued send ran itself to exhaustion. The rate a
 *   hostile peer can farm is unchanged: the tick only steps links whose window
 *   has elapsed, so it still costs exactly one unit per due step, ten steps
 *   across roughly two hours.
 * - A `user` intent never charges. It has already cleared the budget by the
 *   time it gets here (see {@link ensureLinkLocked}), and a deliberate action
 *   is attended by definition.
 * - A wipe of a still-unestablished handshake always charges, window or not.
 *   That one is peer-triggerable on demand — a malformed message 3 forces it —
 *   so throttling it would hand back the free re-adoption cycle the durable
 *   budget exists to close.
 */
async function chargeHandshakeBudget(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  charge: HandshakeCharge,
): Promise<{ advances: number; exhausted: boolean }> {
  const current = await StorageService.getHandshakeBudget(ownerPubky, peerPubky);
  const held = {
    advances: current?.pendingAdvances ?? 0,
    exhausted: current ? current.exhaustedAt !== null : false,
  };
  if (charge.reason === 'pending-advance') {
    if (charge.intent === 'user') return held;
    if (current && current.nextAdvanceAt > Date.now()) return held;
  }
  const advances = held.advances + 1;
  const exhausted = advances >= HANDSHAKE_PENDING_ADVANCE_LIMIT;
  await StorageService.upsertHandshakeBudget({
    ownerPubky,
    peerPubky,
    pendingAdvances: advances,
    nextAdvanceAt: RetryQueue.nextAttemptAt(advances),
    exhaustedAt: exhausted ? (current?.exhaustedAt ?? Date.now()) : null,
  });
  return { advances, exhausted };
}

async function isHandshakeBudgetExhausted(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
): Promise<boolean> {
  const budget = await StorageService.getHandshakeBudget(ownerPubky, peerPubky);
  return !!budget && budget.exhaustedAt !== null;
}

/**
 * A handshake the counterparty never finished. Drops the link row and its
 * outbox so the periodic stepper stops paying for it, then tells the truth on
 * the conversation: every queued send to this peer becomes `failed`, the same
 * state a permanently dropped retry produces and the same one ThreadScreen
 * already renders. Without this the send sits in `sending` forever while a
 * timer spins behind it.
 *
 * The budget row deliberately outlives this: it carries `exhausted_at`, which
 * is what stops the peer from buying more periodic work by rewriting message 1.
 */
async function abandonUnestablishedLink(stored: LinkRecord): Promise<EnsureOutcome> {
  console.warn(
    `[LinkService] Handshake with ${stored.peerPubky} unestablished after ` +
      `${HANDSHAKE_PENDING_ADVANCE_LIMIT} steps; abandoning`,
  );
  await failQueuedSendsForPeer(stored.ownerPubky, stored.peerPubky);
  await wipeLinkState(stored);
  return 'error';
}

async function failQueuedSendsForPeer(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
  const items = await StorageService.listDeliveryQueue();
  for (const item of items) {
    const payload = parseRetryPayload(item.payload);
    if (!payload) continue;
    if (payload.ownerPubky !== ownerPubky || payload.peerPubky !== peerPubky) continue;
    // Drop before marking: group fan-out reads the remaining queue depth to
    // decide whether the message is done (see `markFailed`).
    await StorageService.removeFromQueue(item.id);
    await markFailed(payload);
  }
}

async function completeEstablished(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  role: LinkRole,
  snapshot: string,
  remoteNoisePublicKey: string,
  localPath: string,
  remotePath: string,
  handshakeLinkId: string,
): Promise<LinkStatus> {
  // A completed Noise XX handshake is proof of a real counterparty, so it is
  // the one non-user event that forgives everything charged against this peer.
  await StorageService.clearHandshakeBudget(ownerPubky, peerPubky);
  await StorageService.upsertLink({
    ownerPubky,
    peerPubky,
    role,
    status: 'established',
    snapshot,
    remoteNoisePublicKey,
    localReceiverPath: localPath,
    remoteReceiverPath: remotePath,
    consecutiveFailures: 0,
  });
  await closeQuietly(handshakeLinkId);
  const key = linkKey(ownerPubky, peerPubky);
  try {
    const { linkId } = await PaykitLinkNative.restoreLink(
      activeSession.alias,
      receiver.receiverAlias,
      peerPubky,
      remoteNoisePublicKey,
      localPath,
      remotePath,
      snapshot,
    );
    liveHandles.set(key, { status: 'established', linkId });
  } catch (err) {
    // The handshake handle is already closed and the row already says
    // `established`. Keeping the stale handshaking handle would let a later
    // step drive a dead linkId; the caller re-reads the row and treats this
    // as an established-link restore failure.
    liveHandles.delete(key);
    throw err;
  }
  return 'ready';
}

async function initiateHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
  intent: LinkIntent,
  alreadyRecovered: boolean,
): Promise<EnsureOutcome> {
  const remotePath = LINK_RECEIVER_PATH;
  const initiated = await PaykitLinkNative.initiateLink(
    activeSession.alias,
    receiver.receiverAlias,
    peerPubky,
    marker.noisePublicKey,
    localPath,
    remotePath,
  );
  await StorageService.upsertLink({
    ownerPubky,
    peerPubky,
    role: 'initiator',
    status: 'handshaking',
    snapshot: initiated.snapshot,
    remoteNoisePublicKey: marker.noisePublicKey,
    localReceiverPath: localPath,
    remoteReceiverPath: remotePath,
    consecutiveFailures: 0,
  });
  liveHandles.set(linkKey(ownerPubky, peerPubky), {
    status: 'handshaking',
    linkId: initiated.linkId,
    role: 'initiator',
  });
  // Reaching this function already proves the caller allowed initiation.
  return advanceLiveHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    { status: 'handshaking', linkId: initiated.linkId, role: 'initiator' },
    intent,
    alreadyRecovered,
  );
}

/**
 * Atomic inbound probe. `none` is not an error and leaves prior state
 * untouched (the reference discards failed / empty probes).
 */
async function probeInbound(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  _ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
): Promise<Extract<LinkProbeResult, { result: 'pending' | 'established' }> | null> {
  try {
    const probed = await PaykitLinkNative.probeInboundLink(
      activeSession.alias,
      receiver.receiverAlias,
      peerPubky,
      marker.noisePublicKey,
      localPath,
      LINK_RECEIVER_PATH,
    );
    if (probed.result === 'none') return null;
    return probed;
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'protocol') throw err;
    return null;
  }
}

async function adoptInboundHandshake(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
  inbound: Extract<LinkProbeResult, { result: 'pending' | 'established' }>,
): Promise<LinkStatus> {
  const remotePath = LINK_RECEIVER_PATH;
  const key = linkKey(ownerPubky, peerPubky);
  if (inbound.result === 'established') {
    await StorageService.clearHandshakeBudget(ownerPubky, peerPubky);
    await StorageService.upsertLink({
      ownerPubky,
      peerPubky,
      role: 'responder',
      status: 'established',
      snapshot: inbound.snapshot,
      remoteNoisePublicKey: marker.noisePublicKey,
      localReceiverPath: localPath,
      remoteReceiverPath: remotePath,
      consecutiveFailures: 0,
    });
    liveHandles.set(key, { status: 'established', linkId: inbound.linkId });
    return 'ready';
  }

  await StorageService.upsertLink({
    ownerPubky,
    peerPubky,
    role: 'responder',
    status: 'handshaking',
    snapshot: inbound.snapshot,
    remoteNoisePublicKey: marker.noisePublicKey,
    localReceiverPath: localPath,
    remoteReceiverPath: remotePath,
    consecutiveFailures: 0,
  });
  liveHandles.set(key, { status: 'handshaking', linkId: inbound.linkId, role: 'responder' });
  return 'handshaking-responder';
}

/**
 * The {@link LinkIntent} is the CALLER's policy, threaded through unchanged. It
 * is not a detail of how the failure is classified: recovery from a wedged link
 * ends in {@link initiateHandshake}, which writes Noise message 1 to a
 * peer-visible location. A background tick and an inbox sync must never reach
 * that, however the failure arrived.
 */
async function handleLinkFailure(
  err: unknown,
  stored: LinkRecord,
  intent: LinkIntent,
  alreadyRecovered: boolean,
): Promise<EnsureOutcome> {
  if (isLinkNativeError(err) && err.code === 'unavailable') return 'native-missing';
  if (isLinkNativeError(err) && err.code === 'auth') {
    KeyStore.deleteLinkSession();
    session = null;
    return 'needs-enable';
  }
  const established = stored.status === 'established';
  if (isLinkNativeError(err) && err.code === 'network') {
    if (established) {
      console.warn(
        `[LinkService] Established link restore deferred for ${stored.peerPubky}:`,
        errorMessage(err),
      );
      return 'ready';
    }
    const failures = await StorageService.incrementLinkConsecutiveFailures(
      stored.ownerPubky,
      stored.peerPubky,
    );
    if (failures >= HANDSHAKE_FAILURE_LIMIT) {
      return recoverWedgedLink(stored, intent, alreadyRecovered, err);
    }
    return roleStatus(stored.role);
  }
  if (isLinkNativeError(err) && err.code === 'protocol') {
    return recoverWedgedLink(stored, intent, alreadyRecovered, err);
  }

  if (established) {
    console.warn(
      `[LinkService] Established link step failed for ${stored.peerPubky}:`,
      errorMessage(err),
    );
    return 'ready';
  }

  const failures = await StorageService.incrementLinkConsecutiveFailures(
    stored.ownerPubky,
    stored.peerPubky,
  );
  if (failures >= HANDSHAKE_FAILURE_LIMIT) {
    return recoverWedgedLink(stored, intent, alreadyRecovered, err);
  }
  console.warn(`[LinkService] Handshake step failed for ${stored.peerPubky}:`, errorMessage(err));
  return roleStatus(stored.role);
}

/**
 * Protocol/decrypt error, or N consecutive handshake (not established-network)
 * failures: delete the link row, clear the outbox, and restart a fresh
 * handshake. If the peer marker's noise key changed, this is re-enrollment.
 *
 * Restarting is gated on the caller's {@link LinkIntent}. When the caller
 * forbids initiating (periodic tick, inbox sync) the wipe still happens and
 * this returns `idle` or `error` — the row and its dead outbox are gone, so the
 * peer's own message 1 can be adopted on the next sync, and the user's next
 * send or thread open initiates. Nothing is left wedged; only the timer is
 * silent.
 *
 * Wiping an unestablished handshake also charges the durable abuse budget. The
 * wipe is peer-triggerable — a malformed Noise message 3 produces `protocol` on
 * demand — so without a charge the cycle wipe → re-adopt → wipe would be free
 * and the budget would never decay. An established link is never charged: its
 * failures are transport problems, not an unfinished handshake.
 */
async function recoverWedgedLink(
  stored: LinkRecord,
  intent: LinkIntent,
  alreadyRecovered: boolean,
  cause: unknown,
): Promise<EnsureOutcome> {
  const protocol = isLinkNativeError(cause) && cause.code === 'protocol';
  if (protocol) {
    try {
      const marker = await PaykitLinkNative.getReceiverMarker(stored.peerPubky, LINK_RECEIVER_PATH);
      if (
        marker &&
        stored.remoteNoisePublicKey &&
        marker.noisePublicKey !== stored.remoteNoisePublicKey
      ) {
        console.warn(
          `[LinkService] Peer ${stored.peerPubky} re-enrolled (noise key changed); restarting handshake`,
        );
      }
    } catch {
      // Marker fetch failing does not block the wipe — the handshake is wedged.
    }
  }

  if (stored.status !== 'established') {
    const budget = await chargeHandshakeBudget(stored.ownerPubky, stored.peerPubky, {
      reason: 'unestablished-wipe',
    });
    if (budget.exhausted) return abandonUnestablishedLink(stored);
  }

  await wipeLinkState(stored);

  if (alreadyRecovered) return 'error';
  return ensureLinkLocked(stored.peerPubky, intent, true);
}

async function wipeLinkState(stored: LinkRecord): Promise<void> {
  const key = linkKey(stored.ownerPubky, stored.peerPubky);
  const live = liveHandles.get(key);
  if (live) {
    await closeQuietly(live.linkId);
    liveHandles.delete(key);
  }
  const receiver = await StorageService.getLinkReceiver(stored.ownerPubky);
  if (session && receiver) {
    try {
      await PaykitLinkNative.clearLinkOutbox(
        session.alias,
        receiver.receiverAlias,
        stored.peerPubky,
        stored.remoteNoisePublicKey,
        coerceReceiverPath(stored.localReceiverPath),
        coerceReceiverPath(stored.remoteReceiverPath),
      );
    } catch {
      // Best-effort: a missing outbox is the desired end state.
    }
  }
  await StorageService.deleteLink(stored.ownerPubky, stored.peerPubky);
}

// ─── Receive internals ────────────────────────────────────────────────────────

/**
 * Known counterparties we can probe. Encrypted Links have no inbox
 * enumeration — inbound from a stranger is invisible until their pubky
 * appears in this set (follow / follower / friend / manual add / existing
 * link peer).
 */
async function collectInboxCandidates(ownerPubky: PubkyKey): Promise<PubkyKey[]> {
  const [contacts, links] = await Promise.all([
    StorageService.getAllContacts(ownerPubky),
    StorageService.getAllLinks(ownerPubky),
  ]);
  const seen = new Set<string>();
  const out: PubkyKey[] = [];
  for (const contact of contacts) {
    if (seen.has(contact.pubky)) continue;
    seen.add(contact.pubky);
    out.push(contact.pubky);
  }
  for (const link of links) {
    if (seen.has(link.peerPubky)) continue;
    seen.add(link.peerPubky);
    out.push(link.peerPubky);
  }
  return out;
}

/**
 * Persists a held peer's inbound PAMs without routing them. Only reached
 * while the peer sits behind the accept gate, hence the hard-coded
 * `'gated'` trust handed to {@link routeHeldGroupInbound}.
 */
async function persistInboundWithoutRouting(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
): Promise<void> {
  const handle = requireEstablishedHandle(ownerPubky, peerPubky);
  const { messages, snapshot } = await PaykitLinkNative.receivePrivateMessages(handle);
  if (messages.length === 0) return;
  const arrivedAt = Date.now();
  const streamItems = await prepareInboundStreamItems(ownerPubky, peerPubky, messages, arrivedAt);
  if (streamItems.length > 0) {
    await StorageService.saveLinkStreamItems(streamItems);
  }
  await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, snapshot, 'established');
  const dropped = await StorageService.settleExcessUnprocessedLinkStreamItems(
    ownerPubky,
    peerPubky,
  );
  if (dropped > 0) {
    console.warn(
      `[LinkService] Settled ${dropped} excess held stream item(s) for ${peerPubky} over the per-peer unprocessed cap`,
    );
  }
  // Group fan-out is not a DM inbox item. WoT holds chat messages as a
  // request; group ops that cannot touch the channel list or the roster
  // still apply on an established Encrypted Link.
  await routeHeldGroupInbound(ownerPubky, peerPubky, 'gated');
}

/**
 * Applies group PAMs that arrived while a message request is pending.
 * Chat / attachment / payment items stay unprocessed until accept, and so do
 * the group ops {@link isGroupInboundGated} reserves for an accepted peer.
 */
async function routeHeldGroupInbound(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  peerTrust: GroupPeerTrust,
): Promise<void> {
  const items = await StorageService.getUnprocessedLinkStreamItems(ownerPubky, peerPubky);
  for (const item of items) {
    if (shouldDropOversizedKnownInbound(item.rawJson, item.kind)) {
      const peekedOver = peekEnvelopeKind(item.rawJson);
      if (peekedOver !== null && isGroupWireKind(peekedOver)) {
        const groupEnvelope = decodeGroupEnvelope(item.rawJson);
        if (groupEnvelope) {
          await StorageService.markGroupEventSeen(
            ownerPubky,
            groupEnvelope.channel_id,
            peerPubky,
            groupEnvelope.event_id,
            item.receivedAt,
          );
        }
      }
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    const peeked = peekEnvelopeKind(item.rawJson);
    if (peeked === null || !isGroupWireKind(peeked)) continue;
    const outcome = await routeGroupStreamItem({
      ownerPubky,
      peerPubky,
      item,
      peerTrust,
    });
    if (outcome === 'deferred') continue;
    await StorageService.markLinkStreamItemProcessed(item.id);
  }
}

/**
 * Settles one group `link_stream_items` row, or reports `'deferred'` when the
 * accept gate reserves that op for an accepted peer. A malformed known group
 * kind settles too, so it cannot wedged-retry (M1 rule).
 *
 * A deferred row is left unprocessed on purpose:
 * {@link LinkService.acceptMessageRequest} replays it through
 * {@link routeUnprocessedStreamItems}, and
 * {@link LinkService.declineMessageRequest} deletes the held stream items
 * plus that sender's `group_deferred_events` and `group_seen_events`.
 * Already-persisted `group_messages` in shared channels stay — decline is
 * a 1:1 inbox action, not a group-history wipe.
 */
async function routeGroupStreamItem(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  item: LinkStreamItem;
  peerTrust: GroupPeerTrust;
}): Promise<'settled' | 'deferred'> {
  const { ownerPubky, peerPubky, item, peerTrust } = input;
  const envelope = decodeGroupEnvelope(item.rawJson);
  if (!envelope) return 'settled';
  if (await isGroupInboundGated({ ownerPubky, envelope, peerTrust })) return 'deferred';
  await applyGroupInbound({
    ownerPubky,
    senderPubky: peerPubky,
    envelope,
    rawJson: item.rawJson,
    receivedAt: item.receivedAt,
    peerTrust,
  });
  return 'settled';
}

async function holdAsMessageRequest(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
  const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
  if (existing?.status === 'declined') return;
  const ts = Date.now();
  await StorageService.upsertMessageRequest({
    ownerPubky,
    peerPubky,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
    status: 'pending',
  });
}

/**
 * Decline is terminal: do not adopt a re-initiated inbound handshake, do
 * not persist stream items, and do not rewrite the request row to pending.
 */
async function rejectDeclinedInbound(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
  const key = linkKey(ownerPubky, peerPubky);
  const live = liveHandles.get(key);
  if (live) {
    await closeQuietly(live.linkId);
    liveHandles.delete(key);
  }
  const leftover = await StorageService.getLink(ownerPubky, peerPubky);
  if (leftover) {
    await wipeLinkState(leftover);
    return;
  }
  const lookup = await sessionOrRestore();
  if (!isActiveSession(lookup)) return;
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  if (!receiver) return;
  try {
    const marker = await PaykitLinkNative.getReceiverMarker(peerPubky, LINK_RECEIVER_PATH);
    if (!marker) return;
    await PaykitLinkNative.clearLinkOutbox(
      lookup.alias,
      receiver.receiverAlias,
      peerPubky,
      marker.noisePublicKey,
      coerceReceiverPath(receiver.receiverPath),
      LINK_RECEIVER_PATH,
    );
  } catch {
    // Best-effort: a missing outbox is the desired end state.
  }
}

function notifyInboxSynced(ownerPubky: PubkyKey): void {
  for (const listener of inboxSyncListeners) {
    try {
      listener(ownerPubky);
    } catch {
      // Badge refresh must not fail inbox sync.
    }
  }
}

async function syncPeerLocked(peerPubky: PubkyKey): Promise<LinkMessage[]> {
  const ownerPubky = requireOwner();
  const prior = await StorageService.getLink(ownerPubky, peerPubky);
  const existingRequest = await StorageService.getMessageRequest(ownerPubky, peerPubky);
  if (existingRequest?.status === 'declined') {
    await rejectDeclinedInbound(ownerPubky, peerPubky);
    return [];
  }
  try {
    const outcome = await ensureLinkLocked(peerPubky, 'background', false);
    const priorMessageCount = await StorageService.countLinkMessagesForPeer(ownerPubky, peerPubky);
    const hasPriorRoutedConversation = priorMessageCount > 0;
    const isNewInbound =
      prior === null &&
      !hasPriorRoutedConversation &&
      (outcome === 'ready' || outcome === 'handshaking-responder');

    if (isNewInbound && existingRequest?.status !== 'accepted') {
      const contact = await StorageService.getContact(peerPubky, ownerPubky);
      const decision = classifyInboundPeer(
        wotInputFromContact(contact, hasPriorRoutedConversation),
      );
      if (decision === 'request') {
        await holdAsMessageRequest(ownerPubky, peerPubky);
        if (outcome === 'ready') {
          await persistInboundWithoutRouting(ownerPubky, peerPubky);
        }
        return [];
      }
    }

    if (existingRequest?.status === 'pending' && !isNewInbound) {
      if (outcome === 'ready') {
        await persistInboundWithoutRouting(ownerPubky, peerPubky);
      }
      return [];
    }

    // Past the two gated early-returns above, this peer is accepted or was
    // never gated. `pending` + `!isNewInbound` returned already, and an
    // `isNewInbound` peer always classifies as `request`: the only
    // auto-accept path needs prior routed messages, which `isNewInbound`
    // excludes. So group ops may apply in full from here on.
    const peerTrust: GroupPeerTrust = 'accepted';

    if (outcome !== 'ready') return routeUnprocessedStreamItems(ownerPubky, peerPubky, peerTrust);

    const swept = await routeUnprocessedStreamItems(ownerPubky, peerPubky, peerTrust);
    const handle = requireEstablishedHandle(ownerPubky, peerPubky);
    const { messages, snapshot } = await PaykitLinkNative.receivePrivateMessages(handle);

    if (messages.length === 0) return swept;

    const arrivedAt = Date.now();
    const streamItems = await prepareInboundStreamItems(ownerPubky, peerPubky, messages, arrivedAt);
    if (streamItems.length > 0) {
      await StorageService.saveLinkStreamItems(streamItems);
    }
    const routed = await routeUnprocessedStreamItems(ownerPubky, peerPubky, peerTrust);
    await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, snapshot, 'established');
    return [...swept, ...routed];
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'protocol') {
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      if (stored) await recoverWedgedLink(stored, 'background', false, err);
    }
    throw err;
  }
}

async function routeUnprocessedStreamItems(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  peerTrust: GroupPeerTrust,
): Promise<LinkMessage[]> {
  const items = await StorageService.getUnprocessedLinkStreamItems(ownerPubky, peerPubky);
  const received: LinkMessage[] = [];
  const seenInBatch = new Set<string>();
  for (const item of items) {
    if (shouldDropOversizedKnownInbound(item.rawJson, item.kind)) {
      const peekedOver = peekEnvelopeKind(item.rawJson);
      if (peekedOver !== null && isGroupWireKind(peekedOver)) {
        const groupEnvelope = decodeGroupEnvelope(item.rawJson);
        if (groupEnvelope) {
          await StorageService.markGroupEventSeen(
            ownerPubky,
            groupEnvelope.channel_id,
            peerPubky,
            groupEnvelope.event_id,
            item.receivedAt,
          );
        }
      }
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    const peeked = peekEnvelopeKind(item.rawJson);
    if (peeked === CHAT_ATTACHMENT_KIND) {
      const row = await applyAttachmentInbound({
        ownerPubky,
        senderPubky: peerPubky,
        peerPubky,
        rawJson: item.rawJson,
        receivedAt: item.receivedAt,
      });
      await StorageService.markLinkStreamItemProcessed(item.id);
      if (row) received.push(row);
      continue;
    }
    if (peeked !== null && isPaykitPaymentKind(peeked)) {
      await applyPaymentInbound({
        ownerPubky,
        senderPubky: peerPubky,
        peerPubky,
        rawJson: item.rawJson,
        receivedAt: item.receivedAt,
      });
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    if (peeked !== null && isGroupWireKind(peeked)) {
      const outcome = await routeGroupStreamItem({
        ownerPubky,
        peerPubky,
        item,
        peerTrust,
      });
      if (outcome === 'settled') {
        await StorageService.markLinkStreamItemProcessed(item.id);
      }
      continue;
    }
    const envelope = decodeLinkEnvelope(item.rawJson);
    if (!envelope) continue;
    const dedupKey = `${envelope.kind}:${envelope.event_id}`;
    if (seenInBatch.has(dedupKey)) {
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    seenInBatch.add(dedupKey);
    if (
      await StorageService.hasLinkMessage(ownerPubky, peerPubky, envelope.kind, envelope.event_id)
    ) {
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    const row: LinkMessage = {
      ownerPubky,
      eventId: envelope.event_id,
      conversationId: buildDmConversationId(peerPubky),
      peerPubky,
      senderPubky: peerPubky,
      direction: 'received',
      kind: envelope.kind,
      rawJson: item.rawJson,
      body: envelope.body,
      sentAt: envelope.sent_at,
      receivedAt: item.receivedAt,
      deliveryState: 'delivered',
    };
    await StorageService.saveLinkMessage(row);
    await StorageService.markLinkStreamItemProcessed(item.id);
    received.push(row);
  }
  return received;
}

// ─── Retry / recover internals ────────────────────────────────────────────────

async function drainDueRetries(): Promise<void> {
  const due = await RetryQueue.getDue();
  for (const item of due) {
    const payload = parseRetryPayload(item.payload);
    if (!payload || !isCurrentOwner(payload.ownerPubky)) continue;
    await deliverQueuedPayload(item, payload);
  }
}

async function deliverQueuedPayload(
  item: DeliveryQueueItem,
  payload: AnyLinkRetryPayload,
): Promise<void> {
  await withQueue(payload.peerPubky, async () => {
    // `recoverPendingSends` and a drain can both hold this item from their own
    // pre-lock reads. The group fan-out branch below only checks that the
    // message row exists, which stays true after a successful send, so without
    // this the same `rawJson` could go out twice.
    if (!(await StorageService.hasQueueItem(item.id))) return;
    if (payload.type === LINK_RETRY_PAYLOAD_TYPE) {
      const row = await StorageService.getLinkMessage(
        payload.ownerPubky,
        payload.senderPubky,
        payload.kind,
        payload.eventId,
      );
      if (!row) {
        await RetryQueue.recordSuccess(item.id);
        return;
      }
      if (!isRetryableDeliveryState(row.deliveryState)) {
        await RetryQueue.recordSuccess(item.id);
        return;
      }
    } else {
      const exists = await StorageService.hasGroupMessage(
        payload.ownerPubky,
        payload.channelId,
        payload.senderPubky,
        payload.eventId,
      );
      if (!exists) {
        await RetryQueue.recordSuccess(item.id);
        return;
      }
    }

    let outcome: EnsureOutcome;
    try {
      outcome = await ensureLinkLocked(payload.peerPubky, 'queued', false);
    } catch (err) {
      if (isTransientLinkError(err)) {
        await RetryQueue.defer(item.id, item.attempts);
        return;
      }
      const dropped = await RetryQueue.recordFailure(item.id, item.attempts);
      if (dropped) await markFailed(payload);
      return;
    }

    if (outcome !== 'ready') {
      await RetryQueue.defer(item.id, item.attempts);
      return;
    }

    try {
      const handle = requireEstablishedHandle(payload.ownerPubky, payload.peerPubky);
      const wireJson = await wireJsonForNativeSend(
        payload.kind,
        payload.rawJson,
        payload.ownerPubky,
        payload.senderPubky,
        payload.eventId,
      );
      const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, wireJson);
      if (payload.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
        await StorageService.finalizeGroupFanoutSend({
          ownerPubky: payload.ownerPubky,
          peerPubky: payload.peerPubky,
          snapshot,
          queueId: item.id,
        });
        const remaining = await StorageService.countDeliveryQueueForMessage(payload.eventId);
        if (remaining === 0) {
          await StorageService.updateGroupMessageDeliveryState(
            payload.ownerPubky,
            payload.channelId,
            payload.senderPubky,
            payload.eventId,
            'sent',
          );
          if (payload.kind === CHAT_ATTACHMENT_KIND) {
            await StorageService.updateAttachmentDelivery(
              payload.ownerPubky,
              payload.senderPubky,
              payload.eventId,
              'sent',
            );
          }
        }
      } else {
        await StorageService.finalizeLinkSend({
          ownerPubky: payload.ownerPubky,
          peerPubky: payload.peerPubky,
          senderPubky: payload.senderPubky,
          kind: payload.kind,
          eventId: payload.eventId,
          snapshot,
          queueId: item.id,
        });
      }
      await RetryQueue.recordSuccess(item.id);
    } catch (err) {
      if (isTransientLinkError(err)) {
        await RetryQueue.defer(item.id, item.attempts);
        return;
      }
      const dropped = await RetryQueue.recordFailure(item.id, item.attempts);
      if (dropped) await markFailed(payload);
    }
  });
}

function isTransientLinkError(err: unknown): boolean {
  return isLinkNativeError(err) && (err.code === 'unavailable' || err.code === 'network');
}

function isRetryableDeliveryState(state: LinkMessage['deliveryState']): boolean {
  return state === 'sending' || state === 'failed';
}

async function markImmediateSendFailed(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  senderPubky: PubkyKey;
  kind: string;
  eventId: string;
}): Promise<void> {
  await StorageService.updateLinkMessageDeliveryState(
    input.ownerPubky,
    input.senderPubky,
    input.kind,
    input.eventId,
    'failed',
  );
  if (input.kind === CHAT_ATTACHMENT_KIND) {
    await StorageService.updateAttachmentDelivery(
      input.ownerPubky,
      input.senderPubky,
      input.eventId,
      'failed',
    );
  }
}

function toSendError(err: unknown): Error {
  const native = toLinkNativeError(err);
  return new Error(native.message);
}

async function markFailed(payload: AnyLinkRetryPayload): Promise<void> {
  if (payload.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
    const remaining = await StorageService.countDeliveryQueueForMessage(payload.eventId);
    if (remaining === 0) {
      await StorageService.updateGroupMessageDeliveryState(
        payload.ownerPubky,
        payload.channelId,
        payload.senderPubky,
        payload.eventId,
        'sent',
      );
    }
    return;
  }
  await StorageService.updateLinkMessageDeliveryState(
    payload.ownerPubky,
    payload.senderPubky,
    payload.kind,
    payload.eventId,
    'failed',
  );
  if (payload.kind === CHAT_ATTACHMENT_KIND) {
    await StorageService.updateAttachmentDelivery(
      payload.ownerPubky,
      payload.senderPubky,
      payload.eventId,
      'failed',
    );
  }
}

async function prepareInboundStreamItems(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  messages: readonly { kind: string | null; rawJson: string }[],
  arrivedAt: number,
): Promise<LinkStreamItemInput[]> {
  const out: LinkStreamItemInput[] = [];
  for (const item of messages) {
    if (shouldDropOversizedKnownInbound(item.rawJson, item.kind)) {
      continue;
    }
    const peeked = peekEnvelopeKind(item.rawJson) ?? item.kind;
    if (peeked === CHAT_ATTACHMENT_KIND) {
      const envelope = decodeAttachmentEnvelope(item.rawJson);
      if (!envelope) continue;
      if (!isAttachmentLocationBoundToSender(envelope.location, peerPubky)) {
        if (envelope.channel_id) {
          await StorageService.markGroupEventSeen(
            ownerPubky,
            envelope.channel_id,
            peerPubky,
            envelope.event_id,
            arrivedAt,
          );
        }
        continue;
      }
      await KeyStore.setAttachmentSecret(ownerPubky, peerPubky, envelope.event_id, {
        key: envelope.key,
        nonce: envelope.nonce,
        algorithm: envelope.algorithm,
        ...(envelope.thumbnail
          ? { thumbnail: { key: envelope.thumbnail.key, nonce: envelope.thumbnail.nonce } }
          : {}),
      });
      out.push({
        id: uuidv4(),
        ownerPubky,
        peerPubky,
        kind: item.kind,
        rawJson: redactAttachmentRawJson(item.rawJson),
        receivedAt: arrivedAt,
      });
      continue;
    }
    out.push({
      id: uuidv4(),
      ownerPubky,
      peerPubky,
      kind: item.kind,
      rawJson: item.rawJson,
      receivedAt: arrivedAt,
    });
  }
  return out;
}

async function wireJsonForNativeSend(
  kind: string,
  persistedRawJson: string,
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  eventId: string,
): Promise<string> {
  if (kind !== CHAT_ATTACHMENT_KIND) return persistedRawJson;
  return reconstructAttachmentWireJson(
    persistedRawJson,
    attachmentKeyRef(ownerPubky, senderPubky, eventId),
  );
}

export function buildPreparedSendIntent(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  kind: string;
  eventId: string;
  rawJson: string;
  body: string;
  sentAt: number;
  queueId: string;
}): { message: LinkMessage; queueItem: DeliveryQueueItem } {
  const persistJson =
    input.kind === CHAT_ATTACHMENT_KIND ? redactAttachmentRawJson(input.rawJson) : input.rawJson;
  const ts = Date.now();
  return {
    message: {
      ownerPubky: input.ownerPubky,
      eventId: input.eventId,
      conversationId: buildDmConversationId(input.peerPubky),
      peerPubky: input.peerPubky,
      senderPubky: input.ownerPubky,
      direction: 'sent',
      kind: input.kind,
      rawJson: persistJson,
      body: input.body,
      sentAt: input.sentAt,
      receivedAt: null,
      deliveryState: 'sending',
    },
    queueItem: {
      id: input.queueId,
      messageId: input.eventId,
      recipientPubky: input.peerPubky,
      payload: JSON.stringify(
        retryPayload(input.ownerPubky, input.peerPubky, input.eventId, persistJson, input.kind),
      ),
      attempts: 0,
      nextRetryAt: ts,
      createdAt: ts,
    },
  };
}

async function reconcilePaymentPendingSends(): Promise<void> {
  const ownerPubky = session?.pubky ?? KeyStore.getPubky();
  if (!ownerPubky) return;
  const pending = (await StorageService.listPaymentRequestsWithPendingEvent(ownerPubky)) ?? [];
  for (const row of pending) {
    const eventId = row.pendingEventId;
    if (!eventId) continue;
    const message = await StorageService.getLinkMessageByEventId(ownerPubky, ownerPubky, eventId);
    if (!message) continue;
    if (message.deliveryState === 'sent') {
      await StorageService.clearPaymentPendingEvent(ownerPubky, eventId);
      continue;
    }
    if (!isRetryableDeliveryState(message.deliveryState)) continue;
    if (await StorageService.hasQueueItemForMessage(eventId)) continue;
    const ts = Date.now();
    await StorageService.enqueue({
      id: uuidv4(),
      messageId: eventId,
      recipientPubky: row.peerPubky,
      payload: JSON.stringify(
        retryPayload(ownerPubky, row.peerPubky, eventId, message.rawJson, message.kind),
      ),
      attempts: 0,
      nextRetryAt: ts,
      createdAt: ts,
    });
  }
}

function retryPayload(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  eventId: string,
  rawJson: string,
  kind: string = CHAT_MESSAGE_KIND,
): LinkRetryPayload {
  return {
    type: LINK_RETRY_PAYLOAD_TYPE,
    ownerPubky,
    peerPubky,
    senderPubky: ownerPubky,
    kind,
    eventId,
    rawJson,
  };
}

async function dispatchPreparedDm(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  outcome: EnsureOutcome;
  kind: string;
  eventId: string;
  rawJson: string;
  body: string;
  sentAt: number;
}): Promise<LinkMessage> {
  const queueId = uuidv4();
  const persistJson =
    input.kind === CHAT_ATTACHMENT_KIND ? redactAttachmentRawJson(input.rawJson) : input.rawJson;
  const message: LinkMessage = {
    ownerPubky: input.ownerPubky,
    eventId: input.eventId,
    conversationId: buildDmConversationId(input.peerPubky),
    peerPubky: input.peerPubky,
    senderPubky: input.ownerPubky,
    direction: 'sent',
    kind: input.kind,
    rawJson: persistJson,
    body: input.body,
    sentAt: input.sentAt,
    receivedAt: null,
    deliveryState: 'sending',
  };
  const ts = Date.now();
  await StorageService.persistLinkSendIntent({
    message,
    queueItem: {
      id: queueId,
      messageId: input.eventId,
      recipientPubky: input.peerPubky,
      payload: JSON.stringify(
        retryPayload(input.ownerPubky, input.peerPubky, input.eventId, persistJson, input.kind),
      ),
      attempts: 0,
      nextRetryAt: ts,
      createdAt: ts,
    },
  });

  if (input.outcome !== 'ready') return message;

  try {
    const handle = requireEstablishedHandle(input.ownerPubky, input.peerPubky);
    const wireJson = await wireJsonForNativeSend(
      input.kind,
      persistJson,
      input.ownerPubky,
      input.ownerPubky,
      input.eventId,
    );
    const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, wireJson);
    await StorageService.finalizeLinkSend({
      ownerPubky: input.ownerPubky,
      peerPubky: input.peerPubky,
      senderPubky: input.ownerPubky,
      kind: input.kind,
      eventId: input.eventId,
      snapshot,
      queueId,
    });
    return { ...message, deliveryState: 'sent' };
  } catch (err) {
    console.warn(`[LinkService] Send failed for ${input.peerPubky}:`, errorMessage(err));
    await markImmediateSendFailed({
      ownerPubky: input.ownerPubky,
      peerPubky: input.peerPubky,
      senderPubky: input.ownerPubky,
      kind: input.kind,
      eventId: input.eventId,
    });
    throw toSendError(err);
  }
}

function parseRetryPayload(payload: string): AnyLinkRetryPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.ownerPubky !== 'string') return null;
  if (typeof candidate.peerPubky !== 'string') return null;
  if (typeof candidate.senderPubky !== 'string') return null;
  if (typeof candidate.kind !== 'string') return null;
  if (typeof candidate.eventId !== 'string') return null;
  if (typeof candidate.rawJson !== 'string') return null;
  if (candidate.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
    if (typeof candidate.channelId !== 'string') return null;
    return {
      type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
      ownerPubky: candidate.ownerPubky,
      peerPubky: candidate.peerPubky,
      senderPubky: candidate.senderPubky,
      kind: candidate.kind,
      eventId: candidate.eventId,
      channelId: candidate.channelId,
      rawJson: candidate.rawJson,
    };
  }
  if (candidate.type !== LINK_RETRY_PAYLOAD_TYPE) return null;
  return {
    type: LINK_RETRY_PAYLOAD_TYPE,
    ownerPubky: candidate.ownerPubky,
    peerPubky: candidate.peerPubky,
    senderPubky: candidate.senderPubky,
    kind: candidate.kind,
    eventId: candidate.eventId,
    rawJson: candidate.rawJson,
  };
}

// ─── Shared internals ─────────────────────────────────────────────────────────

function roleStatus(role: LinkRole): LinkStatus {
  return role === 'initiator' ? 'handshaking-initiator' : 'handshaking-responder';
}

function requireOwner(): PubkyKey {
  const owner = session?.pubky ?? KeyStore.getPubky();
  if (!owner) throw new Error('LinkService: no local pubky');
  return owner;
}

function requireSessionAlias(): string {
  if (session) return session.alias;
  const stored = KeyStore.getLinkSession();
  if (stored) return stored;
  throw createLinkNativeError('auth', 'Enable encrypted messaging to write to your homeserver.');
}

function requireEstablishedHandle(ownerPubky: PubkyKey, peerPubky: PubkyKey): string {
  const live = liveHandles.get(linkKey(ownerPubky, peerPubky));
  if (!live || live.status !== 'established') {
    throw createLinkNativeError(
      'network',
      `LinkService: missing established link handle for ${peerPubky}`,
    );
  }
  return live.linkId;
}

function isCurrentOwner(ownerPubky: PubkyKey): boolean {
  const current = session?.pubky ?? KeyStore.getPubky();
  return current !== null && current === ownerPubky;
}

async function clearPeerOutboxBestEffort(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  peerPubky: PubkyKey,
  remoteNoisePublicKey: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  try {
    await PaykitLinkNative.clearLinkOutbox(
      activeSession.alias,
      receiver.receiverAlias,
      peerPubky,
      remoteNoisePublicKey,
      coerceReceiverPath(localPath),
      coerceReceiverPath(remotePath),
    );
  } catch {
    // Best-effort: a missing outbox is the desired end state.
  }
}

function linkKey(ownerPubky: PubkyKey, peerPubky: PubkyKey): string {
  return `${ownerPubky}:${peerPubky}`;
}

function errorMessage(err: unknown): string {
  if (isLinkNativeError(err)) return `[${err.code}] ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

async function closeQuietly(linkId: string): Promise<void> {
  try {
    await PaykitLinkNative.closeLink(linkId);
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'unavailable') throw err;
  }
}

/**
 * Serializes operations per counterparty. Settled entries are pruned so the
 * map cannot grow without bound across a long-lived process.
 */
async function withQueue<T>(peerPubky: PubkyKey, operation: () => Promise<T>): Promise<T> {
  const owner = session?.pubky ?? KeyStore.getPubky() ?? '';
  const key = `${owner}:${peerPubky}`;
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const tracked = next.catch(() => undefined);
  queues.set(key, tracked);
  try {
    return await next;
  } finally {
    if (queues.get(key) === tracked) {
      queues.delete(key);
    }
  }
}

export type { LinkNativeError };
