import { tryDecodeBolt11Invoice } from '../../utils/bolt11';
import { isValidMainnetOnchainAddress } from '../../utils/onchainAddress';
import { schemeForEndpointIdentifier, type TipValidationStatus } from '../../types/payment';

export type ValidatedTipEndpoint = {
  identifier: string;
  payload: string;
  validationStatus: TipValidationStatus;
  invoiceAmount: string | null;
  invoiceExpiresAt: number | null;
  paymentHash: string | null;
};

export function validateTipEndpoint(identifier: string, payload: string): ValidatedTipEndpoint {
  const scheme = schemeForEndpointIdentifier(identifier);
  if (scheme === 'lightning') {
    const decoded = tryDecodeBolt11Invoice(payload);
    if (!decoded || decoded.network !== 'bitcoin') {
      return rejected(identifier, payload);
    }
    return {
      identifier,
      payload: decoded.paymentRequest,
      validationStatus: 'valid',
      invoiceAmount: decoded.amountBtc,
      invoiceExpiresAt: decoded.expiresAtMs,
      paymentHash: decoded.paymentHash,
    };
  }
  if (scheme === 'bitcoin') {
    if (!isValidMainnetOnchainAddress(payload)) {
      return rejected(identifier, payload);
    }
    return {
      identifier,
      payload,
      validationStatus: 'valid',
      invoiceAmount: null,
      invoiceExpiresAt: null,
      paymentHash: null,
    };
  }
  return rejected(identifier, payload);
}

function rejected(identifier: string, payload: string): ValidatedTipEndpoint {
  return {
    identifier,
    payload,
    validationStatus: 'rejected',
    invoiceAmount: null,
    invoiceExpiresAt: null,
    paymentHash: null,
  };
}
