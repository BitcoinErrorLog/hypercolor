jest.mock('../../Telemetry', () => ({
  Telemetry: { record: jest.fn() },
}));

jest.mock('uuid', () => {
  let seq = 0;
  return {
    v4: () => {
      seq += 1;
      return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
    },
  };
});

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the SQL integration test');
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    isInitialized: jest.fn(() => true),
    getPubky: jest.fn(),
    setPubky: jest.fn(),
    getLinkSession: jest.fn(() => null),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
    deleteLinkSessionIfAlias: jest.fn(() => true),
    readLinkSession: jest.fn(() => ({ ok: true, alias: null })),
    markSignOutIncomplete: jest.fn(),
    isSignOutIncomplete: jest.fn(() => false),
    getSignOutIncompleteOwner: jest.fn(() => null),
    clearSignOutIncomplete: jest.fn(),
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
    deleteAttachmentSecret: jest.fn().mockResolvedValue(true),
    attachmentKeyService: jest.fn(
      (owner: string, sender: string, eventId: string) =>
        `hypercolor-attachment-key:${owner}:${sender}:${eventId}`,
    ),
  },
}));

jest.mock('../../attachments/fileIo', () => ({
  cachePathsForAttachment: jest.fn(() => [
    'file:///cache/hypercolor-attachments/attachment.bin',
    'file:///cache/hypercolor-attachments/attachment.bin.thumb',
  ]),
  deleteCacheFiles: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../homeserverOrigin', () => ({
  resolveHomeserverOrigin: async () => 'https://homeserver.example',
  parsePubkyOwner: (url: string) => /^pubky:\/\/([^/]+)/.exec(url)?.[1] ?? null,
}));

jest.mock('../PaykitLinkNative', () => ({
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
    putPublic: jest.fn(),
    deletePublic: jest.fn(),
  },
  isLinkNativeError: (err: unknown) =>
    typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string',
  createLinkNativeError: (code: string, message: string) => ({ code, message }),
  toLinkNativeError: (err: unknown) => err,
}));

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { CHAT_MESSAGE_KIND, LINK_RECEIVER_PATH, buildDmConversationId } from '../../../types/link';
import {
  ATTACHMENT_ALGORITHM,
  CHAT_ATTACHMENT_KIND,
  buildAttachmentEnvelope,
} from '../../../types/attachment';
import { KeyStore } from '../../KeyStore';
import { StorageService } from '../../StorageService';
import { FollowsImportSettings } from '../../contacts/followsImportSettings';
import { wireSignOutMarkerMocks } from '../../__tests__/wireSignOutMarkerMocks';
import { LinkService, resetLinkServiceHarnessState, stopLinkRetryDrain } from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const EVENT_ID = '00000000-0000-4000-8000-0000000000aa';
const PREVIOUS_EVENT_ID = '00000000-0000-4000-8000-0000000000ab';
const LATEST_EVENT_ID = '00000000-0000-4000-8000-0000000000ac';
const RECEIVED_EVENT_ID = '00000000-0000-4000-8000-0000000000ad';
const SESSION_ALIAS = 'session-alias-1';
const NOW = 1_700_000_000_000;

const mockedKeyStore = jest.mocked(KeyStore);
const mockedNative = jest.mocked(PaykitLinkNative) as unknown as jest.Mocked<
  typeof PaykitLinkNative
> &
  Record<
    | 'initiateLink'
    | 'probeInboundLink'
    | 'advanceHandshake'
    | 'restoreHandshake'
    | 'restoreLink'
    | 'clearLinkOutbox',
    jest.Mock
  >;

async function seedEstablishedLink(): Promise<void> {
  await StorageService.upsertLinkReceiver({
    ownerPubky: OWNER,
    receiverAlias: 'receiver-alias-1',
    receiverPath: LINK_RECEIVER_PATH,
    markerPublished: true,
  });
  await StorageService.upsertLink({
    ownerPubky: OWNER,
    peerPubky: PEER,
    role: 'initiator',
    status: 'established',
    snapshot: 'est-1',
    remoteNoisePublicKey: 'peer-noise-pk',
    localReceiverPath: LINK_RECEIVER_PATH,
    remoteReceiverPath: LINK_RECEIVER_PATH,
    consecutiveFailures: 0,
  });
}

async function seedAttachmentMessage(): Promise<void> {
  const conversationId = buildDmConversationId(PEER);
  const location = `pubky://${OWNER}/pub/hypercolor.app/v1/attachments/${EVENT_ID}`;
  const attachment = buildAttachmentEnvelope({
    eventId: EVENT_ID,
    sentAt: NOW,
    location,
    key: 'a'.repeat(43),
    nonce: 'b'.repeat(32),
    algorithm: ATTACHMENT_ALGORITHM,
    contentType: 'image/jpeg',
    size: 12,
  });
  await StorageService.saveLinkMessage({
    ownerPubky: OWNER,
    eventId: EVENT_ID,
    conversationId,
    peerPubky: PEER,
    senderPubky: OWNER,
    direction: 'sent',
    kind: CHAT_ATTACHMENT_KIND,
    rawJson: attachment.json,
    body: '[attachment]',
    sentAt: NOW,
    receivedAt: null,
    deliveryState: 'sent',
  });
  await StorageService.saveAttachment({
    ownerPubky: OWNER,
    eventId: EVENT_ID,
    conversationId,
    channelId: null,
    senderPubky: OWNER,
    direction: 'sent',
    location,
    keyRef: `att:${OWNER}:${OWNER}:${EVENT_ID}`,
    contentType: 'image/jpeg',
    size: 12,
    thumbnailLocation: null,
    localCachePath: `file:///cache/hypercolor-attachments/${OWNER}/${OWNER}/${EVENT_ID}`,
    createdAt: NOW,
    updatedAt: NOW,
    deliveryState: 'sent',
    resolveState: 'ready',
  });
}

describe('unsendDm with real SQLite storage', () => {
  let db: ReturnType<typeof openMemoryDb> | null = null;

  beforeEach(async () => {
    FollowsImportSettings.resetForTests();
    resetLinkServiceHarnessState();
    db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signinWithSecret.mockResolvedValue({ sessionAlias: SESSION_ALIAS, pubky: OWNER });
    mockedNative.signOutSession.mockResolvedValue(undefined);
    mockedNative.clearAllNativeSecrets.mockResolvedValue(undefined);
    mockedNative.closeLink.mockResolvedValue(undefined);
    mockedNative.clearLinkOutbox.mockResolvedValue(0);
    mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-1' });
    mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-2' });
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);
    wireSignOutMarkerMocks(mockedKeyStore);

    await seedEstablishedLink();
    await LinkService.signinWithSecret('signin-secret-hex');
  });

  afterEach(() => {
    stopLinkRetryDrain();
    FollowsImportSettings.resetForTests();
    resetLinkServiceHarnessState();
    db?.close();
    db = null;
    setDbForTests(null);
    jest.restoreAllMocks();
  });

  it.each(['sent', 'sending'] as const)(
    'tombstones an own %s text message and keeps the redacted row in the thread query',
    async deliveryState => {
      await StorageService.saveLinkMessage({
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        conversationId: buildDmConversationId(PEER),
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: JSON.stringify({
          kind: CHAT_MESSAGE_KIND,
          event_id: EVENT_ID,
          body: 'receipt_mobile_final',
        }),
        body: 'receipt_mobile_final',
        sentAt: NOW,
        receivedAt: null,
        deliveryState,
      });

      await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();

      expect(await StorageService.getLinkMessageByEventId(OWNER, OWNER, EVENT_ID)).toEqual(
        expect.objectContaining({ deleted: true, body: '', deliveryState: 'unsent' }),
      );
      expect(
        await StorageService.getLinkMessagesForConversation(OWNER, buildDmConversationId(PEER)),
      ).toEqual([
        expect.objectContaining({
          eventId: EVENT_ID,
          deleted: true,
          body: '',
          deliveryState: 'unsent',
        }),
      ]);
    },
  );

  it('commits the tombstone and attachment terminal state before cleanup', async () => {
    await seedAttachmentMessage();
    mockedKeyStore.deleteAttachmentSecret.mockResolvedValue(true);

    await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();
    expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledTimes(1);
    expect(await StorageService.listDeliveryQueue()).toEqual([]);

    expect(await StorageService.getLinkMessageByEventId(OWNER, OWNER, EVENT_ID)).toEqual(
      expect.objectContaining({ deleted: true, body: '', deliveryState: 'unsent' }),
    );
    expect(await StorageService.getAttachment(OWNER, OWNER, EVENT_ID)).toEqual(
      expect.objectContaining({ resolveState: 'unavailable-from-backup', localCachePath: null }),
    );
    expect(mockedKeyStore.deleteAttachmentSecret).toHaveBeenCalledWith(OWNER, OWNER, EVENT_ID, {
      peerPubky: PEER,
      conversationId: `dm:${PEER}`,
    });
  });

  it('sweeps a key left after the tombstone commits and cleanup fails', async () => {
    await seedAttachmentMessage();
    mockedKeyStore.deleteAttachmentSecret.mockResolvedValue(false);

    await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();
    expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledTimes(1);
    expect(await StorageService.listDeliveryQueue()).toEqual([]);
    expect(
      db?.executeSync(
        `SELECT target_kind, target FROM pending_cleanup
         WHERE owner_pubky = ? AND target_kind = 'keystore'`,
        [OWNER],
      ).rows,
    ).toEqual([
      {
        target_kind: 'keystore',
        target: `hypercolor-attachment-key:${OWNER}:${OWNER}:${EVENT_ID}`,
      },
    ]);

    mockedKeyStore.deleteAttachmentSecretByService.mockResolvedValue(true);
    await StorageService.retryPendingCleanup();
    expect(
      db?.executeSync(
        `SELECT target_kind, target FROM pending_cleanup
         WHERE owner_pubky = ? AND target_kind = 'keystore'`,
        [OWNER],
      ).rows,
    ).toEqual([]);
  });

  it('does not enqueue a delete when the tombstone loses a race', async () => {
    await seedAttachmentMessage();
    jest.spyOn(StorageService, 'tombstoneLinkMessage').mockResolvedValue(false);

    await expect(LinkService.unsendDm(PEER, EVENT_ID)).rejects.toThrow(
      'Message is no longer available to unsend',
    );
    expect(await StorageService.listDeliveryQueue()).toEqual([]);
    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
  });

  it('drains the atomic delete intent after dispatch crashes', async () => {
    await seedAttachmentMessage();
    mockedKeyStore.deleteAttachmentSecret.mockResolvedValue(true);
    mockedNative.sendPrivateMessageJson.mockRejectedValueOnce(new Error('send crashed'));

    await expect(LinkService.unsendDm(PEER, EVENT_ID)).resolves.toBeUndefined();
    expect(await StorageService.listDeliveryQueue()).toHaveLength(1);

    mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-3' });
    // holdControlPam defers with the 15s attempt-0 backoff; the frozen NOW
    // clock must advance or getDue will not return the durable intent.
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 15_000);
    await LinkService.drainRetries();

    expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalledTimes(2);
    expect(await StorageService.listDeliveryQueue()).toEqual([]);
  });

  it('does not recover a stale queued tombstone', async () => {
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: buildDmConversationId(PEER),
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: 'sent',
      kind: CHAT_MESSAGE_KIND,
      rawJson: JSON.stringify({ kind: CHAT_MESSAGE_KIND, event_id: EVENT_ID, body: 'unsent' }),
      body: 'unsent',
      sentAt: NOW,
      receivedAt: null,
      deliveryState: 'sending',
    });
    await StorageService.tombstoneLinkMessage({
      ownerPubky: OWNER,
      peerPubky: PEER,
      senderPubky: OWNER,
      eventId: EVENT_ID,
      redactedRawJson: JSON.stringify({
        kind: CHAT_MESSAGE_KIND,
        event_id: EVENT_ID,
        deleted: true,
      }),
    });
    await StorageService.enqueue({
      id: 'stale-tombstone-queue',
      messageId: EVENT_ID,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: 'link.chat.message',
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
    });
    mockedNative.sendPrivateMessageJson.mockClear();

    await LinkService.recoverPendingSends();

    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    expect(await StorageService.listDeliveryQueue()).toHaveLength(1);
  });

  it('still dispatches the queued delete when journaling cleanup fails', async () => {
    await seedAttachmentMessage();
    mockedKeyStore.deleteAttachmentSecret.mockResolvedValue(false);
    jest
      .spyOn(StorageService, 'journalAttachmentKeyCleanup')
      .mockRejectedValueOnce(new Error('journal unavailable'));

    await expect(LinkService.unsendDm(PEER, EVENT_ID)).rejects.toThrow('journal unavailable');
    expect(mockedNative.sendPrivateMessageJson).toHaveBeenCalled();
  });

  it('keeps the previous live preview and excludes tombstoned received unread messages', async () => {
    const conversationId = buildDmConversationId(PEER);
    const save = async (
      eventId: string,
      body: string,
      direction: 'sent' | 'received',
      sentAt: number,
    ) =>
      StorageService.saveLinkMessage({
        ownerPubky: OWNER,
        eventId,
        conversationId,
        peerPubky: PEER,
        senderPubky: direction === 'sent' ? OWNER : PEER,
        direction,
        kind: CHAT_MESSAGE_KIND,
        rawJson: JSON.stringify({ kind: CHAT_MESSAGE_KIND, event_id: eventId, body }),
        body,
        sentAt,
        receivedAt: direction === 'received' ? sentAt : null,
        deliveryState: direction === 'received' ? 'sent' : 'sending',
      });

    await save(PREVIOUS_EVENT_ID, 'previous live', 'sent', NOW);
    await save(LATEST_EVENT_ID, 'latest then unsent', 'sent', NOW + 1);
    await save(RECEIVED_EVENT_ID, 'received unread', 'received', NOW + 2);
    await StorageService.tombstoneLinkMessage({
      ownerPubky: OWNER,
      peerPubky: PEER,
      senderPubky: OWNER,
      eventId: LATEST_EVENT_ID,
      redactedRawJson: JSON.stringify({
        kind: CHAT_MESSAGE_KIND,
        event_id: LATEST_EVENT_ID,
        deleted: true,
      }),
    });
    expect(await StorageService.getLinkMessageByEventId(OWNER, OWNER, LATEST_EVENT_ID)).toEqual(
      expect.objectContaining({ deleted: true, deliveryState: 'unsent' }),
    );
    await StorageService.tombstoneLinkMessage({
      ownerPubky: OWNER,
      peerPubky: PEER,
      senderPubky: PEER,
      eventId: RECEIVED_EVENT_ID,
      redactedRawJson: JSON.stringify({
        kind: CHAT_MESSAGE_KIND,
        event_id: RECEIVED_EVENT_ID,
        deleted: true,
      }),
    });
    expect(await StorageService.getLinkMessageByEventId(OWNER, PEER, RECEIVED_EVENT_ID)).toEqual(
      expect.objectContaining({ deleted: true, deliveryState: 'sent' }),
    );

    await expect(StorageService.listLinkConversations(OWNER)).resolves.toEqual([
      expect.objectContaining({
        lastMessage: 'previous live',
        unreadCount: 0,
      }),
    ]);
    await expect(StorageService.searchDecryptedMessages(OWNER, 'received')).resolves.toEqual([]);
  });

  it('round-trips the application reconnect error category', async () => {
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: 'initiator',
      status: 'established',
      snapshot: 'est-application',
      remoteNoisePublicKey: 'peer-noise-pk',
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      reconnectErrorCategory: 'application',
    });

    await expect(StorageService.getLink(OWNER, PEER)).resolves.toEqual(
      expect.objectContaining({ reconnectErrorCategory: 'application' }),
    );
  });
});
