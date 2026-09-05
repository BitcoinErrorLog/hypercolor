import { v4 as uuidv4 } from 'uuid';
import {
  HANDSHAKE_ADVANCE_BATCH_LIMIT,
  HANDSHAKE_FAILURE_LIMIT,
  HANDSHAKE_PENDING_ADVANCE_LIMIT,
  LINK_RETRY_DRAIN_INTERVAL_MS,
  LINK_RETRY_PAYLOAD_TYPE,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  LINK_RETRY_TICK_PHASE_TIMEOUT_MS,
  LinkService,
  linkQueueEntryCountForTests,
  resetLinkServiceHarnessState,
  startLinkRetryDrain,
  stopLinkRetryDrain,
} from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { RetryQueue } from '../../RetryQueue';
import { paintOwner, resetPaintOverlayForBoot } from '../../paintedOwner';
import { wireSignOutMarkerMocks } from '../../__tests__/wireSignOutMarkerMocks';
import {
  CHAT_MESSAGE_KIND,
  LINK_MESSAGE_MAX_BYTES,
  LINK_RECEIVER_PATH,
  RING_GRANT_CAPABILITIES,
  PUBKY_APP_DM_KIND,
  type LinkMessage,
  type HandshakeBudget,
  type LinkReceiver,
  type LinkRecord,
} from '../../../types/link';
import type { DeliveryQueueItem } from '../../../types';
import { applyGroupInbound } from '../../group/applyGroupInbound';
import { applyAttachmentInbound } from '../../attachments/applyAttachmentInbound';
import { applyPaymentInbound } from '../../payments/applyPaymentInbound';
import { FollowsImportSettings } from '../../contacts/followsImportSettings';
import { LinkSendError } from '../LinkSendError';
import { PAYKIT_PAYMENT_REQUEST_KIND } from '../../../types/payment';
import { GROUP_MESSAGE_KIND } from '../../../types/group';
import {
  ATTACHMENT_ALGORITHM,
  ATTACHMENT_KEY_PLACEHOLDER,
  CHAT_ATTACHMENT_KIND,
} from '../../../types/attachment';
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
    upsertLink: jest.fn(),
    getLink: jest.fn(),
    getAllLinks: jest.fn(),
    getDueHandshakingLinks: jest.fn(),
    updateLinkSnapshot: jest.fn(),
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
    getLinkReadCursor: jest.fn(),
    setLinkReadCursor: jest.fn(),
    clearAccountData: jest.fn(),
    persistSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
    hasSignOutIncompleteJournal: jest.fn().mockResolvedValue(false),
    getSignOutIncompleteJournalOwner: jest.fn().mockResolvedValue(null),
    clearSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
    retryPendingCleanup: jest.fn(),
    markGroupEventSeen: jest.fn(),
    listDeliveryQueue: jest.fn(),
    listPaymentRequestsWithPendingEvent: jest.fn().mockResolvedValue([]),
    getLinkMessageByEventId: jest.fn(),
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

function storedBudget(overrides: Partial<HandshakeBudget> = {}): HandshakeBudget {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    pendingAdvances: 0,
    nextAdvanceAt: 0,
    exhaustedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * Models the two tables the handshake stepper depends on, with the property
 * that makes them different tables: a wipe deletes the `links` row and MUST
 * NOT delete the `link_handshake_budgets` row. The responder answered with
 * Noise message 2 and persisted `handshaking`; only the counterparty's own
 * process can write message 3, so nothing here exposes PEER-as-owner state.
 */
function givenResponderHandshake(seededBudget: HandshakeBudget | null = null): {
  link: () => LinkRecord | null;
  budget: () => HandshakeBudget | null;
} {
  let link: LinkRecord | null = storedLink({
    role: 'responder',
    status: 'handshaking',
    snapshot: 'b-msg2',
  });
  let budget: HandshakeBudget | null = seededBudget;

  mockedStorage.getDueHandshakingLinks.mockImplementation(async (owner, limit = 10) => {
    if (owner !== OWNER || !link || link.status !== 'handshaking') return [];
    if (budget && budget.exhaustedAt !== null) return [];
    if ((budget?.nextAdvanceAt ?? 0) > Date.now()) return [];
    return [link].slice(0, limit);
  });
  mockedStorage.getLink.mockImplementation(async (owner, peer) =>
    owner === OWNER && peer === PEER ? link : null,
  );
  mockedStorage.upsertLink.mockImplementation(async record => {
    link = storedLink(record);
  });
  mockedStorage.updateLinkSnapshot.mockImplementation(async (owner, peer, snapshot, status) => {
    if (owner === OWNER && peer === PEER && link) link = storedLink({ ...link, snapshot, status });
  });
  mockedStorage.deleteLink.mockImplementation(async (owner, peer) => {
    if (owner === OWNER && peer === PEER) link = null;
  });
  mockedStorage.getHandshakeBudget.mockImplementation(async (owner, peer) =>
    owner === OWNER && peer === PEER ? budget : null,
  );
  mockedStorage.upsertHandshakeBudget.mockImplementation(async input => {
    budget = storedBudget(input);
  });
  mockedStorage.clearHandshakeBudget.mockImplementation(async (owner, peer) => {
    if (owner === OWNER && peer === PEER) budget = null;
  });
  mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-b', status: 'pending' });
  mockedNative.restoreLink.mockResolvedValue({ linkId: 'link-b' });
  return { link: () => link, budget: () => budget };
}

/** One queued DM to PEER, the shape that makes a retry drain step the handshake. */
function givenQueuedDm(): void {
  mockedStorage.getLinkMessage.mockResolvedValue(sendingRow());
  mockedRetryQueue.getDue.mockResolvedValue([
    {
      id: QUEUE_ID,
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
}

/** Runs one periodic tick at the earliest moment the durable schedule allows. */
async function tickWhenDue(budget: HandshakeBudget | null): Promise<void> {
  jest.spyOn(Date, 'now').mockReturnValue(Math.max(NOW, budget?.nextAdvanceAt ?? 0));
  await LinkService.advancePendingLinks();
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
  beforeEach(async () => {
    jest.resetAllMocks();
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
    mockedNative.closeLink.mockResolvedValue(undefined);
    mockedNative.probeInboundLink.mockResolvedValue({ result: 'none' });
    mockedNative.getReceiverPublicKey.mockResolvedValue(PEER_NOISE);
    mockedNative.getReceiverMarker.mockResolvedValue({
      noisePublicKey: PEER_NOISE,
      capabilitiesJson: '{}',
    });
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedKeyStore.isInitialized.mockReturnValue(true);
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
      const aliasOrder = mockedStorage.upsertLinkReceiver.mock.invocationCallOrder[0]!;
      const publishOrder = mockedNative.publishReceiverMarker.mock.invocationCallOrder[0]!;
      expect(aliasOrder).toBeLessThan(publishOrder);
      expect(enabled).toEqual({
        pubky: OWNER,
        receiverPath: LINK_RECEIVER_PATH,
        noisePublicKey: 'noise-pk',
      });
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
      await expect(LinkService.getLinkStatus(PEER)).resolves.toBe('ready');
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
      // A deliberate user action is attended work and costs nothing: see the
      // charge policy on `chargeHandshakeBudget`.
      expect(mockedStorage.upsertHandshakeBudget).not.toHaveBeenCalled();
      expect(mockedStorage.clearHandshakeBudget).toHaveBeenCalledWith(OWNER, PEER);
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

    it('republishes the local receiver marker when it no longer matches homeserver', async () => {
      const stalePublished = 'stale-noise-pk';
      mockedNative.getReceiverPublicKey.mockResolvedValue('local-noise-pk');
      mockedNative.getReceiverMarker.mockImplementation(async (who: string) => {
        if (who === OWNER) {
          return { noisePublicKey: stalePublished, capabilitiesJson: '{}' };
        }
        return { noisePublicKey: PEER_NOISE, capabilitiesJson: '{}' };
      });
      mockedNative.publishReceiverMarker.mockResolvedValue(undefined);
      mockedNative.probeInboundLink.mockResolvedValue({ result: 'none' });

      await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

      expect(mockedNative.publishReceiverMarker).toHaveBeenCalledWith(
        SESSION_ALIAS,
        RECEIVER_ALIAS,
        LINK_RECEIVER_PATH,
      );
      expect(mockedNative.probeInboundLink).toHaveBeenCalledTimes(1);
    });

    it('probes the same peer again after a prior none (native must not cache none)', async () => {
      mockedNative.probeInboundLink.mockResolvedValue({ result: 'none' });

      await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);
      await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

      expect(mockedNative.probeInboundLink).toHaveBeenCalledTimes(2);
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

    it('aborts with owner-changed and persists nothing when identity switches during ensureLinkLocked', async () => {
      mockedStorage.getMessageRequest.mockResolvedValue(null);
      mockedNative.getReceiverMarker.mockImplementation(async () => {
        mockedNative.signinWithSecret.mockResolvedValue({
          sessionAlias: 'session-b',
          pubky: OTHER_OWNER,
        });
        mockedKeyStore.getPubky.mockReturnValue(OTHER_OWNER);
        await LinkService.signinWithSecret('owner-b-secret');
        return { noisePublicKey: PEER_NOISE, capabilitiesJson: '{}' };
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
      mockedNative.getReceiverMarker.mockResolvedValue(null);

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toBeInstanceOf(LinkSendError);
      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toMatchObject({
        code: 'not-sendable',
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
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake.mockImplementation(async () => {
        mockedNative.signinWithSecret.mockResolvedValue({
          sessionAlias: 'session-b',
          pubky: OTHER_OWNER,
        });
        mockedKeyStore.getPubky.mockReturnValue(OTHER_OWNER);
        await LinkService.signinWithSecret('owner-b-secret');
        return { status: 'pending', snapshot: 'hs-3' };
      });

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
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.restoreHandshake.mockResolvedValue({ linkId: 'hs-handle', status: 'pending' });
      mockedNative.advanceHandshake.mockImplementation(async () => {
        mockedNative.signinWithSecret.mockResolvedValue({
          sessionAlias: 'session-b',
          pubky: OTHER_OWNER,
        });
        mockedKeyStore.getPubky.mockReturnValue(OTHER_OWNER);
        await LinkService.signinWithSecret('owner-b-secret');
        return { status: 'pending', snapshot: 'hs-3' };
      });
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
        'handle-1',
        wireMessage(EVENT_ID),
      );
      expect(mockedStorage.finalizeLinkSend).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: EVENT_ID, snapshot: 'est-3', queueId: 'q-link' }),
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

  describe('advancePendingLinks', () => {
    const responderItem: DeliveryQueueItem = {
      id: 'q-responder',
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
    };

    function givenQueuedResponderHandshake(): ReturnType<typeof givenResponderHandshake> {
      mockedStorage.getLinkReceiver.mockImplementation(async owner =>
        owner === OWNER ? receiverRow : null,
      );
      return givenResponderHandshake();
    }

    it('completes a responder handshake on a later tick and delivers its queued sends', async () => {
      const state = givenQueuedResponderHandshake();
      // Message 3 has landed on the homeserver: the responder's own advance
      // is all that is needed.
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'b-est' });
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'b-sent' });
      mockedRetryQueue.getDue.mockResolvedValue([responderItem]);

      await LinkService.advancePendingLinks();
      await LinkService.drainRetries();

      expect(state.link()!.status).toBe('established');
      expect(state.link()!.role).toBe('responder');
      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith(
        'link-b',
        wireMessage(EVENT_ID),
      );
      expect(mockedStorage.finalizeLinkSend).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: EVENT_ID, snapshot: 'b-sent', queueId: 'q-responder' }),
      );
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledWith('q-responder');
      expect(mockedRetryQueue.defer).not.toHaveBeenCalled();
    });

    it('completes without reading any counterparty session, receiver, or link state', async () => {
      givenQueuedResponderHandshake();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'b-est' });
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'b-sent' });
      mockedRetryQueue.getDue.mockResolvedValue([responderItem]);

      await LinkService.advancePendingLinks();
      await LinkService.drainRetries();

      expect(mockedStorage.getLink).not.toHaveBeenCalledWith(PEER, OWNER);
      expect(mockedStorage.getLinkReceiver).not.toHaveBeenCalledWith(PEER);
      expect(mockedNative.restoreHandshake).toHaveBeenCalledTimes(1);
      expect(mockedNative.restoreHandshake).toHaveBeenCalledWith(
        SESSION_ALIAS,
        RECEIVER_ALIAS,
        PEER,
        PEER_NOISE,
        LINK_RECEIVER_PATH,
        LINK_RECEIVER_PATH,
        'b-msg2',
      );
    });

    it('steps a handshaking link that has nothing queued', async () => {
      const state = givenQueuedResponderHandshake();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'b-est' });
      mockedRetryQueue.getDue.mockResolvedValue([]);

      await LinkService.advancePendingLinks();

      expect(mockedNative.advanceHandshake).toHaveBeenCalledWith('hs-b');
      expect(state.link()!.status).toBe('established');
    });

    it('keeps a pending handshake handshaking and never initiates from a tick', async () => {
      const state = givenQueuedResponderHandshake();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });
      mockedRetryQueue.getDue.mockResolvedValue([]);

      await LinkService.advancePendingLinks();

      expect(state.link()!.status).toBe('handshaking');
      expect(state.link()!.snapshot).toBe('b-msg2b');
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
      // A pending advance is persisted progress on the Noise state but is still
      // charged against the durable budget, on the shared retry curve.
      expect(state.budget()).toEqual(
        expect.objectContaining({ pendingAdvances: 1, nextAdvanceAt: NOW + 30_000 }),
      );
    });

    it('asks storage only for handshaking links whose backoff is due, bounded per tick', async () => {
      mockedStorage.getAllLinks.mockClear();

      await LinkService.advancePendingLinks();

      expect(mockedStorage.getDueHandshakingLinks).toHaveBeenCalledWith(
        OWNER,
        HANDSHAKE_ADVANCE_BATCH_LIMIT,
      );
      expect(mockedStorage.getAllLinks).not.toHaveBeenCalled();
      expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();
      expect(mockedNative.restoreHandshake).not.toHaveBeenCalled();
      expect(mockedNative.restoreLink).not.toHaveBeenCalled();
    });

    it('does nothing when no session is active', async () => {
      await LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue(null);
      mockedKeyStore.getPubky.mockReturnValue(null);
      mockedStorage.getDueHandshakingLinks.mockResolvedValue([storedLink({ role: 'responder' })]);

      await LinkService.advancePendingLinks();

      expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();

      // Later tests assert on sign-out call order, which depends on
      // `beforeEach` tearing down a live session rather than a null one.
      mockedKeyStore.getPubky.mockReturnValue(OWNER);
      await LinkService.signinWithSecret('signin-secret-hex');
    });
  });

  describe('handshake tick — bounded, non-initiating, non-overlapping', () => {
    const queuedItem: DeliveryQueueItem = {
      id: 'q-stalled',
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
    };

    /** Runs one tick with the clock moved to this link's next due instant. */
    it('does not write Noise message 1 when a tick hits a protocol error', async () => {
      const state = givenResponderHandshake();
      mockedNative.restoreHandshake.mockRejectedValue({ code: 'protocol', message: 'bad state' });

      await LinkService.advancePendingLinks();

      // The wedged row and its dead outbox are gone...
      expect(mockedStorage.deleteLink).toHaveBeenCalledWith(OWNER, PEER);
      expect(state.link()).toBeNull();
      // ...but recovery must not turn a background timer into an initiator.
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('does not initiate when a tick exhausts the handshake failure limit', async () => {
      givenResponderHandshake();
      mockedNative.restoreHandshake.mockRejectedValue({ code: 'network', message: 'timeout' });
      mockedStorage.incrementLinkConsecutiveFailures.mockResolvedValue(HANDSHAKE_FAILURE_LIMIT);

      await LinkService.advancePendingLinks();

      expect(mockedStorage.deleteLink).toHaveBeenCalledWith(OWNER, PEER);
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('lets the next user-driven send initiate the link the tick refused to restart', async () => {
      const state = givenResponderHandshake();
      mockedNative.restoreHandshake.mockRejectedValue({ code: 'protocol', message: 'bad state' });

      await LinkService.advancePendingLinks();
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
      expect(state.link()).toBeNull();

      mockedNative.initiateLink.mockResolvedValue({ linkId: 'hs-fresh', snapshot: 'fresh-msg1' });
      mockedNative.advanceHandshake.mockResolvedValue({
        status: 'pending',
        snapshot: 'fresh-msg1',
      });

      await LinkService.ensureLinkWith(PEER);

      expect(mockedNative.initiateLink).toHaveBeenCalledTimes(1);
      expect(state.link()).toEqual(
        expect.objectContaining({ role: 'initiator', status: 'handshaking' }),
      );
    });

    it('throttles a repeatedly pending handshake instead of stepping it every tick', async () => {
      const state = givenResponderHandshake();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });

      await LinkService.advancePendingLinks();
      const firstDueAt = state.budget()!.nextAdvanceAt;
      expect(firstDueAt).toBeGreaterThan(NOW);
      expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(1);

      // Next tick, same instant: the row is not due, so it costs no native IO.
      await LinkService.advancePendingLinks();
      expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(1);

      // Once the backoff elapses it steps again, and the next window is wider.
      await tickWhenDue(state.budget());
      expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(2);
      expect(state.budget()!.pendingAdvances).toBe(2);
      expect(state.budget()!.nextAdvanceAt - firstDueAt).toBeGreaterThan(firstDueAt - NOW);
    });

    it('abandons a handshake the peer never finishes and fails its queued sends', async () => {
      const state = givenResponderHandshake();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });
      mockedStorage.listDeliveryQueue.mockResolvedValue([queuedItem]);

      for (let advance = 0; advance < HANDSHAKE_PENDING_ADVANCE_LIMIT; advance += 1) {
        await tickWhenDue(state.budget());
      }

      expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(HANDSHAKE_PENDING_ADVANCE_LIMIT);
      expect(state.link()).toBeNull();
      expect(mockedStorage.deleteLink).toHaveBeenCalledWith(OWNER, PEER);
      // The stuck send stops pretending: `failed` is what ThreadScreen renders
      // in red, and the outbox entry is gone so nothing keeps spinning.
      expect(mockedStorage.failLinkMessageAndDequeue).toHaveBeenCalledWith({
        ownerPubky: OWNER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: EVENT_ID,
        queueId: 'q-stalled',
      });

      // And the abandoned link is no longer timer work at all.
      mockedNative.advanceHandshake.mockClear();
      await LinkService.advancePendingLinks();
      expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();
    });

    it('drops an overlapping tick instead of chaining work behind a slow one', async () => {
      jest.useFakeTimers({ doNotFake: ['Date'] });
      const flush = async (): Promise<void> => {
        for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
      };
      givenResponderHandshake();
      let releaseAdvance: (() => void) | null = null;
      mockedNative.advanceHandshake.mockImplementation(
        () =>
          new Promise(resolve => {
            releaseAdvance = () => resolve({ status: 'pending', snapshot: 'b-slow' });
          }),
      );

      const stop = startLinkRetryDrain(30_000);
      try {
        jest.advanceTimersByTime(30_000);
        await flush();
        expect(mockedStorage.getDueHandshakingLinks).toHaveBeenCalledTimes(1);
        expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(1);

        // Three more intervals fire while the first advance is still in flight.
        jest.advanceTimersByTime(90_000);
        await flush();
        expect(mockedStorage.getDueHandshakingLinks).toHaveBeenCalledTimes(1);
        expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(1);

        releaseAdvance!();
        await flush();

        // The tick is reusable once it settles.
        jest.advanceTimersByTime(30_000);
        await flush();
        expect(mockedStorage.getDueHandshakingLinks).toHaveBeenCalledTimes(2);
      } finally {
        stop();
        jest.useRealTimers();
      }
    });

    /**
     * The tick guards on a module-level flag, so an awaited call that never
     * settles — the platform hazard this codebase already documents for the
     * keystore — used to latch the flag for the lifetime of the process. A new
     * interval could not clear it, so the app kept its timers and did no link
     * work at all. Overlap is still prevented, but by refusing to start a
     * second copy of a wedged phase rather than by never finishing the tick.
     */
    it('releases a latched tick when a handshake advance never settles', async () => {
      jest.useFakeTimers({ doNotFake: ['Date'] });
      const flush = async (): Promise<void> => {
        for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
      };
      givenResponderHandshake();
      givenQueuedDm();
      const wedge: { release: (() => void) | null } = { release: null };
      mockedNative.advanceHandshake.mockImplementation(
        () =>
          new Promise(resolve => {
            wedge.release = () => resolve({ status: 'pending', snapshot: 'b-wedged' });
          }),
      );

      const stop = startLinkRetryDrain(30_000);
      try {
        jest.advanceTimersByTime(30_000);
        await flush();
        expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(1);
        expect(mockedRetryQueue.getDue).not.toHaveBeenCalled();

        // The advance is wedged for good. Once the phase budget elapses the
        // tick must move on and deliver what is already queued.
        jest.advanceTimersByTime(LINK_RETRY_TICK_PHASE_TIMEOUT_MS);
        await flush();
        expect(mockedRetryQueue.getDue).toHaveBeenCalled();

        // Further ticks fire and are refused per phase, never doubled up.
        jest.advanceTimersByTime(60_000 + LINK_RETRY_TICK_PHASE_TIMEOUT_MS);
        await flush();
        expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(1);

        // And the moment the wedge clears, the tick picks the work back up —
        // the flag was released, not merely bypassed once.
        wedge.release?.();
        await flush();
        jest.advanceTimersByTime(30_000);
        await flush();
        expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(2);
      } finally {
        wedge.release?.();
        await flush();
        stop();
        jest.useRealTimers();
      }
    });

    it('does not charge a handshake failure when the transport restore fails after establishing', async () => {
      const state = givenResponderHandshake();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'b-est' });
      mockedNative.restoreLink.mockRejectedValueOnce({ code: 'network', message: 'timeout' });

      await LinkService.advancePendingLinks();

      // The row really is established; the stale pre-advance read must not be
      // what the failure is charged against.
      expect(state.link()).toEqual(expect.objectContaining({ status: 'established' }));
      expect(mockedStorage.incrementLinkConsecutiveFailures).not.toHaveBeenCalled();
      expect(mockedStorage.deleteLink).not.toHaveBeenCalled();

      // The closed handshake handle is gone, so the next attempt restores the
      // established link instead of stepping a dead linkId.
      mockedNative.restoreLink.mockResolvedValue({ linkId: 'link-b' });
      mockedNative.advanceHandshake.mockClear();

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');
      expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();
    });

    it('does not send the same queued payload twice across overlapping drains', async () => {
      givenEstablishedLink();
      const outstanding = new Set([queuedItem.id]);
      // Both passes hold the item from their own pre-lock read of the queue.
      mockedRetryQueue.getDue.mockResolvedValue([queuedItem]);
      mockedStorage.hasQueueItem.mockImplementation(async id => outstanding.has(id));
      mockedStorage.finalizeLinkSend.mockImplementation(async input => {
        if (input.queueId) outstanding.delete(input.queueId);
      });
      mockedStorage.getLinkMessage.mockResolvedValue(sendingRow());
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-3' });

      await Promise.all([LinkService.drainRetries(), LinkService.drainRetries()]);

      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledTimes(1);
      expect(mockedStorage.finalizeLinkSend).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The abuse budget has to survive the link row, because every way a peer can
   * make us give up on a handshake also deletes that row. A hostile follower
   * whose budget reset on wipe could cycle valid message 1 → pending →
   * malformed message 3 → protocol wipe → re-adoption and buy a fresh
   * allowance every 30–60s forever.
   */
  describe('handshake abuse budget — durable across wipe and re-adoption', () => {
    /** Makes the peer's next inbound probe look like a fresh Noise message 1. */
    function givenHostileInboundMessage1(): void {
      mockedNative.probeInboundLink.mockResolvedValue({
        result: 'pending',
        linkId: 'hs-hostile',
        snapshot: 'hostile-msg1',
      });
    }

    it('keeps the pending budget when a protocol wipe is followed by re-adoption', async () => {
      const state = givenResponderHandshake();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });

      // One honest pending advance charges the budget.
      await LinkService.advancePendingLinks();
      expect(state.budget()!.pendingAdvances).toBe(1);

      // The peer now answers with a malformed message 3 and the wipe deletes
      // the link row. Re-adoption immediately re-creates it from the peer's
      // rewritten message 1 — which is the exploit's whole cycle.
      jest.spyOn(Date, 'now').mockReturnValue(state.budget()!.nextAdvanceAt);
      mockedNative.advanceHandshake.mockRejectedValue({ code: 'protocol', message: 'bad msg3' });
      givenHostileInboundMessage1();

      await LinkService.advancePendingLinks();

      // The row is gone and rebuilt, but the charge is not refunded: the wipe
      // itself costs a unit on top of the earlier pending advance. Before the
      // budget was durable this cycle came back at 1 — a fresh allowance.
      expect(state.budget()!.pendingAdvances).toBe(2);
      expect(mockedStorage.clearHandshakeBudget).not.toHaveBeenCalled();
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('runs the budget down to exhaustion across repeated wipe/re-adopt cycles', async () => {
      const state = givenResponderHandshake();
      mockedNative.advanceHandshake.mockRejectedValue({ code: 'protocol', message: 'bad msg3' });
      givenHostileInboundMessage1();

      // Each cycle is a wipe plus a re-adoption, the cheapest attack loop.
      for (let cycle = 0; cycle < HANDSHAKE_PENDING_ADVANCE_LIMIT; cycle += 1) {
        jest.spyOn(Date, 'now').mockReturnValue(Math.max(NOW, state.budget()?.nextAdvanceAt ?? 0));
        await LinkService.advancePendingLinks();
      }

      expect(state.budget()!.exhaustedAt).not.toBeNull();
      const advancesAtExhaustion = mockedNative.advanceHandshake.mock.calls.length;

      // A fresh hostile message 1 must not restart periodic work.
      mockedStorage.upsertLink.mockClear();
      for (let tick = 0; tick < 5; tick += 1) {
        jest.spyOn(Date, 'now').mockReturnValue(NOW + (tick + 1) * 60 * 60 * 1000);
        await LinkService.advancePendingLinks();
      }

      expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(advancesAtExhaustion);
      expect(mockedStorage.upsertLink).not.toHaveBeenCalled();
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('charges every wipe even inside one backoff window', async () => {
      const state = givenResponderHandshake();
      mockedNative.advanceHandshake.mockRejectedValue({ code: 'protocol', message: 'bad msg3' });
      givenHostileInboundMessage1();
      jest.spyOn(Date, 'now').mockReturnValue(NOW);

      // A malformed message 3 forces a wipe on demand, and re-adoption runs off
      // inbound probing, which honours no schedule — so the attacker sets this
      // cadence, not the backoff curve. Throttling this charge the way a
      // `pending` advance is throttled would hand the farm straight back.
      for (let cycle = 0; cycle < HANDSHAKE_PENDING_ADVANCE_LIMIT; cycle += 1) {
        await LinkService.syncInbox([PEER]);
      }

      expect(state.budget()!.pendingAdvances).toBeGreaterThanOrEqual(
        HANDSHAKE_PENDING_ADVANCE_LIMIT,
      );
      expect(state.budget()!.exhaustedAt).not.toBeNull();
    });

    it('refuses an exhausted peer on the sync path before any homeserver IO', async () => {
      givenResponderHandshake(
        storedBudget({ pendingAdvances: HANDSHAKE_PENDING_ADVANCE_LIMIT, exhaustedAt: NOW }),
      );
      mockedStorage.getLink.mockResolvedValue(null);
      givenHostileInboundMessage1();

      await LinkService.syncInbox([PEER]);

      expect(mockedNative.getReceiverMarker).not.toHaveBeenCalled();
      expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
      expect(mockedStorage.upsertLink).not.toHaveBeenCalled();
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('scopes exhaustion to the exact owner and peer', async () => {
      const other = 'c'.repeat(52);
      givenResponderHandshake();
      mockedStorage.getLink.mockResolvedValue(null);
      mockedStorage.getHandshakeBudget.mockImplementation(async (owner, peer) =>
        owner === OWNER && peer === PEER
          ? storedBudget({ pendingAdvances: HANDSHAKE_PENDING_ADVANCE_LIMIT, exhaustedAt: NOW })
          : null,
      );
      mockedNative.probeInboundLink.mockResolvedValue({ result: 'none' });

      await LinkService.syncInbox([PEER, other]);

      expect(mockedNative.getReceiverMarker).toHaveBeenCalledTimes(2);
      expect(mockedNative.getReceiverMarker).toHaveBeenCalledWith(OWNER, LINK_RECEIVER_PATH);
      expect(mockedNative.getReceiverMarker).toHaveBeenCalledWith(other, LINK_RECEIVER_PATH);
      expect(mockedNative.getReceiverMarker).not.toHaveBeenCalledWith(PEER, LINK_RECEIVER_PATH);
    });

    it('lets a deliberate user send clear exhaustion and hand back a full allowance', async () => {
      const state = givenResponderHandshake(
        storedBudget({ pendingAdvances: HANDSHAKE_PENDING_ADVANCE_LIMIT, exhaustedAt: NOW }),
      );
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });

      // The timer refuses the peer outright...
      await LinkService.advancePendingLinks();
      expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();

      // ...and the user deliberately choosing this conversation is the
      // documented override, so exhaustion is never a permanent denial.
      await expect(LinkService.sendDm(PEER, 'hello')).resolves.toEqual(
        expect.objectContaining({ deliveryState: 'sending' }),
      );

      expect(mockedStorage.clearHandshakeBudget).toHaveBeenCalledWith(OWNER, PEER);
      expect(mockedNative.advanceHandshake).toHaveBeenCalledWith('hs-b');
      // A full allowance, not a nearly-spent one: the user's own step is free.
      expect(state.budget()).toBeNull();
    });

    it('does not let a background replay of a queued send clear the budget', async () => {
      givenResponderHandshake(
        storedBudget({ pendingAdvances: HANDSHAKE_PENDING_ADVANCE_LIMIT, exhaustedAt: NOW }),
      );
      mockedStorage.getLinkMessage.mockResolvedValue(sendingRow());
      mockedRetryQueue.getDue.mockResolvedValue([
        {
          id: 'q-stale',
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

      // A timer replaying one stuck item must not refresh the allowance, or the
      // send would never surface as `failed` and the peer keeps its work.
      expect(mockedStorage.clearHandshakeBudget).not.toHaveBeenCalled();
      expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();
      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    });

    it('forgives the budget when the handshake actually completes', async () => {
      const state = givenResponderHandshake();
      mockedNative.advanceHandshake
        .mockResolvedValueOnce({ status: 'pending', snapshot: 'b-msg2b' })
        .mockResolvedValue({ status: 'established', snapshot: 'b-est' });

      await LinkService.advancePendingLinks();
      expect(state.budget()!.pendingAdvances).toBe(1);

      await tickWhenDue(state.budget());

      expect(state.link()!.status).toBe('established');
      expect(state.budget()).toBeNull();
    });
  });

  /**
   * The budget exists to bound work caused by a peer who never completes. A
   * handshake that is converging normally finishes in seconds to minutes, so it
   * must barely touch the budget — the first shipped policy charged on every
   * `pending` advance from every caller, which on device consumed 5/10 during a
   * PASSING convergence and exhausted a legitimate responder outright.
   */
  describe('handshake charge policy — legitimate convergence stays cheap', () => {
    it('charges at most once per backoff window however many callers step it', async () => {
      const state = givenResponderHandshake();
      givenQueuedDm();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });

      // One 30s window, three callers: the timer, a queued-delivery retry, and
      // an inbox sync. All three legitimately step Noise XX.
      await LinkService.advancePendingLinks();
      await LinkService.drainRetries();
      await LinkService.syncInbox([PEER]);

      expect(mockedNative.advanceHandshake.mock.calls.length).toBeGreaterThan(1);
      expect(state.budget()!.pendingAdvances).toBe(1);
    });

    it('keeps a legitimate multi-tick convergence far from exhaustion', async () => {
      const state = givenResponderHandshake();
      givenQueuedDm();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });

      // Two minutes of ordinary convergence: the tick every 30s, a queued
      // delivery retry alongside it, and a thread open in the middle.
      for (let elapsed = 0; elapsed <= 120_000; elapsed += 30_000) {
        jest.spyOn(Date, 'now').mockReturnValue(NOW + elapsed);
        await LinkService.advancePendingLinks();
        await LinkService.drainRetries();
        await LinkService.ensureLinkWith(PEER);
      }

      // Four elapsed windows at most, and the row is still alive and unabandoned.
      expect(state.budget()?.pendingAdvances ?? 0).toBeLessThanOrEqual(4);
      expect(state.budget()?.exhaustedAt ?? null).toBeNull();
      expect(state.link()).not.toBeNull();
      expect(mockedStorage.updateLinkMessageDeliveryState).not.toHaveBeenCalledWith(
        OWNER,
        OWNER,
        CHAT_MESSAGE_KIND,
        EVENT_ID,
        'failed',
      );
    });

    it('never charges a deliberate user action', async () => {
      const state = givenResponderHandshake();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });

      await LinkService.ensureLinkWith(PEER);
      await LinkService.ensureLinkWith(PEER);

      expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(2);
      expect(state.budget()).toBeNull();
    });

    it('keeps the timer due within one interval after a burst of user activity', async () => {
      const state = givenResponderHandshake();
      givenQueuedDm();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });

      // Six non-timer steps inside one window. Charging each one pushed the
      // durable schedule onto the 16-minute rung, which is what silenced the
      // tick on device for 250s+ while an explicit sync converged in 3s.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await LinkService.drainRetries();
        await LinkService.ensureLinkWith(PEER);
      }

      const dueIn = (state.budget()?.nextAdvanceAt ?? NOW) - NOW;
      expect(dueIn).toBeLessThanOrEqual(LINK_RETRY_DRAIN_INTERVAL_MS);

      // ...so the very next tick still sees the link.
      jest.spyOn(Date, 'now').mockReturnValue(NOW + LINK_RETRY_DRAIN_INTERVAL_MS);
      mockedNative.advanceHandshake.mockClear();
      await LinkService.advancePendingLinks();
      expect(mockedNative.advanceHandshake).toHaveBeenCalled();
    });

    it('clears the budget on a user send even while the handshake handle is live', async () => {
      const state = givenResponderHandshake();
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'b-msg2b' });

      // Put a live handshaking handle in memory the way a prior tick does.
      await LinkService.advancePendingLinks();
      expect(state.budget()!.pendingAdvances).toBe(1);

      // Now exhaust it, as an over-charged legitimate peer was on device.
      await StorageService.upsertHandshakeBudget({
        ownerPubky: OWNER,
        peerPubky: PEER,
        pendingAdvances: HANDSHAKE_PENDING_ADVANCE_LIMIT,
        nextAdvanceAt: NOW + 30 * 60 * 1000,
        exhaustedAt: NOW,
      });
      mockedStorage.clearHandshakeBudget.mockClear();

      // The documented recovery has to work through the live-handle path too.
      await expect(LinkService.sendDm(PEER, 'hello')).resolves.toEqual(
        expect.objectContaining({ deliveryState: 'sending' }),
      );

      expect(mockedStorage.clearHandshakeBudget).toHaveBeenCalledWith(OWNER, PEER);
      expect(state.budget()).toBeNull();
      expect(state.link()).not.toBeNull();
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
