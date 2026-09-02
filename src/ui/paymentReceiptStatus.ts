import { COPY } from '../copy/uxCopy';
import {
  displayPaymentStatus,
  PROOF_REASON_AMOUNT_MISMATCH,
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

export type PaymentReceiptRecord = Pick<
  PaymentRequestRecord,
  'status' | 'expiresAt' | 'pendingEventId' | 'proofVerified' | 'proofJson' | 'reason'
>;

/**
 * In-thread payment receipts. Only requested / paid / expired / failed.
 * `paid` is reserved for a PaymentService-verified proof whose invoice amount
 * satisfies the request.
 */
export function formatPaymentReceiptStatus(
  record: PaymentReceiptRecord,
  nowMs: number,
): PaymentReceiptWord {
  return formatPaymentReceipt(record, nowMs).word;
}

export function formatPaymentReceipt(
  record: PaymentReceiptRecord,
  nowMs: number,
): PaymentReceiptView {
  if (record.status === 'proof_received' && record.proofVerified === true) {
    return { word: COPY.paymentPaid, note: null };
  }
  if (record.proofVerified === false) {
    return { word: COPY.paymentRequested, note: COPY.proofAlreadyUsed };
  }
  if (record.reason === PROOF_REASON_AMOUNT_MISMATCH) {
    return { word: COPY.paymentRequested, note: COPY.proofAmountMismatch };
  }
  const unverifiableOnAccepted =
    record.status === 'accepted' && record.proofJson !== null && record.proofVerified !== true;
  if (record.status === 'proof_received' || unverifiableOnAccepted) {
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
