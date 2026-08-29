import { v4 as uuidv4 } from 'uuid';
import {
  HANDSHAKE_FAILURE_LIMIT,
  LINK_RETRY_PAYLOAD_TYPE,
  LinkService,
  linkQueueEntryCountForTests,
} from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { RetryQueue } from '../../RetryQueue';
import {
  CHAT_MESSAGE_KIND,
  LINK_RECEIVER_PATH,
  PAYKIT_MESSAGING_CAPABILITY,
  PUBKY_APP_DM_KIND,
  type LinkReceiver,
  type LinkRecord,
} from '../../../types/link';
import type { DeliveryQueueItem } from '../../../types';

jest.mock('../PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(),
    generateReceiverKey: jest.fn(),
    getReceiverPublicKey: jest.fn(),
    startAuthFlow: jest.fn(),
    awaitAuthApproval: jest.fn(),
    signinWithSecret: jest.fn(),
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
    const code = (err as { code?: unknown }).code;
    return (
      typeof code === 'string' &&
      ['network', 'auth', 'protocol', 'consumed', 'validation', 'unavailable'].includes(code)
    );
  },
  createLinkNativeError: (code: string, message: string) => ({ code, message }),
  toLinkNativeError: (err: unknown) => err,
}));

jest.mock('../../StorageService', () => ({
  StorageService: {
    upsertLinkReceiver: jest.fn(),
    getLinkReceiver: jest.fn(),
    upsertLink: jest.fn(),
    getLink: jest.fn(),
    getAllLinks: jest.fn(),
    updateLinkSnapshot: jest.fn(),
    incrementLinkConsecutiveFailures: jest.fn(),
    deleteLink: jest.fn(),
    saveLinkMessage: jest.fn(),
    persistLinkSendIntent: jest.fn(),
    finalizeLinkSend: jest.fn(),
    hasLinkMessage: jest.fn(),
    getLinkMessage: jest.fn(),
    getLinkMessagesForConversation: jest.fn(),
    updateLinkMessageDeliveryState: jest.fn(),
    saveLinkStreamItems: jest.fn(),
    getUnprocessedLinkStreamItems: jest.fn(),
    markLinkStreamItemProcessed: jest.fn(),
    getLinkReadCursor: jest.fn(),
    setLinkReadCursor: jest.fn(),
    clearAccountData: jest.fn(),
    listDeliveryQueue: jest.fn(),
    removeFromQueue: jest.fn(),
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
    setPubky: jest.fn(),
    getLinkSession: jest.fn(),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
  },
}));

jest.mock('../../RetryQueue', () => ({
  RetryQueue: {
    enqueue: jest.fn(),
    getDue: jest.fn(),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
    defer: jest.fn(),
  },
}));

jest.mock('uuid', () => ({ v4: jest.fn() }));

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedStorage = jest.mocked(StorageService);
const mockedKeyStore = jest.mocked(KeyStore);
const mockedRetryQueue = jest.mocked(RetryQueue);
const mockedUuid = uuidv4 as jest.Mock;

const NOW = 1_700_000_000_000;
const OWNER = 'a'.repeat(52);
const PEER = 'z'.repeat(52);
const OTHER_OWNER = 'b'.repeat(52);
const SESSION_ALIAS = 'session-alias-1';
const RECEIVER_ALIAS = 'receiver-alias-1';
const PEER_NOISE = 'peer-noise-pk';
const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const QUEUE_ID = '00000000-0000-4000-8000-000000000099';
const CONVERSATION_ID = `dm:${PEER}`;

const receiverRow: LinkReceiver = {
  ownerPubky: OWNER,
  receiverAlias: RECEIVER_ALIAS,
  receiverPath: LINK_RECEIVER_PATH,
  markerPublished: true,
  updatedAt: NOW,
};

function storedLink(overrides: Partial<LinkRecord> = {}): LinkRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    role: 'initiator',
    status: 'handshaking',
    snapshot: 'hs-1',
    remoteNoisePublicKey: PEER_NOISE,
    localReceiverPath: LINK_RECEIVER_PATH,
    remoteReceiverPath: LINK_RECEIVER_PATH,
    consecutiveFailures: 0,
    updatedAt: NOW,
    ...overrides,
  };
}

function wireMessage(eventId: string, body = 'hello', kind = CHAT_MESSAGE_KIND): string {
  return JSON.stringify({
    version: 1,
    kind,
    event_id: eventId,
    sent_at: NOW - 1000,
    body,
  });
}

function givenEstablishedLink(): void {
  mockedStorage.getLink.mockResolvedValue(storedLink({ status: 'established', snapshot: 'est-1' }));
  mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-1' });
}

function expectedJson(eventId = EVENT_ID, body = 'hello'): string {
  return JSON.stringify({
    version: 1,
    kind: CHAT_MESSAGE_KIND,
    event_id: eventId,
    sent_at: NOW,
    body,
  });
}

describe('LinkService', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    mockedUuid.mockReturnValueOnce(EVENT_ID).mockReturnValue(QUEUE_ID);

    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signinWithSecret.mockResolvedValue({ sessionAlias: SESSION_ALIAS, pubky: OWNER });
    mockedNative.signOutSession.mockResolvedValue(undefined);
    mockedNative.closeLink.mockResolvedValue(undefined);
    mockedNative.probeInboundLink.mockResolvedValue({ result: 'none' });
    mockedNative.getReceiverMarker.mockResolvedValue({
      noisePublicKey: PEER_NOISE,
      capabilitiesJson: '{}',
    });
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedStorage.getLinkReceiver.mockResolvedValue(receiverRow);
    mockedStorage.getLink.mockResolvedValue(null);
    mockedStorage.getAllLinks.mockResolvedValue([]);
    mockedStorage.listDeliveryQueue.mockResolvedValue([]);
    mockedStorage.hasLinkMessage.mockResolvedValue(false);
    mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValue([]);
    mockedStorage.incrementLinkConsecutiveFailures.mockResolvedValue(1);
    mockedRetryQueue.getDue.mockResolvedValue([]);

    await LinkService.clearSession();
    await LinkService.signinWithSecret('signin-secret-hex');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('session', () => {
    it('persists the session alias on signinWithSecret (dev/e2e path)', () => {
      expect(mockedNative.signinWithSecret).toHaveBeenCalledWith('signin-secret-hex');
      expect(mockedKeyStore.setLinkSession).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedKeyStore.setPubky).toHaveBeenCalledWith(OWNER);
      expect(LinkService.hasSession()).toBe(true);
    });

    it('restores a persisted session alias', async () => {
      await LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);
      mockedNative.restoreSession.mockResolvedValue({ pubky: OWNER });

      await expect(LinkService.restorePersistedSession()).resolves.toBe(true);

      expect(mockedNative.restoreSession).toHaveBeenCalledWith(SESSION_ALIAS);
    });

    it('deletes the stored alias only on an auth restore error', async () => {
      await LinkService.clearSession();
      mockedKeyStore.deleteLinkSession.mockClear();
      mockedKeyStore.getLinkSession.mockReturnValue('stale-alias');
      mockedNative.restoreSession.mockRejectedValue({ code: 'auth', message: 'revoked' });

      await expect(LinkService.restorePersistedSession()).resolves.toBe(false);

      expect(mockedKeyStore.deleteLinkSession).toHaveBeenCalled();
      expect(LinkService.hasSession()).toBe(false);
    });

    it('keeps the stored alias on a network restore error', async () => {
      await LinkService.clearSession();
      mockedKeyStore.deleteLinkSession.mockClear();
      mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);
      mockedNative.restoreSession.mockRejectedValue({ code: 'network', message: 'timeout' });

      await expect(LinkService.restorePersistedSession()).resolves.toBe(false);

      expect(mockedKeyStore.deleteLinkSession).not.toHaveBeenCalled();
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('session-offline');
    });
  });

  describe('enable (Ring path)', () => {
    it('starts a /pub/paykit/:rw flow, then provisions a native-owned receiver', async () => {
      mockedStorage.getLinkReceiver.mockResolvedValue(null);
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });
      mockedNative.awaitAuthApproval.mockResolvedValue({
        sessionAlias: 'alias-2',
        pubky: OWNER,
      });
      mockedNative.generateReceiverKey.mockResolvedValue({
        receiverAlias: 'recv-new',
        noisePublicKey: 'noise-pk',
      });

      const flow = await LinkService.enable();
      expect(flow.authorizationUrl).toBe('pubkyauth://grant');
      expect(mockedNative.startAuthFlow).toHaveBeenCalledWith(PAYKIT_MESSAGING_CAPABILITY);

      const enabled = await flow.awaitEnabled();

      expect(mockedNative.generateReceiverKey).toHaveBeenCalled();
      expect(mockedStorage.upsertLinkReceiver).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          ownerPubky: OWNER,
          receiverAlias: 'recv-new',
          receiverPath: LINK_RECEIVER_PATH,
          markerPublished: false,
        }),
      );
      expect(mockedNative.publishReceiverMarker).toHaveBeenCalledWith(
        'alias-2',
        'recv-new',
        LINK_RECEIVER_PATH,
      );
      const aliasOrder = mockedStorage.upsertLinkReceiver.mock.invocationCallOrder[0]!;
      const publishOrder = mockedNative.publishReceiverMarker.mock.invocationCallOrder[0]!;
      expect(aliasOrder).toBeLessThan(publishOrder);
      expect(enabled).toEqual({
        pubky: OWNER,
        receiverPath: LINK_RECEIVER_PATH,
        noisePublicKey: 'noise-pk',
      });
    });

    it('reuses an existing receiver alias instead of generating a new key', async () => {
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });
      mockedNative.awaitAuthApproval.mockResolvedValue({
        sessionAlias: SESSION_ALIAS,
        pubky: OWNER,
      });
      mockedNative.getReceiverPublicKey.mockResolvedValue('existing-noise');

      const flow = await LinkService.enable();
      await flow.awaitEnabled();

      expect(mockedNative.generateReceiverKey).not.toHaveBeenCalled();
      expect(mockedNative.getReceiverPublicKey).toHaveBeenCalledWith(RECEIVER_ALIAS);
      expect(mockedNative.publishReceiverMarker).toHaveBeenCalledWith(
        SESSION_ALIAS,
        RECEIVER_ALIAS,
        LINK_RECEIVER_PATH,
      );
    });
  });

  describe('ensureLinkWith — provisioning gates', () => {
    it('reports needs-enable when there is no session', async () => {
      await LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue(null);
      mockedKeyStore.getPubky.mockReturnValue(null);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('needs-enable');
    });

    it('reports needs-enable when the receiver marker was never published', async () => {
      mockedStorage.getLinkReceiver.mockResolvedValue({ ...receiverRow, markerPublished: false });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('needs-enable');
    });

    it('reports not-enrolled when the peer has no receiver marker', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue(null);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('not-enrolled');

      expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('reports native-missing when the native module is unavailable', async () => {
      mockedNative.isAvailable.mockReturnValue(false);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('native-missing');
    });
  });

  describe('ensureLinkWith — initiator path', () => {
    it('initiates a handshake, persists it, and reports handshaking-initiator', async () => {
      mockedNative.initiateLink.mockResolvedValue({ linkId: 'hs-handle', snapshot: 'hs-1' });
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-2' });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-initiator');

      expect(mockedNative.initiateLink).toHaveBeenCalledWith(
        SESSION_ALIAS,
        RECEIVER_ALIAS,
        PEER,
        PEER_NOISE,
        LINK_RECEIVER_PATH,
        LINK_RECEIVER_PATH,
      );
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith({
        ownerPubky: OWNER,
        peerPubky: PEER,
        role: 'initiator',
        status: 'handshaking',
        snapshot: 'hs-1',
        remoteNoisePublicKey: PEER_NOISE,
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
      });
      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(
        OWNER,
        PEER,
        'hs-2',
        'handshaking',
      );
    });

    it('completes a stored initiator handshake to ready and caches the handle', async () => {
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'est-1' });
      mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-1' });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');

      expect(mockedStorage.upsertLink).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'established', snapshot: 'est-1' }),
      );
      expect(mockedNative.restoreLink).toHaveBeenCalledWith(
        SESSION_ALIAS,
        RECEIVER_ALIAS,
        PEER,
        PEER_NOISE,
        LINK_RECEIVER_PATH,
        LINK_RECEIVER_PATH,
        'est-1',
      );

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');
      expect(mockedNative.restoreLink).toHaveBeenCalledTimes(1);
      expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(1);
    });

    it('stays handshaking-initiator when an advance step fails once, keeping the snapshot', async () => {
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake.mockRejectedValue(new Error('homeserver unreachable'));
      mockedStorage.incrementLinkConsecutiveFailures.mockResolvedValue(1);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-initiator');

      expect(mockedStorage.updateLinkSnapshot).not.toHaveBeenCalled();
      expect(mockedStorage.deleteLink).not.toHaveBeenCalled();
    });
  });

  describe('ensureLinkWith — responder path', () => {
    it('answers an inbound handshake and reports handshaking-responder', async () => {
      mockedNative.probeInboundLink.mockResolvedValue({
        result: 'pending',
        linkId: 'resp-1',
        snapshot: 'resp-2',
      });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-responder');

      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith({
        ownerPubky: OWNER,
        peerPubky: PEER,
        role: 'responder',
        status: 'handshaking',
        snapshot: 'resp-2',
        remoteNoisePublicKey: PEER_NOISE,
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
      });
    });

    it('adopts an inbound handshake that is already established', async () => {
      mockedNative.probeInboundLink.mockResolvedValue({
        result: 'established',
        linkId: 'handle-2',
        snapshot: 'est-2',
      });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');

      expect(mockedStorage.upsertLink).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'responder',
          status: 'established',
          snapshot: 'est-2',
        }),
      );
    });

    it('completes a stored responder handshake to ready', async () => {
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ role: 'responder', snapshot: 'resp-2' }),
      );
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-9', status: 'pending' });
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'est-9' });
      mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-9' });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');

      expect(mockedStorage.upsertLink).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'established', snapshot: 'est-9' }),
      );
    });
  });

  describe('ensureLinkWith — probe none/pending/established', () => {
    it('leaves prior state untouched when probe returns none and initiates', async () => {
      mockedNative.probeInboundLink.mockResolvedValue({ result: 'none' });
      mockedNative.initiateLink.mockResolvedValue({ linkId: 'hs-handle', snapshot: 'hs-1' });
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-2' });

      await LinkService.ensureLinkWith(PEER);

      expect(mockedNative.initiateLink).toHaveBeenCalled();
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'initiator', snapshot: 'hs-1' }),
      );
    });

    it('does not initiate when probe returns none during inbox sync', async () => {
      mockedNative.probeInboundLink.mockResolvedValue({ result: 'none' });

      await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

      expect(mockedNative.probeInboundLink).toHaveBeenCalledTimes(1);
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });
  });

  describe('ensureLinkWith — crossed-handshake tiebreak', () => {
    it('switches the lexicographically smaller pubky to responder when handshakes cross', async () => {
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-3' });
      mockedNative.probeInboundLink.mockResolvedValue({
        result: 'pending',
        linkId: 'crossed-1',
        snapshot: 'crossed-2',
      });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-responder');

      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(
        OWNER,
        PEER,
        'hs-3',
        'handshaking',
      );
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'responder',
          status: 'handshaking',
          snapshot: 'crossed-2',
        }),
      );
    });

    it('keeps the lexicographically larger pubky on its own initiator handshake', async () => {
      mockedKeyStore.getPubky.mockReturnValue('z'.repeat(52));
      const smallerPeer = 'a'.repeat(52);
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ ownerPubky: 'z'.repeat(52), peerPubky: smallerPeer, snapshot: 'hs-2' }),
      );
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-3' });

      await LinkService.clearSession();
      mockedNative.signinWithSecret.mockResolvedValue({
        sessionAlias: SESSION_ALIAS,
        pubky: 'z'.repeat(52),
      });
      await LinkService.signinWithSecret('signin-secret-hex');
      mockedStorage.getLinkReceiver.mockResolvedValue({
        ...receiverRow,
        ownerPubky: 'z'.repeat(52),
      });

      await expect(LinkService.ensureLinkWith(smallerPeer)).resolves.toBe('handshaking-initiator');

      expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
    });
  });

  describe('wedged-handshake recovery', () => {
    it(`deletes, clears the outbox, and re-handshakes after ${HANDSHAKE_FAILURE_LIMIT} consecutive failures`, async () => {
      mockedStorage.getLink
        .mockResolvedValueOnce(storedLink({ snapshot: 'hs-2' }))
        .mockResolvedValue(null);
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake
        .mockRejectedValueOnce(new Error('still wedged'))
        .mockResolvedValue({ status: 'pending', snapshot: 'hs-fresh-2' });
      mockedStorage.incrementLinkConsecutiveFailures.mockResolvedValue(HANDSHAKE_FAILURE_LIMIT);
      mockedNative.initiateLink.mockResolvedValue({ linkId: 'fresh-hs', snapshot: 'hs-fresh' });
      mockedNative.clearLinkOutbox.mockResolvedValue(0);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-initiator');

      expect(mockedStorage.deleteLink).toHaveBeenCalledWith(OWNER, PEER);
      expect(mockedNative.clearLinkOutbox).toHaveBeenCalled();
      expect(mockedNative.initiateLink).toHaveBeenCalled();
    });

    it('wipes immediately on a typed protocol error', async () => {
      mockedStorage.getLink
        .mockResolvedValueOnce(storedLink({ snapshot: 'hs-2' }))
        .mockResolvedValue(null);
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake
        .mockRejectedValueOnce({ code: 'protocol', message: 'corrupt snapshot' })
        .mockResolvedValue({ status: 'pending', snapshot: 'hs-fresh-2' });
      mockedNative.initiateLink.mockResolvedValue({ linkId: 'fresh-hs', snapshot: 'hs-fresh' });
      mockedNative.clearLinkOutbox.mockResolvedValue(0);

      await LinkService.ensureLinkWith(PEER);

      expect(mockedStorage.deleteLink).toHaveBeenCalledWith(OWNER, PEER);
      expect(mockedNative.clearLinkOutbox).toHaveBeenCalled();
      expect(mockedNative.initiateLink).toHaveBeenCalled();
    });

    it('treats a changed peer noise key as re-enrollment', async () => {
      mockedStorage.getLink
        .mockResolvedValueOnce(storedLink({ snapshot: 'hs-2', remoteNoisePublicKey: 'old-key' }))
        .mockResolvedValue(null);
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake
        .mockRejectedValueOnce({ code: 'protocol', message: 'peer key changed' })
        .mockResolvedValue({ status: 'pending', snapshot: 'hs-fresh-2' });
      mockedNative.getReceiverMarker.mockResolvedValue({
        noisePublicKey: 'new-key',
        capabilitiesJson: '{}',
      });
      mockedNative.initiateLink.mockResolvedValue({ linkId: 'fresh-hs', snapshot: 'hs-fresh' });
      mockedNative.clearLinkOutbox.mockResolvedValue(0);

      await LinkService.ensureLinkWith(PEER);

      expect(mockedStorage.deleteLink).toHaveBeenCalledWith(OWNER, PEER);
      expect(mockedNative.clearLinkOutbox).toHaveBeenCalled();
      expect(mockedNative.initiateLink).toHaveBeenCalledWith(
        SESSION_ALIAS,
        RECEIVER_ALIAS,
        PEER,
        'new-key',
        LINK_RECEIVER_PATH,
        LINK_RECEIVER_PATH,
      );
    });
  });

  describe('sendDm', () => {
    it('persists the sending row and retry item before native send, then finalizes', async () => {
      givenEstablishedLink();
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-2' });

      const message = await LinkService.sendDm(PEER, '  hello  ');

      const json = expectedJson();
      expect(mockedStorage.persistLinkSendIntent).toHaveBeenCalledWith({
        message: {
          ownerPubky: OWNER,
          eventId: EVENT_ID,
          conversationId: CONVERSATION_ID,
          peerPubky: PEER,
          senderPubky: OWNER,
          direction: 'sent',
          kind: CHAT_MESSAGE_KIND,
          rawJson: json,
          body: 'hello',
          sentAt: NOW,
          receivedAt: null,
          deliveryState: 'sending',
        },
        queueItem: expect.objectContaining({
          messageId: EVENT_ID,
          recipientPubky: PEER,
          payload: JSON.stringify({
            type: LINK_RETRY_PAYLOAD_TYPE,
            ownerPubky: OWNER,
            peerPubky: PEER,
            senderPubky: OWNER,
            kind: CHAT_MESSAGE_KIND,
            eventId: EVENT_ID,
            rawJson: json,
          }),
        }),
      });
      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith('handle-1', json);
      expect(mockedStorage.finalizeLinkSend).toHaveBeenCalledWith({
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: EVENT_ID,
        snapshot: 'est-2',
        queueId: QUEUE_ID,
      });
      expect(message.deliveryState).toBe('sent');

      const persistOrder = mockedStorage.persistLinkSendIntent.mock.invocationCallOrder[0]!;
      const sendOrder = mockedNative.sendPrivateMessageJson.mock.invocationCallOrder[0]!;
      const finalizeOrder = mockedStorage.finalizeLinkSend.mock.invocationCallOrder[0]!;
      expect(persistOrder).toBeLessThan(sendOrder);
      expect(sendOrder).toBeLessThan(finalizeOrder);
    });

    it('leaves the row in sending when the native send fails (already queued)', async () => {
      givenEstablishedLink();
      mockedNative.sendPrivateMessageJson.mockRejectedValue(new Error('outbox write failed'));

      const message = await LinkService.sendDm(PEER, 'hello');

      expect(message.deliveryState).toBe('sending');
      expect(mockedStorage.finalizeLinkSend).not.toHaveBeenCalled();
      expect(mockedStorage.persistLinkSendIntent).toHaveBeenCalledTimes(1);
    });

    it('queues instead of sending while the link is still handshaking', async () => {
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-3' });

      const message = await LinkService.sendDm(PEER, 'hello');

      expect(message.deliveryState).toBe('sending');
      expect(mockedStorage.persistLinkSendIntent).toHaveBeenCalledTimes(1);
      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    });

    it('throws without persisting anything when the peer is not enrolled', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue(null);

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toThrow("'not-enrolled'");

      expect(mockedStorage.persistLinkSendIntent).not.toHaveBeenCalled();
    });
  });

  describe('syncInbox', () => {
    it('persists stream items before the snapshot and routes known kinds', async () => {
      givenEstablishedLink();
      const EVT_NEW = '00000000-0000-4000-8000-00000000000a';
      const EVT_KNOWN = '00000000-0000-4000-8000-00000000000b';
      const EVT_DM = '00000000-0000-4000-8000-00000000000c';
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [
          { rawJson: wireMessage(EVT_NEW, 'first'), kind: CHAT_MESSAGE_KIND, version: 1 },
          { rawJson: wireMessage(EVT_NEW, 'first'), kind: CHAT_MESSAGE_KIND, version: 1 },
          { rawJson: wireMessage(EVT_KNOWN, 'old'), kind: CHAT_MESSAGE_KIND, version: 1 },
          {
            rawJson: JSON.stringify({ version: 1, kind: 'other.v0' }),
            kind: 'other.v0',
            version: 1,
          },
          {
            rawJson: JSON.stringify({
              version: 1,
              kind: PUBKY_APP_DM_KIND,
              event_id: EVT_DM,
              sent_at: '2026-01-01T00:00:00.000Z',
              body: 'web dm',
            }),
            kind: PUBKY_APP_DM_KIND,
            version: 1,
          },
        ],
        snapshot: 'est-2',
      });
      mockedStorage.hasLinkMessage.mockImplementation(
        async (_owner, _sender, _kind, eventId) => eventId === EVT_KNOWN,
      );
      mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 's1',
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: CHAT_MESSAGE_KIND,
          rawJson: wireMessage(EVT_NEW, 'first'),
          receivedAt: NOW,
          processed: false,
        },
        {
          id: 's2',
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: CHAT_MESSAGE_KIND,
          rawJson: wireMessage(EVT_NEW, 'first'),
          receivedAt: NOW,
          processed: false,
        },
        {
          id: 's3',
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: CHAT_MESSAGE_KIND,
          rawJson: wireMessage(EVT_KNOWN, 'old'),
          receivedAt: NOW,
          processed: false,
        },
        {
          id: 's4',
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: 'other.v0',
          rawJson: JSON.stringify({ version: 1, kind: 'other.v0' }),
          receivedAt: NOW,
          processed: false,
        },
        {
          id: 's5',
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: PUBKY_APP_DM_KIND,
          rawJson: JSON.stringify({
            version: 1,
            kind: PUBKY_APP_DM_KIND,
            event_id: EVT_DM,
            sent_at: '2026-01-01T00:00:00.000Z',
            body: 'web dm',
          }),
          receivedAt: NOW,
          processed: false,
        },
      ]);

      const received = await LinkService.syncInbox([PEER]);

      expect(mockedStorage.saveLinkStreamItems).toHaveBeenCalled();
      const streamOrder = mockedStorage.saveLinkStreamItems.mock.invocationCallOrder[0]!;
      const snapshotOrder = mockedStorage.updateLinkSnapshot.mock.invocationCallOrder[0]!;
      expect(streamOrder).toBeLessThan(snapshotOrder);
      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(
        OWNER,
        PEER,
        'est-2',
        'established',
      );
      expect(received.map(m => m.eventId).sort()).toEqual([EVT_DM, EVT_NEW].sort());
      expect(received.find(m => m.eventId === EVT_DM)?.kind).toBe(PUBKY_APP_DM_KIND);
      expect(mockedStorage.markLinkStreamItemProcessed).not.toHaveBeenCalledWith('s4');
    });

    it('does not persist a snapshot when the drain returned nothing', async () => {
      givenEstablishedLink();
      mockedNative.receivePrivateMessages.mockResolvedValue({ messages: [], snapshot: 'est-2' });

      await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

      expect(mockedStorage.updateLinkSnapshot).not.toHaveBeenCalled();
    });

    it('answers inbound handshakes but never initiates during inbox sync', async () => {
      await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

      expect(mockedNative.probeInboundLink).toHaveBeenCalledTimes(1);
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('continues with the remaining peers when one peer fails', async () => {
      const otherPeer = 'y'.repeat(52);
      mockedStorage.getLink.mockImplementation(async (_owner, peerPubky) => {
        if (peerPubky === PEER) throw new Error('db corrupt for this row');
        return storedLink({
          peerPubky: otherPeer,
          status: 'established',
          snapshot: 'est-1',
        });
      });
      mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-other' });
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [
          { rawJson: wireMessage(EVENT_ID, 'still works'), kind: CHAT_MESSAGE_KIND, version: 1 },
        ],
        snapshot: 'est-2',
      });
      mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'sx',
          ownerPubky: OWNER,
          peerPubky: otherPeer,
          kind: CHAT_MESSAGE_KIND,
          rawJson: wireMessage(EVENT_ID, 'still works'),
          receivedAt: NOW,
          processed: false,
        },
      ]);

      const received = await LinkService.syncInbox([PEER, otherPeer]);

      expect(received).toHaveLength(1);
      expect(received[0]!.peerPubky).toBe(otherPeer);
    });
  });

  describe('drainRetries / recoverPendingSends', () => {
    const linkItem: DeliveryQueueItem = {
      id: 'q-link',
      messageId: EVENT_ID,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_RETRY_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: EVENT_ID,
        rawJson: wireMessage(EVENT_ID),
      }),
      attempts: 2,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    const foreignItem: DeliveryQueueItem = {
      id: 'q-foreign',
      messageId: 'm-foreign',
      recipientPubky: PEER,
      payload: JSON.stringify({ type: 'dm', message: {} }),
      attempts: 0,
      nextRetryAt: NOW,
      createdAt: NOW,
    };

    it('resends due link items and leaves other transports’ items untouched', async () => {
      givenEstablishedLink();
      mockedRetryQueue.getDue.mockResolvedValue([linkItem, foreignItem]);
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-3' });

      await LinkService.drainRetries();

      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith(
        'handle-1',
        wireMessage(EVENT_ID),
      );
      expect(mockedStorage.finalizeLinkSend).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: EVENT_ID, snapshot: 'est-3', queueId: 'q-link' }),
      );
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledWith('q-link');
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
    });

    it('does not burn an attempt when the link is not ready', async () => {
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-3' });
      mockedRetryQueue.getDue.mockResolvedValue([linkItem]);

      await LinkService.drainRetries();

      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
      expect(mockedRetryQueue.defer).toHaveBeenCalledWith('q-link', 2);
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
    });

    it('sets delivery state failed when the queue permanently drops an item', async () => {
      givenEstablishedLink();
      mockedRetryQueue.getDue.mockResolvedValue([linkItem]);
      mockedNative.sendPrivateMessageJson.mockRejectedValue(new Error('still unreachable'));
      mockedRetryQueue.recordFailure.mockResolvedValue(true);

      await LinkService.drainRetries();

      expect(mockedRetryQueue.recordFailure).toHaveBeenCalledWith('q-link', 2);
      expect(mockedStorage.updateLinkMessageDeliveryState).toHaveBeenCalledWith(
        OWNER,
        OWNER,
        CHAT_MESSAGE_KIND,
        EVENT_ID,
        'failed',
      );
    });

    it('recoverPendingSends replays the exact queued rawJson for sending rows', async () => {
      givenEstablishedLink();
      const exact = wireMessage(EVENT_ID, 'exact-body');
      mockedStorage.listDeliveryQueue.mockResolvedValue([
        {
          ...linkItem,
          payload: JSON.stringify({ ...JSON.parse(linkItem.payload), rawJson: exact }),
        },
      ]);
      mockedStorage.getLinkMessage.mockResolvedValue({
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        conversationId: CONVERSATION_ID,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: exact,
        body: 'exact-body',
        sentAt: NOW,
        receivedAt: null,
        deliveryState: 'sending',
      });
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-9' });

      await LinkService.recoverPendingSends();

      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith('handle-1', exact);
      expect(mockedStorage.finalizeLinkSend).toHaveBeenCalled();
    });
  });

  describe('account scoping and sign-out', () => {
    it('clears account data and closes native handles on sign-out', async () => {
      givenEstablishedLink();
      mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-1' });
      await LinkService.ensureLinkWith(PEER);

      mockedStorage.getAllLinks.mockResolvedValue([
        storedLink({ status: 'established', snapshot: 'est-1' }),
      ]);
      mockedStorage.listDeliveryQueue.mockResolvedValue([
        {
          id: 'q-mine',
          messageId: EVENT_ID,
          recipientPubky: PEER,
          payload: JSON.stringify({
            type: LINK_RETRY_PAYLOAD_TYPE,
            ownerPubky: OWNER,
            peerPubky: PEER,
            senderPubky: OWNER,
            kind: CHAT_MESSAGE_KIND,
            eventId: EVENT_ID,
            rawJson: '{}',
          }),
          attempts: 0,
          nextRetryAt: NOW,
          createdAt: NOW,
        },
        {
          id: 'q-other',
          messageId: EVENT_ID,
          recipientPubky: PEER,
          payload: JSON.stringify({
            type: LINK_RETRY_PAYLOAD_TYPE,
            ownerPubky: OTHER_OWNER,
            peerPubky: PEER,
            senderPubky: OTHER_OWNER,
            kind: CHAT_MESSAGE_KIND,
            eventId: EVENT_ID,
            rawJson: '{}',
          }),
          attempts: 0,
          nextRetryAt: NOW,
          createdAt: NOW,
        },
      ]);

      await LinkService.clearSession();

      expect(mockedNative.closeLink).toHaveBeenCalledWith('handle-1');
      expect(mockedNative.signOutSession).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedStorage.clearAccountData).toHaveBeenCalledWith(OWNER);
      expect(mockedStorage.removeFromQueue).toHaveBeenCalledWith('q-mine');
      expect(mockedStorage.removeFromQueue).not.toHaveBeenCalledWith('q-other');
      expect(LinkService.hasSession()).toBe(false);
    });
  });

  describe('queues map', () => {
    it('prunes settled per-peer queue entries', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue(null);
      await LinkService.ensureLinkWith(PEER);
      expect(linkQueueEntryCountForTests()).toBe(0);
    });
  });

  describe('markRead', () => {
    it('updates the conversation read cursor with the given timestamp', async () => {
      await LinkService.markRead(CONVERSATION_ID, 123);

      expect(mockedStorage.setLinkReadCursor).toHaveBeenCalledWith(OWNER, CONVERSATION_ID, 123);
    });

    it('defaults the cursor to now', async () => {
      await LinkService.markRead(CONVERSATION_ID);

      expect(mockedStorage.setLinkReadCursor).toHaveBeenCalledWith(OWNER, CONVERSATION_ID, NOW);
    });
  });
});
