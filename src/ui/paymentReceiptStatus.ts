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

export type PaymentReceiptView = {
  word: PaymentReceiptWord;
  note: string | null;
};

/**
 * In-thread payment receipts. Only requested / paid / expired / failed.
 * `paid` is reserved for a PaymentService-verified proof.
 */
export function formatPaymentReceiptStatus(
  record: Pick<PaymentRequestRecord, 'status' | 'expiresAt' | 'pendingEventId' | 'proofVerified'>,
  nowMs: number,
): PaymentReceiptWord {
  return formatPaymentReceipt(record, nowMs).word;
}

export function formatPaymentReceipt(
  record: Pick<PaymentRequestRecord, 'status' | 'expiresAt' | 'pendingEventId' | 'proofVerified'>,
  nowMs: number,
): PaymentReceiptView {
  if (record.status === 'proof_received') {
    if (record.proofVerified === true) {
      return { word: COPY.paymentPaid, note: null };
    }
    if (record.proofVerified === false) {
      return { word: COPY.paymentRequested, note: COPY.proofAlreadyUsed };
    }
    return { word: COPY.paymentRequested, note: COPY.proofNotVerified };
  }
  const status: PaymentDisplayStatus = displayPaymentStatus(
    record.status,
    record.expiresAt,
    nowMs,
    {
      pendingEventId: record.pendingEventId,
      proofVerified: record.proofVerified,
    },
  );
  return { word: receiptWordForDisplay(status), note: null };
}

export function receiptWordForDisplay(status: PaymentDisplayStatus): PaymentReceiptWord {
  switch (status) {
    case 'verified':
      return COPY.paymentPaid;
    case 'claimed':
    case 'proof_received':
      return COPY.paymentRequested;
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
