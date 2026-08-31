import { v4 as uuidv4 } from 'uuid';
import {
  runLinkLiveProof,
  parseLiveProofTokenList,
  parseLiveProofTokens,
  parseNamedLiveProofRows,
  redactLiveProofForLog,
  type LiveProofConfig,
} from '../liveProof';
import { PaykitLinkNative, type PaykitLinkNativeApi } from '../PaykitLinkNative';
import { CHAT_MESSAGE_KIND, LINK_RECEIVER_PATH } from '../../../types/link';
import { LinkService } from '../LinkService';
import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
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
} from '../../../types/payment';

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the live-proof unit test');
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
    setHomeserver: jest.fn(),
    getHomeserver: jest.fn(),
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../attachments/fileIo', () => ({
  deleteCacheFiles: jest.fn().mockResolvedValue(undefined),
  cachePathsForAttachment: () => [],
}));

jest.mock('uuid', () => ({ v4: jest.fn() }));

jest.mock('../PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(),
    generateReceiverKey: jest.fn(),
    getReceiverPublicKey: jest.fn(),
    startAuthFlow: jest.fn(),
    awaitAuthApproval: jest.fn(),
    signinWithSecret: jest.fn(),
    signupWithSecret: jest.fn(),
    restoreSession: jest.fn(),
    signOutSession: jest.fn(),
    clearAllNativeSecrets: jest.fn(),
    publishReceiverMarker: jest.fn(),
    getReceiverMarker: jest.fn(),
    removeReceiverMarker: jest.fn(),
    initiateLink: jest.fn(),
    probeInboundLink: jest.fn(),
    advanceHandshake: jest.fn(),
    restoreHandshake: jest.fn(),
    restoreLink: jest.fn(),
    sendPrivateMessageJson: jest.fn(),
    receivePrivateMessages: jest.fn(),
    clearLinkOutbox: jest.fn(),
    closeLink: jest.fn(),
  },
  isLinkNativeError: (err: unknown) => {
    if (typeof err !== 'object' || err === null) return false;
    return typeof (err as { code?: unknown }).code === 'string';
  },
}));

jest.mock('../LinkService', () => ({
  LinkService: {
    enable: jest.fn(),
    getEnableStatus: jest.fn(),
    signinWithSecret: jest.fn(),
    clearSession: jest.fn(),
  },
}));

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedLinkService = jest.mocked(LinkService);

const CONFIG: LiveProofConfig = {
  homeserverPubky: 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy',
  signupTokenA: 'token-a',
  signupTokenB: 'token-b',
};

const PUBKY_A = 'a'.repeat(52);
const PUBKY_B = 'b'.repeat(52);
const EVENT_A = '00000000-0000-4000-8000-0000000000aa';
const EVENT_B = '00000000-0000-4000-8000-0000000000bb';
const REQ_EVENT_1 = '00000000-0000-4000-8000-0000000000c1';
const REQ_ID_1 = '00000000-0000-4000-8000-0000000000d1';
const ACC_EVENT = '00000000-0000-4000-8000-0000000000e1';
const PROOF_EVENT = '00000000-0000-4000-8000-0000000000f1';
const REQ_EVENT_2 = '00000000-0000-4000-8000-0000000000c2';
const REQ_ID_2 = '00000000-0000-4000-8000-0000000000d2';
const REJ_EVENT = '00000000-0000-4000-8000-0000000000e2';
const LIVE_PREIMAGE = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

function secrets(): Uint8Array[] {
  return [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
}

function envelope(eventId: string, body: string, sentAt: number): string {
  return JSON.stringify({
    version: 1,
    kind: CHAT_MESSAGE_KIND,
    event_id: eventId,
    sent_at: sentAt,
    body,
  });
}

function mockNativeHappyPath(): void {
  mockedNative.isAvailable.mockReturnValue(true);
  mockedNative.signupWithSecret.mockImplementation(async (_secret, _hs, token) => {
    if (token === 'token-a') return { sessionAlias: 'session-a', pubky: PUBKY_A };
    return { sessionAlias: 'session-b', pubky: PUBKY_B };
  });
  mockedNative.generateReceiverKey
    .mockResolvedValueOnce({ receiverAlias: 'recv-a', noisePublicKey: 'noise-a' })
    .mockResolvedValueOnce({ receiverAlias: 'recv-b', noisePublicKey: 'noise-b' });
  mockedNative.publishReceiverMarker.mockResolvedValue(undefined);
  mockedNative.getReceiverMarker.mockImplementation(async peer => {
    if (peer === PUBKY_B) return { noisePublicKey: 'noise-b', capabilitiesJson: '{}' };
    return { noisePublicKey: 'noise-a', capabilitiesJson: '{}' };
  });
  mockedNative.initiateLink.mockResolvedValue({ linkId: 'link-a', snapshot: 'snap-a' });
  mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'est-a' });
  mockedNative.probeInboundLink.mockResolvedValue({
    result: 'established',
    linkId: 'link-b',
    snapshot: 'est-b',
  });
  mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'sent' });
  const requestOne = buildPaymentRequestEnvelope({
    eventId: REQ_EVENT_1,
    paymentRequestId: REQ_ID_1,
    amountValue: '0.001',
    paymentReference: 'liveproof-pay-1',
    endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
  });
  const acceptance = buildPaymentAcceptanceEnvelope({
    eventId: ACC_EVENT,
    paymentRequestId: REQ_ID_1,
  });
  const proof = buildPaymentProofEnvelope({
    eventId: PROOF_EVENT,
    paymentRequestId: REQ_ID_1,
    paymentReference: 'liveproof-pay-1',
    paymentEndpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
    proofData: LIVE_PREIMAGE,
  });
  const requestTwo = buildPaymentRequestEnvelope({
    eventId: REQ_EVENT_2,
    paymentRequestId: REQ_ID_2,
    amountValue: '0.002',
    paymentReference: 'liveproof-pay-2',
    endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
  });
  const rejection = buildPaymentRejectionEnvelope({
    eventId: REJ_EVENT,
    paymentRequestId: REQ_ID_2,
    reason: 'liveproof-reject',
  });
  mockedNative.receivePrivateMessages
    .mockResolvedValueOnce({
      messages: [
        { version: 1, kind: CHAT_MESSAGE_KIND, rawJson: envelope(EVENT_A, 'liveproof-a', 1) },
      ],
      snapshot: 'recv-b',
    })
    .mockResolvedValueOnce({
      messages: [
        { version: 1, kind: CHAT_MESSAGE_KIND, rawJson: envelope(EVENT_B, 'liveproof-b-reply', 2) },
      ],
      snapshot: 'recv-a',
    })
    .mockResolvedValueOnce({
      messages: [{ version: 1, kind: PAYKIT_PAYMENT_REQUEST_KIND, rawJson: requestOne.json }],
      snapshot: 'recv-pay-1',
    })
    .mockResolvedValueOnce({
      messages: [{ version: 1, kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND, rawJson: acceptance.json }],
      snapshot: 'recv-acc',
    })
    .mockResolvedValueOnce({
      messages: [{ version: 1, kind: PAYKIT_PAYMENT_PROOF_KIND, rawJson: proof.json }],
      snapshot: 'recv-proof',
    })
    .mockResolvedValueOnce({
      messages: [{ version: 1, kind: PAYKIT_PAYMENT_REQUEST_KIND, rawJson: requestTwo.json }],
      snapshot: 'recv-pay-2',
    })
    .mockResolvedValueOnce({
      messages: [{ version: 1, kind: PAYKIT_PAYMENT_REJECTION_KIND, rawJson: rejection.json }],
      snapshot: 'recv-rej',
    });
  mockedNative.closeLink.mockResolvedValue(undefined);
  mockedNative.removeReceiverMarker.mockResolvedValue(undefined);
  mockedNative.signOutSession.mockResolvedValue(undefined);
}

describe('redactLiveProofForLog', () => {
  it('redacts known tokens and supplied identity secrets', () => {
    const hex = 'ab'.repeat(32);
    const text = `signup token-a failed with ${hex} and leftover`;
    expect(redactLiveProofForLog(text, ['token-a', 'token-b', hex])).toBe(
      'signup [redacted] failed with [redacted] and leftover',
    );
  });
});

describe('parseLiveProofTokens', () => {
  it('reads two fields or a comma-separated first field', () => {
    expect(parseLiveProofTokens(' a ', ' b ')).toEqual({
      signupTokenA: 'a',
      signupTokenB: 'b',
    });
    expect(parseLiveProofTokens('a,b', '')).toEqual({
      signupTokenA: 'a',
      signupTokenB: 'b',
    });
    expect(parseLiveProofTokens('', '')).toBeNull();
  });
});

describe('parseLiveProofTokenList', () => {
  it('reads a third token from a comma list or a dedicated field', () => {
    expect(parseLiveProofTokenList('a,b,c')).toEqual({
      signupTokenA: 'a',
      signupTokenB: 'b',
      signupTokenC: 'c',
    });
    expect(parseLiveProofTokenList('a', 'b', 'c')).toEqual({
      signupTokenA: 'a',
      signupTokenB: 'b',
      signupTokenC: 'c',
    });
  });
});

describe('parseNamedLiveProofRows', () => {
  it('defaults to p0 and de-duplicates named rows', () => {
    expect(parseNamedLiveProofRows(undefined)).toEqual(['p0']);
    expect(parseNamedLiveProofRows('p0,p4,p0,native')).toEqual(['p0', 'p4', 'native']);
    expect(parseNamedLiveProofRows('p6,p3,p5')).toEqual(['p6', 'p3', 'p5']);
  });
});

describe('runLinkLiveProof', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
  });

  afterEach(() => {
    setDbForTests(null);
    jest.restoreAllMocks();
  });

  it('never throws when the native module is missing', async () => {
    mockedNative.isAvailable.mockReturnValue(false);
    const report = await runLinkLiveProof(CONFIG, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]).toEqual(
      expect.objectContaining({ step: 'native-available', ok: false }),
    );
    expect(mockedLinkService.enable).not.toHaveBeenCalled();
  });

  it('records a failed config step for empty tokens', async () => {
    mockedNative.isAvailable.mockReturnValue(true);
    const report = await runLinkLiveProof(
      { homeserverPubky: 'hs', signupTokenA: '', signupTokenB: 'b' },
      { native: mockedNative as unknown as PaykitLinkNativeApi },
    );
    expect(report.ok).toBe(false);
    expect(report.steps.map(step => step.step)).toEqual(
      expect.arrayContaining([
        'validate-config',
        'cleanup-close',
        'cleanup-markers',
        'cleanup-signout',
      ]),
    );
    expect(report.steps.find(step => step.step === 'validate-config')?.ok).toBe(false);
  });

  it('walks signup, handshake, send/receive, and cleanup on the native module only', async () => {
    mockNativeHappyPath();
    const secretsQueue = secrets();
    let now = 1_700_000_000_000;
    const mockedUuid = uuidv4 as jest.Mock;
    mockedUuid
      .mockReturnValueOnce(EVENT_A)
      .mockReturnValueOnce(EVENT_B)
      .mockReturnValueOnce(REQ_EVENT_1)
      .mockReturnValueOnce(REQ_ID_1)
      .mockReturnValueOnce(ACC_EVENT)
      .mockReturnValueOnce(PROOF_EVENT)
      .mockReturnValueOnce(REQ_EVENT_2)
      .mockReturnValueOnce(REQ_ID_2)
      .mockReturnValueOnce(REJ_EVENT);

    const report = await runLinkLiveProof(CONFIG, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      now: () => {
        now += 1;
        return now;
      },
      sleep: async () => undefined,
      randomBytes: () => secretsQueue.shift() ?? new Uint8Array(32).fill(9),
      handshakeTimeoutMs: 5,
      receiveTimeoutMs: 5,
      pollIntervalMs: 0,
    });

    expect(report.ok).toBe(true);
    expect(report.steps.every(step => step.ok)).toBe(true);
    expect(report.steps.map(step => step.step)).toEqual([
      'native-available',
      'validate-config',
      'generate-identities',
      'signup-a',
      'signup-b',
      'provision-a',
      'provision-b',
      'read-marker-b',
      'read-marker-a',
      'initiate-a',
      'establish',
      'send-a',
      'receive-b',
      'send-b',
      'receive-a',
      'send-payment-request-a',
      'receive-payment-request-b',
      'send-payment-acceptance-b',
      'receive-payment-acceptance-a',
      'send-payment-proof-b',
      'receive-payment-proof-a',
      'send-payment-request-2-a',
      'receive-payment-request-2-b',
      'send-payment-rejection-b',
      'receive-payment-rejection-a',
      'cleanup-close',
      'cleanup-markers',
      'cleanup-signout',
    ]);

    expect(mockedNative.signupWithSecret).toHaveBeenCalledTimes(2);
    expect(mockedNative.signupWithSecret).toHaveBeenNthCalledWith(
      1,
      '01'.repeat(32),
      CONFIG.homeserverPubky,
      'token-a',
    );
    expect(mockedNative.publishReceiverMarker).toHaveBeenCalledWith(
      'session-a',
      'recv-a',
      LINK_RECEIVER_PATH,
    );
    expect(mockedNative.initiateLink).toHaveBeenCalledWith(
      'session-a',
      'recv-a',
      PUBKY_B,
      'noise-b',
      LINK_RECEIVER_PATH,
      LINK_RECEIVER_PATH,
    );
    expect(mockedNative.signOutSession).toHaveBeenCalledWith('session-a');
    expect(mockedNative.signOutSession).toHaveBeenCalledWith('session-b');
    expect(mockedLinkService.enable).not.toHaveBeenCalled();
    expect(mockedLinkService.signinWithSecret).not.toHaveBeenCalled();
    expect(mockedLinkService.clearSession).not.toHaveBeenCalled();

    const logged = jest.mocked(console.log).mock.calls.map(args => args.join(' '));
    expect(logged.some(line => line.includes('token-a'))).toBe(false);
    expect(logged.some(line => line.includes('token-b'))).toBe(false);
    expect(logged.some(line => line.includes('01'.repeat(32)))).toBe(false);
    expect(logged.some(line => line.includes('[liveproof]'))).toBe(true);
  });

  it('redacts a token echoed in a native error from step detail and logs', async () => {
    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signupWithSecret.mockRejectedValueOnce({
      code: 'auth',
      message: 'signup failed for token-a',
    });
    mockedNative.signOutSession.mockResolvedValue(undefined);
    mockedNative.removeReceiverMarker.mockResolvedValue(undefined);
    mockedNative.closeLink.mockResolvedValue(undefined);
    const secretsQueue = secrets();

    const report = await runLinkLiveProof(CONFIG, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      randomBytes: () => secretsQueue.shift() ?? new Uint8Array(32).fill(9),
    });

    expect(report.ok).toBe(false);
    const signup = report.steps.find(step => step.step === 'signup-a');
    expect(signup?.ok).toBe(false);
    expect(signup?.detail).not.toContain('token-a');
    expect(signup?.detail).toContain('[redacted]');
    const logged = jest.mocked(console.log).mock.calls.map(args => args.join(' '));
    expect(logged.some(line => line.includes('token-a'))).toBe(false);
  });

  it('still signs out after a mid-proof failure', async () => {
    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signupWithSecret
      .mockResolvedValueOnce({ sessionAlias: 'session-a', pubky: PUBKY_A })
      .mockRejectedValueOnce({ code: 'auth', message: 'signup_failed: bad token' });
    mockedNative.signOutSession.mockResolvedValue(undefined);
    mockedNative.removeReceiverMarker.mockResolvedValue(undefined);
    mockedNative.closeLink.mockResolvedValue(undefined);

    const secretsQueue = secrets();
    const report = await runLinkLiveProof(CONFIG, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      randomBytes: () => secretsQueue.shift() ?? new Uint8Array(32).fill(9),
    });

    expect(report.ok).toBe(false);
    expect(report.steps.find(step => step.step === 'signup-b')?.ok).toBe(false);
    expect(mockedNative.signOutSession).toHaveBeenCalledWith('session-a');
    expect(mockedNative.signOutSession).not.toHaveBeenCalledWith('session-b');
  });
});
