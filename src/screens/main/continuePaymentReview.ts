import { COPY } from '../../copy/uxCopy';
import type { PaymentReviewRequest } from '../../components/PaymentRequestBubble';
import {
  buildPayUri,
  prepareRequestHandoff,
  type RequestHandoffResult,
} from '../../services/payments/walletHandoff';
import type { TipEndpointRecord } from '../../types/payment';
import { payableReviewDestinations, resolvePaymentReviewEndpoint } from '../../ui/paymentReview';
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
    endpointIdentifier: string,
  ) => Promise<void>;
  recordDisplayedTipInvoice: (endpointIdentifier: string, paymentHash: string) => Promise<void>;
  prepare?: typeof prepareRequestHandoff;
};

function isAmountMismatchFailure(prepared: RequestHandoffResult): boolean {
  return !prepared.ok && prepared.error.toLowerCase().includes('does not match');
}

function uriForEndpoint(endpoint: TipEndpointRecord, requestAmountBtc: string): string | null {
  try {
    return buildPayUri(endpoint.identifier, endpoint.payload, requestAmountBtc).uri;
  } catch {
    return null;
  }
}

function missingEndpointError(destinationCount: number): string {
  return destinationCount === 0 ? COPY.noMatchingDestination : COPY.choosePaymentDestination;
}

/**
 * Confirm path for Payment Review. Every awaited step is caught so a rejecting
 * `canOpenURL` / `recordDisplayedInvoice` / `openURL` cannot leave the sheet
 * silently dead. Copy remains reachable whenever the wallet cannot be opened.
 */
export async function continuePaymentReview(
  review: PaymentReviewRequest,
  deps: ContinuePaymentReviewDeps,
): Promise<ContinuePaymentReviewResult> {
  const fallback = COPY.couldNotOpenWallet;
  const prepare = deps.prepare ?? prepareRequestHandoff;
  const destinations = payableReviewDestinations({
    requestAmountBtc: review.amountBtc,
    amountAsset: review.amountAsset,
    destinations: review.destinations,
  });
  const endpoint = resolvePaymentReviewEndpoint(review.selected, destinations);
  if (!endpoint) {
    return {
      closeReview: false,
      walletUnavailable: false,
      recordFailed: false,
      error: missingEndpointError(destinations.length),
    };
  }

  const prepared = prepare({
    requestAmountBtc: review.amountBtc,
    endpointIdentifier: endpoint.identifier,
    payload: endpoint.payload,
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

  const targetUri = prepared.ok ? prepared.uri : uriForEndpoint(endpoint, review.amountBtc);
  if (!targetUri) {
    return {
      closeReview: false,
      walletUnavailable: false,
      recordFailed: false,
      error: fallback,
    };
  }

  let canOpen = false;
  try {
    canOpen = await deps.canOpenURL(targetUri);
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
  const paymentHash = prepared.paymentHash;
  if (paymentHash && (prepared.ok || isAmountMismatchFailure(prepared))) {
    if (review.kind === 'request' && review.record) {
      try {
        await deps.recordDisplayedInvoice(
          review.record.peerPubky,
          review.record.paymentRequestId,
          paymentHash,
          endpoint.identifier,
        );
      } catch (err) {
        recordError = sanitizeError(err, fallback).message;
      }
    } else if (review.kind === 'tip') {
      try {
        await deps.recordDisplayedTipInvoice(endpoint.identifier, paymentHash);
      } catch (err) {
        recordError = sanitizeError(err, fallback).message;
      }
    }
  }

  try {
    await deps.openUri(targetUri);
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
