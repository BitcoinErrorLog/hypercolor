import { v4 as uuidv4 } from 'uuid';
import { runLinkLiveProof, parseLiveProofTokens, type LiveProofConfig } from '../liveProof';
import { PaykitLinkNative, type PaykitLinkNativeApi } from '../PaykitLinkNative';
import { CHAT_MESSAGE_KIND, LINK_RECEIVER_PATH } from '../../../types/link';
import { LinkService } from '../LinkService';

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
    });
  mockedNative.closeLink.mockResolvedValue(undefined);
  mockedNative.removeReceiverMarker.mockResolvedValue(undefined);
  mockedNative.signOutSession.mockResolvedValue(undefined);
}

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

describe('runLinkLiveProof', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
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
    mockedUuid.mockReturnValueOnce(EVENT_A).mockReturnValue(EVENT_B);

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
