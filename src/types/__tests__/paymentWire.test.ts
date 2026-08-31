import { LINK_MESSAGE_MAX_BYTES } from '../link';
import { isKnownInboundChatKind } from '../../services/link/inboundEnvelope';
import {
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  PAYKIT_PAYMENT_CANCELLATION_KIND,
  PAYKIT_PAYMENT_KINDS,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PAYMENT_REJECTION_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
  PaymentError,
  buildPaymentAcceptanceEnvelope,
  buildPaymentCancellationEnvelope,
  buildPaymentProofEnvelope,
  buildPaymentRejectionEnvelope,
  buildPaymentRequestEnvelope,
  buildPrivatePaymentListEnvelope,
  decodePaymentAcceptanceEnvelope,
  decodePaymentCancellationEnvelope,
  decodePaymentProofEnvelope,
  decodePaymentRejectionEnvelope,
  decodePaymentRequestEnvelope,
  decodePrivatePaymentListEnvelope,
  canTransition,
  displayPaymentStatus,
  decodePaymentEnvelope,
  isCanonicalAmountValue,
  isCanonicalThreePartEndpointId,
  isLenientAmountValue,
  isPositiveBtcAmount,
  isValidBolt11,
  isValidOnchainAddress,
  isValidPaymentEndpointIdentifier,
  isValidPaymentReference,
  normalizeAmountValue,
  satsToBtcDecimal,
} from '../payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_AMOUNTLESS,
  MAINNET_P2PKH,
  MAINNET_P2TR,
  MAINNET_P2WPKH,
  TESTNET_BOLT11,
  corruptBolt11Checksum,
} from '../../services/payments/__tests__/bolt11Vectors';

const EVENT_ID = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d101';
const REQUEST_ID = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
const ACCEPT_EVENT = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d102';
const REJECT_EVENT = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d103';
const CANCEL_EVENT = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d104';
const PROOF_EVENT = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d105';

const OFFICIAL_REQUEST = {
  version: 1,
  kind: PAYKIT_PAYMENT_REQUEST_KIND,
  event_id: EVENT_ID,
  payment_request_id: REQUEST_ID,
  request: {
    amount: { value: '0.001', asset: 'btc' },
    payment_reference: 'invoice-2026-0001',
    proposal_expires_at: null,
    recurrence: null,
    accepted_payment_endpoint_identifiers: [ENDPOINT_LIGHTNING_BOLT11],
    metadata: {},
  },
};

const OFFICIAL_ACCEPTANCE = {
  version: 1,
  kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  event_id: ACCEPT_EVENT,
  payment_request_id: REQUEST_ID,
};

const OFFICIAL_REJECTION = {
  version: 1,
  kind: PAYKIT_PAYMENT_REJECTION_KIND,
  event_id: REJECT_EVENT,
  payment_request_id: REQUEST_ID,
  reason: 'declined',
};

const OFFICIAL_CANCELLATION = {
  version: 1,
  kind: PAYKIT_PAYMENT_CANCELLATION_KIND,
  event_id: CANCEL_EVENT,
  payment_request_id: REQUEST_ID,
  reason: 'changed-mind',
};

const OFFICIAL_PROOF = {
  version: 1,
  kind: PAYKIT_PAYMENT_PROOF_KIND,
  event_id: PROOF_EVENT,
  payment_request_id: REQUEST_ID,
  payment_reference: 'invoice-2026-0001',
  billing_period: null,
  payment_endpoint_identifier: ENDPOINT_LIGHTNING_BOLT11,
  proof: { type: 'bitcoin-bolt11-preimage', data: 'aabbcc' },
};

const OFFICIAL_LIST = {
  version: 1,
  kind: PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
  payment_endpoints: {
    [ENDPOINT_LIGHTNING_BOLT11]: MAINNET_BOLT11_20U,
    [ENDPOINT_BITCOIN_P2TR]: MAINNET_P2TR,
  },
};

describe('payment wire contracts', () => {
  it('round-trips official payment_request field-exactly', () => {
    const json = JSON.stringify(OFFICIAL_REQUEST);
    const decoded = decodePaymentRequestEnvelope(json);
    expect(decoded).toEqual(OFFICIAL_REQUEST);
    const rebuilt = buildPaymentRequestEnvelope({
      eventId: EVENT_ID,
      paymentRequestId: REQUEST_ID,
      amountValue: '0.001',
      paymentReference: 'invoice-2026-0001',
      endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
    });
    expect(JSON.parse(rebuilt.json)).toEqual(OFFICIAL_REQUEST);
    expect(rebuilt.byteSize).toBeLessThanOrEqual(LINK_MESSAGE_MAX_BYTES);
  });

  it('round-trips acceptance, rejection, cancellation, proof, and tip list', () => {
    expect(decodePaymentAcceptanceEnvelope(JSON.stringify(OFFICIAL_ACCEPTANCE))).toEqual(
      OFFICIAL_ACCEPTANCE,
    );
    expect(
      JSON.parse(
        buildPaymentAcceptanceEnvelope({
          eventId: ACCEPT_EVENT,
          paymentRequestId: REQUEST_ID,
        }).json,
      ),
    ).toEqual(OFFICIAL_ACCEPTANCE);

    expect(decodePaymentRejectionEnvelope(JSON.stringify(OFFICIAL_REJECTION))).toEqual(
      OFFICIAL_REJECTION,
    );
    expect(
      JSON.parse(
        buildPaymentRejectionEnvelope({
          eventId: REJECT_EVENT,
          paymentRequestId: REQUEST_ID,
          reason: 'declined',
        }).json,
      ),
    ).toEqual(OFFICIAL_REJECTION);

    expect(decodePaymentCancellationEnvelope(JSON.stringify(OFFICIAL_CANCELLATION))).toEqual(
      OFFICIAL_CANCELLATION,
    );
    expect(
      JSON.parse(
        buildPaymentCancellationEnvelope({
          eventId: CANCEL_EVENT,
          paymentRequestId: REQUEST_ID,
          reason: 'changed-mind',
        }).json,
      ),
    ).toEqual(OFFICIAL_CANCELLATION);

    expect(decodePaymentProofEnvelope(JSON.stringify(OFFICIAL_PROOF))).toEqual(OFFICIAL_PROOF);
    expect(
      JSON.parse(
        buildPaymentProofEnvelope({
          eventId: PROOF_EVENT,
          paymentRequestId: REQUEST_ID,
          paymentReference: 'invoice-2026-0001',
          paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
          proofData: 'aabbcc',
        }).json,
      ),
    ).toEqual(OFFICIAL_PROOF);

    const list = decodePrivatePaymentListEnvelope(JSON.stringify(OFFICIAL_LIST));
    expect(list).toEqual(OFFICIAL_LIST);
    expect(
      JSON.parse(
        buildPrivatePaymentListEnvelope({ paymentEndpoints: OFFICIAL_LIST.payment_endpoints }).json,
      ),
    ).toEqual(OFFICIAL_LIST);
  });

  it('omits reason on rejection/cancellation when absent and rejects null reason', () => {
    const noReason = buildPaymentRejectionEnvelope({
      eventId: REJECT_EVENT,
      paymentRequestId: REQUEST_ID,
    });
    expect(JSON.parse(noReason.json)).toEqual({
      version: 1,
      kind: PAYKIT_PAYMENT_REJECTION_KIND,
      event_id: REJECT_EVENT,
      payment_request_id: REQUEST_ID,
    });
    expect(
      decodePaymentRejectionEnvelope(JSON.stringify({ ...OFFICIAL_REJECTION, reason: null })),
    ).toBeNull();
    expect(
      decodePaymentCancellationEnvelope(JSON.stringify({ ...OFFICIAL_CANCELLATION, reason: null })),
    ).toBeNull();
  });

  it('denies unknown fields on known kinds', () => {
    expect(
      decodePaymentRequestEnvelope(JSON.stringify({ ...OFFICIAL_REQUEST, extra: true })),
    ).toBeNull();
    expect(
      decodePaymentAcceptanceEnvelope(JSON.stringify({ ...OFFICIAL_ACCEPTANCE, reason: 'x' })),
    ).toBeNull();
    expect(
      decodePaymentProofEnvelope(JSON.stringify({ ...OFFICIAL_PROOF, ignored: 1 })),
    ).toBeNull();
    expect(
      decodePrivatePaymentListEnvelope(JSON.stringify({ ...OFFICIAL_LIST, reference: 'x' })),
    ).toBeNull();
  });

  it('requires proposal_expires_at and recurrence keys, billing_period on proof', () => {
    const missing = { ...OFFICIAL_REQUEST, request: { ...OFFICIAL_REQUEST.request } };
    delete (missing.request as { proposal_expires_at?: unknown }).proposal_expires_at;
    expect(decodePaymentRequestEnvelope(JSON.stringify(missing))).toBeNull();
    const noBilling = { ...OFFICIAL_PROOF } as Record<string, unknown>;
    delete noBilling.billing_period;
    expect(decodePaymentProofEnvelope(JSON.stringify(noBilling))).toBeNull();
  });

  it('registers paykit kinds as known inbound chat kinds for the byte-budget drop', () => {
    for (const kind of PAYKIT_PAYMENT_KINDS) {
      expect(isKnownInboundChatKind(kind)).toBe(true);
    }
    expect(isKnownInboundChatKind('paykit.unknown')).toBe(false);
  });

  it('enforces the Encrypted Link byte budget on outbound envelopes', () => {
    expect(() =>
      buildPaymentRequestEnvelope({
        eventId: EVENT_ID,
        paymentRequestId: REQUEST_ID,
        amountValue: '0.001',
        paymentReference: 'r'.repeat(256),
        endpointIds: Array.from(
          { length: 20 },
          (_, i) => `btc-lightning-bolt${i.toString().padStart(2, '0')}`,
        ),
      }),
    ).toThrow(PaymentError);
  });

  it('validates endpoint identifier charset and reserved names', () => {
    expect(isValidPaymentEndpointIdentifier(ENDPOINT_LIGHTNING_BOLT11)).toBe(true);
    expect(isValidPaymentEndpointIdentifier('lightning')).toBe(true);
    expect(isCanonicalThreePartEndpointId(ENDPOINT_LIGHTNING_BOLT11)).toBe(true);
    expect(isCanonicalThreePartEndpointId('lightning')).toBe(false);
    expect(isValidPaymentEndpointIdentifier('private')).toBe(false);
    expect(isValidPaymentEndpointIdentifier('..')).toBe(false);
    expect(isValidPaymentEndpointIdentifier('foo/bar')).toBe(false);
    expect(isValidPaymentEndpointIdentifier('a'.repeat(65))).toBe(false);
  });

  it('accepts RFC3339 proposal_expires_at and rejects unix-seconds numbers', () => {
    const rfc = {
      ...OFFICIAL_REQUEST,
      request: {
        ...OFFICIAL_REQUEST.request,
        proposal_expires_at: '2026-01-01T00:00:00Z',
      },
    };
    expect(decodePaymentRequestEnvelope(JSON.stringify(rfc))?.request.proposal_expires_at).toBe(
      '2026-01-01T00:00:00Z',
    );
    const unix = {
      ...OFFICIAL_REQUEST,
      request: { ...OFFICIAL_REQUEST.request, proposal_expires_at: 1_735_689_600 },
    };
    expect(decodePaymentRequestEnvelope(JSON.stringify(unix))).toBeNull();
    expect(decodePaymentEnvelope(JSON.stringify(OFFICIAL_ACCEPTANCE))).toEqual(OFFICIAL_ACCEPTANCE);
  });

  it('renders proof_received as claimed unless verified, and pendingEventId as sending', () => {
    expect(displayPaymentStatus('proof_received', null, 1)).toBe('claimed');
    expect(displayPaymentStatus('proof_received', null, 1, { proofVerified: true })).toBe(
      'verified',
    );
    expect(displayPaymentStatus('accepted', null, 1, { pendingEventId: EVENT_ID })).toBe('sending');
  });

  it('encodes the state machine: pending accept/reject/cancel; proof only from accepted', () => {
    expect(canTransition('pending', 'accept', false)).toBe(true);
    expect(canTransition('pending', 'accept', true)).toBe(false);
    expect(canTransition('pending', 'reject', true)).toBe(true);
    expect(canTransition('pending', 'cancel', false)).toBe(true);
    expect(canTransition('pending', 'proof', false)).toBe(false);
    expect(canTransition('pending', 'proof', true)).toBe(false);
    expect(canTransition('accepted', 'accept', false)).toBe(false);
    expect(canTransition('accepted', 'proof', true)).toBe(true);
    expect(canTransition('accepted', 'cancel', false)).toBe(true);
    expect(canTransition('rejected', 'cancel', false)).toBe(false);
    expect(canTransition('proof_received', 'proof', false)).toBe(false);
  });
});

describe('S3 payload validators', () => {
  it('accepts mainnet bolt11/bech32/base58 and rejects injected schemes', () => {
    expect(isValidBolt11(MAINNET_BOLT11_20U)).toBe(true);
    expect(isValidBolt11(MAINNET_BOLT11_20U.toUpperCase())).toBe(true);
    expect(isValidBolt11(MAINNET_BOLT11_AMOUNTLESS)).toBe(true);
    expect(isValidBolt11(TESTNET_BOLT11)).toBe(false);
    expect(isValidBolt11(corruptBolt11Checksum(MAINNET_BOLT11_20U))).toBe(false);
    expect(isValidBolt11(' javascript:alert(1)')).toBe(false);
    expect(isValidBolt11('lnbc1 abc')).toBe(false);
    expect(isValidOnchainAddress(MAINNET_P2TR)).toBe(true);
    expect(isValidOnchainAddress(MAINNET_P2WPKH)).toBe(true);
    expect(isValidOnchainAddress(MAINNET_P2PKH)).toBe(true);
    expect(isValidOnchainAddress('file:///etc/passwd')).toBe(false);
    expect(isValidOnchainAddress(MAINNET_P2WPKH.toUpperCase())).toBe(false);
  });
});

describe('payment reference validation', () => {
  it('rejects empty, whitespace-only, control, and over-long references', () => {
    expect(isValidPaymentReference('invoice-2026-0001')).toBe(true);
    expect(isValidPaymentReference('')).toBe(false);
    expect(isValidPaymentReference('\n')).toBe(false);
    expect(isValidPaymentReference('invoice\u0007ref')).toBe(false);
    expect(isValidPaymentReference('r'.repeat(256))).toBe(true);
    expect(isValidPaymentReference('r'.repeat(257))).toBe(false);
  });

  it('refuses to build a payment_request with an empty reference', () => {
    expect(() =>
      buildPaymentRequestEnvelope({
        eventId: EVENT_ID,
        paymentRequestId: REQUEST_ID,
        amountValue: '0.001',
        paymentReference: '',
        endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
      }),
    ).toThrow(PaymentError);
    expect(() =>
      buildPaymentRequestEnvelope({
        eventId: EVENT_ID,
        paymentRequestId: REQUEST_ID,
        amountValue: '0.001',
        paymentReference: '',
        endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
      }),
    ).toThrow('payment_reference is invalid');
  });
});

describe('amount validation', () => {
  it('accepts canonical positive btc decimals and rejects scientific/negative/empty', () => {
    expect(isCanonicalAmountValue('0.001')).toBe(true);
    expect(isPositiveBtcAmount('0.001')).toBe(true);
    expect(isPositiveBtcAmount('21000000')).toBe(true);
    expect(isPositiveBtcAmount('21000000.00000001')).toBe(false);
    expect(isPositiveBtcAmount('0')).toBe(false);
    expect(isPositiveBtcAmount('0.0')).toBe(false);
    expect(isCanonicalAmountValue('1e-3')).toBe(false);
    expect(isCanonicalAmountValue('-1')).toBe(false);
    expect(isCanonicalAmountValue('')).toBe(false);
    expect(isCanonicalAmountValue('.5')).toBe(false);
    expect(isCanonicalAmountValue('10.')).toBe(false);
    expect(isLenientAmountValue('.5')).toBe(true);
    expect(isLenientAmountValue('10.')).toBe(true);
    expect(normalizeAmountValue('.5')).toBe('0.5');
    expect(normalizeAmountValue('10.')).toBe('10');
    expect(satsToBtcDecimal(1000)).toBe('0.00001');
    expect(satsToBtcDecimal(100_000_000)).toBe('1');
  });

  it('accepts lenient inbound amounts and any asset on decode, emits remain strict', () => {
    const leading = {
      ...OFFICIAL_REQUEST,
      request: { ...OFFICIAL_REQUEST.request, amount: { value: '.5', asset: 'usd' } },
    };
    expect(decodePaymentRequestEnvelope(JSON.stringify(leading))?.request.amount).toEqual({
      value: '0.5',
      asset: 'usd',
    });
    const trailing = {
      ...OFFICIAL_REQUEST,
      request: { ...OFFICIAL_REQUEST.request, amount: { value: '10.', asset: 'btc' } },
    };
    expect(decodePaymentRequestEnvelope(JSON.stringify(trailing))?.request.amount).toEqual({
      value: '10',
      asset: 'btc',
    });
  });

  it('accepts opaque proof objects including empty and {txid}', () => {
    const txidProof = { ...OFFICIAL_PROOF, proof: { txid: 'abc' } };
    expect(decodePaymentProofEnvelope(JSON.stringify(txidProof))?.proof).toEqual({ txid: 'abc' });
    const emptyProof = { ...OFFICIAL_PROOF, proof: {} };
    expect(decodePaymentProofEnvelope(JSON.stringify(emptyProof))?.proof).toEqual({});
  });

  it('rejects duplicate security-relevant keys before JSON.parse collapse', () => {
    const dupKind = `{"version":1,"kind":"${PAYKIT_PAYMENT_REQUEST_KIND}","kind":"paykit.payment_proof","event_id":"${EVENT_ID}","payment_request_id":"${REQUEST_ID}","request":${JSON.stringify(OFFICIAL_REQUEST.request)}}`;
    expect(decodePaymentRequestEnvelope(dupKind)).toBeNull();
    const dupNested = JSON.stringify(OFFICIAL_REQUEST).replace(
      '"payment_request_id":',
      '"payment_request_id":"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa","payment_request_id":',
    );
    expect(decodePaymentRequestEnvelope(dupNested)).toBeNull();
  });
});
