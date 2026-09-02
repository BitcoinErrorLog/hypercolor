import { COPY } from '../../../copy/uxCopy';
import type { PaymentReviewRequest } from '../../../components/PaymentRequestBubble';
import {
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  type PaymentRequestRecord,
  type TipEndpointRecord,
} from '../../../types/payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_HASH,
  MAINNET_BOLT11_AMOUNTLESS,
  MAINNET_P2TR,
} from '../../../services/payments/__tests__/bolt11Vectors';
import { prepareRequestHandoff } from '../../../services/payments/walletHandoff';
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
    const result = await continuePaymentReview(review(), {
      canOpenURL: async () => {
        throw new Error('malformed url');
      },
      openUri,
      recordDisplayedInvoice,
    });
    expect(result).toEqual({
      closeReview: false,
      walletUnavailable: true,
      recordFailed: false,
      error: COPY.couldNotOpenWallet,
    });
    expect(openUri).not.toHaveBeenCalled();
    expect(recordDisplayedInvoice).not.toHaveBeenCalled();
  });

  it('records the displayed invoice hash on a matching request handoff', async () => {
    const recordDisplayedInvoice = jest.fn().mockResolvedValue(undefined);
    const result = await continuePaymentReview(review(), {
      canOpenURL: async () => true,
      openUri: async () => undefined,
      recordDisplayedInvoice,
    });
    expect(result.closeReview).toBe(true);
    expect(result.recordFailed).toBe(false);
    expect(recordDisplayedInvoice).toHaveBeenCalledWith(
      PEER,
      '11111111-1111-4111-8111-111111111111',
      MAINNET_BOLT11_20U_HASH,
    );
  });

  it('keeps Open wallet when recordDisplayedInvoice rejects after the wallet opened', async () => {
    const openUri = jest.fn().mockResolvedValue(undefined);
    const result = await continuePaymentReview(review(), {
      canOpenURL: async () => true,
      openUri,
      recordDisplayedInvoice: async () => {
        throw new Error('No local pubky');
      },
    });
    expect(result.closeReview).toBe(false);
    expect(result.walletUnavailable).toBe(false);
    expect(result.recordFailed).toBe(true);
    expect(result.error).toBe(COPY.invoiceNotRecorded);
    expect(openUri).toHaveBeenCalledWith(URI);
  });

  it('promotes Copy when openURL rejects', async () => {
    const recordDisplayedInvoice = jest.fn().mockResolvedValue(undefined);
    const result = await continuePaymentReview(review(), {
      canOpenURL: async () => true,
      openUri: async () => {
        throw new Error('No Activity found to handle Intent');
      },
      recordDisplayedInvoice,
    });
    expect(result.closeReview).toBe(false);
    expect(result.walletUnavailable).toBe(true);
    expect(result.recordFailed).toBe(false);
    expect(result.error).toBe(COPY.couldNotOpenWallet);
    expect(recordDisplayedInvoice).toHaveBeenCalled();
  });

  it('sets walletUnavailable without an extra error when canOpenURL is false', async () => {
    const result = await continuePaymentReview(review(), {
      canOpenURL: async () => false,
      openUri: jest.fn(),
      recordDisplayedInvoice: jest.fn(),
    });
    expect(result).toEqual({
      closeReview: false,
      walletUnavailable: true,
      recordFailed: false,
      error: null,
    });
  });

  it('does not record or open when the review amount asset is not bitcoin', async () => {
    const recordDisplayedInvoice = jest.fn();
    const openUri = jest.fn();
    const canOpenURL = jest.fn(async () => true);
    const usd = review();
    usd.amountAsset = 'usd';
    usd.amountBtc = '1';
    const result = await continuePaymentReview(usd, {
      canOpenURL,
      openUri,
      recordDisplayedInvoice,
    });
    expect(result).toEqual({
      closeReview: false,
      walletUnavailable: false,
      recordFailed: false,
      error: COPY.unsupportedPaymentAmount,
    });
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(openUri).not.toHaveBeenCalled();
    expect(recordDisplayedInvoice).not.toHaveBeenCalled();
  });

  it('does not record or open when preparation fails for a reason other than amount mismatch', async () => {
    const recordDisplayedInvoice = jest.fn();
    const openUri = jest.fn();
    const canOpenURL = jest.fn(async () => true);
    const result = await continuePaymentReview(review(), {
      canOpenURL,
      openUri,
      recordDisplayedInvoice,
      prepare: () => ({
        ok: false,
        error: 'endpoint identifier is not a lightning or bitcoin destination',
        requestAmountBtc: MAINNET_BOLT11_20U_BTC,
        invoiceAmountBtc: null,
        paymentHash: null,
        expiresAtMs: null,
      }),
    });
    expect(result).toEqual({
      closeReview: false,
      walletUnavailable: false,
      recordFailed: false,
      error: 'endpoint identifier is not a lightning or bitcoin destination',
    });
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(openUri).not.toHaveBeenCalled();
    expect(recordDisplayedInvoice).not.toHaveBeenCalled();
  });

  it('does not record or open a supplied URI when amountAsset is usd and selected is null', async () => {
    const recordDisplayedInvoice = jest.fn();
    const openUri = jest.fn();
    const canOpenURL = jest.fn(async () => true);
    const usd = review();
    usd.amountAsset = 'usd';
    usd.amountBtc = '1';
    usd.selected = null;
    const result = await continuePaymentReview(usd, {
      canOpenURL,
      openUri,
      recordDisplayedInvoice,
    });
    expect(result).toEqual({
      closeReview: false,
      walletUnavailable: false,
      recordFailed: false,
      error: COPY.unsupportedPaymentAmount,
    });
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(openUri).not.toHaveBeenCalled();
    expect(recordDisplayedInvoice).not.toHaveBeenCalled();
  });

  it('prepares the auto-resolved Lightning endpoint for a sub-sat request with an on-chain option', async () => {
    const lightning: TipEndpointRecord = {
      ...endpoint(),
      payload: MAINNET_BOLT11_AMOUNTLESS,
      invoiceAmount: null,
      paymentHash: null,
    };
    const onchain: TipEndpointRecord = {
      ...endpoint(),
      identifier: ENDPOINT_BITCOIN_P2TR,
      payload: MAINNET_P2TR,
      invoiceAmount: null,
      paymentHash: null,
    };
    const amount = '0.000000001';
    const request = record();
    request.amountValue = amount;
    const reviewRequest: PaymentReviewRequest = {
      kind: 'request',
      record: request,
      peerPubky: PEER,
      amountBtc: amount,
      amountAsset: 'btc',
      reference: 'invoice-1',
      destinations: [lightning, onchain],
      selected: null,
    };
    const recordDisplayedInvoice = jest.fn().mockResolvedValue(undefined);
    const openUri = jest.fn().mockResolvedValue(undefined);
    const canOpenURL = jest.fn(async () => true);
    const prepare = jest.fn(prepareRequestHandoff);
    const expected = prepareRequestHandoff({
      requestAmountBtc: amount,
      endpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_AMOUNTLESS,
      amountAsset: 'btc',
    });
    const result = await continuePaymentReview(reviewRequest, {
      canOpenURL,
      openUri,
      recordDisplayedInvoice,
      prepare,
    });
    expect(result.closeReview).toBe(true);
    expect(prepare).toHaveBeenCalledWith({
      requestAmountBtc: amount,
      endpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_AMOUNTLESS,
      amountAsset: 'btc',
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(recordDisplayedInvoice).toHaveBeenCalledWith(
      PEER,
      '11111111-1111-4111-8111-111111111111',
      expected.paymentHash,
    );
    expect(openUri).toHaveBeenCalledTimes(1);
    expect(openUri).toHaveBeenCalledWith(`lightning:${MAINNET_BOLT11_AMOUNTLESS}`);
    expect(openUri.mock.calls[0][0]).not.toMatch(/bitcoin:/);
    expect(canOpenURL).toHaveBeenCalledWith(`lightning:${MAINNET_BOLT11_AMOUNTLESS}`);
  });

  it('does not record or open when selected is null and no endpoint can be resolved', async () => {
    const lightning = endpoint();
    const onchain: TipEndpointRecord = {
      ...endpoint(),
      identifier: ENDPOINT_BITCOIN_P2TR,
      payload: MAINNET_P2TR,
      invoiceAmount: null,
      paymentHash: null,
    };
    const unresolved = review();
    unresolved.selected = null;
    unresolved.destinations = [lightning, onchain];
    const recordDisplayedInvoice = jest.fn();
    const openUri = jest.fn();
    const canOpenURL = jest.fn(async () => true);
    const result = await continuePaymentReview(unresolved, {
      canOpenURL,
      openUri,
      recordDisplayedInvoice,
    });
    expect(result).toEqual({
      closeReview: false,
      walletUnavailable: false,
      recordFailed: false,
      error: COPY.choosePaymentDestination,
    });
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(openUri).not.toHaveBeenCalled();
    expect(recordDisplayedInvoice).not.toHaveBeenCalled();
  });
});
