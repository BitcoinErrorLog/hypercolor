import { COPY } from '../../copy/uxCopy';
import { ENDPOINT_LIGHTNING_BOLT11, type TipEndpointRecord } from '../../types/payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_HASH,
} from '../../services/payments/__tests__/bolt11Vectors';
import { PAYMENT_COMPOSE_DEFAULT_AMOUNT, mapPaymentReview } from '../paymentReview';
import { shortPubky } from '../shortPubky';

const PEER = 'b'.repeat(52);

function endpoint(partial: Partial<TipEndpointRecord> = {}): TipEndpointRecord {
  return {
    ownerPubky: 'a'.repeat(52),
    peerPubky: PEER,
    identifier: ENDPOINT_LIGHTNING_BOLT11,
    payload: MAINNET_BOLT11_20U,
    updatedAt: 1,
    validationStatus: 'valid',
    invoiceAmount: MAINNET_BOLT11_20U_BTC,
    invoiceExpiresAt: Date.now() + 60_000,
    paymentHash: MAINNET_BOLT11_20U_HASH,
    ...partial,
  };
}

describe('PAYMENT_COMPOSE_DEFAULT_AMOUNT', () => {
  it('is empty so compose never prefills an amount', () => {
    expect(PAYMENT_COMPOSE_DEFAULT_AMOUNT).toBe('');
  });
});

describe('mapPaymentReview', () => {
  it('maps recipient shortPubky, amount, invoice, and Continue in Bitkit', () => {
    const view = mapPaymentReview({
      kind: 'request',
      recipientPubky: PEER,
      recipientContact: { displayName: 'Ada', addedManually: true },
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      amountAsset: 'btc',
      reference: 'invoice-1',
      endpoint: endpoint(),
      nowMs: Date.now(),
      destinationsEmpty: false,
      walletUnavailable: false,
    });
    expect(view.recipientTitle).toBe('Ada');
    expect(view.recipientShortPubky).toBe(shortPubky(PEER));
    expect(view.amountText).toContain(MAINNET_BOLT11_20U_BTC);
    expect(view.invoiceAmountText).toContain(MAINNET_BOLT11_20U_BTC);
    expect(view.referenceText).toBe('invoice-1');
    expect(view.uri).toMatch(/^lightning:/);
    expect(view.primaryLabel).toBe(COPY.continueInBitkit);
    expect(view.primaryEnabled).toBe(true);
    expect(view.primaryOutline).toBe(false);
  });

  it('keeps the primary enabled but outlined on an amount mismatch', () => {
    const view = mapPaymentReview({
      kind: 'request',
      recipientPubky: PEER,
      recipientContact: null,
      requestAmountBtc: '0.001',
      amountAsset: 'btc',
      reference: null,
      endpoint: endpoint(),
      nowMs: Date.now(),
      destinationsEmpty: false,
      walletUnavailable: false,
    });
    expect(view.amountMismatch).toBe(true);
    expect(view.warningText).toContain('0.001');
    expect(view.primaryEnabled).toBe(true);
    expect(view.primaryOutline).toBe(true);
    expect(view.uri).toMatch(/^lightning:/);
  });

  it('disables the primary when destinations are empty', () => {
    const view = mapPaymentReview({
      kind: 'tip',
      recipientPubky: PEER,
      recipientContact: null,
      requestAmountBtc: '0.001',
      amountAsset: 'btc',
      reference: null,
      endpoint: null,
      nowMs: Date.now(),
      destinationsEmpty: true,
      walletUnavailable: false,
    });
    expect(view.errorText).toBe(COPY.noMatchingDestination);
    expect(view.primaryEnabled).toBe(false);
    expect(view.uri).toBeNull();
  });
});
