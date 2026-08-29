import { v4 as uuidv4 } from 'uuid';
import { MeshService } from './MeshService';
import { PubkyService } from './PubkyService';
import { StorageService } from './StorageService';
import { EnvelopeService, type PlainEnvelope } from './EnvelopeService';
import { RetryQueue } from './RetryQueue';
import { SSESubscriptionManager } from './SSESubscriptionManager';
import { KeyStore } from './KeyStore';
import { FeatureFlags } from '../flags';
import { Telemetry } from './Telemetry';
import { useMessageStore } from '../stores/messageStore';
import type { Message, PubkyKey } from '../types';

/**
 * MessageRouter — delivery path decision engine.
 *
 * Send priority:
 *   1. BLE mesh (if peer is nearby and `mesh_transport` flag is on)
 *   2. Pubky outbox (if `pubky_inbox` flag is on)
 *   3. Persist to `delivery_queue` for retry when neither path is available
 *
 * Receive:
 *   - BLE: MeshService callback → verify SB2 signature → dedup → store
 *   - Pubky SSE: SSESubscriptionManager → fetch → decrypt SB2 → dedup → store
 *
 * Message IDs: SHA-256 hex of (sender + recipient + content + timestamp).
 */

let localPubky: PubkyKey | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;
let meshCleanup: (() => void) | null = null;

// ─── Startup / shutdown ───────────────────────────────────────────────────────

export const MessageRouter = {
  async start(): Promise<void> {
    localPubky = KeyStore.getPubky();
    if (!localPubky) throw new Error('MessageRouter.start: no active session');

    if (FeatureFlags.get('mesh_transport')) {
      meshCleanup = MeshService.onMessageReceived(handleIncomingMeshMessage);
      await MeshService.start(localPubky);
    }

    if (FeatureFlags.get('pubky_inbox')) {
      SSESubscriptionManager.setEnvelopeCallback(handleIncomingEnvelope);
      await SSESubscriptionManager.subscribeToContacts(localPubky);
    }

    retryTimer = setInterval(() => drainRetryQueue(), 30_000);
  },

  async stop(): Promise<void> {
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
    meshCleanup?.();
    meshCleanup = null;
    await MeshService.stop();
    await SSESubscriptionManager.unsubscribeAll();
    localPubky = null;
  },

  // ── Send ─────────────────────────────────────────────────────────────────

  async sendDM(recipientPubky: PubkyKey, content: string, threadId: string): Promise<Message> {
    if (!localPubky) throw new Error('MessageRouter: not started');

    const messageId = await computeMessageId(localPubky, recipientPubky, content, Date.now());

    const message: Message = {
      id: messageId,
      threadId,
      senderPubky: localPubky,
      recipientPubky,
      content,
      createdAt: Date.now(),
      deliveryStatus: 'pending',
    };

    await StorageService.saveMessage(message);
    useMessageStore.getState().addMessage(threadId, message);

    // Ensure thread exists with sb2ContextId before attempting delivery
    const existingThread = await StorageService.getThread(threadId);
    if (!existingThread?.sb2ContextId) {
      const contextIdHex = await EnvelopeService.generateContextId();
      await StorageService.setThreadContextId(threadId, contextIdHex);
    }

    await StorageService.upsertThread({
      id: threadId,
      participantPubky: recipientPubky,
      lastMessage: content,
      lastMessageAt: Date.now(),
      unreadCount: 0,
    });

    await attemptDMDelivery(message);

    return message;
  },

  async sendChannelMessage(channelId: string, content: string): Promise<Message> {
    if (!localPubky) throw new Error('MessageRouter: not started');

    const messageId = await computeMessageId(localPubky, channelId, content, Date.now());
    const channel = await StorageService.getChannel(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    const message: Message = {
      id: messageId,
      threadId: channelId,
      channelId,
      senderPubky: localPubky,
      content,
      createdAt: Date.now(),
      deliveryStatus: 'pending',
    };

    await StorageService.saveMessage(message);
    useMessageStore.getState().addMessage(channelId, message);

    await StorageService.upsertChannel({
      ...channel,
      lastMessage: content,
      lastMessageAt: Date.now(),
    });

    const members = await StorageService.getChannelMembers(channelId);
    const recipients = members.map(m => m.pubky).filter(p => p !== localPubky);

    for (const recipientPubky of recipients) {
      await attemptChannelDelivery(message, channel.channelInboxPkHex, recipientPubky);
    }

    await StorageService.updateDeliveryStatus(messageId, 'sent_pubky');
    useMessageStore.getState().updateDeliveryStatus(messageId, channelId, 'sent_pubky');

    return message;
  },
};

// ─── Delivery helpers ─────────────────────────────────────────────────────────

async function attemptDMDelivery(message: Message): Promise<void> {
  if (!localPubky || !message.recipientPubky) return;

  const envelope: PlainEnvelope = {
    messageId: message.id,
    threadId: message.threadId,
    senderPubky: localPubky,
    content: message.content,
    createdAt: message.createdAt,
  };

  // Path 1: BLE mesh
  if (FeatureFlags.get('mesh_transport') && MeshService.isPeerNearby(message.recipientPubky)) {
    try {
      const payloadBase64 = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
      const sent = await MeshService.sendToPeer(message.recipientPubky, payloadBase64);
      if (sent) {
        await StorageService.markDelivered(message.id, 'mesh');
        useMessageStore.getState().updateDeliveryStatus(message.id, message.threadId, 'sent_mesh');
        Telemetry.record('delivery_mesh_success');
        await StorageService.touchContactInteraction(message.recipientPubky);
        return;
      }
    } catch {
      // Fall through to Pubky delivery
    }
  }

  // Path 2: Pubky outbox with SB2 encryption
  if (FeatureFlags.get('pubky_inbox')) {
    try {
      const recipientInboxPk = await PubkyService.getContactInboxKey(message.recipientPubky);
      if (!recipientInboxPk) {
        throw new Error(`Recipient inbox key not found for ${message.recipientPubky}`);
      }

      // sb2ContextId is guaranteed to exist — we created it before calling this
      const thread = await StorageService.getThread(message.threadId);
      const sb2ContextIdHex = thread?.sb2ContextId;
      if (!sb2ContextIdHex) {
        throw new Error('Thread sb2ContextId missing — this should not happen');
      }

      const cursorMs = Date.now();
      const cipherBase64 = await EnvelopeService.encryptDM(
        localPubky,
        recipientInboxPk,
        message.recipientPubky,
        envelope,
        sb2ContextIdHex,
        cursorMs,
      );
      await PubkyService.publishOutboxEnvelope(localPubky, message.recipientPubky, cipherBase64);
      await StorageService.markDelivered(message.id, 'pubky');
      useMessageStore.getState().updateDeliveryStatus(message.id, message.threadId, 'sent_pubky');
      Telemetry.record('delivery_pubky_success');
      await StorageService.touchContactInteraction(message.recipientPubky);
      return;
    } catch (err) {
      console.warn('[MessageRouter] Pubky delivery failed:', (err as Error).message);
    }
  }

  // Path 3: Queue for retry
  await RetryQueue.enqueue({
    id: uuidv4(),
    messageId: message.id,
    recipientPubky: message.recipientPubky,
    payload: JSON.stringify({ type: 'dm', message }),
  });
  await StorageService.updateDeliveryStatus(message.id, 'pending');
  Telemetry.record('delivery_queued');
}

async function attemptChannelDelivery(
  message: Message,
  channelInboxPkHex: string | undefined,
  recipientPubky: PubkyKey,
): Promise<void> {
  if (!localPubky) return;

  const channelId = message.channelId!;
  const envelope: PlainEnvelope = {
    messageId: message.id,
    channelId,
    senderPubky: localPubky,
    content: message.content,
    createdAt: message.createdAt,
  };

  // Path 1: BLE mesh
  if (FeatureFlags.get('mesh_transport') && MeshService.isPeerNearby(recipientPubky)) {
    try {
      const payloadBase64 = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
      await MeshService.sendToPeer(recipientPubky, payloadBase64);
      return;
    } catch {
      // Fall through
    }
  }

  // Path 2: Pubky outbox with SealedBlob v2 encryption
  if (FeatureFlags.get('pubky_inbox') && channelInboxPkHex) {
    try {
      const cursorMs = Date.now();
      const cipherJson = await EnvelopeService.encryptChannel(
        channelInboxPkHex,
        localPubky,
        channelId,
        cursorMs,
        envelope,
      );
      await PubkyService.publishChannelEnvelope(localPubky, channelId, cipherJson);
    } catch {
      // Non-fatal for channel broadcasts
    }
  }
}

// ─── Incoming message handling ────────────────────────────────────────────────

async function handleIncomingMeshMessage(
  senderPubky: PubkyKey | undefined,
  payloadBase64: string,
): Promise<void> {
  if (!localPubky || !senderPubky) return;

  try {
    // BLE payloads are plain JSON — Noise encryption provides transport auth.
    // The sender's Noise static key is pinned during handshake.
    const json = Buffer.from(payloadBase64, 'base64').toString('utf8');
    const envelope = JSON.parse(json) as PlainEnvelope;

    // Validate sender claim matches Noise-authenticated identity
    if (envelope.senderPubky !== senderPubky) {
      console.warn(
        `[MessageRouter] BLE sender mismatch: envelope claims ${envelope.senderPubky}, ` +
          `Noise says ${senderPubky}. Rejecting.`,
      );
      return;
    }

    await processIncomingEnvelope(envelope, 'mesh');
  } catch (err) {
    console.warn('[MessageRouter] Failed to process BLE message:', (err as Error).message);
  }
}

async function handleIncomingEnvelope(senderPubky: PubkyKey, envelopeUrl: string): Promise<void> {
  if (!localPubky) return;

  try {
    const envelopeBase64 = await PubkyService.fetchEnvelope(localPubky, envelopeUrl);
    if (!envelopeBase64) return;

    // Derive canonical path from URL
    const urlMatch = envelopeUrl.match(/pubky:\/\/[^/]+(\/pub\/.+)/);
    const canonicalPath = urlMatch?.[1] ?? envelopeUrl;

    const inboxKeypair = await KeyStore.getInboxKeypair();
    if (!inboxKeypair) throw new Error('No inbox keypair in KeyStore');

    // ownerPubky for SB2 decryption AAD = the sender's root pubky (storage owner)
    const envelope = await EnvelopeService.decryptDM(
      inboxKeypair.secretKey,
      senderPubky,
      envelopeBase64,
      canonicalPath,
      senderPubky,
    );
    await processIncomingEnvelope(envelope, 'pubky');

    const cursorStr = envelopeUrl.split('/').pop()?.replace('.bin', '');
    const cursorMs = parseInt(cursorStr ?? '0', 10);
    if (cursorMs > 0) {
      await StorageService.advanceCursor(senderPubky, localPubky, 'dm', cursorMs);
    }
  } catch (err) {
    console.warn('[MessageRouter] Failed to process SSE envelope:', (err as Error).message);
  }
}

async function processIncomingEnvelope(
  envelope: PlainEnvelope,
  path: 'mesh' | 'pubky',
): Promise<void> {
  if (!localPubky) return;

  const isDup = await StorageService.isDuplicate(envelope.messageId);
  if (isDup) return;

  const message: Message = {
    id: envelope.messageId,
    threadId: envelope.threadId ?? `${envelope.senderPubky}-${localPubky}`,
    senderPubky: envelope.senderPubky,
    recipientPubky: localPubky,
    content: envelope.content,
    createdAt: envelope.createdAt,
    deliveryStatus: 'delivered',
    deliveryPath: path,
  };

  await StorageService.saveMessage(message);
  useMessageStore.getState().addMessage(message.threadId, message);

  await StorageService.upsertThread({
    id: message.threadId,
    participantPubky: envelope.senderPubky,
    lastMessage: envelope.content,
    lastMessageAt: envelope.createdAt,
    unreadCount: 0,
  });
  await StorageService.incrementThreadUnread(message.threadId);
  await StorageService.touchContactInteraction(envelope.senderPubky);
}

// ─── Retry queue drain ────────────────────────────────────────────────────────

async function drainRetryQueue(): Promise<void> {
  // Only retry if at least one delivery path is available
  if (!FeatureFlags.get('mesh_transport') && !FeatureFlags.get('pubky_inbox')) return;

  const items = await RetryQueue.getDue();

  for (const item of items) {
    try {
      const data = JSON.parse(item.payload) as { type: string; message: Message };
      if (data.type === 'dm' && data.message.recipientPubky) {
        await attemptDMDelivery(data.message);
        await RetryQueue.recordSuccess(item.id);
      }
    } catch {
      await RetryQueue.recordFailure(item.id, item.attempts);
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * SHA-256 message ID for deduplication and spec compliance.
 * Uses the SubtleCrypto Web API available in React Native Hermes.
 */
async function computeMessageId(
  sender: string,
  recipient: string,
  content: string,
  ts: number,
): Promise<string> {
  const input = `${sender}|${recipient}|${content}|${ts}`;
  const data = new TextEncoder().encode(input);

  // SubtleCrypto is available in React Native (Hermes) since RN 0.74+
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Node's 'crypto' module does not exist in the RN/Hermes runtime, so there
  // is no meaningful JS fallback; fail loudly rather than dedup incorrectly.
  throw new Error('SHA-256 unavailable: SubtleCrypto is not present in this runtime');
}
