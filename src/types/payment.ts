import { LINK_MESSAGE_MAX_BYTES } from './link';

/**
 * Official Paykit Private Application Message kinds for payments.
 * These travel over Encrypted Links so Bitkit-class peers interoperate.
 * This app never executes payments — it only exchanges PAMs and hands
 * validated lightning:/bitcoin: URIs to an external wallet.
 */

export const PAYKIT_PAYMENT_REQUEST_KIND = 'paykit.payment_request';
export const PAYKIT_PAYMENT_ACCEPTANCE_KIND = 'paykit.payment_request_acceptance';
export const PAYKIT_PAYMENT_REJECTION_KIND = 'paykit.payment_request_rejection';
export const PAYKIT_PAYMENT_CANCELLATION_KIND = 'paykit.payment_request_cancellation';
export const PAYKIT_PAYMENT_PROOF_KIND = 'paykit.payment_proof';
export const PAYKIT_PRIVATE_PAYMENT_LIST_KIND = 'paykit.private_payment_list';

export const PAYKIT_PAYMENT_KINDS = [
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  PAYKIT_PAYMENT_REJECTION_KIND,
  PAYKIT_PAYMENT_CANCELLATION_KIND,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
] as const;

export type PaykitPaymentKind = (typeof PAYKIT_PAYMENT_KINDS)[number];

export const PAYMENT_ASSET_BTC = 'btc';
export const PAYMENT_BTC_MAX = 21_000_000;
export const PAYMENT_REFERENCE_MAX_LEN = 256;
export const PAYMENT_ENDPOINT_IDENTIFIER_MAX_LEN = 64;
export const PAYMENT_PROOF_TYPE_BOLT11_PREIMAGE = 'bitcoin-bolt11-preimage';

export const ENDPOINT_LIGHTNING_BOLT11 = 'btc-lightning-bolt11';
export const ENDPOINT_BITCOIN_P2TR = 'btc-bitcoin-p2tr';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AMOUNT_CANONICAL = /^[0-9]+(\.[0-9]{1,11})?$/;
const ENDPOINT_CHAR = /^[A-Za-z0-9._-]+$/;
const RESERVED_ENDPOINTS = new Set(['private', 'encrypted-link-recovery']);
const BOLT11 = /^(lnbc|lntb|lnbcrt)[0-9a-z]+$/i;
const BECH32 = /^(bc1|tb1|bcrt1)[0-9a-z]{20,90}$/;
const BASE58 = /^[13mn2][1-9A-HJ-NP-Za-km-z]{25,39}$/;
const RFC3339_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const REQUEST_TOP_KEYS = ['version', 'kind', 'event_id', 'payment_request_id', 'request'] as const;
const REQUEST_TERMS_REQUIRED = [
  'amount',
  'payment_reference',
  'proposal_expires_at',
  'recurrence',
  'accepted_payment_endpoint_identifiers',
] as const;
const REQUEST_TERMS_OPTIONAL = ['metadata'] as const;
const AMOUNT_KEYS = ['value', 'asset'] as const;
const BASIC_EVENT_KEYS = ['version', 'kind', 'event_id', 'payment_request_id'] as const;
const PROOF_KEYS = [
  'version',
  'kind',
  'event_id',
  'payment_request_id',
  'payment_reference',
  'billing_period',
  'payment_endpoint_identifier',
  'proof',
] as const;
const LIST_KEYS = ['version', 'kind', 'payment_endpoints'] as const;
const RECURRENCE_REQUIRED = ['every', 'unit', 'starts_at', 'anchor', 'ends_at'] as const;
const BILLING_PERIOD_KEYS = ['starts_at', 'ends_at'] as const;
const RECURRENCE_UNITS = new Set(['minute', 'hour', 'day', 'week', 'month', 'year']);

export type PaymentStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'proof_received';

export type PaymentDirection = 'sent' | 'received';

export type PaymentAction = 'accept' | 'reject' | 'cancel' | 'proof';

/**
 * State machine (receive-side authorization is separate — see PaymentService):
 *
 * | state          | accept | reject | cancel | proof                         |
 * |----------------|--------|--------|--------|-------------------------------|
 * | pending        | payer* | payer  | payee  | payer (accepted-or-pending)   |
 * | accepted       | —      | —      | payee  | payer                         |
 * | rejected       | —      | —      | —      | —                             |
 * | cancelled      | —      | —      | —      | —                             |
 * | proof_received | —      | —      | —      | —                             |
 *
 * *accept is refused when `proposal_expires_at` is in the past.
 * Proof on pending is also refused after proposal expiry.
 * `proposal_expires_at` is a proposal window (before acceptance), not a
 * pay-by deadline: an already-accepted request can still receive proof
 * after that timestamp.
 */
export type PaymentDisplayStatus = PaymentStatus | 'expired';

export interface PaymentAmount {
  value: string;
  asset: typeof PAYMENT_ASSET_BTC;
}

export interface PaymentRecurrence {
  every: number;
  unit: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
  starts_at: string;
  anchor: string;
  ends_at: string | null;
}

export interface PaymentRequestTerms {
  amount: PaymentAmount;
  payment_reference: string;
  proposal_expires_at: string | null;
  recurrence: PaymentRecurrence | null;
  accepted_payment_endpoint_identifiers: string[];
  metadata: Record<string, unknown>;
}

export interface PaymentRequestEnvelope {
  version: 1;
  kind: typeof PAYKIT_PAYMENT_REQUEST_KIND;
  event_id: string;
  payment_request_id: string;
  request: PaymentRequestTerms;
}

export interface PaymentAcceptanceEnvelope {
  version: 1;
  kind: typeof PAYKIT_PAYMENT_ACCEPTANCE_KIND;
  event_id: string;
  payment_request_id: string;
}

export interface PaymentRejectionEnvelope {
  version: 1;
  kind: typeof PAYKIT_PAYMENT_REJECTION_KIND;
  event_id: string;
  payment_request_id: string;
  reason?: string;
}

export interface PaymentCancellationEnvelope {
  version: 1;
  kind: typeof PAYKIT_PAYMENT_CANCELLATION_KIND;
  event_id: string;
  payment_request_id: string;
  reason?: string;
}

export interface PaymentBillingPeriod {
  starts_at: string;
  ends_at: string;
}

export interface PaymentProofBody {
  type: typeof PAYMENT_PROOF_TYPE_BOLT11_PREIMAGE;
  data: string;
}

export interface PaymentProofEnvelope {
  version: 1;
  kind: typeof PAYKIT_PAYMENT_PROOF_KIND;
  event_id: string;
  payment_request_id: string;
  payment_reference: string;
  billing_period: PaymentBillingPeriod | null;
  payment_endpoint_identifier: string;
  proof: PaymentProofBody;
}

export interface PrivatePaymentListEnvelope {
  version: 1;
  kind: typeof PAYKIT_PRIVATE_PAYMENT_LIST_KIND;
  payment_endpoints: Record<string, string>;
}

export type PaymentEnvelope =
  | PaymentRequestEnvelope
  | PaymentAcceptanceEnvelope
  | PaymentRejectionEnvelope
  | PaymentCancellationEnvelope
  | PaymentProofEnvelope
  | PrivatePaymentListEnvelope;

export interface PaymentRequestRecord {
  ownerPubky: string;
  peerPubky: string;
  direction: PaymentDirection;
  paymentRequestId: string;
  eventId: string;
  amountValue: string;
  amountAsset: string;
  paymentReference: string;
  endpointIds: string[];
  expiresAt: number | null;
  status: PaymentStatus;
  createdAt: number;
  updatedAt: number;
  proofJson: string | null;
  reason: string | null;
}

export interface PaymentEventRecord {
  ownerPubky: string;
  conversationId: string;
  senderPubky: string;
  eventId: string;
  kind: string;
  paymentRequestId: string | null;
  applied: boolean;
  receivedAt: number;
}

export interface TipEndpointRecord {
  ownerPubky: string;
  peerPubky: string;
  identifier: string;
  payload: string;
  updatedAt: number;
}

export class PaymentError extends Error {
  readonly code: 'validation' | 'unauthorized' | 'not-found' | 'state' | 'expired' | 'budget';

  constructor(code: PaymentError['code'], message: string) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
  }
}

export function isPaykitPaymentKind(kind: string | null | undefined): kind is PaykitPaymentKind {
  if (!kind) return false;
  return (PAYKIT_PAYMENT_KINDS as readonly string[]).includes(kind);
}

export function isUuidV4(value: string): boolean {
  return UUID_V4.test(value);
}

export function isValidPaymentEndpointIdentifier(id: string): boolean {
  if (id.length === 0 || id.length > PAYMENT_ENDPOINT_IDENTIFIER_MAX_LEN) return false;
  if (RESERVED_ENDPOINTS.has(id)) return false;
  if (!ENDPOINT_CHAR.test(id)) return false;
  if (/^\.+$/.test(id)) return false;
  return true;
}

/**
 * Canonical v1 identifiers this app emits. Inbound lists may carry any
 * official-charset identifier; handoff only opens URIs for identifiers
 * we can map to lightning: or bitcoin: after payload validation.
 */
export function isCanonicalThreePartEndpointId(id: string): boolean {
  if (!isValidPaymentEndpointIdentifier(id)) return false;
  const parts = id.split('-');
  return parts.length >= 3 && parts.every(part => part.length > 0);
}

export function isCanonicalAmountValue(value: string): boolean {
  return AMOUNT_CANONICAL.test(value);
}

export function isPositiveBtcAmount(value: string): boolean {
  if (!isCanonicalAmountValue(value)) return false;
  if (!isBtcAtMostCap(value)) return false;
  return !isZeroAmount(value);
}

function isZeroAmount(value: string): boolean {
  const parts = value.split('.');
  const whole = parts[0] ?? '';
  const frac = parts[1] ?? '';
  return (whole === '' || /^0+$/.test(whole)) && /^0*$/.test(frac);
}

function isBtcAtMostCap(value: string): boolean {
  const parts = value.split('.');
  const wholeRaw = parts[0] ?? '0';
  const frac = parts[1] ?? '';
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  if (whole.length > 8) return false;
  const wholeNum = Number(whole);
  if (!Number.isFinite(wholeNum) || wholeNum > PAYMENT_BTC_MAX) return false;
  if (wholeNum === PAYMENT_BTC_MAX && /[1-9]/.test(frac)) return false;
  return true;
}

export function isValidPaymentReference(value: string): boolean {
  if (value.length === 0) return false;
  if ([...value].length > PAYMENT_REFERENCE_MAX_LEN) return false;
  for (const ch of value) {
    if (ch < ' ' || ch === '\u007f') return false;
  }
  return true;
}

export function isValidBolt11(payload: string): boolean {
  if (payload.length === 0) return false;
  for (const ch of payload) {
    const code = ch.charCodeAt(0);
    if (code <= 32 || code === 127) return false;
  }
  return BOLT11.test(payload);
}

export function isValidOnchainAddress(payload: string): boolean {
  if (payload.length === 0) return false;
  for (const ch of payload) {
    const code = ch.charCodeAt(0);
    if (code <= 32 || code === 127) return false;
  }
  return BECH32.test(payload) || BASE58.test(payload);
}

export function isValidRfc3339Z(value: string): boolean {
  if (!RFC3339_Z.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms);
}

export function rfc3339ZToUnixMs(value: string): number | null {
  if (!isValidRfc3339Z(value)) return null;
  return Date.parse(value);
}

export function unixMsToRfc3339Z(ms: number): string {
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new PaymentError('validation', 'expiry must be a positive Unix-millisecond integer');
  }
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function satsToBtcDecimal(sats: number): string {
  if (!Number.isInteger(sats) || sats <= 0) {
    throw new PaymentError('validation', 'amount sats must be a positive integer');
  }
  const whole = Math.floor(sats / 100_000_000);
  const frac = sats % 100_000_000;
  if (frac === 0) return String(whole);
  return `${whole}.${frac.toString().padStart(8, '0').replace(/0+$/, '')}`;
}

export function serializedPaymentBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertFitsLinkBudget(json: string, label: string): void {
  const byteSize = new TextEncoder().encode(json).byteLength;
  if (byteSize > LINK_MESSAGE_MAX_BYTES) {
    throw new PaymentError(
      'budget',
      `${label} exceeds Encrypted Link budget (${byteSize} > ${LINK_MESSAGE_MAX_BYTES})`,
    );
  }
}

export function isProposalExpired(expiresAt: number | null, nowMs: number): boolean {
  return expiresAt !== null && nowMs >= expiresAt;
}

export function displayPaymentStatus(
  status: PaymentStatus,
  expiresAt: number | null,
  nowMs: number,
): PaymentDisplayStatus {
  if (status === 'pending' && isProposalExpired(expiresAt, nowMs)) return 'expired';
  return status;
}

export function canTransition(
  status: PaymentStatus,
  action: PaymentAction,
  proposalExpired: boolean,
): boolean {
  switch (action) {
    case 'accept':
      return status === 'pending' && !proposalExpired;
    case 'reject':
      return status === 'pending';
    case 'cancel':
      return status === 'pending' || status === 'accepted';
    case 'proof':
      if (status === 'accepted') return true;
      return status === 'pending' && !proposalExpired;
    default:
      return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

function readReason(candidate: Record<string, unknown>): string | undefined | 'invalid' {
  if (!Object.prototype.hasOwnProperty.call(candidate, 'reason')) return undefined;
  if (typeof candidate.reason !== 'string') return 'invalid';
  return candidate.reason;
}

function decodeAmount(value: unknown): PaymentAmount | null {
  const amount = asRecord(value);
  if (!amount || !hasExactKeys(amount, AMOUNT_KEYS)) return null;
  if (typeof amount.value !== 'string' || typeof amount.asset !== 'string') return null;
  if (amount.asset !== PAYMENT_ASSET_BTC) return null;
  if (!isPositiveBtcAmount(amount.value)) return null;
  return { value: amount.value, asset: PAYMENT_ASSET_BTC };
}

function decodeRecurrence(value: unknown): PaymentRecurrence | null | 'invalid' {
  if (value === null) return null;
  const rec = asRecord(value);
  if (!rec || !hasExactKeys(rec, RECURRENCE_REQUIRED)) return 'invalid';
  if (typeof rec.every !== 'number' || !Number.isInteger(rec.every) || rec.every <= 0) {
    return 'invalid';
  }
  if (typeof rec.unit !== 'string' || !RECURRENCE_UNITS.has(rec.unit)) return 'invalid';
  if (typeof rec.starts_at !== 'string' || !isValidRfc3339Z(rec.starts_at)) return 'invalid';
  if (typeof rec.anchor !== 'string' || !isValidRfc3339Z(rec.anchor)) return 'invalid';
  if (rec.ends_at !== null) {
    if (typeof rec.ends_at !== 'string' || !isValidRfc3339Z(rec.ends_at)) return 'invalid';
    if (Date.parse(rec.ends_at) <= Date.parse(rec.starts_at)) return 'invalid';
  }
  return {
    every: rec.every,
    unit: rec.unit as PaymentRecurrence['unit'],
    starts_at: rec.starts_at,
    anchor: rec.anchor,
    ends_at: rec.ends_at,
  };
}

function decodeBillingPeriod(value: unknown): PaymentBillingPeriod | null | 'invalid' {
  if (value === null) return null;
  const period = asRecord(value);
  if (!period || !hasExactKeys(period, BILLING_PERIOD_KEYS)) return 'invalid';
  if (typeof period.starts_at !== 'string' || !isValidRfc3339Z(period.starts_at)) return 'invalid';
  if (typeof period.ends_at !== 'string' || !isValidRfc3339Z(period.ends_at)) return 'invalid';
  if (Date.parse(period.ends_at) <= Date.parse(period.starts_at)) return 'invalid';
  return { starts_at: period.starts_at, ends_at: period.ends_at };
}

function decodeProofBody(value: unknown): PaymentProofBody | null {
  const proof = asRecord(value);
  if (!proof) return null;
  if (typeof proof.type !== 'string' || typeof proof.data !== 'string') return null;
  if (proof.type !== PAYMENT_PROOF_TYPE_BOLT11_PREIMAGE) return null;
  for (const ch of proof.data) {
    if (ch < ' ' || ch === '\u007f') return null;
  }
  return { type: PAYMENT_PROOF_TYPE_BOLT11_PREIMAGE, data: proof.data };
}

export function buildPaymentRequestEnvelope(input: {
  eventId: string;
  paymentRequestId: string;
  amountValue: string;
  paymentReference: string;
  endpointIds: readonly string[];
  expiresAtMs?: number | null;
}): { envelope: PaymentRequestEnvelope; json: string; byteSize: number } {
  if (!isUuidV4(input.eventId) || !isUuidV4(input.paymentRequestId)) {
    throw new PaymentError('validation', 'payment request ids must be UUID v4');
  }
  if (!isPositiveBtcAmount(input.amountValue)) {
    throw new PaymentError('validation', 'amount must be a positive canonical btc decimal');
  }
  if (!isValidPaymentReference(input.paymentReference)) {
    throw new PaymentError('validation', 'payment_reference is invalid');
  }
  if (input.endpointIds.length === 0) {
    throw new PaymentError('validation', 'accepted_payment_endpoint_identifiers must not be empty');
  }
  for (const id of input.endpointIds) {
    if (!isValidPaymentEndpointIdentifier(id)) {
      throw new PaymentError('validation', 'invalid payment endpoint identifier');
    }
  }
  let proposalExpiresAt: string | null = null;
  if (input.expiresAtMs !== undefined && input.expiresAtMs !== null) {
    proposalExpiresAt = unixMsToRfc3339Z(input.expiresAtMs);
  }
  const envelope: PaymentRequestEnvelope = {
    version: 1,
    kind: PAYKIT_PAYMENT_REQUEST_KIND,
    event_id: input.eventId,
    payment_request_id: input.paymentRequestId,
    request: {
      amount: { value: input.amountValue, asset: PAYMENT_ASSET_BTC },
      payment_reference: input.paymentReference,
      proposal_expires_at: proposalExpiresAt,
      recurrence: null,
      accepted_payment_endpoint_identifiers: [...input.endpointIds],
      metadata: {},
    },
  };
  const json = JSON.stringify(envelope);
  assertFitsLinkBudget(json, 'paykit.payment_request');
  return { envelope, json, byteSize: new TextEncoder().encode(json).byteLength };
}

function buildBasicEvent(
  kind:
    | typeof PAYKIT_PAYMENT_ACCEPTANCE_KIND
    | typeof PAYKIT_PAYMENT_REJECTION_KIND
    | typeof PAYKIT_PAYMENT_CANCELLATION_KIND,
  eventId: string,
  paymentRequestId: string,
  reason?: string,
): { json: string; byteSize: number } {
  if (!isUuidV4(eventId) || !isUuidV4(paymentRequestId)) {
    throw new PaymentError('validation', 'payment event ids must be UUID v4');
  }
  if (kind === PAYKIT_PAYMENT_ACCEPTANCE_KIND && reason !== undefined) {
    throw new PaymentError('validation', 'acceptance must not include reason');
  }
  if (reason !== undefined) {
    if ([...reason].length > PAYMENT_REFERENCE_MAX_LEN) {
      throw new PaymentError('validation', 'reason exceeds maximum length');
    }
    for (const ch of reason) {
      if (ch < ' ' || ch === '\u007f') {
        throw new PaymentError('validation', 'reason must not contain control characters');
      }
    }
  }
  const envelope: Record<string, unknown> = {
    version: 1,
    kind,
    event_id: eventId,
    payment_request_id: paymentRequestId,
  };
  if (reason !== undefined) envelope.reason = reason;
  const json = JSON.stringify(envelope);
  assertFitsLinkBudget(json, kind);
  return { json, byteSize: new TextEncoder().encode(json).byteLength };
}

export function buildPaymentAcceptanceEnvelope(input: {
  eventId: string;
  paymentRequestId: string;
}): { envelope: PaymentAcceptanceEnvelope; json: string; byteSize: number } {
  const built = buildBasicEvent(
    PAYKIT_PAYMENT_ACCEPTANCE_KIND,
    input.eventId,
    input.paymentRequestId,
  );
  const envelope: PaymentAcceptanceEnvelope = {
    version: 1,
    kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
    event_id: input.eventId,
    payment_request_id: input.paymentRequestId,
  };
  return { envelope, json: built.json, byteSize: built.byteSize };
}

export function buildPaymentRejectionEnvelope(input: {
  eventId: string;
  paymentRequestId: string;
  reason?: string;
}): { envelope: PaymentRejectionEnvelope; json: string; byteSize: number } {
  const built = buildBasicEvent(
    PAYKIT_PAYMENT_REJECTION_KIND,
    input.eventId,
    input.paymentRequestId,
    input.reason,
  );
  const envelope: PaymentRejectionEnvelope = {
    version: 1,
    kind: PAYKIT_PAYMENT_REJECTION_KIND,
    event_id: input.eventId,
    payment_request_id: input.paymentRequestId,
  };
  if (input.reason !== undefined) envelope.reason = input.reason;
  return { envelope, json: built.json, byteSize: built.byteSize };
}

export function buildPaymentCancellationEnvelope(input: {
  eventId: string;
  paymentRequestId: string;
  reason?: string;
}): { envelope: PaymentCancellationEnvelope; json: string; byteSize: number } {
  const built = buildBasicEvent(
    PAYKIT_PAYMENT_CANCELLATION_KIND,
    input.eventId,
    input.paymentRequestId,
    input.reason,
  );
  const envelope: PaymentCancellationEnvelope = {
    version: 1,
    kind: PAYKIT_PAYMENT_CANCELLATION_KIND,
    event_id: input.eventId,
    payment_request_id: input.paymentRequestId,
  };
  if (input.reason !== undefined) envelope.reason = input.reason;
  return { envelope, json: built.json, byteSize: built.byteSize };
}

export function buildPaymentProofEnvelope(input: {
  eventId: string;
  paymentRequestId: string;
  paymentReference: string;
  paymentEndpointIdentifier: string;
  proofData: string;
}): { envelope: PaymentProofEnvelope; json: string; byteSize: number } {
  if (!isUuidV4(input.eventId) || !isUuidV4(input.paymentRequestId)) {
    throw new PaymentError('validation', 'payment proof ids must be UUID v4');
  }
  if (!isValidPaymentReference(input.paymentReference)) {
    throw new PaymentError('validation', 'payment_reference is invalid');
  }
  if (!isValidPaymentEndpointIdentifier(input.paymentEndpointIdentifier)) {
    throw new PaymentError('validation', 'invalid payment endpoint identifier');
  }
  for (const ch of input.proofData) {
    if (ch < ' ' || ch === '\u007f') {
      throw new PaymentError('validation', 'proof data must not contain control characters');
    }
  }
  const envelope: PaymentProofEnvelope = {
    version: 1,
    kind: PAYKIT_PAYMENT_PROOF_KIND,
    event_id: input.eventId,
    payment_request_id: input.paymentRequestId,
    payment_reference: input.paymentReference,
    billing_period: null,
    payment_endpoint_identifier: input.paymentEndpointIdentifier,
    proof: { type: PAYMENT_PROOF_TYPE_BOLT11_PREIMAGE, data: input.proofData },
  };
  const json = JSON.stringify(envelope);
  assertFitsLinkBudget(json, 'paykit.payment_proof');
  return { envelope, json, byteSize: new TextEncoder().encode(json).byteLength };
}

export function buildPrivatePaymentListEnvelope(input: {
  paymentEndpoints: Record<string, string>;
}): { envelope: PrivatePaymentListEnvelope; json: string; byteSize: number } {
  const payment_endpoints: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [identifier, payload] of Object.entries(input.paymentEndpoints)) {
    if (!isValidPaymentEndpointIdentifier(identifier)) {
      throw new PaymentError('validation', 'invalid payment endpoint identifier');
    }
    if (seen.has(identifier)) {
      throw new PaymentError('validation', 'duplicate payment endpoint identifier');
    }
    seen.add(identifier);
    const scheme = schemeForEndpointIdentifier(identifier);
    if (scheme === 'lightning' && !isValidBolt11(payload)) {
      throw new PaymentError('validation', 'lightning endpoint payload is not a valid bolt11');
    }
    if (scheme === 'bitcoin' && !isValidOnchainAddress(payload)) {
      throw new PaymentError('validation', 'bitcoin endpoint payload is not a valid address');
    }
    if (scheme === null) {
      throw new PaymentError('validation', 'unsupported payment endpoint identifier');
    }
    payment_endpoints[identifier] = payload;
  }
  const envelope: PrivatePaymentListEnvelope = {
    version: 1,
    kind: PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
    payment_endpoints,
  };
  const json = JSON.stringify(envelope);
  assertFitsLinkBudget(json, 'paykit.private_payment_list');
  return { envelope, json, byteSize: new TextEncoder().encode(json).byteLength };
}

export function schemeForEndpointIdentifier(identifier: string): 'lightning' | 'bitcoin' | null {
  if (!isValidPaymentEndpointIdentifier(identifier)) return null;
  const lower = identifier.toLowerCase();
  if (lower.includes('lightning') || lower.includes('bolt11') || lower.includes('bolt12')) {
    return 'lightning';
  }
  if (
    lower.includes('bitcoin') ||
    lower.includes('onchain') ||
    lower.includes('p2tr') ||
    lower.includes('p2wpkh') ||
    lower.includes('p2pkh')
  ) {
    return 'bitcoin';
  }
  return null;
}

export function decodePaymentRequestEnvelope(rawJson: string): PaymentRequestEnvelope | null {
  const candidate = parseObject(rawJson);
  if (!candidate || !hasExactKeys(candidate, REQUEST_TOP_KEYS)) return null;
  if (candidate.version !== 1 || candidate.kind !== PAYKIT_PAYMENT_REQUEST_KIND) return null;
  if (typeof candidate.event_id !== 'string' || !isUuidV4(candidate.event_id)) return null;
  if (typeof candidate.payment_request_id !== 'string' || !isUuidV4(candidate.payment_request_id)) {
    return null;
  }
  const terms = asRecord(candidate.request);
  if (!terms || !hasExactKeys(terms, REQUEST_TERMS_REQUIRED, REQUEST_TERMS_OPTIONAL)) return null;
  const amount = decodeAmount(terms.amount);
  if (!amount) return null;
  if (
    typeof terms.payment_reference !== 'string' ||
    !isValidPaymentReference(terms.payment_reference)
  ) {
    return null;
  }
  let proposalExpiresAt: string | null = null;
  if (terms.proposal_expires_at !== null) {
    if (
      typeof terms.proposal_expires_at !== 'string' ||
      !isValidRfc3339Z(terms.proposal_expires_at)
    ) {
      return null;
    }
    proposalExpiresAt = terms.proposal_expires_at;
  }
  const recurrence = decodeRecurrence(terms.recurrence);
  if (recurrence === 'invalid') return null;
  if (!Array.isArray(terms.accepted_payment_endpoint_identifiers)) return null;
  if (terms.accepted_payment_endpoint_identifiers.length === 0) return null;
  const endpointIds: string[] = [];
  for (const id of terms.accepted_payment_endpoint_identifiers) {
    if (typeof id !== 'string' || !isValidPaymentEndpointIdentifier(id)) return null;
    endpointIds.push(id);
  }
  let metadata: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(terms, 'metadata')) {
    const meta = asRecord(terms.metadata);
    if (!meta) return null;
    metadata = meta;
  }
  return {
    version: 1,
    kind: PAYKIT_PAYMENT_REQUEST_KIND,
    event_id: candidate.event_id,
    payment_request_id: candidate.payment_request_id,
    request: {
      amount,
      payment_reference: terms.payment_reference,
      proposal_expires_at: proposalExpiresAt,
      recurrence,
      accepted_payment_endpoint_identifiers: endpointIds,
      metadata,
    },
  };
}

export function decodePaymentAcceptanceEnvelope(rawJson: string): PaymentAcceptanceEnvelope | null {
  const candidate = parseObject(rawJson);
  if (!candidate || !hasExactKeys(candidate, BASIC_EVENT_KEYS)) return null;
  if (candidate.version !== 1 || candidate.kind !== PAYKIT_PAYMENT_ACCEPTANCE_KIND) return null;
  if (typeof candidate.event_id !== 'string' || !isUuidV4(candidate.event_id)) return null;
  if (typeof candidate.payment_request_id !== 'string' || !isUuidV4(candidate.payment_request_id)) {
    return null;
  }
  return {
    version: 1,
    kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
    event_id: candidate.event_id,
    payment_request_id: candidate.payment_request_id,
  };
}

function decodeReasonedEvent(
  rawJson: string,
  kind: typeof PAYKIT_PAYMENT_REJECTION_KIND | typeof PAYKIT_PAYMENT_CANCELLATION_KIND,
): { event_id: string; payment_request_id: string; reason?: string } | null {
  const candidate = parseObject(rawJson);
  if (!candidate || !hasExactKeys(candidate, BASIC_EVENT_KEYS, ['reason'])) return null;
  if (candidate.version !== 1 || candidate.kind !== kind) return null;
  if (typeof candidate.event_id !== 'string' || !isUuidV4(candidate.event_id)) return null;
  if (typeof candidate.payment_request_id !== 'string' || !isUuidV4(candidate.payment_request_id)) {
    return null;
  }
  const reason = readReason(candidate);
  if (reason === 'invalid') return null;
  const result: { event_id: string; payment_request_id: string; reason?: string } = {
    event_id: candidate.event_id,
    payment_request_id: candidate.payment_request_id,
  };
  if (reason !== undefined) result.reason = reason;
  return result;
}

export function decodePaymentRejectionEnvelope(rawJson: string): PaymentRejectionEnvelope | null {
  const decoded = decodeReasonedEvent(rawJson, PAYKIT_PAYMENT_REJECTION_KIND);
  if (!decoded) return null;
  const envelope: PaymentRejectionEnvelope = {
    version: 1,
    kind: PAYKIT_PAYMENT_REJECTION_KIND,
    event_id: decoded.event_id,
    payment_request_id: decoded.payment_request_id,
  };
  if (decoded.reason !== undefined) envelope.reason = decoded.reason;
  return envelope;
}

export function decodePaymentCancellationEnvelope(
  rawJson: string,
): PaymentCancellationEnvelope | null {
  const decoded = decodeReasonedEvent(rawJson, PAYKIT_PAYMENT_CANCELLATION_KIND);
  if (!decoded) return null;
  const envelope: PaymentCancellationEnvelope = {
    version: 1,
    kind: PAYKIT_PAYMENT_CANCELLATION_KIND,
    event_id: decoded.event_id,
    payment_request_id: decoded.payment_request_id,
  };
  if (decoded.reason !== undefined) envelope.reason = decoded.reason;
  return envelope;
}

export function decodePaymentProofEnvelope(rawJson: string): PaymentProofEnvelope | null {
  const candidate = parseObject(rawJson);
  if (!candidate || !hasExactKeys(candidate, PROOF_KEYS)) return null;
  if (candidate.version !== 1 || candidate.kind !== PAYKIT_PAYMENT_PROOF_KIND) return null;
  if (typeof candidate.event_id !== 'string' || !isUuidV4(candidate.event_id)) return null;
  if (typeof candidate.payment_request_id !== 'string' || !isUuidV4(candidate.payment_request_id)) {
    return null;
  }
  if (
    typeof candidate.payment_reference !== 'string' ||
    !isValidPaymentReference(candidate.payment_reference)
  ) {
    return null;
  }
  const billing = decodeBillingPeriod(candidate.billing_period);
  if (billing === 'invalid') return null;
  if (
    typeof candidate.payment_endpoint_identifier !== 'string' ||
    !isValidPaymentEndpointIdentifier(candidate.payment_endpoint_identifier)
  ) {
    return null;
  }
  const proof = decodeProofBody(candidate.proof);
  if (!proof) return null;
  return {
    version: 1,
    kind: PAYKIT_PAYMENT_PROOF_KIND,
    event_id: candidate.event_id,
    payment_request_id: candidate.payment_request_id,
    payment_reference: candidate.payment_reference,
    billing_period: billing,
    payment_endpoint_identifier: candidate.payment_endpoint_identifier,
    proof,
  };
}

export function decodePrivatePaymentListEnvelope(
  rawJson: string,
): PrivatePaymentListEnvelope | null {
  const candidate = parseObject(rawJson);
  if (!candidate || !hasExactKeys(candidate, LIST_KEYS)) return null;
  if (candidate.version !== 1 || candidate.kind !== PAYKIT_PRIVATE_PAYMENT_LIST_KIND) return null;
  const map = asRecord(candidate.payment_endpoints);
  if (!map) return null;
  const payment_endpoints: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [identifier, payload] of Object.entries(map)) {
    if (seen.has(identifier)) return null;
    seen.add(identifier);
    if (!isValidPaymentEndpointIdentifier(identifier)) return null;
    if (typeof payload !== 'string') return null;
    payment_endpoints[identifier] = payload;
  }
  return {
    version: 1,
    kind: PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
    payment_endpoints,
  };
}

export function decodePaymentEnvelope(rawJson: string): PaymentEnvelope | null {
  const kind = peekPaymentKind(rawJson);
  if (kind === PAYKIT_PAYMENT_REQUEST_KIND) return decodePaymentRequestEnvelope(rawJson);
  if (kind === PAYKIT_PAYMENT_ACCEPTANCE_KIND) return decodePaymentAcceptanceEnvelope(rawJson);
  if (kind === PAYKIT_PAYMENT_REJECTION_KIND) return decodePaymentRejectionEnvelope(rawJson);
  if (kind === PAYKIT_PAYMENT_CANCELLATION_KIND) return decodePaymentCancellationEnvelope(rawJson);
  if (kind === PAYKIT_PAYMENT_PROOF_KIND) return decodePaymentProofEnvelope(rawJson);
  if (kind === PAYKIT_PRIVATE_PAYMENT_LIST_KIND) return decodePrivatePaymentListEnvelope(rawJson);
  return null;
}

export function peekPaymentKind(rawJson: string): string | null {
  const candidate = parseObject(rawJson);
  if (!candidate) return null;
  return typeof candidate.kind === 'string' ? candidate.kind : null;
}

export function paymentPreviewBody(kind: string): string {
  switch (kind) {
    case PAYKIT_PAYMENT_REQUEST_KIND:
      return '[payment request]';
    case PAYKIT_PAYMENT_ACCEPTANCE_KIND:
      return '[payment accepted]';
    case PAYKIT_PAYMENT_REJECTION_KIND:
      return '[payment rejected]';
    case PAYKIT_PAYMENT_CANCELLATION_KIND:
      return '[payment cancelled]';
    case PAYKIT_PAYMENT_PROOF_KIND:
      return '[payment proof]';
    case PAYKIT_PRIVATE_PAYMENT_LIST_KIND:
      return '[tip list]';
    default:
      return '[payment]';
  }
}

function parseObject(rawJson: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return null;
  }
  return asRecord(value);
}
