import { v4 as uuidv4 } from 'uuid';
import { LinkService, LINK_RETRY_PAYLOAD_TYPE } from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { RetryQueue } from '../../RetryQueue';
import { CHAT_MESSAGE_KIND, type LinkReceiver, type LinkRecord } from '../../../types/link';
import type { DeliveryQueueItem } from '../../../types';

jest.mock('../PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(),
    generateReceiverSecret: jest.fn(),
    receiverPublicKey: jest.fn(),
    signinWithSecret: jest.fn(),
    restoreSession: jest.fn(),
    publishReceiverMarker: jest.fn(),
    getReceiverMarker: jest.fn(),
    initiateLink: jest.fn(),
    acceptLink: jest.fn(),
    advanceHandshake: jest.fn(),
    restoreLink: jest.fn(),
    sendPrivateMessageJson: jest.fn(),
    receivePrivateMessages: jest.fn(),
  },
}));

jest.mock('../../StorageService', () => ({
  StorageService: {
    upsertLinkReceiver: jest.fn(),
    getLinkReceiver: jest.fn(),
    upsertLink: jest.fn(),
    getLink: jest.fn(),
    getAllLinks: jest.fn(),
    updateLinkSnapshot: jest.fn(),
    deleteLink: jest.fn(),
    saveLinkMessage: jest.fn(),
    hasLinkMessage: jest.fn(),
    getLinkMessagesForConversation: jest.fn(),
    updateLinkMessageDeliveryState: jest.fn(),
    getLinkReadCursor: jest.fn(),
    setLinkReadCursor: jest.fn(),
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
    getLinkSession: jest.fn(),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
    getLinkReceiverSecret: jest.fn(),
    setLinkReceiverSecret: jest.fn(),
    deleteLinkReceiverSecret: jest.fn(),
  },
  LINK_RECEIVER_SECRET_SERVICE: 'hypercolor-link-receiver-secret',
}));

jest.mock('../../RetryQueue', () => ({
  RetryQueue: {
    enqueue: jest.fn(),
    getDue: jest.fn(),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
  },
}));

jest.mock('uuid', () => ({ v4: jest.fn() }));

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedStorage = jest.mocked(StorageService);
const mockedKeyStore = jest.mocked(KeyStore);
const mockedRetryQueue = jest.mocked(RetryQueue);
const mockedUuid = uuidv4 as jest.Mock;

const NOW = 1_700_000_000_000;
const OWNER = 'a'.repeat(52); // lexicographically smaller than PEER
const PEER = 'z'.repeat(52);
const SESSION = 'session-export-json';
const RECEIVER_SECRET = 'receiver-secret-hex';
const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const CONVERSATION_ID = `dm:${PEER}`;

const receiverRow: LinkReceiver = {
  ownerPubky: OWNER,
  secretRef: 'hypercolor-link-receiver-secret',
  app: 'hypercolor',
  runtime: 'mobile',
  markerPublished: true,
  updatedAt: NOW,
};

function storedLink(overrides: Partial<LinkRecord>): LinkRecord {
  return {
    peerPubky: PEER,
    role: 'initiator',
    status: 'handshaking',
    snapshot: 'hs-1',
    updatedAt: NOW,
    ...overrides,
  };
}

function wireMessage(eventId: string, body = 'hello'): string {
  return JSON.stringify({
    version: 1,
    kind: CHAT_MESSAGE_KIND,
    event_id: eventId,
    sent_at: NOW - 1000,
    body,
  });
}

/** Puts the link with PEER in the ready state: stored established snapshot, restorable handle. */
function givenEstablishedLink(): void {
  mockedStorage.getLink.mockResolvedValue(storedLink({ status: 'established', snapshot: 'est-1' }));
  mockedNative.restoreLink.mockResolvedValue('handle-1');
}

describe('LinkService', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    LinkService.clearSession();

    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signinWithSecret.mockResolvedValue(SESSION);
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedKeyStore.getLinkReceiverSecret.mockResolvedValue(RECEIVER_SECRET);
    mockedStorage.getLinkReceiver.mockResolvedValue(receiverRow);
    mockedStorage.getLink.mockResolvedValue(null);
    mockedStorage.hasLinkMessage.mockResolvedValue(false);
    mockedUuid.mockReturnValue(EVENT_ID);

    await LinkService.signin('signin-secret-hex');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('session', () => {
    it('persists the exported session on signin', () => {
      expect(mockedNative.signinWithSecret).toHaveBeenCalledWith('signin-secret-hex');
      expect(mockedKeyStore.setLinkSession).toHaveBeenCalledWith(SESSION);
      expect(LinkService.hasSession()).toBe(true);
    });

    it('restores and refreshes a persisted session', async () => {
      LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue('old-session');
      mockedNative.restoreSession.mockResolvedValue('refreshed-session');

      await expect(LinkService.restorePersistedSession()).resolves.toBe(true);

      expect(mockedNative.restoreSession).toHaveBeenCalledWith('old-session');
      expect(mockedKeyStore.setLinkSession).toHaveBeenCalledWith('refreshed-session');
    });

    it('clears a persisted session the homeserver rejects', async () => {
      LinkService.clearSession();
      mockedKeyStore.deleteLinkSession.mockClear();
      mockedKeyStore.getLinkSession.mockReturnValue('stale-session');
      mockedNative.restoreSession.mockRejectedValue(new Error('session expired'));

      await expect(LinkService.restorePersistedSession()).resolves.toBe(false);

      expect(mockedKeyStore.deleteLinkSession).toHaveBeenCalled();
      expect(LinkService.hasSession()).toBe(false);
    });
  });

  describe('enable', () => {
    it('generates the receiver secret once, persists it in the keychain, then publishes the marker', async () => {
      mockedKeyStore.getLinkReceiverSecret.mockResolvedValue(null);
      mockedNative.generateReceiverSecret.mockResolvedValue('fresh-secret');

      await LinkService.enable();

      expect(mockedKeyStore.setLinkReceiverSecret).toHaveBeenCalledWith('fresh-secret');
      expect(mockedNative.publishReceiverMarker).toHaveBeenCalledWith(
        SESSION,
        'fresh-secret',
        'hypercolor',
        'mobile',
      );
      // The secret must be safe in the keychain BEFORE the marker publish.
      const secretOrder = mockedKeyStore.setLinkReceiverSecret.mock.invocationCallOrder[0]!;
      const publishOrder = mockedNative.publishReceiverMarker.mock.invocationCallOrder[0]!;
      expect(secretOrder).toBeLessThan(publishOrder);
      // The receiver row references the keychain entry, never the secret.
      expect(mockedStorage.upsertLinkReceiver).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          ownerPubky: OWNER,
          secretRef: 'hypercolor-link-receiver-secret',
          markerPublished: false,
        }),
      );
      expect(mockedStorage.upsertLinkReceiver).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ markerPublished: true }),
      );
    });

    it('reuses an existing receiver secret instead of generating a new one', async () => {
      await LinkService.enable();

      expect(mockedNative.generateReceiverSecret).not.toHaveBeenCalled();
      expect(mockedKeyStore.setLinkReceiverSecret).not.toHaveBeenCalled();
      expect(mockedNative.publishReceiverMarker).toHaveBeenCalledWith(
        SESSION,
        RECEIVER_SECRET,
        'hypercolor',
        'mobile',
      );
    });
  });

  describe('ensureLinkWith — provisioning gates', () => {
    it('reports needs-enable when there is no session', async () => {
      LinkService.clearSession();
      mockedKeyStore.getLinkSession.mockReturnValue(null);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('needs-enable');
    });

    it('reports needs-enable when the receiver marker was never published', async () => {
      mockedStorage.getLinkReceiver.mockResolvedValue({ ...receiverRow, markerPublished: false });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('needs-enable');
    });

    it('reports not-enrolled when the peer has no receiver marker', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue(null);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('not-enrolled');

      expect(mockedNative.acceptLink).not.toHaveBeenCalled();
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('reports error when the native module is unavailable', async () => {
      mockedNative.isAvailable.mockReturnValue(false);

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('error');
    });
  });

  describe('ensureLinkWith — initiator path', () => {
    it('initiates a handshake, persists it, and reports handshaking-initiator', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue('marker-json');
      mockedNative.acceptLink.mockRejectedValue(new Error('no inbound handshake'));
      mockedNative.initiateLink.mockResolvedValue('hs-1');
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-2' });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-initiator');

      expect(mockedNative.initiateLink).toHaveBeenCalledWith(
        SESSION,
        RECEIVER_SECRET,
        PEER,
        'marker-json',
      );
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith({
        peerPubky: PEER,
        role: 'initiator',
        status: 'handshaking',
        snapshot: 'hs-1',
      });
      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(PEER, 'hs-2', 'handshaking');
    });

    it('completes a stored initiator handshake to ready and caches the handle', async () => {
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'est-1' });
      mockedNative.restoreLink.mockResolvedValue('handle-1');

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');

      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(PEER, 'est-1', 'established');
      expect(mockedNative.restoreLink).toHaveBeenCalledWith(SESSION, 'est-1');

      // The handle is cached: a second call is ready without touching the native layer again.
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');
      expect(mockedNative.restoreLink).toHaveBeenCalledTimes(1);
      expect(mockedNative.advanceHandshake).toHaveBeenCalledTimes(1);
    });

    it('stays handshaking-initiator when an advance step fails, keeping the persisted snapshot', async () => {
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.advanceHandshake.mockRejectedValue(new Error('homeserver unreachable'));

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-initiator');

      expect(mockedStorage.updateLinkSnapshot).not.toHaveBeenCalled();
      expect(mockedStorage.deleteLink).not.toHaveBeenCalled();
    });
  });

  describe('ensureLinkWith — responder path', () => {
    it('answers an inbound handshake and reports handshaking-responder', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue('marker-json');
      mockedNative.acceptLink.mockResolvedValue('resp-1');
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'resp-2' });

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-responder');

      expect(mockedNative.acceptLink).toHaveBeenCalledWith(SESSION, RECEIVER_SECRET, PEER);
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith({
        peerPubky: PEER,
        role: 'responder',
        status: 'handshaking',
        snapshot: 'resp-2',
      });
    });

    it('adopts an inbound handshake that is already established', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue('marker-json');
      mockedNative.acceptLink.mockResolvedValue('resp-est');
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'est-2' });
      mockedNative.restoreLink.mockResolvedValue('handle-2');

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');

      expect(mockedStorage.upsertLink).toHaveBeenCalledWith({
        peerPubky: PEER,
        role: 'responder',
        status: 'established',
        snapshot: 'est-2',
      });
      expect(mockedNative.restoreLink).toHaveBeenCalledWith(SESSION, 'est-2');
    });

    it('completes a stored responder handshake to ready', async () => {
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ role: 'responder', snapshot: 'resp-2' }),
      );
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'established', snapshot: 'est-9' });
      mockedNative.restoreLink.mockResolvedValue('handle-9');

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('ready');

      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(PEER, 'est-9', 'established');
    });
  });

  describe('ensureLinkWith — crossed-handshake tiebreak', () => {
    it('switches the lexicographically smaller pubky to responder when handshakes cross', async () => {
      // OWNER ('aaa…') < PEER ('zzz…'): our stalled initiator handshake must
      // probe for the crossed inbound one and adopt it.
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.advanceHandshake.mockImplementation(async (_session, snapshot) => {
        if (snapshot === 'hs-2') return { status: 'pending', snapshot: 'hs-3' };
        if (snapshot === 'crossed-1') return { status: 'pending', snapshot: 'crossed-2' };
        throw new Error(`unexpected snapshot ${snapshot}`);
      });
      mockedNative.acceptLink.mockResolvedValue('crossed-1');

      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('handshaking-responder');

      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(PEER, 'hs-3', 'handshaking');
      expect(mockedStorage.upsertLink).toHaveBeenCalledWith({
        peerPubky: PEER,
        role: 'responder',
        status: 'handshaking',
        snapshot: 'crossed-2',
      });
    });

    it('keeps the lexicographically larger pubky on its own initiator handshake', async () => {
      mockedKeyStore.getPubky.mockReturnValue('z'.repeat(52));
      const smallerPeer = 'a'.repeat(52);
      mockedStorage.getLink.mockResolvedValue(
        storedLink({ peerPubky: smallerPeer, snapshot: 'hs-2' }),
      );
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-3' });

      await expect(LinkService.ensureLinkWith(smallerPeer)).resolves.toBe('handshaking-initiator');

      expect(mockedNative.acceptLink).not.toHaveBeenCalled();
    });
  });

  describe('sendDm', () => {
    it('persists the message row, sends, marks it sent, then stores the snapshot', async () => {
      givenEstablishedLink();
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-2' });

      const message = await LinkService.sendDm(PEER, '  hello  ');

      const expectedJson = JSON.stringify({
        version: 1,
        kind: CHAT_MESSAGE_KIND,
        event_id: EVENT_ID,
        sent_at: NOW,
        body: 'hello',
      });
      expect(mockedStorage.saveLinkMessage).toHaveBeenCalledWith({
        eventId: EVENT_ID,
        conversationId: CONVERSATION_ID,
        peerPubky: PEER,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: expectedJson,
        body: 'hello',
        sentAt: NOW,
        receivedAt: null,
        deliveryState: 'sending',
      });
      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith('handle-1', expectedJson);
      expect(mockedStorage.updateLinkMessageDeliveryState).toHaveBeenCalledWith(EVENT_ID, 'sent');
      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(PEER, 'est-2', 'established');
      expect(message.deliveryState).toBe('sent');

      // Crash safety: the row exists before the send, the snapshot lands last.
      const saveOrder = mockedStorage.saveLinkMessage.mock.invocationCallOrder[0]!;
      const sendOrder = mockedNative.sendPrivateMessageJson.mock.invocationCallOrder[0]!;
      const snapshotOrder = mockedStorage.updateLinkSnapshot.mock.invocationCallOrder[0]!;
      expect(saveOrder).toBeLessThan(sendOrder);
      expect(sendOrder).toBeLessThan(snapshotOrder);
    });

    it('enqueues a retry when the native send fails and leaves the row in sending', async () => {
      givenEstablishedLink();
      mockedNative.sendPrivateMessageJson.mockRejectedValue(new Error('outbox write failed'));

      const message = await LinkService.sendDm(PEER, 'hello');

      expect(message.deliveryState).toBe('sending');
      expect(mockedStorage.updateLinkMessageDeliveryState).not.toHaveBeenCalled();
      expect(mockedStorage.updateLinkSnapshot).not.toHaveBeenCalled();
      expect(mockedRetryQueue.enqueue).toHaveBeenCalledTimes(1);
      const queued = mockedRetryQueue.enqueue.mock.calls[0]![0];
      expect(queued.messageId).toBe(EVENT_ID);
      expect(queued.recipientPubky).toBe(PEER);
      expect(JSON.parse(queued.payload)).toEqual({
        type: LINK_RETRY_PAYLOAD_TYPE,
        peerPubky: PEER,
        eventId: EVENT_ID,
        rawJson: expect.stringContaining(CHAT_MESSAGE_KIND),
      });
    });

    it('queues instead of sending while the link is still handshaking', async () => {
      mockedStorage.getLink.mockResolvedValue(storedLink({ snapshot: 'hs-2' }));
      mockedNative.advanceHandshake.mockResolvedValue({ status: 'pending', snapshot: 'hs-3' });
      mockedNative.acceptLink.mockRejectedValue(new Error('no inbound handshake'));

      const message = await LinkService.sendDm(PEER, 'hello');

      expect(message.deliveryState).toBe('sending');
      expect(mockedStorage.saveLinkMessage).toHaveBeenCalledTimes(1);
      expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
      expect(mockedRetryQueue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('throws without persisting anything when the peer is not enrolled', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue(null);

      await expect(LinkService.sendDm(PEER, 'hello')).rejects.toThrow("'not-enrolled'");

      expect(mockedStorage.saveLinkMessage).not.toHaveBeenCalled();
      expect(mockedRetryQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('syncInbox', () => {
    it('dedupes by event_id and persists messages before the snapshot', async () => {
      givenEstablishedLink();
      const EVT_NEW = '00000000-0000-4000-8000-00000000000a';
      const EVT_KNOWN = '00000000-0000-4000-8000-00000000000b';
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [
          { rawJson: wireMessage(EVT_NEW, 'first'), kind: CHAT_MESSAGE_KIND, eventId: EVT_NEW },
          // Replay of the same event inside one drain (expected after a snapshot restore).
          { rawJson: wireMessage(EVT_NEW, 'first'), kind: CHAT_MESSAGE_KIND, eventId: EVT_NEW },
          // Already persisted on a previous drain.
          { rawJson: wireMessage(EVT_KNOWN, 'old'), kind: CHAT_MESSAGE_KIND, eventId: EVT_KNOWN },
          // Unknown kind on the shared link — legal, skipped.
          {
            rawJson: JSON.stringify({ version: 1, kind: 'other.v0' }),
            kind: 'other.v0',
            eventId: null,
          },
        ],
        snapshot: 'est-2',
      });
      mockedStorage.hasLinkMessage.mockImplementation(async eventId => eventId === EVT_KNOWN);

      const received = await LinkService.syncInbox([PEER]);

      expect(received).toHaveLength(1);
      expect(received[0]!).toEqual(
        expect.objectContaining({
          eventId: EVT_NEW,
          conversationId: CONVERSATION_ID,
          direction: 'received',
          body: 'first',
          receivedAt: NOW,
          deliveryState: 'delivered',
        }),
      );
      expect(mockedStorage.saveLinkMessage).toHaveBeenCalledTimes(1);
      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(PEER, 'est-2', 'established');

      // Messages MUST be persisted before the snapshot: the snapshot's read
      // checkpoint has moved past them, so the reversed order loses them on a crash.
      const saveOrder = mockedStorage.saveLinkMessage.mock.invocationCallOrder[0]!;
      const snapshotOrder = mockedStorage.updateLinkSnapshot.mock.invocationCallOrder[0]!;
      expect(saveOrder).toBeLessThan(snapshotOrder);
    });

    it('does not persist a snapshot when the drain returned nothing', async () => {
      givenEstablishedLink();
      mockedNative.receivePrivateMessages.mockResolvedValue({ messages: [], snapshot: 'est-2' });

      await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

      expect(mockedStorage.updateLinkSnapshot).not.toHaveBeenCalled();
    });

    it('answers inbound handshakes but never initiates during inbox sync', async () => {
      mockedNative.getReceiverMarker.mockResolvedValue('marker-json');
      mockedNative.acceptLink.mockRejectedValue(new Error('no inbound handshake'));

      await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

      expect(mockedNative.acceptLink).toHaveBeenCalledTimes(1);
      expect(mockedNative.initiateLink).not.toHaveBeenCalled();
    });

    it('continues with the remaining peers when one peer fails', async () => {
      const otherPeer = 'y'.repeat(52);
      mockedStorage.getLink.mockImplementation(async peerPubky => {
        if (peerPubky === PEER) throw new Error('db corrupt for this row');
        return storedLink({ peerPubky: otherPeer, status: 'established', snapshot: 'est-1' });
      });
      mockedNative.restoreLink.mockResolvedValue('handle-other');
      mockedNative.receivePrivateMessages.mockResolvedValue({
        messages: [
          {
            rawJson: wireMessage(EVENT_ID, 'still works'),
            kind: CHAT_MESSAGE_KIND,
            eventId: EVENT_ID,
          },
        ],
        snapshot: 'est-2',
      });

      const received = await LinkService.syncInbox([PEER, otherPeer]);

      expect(received).toHaveLength(1);
      expect(received[0]!.peerPubky).toBe(otherPeer);
    });
  });

  describe('retryPendingSends', () => {
    const linkItem: DeliveryQueueItem = {
      id: 'q-link',
      messageId: EVENT_ID,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_RETRY_PAYLOAD_TYPE,
        peerPubky: PEER,
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

      await LinkService.retryPendingSends();

      expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledWith(
        'handle-1',
        wireMessage(EVENT_ID),
      );
      expect(mockedStorage.updateLinkMessageDeliveryState).toHaveBeenCalledWith(EVENT_ID, 'sent');
      expect(mockedStorage.updateLinkSnapshot).toHaveBeenCalledWith(PEER, 'est-3', 'established');
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledTimes(1);
      expect(mockedRetryQueue.recordSuccess).toHaveBeenCalledWith('q-link');
      expect(mockedRetryQueue.recordFailure).not.toHaveBeenCalled();
    });

    it('records a failure with the current attempt count when the retry send fails', async () => {
      givenEstablishedLink();
      mockedRetryQueue.getDue.mockResolvedValue([linkItem]);
      mockedNative.sendPrivateMessageJson.mockRejectedValue(new Error('still unreachable'));

      await LinkService.retryPendingSends();

      expect(mockedRetryQueue.recordFailure).toHaveBeenCalledWith('q-link', 2);
      expect(mockedRetryQueue.recordSuccess).not.toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it('updates the conversation read cursor with the given timestamp', async () => {
      await LinkService.markRead(CONVERSATION_ID, 123);

      expect(mockedStorage.setLinkReadCursor).toHaveBeenCalledWith(CONVERSATION_ID, 123);
    });

    it('defaults the cursor to now', async () => {
      await LinkService.markRead(CONVERSATION_ID);

      expect(mockedStorage.setLinkReadCursor).toHaveBeenCalledWith(CONVERSATION_ID, NOW);
    });
  });
});
