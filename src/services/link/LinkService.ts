import { v4 as uuidv4 } from 'uuid';
import { PaykitLinkNative, type LinkAdvanceResult } from './PaykitLinkNative';
import { StorageService } from '../StorageService';
import { KeyStore, LINK_RECEIVER_SECRET_SERVICE } from '../KeyStore';
import { RetryQueue } from '../RetryQueue';
import {
  buildChatMessageEnvelope,
  buildDmConversationId,
  CHAT_MESSAGE_KIND,
  decodeChatMessageEnvelope,
  type LinkMessage,
  type LinkRole,
  type LinkStatus,
} from '../../types/link';
import type { PubkyKey } from '../../types';

/**
 * LinkService — end-to-end-encrypted DMs over official Paykit Encrypted
 * Links (Noise XX over pubky homeserver outboxes), via PaykitLinkNative.
 *
 * Port of the proven mp-dm transport state machine, adapted to this app's
 * SQLite storage and single-account KeyStore. Facts the rest of the app
 * relies on:
 *
 * - The receiver-scoped Noise secret lives in the OS keychain (KeyStore);
 *   SQLite rows only reference it. Link snapshots persist as the native
 *   layer produces them — unencrypted, containing key material — so they
 *   are device-local only.
 * - Noise XX needs BOTH parties: an initiator writes message 1 and then
 *   CANNOT send until the counterparty's runtime reads and answers it. The
 *   statuses are truthful about that — `handshaking-initiator` means
 *   "waiting for the counterparty to come online".
 * - When both sides initiate at once (crossed handshakes), the
 *   lexicographically smaller pubky abandons its own handshake and answers
 *   the inbound one — a deterministic tiebreak where exactly one side
 *   switches.
 * - Received messages are persisted BEFORE the advanced link snapshot: the
 *   snapshot's read checkpoint moves past returned messages, so the
 *   reversed order would lose them on a crash. Replays after a restored
 *   snapshot are expected and dedupe by `event_id`.
 * - The native layer rejects overlapping operations per link, so every
 *   public operation is serialized per counterparty.
 */

/** Receiver path segment identifying this app on the homeserver. */
export const LINK_APP = 'hypercolor';

/** Receiver path segment identifying this runtime. */
export const LINK_RUNTIME = 'mobile';

/**
 * Discriminator for this transport's items in the shared `delivery_queue`.
 * MessageRouter's drain only acts on its own `type: 'dm'` items and this
 * service only acts on these — the two transports share the table without
 * touching each other's work.
 */
export const LINK_RETRY_PAYLOAD_TYPE = 'link.chat.message';

interface LinkRetryPayload {
  type: typeof LINK_RETRY_PAYLOAD_TYPE;
  peerPubky: PubkyKey;
  eventId: string;
  rawJson: string;
}

type EnsureOutcome = LinkStatus | 'idle';

let session: string | null = null;
let restoreInFlight: Promise<string | null> | null = null;
const linkHandles = new Map<PubkyKey, string>();
const queues = new Map<PubkyKey, Promise<unknown>>();

export const LinkService = {
  // ── Session ───────────────────────────────────────────────────────────────

  /** Signs in to the homeserver and persists the exported session for silent restore. */
  async signin(secretKeyHex: string): Promise<void> {
    const exported = await PaykitLinkNative.signinWithSecret(secretKeyHex);
    session = exported;
    KeyStore.setLinkSession(exported);
  },

  /**
   * Attempts to silently resume the messaging session after an app restart:
   * true when a session is live afterwards. A persisted session the
   * homeserver no longer accepts is cleared so the UI shows the honest
   * reconnect state. Never throws for "no session"; concurrent callers
   * share one in-flight restore.
   */
  async restorePersistedSession(): Promise<boolean> {
    return (await sessionOrRestore()) !== null;
  },

  /** True while a messaging session is held in memory. */
  hasSession(): boolean {
    return session !== null;
  },

  /** Drops the in-memory session, persisted session, and every live link handle. */
  clearSession(): void {
    session = null;
    linkHandles.clear();
    queues.clear();
    KeyStore.deleteLinkSession();
  },

  // ── Enable flow ───────────────────────────────────────────────────────────

  /**
   * Provisions this account for encrypted messaging: generates the receiver
   * Noise secret ONCE (persisted in the OS keychain via KeyStore), records
   * the receiver row (SQLite holds only the keychain reference), and
   * publishes the receiver marker that makes this user discoverable.
   * Republishing is idempotent and heals a marker removed elsewhere.
   */
  async enable(): Promise<void> {
    const activeSession = await sessionOrRestore();
    if (!activeSession) {
      throw new Error('LinkService.enable: no active messaging session — sign in first');
    }
    const ownerPubky = KeyStore.getPubky();
    if (!ownerPubky) {
      throw new Error('LinkService.enable: no local pubky in KeyStore');
    }

    let receiverSecret = await KeyStore.getLinkReceiverSecret();
    if (!receiverSecret) {
      receiverSecret = await PaykitLinkNative.generateReceiverSecret();
      // The secret must be safe in the keychain BEFORE anything references it:
      // publishing a marker for an unpersisted secret would strand every
      // handshake made against it.
      await KeyStore.setLinkReceiverSecret(receiverSecret);
    }

    await StorageService.upsertLinkReceiver({
      ownerPubky,
      secretRef: LINK_RECEIVER_SECRET_SERVICE,
      app: LINK_APP,
      runtime: LINK_RUNTIME,
      markerPublished: false,
    });
    await PaykitLinkNative.publishReceiverMarker(
      activeSession,
      receiverSecret,
      LINK_APP,
      LINK_RUNTIME,
    );
    await StorageService.upsertLinkReceiver({
      ownerPubky,
      secretRef: LINK_RECEIVER_SECRET_SERVICE,
      app: LINK_APP,
      runtime: LINK_RUNTIME,
      markerPublished: true,
    });
  },

  // ── Links ─────────────────────────────────────────────────────────────────

  /**
   * Brings the Encrypted Link toward `peerPubky` as far as one poll step
   * allows and reports the truthful state. Serialized per counterparty.
   */
  async ensureLinkWith(peerPubky: PubkyKey): Promise<LinkStatus> {
    return withQueue(peerPubky, async () => {
      try {
        const outcome = await ensureLinkLocked(peerPubky, true);
        // `allowInitiate` makes the probe-only 'idle' branch unreachable.
        return outcome === 'idle' ? 'error' : outcome;
      } catch (err) {
        console.warn(
          `[LinkService] ensureLinkWith failed for ${peerPubky}:`,
          (err as Error).message,
        );
        return 'error';
      }
    });
  },

  // ── Send ──────────────────────────────────────────────────────────────────

  /**
   * Sends one `chat.message.v0` DM. The message row is persisted first
   * (delivery state `sending`), then sent over the ready link and marked
   * `sent` BEFORE the advanced snapshot is stored. A send that cannot
   * complete now — link still handshaking, or the native send failed —
   * leaves the row in `sending` and queues a retry.
   *
   * Throws when the peer can never receive (`not-enrolled`), when this
   * device is not provisioned (`needs-enable`), or on transport error.
   */
  async sendDm(peerPubky: PubkyKey, body: string): Promise<LinkMessage> {
    return withQueue(peerPubky, async () => {
      const outcome = await ensureLinkLocked(peerPubky, true);
      if (
        outcome !== 'ready' &&
        outcome !== 'handshaking-initiator' &&
        outcome !== 'handshaking-responder'
      ) {
        throw new Error(
          `LinkService.sendDm: cannot send to ${peerPubky} — link status is '${outcome}'`,
        );
      }

      const { envelope, json } = buildChatMessageEnvelope({
        eventId: uuidv4(),
        sentAt: Date.now(),
        body,
      });
      const message: LinkMessage = {
        eventId: envelope.event_id,
        conversationId: buildDmConversationId(peerPubky),
        peerPubky,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: json,
        body: envelope.body,
        sentAt: envelope.sent_at,
        receivedAt: null,
        deliveryState: 'sending',
      };
      await StorageService.saveLinkMessage(message);

      if (outcome !== 'ready') {
        await enqueueRetry(peerPubky, envelope.event_id, json);
        return message;
      }

      const handle = requireLinkHandle(peerPubky);
      try {
        const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(handle, json);
        await StorageService.updateLinkMessageDeliveryState(envelope.event_id, 'sent');
        await StorageService.updateLinkSnapshot(peerPubky, snapshot, 'established');
        return { ...message, deliveryState: 'sent' };
      } catch (err) {
        console.warn(`[LinkService] Send failed for ${peerPubky}:`, (err as Error).message);
        await enqueueRetry(peerPubky, envelope.event_id, json);
        return message;
      }
    });
  },

  /**
   * Re-attempts this transport's due items in the shared retry queue.
   * Items from other transports (MessageRouter's `type: 'dm'`) are left
   * untouched for their own drain.
   */
  async retryPendingSends(): Promise<void> {
    const due = await RetryQueue.getDue();
    for (const item of due) {
      const payload = parseRetryPayload(item.payload);
      if (!payload) continue;
      try {
        await withQueue(payload.peerPubky, async () => {
          const outcome = await ensureLinkLocked(payload.peerPubky, true);
          if (outcome !== 'ready') {
            throw new Error(`link not ready (status '${outcome}')`);
          }
          const handle = requireLinkHandle(payload.peerPubky);
          const { snapshot } = await PaykitLinkNative.sendPrivateMessageJson(
            handle,
            payload.rawJson,
          );
          await StorageService.updateLinkMessageDeliveryState(payload.eventId, 'sent');
          await StorageService.updateLinkSnapshot(payload.peerPubky, snapshot, 'established');
        });
        await RetryQueue.recordSuccess(item.id);
      } catch {
        await RetryQueue.recordFailure(item.id, item.attempts);
      }
    }
  },

  // ── Receive ───────────────────────────────────────────────────────────────

  /**
   * Inbox sync across known counterparties: advances existing handshakes and
   * answers queued inbound ones WITHOUT ever initiating (the native layer
   * exposes no way to enumerate unknown inbound initiators, so peers must be
   * known — contacts, existing conversations). Drains ready links, dedupes
   * by `event_id`, and persists messages BEFORE the advanced snapshot.
   * Returns the newly received messages. One failing peer never aborts the
   * others.
   */
  async syncInbox(peers: PubkyKey[]): Promise<LinkMessage[]> {
    const received: LinkMessage[] = [];
    for (const peerPubky of new Set(peers)) {
      try {
        const batch = await withQueue(peerPubky, () => syncPeerLocked(peerPubky));
        received.push(...batch);
      } catch (err) {
        console.warn(`[LinkService] Inbox sync failed for ${peerPubky}:`, (err as Error).message);
      }
    }
    return received;
  },

  // ── Read cursor ───────────────────────────────────────────────────────────

  /**
   * Moves the device-local read checkpoint for one conversation. The cursor
   * is monotonic — marking an older timestamp never moves it backwards.
   */
  async markRead(conversationId: string, readAt: number = Date.now()): Promise<void> {
    await StorageService.setLinkReadCursor(conversationId, readAt);
  },
};

// ─── Session internals ────────────────────────────────────────────────────────

async function sessionOrRestore(): Promise<string | null> {
  if (session) return session;
  restoreInFlight ??= restoreFromKeyStore();
  try {
    return await restoreInFlight;
  } finally {
    restoreInFlight = null;
  }
}

async function restoreFromKeyStore(): Promise<string | null> {
  const stored = KeyStore.getLinkSession();
  if (!stored) return null;
  try {
    const refreshed = await PaykitLinkNative.restoreSession(stored);
    session = refreshed;
    KeyStore.setLinkSession(refreshed);
    return refreshed;
  } catch (err) {
    // The homeserver rejected the session (expired/revoked) or the restore
    // failed in transit; either way the persisted value is useless now.
    console.warn('[LinkService] Could not restore the persisted session:', (err as Error).message);
    KeyStore.deleteLinkSession();
    return null;
  }
}

// ─── State machine internals ──────────────────────────────────────────────────

async function ensureLinkLocked(
  peerPubky: PubkyKey,
  allowInitiate: boolean,
): Promise<EnsureOutcome> {
  if (!PaykitLinkNative.isAvailable()) return 'error';

  const activeSession = await sessionOrRestore();
  if (!activeSession) return 'needs-enable';
  const ownerPubky = KeyStore.getPubky();
  if (!ownerPubky) return 'needs-enable';
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  if (!receiver?.markerPublished) return 'needs-enable';
  const receiverSecret = await KeyStore.getLinkReceiverSecret();
  if (!receiverSecret) return 'needs-enable';

  if (linkHandles.has(peerPubky)) return 'ready';

  const stored = await StorageService.getLink(peerPubky);
  if (stored?.status === 'established') {
    const handle = await PaykitLinkNative.restoreLink(activeSession, stored.snapshot);
    linkHandles.set(peerPubky, handle);
    return 'ready';
  }
  if (stored?.status === 'handshaking') {
    return advanceHandshakeLocked(
      activeSession,
      receiverSecret,
      ownerPubky,
      peerPubky,
      stored.role,
      stored.snapshot,
    );
  }

  // No local state at all: discover the counterparty, prefer answering an
  // inbound handshake if one is queued, otherwise initiate our own.
  const marker = await PaykitLinkNative.getReceiverMarker(
    activeSession,
    peerPubky,
    receiver.app,
    receiver.runtime,
  );
  if (marker === null) return 'not-enrolled';

  const inbound = await probeInboundHandshake(activeSession, receiverSecret, peerPubky);
  if (inbound !== null) {
    return adoptInboundHandshake(activeSession, peerPubky, inbound);
  }

  if (!allowInitiate) return 'idle';

  const handshakeSnapshot = await PaykitLinkNative.initiateLink(
    activeSession,
    receiverSecret,
    peerPubky,
    marker,
  );
  // Persist BEFORE advancing so an app kill resumes instead of restarting.
  await StorageService.upsertLink({
    peerPubky,
    role: 'initiator',
    status: 'handshaking',
    snapshot: handshakeSnapshot,
  });
  return advanceHandshakeLocked(
    activeSession,
    receiverSecret,
    ownerPubky,
    peerPubky,
    'initiator',
    handshakeSnapshot,
  );
}

/**
 * One handshake step. On `pending`, persists the advanced snapshot so a
 * restart resumes instead of restarting. When our own initiated handshake
 * stalls, the lexicographically smaller pubky additionally probes for a
 * CROSSED inbound handshake (both sides initiated at once) and switches to
 * answering it — the deterministic tiebreak that keeps exactly one side
 * switching.
 */
async function advanceHandshakeLocked(
  activeSession: string,
  receiverSecret: string,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  role: LinkRole,
  snapshot: string,
): Promise<LinkStatus> {
  let result: LinkAdvanceResult;
  try {
    result = await PaykitLinkNative.advanceHandshake(activeSession, snapshot);
  } catch (err) {
    // Recoverable: the persisted snapshot restores this handshake next poll.
    console.warn(
      `[LinkService] Handshake advance failed for ${peerPubky}:`,
      (err as Error).message,
    );
    return roleStatus(role);
  }

  if (result.status === 'established') {
    await StorageService.updateLinkSnapshot(peerPubky, result.snapshot, 'established');
    const handle = await PaykitLinkNative.restoreLink(activeSession, result.snapshot);
    linkHandles.set(peerPubky, handle);
    return 'ready';
  }

  await StorageService.updateLinkSnapshot(peerPubky, result.snapshot, 'handshaking');

  if (role === 'initiator' && ownerPubky < peerPubky) {
    const inbound = await probeInboundHandshake(activeSession, receiverSecret, peerPubky);
    if (inbound !== null) {
      return adoptInboundHandshake(activeSession, peerPubky, inbound);
    }
  }

  return roleStatus(role);
}

/**
 * Answers a possibly-queued inbound handshake. The native contract resolves
 * only when the peer actually has an inbound handshake queued for us and
 * rejects otherwise — a rejection here is "nothing inbound", not an error.
 */
async function probeInboundHandshake(
  activeSession: string,
  receiverSecret: string,
  peerPubky: PubkyKey,
): Promise<string | null> {
  try {
    return await PaykitLinkNative.acceptLink(activeSession, receiverSecret, peerPubky);
  } catch {
    return null;
  }
}

/**
 * Adopts an accepted inbound handshake as responder state. The snapshot from
 * `acceptLink` may already be established or still mid-handshake; one
 * advance step classifies it (advancing an established snapshot is a safe
 * no-op per the native contract).
 */
async function adoptInboundHandshake(
  activeSession: string,
  peerPubky: PubkyKey,
  snapshot: string,
): Promise<LinkStatus> {
  let result: LinkAdvanceResult;
  try {
    result = await PaykitLinkNative.advanceHandshake(activeSession, snapshot);
  } catch (err) {
    // Persist the responder state as-is; the next poll advances it.
    console.warn(
      `[LinkService] Inbound handshake advance failed for ${peerPubky}:`,
      (err as Error).message,
    );
    await StorageService.upsertLink({
      peerPubky,
      role: 'responder',
      status: 'handshaking',
      snapshot,
    });
    return 'handshaking-responder';
  }

  if (result.status === 'established') {
    await StorageService.upsertLink({
      peerPubky,
      role: 'responder',
      status: 'established',
      snapshot: result.snapshot,
    });
    const handle = await PaykitLinkNative.restoreLink(activeSession, result.snapshot);
    linkHandles.set(peerPubky, handle);
    return 'ready';
  }

  await StorageService.upsertLink({
    peerPubky,
    role: 'responder',
    status: 'handshaking',
    snapshot: result.snapshot,
  });
  return 'handshaking-responder';
}

// ─── Receive internals ────────────────────────────────────────────────────────

async function syncPeerLocked(peerPubky: PubkyKey): Promise<LinkMessage[]> {
  const outcome = await ensureLinkLocked(peerPubky, false);
  if (outcome !== 'ready') return [];

  const handle = requireLinkHandle(peerPubky);
  const { messages, snapshot } = await PaykitLinkNative.receivePrivateMessages(handle);

  const received: LinkMessage[] = [];
  const seenInBatch = new Set<string>();
  const arrivedAt = Date.now();
  for (const item of messages) {
    const envelope = decodeChatMessageEnvelope(item.rawJson);
    // Unknown kinds are legal on a shared link and are skipped.
    if (!envelope) continue;
    if (seenInBatch.has(envelope.event_id)) continue;
    seenInBatch.add(envelope.event_id);
    if (await StorageService.hasLinkMessage(envelope.event_id)) continue;
    const row: LinkMessage = {
      eventId: envelope.event_id,
      conversationId: buildDmConversationId(peerPubky),
      peerPubky,
      direction: 'received',
      kind: envelope.kind,
      rawJson: item.rawJson,
      body: envelope.body,
      sentAt: envelope.sent_at,
      receivedAt: arrivedAt,
      deliveryState: 'delivered',
    };
    await StorageService.saveLinkMessage(row);
    received.push(row);
  }

  // The snapshot's read checkpoint has advanced past everything returned —
  // it is persisted AFTER the message rows so a crash between the two
  // replays deliveries (deduped by event_id) instead of losing them.
  if (messages.length > 0) {
    await StorageService.updateLinkSnapshot(peerPubky, snapshot, 'established');
  }
  return received;
}

// ─── Shared internals ─────────────────────────────────────────────────────────

function roleStatus(role: LinkRole): LinkStatus {
  return role === 'initiator' ? 'handshaking-initiator' : 'handshaking-responder';
}

function requireLinkHandle(peerPubky: PubkyKey): string {
  const handle = linkHandles.get(peerPubky);
  if (!handle) {
    throw new Error(`LinkService: missing link handle for ${peerPubky}`);
  }
  return handle;
}

async function enqueueRetry(peerPubky: PubkyKey, eventId: string, rawJson: string): Promise<void> {
  const payload: LinkRetryPayload = {
    type: LINK_RETRY_PAYLOAD_TYPE,
    peerPubky,
    eventId,
    rawJson,
  };
  await RetryQueue.enqueue({
    id: uuidv4(),
    messageId: eventId,
    recipientPubky: peerPubky,
    payload: JSON.stringify(payload),
  });
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
  if (typeof candidate.peerPubky !== 'string') return null;
  if (typeof candidate.eventId !== 'string') return null;
  if (typeof candidate.rawJson !== 'string') return null;
  return {
    type: LINK_RETRY_PAYLOAD_TYPE,
    peerPubky: candidate.peerPubky,
    eventId: candidate.eventId,
    rawJson: candidate.rawJson,
  };
}

/**
 * Serializes operations per counterparty: the native layer rejects
 * overlapping operations on one link, and interleaved persistence would
 * break the messages-before-snapshot ordering.
 */
async function withQueue<T>(peerPubky: PubkyKey, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(peerPubky) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  queues.set(
    peerPubky,
    next.catch(() => undefined),
  );
  return next;
}
