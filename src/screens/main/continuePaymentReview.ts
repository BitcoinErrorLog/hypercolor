import { COPY } from '../../copy/uxCopy';
import type { PaymentReviewRequest } from '../../components/PaymentRequestBubble';
import {
  prepareRequestHandoff,
  type RequestHandoffResult,
} from '../../services/payments/walletHandoff';
import { sanitizeError } from '../../ui/sanitizedError';

export type ContinuePaymentReviewResult = {
  closeReview: boolean;
  walletUnavailable: boolean;
  recordFailed: boolean;
  error: string | null;
};

export type ContinuePaymentReviewDeps = {
  canOpenURL: (uri: string) => Promise<boolean>;
  openUri: (uri: string) => Promise<unknown>;
  recordDisplayedInvoice: (
    peer: string,
    paymentRequestId: string,
    paymentHash: string,
  ) => Promise<void>;
  prepare?: typeof prepareRequestHandoff;
};

function isAmountMismatchFailure(prepared: RequestHandoffResult): boolean {
  return !prepared.ok && prepared.error.toLowerCase().includes('does not match');
}

/**
 * Confirm path for Payment Review. Every awaited step is caught so a rejecting
 * `canOpenURL` / `recordDisplayedInvoice` / `openURL` cannot leave the sheet
 * silently dead. Copy remains reachable whenever the wallet cannot be opened.
 */
export async function continuePaymentReview(
  uri: string,
  review: PaymentReviewRequest,
  deps: ContinuePaymentReviewDeps,
): Promise<ContinuePaymentReviewResult> {
  const fallback = COPY.couldNotOpenWallet;
  const prepare = deps.prepare ?? prepareRequestHandoff;

  let prepared: RequestHandoffResult | null = null;
  if (review.selected) {
    prepared = prepare({
      requestAmountBtc: review.amountBtc,
      endpointIdentifier: review.selected.identifier,
      payload: review.selected.payload,
      amountAsset: review.amountAsset,
    });
    if (!prepared.ok && !isAmountMismatchFailure(prepared)) {
      return {
        closeReview: false,
        walletUnavailable: false,
        recordFailed: false,
        error: prepared.error,
      };
    }
  }

  let canOpen = false;
  try {
    canOpen = await deps.canOpenURL(uri);
  } catch (err) {
    return {
      closeReview: false,
      walletUnavailable: true,
      recordFailed: false,
      error: sanitizeError(err, fallback).message,
    };
  }
  if (!canOpen) {
    return { closeReview: false, walletUnavailable: true, recordFailed: false, error: null };
  }

  let recordError: string | null = null;
  if (
    review.kind === 'request' &&
    review.record &&
    prepared &&
    prepared.paymentHash &&
    (prepared.ok || isAmountMismatchFailure(prepared))
  ) {
    try {
      await deps.recordDisplayedInvoice(
        review.record.peerPubky,
        review.record.paymentRequestId,
        prepared.paymentHash,
      );
    } catch (err) {
      recordError = sanitizeError(err, fallback).message;
    }
  }

  try {
    await deps.openUri(uri);
  } catch (err) {
    return {
      closeReview: false,
      walletUnavailable: true,
      recordFailed: false,
      error: recordError ?? sanitizeError(err, fallback).message,
    };
  }

  if (recordError) {
    return {
      closeReview: false,
      walletUnavailable: false,
      recordFailed: true,
      error: COPY.invoiceNotRecorded,
    };
  }
  return { closeReview: true, walletUnavailable: false, recordFailed: false, error: null };
}
