import type { PubkyKey } from '../../types';
import { buildDmConversationId } from '../../types/link';
import {
  EMPTY_PAYMENT_RECORD_EXTRAS,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  PAYKIT_PAYMENT_CANCELLATION_KIND,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PAYMENT_REJECTION_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
  canTransition,
  decodePaymentAcceptanceEnvelope,
  decodePaymentCancellationEnvelope,
  decodePaymentProofEnvelope,
  decodePaymentRejectionEnvelope,
  decodePaymentRequestEnvelope,
  decodePrivatePaymentListEnvelope,
  expectedStatusesForAction,
  isProposalExpired,
  isSupportedV1PaymentAmount,
  peekPaymentKind,
  rfc3339ZToUnixMs,
  PROOF_REASON_AMOUNT_MISMATCH,
  type OwnInvoiceHashRecord,
  type PaymentAction,
  type PaymentDirection,
  type PaymentRequestRecord,
  type PaymentStatus,
} from '../../types/payment';
import { StorageService } from '../StorageService';
import { validateTipEndpoint } from './endpointValidation';
import { invoiceAmountRelation, invoiceExpiredBeforeRequest } from './invoiceAmountBind';
import { bolt11PreimagePaymentHash, extractBolt11Preimage } from './proofVerify';

export type PaymentInboundOutcome =
  | { action: 'applied'; request: PaymentRequestRecord | null }
  | { action: 'ignored' }
  | { action: 'rejected' };

/**
 * Receive-side Paykit payment PAM apply. Authorization is against the
 * authenticated Encrypted Link peer (`senderPubky`).
 *
 * - payment_request: creates a request owned by the authenticated sender (payee).
 * - acceptance / rejection: payer only — must reference a request WE sent
 *   to that peer (`direction = sent`).
 * - cancellation: payee only — must reference a request WE received from
 *   that peer (`direction = received`).
 * - proof: payer only, request must already be accepted. Proof on a
 *   pending request is marked seen and not applied.
 * - Unknown payment_request_id: mark seen, never apply.
 * - Cross-peer: lookup is always (owner, authenticated peer, request_id).
 *
 * Recurring requests (non-null `recurrence`) and proofs with a billing
 * period are rejected: this app's v1 chat payments are one-time only.
 */
export async function applyPaymentInbound(input: {
  ownerPubky: PubkyKey;
  senderPubky: PubkyKey;
  peerPubky: PubkyKey;
  rawJson: string;
  receivedAt: number;
  nowMs?: number;
}): Promise<PaymentInboundOutcome> {
  const nowMs = input.nowMs ?? input.receivedAt;
  const conversationId = buildDmConversationId(input.peerPubky);
  const kind = peekPaymentKind(input.rawJson);

  if (kind === PAYKIT_PRIVATE_PAYMENT_LIST_KIND) {
    return applyTipList(input, conversationId);
  }

  const eventId = peekEventId(input.rawJson);
  if (
    eventId &&
    (await StorageService.hasPaymentEvent(
      input.ownerPubky,
      conversationId,
      input.senderPubky,
      eventId,
    ))
  ) {
    return { action: 'ignored' };
  }

  if (kind === PAYKIT_PAYMENT_REQUEST_KIND) {
    return applyRequest(input, conversationId, nowMs);
  }
  if (kind === PAYKIT_PAYMENT_ACCEPTANCE_KIND) {
    return applyLifecycle(input, conversationId, nowMs, 'accept', 'sent');
  }
  if (kind === PAYKIT_PAYMENT_REJECTION_KIND) {
    return applyLifecycle(input, conversationId, nowMs, 'reject', 'sent');
  }
  if (kind === PAYKIT_PAYMENT_CANCELLATION_KIND) {
    return applyLifecycle(input, conversationId, nowMs, 'cancel', 'received');
  }
  if (kind === PAYKIT_PAYMENT_PROOF_KIND) {
    return applyProof(input, conversationId, nowMs);
  }
  return { action: 'rejected' };
}

async function applyTipList(
  input: {
    ownerPubky: PubkyKey;
    senderPubky: PubkyKey;
    peerPubky: PubkyKey;
    rawJson: string;
    receivedAt: number;
  },
  conversationId: string,
): Promise<PaymentInboundOutcome> {
  const envelope = decodePrivatePaymentListEnvelope(input.rawJson);
  if (!envelope) {
    await markSeen(
      input,
      conversationId,
      `tip:${input.receivedAt}`,
      PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
      null,
      false,
    );
    return { action: 'rejected' };
  }
  const endpoints = Object.entries(envelope.payment_endpoints).map(([identifier, payload]) =>
    validateTipEndpoint(identifier, payload),
  );
  await StorageService.replaceTipEndpoints(
    input.ownerPubky,
    input.senderPubky,
    endpoints,
    input.receivedAt,
  );
  await markSeen(
    input,
    conversationId,
    `list:${input.receivedAt}`,
    PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
    null,
    true,
  );
  return { action: 'applied', request: null };
}

async function applyRequest(
  input: {
    ownerPubky: PubkyKey;
    senderPubky: PubkyKey;
    peerPubky: PubkyKey;
    rawJson: string;
    receivedAt: number;
  },
  conversationId: string,
  nowMs: number,
): Promise<PaymentInboundOutcome> {
  const envelope = decodePaymentRequestEnvelope(input.rawJson);
  if (!envelope) {
    const eventId = peekEventId(input.rawJson);
    if (eventId) {
      await markSeen(
        input,
        conversationId,
        eventId,
        PAYKIT_PAYMENT_REQUEST_KIND,
        peekRequestId(input.rawJson),
        false,
      );
    }
    return { action: 'rejected' };
  }
  if (envelope.request.recurrence !== null) {
    await markSeen(
      input,
      conversationId,
      envelope.event_id,
      envelope.kind,
      envelope.payment_request_id,
      false,
    );
    return { action: 'rejected' };
  }

  const existing = await StorageService.getPaymentRequest(
    input.ownerPubky,
    input.senderPubky,
    envelope.payment_request_id,
  );
  if (existing) {
    await markSeen(
      input,
      conversationId,
      envelope.event_id,
      envelope.kind,
      envelope.payment_request_id,
      false,
    );
    return { action: 'ignored' };
  }

  if (!isSupportedV1PaymentAmount(envelope.request.amount)) {
    await markSeen(
      input,
      conversationId,
      envelope.event_id,
      envelope.kind,
      envelope.payment_request_id,
      false,
    );
    return { action: 'rejected' };
  }

  const expiresAt =
    envelope.request.proposal_expires_at === null
      ? null
      : rfc3339ZToUnixMs(envelope.request.proposal_expires_at);

  const record: PaymentRequestRecord = {
    ownerPubky: input.ownerPubky,
    peerPubky: input.senderPubky,
    direction: 'received',
    paymentRequestId: envelope.payment_request_id,
    eventId: envelope.event_id,
    amountValue: envelope.request.amount.value,
    amountAsset: envelope.request.amount.asset,
    paymentReference: envelope.request.payment_reference,
    endpointIds: envelope.request.accepted_payment_endpoint_identifiers,
    expiresAt,
    status: 'pending',
    createdAt: nowMs,
    updatedAt: nowMs,
    proofJson: null,
    reason: null,
    ...EMPTY_PAYMENT_RECORD_EXTRAS,
  };
  await StorageService.savePaymentRequest(record);
  await markSeen(
    input,
    conversationId,
    envelope.event_id,
    envelope.kind,
    envelope.payment_request_id,
    true,
  );
  return { action: 'applied', request: record };
}

async function applyLifecycle(
  input: {
    ownerPubky: PubkyKey;
    senderPubky: PubkyKey;
    peerPubky: PubkyKey;
    rawJson: string;
    receivedAt: number;
  },
  conversationId: string,
  nowMs: number,
  action: Exclude<PaymentAction, 'proof'>,
  requiredDirection: PaymentDirection,
): Promise<PaymentInboundOutcome> {
  const decoded =
    action === 'accept'
      ? decodePaymentAcceptanceEnvelope(input.rawJson)
      : action === 'reject'
        ? decodePaymentRejectionEnvelope(input.rawJson)
        : decodePaymentCancellationEnvelope(input.rawJson);
  if (!decoded) {
    const eventId = peekEventId(input.rawJson);
    if (eventId) {
      await markSeen(
        input,
        conversationId,
        eventId,
        peekPaymentKind(input.rawJson) ?? '',
        peekRequestId(input.rawJson),
        false,
      );
    }
    return { action: 'rejected' };
  }

  const row = await StorageService.getPaymentRequest(
    input.ownerPubky,
    input.senderPubky,
    decoded.payment_request_id,
  );
  if (!row || row.direction !== requiredDirection) {
    await markSeen(
      input,
      conversationId,
      decoded.event_id,
      decoded.kind,
      decoded.payment_request_id,
      false,
    );
    return { action: 'rejected' };
  }

  const expired = isProposalExpired(row.expiresAt, nowMs);
  if (!canTransition(row.status, action, expired)) {
    await markSeen(
      input,
      conversationId,
      decoded.event_id,
      decoded.kind,
      decoded.payment_request_id,
      false,
    );
    return { action: 'rejected' };
  }

  const nextStatus: PaymentStatus =
    action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled';
  const reason = 'reason' in decoded ? (decoded.reason ?? null) : null;
  const applied = await StorageService.compareAndSetPaymentRequest(
    input.ownerPubky,
    input.senderPubky,
    decoded.payment_request_id,
    expectedStatusesForAction(action),
    { status: nextStatus, reason },
  );
  await markSeen(
    input,
    conversationId,
    decoded.event_id,
    decoded.kind,
    decoded.payment_request_id,
    applied,
  );
  if (!applied) {
    return { action: 'ignored' };
  }
  const updated = await StorageService.getPaymentRequest(
    input.ownerPubky,
    input.senderPubky,
    decoded.payment_request_id,
  );
  return { action: 'applied', request: updated };
}

async function applyProof(
  input: {
    ownerPubky: PubkyKey;
    senderPubky: PubkyKey;
    peerPubky: PubkyKey;
    rawJson: string;
    receivedAt: number;
  },
  conversationId: string,
  nowMs: number,
): Promise<PaymentInboundOutcome> {
  const decoded = decodePaymentProofEnvelope(input.rawJson);
  if (!decoded) {
    const eventId = peekEventId(input.rawJson);
    if (eventId) {
      await markSeen(
        input,
        conversationId,
        eventId,
        PAYKIT_PAYMENT_PROOF_KIND,
        peekRequestId(input.rawJson),
        false,
      );
    }
    return { action: 'rejected' };
  }
  if (decoded.billing_period !== null) {
    await markSeen(
      input,
      conversationId,
      decoded.event_id,
      decoded.kind,
      decoded.payment_request_id,
      false,
    );
    return { action: 'rejected' };
  }

  const row = await StorageService.getPaymentRequest(
    input.ownerPubky,
    input.senderPubky,
    decoded.payment_request_id,
  );
  if (!row || row.direction !== 'sent') {
    await markSeen(
      input,
      conversationId,
      decoded.event_id,
      decoded.kind,
      decoded.payment_request_id,
      false,
    );
    return { action: 'rejected' };
  }
  if (decoded.payment_reference !== row.paymentReference) {
    await markSeen(
      input,
      conversationId,
      decoded.event_id,
      decoded.kind,
      decoded.payment_request_id,
      false,
    );
    return { action: 'rejected' };
  }
  if (!row.endpointIds.includes(decoded.payment_endpoint_identifier)) {
    await markSeen(
      input,
      conversationId,
      decoded.event_id,
      decoded.kind,
      decoded.payment_request_id,
      false,
    );
    return { action: 'rejected' };
  }

  const expired = isProposalExpired(row.expiresAt, nowMs);
  if (!canTransition(row.status, 'proof', expired)) {
    await markSeen(
      input,
      conversationId,
      decoded.event_id,
      decoded.kind,
      decoded.payment_request_id,
      false,
    );
    return { action: 'rejected' };
  }

  const preimage = extractBolt11Preimage(decoded.proof);
  let proofVerified: boolean | null = null;
  let rebindHash: string | undefined;
  let proofReason: string | undefined;
  if (preimage) {
    const h = await bolt11PreimagePaymentHash(preimage);
    if (h !== null) {
      const reused = await StorageService.hasVerifiedPaymentHash(
        input.ownerPubky,
        h,
        decoded.payment_request_id,
      );
      if (reused) {
        proofVerified = false;
      } else {
        const invoice = await StorageService.getOwnInvoiceHash(
          input.ownerPubky,
          decoded.payment_endpoint_identifier,
          h,
        );
        const bound = bindProofToRequest(row, h, invoice);
        proofVerified = bound.proofVerified;
        if (bound.rebindHash) rebindHash = bound.rebindHash;
        if (bound.proofReason) proofReason = bound.proofReason;
      }
    }
  }

  const nextStatus: PaymentStatus = proofVerified === true ? 'proof_received' : row.status;
  const applied = await StorageService.compareAndSetPaymentRequest(
    input.ownerPubky,
    input.senderPubky,
    decoded.payment_request_id,
    expectedStatusesForAction('proof'),
    {
      status: nextStatus,
      proofJson: JSON.stringify(decoded.proof),
      ...(proofVerified !== null ? { proofVerified } : {}),
      ...(rebindHash ? { displayedPaymentHash: rebindHash } : {}),
      ...(proofReason ? { reason: proofReason } : {}),
    },
  );
  await markSeen(
    input,
    conversationId,
    decoded.event_id,
    decoded.kind,
    decoded.payment_request_id,
    applied,
  );
  if (!applied) {
    return { action: 'ignored' };
  }
  const updated = await StorageService.getPaymentRequest(
    input.ownerPubky,
    input.senderPubky,
    decoded.payment_request_id,
  );
  return { action: 'applied', request: updated };
}

async function markSeen(
  input: { ownerPubky: PubkyKey; senderPubky: PubkyKey; receivedAt: number },
  conversationId: string,
  eventId: string,
  kind: string,
  paymentRequestId: string | null,
  applied: boolean,
): Promise<void> {
  await StorageService.savePaymentEvent({
    ownerPubky: input.ownerPubky,
    conversationId,
    senderPubky: input.senderPubky,
    eventId,
    kind,
    paymentRequestId,
    applied,
    receivedAt: input.receivedAt,
  });
}

function bindProofToRequest(
  row: PaymentRequestRecord,
  paymentHash: string,
  invoice: OwnInvoiceHashRecord | null,
): {
  proofVerified: boolean | null;
  rebindHash?: string;
  proofReason?: string;
} {
  if (!invoice) return { proofVerified: null };
  if (invoice.displayContext === 'tip') return { proofVerified: null };
  if (invoice.paymentRequestId !== null && invoice.paymentRequestId !== row.paymentRequestId) {
    return { proofVerified: null };
  }
  if (invoiceExpiredBeforeRequest(invoice.invoiceExpiresAt, row.createdAt)) {
    return { proofVerified: null };
  }

  const displayed = row.displayedPaymentHash;
  if (displayed !== null) {
    if (paymentHash !== displayed) return { proofVerified: null };
    return amountBindResult(invoice, row, null);
  }

  // recordFailed path: no displayed hash was recorded for this request.
  if (invoice.firstSeenAt < row.createdAt) return { proofVerified: null };
  return amountBindResult(invoice, row, paymentHash);
}

function amountBindResult(
  invoice: OwnInvoiceHashRecord,
  row: PaymentRequestRecord,
  rebindHash: string | null,
): {
  proofVerified: boolean | null;
  rebindHash?: string;
  proofReason?: string;
} {
  const relation = invoiceAmountRelation(invoice.invoiceAmountMsat, row.amountValue);
  if (relation === 'satisfies') {
    return rebindHash ? { proofVerified: true, rebindHash } : { proofVerified: true };
  }
  if (relation === 'mismatch') {
    return { proofVerified: null, proofReason: PROOF_REASON_AMOUNT_MISMATCH };
  }
  return { proofVerified: null };
}

function peekEventId(rawJson: string): string | null {
  try {
    const value = JSON.parse(rawJson) as { event_id?: unknown };
    return typeof value.event_id === 'string' ? value.event_id : null;
  } catch {
    return null;
  }
}

function peekRequestId(rawJson: string): string | null {
  try {
    const value = JSON.parse(rawJson) as { payment_request_id?: unknown };
    return typeof value.payment_request_id === 'string' ? value.payment_request_id : null;
  } catch {
    return null;
  }
}
