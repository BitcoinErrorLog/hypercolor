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

jest.mock('../../StorageService', () => ({
  StorageService: {
    hasPaymentEvent: jest.fn(),
    savePaymentEvent: jest.fn(),
    getPaymentRequest: jest.fn(),
    savePaymentRequest: jest.fn(),
    compareAndSetPaymentRequest: jest.fn(),
    replaceTipEndpoints: jest.fn(),
    getTipEndpoint: jest.fn(),
    hasVerifiedPaymentHash: jest.fn(),
    hasOwnInvoiceHash: jest.fn(),
  },
}));

import { createHash } from 'crypto';
import { StorageService } from '../../StorageService';
import { applyPaymentInbound } from '../applyPaymentInbound';
import {
  EMPTY_PAYMENT_RECORD_EXTRAS,
  ENDPOINT_LIGHTNING_BOLT11,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
  buildPaymentAcceptanceEnvelope,
  buildPaymentCancellationEnvelope,
  buildPaymentProofEnvelope,
  buildPaymentRejectionEnvelope,
  buildPaymentRequestEnvelope,
  buildPrivatePaymentListEnvelope,
  displayPaymentStatus,
  type PaymentEventRecord,
  type PaymentRequestPatch,
  type PaymentRequestRecord,
} from '../../../types/payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_HASH,
} from './bolt11Vectors';

const OWNER = 'a'.repeat(52);
const PEER_A = 'b'.repeat(52);
const PEER_B = 'c'.repeat(52);
const NOW = 1_700_000_000_000;
const REQUEST_ID = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
const EVENT_REQ = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d101';
const EVENT_ACC = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d102';
const EVENT_REJ = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d103';
const EVENT_CAN = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d104';
const EVENT_PRF = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d105';

const mockedStorage = jest.mocked(StorageService);

type Store = {
  requests: Map<string, PaymentRequestRecord>;
  events: Map<string, PaymentEventRecord>;
  ownHashes: Set<string>;
};

function requestKey(owner: string, peer: string, id: string): string {
  return `${owner}|${peer}|${id}`;
}

function eventKey(owner: string, conversationId: string, sender: string, eventId: string): string {
  return `${owner}|${conversationId}|${sender}|${eventId}`;
}

function installStore(store: Store): void {
  mockedStorage.hasPaymentEvent.mockImplementation(async (owner, conversationId, sender, eventId) =>
    store.events.has(eventKey(owner, conversationId, sender, eventId)),
  );
  mockedStorage.savePaymentEvent.mockImplementation(async record => {
    const key = eventKey(
      record.ownerPubky,
      record.conversationId,
      record.senderPubky,
      record.eventId,
    );
    if (store.events.has(key)) return false;
    store.events.set(key, record);
    return true;
  });
  mockedStorage.getPaymentRequest.mockImplementation(
    async (owner, peer, id) => store.requests.get(requestKey(owner, peer, id)) ?? null,
  );
  mockedStorage.savePaymentRequest.mockImplementation(async record => {
    store.requests.set(requestKey(record.ownerPubky, record.peerPubky, record.paymentRequestId), {
      ...record,
    });
  });
  mockedStorage.compareAndSetPaymentRequest.mockImplementation(
    async (owner, peer, id, expected, patch: PaymentRequestPatch) => {
      const key = requestKey(owner, peer, id);
      const existing = store.requests.get(key);
      if (!existing) return false;
      if (!expected.includes(existing.status)) return false;
      let nextHash =
        patch.displayedPaymentHash === undefined
          ? existing.displayedPaymentHash
          : patch.displayedPaymentHash;
      let nextVerified =
        patch.proofVerified === undefined ? existing.proofVerified : patch.proofVerified;
      if (nextVerified === true && nextHash) {
        for (const other of store.requests.values()) {
          if (other.ownerPubky !== owner) continue;
          if (other.paymentRequestId === id) continue;
          if (other.displayedPaymentHash === nextHash && other.proofVerified === true) {
            nextVerified = false;
            nextHash = existing.displayedPaymentHash;
            break;
          }
        }
      }
      store.requests.set(key, {
        ...existing,
        status: patch.status,
        proofJson: patch.proofJson === undefined ? existing.proofJson : patch.proofJson,
        reason: patch.reason === undefined ? existing.reason : patch.reason,
        pendingEventId:
          patch.pendingEventId === undefined ? existing.pendingEventId : patch.pendingEventId,
        displayedPaymentHash: nextHash,
        proofVerified: nextVerified,
        updatedAt: NOW,
      });
      return true;
    },
  );
  mockedStorage.replaceTipEndpoints.mockResolvedValue(undefined);
  mockedStorage.getTipEndpoint.mockResolvedValue(null);
  mockedStorage.hasVerifiedPaymentHash.mockImplementation(async (owner, hash, exceptId) => {
    for (const existing of store.requests.values()) {
      if (existing.ownerPubky !== owner) continue;
      if (existing.paymentRequestId === exceptId) continue;
      if (existing.displayedPaymentHash === hash && existing.proofVerified === true) return true;
    }
    return false;
  });
  mockedStorage.hasOwnInvoiceHash.mockImplementation(async (owner, identifier, hash) =>
    store.ownHashes.has(`${owner}|${identifier}|${hash}`),
  );
}

function sentRow(overrides: Partial<PaymentRequestRecord> = {}): PaymentRequestRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER_A,
    direction: 'sent',
    paymentRequestId: REQUEST_ID,
    eventId: EVENT_REQ,
    amountValue: '0.001',
    amountAsset: 'btc',
    paymentReference: 'invoice-2026-0001',
    endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    expiresAt: null,
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    proofJson: null,
    reason: null,
    ...EMPTY_PAYMENT_RECORD_EXTRAS,
    ...overrides,
  };
}

function inbound(sender: string, rawJson: string, nowMs = NOW) {
  return applyPaymentInbound({
    ownerPubky: OWNER,
    senderPubky: sender,
    peerPubky: sender,
    rawJson,
    receivedAt: nowMs,
    nowMs,
  });
}

describe('applyPaymentInbound authorization (S2)', () => {
  let store: Store;

  beforeEach(() => {
    jest.resetAllMocks();
    store = { requests: new Map(), events: new Map(), ownHashes: new Set() };
    installStore(store);
  });

  it('creates a received pending request owned by the authenticated sender', async () => {
    const built = buildPaymentRequestEnvelope({
      eventId: EVENT_REQ,
      paymentRequestId: REQUEST_ID,
      amountValue: '0.001',
      paymentReference: 'invoice-2026-0001',
      endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    });
    const result = await inbound(PEER_A, built.json);
    expect(result.action).toBe('applied');
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))).toEqual(
      expect.objectContaining({
        direction: 'received',
        peerPubky: PEER_A,
        status: 'pending',
        amountValue: '0.001',
      }),
    );
  });

  it('rejects wrong-peer acceptance of a request we sent to someone else', async () => {
    store.requests.set(requestKey(OWNER, PEER_A, REQUEST_ID), sentRow());
    const acceptance = buildPaymentAcceptanceEnvelope({
      eventId: EVENT_ACC,
      paymentRequestId: REQUEST_ID,
    });
    const result = await inbound(PEER_B, acceptance.json);
    expect(result).toEqual({ action: 'rejected' });
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))?.status).toBe('pending');
    expect(store.events.get(eventKey(OWNER, `dm:${PEER_B}`, PEER_B, EVENT_ACC))?.applied).toBe(
      false,
    );
  });

  it('rejects cancellation that is not from the original payee', async () => {
    store.requests.set(requestKey(OWNER, PEER_A, REQUEST_ID), sentRow());
    const cancel = buildPaymentCancellationEnvelope({
      eventId: EVENT_CAN,
      paymentRequestId: REQUEST_ID,
      reason: 'nope',
    });
    const result = await inbound(PEER_A, cancel.json);
    expect(result).toEqual({ action: 'rejected' });
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))?.status).toBe('pending');
  });

  it('rejects proof for an unknown payment_request_id and marks it seen', async () => {
    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: REQUEST_ID,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: 'aabbcc',
    });
    const result = await inbound(PEER_A, proof.json);
    expect(result).toEqual({ action: 'rejected' });
    expect(store.requests.size).toBe(0);
    expect(store.events.get(eventKey(OWNER, `dm:${PEER_A}`, PEER_A, EVENT_PRF))).toEqual(
      expect.objectContaining({ applied: false, paymentRequestId: REQUEST_ID }),
    );
  });

  it('rejects proof on a pending request and marks it seen', async () => {
    store.requests.set(requestKey(OWNER, PEER_A, REQUEST_ID), sentRow({ status: 'pending' }));
    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: REQUEST_ID,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: 'aabbcc',
    });
    const result = await inbound(PEER_A, proof.json);
    expect(result).toEqual({ action: 'rejected' });
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))?.status).toBe('pending');
    expect(store.events.get(eventKey(OWNER, `dm:${PEER_A}`, PEER_A, EVENT_PRF))?.applied).toBe(
      false,
    );
  });

  it('rejects acceptance after proposal expiry', async () => {
    store.requests.set(
      requestKey(OWNER, PEER_A, REQUEST_ID),
      sentRow({ expiresAt: NOW - 1, status: 'pending' }),
    );
    const acceptance = buildPaymentAcceptanceEnvelope({
      eventId: EVENT_ACC,
      paymentRequestId: REQUEST_ID,
    });
    const result = await inbound(PEER_A, acceptance.json, NOW);
    expect(result).toEqual({ action: 'rejected' });
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))?.status).toBe('pending');
  });

  it('rejects cross-peer reuse of a payment_request_id', async () => {
    store.requests.set(requestKey(OWNER, PEER_A, REQUEST_ID), sentRow({ status: 'accepted' }));
    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: REQUEST_ID,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: 'aabbcc',
    });
    const result = await inbound(PEER_B, proof.json);
    expect(result).toEqual({ action: 'rejected' });
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))?.status).toBe('accepted');
  });

  it('dedups the same sender event_id and allows the same event_id from another sender', async () => {
    const built = buildPaymentRequestEnvelope({
      eventId: EVENT_REQ,
      paymentRequestId: REQUEST_ID,
      amountValue: '0.001',
      paymentReference: 'invoice-2026-0001',
      endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    });
    expect((await inbound(PEER_A, built.json)).action).toBe('applied');
    expect((await inbound(PEER_A, built.json)).action).toBe('ignored');

    const other = buildPaymentRequestEnvelope({
      eventId: EVENT_REQ,
      paymentRequestId: 'c7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab44',
      amountValue: '0.002',
      paymentReference: 'other-invoice',
      endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    });
    const second = await inbound(PEER_B, other.json);
    expect(second.action).toBe('applied');
    expect(
      store.requests.get(requestKey(OWNER, PEER_B, 'c7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab44'))?.status,
    ).toBe('pending');
  });

  it('applies payer acceptance and proof, and a second-request rejection', async () => {
    store.requests.set(requestKey(OWNER, PEER_A, REQUEST_ID), sentRow());
    const acceptance = buildPaymentAcceptanceEnvelope({
      eventId: EVENT_ACC,
      paymentRequestId: REQUEST_ID,
    });
    expect((await inbound(PEER_A, acceptance.json)).action).toBe('applied');
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))?.status).toBe('accepted');

    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: REQUEST_ID,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: 'aabbcc',
    });
    expect((await inbound(PEER_A, proof.json)).action).toBe('applied');
    const afterProof = store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID));
    expect(afterProof?.status).toBe('proof_received');
    expect(displayPaymentStatus(afterProof!.status, afterProof!.expiresAt, NOW, afterProof)).toBe(
      'claimed',
    );
  });

  it('renders an empty opaque proof as claimed without a checkmark', async () => {
    store.requests.set(requestKey(OWNER, PEER_A, REQUEST_ID), sentRow({ status: 'accepted' }));
    const envelope = {
      version: 1,
      kind: PAYKIT_PAYMENT_PROOF_KIND,
      event_id: EVENT_PRF,
      payment_request_id: REQUEST_ID,
      payment_reference: 'invoice-2026-0001',
      billing_period: null,
      payment_endpoint_identifier: ENDPOINT_LIGHTNING_BOLT11,
      proof: {},
    };
    expect((await inbound(PEER_A, JSON.stringify(envelope))).action).toBe('applied');
    const row = store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID));
    expect(row?.proofVerified).toBeNull();
    expect(displayPaymentStatus(row!.status, row!.expiresAt, NOW, row)).toBe('claimed');
  });

  it('marks a bolt11 preimage verified when we already displayed the invoice hash', async () => {
    const preimage = 'ab'.repeat(32);
    const paymentHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    store.requests.set(
      requestKey(OWNER, PEER_A, REQUEST_ID),
      sentRow({ status: 'accepted', displayedPaymentHash: paymentHash }),
    );
    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: REQUEST_ID,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    expect((await inbound(PEER_A, proof.json)).action).toBe('applied');
    const row = store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID));
    expect(row?.proofVerified).toBe(true);
    expect(displayPaymentStatus(row!.status, row!.expiresAt, NOW, row)).toBe('verified');
  });

  it('treats a lost compare-and-set as already-transitioned', async () => {
    store.requests.set(requestKey(OWNER, PEER_A, REQUEST_ID), sentRow());
    mockedStorage.compareAndSetPaymentRequest.mockResolvedValueOnce(false);
    const acceptance = buildPaymentAcceptanceEnvelope({
      eventId: EVENT_ACC,
      paymentRequestId: REQUEST_ID,
    });
    const result = await inbound(PEER_A, acceptance.json);
    expect(result).toEqual({ action: 'ignored' });
    expect(store.events.get(eventKey(OWNER, `dm:${PEER_A}`, PEER_A, EVENT_ACC))?.applied).toBe(
      false,
    );
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))?.status).toBe('pending');
  });

  it('rejects payee-originated rejection of a request we received', async () => {
    store.requests.set(
      requestKey(OWNER, PEER_A, REQUEST_ID),
      sentRow({ direction: 'received', status: 'pending' }),
    );
    const rejection = buildPaymentRejectionEnvelope({
      eventId: EVENT_REJ,
      paymentRequestId: REQUEST_ID,
      reason: 'declined',
    });
    const result = await inbound(PEER_A, rejection.json);
    expect(result).toEqual({ action: 'rejected' });
  });

  it('replaces the latest tip list and stores rejected invalid payloads', async () => {
    const list = buildPrivatePaymentListEnvelope({
      paymentEndpoints: {
        [ENDPOINT_LIGHTNING_BOLT11]: MAINNET_BOLT11_20U,
      },
    });
    const result = await inbound(PEER_A, list.json);
    expect(result).toEqual({ action: 'applied', request: null });
    expect(mockedStorage.replaceTipEndpoints).toHaveBeenCalledWith(
      OWNER,
      PEER_A,
      [
        expect.objectContaining({
          identifier: ENDPOINT_LIGHTNING_BOLT11,
          payload: MAINNET_BOLT11_20U,
          validationStatus: 'valid',
          invoiceAmount: MAINNET_BOLT11_20U_BTC,
          paymentHash: MAINNET_BOLT11_20U_HASH,
        }),
      ],
      NOW,
    );

    const invalid = {
      version: 1,
      kind: PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
      payment_endpoints: {
        [ENDPOINT_LIGHTNING_BOLT11]: 'javascript:alert(1)',
      },
    };
    await inbound(PEER_A, JSON.stringify(invalid));
    expect(mockedStorage.replaceTipEndpoints).toHaveBeenLastCalledWith(
      OWNER,
      PEER_A,
      [
        expect.objectContaining({
          identifier: ENDPOINT_LIGHTNING_BOLT11,
          payload: 'javascript:alert(1)',
          validationStatus: 'rejected',
        }),
      ],
      NOW,
    );
    expect(PAYKIT_PAYMENT_REQUEST_KIND).toBe('paykit.payment_request');
    expect(PAYKIT_PRIVATE_PAYMENT_LIST_KIND).toBe('paykit.private_payment_list');
  });

  it('does not mark a second request paid when the same preimage is reused', async () => {
    const preimage = 'cd'.repeat(32);
    const paymentHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    const secondId = 'c7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab44';
    store.requests.set(
      requestKey(OWNER, PEER_A, REQUEST_ID),
      sentRow({
        status: 'proof_received',
        displayedPaymentHash: paymentHash,
        proofVerified: true,
      }),
    );
    store.requests.set(
      requestKey(OWNER, PEER_A, secondId),
      sentRow({
        paymentRequestId: secondId,
        status: 'accepted',
        displayedPaymentHash: paymentHash,
      }),
    );
    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: secondId,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    expect((await inbound(PEER_A, proof.json)).action).toBe('applied');
    const second = store.requests.get(requestKey(OWNER, PEER_A, secondId));
    expect(second?.status).toBe('proof_received');
    expect(second?.proofVerified).not.toBe(true);
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))?.proofVerified).toBe(true);
  });

  it('marks paid when a stale snapshot is rebound to a rotated own invoice', async () => {
    const preimage = 'ab'.repeat(32);
    const rotatedHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    const staleHash = '11'.repeat(32);
    store.requests.set(
      requestKey(OWNER, PEER_A, REQUEST_ID),
      sentRow({ status: 'accepted', displayedPaymentHash: staleHash }),
    );
    store.ownHashes.add(`${OWNER}|${ENDPOINT_LIGHTNING_BOLT11}|${rotatedHash}`);
    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: REQUEST_ID,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    expect((await inbound(PEER_A, proof.json)).action).toBe('applied');
    const row = store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID));
    expect(row?.proofVerified).toBe(true);
    expect(row?.displayedPaymentHash).toBe(rotatedHash);
    expect(displayPaymentStatus(row!.status, row!.expiresAt, NOW, row)).toBe('verified');
  });

  it('marks paid when the snapshot is null and the preimage matches a later own invoice', async () => {
    const preimage = 'cd'.repeat(32);
    const laterHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    store.requests.set(
      requestKey(OWNER, PEER_A, REQUEST_ID),
      sentRow({ status: 'accepted', displayedPaymentHash: null }),
    );
    store.ownHashes.add(`${OWNER}|${ENDPOINT_LIGHTNING_BOLT11}|${laterHash}`);
    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: REQUEST_ID,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    expect((await inbound(PEER_A, proof.json)).action).toBe('applied');
    const row = store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID));
    expect(row?.proofVerified).toBe(true);
    expect(row?.displayedPaymentHash).toBe(laterHash);
  });

  it('leaves proofVerified null for a preimage this owner never issued', async () => {
    const preimage = 'ab'.repeat(32);
    store.requests.set(
      requestKey(OWNER, PEER_A, REQUEST_ID),
      sentRow({ status: 'accepted', displayedPaymentHash: null }),
    );
    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: REQUEST_ID,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    expect((await inbound(PEER_A, proof.json)).action).toBe('applied');
    const row = store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID));
    expect(row?.proofVerified).toBeNull();
    expect(row?.displayedPaymentHash).toBeNull();
    expect(displayPaymentStatus(row!.status, row!.expiresAt, NOW, row)).toBe('claimed');
  });

  it('marks a genuine per-request hash match as verified', async () => {
    const preimage = 'ef'.repeat(32);
    const paymentHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    store.requests.set(
      requestKey(OWNER, PEER_A, REQUEST_ID),
      sentRow({ status: 'accepted', displayedPaymentHash: paymentHash }),
    );
    const proof = buildPaymentProofEnvelope({
      eventId: EVENT_PRF,
      paymentRequestId: REQUEST_ID,
      paymentReference: 'invoice-2026-0001',
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: preimage,
    });
    expect((await inbound(PEER_A, proof.json)).action).toBe('applied');
    const row = store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID));
    expect(row?.proofVerified).toBe(true);
  });
});
