/**
 * Real StorageService + LinkService: v1 receipt emit must not deadlock
 * `withQueue` when sync/accept already holds the peer lock.
 */
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
import { LinkService, resetLinkServiceHarnessState, stopLinkRetryDrain } from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import {
  CHAT_MESSAGE_KIND,
  CHAT_RECEIPT_KIND,
  LINK_RECEIVER_PATH,
  buildChatMessageEnvelope,
} from '../../../types/link';
import { wireSignOutMarkerMocks } from '../../__tests__/wireSignOutMarkerMocks';

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedKeyStore = jest.mocked(KeyStore);

const NOW = 1_700_000_000_000;
const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const SESSION_ALIAS = 'session-alias-1';
const RECEIVER_ALIAS = 'receiver-alias-1';
const PEER_NOISE = 'peer-noise-pk';
const INBOUND_EVENT = '00000000-0000-4000-8000-00000000aaaa';

async function seedEstablishedV1(): Promise<void> {
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
  await StorageService.recordPeerChatKindsV(OWNER, PEER, 1);
}

describe('v1 receipt emit queue re-entrancy (real sqlite)', () => {
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
    wireSignOutMarkerMocks(mockedKeyStore);

    await seedEstablishedV1();
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

  it('syncs a v1 peer with inbound mail without the 8s raceWithin timeout and queues a receipt', async () => {
    const inbound = buildChatMessageEnvelope({
      eventId: INBOUND_EVENT,
      sentAt: NOW,
      body: 'hello v1',
    });
    mockedNative.receivePrivateMessages.mockResolvedValue({
      messages: [{ version: 1, kind: CHAT_MESSAGE_KIND, rawJson: inbound.json }],
      snapshot: 'est-2',
    });
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'accepted',
    });

    const started = Date.now();
    const received = await LinkService.syncInbox([PEER]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(received.some(row => row.eventId === INBOUND_EVENT)).toBe(true);
    expect(
      mockedNative.sendPrivateMessageJson.mock.calls.some(call =>
        String(call[1] ?? '').includes(CHAT_RECEIPT_KIND),
      ),
    ).toBe(true);
  });

  it('acceptMessageRequest with a v1 peer resolves and a later send is not wedged', async () => {
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'pending',
    });
    const inbound = buildChatMessageEnvelope({
      eventId: INBOUND_EVENT,
      sentAt: NOW,
      body: 'held then accepted',
    });
    mockedNative.receivePrivateMessages.mockResolvedValue({
      messages: [{ version: 1, kind: CHAT_MESSAGE_KIND, rawJson: inbound.json }],
      snapshot: 'est-2',
    });

    const accepted = await LinkService.acceptMessageRequest(PEER);
    expect(accepted.some(row => row.eventId === INBOUND_EVENT)).toBe(true);
    mockedNative.receivePrivateMessages.mockResolvedValue({ messages: [], snapshot: 'est-3' });
    const sent = await LinkService.sendDm(PEER, 'after accept');
    expect(sent.deliveryState).toBe('sent');
  });
});
