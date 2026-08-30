/**
 * Real-SQL proof of payment CAS + outbound send-intent persist.
 * Uses the same better-sqlite3 adapter as linkSchema.integration.test.ts.
 */
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the SQL integration test');
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../attachments/fileIo', () => ({
  deleteCacheFiles: jest.fn().mockResolvedValue(undefined),
  cachePathsForAttachment: () => [],
}));

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../StorageService';
import {
  EMPTY_PAYMENT_RECORD_EXTRAS,
  ENDPOINT_LIGHTNING_BOLT11,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  displayPaymentStatus,
  expectedStatusesForAction,
  type PaymentRequestRecord,
} from '../../../types/payment';

const OWNER = 'a'.repeat(52);
const PEER = 'z'.repeat(52);
const REQUEST_ID = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
const EVENT_REQ = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d101';
const EVENT_ACC = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d102';
const QUEUE_ID = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d199';
const LINK_RETRY_PAYLOAD_TYPE = 'link.chat.message';

function pendingRow(): PaymentRequestRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    direction: 'received',
    paymentRequestId: REQUEST_ID,
    eventId: EVENT_REQ,
    amountValue: '0.001',
    amountAsset: 'btc',
    paymentReference: 'invoice-2026-0001',
    endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    expiresAt: null,
    status: 'pending',
    createdAt: 10,
    updatedAt: 10,
    proofJson: null,
    reason: null,
    ...EMPTY_PAYMENT_RECORD_EXTRAS,
  };
}

function acceptIntent() {
  const rawJson = JSON.stringify({
    version: 1,
    kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
    event_id: EVENT_ACC,
    payment_request_id: REQUEST_ID,
  });
  return {
    message: {
      ownerPubky: OWNER,
      eventId: EVENT_ACC,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: 'sent' as const,
      kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
      rawJson,
      body: '[payment accepted]',
      sentAt: 20,
      receivedAt: null,
      deliveryState: 'sending' as const,
    },
    queueItem: {
      id: QUEUE_ID,
      messageId: EVENT_ACC,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_RETRY_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
        eventId: EVENT_ACC,
        rawJson,
      }),
      attempts: 0,
      nextRetryAt: 20,
      createdAt: 20,
    },
  };
}

describe('payment persist + CAS (real SQL)', () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it('compare-and-set applies once; the loser is already transitioned', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.savePaymentRequest(pendingRow());

    const first = await StorageService.compareAndSetPaymentRequest(
      OWNER,
      PEER,
      REQUEST_ID,
      expectedStatusesForAction('accept'),
      { status: 'accepted', pendingEventId: EVENT_ACC },
    );
    const second = await StorageService.compareAndSetPaymentRequest(
      OWNER,
      PEER,
      REQUEST_ID,
      expectedStatusesForAction('accept'),
      { status: 'accepted', pendingEventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d188' },
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
    const row = await StorageService.getPaymentRequest(OWNER, PEER, REQUEST_ID);
    expect(row?.status).toBe('accepted');
    expect(row?.pendingEventId).toBe(EVENT_ACC);
  });

  it('persists outbound intent with the status change so a send failure stays queued', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.savePaymentRequest(pendingRow());

    const applied = await StorageService.persistPaymentOutboundTransition({
      ownerPubky: OWNER,
      peerPubky: PEER,
      paymentRequestId: REQUEST_ID,
      expectedStatuses: expectedStatusesForAction('accept'),
      patch: { status: 'accepted', pendingEventId: EVENT_ACC },
      event: {
        ownerPubky: OWNER,
        conversationId: `dm:${PEER}`,
        senderPubky: OWNER,
        eventId: EVENT_ACC,
        kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
        paymentRequestId: REQUEST_ID,
        applied: true,
        receivedAt: 20,
      },
      sendIntent: acceptIntent(),
    });
    expect(applied).toBe(true);

    const row = await StorageService.getPaymentRequest(OWNER, PEER, REQUEST_ID);
    expect(row).not.toBeNull();
    if (!row) throw new Error('expected payment request after persist');
    expect(row.status).toBe('accepted');
    expect(row.pendingEventId).toBe(EVENT_ACC);
    expect(displayPaymentStatus(row.status, row.expiresAt, 20, row)).toBe('sending');

    const queued = await StorageService.listDeliveryQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.messageId).toBe(EVENT_ACC);
    expect(JSON.parse(queued[0]!.payload).type).toBe(LINK_RETRY_PAYLOAD_TYPE);
    expect(await StorageService.hasQueueItemForMessage(EVENT_ACC)).toBe(true);

    const message = await StorageService.getLinkMessageByEventId(OWNER, OWNER, EVENT_ACC);
    expect(message?.deliveryState).toBe('sending');

    const conflict = await StorageService.persistPaymentOutboundTransition({
      ownerPubky: OWNER,
      peerPubky: PEER,
      paymentRequestId: REQUEST_ID,
      expectedStatuses: expectedStatusesForAction('accept'),
      patch: { status: 'accepted', pendingEventId: EVENT_ACC },
      event: {
        ownerPubky: OWNER,
        conversationId: `dm:${PEER}`,
        senderPubky: OWNER,
        eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d177',
        kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
        paymentRequestId: REQUEST_ID,
        applied: true,
        receivedAt: 21,
      },
      sendIntent: acceptIntent(),
    });
    expect(conflict).toBe(false);
    expect(await StorageService.listDeliveryQueue()).toHaveLength(1);

    await StorageService.finalizeLinkSend({
      ownerPubky: OWNER,
      peerPubky: PEER,
      senderPubky: OWNER,
      kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
      eventId: EVENT_ACC,
      snapshot: 'snap',
      queueId: QUEUE_ID,
    });
    const afterSend = await StorageService.getPaymentRequest(OWNER, PEER, REQUEST_ID);
    expect(afterSend).not.toBeNull();
    if (!afterSend) throw new Error('expected payment request after finalize');
    expect(afterSend.pendingEventId).toBeNull();
    expect(await StorageService.listDeliveryQueue()).toHaveLength(0);
    expect(displayPaymentStatus(afterSend.status, afterSend.expiresAt, 30, afterSend)).toBe(
      'accepted',
    );
  });
});
