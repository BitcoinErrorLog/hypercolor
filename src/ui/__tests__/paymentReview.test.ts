import { COPY } from '../../copy/uxCopy';
import {
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  type TipEndpointRecord,
} from '../../types/payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_HASH,
  MAINNET_BOLT11_AMOUNTLESS,
  MAINNET_P2TR,
} from '../../services/payments/__tests__/bolt11Vectors';
import { formatPaymentDisplayText } from '../../utils/displaySanitize';
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

const BASE = {
  kind: 'request' as const,
  recipientPubky: PEER,
  recipientContact: { displayName: 'Ada', addedManually: true as const },
  amountAsset: 'btc',
  reference: 'invoice-1',
  nowMs: Date.now(),
  destinationsEmpty: false,
  walletUnavailable: false,
};

describe('PAYMENT_COMPOSE_DEFAULT_AMOUNT', () => {
  it('is empty so compose never prefills an amount', () => {
    expect(PAYMENT_COMPOSE_DEFAULT_AMOUNT).toBe('');
  });
});

describe('mapPaymentReview', () => {
  it('maps recipient, amount, invoice, Open wallet, and Lightning mainnet', () => {
    const dest = endpoint();
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      endpoint: dest,
      destinations: [dest],
    });
    expect(view.recipientTitle).toBe('Ada');
    expect(view.recipientShortPubky).toBe(shortPubky(PEER));
    expect(view.amountText).toContain(MAINNET_BOLT11_20U_BTC);
    expect(view.invoiceAmountText).toContain(MAINNET_BOLT11_20U_BTC);
    expect(view.referenceText).toBe(formatPaymentDisplayText('invoice-1'));
    expect(view.uri).toMatch(/^lightning:/);
    expect(view.networkText).toBe(COPY.networkLightningMainnet);
    expect(view.primaryLabel).toBe(COPY.openWallet);
    expect(view.primaryAction).toBe('open');
    expect(view.primaryEnabled).toBe(true);
    expect(view.primaryOutline).toBe(false);
    expect(view.paymentHash).toBe(MAINNET_BOLT11_20U_HASH);
  });

  it('keeps the primary enabled but outlined on an amount mismatch and still exposes the hash', () => {
    const dest = endpoint();
    const view = mapPaymentReview({
      ...BASE,
      recipientContact: null,
      requestAmountBtc: '0.001',
      reference: null,
      endpoint: dest,
      destinations: [dest],
    });
    expect(view.amountMismatch).toBe(true);
    expect(view.warningText).toContain('0.001');
    expect(view.primaryEnabled).toBe(true);
    expect(view.primaryOutline).toBe(true);
    expect(view.uri).toMatch(/^lightning:/);
    expect(view.paymentHash).toBe(MAINNET_BOLT11_20U_HASH);
  });

  it('does not flag numeric-equivalent amounts as a mismatch', () => {
    const dest = endpoint();
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: '0.000020',
      endpoint: dest,
      destinations: [dest],
    });
    expect(view.amountMismatch).toBe(false);
    expect(view.primaryEnabled).toBe(true);
    expect(view.primaryOutline).toBe(false);
  });

  it('blocks a zero or empty amount from reaching wallet handoff', () => {
    const dest = endpoint({
      payload: MAINNET_BOLT11_AMOUNTLESS,
      invoiceAmount: null,
      paymentHash: null,
    });
    for (const amount of ['', '0', '0.0']) {
      const view = mapPaymentReview({
        ...BASE,
        kind: 'tip',
        requestAmountBtc: amount,
        reference: null,
        endpoint: dest,
        destinations: [dest],
      });
      expect(view.primaryEnabled).toBe(false);
      expect(view.errorText).toBe('Enter a valid BTC amount');
    }
  });

  it('does not hand off a non-BTC request amount as bitcoin', () => {
    const dest = endpoint();
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: '1',
      amountAsset: 'usd',
      endpoint: dest,
      destinations: [dest],
    });
    expect(view.primaryEnabled).toBe(false);
    expect(view.uri).toBeNull();
    expect(view.amountMismatch).toBe(false);
    expect(view.errorText).toBe(COPY.unsupportedPaymentAmount);
  });

  it('promotes Copy payment URI when no wallet can open the link', () => {
    const dest = endpoint();
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      endpoint: dest,
      destinations: [dest],
      walletUnavailable: true,
    });
    expect(view.primaryEnabled).toBe(true);
    expect(view.primaryLabel).toBe(COPY.copyPaymentUri);
    expect(view.primaryAction).toBe('copy');
    expect(view.secondaryLabel).toBe(COPY.openWallet);
    expect(view.secondaryAction).toBe('open');
    expect(view.warningText).toBe(COPY.noWalletForLink);
    expect(view.errorText).toBeNull();
  });

  it('keeps Open wallet when the invoice record failed after the wallet opened', () => {
    const dest = endpoint();
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      endpoint: dest,
      destinations: [dest],
      walletUnavailable: false,
      recordFailed: true,
    });
    expect(view.primaryEnabled).toBe(true);
    expect(view.primaryLabel).toBe(COPY.openWallet);
    expect(view.primaryAction).toBe('open');
    expect(view.warningText).toBe(COPY.invoiceNotRecorded);
    expect(view.errorText).toBeNull();
  });

  it('requires an explicit destination when more than one endpoint matches', () => {
    const first = endpoint();
    const second = endpoint({
      identifier: ENDPOINT_BITCOIN_P2TR,
      payload: MAINNET_P2TR,
      invoiceAmount: null,
      paymentHash: null,
    });
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: '0.001',
      endpoint: null,
      destinations: [first, second],
    });
    expect(view.requiresDestinationChoice).toBe(true);
    expect(view.destinations).toHaveLength(2);
    expect(view.primaryEnabled).toBe(false);
    expect(view.errorText).toBe(COPY.choosePaymentDestination);
  });

  it('shows Bitcoin mainnet for a selected on-chain destination', () => {
    const dest = endpoint({
      identifier: ENDPOINT_BITCOIN_P2TR,
      payload: MAINNET_P2TR,
      invoiceAmount: null,
      paymentHash: null,
    });
    const view = mapPaymentReview({
      ...BASE,
      kind: 'tip',
      requestAmountBtc: '0.001',
      reference: null,
      endpoint: dest,
      destinations: [dest],
    });
    expect(view.networkText).toBe(COPY.networkBitcoinMainnet);
    expect(view.primaryEnabled).toBe(true);
  });

  it('omits the network row when the lightning network is not decoded', () => {
    const dest = endpoint({
      payload: 'lnbc1not-an-invoice',
      invoiceAmount: null,
      paymentHash: null,
    });
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: '0.001',
      endpoint: dest,
      destinations: [dest],
    });
    expect(view.networkText).toBeNull();
  });

  it('disables the primary when destinations are empty', () => {
    const view = mapPaymentReview({
      ...BASE,
      kind: 'tip',
      recipientContact: null,
      requestAmountBtc: '0.001',
      reference: null,
      endpoint: null,
      destinations: [],
      destinationsEmpty: true,
    });
    expect(view.errorText).toBe(COPY.noMatchingDestination);
    expect(view.primaryEnabled).toBe(false);
    expect(view.uri).toBeNull();
  });

  it('filters on-chain destinations for a sub-satoshi amount and offers Lightning', () => {
    const lightning = endpoint({
      payload: MAINNET_BOLT11_AMOUNTLESS,
      invoiceAmount: null,
      paymentHash: null,
    });
    const onchain = endpoint({
      identifier: ENDPOINT_BITCOIN_P2TR,
      payload: MAINNET_P2TR,
      invoiceAmount: null,
      paymentHash: null,
    });
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: '0.000000001',
      endpoint: onchain,
      destinations: [lightning, onchain],
    });
    expect(view.destinations.map(row => row.identifier)).toEqual([ENDPOINT_LIGHTNING_BOLT11]);
    expect(view.selectedIdentifier).toBe(ENDPOINT_LIGHTNING_BOLT11);
    expect(view.uri).toBe(`lightning:${MAINNET_BOLT11_AMOUNTLESS}`);
    expect(view.uri).not.toMatch(/bitcoin:/);
    expect(view.uri).not.toMatch(/amount=0\.000000001/);
    expect(view.warningText).toContain(COPY.onlyLightningCanPayAmount);
    expect(view.primaryEnabled).toBe(true);
    expect(view.errorText).toBeNull();
  });

  it('shows the Lightning-only note and disables primary when only on-chain remains for a sub-sat amount', () => {
    const onchain = endpoint({
      identifier: ENDPOINT_BITCOIN_P2TR,
      payload: MAINNET_P2TR,
      invoiceAmount: null,
      paymentHash: null,
    });
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: '0.000000001',
      endpoint: onchain,
      destinations: [onchain],
    });
    expect(view.warningText).toBe(COPY.onlyLightningCanPayAmount);
    expect(view.errorText).toBe(COPY.noMatchingDestination);
    expect(view.primaryEnabled).toBe(false);
    expect(view.uri).toBeNull();
    expect(view.secondaryAction).toBeNull();
    expect(view.destinations).toHaveLength(0);
  });

  it('sanitizes a peer-supplied payment_reference in the Review sheet', () => {
    const dest = endpoint();
    const raw = 'pay \u202Eevil\u202C invoice';
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      reference: raw,
      endpoint: dest,
      destinations: [dest],
    });
    expect(view.referenceText).toBe(formatPaymentDisplayText(raw));
    expect(view.referenceText).not.toContain('\u202E');
    expect(view.referenceText).not.toBe(raw);
  });

  it('maps an unreadable bolt11 to fixed copy in the error region', () => {
    const dest = endpoint({
      payload: 'lnbc1not-a-real-invoice',
      invoiceAmount: null,
      paymentHash: null,
    });
    const view = mapPaymentReview({
      ...BASE,
      requestAmountBtc: '0.001',
      endpoint: dest,
      destinations: [dest],
    });
    expect(view.errorText).toBe(COPY.invoiceInvalid);
    expect(view.errorText).not.toMatch(/Not a proper/i);
    expect(view.primaryEnabled).toBe(false);
  });
});
