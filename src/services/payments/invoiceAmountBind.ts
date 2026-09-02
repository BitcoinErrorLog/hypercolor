import { btcDecimalToMsat, tryDecodeBolt11Invoice } from '../../utils/bolt11';

/** Sentinel stored in `own_invoice_hashes.invoice_amount_msat` for amountless invoices. */
export const INVOICE_AMOUNTLESS = 'amountless';

export type InvoiceAmountRelation = 'satisfies' | 'mismatch' | 'unknown';

export function encodeInvoiceAmountMsat(amountMsat: string | null): string {
  return amountMsat === null ? INVOICE_AMOUNTLESS : amountMsat;
}

/**
 * Whether a bound invoice amount can mark this request `paid`.
 *
 * - amountless invoice → `mismatch` (v1 requests always carry an amount)
 * - invoice msat < request msat → `mismatch` (under-payment)
 * - invoice msat >= request msat → `satisfies` (exact and over-payment)
 * - missing/unparseable metadata → `unknown` (cannot corroborate)
 */
export function invoiceAmountRelation(
  invoiceAmountMsat: string | null,
  requestAmountBtc: string,
): InvoiceAmountRelation {
  if (invoiceAmountMsat === null || invoiceAmountMsat.length === 0) return 'unknown';
  if (invoiceAmountMsat === INVOICE_AMOUNTLESS) return 'mismatch';
  if (!/^\d+$/.test(invoiceAmountMsat)) return 'unknown';
  const requestMsat = btcDecimalToMsat(requestAmountBtc);
  if (requestMsat === null) return 'unknown';
  let paid: bigint;
  try {
    paid = BigInt(invoiceAmountMsat);
  } catch {
    return 'unknown';
  }
  if (paid < requestMsat) return 'mismatch';
  return 'satisfies';
}

/** An invoice that was already expired when the request was created cannot corroborate it. */
export function invoiceExpiredBeforeRequest(
  invoiceExpiresAt: number | null,
  requestCreatedAt: number,
): boolean {
  return invoiceExpiresAt !== null && invoiceExpiresAt <= requestCreatedAt;
}

export function bindingFromBolt11Payload(payload: string): {
  amountMsat: string;
  expiresAt: number | null;
} | null {
  const decoded = tryDecodeBolt11Invoice(payload);
  if (!decoded) return null;
  return {
    amountMsat: encodeInvoiceAmountMsat(decoded.amountMsat),
    expiresAt: decoded.expiresAtMs,
  };
}

export function bindingFromEndpoint(endpoint: {
  payload: string;
  invoiceAmount?: string | null;
  invoiceExpiresAt?: number | null;
}): { amountMsat: string; expiresAt: number | null } {
  const fromInvoice = bindingFromBolt11Payload(endpoint.payload);
  if (fromInvoice) return fromInvoice;
  if (endpoint.invoiceAmount === undefined || endpoint.invoiceAmount === null) {
    return {
      amountMsat: INVOICE_AMOUNTLESS,
      expiresAt: endpoint.invoiceExpiresAt ?? null,
    };
  }
  const msat = btcDecimalToMsat(endpoint.invoiceAmount);
  return {
    amountMsat: msat === null ? INVOICE_AMOUNTLESS : msat.toString(),
    expiresAt: endpoint.invoiceExpiresAt ?? null,
  };
}
