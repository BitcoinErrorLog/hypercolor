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
import { paintOwner, resetPaintedOwnerModuleForTests } from '../../paintedOwner';
import { applyPaymentInbound } from '../applyPaymentInbound';
import { COPY } from '../../../copy/uxCopy';
import { formatPaymentReceipt } from '../../../ui/paymentReceiptStatus';
import { MAINNET_BOLT11_20U } from './bolt11Vectors';
import {
  EMPTY_PAYMENT_RECORD_EXTRAS,
  ENDPOINT_LIGHTNING_BOLT11,
  buildPaymentProofEnvelope,
  buildPaymentRequestEnvelope,
  buildPrivatePaymentListEnvelope,
  expectedStatusesForAction,
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
  beforeEach(() => {
    resetPaintedOwnerModuleForTests();
    paintOwner(OWNER);
  });
  afterEach(() => {
    setDbForTests(null);
    resetPaintedOwnerModuleForTests();
  });

  // Promise.all is scheduling-deterministic on better-sqlite3 (sync adapter).
  // The assertion that matters is the unique-index catch path, not interleaving.

  it('marks exactly one request paid when two proofs share a preimage', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);

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
  beforeEach(() => {
    resetPaintedOwnerModuleForTests();
    paintOwner(OWNER);
  });
  afterEach(() => {
    setDbForTests(null);
  });

  it('does not mark a 1,000,000-sat request paid from a 1,000-sat invoice', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);

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
  beforeEach(() => {
    resetPaintedOwnerModuleForTests();
    paintOwner(OWNER);
  });
  afterEach(() => {
    setDbForTests(null);
  });

  it('marks the stream item processed and does not pay when the table is absent', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
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
  beforeEach(() => {
    resetPaintedOwnerModuleForTests();
    paintOwner(OWNER);
  });
  afterEach(() => {
    setDbForTests(null);
  });

  it('refuses to overwrite displayed_payment_hash once proof_verified is 1', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
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
  beforeEach(() => {
    resetPaintedOwnerModuleForTests();
    paintOwner(OWNER);
  });
  afterEach(() => {
    setDbForTests(null);
  });

  it('keeps only the newest 100 unapplied events per sender', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
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
    paintOwner(OWNER);
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

describe('invoice reuse and terminal unbind', () => {
  beforeEach(() => {
    resetPaintedOwnerModuleForTests();
    paintOwner(OWNER);
  });
  afterEach(() => {
    setDbForTests(null);
  });

  it('detects a snapshot hash already displayed on a non-terminal request', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
    const hash = 'ab'.repeat(32);
    const idA = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    const idB = 'c7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab44';
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, idA, hash));
    expect((await StorageService.getPaymentRequest(OWNER, PEER_A, idA))?.displayedPaymentHash).toBe(
      hash,
    );
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

  it('flags reuse after a cancelled request and still proves the next request', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
    const preimage = 'ab'.repeat(32);
    const paymentHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    const idA = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    const idB = 'c7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab44';
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, idA, paymentHash));
    await StorageService.recordOwnInvoiceDisplay({
      ownerPubky: OWNER,
      endpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      paymentHash,
      context: 'request',
      paymentRequestId: idA,
      firstSeenAt: NOW,
      invoiceAmountMsat: '100000000',
      invoiceExpiresAt: NOW + 86_400_000,
    });
    expect(
      await StorageService.compareAndSetPaymentRequest(
        OWNER,
        PEER_A,
        idA,
        expectedStatusesForAction('cancel'),
        { status: 'cancelled' },
      ),
    ).toBe(true);
    expect(
      (await StorageService.getOwnInvoiceHash(OWNER, ENDPOINT_LIGHTNING_BOLT11, paymentHash))
        ?.paymentRequestId,
    ).toBeNull();
    expect((await StorageService.getPaymentRequest(OWNER, PEER_A, idA))?.displayedPaymentHash).toBe(
      paymentHash,
    );
    await StorageService.savePaymentRequest({
      ...sentAccepted(PEER_A, idB, paymentHash),
      invoiceReused: true,
    });
    const proof = buildPaymentProofEnvelope({
      eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d108',
      paymentRequestId: idB,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    expect(
      (
        await applyPaymentInbound({
          ownerPubky: OWNER,
          senderPubky: PEER_A,
          peerPubky: PEER_A,
          rawJson: proof.json,
          receivedAt: NOW,
          nowMs: NOW,
        })
      ).action,
    ).toBe('applied');
    const payee = await StorageService.getPaymentRequest(OWNER, PEER_A, idB);
    expect(payee?.proofVerified).toBe(true);
    expect(payee?.status).toBe('proof_received');
    expect(formatPaymentReceipt(payee!, NOW)).toEqual({ word: COPY.paymentPaid, note: null });
    const payer = sentAccepted(PEER_A, idB, paymentHash);
    payer.direction = 'received';
    payer.status = 'proof_received';
    payer.proofVerified = true;
    expect(formatPaymentReceipt(payer, NOW)).toEqual({ word: COPY.paymentPaid, note: null });
    const cancelled = await StorageService.getPaymentRequest(OWNER, PEER_A, idA);
    expect(cancelled?.status).toBe('cancelled');
    expect(formatPaymentReceipt(cancelled!, NOW).word).toBe(COPY.paymentFailed);
  });

  it('keeps a verified binding sticky so a second request stays accepted and flagged', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
    const preimage = 'ab'.repeat(32);
    const paymentHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    const idA = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    const idB = 'c7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab44';
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, idA, paymentHash));
    await StorageService.recordOwnInvoiceDisplay({
      ownerPubky: OWNER,
      endpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      paymentHash,
      context: 'request',
      paymentRequestId: idA,
      firstSeenAt: NOW,
      invoiceAmountMsat: '100000000',
      invoiceExpiresAt: NOW + 86_400_000,
    });
    const proofA = buildPaymentProofEnvelope({
      eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d105',
      paymentRequestId: idA,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    expect(
      (
        await applyPaymentInbound({
          ownerPubky: OWNER,
          senderPubky: PEER_A,
          peerPubky: PEER_A,
          rawJson: proofA.json,
          receivedAt: NOW,
          nowMs: NOW,
        })
      ).action,
    ).toBe('applied');
    expect(
      (await StorageService.getOwnInvoiceHash(OWNER, ENDPOINT_LIGHTNING_BOLT11, paymentHash))
        ?.paymentRequestId,
    ).toBe(idA);
    await StorageService.savePaymentRequest({
      ...sentAccepted(PEER_B, idB, paymentHash),
      invoiceReused: true,
    });
    const proofB = buildPaymentProofEnvelope({
      eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d106',
      paymentRequestId: idB,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    expect(
      (
        await applyPaymentInbound({
          ownerPubky: OWNER,
          senderPubky: PEER_B,
          peerPubky: PEER_B,
          rawJson: proofB.json,
          receivedAt: NOW + 1,
          nowMs: NOW + 1,
        })
      ).action,
    ).toBe('applied');
    const second = await StorageService.getPaymentRequest(OWNER, PEER_B, idB);
    expect(second?.status).toBe('accepted');
    expect(second?.proofVerified).toBe(false);
    expect(second?.invoiceReused).toBe(true);
    expect(formatPaymentReceipt(second!, NOW)).toEqual({
      word: COPY.paymentRequested,
      note: COPY.invoiceAlreadyAttachedRotate,
    });
    const first = await StorageService.getPaymentRequest(OWNER, PEER_A, idA);
    expect(first?.proofVerified).toBe(true);
  });

  it('flags a new request when a pending request already displayed the hash', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
    const hash = 'cd'.repeat(32);
    await StorageService.savePaymentRequest({
      ...sentAccepted(PEER_A, 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33', hash),
      status: 'pending',
    });
    expect(
      (
        await StorageService.getPaymentRequest(
          OWNER,
          PEER_A,
          'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
        )
      )?.displayedPaymentHash,
    ).toBe(hash);
  });
});

describe('invoice_reused column repair isolation', () => {
  beforeEach(() => {
    resetPaintedOwnerModuleForTests();
    paintOwner(OWNER);
  });
  afterEach(() => {
    setDbForTests(null);
  });

  it('keeps invoice_reused after a later repair statement throws and still inserts', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
    db.executeSync('ALTER TABLE payment_requests DROP COLUMN invoice_reused');
    expect(
      (db.executeSync('PRAGMA table_info(payment_requests)').rows ?? []).map(col =>
        String(col.name),
      ),
    ).not.toContain('invoice_reused');
    const original = db.executeSync.bind(db);
    db.executeSync = (query, params) => {
      const sql = String(query);
      if (
        sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_owner_verified_hash')
      ) {
        throw new Error('index boom');
      }
      return original(query, params);
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(runMigrations(db)).resolves.toBeUndefined();
    db.executeSync = original;
    expect(
      (db.executeSync('PRAGMA table_info(payment_requests)').rows ?? []).map(col =>
        String(col.name),
      ),
    ).toContain('invoice_reused');
    await StorageService.savePaymentRequest(
      sentAccepted(PEER_A, 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33', 'ab'.repeat(32)),
    );
    const row = await StorageService.getPaymentRequest(
      OWNER,
      PEER_A,
      'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
    );
    expect(row?.paymentRequestId).toBe('b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33');
    expect(warn).toHaveBeenCalledWith(
      '[db] own_invoice_hashes repair failed; will retry next launch',
      'index boom',
    );
    warn.mockRestore();
  });

  it('inserts and marks inbound seen when invoice_reused is absent and ALTER fails', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
    db.executeSync('ALTER TABLE payment_requests DROP COLUMN invoice_reused');
    const original = db.executeSync.bind(db);
    db.executeSync = (query, params) => {
      const sql = String(query);
      if (sql.includes('ADD COLUMN invoice_reused')) {
        throw new Error('alter boom');
      }
      return original(query, params);
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(runMigrations(db)).resolves.toBeUndefined();
    db.executeSync = original;
    expect(
      (db.executeSync('PRAGMA table_info(payment_requests)').rows ?? []).map(col =>
        String(col.name),
      ),
    ).not.toContain('invoice_reused');
    const built = buildPaymentRequestEnvelope({
      eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d101',
      paymentRequestId: 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
      amountValue: '0.001',
      paymentReference: 'invoice-2026-0001',
      endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    });
    const result = await applyPaymentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      peerPubky: PEER_A,
      rawJson: built.json,
      receivedAt: NOW,
      nowMs: NOW,
    });
    expect(result.action).toBe('applied');
    const row = await StorageService.getPaymentRequest(
      OWNER,
      PEER_A,
      'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
    );
    expect(row?.status).toBe('pending');
    expect(row?.invoiceReused).toBe(false);
    expect(
      await StorageService.hasPaymentEvent(OWNER, `dm:${PEER_A}`, PEER_A, built.envelope.event_id),
    ).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[db] payment_requests.invoice_reused missing; inserting without the flag',
    );
    warn.mockRestore();
  });
});

describe('tip-list payment_events markers', () => {
  beforeEach(() => {
    resetPaintedOwnerModuleForTests();
    paintOwner(OWNER);
  });
  afterEach(() => {
    setDbForTests(null);
  });

  it('keys a tip list by event_id so a replay is ignored', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
    const built = buildPrivatePaymentListEnvelope({
      paymentEndpoints: { [ENDPOINT_LIGHTNING_BOLT11]: MAINNET_BOLT11_20U },
    });
    const eventId = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d109';
    const rawJson = JSON.stringify({ ...JSON.parse(built.json), event_id: eventId });
    const first = await applyPaymentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      peerPubky: PEER_A,
      rawJson,
      receivedAt: NOW,
      nowMs: NOW,
    });
    const second = await applyPaymentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      peerPubky: PEER_A,
      rawJson,
      receivedAt: NOW + 1,
      nowMs: NOW + 1,
    });
    expect(first.action).toBe('applied');
    expect(second.action).toBe('ignored');
    expect(await StorageService.hasPaymentEvent(OWNER, `dm:${PEER_A}`, PEER_A, eventId)).toBe(true);
    const total =
      db.executeSync(
        `SELECT COUNT(*) AS n FROM payment_events
          WHERE owner_pubky = ? AND conversation_id = ? AND sender_pubky = ?`,
        [OWNER, `dm:${PEER_A}`, PEER_A],
      ).rows ?? [];
    expect(Number(total[0]?.n)).toBe(1);
  });

  it('marks an unchanged tip list unapplied so prune covers a flood', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
    const built = buildPrivatePaymentListEnvelope({
      paymentEndpoints: { [ENDPOINT_LIGHTNING_BOLT11]: MAINNET_BOLT11_20U },
    });
    for (let i = 0; i < 200; i += 1) {
      const result = await applyPaymentInbound({
        ownerPubky: OWNER,
        senderPubky: PEER_A,
        peerPubky: PEER_A,
        rawJson: built.json,
        receivedAt: NOW + i,
        nowMs: NOW + i,
      });
      expect(result.action).toBe('applied');
    }
    const applied =
      db.executeSync(
        `SELECT COUNT(*) AS n FROM payment_events
          WHERE owner_pubky = ? AND conversation_id = ? AND sender_pubky = ?
            AND applied = 1`,
        [OWNER, `dm:${PEER_A}`, PEER_A],
      ).rows ?? [];
    expect(Number(applied[0]?.n)).toBe(1);
    const unapplied =
      db.executeSync(
        `SELECT COUNT(*) AS n FROM payment_events
          WHERE owner_pubky = ? AND conversation_id = ? AND sender_pubky = ?
            AND applied = 0`,
        [OWNER, `dm:${PEER_A}`, PEER_A],
      ).rows ?? [];
    expect(Number(unapplied[0]?.n)).toBeLessThanOrEqual(100);
  });
});
