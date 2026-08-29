import { v4 as uuidv4 } from 'uuid';
import {
  PaykitLinkNative,
  createLinkNativeError,
  isLinkNativeError,
  type LinkNativeError,
  type LinkProbeResult,
  type ReceiverMarker,
} from './PaykitLinkNative';
import { StorageService } from '../StorageService';
import { KeyStore } from '../KeyStore';
import { RetryQueue } from '../RetryQueue';
import {
  PAYKIT_MESSAGING_CAPABILITY,
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

/**
 * LinkService — end-to-end-encrypted DMs over official Paykit Encrypted
 * Links (Noise XX over pubky homeserver outboxes), via PaykitLinkNative v2.
 *
 * Secret material never crosses the JS bridge. Snapshots are opaque AEAD
 * ciphertext — this file persists them and passes them back, and never
 * parses them.
 *
 * ## Wiring-step call sites (do NOT hook these from MessageRouter)
 *
 * - `LinkService.enable()` — present `authorizationUrl` on the messaging-
 *   enable surface (QR / open Ring). `AwaitingRingAuthScreen` is the app-
 *   identity grant, not this `/pub/paykit/:rw` flow.
 * - App startup / `AppState` `'active'` (App.tsx or RootNavigator):
 *     `await LinkService.recoverPendingSends();`
 *     `await LinkService.drainRetries();`
 * - Foreground interval: `startLinkRetryDrain()` (30s, matches MessageRouter).
 * - Inbox sync already calls `drainRetries` at the end of `syncInbox`.
 */

/** Discriminator for this transport's items in the shared `delivery_queue`. */
export const LINK_RETRY_PAYLOAD_TYPE = 'link.chat.message';

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

interface LinkRetryPayload {
  type: typeof LINK_RETRY_PAYLOAD_TYPE;
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  senderPubky: PubkyKey;
  kind: string;
  eventId: string;
  rawJson: string;
}

type ActiveSession = { alias: string; pubky: string };
type LiveHandle =
  | { status: 'established'; linkId: string }
  | { status: 'handshaking'; linkId: string; role: LinkRole };
type SessionLookup = ActiveSession | { status: 'offline' } | null;
type EnsureOutcome = LinkStatus | 'idle';

let session: ActiveSession | null = null;
let restoreInFlight: Promise<SessionLookup> | null = null;
const liveHandles = new Map<string, LiveHandle>();
const queues = new Map<string, Promise<unknown>>();
let drainTimer: ReturnType<typeof setInterval> | null = null;

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
    return { pubky };
  },

  /**
   * Attempts to silently resume the messaging session after an app restart.
   * `true` only when a session is live afterwards. An `auth` rejection
   * (revoked/expired) deletes the stored alias; a `network` rejection keeps
   * the alias and is reported as `session-offline` from {@link ensureLinkWith}.
   */
  async restorePersistedSession(): Promise<boolean> {
    const lookup = await sessionOrRestore();
    return isActiveSession(lookup);
  },

  hasSession(): boolean {
    return session !== null;
  },

  /**
   * Sign-out / account-switch teardown: close native link handles, sign the
   * native session out, and drop every account-scoped Encrypted-Link row.
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
    session = null;
    liveHandles.clear();
    queues.clear();
    KeyStore.deleteLinkSession();
  },

  // ── Enable flow ───────────────────────────────────────────────────────────

  /**
   * Ring-based enable: starts a `/pub/paykit/:rw` pubkyauth flow. The caller
   * presents `authorizationUrl` (QR / open Ring), then `awaitEnabled`.
   */
  async enable(): Promise<LinkEnableFlow> {
    if (!PaykitLinkNative.isAvailable()) {
      throw createLinkNativeError('unavailable', 'PaykitLinkModule native module is not available');
    }
    const { flowId, authorizationUrl } = await PaykitLinkNative.startAuthFlow(
      PAYKIT_MESSAGING_CAPABILITY,
    );
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
        return provisionReceiver(sessionAlias, pubky);
      },
    };
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

      const ownerPubky = requireOwner();
      const { envelope, json } = buildChatMessageEnvelope({
        eventId: uuidv4(),
        sentAt: Date.now(),
        body,
      });
      const queueId = uuidv4();
      const message: LinkMessage = {
        ownerPubky,
        eventId: envelope.event_id,
        conversationId: buildDmConversationId(peerPubky),
        peerPubky,
        senderPubky: ownerPubky,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: json,
        body: envelope.body,
        sentAt: envelope.sent_at,
        receivedAt: null,
        deliveryState: 'sending',
      };
      const ts = Date.now();
      await StorageService.persistLinkSendIntent({
        message,
        queueItem: {
          id: queueId,
          messageId: envelope.event_id,
          recipientPubky: peerPubky,
          payload: JSON.stringify(retryPayload(ownerPubky, peerPubky, envelope.event_id, json)),
          attempts: 0,
          nextRetryAt: ts,
          createdAt: ts,
        },
      });

      if (outcome !== 'ready') return message;

      try {
        const handle = requireEstablishedHandle(ownerPubky, peerPubky);
        const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, json);
        await StorageService.finalizeLinkSend({
          ownerPubky,
          peerPubky,
          senderPubky: ownerPubky,
          kind: CHAT_MESSAGE_KIND,
          eventId: envelope.event_id,
          snapshot,
          queueId,
        });
        return { ...message, deliveryState: 'sent' };
      } catch (err) {
        console.warn(`[LinkService] Send failed for ${peerPubky}:`, errorMessage(err));
        return message;
      }
    });
  },

  /**
   * Replays exact queued rawJson for items whose row is still `sending`.
   * Intended call site: app startup / foreground (see file header).
   */
  async recoverPendingSends(): Promise<void> {
    const items = await StorageService.listDeliveryQueue();
    for (const item of items) {
      const payload = parseRetryPayload(item.payload);
      if (!payload || !isCurrentOwner(payload.ownerPubky)) continue;
      const row = await StorageService.getLinkMessage(
        payload.ownerPubky,
        payload.senderPubky,
        payload.kind,
        payload.eventId,
      );
      if (!row || row.deliveryState !== 'sending') continue;
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
   */
  async syncInbox(peers: PubkyKey[]): Promise<LinkMessage[]> {
    const received: LinkMessage[] = [];
    for (const peerPubky of new Set(peers)) {
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
    return received;
  },

  async markRead(conversationId: string, readAt: number = Date.now()): Promise<void> {
    const owner = KeyStore.getPubky();
    if (!owner) return;
    await StorageService.setLinkReadCursor(owner, conversationId, readAt);
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
    return adoptInboundHandshake(ownerPubky, peerPubky, marker, localPath, inbound);
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
          return adoptInboundHandshake(ownerPubky, peerPubky, marker, LINK_RECEIVER_PATH, inbound);
        }
      }
    }

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
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
  inbound: Extract<LinkProbeResult, { result: 'pending' | 'established' }>,
): Promise<LinkStatus> {
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
  liveHandles.set(key, { status: 'handshaking', linkId: inbound.linkId, role: 'responder' });
  return 'handshaking-responder';
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

async function syncPeerLocked(peerPubky: PubkyKey): Promise<LinkMessage[]> {
  const ownerPubky = requireOwner();
  try {
    const outcome = await ensureLinkLocked(peerPubky, false, false);
    if (outcome !== 'ready') return routeUnprocessedStreamItems(ownerPubky, peerPubky);

    const swept = await routeUnprocessedStreamItems(ownerPubky, peerPubky);
    const handle = requireEstablishedHandle(ownerPubky, peerPubky);
    const { messages, snapshot } = await PaykitLinkNative.receivePrivateMessages(handle);

    if (messages.length === 0) return swept;

    const arrivedAt = Date.now();
    const streamItems: LinkStreamItemInput[] = messages.map(item => ({
      id: uuidv4(),
      ownerPubky,
      peerPubky,
      kind: item.kind,
      rawJson: item.rawJson,
      receivedAt: arrivedAt,
    }));
    await StorageService.saveLinkStreamItems(streamItems);
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
  payload: LinkRetryPayload,
): Promise<void> {
  await withQueue(payload.peerPubky, async () => {
    const row = await StorageService.getLinkMessage(
      payload.ownerPubky,
      payload.senderPubky,
      payload.kind,
      payload.eventId,
    );
    if (!row || row.deliveryState !== 'sending') {
      await RetryQueue.recordSuccess(item.id);
      return;
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
      const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, payload.rawJson);
      await StorageService.finalizeLinkSend({
        ownerPubky: payload.ownerPubky,
        peerPubky: payload.peerPubky,
        senderPubky: payload.senderPubky,
        kind: payload.kind,
        eventId: payload.eventId,
        snapshot,
        queueId: item.id,
      });
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

async function markFailed(payload: LinkRetryPayload): Promise<void> {
  await StorageService.updateLinkMessageDeliveryState(
    payload.ownerPubky,
    payload.senderPubky,
    payload.kind,
    payload.eventId,
    'failed',
  );
}

function retryPayload(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  eventId: string,
  rawJson: string,
): LinkRetryPayload {
  return {
    type: LINK_RETRY_PAYLOAD_TYPE,
    ownerPubky,
    peerPubky,
    senderPubky: ownerPubky,
    kind: CHAT_MESSAGE_KIND,
    eventId,
    rawJson,
  };
}

function parseRetryPayload(payload: string): LinkRetryPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== LINK_RETRY_PAYLOAD_TYPE) return null;
  if (typeof candidate.ownerPubky !== 'string') return null;
  if (typeof candidate.peerPubky !== 'string') return null;
  if (typeof candidate.senderPubky !== 'string') return null;
  if (typeof candidate.kind !== 'string') return null;
  if (typeof candidate.eventId !== 'string') return null;
  if (typeof candidate.rawJson !== 'string') return null;
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
