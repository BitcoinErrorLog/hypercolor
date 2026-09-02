import { COPY } from '../../../copy/uxCopy';
import type { PaymentReviewRequest } from '../../../components/PaymentRequestBubble';
import {
  ENDPOINT_LIGHTNING_BOLT11,
  type PaymentRequestRecord,
  type TipEndpointRecord,
} from '../../../types/payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_HASH,
} from '../../../services/payments/__tests__/bolt11Vectors';
import { continuePaymentReview } from '../continuePaymentReview';

const PEER = 'b'.repeat(52);
const OWNER = 'a'.repeat(52);

function endpoint(): TipEndpointRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    identifier: ENDPOINT_LIGHTNING_BOLT11,
    payload: MAINNET_BOLT11_20U,
    updatedAt: 1,
    validationStatus: 'valid',
    invoiceAmount: MAINNET_BOLT11_20U_BTC,
    invoiceExpiresAt: Date.now() + 60_000,
    paymentHash: MAINNET_BOLT11_20U_HASH,
  };
}

function record(): PaymentRequestRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    direction: 'received',
    paymentRequestId: '11111111-1111-4111-8111-111111111111',
    eventId: '22222222-2222-4222-8222-222222222222',
    amountValue: MAINNET_BOLT11_20U_BTC,
    amountAsset: 'btc',
    paymentReference: 'invoice-1',
    endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    expiresAt: null,
    status: 'accepted',
    createdAt: 1,
    updatedAt: 1,
    proofJson: null,
    reason: null,
    pendingEventId: null,
    displayedPaymentHash: null,
    proofVerified: null,
  };
}

function review(): PaymentReviewRequest {
  const dest = endpoint();
  return {
    kind: 'request',
    record: record(),
    peerPubky: PEER,
    amountBtc: MAINNET_BOLT11_20U_BTC,
    amountAsset: 'btc',
    reference: 'invoice-1',
    destinations: [dest],
    selected: dest,
  };
}

const URI = `lightning:${MAINNET_BOLT11_20U}`;

describe('continuePaymentReview', () => {
  it('promotes Copy when canOpenURL rejects', async () => {
    const recordDisplayedInvoice = jest.fn();
    const openUri = jest.fn();
    const result = await continuePaymentReview(URI, review(), {
      canOpenURL: async () => {
        throw new Error('malformed url');
      },
      openUri,
      recordDisplayedInvoice,
    });
    expect(result).toEqual({
      closeReview: false,
      walletUnavailable: true,
      error: COPY.couldNotOpenWallet,
    });
    expect(openUri).not.toHaveBeenCalled();
    expect(recordDisplayedInvoice).not.toHaveBeenCalled();
  });

  it('records the displayed invoice hash on a matching request handoff', async () => {
    const recordDisplayedInvoice = jest.fn().mockResolvedValue(undefined);
    const result = await continuePaymentReview(URI, review(), {
      canOpenURL: async () => true,
      openUri: async () => undefined,
      recordDisplayedInvoice,
    });
    expect(result.closeReview).toBe(true);
    expect(recordDisplayedInvoice).toHaveBeenCalledWith(
      PEER,
      '11111111-1111-4111-8111-111111111111',
      MAINNET_BOLT11_20U_HASH,
    );
  });

  it('keeps Copy reachable when recordDisplayedInvoice rejects and still surfaces the error', async () => {
    const openUri = jest.fn().mockResolvedValue(undefined);
    const result = await continuePaymentReview(URI, review(), {
      canOpenURL: async () => true,
      openUri,
      recordDisplayedInvoice: async () => {
        throw new Error('No local pubky');
      },
    });
    expect(result.closeReview).toBe(false);
    expect(result.walletUnavailable).toBe(true);
    expect(result.error).toBe(COPY.couldNotOpenWallet);
    expect(openUri).toHaveBeenCalledWith(URI);
  });

  it('promotes Copy when openURL rejects', async () => {
    const recordDisplayedInvoice = jest.fn().mockResolvedValue(undefined);
    const result = await continuePaymentReview(URI, review(), {
      canOpenURL: async () => true,
      openUri: async () => {
        throw new Error('No Activity found to handle Intent');
      },
      recordDisplayedInvoice,
    });
    expect(result.closeReview).toBe(false);
    expect(result.walletUnavailable).toBe(true);
    expect(result.error).toBe(COPY.couldNotOpenWallet);
    expect(recordDisplayedInvoice).toHaveBeenCalled();
  });

  it('sets walletUnavailable without an extra error when canOpenURL is false', async () => {
    const result = await continuePaymentReview(URI, review(), {
      canOpenURL: async () => false,
      openUri: jest.fn(),
      recordDisplayedInvoice: jest.fn(),
    });
    expect(result).toEqual({ closeReview: false, walletUnavailable: true, error: null });
  });
});
