/**
 * Real LinkService + real SQLite: decline is not a link deny.
 * Native Paykit I/O is mocked; StorageService and RetryQueue are not.
 */
jest.mock('../../Telemetry', () => ({
  Telemetry: { record: jest.fn() },
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => '00000000-0000-4000-8000-0000000000aa') }));

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the SQL integration test');
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
    setPubky: jest.fn(),
    getLinkSession: jest.fn(),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../homeserverOrigin', () => ({
  resolveHomeserverOrigin: async () => 'https://homeserver.example',
  parsePubkyOwner: (url: string) => {
    const match = /^pubky:\/\/([^/]+)/.exec(url);
    return match?.[1] ?? null;
  },
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

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { FollowsImportSettings } from '../../contacts/followsImportSettings';
import {
  LinkService,
  LINK_RETRY_PAYLOAD_TYPE,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  resetLinkServiceHarnessState,
  stopLinkRetryDrain,
} from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import { CHAT_MESSAGE_KIND, LINK_RECEIVER_PATH, buildDmConversationId } from '../../../types/link';
import { GROUP_MESSAGE_KIND } from '../../../types/group';
import { CONTACTS_COPY } from '../../../ui/contacts/contactsCopy';
import { formatGroupFanoutAggregate } from '../../../ui/groupFanoutStatus';

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedKeyStore = jest.mocked(KeyStore);

const NOW = 1_700_000_000_000;
const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const SESSION_ALIAS = 'session-alias-1';
const RECEIVER_ALIAS = 'receiver-alias-1';
const PEER_NOISE = 'peer-noise-pk';
const CHANNEL_ID = `${OWNER}:00000000-0000-4000-8000-00000000bbbb`;

async function seedMessaging(): Promise<void> {
  await StorageService.upsertLinkReceiver({
    ownerPubky: OWNER,
    receiverAlias: RECEIVER_ALIAS,
    receiverPath: LINK_RECEIVER_PATH,
    markerPublished: true,
  });
  await StorageService.upsertLink({
    ownerPubky: OWNER,
    peerPubky: PEER,
    role: 'initiator',
    status: 'established',
    snapshot: 'est-1',
    remoteNoisePublicKey: PEER_NOISE,
    localReceiverPath: LINK_RECEIVER_PATH,
    remoteReceiverPath: LINK_RECEIVER_PATH,
    consecutiveFailures: 0,
  });
}

describe('declined peer outbound (real LinkService + storage)', () => {
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
    mockedNative.probeInboundLink.mockResolvedValue({
      result: 'established',
      linkId: 'inbound-1',
      snapshot: 'est-in',
    });
    mockedNative.getReceiverMarker.mockResolvedValue({
      noisePublicKey: PEER_NOISE,
      capabilitiesJson: '{}',
    });
    mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-out' });
    mockedNative.receivePrivateMessages.mockResolvedValue({ messages: [], snapshot: 'est-in' });
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);

    await seedMessaging();
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

  it('lets the user establish a link with a declined (not blocked) peer', async () => {
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'declined',
    });

    const status = await LinkService.ensureLinkWith(PEER);
    expect(status).toBe('ready');
    expect(mockedNative.restoreLink).toHaveBeenCalled();
    const request = await StorageService.getMessageRequest(OWNER, PEER);
    expect(request?.status).toBe('declined');
  });

  it('sends outbound to a declined peer and accepts the request before linking', async () => {
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'declined',
    });

    const sent = await LinkService.sendDm(PEER, 'hello after decline');
    expect(sent.deliveryState).toBe('sent');
    const request = await StorageService.getMessageRequest(OWNER, PEER);
    expect(request?.status).toBe('accepted');
    const stored = await StorageService.getLinkMessage(
      OWNER,
      OWNER,
      CHAT_MESSAGE_KIND,
      sent.eventId,
    );
    expect(stored?.body).toBe('hello after decline');
    expect(stored?.deliveryState).toBe('sent');
    const link = await StorageService.getLink(OWNER, PEER);
    expect(link?.status).toBe('established');
  });

  it('keeps the link and outbox after send then syncInbox', async () => {
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'declined',
    });
    mockedNative.clearLinkOutbox.mockClear();

    const sent = await LinkService.sendDm(PEER, 'keep me');
    const received = await LinkService.syncInbox([PEER]);

    expect(received.filter(row => row.direction === 'received')).toEqual([]);
    expect(mockedNative.clearLinkOutbox).not.toHaveBeenCalled();
    const link = await StorageService.getLink(OWNER, PEER);
    expect(link?.status).toBe('established');
    const stored = await StorageService.getLinkMessage(
      OWNER,
      OWNER,
      CHAT_MESSAGE_KIND,
      sent.eventId,
    );
    expect(stored?.deliveryState).toBe('sent');
    const request = await StorageService.getMessageRequest(OWNER, PEER);
    expect(request?.status).toBe('accepted');
  });

  it('does not adopt declined inbound before any user send', async () => {
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'declined',
    });
    mockedNative.probeInboundLink.mockClear();
    mockedNative.restoreLink.mockClear();

    const received = await LinkService.syncInbox([PEER]);
    expect(received).toEqual([]);
    expect(mockedNative.probeInboundLink).not.toHaveBeenCalled();
    const request = await StorageService.getMessageRequest(OWNER, PEER);
    expect(request?.status).toBe('declined');
    const conversation = await StorageService.getLinkMessagesForConversation(
      OWNER,
      buildDmConversationId(PEER),
      50,
    );
    expect(conversation.filter(row => row.direction === 'received')).toEqual([]);
    expect(mockedNative.clearLinkOutbox).not.toHaveBeenCalled();
    expect(await StorageService.getLink(OWNER, PEER)).not.toBeNull();
  });

  it('denies ensureLinkWith and sendDm for a blocked peer', async () => {
    await FollowsImportSettings.block(OWNER, PEER);
    mockedNative.restoreLink.mockClear();

    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe('error');
    expect(mockedNative.restoreLink).not.toHaveBeenCalled();

    await expect(LinkService.sendDm(PEER, 'nope')).rejects.toMatchObject({
      name: 'LinkSendError',
      code: 'denied',
      message: CONTACTS_COPY.deniedSendMessage,
    });
    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
  });

  it('marks a queued payload to a blocked peer failed and does not retry', async () => {
    const eventId = '00000000-0000-4000-8000-00000000cccc';
    await StorageService.persistLinkSendIntent({
      message: {
        ownerPubky: OWNER,
        eventId,
        conversationId: buildDmConversationId(PEER),
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: JSON.stringify({
          version: 1,
          kind: CHAT_MESSAGE_KIND,
          event_id: eventId,
          sent_at: NOW,
          body: 'queued',
        }),
        body: 'queued',
        sentAt: NOW,
        receivedAt: null,
        deliveryState: 'sending',
      },
      queueItem: {
        id: 'q-real-blocked',
        messageId: eventId,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type: LINK_RETRY_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: CHAT_MESSAGE_KIND,
          eventId,
          rawJson: '{}',
        }),
        attempts: 0,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    });
    await FollowsImportSettings.block(OWNER, PEER);
    mockedNative.sendPrivateMessageJson.mockClear();

    await LinkService.drainRetries();

    const row = await StorageService.getLinkMessage(OWNER, OWNER, CHAT_MESSAGE_KIND, eventId);
    expect(row?.deliveryState).toBe('failed');
    expect(await StorageService.listDeliveryQueue()).toEqual([]);
    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
  });

  it('finalizes group fan-out when the blocked recipient is the last queue item', async () => {
    const eventId = '00000000-0000-4000-8000-00000000dddd';
    await StorageService.saveGroupMessage({
      ownerPubky: OWNER,
      channelId: CHANNEL_ID,
      eventId,
      senderPubky: OWNER,
      kind: GROUP_MESSAGE_KIND,
      body: 'group hello',
      rawJson: '{}',
      sentAt: NOW,
      receivedAt: null,
      deliveryState: 'sending',
      replyToEventId: null,
      replyToAuthorPubky: null,
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    });
    await StorageService.upsertGroupFanoutOutcome({
      ownerPubky: OWNER,
      channelId: CHANNEL_ID,
      eventId,
      senderPubky: OWNER,
      recipientPubky: PEER,
      status: 'pending',
      reason: null,
      updatedAt: NOW,
    });
    await StorageService.enqueue({
      id: 'q-group-real',
      messageId: eventId,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: GROUP_MESSAGE_KIND,
        eventId,
        channelId: CHANNEL_ID,
        rawJson: '{}',
      }),
      attempts: 0,
      nextRetryAt: NOW,
      createdAt: NOW,
    });
    await FollowsImportSettings.block(OWNER, PEER);
    mockedNative.sendPrivateMessageJson.mockClear();

    await LinkService.drainRetries();

    const group = await StorageService.getGroupMessage(OWNER, CHANNEL_ID, OWNER, eventId);
    expect(group?.deliveryState).toBe('failed');
    expect(await StorageService.listDeliveryQueue()).toEqual([]);
    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
  });

  it('accepts a declined request from Requests without messaging', async () => {
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'declined',
    });
    mockedNative.receivePrivateMessages.mockResolvedValue({ messages: [], snapshot: 'est-in' });

    const routed = await LinkService.acceptDeclinedRequest(PEER);
    expect(routed.filter(row => row.direction === 'received')).toEqual([]);
    const request = await StorageService.getMessageRequest(OWNER, PEER);
    expect(request?.status).toBe('accepted');
    const after = await LinkService.syncInbox([PEER]);
    expect(mockedNative.receivePrivateMessages).toHaveBeenCalled();
    expect(after).toEqual([]);
  });

  it('derives the same mixed fan-out aggregate in both drain orders', async () => {
    const PEER_B = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';
    const PEER_C = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
    const eventId = '00000000-0000-4000-8000-00000000eeee';

    async function seedPeer(peer: string): Promise<void> {
      await StorageService.upsertLink({
        ownerPubky: OWNER,
        peerPubky: peer,
        role: 'initiator',
        status: 'established',
        snapshot: `est-${peer.slice(0, 4)}`,
        remoteNoisePublicKey: `noise-${peer.slice(0, 4)}`,
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
      });
    }

    async function runDrain(order: [string, string, string]): Promise<string> {
      FollowsImportSettings.resetForTests();
      resetLinkServiceHarnessState();
      const db = openMemoryDb();
      setDbForTests(db);
      await runMigrations(db);
      mockedNative.isAvailable.mockReturnValue(true);
      mockedNative.signinWithSecret.mockResolvedValue({
        sessionAlias: SESSION_ALIAS,
        pubky: OWNER,
      });
      mockedNative.restoreLink.mockResolvedValue({ linkId: 'handle-mix' });
      mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-out' });
      mockedKeyStore.getPubky.mockReturnValue(OWNER);
      mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);
      await seedMessaging();
      await seedPeer(PEER_B);
      await seedPeer(PEER_C);
      await LinkService.signinWithSecret('signin-secret-hex');
      await FollowsImportSettings.block(OWNER, PEER);

      await StorageService.saveGroupMessage({
        ownerPubky: OWNER,
        channelId: CHANNEL_ID,
        eventId,
        senderPubky: OWNER,
        kind: GROUP_MESSAGE_KIND,
        body: 'group hello',
        rawJson: '{}',
        sentAt: NOW,
        receivedAt: null,
        deliveryState: 'sending',
        replyToEventId: null,
        replyToAuthorPubky: null,
        targetEventId: null,
        targetAuthorPubky: null,
        editedAt: null,
        deleted: false,
      });
      for (let i = 0; i < order.length; i += 1) {
        const peer = order[i]!;
        await StorageService.upsertGroupFanoutOutcome({
          ownerPubky: OWNER,
          channelId: CHANNEL_ID,
          eventId,
          senderPubky: OWNER,
          recipientPubky: peer,
          status: 'pending',
          reason: null,
          updatedAt: NOW,
        });
        await StorageService.enqueue({
          id: `q-mix-${i}`,
          messageId: eventId,
          recipientPubky: peer,
          payload: JSON.stringify({
            type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
            ownerPubky: OWNER,
            peerPubky: peer,
            senderPubky: OWNER,
            kind: GROUP_MESSAGE_KIND,
            eventId,
            channelId: CHANNEL_ID,
            rawJson: '{}',
          }),
          attempts: 0,
          nextRetryAt: NOW - order.length + i,
          createdAt: NOW,
        });
      }
      await LinkService.drainRetries();
      const outcomes = await StorageService.listGroupFanoutOutcomes(
        OWNER,
        CHANNEL_ID,
        OWNER,
        eventId,
      );
      const label = formatGroupFanoutAggregate(outcomes);
      db.close();
      setDbForTests(null);
      return label;
    }

    const blockedFirst = await runDrain([PEER, PEER_B, PEER_C]);
    const blockedLast = await runDrain([PEER_B, PEER_C, PEER]);
    expect(blockedFirst).toBe(blockedLast);
    expect(blockedFirst).toBe('Sent to 2 of 3');
  });

  it('labels immediate success plus a queued blocked recipient as Sent to 1 of 2', async () => {
    const PEER_B = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';
    const eventId = '00000000-0000-4000-8000-00000000ffff';
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER_B,
      role: 'initiator',
      status: 'established',
      snapshot: 'est-b',
      remoteNoisePublicKey: 'noise-b',
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
    });
    await FollowsImportSettings.block(OWNER, PEER);
    const ts = NOW;
    await StorageService.persistGroupSendIntent({
      message: {
        ownerPubky: OWNER,
        channelId: CHANNEL_ID,
        eventId,
        senderPubky: OWNER,
        kind: GROUP_MESSAGE_KIND,
        body: 'hi',
        rawJson: '{}',
        sentAt: ts,
        receivedAt: null,
        deliveryState: 'sending',
        replyToEventId: null,
        replyToAuthorPubky: null,
        targetEventId: null,
        targetAuthorPubky: null,
        editedAt: null,
        deleted: false,
      },
      queueItems: [
        {
          id: 'q-imm-b',
          messageId: eventId,
          recipientPubky: PEER_B,
          payload: JSON.stringify({
            type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
            ownerPubky: OWNER,
            peerPubky: PEER_B,
            senderPubky: OWNER,
            kind: GROUP_MESSAGE_KIND,
            eventId,
            channelId: CHANNEL_ID,
            rawJson: '{}',
          }),
          attempts: 0,
          nextRetryAt: ts,
          createdAt: ts,
        },
        {
          id: 'q-imm-blocked',
          messageId: eventId,
          recipientPubky: PEER,
          payload: JSON.stringify({
            type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
            ownerPubky: OWNER,
            peerPubky: PEER,
            senderPubky: OWNER,
            kind: GROUP_MESSAGE_KIND,
            eventId,
            channelId: CHANNEL_ID,
            rawJson: '{}',
          }),
          attempts: 0,
          nextRetryAt: ts,
          createdAt: ts,
        },
      ],
    });
    mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-out' });
    await expect(
      LinkService.sendPersistedLinkJson({
        ownerPubky: OWNER,
        senderPubky: OWNER,
        peerPubky: PEER_B,
        queueId: 'q-imm-b',
        kind: GROUP_MESSAGE_KIND,
        eventId,
        rawJson: '{}',
        channelId: CHANNEL_ID,
      }),
    ).resolves.toBe('sent');
    await LinkService.drainRetries();
    const outcomes = await StorageService.getGroupFanoutAggregate(
      OWNER,
      CHANNEL_ID,
      OWNER,
      eventId,
    );
    expect(formatGroupFanoutAggregate(outcomes)).toBe('Sent to 1 of 2');
  });

  it('labels immediate-success-only fan-out as Sent', async () => {
    const PEER_B = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';
    const eventId = '00000000-0000-4000-8000-00000000aaaa';
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER_B,
      role: 'initiator',
      status: 'established',
      snapshot: 'est-b',
      remoteNoisePublicKey: 'noise-b',
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
    });
    const ts = NOW;
    await StorageService.persistGroupSendIntent({
      message: {
        ownerPubky: OWNER,
        channelId: CHANNEL_ID,
        eventId,
        senderPubky: OWNER,
        kind: GROUP_MESSAGE_KIND,
        body: 'hi',
        rawJson: '{}',
        sentAt: ts,
        receivedAt: null,
        deliveryState: 'sending',
        replyToEventId: null,
        replyToAuthorPubky: null,
        targetEventId: null,
        targetAuthorPubky: null,
        editedAt: null,
        deleted: false,
      },
      queueItems: [PEER, PEER_B].map((peer, i) => ({
        id: `q-all-${i}`,
        messageId: eventId,
        recipientPubky: peer,
        payload: JSON.stringify({
          type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: peer,
          senderPubky: OWNER,
          kind: GROUP_MESSAGE_KIND,
          eventId,
          channelId: CHANNEL_ID,
          rawJson: '{}',
        }),
        attempts: 0,
        nextRetryAt: ts,
        createdAt: ts,
      })),
    });
    mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-out' });
    await expect(
      LinkService.sendPersistedLinkJson({
        ownerPubky: OWNER,
        senderPubky: OWNER,
        peerPubky: PEER,
        queueId: 'q-all-0',
        kind: GROUP_MESSAGE_KIND,
        eventId,
        rawJson: '{}',
        channelId: CHANNEL_ID,
      }),
    ).resolves.toBe('sent');
    await expect(
      LinkService.sendPersistedLinkJson({
        ownerPubky: OWNER,
        senderPubky: OWNER,
        peerPubky: PEER_B,
        queueId: 'q-all-1',
        kind: GROUP_MESSAGE_KIND,
        eventId,
        rawJson: '{}',
        channelId: CHANNEL_ID,
      }),
    ).resolves.toBe('sent');
    const outcomes = await StorageService.getGroupFanoutAggregate(
      OWNER,
      CHANNEL_ID,
      OWNER,
      eventId,
    );
    expect(formatGroupFanoutAggregate(outcomes)).toBe('Sent');
  });
});
