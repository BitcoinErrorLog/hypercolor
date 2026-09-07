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
  CHAT_RECEIPT_KIND,
  CHAT_REACTION_KIND,
  CHAT_TAG_KIND,
  coerceReceiverPath,
  decodeLinkEnvelope,
  parseDmConversationId,
  type LinkMessage,
  type LinkReceiver,
  type LinkRecord,
  type LinkRole,
  type LinkStatus,
  type LinkStreamItem,
  type LinkStreamItemInput,
  type ReceiverRole,
} from '../../types/link';
import type { DeliveryQueueItem, PubkyKey } from '../../types';
import {
  persistPeerChatKindsVFromMarker,
  putChatKindsVReceiverJson,
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
import { applyPaymentInbound } from '../payments/applyPaymentInbound';
import { isPaykitPaymentKind } from '../../types/payment';
import { shouldDropOversizedKnownInbound } from './inboundEnvelope';
import { LinkSendError } from './LinkSendError';
import { FollowsImportSettings } from '../contacts/followsImportSettings';
import { opaquePeerId } from '../contacts/opaquePeerId';
import { setReceiverRoleState, useReceiverRoleStore } from '../../stores/receiverRoleStore';
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
 * - Welcome combined grant: `startAuthFlow` is minted with the paykit-connect
 *   QR; after one Ring sheet, `adoptApprovedSession` then UKD keys then
 *   `provisionReceiver`. `LinkService.enable()` remains recovery / old Ring.
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

function mayInitiate(intent: LinkIntent): boolean {
  return intent !== 'background';
}

/** Same `ready` predicate the send path uses: live established handle or snapshot. */
function isReadyLinkPredicate(record: LinkRecord, live: LiveHandle | undefined): boolean {
  if (live?.status === 'established') return true;
  return record.status === 'established' && record.snapshot.length > 0;
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
   * Used after UKD keys are persisted, and as the Retry-publish CTA.
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
            await persistThenAdopt(sessionAlias);
            KeyStore.setPubky(pubky);
            session = { alias: sessionAlias, pubky };
            paintOwner(pubky);
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
      if (isReadyLinkPredicate(record, live)) {
        if (blockedEstablishedRekeyOutcome(record) === 'error') return 'error';
        return 'ready';
      }
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
      await promoteUserOutboundRequest(peerPubky, 'sendable', ownerAtStart);
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
      await promoteUserOutboundRequest(input.peerPubky, 'sendable', ownerAtStart);
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
      const handle = requireEstablishedHandle(input.ownerPubky, input.peerPubky);
      const wireJson = await wireJsonForNativeSend(
        input.kind,
        input.rawJson,
        input.ownerPubky,
        input.senderPubky,
        input.eventId,
      );
      abortIfOwnerChanged(input.ownerPubky);
      const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, wireJson);
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
        const handle = requireEstablishedHandle(input.ownerPubky, input.peerPubky);
        const wireJson = await wireJsonForNativeSend(
          input.kind,
          input.rawJson,
          input.ownerPubky,
          input.senderPubky,
          input.eventId,
        );
        abortIfOwnerChanged(input.ownerPubky);
        const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, wireJson);
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
      if (stored) await wipeLinkState(stored, ownerPubky);
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
  let rollbackOnFailure = true;
  if (existing) {
    try {
      receiverAlias = existing.receiverAlias;
      noisePublicKey = await PaykitLinkNative.getReceiverPublicKey(receiverAlias);
      rollbackOnFailure = !existing.markerPublished;
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
    if (rollbackOnFailure) await rollbackUnpublishedReceiver(pubky);
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
    await putChatKindsVReceiverJson(sessionAlias, pubky, noisePublicKey);
    await persistReceiverRow(
      pubky,
      receiverAlias,
      receiverPath,
      true,
      'active',
      published.noisePublicKey,
    );
    setReceiverRoleState('active', null);
    return { pubky, receiverPath, noisePublicKey, receiverRole: 'active' };
  }

  try {
    await PaykitLinkNative.publishReceiverMarker(sessionAlias, receiverAlias, receiverPath);
    await putChatKindsVReceiverJson(sessionAlias, pubky, noisePublicKey);
  } catch (error) {
    if (rollbackOnFailure) await rollbackUnpublishedReceiver(pubky);
    throw error;
  }
  await persistReceiverRow(pubky, receiverAlias, receiverPath, true, 'active', noisePublicKey);
  setReceiverRoleState('active', null);
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

async function rollbackUnpublishedReceiver(ownerPubky: PubkyKey): Promise<void> {
  try {
    await StorageService.deleteLinkReceiver(ownerPubky);
  } catch {
    // Best effort.
  }
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
  await putChatKindsVReceiverJson(sessionAlias, pubky, noisePublicKey);
  await persistReceiverRow(
    pubky,
    existing.receiverAlias,
    receiverPath,
    true,
    'active',
    noisePublicKey,
  );
  setReceiverRoleState('active', reason === 'reenable' ? COPY.reenableToast : COPY.takeoverToast);
  await restartUnestablishedLinksAfterTakeover(pubky);
  return { pubky, receiverPath, noisePublicKey, receiverRole: 'active' };
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
    if (link.status === 'established') continue;
    try {
      await withQueue(link.peerPubky, async () => {
        abortIfOwnerChanged(ownerPubky);
        const latest = await StorageService.getLink(ownerPubky, link.peerPubky);
        abortIfOwnerChanged(ownerPubky);
        if (!latest || latest.status === 'established') return;
        await StorageService.clearHandshakeBudget(ownerPubky, link.peerPubky);
        abortIfOwnerChanged(ownerPubky);
        await wipeLinkState(latest, ownerPubky);
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
  const deny = await FollowsImportSettings.resolveDenyState(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);
  if (deny === 'denied') return 'denied';
  if (deny === 'unavailable') return 'deny-unavailable';
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  abortIfOwnerChanged(expectedOwner);
  if (!receiver) return 'needs-enable';
  if (!receiver.markerPublished && receiver.receiverRole !== 'standby') return 'needs-enable';
  const localPath = assertValidReceiverPath(coerceReceiverPath(receiver.receiverPath));

  const key = linkKey(ownerPubky, peerPubky);
  const expectedQueueGen = currentQueueGeneration(ownerPubky, peerPubky);
  let live = liveHandles.get(key);
  let stored = await StorageService.getLink(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);

  // Above the live-handle dispatch on purpose. A handshake in progress keeps a
  // handle in memory for as long as the app stays foregrounded, and clearing
  // below that branch made the documented recovery unreachable in exactly the
  // case that needs it: the peer whose budget the handshake itself ran down.
  if (intent === 'user') {
    await StorageService.clearHandshakeBudget(ownerPubky, peerPubky);
    establishedRekeyParkWindows.delete(key);
    abortIfOwnerChanged(expectedOwner);
  }

  if (stored && (await shouldAgeOutNonReadyLink(stored, expectedOwner))) {
    console.warn(
      `[LinkService] handshake-stale-discard peer=${opaquePeerId(ownerPubky, peerPubky)} ageMs=${Date.now() - stored.updatedAt}`,
    );
    await wipeLinkState(stored, expectedOwner);
    stored = null;
    live = liveHandles.get(key);
  }

  if (live?.status === 'established' || stored?.status === 'established') {
    if (stored?.status === 'established' && live?.status !== 'established') {
      const restored = await restoreEstablished(
        activeSession,
        receiver,
        stored,
        intent,
        alreadyRecovered,
        expectedOwner,
      );
      abortIfOwnerChanged(expectedOwner);
      if (restored !== 'ready') return restored;
      live = liveHandles.get(key);
    }
    if (stored?.status === 'established') {
      const rekeyed = await maybeAdoptEstablishedRekey(
        activeSession,
        receiver,
        stored,
        ownerPubky,
        peerPubky,
        localPath,
        expectedOwner,
        expectedQueueGen,
        intent,
      );
      abortIfOwnerChanged(expectedOwner);
      if (rekeyed !== null) return rekeyed;
      stored = await StorageService.getLink(ownerPubky, peerPubky);
      abortIfOwnerChanged(expectedOwner);
      const blocked = stored ? blockedEstablishedRekeyOutcome(stored) : null;
      if (blocked) return blocked;
    }
    if (liveHandles.get(key)?.status === 'established' || stored?.status === 'established') {
      return 'ready';
    }
  }

  const latestReceiver = await StorageService.getLinkReceiver(ownerPubky);
  abortIfOwnerChanged(expectedOwner);
  if (latestReceiver?.receiverRole === 'standby') return 'standby-blocked';

  if (intent !== 'user' && (await isHandshakeBudgetExhausted(ownerPubky, peerPubky))) {
    abortIfOwnerChanged(expectedOwner);
    return 'idle';
  }

  await ensureOwnReceiverMarkerMatches(
    activeSession,
    receiver,
    ownerPubky,
    localPath,
    expectedOwner,
  );
  abortIfOwnerChanged(expectedOwner);

  let marker: ReceiverMarker | null | undefined;
  try {
    marker = await fetchPeerReceiverMarker(ownerPubky, peerPubky, localPath);
    abortIfOwnerChanged(expectedOwner);
    if (marker && stored) {
      await StorageService.recordLastSeenPeerMarkerPk(ownerPubky, peerPubky, marker.noisePublicKey);
      stored = { ...stored, lastSeenPeerMarkerPk: marker.noisePublicKey };
    }
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    marker = undefined;
  }

  // A responder that already wrote Noise msg2 must advance that same
  // handshake to read initiator msg3. `probeInboundLink` is accept+one
  // advance: calling it again starts a new XX, rewrites msg2, and the
  // initiator (already established after the first msg2) never re-sends
  // msg3. Inbox poll / open-thread sync then loop `result=pending`.
  const responderHandshaking =
    (live?.status === 'handshaking' && live.role === 'responder') ||
    (stored?.status === 'handshaking' && stored.role === 'responder');

  // Peer re-enrolled (new noise pk on receiver.json) while we still hold
  // msg2: advance() only reads the msg3 slot. Wipe and accept the fresh
  // msg1. Same-pk restarts stay on the pre-existing non-ready age-out
  // ({@link HANDSHAKE_STALE_MS}) so a late msg3 is not wiped sooner.
  if (
    responderHandshaking &&
    marker &&
    stored?.remoteNoisePublicKey &&
    marker.noisePublicKey !== stored.remoteNoisePublicKey
  ) {
    return restartResponderFromFreshMsg1(
      activeSession,
      receiver,
      ownerPubky,
      peerPubky,
      stored,
      marker,
      localPath,
      alreadyRecovered,
      expectedOwner,
      expectedQueueGen,
    );
  }

  if (marker && !responderHandshaking) {
    let inbound: Extract<LinkProbeResult, { result: 'pending' | 'established' }> | null;
    try {
      inbound = await probeInbound(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        marker,
        localPath,
      );
      abortIfOwnerChanged(expectedOwner);
    } catch (err) {
      if (isLinkNativeError(err) && err.code === 'protocol') {
        abortIfOwnerChanged(expectedOwner);
        await clearPeerOutboxBestEffort(
          activeSession,
          receiver,
          peerPubky,
          marker.noisePublicKey,
          localPath,
          LINK_RECEIVER_PATH,
        );
        abortIfOwnerChanged(expectedOwner);
        inbound = null;
      } else {
        throw err;
      }
    }
    if (inbound !== null) {
      stored = await StorageService.getLink(ownerPubky, peerPubky);
      live = liveHandles.get(key);
      abortIfOwnerChanged(expectedOwner);
      if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
        await closeQuietly(inbound.linkId);
        return 'idle';
      }
      const canReplace = stored === null || stored.status !== 'established';
      if (canReplace && (stored?.status === 'handshaking' || live?.status === 'handshaking')) {
        if (stored) await wipeNonReadyHandshakeOnly(stored, expectedOwner);
        else if (live) {
          await closeQuietly(live.linkId);
          liveHandles.delete(key);
        }
      }
      if (canReplace) {
        abortIfOwnerChanged(expectedOwner);
        if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
          await closeQuietly(inbound.linkId);
          return 'idle';
        }
        return adoptInboundHandshake(
          ownerPubky,
          peerPubky,
          marker,
          localPath,
          inbound,
          expectedOwner,
          expectedQueueGen,
        );
      }
    }
  }

  live = liveHandles.get(key);
  stored = await StorageService.getLink(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);

  if (live?.status === 'handshaking') {
    return advanceLiveHandshake(
      activeSession,
      receiver,
      ownerPubky,
      peerPubky,
      live,
      intent,
      alreadyRecovered,
      expectedOwner,
    );
  }

  if (stored?.status === 'handshaking') {
    const restored = await restoreAndAdvanceHandshake(
      activeSession,
      receiver,
      stored,
      intent,
      alreadyRecovered,
      expectedOwner,
    );
    abortIfOwnerChanged(expectedOwner);
    return restored;
  }

  if (marker === undefined) return 'idle';
  if (marker === null) return mayInitiate(intent) ? 'not-enrolled' : 'idle';

  if (!mayInitiate(intent)) return 'idle';

  const initiateReceiver = await StorageService.getLinkReceiver(ownerPubky);
  abortIfOwnerChanged(expectedOwner);
  if (initiateReceiver?.receiverRole === 'standby') return 'standby-blocked';

  abortIfOwnerChanged(expectedOwner);
  return initiateHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    marker,
    localPath,
    intent,
    alreadyRecovered,
    expectedOwner,
  );
}

async function shouldAgeOutNonReadyLink(
  stored: LinkRecord,
  expectedOwner: PubkyKey,
): Promise<boolean> {
  abortIfOwnerChanged(expectedOwner);
  const ageMs = Date.now() - stored.updatedAt;
  if (!Number.isFinite(ageMs) || ageMs < HANDSHAKE_STALE_MS) return false;
  if (stored.status === 'handshaking') {
    const budget = await StorageService.getHandshakeBudget(stored.ownerPubky, stored.peerPubky);
    abortIfOwnerChanged(expectedOwner);
    if (budget && budget.exhaustedAt === null && budget.pendingAdvances > 0) return false;
    return true;
  }
  if (stored.status !== 'established') return false;
  const request = await StorageService.getMessageRequest(stored.ownerPubky, stored.peerPubky);
  abortIfOwnerChanged(expectedOwner);
  if (request?.status !== 'pending') return false;
  const messages = await StorageService.countLinkMessagesForPeer(
    stored.ownerPubky,
    stored.peerPubky,
  );
  abortIfOwnerChanged(expectedOwner);
  return messages === 0;
}

async function wipeNonReadyHandshakeOnly(
  stored: LinkRecord,
  expectedOwner: PubkyKey,
): Promise<void> {
  if (stored.status === 'established') return;
  await wipeLinkState(stored, expectedOwner);
}

/**
 * Re-key compare key is the established link's remote static, not last GET.
 * Preferring `lastSeenPeerMarkerPk` skipped a live re-key once a GET of the
 * new pk was recorded, and probed the old DH slot when a later GET was stale.
 */
function establishedRemotePk(stored: LinkRecord): string {
  return stored.remoteNoisePublicKey || '';
}

function blockedEstablishedRekeyOutcome(
  stored: LinkRecord,
  markerPk?: string | null,
): EnsureOutcome | null {
  const establishedPk = establishedRemotePk(stored);
  const seen = markerPk || stored.lastSeenPeerMarkerPk || '';
  if (establishedPk === '' || seen === '' || establishedPk === seen) return null;
  const key = linkKey(stored.ownerPubky, stored.peerPubky);
  if (pendingEstablishedRekeys.has(key)) return null;
  return 'error';
}

function establishedRekeyParkAllowed(ownerPubky: PubkyKey, peerPubky: PubkyKey): boolean {
  const key = linkKey(ownerPubky, peerPubky);
  const now = Date.now();
  const held = establishedRekeyParkWindows.get(key);
  if (!held || now - held.windowStart >= HANDSHAKE_STALE_MS) {
    establishedRekeyParkWindows.set(key, { windowStart: now, parks: 0 });
    return true;
  }
  return held.parks < ESTABLISHED_REKEY_PARK_LIMIT;
}

async function chargeEstablishedRekeyPark(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  expectedOwner: PubkyKey,
): Promise<{ exhausted: boolean }> {
  const key = linkKey(ownerPubky, peerPubky);
  const now = Date.now();
  const held = establishedRekeyParkWindows.get(key);
  const window =
    !held || now - held.windowStart >= HANDSHAKE_STALE_MS ? { windowStart: now, parks: 0 } : held;
  window.parks += 1;
  establishedRekeyParkWindows.set(key, window);
  return chargeHandshakeBudget(
    ownerPubky,
    peerPubky,
    { reason: 'established-rekey-park' },
    expectedOwner,
  );
}

async function dropParkedEstablishedRekey(
  stored: LinkRecord,
  pending: PendingEstablishedRekey,
): Promise<EnsureOutcome | null> {
  const key = linkKey(stored.ownerPubky, stored.peerPubky);
  await closeQuietly(pending.handshakeLinkId);
  pendingEstablishedRekeys.delete(key);
  await StorageService.recordLastSeenPeerMarkerPk(
    stored.ownerPubky,
    stored.peerPubky,
    pending.marker.noisePublicKey,
  );
  return blockedEstablishedRekeyOutcome(stored, pending.marker.noisePublicKey);
}

function pkPrefix8(pk: string | null | undefined): string {
  const raw = (pk ?? '').replace(/^pubky/i, '');
  return raw.length === 0 ? 'empty' : raw.slice(0, 8);
}

function peerMarkerRefreshDue(ownerPubky: PubkyKey, peerPubky: PubkyKey): boolean {
  const last = peerMarkerRefreshedAt.get(linkKey(ownerPubky, peerPubky));
  if (last === undefined) return true;
  return Date.now() - last >= PEER_MARKER_REFRESH_TTL_MS;
}

function markPeerMarkerRefreshed(ownerPubky: PubkyKey, peerPubky: PubkyKey): void {
  peerMarkerRefreshedAt.set(linkKey(ownerPubky, peerPubky), Date.now());
}

/**
 * Responder re-key (two-phase): keep the established handle until the new
 * handshake reaches `established` (msg3) or first successful inbound decrypt.
 */
async function maybeAdoptEstablishedRekey(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  localPath: string,
  expectedOwner: PubkyKey,
  expectedQueueGen: number,
  intent: LinkIntent,
): Promise<EnsureOutcome | null> {
  const advanced = await advancePendingEstablishedRekey(
    activeSession,
    receiver,
    stored,
    ownerPubky,
    peerPubky,
    expectedOwner,
    expectedQueueGen,
    intent,
  );
  if (advanced !== undefined) return advanced;

  if (!peerMarkerRefreshDue(ownerPubky, peerPubky) && intent !== 'user') {
    return blockedEstablishedRekeyOutcome(stored);
  }

  if (!(await inboundStillAllowed(ownerPubky, peerPubky, expectedOwner))) return null;
  abortIfOwnerChanged(expectedOwner);

  markPeerMarkerRefreshed(ownerPubky, peerPubky);
  let marker: ReceiverMarker | null | undefined;
  try {
    marker = await fetchPeerReceiverMarker(ownerPubky, peerPubky, localPath);
    abortIfOwnerChanged(expectedOwner);
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    return blockedEstablishedRekeyOutcome(stored);
  }
  if (!marker) return blockedEstablishedRekeyOutcome(stored);

  const establishedPk = establishedRemotePk(stored);
  console.warn(
    `[LinkService] rekey-marker peer=${opaquePeerId(ownerPubky, peerPubky)} stored=${pkPrefix8(establishedPk)} lastSeen=${pkPrefix8(stored.lastSeenPeerMarkerPk)} fetched=${pkPrefix8(marker.noisePublicKey)}`,
  );
  await StorageService.recordLastSeenPeerMarkerPk(ownerPubky, peerPubky, marker.noisePublicKey);
  stored = { ...stored, lastSeenPeerMarkerPk: marker.noisePublicKey };
  if (establishedPk !== '' && marker.noisePublicKey === establishedPk) {
    return null;
  }

  if (intent !== 'user') {
    const budget = await StorageService.getHandshakeBudget(ownerPubky, peerPubky);
    abortIfOwnerChanged(expectedOwner);
    if (budget && budget.nextAdvanceAt > Date.now()) {
      return blockedEstablishedRekeyOutcome(stored, marker.noisePublicKey);
    }
    if (budget && budget.exhaustedAt !== null) {
      return blockedEstablishedRekeyOutcome(stored, marker.noisePublicKey);
    }
  }

  if (intent !== 'user' && !establishedRekeyParkAllowed(ownerPubky, peerPubky)) {
    return blockedEstablishedRekeyOutcome(stored, marker.noisePublicKey);
  }

  if (!(await inboundStillAllowed(ownerPubky, peerPubky, expectedOwner))) return null;
  abortIfOwnerChanged(expectedOwner);

  let inbound: Extract<LinkProbeResult, { result: 'pending' | 'established' }> | null;
  try {
    inbound = await probeInbound(activeSession, receiver, ownerPubky, peerPubky, marker, localPath);
    abortIfOwnerChanged(expectedOwner);
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'protocol') {
      return blockedEstablishedRekeyOutcome(stored, marker.noisePublicKey);
    }
    throw err;
  }
  if (inbound !== null) {
    if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
      await closeQuietly(inbound.linkId);
      return blockedEstablishedRekeyOutcome(stored, marker.noisePublicKey);
    }
    if (!(await inboundStillAllowed(ownerPubky, peerPubky, expectedOwner))) {
      await closeQuietly(inbound.linkId);
      return blockedEstablishedRekeyOutcome(stored, marker.noisePublicKey);
    }
    abortIfOwnerChanged(expectedOwner);

    if (inbound.result === 'established') {
      return commitEstablishedRekey(
        activeSession,
        receiver,
        stored,
        ownerPubky,
        peerPubky,
        marker,
        localPath,
        inbound,
        expectedOwner,
        expectedQueueGen,
      );
    }

    const parkCharge = await chargeEstablishedRekeyPark(ownerPubky, peerPubky, expectedOwner);
    abortIfOwnerChanged(expectedOwner);
    if (parkCharge.exhausted) {
      await closeQuietly(inbound.linkId);
      return blockedEstablishedRekeyOutcome(stored, marker.noisePublicKey);
    }

    pendingEstablishedRekeys.set(linkKey(ownerPubky, peerPubky), {
      handshakeLinkId: inbound.linkId,
      snapshot: inbound.snapshot,
      marker,
      localPath,
      startedAt: Date.now(),
      role: 'responder',
    });
    const stepped = await advancePendingEstablishedRekey(
      activeSession,
      receiver,
      stored,
      ownerPubky,
      peerPubky,
      expectedOwner,
      expectedQueueGen,
      intent,
    );
    if (stepped !== undefined) return stepped;
    return 'handshaking-responder';
  }

  return blockedEstablishedRekeyOutcome(stored, marker.noisePublicKey);
}

async function advancePendingEstablishedRekey(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  expectedOwner: PubkyKey,
  expectedQueueGen: number,
  intent: LinkIntent,
): Promise<EnsureOutcome | null | undefined> {
  const key = linkKey(ownerPubky, peerPubky);
  const pending = pendingEstablishedRekeys.get(key);
  if (!pending) return undefined;

  if (Date.now() - pending.startedAt >= HANDSHAKE_STALE_MS) {
    return dropParkedEstablishedRekey(stored, pending);
  }
  if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
    return dropParkedEstablishedRekey(stored, pending);
  }
  if (!(await inboundStillAllowed(ownerPubky, peerPubky, expectedOwner))) {
    return dropParkedEstablishedRekey(stored, pending);
  }
  abortIfOwnerChanged(expectedOwner);

  if (intent !== 'user') {
    const held = await StorageService.getHandshakeBudget(ownerPubky, peerPubky);
    abortIfOwnerChanged(expectedOwner);
    if (held && held.nextAdvanceAt > Date.now()) {
      return roleStatus(pending.role);
    }
  }

  try {
    const result = await PaykitLinkNative.advanceHandshake(pending.handshakeLinkId);
    abortIfOwnerChanged(expectedOwner);
    if (result.status === 'established') {
      pendingEstablishedRekeys.delete(key);
      return commitEstablishedRekey(
        activeSession,
        receiver,
        stored,
        ownerPubky,
        peerPubky,
        pending.marker,
        pending.localPath,
        { result: 'established', linkId: pending.handshakeLinkId, snapshot: result.snapshot },
        expectedOwner,
        expectedQueueGen,
      );
    }
    const budget = await chargeHandshakeBudget(
      ownerPubky,
      peerPubky,
      {
        reason: 'pending-advance',
        intent,
      },
      expectedOwner,
    );
    abortIfOwnerChanged(expectedOwner);
    if (budget.exhausted) {
      return dropParkedEstablishedRekey(stored, pending);
    }
    pending.snapshot = result.snapshot;
    pendingEstablishedRekeys.set(key, pending);
    return roleStatus(pending.role);
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    return dropParkedEstablishedRekey(stored, pending);
  }
}

async function drainEstablishedBestEffort(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  expectedQueueGen: number,
): Promise<void> {
  try {
    await persistInboundWithoutRouting(ownerPubky, peerPubky, expectedQueueGen);
  } catch {
    // Best-effort drain; close still proceeds.
  }
}

async function commitEstablishedRekey(
  _activeSession: ActiveSession,
  _receiver: LinkReceiver,
  stored: LinkRecord,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
  inbound: Extract<LinkProbeResult, { result: 'established' }>,
  expectedOwner: PubkyKey,
  expectedQueueGen: number,
): Promise<EnsureOutcome> {
  abortIfOwnerChanged(expectedOwner);
  await drainEstablishedBestEffort(ownerPubky, peerPubky, expectedQueueGen);
  abortIfOwnerChanged(expectedOwner);
  const latest = (await StorageService.getLink(ownerPubky, peerPubky)) ?? stored;
  await StorageService.upsertArchivedLink(latest);
  const key = linkKey(ownerPubky, peerPubky);
  const live = liveHandles.get(key);
  if (live && live.linkId !== inbound.linkId) {
    await closeQuietly(live.linkId);
    liveHandles.delete(key);
  }
  pendingEstablishedRekeys.delete(key);
  abortIfOwnerChanged(expectedOwner);
  if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
    await closeQuietly(inbound.linkId);
    return 'idle';
  }
  return adoptInboundHandshake(
    ownerPubky,
    peerPubky,
    marker,
    localPath,
    inbound,
    expectedOwner,
    expectedQueueGen,
  );
}

async function restoreEstablished(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  intent: LinkIntent,
  alreadyRecovered: boolean,
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome> {
  const localPath = coerceReceiverPath(stored.localReceiverPath);
  const remotePath = coerceReceiverPath(stored.remoteReceiverPath);
  try {
    abortIfOwnerChanged(expectedOwner);
    const { linkId } = await PaykitLinkNative.restoreLink(
      activeSession.alias,
      receiver.receiverAlias,
      stored.peerPubky,
      stored.remoteNoisePublicKey,
      localPath,
      remotePath,
      stored.snapshot,
    );
    abortIfOwnerChanged(expectedOwner);
    liveHandles.set(linkKey(stored.ownerPubky, stored.peerPubky), {
      status: 'established',
      linkId,
    });
    await StorageService.resetLinkConsecutiveFailures(stored.ownerPubky, stored.peerPubky);
    return 'ready';
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    return handleLinkFailure(err, stored, intent, alreadyRecovered, expectedOwner);
  }
}

async function restoreAndAdvanceHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  intent: LinkIntent,
  alreadyRecovered: boolean,
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome> {
  const localPath = coerceReceiverPath(stored.localReceiverPath);
  const remotePath = coerceReceiverPath(stored.remoteReceiverPath);
  try {
    abortIfOwnerChanged(expectedOwner);
    const restored = await PaykitLinkNative.restoreHandshake(
      activeSession.alias,
      receiver.receiverAlias,
      stored.peerPubky,
      stored.remoteNoisePublicKey,
      localPath,
      remotePath,
      stored.snapshot,
    );
    abortIfOwnerChanged(expectedOwner);
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
        expectedOwner,
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
      expectedOwner,
    );
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    const current = await StorageService.getLink(stored.ownerPubky, stored.peerPubky);
    return handleLinkFailure(err, current ?? stored, intent, alreadyRecovered, expectedOwner);
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
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome> {
  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);
  try {
    abortIfOwnerChanged(expectedOwner);
    const result = await PaykitLinkNative.advanceHandshake(live.linkId);
    abortIfOwnerChanged(expectedOwner);
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
        expectedOwner,
      );
    }

    // `pending` is a real Noise XX step, not a failure — but it is also the
    // shape of a peer that answered once and went silent, so it has to cost
    // something. What it costs is decided in one place: see the charge policy on
    // `chargeHandshakeBudget`. Charged BEFORE persisting the snapshot: a crash
    // between the two loses a handshake step, never a charge.
    const budget = await chargeHandshakeBudget(
      ownerPubky,
      peerPubky,
      {
        reason: 'pending-advance',
        intent,
      },
      expectedOwner,
    );
    abortIfOwnerChanged(expectedOwner);
    await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, result.snapshot, 'handshaking');
    abortIfOwnerChanged(expectedOwner);

    if (budget.exhausted) {
      return abandonUnestablishedLink(
        stored ?? fallbackLinkRecord(ownerPubky, peerPubky, receiver, live.role),
        expectedOwner,
      );
    }

    if (live.role === 'initiator') {
      const recovered = await maybeRecoverInitiatorMarkerRotation(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        live,
        stored,
        result.snapshot,
        alreadyRecovered,
        intent,
        expectedOwner,
      );
      if (recovered !== null) return recovered;
    }

    if (live.role === 'initiator' && ownerPubky < peerPubky) {
      const marker = await fetchPeerReceiverMarker(ownerPubky, peerPubky, LINK_RECEIVER_PATH);
      abortIfOwnerChanged(expectedOwner);
      if (marker) {
        const inbound = await probeInbound(
          activeSession,
          receiver,
          ownerPubky,
          peerPubky,
          marker,
          LINK_RECEIVER_PATH,
        );
        abortIfOwnerChanged(expectedOwner);
        if (inbound !== null) {
          await closeQuietly(live.linkId);
          liveHandles.delete(linkKey(ownerPubky, peerPubky));
          return adoptInboundHandshake(
            ownerPubky,
            peerPubky,
            marker,
            LINK_RECEIVER_PATH,
            inbound,
            expectedOwner,
            currentQueueGeneration(ownerPubky, peerPubky),
          );
        }
      }
    }

    return roleStatus(live.role);
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    // Re-read: `completeEstablished` persists `established` before restoring
    // the transport handle, so the row read above can be stale by exactly one
    // transition. Charging handshake failures against a row that is already
    // established would wipe a live link.
    const current = await StorageService.getLink(ownerPubky, peerPubky);
    const fallback = current ?? fallbackLinkRecord(ownerPubky, peerPubky, receiver, live.role);
    return handleLinkFailure(err, fallback, intent, alreadyRecovered, expectedOwner);
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
    lastSeenPeerMarkerPk: null,
    createdAt: Date.now(),
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
  | { reason: 'unestablished-wipe' }
  /** A new parked established re-key: never throttled, counted in the park window. */
  | { reason: 'established-rekey-park' };

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
  expectedOwner: PubkyKey,
): Promise<{ advances: number; exhausted: boolean }> {
  const current = await StorageService.getHandshakeBudget(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);
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
  abortIfOwnerChanged(expectedOwner);
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
async function abandonUnestablishedLink(
  stored: LinkRecord,
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome> {
  abortIfOwnerChanged(expectedOwner);
  console.warn(
    `[LinkService] handshake-abandoned peer=${opaquePeerId(stored.ownerPubky, stored.peerPubky)} after ` +
      `${HANDSHAKE_PENDING_ADVANCE_LIMIT} steps`,
  );
  await failQueuedSendsForPeer(stored.ownerPubky, stored.peerPubky);
  abortIfOwnerChanged(expectedOwner);
  await wipeLinkState(stored, expectedOwner);
  return 'error';
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
  expectedOwner: PubkyKey,
): Promise<LinkStatus> {
  abortIfOwnerChanged(expectedOwner);
  // A completed Noise XX handshake is proof of a real counterparty, so it is
  // the one non-user event that forgives everything charged against this peer.
  await StorageService.clearHandshakeBudget(ownerPubky, peerPubky);
  abortIfOwnerChanged(expectedOwner);
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
  abortIfOwnerChanged(expectedOwner);
  await closeQuietly(handshakeLinkId);
  const key = linkKey(ownerPubky, peerPubky);
  try {
    abortIfOwnerChanged(expectedOwner);
    const { linkId } = await PaykitLinkNative.restoreLink(
      activeSession.alias,
      receiver.receiverAlias,
      peerPubky,
      remoteNoisePublicKey,
      localPath,
      remotePath,
      snapshot,
    );
    abortIfOwnerChanged(expectedOwner);
    liveHandles.set(key, { status: 'established', linkId });
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    liveHandles.delete(key);
    throw err;
  }
  // Do not clearLinkOutbox here. That primitive deletes every slot on our
  // write path, including unconsumed msg3 (Noise XX: initiator is Complete
  // the instant msg3 is PUT; the responder still has to read it) and any
  // unread transport slots. There is no protocol ack that msg1 was consumed,
  // so a slot-scoped delete is also unsafe until paykit grows one. Orphan
  // msg1 stays as garbage; see docs/DECISIONS.md (P1-1 backlog).
  return 'ready';
}

/**
 * Orphan-marker case (J3/J5/J19): a session that published `receiver.json`
 * then signed out leaves that pk live. Standby siblings never published, so
 * their local receiver secret ≠ the published pk. A peer answering XX msg1
 * derives the inbound slot from the published key; this device never sees
 * msg2. Initiator recovery (C) re-GETs the *peer* marker and cannot unstick
 * our own marker. Recovery is explicit takeover: publish this device's pk,
 * wipe unestablished handshakes + outbox slots, then re-initiate.
 */
async function initiateHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
  intent: LinkIntent,
  alreadyRecovered: boolean,
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome> {
  abortIfOwnerChanged(expectedOwner);
  if (receiver.receiverRole === 'standby') return 'standby-blocked';
  const remotePath = LINK_RECEIVER_PATH;
  const initiated = await PaykitLinkNative.initiateLink(
    activeSession.alias,
    receiver.receiverAlias,
    peerPubky,
    marker.noisePublicKey,
    localPath,
    remotePath,
  );
  abortIfOwnerChanged(expectedOwner);
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
    lastSeenPeerMarkerPk: marker.noisePublicKey,
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
    expectedOwner,
  );
}

/**
 * GET-only. Never PUTs. Fetch failure is not absence. Foreign pk → standby.
 */
async function ensureOwnReceiverMarkerMatches(
  _activeSession: ActiveSession,
  _receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  _localPath: string,
  expectedOwner: PubkyKey,
): Promise<void> {
  if (ownMarkerSyncIsFresh(ownerPubky)) return;
  abortIfOwnerChanged(expectedOwner);
  await syncOwnReceiverRole(ownerPubky);
  abortIfOwnerChanged(expectedOwner);
  markOwnMarkerSynced(ownerPubky);
}

/**
 * Atomic inbound probe. `none` is not an error and leaves prior state
 * untouched (the reference discards failed / empty probes).
 */
async function probeInbound(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
): Promise<Extract<LinkProbeResult, { result: 'pending' | 'established' }> | null> {
  try {
    const startedAt = Date.now();
    console.warn(
      `[LinkService] inbound-probe begin peer=${opaquePeerId(ownerPubky, peerPubky)} probePk=${pkPrefix8(marker.noisePublicKey)} slotFrom=fetched-marker`,
    );
    const probed = await PaykitLinkNative.probeInboundLink(
      activeSession.alias,
      receiver.receiverAlias,
      peerPubky,
      marker.noisePublicKey,
      localPath,
      LINK_RECEIVER_PATH,
    );
    const durationMs = Date.now() - startedAt;
    if (probed.result === 'none') {
      console.warn(
        `[LinkService] inbound-probe result=none durationMs=${durationMs} peer=${opaquePeerId(ownerPubky, peerPubky)}`,
      );
      return null;
    }
    console.warn(
      `[LinkService] inbound-probe result=${probed.result} durationMs=${durationMs} peer=${opaquePeerId(ownerPubky, peerPubky)}`,
    );
    return probed;
  } catch (err) {
    console.warn(
      `[LinkService] inbound-probe-failed peer=${opaquePeerId(ownerPubky, peerPubky)}:`,
      errorMessage(err),
    );
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
  expectedOwner: PubkyKey,
  expectedQueueGen: number,
): Promise<EnsureOutcome> {
  abortIfOwnerChanged(expectedOwner);
  if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
    await closeQuietly(inbound.linkId);
    return 'idle';
  }
  if (!(await inboundStillAllowed(ownerPubky, peerPubky, expectedOwner))) {
    await closeQuietly(inbound.linkId);
    return 'denied';
  }
  const remotePath = LINK_RECEIVER_PATH;
  const key = linkKey(ownerPubky, peerPubky);
  if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
    await closeQuietly(inbound.linkId);
    return 'idle';
  }
  const existing = liveHandles.get(key);
  if (existing && existing.linkId !== inbound.linkId) {
    await closeQuietly(existing.linkId);
  }
  if (inbound.result === 'established') {
    await StorageService.clearHandshakeBudget(ownerPubky, peerPubky);
    abortIfOwnerChanged(expectedOwner);
    if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
      await closeQuietly(inbound.linkId);
      return 'idle';
    }
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
      lastSeenPeerMarkerPk: marker.noisePublicKey,
    });
    liveHandles.set(key, { status: 'established', linkId: inbound.linkId });
    return 'ready';
  }

  if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
    await closeQuietly(inbound.linkId);
    return 'idle';
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
    lastSeenPeerMarkerPk: marker.noisePublicKey,
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
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome> {
  if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
  if (isLinkNativeError(err) && err.code === 'unavailable') return 'native-missing';
  if (isLinkNativeError(err) && err.code === 'auth') {
    KeyStore.deleteLinkSession();
    session = null;
    return 'needs-enable';
  }
  abortIfOwnerChanged(expectedOwner);
  const established = stored.status === 'established';
  if (isLinkNativeError(err) && err.code === 'network') {
    if (established) {
      console.warn(
        `[LinkService] established-restore-deferred peer=${opaquePeerId(stored.ownerPubky, stored.peerPubky)}:`,
        errorMessage(err),
      );
      return 'ready';
    }
    const failures = await StorageService.incrementLinkConsecutiveFailures(
      stored.ownerPubky,
      stored.peerPubky,
    );
    if (failures >= HANDSHAKE_FAILURE_LIMIT) {
      return recoverWedgedLink(stored, intent, alreadyRecovered, err, expectedOwner);
    }
    return roleStatus(stored.role);
  }
  if (isLinkNativeError(err) && err.code === 'protocol') {
    return recoverWedgedLink(stored, intent, alreadyRecovered, err, expectedOwner);
  }

  if (established) {
    console.warn(
      `[LinkService] established-step-failed peer=${opaquePeerId(stored.ownerPubky, stored.peerPubky)}:`,
      errorMessage(err),
    );
    return 'ready';
  }

  const failures = await StorageService.incrementLinkConsecutiveFailures(
    stored.ownerPubky,
    stored.peerPubky,
  );
  if (failures >= HANDSHAKE_FAILURE_LIMIT) {
    return recoverWedgedLink(stored, intent, alreadyRecovered, err, expectedOwner);
  }
  console.warn(
    `[LinkService] handshake-step-failed peer=${opaquePeerId(stored.ownerPubky, stored.peerPubky)}:`,
    errorMessage(err),
  );
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
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome> {
  abortIfOwnerChanged(expectedOwner);
  const protocol = isLinkNativeError(cause) && cause.code === 'protocol';
  if (protocol) {
    try {
      const marker = await fetchPeerReceiverMarker(
        stored.ownerPubky,
        stored.peerPubky,
        LINK_RECEIVER_PATH,
      );
      abortIfOwnerChanged(expectedOwner);
      if (
        marker &&
        stored.remoteNoisePublicKey &&
        marker.noisePublicKey !== stored.remoteNoisePublicKey
      ) {
        console.warn(
          `[LinkService] peer-re-enrolled peer=${opaquePeerId(stored.ownerPubky, stored.peerPubky)}; restarting handshake`,
        );
      }
    } catch (err) {
      if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
      // Marker fetch failing does not block the wipe — the handshake is wedged.
    }
  }

  if (stored.status !== 'established') {
    const budget = await chargeHandshakeBudget(
      stored.ownerPubky,
      stored.peerPubky,
      {
        reason: 'unestablished-wipe',
      },
      expectedOwner,
    );
    if (budget.exhausted) return abandonUnestablishedLink(stored, expectedOwner);
  }

  await wipeLinkState(stored, expectedOwner);

  if (alreadyRecovered) return 'error';
  return ensureLinkLocked(stored.peerPubky, intent, true, expectedOwner);
}

/**
 * C: re-GET the *peer's* receiver.json after N polls / T seconds and
 * restart if that pk rotated. Does not help the orphan-marker case — a
 * standby initiator's own published (or leftover) marker is what the peer
 * answered, and takeover is the recovery.
 */
async function maybeRecoverInitiatorMarkerRotation(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  live: Extract<LiveHandle, { status: 'handshaking' }>,
  stored: LinkRecord | null,
  snapshot: string,
  alreadyRecovered: boolean,
  intent: LinkIntent,
  expectedOwner: PubkyKey,
): Promise<EnsureOutcome | null> {
  abortIfOwnerChanged(expectedOwner);
  const key = linkKey(ownerPubky, peerPubky);
  const watch = handshakeWatch.get(key);
  const now = Date.now();
  if (!watch || watch.snapshot !== snapshot) {
    handshakeWatch.set(key, { polls: 1, firstAt: now, snapshot });
  } else {
    handshakeWatch.set(key, { polls: watch.polls + 1, firstAt: watch.firstAt, snapshot });
  }
  const current = handshakeWatch.get(key)!;
  const due =
    current.polls >= MARKER_RECOVERY_POLL_LIMIT ||
    now - current.firstAt >= MARKER_RECOVERY_TIMEOUT_MS;
  if (!due) return null;

  let marker: ReceiverMarker | null;
  try {
    marker = await fetchPeerReceiverMarker(ownerPubky, peerPubky, LINK_RECEIVER_PATH);
    abortIfOwnerChanged(expectedOwner);
  } catch (err) {
    if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    return null;
  }
  const recorded = stored?.remoteNoisePublicKey ?? stored?.lastSeenPeerMarkerPk ?? '';
  if (!marker || !recorded || marker.noisePublicKey === recorded) {
    handshakeWatch.set(key, { polls: 0, firstAt: now, snapshot });
    return null;
  }

  const row = stored ?? fallbackLinkRecord(ownerPubky, peerPubky, receiver, live.role);
  const budget = await chargeHandshakeBudget(
    ownerPubky,
    peerPubky,
    { reason: 'unestablished-wipe' },
    expectedOwner,
  );
  if (budget.exhausted) return abandonUnestablishedLink(row, expectedOwner);

  await wipeLinkState(row, expectedOwner);
  handshakeWatch.delete(key);
  if (alreadyRecovered) return 'error';
  if (!mayInitiate(intent)) return 'idle';
  return initiateHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    marker,
    coerceReceiverPath(receiver.receiverPath),
    intent,
    true,
    expectedOwner,
  );
}

/**
 * Wipe a pending responder handshake and accept the current msg1. Charges
 * `unestablished-wipe` (never throttled) so a flapping marker cannot loop
 * for free. Completing XX later still clears the budget.
 */
async function restartResponderFromFreshMsg1(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  stored: LinkRecord,
  marker: ReceiverMarker | null | undefined,
  localPath: string,
  alreadyRecovered: boolean,
  expectedOwner: PubkyKey,
  expectedQueueGen: number,
): Promise<EnsureOutcome> {
  abortIfOwnerChanged(expectedOwner);
  const budget = await chargeHandshakeBudget(
    ownerPubky,
    peerPubky,
    { reason: 'unestablished-wipe' },
    expectedOwner,
  );
  if (budget.exhausted) return abandonUnestablishedLink(stored, expectedOwner);

  await wipeLinkState(stored, expectedOwner);
  abortIfOwnerChanged(expectedOwner);
  if (alreadyRecovered) return 'error';

  let nextMarker = marker && marker.noisePublicKey ? marker : null;
  if (!nextMarker) {
    try {
      nextMarker = await fetchPeerReceiverMarker(ownerPubky, peerPubky, localPath);
      abortIfOwnerChanged(expectedOwner);
    } catch (err) {
      if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
      return 'idle';
    }
  }
  if (!nextMarker) return 'idle';

  let inbound: Extract<LinkProbeResult, { result: 'pending' | 'established' }> | null;
  try {
    inbound = await probeInbound(
      activeSession,
      receiver,
      ownerPubky,
      peerPubky,
      nextMarker,
      localPath,
    );
    abortIfOwnerChanged(expectedOwner);
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'protocol') {
      abortIfOwnerChanged(expectedOwner);
      await clearPeerOutboxBestEffort(
        activeSession,
        receiver,
        peerPubky,
        nextMarker.noisePublicKey,
        localPath,
        LINK_RECEIVER_PATH,
      );
      abortIfOwnerChanged(expectedOwner);
      return 'idle';
    }
    throw err;
  }
  if (inbound === null) {
    await failQueuedSendsForPeer(ownerPubky, peerPubky);
    abortIfOwnerChanged(expectedOwner);
    return 'idle';
  }
  if (queueGenerationChanged(ownerPubky, peerPubky, expectedQueueGen)) {
    await closeQuietly(inbound.linkId);
    return 'idle';
  }
  return adoptInboundHandshake(
    ownerPubky,
    peerPubky,
    nextMarker,
    localPath,
    inbound,
    expectedOwner,
    expectedQueueGen,
  );
}

async function wipeLinkState(stored: LinkRecord, expectedOwner: PubkyKey): Promise<void> {
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
  const receiver = await StorageService.getLinkReceiver(stored.ownerPubky);
  abortIfOwnerChanged(expectedOwner);
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
  abortIfOwnerChanged(expectedOwner);
  await StorageService.deleteArchivedLink(stored.ownerPubky, stored.peerPubky);
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
    await emitReceiptIfEnabled(ownerPubky, peerPubky, 'delivered', ids, channelId);
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
    await wipeLinkState(leftover, leftover.ownerPubky);
    return;
  }
  const lookup = await sessionOrRestore();
  if (!isActiveSession(lookup)) return;
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  if (!receiver) return;
  try {
    const marker = await fetchPeerReceiverMarker(ownerPubky, peerPubky, LINK_RECEIVER_PATH);
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
      if (stored) await recoverWedgedLink(stored, 'background', false, err, ownerPubky);
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
  const deliveredDmIds: string[] = [];
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
    if (peeked === CHAT_TAG_KIND || peeked === CHAT_RECEIPT_KIND || peeked === CHAT_REACTION_KIND) {
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
    await StorageService.markLinkStreamItemProcessed(item.id);
    received.push(row);
    deliveredDmIds.push(row.eventId);
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
      const control = payload.kind === CHAT_TAG_KIND || payload.kind === CHAT_RECEIPT_KIND;
      if (!control) {
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
      }
    } else {
      const control = payload.kind === CHAT_TAG_KIND || payload.kind === CHAT_RECEIPT_KIND;
      if (!control) {
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
    }

    let outcome: EnsureOutcome;
    try {
      outcome = await ensureLinkLocked(payload.peerPubky, 'queued', false, payload.ownerPubky);
    } catch (err) {
      if (err instanceof LinkSendError && err.code === 'owner-changed') return;
      if (isTransientLinkError(err)) {
        await RetryQueue.defer(item.id, item.attempts);
        return;
      }
      await dropQueuedPayloadPermanently(item, payload);
      return;
    }

    if (outcome === 'denied') {
      await dropQueuedPayloadDenied(item, payload);
      return;
    }

    if (outcome === 'deny-unavailable' || outcome !== 'ready') {
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
      abortIfOwnerChanged(payload.ownerPubky);
      const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, wireJson);
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
  await withQueue(peerPubky, async () => {
    abortIfOwnerChanged(ownerPubky);
    let outcome: EnsureOutcome;
    try {
      outcome = await ensureLinkLocked(peerPubky, 'user', false, ownerPubky);
    } catch {
      outcome = 'handshaking-initiator';
    }
    abortIfOwnerChanged(ownerPubky);
    const item = queueItemForPeer(ownerPubky, peerPubky, eventId, rawJson, kind);
    if (typeof StorageService.persistControlSendIntent !== 'function') return;
    await StorageService.persistControlSendIntent({ ownerPubky, queueItem: item });
    if (outcome !== 'ready') return;
    try {
      const handle = requireEstablishedHandle(ownerPubky, peerPubky);
      const wireJson = await wireJsonForNativeSend(kind, rawJson, ownerPubky, ownerPubky, eventId);
      const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, wireJson);
      await StorageService.finalizeControlSend({
        ownerPubky,
        peerPubky,
        snapshot,
        queueId: item.id,
      });
    } catch (err) {
      if (err instanceof LinkSendError && err.code === 'owner-changed') throw err;
    }
  });
}

async function emitReceiptIfEnabled(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  status: 'delivered' | 'read',
  eventIds: string[],
  channelId?: string,
  peerKnownV1?: boolean,
): Promise<void> {
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
    const handle = requireEstablishedHandle(input.ownerPubky, input.peerPubky);
    const wireJson = await wireJsonForNativeSend(
      input.kind,
      persistJson,
      input.ownerPubky,
      input.ownerPubky,
      input.eventId,
    );
    abortIfOwnerChanged(input.ownerPubky);
    const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, wireJson);
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
      `LinkService: missing established link handle peer=${opaquePeerId(ownerPubky, peerPubky)}`,
    );
  }
  return live.linkId;
}

function isCurrentOwner(ownerPubky: PubkyKey): boolean {
  return activeOwnerAtCommit() === ownerPubky;
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
  try {
    await PaykitLinkNative.closeLink(linkId);
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'unavailable') throw err;
  }
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

function resetPeerQueue(ownerPubky: PubkyKey, peerPubky: PubkyKey): void {
  const key = `${ownerPubky}:${peerPubky}`;
  queues.delete(key);
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
