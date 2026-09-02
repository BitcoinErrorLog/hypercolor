import {
  INVOICE_AMOUNTLESS,
  invoiceAmountRelation,
  invoiceExpiredBeforeRequest,
  encodeInvoiceAmountMsat,
} from '../invoiceAmountBind';

describe('invoiceAmountRelation', () => {
  it('treats exact and over-payment as satisfying, under-payment and amountless as mismatch', () => {
    expect(invoiceAmountRelation('1000000', '0.00001')).toBe('satisfies');
    expect(invoiceAmountRelation('2000000', '0.00001')).toBe('satisfies');
    expect(invoiceAmountRelation('999999', '0.00001')).toBe('mismatch');
    expect(invoiceAmountRelation(INVOICE_AMOUNTLESS, '0.00001')).toBe('mismatch');
    expect(invoiceAmountRelation(null, '0.00001')).toBe('unknown');
    expect(invoiceAmountRelation('not-msat', '0.00001')).toBe('unknown');
  });

  it('encodes a null bolt11 amount as the amountless sentinel', () => {
    expect(encodeInvoiceAmountMsat(null)).toBe(INVOICE_AMOUNTLESS);
    expect(encodeInvoiceAmountMsat('1000')).toBe('1000');
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
