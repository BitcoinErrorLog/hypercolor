jest.mock('uuid', () => ({ v4: jest.fn() }));

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

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
  },
}));

jest.mock('../../StorageService', () => ({
  StorageService: {
    getPaymentRequest: jest.fn(),
    persistPaymentCreateWithSendIntent: jest.fn(),
    persistPaymentOutboundTransition: jest.fn(),
    persistPaymentEventWithSendIntent: jest.fn(),
    replaceTipEndpoints: jest.fn(),
    recordOwnInvoiceDisplay: jest.fn(),
    listTipEndpoints: jest.fn(),
    listPaymentRequestsForPeer: jest.fn(),
    setDisplayedPaymentHash: jest.fn(),
    getTipEndpoint: jest.fn(),
    hasDisplayedPaymentHash: jest.fn(),
  },
}));

jest.mock('../../link/LinkService', () => ({
  buildPreparedSendIntent: jest.fn(input => ({
    message: {
      ownerPubky: input.ownerPubky,
      eventId: input.eventId,
      conversationId: `dm:${input.peerPubky}`,
      peerPubky: input.peerPubky,
      senderPubky: input.ownerPubky,
      direction: 'sent',
      kind: input.kind,
      rawJson: input.rawJson,
      body: input.body,
      sentAt: input.sentAt,
      receivedAt: null,
      deliveryState: 'sending',
    },
    queueItem: {
      id: input.queueId,
      messageId: input.eventId,
      recipientPubky: input.peerPubky,
      payload: JSON.stringify({
        type: 'link.chat.message',
        eventId: input.eventId,
        rawJson: input.rawJson,
      }),
      attempts: 0,
      nextRetryAt: input.sentAt,
      createdAt: input.sentAt,
    },
  })),
  LinkService: {
    withPeerQueue: jest.fn((_peer: string, fn: () => Promise<unknown>) => fn()),
    attemptPersistedSend: jest.fn().mockResolvedValue('sent'),
    sendPreparedMessage: jest.fn(),
  },
}));

import { v4 as uuidv4 } from 'uuid';
import { KeyStore } from '../../KeyStore';
import { StorageService } from '../../StorageService';
import { LinkService } from '../../link/LinkService';
import { PaymentService } from '../PaymentService';
import {
  EMPTY_PAYMENT_RECORD_EXTRAS,
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
  PaymentError,
  displayPaymentStatus,
  type PaymentRequestRecord,
} from '../../../types/payment';
import { MAINNET_BOLT11_20U, MAINNET_P2TR } from './bolt11Vectors';

const OWNER = 'a'.repeat(52);
const PEER = 'b'.repeat(52);
const REQUEST_ID = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
const EVENT_ID = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d101';
const EVENT_NEXT = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d102';
const QUEUE_ID = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d199';

const mockedUuid = uuidv4 as jest.Mock;
const mockedKeyStore = jest.mocked(KeyStore);
const mockedStorage = jest.mocked(StorageService);
const mockedLink = jest.mocked(LinkService);

function row(overrides: Partial<PaymentRequestRecord> = {}): PaymentRequestRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    direction: 'received',
    paymentRequestId: REQUEST_ID,
    eventId: EVENT_ID,
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
    ...overrides,
  };
}

describe('PaymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedLink.withPeerQueue.mockImplementation((_peer, fn) => fn());
    mockedLink.attemptPersistedSend.mockResolvedValue('sent');
    mockedStorage.persistPaymentOutboundTransition.mockResolvedValue(true);
    mockedStorage.persistPaymentCreateWithSendIntent.mockResolvedValue(undefined);
    mockedStorage.persistPaymentEventWithSendIntent.mockResolvedValue(undefined);
    mockedStorage.getTipEndpoint.mockResolvedValue(null);
    mockedStorage.recordOwnInvoiceDisplay.mockResolvedValue(undefined);
    mockedStorage.hasDisplayedPaymentHash.mockResolvedValue(false);
  });

  it('persists and sends a payment_request within the link byte budget', async () => {
    mockedUuid
      .mockReturnValueOnce(EVENT_ID)
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(QUEUE_ID);
    const createdRow = row({
      direction: 'sent',
      pendingEventId: EVENT_ID,
    });
    mockedStorage.getPaymentRequest.mockResolvedValue(createdRow);
    const created = await PaymentService.requestPayment(
      PEER,
      { value: '0.001' },
      'invoice-2026-0001',
    );
    expect(created).toEqual(
      expect.objectContaining({
        direction: 'sent',
        paymentRequestId: REQUEST_ID,
        amountValue: '0.001',
        status: 'pending',
      }),
    );
    expect(mockedStorage.persistPaymentCreateWithSendIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({ pendingEventId: EVENT_ID, status: 'pending' }),
        sendIntent: expect.objectContaining({
          queueItem: expect.objectContaining({ id: QUEUE_ID, messageId: EVENT_ID }),
        }),
      }),
    );
    expect(mockedLink.attemptPersistedSend).toHaveBeenCalledWith(
      expect.objectContaining({
        peerPubky: PEER,
        kind: PAYKIT_PAYMENT_REQUEST_KIND,
        eventId: EVENT_ID,
        queueId: QUEUE_ID,
      }),
    );
    expect(mockedLink.sendPreparedMessage).not.toHaveBeenCalled();
    const persistCall = mockedStorage.persistPaymentCreateWithSendIntent.mock.calls[0];
    expect(persistCall).toBeDefined();
    const sentJson = persistCall![0].sendIntent.message.rawJson;
    expect(new TextEncoder().encode(sentJson).byteLength).toBeLessThanOrEqual(1000);
    expect(JSON.parse(sentJson).request.metadata).toEqual({});
  });

  it('rejects a payee trying to accept their own outbound request', async () => {
    mockedStorage.getPaymentRequest.mockResolvedValue(row({ direction: 'sent' }));
    await expect(PaymentService.acceptRequest(PEER, REQUEST_ID)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(mockedStorage.persistPaymentOutboundTransition).not.toHaveBeenCalled();
    expect(mockedLink.attemptPersistedSend).not.toHaveBeenCalled();
  });

  it('refuses accept after proposal expiry', async () => {
    mockedStorage.getPaymentRequest.mockResolvedValue(
      row({ expiresAt: Date.now() - 5_000, status: 'pending' }),
    );
    await expect(PaymentService.acceptRequest(PEER, REQUEST_ID)).rejects.toBeInstanceOf(
      PaymentError,
    );
    await expect(PaymentService.acceptRequest(PEER, REQUEST_ID)).rejects.toMatchObject({
      code: 'expired',
    });
  });

  it('sends acceptance for an inbound pending request', async () => {
    mockedUuid.mockReturnValueOnce(EVENT_NEXT).mockReturnValueOnce(QUEUE_ID);
    const pending = row({ direction: 'received', status: 'pending' });
    mockedStorage.getPaymentRequest
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, status: 'accepted', pendingEventId: EVENT_NEXT });
    const updated = await PaymentService.acceptRequest(PEER, REQUEST_ID);
    expect(updated.status).toBe('accepted');
    expect(mockedStorage.persistPaymentOutboundTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatuses: ['pending'],
        patch: expect.objectContaining({ status: 'accepted', pendingEventId: EVENT_NEXT }),
        sendIntent: expect.objectContaining({
          message: expect.objectContaining({ kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND }),
        }),
      }),
    );
    expect(mockedLink.attemptPersistedSend).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND, eventId: EVENT_NEXT }),
    );
  });

  it('surfaces conflict when a compare-and-set loses a race', async () => {
    mockedUuid.mockReturnValueOnce(EVENT_NEXT).mockReturnValueOnce(QUEUE_ID);
    mockedStorage.getPaymentRequest.mockResolvedValue(row({ direction: 'received' }));
    mockedStorage.persistPaymentOutboundTransition.mockResolvedValue(false);
    await expect(PaymentService.acceptRequest(PEER, REQUEST_ID)).rejects.toMatchObject({
      code: 'conflict',
      message: 'already transitioned',
    });
    expect(mockedLink.attemptPersistedSend).not.toHaveBeenCalled();
  });

  it('leaves a queued send intent and sending status when delivery fails', async () => {
    mockedUuid.mockReturnValueOnce(EVENT_NEXT).mockReturnValueOnce(QUEUE_ID);
    const pending = row({ direction: 'received', status: 'pending' });
    const sending = { ...pending, status: 'accepted' as const, pendingEventId: EVENT_NEXT };
    mockedStorage.getPaymentRequest.mockResolvedValueOnce(pending).mockResolvedValueOnce(sending);
    mockedLink.attemptPersistedSend.mockResolvedValue('queued');
    const updated = await PaymentService.acceptRequest(PEER, REQUEST_ID);
    expect(updated.pendingEventId).toBe(EVENT_NEXT);
    expect(displayPaymentStatus(updated.status, updated.expiresAt, Date.now(), updated)).toBe(
      'sending',
    );
    expect(mockedStorage.persistPaymentOutboundTransition).toHaveBeenCalled();
    expect(mockedLink.attemptPersistedSend).toHaveBeenCalled();
  });

  it('submits a manual proof after the payer paid in a wallet', async () => {
    mockedUuid.mockReturnValueOnce(EVENT_NEXT).mockReturnValueOnce(QUEUE_ID);
    const accepted = row({ direction: 'received', status: 'accepted' });
    mockedStorage.getPaymentRequest
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce({ ...accepted, status: 'proof_received', pendingEventId: EVENT_NEXT });
    const updated = await PaymentService.submitProofManual(PEER, REQUEST_ID, 'aabbcc');
    expect(updated.status).toBe('proof_received');
    expect(mockedStorage.persistPaymentOutboundTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatuses: ['accepted'],
        patch: expect.objectContaining({ status: 'proof_received' }),
        sendIntent: expect.objectContaining({
          message: expect.objectContaining({ kind: PAYKIT_PAYMENT_PROOF_KIND }),
        }),
      }),
    );
  });

  it('validates tip endpoints with the same S3 rules and composes a private_payment_list', async () => {
    mockedStorage.listTipEndpoints.mockResolvedValue([
      {
        ownerPubky: OWNER,
        peerPubky: OWNER,
        identifier: ENDPOINT_LIGHTNING_BOLT11,
        payload: MAINNET_BOLT11_20U,
        updatedAt: 1,
        validationStatus: 'valid',
        invoiceAmount: '0.00002',
        invoiceExpiresAt: 1,
        paymentHash: 'aa'.repeat(32),
      },
    ]);
    mockedUuid.mockReturnValueOnce(EVENT_NEXT).mockReturnValueOnce(QUEUE_ID);
    await PaymentService.sendTipList(PEER);
    expect(mockedStorage.persistPaymentEventWithSendIntent).toHaveBeenCalled();
    const persistCall = mockedStorage.persistPaymentEventWithSendIntent.mock.calls[0];
    expect(persistCall).toBeDefined();
    const sent = persistCall![0].sendIntent.message;
    expect(sent.kind).toBe(PAYKIT_PRIVATE_PAYMENT_LIST_KIND);
    expect(JSON.parse(sent.rawJson)).toEqual({
      version: 1,
      kind: PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
      payment_endpoints: {
        [ENDPOINT_LIGHTNING_BOLT11]: MAINNET_BOLT11_20U,
      },
    });

    await expect(
      PaymentService.setMyTipEndpoints([
        { identifier: ENDPOINT_LIGHTNING_BOLT11, payload: 'javascript:alert(1)' },
      ]),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      PaymentService.setMyTipEndpoints([
        { identifier: ENDPOINT_BITCOIN_P2TR, payload: 'file:///etc/passwd' },
      ]),
    ).rejects.toMatchObject({ code: 'validation' });
    await PaymentService.setMyTipEndpoints([
      { identifier: ENDPOINT_LIGHTNING_BOLT11, payload: MAINNET_BOLT11_20U },
      { identifier: ENDPOINT_BITCOIN_P2TR, payload: MAINNET_P2TR },
    ]);
    expect(mockedStorage.replaceTipEndpoints).toHaveBeenCalledWith(
      OWNER,
      OWNER,
      expect.arrayContaining([
        expect.objectContaining({
          identifier: ENDPOINT_LIGHTNING_BOLT11,
          validationStatus: 'valid',
        }),
      ]),
      expect.any(Number),
    );
  });

  it('rejects an empty payment reference before persisting or sending', async () => {
    mockedUuid.mockReturnValue(EVENT_ID);
    await expect(
      PaymentService.requestPayment(PEER, { value: '0.001' }, ''),
    ).rejects.toBeInstanceOf(PaymentError);
    await expect(PaymentService.requestPayment(PEER, { value: '0.001' }, '')).rejects.toMatchObject(
      {
        code: 'validation',
      },
    );
    await expect(PaymentService.requestPayment(PEER, { value: '0.001' }, '')).rejects.toThrow(
      'payment_reference is invalid',
    );
    await expect(PaymentService.requestPayment(PEER, { value: '0.001' }, '   ')).rejects.toThrow(
      'payment_reference is invalid',
    );
    expect(mockedStorage.persistPaymentCreateWithSendIntent).not.toHaveBeenCalled();
    expect(mockedLink.attemptPersistedSend).not.toHaveBeenCalled();
  });

  it('enforces the Encrypted Link byte budget on outbound requests', async () => {
    mockedUuid.mockReturnValueOnce(EVENT_ID).mockReturnValueOnce(REQUEST_ID);
    await expect(
      PaymentService.requestPayment(PEER, { value: '0.001' }, 'r'.repeat(256), [
        ENDPOINT_LIGHTNING_BOLT11,
        ...Array.from(
          { length: 20 },
          (_, i) => `btc-lightning-bolt${i.toString().padStart(2, '0')}`,
        ),
      ]),
    ).rejects.toMatchObject({ code: 'budget' });
    expect(mockedStorage.persistPaymentCreateWithSendIntent).not.toHaveBeenCalled();
    expect(mockedLink.attemptPersistedSend).not.toHaveBeenCalled();
  });

  it('snapshots the payee invoice hash onto the request at create time', async () => {
    mockedUuid
      .mockReturnValueOnce(EVENT_ID)
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(QUEUE_ID);
    mockedStorage.getTipEndpoint.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: OWNER,
      identifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_20U,
      updatedAt: 1,
      validationStatus: 'valid',
      invoiceAmount: null,
      invoiceExpiresAt: null,
      paymentHash: 'ab'.repeat(32),
    });
    mockedStorage.getPaymentRequest.mockResolvedValue(
      row({
        direction: 'sent',
        pendingEventId: EVENT_ID,
        displayedPaymentHash: 'ab'.repeat(32),
      }),
    );
    await PaymentService.requestPayment(PEER, { value: '0.001' }, 'invoice-2026-0001');
    expect(mockedStorage.hasDisplayedPaymentHash).toHaveBeenCalledWith(OWNER, 'ab'.repeat(32));
    expect(mockedStorage.persistPaymentCreateWithSendIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          displayedPaymentHash: 'ab'.repeat(32),
          invoiceReused: false,
        }),
      }),
    );
  });

  it('flags a new request whose snapshot invoice is already on another open request', async () => {
    mockedUuid
      .mockReturnValueOnce(EVENT_ID)
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(QUEUE_ID);
    mockedStorage.getTipEndpoint.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: OWNER,
      identifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_20U,
      updatedAt: 1,
      validationStatus: 'valid',
      invoiceAmount: null,
      invoiceExpiresAt: null,
      paymentHash: 'ab'.repeat(32),
    });
    mockedStorage.hasDisplayedPaymentHash.mockResolvedValue(true);
    mockedStorage.getPaymentRequest.mockResolvedValue(
      row({
        direction: 'sent',
        pendingEventId: EVENT_ID,
        displayedPaymentHash: 'ab'.repeat(32),
        invoiceReused: true,
      }),
    );
    const created = await PaymentService.requestPayment(
      PEER,
      { value: '0.001' },
      'invoice-2026-0001',
    );
    expect(mockedStorage.persistPaymentCreateWithSendIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({ invoiceReused: true }),
      }),
    );
    expect(created.invoiceReused).toBe(true);
  });
});
