import { btcDecimalToMsat, tryDecodeBolt11Invoice } from '../../utils/bolt11';

/** Sentinel stored in `own_invoice_hashes.invoice_amount_msat` for amountless invoices. */
export const INVOICE_AMOUNTLESS = 'amountless';

/**
 * Durable repair marker for a hash whose amount could not be derived.
 * Distinct from NULL (not yet repaired) and from `amountless` (decoded
 * amountless mainnet bolt11). Cannot corroborate a request.
 */
export const INVOICE_AMOUNT_UNKNOWN = 'unknown';

export type InvoiceAmountRelation = 'satisfies' | 'mismatch' | 'unknown';

export function encodeInvoiceAmountMsat(amountMsat: string | null): string {
  return amountMsat === null ? INVOICE_AMOUNTLESS : amountMsat;
}

export function isKnownInvoiceAmountMsat(value: string | null): boolean {
  return value !== null && /^\d+$/.test(value);
}

/**
 * Keep a verified millisatoshi string. Allow a later verified decoder
 * result to replace NULL, `amountless`, or `unknown`.
 */
export function preferVerifiedInvoiceAmount(
  existing: string | null,
  incoming: string | null,
): string | null {
  if (isKnownInvoiceAmountMsat(existing)) return existing;
  if (incoming !== null) return incoming;
  return existing;
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
  if (invoiceAmountMsat === INVOICE_AMOUNT_UNKNOWN) return 'unknown';
  if (invoiceAmountMsat === INVOICE_AMOUNTLESS) return 'mismatch';
  if (!isKnownInvoiceAmountMsat(invoiceAmountMsat)) return 'unknown';
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
  if (!decoded || decoded.network !== 'bitcoin') return null;
  return {
    amountMsat: encodeInvoiceAmountMsat(decoded.amountMsat),
    expiresAt: decoded.expiresAtMs,
  };
}

export function bindingFromEndpoint(endpoint: {
  payload: string;
  invoiceAmount?: string | null;
  invoiceExpiresAt?: number | null;
}): { amountMsat: string | null; expiresAt: number | null } {
  const decoded = tryDecodeBolt11Invoice(endpoint.payload);
  if (decoded) {
    if (decoded.network !== 'bitcoin') {
      return { amountMsat: null, expiresAt: null };
    }
    return {
      amountMsat: encodeInvoiceAmountMsat(decoded.amountMsat),
      expiresAt: decoded.expiresAtMs,
    };
  }
  if (typeof endpoint.invoiceAmount === 'string') {
    const msat = btcDecimalToMsat(endpoint.invoiceAmount);
    return {
      amountMsat: msat === null ? null : msat.toString(),
      expiresAt: endpoint.invoiceExpiresAt ?? null,
    };
  }
  return { amountMsat: null, expiresAt: endpoint.invoiceExpiresAt ?? null };
}
