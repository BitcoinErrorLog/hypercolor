import { Alert, Clipboard, Linking } from 'react-native';
import { COPY } from '../../copy/uxCopy';
import {
  btcDecimalToSats,
  isSupportedV1PaymentAmount,
  isValidOnchainAddress,
  satsToBtcDecimal,
  schemeForEndpointIdentifier,
} from '../../types/payment';
import {
  amountsMatchExactly,
  decodeBolt11Invoice,
  isMainnetBolt11,
  type DecodedBolt11Invoice,
} from '../../utils/bolt11';

export type WalletHandoffDeps = {
  canOpenURL?: (url: string) => Promise<boolean>;
  openURL?: (url: string) => Promise<void>;
  alert?: (title: string, message: string, buttons?: AlertButton[]) => void;
  copyText?: (text: string) => void;
};

type AlertButton = { text: string; onPress?: () => void; style?: 'cancel' | 'default' };

export type BuiltPayUri = {
  uri: string;
  scheme: 'lightning' | 'bitcoin';
};

export type RequestHandoffResult =
  | {
      ok: true;
      uri: string;
      scheme: 'lightning' | 'bitcoin';
      requestAmountBtc: string;
      invoiceAmountBtc: string | null;
      paymentHash: string | null;
      expiresAtMs: number | null;
      warning?: string;
    }
  | {
      ok: false;
      error: string;
      requestAmountBtc: string;
      invoiceAmountBtc: string | null;
      paymentHash: string | null;
      expiresAtMs: number | null;
    };

/**
 * Build a lightning: or bitcoin: URI from a validated endpoint payload.
 * `requestAmountBtc` is required for request-bound bitcoin: handoff
 * (`?amount=`). Lightning URIs carry the invoice amount when present.
 */
export function buildPayUri(
  endpointIdentifier: string,
  payload: string,
  requestAmountBtc?: string,
): BuiltPayUri {
  const scheme = schemeForEndpointIdentifier(endpointIdentifier);
  if (scheme === 'lightning') {
    if (!isMainnetBolt11(payload)) {
      throw new Error('bolt11 invoice failed validation');
    }
    return { uri: `lightning:${payload.toLowerCase()}`, scheme };
  }
  if (scheme === 'bitcoin') {
    if (!isValidOnchainAddress(payload)) {
      throw new Error('on-chain address failed validation');
    }
    if (requestAmountBtc !== undefined && requestAmountBtc.length > 0) {
      const sats = btcDecimalToSats(requestAmountBtc);
      if (sats === null) {
        throw new Error('on-chain amount must be a whole-satoshi BTC decimal');
      }
      return { uri: `bitcoin:${payload}?amount=${satsToBtcDecimal(sats)}`, scheme };
    }
    return { uri: `bitcoin:${payload}`, scheme };
  }
  throw new Error('endpoint identifier is not a lightning or bitcoin destination');
}

/**
 * Bind a destination to a payment request. Lightning invoices with an
 * embedded amount that differs from the request are blocked (exact match).
 * Amountless invoices are allowed with a warning naming the request amount.
 */
export function prepareRequestHandoff(input: {
  requestAmountBtc: string;
  endpointIdentifier: string;
  payload: string;
  amountAsset: string;
}): RequestHandoffResult {
  if (!isSupportedV1PaymentAmount({ value: input.requestAmountBtc, asset: input.amountAsset })) {
    return {
      ok: false,
      error: COPY.unsupportedPaymentAmount,
      requestAmountBtc: input.requestAmountBtc,
      invoiceAmountBtc: null,
      paymentHash: null,
      expiresAtMs: null,
    };
  }
  const scheme = schemeForEndpointIdentifier(input.endpointIdentifier);
  if (scheme === 'bitcoin') {
    if (btcDecimalToSats(input.requestAmountBtc) === null) {
      return {
        ok: false,
        error: COPY.onlyLightningCanPayAmount,
        requestAmountBtc: input.requestAmountBtc,
        invoiceAmountBtc: null,
        paymentHash: null,
        expiresAtMs: null,
      };
    }
    try {
      const { uri } = buildPayUri(input.endpointIdentifier, input.payload, input.requestAmountBtc);
      return {
        ok: true,
        uri,
        scheme,
        requestAmountBtc: input.requestAmountBtc,
        invoiceAmountBtc: null,
        paymentHash: null,
        expiresAtMs: null,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'on-chain address failed validation',
        requestAmountBtc: input.requestAmountBtc,
        invoiceAmountBtc: null,
        paymentHash: null,
        expiresAtMs: null,
      };
    }
  }
  if (scheme !== 'lightning') {
    return {
      ok: false,
      error: 'endpoint identifier is not a lightning or bitcoin destination',
      requestAmountBtc: input.requestAmountBtc,
      invoiceAmountBtc: null,
      paymentHash: null,
      expiresAtMs: null,
    };
  }

  let decoded: DecodedBolt11Invoice;
  try {
    decoded = decodeBolt11Invoice(input.payload);
  } catch {
    return {
      ok: false,
      error: COPY.invoiceInvalid,
      requestAmountBtc: input.requestAmountBtc,
      invoiceAmountBtc: null,
      paymentHash: null,
      expiresAtMs: null,
    };
  }
  if (decoded.network !== 'bitcoin') {
    return {
      ok: false,
      error: 'invoice network is not mainnet bitcoin',
      requestAmountBtc: input.requestAmountBtc,
      invoiceAmountBtc: decoded.amountBtc,
      paymentHash: decoded.paymentHash,
      expiresAtMs: decoded.expiresAtMs,
    };
  }
  if (decoded.amountMsat !== null) {
    if (!amountsMatchExactly(input.requestAmountBtc, decoded.amountMsat)) {
      return {
        ok: false,
        error: `Invoice amount ${decoded.amountBtc ?? decoded.amountMsat} BTC does not match the request amount ${input.requestAmountBtc} BTC`,
        requestAmountBtc: input.requestAmountBtc,
        invoiceAmountBtc: decoded.amountBtc,
        paymentHash: decoded.paymentHash,
        expiresAtMs: decoded.expiresAtMs,
      };
    }
    return {
      ok: true,
      uri: `lightning:${decoded.paymentRequest}`,
      scheme: 'lightning',
      requestAmountBtc: input.requestAmountBtc,
      invoiceAmountBtc: decoded.amountBtc,
      paymentHash: decoded.paymentHash,
      expiresAtMs: decoded.expiresAtMs,
    };
  }
  return {
    ok: true,
    uri: `lightning:${decoded.paymentRequest}`,
    scheme: 'lightning',
    requestAmountBtc: input.requestAmountBtc,
    invoiceAmountBtc: null,
    paymentHash: decoded.paymentHash,
    expiresAtMs: decoded.expiresAtMs,
    warning: `Invoice has no amount. Enter ${input.requestAmountBtc} BTC in the wallet.`,
  };
}

export async function openBuiltUri(
  uri: string,
  deps: WalletHandoffDeps = {},
): Promise<'opened' | 'copied'> {
  const canOpen = deps.canOpenURL ?? ((url: string) => Linking.canOpenURL(url));
  const openURL = deps.openURL ?? ((url: string) => Linking.openURL(url));
  const alert = deps.alert ?? Alert.alert;
  const copyText = deps.copyText ?? ((text: string) => Clipboard.setString(text));

  const available = await canOpen(uri);
  if (available) {
    await openURL(uri);
    return 'opened';
  }

  await new Promise<void>(resolve => {
    alert(
      'No wallet installed',
      'Copy the payment URI and paste it into a wallet that supports lightning: or bitcoin: links.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
        {
          text: 'Copy URI',
          onPress: () => {
            copyText(uri);
            resolve();
          },
        },
      ],
    );
  });
  return 'copied';
}
