jest.mock('uuid', () => ({ v4: jest.fn() }));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
  },
}));

jest.mock('../../StorageService', () => ({
  StorageService: {
    savePaymentRequest: jest.fn(),
    savePaymentEvent: jest.fn(),
    getPaymentRequest: jest.fn(),
    updatePaymentRequest: jest.fn(),
    replaceTipEndpoints: jest.fn(),
    listTipEndpoints: jest.fn(),
    listPaymentRequestsForPeer: jest.fn(),
  },
}));

jest.mock('../../link/LinkService', () => ({
  LinkService: {
    sendPreparedMessage: jest.fn(),
  },
}));

import { v4 as uuidv4 } from 'uuid';
import { KeyStore } from '../../KeyStore';
import { StorageService } from '../../StorageService';
import { LinkService } from '../../link/LinkService';
import { PaymentService } from '../PaymentService';
import {
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
  PaymentError,
  type PaymentRequestRecord,
} from '../../../types/payment';

const OWNER = 'a'.repeat(52);
const PEER = 'b'.repeat(52);
const REQUEST_ID = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
const EVENT_ID = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d101';
const EVENT_NEXT = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d102';

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
    ...overrides,
  };
}

describe('PaymentService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedStorage.savePaymentEvent.mockResolvedValue(true);
    mockedLink.sendPreparedMessage.mockResolvedValue({
      eventId: EVENT_ID,
      rawJson: '{}',
    } as never);
  });

  it('persists and sends a payment_request within the link byte budget', async () => {
    mockedUuid.mockReturnValueOnce(EVENT_ID).mockReturnValueOnce(REQUEST_ID);
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
    expect(mockedStorage.savePaymentRequest).toHaveBeenCalled();
    expect(mockedLink.sendPreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        peerPubky: PEER,
        kind: PAYKIT_PAYMENT_REQUEST_KIND,
        eventId: EVENT_ID,
      }),
    );
    const sentCall = mockedLink.sendPreparedMessage.mock.calls[0];
    expect(sentCall).toBeDefined();
    const sentJson = sentCall![0].rawJson;
    expect(new TextEncoder().encode(sentJson).byteLength).toBeLessThanOrEqual(1000);
    expect(JSON.parse(sentJson).request.metadata).toEqual({});
  });

  it('rejects a payee trying to accept their own outbound request', async () => {
    mockedStorage.getPaymentRequest.mockResolvedValue(row({ direction: 'sent' }));
    await expect(PaymentService.acceptRequest(PEER, REQUEST_ID)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(mockedLink.sendPreparedMessage).not.toHaveBeenCalled();
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
    mockedUuid.mockReturnValueOnce(EVENT_NEXT);
    const pending = row({ direction: 'received', status: 'pending' });
    mockedStorage.getPaymentRequest
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, status: 'accepted' });
    const updated = await PaymentService.acceptRequest(PEER, REQUEST_ID);
    expect(updated.status).toBe('accepted');
    expect(mockedLink.sendPreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND, eventId: EVENT_NEXT }),
    );
  });

  it('submits a manual proof after the payer paid in a wallet', async () => {
    mockedUuid.mockReturnValueOnce(EVENT_NEXT);
    const accepted = row({ direction: 'received', status: 'accepted' });
    mockedStorage.getPaymentRequest
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce({ ...accepted, status: 'proof_received' });
    const updated = await PaymentService.submitProofManual(PEER, REQUEST_ID, 'aabbcc');
    expect(updated.status).toBe('proof_received');
    expect(mockedLink.sendPreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PAYKIT_PAYMENT_PROOF_KIND }),
    );
  });

  it('validates tip endpoints with the same S3 rules and composes a private_payment_list', async () => {
    mockedStorage.listTipEndpoints.mockResolvedValue([
      {
        ownerPubky: OWNER,
        peerPubky: OWNER,
        identifier: ENDPOINT_LIGHTNING_BOLT11,
        payload: 'lnbc1abcdefghijklmnopqrstuvwxyz',
        updatedAt: 1,
      },
    ]);
    mockedUuid.mockReturnValueOnce(EVENT_NEXT);
    await PaymentService.sendTipList(PEER);
    const sentCall = mockedLink.sendPreparedMessage.mock.calls[0];
    expect(sentCall).toBeDefined();
    const sent = sentCall![0];
    expect(sent.kind).toBe(PAYKIT_PRIVATE_PAYMENT_LIST_KIND);
    expect(JSON.parse(sent.rawJson)).toEqual({
      version: 1,
      kind: PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
      payment_endpoints: {
        [ENDPOINT_LIGHTNING_BOLT11]: 'lnbc1abcdefghijklmnopqrstuvwxyz',
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
    expect(mockedLink.sendPreparedMessage).not.toHaveBeenCalled();
  });
});
