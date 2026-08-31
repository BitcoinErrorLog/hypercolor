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
  LINK_MESSAGE_MAX_BYTES,
  LINK_RECEIVER_PATH,
  RING_GRANT_CAPABILITIES,
  PUBKY_APP_DM_KIND,
  type LinkMessage,
  type LinkReceiver,
  type LinkRecord,
} from '../../../types/link';
import type { DeliveryQueueItem } from '../../../types';
import { applyGroupInbound } from '../../group/applyGroupInbound';
import { applyAttachmentInbound } from '../../attachments/applyAttachmentInbound';
import { applyPaymentInbound } from '../../payments/applyPaymentInbound';
import { PAYKIT_PAYMENT_REQUEST_KIND } from '../../../types/payment';
import { GROUP_MESSAGE_KIND } from '../../../types/group';
import {
  ATTACHMENT_ALGORITHM,
  ATTACHMENT_KEY_PLACEHOLDER,
  CHAT_ATTACHMENT_KIND,
} from '../../../types/attachment';

jest.mock('../PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(),
    generateAttachmentKey: jest.fn(),
    attachmentEncrypt: jest.fn(),
    attachmentDecrypt: jest.fn(),
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
    putPublic: jest.fn(),
    deletePublic: jest.fn(),
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
    resetLinkConsecutiveFailures: jest.fn(),
    deleteLink: jest.fn(),
    deleteLinkReceiver: jest.fn(),
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
    retryPendingCleanup: jest.fn(),
    markGroupEventSeen: jest.fn(),
    listDeliveryQueue: jest.fn(),
    listPaymentRequestsWithPendingEvent: jest.fn().mockResolvedValue([]),
    getLinkMessageByEventId: jest.fn(),
    hasQueueItemForMessage: jest.fn(),
    clearPaymentPendingEvent: jest.fn(),
    enqueue: jest.fn(),
    removeFromQueue: jest.fn(),
    getContact: jest.fn(),
    getAllContacts: jest.fn(),
    getMessageRequest: jest.fn(),
    upsertMessageRequest: jest.fn(),
    listMessageRequests: jest.fn(),
    countPendingMessageRequests: jest.fn(),
    deleteLinkStreamItemsForPeer: jest.fn(),
    deleteLinkMessagesForPeer: jest.fn(),
    countLinkMessagesForPeer: jest.fn(),
    setContactRelationshipFlags: jest.fn(),
    hasGroupMessage: jest.fn(),
    finalizeGroupFanoutSend: jest.fn(),
    countDeliveryQueueForMessage: jest.fn(),
    updateGroupMessageDeliveryState: jest.fn(),
    saveAttachment: jest.fn(),
    getAttachment: jest.fn(),
    hasAttachment: jest.fn(),
    updateAttachmentResolve: jest.fn(),
    updateAttachmentDelivery: jest.fn(),
  },
}));

jest.mock('../../group/applyGroupInbound', () => ({
  applyGroupInbound: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../attachments/applyAttachmentInbound', () => ({
  applyAttachmentInbound: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../payments/applyPaymentInbound', () => ({
  applyPaymentInbound: jest.fn().mockResolvedValue({ action: 'applied', request: null }),
}));

jest.mock('../../homeserverOrigin', () => ({
  resolveHomeserverOrigin: async () => 'https://homeserver.example',
  parsePubkyOwner: (url: string) => {
    const match = /^pubky:\/\/([^/]+)/.exec(url);
    return match?.[1] ?? null;
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
    setPubky: jest.fn(),
    getLinkSession: jest.fn(),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
    setAttachmentSecret: jest.fn(),
    getAttachmentSecret: jest.fn(),
    deleteAttachmentSecrets: jest.fn(),
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

function sendingRow(overrides: Partial<LinkMessage> = {}): LinkMessage {
  return {
    ownerPubky: OWNER,
    eventId: EVENT_ID,
    conversationId: CONVERSATION_ID,
    peerPubky: PEER,
    senderPubky: OWNER,
    direction: 'sent',
    kind: CHAT_MESSAGE_KIND,
    rawJson: wireMessage(EVENT_ID),
    body: 'hello',
    sentAt: NOW,
    receivedAt: null,
    deliveryState: 'sending',
    ...overrides,
  };
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
    mockedNative.clearAllNativeSecrets.mockResolvedValue(undefined);
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
    mockedStorage.listPaymentRequestsWithPendingEvent.mockResolvedValue([]);
    mockedStorage.retryPendingCleanup.mockResolvedValue(undefined);
    mockedStorage.markGroupEventSeen.mockResolvedValue(undefined);
    mockedStorage.hasLinkMessage.mockResolvedValue(false);
    mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValue([]);
    mockedStorage.incrementLinkConsecutiveFailures.mockResolvedValue(1);
    mockedStorage.getContact.mockResolvedValue(null);
    mockedStorage.getAllContacts.mockResolvedValue([]);
    mockedStorage.getMessageRequest.mockResolvedValue(null);
    mockedStorage.countLinkMessagesForPeer.mockResolvedValue(0);
    mockedStorage.hasGroupMessage.mockResolvedValue(true);
    mockedStorage.finalizeGroupFanoutSend.mockResolvedValue(undefined);
    mockedStorage.countDeliveryQueueForMessage.mockResolvedValue(0);
    mockedStorage.updateGroupMessageDeliveryState.mockResolvedValue(undefined);
    mockedStorage.upsertMessageRequest.mockResolvedValue(undefined);
    mockedStorage.deleteLinkStreamItemsForPeer.mockResolvedValue(undefined);
    mockedStorage.deleteLinkMessagesForPeer.mockResolvedValue(undefined);
    mockedStorage.getLinkMessage.mockResolvedValue(sendingRow());
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

    it('reports getEnableStatus from native, session, and receiver marker', async () => {
      mockedNative.isAvailable.mockReturnValue(false);
      await expect(LinkService.getEnableStatus()).resolves.toBe('native-missing');

      mockedNative.isAvailable.mockReturnValue(true);
      await expect(LinkService.getEnableStatus()).resolves.toBe('enabled');

      mockedStorage.getLinkReceiver.mockResolvedValueOnce({
        ...receiverRow,
        markerPublished: false,
      });
      await expect(LinkService.getEnableStatus()).resolves.toBe('needs-enable');

      await LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue(null);
      mockedKeyStore.getPubky.mockReturnValue(null);
      await expect(LinkService.getEnableStatus()).resolves.toBe('needs-enable');

      mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);
      mockedNative.restoreSession.mockRejectedValue({ code: 'network', message: 'timeout' });
      await expect(LinkService.getEnableStatus()).resolves.toBe('session-offline');
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
    it('starts a combined Paykit + Hypercolor write grant, then provisions a native-owned receiver', async () => {
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
      expect(RING_GRANT_CAPABILITIES).toBe('/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw');
      expect(mockedNative.startAuthFlow).toHaveBeenCalledWith(RING_GRANT_CAPABILITIES);

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

    it('regenerates the receiver when getReceiverPublicKey rejects the stored alias', async () => {
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });
      mockedNative.awaitAuthApproval.mockResolvedValue({
        sessionAlias: SESSION_ALIAS,
        pubky: OWNER,
      });
      mockedNative.getReceiverPublicKey.mockRejectedValue({
        code: 'validation',
        message: 'unknown receiver alias',
      });
      mockedNative.generateReceiverKey.mockResolvedValue({
        receiverAlias: 'recv-healed',
        noisePublicKey: 'noise-healed',
      });

      const flow = await LinkService.enable();
      const enabled = await flow.awaitEnabled();

      expect(mockedStorage.deleteLinkReceiver).toHaveBeenCalledWith(OWNER);
      expect(mockedNative.generateReceiverKey).toHaveBeenCalled();
      expect(mockedNative.publishReceiverMarker).toHaveBeenCalledWith(
        SESSION_ALIAS,
        'recv-healed',
        LINK_RECEIVER_PATH,
      );
      expect(enabled).toEqual({
        pubky: OWNER,
        receiverPath: LINK_RECEIVER_PATH,
        noisePublicKey: 'noise-healed',
      });
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

    it('clears the outbox and retries when a protocol probe fails with no stored link', async () => {
      mockedStorage.getLink.mockResolvedValue(null);
      mockedNative.probeInboundLink.mockRejectedValueOnce({
        code: 'protocol',
        message: 'stale msg1',
      });
      mockedNative.clearLinkOutbox.mockResolvedValue(1);
      mockedNative.initiateLink.mockResolvedValue({ linkId: 'hs-handle', snapshot: 'hs-1' });
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-2' });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-initiator');

      expect(mockedNative.clearLinkOutbox).toHaveBeenCalled();
      expect(mockedNative.initiateLink).toHaveBeenCalled();
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

    it('does not increment or wipe an established link on repeated network restore failures', async () => {
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ status: 'established', snapshot: 'est-1', consecutiveFailures: 4 }),
      );
      mockedNative.restoreLink.mockRejectedValue({ code: 'network', message: 'homeserver down' });
      mockedStorage.incrementLinkConsecutiveFailures.mockResolvedValue(HANDSHAKE_FAILURE_LIMIT);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');

      expect(mockedStorage.incrementLinkConsecutiveFailures).not.toHaveBeenCalled();
      expect(mockedStorage.deleteLink).not.toHaveBeenCalled();
      expect(mockedNative.clearLinkOutbox).not.toHaveBeenCalled();
    });

    it('wipes an established link immediately on a protocol restore error', async () => {
      mockedStorage.getLink
        .mockResolvedValueOnce(storedLink({ status: 'established', snapshot: 'est-1' }))
        .mockResolvedValue(null);
      mockedNative.restoreLink.mockRejectedValueOnce({
        code: 'protocol',
        message: 'decrypt failed',
      });
      mockedNative.initiateLink.mockResolvedValue({ linkId: 'fresh-hs', snapshot: 'hs-fresh' });
      mockedNative.advanceHandshake.mockResolvedValue({
        status: 'pending',
        snapshot: 'hs-fresh-2',
      });
      mockedNative.clearLinkOutbox.mockResolvedValue(0);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-initiator');

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

    it('does not accept a pending request when sendDm cannot establish a link', async () => {
      mockedStorage.getMessageRequest.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        createdAt: NOW,
        updatedAt: NOW,
        status: 'pending',
      });
      mockedNative.getReceiverMarker.mockResolvedValue(null);

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toThrow("'not-enrolled'");

      expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
    });

    it('accepts a pending request only after ensureLinkLocked returns a sendable status', async () => {
      givenEstablishedLink();
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-2' });
      mockedStorage.getMessageRequest.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        createdAt: NOW,
        updatedAt: NOW,
        status: 'pending',
      });

      await LinkService.sendDm(PEER, 'hello');

      expect(mockedStorage.upsertMessageRequest).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'accepted' }),
      );
      const restoreOrder = mockedNative.restoreLink.mock.invocationCallOrder[0]!;
      const acceptOrder = mockedStorage.upsertMessageRequest.mock.invocationCallOrder[0]!;
      expect(restoreOrder).toBeLessThan(acceptOrder);
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

    it('routes group kinds into GroupService and leaves unknown kinds unprocessed', async () => {
      givenEstablishedLink();
      const groupJson = JSON.stringify({
        version: 1,
        kind: GROUP_MESSAGE_KIND,
        channel_id: EVENT_ID,
        event_id: EVENT_ID,
        sent_at: NOW,
        body: 'group hi',
      });
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [{ rawJson: groupJson, kind: GROUP_MESSAGE_KIND, version: 1 }],
        snapshot: 'est-2',
      });
      mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'sg',
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: GROUP_MESSAGE_KIND,
          rawJson: groupJson,
          receivedAt: NOW,
          processed: false,
        },
      ]);

      const received = await LinkService.syncInbox([PEER]);

      expect(received).toEqual([]);
      expect(applyGroupInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: OWNER,
          senderPubky: PEER,
          rawJson: groupJson,
        }),
      );
      expect(mockedStorage.markLinkStreamItemProcessed).toHaveBeenCalledWith('sg');
      expect(mockedStorage.saveLinkMessage).not.toHaveBeenCalled();
    });

    it('routes chat.attachment.v0 through applyAttachmentInbound and marks processed', async () => {
      givenEstablishedLink();
      const liveKey = 'A'.repeat(43);
      const liveNonce = 'B'.repeat(32);
      const attJson = JSON.stringify({
        version: 1,
        kind: CHAT_ATTACHMENT_KIND,
        event_id: EVENT_ID,
        sent_at: NOW,
        location: `pubky://${PEER}/pub/hypercolor.app/v1/attachments/${EVENT_ID}`,
        key: liveKey,
        nonce: liveNonce,
        algorithm: ATTACHMENT_ALGORITHM,
        contentType: 'image/jpeg',
        size: 12,
      });
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [{ rawJson: attJson, kind: CHAT_ATTACHMENT_KIND, version: 1 }],
        snapshot: 'est-2',
      });
      mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'sa',
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: CHAT_ATTACHMENT_KIND,
          rawJson: attJson,
          receivedAt: NOW,
          processed: false,
        },
      ]);
      const attRow = {
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        conversationId: CONVERSATION_ID,
        peerPubky: PEER,
        senderPubky: PEER,
        direction: 'received' as const,
        kind: CHAT_ATTACHMENT_KIND,
        rawJson: attJson,
        body: '[attachment]',
        sentAt: NOW,
        receivedAt: NOW,
        deliveryState: 'delivered' as const,
      };
      (applyAttachmentInbound as jest.Mock).mockResolvedValueOnce(attRow);

      const received = await LinkService.syncInbox([PEER]);

      expect(mockedKeyStore.setAttachmentSecret).toHaveBeenCalledWith(
        OWNER,
        PEER,
        EVENT_ID,
        expect.objectContaining({ key: liveKey, nonce: liveNonce }),
      );
      expect(mockedStorage.saveLinkStreamItems).toHaveBeenCalled();
      const stored = mockedStorage.saveLinkStreamItems.mock.calls[0]![0] as {
        rawJson: string;
      }[];
      expect(stored[0]!.rawJson).toContain(ATTACHMENT_KEY_PLACEHOLDER);
      expect(stored[0]!.rawJson).not.toContain(liveKey);
      expect(stored[0]!.rawJson).not.toContain(liveNonce);
      expect(applyAttachmentInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: OWNER,
          senderPubky: PEER,
        }),
      );
      expect(mockedStorage.markLinkStreamItemProcessed).toHaveBeenCalledWith('sa');
      expect(received).toEqual([attRow]);
    });

    it('routes paykit.payment_request through applyPaymentInbound and marks processed', async () => {
      givenEstablishedLink();
      const payJson = JSON.stringify({
        version: 1,
        kind: PAYKIT_PAYMENT_REQUEST_KIND,
        event_id: EVENT_ID,
        payment_request_id: 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
        request: {
          amount: { value: '0.001', asset: 'btc' },
          payment_reference: 'invoice-2026-0001',
          proposal_expires_at: null,
          recurrence: null,
          accepted_payment_endpoint_identifiers: ['btc-lightning-bolt11'],
          metadata: {},
        },
      });
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [{ rawJson: payJson, kind: PAYKIT_PAYMENT_REQUEST_KIND, version: 1 }],
        snapshot: 'est-2',
      });
      mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'sp',
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: PAYKIT_PAYMENT_REQUEST_KIND,
          rawJson: payJson,
          receivedAt: NOW,
          processed: false,
        },
      ]);

      const received = await LinkService.syncInbox([PEER]);

      expect(applyPaymentInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: OWNER,
          senderPubky: PEER,
          peerPubky: PEER,
          rawJson: payJson,
        }),
      );
      expect(mockedStorage.markLinkStreamItemProcessed).toHaveBeenCalledWith('sp');
      expect(received).toEqual([]);
    });

    it('does not persist an oversized known-kind inbound envelope', async () => {
      givenEstablishedLink();
      const oversized = JSON.stringify({
        version: 1,
        kind: CHAT_MESSAGE_KIND,
        event_id: EVENT_ID,
        sent_at: NOW,
        body: 'z'.repeat(LINK_MESSAGE_MAX_BYTES),
      });
      expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(
        LINK_MESSAGE_MAX_BYTES,
      );
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [{ rawJson: oversized, kind: CHAT_MESSAGE_KIND, version: 1 }],
        snapshot: 'est-2',
      });
      mockedStorage.getUnprocessedLinkStreamItems
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await LinkService.syncInbox([PEER]);

      expect(mockedStorage.saveLinkStreamItems).not.toHaveBeenCalled();
      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(
        OWNER,
        PEER,
        'est-2',
        'established',
      );
      expect(mockedStorage.saveLinkMessage).not.toHaveBeenCalled();
    });

    it('does not persist a spoofed attachment location', async () => {
      givenEstablishedLink();
      const victim = 'v'.repeat(52);
      const spoofed = JSON.stringify({
        version: 1,
        kind: CHAT_ATTACHMENT_KIND,
        event_id: EVENT_ID,
        sent_at: NOW,
        location: `pubky://${victim}/pub/hypercolor.app/v1/attachments/${EVENT_ID}`,
        key: 'A'.repeat(43),
        nonce: 'B'.repeat(32),
        algorithm: ATTACHMENT_ALGORITHM,
        contentType: 'image/jpeg',
        size: 12,
      });
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [{ rawJson: spoofed, kind: CHAT_ATTACHMENT_KIND, version: 1 }],
        snapshot: 'est-2',
      });
      mockedStorage.getUnprocessedLinkStreamItems
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await LinkService.syncInbox([PEER]);

      expect(mockedStorage.saveLinkStreamItems).not.toHaveBeenCalled();
      expect(mockedKeyStore.setAttachmentSecret).not.toHaveBeenCalled();
      expect(applyAttachmentInbound).not.toHaveBeenCalled();
      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalled();
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

    it('skips a queued item whose message is no longer sending and does not send again', async () => {
      givenEstablishedLink();
      mockedRetryQueue.getDue.mockResolvedValue([linkItem]);
      mockedStorage.getLinkMessage.mockResolvedValue(sendingRow({ deliveryState: 'sent' }));

      await LinkService.drainRetries();

      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledWith('q-link');
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
    });

    it('defers without burning an attempt when ensureLinkLocked throws a network error', async () => {
      mockedStorage.getLink.mockResolvedValue(null);
      mockedNative.getReceiverMarker.mockRejectedValue({ code: 'network', message: 'timeout' });
      mockedRetryQueue.getDue.mockResolvedValue([linkItem]);

      await LinkService.drainRetries();

      expect(mockedRetryQueue.defer).toHaveBeenCalledWith('q-link', 2);
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    });

    it('leaves a foreign-owner queued item untouched', async () => {
      givenEstablishedLink();
      const foreignOwned: DeliveryQueueItem = {
        ...linkItem,
        payload: JSON.stringify({
          type: LINK_RETRY_PAYLOAD_TYPE,
          ownerPubky: OTHER_OWNER,
          peerPubky: PEER,
          senderPubky: OTHER_OWNER,
          kind: CHAT_MESSAGE_KIND,
          eventId: EVENT_ID,
          rawJson: wireMessage(EVENT_ID),
        }),
      };
      mockedRetryQueue.getDue.mockResolvedValue([foreignOwned]);
      mockedStorage.listDeliveryQueue.mockResolvedValue([foreignOwned]);

      await LinkService.drainRetries();
      await LinkService.recoverPendingSends();

      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
      expect(mockedRetryQueue.recordSuccess).not.toHaveBeenCalled();
      expect(mockedRetryQueue.defer).not.toHaveBeenCalled();
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
      expect(mockedNative.removeReceiverMarker).toHaveBeenCalledWith(
        SESSION_ALIAS,
        LINK_RECEIVER_PATH,
      );
      const unpublishOrder = mockedNative.removeReceiverMarker.mock.invocationCallOrder[0]!;
      const signOutOrder = mockedNative.signOutSession.mock.invocationCallOrder[0]!;
      expect(unpublishOrder).toBeLessThan(signOutOrder);
      expect(mockedNative.signOutSession).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedNative.clearAllNativeSecrets).toHaveBeenCalled();
      const wipeOrder = mockedNative.clearAllNativeSecrets.mock.invocationCallOrder[0]!;
      expect(signOutOrder).toBeLessThan(wipeOrder);
      expect(mockedStorage.clearAccountData).toHaveBeenCalledWith(OWNER);
      expect(mockedStorage.removeFromQueue).toHaveBeenCalledWith('q-mine');
      expect(mockedStorage.removeFromQueue).not.toHaveBeenCalledWith('q-other');
      expect(LinkService.hasSession()).toBe(false);
    });

    it('calls clearAllNativeSecrets while the current-owner identity is still readable', async () => {
      mockedKeyStore.deleteLinkSession.mockClear();
      mockedNative.clearAllNativeSecrets.mockClear();
      mockedNative.clearAllNativeSecrets.mockImplementation(async () => {
        expect(mockedKeyStore.getPubky()).toBe(OWNER);
        expect(mockedKeyStore.deleteLinkSession).not.toHaveBeenCalled();
      });

      await LinkService.clearSession();

      expect(mockedNative.clearAllNativeSecrets).toHaveBeenCalledTimes(1);
      expect(mockedKeyStore.deleteLinkSession).toHaveBeenCalled();
      const wipeOrder = mockedNative.clearAllNativeSecrets.mock.invocationCallOrder[0]!;
      const identityDropOrder = mockedKeyStore.deleteLinkSession.mock.invocationCallOrder[0]!;
      expect(wipeOrder).toBeLessThan(identityDropOrder);
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

  describe('owner homeserver writes', () => {
    it('puts through the Paykit session alias, not an AppKey', async () => {
      mockedNative.putPublic.mockResolvedValue(undefined);
      const url = `pubky://${OWNER}/pub/hypercolor.app/v1/backup/latest`;
      await LinkService.putOwnerDocument(url, 'ciphertext');
      expect(mockedNative.putPublic).toHaveBeenCalledWith(
        SESSION_ALIAS,
        url,
        'ciphertext',
        'https://homeserver.example',
      );
    });

    it('rejects owner writes when no Paykit session exists', async () => {
      await LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue(null);
      await expect(
        LinkService.putOwnerDocument(`pubky://${OWNER}/pub/hypercolor.app/v1/backup/latest`, 'x'),
      ).rejects.toMatchObject({
        code: 'auth',
      });
      expect(mockedNative.putPublic).not.toHaveBeenCalled();
    });
  });
});
