import { COPY } from '../copy/uxCopy';
import {
  displayPaymentStatus,
  type PaymentDisplayStatus,
  type PaymentRequestRecord,
} from '../types/payment';

export type PaymentReceiptWord =
  | typeof COPY.paymentRequested
  | typeof COPY.paymentPaid
  | typeof COPY.paymentExpired
  | typeof COPY.paymentFailed;

const RECEIPT_WORDS: readonly PaymentReceiptWord[] = [
  COPY.paymentRequested,
  COPY.paymentPaid,
  COPY.paymentExpired,
  COPY.paymentFailed,
];

export function isPaymentReceiptWord(value: string): value is PaymentReceiptWord {
  return (RECEIPT_WORDS as readonly string[]).includes(value);
}

/**
 * In-thread payment receipts. Only requested / paid / expired / failed.
 * Never emits delivered, sending, claimed, or raw enum values.
 */
export function formatPaymentReceiptStatus(
  record: Pick<PaymentRequestRecord, 'status' | 'expiresAt' | 'pendingEventId' | 'proofVerified'>,
  nowMs: number,
): PaymentReceiptWord {
  const status: PaymentDisplayStatus = displayPaymentStatus(
    record.status,
    record.expiresAt,
    nowMs,
    {
      pendingEventId: record.pendingEventId,
      proofVerified: record.proofVerified,
    },
  );
  return receiptWordForDisplay(status);
}

export function receiptWordForDisplay(status: PaymentDisplayStatus): PaymentReceiptWord {
  switch (status) {
    case 'verified':
    case 'claimed':
    case 'proof_received':
      return COPY.paymentPaid;
    case 'expired':
      return COPY.paymentExpired;
    case 'rejected':
    case 'cancelled':
      return COPY.paymentFailed;
    case 'pending':
    case 'accepted':
    case 'sending':
      return COPY.paymentRequested;
    default:
      return COPY.paymentRequested;
  }
}
