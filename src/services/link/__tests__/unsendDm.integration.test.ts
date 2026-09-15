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
  },
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
import { KeyStore } from '../../KeyStore';
import { StorageService } from '../../StorageService';
import { FollowsImportSettings } from '../../contacts/followsImportSettings';
import { wireSignOutMarkerMocks } from '../../__tests__/wireSignOutMarkerMocks';
import { LinkService, resetLinkServiceHarnessState, stopLinkRetryDrain } from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const EVENT_ID = '00000000-0000-4000-8000-0000000000aa';
const SESSION_ALIAS = 'session-alias-1';
const NOW = 1_700_000_000_000;

const mockedKeyStore = jest.mocked(KeyStore);
const mockedNative = jest.mocked(PaykitLinkNative);

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
    'tombstones and hides an own %s text message from the thread query',
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
        expect.objectContaining({ deleted: true, body: '' }),
      );
      expect(
        await StorageService.getLinkMessagesForConversation(OWNER, buildDmConversationId(PEER)),
      ).toEqual([]);
    },
  );
});
