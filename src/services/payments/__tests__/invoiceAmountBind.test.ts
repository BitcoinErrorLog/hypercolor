import {
  INVOICE_AMOUNT_UNKNOWN,
  INVOICE_AMOUNTLESS,
  invoiceAmountRelation,
  invoiceExpiredBeforeRequest,
  encodeInvoiceAmountMsat,
  preferVerifiedInvoiceAmount,
  bindingFromBolt11Payload,
  bindingFromEndpoint,
} from '../invoiceAmountBind';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_MSAT,
  MAINNET_BOLT11_AMOUNTLESS,
  REGTEST_BOLT11,
  TESTNET_BOLT11,
} from './bolt11Vectors';

describe('invoiceAmountRelation', () => {
  it('treats exact and over-payment as satisfying, under-payment and amountless as mismatch', () => {
    expect(invoiceAmountRelation('1000000', '0.00001')).toBe('satisfies');
    expect(invoiceAmountRelation('2000000', '0.00001')).toBe('satisfies');
    expect(invoiceAmountRelation('999999', '0.00001')).toBe('mismatch');
    expect(invoiceAmountRelation(INVOICE_AMOUNTLESS, '0.00001')).toBe('mismatch');
    expect(invoiceAmountRelation(null, '0.00001')).toBe('unknown');
    expect(invoiceAmountRelation(INVOICE_AMOUNT_UNKNOWN, '0.00001')).toBe('unknown');
    expect(invoiceAmountRelation('not-msat', '0.00001')).toBe('unknown');
  });

  it('encodes a null bolt11 amount as the amountless sentinel', () => {
    expect(encodeInvoiceAmountMsat(null)).toBe(INVOICE_AMOUNTLESS);
    expect(encodeInvoiceAmountMsat('1000')).toBe('1000');
  });

  it('lets a verified msat replace amountless or unknown but never a known msat', () => {
    expect(preferVerifiedInvoiceAmount(INVOICE_AMOUNTLESS, '2000000')).toBe('2000000');
    expect(preferVerifiedInvoiceAmount(INVOICE_AMOUNT_UNKNOWN, '2000000')).toBe('2000000');
    expect(preferVerifiedInvoiceAmount(null, '2000000')).toBe('2000000');
    expect(preferVerifiedInvoiceAmount('2000000', INVOICE_AMOUNTLESS)).toBe('2000000');
  });
});

describe('bindingFromBolt11Payload', () => {
  it('binds mainnet invoices and leaves testnet/regtest metadata unknown', () => {
    expect(bindingFromBolt11Payload(MAINNET_BOLT11_20U)).toEqual(
      expect.objectContaining({ amountMsat: MAINNET_BOLT11_20U_MSAT }),
    );
    expect(bindingFromBolt11Payload(MAINNET_BOLT11_AMOUNTLESS)?.amountMsat).toBe(
      INVOICE_AMOUNTLESS,
    );
    expect(bindingFromBolt11Payload(TESTNET_BOLT11)).toBeNull();
    expect(bindingFromBolt11Payload(REGTEST_BOLT11)).toBeNull();
  });
});

describe('bindingFromEndpoint', () => {
  it('does not store amount or expiry for a non-mainnet invoice', () => {
    expect(
      bindingFromEndpoint({
        payload: TESTNET_BOLT11,
        invoiceAmount: '0.2',
        invoiceExpiresAt: 99,
      }),
    ).toEqual({ amountMsat: null, expiresAt: null });
    expect(
      bindingFromEndpoint({
        payload: REGTEST_BOLT11,
        invoiceAmount: '24',
        invoiceExpiresAt: 99,
      }),
    ).toEqual({ amountMsat: null, expiresAt: null });
  });
});

describe('invoiceExpiredBeforeRequest', () => {
  it('is true only when expiry is at or before request creation', () => {
    expect(invoiceExpiredBeforeRequest(10, 10)).toBe(true);
    expect(invoiceExpiredBeforeRequest(9, 10)).toBe(true);
    expect(invoiceExpiredBeforeRequest(11, 10)).toBe(false);
    expect(invoiceExpiredBeforeRequest(null, 10)).toBe(false);
  });
});
