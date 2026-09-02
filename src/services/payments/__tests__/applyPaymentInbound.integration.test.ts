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

jest.mock('expo-crypto', () => {
  const nodeCrypto = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_alg: string, data: Uint8Array) => {
      const buf = nodeCrypto.createHash('sha256').update(Buffer.from(data)).digest();
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
});

import { createHash } from 'crypto';
import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../StorageService';
import { applyPaymentInbound } from '../applyPaymentInbound';
import { COPY } from '../../../copy/uxCopy';
import { formatPaymentReceipt } from '../../../ui/paymentReceiptStatus';
import {
  EMPTY_PAYMENT_RECORD_EXTRAS,
  ENDPOINT_LIGHTNING_BOLT11,
  buildPaymentProofEnvelope,
  type PaymentRequestRecord,
} from '../../../types/payment';

const OWNER = 'a'.repeat(52);
const PEER_A = 'b'.repeat(52);
const PEER_B = 'c'.repeat(52);
const NOW = 1_700_000_000_000;

function sentAccepted(
  peer: string,
  requestId: string,
  hash: string,
  amountValue = '0.001',
): PaymentRequestRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: peer,
    direction: 'sent',
    paymentRequestId: requestId,
    eventId: `${requestId.slice(0, 14)}e000-0000-4000-8000-000000000001`,
    amountValue,
    amountAsset: 'btc',
    paymentReference: 'invoice-2026-0001',
    endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    expiresAt: null,
    status: 'accepted',
    createdAt: NOW,
    updatedAt: NOW,
    proofJson: null,
    reason: null,
    ...EMPTY_PAYMENT_RECORD_EXTRAS,
    displayedPaymentHash: hash,
  };
}

describe('applyPaymentInbound verified-hash unique index', () => {
  afterEach(() => {
    setDbForTests(null);
  });

  // Promise.all is scheduling-deterministic on better-sqlite3 (sync adapter).
  // The assertion that matters is the unique-index catch path, not interleaving.

  it('marks exactly one request paid when two proofs share a preimage', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    const preimage = 'ab'.repeat(32);
    const paymentHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    const idA = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    const idB = 'c7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab44';
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, idA, paymentHash));
    await StorageService.savePaymentRequest(sentAccepted(PEER_B, idB, paymentHash));
    await StorageService.replaceTipEndpoints(
      OWNER,
      OWNER,
      [
        {
          identifier: ENDPOINT_LIGHTNING_BOLT11,
          payload: 'lnbc1not-a-real-invoice',
          paymentHash,
          invoiceAmount: '0.001',
          invoiceExpiresAt: NOW + 86_400_000,
          validationStatus: 'valid',
        },
      ],
      NOW,
    );

    const proofA = buildPaymentProofEnvelope({
      eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d105',
      paymentRequestId: idA,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    const proofB = buildPaymentProofEnvelope({
      eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d106',
      paymentRequestId: idB,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });

    const [resultA, resultB] = await Promise.all([
      applyPaymentInbound({
        ownerPubky: OWNER,
        senderPubky: PEER_A,
        peerPubky: PEER_A,
        rawJson: proofA.json,
        receivedAt: NOW,
        nowMs: NOW,
      }),
      applyPaymentInbound({
        ownerPubky: OWNER,
        senderPubky: PEER_B,
        peerPubky: PEER_B,
        rawJson: proofB.json,
        receivedAt: NOW,
        nowMs: NOW,
      }),
    ]);

    expect(resultA.action).toBe('applied');
    expect(resultB.action).toBe('applied');
    const rowA = await StorageService.getPaymentRequest(OWNER, PEER_A, idA);
    const rowB = await StorageService.getPaymentRequest(OWNER, PEER_B, idB);
    const verified = [rowA?.proofVerified, rowB?.proofVerified].filter(v => v === true);
    expect(verified).toHaveLength(1);
    const other = rowA?.proofVerified === true ? rowB : rowA;
    expect(other?.proofVerified).toBe(false);
    expect(other?.status).toBe('accepted');
  });
});

describe('applyPaymentInbound invoice amount binding', () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it('does not mark a 1,000,000-sat request paid from a 1,000-sat invoice', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    const smallPreimage = 'ab'.repeat(32);
    const smallHash = createHash('sha256').update(Buffer.from(smallPreimage, 'hex')).digest('hex');
    const largeId = 'c7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab44';
    const smallId = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, largeId, smallHash, '0.01'));
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, smallId, smallHash, '0.00001'));
    db.executeSync(
      `INSERT INTO own_invoice_hashes
        (owner_pubky, endpoint_identifier, payment_hash, first_seen_at,
         invoice_amount_msat, invoice_expires_at)
       VALUES (?, ?, ?, ?, '1000000', ?)`,
      [OWNER, ENDPOINT_LIGHTNING_BOLT11, smallHash, NOW, NOW + 86_400_000],
    );

    const againstLarge = buildPaymentProofEnvelope({
      eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d105',
      paymentRequestId: largeId,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: smallPreimage,
    });
    const result = await applyPaymentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      peerPubky: PEER_A,
      rawJson: againstLarge.json,
      receivedAt: NOW,
      nowMs: NOW,
    });
    expect(result.action).toBe('applied');
    const large = await StorageService.getPaymentRequest(OWNER, PEER_A, largeId);
    const small = await StorageService.getPaymentRequest(OWNER, PEER_A, smallId);
    expect(large?.proofVerified).not.toBe(true);
    expect(large?.status).toBe('accepted');
    expect(formatPaymentReceipt(large!, NOW)).toEqual({
      word: COPY.paymentRequested,
      note: COPY.proofAmountMismatch,
    });
    expect(small?.proofVerified).toBeNull();
    expect(small?.status).toBe('accepted');
    expect(formatPaymentReceipt(small!, NOW).word).toBe(COPY.paymentRequested);
    expect(formatPaymentReceipt(small!, NOW).note).toBeNull();
  });
});

describe('applyPaymentInbound missing own_invoice_hashes table', () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it('marks the stream item processed and does not pay when the table is absent', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    db.executeSync('DROP TABLE own_invoice_hashes');

    const preimage = 'ab'.repeat(32);
    const paymentHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    const idA = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, idA, paymentHash));
    const proof = buildPaymentProofEnvelope({
      eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d105',
      paymentRequestId: idA,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    const streamId = 'stream-proof-missing-table';
    await StorageService.saveLinkStreamItems([
      {
        id: streamId,
        ownerPubky: OWNER,
        peerPubky: PEER_A,
        kind: 'paykit.payment_proof',
        rawJson: proof.json,
        receivedAt: NOW,
      },
    ]);

    await expect(
      applyPaymentInbound({
        ownerPubky: OWNER,
        senderPubky: PEER_A,
        peerPubky: PEER_A,
        rawJson: proof.json,
        receivedAt: NOW,
        nowMs: NOW,
      }),
    ).resolves.toEqual(expect.objectContaining({ action: 'applied' }));
    await StorageService.markLinkStreamItemProcessed(streamId);

    const row = await StorageService.getPaymentRequest(OWNER, PEER_A, idA);
    expect(row?.proofVerified).not.toBe(true);
    expect(row?.status).toBe('accepted');
    const stream = await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER_A);
    expect(stream.find(item => item.id === streamId)).toBeUndefined();
  });
});

describe('setDisplayedPaymentHash write-once after verification', () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it('refuses to overwrite displayed_payment_hash once proof_verified is 1', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const verifiedHash = 'aa'.repeat(32);
    const idA = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    await StorageService.savePaymentRequest({
      ...sentAccepted(PEER_A, idA, verifiedHash),
      status: 'proof_received',
      proofVerified: true,
    });
    await StorageService.setDisplayedPaymentHash(OWNER, PEER_A, idA, 'bb'.repeat(32));
    const row = await StorageService.getPaymentRequest(OWNER, PEER_A, idA);
    expect(row?.displayedPaymentHash).toBe(verifiedHash);
    expect(await StorageService.hasVerifiedPaymentHash(OWNER, verifiedHash, 'other-id')).toBe(true);
  });
});

describe('payment_events unapplied prune', () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it('keeps only the newest 100 unapplied events per sender', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const conversationId = `dm:${PEER_A}`;
    for (let i = 0; i < 105; i += 1) {
      await StorageService.savePaymentEvent({
        ownerPubky: OWNER,
        conversationId,
        senderPubky: PEER_A,
        eventId: `evt-${i.toString().padStart(3, '0')}`,
        kind: 'paykit.unknown',
        paymentRequestId: null,
        applied: false,
        receivedAt: NOW + i,
      });
    }
    const remaining =
      db.executeSync(
        `SELECT COUNT(*) AS n FROM payment_events
          WHERE owner_pubky = ? AND conversation_id = ? AND sender_pubky = ?
            AND applied = 0`,
        [OWNER, conversationId, PEER_A],
      ).rows ?? [];
    expect(Number(remaining[0]?.n)).toBe(100);
    const newest =
      db.executeSync(
        `SELECT event_id FROM payment_events
          WHERE owner_pubky = ? AND conversation_id = ? AND sender_pubky = ?
            AND applied = 0
          ORDER BY received_at DESC LIMIT 1`,
        [OWNER, conversationId, PEER_A],
      ).rows ?? [];
    expect(newest[0]?.event_id).toBe('evt-104');
  });

  it('keeps 200 junk proofs against one accepted request at the unapplied cap', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const requestId = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, requestId, 'aa'.repeat(32)));
    const conversationId = `dm:${PEER_A}`;
    for (let i = 0; i < 200; i += 1) {
      const eventId = `8a0d8b4c-913f-4e31-9f2c-${i.toString(16).padStart(12, '0')}`;
      const proof = buildPaymentProofEnvelope({
        eventId,
        paymentRequestId: requestId,
        paymentReference: 'invoice-2026-0001',
        paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
        proofData: '00'.repeat(32),
      });
      const result = await applyPaymentInbound({
        ownerPubky: OWNER,
        senderPubky: PEER_A,
        peerPubky: PEER_A,
        rawJson: proof.json,
        receivedAt: NOW + i,
        nowMs: NOW + i,
      });
      expect(result.action).toBe('applied');
    }
    const total =
      db.executeSync(
        `SELECT COUNT(*) AS n FROM payment_events
          WHERE owner_pubky = ? AND conversation_id = ? AND sender_pubky = ?`,
        [OWNER, conversationId, PEER_A],
      ).rows ?? [];
    expect(Number(total[0]?.n)).toBeLessThanOrEqual(100);
    const applied =
      db.executeSync(
        `SELECT COUNT(*) AS n FROM payment_events
          WHERE owner_pubky = ? AND conversation_id = ? AND sender_pubky = ?
            AND applied = 1`,
        [OWNER, conversationId, PEER_A],
      ).rows ?? [];
    expect(Number(applied[0]?.n)).toBe(0);
    const row = await StorageService.getPaymentRequest(OWNER, PEER_A, requestId);
    expect(row?.status).toBe('accepted');
  });
});

describe('invoice reuse detection', () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it('detects a snapshot hash already displayed on a non-terminal request', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const hash = 'ab'.repeat(32);
    const idA = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    const idB = 'c7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab44';
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, idA, hash));
    expect(await StorageService.hasNonTerminalDisplayedPaymentHash(OWNER, hash)).toBe(true);
    await StorageService.savePaymentRequest({
      ...sentAccepted(PEER_B, idB, hash),
      invoiceReused: true,
    });
    const reused = await StorageService.getPaymentRequest(OWNER, PEER_B, idB);
    expect(reused?.invoiceReused).toBe(true);
    expect(formatPaymentReceipt(reused!, NOW)).toEqual({
      word: COPY.paymentRequested,
      note: COPY.invoiceAlreadyAttachedRotate,
    });
  });

  it('does not treat a cancelled request as occupying the invoice', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const hash = 'cd'.repeat(32);
    await StorageService.savePaymentRequest({
      ...sentAccepted(PEER_A, 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33', hash),
      status: 'cancelled',
    });
    expect(await StorageService.hasNonTerminalDisplayedPaymentHash(OWNER, hash)).toBe(false);
  });
});
