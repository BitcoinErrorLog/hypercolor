jest.mock('../../StorageService', () => ({
  StorageService: {
    hasPaymentEvent: jest.fn(),
    savePaymentEvent: jest.fn(),
    getPaymentRequest: jest.fn(),
    savePaymentRequest: jest.fn(),
    updatePaymentRequest: jest.fn(),
    replaceTipEndpoints: jest.fn(),
  },
}));

import { StorageService } from '../../StorageService';
import { applyPaymentInbound } from '../applyPaymentInbound';
import {
  ENDPOINT_LIGHTNING_BOLT11,
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
  buildPaymentAcceptanceEnvelope,
  buildPaymentCancellationEnvelope,
  buildPaymentProofEnvelope,
  buildPaymentRejectionEnvelope,
  buildPaymentRequestEnvelope,
  buildPrivatePaymentListEnvelope,
  type PaymentEventRecord,
  type PaymentRequestRecord,
} from '../../../types/payment';

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
  mockedStorage.updatePaymentRequest.mockImplementation(async (owner, peer, id, patch) => {
    const key = requestKey(owner, peer, id);
    const existing = store.requests.get(key);
    if (!existing) return;
    store.requests.set(key, {
      ...existing,
      status: patch.status,
      proofJson: patch.proofJson === undefined ? existing.proofJson : patch.proofJson,
      reason: patch.reason === undefined ? existing.reason : patch.reason,
      updatedAt: NOW,
    });
  });
  mockedStorage.replaceTipEndpoints.mockResolvedValue(undefined);
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
    store = { requests: new Map(), events: new Map() };
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
    expect(store.requests.get(requestKey(OWNER, PEER_A, REQUEST_ID))?.status).toBe(
      'proof_received',
    );
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

  it('replaces the latest tip list for the authenticated sender', async () => {
    const list = buildPrivatePaymentListEnvelope({
      paymentEndpoints: {
        [ENDPOINT_LIGHTNING_BOLT11]: 'lnbc1abcdefghijklmnopqrstuvwxyz',
      },
    });
    const result = await inbound(PEER_A, list.json);
    expect(result).toEqual({ action: 'applied', request: null });
    expect(mockedStorage.replaceTipEndpoints).toHaveBeenCalledWith(
      OWNER,
      PEER_A,
      [{ identifier: ENDPOINT_LIGHTNING_BOLT11, payload: 'lnbc1abcdefghijklmnopqrstuvwxyz' }],
      NOW,
    );
    expect(PAYKIT_PAYMENT_REQUEST_KIND).toBe('paykit.payment_request');
    expect(PAYKIT_PRIVATE_PAYMENT_LIST_KIND).toBe('paykit.private_payment_list');
  });
});
