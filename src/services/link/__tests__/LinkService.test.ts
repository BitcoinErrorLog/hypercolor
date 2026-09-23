import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
  HANDSHAKE_PENDING_ADVANCE_LIMIT,
  LINK_RETRY_PAYLOAD_TYPE,
  LINK_CONTROL_PAYLOAD_TYPE,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  LinkService,
  linkQueueEntryCountForTests,
  resetLinkServiceHarnessState,
  stopLinkRetryDrain,
} from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import { PaykitSdkNative, SdkOperationError } from '../PaykitSdkNative';
import { seedPaykitSdkJestMock } from './paykitSdkJestMock';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { RetryQueue } from '../../RetryQueue';
import { paintOwner, resetPaintOverlayForBoot } from '../../paintedOwner';
import { COPY } from '../../../copy/uxCopy';
import { wireSignOutMarkerMocks } from '../../__tests__/wireSignOutMarkerMocks';
import {
  CHAT_MESSAGE_KIND,
  CHAT_DELETE_KIND,
  CHAT_RECEIPT_KIND,
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
import { FollowsImportSettings } from '../../contacts/followsImportSettings';
import { LinkSendError } from '../LinkSendError';
import * as ChatKindsAdvertisement from '../chatKindsAdvertisement';
import { PAYKIT_PAYMENT_REQUEST_KIND } from '../../../types/payment';
import { GROUP_MESSAGE_KIND } from '../../../types/group';
import {
  ATTACHMENT_ALGORITHM,
  ATTACHMENT_KEY_PLACEHOLDER,
  CHAT_ATTACHMENT_KIND,
} from '../../../types/attachment';
import { cachePathsForAttachment, deleteCacheFiles } from '../../attachments/fileIo';
import {
  finishConnectDelegation,
  resetConnectDelegationForTests,
  tryBeginConnectDelegation,
} from '../../../ui/connectDelegationStart';

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
    adoptAuthSession: jest.fn(),
    reconcileAdoptedSessions: jest.fn(),
    stopAuthKeepalive: jest.fn(),
    cancelAuthFlow: jest.fn(),
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
    sessionCapabilities: jest.fn(),
  },
  isLinkNativeError: (err: unknown) => {
    if (typeof err !== 'object' || err === null) return false;
    const code = (err as { code?: unknown }).code;
    return (
      typeof code === 'string' &&
      [
        'network',
        'auth',
        'protocol',
        'consumed',
        'validation',
        'unavailable',
        'auth_flow_cancelled',
      ].includes(code)
    );
  },
  createLinkNativeError: (code: string, message: string) => ({ code, message }),
  toLinkNativeError: (err: unknown) => err,
}));

jest.mock('../../StorageService', () => ({
  StorageService: {
    upsertLinkReceiver: jest.fn(),
    getLinkReceiver: jest.fn(),
    getChatKindsAdvertiseRetry: jest.fn(),
    saveChatKindsAdvertiseRetry: jest.fn(),
    recordChatKindsAdvertiseRetryFailure: jest.fn(),
    clearChatKindsAdvertiseRetry: jest.fn(),
    upsertLink: jest.fn(),
    upsertArchivedLink: jest.fn(),
    getArchivedLink: jest.fn(),
    deleteArchivedLink: jest.fn(),
    getLink: jest.fn(),
    getAllLinks: jest.fn(),
    recordLastSeenPeerMarkerPk: jest.fn(),
    recordPeerChatKindsV: jest.fn(),
    getDueHandshakingLinks: jest.fn(),
    updateLinkSnapshot: jest.fn(),
    markLinkReconnectRequired: jest.fn(),
    getHandshakeBudget: jest.fn(),
    upsertHandshakeBudget: jest.fn(),
    clearHandshakeBudget: jest.fn(),
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
    failLinkMessageAndDequeue: jest.fn(),
    saveLinkStreamItems: jest.fn(),
    getUnprocessedLinkStreamItems: jest.fn(),
    markLinkStreamItemProcessed: jest.fn(),
    savePendingChatDelete: jest.fn(),
    listPendingChatDeletes: jest.fn(),
    deletePendingChatDelete: jest.fn(),
    listPendingChatTags: jest.fn(),
    deletePendingChatTag: jest.fn(),
    getLinkReadCursor: jest.fn(),
    setLinkReadCursor: jest.fn(),
    getChatDevicePrefs: jest.fn(),
    persistControlSendIntent: jest.fn(),
    finalizeControlSend: jest.fn(),
    clearAccountData: jest.fn(),
    persistSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
    hasSignOutIncompleteJournal: jest.fn().mockResolvedValue(false),
    getSignOutIncompleteJournalOwner: jest.fn().mockResolvedValue(null),
    clearSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
    retryPendingCleanup: jest.fn(),
    markGroupEventSeen: jest.fn(),
    listDeliveryQueue: jest.fn(),
    listPaymentRequestsWithPendingEvent: jest.fn().mockResolvedValue([]),
    getPaymentRequestByEventId: jest.fn(),
    getLinkMessageByEventId: jest.fn(),
    tombstoneLinkMessage: jest.fn(),
    getGroupMember: jest.fn(),
    getGroupMessage: jest.fn(),
    listGroupMessages: jest.fn().mockResolvedValue([]),
    applyMonotonicDelivery: jest.fn(),
    upsertChatTag: jest.fn(),
    saveGroupDeferred: jest.fn(),
    hasQueueItemForMessage: jest.fn(),
    clearPaymentPendingEvent: jest.fn(),
    enqueue: jest.fn(),
    hasQueueItem: jest.fn(),
    removeFromQueue: jest.fn(),
    getContact: jest.fn(),
    getAllContacts: jest.fn(),
    getMessageRequest: jest.fn(),
    upsertMessageRequest: jest.fn(),
    acceptDeclinedMessageRequest: jest.fn(),
    deleteMessageRequest: jest.fn(),
    listMessageRequests: jest.fn(),
    countPendingMessageRequests: jest.fn(),
    deleteLinkStreamItemsForPeer: jest.fn(),
    deleteLinkMessagesForPeer: jest.fn(),
    countLinkMessagesForPeer: jest.fn(),
    settleExcessUnprocessedLinkStreamItems: jest.fn(),
    deleteGroupDeferredForSender: jest.fn(),
    deleteGroupSeenEventsForSender: jest.fn(),
    setContactRelationshipFlags: jest.fn(),
    hasGroupMessage: jest.fn(),
    finalizeGroupFanoutSend: jest.fn(),
    countDeliveryQueueForMessage: jest.fn(),
    upsertGroupFanoutOutcome: jest.fn(),
    listGroupFanoutOutcomes: jest.fn(),
    updateGroupMessageDeliveryState: jest.fn(),
    completeGroupFanoutRecipient: jest.fn(),
    getGroupFanoutAggregate: jest.fn(),
    listBlockedPeers: jest.fn(),
    listBlockedPeerCleanupPending: jest.fn(),
    setBlockedPeerCleanupPending: jest.fn(),
    insertBlockedPeer: jest.fn(),
    insertBlockedPeers: jest.fn(),
    deleteBlockedPeer: jest.fn(),
    saveAttachment: jest.fn(),
    getAttachment: jest.fn(),
    hasAttachment: jest.fn(),
    updateAttachmentResolve: jest.fn(),
    updateAttachmentDelivery: jest.fn(),
    journalAttachmentCacheCleanup: jest.fn(),
    journalAttachmentKeyCleanup: jest.fn(),
    completePendingCleanup: jest.fn(),
  },
}));

jest.mock('../../../db', () => ({
  getDb: jest.fn().mockResolvedValue({
    executeSync: jest.fn(),
  }),
}));

jest.mock('../../group/applyGroupInbound', () => ({
  applyGroupInbound: jest.fn().mockResolvedValue('applied'),
}));

jest.mock('../../attachments/applyAttachmentInbound', () => ({
  applyAttachmentInbound: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../attachments/fileIo', () => ({
  cachePathsForAttachment: jest.fn(() => []),
  deleteCacheFiles: jest.fn().mockResolvedValue(undefined),
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
    setHomeserver: jest.fn(),
    getLinkSession: jest.fn(),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
    deleteLinkSessionIfAlias: jest.fn(),
    isInitialized: jest.fn(),
    readLinkSession: jest.fn(),
    markSignOutIncomplete: jest.fn(),
    isSignOutIncomplete: jest.fn(() => false),
    getSignOutIncompleteOwner: jest.fn(() => null),
    clearSignOutIncomplete: jest.fn(),
    setAttachmentSecret: jest.fn(),
    getAttachmentSecret: jest.fn(),
    deleteAttachmentSecrets: jest.fn(),
    deleteAttachmentSecret: jest.fn(),
    attachmentKeyService: jest.fn(
      (owner: string, sender: string, eventId: string) =>
        `hypercolor-attachment-key:${owner}:${sender}:${eventId}`,
    ),
  },
}));

jest.mock('../../RetryQueue', () => ({
  RetryQueue: {
    getDue: jest.fn(),
    nextAttemptAt: jest.fn(),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
    defer: jest.fn(),
    wouldDrop: jest.fn((attempts: number) => attempts + 1 >= 10),
  },
}));

jest.mock('uuid', () => ({ v4: jest.fn() }));

const LEGACY_NATIVE = [
  'initiateLink',
  'acceptLink',
  'advanceHandshake',
  'probeInboundLink',
  'restoreLink',
  'restoreHandshake',
  'clearLinkOutbox',
] as const;
const mockedNative = jest.mocked(PaykitLinkNative) as unknown as jest.Mocked<
  typeof PaykitLinkNative
> &
  Record<(typeof LEGACY_NATIVE)[number], jest.Mock>;
for (const name of LEGACY_NATIVE) {
  if (typeof mockedNative[name] !== 'function') mockedNative[name] = jest.fn();
}
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
  receiverRole: 'active',
  lastSeenOwnMarkerPk: null,
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
    lastSeenPeerMarkerPk: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
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

type SdkEnsureState =
  | 'LINKED'
  | 'LINKING'
  | 'BLOCKED'
  | 'UNKNOWN'
  | 'RECOVERY_REQUIRED'
  | 'NOT_LINKED';

function mockSdkEnsure(
  state: SdkEnsureState,
  role: 'INITIATOR' | 'RESPONDER' | 'UNKNOWN' = 'INITIATOR',
): void {
  jest
    .mocked(PaykitSdkNative.ensureLinkWithPeer)
    .mockImplementation(async (ownerPubky: string, peerPubky: string) => ({
      counterparty: peerPubky,
      path: 'hypercolor/wallet',
      state,
      generation: '1',
      role,
      leaseSkipped: false,
      ownerPubky,
    }));
}

async function switchOwnerDuringSdkEnsure(): Promise<void> {
  jest.mocked(PaykitSdkNative.ensureLinkWithPeer).mockImplementation(async () => {
    mockedNative.signinWithSecret.mockResolvedValue({
      sessionAlias: 'session-b',
      pubky: OTHER_OWNER,
    });
    mockedKeyStore.getPubky.mockReturnValue(OTHER_OWNER);
    await LinkService.signinWithSecret('owner-b-secret');
    return {
      counterparty: PEER,
      path: 'hypercolor/wallet',
      state: 'LINKING' as const,
      generation: '1',
      role: 'INITIATOR' as const,
      leaseSkipped: false,
      ownerPubky: OWNER,
    };
  });
}

function givenEstablishedLink(): void {
  mockedStorage.getLink.mockResolvedValue(storedLink({ status: 'established', snapshot: 'est-1' }));
  mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-1' });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
  it('keeps native outbox clearing out of local link recovery', () => {
    const source = readFileSync(resolve(__dirname, '../LinkService.ts'), 'utf8');
    expect(source).not.toContain('clearLinkOutbox(');
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    seedPaykitSdkJestMock();
    for (const name of LEGACY_NATIVE) {
      if (typeof mockedNative[name] !== 'function') mockedNative[name] = jest.fn();
    }
    resetLinkServiceHarnessState();
    resetPaintOverlayForBoot();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    mockedUuid.mockReturnValueOnce(EVENT_ID).mockReturnValue(QUEUE_ID);
    resetConnectDelegationForTests();

    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signinWithSecret.mockResolvedValue({ sessionAlias: SESSION_ALIAS, pubky: OWNER });
    mockedNative.adoptAuthSession.mockResolvedValue(undefined);
    mockedNative.reconcileAdoptedSessions.mockResolvedValue(undefined);
    mockedNative.signOutSession.mockResolvedValue(undefined);
    mockedNative.clearAllNativeSecrets.mockResolvedValue(undefined);
    mockedNative.stopAuthKeepalive.mockResolvedValue(undefined);
    mockedNative.cancelAuthFlow.mockResolvedValue(undefined);
    mockedNative.sessionCapabilities.mockResolvedValue({
      capabilities: '/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw',
      origin: 'https://homeserver.example',
    });
    mockedNative.closeLink.mockResolvedValue(undefined);
    mockedNative.probeInboundLink.mockResolvedValue({ result: 'none' });
    mockedNative.getReceiverPublicKey.mockResolvedValue(PEER_NOISE);
    mockedNative.getReceiverMarker.mockImplementation(async (who: string) => {
      if (who === OWNER) return null;
      return { noisePublicKey: PEER_NOISE };
    });
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedKeyStore.isInitialized.mockReturnValue(true);
    mockedKeyStore.attachmentKeyService.mockImplementation(
      (owner: string, sender: string, eventId: string) =>
        `hypercolor-attachment-key:${owner}:${sender}:${eventId}`,
    );
    mockedKeyStore.getLinkSession.mockReturnValue(null);
    mockedKeyStore.setLinkSession.mockImplementation((alias: string) => {
      mockedKeyStore.getLinkSession.mockReturnValue(alias);
    });
    mockedKeyStore.deleteLinkSession.mockImplementation(() => {
      mockedKeyStore.getLinkSession.mockReturnValue(null);
    });
    mockedKeyStore.readLinkSession.mockImplementation(() => ({
      ok: true,
      alias: mockedKeyStore.getLinkSession() ?? null,
    }));
    mockedKeyStore.deleteLinkSessionIfAlias.mockImplementation((alias: string) => {
      if (mockedKeyStore.getLinkSession() !== alias) return false;
      mockedKeyStore.deleteLinkSession();
      return true;
    });
    wireSignOutMarkerMocks(mockedKeyStore, mockedStorage);
    mockedStorage.getLinkReceiver.mockResolvedValue(receiverRow);
    mockedStorage.getLink.mockResolvedValue(null);
    mockedStorage.recordLastSeenPeerMarkerPk.mockResolvedValue(undefined);
    mockedStorage.recordPeerChatKindsV.mockResolvedValue(undefined);
    mockedStorage.getChatDevicePrefs.mockResolvedValue({
      receiptsEnabled: true,
      typingEnabled: true,
    });
    mockedStorage.persistControlSendIntent.mockResolvedValue(undefined);
    mockedStorage.finalizeControlSend.mockResolvedValue(undefined);
    mockedStorage.getLinkMessagesForConversation.mockResolvedValue([]);
    mockedStorage.getLinkReadCursor.mockResolvedValue(null);
    mockedNative.putPublic.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    mockedStorage.getAllLinks.mockResolvedValue([]);
    mockedStorage.getDueHandshakingLinks.mockResolvedValue([]);
    mockedStorage.getHandshakeBudget.mockResolvedValue(null);
    mockedStorage.upsertHandshakeBudget.mockResolvedValue(undefined);
    mockedStorage.clearHandshakeBudget.mockResolvedValue(undefined);
    mockedStorage.persistLinkSendIntent.mockResolvedValue(undefined);
    mockedStorage.resetLinkConsecutiveFailures.mockResolvedValue(undefined);
    mockedStorage.hasQueueItem.mockResolvedValue(true);
    mockedStorage.listDeliveryQueue.mockResolvedValue([]);
    mockedStorage.listPaymentRequestsWithPendingEvent.mockResolvedValue([]);
    mockedStorage.retryPendingCleanup.mockResolvedValue(undefined);
    mockedStorage.journalAttachmentCacheCleanup.mockResolvedValue(undefined);
    mockedStorage.journalAttachmentKeyCleanup.mockResolvedValue(undefined);
    mockedStorage.completePendingCleanup.mockResolvedValue(undefined);
    mockedStorage.tombstoneLinkMessage.mockResolvedValue(true);
    mockedStorage.markGroupEventSeen.mockResolvedValue(undefined);
    mockedStorage.hasLinkMessage.mockResolvedValue(false);
    mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValue([]);
    mockedStorage.savePendingChatDelete.mockResolvedValue(undefined);
    mockedStorage.listPendingChatDeletes.mockResolvedValue([]);
    mockedStorage.deletePendingChatDelete.mockResolvedValue(undefined);
    mockedStorage.listPendingChatTags.mockResolvedValue([]);
    mockedStorage.deletePendingChatTag.mockResolvedValue(undefined);
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
    mockedStorage.acceptDeclinedMessageRequest.mockResolvedValue(false);
    mockedStorage.upsertGroupFanoutOutcome.mockResolvedValue(undefined);
    mockedStorage.listGroupFanoutOutcomes.mockResolvedValue([]);
    mockedStorage.completeGroupFanoutRecipient.mockResolvedValue(undefined);
    mockedStorage.failLinkMessageAndDequeue.mockResolvedValue(undefined);
    mockedStorage.getGroupFanoutAggregate.mockResolvedValue([]);
    mockedStorage.listBlockedPeers.mockResolvedValue([]);
    mockedStorage.listBlockedPeerCleanupPending.mockResolvedValue([]);
    mockedStorage.setBlockedPeerCleanupPending.mockResolvedValue(undefined);
    mockedStorage.insertBlockedPeer.mockResolvedValue(undefined);
    mockedStorage.deleteBlockedPeer.mockResolvedValue(undefined);
    mockedRetryQueue.wouldDrop.mockImplementation((attempts: number) => attempts + 1 >= 10);
    FollowsImportSettings.resetForTests();
    mockedStorage.deleteLinkStreamItemsForPeer.mockResolvedValue(undefined);
    mockedStorage.deleteLinkMessagesForPeer.mockResolvedValue(undefined);
    mockedStorage.getLinkMessage.mockResolvedValue(sendingRow());
    mockedRetryQueue.getDue.mockResolvedValue([]);
    // Same curve as the real queue so backoff assertions stay honest.
    mockedRetryQueue.nextAttemptAt.mockImplementation(
      attempts => Date.now() + Math.min(15_000 * Math.pow(2, attempts), 30 * 60 * 1000),
    );

    await LinkService.clearSession();
    mockedKeyStore.clearSignOutIncomplete();
    await mockedStorage.clearSignOutIncompleteJournal();
    await LinkService.signinWithSecret('signin-secret-hex');
    paintOwner(OWNER);
  });

  afterEach(() => {
    stopLinkRetryDrain();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('session', () => {
    it('does not delete a foreign receiver marker on sign-out', async () => {
      mockedNative.getReceiverPublicKey.mockResolvedValue('local-noise-pk');
      mockedNative.getReceiverMarker.mockResolvedValue({
        noisePublicKey: 'foreign-noise-pk',
      });
      mockedNative.removeReceiverMarker.mockClear();

      await LinkService.clearSession();

      expect(mockedNative.removeReceiverMarker).not.toHaveBeenCalled();
    });

    it('tears down a previously adopted alias before adopting a different one', async () => {
      givenEstablishedLink();
      await LinkService.ensureLinkWith(PEER);
      mockedStorage.getAllLinks.mockResolvedValue([
        storedLink({ status: 'established', snapshot: 'est-1' }),
      ]);
      mockedNative.getReceiverPublicKey.mockResolvedValue(PEER_NOISE);
      mockedNative.getReceiverMarker.mockResolvedValue({
        noisePublicKey: PEER_NOISE,
      });
      mockedNative.closeLink.mockClear();
      mockedNative.removeReceiverMarker.mockClear();
      mockedNative.signOutSession.mockClear();
      mockedNative.clearAllNativeSecrets.mockClear();
      mockedStorage.clearAccountData.mockClear();
      mockedNative.adoptAuthSession.mockClear();
      mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);
      mockedKeyStore.isInitialized.mockReturnValue(true);
      mockedKeyStore.deleteLinkSessionIfAlias.mockReturnValue(true);

      await LinkService.adoptApprovedSession('session-alias-2', OTHER_OWNER);

      expect(mockedNative.closeLink).not.toHaveBeenCalled();
      expect(mockedNative.removeReceiverMarker).toHaveBeenCalledWith(
        SESSION_ALIAS,
        LINK_RECEIVER_PATH,
      );
      const unpublishOrder = mockedNative.removeReceiverMarker.mock.invocationCallOrder[0]!;
      const signOutOrder = mockedNative.signOutSession.mock.invocationCallOrder[0]!;
      expect(unpublishOrder).toBeLessThan(signOutOrder);
      expect(mockedNative.signOutSession).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedKeyStore.deleteLinkSessionIfAlias).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedNative.clearAllNativeSecrets).not.toHaveBeenCalled();
      expect(mockedStorage.clearAccountData).not.toHaveBeenCalled();
      expect(mockedNative.adoptAuthSession).toHaveBeenCalledWith('session-alias-2');
      expect(mockedKeyStore.setPubky).toHaveBeenCalledWith(OTHER_OWNER);
    });

    it('does not sign out or clear on same-alias re-adopt', async () => {
      givenEstablishedLink();
      await LinkService.ensureLinkWith(PEER);
      mockedNative.closeLink.mockClear();
      mockedNative.removeReceiverMarker.mockClear();
      mockedNative.signOutSession.mockClear();
      mockedNative.clearAllNativeSecrets.mockClear();
      mockedStorage.clearAccountData.mockClear();
      mockedNative.adoptAuthSession.mockClear();
      mockedKeyStore.deleteLinkSessionIfAlias.mockClear();
      mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);
      mockedKeyStore.isInitialized.mockReturnValue(true);

      await LinkService.adoptApprovedSession(SESSION_ALIAS, OWNER);

      expect(mockedNative.signOutSession).not.toHaveBeenCalled();
      expect(mockedNative.removeReceiverMarker).not.toHaveBeenCalled();
      expect(mockedNative.closeLink).not.toHaveBeenCalled();
      expect(mockedKeyStore.deleteLinkSessionIfAlias).not.toHaveBeenCalled();
      expect(mockedNative.clearAllNativeSecrets).not.toHaveBeenCalled();
      expect(mockedStorage.clearAccountData).not.toHaveBeenCalled();
      expect(mockedNative.adoptAuthSession).toHaveBeenCalledWith(SESSION_ALIAS);
    });

    it('persists the session alias on signinWithSecret (dev/e2e path)', () => {
      expect(mockedNative.signinWithSecret).toHaveBeenCalledWith('signin-secret-hex');
      expect(mockedNative.adoptAuthSession).toHaveBeenCalledWith(SESSION_ALIAS);
      const adoptOrder = mockedNative.adoptAuthSession.mock.invocationCallOrder[0]!;
      const storeOrder = mockedKeyStore.setLinkSession.mock.invocationCallOrder[0]!;
      expect(storeOrder).toBeLessThan(adoptOrder);
      expect(mockedKeyStore.setLinkSession).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedKeyStore.setPubky).toHaveBeenCalledWith(OWNER);
      expect(LinkService.hasSession()).toBe(true);
    });

    it('restores a persisted session alias', async () => {
      await LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);
      mockedNative.restoreSession.mockResolvedValue({ pubky: OWNER });
      mockedNative.reconcileAdoptedSessions.mockClear();

      await expect(LinkService.restorePersistedSession()).resolves.toBe(true);

      expect(mockedNative.reconcileAdoptedSessions).not.toHaveBeenCalled();
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
      resetLinkServiceHarnessState();
      mockedKeyStore.deleteLinkSession.mockClear();
      mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);
      mockedNative.restoreSession.mockRejectedValue({ code: 'network', message: 'timeout' });

      await expect(LinkService.restorePersistedSession()).resolves.toBe(false);

      expect(mockedKeyStore.deleteLinkSession).not.toHaveBeenCalled();
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('session-offline');
    });

    it('does not reconcile native aliases from restorePersistedSession', async () => {
      await LinkService.clearSession();
      mockedNative.reconcileAdoptedSessions.mockClear();
      mockedKeyStore.getLinkSession.mockReturnValue(null);
      mockedKeyStore.readLinkSession.mockReturnValue({ ok: true, alias: null });

      await expect(LinkService.restorePersistedSession()).resolves.toBe(false);

      expect(mockedNative.reconcileAdoptedSessions).not.toHaveBeenCalled();
      expect(mockedNative.restoreSession).not.toHaveBeenCalled();
    });

    it('boot-reconciles a ready empty KeyStore without treating unread as empty', async () => {
      resetLinkServiceHarnessState();
      mockedNative.reconcileAdoptedSessions.mockClear();
      mockedKeyStore.isInitialized.mockReturnValue(true);
      mockedKeyStore.readLinkSession.mockReturnValue({ ok: true, alias: null });

      await LinkService.reconcileAdoptedSessionsAtBoot();

      expect(mockedNative.reconcileAdoptedSessions).toHaveBeenCalledWith(null);
    });

    it('does not boot-reconcile when KeyStore is not ready', async () => {
      resetLinkServiceHarnessState();
      mockedNative.reconcileAdoptedSessions.mockClear();
      mockedKeyStore.isInitialized.mockReturnValue(false);
      mockedKeyStore.readLinkSession.mockReturnValue({ ok: false });

      await LinkService.reconcileAdoptedSessionsAtBoot();

      expect(mockedNative.reconcileAdoptedSessions).not.toHaveBeenCalled();
    });

    it('does not boot-reconcile when KeyStore read fails', async () => {
      resetLinkServiceHarnessState();
      mockedNative.reconcileAdoptedSessions.mockClear();
      mockedKeyStore.isInitialized.mockReturnValue(true);
      mockedKeyStore.readLinkSession.mockReturnValue({ ok: false });

      await LinkService.reconcileAdoptedSessionsAtBoot();

      expect(mockedNative.reconcileAdoptedSessions).not.toHaveBeenCalled();
    });

    it('skips boot reconcile while an enable generation is in flight', async () => {
      resetLinkServiceHarnessState();
      mockedKeyStore.isInitialized.mockReturnValue(true);
      mockedKeyStore.readLinkSession.mockReturnValue({ ok: true, alias: null });
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-boot',
        authorizationUrl: 'pubkyauth://grant',
      });

      const flow = await LinkService.enable();
      mockedNative.reconcileAdoptedSessions.mockClear();
      await LinkService.reconcileAdoptedSessionsAtBoot();
      expect(mockedNative.reconcileAdoptedSessions).not.toHaveBeenCalled();
      flow.cancel();
    });

    it('skips boot reconcile while Connect delegation is in flight', async () => {
      resetLinkServiceHarnessState();
      mockedKeyStore.isInitialized.mockReturnValue(true);
      mockedKeyStore.readLinkSession.mockReturnValue({ ok: true, alias: null });
      const token = tryBeginConnectDelegation();
      expect(token).not.toBeNull();
      mockedNative.reconcileAdoptedSessions.mockClear();
      await LinkService.reconcileAdoptedSessionsAtBoot();
      expect(mockedNative.reconcileAdoptedSessions).not.toHaveBeenCalled();
      finishConnectDelegation(token as number);
      await LinkService.reconcileAdoptedSessionsAtBoot();
      expect(mockedNative.reconcileAdoptedSessions).toHaveBeenCalledWith(null);
    });

    it('latches boot reconcile so a second call in the same process is a no-op', async () => {
      resetLinkServiceHarnessState();
      mockedKeyStore.isInitialized.mockReturnValue(true);
      mockedKeyStore.readLinkSession.mockReturnValue({ ok: true, alias: SESSION_ALIAS });
      mockedNative.reconcileAdoptedSessions.mockClear();
      await LinkService.reconcileAdoptedSessionsAtBoot();
      await LinkService.reconcileAdoptedSessionsAtBoot();
      expect(mockedNative.reconcileAdoptedSessions).toHaveBeenCalledTimes(1);
    });

    it('does not keep KeyStore when adoptHarnessSession restore refuses a pending alias', async () => {
      await LinkService.clearSession();
      mockedKeyStore.setLinkSession.mockClear();
      mockedKeyStore.deleteLinkSession.mockClear();
      mockedKeyStore.setPubky.mockClear();
      mockedNative.adoptAuthSession.mockRejectedValue({
        code: 'unavailable',
        message: 'unavailable',
      });
      mockedNative.restoreSession.mockRejectedValue({
        code: 'unavailable',
        message: 'unavailable',
      });

      await expect(LinkService.adoptHarnessSession(SESSION_ALIAS, OWNER)).rejects.toEqual({
        code: 'unavailable',
        message: 'unavailable',
      });
      expect(mockedKeyStore.setLinkSession).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedNative.restoreSession).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedKeyStore.deleteLinkSession).toHaveBeenCalled();
      expect(mockedKeyStore.setPubky).not.toHaveBeenCalled();
      expect(LinkService.hasSession()).toBe(false);
    });

    it('does not keep KeyStore when adoptHarnessSession restore refuses an unknown alias', async () => {
      await LinkService.clearSession();
      mockedKeyStore.setLinkSession.mockClear();
      mockedKeyStore.deleteLinkSession.mockClear();
      mockedKeyStore.setPubky.mockClear();
      mockedNative.adoptAuthSession.mockRejectedValue({
        code: 'unavailable',
        message: 'unavailable',
      });
      mockedNative.restoreSession.mockRejectedValue({
        code: 'auth',
        message: 'session alias not found',
      });

      await expect(LinkService.adoptHarnessSession(SESSION_ALIAS, OWNER)).rejects.toEqual({
        code: 'auth',
        message: 'session alias not found',
      });
      expect(mockedNative.restoreSession).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedKeyStore.deleteLinkSession).toHaveBeenCalled();
      expect(mockedKeyStore.setPubky).not.toHaveBeenCalled();
      expect(LinkService.hasSession()).toBe(false);
    });

    it('adoptHarnessSession is inert in production builds', async () => {
      const prior = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
      try {
        await LinkService.clearSession();
        mockedNative.adoptAuthSession.mockClear();
        mockedKeyStore.setLinkSession.mockClear();
        mockedKeyStore.setPubky.mockClear();
        await expect(LinkService.adoptHarnessSession(SESSION_ALIAS, OWNER)).rejects.toEqual({
          code: 'unavailable',
          message: 'adoptHarnessSession is disabled in release builds',
        });
        expect(mockedNative.adoptAuthSession).not.toHaveBeenCalled();
        expect(mockedKeyStore.setLinkSession).not.toHaveBeenCalled();
        expect(mockedKeyStore.setPubky).not.toHaveBeenCalled();
        expect(LinkService.hasSession()).toBe(false);
      } finally {
        (globalThis as unknown as { __DEV__: boolean }).__DEV__ = prior;
      }
    });
  });

  describe('enable (Ring path)', () => {
    it('starts a combined Paykit + Hypercolor write grant, then provisions a native-owned receiver', async () => {
      mockedStorage.getLinkReceiver.mockResolvedValue(null);
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ status: 404, ok: false, text: async () => '' })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          text: async () =>
            '{"version":1,"kind":"hypercolor.receiver.capabilities","receiver_path":"hypercolor/wallet","chat_kinds_v":1}',
        }) as unknown as typeof fetch;
      mockedNative.getReceiverMarker
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ noisePublicKey: 'noise-pk' });
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
      const drainSpy = jest
        .spyOn(ChatKindsAdvertisement, 'drainChatKindsAdvertiseRetry')
        .mockResolvedValue(undefined);

      const flow = await LinkService.enable();
      expect(flow.authorizationUrl).toBe('pubkyauth://grant');
      expect(RING_GRANT_CAPABILITIES).toBe('/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw');
      expect(mockedNative.startAuthFlow).toHaveBeenCalledWith(RING_GRANT_CAPABILITIES);

      const enabled = await flow.awaitEnabled();

      expect(mockedNative.adoptAuthSession).toHaveBeenCalledWith('alias-2');
      const adoptOrder = mockedNative.adoptAuthSession.mock.invocationCallOrder.at(-1)!;
      const storeCalls = mockedKeyStore.setLinkSession.mock.invocationCallOrder;
      expect(storeCalls[storeCalls.length - 1]).toBeLessThan(adoptOrder);
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
      expect(mockedStorage.saveChatKindsAdvertiseRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: OWNER,
          sessionAlias: 'alias-2',
          noisePublicKey: 'noise-pk',
          nextRetryAt: expect.any(Number),
        }),
      );
      expect(drainSpy).toHaveBeenCalledWith(OWNER, 'alias-2');
      drainSpy.mockRestore();
      const aliasOrder = mockedStorage.upsertLinkReceiver.mock.invocationCallOrder[0]!;
      const publishOrder = mockedNative.publishReceiverMarker.mock.invocationCallOrder[0]!;
      expect(aliasOrder).toBeLessThan(publishOrder);
      expect(enabled).toEqual({
        pubky: OWNER,
        receiverPath: LINK_RECEIVER_PATH,
        noisePublicKey: 'noise-pk',
        receiverRole: 'active',
      });
    });

    it('resolves after marker confirmation when capability GET remains pending', async () => {
      jest.useFakeTimers();
      mockedStorage.getLinkReceiver.mockResolvedValue(null);
      mockedStorage.getChatKindsAdvertiseRetry.mockResolvedValue({
        ownerPubky: OWNER,
        sessionAlias: 'alias-2',
        noisePublicKey: 'noise-pk',
        nextRetryAt: 0,
        attempts: 0,
      });
      global.fetch = jest.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
      mockedNative.getReceiverMarker
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ noisePublicKey: 'noise-pk' });
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
      await expect(flow.awaitEnabled()).resolves.toEqual(
        expect.objectContaining({ receiverRole: 'active', noisePublicKey: 'noise-pk' }),
      );
      expect(mockedStorage.saveChatKindsAdvertiseRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: OWNER,
          sessionAlias: 'alias-2',
          noisePublicKey: 'noise-pk',
          nextRetryAt: expect.any(Number),
        }),
      );
      await jest.advanceTimersByTimeAsync(15_000);
      jest.useRealTimers();
    });

    it('does not persist KeyStore when adoptAuthSession rejects', async () => {
      mockedKeyStore.setLinkSession.mockClear();
      mockedKeyStore.deleteLinkSession.mockClear();
      mockedKeyStore.setPubky.mockClear();
      mockedNative.signOutSession.mockClear();
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });
      mockedNative.awaitAuthApproval.mockResolvedValue({
        sessionAlias: 'alias-orphan',
        pubky: OWNER,
      });
      mockedNative.adoptAuthSession.mockRejectedValue({
        code: 'unavailable',
        message: 'unavailable',
      });
      mockedNative.restoreSession.mockRejectedValue({
        code: 'unavailable',
        message: 'unavailable',
      });

      const flow = await LinkService.enable();
      await expect(flow.awaitEnabled()).rejects.toEqual({
        code: 'unavailable',
        message: 'unavailable',
      });
      expect(mockedKeyStore.setLinkSession).toHaveBeenCalledWith('alias-orphan');
      expect(mockedNative.restoreSession).toHaveBeenCalledWith('alias-orphan');
      expect(mockedKeyStore.deleteLinkSession).toHaveBeenCalled();
      expect(mockedKeyStore.setPubky).not.toHaveBeenCalled();
      expect(mockedNative.signOutSession).toHaveBeenCalledWith('alias-orphan');
      expect(mockedNative.publishReceiverMarker).not.toHaveBeenCalled();
    });

    it('does not restore on adopt unavailable when __DEV__ is false', async () => {
      const prior = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
      try {
        mockedKeyStore.setLinkSession.mockClear();
        mockedKeyStore.deleteLinkSession.mockClear();
        mockedKeyStore.setPubky.mockClear();
        mockedNative.signOutSession.mockClear();
        mockedNative.restoreSession.mockClear();
        mockedNative.startAuthFlow.mockResolvedValue({
          flowId: 'flow-prod',
          authorizationUrl: 'pubkyauth://grant',
        });
        mockedNative.awaitAuthApproval.mockResolvedValue({
          sessionAlias: 'alias-orphan',
          pubky: OWNER,
        });
        mockedNative.adoptAuthSession.mockRejectedValue({
          code: 'unavailable',
          message: 'unavailable',
        });

        const flow = await LinkService.enable();
        await expect(flow.awaitEnabled()).rejects.toEqual({
          code: 'unavailable',
          message: 'unavailable',
        });
        expect(mockedNative.restoreSession).not.toHaveBeenCalled();
        expect(mockedKeyStore.deleteLinkSession).toHaveBeenCalled();
        expect(mockedKeyStore.setPubky).not.toHaveBeenCalled();
        expect(mockedNative.signOutSession).toHaveBeenCalledWith('alias-orphan');
      } finally {
        (globalThis as unknown as { __DEV__: boolean }).__DEV__ = prior;
      }
    });

    it('does not drop a different working KeyStore alias on adopt failure', async () => {
      await LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue('working-alias');
      mockedKeyStore.setLinkSession.mockImplementation((alias: string) => {
        mockedKeyStore.getLinkSession.mockReturnValue(alias);
      });
      mockedKeyStore.deleteLinkSession.mockImplementation(() => {
        mockedKeyStore.getLinkSession.mockReturnValue(null);
      });
      mockedKeyStore.setPubky.mockClear();
      mockedNative.signinWithSecret.mockResolvedValue({
        sessionAlias: 'new-alias',
        pubky: OWNER,
      });
      mockedNative.adoptAuthSession.mockRejectedValue({
        code: 'protocol',
        message: 'fail',
      });

      await expect(LinkService.signinWithSecret('secret')).rejects.toEqual({
        code: 'protocol',
        message: 'fail',
      });
      expect(mockedKeyStore.getLinkSession()).toBe('working-alias');
      expect(mockedKeyStore.setLinkSession).toHaveBeenCalledWith('working-alias');
      expect(mockedKeyStore.setPubky).not.toHaveBeenCalled();
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
        receiverRole: 'active',
      });
    });

    it('stops auth keepalive in finally after awaitEnabled succeeds', async () => {
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

      expect(mockedNative.stopAuthKeepalive).toHaveBeenCalledWith('flow-1');
      const awaitOrder = mockedNative.awaitAuthApproval.mock.invocationCallOrder[0]!;
      const stopOrder = mockedNative.stopAuthKeepalive.mock.invocationCallOrder[0]!;
      expect(awaitOrder).toBeLessThan(stopOrder);
    });

    it('stops auth keepalive in finally when awaitAuthApproval rejects', async () => {
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });
      mockedNative.awaitAuthApproval.mockRejectedValue({
        code: 'network',
        message: 'network error',
      });

      const flow = await LinkService.enable();
      await expect(flow.awaitEnabled()).rejects.toEqual({
        code: 'network',
        message: 'network error',
      });
      expect(mockedNative.stopAuthKeepalive).toHaveBeenCalledWith('flow-1');
    });

    it('does not call native awaitAuthApproval after cancel', async () => {
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });

      const flow = await LinkService.enable();
      flow.cancel();
      await Promise.resolve();

      await expect(flow.awaitEnabled()).rejects.toThrow(
        'LinkService.enable: the messaging enable flow was cancelled',
      );
      expect(mockedNative.awaitAuthApproval).not.toHaveBeenCalled();
      expect(mockedNative.stopAuthKeepalive).toHaveBeenCalledWith('flow-1');
    });

    it('stops auth keepalive on cancel even if awaitEnabled was never called', async () => {
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });

      const flow = await LinkService.enable();
      flow.cancel();
      await Promise.resolve();

      expect(mockedNative.awaitAuthApproval).not.toHaveBeenCalled();
      expect(mockedNative.stopAuthKeepalive).toHaveBeenCalledWith('flow-1');
      expect(mockedNative.cancelAuthFlow).toHaveBeenCalledWith('flow-1');
    });

    it('calls cancelAuthFlow on cancel and not on releaseKeepalive', async () => {
      mockedNative.startAuthFlow
        .mockResolvedValueOnce({
          flowId: 'flow-cancel',
          authorizationUrl: 'pubkyauth://grant',
        })
        .mockResolvedValueOnce({
          flowId: 'flow-release',
          authorizationUrl: 'pubkyauth://grant',
        });

      const cancelled = await LinkService.enable();
      cancelled.cancel();
      await Promise.resolve();
      expect(mockedNative.cancelAuthFlow).toHaveBeenCalledWith('flow-cancel');
      expect(mockedNative.cancelAuthFlow).toHaveBeenCalledTimes(1);

      const released = await LinkService.enable();
      released.releaseKeepalive();
      await Promise.resolve();
      expect(mockedNative.cancelAuthFlow).toHaveBeenCalledTimes(1);
      expect(mockedNative.stopAuthKeepalive).toHaveBeenCalledWith('flow-release');
    });

    it('does not mask awaitEnabled success if stopAuthKeepalive rejects', async () => {
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });
      mockedNative.awaitAuthApproval.mockResolvedValue({
        sessionAlias: SESSION_ALIAS,
        pubky: OWNER,
      });
      mockedNative.getReceiverPublicKey.mockResolvedValue('existing-noise');
      mockedNative.stopAuthKeepalive.mockRejectedValue({
        code: 'unavailable',
        message: 'unavailable',
      });

      const flow = await LinkService.enable();
      await expect(flow.awaitEnabled()).resolves.toEqual({
        pubky: OWNER,
        receiverPath: LINK_RECEIVER_PATH,
        noisePublicKey: 'existing-noise',
        receiverRole: 'active',
      });
      expect(mockedNative.stopAuthKeepalive).toHaveBeenCalledWith('flow-1');
    });

    it('does not let a cancelled flow stop a newer attempt keepalive', async () => {
      mockedNative.startAuthFlow
        .mockResolvedValueOnce({
          flowId: 'flow-old',
          authorizationUrl: 'pubkyauth://grant',
        })
        .mockResolvedValueOnce({
          flowId: 'flow-new',
          authorizationUrl: 'pubkyauth://grant',
        });
      mockedNative.awaitAuthApproval.mockResolvedValue({
        sessionAlias: SESSION_ALIAS,
        pubky: OWNER,
      });
      mockedNative.getReceiverPublicKey.mockResolvedValue('existing-noise');

      const first = await LinkService.enable();
      const second = await LinkService.enable();
      first.cancel();
      await Promise.resolve();

      expect(mockedNative.stopAuthKeepalive).toHaveBeenCalledWith('flow-old');
      expect(mockedNative.stopAuthKeepalive.mock.calls.map(call => call[0])).toEqual(['flow-old']);

      await second.awaitEnabled();
      expect(mockedNative.stopAuthKeepalive).toHaveBeenCalledWith('flow-new');
    });

    it('does not sign out a late approval after releaseKeepalive', async () => {
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });
      const approval = deferred<{ sessionAlias: string; pubky: string }>();
      mockedNative.awaitAuthApproval.mockImplementation(() => approval.promise);
      mockedNative.getReceiverPublicKey.mockResolvedValue('existing-noise');
      mockedKeyStore.setPubky.mockClear();
      mockedNative.signOutSession.mockClear();

      const flow = await LinkService.enable();
      const enabled = flow.awaitEnabled();
      flow.releaseKeepalive();
      await Promise.resolve();
      expect(mockedNative.stopAuthKeepalive).toHaveBeenCalledWith('flow-1');

      approval.resolve({ sessionAlias: SESSION_ALIAS, pubky: OWNER });
      await expect(enabled).resolves.toEqual({
        pubky: OWNER,
        receiverPath: LINK_RECEIVER_PATH,
        noisePublicKey: 'existing-noise',
        receiverRole: 'active',
      });
      expect(mockedNative.signOutSession).not.toHaveBeenCalled();
      expect(mockedKeyStore.setPubky).toHaveBeenCalledWith(OWNER);
    });

    it('signs out a session that is approved after cancel', async () => {
      mockedNative.startAuthFlow.mockResolvedValue({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth://grant',
      });
      const approval = deferred<{ sessionAlias: string; pubky: string }>();
      mockedNative.awaitAuthApproval.mockImplementation(() => approval.promise);
      mockedKeyStore.setPubky.mockClear();
      mockedNative.signOutSession.mockClear();

      const flow = await LinkService.enable();
      const enabled = flow.awaitEnabled();
      flow.cancel();
      approval.resolve({ sessionAlias: SESSION_ALIAS, pubky: OWNER });
      await expect(enabled).rejects.toThrow(
        'LinkService.enable: the messaging enable flow was cancelled',
      );
      expect(mockedNative.signOutSession).toHaveBeenCalledWith(SESSION_ALIAS);
      expect(mockedKeyStore.setPubky).not.toHaveBeenCalled();
    });
  });

  describe('getLinkStatus', () => {
    it('reads persisted link state without initiating a handshake', async () => {
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ status: 'established', snapshot: 'est-1' }),
      );
      await expect(LinkService.getLinkStatus(PEER)).resolves.toBe('restoring');
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
      expect(mockedNative.restoreHandshake).not.toHaveBeenCalled();
      expect(mockedNative.restoreLink).not.toHaveBeenCalled();
      expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
    });

    it('maps a stored initiator handshake without calling native', async () => {
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ role: 'initiator', status: 'handshaking' }),
      );
      await expect(LinkService.getLinkStatus(PEER)).resolves.toBe('handshaking-initiator');
      expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();
    });

    it('does not treat a bare established row without snapshot as ready', async () => {
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ status: 'established', snapshot: '', role: 'initiator' }),
      );
      await expect(LinkService.getLinkStatus(PEER)).resolves.toBe('restoring');
      expect(mockedNative.restoreLink).not.toHaveBeenCalled();
    });

    it('surfaces a blocked established re-key as error, not ready', async () => {
      mockedStorage.getLink.mockResolvedValue(
        storedLink({
          status: 'established',
          snapshot: 'est-1',
          remoteNoisePublicKey: 'old-peer-pk',
          lastSeenPeerMarkerPk: 'new-peer-pk',
        }),
      );
      await expect(LinkService.getLinkStatus(PEER)).resolves.toBe('restoring');
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });
  });

  describe('ensureLinkWith — provisioning gates', () => {
    it('reports error when sign-out paint is active and there is no session', async () => {
      await LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue(null);
      mockedKeyStore.getPubky.mockReturnValue(null);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('error');
    });

    it('reports needs-enable when there is no session and no paint', async () => {
      resetLinkServiceHarnessState();
      resetPaintOverlayForBoot();
      mockedKeyStore.getLinkSession.mockReturnValue(null);
      mockedKeyStore.getPubky.mockReturnValue(null);
      mockedNative.isAvailable.mockReturnValue(false);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('needs-enable');
    });

    it('reports needs-enable when the receiver marker was never published', async () => {
      mockedStorage.getLinkReceiver.mockResolvedValue({ ...receiverRow, markerPublished: false });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('needs-enable');
    });

    it('links when the peer marker is absent because the SDK owns enrollment', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue(null);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');

      expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
      expect(PaykitSdkNative.ensureLinkWithPeer).toHaveBeenCalled();
    });

    it('reports native-missing when the native module is unavailable', async () => {
      mockedNative.isAvailable.mockReturnValue(false);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('native-missing');
    });
  });

  describe('ensureLinkWith — SDK managed link', () => {
    it('persists an SDK generation snapshot when ensure reports LINKED', async () => {
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');
      expect(PaykitSdkNative.ensureLinkWithPeer).toHaveBeenCalledWith(
        OWNER,
        PEER,
        LINK_RECEIVER_PATH,
      );
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'established', snapshot: 'sdk:1', role: 'initiator' }),
      );
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
      expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();
      expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
      expect(mockedNative.clearLinkOutbox).not.toHaveBeenCalled();
    });

    it('stores the responder role the SDK reports', async () => {
      mockSdkEnsure('LINKED', 'RESPONDER');
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'responder', snapshot: 'sdk:1', status: 'established' }),
      );
    });

    it('stops after the tick budget while the SDK stays LINKING', async () => {
      mockSdkEnsure('LINKING');
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-initiator');
      expect(PaykitSdkNative.ensureLinkWithPeer).toHaveBeenCalledTimes(
        HANDSHAKE_PENDING_ADVANCE_LIMIT,
      );
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'handshaking', snapshot: 'sdk:1', role: 'initiator' }),
      );
    });

    it('maps UNKNOWN and RECOVERY_REQUIRED to reconnect_required without failing the queue', async () => {
      mockSdkEnsure('UNKNOWN');
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('reconnect_required');
      expect(mockedStorage.failLinkMessageAndDequeue).not.toHaveBeenCalled();
      mockSdkEnsure('RECOVERY_REQUIRED');
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('reconnect_required');
      expect(mockedStorage.failLinkMessageAndDequeue).not.toHaveBeenCalled();
    });

    it('does not mark reconnect_required when ensure fails with transport', async () => {
      givenEstablishedLink();
      jest
        .mocked(PaykitSdkNative.ensureLinkWithPeer)
        .mockRejectedValue(new SdkOperationError('network', 'timeout'));
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('error');
      expect(mockedStorage.markLinkReconnectRequired).not.toHaveBeenCalled();
    });

    it('does not mark reconnect_required when ensure fails with protocol', async () => {
      givenEstablishedLink();
      jest
        .mocked(PaykitSdkNative.ensureLinkWithPeer)
        .mockRejectedValue(new SdkOperationError('protocol', 'bad'));
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('error');
      expect(mockedStorage.markLinkReconnectRequired).not.toHaveBeenCalled();
    });

    it('returns error when the SDK reports BLOCKED', async () => {
      mockSdkEnsure('BLOCKED');
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('error');
      expect(mockedNative.clearLinkOutbox).not.toHaveBeenCalled();
    });

    it('observes a recovery marker before ensure and skips ensure when recovery is required', async () => {
      jest.mocked(PaykitSdkNative.observeEncryptedLinkRecoveryMarker).mockResolvedValue({
        state: 'RECOVERY_REQUIRED',
        remoteMarkerChanged: true,
        localAttemptId: 'local',
        remoteAttemptId: 'remote',
      });
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('reconnect_required');
      expect(PaykitSdkNative.ensureLinkWithPeer).not.toHaveBeenCalled();
      expect(mockedStorage.failLinkMessageAndDequeue).not.toHaveBeenCalled();
    });

    it('treats an in-progress lease as handshaking when no live link exists', async () => {
      jest.mocked(PaykitSdkNative.ensureLinkWithPeer).mockResolvedValue({
        counterparty: PEER,
        path: 'hypercolor/wallet',
        state: 'LINKING',
        generation: '1',
        role: 'UNKNOWN',
        leaseSkipped: true,
      });
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-responder');
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
      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith('sdk-link', json);
      expect(mockedStorage.finalizeLinkSend).toHaveBeenCalledWith({
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: EVENT_ID,
        snapshot: 'sdk:sdk-queue-1',
        queueId: QUEUE_ID,
      });
      expect(message.deliveryState).toBe('sent');

      const persistOrder = mockedStorage.persistLinkSendIntent.mock.invocationCallOrder[0]!;
      const sendOrder = mockedNative.sendPrivateMessageJson.mock.invocationCallOrder[0]!;
      const finalizeOrder = mockedStorage.finalizeLinkSend.mock.invocationCallOrder[0]!;
      expect(persistOrder).toBeLessThan(sendOrder);
      expect(sendOrder).toBeLessThan(finalizeOrder);
    });

    it('blocks sendDm on standby when a handshaking row already exists, without queuing', async () => {
      mockedStorage.getLinkReceiver.mockResolvedValue({
        ...receiverRow,
        receiverRole: 'standby',
      });
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ status: 'handshaking', role: 'initiator', snapshot: 'hs-wedge' }),
      );

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toMatchObject({
        code: 'standby-not-receiving',
        message: COPY.standbyComposerNotice,
      });
      expect(mockedNative.restoreHandshake).not.toHaveBeenCalled();
      expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
      expect(mockedStorage.persistLinkSendIntent).not.toHaveBeenCalled();
    });

    it('blocks sendDm on standby when no link is established, without queuing', async () => {
      mockedStorage.getLinkReceiver.mockResolvedValue({
        ...receiverRow,
        receiverRole: 'standby',
      });
      mockedStorage.getLink.mockResolvedValue(null);

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toMatchObject({
        code: 'standby-not-receiving',
        message: COPY.standbyComposerNotice,
      });
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
      expect(mockedStorage.persistLinkSendIntent).not.toHaveBeenCalled();
    });

    it('allows sendDm on standby when the link is already established', async () => {
      mockedStorage.getLinkReceiver.mockResolvedValue({
        ...receiverRow,
        receiverRole: 'standby',
      });
      givenEstablishedLink();
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-2' });

      const message = await LinkService.sendDm(PEER, 'hello');
      expect(message.deliveryState).toBe('sent');
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('marks failed and throws when the native send fails (retry item kept)', async () => {
      givenEstablishedLink();
      mockedNative.sendPrivateMessageJson.mockRejectedValue({
        code: 'protocol',
        message: 'protocol error',
      });

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toThrow('protocol error');

      expect(mockedStorage.updateLinkMessageDeliveryState).toHaveBeenCalledWith(
        OWNER,
        OWNER,
        CHAT_MESSAGE_KIND,
        EVENT_ID,
        'failed',
      );
      expect(mockedStorage.finalizeLinkSend).not.toHaveBeenCalled();
      expect(mockedStorage.persistLinkSendIntent).toHaveBeenCalledTimes(1);
    });

    it('keeps sending when native send was not attempted yet (link handshaking)', async () => {
      mockSdkEnsure('LINKING');

      const message = await LinkService.sendDm(PEER, 'hello');

      expect(message.deliveryState).toBe('sending');
      expect(mockedStorage.persistLinkSendIntent).toHaveBeenCalledTimes(1);
      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    });

    it('sends when the peer marker is absent and the SDK reports LINKED', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue(null);

      const message = await LinkService.sendDm(PEER, 'hello');

      expect(message.deliveryState).toBe('sent');
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('does not accept a pending request when the SDK reports BLOCKED', async () => {
      mockSdkEnsure('BLOCKED');
      mockedStorage.getMessageRequest.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        createdAt: NOW,
        updatedAt: NOW,
        status: 'pending',
      });

      const message = await LinkService.sendDm(PEER, 'hello');

      expect(message.deliveryState).toBe('sending');
      expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
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
      const ensureOrder = jest.mocked(PaykitSdkNative.ensureLinkWithPeer).mock
        .invocationCallOrder[0]!;
      const acceptOrder = mockedStorage.upsertMessageRequest.mock.invocationCallOrder[0]!;
      expect(ensureOrder).toBeLessThan(acceptOrder);
    });

    it('aborts with owner-changed and persists nothing when identity switches during ensureLinkLocked', async () => {
      mockedStorage.getMessageRequest.mockResolvedValue(null);
      mockedNative.getReceiverMarker.mockImplementation(async () => {
        mockedNative.signinWithSecret.mockResolvedValue({
          sessionAlias: 'session-b',
          pubky: OTHER_OWNER,
        });
        mockedKeyStore.getPubky.mockReturnValue(OTHER_OWNER);
        await LinkService.signinWithSecret('owner-b-secret');
        return { noisePublicKey: PEER_NOISE };
      });

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toEqual(
        expect.objectContaining({
          name: 'LinkSendError',
          code: 'owner-changed',
        }),
      );
      expect(mockedStorage.persistLinkSendIntent).not.toHaveBeenCalled();
      expect(mockedStorage.acceptDeclinedMessageRequest).not.toHaveBeenCalled();
      expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
    });

    it('never puts a 52-char z32 pubky in thrown send errors or warn output', async () => {
      const z32 = /[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/;
      const warns: string[] = [];
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warns.push(args.map(String).join(' '));
      });
      mockedStorage.getLinkReceiver.mockResolvedValue({
        ...receiverRow,
        receiverRole: 'standby',
      });
      mockedStorage.getLink.mockResolvedValue(null);

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toBeInstanceOf(LinkSendError);
      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toMatchObject({
        code: 'standby-not-receiving',
      });
      const thrown = await LinkService.sendDm(PEER, 'hello').catch((err: unknown) => err);
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).not.toMatch(z32);
      expect((thrown as Error).message).not.toContain(PEER);
      expect((thrown as Error).message).not.toContain(OWNER);

      givenEstablishedLink();
      mockedNative.sendPrivateMessageJson.mockRejectedValue({
        code: 'protocol',
        message: `native failed for ${PEER}`,
      });
      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toBeTruthy();
      expect(warns.join('\n')).not.toMatch(z32);
      expect(warns.join('\n')).not.toContain(PEER);

      mockedNative.sendPrivateMessageJson.mockRejectedValue({
        code: 'protocol',
        message: `group native failed for ${PEER}`,
      });
      await expect(
        LinkService.sendPersistedLinkJson({
          ownerPubky: OWNER,
          senderPubky: OWNER,
          peerPubky: PEER,
          queueId: QUEUE_ID,
          kind: GROUP_MESSAGE_KIND,
          eventId: EVENT_ID,
          rawJson: '{}',
          channelId: `${OWNER}:00000000-0000-4000-8000-00000000bbbb`,
        }),
      ).resolves.toBe('queued');
      mockedRetryQueue.getDue.mockResolvedValue([
        {
          id: 'q-group-warn',
          messageId: EVENT_ID,
          recipientPubky: PEER,
          payload: JSON.stringify({
            type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
            ownerPubky: OWNER,
            peerPubky: PEER,
            senderPubky: OWNER,
            kind: GROUP_MESSAGE_KIND,
            eventId: EVENT_ID,
            channelId: `${OWNER}:00000000-0000-4000-8000-00000000bbbb`,
            rawJson: '{}',
          }),
          attempts: 0,
          nextRetryAt: NOW,
          createdAt: NOW,
        },
      ]);
      await LinkService.drainRetries();
      expect(warns.join('\n')).not.toMatch(z32);
      expect(warns.join('\n')).not.toContain(PEER);
      warnSpy.mockRestore();
    });

    it('aborts live handshake advance after an identity switch without charging or snapshotting', async () => {
      await switchOwnerDuringSdkEnsure();

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toEqual(
        expect.objectContaining({
          name: 'LinkSendError',
          code: 'owner-changed',
        }),
      );
      expect(mockedStorage.upsertHandshakeBudget).not.toHaveBeenCalled();
      expect(mockedStorage.updateLinkSnapshot).not.toHaveBeenCalled();
      expect(mockedStorage.persistLinkSendIntent).not.toHaveBeenCalled();
    });

    it('does not charge a queued handshake advance after an identity switch', async () => {
      await switchOwnerDuringSdkEnsure();
      mockedRetryQueue.getDue.mockResolvedValue([
        {
          id: 'q-hs-switch',
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
          attempts: 0,
          nextRetryAt: NOW,
          createdAt: NOW,
        },
      ]);

      await LinkService.drainRetries();

      expect(mockedStorage.upsertHandshakeBudget).not.toHaveBeenCalled();
      expect(mockedStorage.updateLinkSnapshot).not.toHaveBeenCalled();
      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    });
  });

  describe('syncInbox', () => {
    it('settles a racing delete stream item while retaining its pending tombstone', async () => {
      givenEstablishedLink();
      const deleteJson = JSON.stringify({
        version: 1,
        kind: 'chat.delete.v0',
        event_id: '00000000-0000-4000-8000-0000000000dd',
        sent_at: NOW,
        target_event_id: EVENT_ID,
      });
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [],
        snapshot: 'est-2',
      });
      mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValue([
        {
          id: 's-racing-delete',
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: 'chat.delete.v0',
          rawJson: deleteJson,
          receivedAt: NOW,
          processed: false,
        },
      ]);
      mockedStorage.getLinkMessageByEventId.mockResolvedValue({
        ...sendingRow({ senderPubky: PEER, direction: 'received' }),
        eventId: EVENT_ID,
      });
      mockedStorage.tombstoneLinkMessage.mockResolvedValue(false);

      await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

      expect(mockedStorage.savePendingChatDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: PEER,
          targetEventId: EVENT_ID,
        }),
      );
      expect(mockedStorage.markLinkStreamItemProcessed).toHaveBeenCalledWith('s-racing-delete');
    });

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
        'sdk:1',
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
        { peerPubky: PEER, conversationId: `dm:${PEER}` },
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
      expect(mockedStorage.listPendingChatDeletes).toHaveBeenCalledWith(
        OWNER,
        PEER,
        PEER,
        EVENT_ID,
      );
      expect(mockedStorage.listPendingChatTags).toHaveBeenCalledWith(OWNER, PEER, PEER, EVENT_ID);
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
        'sdk:1',
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

      expect(PaykitSdkNative.ensureLinkWithPeer).toHaveBeenCalled();
      expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
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
    it('recoverPendingSends is a no-op when KeyStore is not ready', async () => {
      mockedKeyStore.getPubky.mockClear();
      mockedStorage.listDeliveryQueue.mockClear();
      mockedKeyStore.isInitialized.mockReturnValue(false);
      await LinkService.recoverPendingSends();
      expect(mockedKeyStore.getPubky).not.toHaveBeenCalled();
      expect(mockedStorage.listDeliveryQueue).not.toHaveBeenCalled();
    });

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
        'sdk-link',
        wireMessage(EVENT_ID),
      );
      expect(mockedStorage.finalizeLinkSend).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: EVENT_ID,
          snapshot: 'sdk:sdk-queue-1',
          queueId: 'q-link',
        }),
      );
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledWith('q-link');
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
    });

    it('does not burn an attempt when the link is not ready', async () => {
      mockSdkEnsure('LINKING');
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
      mockedRetryQueue.wouldDrop.mockReturnValue(true);

      await LinkService.drainRetries();

      expect(mockedStorage.failLinkMessageAndDequeue).toHaveBeenCalledWith({
        ownerPubky: OWNER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: EVENT_ID,
        queueId: 'q-link',
      });
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
    });

    it('writes a terminal group outcome and dequeues atomically on max-attempt drop', async () => {
      givenEstablishedLink();
      const groupItem: DeliveryQueueItem = {
        id: 'q-group-max',
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: GROUP_MESSAGE_KIND,
          eventId: EVENT_ID,
          channelId: `${OWNER}:chan`,
          rawJson: '{}',
        }),
        attempts: 9,
        nextRetryAt: NOW,
        createdAt: NOW,
      };
      mockedRetryQueue.getDue.mockResolvedValue([groupItem]);
      mockedRetryQueue.wouldDrop.mockReturnValue(true);
      mockedNative.sendPrivateMessageJson.mockRejectedValue(new Error('still unreachable'));

      await LinkService.drainRetries();

      expect(mockedStorage.completeGroupFanoutRecipient).toHaveBeenCalledWith({
        ownerPubky: OWNER,
        channelId: `${OWNER}:chan`,
        eventId: EVENT_ID,
        senderPubky: OWNER,
        recipientPubky: PEER,
        status: 'failed',
        reason: null,
        queueId: 'q-group-max',
        kind: GROUP_MESSAGE_KIND,
      });
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
    });

    it('retries due link items whose delivery state is failed', async () => {
      givenEstablishedLink();
      mockedRetryQueue.getDue.mockResolvedValue([linkItem]);
      mockedStorage.getLinkMessage.mockResolvedValue(sendingRow({ deliveryState: 'failed' }));
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-3' });

      await LinkService.drainRetries();

      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith(
        'sdk-link',
        wireMessage(EVENT_ID),
      );
      expect(mockedStorage.finalizeLinkSend).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: EVENT_ID,
          snapshot: 'sdk:sdk-queue-1',
          queueId: 'q-link',
        }),
      );
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledWith('q-link');
    });

    it('skips a queued item whose message is no longer retryable and does not send again', async () => {
      givenEstablishedLink();
      mockedRetryQueue.getDue.mockResolvedValue([linkItem]);
      mockedStorage.getLinkMessage.mockResolvedValue(sendingRow({ deliveryState: 'sent' }));

      await LinkService.drainRetries();

      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledWith('q-link');
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
    });

    it('defers without burning an attempt when ensureLinkLocked throws a network error', async () => {
      jest
        .mocked(PaykitSdkNative.ensureLinkWithPeer)
        .mockRejectedValue(new SdkOperationError('network', 'timeout'));
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

      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith('sdk-link', exact);
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
      mockedNative.closeLink.mockClear();
      mockedNative.removeReceiverMarker.mockClear();
      mockedNative.signOutSession.mockClear();
      mockedNative.clearAllNativeSecrets.mockClear();
      mockedNative.getReceiverPublicKey.mockResolvedValue(PEER_NOISE);
      mockedNative.getReceiverMarker.mockResolvedValue({
        noisePublicKey: PEER_NOISE,
      });
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

      expect(mockedNative.closeLink).not.toHaveBeenCalled();
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
      expect(mockedStorage.removeFromQueue).not.toHaveBeenCalled();
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

    it('does not emit chat.receipt.v0 to a pre-v1 peer', async () => {
      mockedStorage.getLink.mockResolvedValue(storedLink({ chatKindsV: 0 }));
      mockedStorage.getLinkMessagesForConversation.mockResolvedValue([
        sendingRow({
          senderPubky: PEER,
          direction: 'received',
          eventId: EVENT_ID,
        }),
      ]);

      await LinkService.markRead(CONVERSATION_ID, NOW);

      expect(mockedStorage.persistControlSendIntent).not.toHaveBeenCalled();
    });

    it('emits chat.receipt.v0 after the peer marker shows v1', async () => {
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ status: 'established', snapshot: 'est-1', chatKindsV: 1 }),
      );
      mockedStorage.getLinkMessagesForConversation.mockResolvedValue([
        sendingRow({
          senderPubky: PEER,
          direction: 'received',
          eventId: EVENT_ID,
        }),
      ]);
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'snap' });
      mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-1' });

      await LinkService.markRead(CONVERSATION_ID, NOW);

      expect(mockedStorage.persistControlSendIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: OWNER,
          queueItem: expect.objectContaining({
            payload: expect.stringContaining(CHAT_RECEIPT_KIND),
          }),
        }),
      );
    });

    it('receipts only ids newer than the previous read cursor', async () => {
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ status: 'established', snapshot: 'est-1', chatKindsV: 1 }),
      );
      mockedStorage.getLinkReadCursor.mockResolvedValue(NOW - 10);
      mockedStorage.getLinkMessagesForConversation.mockResolvedValue([
        sendingRow({
          senderPubky: PEER,
          direction: 'received',
          eventId: 'old-id',
          sentAt: NOW - 20,
        }),
        sendingRow({
          senderPubky: PEER,
          direction: 'received',
          eventId: EVENT_ID,
          sentAt: NOW,
        }),
      ]);
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'snap' });
      mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-1' });

      await LinkService.markRead(CONVERSATION_ID, NOW);

      const payload = String(
        mockedStorage.persistControlSendIntent.mock.calls[0]?.[0]?.queueItem.payload,
      );
      expect(payload).toContain(EVENT_ID);
      expect(payload).not.toContain('old-id');
    });
  });

  describe('chat_kinds_v advertisement', () => {
    it('persists chat_kinds_v from a fetched peer marker', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue({
        noisePublicKey: PEER_NOISE,
      });
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: async () =>
          '{"version":1,"kind":"hypercolor.receiver.capabilities","receiver_path":"hypercolor/wallet","chat_kinds_v":1}',
      }) as unknown as typeof fetch;
      givenEstablishedLink();
      mockedStorage.getLink.mockResolvedValue(
        storedLink({
          status: 'established',
          snapshot: 'est-1',
          chatKindsV: 0,
        }),
      );

      await LinkService.ensureLinkWith(PEER);

      expect(mockedStorage.recordPeerChatKindsV).toHaveBeenCalledWith(OWNER, PEER, 1);
    });

    it('replays read receipts once when chat_kinds_v flips 0 to 1', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue({
        noisePublicKey: PEER_NOISE,
      });
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: async () =>
          '{"version":1,"kind":"hypercolor.receiver.capabilities","receiver_path":"hypercolor/wallet","chat_kinds_v":1}',
      }) as unknown as typeof fetch;
      givenEstablishedLink();
      mockedStorage.getLink.mockResolvedValue(
        storedLink({
          status: 'established',
          snapshot: 'est-1',
          chatKindsV: 0,
        }),
      );
      mockedStorage.getLinkReadCursor.mockResolvedValue(NOW);
      mockedStorage.getLinkMessagesForConversation.mockResolvedValue([
        sendingRow({
          senderPubky: PEER,
          direction: 'received',
          eventId: EVENT_ID,
        }),
      ]);
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'snap' });

      await LinkService.ensureLinkWith(PEER);
      await new Promise<void>(resolve => {
        setImmediate(resolve);
      });
      await new Promise<void>(resolve => {
        setImmediate(resolve);
      });

      expect(mockedStorage.persistControlSendIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          queueItem: expect.objectContaining({
            payload: expect.stringContaining(CHAT_RECEIPT_KIND),
          }),
        }),
      );
    });
  });

  describe('attachment unsend cleanup', () => {
    function givenAttachmentMessage(): string[] {
      const localCachePath = `file:///cache/hypercolor-attachments/${OWNER}/${OWNER}/${EVENT_ID}`;
      mockedStorage.getLinkMessageByEventId.mockResolvedValue({
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        conversationId: CONVERSATION_ID,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: 'sent',
        kind: CHAT_ATTACHMENT_KIND,
        rawJson: '{}',
        body: '[attachment]',
        sentAt: NOW,
        receivedAt: null,
        deliveryState: 'sent',
        deleted: false,
      });
      mockedStorage.getAttachment.mockResolvedValue({
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        conversationId: CONVERSATION_ID,
        channelId: null,
        senderPubky: OWNER,
        direction: 'sent',
        location: `pubky://${OWNER}/pub/hypercolor.app/v1/attachments/${EVENT_ID}`,
        keyRef: `att:${OWNER}:${OWNER}:${EVENT_ID}`,
        contentType: 'image/jpeg',
        size: 12,
        thumbnailLocation: null,
        localCachePath,
        createdAt: NOW,
        updatedAt: NOW,
        deliveryState: 'sent',
        resolveState: 'ready',
      });
      const paths = [
        `file:///cache/hypercolor-attachments/${OWNER}/${OWNER}/${EVENT_ID}`,
        `file:///cache/hypercolor-attachments/${OWNER}/${OWNER}/${EVENT_ID}.thumb`,
        localCachePath,
        `${localCachePath}.thumb`,
      ];
      jest.mocked(cachePathsForAttachment).mockReturnValue(paths);
      return paths;
    }

    it('journals cache cleanup failure and still tombstones and dispatches deletion', async () => {
      const paths = givenAttachmentMessage();
      givenEstablishedLink();
      mockedKeyStore.deleteAttachmentSecret.mockResolvedValue(true);
      mockedStorage.tombstoneLinkMessage.mockResolvedValue(true);
      jest.mocked(deleteCacheFiles).mockRejectedValueOnce(new Error('unlink failed'));

      await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();

      expect(mockedKeyStore.deleteAttachmentSecret).toHaveBeenCalledWith(OWNER, OWNER, EVENT_ID, {
        peerPubky: PEER,
        conversationId: `dm:${PEER}`,
      });
      expect(deleteCacheFiles).toHaveBeenCalledWith(paths);
      expect(mockedStorage.journalAttachmentCacheCleanup).toHaveBeenCalledWith(OWNER, paths);
      expect(mockedStorage.tombstoneLinkMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          eventId: EVENT_ID,
          attachmentKeyService: `hypercolor-attachment-key:${OWNER}:${OWNER}:${EVENT_ID}`,
          attachmentCachePaths: paths,
        }),
      );
      expect(mockedStorage.tombstoneLinkMessage.mock.invocationCallOrder[0]).toBeLessThan(
        mockedKeyStore.deleteAttachmentSecret.mock.invocationCallOrder[0]!,
      );
      expect(mockedKeyStore.deleteAttachmentSecret.mock.invocationCallOrder[0]!).toBeLessThan(
        jest.mocked(deleteCacheFiles).mock.invocationCallOrder[0]!,
      );
      expect(mockedStorage.tombstoneLinkMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          controlQueueItem: expect.objectContaining({
            payload: expect.stringMatching(/"kind":"chat\.delete\.v0"/),
          }),
        }),
      );
    });

    it('tombstones before journaling attachment key cleanup failure', async () => {
      givenAttachmentMessage();
      mockedKeyStore.deleteAttachmentSecret.mockResolvedValue(false);

      await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();

      expect(deleteCacheFiles).toHaveBeenCalled();
      expect(mockedStorage.journalAttachmentCacheCleanup).not.toHaveBeenCalled();
      expect(mockedStorage.tombstoneLinkMessage).toHaveBeenCalled();
      expect(mockedKeyStore.deleteAttachmentSecret).toHaveBeenCalledWith(OWNER, OWNER, EVENT_ID, {
        peerPubky: PEER,
        conversationId: `dm:${PEER}`,
      });
      expect(mockedStorage.journalAttachmentKeyCleanup).toHaveBeenCalledWith(
        OWNER,
        `hypercolor-attachment-key:${OWNER}:${OWNER}:${EVENT_ID}`,
      );
      expect(mockedStorage.updateAttachmentResolve).not.toHaveBeenCalled();
      expect(mockedStorage.persistControlSendIntent).not.toHaveBeenCalled();
    });

    it('attempts key deletion even without a local attachment row', async () => {
      givenAttachmentMessage();
      mockedStorage.getAttachment.mockResolvedValue(null);
      mockedKeyStore.deleteAttachmentSecret.mockResolvedValue(false);

      await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();

      expect(mockedKeyStore.deleteAttachmentSecret).toHaveBeenCalledWith(OWNER, OWNER, EVENT_ID, {
        peerPubky: PEER,
        conversationId: `dm:${PEER}`,
      });
      expect(deleteCacheFiles).not.toHaveBeenCalled();
      expect(mockedStorage.tombstoneLinkMessage).toHaveBeenCalled();
      expect(mockedStorage.persistControlSendIntent).not.toHaveBeenCalled();
    });

    it('clears attachment cache metadata when tombstone loses a concurrent race', async () => {
      givenAttachmentMessage();
      givenEstablishedLink();
      mockedKeyStore.deleteAttachmentSecret.mockResolvedValue(true);
      mockedStorage.tombstoneLinkMessage.mockResolvedValue(false);

      await expect(LinkService.unsendDm(PEER, EVENT_ID)).rejects.toThrow(
        'Message is no longer available to unsend',
      );

      expect(mockedStorage.updateAttachmentResolve).not.toHaveBeenCalled();
      expect(mockedStorage.persistControlSendIntent).not.toHaveBeenCalled();
      expect(mockedKeyStore.deleteAttachmentSecret).not.toHaveBeenCalled();
      expect(deleteCacheFiles).not.toHaveBeenCalled();
      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    });
  });

  describe('control PAM durability', () => {
    const deleteEventId = '00000000-0000-4000-8000-0000000000de';
    const deleteJson = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: deleteEventId,
      sent_at: NOW,
      target_event_id: EVENT_ID,
    });

    function ownedMessage() {
      return {
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        conversationId: CONVERSATION_ID,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: 'sent' as const,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{}',
        body: 'secret',
        sentAt: NOW,
        receivedAt: null,
        deliveryState: 'sent' as const,
        deleted: false,
      };
    }

    function controlItem(type: string, attempts = 0) {
      return {
        id: 'q-control',
        messageId: deleteEventId,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: CHAT_DELETE_KIND,
          eventId: deleteEventId,
          rawJson: deleteJson,
        }),
        attempts,
        nextRetryAt: NOW,
        createdAt: NOW,
      };
    }

    function pinDeleteEventId() {
      mockedUuid.mockReset();
      mockedUuid.mockReturnValue(deleteEventId);
    }

    it('sends chat.delete.v0 on a healthy established link', async () => {
      givenEstablishedLink();
      mockedStorage.getLinkMessageByEventId.mockResolvedValue(ownedMessage());
      mockedStorage.tombstoneLinkMessage.mockResolvedValue(true);
      pinDeleteEventId();
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-2' });

      await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();

      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith('sdk-link', deleteJson);
      expect(mockedStorage.finalizeControlSend).toHaveBeenCalledWith(
        expect.objectContaining({ ownerPubky: OWNER, peerPubky: PEER }),
      );
      expect(mockedRetryQueue.defer).not.toHaveBeenCalled();
      expect(mockedNative.deletePublic).not.toHaveBeenCalled();
    });

    it('defers a protocol-failed delete PAM and never drops it', async () => {
      givenEstablishedLink();
      mockedStorage.getLinkMessageByEventId.mockResolvedValue(ownedMessage());
      mockedStorage.tombstoneLinkMessage.mockResolvedValue(true);
      pinDeleteEventId();
      mockedNative.sendPrivateMessageJson.mockRejectedValue({
        code: 'protocol',
        message: 'protocol error',
      });

      await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();

      expect(mockedStorage.finalizeControlSend).not.toHaveBeenCalled();
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
      expect(mockedStorage.failLinkMessageAndDequeue).not.toHaveBeenCalled();
      expect(mockedRetryQueue.defer).toHaveBeenCalled();
      expect(mockedNative.closeLink).not.toHaveBeenCalled();
      expect(mockedNative.deletePublic).not.toHaveBeenCalled();
    });

    it('defers in_flight control without dropping the live handle', async () => {
      givenEstablishedLink();
      mockedStorage.getLinkMessageByEventId.mockResolvedValue(ownedMessage());
      mockedStorage.tombstoneLinkMessage.mockResolvedValue(true);
      pinDeleteEventId();
      mockedNative.sendPrivateMessageJson.mockRejectedValue({
        code: 'unavailable',
        message: 'unavailable',
      });

      await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();

      expect(mockedRetryQueue.defer).toHaveBeenCalled();
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
      expect(mockedNative.closeLink).not.toHaveBeenCalled();
      expect(mockedStorage.finalizeControlSend).not.toHaveBeenCalled();
      expect(mockedNative.deletePublic).not.toHaveBeenCalled();
    });

    it('resends a deferred control PAM once the link is ready', async () => {
      givenEstablishedLink();
      const item = controlItem(LINK_CONTROL_PAYLOAD_TYPE, 2);
      mockedRetryQueue.getDue.mockResolvedValue([item]);
      mockedStorage.hasQueueItem.mockResolvedValue(true);
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-3' });

      await LinkService.drainRetries();

      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith('sdk-link', deleteJson);
      expect(mockedStorage.finalizeControlSend).toHaveBeenCalledWith(
        expect.objectContaining({ queueId: 'q-control', snapshot: 'sdk:sdk-queue-1' }),
      );
      expect(mockedStorage.finalizeLinkSend).not.toHaveBeenCalled();
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledWith('q-control');
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
    });

    it('treats a legacy link.chat.message delete payload as control', async () => {
      givenEstablishedLink();
      mockedRetryQueue.getDue.mockResolvedValue([controlItem(LINK_RETRY_PAYLOAD_TYPE, 1)]);
      mockedStorage.hasQueueItem.mockResolvedValue(true);
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-legacy' });

      await LinkService.drainRetries();

      expect(mockedStorage.finalizeControlSend).toHaveBeenCalledWith(
        expect.objectContaining({ queueId: 'q-control' }),
      );
      expect(mockedStorage.finalizeLinkSend).not.toHaveBeenCalled();
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledWith('q-control');
    });

    it('holds a delete PAM while reconnect_required and sends after restore', async () => {
      jest.mocked(PaykitSdkNative.observeEncryptedLinkRecoveryMarker).mockResolvedValue({
        state: 'RECOVERY_REQUIRED',
        remoteMarkerChanged: true,
        localAttemptId: 'local',
        remoteAttemptId: 'remote',
      });
      mockedStorage.getLinkMessageByEventId.mockResolvedValue(ownedMessage());
      mockedStorage.tombstoneLinkMessage.mockResolvedValue(true);
      pinDeleteEventId();

      await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();

      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
      expect(mockedRetryQueue.defer).toHaveBeenCalled();
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
      expect(mockedNative.deletePublic).not.toHaveBeenCalled();

      givenEstablishedLink();
      jest.mocked(PaykitSdkNative.observeEncryptedLinkRecoveryMarker).mockResolvedValue({
        state: 'LINKED',
        remoteMarkerChanged: false,
        localAttemptId: null,
        remoteAttemptId: null,
      });
      seedPaykitSdkJestMock();
      mockedRetryQueue.getDue.mockResolvedValue([controlItem(LINK_CONTROL_PAYLOAD_TYPE, 0)]);
      mockedStorage.hasQueueItem.mockResolvedValue(true);
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-ready' });
      mockedRetryQueue.defer.mockClear();

      await LinkService.drainRetries();

      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledTimes(1);
      expect(mockedStorage.finalizeControlSend).toHaveBeenCalled();
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalled();
    });

    it('does not send a queued control PAM after the owner changes', async () => {
      givenEstablishedLink();
      mockedRetryQueue.getDue.mockResolvedValue([
        {
          ...controlItem(LINK_CONTROL_PAYLOAD_TYPE),
          payload: JSON.stringify({
            type: LINK_CONTROL_PAYLOAD_TYPE,
            ownerPubky: OTHER_OWNER,
            peerPubky: PEER,
            senderPubky: OTHER_OWNER,
            kind: CHAT_DELETE_KIND,
            eventId: deleteEventId,
            rawJson: deleteJson,
          }),
        },
      ]);

      await LinkService.drainRetries();

      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
      expect(mockedRetryQueue.defer).not.toHaveBeenCalled();
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
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
