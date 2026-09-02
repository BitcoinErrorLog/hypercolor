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
    await StorageService.savePaymentRequest(sentAccepted(PEER_A, largeId, '22'.repeat(32), '0.01'));
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
