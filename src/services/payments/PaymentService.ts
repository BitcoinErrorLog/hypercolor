import { v4 as uuidv4 } from 'uuid';
import type { PubkyKey } from '../../types';
import {
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
  PaymentError,
  buildPaymentAcceptanceEnvelope,
  buildPaymentCancellationEnvelope,
  buildPaymentProofEnvelope,
  buildPaymentRejectionEnvelope,
  buildPaymentRequestEnvelope,
  buildPrivatePaymentListEnvelope,
  canTransition,
  isPositiveBtcAmount,
  isProposalExpired,
  isValidBolt11,
  isValidOnchainAddress,
  isValidPaymentEndpointIdentifier,
  paymentPreviewBody,
  satsToBtcDecimal,
  schemeForEndpointIdentifier,
  type PaymentRequestRecord,
  type PaymentStatus,
  type TipEndpointRecord,
} from '../../types/payment';
import { KeyStore } from '../KeyStore';
import { StorageService } from '../StorageService';
import { LinkService } from '../link/LinkService';

export type RequestPaymentAmount = number | { value: string; asset?: string };

export const PaymentService = {
  /**
   * Payee: send a one-time `paykit.payment_request` to `peer`.
   * `amount` is either satoshis (integer) or a canonical btc decimal `{ value }`.
   */
  async requestPayment(
    peer: PubkyKey,
    amount: RequestPaymentAmount,
    reference: string,
    endpointIds: readonly string[] = [ENDPOINT_LIGHTNING_BOLT11],
    expiresAtMs?: number | null,
  ): Promise<PaymentRequestRecord> {
    const owner = requireOwner();
    const amountValue = resolveAmountValue(amount);
    const eventId = uuidv4();
    const paymentRequestId = uuidv4();
    const sentAt = Date.now();
    const built = buildPaymentRequestEnvelope({
      eventId,
      paymentRequestId,
      amountValue,
      paymentReference: reference.trim(),
      endpointIds,
      ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
    });
    const record: PaymentRequestRecord = {
      ownerPubky: owner,
      peerPubky: peer,
      direction: 'sent',
      paymentRequestId,
      eventId,
      amountValue,
      amountAsset: 'btc',
      paymentReference: built.envelope.request.payment_reference,
      endpointIds: [...endpointIds],
      expiresAt: expiresAtMs ?? null,
      status: 'pending',
      createdAt: sentAt,
      updatedAt: sentAt,
      proofJson: null,
      reason: null,
    };
    await StorageService.savePaymentRequest(record);
    await StorageService.savePaymentEvent({
      ownerPubky: owner,
      conversationId: `dm:${peer}`,
      senderPubky: owner,
      eventId,
      kind: PAYKIT_PAYMENT_REQUEST_KIND,
      paymentRequestId,
      applied: true,
      receivedAt: sentAt,
    });
    await LinkService.sendPreparedMessage({
      peerPubky: peer,
      kind: PAYKIT_PAYMENT_REQUEST_KIND,
      eventId,
      rawJson: built.json,
      body: paymentPreviewBody(PAYKIT_PAYMENT_REQUEST_KIND),
      sentAt,
    });
    return record;
  },

  async acceptRequest(peer: PubkyKey, paymentRequestId: string): Promise<PaymentRequestRecord> {
    return localTransition(peer, paymentRequestId, 'accept');
  },

  async rejectRequest(
    peer: PubkyKey,
    paymentRequestId: string,
    reason?: string,
  ): Promise<PaymentRequestRecord> {
    return localTransition(peer, paymentRequestId, 'reject', reason);
  },

  async cancelRequest(
    peer: PubkyKey,
    paymentRequestId: string,
    reason?: string,
  ): Promise<PaymentRequestRecord> {
    return localTransition(peer, paymentRequestId, 'cancel', reason);
  },

  /**
   * Payer: after paying in an external wallet, send `paykit.payment_proof`.
   * `preimage` may be empty (manual attestation without a bolt11 preimage).
   */
  async submitProofManual(
    peer: PubkyKey,
    paymentRequestId: string,
    preimage?: string,
    endpointIdentifier: string = ENDPOINT_LIGHTNING_BOLT11,
  ): Promise<PaymentRequestRecord> {
    const owner = requireOwner();
    const row = await requireLocalRequest(owner, peer, paymentRequestId, 'received');
    const nowMs = Date.now();
    if (!canTransition(row.status, 'proof', isProposalExpired(row.expiresAt, nowMs))) {
      throw new PaymentError('state', 'payment request cannot receive proof in its current state');
    }
    if (!row.endpointIds.includes(endpointIdentifier)) {
      throw new PaymentError('validation', 'endpoint is not accepted by this request');
    }
    const eventId = uuidv4();
    const built = buildPaymentProofEnvelope({
      eventId,
      paymentRequestId,
      paymentReference: row.paymentReference,
      paymentEndpointIdentifier: endpointIdentifier,
      proofData: (preimage ?? '').trim(),
    });
    await StorageService.updatePaymentRequest(owner, peer, paymentRequestId, {
      status: 'proof_received',
      proofJson: JSON.stringify(built.envelope.proof),
    });
    await StorageService.savePaymentEvent({
      ownerPubky: owner,
      conversationId: `dm:${peer}`,
      senderPubky: owner,
      eventId,
      kind: PAYKIT_PAYMENT_PROOF_KIND,
      paymentRequestId,
      applied: true,
      receivedAt: nowMs,
    });
    await LinkService.sendPreparedMessage({
      peerPubky: peer,
      kind: PAYKIT_PAYMENT_PROOF_KIND,
      eventId,
      rawJson: built.json,
      body: paymentPreviewBody(PAYKIT_PAYMENT_PROOF_KIND),
      sentAt: nowMs,
    });
    const updated = await StorageService.getPaymentRequest(owner, peer, paymentRequestId);
    if (!updated) throw new PaymentError('not-found', 'payment request missing after proof');
    return updated;
  },

  async setMyTipEndpoints(
    endpoints: readonly { identifier: string; payload: string }[],
  ): Promise<TipEndpointRecord[]> {
    const owner = requireOwner();
    const cleaned = validateLocalTipEndpoints(endpoints);
    await StorageService.replaceTipEndpoints(owner, owner, cleaned, Date.now());
    return StorageService.listTipEndpoints(owner, owner);
  },

  async getMyTipEndpoints(): Promise<TipEndpointRecord[]> {
    const owner = requireOwner();
    return StorageService.listTipEndpoints(owner, owner);
  },

  async getPeerTipEndpoints(peer: PubkyKey): Promise<TipEndpointRecord[]> {
    const owner = requireOwner();
    return StorageService.listTipEndpoints(owner, peer);
  },

  async sendTipList(peer: PubkyKey): Promise<void> {
    const owner = requireOwner();
    const mine = await StorageService.listTipEndpoints(owner, owner);
    const map: Record<string, string> = {};
    for (const row of mine) {
      map[row.identifier] = row.payload;
    }
    const built = buildPrivatePaymentListEnvelope({ paymentEndpoints: map });
    const eventId = uuidv4();
    const sentAt = Date.now();
    await StorageService.savePaymentEvent({
      ownerPubky: owner,
      conversationId: `dm:${peer}`,
      senderPubky: owner,
      eventId,
      kind: PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
      paymentRequestId: null,
      applied: true,
      receivedAt: sentAt,
    });
    await LinkService.sendPreparedMessage({
      peerPubky: peer,
      kind: PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
      eventId,
      rawJson: built.json,
      body: paymentPreviewBody(PAYKIT_PRIVATE_PAYMENT_LIST_KIND),
      sentAt,
    });
  },

  async listRequestsForPeer(peer: PubkyKey): Promise<PaymentRequestRecord[]> {
    const owner = requireOwner();
    return StorageService.listPaymentRequestsForPeer(owner, peer);
  },
};

async function localTransition(
  peer: PubkyKey,
  paymentRequestId: string,
  action: 'accept' | 'reject' | 'cancel',
  reason?: string,
): Promise<PaymentRequestRecord> {
  const owner = requireOwner();
  const requiredDirection = action === 'cancel' ? 'sent' : 'received';
  const row = await requireLocalRequest(owner, peer, paymentRequestId, requiredDirection);
  const nowMs = Date.now();
  if (!canTransition(row.status, action, isProposalExpired(row.expiresAt, nowMs))) {
    if (action === 'accept' && isProposalExpired(row.expiresAt, nowMs)) {
      throw new PaymentError('expired', 'payment request has expired');
    }
    throw new PaymentError('state', 'payment request cannot be transitioned');
  }

  const eventId = uuidv4();
  const nextStatus: PaymentStatus =
    action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled';
  const trimmedReason = reason === undefined ? undefined : reason.trim();

  const built =
    action === 'accept'
      ? buildPaymentAcceptanceEnvelope({ eventId, paymentRequestId })
      : action === 'reject'
        ? buildPaymentRejectionEnvelope({
            eventId,
            paymentRequestId,
            ...(trimmedReason ? { reason: trimmedReason } : {}),
          })
        : buildPaymentCancellationEnvelope({
            eventId,
            paymentRequestId,
            ...(trimmedReason ? { reason: trimmedReason } : {}),
          });

  await StorageService.updatePaymentRequest(owner, peer, paymentRequestId, {
    status: nextStatus,
    reason: trimmedReason ?? null,
  });
  await StorageService.savePaymentEvent({
    ownerPubky: owner,
    conversationId: `dm:${peer}`,
    senderPubky: owner,
    eventId,
    kind: built.envelope.kind,
    paymentRequestId,
    applied: true,
    receivedAt: nowMs,
  });
  await LinkService.sendPreparedMessage({
    peerPubky: peer,
    kind: built.envelope.kind,
    eventId,
    rawJson: built.json,
    body: paymentPreviewBody(built.envelope.kind),
    sentAt: nowMs,
  });
  const updated = await StorageService.getPaymentRequest(owner, peer, paymentRequestId);
  if (!updated) throw new PaymentError('not-found', 'payment request missing after transition');
  return updated;
}

async function requireLocalRequest(
  owner: PubkyKey,
  peer: PubkyKey,
  paymentRequestId: string,
  direction: 'sent' | 'received',
): Promise<PaymentRequestRecord> {
  const row = await StorageService.getPaymentRequest(owner, peer, paymentRequestId);
  if (!row) throw new PaymentError('not-found', 'payment request not found');
  if (row.direction !== direction) {
    throw new PaymentError('unauthorized', 'not authorized for this payment action');
  }
  return row;
}

function resolveAmountValue(amount: RequestPaymentAmount): string {
  if (typeof amount === 'number') {
    return satsToBtcDecimal(amount);
  }
  if (amount.asset !== undefined && amount.asset !== 'btc') {
    throw new PaymentError('validation', 'only btc amounts are supported in v1');
  }
  const value = amount.value.trim();
  if (!isPositiveBtcAmount(value)) {
    throw new PaymentError('validation', 'amount must be a positive canonical btc decimal');
  }
  return value;
}

function validateLocalTipEndpoints(
  endpoints: readonly { identifier: string; payload: string }[],
): { identifier: string; payload: string }[] {
  const cleaned: { identifier: string; payload: string }[] = [];
  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    const identifier = endpoint.identifier.trim();
    const payload = endpoint.payload.trim();
    if (!isValidPaymentEndpointIdentifier(identifier)) {
      throw new PaymentError('validation', 'invalid payment endpoint identifier');
    }
    if (seen.has(identifier)) {
      throw new PaymentError('validation', 'duplicate payment endpoint identifier');
    }
    seen.add(identifier);
    const scheme = schemeForEndpointIdentifier(identifier);
    if (scheme === 'lightning') {
      if (!isValidBolt11(payload)) {
        throw new PaymentError('validation', 'lightning endpoint payload is not a valid bolt11');
      }
    } else if (scheme === 'bitcoin') {
      if (!isValidOnchainAddress(payload)) {
        throw new PaymentError('validation', 'bitcoin endpoint payload is not a valid address');
      }
    } else {
      throw new PaymentError('validation', 'unsupported payment endpoint identifier');
    }
    cleaned.push({ identifier, payload });
  }
  return cleaned;
}

function requireOwner(): PubkyKey {
  const owner = KeyStore.getPubky();
  if (!owner) throw new PaymentError('validation', 'No local pubky');
  return owner;
}

export const DEFAULT_TIP_IDENTIFIERS = {
  lightning: ENDPOINT_LIGHTNING_BOLT11,
  onchain: ENDPOINT_BITCOIN_P2TR,
} as const;
