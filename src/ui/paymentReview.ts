import { COPY, invoiceAmountMismatchWarning } from '../copy/uxCopy';
import {
  buildPayUri,
  prepareRequestHandoff,
  type RequestHandoffResult,
} from '../services/payments/walletHandoff';
import { schemeForEndpointIdentifier, type TipEndpointRecord } from '../types/payment';
import { formatTipIdentifierDisplay, payloadPreview } from '../utils/displaySanitize';
import { peerIdentity, type PeerContactHint } from './peerIdentity';
import { shortPubky } from './shortPubky';

export type PaymentReviewKind = 'request' | 'tip';

export type PaymentReviewInput = {
  kind: PaymentReviewKind;
  recipientPubky: string;
  recipientContact: PeerContactHint;
  requestAmountBtc: string;
  amountAsset: string;
  reference: string | null;
  endpoint: TipEndpointRecord | null;
  nowMs: number;
  destinationsEmpty: boolean;
  walletUnavailable: boolean;
};

export type PaymentReviewView = {
  recipientTitle: string;
  recipientShortPubky: string;
  amountText: string;
  invoiceAmountText: string | null;
  referenceText: string | null;
  destinationText: string | null;
  payloadText: string | null;
  networkText: string | null;
  feeText: string | null;
  expiryText: string | null;
  warningText: string | null;
  errorText: string | null;
  emptyDestinations: boolean;
  expired: boolean;
  amountMismatch: boolean;
  primaryEnabled: boolean;
  primaryOutline: boolean;
  primaryLabel: string;
  secondaryLabel: string;
  uri: string | null;
  walletUnavailable: boolean;
};

export const PAYMENT_COMPOSE_DEFAULT_AMOUNT = '';

function handoffFor(input: PaymentReviewInput): RequestHandoffResult | null {
  if (!input.endpoint) return null;
  return prepareRequestHandoff({
    requestAmountBtc: input.requestAmountBtc,
    endpointIdentifier: input.endpoint.identifier,
    payload: input.endpoint.payload,
  });
}

function tryUri(input: PaymentReviewInput): string | null {
  if (!input.endpoint) return null;
  try {
    return buildPayUri(input.endpoint.identifier, input.endpoint.payload, input.requestAmountBtc)
      .uri;
  } catch {
    return null;
  }
}

function expiryMs(input: PaymentReviewInput, handoff: RequestHandoffResult | null): number | null {
  if (input.endpoint?.invoiceExpiresAt != null) return input.endpoint.invoiceExpiresAt;
  if (handoff?.expiresAtMs != null) return handoff.expiresAtMs;
  return null;
}

function formatExpiry(expiresAt: number, nowMs: number): string | null {
  if (expiresAt <= nowMs) return COPY.invoiceExpired;
  const remaining = Math.ceil((expiresAt - nowMs) / 1000);
  const minutes = Math.floor(remaining / 60);
  if (minutes >= 1) return `Expires in ${minutes}m ${remaining % 60}s`;
  return `Expires in ${remaining}s`;
}

function amountsDiffer(requested: string, invoice: string | null): boolean {
  if (!invoice) return false;
  return invoice.trim() !== requested.trim();
}

/** Maps request/tip + destination into the Payment Review sheet model. */
export function mapPaymentReview(input: PaymentReviewInput): PaymentReviewView {
  const identity = peerIdentity(input.recipientPubky, input.recipientContact);
  const handoff = handoffFor(input);
  const uri = tryUri(input);
  const invoiceAmount = handoff?.invoiceAmountBtc ?? input.endpoint?.invoiceAmount ?? null;
  const mismatch = amountsDiffer(input.requestAmountBtc, invoiceAmount);
  const expiresAt = expiryMs(input, handoff);
  const expired = expiresAt !== null && expiresAt <= input.nowMs;
  const scheme = input.endpoint ? schemeForEndpointIdentifier(input.endpoint.identifier) : null;
  const handoffError = handoff && !handoff.ok ? handoff.error : null;
  const mismatchIsOnlyBlock =
    mismatch && handoffError !== null && handoffError.toLowerCase().includes('does not match');

  let errorText: string | null = null;
  if (input.destinationsEmpty) {
    errorText = COPY.noMatchingDestination;
  } else if (expired) {
    errorText = COPY.invoiceExpired;
  } else if (input.walletUnavailable) {
    errorText = COPY.noWalletForLink;
  } else if (handoffError && !mismatchIsOnlyBlock) {
    errorText = handoffError;
  }

  const warningText = mismatch
    ? invoiceAmountMismatchWarning(invoiceAmount ?? '', input.requestAmountBtc)
    : handoff && handoff.ok
      ? (handoff.warning ?? null)
      : null;

  const primaryEnabled =
    !input.destinationsEmpty &&
    !expired &&
    errorText === null &&
    uri !== null &&
    (handoff === null || handoff.ok || mismatchIsOnlyBlock);

  return {
    recipientTitle: identity.title,
    recipientShortPubky: shortPubky(input.recipientPubky),
    amountText: `${input.requestAmountBtc} ${input.amountAsset.toUpperCase()}`.trim(),
    invoiceAmountText: invoiceAmount ? `${invoiceAmount} BTC` : null,
    referenceText: input.reference,
    destinationText: input.endpoint ? formatTipIdentifierDisplay(input.endpoint.identifier) : null,
    payloadText: input.endpoint ? payloadPreview(input.endpoint.payload) : null,
    networkText: scheme,
    feeText: null,
    expiryText: expiresAt !== null ? formatExpiry(expiresAt, input.nowMs) : null,
    warningText,
    errorText,
    emptyDestinations: input.destinationsEmpty,
    expired,
    amountMismatch: mismatch,
    primaryEnabled,
    primaryOutline: mismatch && primaryEnabled,
    primaryLabel: input.walletUnavailable ? COPY.copyPaymentUri : COPY.continueInBitkit,
    secondaryLabel: COPY.copyPaymentUri,
    uri,
    walletUnavailable: input.walletUnavailable,
  };
}
