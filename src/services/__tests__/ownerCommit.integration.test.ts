/**
 * Owner-conditional persist: identity switch during `await getDb()` must not
 * commit declined promotion, send-intent rows, or group fan-out terminalization.
 */
jest.mock('../Telemetry', () => ({
  Telemetry: { record: jest.fn() },
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => '00000000-0000-4000-8000-0000000000aa') }));

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the SQL integration test');
  },
}));

jest.mock('../KeyStore', () => ({
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

jest.mock('../homeserverOrigin', () => ({
  resolveHomeserverOrigin: async () => 'https://homeserver.example',
  parsePubkyOwner: (url: string) => {
    const match = /^pubky:\/\/([^/]+)/.exec(url);
    return match?.[1] ?? null;
  },
}));

jest.mock('../link/PaykitLinkNative', () => ({
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

import { setDbForTests, setGetDbGateForTests } from '../../db';
import { runMigrations } from '../../db/migrations';
import { openMemoryDb } from '../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../StorageService';
import { KeyStore } from '../KeyStore';
import { FollowsImportSettings } from '../contacts/followsImportSettings';
import {
  LinkService,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  resetLinkServiceHarnessState,
  stopLinkRetryDrain,
} from '../link/LinkService';
import { PaykitLinkNative } from '../link/PaykitLinkNative';
import { CHAT_MESSAGE_KIND, LINK_RECEIVER_PATH, buildDmConversationId } from '../../types/link';
import { GROUP_MESSAGE_KIND } from '../../types/group';

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedKeyStore = jest.mocked(KeyStore);

const NOW = 1_700_000_000_000;
const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const OTHER = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const PEER_B = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';
const SESSION_ALIAS = 'session-alias-1';
const RECEIVER_ALIAS = 'receiver-alias-1';
const PEER_NOISE = 'peer-noise-pk';
const CHANNEL_ID = `${OWNER}:00000000-0000-4000-8000-00000000bbbb`;

function installGetDbStall(): {
  armNth: (n: number) => void;
  waiting: Promise<void>;
  release: () => void;
} {
  let remaining = 0;
  let armed = false;
  let resolveWaiting = (): void => undefined;
  const waiting = new Promise<void>(r => {
    resolveWaiting = r;
  });
  let resolveHold = (): void => undefined;
  const hold = new Promise<void>(r => {
    resolveHold = r;
  });
  setGetDbGateForTests(async () => {
    if (!armed) return;
    remaining -= 1;
    if (remaining > 0) return;
    resolveWaiting();
    await hold;
  });
  return {
    armNth(n: number) {
      remaining = n;
      armed = true;
    },
    waiting,
    release() {
      resolveHold();
    },
  };
}

function switchPaintedOwner(): void {
  mockedKeyStore.getPubky.mockReturnValue(OTHER);
}

describe('owner-conditional persist at commit time', () => {
  let db: ReturnType<typeof openMemoryDb> | null = null;

  beforeEach(async () => {
    FollowsImportSettings.resetForTests();
    resetLinkServiceHarnessState();
    setGetDbGateForTests(null);
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
    mockedNative.getReceiverMarker.mockResolvedValue({
      noisePublicKey: PEER_NOISE,
      capabilitiesJson: '{}',
    });
    mockedNative.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'est-out' });
    mockedNative.receivePrivateMessages.mockResolvedValue({ messages: [], snapshot: 'est-in' });
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedKeyStore.getLinkSession.mockReturnValue(SESSION_ALIAS);

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
    await LinkService.signinWithSecret('signin-secret-hex');
  });

  afterEach(() => {
    stopLinkRetryDrain();
    FollowsImportSettings.resetForTests();
    resetLinkServiceHarnessState();
    setGetDbGateForTests(null);
    db?.close();
    db = null;
    setDbForTests(null);
    jest.restoreAllMocks();
  });

  it('refuses declined promotion when identity switches during getDb', async () => {
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'declined',
    });
    const stall = installGetDbStall();
    stall.armNth(1);
    const pending = StorageService.acceptDeclinedMessageRequest(OWNER, PEER);
    await stall.waiting;
    switchPaintedOwner();
    stall.release();
    await expect(pending).rejects.toEqual(
      expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }),
    );
    expect((await StorageService.getMessageRequest(OWNER, PEER))?.status).toBe('declined');
    expect(await StorageService.getMessageRequest(OTHER, PEER)).toBeNull();
  });

  it('keeps a declined row when sendDm switches during the promotion getDb', async () => {
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'declined',
    });
    await FollowsImportSettings.hydrate(OWNER);
    const stall = installGetDbStall();
    stall.armNth(2);
    const pending = LinkService.sendDm(PEER, 'hello after decline');
    await stall.waiting;
    switchPaintedOwner();
    stall.release();
    await expect(pending).rejects.toEqual(
      expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }),
    );
    expect((await StorageService.getMessageRequest(OWNER, PEER))?.status).toBe('declined');
    expect(await StorageService.getMessageRequest(OTHER, PEER)).toBeNull();
    expect(
      await StorageService.hasLinkMessage(
        OWNER,
        OWNER,
        CHAT_MESSAGE_KIND,
        '00000000-0000-4000-8000-0000000000aa',
      ),
    ).toBe(false);
  });

  it('refuses persistLinkSendIntent when identity switches during getDb', async () => {
    const eventId = '00000000-0000-4000-8000-00000000aaaa';
    const stall = installGetDbStall();
    stall.armNth(1);
    const pending = StorageService.persistLinkSendIntent({
      message: {
        ownerPubky: OWNER,
        eventId,
        conversationId: buildDmConversationId(PEER),
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{}',
        body: 'hello',
        sentAt: NOW,
        receivedAt: null,
        deliveryState: 'sending',
      },
      queueItem: {
        id: 'q-intent-1',
        messageId: eventId,
        recipientPubky: PEER,
        payload: '{}',
        attempts: 0,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    });
    await stall.waiting;
    switchPaintedOwner();
    stall.release();
    await expect(pending).rejects.toEqual(
      expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }),
    );
    expect(await StorageService.hasLinkMessage(OWNER, OWNER, CHAT_MESSAGE_KIND, eventId)).toBe(
      false,
    );
    expect(await StorageService.hasLinkMessage(OTHER, OTHER, CHAT_MESSAGE_KIND, eventId)).toBe(
      false,
    );
    expect(await StorageService.hasQueueItem('q-intent-1')).toBe(false);
  });

  it('does not terminalize group fan-out when identity switches during finalize getDb', async () => {
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
    await StorageService.persistGroupSendIntent({
      message: {
        ownerPubky: OWNER,
        channelId: CHANNEL_ID,
        eventId,
        senderPubky: OWNER,
        kind: GROUP_MESSAGE_KIND,
        body: 'hi',
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
      },
      queueItems: [
        {
          id: 'q-group-1',
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
          nextRetryAt: NOW,
          createdAt: NOW,
        },
      ],
    });
    await FollowsImportSettings.hydrate(OWNER);
    const stall = installGetDbStall();
    mockedNative.sendPrivateMessageJson.mockImplementation(async () => {
      stall.armNth(1);
      return { snapshot: 'est-out' };
    });
    const pending = LinkService.sendPersistedLinkJson({
      peerPubky: PEER_B,
      queueId: 'q-group-1',
      kind: GROUP_MESSAGE_KIND,
      eventId,
      rawJson: '{}',
      channelId: CHANNEL_ID,
    });
    await stall.waiting;
    switchPaintedOwner();
    stall.release();
    await expect(pending).rejects.toEqual(
      expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }),
    );
    const outcomes = await StorageService.getGroupFanoutAggregate(
      OWNER,
      CHANNEL_ID,
      OWNER,
      eventId,
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe('pending');
    expect(await StorageService.hasQueueItem('q-group-1')).toBe(true);
    expect(await StorageService.getGroupFanoutAggregate(OTHER, CHANNEL_ID, OTHER, eventId)).toEqual(
      [],
    );
  });
});
