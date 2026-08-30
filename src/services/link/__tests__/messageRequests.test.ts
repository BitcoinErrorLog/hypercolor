import { LinkService } from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { RetryQueue } from '../../RetryQueue';
import { LINK_RECEIVER_PATH, type LinkReceiver, type LinkRecord } from '../../../types/link';
import type { Contact, MessageRequest } from '../../../types';

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
    listDeliveryQueue: jest.fn(),
    removeFromQueue: jest.fn(),
    getContact: jest.fn(),
    getAllContacts: jest.fn(),
    getMessageRequest: jest.fn(),
    upsertMessageRequest: jest.fn(),
    listMessageRequests: jest.fn(),
    countPendingMessageRequests: jest.fn(),
    deleteLinkStreamItemsForPeer: jest.fn(),
    deleteLinkMessagesForPeer: jest.fn(),
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
    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signinWithSecret.mockResolvedValue({ sessionAlias: SESSION_ALIAS, pubky: OWNER });
    mockedNative.signOutSession.mockResolvedValue(undefined);
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
    mockedStorage.getLinkReceiver.mockResolvedValue(receiverRow);
    mockedStorage.getLink.mockResolvedValue(null);
    mockedStorage.getAllLinks.mockResolvedValue([]);
    mockedStorage.listDeliveryQueue.mockResolvedValue([]);
    mockedStorage.hasLinkMessage.mockResolvedValue(false);
    mockedStorage.getUnprocessedLinkStreamItems.mockResolvedValue([]);
    mockedStorage.getContact.mockResolvedValue(null);
    mockedStorage.getAllContacts.mockResolvedValue([]);
    mockedStorage.getMessageRequest.mockResolvedValue(null);
    mockedRetryQueue.getDue.mockResolvedValue([]);

    await LinkService.clearSession();
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

  it('auto-accepts inbound from someone I already follow', async () => {
    mockedStorage.getContact.mockResolvedValue(followingContact());

    const received = await LinkService.syncInbox([PEER]);

    expect(received).toEqual([]);
    expect(mockedStorage.upsertMessageRequest).not.toHaveBeenCalled();
    expect(mockedNative.receivePrivateMessages).toHaveBeenCalled();
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
});
