import { COPY, invoiceAmountMismatchWarning, paymentNetworkLabel } from '../copy/uxCopy';
import {
  buildPayUri,
  prepareRequestHandoff,
  type RequestHandoffResult,
} from '../services/payments/walletHandoff';
import {
  isPositiveBtcAmount,
  schemeForEndpointIdentifier,
  type TipEndpointRecord,
} from '../types/payment';
import { decodeBolt11Invoice } from '../utils/bolt11';
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
  destinations: readonly TipEndpointRecord[];
  nowMs: number;
  destinationsEmpty: boolean;
  walletUnavailable: boolean;
  handoffError?: string | null;
};

export type PaymentReviewDestinationOption = {
  identifier: string;
  label: string;
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
  requiresDestinationChoice: boolean;
  destinations: PaymentReviewDestinationOption[];
  selectedIdentifier: string | null;
  primaryEnabled: boolean;
  primaryOutline: boolean;
  primaryLabel: string;
  primaryAction: 'open' | 'copy';
  secondaryLabel: string | null;
  secondaryAction: 'copy' | 'open' | null;
  uri: string | null;
  walletUnavailable: boolean;
  paymentHash: string | null;
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

function isAmountMismatch(handoff: RequestHandoffResult | null): boolean {
  if (!handoff || handoff.ok) return false;
  return handoff.error.toLowerCase().includes('does not match');
}

function networkForEndpoint(endpoint: TipEndpointRecord | null): string | null {
  if (!endpoint) return null;
  const scheme = schemeForEndpointIdentifier(endpoint.identifier);
  if (scheme === 'bitcoin') return paymentNetworkLabel(scheme, 'bitcoin');
  if (scheme !== 'lightning') return null;
  try {
    const decoded = decodeBolt11Invoice(endpoint.payload);
    return paymentNetworkLabel(scheme, decoded.network);
  } catch {
    return paymentNetworkLabel(scheme, null);
  }
}

/** Maps request/tip + destination into the Payment Review sheet model. */
export function mapPaymentReview(input: PaymentReviewInput): PaymentReviewView {
  const identity = peerIdentity(input.recipientPubky, input.recipientContact);
  const handoff = handoffFor(input);
  const uri = tryUri(input);
  const invoiceAmount = handoff?.invoiceAmountBtc ?? input.endpoint?.invoiceAmount ?? null;
  const mismatch = isAmountMismatch(handoff);
  const expiresAt = expiryMs(input, handoff);
  const expired = expiresAt !== null && expiresAt <= input.nowMs;
  const handoffError = handoff && !handoff.ok ? handoff.error : null;
  const amountMissing =
    input.requestAmountBtc.trim().length === 0 || !isPositiveBtcAmount(input.requestAmountBtc);
  const needsChoice = input.destinations.length > 1 && input.endpoint === null;

  let errorText: string | null = null;
  if (input.destinationsEmpty) {
    errorText = COPY.noMatchingDestination;
  } else if (needsChoice) {
    errorText = COPY.choosePaymentDestination;
  } else if (amountMissing) {
    errorText = 'Enter a valid BTC amount';
  } else if (expired) {
    errorText = COPY.invoiceExpired;
  } else if (handoffError && !mismatch) {
    errorText = handoffError;
  }

  const warningText = mismatch
    ? invoiceAmountMismatchWarning(invoiceAmount ?? '', input.requestAmountBtc)
    : input.walletUnavailable
      ? COPY.noWalletForLink
      : handoff && handoff.ok
        ? (handoff.warning ?? null)
        : null;

  const primaryEnabled =
    !input.destinationsEmpty &&
    !needsChoice &&
    !amountMissing &&
    !expired &&
    errorText === null &&
    uri !== null &&
    (handoff === null || handoff.ok || mismatch);

  const copyPrimary = input.walletUnavailable && uri !== null && primaryEnabled;

  return {
    recipientTitle: identity.title,
    recipientShortPubky: shortPubky(input.recipientPubky),
    amountText: `${input.requestAmountBtc} ${input.amountAsset.toUpperCase()}`.trim(),
    invoiceAmountText: invoiceAmount ? `${invoiceAmount} BTC` : null,
    referenceText: input.reference,
    destinationText: input.endpoint
      ? formatTipIdentifierDisplay(input.endpoint.identifier)
      : needsChoice
        ? COPY.choosePaymentDestination
        : null,
    payloadText: input.endpoint ? payloadPreview(input.endpoint.payload) : null,
    networkText: networkForEndpoint(input.endpoint),
    feeText: null,
    expiryText: expiresAt !== null ? formatExpiry(expiresAt, input.nowMs) : null,
    warningText,
    errorText: input.handoffError ?? errorText,
    emptyDestinations: input.destinationsEmpty,
    expired,
    amountMismatch: mismatch,
    requiresDestinationChoice: needsChoice,
    destinations: input.destinations.map(row => ({
      identifier: row.identifier,
      label: formatTipIdentifierDisplay(row.identifier),
    })),
    selectedIdentifier: input.endpoint?.identifier ?? null,
    primaryEnabled,
    primaryOutline: mismatch && primaryEnabled,
    primaryLabel: copyPrimary ? COPY.copyPaymentUri : COPY.openWallet,
    primaryAction: copyPrimary ? 'copy' : 'open',
    secondaryLabel: copyPrimary ? COPY.openWallet : uri ? COPY.copyPaymentUri : null,
    secondaryAction: copyPrimary ? 'open' : uri ? 'copy' : null,
    uri,
    walletUnavailable: input.walletUnavailable,
    paymentHash: handoff?.paymentHash ?? input.endpoint?.paymentHash ?? null,
  };
}
