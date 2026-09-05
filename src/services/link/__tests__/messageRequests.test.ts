import { LINK_INBOX_PEER_TIMEOUT_MS, LinkService } from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { RetryQueue } from '../../RetryQueue';
import { FollowsImportSettings } from '../../contacts/followsImportSettings';
import { wireSignOutMarkerMocks } from '../../__tests__/wireSignOutMarkerMocks';
import { LINK_RECEIVER_PATH, type LinkReceiver, type LinkRecord } from '../../../types/link';
import { buildGroupMembershipEnvelope } from '../../../types/group';
import type { Contact, MessageRequest } from '../../../types';

jest.mock('../PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(),
    generateReceiverKey: jest.fn(),
    getReceiverPublicKey: jest.fn(),
    startAuthFlow: jest.fn(),
    awaitAuthApproval: jest.fn(),
    adoptAuthSession: jest.fn(),
    reconcileAdoptedSessions: jest.fn(),
    stopAuthKeepalive: jest.fn(),
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
    hasGroupEvent: jest.fn(),
    getGroupChannel: jest.fn(),
    insertInboundPrivateCreate: jest.fn(),
    saveGroupMessage: jest.fn(),
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
    listBlockedPeers: jest.fn(),
    listBlockedPeerCleanupPending: jest.fn(),
    setBlockedPeerCleanupPending: jest.fn(),
    insertBlockedPeer: jest.fn(),
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
    getPubky: jest.fn(),
    setPubky: jest.fn(),
    getLinkSession: jest.fn(),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
    deleteLinkSessionIfAlias: jest.fn(),
    isInitialized: jest.fn(() => true),
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
  },
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => '00000000-0000-4000-8000-0000000000aa') }));

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedStorage = jest.mocked(StorageService);
const mockedKeyStore = jest.mocked(KeyStore);
const mockedRetryQueue = jest.mocked(RetryQueue);

const NOW = 1_700_000_000_000;
const OWNER = 'a'.repeat(52);
const PEER = 'z'.repeat(52);
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

function followingContact(): Contact {
  return {
    pubky: PEER,
    ownerPubky: OWNER,
    trustScore: 0.1,
    isFollowing: true,
    isFollower: false,
    isMutual: false,
    addedManually: false,
    firstSeenAt: NOW,
  };
}

function pendingRequest(status: MessageRequest['status'] = 'pending'): MessageRequest {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    createdAt: NOW,
    updatedAt: NOW,
    status,
  };
}

describe('LinkService message requests', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    FollowsImportSettings.resetForTests();
    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signinWithSecret.mockResolvedValue({ sessionAlias: SESSION_ALIAS, pubky: OWNER });
    mockedNative.adoptAuthSession.mockResolvedValue(undefined);
    mockedNative.signOutSession.mockResolvedValue(undefined);
    mockedNative.clearAllNativeSecrets.mockResolvedValue(undefined);
    mockedNative.closeLink.mockResolvedValue(undefined);
    mockedNative.clearLinkOutbox.mockResolvedValue(0);
    mockedNative.getReceiverMarker.mockResolvedValue({
      noisePublicKey: PEER_NOISE,
      capabilitiesJson: '{}',
    });
    mockedNative.probeInboundLink.mockResolvedValue({
      result: 'established',
      linkId: 'inbound-1',
      snapshot: 'est-in',
    });
    mockedNative.receivePrivateMessages.mockResolvedValue({ messages: [], snapshot: 'est-in' });
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedKeyStore.isInitialized.mockReturnValue(true);
    mockedKeyStore.getLinkSession.mockReturnValue(null);
    mockedKeyStore.setLinkSession.mockImplementation((alias: string) => {
      mockedKeyStore.getLinkSession.mockReturnValue(alias);
    });
    mockedKeyStore.deleteLinkSession.mockImplementation(() => {
      mockedKeyStore.getLinkSession.mockReturnValue(null);
    });
    mockedKeyStore.deleteLinkSessionIfAlias.mockImplementation((alias: string) => {
      if (mockedKeyStore.getLinkSession() !== alias) return false;
      mockedKeyStore.deleteLinkSession();
      return true;
    });
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
    mockedStorage.acceptDeclinedMessageRequest.mockResolvedValue(false);
    mockedStorage.countLinkMessagesForPeer.mockResolvedValue(0);
    mockedStorage.listBlockedPeers.mockResolvedValue([]);
    mockedStorage.listBlockedPeerCleanupPending.mockResolvedValue([]);
    mockedStorage.getHandshakeBudget.mockResolvedValue(null);
    mockedRetryQueue.getDue.mockResolvedValue([]);

    await LinkService.clearSession();
    mockedKeyStore.clearSignOutIncomplete();
    await mockedStorage.clearSignOutIncompleteJournal();
    await LinkService.signinWithSecret('signin-secret-hex');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('holds a stranger inbound link as a pending message request and hides it from the inbox', async () => {
    const received = await LinkService.syncInbox([PEER]);

    expect(received).toEqual([]);
    expect(mockedStorage.upsertMessageRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPubky: OWNER,
        peerPubky: PEER,
        status: 'pending',
      }),
    );
    expect(mockedStorage.saveLinkMessage).not.toHaveBeenCalled();
    expect(mockedNative.initiateLink).not.toHaveBeenCalled();
  });

  it('probes a later peer when an earlier marker fetch never settles', async () => {
    jest.useFakeTimers();
    const slowPeer = 'b'.repeat(52);
    mockedNative.getReceiverMarker.mockImplementation(async peer => {
      if (peer === slowPeer) {
        return new Promise(() => {});
      }
      return { noisePublicKey: PEER_NOISE, capabilitiesJson: '{}' };
    });
    mockedNative.probeInboundLink.mockImplementation(async (_session, _receiver, peer) => {
      if (peer === PEER) {
        return { result: 'pending', linkId: 'from-web', snapshot: 'msg1' };
      }
      return { result: 'none' };
    });

    try {
      const done = LinkService.syncInbox([slowPeer, PEER]);
      await jest.advanceTimersByTimeAsync(LINK_INBOX_PEER_TIMEOUT_MS);
      await expect(done).resolves.toEqual([]);
      expect(mockedNative.probeInboundLink).toHaveBeenCalledWith(
        SESSION_ALIAS,
        RECEIVER_ALIAS,
        PEER,
        PEER_NOISE,
        LINK_RECEIVER_PATH,
        LINK_RECEIVER_PATH,
      );
      expect(mockedStorage.upsertMessageRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: OWNER,
          peerPubky: PEER,
          status: 'pending',
        }),
      );
      expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalledWith(
        expect.objectContaining({ peerPubky: slowPeer }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('finishes inbox sync when a peer marker fetch never settles', async () => {
    jest.useFakeTimers();
    mockedNative.getReceiverMarker.mockImplementation(() => new Promise(() => {}));
    try {
      const done = LinkService.syncInbox([PEER]);
      await jest.advanceTimersByTimeAsync(LINK_INBOX_PEER_TIMEOUT_MS);
      await expect(done).resolves.toEqual([]);
      expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
      expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  // Previously asserted that a held stranger's membership `create` was
  // applied. That was the bug: `channel_id` is sender-chosen, so the
  // founder-bound check self-certifies and the create landed a named channel
  // plus a roster containing the recipient with no acceptance. It is now
  // deferred on the carrying stream item. Full coverage of the gate,
  // including accept replay and decline, lives in groupAcceptGate.test.ts.
  it('defers a stranger group membership create while holding the DM as a request', async () => {
    const channelId = `${PEER}:00000000-0000-4000-8000-00000000aaaa`;
    const packed = buildGroupMembershipEnvelope({
      channelId,
      eventId: '00000000-0000-4000-8000-000000000001',
      sentAt: NOW,
      op: 'create',
      name: 'held-group',
      members: [OWNER, PEER],
    });
    let held: Array<{
      id: string;
      ownerPubky: string;
      peerPubky: string;
      rawJson: string;
      kind: string | null;
      receivedAt: number;
      processed: boolean;
    }> = [];
    mockedStorage.saveLinkStreamItems.mockImplementation(async items => {
      held = items.map(item => ({ ...item, processed: false }));
    });
    mockedStorage.getUnprocessedLinkStreamItems.mockImplementation(async () =>
      held.filter(item => !item.processed),
    );
    mockedStorage.markLinkStreamItemProcessed.mockImplementation(async id => {
      held = held.map(item => (item.id === id ? { ...item, processed: true } : item));
    });
    mockedStorage.hasGroupEvent.mockResolvedValue(false);
    mockedStorage.getGroupChannel.mockResolvedValue(null);
    mockedStorage.insertInboundPrivateCreate.mockResolvedValue('inserted');
    mockedStorage.saveGroupMessage.mockResolvedValue(true);
    mockedNative.receivePrivateMessages.mockResolvedValue({
      messages: [{ version: 1, kind: packed.envelope.kind, rawJson: packed.json }],
      snapshot: 'est-in',
    });

    const received = await LinkService.syncInbox([PEER]);

    expect(received).toEqual([]);
    expect(mockedStorage.upsertMessageRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
    expect(mockedStorage.insertInboundPrivateCreate).not.toHaveBeenCalled();
    expect(mockedStorage.markGroupEventSeen).not.toHaveBeenCalled();
    expect(mockedStorage.markLinkStreamItemProcessed).not.toHaveBeenCalled();
    expect(held.filter(item => !item.processed)).toHaveLength(1);
    expect(mockedStorage.saveLinkMessage).not.toHaveBeenCalled();
  });

  it('holds inbound from someone I already follow as a message request', async () => {
    mockedStorage.getContact.mockResolvedValue(followingContact());

    const received = await LinkService.syncInbox([PEER]);

    expect(received).toEqual([]);
    expect(mockedStorage.upsertMessageRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPubky: OWNER,
        peerPubky: PEER,
        status: 'pending',
      }),
    );
    expect(mockedStorage.saveLinkMessage).not.toHaveBeenCalled();
  });

  it('accepting a request promotes it and routes held stream items', async () => {
    let status: MessageRequest['status'] = 'pending';
    mockedStorage.getMessageRequest.mockImplementation(async () => pendingRequest(status));
    mockedStorage.upsertMessageRequest.mockImplementation(async request => {
      status = request.status;
    });
    mockedStorage.getLink.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: 'responder',
      status: 'established',
      snapshot: 'est-in',
      remoteNoisePublicKey: PEER_NOISE,
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      updatedAt: NOW,
    } satisfies LinkRecord);
    mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-1' });
    mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValue([
      {
        id: 'held-1',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: 'chat.message.v0',
        rawJson: JSON.stringify({
          version: 1,
          kind: 'chat.message.v0',
          event_id: '00000000-0000-4000-8000-000000000001',
          sent_at: NOW,
          body: 'hello from request',
        }),
        receivedAt: NOW,
        processed: false,
      },
    ]);

    const routed = await LinkService.acceptMessageRequest(PEER);

    expect(mockedStorage.upsertMessageRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted' }),
    );
    expect(routed).toHaveLength(1);
    expect(routed[0]?.body).toBe('hello from request');
    expect(mockedStorage.saveLinkMessage).toHaveBeenCalled();
  });

  it('declining a request wipes the link, clears the outbox, and stores declined', async () => {
    const stored: LinkRecord = {
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: 'responder',
      status: 'handshaking',
      snapshot: 'hs',
      remoteNoisePublicKey: PEER_NOISE,
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      updatedAt: NOW,
    };
    mockedStorage.getLink.mockResolvedValue(stored);
    mockedStorage.getMessageRequest.mockResolvedValue(pendingRequest('pending'));

    await LinkService.declineMessageRequest(PEER);

    expect(mockedNative.clearLinkOutbox).toHaveBeenCalled();
    expect(mockedStorage.deleteLink).toHaveBeenCalledWith(OWNER, PEER);
    expect(mockedStorage.deleteLinkStreamItemsForPeer).toHaveBeenCalledWith(OWNER, PEER);
    expect(mockedStorage.deleteLinkMessagesForPeer).toHaveBeenCalledWith(OWNER, PEER);
    expect(mockedStorage.deleteGroupDeferredForSender).toHaveBeenCalledWith(OWNER, PEER);
    expect(mockedStorage.deleteGroupSeenEventsForSender).toHaveBeenCalledWith(OWNER, PEER);
    expect(mockedStorage.upsertMessageRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'declined' }),
    );
  });

  it('collectInboxCandidates unions contacts and existing link peers', async () => {
    const other = 'y'.repeat(52);
    mockedStorage.getAllContacts.mockResolvedValue([
      {
        pubky: PEER,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: true,
        isFollower: false,
        isMutual: false,
        addedManually: false,
        firstSeenAt: NOW,
      },
    ]);
    mockedStorage.getAllLinks.mockResolvedValue([
      {
        ownerPubky: OWNER,
        peerPubky: other,
        role: 'initiator',
        status: 'established',
        snapshot: 'x',
        remoteNoisePublicKey: 'n',
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
        updatedAt: NOW,
      },
    ]);

    const candidates = await LinkService.collectInboxCandidates();
    expect(candidates.sort()).toEqual([PEER, other].sort());
  });

  it('declined stays declined across re-sync with re-initiated inbound', async () => {
    mockedStorage.getMessageRequest.mockResolvedValue(pendingRequest('declined'));
    mockedStorage.getLink.mockResolvedValue(null);
    mockedNative.probeInboundLink.mockResolvedValue({
      result: 'established',
      linkId: 'inbound-reprobe',
      snapshot: 'est-again',
    });

    const received = await LinkService.syncInbox([PEER]);

    expect(received).toEqual([]);
    expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
    expect(mockedStorage.saveLinkStreamItems).not.toHaveBeenCalled();
    expect(mockedStorage.saveLinkMessage).not.toHaveBeenCalled();
    expect(mockedNative.receivePrivateMessages).not.toHaveBeenCalled();
    expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
    expect(mockedNative.clearLinkOutbox).toHaveBeenCalled();
  });

  it('refuses to accept a previously declined request', async () => {
    mockedStorage.getMessageRequest.mockResolvedValue(pendingRequest('declined'));
    mockedStorage.getLink.mockResolvedValue(null);

    await expect(LinkService.acceptMessageRequest(PEER)).rejects.toThrow(
      'Cannot accept a declined message request',
    );

    expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
    expect(mockedStorage.acceptDeclinedMessageRequest).not.toHaveBeenCalled();
    expect(mockedNative.receivePrivateMessages).not.toHaveBeenCalled();
    expect(mockedNative.restoreLink).not.toHaveBeenCalled();
    expect(mockedStorage.saveLinkMessage).not.toHaveBeenCalled();
    expect(mockedStorage.saveLinkStreamItems).not.toHaveBeenCalled();
  });

  it('acceptDeclinedRequest promotes declined to accepted without using sticky upsert', async () => {
    let status: MessageRequest['status'] = 'declined';
    mockedStorage.getMessageRequest.mockImplementation(async () => pendingRequest(status));
    mockedStorage.acceptDeclinedMessageRequest.mockImplementation(async () => {
      status = 'accepted';
      return true;
    });
    mockedStorage.getLink.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: 'responder',
      status: 'established',
      snapshot: 'est-in',
      remoteNoisePublicKey: PEER_NOISE,
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      updatedAt: NOW,
    } satisfies LinkRecord);
    mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-1' });
    mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValue([]);

    await LinkService.acceptDeclinedRequest(PEER);

    expect(mockedStorage.acceptDeclinedMessageRequest).toHaveBeenCalledWith(OWNER, PEER);
    expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
    expect(mockedNative.restoreLink).toHaveBeenCalled();
  });

  it('classifies a wiped established conversation as auto-accept, not a new request', async () => {
    mockedStorage.getLink.mockResolvedValue(null);
    mockedStorage.getMessageRequest.mockResolvedValue(null);
    mockedStorage.getContact.mockResolvedValue({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: false,
      isFollower: false,
      isMutual: false,
      addedManually: false,
      firstSeenAt: NOW,
    });
    mockedStorage.countLinkMessagesForPeer.mockResolvedValue(3);
    mockedNative.restoreLink.mockResolvedValue({ linkId: 'recovered-1' });

    const received = await LinkService.syncInbox([PEER]);

    expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
    expect(mockedNative.receivePrivateMessages).toHaveBeenCalled();
    expect(received).toEqual([]);
  });
});
