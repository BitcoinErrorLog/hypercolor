import { v4 as uuidv4 } from 'uuid';
import {
  PaykitLinkNative,
  createLinkNativeError,
  isLinkNativeError,
  toLinkNativeError,
  type LinkNativeError,
  type ReceiverMarker,
} from './PaykitLinkNative';
import {
  PaykitSdkNative,
  SdkOperationError,
  isSdkOperationError,
  type SdkEnsureResult,
  type SdkLinkRole,
} from './PaykitSdkNative';
import { StorageService } from '../StorageService';
import { KeyStore } from '../KeyStore';
import { parsePubkyOwner, resolveHomeserverOrigin } from '../homeserverOrigin';
import {
  rejectIfOwnerMismatch,
  requireRingGrantCoverage,
  ScopesDeclinedError,
} from '../adoptSessionGates';
import { RetryQueue } from '../RetryQueue';
import { isConnectDelegationInFlight } from '../../ui/connectDelegationStart';
import {
  RING_GRANT_CAPABILITIES,
  formatAuthFlowCapabilities,
  LINK_RECEIVER_PATH,
  assertValidReceiverPath,
  buildChatMessageEnvelope,
  buildDmConversationId,
  CHAT_DELETE_KIND,
  CHAT_MESSAGE_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_REACTION_KIND,
  CHAT_TAG_KIND,
  coerceReceiverPath,
  decodeLinkEnvelope,
  parseDmConversationId,
  type LinkMessage,
  type LinkReconnectErrorCategory,
  type LinkRecord,
  type LinkRecordInput,
  type LinkRole,
  type LinkStatus,
  type LinkStreamItem,
  type LinkStreamItemInput,
  type ReceiverRole,
} from '../../types/link';
import type { DeliveryQueueItem, PubkyKey } from '../../types';
import {
  enqueueChatKindsAdvertisement,
  persistPeerChatKindsVFromMarker,
  drainChatKindsAdvertiseRetry,
  resetChatKindsUpgradeReplayedForTests,
} from './chatKindsAdvertisement';
import { CHAT_KINDS_V, normalizeChatKindsV } from '../../types/receiverMarker';
import {
  decodeGroupEnvelope,
  GROUP_MESSAGE_KIND,
  GROUP_REACTION_KIND,
  groupReadCursorId,
  isGroupWireKind,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  peekEnvelopeKind,
  type GroupPeerTrust,
} from '../../types/group';
import { applyGroupInbound } from '../group/applyGroupInbound';
import {
  applyInboundDelete,
  applyPendingChatDeletesForTarget,
  applyPendingChatTagsForTarget,
  applyInboundTagOrReceipt,
  applyLocalTag,
  buildOutboundReceipt,
  buildOutboundTag,
  queueItemForPeer,
} from './applyChatKinds';
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
import { cachePathsForAttachment, deleteCacheFiles } from '../attachments/fileIo';
import { applyPaymentInbound } from '../payments/applyPaymentInbound';
import { isPaykitPaymentKind } from '../../types/payment';
import { shouldDropOversizedKnownInbound } from './inboundEnvelope';
import { LinkSendError } from './LinkSendError';
import { FollowsImportSettings } from '../contacts/followsImportSettings';
import { opaquePeerId } from '../contacts/opaquePeerId';
import { setReceiverRoleState, useReceiverRoleStore } from '../../stores/receiverRoleStore';
import { buildChatDeleteEnvelope } from '../../types/chatKindValidation';
import { COPY } from '../../copy/uxCopy';
import { CONTACTS_COPY } from '../../ui/contacts/contactsCopy';
import { stripSensitive } from '../../ui/sanitizedError';
import {
  activeOwnerAtCommit,
  ensureSignOutPaint,
  invalidateSignOutRestore,
  paintOwner,
  pendingWipeInFlight,
  restorePaintedOwner,
  SIGNING_OUT,
  waitForWipeInFlight,
} from '../paintedOwner';

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
 * - Welcome Connect: `startAuthFlow` mints a raw `pubkyauth://` URL; after
 *   Ring approval, F2/F7 gates then `adoptApprovedSession` then
 *   `provisionReceiver`. `LinkService.enable()` is recovery for the same
 *   grant.
 * - App startup / `AppState` `'active'` (App.tsx):
 *     `await LinkService.recoverPendingSends();`
 *     `await LinkService.drainRetries();`
 *     `await LinkService.syncInbox();`
 * - Foreground interval: `startLinkRetryDrain()` (30s).
 * - ThreadScreen / ChatsScreen send and render through this service.
 */

/** Discriminator for this transport's items in the shared `delivery_queue`. */
export const LINK_RETRY_PAYLOAD_TYPE = 'link.chat.message';
export const LINK_CONTROL_PAYLOAD_TYPE = 'link.chat.control';

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

/**
 * Non-ready (and unaccepted-empty established) links older than this are
 * wiped so a later probe can adopt a peer's *current* msg1. Advancing a
 * stored handshake never GETs a new initiator channel.
 */
export const HANDSHAKE_STALE_MS = 10 * 60 * 1000;

/** Parked established re-keys per peer inside one {@link HANDSHAKE_STALE_MS} window. */
export const ESTABLISHED_REKEY_PARK_LIMIT = 3;

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

/**
 * How long inbox sync may wait on one counterparty before moving on to the
 * next. Marker fetch and native probe have no JS timeout of their own; a
 * hung `getReceiverMarker` for peer N otherwise blocks `probeInboundLink`
 * for every later candidate for the rest of the call (and, on App foreground
 * recover, for the rest of that recover). The abandoned peer's `withQueue`
 * work is left running so a late marker+probe can still adopt.
 */
export const LINK_INBOX_PEER_TIMEOUT_MS = 8_000;

/** Initiator C: re-GET the peer marker after this many no-advance polls. */
export const MARKER_RECOVERY_POLL_LIMIT = 3;

/** Initiator C: re-GET the peer marker after this much wall time without advance. */
export const MARKER_RECOVERY_TIMEOUT_MS = 120_000;

/** Open-thread inbox poll while the conversation is focused and the app is active. */
export const THREAD_INBOX_POLL_MS = 5_000;

/** Skip a repeat own-marker GET when the last successful sync was this recent. */
export const OWN_MARKER_SYNC_TTL_MS = 60_000;

/**
 * Ready-link peer-marker refresh cadence. syncInbox may GET a ready peer's
 * marker at most once per this window, and probes that peer's msg1 only when
 * the GET succeeds and the pk differs from the stored established link.
 */
export const PEER_MARKER_REFRESH_TTL_MS = 60_000;

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

interface ControlRetryPayload {
  type: typeof LINK_CONTROL_PAYLOAD_TYPE;
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

type AnyLinkRetryPayload = LinkRetryPayload | GroupFanoutRetryPayload | ControlRetryPayload;

type ActiveSession = { alias: string; pubky: string };
type LiveHandle =
  | { status: 'established'; linkId: string }
  | { status: 'handshaking'; linkId: string; role: LinkRole };
type SessionLookup = ActiveSession | { status: 'offline' } | null;
type EnsureOutcome = LinkStatus | 'idle' | 'denied' | 'deny-unavailable' | 'standby-blocked';

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

/** Same `ready` predicate the send path uses: live established handle or snapshot. */
function isReadyLinkPredicate(record: LinkRecord, live: LiveHandle | undefined): boolean {
  return live?.status === 'established' && record.status === 'established';
}

let session: ActiveSession | null = null;
let restoreInFlight: Promise<SessionLookup> | null = null;
const liveHandles = new Map<string, LiveHandle>();
const queues = new Map<string, Promise<unknown>>();
const peerQueueGenerations = new Map<string, number>();
let drainTimer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;
let drainInFlight: Promise<void> | null = null;
const inboxSyncListeners = new Set<(ownerPubky: PubkyKey) => void>();
const handshakeWatch = new Map<string, { polls: number; firstAt: number; snapshot: string }>();
const peerMarkerRefreshedAt = new Map<string, number>();
type PendingEstablishedRekey = {
  handshakeLinkId: string;
  snapshot: string;
  marker: ReceiverMarker;
  localPath: string;
  startedAt: number;
  role: LinkRole;
};
const pendingEstablishedRekeys = new Map<string, PendingEstablishedRekey>();
const establishedRekeyParkWindows = new Map<string, { windowStart: number; parks: number }>();
let inboxOwnMarkerSyncedFor: PubkyKey | null = null;
let inboxOwnMarkerSyncedAt = 0;
/** In-flight enable / persistThenAdopt / Connect operations. */
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
    const pendingWipe = pendingWipeInFlight();
    if (pendingWipe) await waitForWipeInFlight();
    const { sessionAlias, pubky } = await PaykitLinkNative.signinWithSecret(identitySecretHex);
    await persistThenAdopt(sessionAlias);
    KeyStore.setPubky(pubky);
    session = { alias: sessionAlias, pubky };
    paintOwner(pubky);
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
   * Native reconcile is report-only: it records sightings and never
   * deletes an adopted bearer.
   */
  async reconcileAdoptedSessionsAtBoot(): Promise<void> {
    await reconcileNativeSessions();
  },

  hasSession(): boolean {
    return session !== null;
  },

  /**
   * Adopt a Ring-approved pubkyauth session (cookie/bearer already created
   * inside native `awaitAuthApproval`). Persist the alias, then native adopt.
   */
  async adoptApprovedSession(
    sessionAlias: string,
    pubky: string,
  ): Promise<{ alias: string; pubky: string }> {
    const pendingWipe = pendingWipeInFlight();
    if (pendingWipe) await waitForWipeInFlight();
    const previousAlias = KeyStore.isInitialized() ? KeyStore.getLinkSession() : null;
    const previousPubky = session?.pubky ?? null;
    if (
      (previousAlias && previousAlias !== sessionAlias) ||
      (previousPubky && previousPubky !== pubky)
    ) {
      if (previousAlias && previousAlias !== sessionAlias) {
        await teardownPreviousAdoptedOwner(previousAlias, previousPubky);
      }
      if (session?.alias === previousAlias || (previousPubky && previousPubky !== pubky)) {
        session = null;
      }
    }
    await persistThenAdopt(sessionAlias);
    KeyStore.setPubky(pubky);
    session = { alias: sessionAlias, pubky };
    paintOwner(pubky);
    return { alias: sessionAlias, pubky };
  },

  /**
   * Publish the receiver marker for the already-adopted Connect session.
   * Used after the homeserver session is persisted, and as the Retry-publish CTA.
   */
  async provisionReceiverAfterConnect(): Promise<{
    pubky: string;
    receiverPath: string;
    noisePublicKey: string;
    receiverRole: ReceiverRole;
  }> {
    if (!session) {
      throw new Error('LinkService.provisionReceiverAfterConnect: no adopted session');
    }
    return provisionReceiver(session.alias, session.pubky);
  },

  async signOutSessionQuiet(sessionAlias: string): Promise<void> {
    try {
      await PaykitLinkNative.signOutSession(sessionAlias);
    } catch {
      // Detached / already consumed.
    }
  },

  async rollbackAdoptedSession(sessionAlias: string): Promise<void> {
    await this.signOutSessionQuiet(sessionAlias);
    rollbackLinkSession(sessionAlias, null);
    if (session?.alias === sessionAlias) {
      session = null;
    }
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
  async clearSession(opts?: {
    owner?: PubkyKey;
    alias?: string | null;
    restorable?: boolean;
  }): Promise<void> {
    const previousOwner = opts?.owner ?? session?.pubky ?? KeyStore.getPubky() ?? null;
    if (!previousOwner) {
      throw new Error('sign-out requires an owner');
    }
    const owner = previousOwner;
    const generation = ensureSignOutPaint();
    const restorable = opts?.restorable !== false;
    if (!restorable) {
      invalidateSignOutRestore();
    }
    stopLinkRetryDrain();
    const alias =
      session?.pubky === owner
        ? session.alias
        : typeof opts?.alias === 'string' && opts.alias.length > 0
          ? opts.alias
          : KeyStore.getPubky() === owner
            ? KeyStore.getLinkSession()
            : null;
    let markerPath = LINK_RECEIVER_PATH;
    try {
      const receiver = await StorageService.getLinkReceiver(owner);
      if (receiver) markerPath = coerceReceiverPath(receiver.receiverPath);
      const links = await StorageService.getAllLinks(owner);
      for (const link of links) {
        const live = liveHandles.get(linkKey(owner, link.peerPubky));
        if (live) await closeQuietly(live.linkId);
      }
    } catch (err) {
      if (restorable) restorePaintedOwner(owner, generation);
      throw err;
    }
    try {
      await commitSignOutWipe({ owner, alias, markerPath });
    } catch (err) {
      if (restorable) restorePaintedOwner(owner, generation);
      throw err;
    }
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
    const pendingWipe = pendingWipeInFlight();
    if (pendingWipe) await waitForWipeInFlight();
    const alias = sessionAlias.trim();
    const id = pubky.trim();
    if (alias.length === 0 || id.length === 0) {
      throw new Error('LinkService.adoptHarnessSession: sessionAlias and pubky are required');
    }
    await persistThenAdopt(alias);
    KeyStore.setPubky(id);
    session = { alias, pubky: id };
    paintOwner(id);
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

  /**
   * Confirmed takeover: PUT this device's current receiver pk (exactly one).
   */
  async takeoverReceiver(reason: 'takeover' | 'reenable' = 'takeover'): Promise<{
    pubky: string;
    receiverPath: string;
    noisePublicKey: string;
    receiverRole: ReceiverRole;
  }> {
    const lookup = await sessionOrRestore();
    if (!isActiveSession(lookup)) {
      throw new Error('LinkService.takeoverReceiver: no live session');
    }
    return publishTakeoverReceiver(lookup.alias, lookup.pubky, reason);
  },

  async syncOwnReceiverRole(): Promise<ReceiverRole | null> {
    const owner = KeyStore.getPubky();
    if (!owner) return null;
    return syncOwnReceiverRole(owner);
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
    const pendingWipe = pendingWipeInFlight();
    if (pendingWipe) await waitForWipeInFlight();
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
          const pendingWipeInner = pendingWipeInFlight();
          if (pendingWipeInner) await waitForWipeInFlight();
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
            await rejectIfOwnerMismatch(sessionAlias, pubky);
            const inspected = await requireRingGrantCoverage(sessionAlias);
            await persistThenAdopt(sessionAlias);
            KeyStore.setPubky(pubky);
            KeyStore.setHomeserver(inspected.origin);
            session = { alias: sessionAlias, pubky };
            paintOwner(pubky);
            try {
              return await provisionReceiver(sessionAlias, pubky);
            } catch (err) {
              if (isLinkNativeError(err) && err.code === 'auth') {
                await LinkService.signOutSessionQuiet(sessionAlias);
                KeyStore.deleteLinkSessionIfAlias(sessionAlias);
                throw new ScopesDeclinedError();
              }
              throw err;
            }
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
    const painted = activeOwnerAtCommit();
    if (painted === SIGNING_OUT) return 'error';
    if (painted === null) return 'needs-enable';
    const expectedOwner = painted;
    return withQueue(peerPubky, async () => {
      try {
        abortIfOwnerChanged(expectedOwner);
        const outcome = await ensureLinkLocked(peerPubky, 'user', false, expectedOwner);
        return outcome === 'idle' ||
          outcome === 'denied' ||
          outcome === 'deny-unavailable' ||
          outcome === 'standby-blocked'
          ? 'error'
          : outcome;
      } catch (err) {
        if (err instanceof LinkSendError && err.code === 'owner-changed') return 'error';
        if (isLinkNativeError(err) && err.code === 'unavailable') return 'native-missing';
        console.warn(
          `[LinkService] ensureLinkWith failed peer=${opaquePeerId(expectedOwner, peerPubky)}`,
        );
        return 'error';
      }
    });
  },

  /**
   * Read-only Encrypted Link state for display. Does not initiate or resume
   * a handshake. `ready` matches the send-path predicate: a live established
   * handle or a persisted snapshot, not a bare `established` row.
   */
  async getLinkStatus(peerPubky: PubkyKey): Promise<LinkStatus | null> {
    const owner = KeyStore.getPubky();
    if (!owner) return 'needs-enable';
    try {
      const record = await StorageService.getLink(owner, peerPubky);
      if (!record) return null;
      const live = liveHandles.get(linkKey(owner, peerPubky));
      if (isReadyLinkPredicate(record, live)) return 'ready';
      if (record.status === 'reconnect_required') return 'reconnect_required';
      if (record.status === 'established') return 'restoring';
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
      const ownerAtStart = requireOwner();
      await promoteUserOutboundRequest(peerPubky, 'before-link', ownerAtStart);
      abortIfOwnerChanged(ownerAtStart);
      const outcome = await ensureLinkLocked(peerPubky, 'user', false, ownerAtStart);
      abortIfOwnerChanged(ownerAtStart);
      assertLinkSendable(outcome, 'sendDm');
      if (
        outcome === 'ready' ||
        outcome === 'handshaking-initiator' ||
        outcome === 'handshaking-responder'
      ) {
        await promoteUserOutboundRequest(peerPubky, 'sendable', ownerAtStart);
      }
      abortIfOwnerChanged(ownerAtStart);

      const { envelope, json } = buildChatMessageEnvelope({
        eventId: uuidv4(),
        sentAt: Date.now(),
        body,
      });
      return dispatchPreparedDm({
        ownerPubky: ownerAtStart,
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

  async unsendDm(peerPubky: PubkyKey, eventId: string): Promise<void> {
    return withQueue(peerPubky, async () => {
      const owner = requireOwner();
      const target = await StorageService.getLinkMessageByEventId(owner, owner, eventId);
      if (!target || target.peerPubky !== peerPubky || target.deleted) {
        throw new Error('Message is no longer available to unsend');
      }
      if (isPaykitPaymentKind(target.kind)) {
        throw new Error('Payment messages cannot be unsent');
      }
      const attachment =
        target.kind === CHAT_ATTACHMENT_KIND
          ? await StorageService.getAttachment(owner, owner, eventId)
          : null;
      const attachmentCachePaths = attachment ? cachePathsForAttachment(attachment) : [];
      const attachmentBinding = bindingForStoredAttachment(peerPubky, owner, attachment);
      const attachmentKeyService =
        target.kind === CHAT_ATTACHMENT_KIND
          ? KeyStore.attachmentKeyService(owner, owner, eventId, attachmentBinding)
          : undefined;
      const built = buildChatDeleteEnvelope({
        eventId: uuidv4(),
        sentAt: Date.now(),
        targetEventId: eventId,
      });
      const queueItem = queueItemForPeer(
        owner,
        peerPubky,
        built.envelope.event_id,
        built.json,
        CHAT_DELETE_KIND,
      );
      const redacted = JSON.stringify({
        kind: target.kind === CHAT_ATTACHMENT_KIND ? CHAT_ATTACHMENT_KIND : CHAT_MESSAGE_KIND,
        event_id: target.eventId,
        sent_at: target.sentAt,
        deleted: true,
      });
      const tombstoned = await StorageService.tombstoneLinkMessage({
        ownerPubky: owner,
        peerPubky,
        senderPubky: owner,
        eventId,
        redactedRawJson: redacted,
        ...(attachmentKeyService ? { attachmentKeyService } : {}),
        ...(attachment ? { attachmentCachePaths } : {}),
        controlQueueItem: queueItem,
      });
      if (!tombstoned) {
        throw new Error('Message is no longer available to unsend');
      }
      let cleanupError: unknown = null;
      if (attachmentKeyService) {
        let deleted = false;
        try {
          deleted = await KeyStore.deleteAttachmentSecret(owner, owner, eventId, attachmentBinding);
        } catch {
          deleted = false;
        }
        if (deleted) {
          try {
            await StorageService.completePendingCleanup(owner, 'keystore', attachmentKeyService);
          } catch (err) {
            cleanupError ??= err;
          }
        } else {
          try {
            await StorageService.journalAttachmentKeyCleanup(owner, attachmentKeyService);
          } catch (err) {
            cleanupError ??= err;
          }
        }
      }
      if (attachment) {
        let cacheCleanupFailed = false;
        try {
          await deleteCacheFiles(attachmentCachePaths);
          for (const path of attachmentCachePaths) {
            try {
              await StorageService.completePendingCleanup(owner, 'cache', path);
            } catch (err) {
              cleanupError ??= err;
            }
          }
        } catch {
          cacheCleanupFailed = true;
        }
        if (cacheCleanupFailed || cleanupError) {
          try {
            await StorageService.journalAttachmentCacheCleanup(owner, attachmentCachePaths);
          } catch (err) {
            cleanupError ??= err;
          }
        }
      }
      await dispatchPersistedControlPam(owner, peerPubky, queueItem, CHAT_DELETE_KIND, built.json);
      if (cleanupError) throw cleanupError;
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
      const ownerAtStart = requireOwner();
      await promoteUserOutboundRequest(input.peerPubky, 'before-link', ownerAtStart);
      abortIfOwnerChanged(ownerAtStart);
      const outcome = await ensureLinkLocked(input.peerPubky, 'user', false, ownerAtStart);
      abortIfOwnerChanged(ownerAtStart);
      assertLinkSendable(outcome, 'sendPreparedMessage');
      if (
        outcome === 'ready' ||
        outcome === 'handshaking-initiator' ||
        outcome === 'handshaking-responder'
      ) {
        await promoteUserOutboundRequest(input.peerPubky, 'sendable', ownerAtStart);
      }
      abortIfOwnerChanged(ownerAtStart);
      return dispatchPreparedDm({
        ownerPubky: ownerAtStart,
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

  async sendTag(input: {
    peerPubky: PubkyKey;
    targetEventId: string;
    targetAuthorPubky: PubkyKey;
    label: string;
    op: 'add' | 'remove';
    channelId?: string;
  }): Promise<void> {
    const owner = requireOwner();
    const built = buildOutboundTag({
      targetEventId: input.targetEventId,
      targetAuthorPubky: input.targetAuthorPubky,
      label: input.label,
      op: input.op,
      ...(input.channelId ? { channelId: input.channelId } : {}),
    });
    await applyLocalTag(owner, owner, built.envelope, input.peerPubky);
    if (input.channelId) {
      const members = await StorageService.listGroupMembers(owner, input.channelId);
      const recipients = members
        .filter(m => m.status === 'active' && m.memberPubky !== owner)
        .map(m => m.memberPubky);
      for (const peer of recipients) {
        const item = queueItemForPeer(
          owner,
          peer,
          built.eventId,
          built.json,
          CHAT_TAG_KIND,
          input.channelId,
        );
        await StorageService.persistControlSendIntent({ ownerPubky: owner, queueItem: item });
        await LinkService.sendPersistedLinkJson({
          ownerPubky: owner,
          senderPubky: owner,
          peerPubky: peer,
          queueId: item.id,
          kind: CHAT_TAG_KIND,
          eventId: built.eventId,
          rawJson: built.json,
          channelId: input.channelId,
        });
      }
      return;
    }
    await dispatchControlPam(owner, input.peerPubky, built.eventId, built.json, CHAT_TAG_KIND);
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
    ownerPubky: PubkyKey;
    senderPubky: PubkyKey;
    peerPubky: PubkyKey;
    kind: string;
    eventId: string;
    queueId: string;
    rawJson: string;
  }): Promise<'sent' | 'queued'> {
    let outcome: EnsureOutcome;
    abortIfOwnerChanged(input.ownerPubky);
    try {
      await promoteUserOutboundRequest(input.peerPubky, 'before-link', input.ownerPubky);
      abortIfOwnerChanged(input.ownerPubky);
      outcome = await ensureLinkLocked(input.peerPubky, 'user', false, input.ownerPubky);
      abortIfOwnerChanged(input.ownerPubky);
    } catch (err) {
      if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
      return 'queued';
    }
    if (
      outcome !== 'ready' &&
      outcome !== 'handshaking-initiator' &&
      outcome !== 'handshaking-responder'
    ) {
      return 'queued';
    }
    await promoteUserOutboundRequest(input.peerPubky, 'sendable', input.ownerPubky);
    abortIfOwnerChanged(input.ownerPubky);
    if (outcome !== 'ready') return 'queued';
    try {
      abortIfOwnerChanged(input.ownerPubky);
      const wireJson = await wireJsonForNativeSend(
        input.kind,
        input.rawJson,
        input.ownerPubky,
        input.senderPubky,
        input.eventId,
        input.peerPubky,
      );
      abortIfOwnerChanged(input.ownerPubky);
      const { snapshot } = await sendOpaqueOnLink(input.ownerPubky, input.peerPubky, wireJson);
      abortIfOwnerChanged(input.ownerPubky);
      await StorageService.finalizeLinkSend({
        ownerPubky: input.ownerPubky,
        peerPubky: input.peerPubky,
        senderPubky: input.senderPubky,
        kind: input.kind,
        eventId: input.eventId,
        snapshot,
        queueId: input.queueId,
      });
      abortIfOwnerChanged(input.ownerPubky);
      return 'sent';
    } catch (err) {
      if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
      console.warn(
        `[LinkService] persisted-send-failed peer=${opaquePeerId(input.ownerPubky, input.peerPubky)}:`,
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
    ownerPubky: PubkyKey;
    senderPubky: PubkyKey;
    peerPubky: PubkyKey;
    queueId: string;
    kind: string;
    eventId: string;
    rawJson: string;
    channelId: string;
  }): Promise<'sent' | 'queued'> {
    return withQueue(input.peerPubky, async () => {
      let outcome: EnsureOutcome;
      abortIfOwnerChanged(input.ownerPubky);
      try {
        outcome = await ensureLinkLocked(input.peerPubky, 'user', false, input.ownerPubky);
        abortIfOwnerChanged(input.ownerPubky);
      } catch (err) {
        if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
        if (isTransientLinkError(err)) return 'queued';
        return 'queued';
      }
      if (outcome !== 'ready') return 'queued';
      try {
        abortIfOwnerChanged(input.ownerPubky);
        const wireJson = await wireJsonForNativeSend(
          input.kind,
          input.rawJson,
          input.ownerPubky,
          input.senderPubky,
          input.eventId,
          input.peerPubky,
        );
        abortIfOwnerChanged(input.ownerPubky);
        const { snapshot } = await sendOpaqueOnLink(input.ownerPubky, input.peerPubky, wireJson);
        abortIfOwnerChanged(input.ownerPubky);
        await StorageService.finalizeGroupFanoutSend({
          ownerPubky: input.ownerPubky,
          peerPubky: input.peerPubky,
          snapshot,
          queueId: input.queueId,
          channelId: input.channelId,
          eventId: input.eventId,
          senderPubky: input.senderPubky,
          kind: input.kind,
        });
        abortIfOwnerChanged(input.ownerPubky);
        return 'sent';
      } catch (err) {
        if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
        console.warn(
          `[LinkService] group-fanout-send-failed peer=${opaquePeerId(input.ownerPubky, input.peerPubky)}:`,
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
   * User-gesture recovery for a blocked established re-key: clears the
   * handshake budget, attempts ensure, then flushes queued sends.
   */
  async retryPeerSends(peerPubky: PubkyKey): Promise<LinkStatus> {
    const status = await LinkService.ensureLinkWith(peerPubky);
    await LinkService.recoverPendingSends();
    await LinkService.drainRetries();
    return status;
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
    const next = previous.then(drainAllRetries, drainAllRetries);
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
    const painted = activeOwnerAtCommit();
    if (painted === SIGNING_OUT || painted === null) return;
    const expectedOwner = painted;
    const lookup = await sessionOrRestore();
    abortIfOwnerChanged(expectedOwner);
    if (!isActiveSession(lookup)) return;
    if (lookup.pubky !== expectedOwner) return;
    const links = await StorageService.getDueHandshakingLinks(
      expectedOwner,
      HANDSHAKE_ADVANCE_BATCH_LIMIT,
    );
    abortIfOwnerChanged(expectedOwner);
    for (const link of links) {
      try {
        abortIfOwnerChanged(expectedOwner);
        await withQueue(link.peerPubky, () =>
          ensureLinkLocked(link.peerPubky, 'background', false, expectedOwner),
        );
      } catch (err) {
        if (err instanceof LinkSendError && err.code === 'owner-changed') return;
        console.warn(
          `[LinkService] handshake-advance-failed peer=${opaquePeerId(link.ownerPubky, link.peerPubky)}:`,
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
    const ownerAtStart = requireOwner();
    if (!ownMarkerSyncIsFresh(ownerAtStart)) {
      const ownRole = await raceWithin(
        syncOwnReceiverRole(ownerAtStart),
        LINK_INBOX_PEER_TIMEOUT_MS,
      );
      if (ownRole.status === 'ok') {
        markOwnMarkerSynced(ownerAtStart);
      }
    }
    const candidates = peers !== undefined ? peers : await collectInboxCandidates(ownerAtStart);
    const received: LinkMessage[] = [];
    for (const peerPubky of new Set(candidates)) {
      if (!isCurrentOwner(ownerAtStart)) break;
      const peerWork = withQueue(peerPubky, () => syncPeerLocked(peerPubky, ownerAtStart));
      const raced = await raceWithin(peerWork, LINK_INBOX_PEER_TIMEOUT_MS);
      if (raced.status === 'timeout') {
        resetPeerQueue(ownerAtStart, peerPubky);
        console.warn(
          `[LinkService] inbox-sync-timeout peer=${opaquePeerId(ownerAtStart, peerPubky)} after ${LINK_INBOX_PEER_TIMEOUT_MS}ms; continuing`,
        );
        continue;
      }
      if (raced.status === 'error') {
        console.warn(
          `[LinkService] inbox-sync-failed peer=${opaquePeerId(ownerAtStart, peerPubky)}:`,
          errorMessage(raced.error),
        );
        continue;
      }
      received.push(...raced.value);
    }
    try {
      await settleWithin(
        LinkService.drainRetries().catch(err => {
          console.warn('[LinkService] drainRetries after syncInbox failed:', errorMessage(err));
        }),
        LINK_INBOX_PEER_TIMEOUT_MS,
        'Inbox drain',
      );
    } catch (err) {
      console.warn('[LinkService] drainRetries after syncInbox failed:', errorMessage(err));
    }
    notifyInboxSynced(ownerAtStart);
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
    const prev = await StorageService.getLinkReadCursor(owner, conversationId);
    await StorageService.setLinkReadCursor(owner, conversationId, readAt);
    const parsed = parseDmConversationId(conversationId);
    if (!parsed) return;
    const msgs =
      (await StorageService.getLinkMessagesForConversation?.(owner, conversationId, 200)) ?? [];
    const ids = msgs
      .filter(
        row =>
          row.senderPubky !== owner && row.sentAt <= readAt && (prev == null || row.sentAt > prev),
      )
      .map(row => row.eventId);
    await emitReceiptIfEnabled(owner, parsed.counterpartyPubky, 'read', ids);
  },

  async markGroupRead(channelId: string, readAt: number = Date.now()): Promise<void> {
    const owner = KeyStore.getPubky();
    if (!owner) return;
    const prev = await StorageService.getLinkReadCursor(owner, groupReadCursorId(channelId));
    const msgs = await StorageService.listGroupMessages(owner, channelId, 200);
    const byAuthor = new Map<string, string[]>();
    for (const row of msgs) {
      if (row.senderPubky === owner) continue;
      if (row.kind !== GROUP_MESSAGE_KIND) continue;
      if (row.sentAt > readAt) continue;
      if (prev != null && row.sentAt <= prev) continue;
      const list = byAuthor.get(row.senderPubky) ?? [];
      list.push(row.eventId);
      byAuthor.set(row.senderPubky, list);
    }
    for (const [author, ids] of byAuthor) {
      await emitReceiptIfEnabled(owner, author, 'read', ids, channelId);
    }
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
   * Decline is sticky in {@link StorageService.upsertMessageRequest}. This
   * method still refuses a declined row — reversing a decline is
   * {@link LinkService.acceptDeclinedRequest} or a user-initiated send.
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
      return syncPeerLocked(peerPubky, ownerPubky);
    });
  },

  /**
   * User-initiated release of a declined-not-blocked request: declined →
   * accepted. Not reachable from inbound sync. Sticky upsert cannot do this.
   */
  async acceptDeclinedRequest(peerPubky: PubkyKey): Promise<LinkMessage[]> {
    return withQueue(peerPubky, async () => {
      const ownerPubky = requireOwner();
      const deny = await FollowsImportSettings.resolveDenyState(ownerPubky, peerPubky);
      if (deny === 'unavailable') {
        throw new LinkSendError('deny-unavailable', CONTACTS_COPY.couldNotSendMessage);
      }
      if (deny === 'denied') {
        throw new LinkSendError('denied', CONTACTS_COPY.deniedSendMessage);
      }
      const changed = await StorageService.acceptDeclinedMessageRequest(ownerPubky, peerPubky);
      if (!changed) {
        const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
        if (existing?.status !== 'accepted') {
          throw new Error('Cannot accept this request.');
        }
      }
      return syncPeerLocked(peerPubky, ownerPubky);
    });
  },

  /**
   * Declines a message request: retire the local link state, drop
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
      if (stored) {
        await failQueuedSendsForPeer(ownerPubky, peerPubky);
        await retireLocalLinkState(stored, ownerPubky);
      }
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

  /**
   * Unblock transition for a previously declined peer: delete the declined
   * `message_requests` row. Decline is sticky in upsert, so this is the
   * only way back to "no request" without inventing a status. No-op when
   * there is no declined row (including when messaging is not enabled).
   */
  async releaseDeclinedRequest(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
    if (!ownerPubky || !peerPubky) return;
    return withQueue(peerPubky, async () => {
      const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
      if (existing?.status !== 'declined') return;
      await StorageService.deleteMessageRequest(ownerPubky, peerPubky);
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

/**
 * Races `work` against `budgetMs`. Does not cancel `work` — a timeout only
 * stops waiting. Used so one hung homeserver GET cannot stall inbox sync.
 */
async function raceWithin<T>(
  work: Promise<T>,
  budgetMs: number,
): Promise<
  { status: 'ok'; value: T } | { status: 'timeout' } | { status: 'error'; error: unknown }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), budgetMs);
  });
  const settled = work.then(
    value => ({ status: 'ok' as const, value }),
    error => ({ status: 'error' as const, error }),
  );
  try {
    const outcome = await Promise.race([
      settled,
      expiry.then(() => ({ status: 'timeout' as const })),
    ]);
    return outcome;
  } finally {
    clearTimeout(timer);
  }
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
  restoreInFlight = null;
  liveHandles.clear();
  queues.clear();
  heldPeerQueues.clear();
  resetChatKindsUpgradeReplayedForTests();
  peerQueueGenerations.clear();
  handshakeWatch.clear();
  peerMarkerRefreshedAt.clear();
  pendingEstablishedRekeys.clear();
  establishedRekeyParkWindows.clear();
  inboxOwnMarkerSyncedFor = null;
  inboxOwnMarkerSyncedAt = 0;
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
  await resetSdkLinksEpochIfNeeded(KeyStore.getPubky());
  const stored = KeyStore.getLinkSession();
  if (!stored) return null;
  try {
    const { pubky } = await PaykitLinkNative.restoreSession(stored);
    session = { alias: stored, pubky };
    return session;
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'auth') {
      KeyStore.deleteLinkSessionIfAlias(stored);
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

const SDK_LINKS_EPOCH = '1';

async function resetSdkLinksEpochIfNeeded(owner: string | null): Promise<void> {
  const readEpoch = KeyStore.getSdkLinksEpoch;
  if (typeof readEpoch !== 'function') return;
  let epoch: string | null;
  try {
    epoch = readEpoch();
  } catch (err) {
    if (typeof KeyStore.isKeyStoreNotReady === 'function' && KeyStore.isKeyStoreNotReady(err)) {
      return;
    }
    throw err;
  }
  if (epoch === SDK_LINKS_EPOCH) return;
  if (owner) {
    await StorageService.clearAccountData(owner);
    if (PaykitSdkNative.isAvailable()) {
      await PaykitSdkNative.deleteOwnerState(owner);
    }
  } else {
    await StorageService.wipeUnsignedSdkResidue();
  }
  KeyStore.setSdkLinksEpoch?.(SDK_LINKS_EPOCH);
}

function isActiveSession(lookup: SessionLookup): lookup is ActiveSession {
  return lookup !== null && !('status' in lookup);
}

/**
 * Previous-owner teardown for adopt: unpublish that owner's receiver marker
 * and close its live handles, then sign the old alias out. Does not wipe the
 * incoming owner's KeyStore identity, native secrets, or SQL rows.
 */
async function teardownPreviousAdoptedOwner(
  previousAlias: string,
  previousPubky: string | null,
): Promise<void> {
  let markerPath = LINK_RECEIVER_PATH;
  if (previousPubky) {
    try {
      const receiver = await StorageService.getLinkReceiver(previousPubky);
      if (receiver) markerPath = coerceReceiverPath(receiver.receiverPath);
      const links = await StorageService.getAllLinks(previousPubky);
      for (const link of links) {
        const live = liveHandles.get(linkKey(previousPubky, link.peerPubky));
        if (live) await closeQuietly(live.linkId);
      }
    } catch {
      // Listing previous links is best-effort; prefix sweep still runs.
    }
    const ownerPrefix = `${previousPubky}:`;
    for (const key of [...liveHandles.keys()]) {
      if (!key.startsWith(ownerPrefix)) continue;
      const live = liveHandles.get(key);
      if (live) await closeQuietly(live.linkId);
      liveHandles.delete(key);
    }
    for (const key of [...queues.keys()]) {
      if (key.startsWith(ownerPrefix)) queues.delete(key);
    }
    for (const key of [...peerQueueGenerations.keys()]) {
      if (key.startsWith(ownerPrefix)) peerQueueGenerations.delete(key);
    }
    try {
      let localPk: string | null = null;
      try {
        const receiver = await StorageService.getLinkReceiver(previousPubky);
        if (receiver) localPk = await PaykitLinkNative.getReceiverPublicKey(receiver.receiverAlias);
      } catch {
        localPk = null;
      }
      if (localPk) {
        const marker = await PaykitLinkNative.getReceiverMarker(previousPubky, markerPath);
        if (marker && marker.noisePublicKey === localPk) {
          await PaykitLinkNative.removeReceiverMarker(previousAlias, markerPath);
        }
      }
    } catch {
      // GET failure or foreign pk: leave the published marker.
    }
  }
  await LinkService.signOutSessionQuiet(previousAlias);
  KeyStore.deleteLinkSessionIfAlias(previousAlias);
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
): Promise<{
  pubky: string;
  receiverPath: string;
  noisePublicKey: string;
  receiverRole: ReceiverRole;
}> {
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

  let published: Awaited<ReturnType<typeof inspectOwnPublishedMarker>>;
  try {
    published = await inspectOwnPublishedMarker(pubky, receiverPath);
  } catch (error) {
    throw error;
  }

  if (published.kind === 'present' && published.noisePublicKey !== noisePublicKey) {
    await persistReceiverRow(
      pubky,
      receiverAlias,
      receiverPath,
      true,
      'standby',
      published.noisePublicKey,
    );
    setReceiverRoleState('standby', null);
    return { pubky, receiverPath, noisePublicKey, receiverRole: 'standby' };
  }

  if (published.kind === 'present' && published.noisePublicKey === noisePublicKey) {
    await enqueueChatKindsAdvertisement(sessionAlias, pubky, noisePublicKey);
    await persistReceiverRow(
      pubky,
      receiverAlias,
      receiverPath,
      true,
      'active',
      published.noisePublicKey,
    );
    setReceiverRoleState('active', null);
    scheduleChatKindsAdvertisement(pubky, sessionAlias);
    return { pubky, receiverPath, noisePublicKey, receiverRole: 'active' };
  }

  try {
    await PaykitLinkNative.publishReceiverMarker(sessionAlias, receiverAlias, receiverPath);
  } catch (error) {
    await persistReceiverRow(pubky, receiverAlias, receiverPath, false, 'active', null);
    throw error;
  }
  await persistReceiverRow(pubky, receiverAlias, receiverPath, true, 'active', noisePublicKey);
  await enqueueChatKindsAdvertisement(sessionAlias, pubky, noisePublicKey);
  setReceiverRoleState('active', null);
  scheduleChatKindsAdvertisement(pubky, sessionAlias);
  return { pubky, receiverPath, noisePublicKey, receiverRole: 'active' };
}

async function rememberFetchedPeerMarker(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
): Promise<void> {
  await persistPeerChatKindsVFromMarker(
    ownerPubky,
    peerPubky,
    marker,
    replayReadReceiptsAfterV1Upgrade,
  );
}

async function fetchPeerReceiverMarker(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  receiverPath: string,
): Promise<ReceiverMarker | null> {
  const marker = await PaykitLinkNative.getReceiverMarker(peerPubky, receiverPath);
  if (!marker) return null;
  await rememberFetchedPeerMarker(ownerPubky, peerPubky, marker);
  return marker;
}

async function replayReadReceiptsAfterV1Upgrade(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
): Promise<void> {
  const conversationId = buildDmConversationId(peerPubky);
  const cursor = await StorageService.getLinkReadCursor(ownerPubky, conversationId);
  if (cursor == null || cursor <= 0) return;
  const msgs =
    (await StorageService.getLinkMessagesForConversation?.(ownerPubky, conversationId, 200)) ?? [];
  const ids = msgs
    .filter(row => row.senderPubky !== ownerPubky && row.sentAt <= cursor)
    .map(row => row.eventId);
  await emitReceiptIfEnabled(ownerPubky, peerPubky, 'read', ids, undefined, true);
}

async function inspectOwnPublishedMarker(
  ownerPubky: PubkyKey,
  receiverPath: string,
): Promise<{ kind: 'absent' } | { kind: 'present'; noisePublicKey: string }> {
  const marker = await PaykitLinkNative.getReceiverMarker(ownerPubky, receiverPath);
  if (
    marker === null ||
    typeof marker.noisePublicKey !== 'string' ||
    marker.noisePublicKey === ''
  ) {
    return { kind: 'absent' };
  }
  return { kind: 'present', noisePublicKey: marker.noisePublicKey };
}

async function persistReceiverRow(
  ownerPubky: PubkyKey,
  receiverAlias: string,
  receiverPath: string,
  markerPublished: boolean,
  receiverRole: ReceiverRole,
  lastSeenOwnMarkerPk: string | null,
): Promise<void> {
  await StorageService.upsertLinkReceiver({
    ownerPubky,
    receiverAlias,
    receiverPath,
    markerPublished,
    receiverRole,
    lastSeenOwnMarkerPk,
  });
}

async function publishTakeoverReceiver(
  sessionAlias: string,
  pubky: PubkyKey,
  reason: 'takeover' | 'reenable' = 'takeover',
): Promise<{
  pubky: string;
  receiverPath: string;
  noisePublicKey: string;
  receiverRole: ReceiverRole;
}> {
  const receiverPath = assertValidReceiverPath(LINK_RECEIVER_PATH);
  const existing = await StorageService.getLinkReceiver(pubky);
  if (!existing) {
    throw new Error('takeoverReceiver: this device has no receiver secret');
  }
  const noisePublicKey = await PaykitLinkNative.getReceiverPublicKey(existing.receiverAlias);
  await PaykitLinkNative.publishReceiverMarker(sessionAlias, existing.receiverAlias, receiverPath);
  await persistReceiverRow(
    pubky,
    existing.receiverAlias,
    receiverPath,
    true,
    'active',
    noisePublicKey,
  );
  setReceiverRoleState('active', reason === 'reenable' ? COPY.reenableToast : COPY.takeoverToast);
  await enqueueChatKindsAdvertisement(sessionAlias, pubky, noisePublicKey);
  scheduleChatKindsAdvertisement(pubky, sessionAlias);
  await restartUnestablishedLinksAfterTakeover(pubky);
  return { pubky, receiverPath, noisePublicKey, receiverRole: 'active' };
}

function scheduleChatKindsAdvertisement(ownerPubky: PubkyKey, sessionAlias: string): void {
  void drainChatKindsAdvertiseRetry(ownerPubky, sessionAlias).catch(() => undefined);
}

/**
 * After this device publishes its receiver pk, any handshake started while
 * standby was answered against the previously published (often dead) key.
 * Wipe those unestablished rows and their outbox slots, then re-initiate.
 * Takeover is explicit user intent: clear any exhausted budget first so a
 * long-standby peer is recovered rather than abandoned (queued sends stay
 * queued). The follow-up uses `user` intent so re-initiate does not charge.
 */
async function restartUnestablishedLinksAfterTakeover(ownerPubky: PubkyKey): Promise<void> {
  const links = await StorageService.getAllLinks(ownerPubky);
  abortIfOwnerChanged(ownerPubky);
  for (const link of links) {
    if (link.status === 'established' || link.status === 'reconnect_required') continue;
    try {
      await withQueue(link.peerPubky, async () => {
        abortIfOwnerChanged(ownerPubky);
        const latest = await StorageService.getLink(ownerPubky, link.peerPubky);
        abortIfOwnerChanged(ownerPubky);
        if (!latest || latest.status === 'established' || latest.status === 'reconnect_required') {
          return;
        }
        await StorageService.clearHandshakeBudget(ownerPubky, link.peerPubky);
        abortIfOwnerChanged(ownerPubky);
        await retireLocalLinkState(latest, ownerPubky);
        await ensureLinkLocked(link.peerPubky, 'user', true, ownerPubky);
      });
    } catch (err) {
      if (err instanceof LinkSendError && err.code === 'owner-changed') return;
      console.warn(
        `[LinkService] takeover-restart-failed peer=${opaquePeerId(ownerPubky, link.peerPubky)}:`,
        errorMessage(err),
      );
    }
  }
}

async function syncOwnReceiverRole(ownerPubky: PubkyKey): Promise<ReceiverRole | null> {
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  if (!receiver) return null;
  let localPk: string;
  try {
    localPk = await PaykitLinkNative.getReceiverPublicKey(receiver.receiverAlias);
  } catch {
    return receiver.receiverRole;
  }
  let published: Awaited<ReturnType<typeof inspectOwnPublishedMarker>>;
  try {
    published = await inspectOwnPublishedMarker(
      ownerPubky,
      coerceReceiverPath(receiver.receiverPath),
    );
  } catch {
    return receiver.receiverRole;
  }
  if (!isCurrentOwner(ownerPubky)) return receiver.receiverRole;
  if (published.kind === 'absent') {
    if (receiver.receiverRole === 'active') {
      setReceiverRoleState('active', null, { needsReenable: true });
    }
    return receiver.receiverRole;
  }
  const role: ReceiverRole = published.noisePublicKey === localPk ? 'active' : 'standby';
  await persistReceiverRow(
    ownerPubky,
    receiver.receiverAlias,
    receiver.receiverPath,
    true,
    role,
    published.noisePublicKey,
  );
  if (!isCurrentOwner(ownerPubky)) return receiver.receiverRole;
  setReceiverRoleState(role, null);
  return role;
}

async function mintReceiver(
  pubky: PubkyKey,
  receiverPath: string,
): Promise<{ receiverAlias: string; noisePublicKey: string }> {
  const generated = await PaykitLinkNative.generateReceiverKey();
  await persistReceiverRow(pubky, generated.receiverAlias, receiverPath, false, 'active', null);
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
 * Owner-scoped deny for Encrypted Link establishment. Every inbound and
 * outbound path that creates or advances a link goes through
 * {@link ensureLinkLocked}; this is the single choke so a leftover
 * `handshaking` row after a failed block cannot be stepped by the ticker
 * or used to deliver a queued payload.
 *
 * Decline is not a deny. A `declined` message request is inbound-queue
 * memory only ({@link syncPeerLocked}) until a user-initiated send or
 * {@link LinkService.acceptDeclinedRequest} promotes it to `accepted`.
 */
async function promoteUserOutboundRequest(
  peerPubky: PubkyKey,
  phase: 'before-link' | 'sendable',
  ownerAtStart: PubkyKey,
): Promise<void> {
  abortIfOwnerChanged(ownerAtStart);
  const deny = await FollowsImportSettings.resolveDenyState(ownerAtStart, peerPubky);
  abortIfOwnerChanged(ownerAtStart);
  if (deny !== 'clear') return;
  const existing = await StorageService.getMessageRequest(ownerAtStart, peerPubky);
  abortIfOwnerChanged(ownerAtStart);
  if (phase === 'before-link') {
    if (existing?.status === 'declined') {
      await StorageService.acceptDeclinedMessageRequest(ownerAtStart, peerPubky);
      abortIfOwnerChanged(ownerAtStart);
    }
    return;
  }
  if (existing?.status === 'pending') {
    await StorageService.upsertMessageRequest({
      ...existing,
      status: 'accepted',
      updatedAt: Date.now(),
    });
    abortIfOwnerChanged(ownerAtStart);
  }
}

function assertLinkSendable(
  outcome: EnsureOutcome,
  operation: 'sendDm' | 'sendPreparedMessage',
): void {
  if (
    outcome === 'ready' ||
    outcome === 'handshaking-initiator' ||
    outcome === 'handshaking-responder' ||
    outcome === 'error'
  ) {
    return;
  }
  if (outcome === 'denied') {
    throw new LinkSendError('denied', CONTACTS_COPY.deniedSendMessage);
  }
  if (outcome === 'deny-unavailable') {
    throw new LinkSendError('deny-unavailable', CONTACTS_COPY.couldNotSendMessage);
  }
  if (outcome === 'standby-blocked') {
    throw new LinkSendError('standby-not-receiving', COPY.standbyComposerNotice);
  }
  throw new LinkSendError(
    'not-sendable',
    `LinkService.${operation}: cannot send — link status is '${outcome}'`,
  );
}

/**
 * Handshake abuse budget recovery policy, in one place so it cannot drift:
 *
 * A `user` intent clears the budget before any handshake work is dispatched, so
 * a peer is never permanently denied — one deliberate send, "tap to retry",
 * or failed-bubble retry restores a full allowance, whether or not a handshake
 * handle is already live. Thread focus / inbox poll stays `background` and
 * does not clear the budget.
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
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome> {
  if (!PaykitLinkNative.isAvailable()) return 'native-missing';

  const lookup = await sessionOrRestore();
  abortIfOwnerChanged(expectedOwner);
  if (lookup && 'status' in lookup && lookup.status === 'offline') return 'session-offline';
  if (!isActiveSession(lookup)) return 'needs-enable';
  const activeSession = lookup;
  const ownerPubky = activeSession.pubky;
  if (ownerPubky !== expectedOwner) {
    throw new LinkSendError('owner-changed', 'LinkService: owner changed during send');
  }
  const queueGenAtStart = currentQueueGeneration(ownerPubky, peerPubky);
  const queueReset = (): boolean => queueGenerationChanged(ownerPubky, peerPubky, queueGenAtStart);
  const deny = await FollowsImportSettings.resolveDenyState(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);
  if (deny === 'denied') return 'denied';
  if (deny === 'unavailable') return 'deny-unavailable';
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  abortIfOwnerChanged(expectedOwner);
  if (!receiver) return 'needs-enable';
  if (!receiver.markerPublished && receiver.receiverRole !== 'standby') return 'needs-enable';
  const localPath = assertValidReceiverPath(coerceReceiverPath(receiver.receiverPath));
  if (receiver.receiverRole === 'standby') {
    const standbyRow = await StorageService.getLink(ownerPubky, peerPubky);
    abortIfOwnerChanged(expectedOwner);
    if (standbyRow?.status !== 'established') return 'standby-blocked';
  }

  void alreadyRecovered;
  if (!PaykitSdkNative.isAvailable()) return 'native-missing';

  const key = linkKey(ownerPubky, peerPubky);
  await PaykitSdkNative.bindOwner({
    ownerPubky,
    sessionAlias: activeSession.alias,
    receiverAlias: receiver.receiverAlias,
    receiverPath: localPath,
  });
  abortIfOwnerChanged(expectedOwner);
  await syncOwnReceiverRole(ownerPubky);
  abortIfOwnerChanged(expectedOwner);
  try {
    await fetchPeerReceiverMarker(ownerPubky, peerPubky, localPath);
  } catch (err) {
    if (err instanceof LinkSendError) throw err;
    if (isLinkNativeError(err) && err.code === 'unavailable') return 'native-missing';
  }
  abortIfOwnerChanged(expectedOwner);

  let stored = await StorageService.getLink(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);

  try {
    const observation = await PaykitSdkNative.observeEncryptedLinkRecoveryMarker(
      ownerPubky,
      peerPubky,
      localPath,
    );
    abortIfOwnerChanged(expectedOwner);
    if (observation.state === 'RECOVERY_REQUIRED' || observation.state === 'UNKNOWN') {
      if (queueReset()) return intent === 'background' ? 'idle' : 'handshaking-responder';
      return rememberSdkRecovery(ownerPubky, peerPubky, localPath, stored, expectedOwner);
    }
  } catch (err) {
    if (isSdkOperationError(err) && err.code === 'recovery_required') {
      return rememberSdkRecovery(ownerPubky, peerPubky, localPath, stored, expectedOwner);
    }
    if (!(isSdkOperationError(err) && (err.code === 'network' || err.code === 'protocol'))) {
      throw err;
    }
  }

  let report: SdkEnsureResult | null = null;
  for (let step = 0; step < HANDSHAKE_PENDING_ADVANCE_LIMIT; step += 1) {
    abortIfOwnerChanged(expectedOwner);
    try {
      report = await PaykitSdkNative.ensureLinkWithPeer(ownerPubky, peerPubky, localPath);
    } catch (err) {
      if (isSdkOperationError(err) && err.code === 'recovery_required') {
        if (queueReset()) return intent === 'background' ? 'idle' : 'handshaking-responder';
        return rememberSdkRecovery(ownerPubky, peerPubky, localPath, stored, expectedOwner);
      }
      if (isSdkOperationError(err) && err.code === 'network') return 'idle';
      if (isSdkOperationError(err) && err.code === 'unavailable') return 'native-missing';
      if (isSdkOperationError(err) && err.code === 'auth') return 'needs-enable';
      if (isSdkOperationError(err) && err.code === 'protocol') return 'error';
      throw err;
    }
    abortIfOwnerChanged(expectedOwner);
    if (report.leaseSkipped) {
      const live = liveHandles.get(key);
      if (live?.status === 'established') return 'ready';
      return intent === 'background' ? 'idle' : 'handshaking-responder';
    }
    const state = report.state ?? 'UNKNOWN';
    if (
      state === 'LINKED' ||
      state === 'BLOCKED' ||
      state === 'RECOVERY_REQUIRED' ||
      state === 'UNKNOWN'
    ) {
      break;
    }
  }

  if (!report || report.leaseSkipped) {
    return intent === 'background' ? 'idle' : 'handshaking-responder';
  }
  if (queueReset()) return intent === 'background' ? 'idle' : 'handshaking-responder';
  const denyAfter = await FollowsImportSettings.resolveDenyState(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);
  if (queueReset()) return intent === 'background' ? 'idle' : 'handshaking-responder';
  if (denyAfter === 'denied') return 'denied';
  if (denyAfter === 'unavailable') return 'deny-unavailable';
  const state = report.state ?? 'UNKNOWN';
  if (state === 'RECOVERY_REQUIRED' || state === 'UNKNOWN') {
    return rememberSdkRecovery(ownerPubky, peerPubky, localPath, stored, expectedOwner);
  }
  if (state === 'BLOCKED') return 'error';

  const role = sdkHandshakeRole(report.role, stored);
  const generation = report.generation ?? '0';
  const snapshot = `sdk:${generation}`;
  if (state === 'LINKED') {
    liveHandles.set(key, { status: 'established', linkId: snapshot });
    await StorageService.upsertLink({
      ownerPubky,
      peerPubky,
      role,
      status: 'established',
      snapshot,
      remoteNoisePublicKey: stored?.remoteNoisePublicKey ?? '',
      localReceiverPath: localPath,
      remoteReceiverPath: localPath,
      consecutiveFailures: 0,
      ...(stored?.chatKindsV !== undefined ? { chatKindsV: stored.chatKindsV } : {}),
    });
    abortIfOwnerChanged(expectedOwner);
    return 'ready';
  }

  liveHandles.set(key, { status: 'handshaking', linkId: snapshot, role });
  await StorageService.upsertLink({
    ownerPubky,
    peerPubky,
    role,
    status: 'handshaking',
    snapshot,
    remoteNoisePublicKey: stored?.remoteNoisePublicKey ?? '',
    localReceiverPath: localPath,
    remoteReceiverPath: localPath,
    consecutiveFailures: stored?.consecutiveFailures ?? 0,
    ...(stored?.chatKindsV !== undefined ? { chatKindsV: stored.chatKindsV } : {}),
  });
  abortIfOwnerChanged(expectedOwner);
  if (intent === 'background') return 'idle';
  return role === 'initiator' ? 'handshaking-initiator' : 'handshaking-responder';
}

function sdkHandshakeRole(role: SdkLinkRole | undefined, stored: LinkRecord | null): LinkRole {
  if (role === 'INITIATOR') return 'initiator';
  if (role === 'RESPONDER') return 'responder';
  return stored?.role ?? 'responder';
}

async function rememberSdkRecovery(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  localPath: string,
  stored: LinkRecord | null,
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome> {
  abortIfOwnerChanged(expectedOwner);
  const row =
    stored ??
    ({
      ownerPubky,
      peerPubky,
      role: 'responder' as const,
      status: 'handshaking' as const,
      snapshot: 'sdk:0',
      remoteNoisePublicKey: '',
      localReceiverPath: localPath,
      remoteReceiverPath: localPath,
      consecutiveFailures: 0,
    } satisfies LinkRecordInput);
  if (!stored) {
    await StorageService.upsertLink(row);
    abortIfOwnerChanged(expectedOwner);
  }
  const current = stored ?? (await StorageService.getLink(ownerPubky, peerPubky));
  if (current) await markReconnectRequired(current, expectedOwner, 'application');
  return 'reconnect_required';
}

async function sendOpaqueOnLink(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  rawJson: string,
): Promise<{ snapshot: string }> {
  const path = LINK_RECEIVER_PATH;
  let queueId: string | null = null;
  try {
    const enqueued = await PaykitSdkNative.enqueueOpaquePrivateApplicationMessageJson(
      ownerPubky,
      peerPubky,
      path,
      rawJson,
    );
    queueId = enqueued.queueId;
  } catch (err) {
    if (!(isSdkOperationError(err) && err.code === 'protocol')) throw err;
  }
  const processed = await PaykitSdkNative.processOutboundPrivateMessages(
    ownerPubky,
    peerPubky,
    path,
  );
  const failed = queueId
    ? processed.failed.find(item => item.queueId === queueId)
    : processed.failed[0];
  if (failed) {
    if (failed.category === 'recovery_required' || failed.category === 'RecoveryRequired') {
      throw new SdkOperationError('recovery_required', 'recovery required');
    }
    throw createLinkNativeError('network', 'network error');
  }
  return { snapshot: `sdk:${queueId ?? processed.sent[0] ?? 'sent'}` };
}

async function receiveSdkMessages(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
): Promise<{ messages: Array<{ kind: string; rawJson: string }>; snapshot: string }> {
  const path = LINK_RECEIVER_PATH;
  const received = await PaykitSdkNative.receivePrivateMessages(ownerPubky, peerPubky, path);
  const items =
    received.streamItemIds.length > 0
      ? await PaykitSdkNative.privateStreamItems(ownerPubky, received.streamItemIds)
      : [];
  return {
    messages: items.map(item => ({ kind: item.kind, rawJson: item.rawJson })),
    snapshot: `sdk:${received.receiveBatchId}`,
  };
}

async function failQueuedSendsForPeer(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
  const items = await StorageService.listDeliveryQueue();
  for (const item of items) {
    const payload = parseRetryPayload(item.payload);
    if (!payload) continue;
    if (payload.ownerPubky !== ownerPubky || payload.peerPubky !== peerPubky) continue;
    if (payload.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
      await StorageService.completeGroupFanoutRecipient({
        ownerPubky: payload.ownerPubky,
        channelId: payload.channelId,
        eventId: payload.eventId,
        senderPubky: payload.senderPubky,
        recipientPubky: payload.peerPubky,
        status: 'failed',
        reason: null,
        queueId: item.id,
        kind: payload.kind,
      });
      continue;
    }
    await StorageService.failLinkMessageAndDequeue({
      ownerPubky: payload.ownerPubky,
      senderPubky: payload.senderPubky,
      kind: payload.kind,
      eventId: payload.eventId,
      queueId: item.id,
    });
  }
}

async function retireLocalLinkState(stored: LinkRecord, expectedOwner: PubkyKey): Promise<void> {
  abortIfOwnerChanged(expectedOwner);
  const key = linkKey(stored.ownerPubky, stored.peerPubky);
  const pending = pendingEstablishedRekeys.get(key);
  if (pending) {
    await closeQuietly(pending.handshakeLinkId);
    pendingEstablishedRekeys.delete(key);
  }
  const live = liveHandles.get(key);
  if (live) {
    await closeQuietly(live.linkId);
    liveHandles.delete(key);
  }
  abortIfOwnerChanged(expectedOwner);
  await StorageService.deleteArchivedLink(stored.ownerPubky, stored.peerPubky);
  // A retired msg1 is harmless protocol garbage; without a slot-scoped
  // acknowledgement, its peer-visible history must remain untouched.
  await StorageService.upsertArchivedLink(stored);
  abortIfOwnerChanged(expectedOwner);
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
    const deny = await FollowsImportSettings.resolveDenyState(ownerPubky, contact.pubky);
    if (deny !== 'clear') continue;
    if (seen.has(contact.pubky)) continue;
    seen.add(contact.pubky);
    out.push(contact.pubky);
  }
  for (const link of links) {
    const deny = await FollowsImportSettings.resolveDenyState(ownerPubky, link.peerPubky);
    if (deny !== 'clear') continue;
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
  expectedQueueGen: number,
): Promise<void> {
  if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) return;
  if (!(await inboundStillAllowed(ownerPubky, peerPubky, ownerPubky))) return;
  const { messages, snapshot } = await receiveSdkMessages(ownerPubky, peerPubky);
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
      `[LinkService] Settled ${dropped} excess held stream item(s) peer=${opaquePeerId(ownerPubky, peerPubky)} over the per-peer unprocessed cap`,
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
  const deliveredByChannel = new Map<string, string[]>();
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
    if (outcome.kind === 'deferred') continue;
    await StorageService.markLinkStreamItemProcessed(item.id);
    if (outcome.deliveredEventId && outcome.channelId) {
      deliveredByChannel.set(outcome.channelId, [
        ...(deliveredByChannel.get(outcome.channelId) ?? []),
        outcome.deliveredEventId,
      ]);
    }
  }
  for (const [channelId, ids] of deliveredByChannel) {
    await emitReceiptIfEnabled(
      ownerPubky,
      peerPubky,
      'delivered',
      ids,
      channelId,
      undefined,
      peerTrust,
    );
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
}): Promise<
  { kind: 'deferred' } | { kind: 'settled'; deliveredEventId?: string; channelId?: string }
> {
  const { ownerPubky, peerPubky, item, peerTrust } = input;
  const envelope = decodeGroupEnvelope(item.rawJson);
  if (!envelope) return { kind: 'settled' };
  if (await isGroupInboundGated({ ownerPubky, envelope, peerTrust })) return { kind: 'deferred' };
  const applied = await applyGroupInbound({
    ownerPubky,
    senderPubky: peerPubky,
    envelope,
    rawJson: item.rawJson,
    receivedAt: item.receivedAt,
    peerTrust,
  });
  if (envelope.kind === GROUP_REACTION_KIND) {
    await applyInboundTagOrReceipt({
      ownerPubky,
      senderPubky: peerPubky,
      rawJson: item.rawJson,
      peerTrust,
      kindHint: GROUP_REACTION_KIND,
    });
  }
  if (envelope.kind === GROUP_MESSAGE_KIND && applied === 'applied') {
    return {
      kind: 'settled',
      deliveredEventId: envelope.event_id,
      channelId: envelope.channel_id,
    };
  }
  return { kind: 'settled' };
}

async function holdAsMessageRequest(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  expectedQueueGen: number,
): Promise<void> {
  if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) return;
  if (!(await inboundStillAllowed(ownerPubky, peerPubky, ownerPubky))) return;
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
    await retireLocalLinkState(leftover, leftover.ownerPubky);
    return;
  }
  // A declined inbound only discards local candidate state. Never delete the
  // peer-visible outbox, even when there is no local row to retire.
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

async function syncPeerLocked(peerPubky: PubkyKey, ownerPubky: PubkyKey): Promise<LinkMessage[]> {
  if (!isCurrentOwner(ownerPubky)) return [];
  const expectedQueueGen = currentQueueGeneration(ownerPubky, peerPubky);
  const deny = await FollowsImportSettings.resolveDenyState(ownerPubky, peerPubky);
  if (deny === 'unavailable') return [];
  if (deny === 'denied') {
    await rejectDeclinedInbound(ownerPubky, peerPubky);
    return [];
  }
  const prior = await StorageService.getLink(ownerPubky, peerPubky);
  const existingRequest = await StorageService.getMessageRequest(ownerPubky, peerPubky);
  if (existingRequest?.status === 'declined') {
    // Do not wipe a user-established link. Inbound is still not adopted.
    if (prior === null) {
      await rejectDeclinedInbound(ownerPubky, peerPubky);
    }
    return [];
  }
  try {
    const outcome = await ensureLinkLocked(peerPubky, 'background', false, ownerPubky);
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
        await holdAsMessageRequest(ownerPubky, peerPubky, expectedQueueGen);
        if (outcome === 'ready') {
          await persistInboundWithoutRouting(ownerPubky, peerPubky, expectedQueueGen);
        }
        return [];
      }
    }

    if (existingRequest?.status === 'pending' && !isNewInbound) {
      if (outcome === 'ready') {
        await persistInboundWithoutRouting(ownerPubky, peerPubky, expectedQueueGen);
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
    const { messages, snapshot } = await receiveSdkMessages(ownerPubky, peerPubky);

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
    if (isSdkOperationError(err) && err.code === 'recovery_required') {
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      if (stored) await markReconnectRequired(stored, ownerPubky, 'application');
    }
    throw err;
  }
}

async function markReconnectRequired(
  stored: LinkRecord,
  expectedOwner: PubkyKey,
  category: LinkReconnectErrorCategory,
): Promise<void> {
  abortIfOwnerChanged(expectedOwner);
  const key = linkKey(stored.ownerPubky, stored.peerPubky);
  const live = liveHandles.get(key);
  if (live) {
    await closeQuietly(live.linkId);
    liveHandles.delete(key);
  }
  abortIfOwnerChanged(expectedOwner);
  await StorageService.markLinkReconnectRequired(stored.ownerPubky, stored.peerPubky, category);
}

async function routeUnprocessedStreamItems(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  peerTrust: GroupPeerTrust,
): Promise<LinkMessage[]> {
  const items = await StorageService.getUnprocessedLinkStreamItems(ownerPubky, peerPubky);
  const received: LinkMessage[] = [];
  const seenInBatch = new Set<string>();
  const deliveredDmIds: string[] = [];
  const deliveredByChannel = new Map<string, string[]>();
  for (const item of items) {
    try {
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
        const attachmentEnvelope = decodeAttachmentEnvelope(item.rawJson);
        if (attachmentEnvelope) {
          await applyPendingChatDeletesForTarget({
            ownerPubky,
            peerPubky,
            senderPubky: peerPubky,
            targetEventId: attachmentEnvelope.event_id,
          });
          await applyPendingChatTagsForTarget({
            ownerPubky,
            peerPubky,
            senderPubky: peerPubky,
            targetEventId: attachmentEnvelope.event_id,
          });
        }
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
      if (peeked === CHAT_DELETE_KIND) {
        const result = await applyInboundDelete({
          ownerPubky,
          senderPubky: peerPubky,
          peerPubky,
          rawJson: item.rawJson,
          peerTrust,
        });
        if (result !== 'unprocessed') {
          await StorageService.markLinkStreamItemProcessed(item.id);
        }
        continue;
      }
      if (
        peeked === CHAT_TAG_KIND ||
        peeked === CHAT_RECEIPT_KIND ||
        peeked === CHAT_REACTION_KIND
      ) {
        const result = await applyInboundTagOrReceipt({
          ownerPubky,
          senderPubky: peerPubky,
          rawJson: item.rawJson,
          peerTrust,
          kindHint: peeked,
        });
        if (result === 'processed') {
          await StorageService.markLinkStreamItemProcessed(item.id);
        }
        continue;
      }
      if (peeked !== null && isGroupWireKind(peeked)) {
        const outcome = await routeGroupStreamItem({
          ownerPubky,
          peerPubky,
          item,
          peerTrust,
        });
        if (outcome.kind === 'settled') {
          await StorageService.markLinkStreamItemProcessed(item.id);
          if (outcome.deliveredEventId && outcome.channelId) {
            deliveredByChannel.set(outcome.channelId, [
              ...(deliveredByChannel.get(outcome.channelId) ?? []),
              outcome.deliveredEventId,
            ]);
          }
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
      await applyPendingChatDeletesForTarget({
        ownerPubky,
        peerPubky,
        senderPubky: peerPubky,
        targetEventId: row.eventId,
      });
      await applyPendingChatTagsForTarget({
        ownerPubky,
        peerPubky,
        senderPubky: peerPubky,
        targetEventId: row.eventId,
      });
      await StorageService.markLinkStreamItemProcessed(item.id);
      received.push(row);
      deliveredDmIds.push(row.eventId);
    } catch (err) {
      if (isLinkNativeError(err)) throw err;
      await StorageService.markLinkStreamItemProcessed(item.id, 'application');
    }
  }
  if (deliveredDmIds.length > 0) {
    await emitReceiptIfEnabled(ownerPubky, peerPubky, 'delivered', deliveredDmIds);
  }
  for (const [channelId, ids] of deliveredByChannel) {
    await emitReceiptIfEnabled(ownerPubky, peerPubky, 'delivered', ids, channelId);
  }
  return received;
}

// ─── Retry / recover internals ────────────────────────────────────────────────

async function drainAllRetries(): Promise<void> {
  const activeSession = session;
  if (activeSession) {
    try {
      await drainChatKindsAdvertiseRetry(activeSession.pubky, activeSession.alias);
    } catch (err) {
      console.warn('[LinkService] capability advertisement retry drain failed:', errorMessage(err));
    }
  }
  await drainDueRetries();
}

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
    if (payload.type === LINK_CONTROL_PAYLOAD_TYPE) {
      // Control PAMs have no message-row delivery state. Stay owed until sent.
    } else if (payload.type === LINK_RETRY_PAYLOAD_TYPE) {
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
      outcome = await ensureLinkLocked(payload.peerPubky, 'queued', false, payload.ownerPubky);
    } catch (err) {
      if (err instanceof LinkSendError && err.code === 'owner-changed') return;
      if (payload.type === LINK_CONTROL_PAYLOAD_TYPE) {
        await holdControlPam(item, payload.ownerPubky, payload.peerPubky, err);
        return;
      }
      if (isTransientLinkError(err)) {
        await RetryQueue.defer(item.id, item.attempts);
        return;
      }
      await dropQueuedPayloadPermanently(item, payload);
      return;
    }

    if (outcome === 'denied') {
      if (payload.type === LINK_CONTROL_PAYLOAD_TYPE) {
        await holdControlPam(item, payload.ownerPubky, payload.peerPubky, outcome);
        return;
      }
      await dropQueuedPayloadDenied(item, payload);
      return;
    }

    if (outcome === 'deny-unavailable' || outcome !== 'ready') {
      if (payload.type === LINK_CONTROL_PAYLOAD_TYPE) {
        await holdControlPam(item, payload.ownerPubky, payload.peerPubky, outcome);
        return;
      }
      await RetryQueue.defer(item.id, item.attempts);
      return;
    }

    try {
      const wireJson = await wireJsonForNativeSend(
        payload.kind,
        payload.rawJson,
        payload.ownerPubky,
        payload.senderPubky,
        payload.eventId,
        payload.peerPubky,
      );
      abortIfOwnerChanged(payload.ownerPubky);
      const { snapshot } = await sendOpaqueOnLink(payload.ownerPubky, payload.peerPubky, wireJson);
      abortIfOwnerChanged(payload.ownerPubky);
      if (payload.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
        await StorageService.finalizeGroupFanoutSend({
          ownerPubky: payload.ownerPubky,
          peerPubky: payload.peerPubky,
          snapshot,
          queueId: item.id,
          channelId: payload.channelId,
          eventId: payload.eventId,
          senderPubky: payload.senderPubky,
          kind: payload.kind,
        });
      } else if (payload.type === LINK_CONTROL_PAYLOAD_TYPE) {
        await StorageService.finalizeControlSend({
          ownerPubky: payload.ownerPubky,
          peerPubky: payload.peerPubky,
          snapshot,
          queueId: item.id,
        });
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
      if (err instanceof LinkSendError && err.code === 'owner-changed') return;
      if (payload.type === LINK_CONTROL_PAYLOAD_TYPE) {
        await holdControlPam(item, payload.ownerPubky, payload.peerPubky, err);
        return;
      }
      if (isTransientLinkError(err)) {
        await RetryQueue.defer(item.id, item.attempts);
        return;
      }
      await dropQueuedPayloadPermanently(item, payload);
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

async function dropQueuedPayloadDenied(
  item: DeliveryQueueItem,
  payload: AnyLinkRetryPayload,
): Promise<void> {
  abortIfOwnerChanged(payload.ownerPubky);
  if (payload.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
    await StorageService.completeGroupFanoutRecipient({
      ownerPubky: payload.ownerPubky,
      channelId: payload.channelId,
      eventId: payload.eventId,
      senderPubky: payload.senderPubky,
      recipientPubky: payload.peerPubky,
      status: 'failed',
      reason: 'blocked',
      queueId: item.id,
      kind: payload.kind,
    });
    return;
  }
  await StorageService.failLinkMessageAndDequeue({
    ownerPubky: payload.ownerPubky,
    senderPubky: payload.senderPubky,
    kind: payload.kind,
    eventId: payload.eventId,
    queueId: item.id,
  });
}

async function dropQueuedPayloadPermanently(
  item: DeliveryQueueItem,
  payload: AnyLinkRetryPayload,
): Promise<void> {
  abortIfOwnerChanged(payload.ownerPubky);
  if (payload.type === LINK_CONTROL_PAYLOAD_TYPE) {
    await holdControlPam(item, payload.ownerPubky, payload.peerPubky, 'permanent-drop-blocked');
    return;
  }
  if (payload.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE && RetryQueue.wouldDrop(item.attempts)) {
    await StorageService.completeGroupFanoutRecipient({
      ownerPubky: payload.ownerPubky,
      channelId: payload.channelId,
      eventId: payload.eventId,
      senderPubky: payload.senderPubky,
      recipientPubky: payload.peerPubky,
      status: 'failed',
      reason: null,
      queueId: item.id,
      kind: payload.kind,
    });
    return;
  }
  if (RetryQueue.wouldDrop(item.attempts)) {
    await StorageService.failLinkMessageAndDequeue({
      ownerPubky: payload.ownerPubky,
      senderPubky: payload.senderPubky,
      kind: payload.kind,
      eventId: payload.eventId,
      queueId: item.id,
    });
    return;
  }
  await RetryQueue.recordFailure(item.id, item.attempts);
}

function toSendError(err: unknown): Error {
  const native = toLinkNativeError(err);
  return new Error(native.message);
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
      await KeyStore.setAttachmentSecret(
        ownerPubky,
        peerPubky,
        envelope.event_id,
        {
          key: envelope.key,
          nonce: envelope.nonce,
          algorithm: envelope.algorithm,
          ...(envelope.thumbnail
            ? { thumbnail: { key: envelope.thumbnail.key, nonce: envelope.thumbnail.nonce } }
            : {}),
        },
        {
          peerPubky,
          conversationId: envelope.channel_id ?? buildDmConversationId(peerPubky),
        },
      );
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

function bindingForStoredAttachment(
  peerPubky: PubkyKey,
  senderPubky: PubkyKey,
  attachment: { conversationId?: string | null; channelId?: string | null } | null,
): { peerPubky: string; conversationId: string } {
  if (attachment?.channelId) {
    return { peerPubky: senderPubky, conversationId: attachment.channelId };
  }
  return {
    peerPubky,
    conversationId: attachment?.conversationId || buildDmConversationId(peerPubky),
  };
}

async function wireJsonForNativeSend(
  kind: string,
  persistedRawJson: string,
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  eventId: string,
  peerPubky: PubkyKey,
): Promise<string> {
  if (kind !== CHAT_ATTACHMENT_KIND) return persistedRawJson;
  const row = await StorageService.getAttachment(ownerPubky, senderPubky, eventId);
  return reconstructAttachmentWireJson(
    persistedRawJson,
    attachmentKeyRef(ownerPubky, senderPubky, eventId),
    bindingForStoredAttachment(peerPubky, senderPubky, row),
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
  const painted = activeOwnerAtCommit();
  if (painted === SIGNING_OUT || painted === null) return;
  const expectedOwner = painted;
  try {
    abortIfOwnerChanged(expectedOwner);
    const pending = (await StorageService.listPaymentRequestsWithPendingEvent(expectedOwner)) ?? [];
    abortIfOwnerChanged(expectedOwner);
    for (const row of pending) {
      const eventId = row.pendingEventId;
      if (!eventId) continue;
      const message = await StorageService.getLinkMessageByEventId(
        expectedOwner,
        expectedOwner,
        eventId,
      );
      abortIfOwnerChanged(expectedOwner);
      if (!message) continue;
      if (message.deliveryState === 'sent') {
        await StorageService.clearPaymentPendingEvent(expectedOwner, eventId);
        abortIfOwnerChanged(expectedOwner);
        continue;
      }
      if (!isRetryableDeliveryState(message.deliveryState)) continue;
      if (await StorageService.hasQueueItemForMessage(eventId)) continue;
      abortIfOwnerChanged(expectedOwner);
      const ts = Date.now();
      await StorageService.enqueue({
        id: uuidv4(),
        messageId: eventId,
        recipientPubky: row.peerPubky,
        payload: JSON.stringify(
          retryPayload(expectedOwner, row.peerPubky, eventId, message.rawJson, message.kind),
        ),
        attempts: 0,
        nextRetryAt: ts,
        createdAt: ts,
      });
    }
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') return;
    throw err;
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

async function dispatchControlPam(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  eventId: string,
  rawJson: string,
  kind: string,
): Promise<void> {
  const run = () => dispatchControlPamLocked(ownerPubky, peerPubky, eventId, rawJson, kind);
  if (heldPeerQueues.has(peerQueueKey(peerPubky))) {
    await run();
    return;
  }
  await withQueue(peerPubky, run);
}

async function dispatchControlPamLocked(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  eventId: string,
  rawJson: string,
  kind: string,
): Promise<void> {
  const item = queueItemForPeer(ownerPubky, peerPubky, eventId, rawJson, kind);
  if (typeof StorageService.persistControlSendIntent !== 'function') return;
  await StorageService.persistControlSendIntent({ ownerPubky, queueItem: item });
  await dispatchPersistedControlPam(ownerPubky, peerPubky, item, kind, rawJson);
}

async function dispatchPersistedControlPam(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  item: DeliveryQueueItem,
  kind: string,
  rawJson: string,
): Promise<void> {
  abortIfOwnerChanged(ownerPubky);
  let outcome: EnsureOutcome;
  try {
    outcome = await ensureLinkLocked(peerPubky, 'user', false, ownerPubky);
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    await holdControlPam(item, ownerPubky, peerPubky, err);
    return;
  }
  abortIfOwnerChanged(ownerPubky);
  if (outcome !== 'ready') {
    await holdControlPam(item, ownerPubky, peerPubky, outcome);
    return;
  }
  try {
    const wireJson = await wireJsonForNativeSend(
      kind,
      rawJson,
      ownerPubky,
      ownerPubky,
      item.messageId,
      peerPubky,
    );
    const { snapshot } = await sendOpaqueOnLink(ownerPubky, peerPubky, wireJson);
    abortIfOwnerChanged(ownerPubky);
    await StorageService.finalizeControlSend({
      ownerPubky,
      peerPubky,
      snapshot,
      queueId: item.id,
    });
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    await holdControlPam(item, ownerPubky, peerPubky, err);
  }
}

async function emitReceiptIfEnabled(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  status: 'delivered' | 'read',
  eventIds: string[],
  channelId?: string,
  peerKnownV1?: boolean,
  peerTrust: GroupPeerTrust = 'accepted',
): Promise<void> {
  if (peerTrust === 'gated') return;
  if (typeof StorageService.getChatDevicePrefs !== 'function') return;
  const prefs = await StorageService.getChatDevicePrefs(ownerPubky);
  if (!prefs?.receiptsEnabled) return;
  if (!peerKnownV1) {
    const link = await StorageService.getLink(ownerPubky, peerPubky);
    if (normalizeChatKindsV(link?.chatKindsV) < CHAT_KINDS_V) return;
  }
  const unique = [...new Set(eventIds.filter(id => id.length > 0))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (unique.length === 0) return;
  for (let i = 0; i < unique.length; i += 16) {
    const batch = unique.slice(i, i + 16);
    const built = buildOutboundReceipt({
      status,
      eventIds: batch,
      ...(channelId ? { channelId } : {}),
    });
    await dispatchControlPam(ownerPubky, peerPubky, built.eventId, built.json, CHAT_RECEIPT_KIND);
  }
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
  abortIfOwnerChanged(input.ownerPubky);
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
  abortIfOwnerChanged(input.ownerPubky);

  if (input.outcome !== 'ready') return message;

  try {
    const wireJson = await wireJsonForNativeSend(
      input.kind,
      persistJson,
      input.ownerPubky,
      input.ownerPubky,
      input.eventId,
      input.peerPubky,
    );
    abortIfOwnerChanged(input.ownerPubky);
    const { snapshot } = await sendOpaqueOnLink(input.ownerPubky, input.peerPubky, wireJson);
    abortIfOwnerChanged(input.ownerPubky);
    await StorageService.finalizeLinkSend({
      ownerPubky: input.ownerPubky,
      peerPubky: input.peerPubky,
      senderPubky: input.ownerPubky,
      kind: input.kind,
      eventId: input.eventId,
      snapshot,
      queueId,
    });
    abortIfOwnerChanged(input.ownerPubky);
    return { ...message, deliveryState: 'sent' };
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    console.warn(
      `[LinkService] send-failed peer=${opaquePeerId(input.ownerPubky, input.peerPubky)}:`,
      errorMessage(err),
    );
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
  if (
    candidate.type === LINK_CONTROL_PAYLOAD_TYPE ||
    (candidate.type === LINK_RETRY_PAYLOAD_TYPE && isLegacyControlKind(candidate.kind))
  ) {
    return {
      type: LINK_CONTROL_PAYLOAD_TYPE,
      ownerPubky: candidate.ownerPubky,
      peerPubky: candidate.peerPubky,
      senderPubky: candidate.senderPubky,
      kind: candidate.kind,
      eventId: candidate.eventId,
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

function isCurrentOwner(ownerPubky: PubkyKey): boolean {
  return activeOwnerAtCommit() === ownerPubky;
}

function linkKey(ownerPubky: PubkyKey, peerPubky: PubkyKey): string {
  return `${ownerPubky}:${peerPubky}`;
}

function abortIfOwnerChanged(expectedOwner: PubkyKey): void {
  if (activeOwnerAtCommit() !== expectedOwner) {
    throw new LinkSendError('owner-changed', 'LinkService: owner changed during send');
  }
}

function errorMessage(err: unknown): string {
  const raw = isLinkNativeError(err)
    ? `[${err.code}] ${err.message}`
    : err instanceof Error
      ? err.message
      : String(err);
  return stripSensitive(raw);
}

async function closeQuietly(linkId: string): Promise<void> {
  if (linkId.startsWith('sdk:')) return;
  try {
    await PaykitLinkNative.closeLink(linkId);
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'unavailable') throw err;
  }
}

async function dropLiveHandleQuietly(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
  const key = linkKey(ownerPubky, peerPubky);
  const live = liveHandles.get(key);
  if (!live) return;
  liveHandles.delete(key);
  await closeQuietly(live.linkId);
}

function isLegacyControlKind(kind: string): boolean {
  return kind === CHAT_DELETE_KIND || kind === CHAT_TAG_KIND || kind === CHAT_RECEIPT_KIND;
}

async function holdControlPam(
  item: DeliveryQueueItem,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  reason: unknown,
): Promise<void> {
  const detail = typeof reason === 'string' ? reason : errorMessage(reason);
  console.warn(
    `[LinkService] Control PAM send deferred peer=${opaquePeerId(ownerPubky, peerPubky)}:`,
    detail,
  );
  if (isLinkNativeError(reason) && reason.code === 'protocol') {
    await dropLiveHandleQuietly(ownerPubky, peerPubky);
  }
  await RetryQueue.defer(item.id, item.attempts);
}

const SIGN_OUT_MARKER_WRITE_FAILED = 'sign-out marker write failed';

async function persistAndVerifySignOutIncompleteMarker(
  owner: PubkyKey,
  alias: string | null,
): Promise<void> {
  try {
    KeyStore.markSignOutIncomplete(owner);
  } catch {
    throw new Error(SIGN_OUT_MARKER_WRITE_FAILED);
  }
  if (KeyStore.getSignOutIncompleteOwner() !== owner) {
    try {
      KeyStore.clearSignOutIncomplete();
    } catch {
      // Best-effort rollback of a partial MMKV write.
    }
    throw new Error(SIGN_OUT_MARKER_WRITE_FAILED);
  }
  if (alias) {
    try {
      KeyStore.markSignOutIncompleteAlias(alias);
    } catch {
      // Alias is needed for native teardown on boot, not for the wipe itself.
    }
  }
  try {
    await StorageService.persistSignOutIncompleteJournal(owner, alias);
  } catch {
    try {
      KeyStore.clearSignOutIncomplete();
    } catch {
      // Best-effort rollback.
    }
    throw new Error(SIGN_OUT_MARKER_WRITE_FAILED);
  }
  let journalOwner: string | null;
  try {
    journalOwner = await StorageService.getSignOutIncompleteJournalOwner(owner);
  } catch {
    try {
      KeyStore.clearSignOutIncomplete();
    } catch {
      // Best-effort rollback.
    }
    throw new Error(SIGN_OUT_MARKER_WRITE_FAILED);
  }
  if (journalOwner !== owner) {
    try {
      KeyStore.clearSignOutIncomplete();
    } catch {
      // Best-effort rollback.
    }
    try {
      await StorageService.clearSignOutIncompleteJournal(owner);
    } catch {
      // Best-effort rollback.
    }
    throw new Error(SIGN_OUT_MARKER_WRITE_FAILED);
  }
}

function deleteLinkSessionWithRetry(owner: PubkyKey): void {
  try {
    KeyStore.deleteLinkSession();
  } catch {
    try {
      KeyStore.deleteLinkSession();
    } catch (err) {
      try {
        KeyStore.markSignOutIncomplete(owner);
      } catch {
        // Marker write may fail on the same store.
      }
      throw err;
    }
  }
}

async function commitSignOutWipe(input: {
  owner: PubkyKey;
  alias: string | null;
  markerPath: string;
}): Promise<void> {
  await persistAndVerifySignOutIncompleteMarker(input.owner, input.alias);
  invalidateSignOutRestore();
  const errors: unknown[] = [];
  const capture = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (err) {
      errors.push(err);
    }
  };

  let localPk: string | null = null;
  try {
    const receiver = await StorageService.getLinkReceiver(input.owner);
    if (receiver) localPk = await PaykitLinkNative.getReceiverPublicKey(receiver.receiverAlias);
  } catch {
    localPk = null;
  }

  await capture(() => StorageService.clearAccountData(input.owner));
  if (input.alias) {
    await capture(async () => {
      if (!localPk) return;
      try {
        const marker = await PaykitLinkNative.getReceiverMarker(input.owner, input.markerPath);
        if (marker && marker.noisePublicKey === localPk) {
          await PaykitLinkNative.removeReceiverMarker(input.alias!, input.markerPath);
        }
      } catch {
        // GET failure or foreign pk: leave the published marker.
      }
    });
    await capture(() => PaykitLinkNative.signOutSession(input.alias!));
  }
  const current = KeyStore.getPubky();
  if (current === input.owner) {
    await capture(() => PaykitLinkNative.clearAllNativeSecrets());
  }
  if (session?.pubky === input.owner) {
    session = null;
  }
  useReceiverRoleStore.getState().reset();
  inboxOwnMarkerSyncedFor = null;
  inboxOwnMarkerSyncedAt = 0;
  peerMarkerRefreshedAt.clear();
  pendingEstablishedRekeys.clear();
  const ownerPrefix = `${input.owner}:`;
  for (const key of [...liveHandles.keys()]) {
    if (key.startsWith(ownerPrefix)) liveHandles.delete(key);
  }
  for (const key of [...queues.keys()]) {
    if (key.startsWith(ownerPrefix)) queues.delete(key);
  }
  for (const key of [...peerQueueGenerations.keys()]) {
    if (key.startsWith(ownerPrefix)) peerQueueGenerations.delete(key);
  }
  if (KeyStore.getPubky() === input.owner) {
    const storedAlias = KeyStore.getLinkSession();
    if (storedAlias == null || storedAlias === input.alias) {
      try {
        deleteLinkSessionWithRetry(input.owner);
      } catch (err) {
        errors.push(err);
      }
    }
  }
  if (errors.length > 0) throw errors[0];
}

/**
 * Serializes operations per counterparty. Settled entries are pruned so the
 * map cannot grow without bound across a long-lived process.
 */
const heldPeerQueues = new Set<string>();

function peerQueueKey(peerPubky: PubkyKey): string {
  const owner = session?.pubky ?? KeyStore.getPubky() ?? '';
  return `${owner}:${peerPubky}`;
}

async function withQueue<T>(peerPubky: PubkyKey, operation: () => Promise<T>): Promise<T> {
  const key = peerQueueKey(peerPubky);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(
    () => runHeldPeerQueue(key, operation),
    () => runHeldPeerQueue(key, operation),
  );
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

async function runHeldPeerQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  heldPeerQueues.add(key);
  try {
    return await operation();
  } finally {
    heldPeerQueues.delete(key);
  }
}

function resetPeerQueue(ownerPubky: PubkyKey, peerPubky: PubkyKey): void {
  const key = `${ownerPubky}:${peerPubky}`;
  queues.delete(key);
  heldPeerQueues.delete(key);
  peerQueueGenerations.set(key, currentQueueGeneration(ownerPubky, peerPubky) + 1);
}

function currentQueueGeneration(ownerPubky: PubkyKey, peerPubky: PubkyKey): number {
  return peerQueueGenerations.get(`${ownerPubky}:${peerPubky}`) ?? 0;
}

function queueGenerationChanged(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  expected: number,
): boolean {
  return currentQueueGeneration(ownerPubky, peerPubky) !== expected;
}

function ownMarkerSyncIsFresh(ownerPubky: PubkyKey): boolean {
  return (
    inboxOwnMarkerSyncedFor === ownerPubky &&
    Date.now() - inboxOwnMarkerSyncedAt < OWN_MARKER_SYNC_TTL_MS
  );
}

function markOwnMarkerSynced(ownerPubky: PubkyKey): void {
  inboxOwnMarkerSyncedFor = ownerPubky;
  inboxOwnMarkerSyncedAt = Date.now();
}

async function inboundStillAllowed(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  expectedOwner: PubkyKey,
): Promise<boolean> {
  abortIfOwnerChanged(expectedOwner);
  if (!isCurrentOwner(ownerPubky)) return false;
  const deny = await FollowsImportSettings.resolveDenyState(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);
  return deny === 'clear';
}

export type { LinkNativeError };
