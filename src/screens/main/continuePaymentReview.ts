import { COPY } from '../../copy/uxCopy';
import type { PaymentReviewRequest } from '../../components/PaymentRequestBubble';
import { prepareRequestHandoff } from '../../services/payments/walletHandoff';
import { sanitizeError } from '../../ui/sanitizedError';

export type ContinuePaymentReviewResult = {
  closeReview: boolean;
  walletUnavailable: boolean;
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

  let canOpen = false;
  try {
    canOpen = await deps.canOpenURL(uri);
  } catch (err) {
    return {
      closeReview: false,
      walletUnavailable: true,
      error: sanitizeError(err, fallback).message,
    };
  }
  if (!canOpen) {
    return { closeReview: false, walletUnavailable: true, error: null };
  }

  let recordError: string | null = null;
  if (review.kind === 'request' && review.record && review.selected) {
    const prepared = prepare({
      requestAmountBtc: review.amountBtc,
      endpointIdentifier: review.selected.identifier,
      payload: review.selected.payload,
    });
    const mismatchOnly = !prepared.ok && prepared.error.toLowerCase().includes('does not match');
    if (prepared.paymentHash && (prepared.ok || mismatchOnly)) {
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
  }

  try {
    await deps.openUri(uri);
  } catch (err) {
    return {
      closeReview: false,
      walletUnavailable: true,
      error: recordError ?? sanitizeError(err, fallback).message,
    };
  }

  if (recordError) {
    return { closeReview: false, walletUnavailable: true, error: recordError };
  }
  return { closeReview: true, walletUnavailable: false, error: null };
}
