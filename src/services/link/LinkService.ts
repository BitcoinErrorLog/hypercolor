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
import {
  RING_GRANT_CAPABILITIES,
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
  type LinkStreamItemInput,
} from '../../types/link';
import type { DeliveryQueueItem, PubkyKey } from '../../types';
import {
  decodeGroupEnvelope,
  isGroupWireKind,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  peekEnvelopeKind,
} from '../../types/group';
import { applyGroupInbound } from '../group/applyGroupInbound';
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

export const LINK_RETRY_DRAIN_INTERVAL_MS = 30_000;

export type LinkEnableFlow = {
  authorizationUrl: string;
  awaitEnabled: () => Promise<{ pubky: string; receiverPath: string; noisePublicKey: string }>;
  cancel: () => void;
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

let session: ActiveSession | null = null;
let restoreInFlight: Promise<SessionLookup> | null = null;
const liveHandles = new Map<string, LiveHandle>();
/** Native session aliases that still exist in this process (slot-switch). */
const nativeSessions = new Map<string, string>();
const queues = new Map<string, Promise<unknown>>();
let drainTimer: ReturnType<typeof setInterval> | null = null;
const inboxSyncListeners = new Set<(ownerPubky: PubkyKey) => void>();

export const LinkService = {
  // ── Session ───────────────────────────────────────────────────────────────

  /**
   * Dev/e2e only — production uses {@link enable} (Ring pubkyauth).
   * Signs in with an identity secret; native stores the bearer under an
   * alias. The secret is not persisted in JS.
   */
  async signinWithSecret(identitySecretHex: string): Promise<{ pubky: string }> {
    const { sessionAlias, pubky } = await PaykitLinkNative.signinWithSecret(identitySecretHex);
    KeyStore.setPubky(pubky);
    KeyStore.setLinkSession(sessionAlias);
    session = { alias: sessionAlias, pubky };
    rememberNativeSession(sessionAlias, pubky);
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
    nativeSessions.clear();
    queues.clear();
    KeyStore.deleteLinkSession();
  },

  /**
   * Live-proof / test harness: adopt an already-created native session
   * (`signupWithSecret`) without signing in again and without wiping
   * other parties' live handles. Used to switch A/B/C on one process.
   */
  async adoptHarnessSession(sessionAlias: string, pubky: string): Promise<void> {
    const alias = sessionAlias.trim();
    const id = pubky.trim();
    if (alias.length === 0 || id.length === 0) {
      throw new Error('LinkService.adoptHarnessSession: sessionAlias and pubky are required');
    }
    KeyStore.setPubky(id);
    KeyStore.setLinkSession(alias);
    session = { alias, pubky: id };
    rememberNativeSession(alias, id);
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
   */
  async enable(): Promise<LinkEnableFlow> {
    if (!PaykitLinkNative.isAvailable()) {
      throw createLinkNativeError('unavailable', 'PaykitLinkModule native module is not available');
    }
    const { flowId, authorizationUrl } =
      await PaykitLinkNative.startAuthFlow(RING_GRANT_CAPABILITIES);
    let cancelled = false;
    return {
      authorizationUrl,
      cancel: () => {
        cancelled = true;
      },
      awaitEnabled: async () => {
        const { sessionAlias, pubky } = await PaykitLinkNative.awaitAuthApproval(flowId);
        if (cancelled) {
          try {
            await PaykitLinkNative.signOutSession(sessionAlias);
          } catch {
            // Detached flow: drop the unused session.
          }
          throw new Error('LinkService.enable: the messaging enable flow was cancelled');
        }
        KeyStore.setPubky(pubky);
        KeyStore.setLinkSession(sessionAlias);
        session = { alias: sessionAlias, pubky };
        rememberNativeSession(sessionAlias, pubky);
        return provisionReceiver(sessionAlias, pubky);
      },
    };
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
        const outcome = await ensureLinkLocked(peerPubky, true, false);
        return outcome === 'idle' ? 'error' : outcome;
      } catch (err) {
        if (isLinkNativeError(err) && err.code === 'unavailable') return 'native-missing';
        console.warn(`[LinkService] ensureLinkWith failed for ${peerPubky}:`, errorMessage(err));
        return 'error';
      }
    });
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
      const outcome = await ensureLinkLocked(peerPubky, true, false);
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
      const outcome = await ensureLinkLocked(input.peerPubky, true, false);
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
      outcome = await ensureLinkLocked(input.peerPubky, true, false);
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
        outcome = await ensureLinkLocked(input.peerPubky, true, false);
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
   */
  async drainRetries(): Promise<void> {
    const due = await RetryQueue.getDue();
    for (const item of due) {
      const payload = parseRetryPayload(item.payload);
      if (!payload || !isCurrentOwner(payload.ownerPubky)) continue;
      await deliverQueuedPayload(item, payload);
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
   */
  async acceptMessageRequest(peerPubky: PubkyKey): Promise<LinkMessage[]> {
    return withQueue(peerPubky, async () => {
      const ownerPubky = requireOwner();
      const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
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
   * held stream/message rows, and persist `declined`.
   */
  async declineMessageRequest(peerPubky: PubkyKey): Promise<void> {
    return withQueue(peerPubky, async () => {
      const ownerPubky = requireOwner();
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      if (stored) await wipeLinkState(stored);
      await StorageService.deleteLinkStreamItemsForPeer(ownerPubky, peerPubky);
      await StorageService.deleteLinkMessagesForPeer(ownerPubky, peerPubky);
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
    void LinkService.drainRetries();
  }, intervalMs);
  return stopLinkRetryDrain;
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
  nativeSessions.clear();
  queues.clear();
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
    rememberNativeSession(stored, pubky);
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

async function ensureLinkLocked(
  peerPubky: PubkyKey,
  allowInitiate: boolean,
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
  if (live?.status === 'handshaking') {
    return advanceLiveHandshake(
      activeSession,
      receiver,
      ownerPubky,
      peerPubky,
      live,
      alreadyRecovered,
    );
  }

  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  if (stored?.status === 'established') {
    return restoreEstablished(activeSession, receiver, stored, alreadyRecovered);
  }
  if (stored?.status === 'handshaking') {
    return restoreAndAdvanceHandshake(activeSession, receiver, stored, alreadyRecovered);
  }

  const marker = await PaykitLinkNative.getReceiverMarker(peerPubky, localPath);
  if (marker === null) return allowInitiate ? 'not-enrolled' : 'idle';

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
      if (!allowInitiate) return 'idle';
      return initiateHandshake(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        marker,
        localPath,
        alreadyRecovered,
      );
    }
    throw err;
  }
  if (inbound !== null) {
    return adoptInboundHandshake(
      activeSession,
      receiver,
      ownerPubky,
      peerPubky,
      marker,
      localPath,
      inbound,
    );
  }

  if (!allowInitiate) return 'idle';

  return initiateHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    marker,
    localPath,
    alreadyRecovered,
  );
}

async function restoreEstablished(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
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
    return handleLinkFailure(err, stored, alreadyRecovered, true);
  }
}

async function restoreAndAdvanceHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
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
      return completeEstablished(
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
      alreadyRecovered,
    );
  } catch (err) {
    return handleLinkFailure(err, stored, alreadyRecovered, true);
  }
}

async function advanceLiveHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  live: Extract<LiveHandle, { status: 'handshaking' }>,
  alreadyRecovered: boolean,
): Promise<EnsureOutcome> {
  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  try {
    const result = await PaykitLinkNative.advanceHandshake(live.linkId);
    if (result.status === 'established') {
      const remoteKey = stored?.remoteNoisePublicKey ?? '';
      const localPath = coerceReceiverPath(stored?.localReceiverPath ?? receiver.receiverPath);
      const remotePath = coerceReceiverPath(stored?.remoteReceiverPath ?? LINK_RECEIVER_PATH);
      return completeEstablished(
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

    await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, result.snapshot, 'handshaking');

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
          return adoptInboundHandshake(
            activeSession,
            receiver,
            ownerPubky,
            peerPubky,
            marker,
            LINK_RECEIVER_PATH,
            inbound,
          );
        }
      }
    }

    await nudgeCounterpartHandshake(ownerPubky, peerPubky);
    const stepped = await PaykitLinkNative.advanceHandshake(live.linkId);
    if (stepped.status === 'established') {
      const remoteKey = stored?.remoteNoisePublicKey ?? '';
      const localPath = coerceReceiverPath(stored?.localReceiverPath ?? receiver.receiverPath);
      const remotePath = coerceReceiverPath(stored?.remoteReceiverPath ?? LINK_RECEIVER_PATH);
      return completeEstablished(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        live.role,
        stepped.snapshot,
        remoteKey,
        localPath,
        remotePath,
        live.linkId,
      );
    }
    await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, stepped.snapshot, 'handshaking');

    return roleStatus(live.role);
  } catch (err) {
    const fallback: LinkRecord = stored ?? {
      ownerPubky,
      peerPubky,
      role: live.role,
      status: 'handshaking',
      snapshot: '',
      remoteNoisePublicKey: '',
      localReceiverPath: receiver.receiverPath,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      updatedAt: Date.now(),
    };
    return handleLinkFailure(err, fallback, alreadyRecovered, true);
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
  const { linkId } = await PaykitLinkNative.restoreLink(
    activeSession.alias,
    receiver.receiverAlias,
    peerPubky,
    remoteNoisePublicKey,
    localPath,
    remotePath,
    snapshot,
  );
  liveHandles.set(linkKey(ownerPubky, peerPubky), { status: 'established', linkId });
  return 'ready';
}

async function initiateHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
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
  return advanceLiveHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    { status: 'handshaking', linkId: initiated.linkId, role: 'initiator' },
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
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
  inbound: Extract<LinkProbeResult, { result: 'pending' | 'established' }>,
): Promise<EnsureOutcome> {
  const remotePath = LINK_RECEIVER_PATH;
  const key = linkKey(ownerPubky, peerPubky);
  if (inbound.result === 'established') {
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
  const live: Extract<LiveHandle, { status: 'handshaking' }> = {
    status: 'handshaking',
    linkId: inbound.linkId,
    role: 'responder',
  };
  liveHandles.set(key, live);
  return advanceLiveHandshake(activeSession, receiver, ownerPubky, peerPubky, live, false);
}

/**
 * Noise XX needs both parties to advance. On one process (debug slot-switch)
 * the counterparty handshake handle is still live; drive it so a responder
 * send can finish instead of sitting in `sending` forever.
 */
async function nudgeCounterpartHandshake(localOwner: PubkyKey, peerPubky: PubkyKey): Promise<void> {
  const reverseKey = linkKey(peerPubky, localOwner);
  const existing = liveHandles.get(reverseKey);
  if (existing?.status === 'established') return;

  const stored = await StorageService.getLink(peerPubky, localOwner);
  let live = existing?.status === 'handshaking' ? existing : null;

  if (!live) {
    if (stored?.status !== 'handshaking') return;
    const alias = nativeSessions.get(peerPubky);
    const receiver = await StorageService.getLinkReceiver(peerPubky);
    if (!alias || !receiver) return;
    try {
      const restored = await PaykitLinkNative.restoreHandshake(
        alias,
        receiver.receiverAlias,
        localOwner,
        stored.remoteNoisePublicKey,
        coerceReceiverPath(stored.localReceiverPath),
        coerceReceiverPath(stored.remoteReceiverPath),
        stored.snapshot,
      );
      live = {
        status: 'handshaking',
        linkId: restored.linkId,
        role: stored.role,
      };
      liveHandles.set(reverseKey, live);
    } catch {
      return;
    }
  }

  try {
    const result = await PaykitLinkNative.advanceHandshake(live.linkId);
    if (result.status === 'established') {
      if (stored) {
        await StorageService.upsertLink({
          ownerPubky: peerPubky,
          peerPubky: localOwner,
          role: live.role,
          status: 'established',
          snapshot: result.snapshot,
          remoteNoisePublicKey: stored.remoteNoisePublicKey,
          localReceiverPath: stored.localReceiverPath,
          remoteReceiverPath: stored.remoteReceiverPath,
          consecutiveFailures: 0,
        });
      } else {
        await StorageService.updateLinkSnapshot(
          peerPubky,
          localOwner,
          result.snapshot,
          'established',
        );
      }
      liveHandles.set(reverseKey, { status: 'established', linkId: live.linkId });
      return;
    }
    await StorageService.updateLinkSnapshot(peerPubky, localOwner, result.snapshot, 'handshaking');
  } catch {
    // The counterparty will advance when its own session is active.
  }
}

function rememberNativeSession(alias: string, pubky: string): void {
  nativeSessions.set(pubky, alias);
}

async function handleLinkFailure(
  err: unknown,
  stored: LinkRecord,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
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
      return recoverWedgedLink(stored, alreadyRecovered, allowInitiate, err);
    }
    return roleStatus(stored.role);
  }
  if (isLinkNativeError(err) && err.code === 'protocol') {
    return recoverWedgedLink(stored, alreadyRecovered, allowInitiate, err);
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
    return recoverWedgedLink(stored, alreadyRecovered, allowInitiate, err);
  }
  console.warn(`[LinkService] Handshake step failed for ${stored.peerPubky}:`, errorMessage(err));
  return roleStatus(stored.role);
}

/**
 * Protocol/decrypt error, or N consecutive handshake (not established-network)
 * failures: delete the link row, clear the outbox, and restart a fresh
 * handshake. If the peer marker's noise key changed, this is re-enrollment.
 */
async function recoverWedgedLink(
  stored: LinkRecord,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
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

  await wipeLinkState(stored);

  if (alreadyRecovered) return 'error';
  return ensureLinkLocked(stored.peerPubky, allowInitiate, true);
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
  // Group fan-out is not a DM inbox item. WoT holds chat messages as a
  // request; membership still applies on an established Encrypted Link.
  await routeHeldGroupInbound(ownerPubky, peerPubky);
}

/**
 * Applies group PAMs that arrived while a message request is pending.
 * Chat / attachment / payment items stay unprocessed until accept.
 */
async function routeHeldGroupInbound(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
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
    const groupEnvelope = decodeGroupEnvelope(item.rawJson);
    if (groupEnvelope) {
      await applyGroupInbound({
        ownerPubky,
        senderPubky: peerPubky,
        envelope: groupEnvelope,
        rawJson: item.rawJson,
        receivedAt: item.receivedAt,
      });
    }
    await StorageService.markLinkStreamItemProcessed(item.id);
  }
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
    const outcome = await ensureLinkLocked(peerPubky, false, false);
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

    if (outcome !== 'ready') return routeUnprocessedStreamItems(ownerPubky, peerPubky);

    const swept = await routeUnprocessedStreamItems(ownerPubky, peerPubky);
    const handle = requireEstablishedHandle(ownerPubky, peerPubky);
    const { messages, snapshot } = await PaykitLinkNative.receivePrivateMessages(handle);

    if (messages.length === 0) return swept;

    const arrivedAt = Date.now();
    const streamItems = await prepareInboundStreamItems(ownerPubky, peerPubky, messages, arrivedAt);
    if (streamItems.length > 0) {
      await StorageService.saveLinkStreamItems(streamItems);
    }
    const routed = await routeUnprocessedStreamItems(ownerPubky, peerPubky);
    await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, snapshot, 'established');
    return [...swept, ...routed];
  } catch (err) {
    if (isLinkNativeError(err) && err.code === 'protocol') {
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      if (stored) await recoverWedgedLink(stored, false, false, err);
    }
    throw err;
  }
}

async function routeUnprocessedStreamItems(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
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
      const groupEnvelope = decodeGroupEnvelope(item.rawJson);
      if (groupEnvelope) {
        await applyGroupInbound({
          ownerPubky,
          senderPubky: peerPubky,
          envelope: groupEnvelope,
          rawJson: item.rawJson,
          receivedAt: item.receivedAt,
        });
      }
      await StorageService.markLinkStreamItemProcessed(item.id);
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

async function deliverQueuedPayload(
  item: DeliveryQueueItem,
  payload: AnyLinkRetryPayload,
): Promise<void> {
  await withQueue(payload.peerPubky, async () => {
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
      outcome = await ensureLinkLocked(payload.peerPubky, true, false);
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
