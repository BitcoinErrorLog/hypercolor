import { COPY, invoiceAmountMismatchWarning, paymentNetworkLabel } from '../copy/uxCopy';
import {
  buildPayUri,
  prepareRequestHandoff,
  type RequestHandoffResult,
} from '../services/payments/walletHandoff';
import {
  btcDecimalToSats,
  isPositiveBtcAmount,
  isSupportedV1PaymentAmount,
  PAYMENT_ASSET_BTC,
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
  recordFailed?: boolean;
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

function isReviewAmountSupported(input: PaymentReviewInput): boolean {
  return isSupportedV1PaymentAmount({
    value: input.requestAmountBtc,
    asset: input.amountAsset,
  });
}

function isBitcoinDestination(row: TipEndpointRecord): boolean {
  return schemeForEndpointIdentifier(row.identifier) === 'bitcoin';
}

function isSubSatBtcAmount(value: string): boolean {
  return isPositiveBtcAmount(value) && btcDecimalToSats(value) === null;
}

export function payableReviewDestinations(input: {
  requestAmountBtc: string;
  amountAsset: string;
  destinations: readonly TipEndpointRecord[];
}): TipEndpointRecord[] {
  if (
    isSupportedV1PaymentAmount({ value: input.requestAmountBtc, asset: input.amountAsset }) &&
    isSubSatBtcAmount(input.requestAmountBtc)
  ) {
    return input.destinations.filter(row => !isBitcoinDestination(row));
  }
  return [...input.destinations];
}

export function resolvePaymentReviewEndpoint(
  requested: TipEndpointRecord | null,
  destinations: readonly TipEndpointRecord[],
): TipEndpointRecord | null {
  if (requested && destinations.some(row => row.identifier === requested.identifier)) {
    return requested;
  }
  if (destinations.length === 1) return destinations[0] ?? null;
  return null;
}

function joinWarningText(...parts: Array<string | null | undefined>): string | null {
  const texts = parts.filter((part): part is string => typeof part === 'string' && part.length > 0);
  return texts.length === 0 ? null : texts.join(' ');
}

function handoffFor(
  requestAmountBtc: string,
  amountAsset: string,
  endpoint: TipEndpointRecord | null,
): RequestHandoffResult | null {
  if (!endpoint) return null;
  if (!isSupportedV1PaymentAmount({ value: requestAmountBtc, asset: amountAsset })) return null;
  return prepareRequestHandoff({
    requestAmountBtc,
    endpointIdentifier: endpoint.identifier,
    payload: endpoint.payload,
    amountAsset,
  });
}

function tryUri(
  requestAmountBtc: string,
  amountAsset: string,
  endpoint: TipEndpointRecord | null,
): string | null {
  if (!endpoint) return null;
  if (!isSupportedV1PaymentAmount({ value: requestAmountBtc, asset: amountAsset })) return null;
  try {
    return buildPayUri(endpoint.identifier, endpoint.payload, requestAmountBtc).uri;
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
  const destinations = payableReviewDestinations(input);
  const endpoint = resolvePaymentReviewEndpoint(input.endpoint, destinations);
  const droppedOnchain =
    isReviewAmountSupported(input) &&
    isSubSatBtcAmount(input.requestAmountBtc) &&
    input.destinations.some(isBitcoinDestination);
  const lightningOnlyNote = droppedOnchain ? COPY.onlyLightningCanPayAmount : null;
  const handoff = handoffFor(input.requestAmountBtc, input.amountAsset, endpoint);
  const uri = tryUri(input.requestAmountBtc, input.amountAsset, endpoint);
  const invoiceAmount = handoff?.invoiceAmountBtc ?? endpoint?.invoiceAmount ?? null;
  const mismatch = isAmountMismatch(handoff);
  const expiresAt = expiryMs({ ...input, endpoint }, handoff);
  const expired = expiresAt !== null && expiresAt <= input.nowMs;
  const handoffError = handoff && !handoff.ok ? handoff.error : null;
  const amountMissing = !isReviewAmountSupported(input);
  const destinationsEmpty = input.destinationsEmpty || destinations.length === 0;
  const needsChoice = destinations.length > 1 && endpoint === null;

  let errorText: string | null = null;
  if (destinationsEmpty) {
    errorText = COPY.noMatchingDestination;
  } else if (needsChoice) {
    errorText = COPY.choosePaymentDestination;
  } else if (amountMissing) {
    errorText =
      input.amountAsset !== PAYMENT_ASSET_BTC
        ? COPY.unsupportedPaymentAmount
        : 'Enter a valid BTC amount';
  } else if (expired) {
    errorText = COPY.invoiceExpired;
  } else if (handoffError && !mismatch) {
    errorText = handoffError;
  }

  const warningText = joinWarningText(
    lightningOnlyNote,
    input.recordFailed
      ? COPY.invoiceNotRecorded
      : mismatch
        ? invoiceAmountMismatchWarning(invoiceAmount ?? '', input.requestAmountBtc)
        : input.walletUnavailable
          ? COPY.noWalletForLink
          : handoff && handoff.ok
            ? (handoff.warning ?? null)
            : null,
  );

  const primaryEnabled =
    !destinationsEmpty &&
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
    destinationText: endpoint
      ? formatTipIdentifierDisplay(endpoint.identifier)
      : needsChoice
        ? COPY.choosePaymentDestination
        : null,
    payloadText: endpoint ? payloadPreview(endpoint.payload) : null,
    networkText: networkForEndpoint(endpoint),
    feeText: null,
    expiryText: expiresAt !== null ? formatExpiry(expiresAt, input.nowMs) : null,
    warningText,
    errorText: input.handoffError ?? errorText,
    emptyDestinations: destinationsEmpty,
    expired,
    amountMismatch: mismatch,
    requiresDestinationChoice: needsChoice,
    destinations: destinations.map(row => ({
      identifier: row.identifier,
      label: formatTipIdentifierDisplay(row.identifier),
    })),
    selectedIdentifier: endpoint?.identifier ?? null,
    primaryEnabled,
    primaryOutline: mismatch && primaryEnabled,
    primaryLabel: copyPrimary ? COPY.copyPaymentUri : COPY.openWallet,
    primaryAction: copyPrimary ? 'copy' : 'open',
    secondaryLabel: copyPrimary ? COPY.openWallet : uri ? COPY.copyPaymentUri : null,
    secondaryAction: copyPrimary ? 'open' : uri ? 'copy' : null,
    uri,
    walletUnavailable: input.walletUnavailable,
    paymentHash: handoff?.paymentHash ?? endpoint?.paymentHash ?? null,
  };
}
