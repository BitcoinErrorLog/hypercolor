import {
  LinkService,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  LINK_RETRY_PAYLOAD_TYPE,
} from '../../link/LinkService';
import { PaykitLinkNative } from '../../link/PaykitLinkNative';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { RetryQueue } from '../../RetryQueue';
import { FollowsImportSettings } from '../followsImportSettings';
import { wireSignOutMarkerMocks } from '../../__tests__/wireSignOutMarkerMocks';
import { blockPeer, unblockPeer } from '../blockPeer';
import {
  LINK_RECEIVER_PATH,
  CHAT_MESSAGE_KIND,
  type LinkReceiver,
  type LinkRecord,
} from '../../../types/link';
import { GROUP_MESSAGE_KIND } from '../../../types/group';
import type { DeliveryQueueItem, MessageRequest } from '../../../types';

jest.mock('../../link/PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(),
    generateReceiverKey: jest.fn(),
    getReceiverPublicKey: jest.fn(),
    startAuthFlow: jest.fn(),
    awaitAuthApproval: jest.fn(),
    stopAuthKeepalive: jest.fn(),
    signinWithSecret: jest.fn(),
    adoptAuthSession: jest.fn(),
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
    removeFromQueue: jest.fn(),
    getContact: jest.fn(),
    getAllContacts: jest.fn(),
    getMessageRequest: jest.fn(),
    deleteMessageRequest: jest.fn(),
    hasGroupEvent: jest.fn(),
    getGroupChannel: jest.fn(),
    insertInboundPrivateCreate: jest.fn(),
    saveGroupMessage: jest.fn(),
    upsertMessageRequest: jest.fn(),
    listMessageRequests: jest.fn(),
    countPendingMessageRequests: jest.fn(),
    deleteLinkStreamItemsForPeer: jest.fn(),
    deleteLinkMessagesForPeer: jest.fn(),
    countLinkMessagesForPeer: jest.fn(),
    settleExcessUnprocessedLinkStreamItems: jest.fn(),
    deleteGroupDeferredForSender: jest.fn(),
    deleteGroupSeenEventsForSender: jest.fn(),
    setContactRelationshipFlags: jest.fn(),
    getDueHandshakingLinks: jest.fn(),
    hasQueueItem: jest.fn(),
    countDeliveryQueueForMessage: jest.fn(),
    upsertGroupFanoutOutcome: jest.fn(),
    listGroupFanoutOutcomes: jest.fn(),
    hasGroupMessage: jest.fn(),
    updateGroupMessageDeliveryState: jest.fn(),
    updateAttachmentDelivery: jest.fn(),
    completeGroupFanoutRecipient: jest.fn(),
    listBlockedPeers: jest.fn(),
    listBlockedPeerCleanupPending: jest.fn(),
    setBlockedPeerCleanupPending: jest.fn(),
    insertBlockedPeer: jest.fn(),
    insertBlockedPeers: jest.fn(),
    deleteBlockedPeer: jest.fn(),
  },
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
    isInitialized: jest.fn(() => true),
    getPubky: jest.fn(),
    setPubky: jest.fn(),
    getLinkSession: jest.fn(),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
    deleteLinkSessionIfAlias: jest.fn(() => true),
    readLinkSession: jest.fn(() => ({ ok: true, alias: null })),
    markSignOutIncomplete: jest.fn(),
    isSignOutIncomplete: jest.fn(() => false),
    getSignOutIncompleteOwner: jest.fn(() => null),
    clearSignOutIncomplete: jest.fn(),
  },
}));

jest.mock('../../RetryQueue', () => ({
  RetryQueue: {
    getDue: jest.fn(),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
    defer: jest.fn(),
    wouldDrop: jest.fn((attempts: number) => attempts + 1 >= 10),
  },
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => '00000000-0000-4000-8000-0000000000aa') }));

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedStorage = jest.mocked(StorageService);
const mockedKeyStore = jest.mocked(KeyStore);
const mockedRetryQueue = jest.mocked(RetryQueue);

const NOW = 1_700_000_000_000;
const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const OTHER = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';
const SESSION_ALIAS = 'session-alias-1';
const RECEIVER_ALIAS = 'receiver-alias-1';
const PEER_NOISE = 'peer-noise-pk';

const receiverRow: LinkReceiver = {
  ownerPubky: OWNER,
  receiverAlias: RECEIVER_ALIAS,
  receiverPath: LINK_RECEIVER_PATH,
  markerPublished: true,
  updatedAt: NOW,
};

function storedLink(): LinkRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    role: 'responder',
    status: 'established',
    snapshot: 'est-in',
    remoteNoisePublicKey: PEER_NOISE,
    localReceiverPath: LINK_RECEIVER_PATH,
    remoteReceiverPath: LINK_RECEIVER_PATH,
    consecutiveFailures: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('inbound deny is authoritative', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    FollowsImportSettings.resetForTests();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signinWithSecret.mockResolvedValue({ sessionAlias: SESSION_ALIAS, pubky: OWNER });
    mockedNative.signOutSession.mockResolvedValue(undefined);
    mockedNative.clearAllNativeSecrets.mockResolvedValue(undefined);
    mockedNative.closeLink.mockResolvedValue(undefined);
    mockedNative.clearLinkOutbox.mockResolvedValue(0);
    mockedNative.getReceiverMarker.mockResolvedValue({
      noisePublicKey: PEER_NOISE,
      capabilitiesJson: '{}',
    });
    mockedNative.getReceiverPublicKey.mockResolvedValue(PEER_NOISE);
    mockedNative.probeInboundLink.mockResolvedValue({
      result: 'established',
      linkId: 'inbound-1',
      snapshot: 'est-in',
    });
    mockedNative.receivePrivateMessages.mockResolvedValue({ messages: [], snapshot: 'est-in' });
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    wireSignOutMarkerMocks(mockedKeyStore, mockedStorage);
    mockedStorage.getLinkReceiver.mockResolvedValue(receiverRow);
    mockedStorage.getLink.mockResolvedValue(null);
    mockedStorage.getAllLinks.mockResolvedValue([]);
    mockedStorage.listDeliveryQueue.mockResolvedValue([]);
    mockedStorage.hasLinkMessage.mockResolvedValue(false);
    mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValue([]);
    mockedStorage.getContact.mockResolvedValue(null);
    mockedStorage.getAllContacts.mockResolvedValue([]);
    mockedStorage.getMessageRequest.mockResolvedValue(null);
    mockedStorage.deleteMessageRequest.mockResolvedValue(undefined);
    mockedStorage.countLinkMessagesForPeer.mockResolvedValue(0);
    mockedStorage.getDueHandshakingLinks.mockResolvedValue([]);
    mockedStorage.hasQueueItem.mockResolvedValue(true);
    mockedStorage.countDeliveryQueueForMessage.mockResolvedValue(0);
    mockedStorage.hasGroupMessage.mockResolvedValue(true);
    mockedStorage.upsertGroupFanoutOutcome.mockImplementation(async outcome => {
      const current = await mockedStorage.listGroupFanoutOutcomes(
        outcome.ownerPubky,
        outcome.channelId,
        outcome.senderPubky,
        outcome.eventId,
      );
      mockedStorage.listGroupFanoutOutcomes.mockResolvedValue([...current, outcome]);
    });
    mockedStorage.listGroupFanoutOutcomes.mockResolvedValue([]);
    mockedStorage.getHandshakeBudget.mockResolvedValue(null);
    mockedRetryQueue.getDue.mockResolvedValue([]);
    const denyRows = new Map<string, Set<string>>();
    mockedStorage.insertBlockedPeer.mockImplementation(async (owner, peer) => {
      const set = denyRows.get(owner) ?? new Set<string>();
      set.add(peer);
      denyRows.set(owner, set);
    });
    mockedStorage.insertBlockedPeers.mockImplementation(async (owner, peers) => {
      const set = denyRows.get(owner) ?? new Set<string>();
      for (const peer of peers) set.add(peer);
      denyRows.set(owner, set);
    });
    mockedStorage.deleteBlockedPeer.mockImplementation(async (owner, peer) => {
      denyRows.get(owner)?.delete(peer);
    });
    mockedStorage.listBlockedPeers.mockImplementation(async owner => [
      ...(denyRows.get(owner) ?? []),
    ]);
    mockedStorage.listBlockedPeerCleanupPending.mockResolvedValue([]);
    mockedStorage.setBlockedPeerCleanupPending.mockResolvedValue(undefined);
    mockedStorage.completeGroupFanoutRecipient.mockResolvedValue(undefined);
    mockedStorage.failLinkMessageAndDequeue.mockResolvedValue(undefined);

    await LinkService.clearSession();
    mockedKeyStore.clearSignOutIncomplete();
    await mockedStorage.clearSignOutIncompleteJournal();
    await LinkService.signinWithSecret('signin-secret-hex');
  });

  afterEach(() => {
    FollowsImportSettings.resetForTests();
    jest.restoreAllMocks();
  });

  it('omits a blocked peer from collectInboxCandidates even when the contact row remains', async () => {
    await FollowsImportSettings.block(OWNER, PEER);
    mockedStorage.getAllContacts.mockResolvedValue([
      {
        pubky: PEER,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: false,
        isFollower: false,
        isMutual: false,
        addedManually: true,
        firstSeenAt: NOW,
      },
      {
        pubky: OTHER,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: false,
        isFollower: false,
        isMutual: false,
        addedManually: true,
        firstSeenAt: NOW,
      },
    ]);
    mockedStorage.getAllLinks.mockResolvedValue([]);
    const candidates = await LinkService.collectInboxCandidates();
    expect(candidates).toEqual([OTHER]);
    expect(candidates).not.toContain(PEER);
  });

  it('denies an explicit syncInbox(peers) probe when the owner deny list is set', async () => {
    await FollowsImportSettings.block(OWNER, PEER);
    const received = await LinkService.syncInbox([PEER]);
    expect(received).toEqual([]);
    expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
    expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
    expect(mockedStorage.saveLinkMessage).not.toHaveBeenCalled();
  });

  it.each([
    [
      'wipe deleteLink',
      () => {
        mockedStorage.getLink.mockResolvedValue(storedLink());
        mockedStorage.deleteLink.mockRejectedValue(new Error('delete link failed'));
      },
    ],
    [
      'deleteLinkStreamItemsForPeer',
      () => {
        mockedStorage.deleteLinkStreamItemsForPeer.mockRejectedValue(
          new Error('stream wipe failed'),
        );
      },
    ],
    [
      'deleteLinkMessagesForPeer',
      () => {
        mockedStorage.deleteLinkMessagesForPeer.mockRejectedValue(new Error('message wipe failed'));
      },
    ],
    [
      'deleteGroupDeferredForSender',
      () => {
        mockedStorage.deleteGroupDeferredForSender.mockRejectedValue(
          new Error('deferred wipe failed'),
        );
      },
    ],
    [
      'deleteGroupSeenEventsForSender',
      () => {
        mockedStorage.deleteGroupSeenEventsForSender.mockRejectedValue(
          new Error('seen wipe failed'),
        );
      },
    ],
    [
      'upsertMessageRequest declined',
      () => {
        mockedStorage.upsertMessageRequest.mockRejectedValue(new Error('declined write failed'));
      },
    ],
  ] as const)('keeps inbound denied when decline fails at %s', async (_name, failStep) => {
    failStep();
    const outcome = await blockPeer({
      ownerPubky: OWNER,
      peerPubky: PEER,
      persistBlock: (owner, peer) => FollowsImportSettings.block(owner, peer),
      declineMessageRequest: peer => LinkService.declineMessageRequest(peer),
      deleteContact: async () => undefined,
    });
    expect(outcome.blocked).toBe(true);
    expect(outcome.cleanup).toBe('pending');
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(true);

    mockedStorage.deleteLink.mockResolvedValue(undefined);
    mockedStorage.deleteLinkStreamItemsForPeer.mockResolvedValue(undefined);
    mockedStorage.deleteLinkMessagesForPeer.mockResolvedValue(undefined);
    mockedStorage.deleteGroupDeferredForSender.mockResolvedValue(undefined);
    mockedStorage.deleteGroupSeenEventsForSender.mockResolvedValue(undefined);
    mockedStorage.upsertMessageRequest.mockResolvedValue(undefined);
    mockedNative.probeInboundLink.mockClear();
    mockedStorage.upsertMessageRequest.mockClear();
    const received = await LinkService.syncInbox([PEER]);
    expect(received).toEqual([]);
    expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
    expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('re-add after unblock releases declined so inbound can become a new pending request', async () => {
    let request: MessageRequest | null = {
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'declined',
    };
    mockedStorage.getMessageRequest.mockImplementation(async () => request);
    mockedStorage.deleteMessageRequest.mockImplementation(async () => {
      request = null;
    });
    mockedStorage.upsertMessageRequest.mockImplementation(async next => {
      request = next;
    });

    await FollowsImportSettings.block(OWNER, PEER);
    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);
    expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();

    await unblockPeer({
      ownerPubky: OWNER,
      peerPubky: PEER,
      persistUnblock: (owner, peer) => FollowsImportSettings.unblock(owner, peer),
      releaseDeclinedRequest: (owner, peer) => LinkService.releaseDeclinedRequest(owner, peer),
    });
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    expect(request).toBeNull();

    mockedNative.probeInboundLink.mockClear();
    const received = await LinkService.syncInbox([PEER]);
    expect(received).toEqual([]);
    expect(mockedNative.probeInboundLink).toHaveBeenCalled();
    expect(request?.status).toBe('pending');
  });

  it('does not advance a leftover handshaking link while cleanup is pending', async () => {
    const leftover: LinkRecord = {
      ...storedLink(),
      status: 'handshaking',
      role: 'responder',
      snapshot: 'b-msg2',
    };
    mockedStorage.getLink.mockResolvedValue(leftover);
    mockedStorage.deleteLink.mockRejectedValue(new Error('delete link failed'));
    mockedStorage.getDueHandshakingLinks.mockResolvedValue([leftover]);

    const outcome = await blockPeer({
      ownerPubky: OWNER,
      peerPubky: PEER,
      persistBlock: (owner, peer) => FollowsImportSettings.block(owner, peer),
      declineMessageRequest: peer => LinkService.declineMessageRequest(peer),
      deleteContact: async () => undefined,
    });
    expect(outcome.cleanup).toBe('pending');
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(true);
    expect(await StorageService.getLink(OWNER, PEER)).toEqual(leftover);

    mockedNative.restoreHandshake.mockClear();
    mockedNative.advanceHandshake.mockClear();
    mockedNative.probeInboundLink.mockClear();
    mockedNative.initiateLink.mockClear();
    mockedNative.getReceiverMarker.mockClear();
    mockedNative.restoreLink.mockClear();

    await LinkService.advancePendingLinks();

    expect(mockedNative.restoreHandshake).not.toHaveBeenCalled();
    expect(mockedNative.advanceHandshake).not.toHaveBeenCalled();
    expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
    expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    expect(mockedNative.getReceiverMarker).not.toHaveBeenCalled();
    expect(mockedNative.restoreLink).not.toHaveBeenCalled();
  });

  it('drops a queued payload to a blocked peer instead of delivering it', async () => {
    await FollowsImportSettings.block(OWNER, PEER);
    const queueItem: DeliveryQueueItem = {
      id: 'q-blocked',
      messageId: 'evt-blocked',
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_RETRY_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: 'evt-blocked',
        rawJson: '{}',
      }),
      attempts: 0,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    mockedRetryQueue.getDue.mockResolvedValue([queueItem]);
    mockedStorage.hasQueueItem.mockResolvedValue(true);
    mockedStorage.getLinkMessage.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: 'evt-blocked',
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: 'sent',
      kind: CHAT_MESSAGE_KIND,
      rawJson: '{}',
      body: 'hello',
      sentAt: NOW,
      receivedAt: null,
      deliveryState: 'sending',
    });
    mockedNative.sendPrivateMessageJson.mockClear();

    await LinkService.drainRetries();

    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    expect(mockedStorage.failLinkMessageAndDequeue).toHaveBeenCalledWith({
      ownerPubky: OWNER,
      senderPubky: OWNER,
      kind: CHAT_MESSAGE_KIND,
      eventId: 'evt-blocked',
      queueId: 'q-blocked',
    });
    expect(mockedRetryQueue.recordSuccess).not.toHaveBeenCalled();
    expect(mockedRetryQueue.defer).not.toHaveBeenCalled();
    expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
  });

  it('finalizes group fan-out as failed when the last recipient is blocked', async () => {
    await FollowsImportSettings.block(OWNER, PEER);
    const queueItem: DeliveryQueueItem = {
      id: 'q-group-blocked',
      messageId: 'evt-group-blocked',
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: GROUP_MESSAGE_KIND,
        eventId: 'evt-group-blocked',
        channelId: `${OWNER}:00000000-0000-4000-8000-00000000bbbb`,
        rawJson: '{}',
      }),
      attempts: 0,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    mockedRetryQueue.getDue.mockResolvedValue([queueItem]);
    mockedStorage.hasQueueItem.mockResolvedValue(true);
    mockedStorage.hasGroupMessage.mockResolvedValue(true);
    mockedStorage.countDeliveryQueueForMessage.mockResolvedValue(0);
    mockedNative.sendPrivateMessageJson.mockClear();

    await LinkService.drainRetries();

    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    expect(mockedStorage.completeGroupFanoutRecipient).toHaveBeenCalledWith({
      ownerPubky: OWNER,
      channelId: `${OWNER}:00000000-0000-4000-8000-00000000bbbb`,
      eventId: 'evt-group-blocked',
      senderPubky: OWNER,
      recipientPubky: PEER,
      status: 'failed',
      reason: 'blocked',
      queueId: 'q-group-blocked',
      kind: GROUP_MESSAGE_KIND,
    });
    expect(mockedRetryQueue.recordSuccess).not.toHaveBeenCalled();
    expect(mockedRetryQueue.defer).not.toHaveBeenCalled();
    expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
  });

  it('stops remaining inbox probes when the owner switches mid-loop', async () => {
    const OWNER_B = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
    mockedNative.probeInboundLink.mockImplementation(async () => {
      mockedNative.signinWithSecret.mockResolvedValue({
        sessionAlias: 'session-b',
        pubky: OWNER_B,
      });
      mockedKeyStore.getPubky.mockReturnValue(OWNER_B);
      await LinkService.signinWithSecret('owner-b-secret');
      return { result: 'established', linkId: 'inbound-switch', snapshot: 'est-in' };
    });

    await LinkService.syncInbox([PEER, OTHER]);

    expect(mockedNative.probeInboundLink).toHaveBeenCalledTimes(1);
  });
});
