import { COPY } from '../../copy/uxCopy';
import type { PaymentRequestRecord } from '../../types/payment';
import {
  formatPaymentReceipt,
  formatPaymentReceiptStatus,
  receiptWordForDisplay,
} from '../paymentReceiptStatus';

function record(
  partial: Partial<PaymentRequestRecord> & Pick<PaymentRequestRecord, 'status'>,
): PaymentRequestRecord {
  return {
    ownerPubky: 'a'.repeat(52),
    peerPubky: 'b'.repeat(52),
    direction: 'received',
    paymentRequestId: 'req-1',
    eventId: 'evt-1',
    amountValue: '0.001',
    amountAsset: 'btc',
    paymentReference: 'ref',
    endpointIds: [],
    expiresAt: null,
    createdAt: 1,
    updatedAt: 1,
    proofJson: null,
    reason: null,
    pendingEventId: null,
    displayedPaymentHash: null,
    proofVerified: null,
    ...partial,
  };
}

describe('formatPaymentReceiptStatus', () => {
  it('renders only requested, paid, expired, or failed', () => {
    const now = 1_000_000;
    expect(formatPaymentReceiptStatus(record({ status: 'pending' }), now)).toBe(
      COPY.paymentRequested,
    );
    expect(formatPaymentReceiptStatus(record({ status: 'accepted' }), now)).toBe(
      COPY.paymentRequested,
    );
    expect(
      formatPaymentReceiptStatus(record({ status: 'pending', pendingEventId: 'queued' }), now),
    ).toBe(COPY.paymentRequested);
    expect(
      formatPaymentReceiptStatus(record({ status: 'proof_received', proofVerified: true }), now),
    ).toBe(COPY.paymentPaid);
    expect(
      formatPaymentReceiptStatus(record({ status: 'proof_received', proofVerified: false }), now),
    ).toBe(COPY.paymentRequested);
    expect(
      formatPaymentReceiptStatus(record({ status: 'proof_received', proofVerified: null }), now),
    ).toBe(COPY.paymentRequested);
    expect(formatPaymentReceiptStatus(record({ status: 'rejected' }), now)).toBe(
      COPY.paymentFailed,
    );
    expect(formatPaymentReceiptStatus(record({ status: 'cancelled' }), now)).toBe(
      COPY.paymentFailed,
    );
    expect(formatPaymentReceiptStatus(record({ status: 'pending', expiresAt: now - 1 }), now)).toBe(
      COPY.paymentExpired,
    );
  });

  it('labels paid only when PaymentService verified the proof', () => {
    const now = 1_000_000;
    expect(
      formatPaymentReceipt(record({ status: 'proof_received', proofVerified: true }), now),
    ).toEqual({ word: COPY.paymentPaid, note: null });
    expect(
      formatPaymentReceipt(record({ status: 'proof_received', proofVerified: false }), now),
    ).toEqual({ word: COPY.paymentRequested, note: COPY.proofAlreadyUsed });
    expect(
      formatPaymentReceipt(record({ status: 'proof_received', proofVerified: null }), now),
    ).toEqual({ word: COPY.paymentRequested, note: COPY.proofNotVerified });
  });

  it('maps the four receipt words and the two proof notes', () => {
    const now = 1_000_000;
    const rows: Array<{
      status: PaymentRequestRecord['status'];
      extras?: Partial<PaymentRequestRecord>;
      word: string;
      note: string | null;
    }> = [
      { status: 'pending', word: COPY.paymentRequested, note: null },
      { status: 'accepted', word: COPY.paymentRequested, note: null },
      {
        status: 'pending',
        extras: { pendingEventId: 'queued' },
        word: COPY.paymentRequested,
        note: null,
      },
      {
        status: 'proof_received',
        extras: { proofVerified: true },
        word: COPY.paymentPaid,
        note: null,
      },
      {
        status: 'proof_received',
        extras: { proofVerified: null },
        word: COPY.paymentRequested,
        note: COPY.proofNotVerified,
      },
      {
        status: 'proof_received',
        extras: { proofVerified: false },
        word: COPY.paymentRequested,
        note: COPY.proofAlreadyUsed,
      },
      { status: 'rejected', word: COPY.paymentFailed, note: null },
      { status: 'cancelled', word: COPY.paymentFailed, note: null },
      {
        status: 'pending',
        extras: { expiresAt: now - 1 },
        word: COPY.paymentExpired,
        note: null,
      },
    ];
    for (const row of rows) {
      expect(formatPaymentReceipt(record({ status: row.status, ...row.extras }), now)).toEqual({
        word: row.word,
        note: row.note,
      });
    }
  });

  it('never emits delivered', () => {
    const words = [
      receiptWordForDisplay('pending'),
      receiptWordForDisplay('accepted'),
      receiptWordForDisplay('sending'),
      receiptWordForDisplay('claimed'),
      receiptWordForDisplay('verified'),
      receiptWordForDisplay('expired'),
      receiptWordForDisplay('rejected'),
      receiptWordForDisplay('cancelled'),
      receiptWordForDisplay('proof_received'),
    ];
    expect(words).not.toContain('delivered');
    expect(new Set(words)).toEqual(
      new Set([COPY.paymentRequested, COPY.paymentPaid, COPY.paymentExpired, COPY.paymentFailed]),
    );
    expect(receiptWordForDisplay('claimed')).toBe(COPY.paymentRequested);
    expect(receiptWordForDisplay('proof_received')).toBe(COPY.paymentRequested);
    expect(receiptWordForDisplay('verified')).toBe(COPY.paymentPaid);
  });
});
