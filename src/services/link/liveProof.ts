import { v4 as uuidv4 } from 'uuid';
import { type PaykitLinkNativeApi } from './PaykitLinkNative';
import {
  CHAT_MESSAGE_KIND,
  LINK_RECEIVER_PATH,
  buildChatMessageEnvelope,
  decodeLinkEnvelope,
} from '../../types/link';
import {
  ENDPOINT_LIGHTNING_BOLT11,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PAYMENT_REJECTION_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
  buildPaymentAcceptanceEnvelope,
  buildPaymentProofEnvelope,
  buildPaymentRejectionEnvelope,
  buildPaymentRequestEnvelope,
  decodePaymentEnvelope,
  expectedStatusesForAction,
  type PaymentStatus,
} from '../../types/payment';
import { StorageService } from '../StorageService';
import { applyPaymentInbound } from '../payments/applyPaymentInbound';
import {
  cleanupNativeParties,
  createLiveProofRecorder,
  emptyParty,
  generatePartySecrets,
  requirePartyField,
  requireText,
  resolveClock,
  signupParty,
  type LiveProofConfig,
  type LiveProofDeps,
  type LiveProofReport,
  type ProofParty,
} from './liveProofShared';

export type {
  LiveProofConfig,
  LiveProofDeps,
  LiveProofReport,
  LiveProofStep,
  NamedLiveProofConfig,
  NamedLiveProofRow,
  ThreePartyLiveProofConfig,
} from './liveProofShared';
export {
  parseLiveProofTokenList,
  parseLiveProofTokens,
  parseNamedLiveProofRows,
  redactLiveProofForLog,
} from './liveProofShared';

/**
 * Two-party Encrypted-Link proof against the real native module.
 * Never touches {@link LinkService}, KeyStore, or SQLite for chat send/receive.
 * Optional diagnostic only — it is not the product proof (see P0).
 * Never throws — failures are recorded on the report.
 */
export async function runLinkLiveProof(
  config: LiveProofConfig,
  deps: LiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, sleep, randomBytes, handshakeTimeoutMs, receiveTimeoutMs, pollIntervalMs } =
    resolveClock(deps);

  const partyA = emptyParty('A');
  const partyB = emptyParty('B');
  const redactSecrets = [config.signupTokenA, config.signupTokenB];
  const { record, failed, report, steps } = createLiveProofRecorder(now, redactSecrets);
  void steps;

  try {
    if (
      !(await record('native-available', async () => {
        if (!native.isAvailable()) {
          throw new Error('PaykitLinkModule native module is not available');
        }
        return 'available';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('validate-config', async () => {
        requireText(config.homeserverPubky, 'homeserverPubky');
        requireText(config.signupTokenA, 'signupTokenA');
        requireText(config.signupTokenB, 'signupTokenB');
        return 'ok';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('generate-identities', async () =>
        generatePartySecrets([partyA, partyB], randomBytes, redactSecrets),
      ))
    ) {
      return failed();
    }

    if (!(await signupParty(record, native, config.homeserverPubky, partyA, config.signupTokenA))) {
      return failed();
    }
    if (!(await signupParty(record, native, config.homeserverPubky, partyB, config.signupTokenB))) {
      return failed();
    }
    if (!(await provisionNativeParty(record, native, partyA))) return failed();
    if (!(await provisionNativeParty(record, native, partyB))) return failed();

    if (
      !(await record('read-marker-b', async () => {
        const marker = await native.getReceiverMarker(
          requirePartyField(partyB.pubky, 'B.pubky'),
          LINK_RECEIVER_PATH,
        );
        if (marker === null) throw new Error('B receiver marker not published');
        if (marker.noisePublicKey !== partyB.noisePublicKey) {
          throw new Error('B marker noise key does not match provisioned receiver');
        }
        return marker.noisePublicKey;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('read-marker-a', async () => {
        const marker = await native.getReceiverMarker(
          requirePartyField(partyA.pubky, 'A.pubky'),
          LINK_RECEIVER_PATH,
        );
        if (marker === null) throw new Error('A receiver marker not published');
        if (marker.noisePublicKey !== partyA.noisePublicKey) {
          throw new Error('A marker noise key does not match provisioned receiver');
        }
        return marker.noisePublicKey;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('initiate-a', async () => {
        const initiated = await native.initiateLink(
          requirePartyField(partyA.sessionAlias, 'A.sessionAlias'),
          requirePartyField(partyA.receiverAlias, 'A.receiverAlias'),
          requirePartyField(partyB.pubky, 'B.pubky'),
          requirePartyField(partyB.noisePublicKey, 'B.noisePublicKey'),
          LINK_RECEIVER_PATH,
          LINK_RECEIVER_PATH,
        );
        partyA.handshakeLinkId = initiated.linkId;
        return initiated.linkId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('establish', async () => {
        return establishBoth(
          native,
          partyA,
          partyB,
          now,
          sleep,
          handshakeTimeoutMs,
          pollIntervalMs,
        );
      }))
    ) {
      return failed();
    }

    const outboundA = buildChatMessageEnvelope({
      eventId: uuidv4(),
      sentAt: now(),
      body: 'liveproof-a',
    });

    if (
      !(await record('send-a', async () => {
        await native.sendPrivateMessageJson(
          requirePartyField(partyA.establishedLinkId, 'A.establishedLinkId'),
          outboundA.json,
        );
        return outboundA.envelope.event_id;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('receive-b', async () => {
        return receiveExpected(
          native,
          partyB,
          outboundA.envelope.event_id,
          outboundA.envelope.body,
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
        );
      }))
    ) {
      return failed();
    }

    const outboundB = buildChatMessageEnvelope({
      eventId: uuidv4(),
      sentAt: now(),
      body: 'liveproof-b-reply',
    });

    if (
      !(await record('send-b', async () => {
        await native.sendPrivateMessageJson(
          requirePartyField(partyB.establishedLinkId, 'B.establishedLinkId'),
          outboundB.json,
        );
        return outboundB.envelope.event_id;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('receive-a', async () => {
        return receiveExpected(
          native,
          partyA,
          outboundB.envelope.event_id,
          outboundB.envelope.body,
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
        );
      }))
    ) {
      return failed();
    }

    const requestOne = buildPaymentRequestEnvelope({
      eventId: uuidv4(),
      paymentRequestId: uuidv4(),
      amountValue: '0.001',
      paymentReference: 'liveproof-pay-1',
      endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    });
    const pubkyA = requirePartyField(partyA.pubky, 'A.pubky');
    const pubkyB = requirePartyField(partyB.pubky, 'B.pubky');

    if (
      !(await record('send-payment-request-a', async () => {
        await persistOutboundRequest(pubkyA, pubkyB, requestOne.envelope, now());
        await native.sendPrivateMessageJson(
          requirePartyField(partyA.establishedLinkId, 'A.establishedLinkId'),
          requestOne.json,
        );
        return requestOne.envelope.payment_request_id;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('receive-payment-request-b', async () => {
        const raw = await receivePaymentJson(
          native,
          partyB,
          PAYKIT_PAYMENT_REQUEST_KIND,
          requestOne.envelope.event_id,
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
        );
        const applied = await applyPaymentInbound({
          ownerPubky: pubkyB,
          senderPubky: pubkyA,
          peerPubky: pubkyA,
          rawJson: raw,
          receivedAt: now(),
        });
        await assertRequestStatus(pubkyB, pubkyA, requestOne.envelope.payment_request_id, 'pending');
        if (applied.action !== 'applied') throw new Error(`B apply request: ${applied.action}`);
        return `pending ${requestOne.envelope.payment_request_id}`;
      }))
    ) {
      return failed();
    }

    const acceptance = buildPaymentAcceptanceEnvelope({
      eventId: uuidv4(),
      paymentRequestId: requestOne.envelope.payment_request_id,
    });

    if (
      !(await record('send-payment-acceptance-b', async () => {
        await StorageService.compareAndSetPaymentRequest(
          pubkyB,
          pubkyA,
          requestOne.envelope.payment_request_id,
          expectedStatusesForAction('accept'),
          { status: 'accepted' },
        );
        await native.sendPrivateMessageJson(
          requirePartyField(partyB.establishedLinkId, 'B.establishedLinkId'),
          acceptance.json,
        );
        return acceptance.envelope.event_id;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('receive-payment-acceptance-a', async () => {
        const raw = await receivePaymentJson(
          native,
          partyA,
          PAYKIT_PAYMENT_ACCEPTANCE_KIND,
          acceptance.envelope.event_id,
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
        );
        const applied = await applyPaymentInbound({
          ownerPubky: pubkyA,
          senderPubky: pubkyB,
          peerPubky: pubkyB,
          rawJson: raw,
          receivedAt: now(),
        });
        await assertRequestStatus(
          pubkyA,
          pubkyB,
          requestOne.envelope.payment_request_id,
          'accepted',
        );
        if (applied.action !== 'applied') throw new Error(`A apply acceptance: ${applied.action}`);
        return 'accepted';
      }))
    ) {
      return failed();
    }

    const proof = buildPaymentProofEnvelope({
      eventId: uuidv4(),
      paymentRequestId: requestOne.envelope.payment_request_id,
      paymentReference: requestOne.envelope.request.payment_reference,
      paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      proofData: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    });

    if (
      !(await record('send-payment-proof-b', async () => {
        await StorageService.compareAndSetPaymentRequest(
          pubkyB,
          pubkyA,
          requestOne.envelope.payment_request_id,
          expectedStatusesForAction('proof'),
          { status: 'proof_received', proofJson: JSON.stringify(proof.envelope.proof) },
        );
        await native.sendPrivateMessageJson(
          requirePartyField(partyB.establishedLinkId, 'B.establishedLinkId'),
          proof.json,
        );
        return proof.envelope.event_id;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('receive-payment-proof-a', async () => {
        const raw = await receivePaymentJson(
          native,
          partyA,
          PAYKIT_PAYMENT_PROOF_KIND,
          proof.envelope.event_id,
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
        );
        const applied = await applyPaymentInbound({
          ownerPubky: pubkyA,
          senderPubky: pubkyB,
          peerPubky: pubkyB,
          rawJson: raw,
          receivedAt: now(),
        });
        await assertRequestStatus(
          pubkyA,
          pubkyB,
          requestOne.envelope.payment_request_id,
          'proof_received',
        );
        if (applied.action !== 'applied') throw new Error(`A apply proof: ${applied.action}`);
        return 'proof_received (dummy hex — does not close P4)';
      }))
    ) {
      return failed();
    }

    const requestTwo = buildPaymentRequestEnvelope({
      eventId: uuidv4(),
      paymentRequestId: uuidv4(),
      amountValue: '0.002',
      paymentReference: 'liveproof-pay-2',
      endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    });

    if (
      !(await record('send-payment-request-2-a', async () => {
        await persistOutboundRequest(pubkyA, pubkyB, requestTwo.envelope, now());
        await native.sendPrivateMessageJson(
          requirePartyField(partyA.establishedLinkId, 'A.establishedLinkId'),
          requestTwo.json,
        );
        return requestTwo.envelope.payment_request_id;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('receive-payment-request-2-b', async () => {
        const raw = await receivePaymentJson(
          native,
          partyB,
          PAYKIT_PAYMENT_REQUEST_KIND,
          requestTwo.envelope.event_id,
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
        );
        const applied = await applyPaymentInbound({
          ownerPubky: pubkyB,
          senderPubky: pubkyA,
          peerPubky: pubkyA,
          rawJson: raw,
          receivedAt: now(),
        });
        await assertRequestStatus(pubkyB, pubkyA, requestTwo.envelope.payment_request_id, 'pending');
        if (applied.action !== 'applied') throw new Error(`B apply request 2: ${applied.action}`);
        return 'pending';
      }))
    ) {
      return failed();
    }

    const rejection = buildPaymentRejectionEnvelope({
      eventId: uuidv4(),
      paymentRequestId: requestTwo.envelope.payment_request_id,
      reason: 'liveproof-reject',
    });

    if (
      !(await record('send-payment-rejection-b', async () => {
        await StorageService.compareAndSetPaymentRequest(
          pubkyB,
          pubkyA,
          requestTwo.envelope.payment_request_id,
          expectedStatusesForAction('reject'),
          { status: 'rejected', reason: 'liveproof-reject' },
        );
        await native.sendPrivateMessageJson(
          requirePartyField(partyB.establishedLinkId, 'B.establishedLinkId'),
          rejection.json,
        );
        return rejection.envelope.event_id;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('receive-payment-rejection-a', async () => {
        const raw = await receivePaymentJson(
          native,
          partyA,
          PAYKIT_PAYMENT_REJECTION_KIND,
          rejection.envelope.event_id,
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
        );
        const applied = await applyPaymentInbound({
          ownerPubky: pubkyA,
          senderPubky: pubkyB,
          peerPubky: pubkyB,
          rawJson: raw,
          receivedAt: now(),
        });
        await assertRequestStatus(
          pubkyA,
          pubkyB,
          requestTwo.envelope.payment_request_id,
          'rejected',
        );
        await assertRequestStatus(
          pubkyA,
          pubkyB,
          requestOne.envelope.payment_request_id,
          'proof_received',
        );
        if (applied.action !== 'applied') throw new Error(`A apply rejection: ${applied.action}`);
        return 'rejected';
      }))
    ) {
      return failed();
    }
  } finally {
    await cleanupNativeParties(record, native, [partyA, partyB]);
  }

  return report();
}

async function persistOutboundRequest(
  ownerPubky: string,
  peerPubky: string,
  envelope: {
    event_id: string;
    payment_request_id: string;
    request: {
      amount: { value: string; asset: string };
      payment_reference: string;
      accepted_payment_endpoint_identifiers: string[];
      proposal_expires_at: string | null;
    };
  },
  nowMs: number,
): Promise<void> {
  await StorageService.savePaymentRequest({
    ownerPubky,
    peerPubky,
    direction: 'sent',
    paymentRequestId: envelope.payment_request_id,
    eventId: envelope.event_id,
    amountValue: envelope.request.amount.value,
    amountAsset: envelope.request.amount.asset,
    paymentReference: envelope.request.payment_reference,
    endpointIds: envelope.request.accepted_payment_endpoint_identifiers,
    expiresAt: null,
    status: 'pending',
    createdAt: nowMs,
    updatedAt: nowMs,
    proofJson: null,
    reason: null,
    pendingEventId: null,
    displayedPaymentHash: null,
    proofVerified: null,
  });
  await StorageService.savePaymentEvent({
    ownerPubky,
    conversationId: `dm:${peerPubky}`,
    senderPubky: ownerPubky,
    eventId: envelope.event_id,
    kind: PAYKIT_PAYMENT_REQUEST_KIND,
    paymentRequestId: envelope.payment_request_id,
    applied: true,
    receivedAt: nowMs,
  });
}

async function assertRequestStatus(
  ownerPubky: string,
  peerPubky: string,
  paymentRequestId: string,
  expected: PaymentStatus,
): Promise<void> {
  const row = await StorageService.getPaymentRequest(ownerPubky, peerPubky, paymentRequestId);
  if (!row) throw new Error(`payment request ${paymentRequestId} missing in DB`);
  if (row.status !== expected) {
    throw new Error(`expected status ${expected}, got ${row.status}`);
  }
}

async function receivePaymentJson(
  native: PaykitLinkNativeApi,
  party: ProofParty,
  kind: string,
  eventId: string,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<string> {
  const deadline = now() + timeoutMs;
  const seen: string[] = [];
  while (now() < deadline) {
    const received = await native.receivePrivateMessages(
      requirePartyField(party.establishedLinkId, `${party.label}.establishedLinkId`),
    );
    for (const item of received.messages) {
      const decoded = decodePaymentEnvelope(item.rawJson);
      if (decoded === null || !('event_id' in decoded)) {
        seen.push(item.kind ?? 'undecodable');
        continue;
      }
      seen.push(`${decoded.kind}:${decoded.event_id}`);
      if (decoded.kind !== kind || decoded.event_id !== eventId) continue;
      return item.rawJson;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `did not receive ${kind} ${eventId} within ${timeoutMs}ms; seen=[${seen.join(', ')}]`,
  );
}

async function provisionNativeParty(
  record: (step: string, body: () => Promise<string>) => Promise<boolean>,
  native: PaykitLinkNativeApi,
  party: ProofParty,
): Promise<boolean> {
  return record(`provision-${party.label.toLowerCase()}`, async () => {
    const generated = await native.generateReceiverKey();
    party.receiverAlias = generated.receiverAlias;
    party.noisePublicKey = generated.noisePublicKey;
    await native.publishReceiverMarker(
      requirePartyField(party.sessionAlias, `${party.label}.sessionAlias`),
      generated.receiverAlias,
      LINK_RECEIVER_PATH,
    );
    return `${LINK_RECEIVER_PATH} ${generated.noisePublicKey}`;
  });
}

async function establishBoth(
  native: PaykitLinkNativeApi,
  partyA: ProofParty,
  partyB: ProofParty,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<string> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (partyA.establishedLinkId === null && partyA.handshakeLinkId !== null) {
      const advanced = await native.advanceHandshake(partyA.handshakeLinkId);
      if (advanced.status === 'established') {
        partyA.establishedLinkId = partyA.handshakeLinkId;
      }
    }

    if (partyB.establishedLinkId === null) {
      if (partyB.handshakeLinkId !== null) {
        const advanced = await native.advanceHandshake(partyB.handshakeLinkId);
        if (advanced.status === 'established') {
          partyB.establishedLinkId = partyB.handshakeLinkId;
        }
      } else {
        const probed = await native.probeInboundLink(
          requirePartyField(partyB.sessionAlias, 'B.sessionAlias'),
          requirePartyField(partyB.receiverAlias, 'B.receiverAlias'),
          requirePartyField(partyA.pubky, 'A.pubky'),
          requirePartyField(partyA.noisePublicKey, 'A.noisePublicKey'),
          LINK_RECEIVER_PATH,
          LINK_RECEIVER_PATH,
        );
        if (probed.result === 'pending') {
          partyB.handshakeLinkId = probed.linkId;
        } else if (probed.result === 'established') {
          partyB.establishedLinkId = probed.linkId;
        }
      }
    }

    if (partyA.establishedLinkId !== null && partyB.establishedLinkId !== null) {
      return `A=${partyA.establishedLinkId} B=${partyB.establishedLinkId}`;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `handshake timed out after ${timeoutMs}ms (A=${partyA.establishedLinkId ?? 'pending'}, B=${partyB.establishedLinkId ?? 'pending'})`,
  );
}

async function receiveExpected(
  native: PaykitLinkNativeApi,
  party: ProofParty,
  eventId: string,
  body: string,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<string> {
  const deadline = now() + timeoutMs;
  const seen: string[] = [];
  while (now() < deadline) {
    const received = await native.receivePrivateMessages(
      requirePartyField(party.establishedLinkId, `${party.label}.establishedLinkId`),
    );
    for (const item of received.messages) {
      const decoded = decodeLinkEnvelope(item.rawJson);
      if (decoded === null) {
        seen.push(item.kind ?? 'undecodable');
        continue;
      }
      seen.push(`${decoded.kind}:${decoded.event_id}`);
      if (decoded.kind !== CHAT_MESSAGE_KIND) continue;
      if (decoded.event_id !== eventId) continue;
      if (decoded.body !== body) {
        throw new Error(`body mismatch: expected "${body}", got "${decoded.body}"`);
      }
      return `${decoded.kind} ${decoded.event_id}`;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `did not receive ${CHAT_MESSAGE_KIND} ${eventId} within ${timeoutMs}ms; seen=[${seen.join(', ')}]`,
  );
}

