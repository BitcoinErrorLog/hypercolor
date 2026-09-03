/**
 * Owner-conditional persist: identity switch during `await getDb()` must not
 * commit declined promotion, send-intent rows, or group fan-out terminalization.
 */
jest.mock('@synonymdev/react-native-pubky', () => ({
  signOut: jest.fn().mockResolvedValue({ isOk: () => true, value: undefined }),
  put: jest.fn(),
  get: jest.fn(),
  deleteFile: jest.fn(),
  list: jest.fn(),
  getHomeserver: jest.fn(),
  setEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}));

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
    markSignOutIncompleteAlias: jest.fn(),
    getSignOutIncompleteAlias: jest.fn(() => null),
    clearSignOutIncomplete: jest.fn(),
    setSignOutWipeFailureCount: jest.fn(),
    getSignOutWipeFailureCount: jest.fn(() => 0),
    clearSignOutWipeFailures: jest.fn(),
    clearIfPubky: jest.fn(),
    getSessionSecret: jest.fn(),
    getHomeserver: jest.fn(() => 'homeserver-pk'),
    hasPersistedSession: jest.fn(),
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      setAuthenticated: (pubky: string) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { paintOwner } = require('../paintedOwner') as typeof import('../paintedOwner');
        paintOwner(pubky);
      },
    }),
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
    adoptAuthSession: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../db', () => {
  const actual = jest.requireActual('../../db') as typeof import('../../db');
  return {
    ...actual,
    getDb: async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ownerCommitGetDbGate } = require('./ownerCommitGetDbGate') as {
        ownerCommitGetDbGate: { current: (() => Promise<void>) | null };
      };
      if (ownerCommitGetDbGate.current) await ownerCommitGetDbGate.current();
      return actual.getDb();
    },
  };
});

import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setDbForTests } from '../../db';
import { ownerCommitGetDbGate } from './ownerCommitGetDbGate';
import { runMigrations } from '../../db/migrations';
import { openFileDb, openMemoryDb } from '../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../StorageService';
import { KeyStore } from '../KeyStore';
import {
  INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE,
  INTERRUPTED_SIGN_OUT_OWNER_MISSING,
  PubkyService,
} from '../PubkyService';
import { FollowsImportSettings } from '../contacts/followsImportSettings';
import {
  LinkService,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  LINK_RETRY_PAYLOAD_TYPE,
  resetLinkServiceHarnessState,
  stopLinkRetryDrain,
  buildPreparedSendIntent,
} from '../link/LinkService';
import { PaykitLinkNative } from '../link/PaykitLinkNative';
import { CHAT_MESSAGE_KIND, LINK_RECEIVER_PATH, buildDmConversationId } from '../../types/link';
import { GROUP_MESSAGE_KIND } from '../../types/group';
import {
  activeOwnerAtCommit,
  claimWipeInFlight,
  ensureSignOutPaint,
  isNeedsSignInPaint,
  paintOwner,
  pendingWipeInFlight,
  resetPaintedOwnerModuleForTests,
  shouldHoldPreAuthWork,
  SIGNING_OUT,
  waitForWipeInFlight,
  WIPE_WAIT_TIMEOUT_MS,
} from '../paintedOwner';
import {
  BOOT_WIPE_FAILURES_BEFORE_RESET,
  resetAppDataAfterFailedWipe,
  shouldOfferResetAfterFailedWipe,
} from '../resetAfterFailedWipe';
import {
  consumeInterruptedSignOutAtBoot,
  hydratePersistedAuth,
} from '../../stores/hydrateAuthSession';
import {
  EMPTY_PAYMENT_RECORD_EXTRAS,
  ENDPOINT_LIGHTNING_BOLT11,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
} from '../../types/payment';

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
  ownerCommitGetDbGate.current = async () => {
    if (!armed) return;
    remaining -= 1;
    if (remaining > 0) return;
    armed = false;
    resolveWaiting();
    await hold;
  };
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
  paintOwner(OTHER);
}

function wireSignOutIncomplete(): { isSet: () => boolean; owner: () => string | null } {
  let incompleteOwner: string | null = null;
  let incompleteAlias: string | null = null;
  let wipeFailures: { owner: string; count: number } | null = null;
  mockedKeyStore.markSignOutIncomplete.mockImplementation((owner: string) => {
    incompleteOwner = owner;
  });
  mockedKeyStore.isSignOutIncomplete.mockImplementation(
    () => typeof incompleteOwner === 'string' && incompleteOwner.length > 0,
  );
  mockedKeyStore.getSignOutIncompleteOwner.mockImplementation(() => incompleteOwner);
  mockedKeyStore.markSignOutIncompleteAlias.mockImplementation((alias: string) => {
    incompleteAlias = alias;
  });
  mockedKeyStore.getSignOutIncompleteAlias.mockImplementation(() => incompleteAlias);
  mockedKeyStore.clearSignOutIncomplete.mockImplementation(() => {
    incompleteOwner = null;
    incompleteAlias = null;
  });
  mockedKeyStore.setSignOutWipeFailureCount.mockImplementation((owner: string, count: number) => {
    wipeFailures = { owner, count };
  });
  mockedKeyStore.getSignOutWipeFailureCount.mockImplementation((owner: string) => {
    return wipeFailures?.owner === owner ? wipeFailures.count : 0;
  });
  mockedKeyStore.clearSignOutWipeFailures.mockImplementation((owner: string) => {
    if (wipeFailures?.owner === owner) wipeFailures = null;
  });
  mockedKeyStore.deleteLinkSession.mockImplementation(() => {
    mockedKeyStore.getLinkSession.mockReturnValue(null);
  });
  mockedKeyStore.clearIfPubky.mockImplementation(async (expected: string) => {
    if (mockedKeyStore.getPubky() !== expected) return false;
    mockedKeyStore.getPubky.mockReturnValue(null);
    mockedKeyStore.getLinkSession.mockReturnValue(null);
    mockedKeyStore.getSessionSecret.mockReturnValue(null);
    mockedKeyStore.hasPersistedSession.mockResolvedValue(false);
    return true;
  });
  mockedKeyStore.hasPersistedSession.mockImplementation(
    async () => mockedKeyStore.getPubky() != null,
  );
  return { isSet: () => incompleteOwner != null, owner: () => incompleteOwner };
}

async function simulateRelaunch(): Promise<void> {
  resetLinkServiceHarnessState();
  resetPaintedOwnerModuleForTests();
  // Match App boot: consume interrupted sign-out once, then hydrate.
  await consumeInterruptedSignOutAtBoot();
  await hydratePersistedAuth();
}

describe('owner-conditional persist at commit time', () => {
  let db: ReturnType<typeof openMemoryDb> | null = null;

  beforeEach(async () => {
    FollowsImportSettings.resetForTests();
    resetLinkServiceHarnessState();
    ownerCommitGetDbGate.current = null;
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
    wireSignOutIncomplete();
    paintOwner(OWNER);

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
    ownerCommitGetDbGate.current = null;
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
      ownerPubky: OWNER,
      senderPubky: OWNER,
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

  it('refuses a stalled persist after full OWNER→null sign-out and leaves tables empty', async () => {
    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: false,
      isFollower: false,
      isMutual: false,
      addedManually: true,
      firstSeenAt: NOW,
    });
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
        id: 'q-signout-null',
        messageId: eventId,
        recipientPubky: PEER,
        payload: '{}',
        attempts: 0,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    });
    await stall.waiting;
    ensureSignOutPaint();
    await StorageService.clearAccountData(OWNER);
    mockedKeyStore.getPubky.mockReturnValue(null);
    stall.release();
    await expect(pending).rejects.toEqual(
      expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }),
    );
    expect(await StorageService.getContact(PEER, OWNER)).toBeNull();
    expect(await StorageService.hasLinkMessage(OWNER, OWNER, CHAT_MESSAGE_KIND, eventId)).toBe(
      false,
    );
    expect(await StorageService.hasQueueItem('q-signout-null')).toBe(false);
  });

  it('refuses a stalled persist after clearAccountData while still signing-out', async () => {
    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: false,
      isFollower: false,
      isMutual: false,
      addedManually: true,
      firstSeenAt: NOW,
    });
    const eventId = '00000000-0000-4000-8000-00000000aaab';
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
        id: 'q-signout-teardown',
        messageId: eventId,
        recipientPubky: PEER,
        payload: '{}',
        attempts: 0,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    });
    await stall.waiting;
    ensureSignOutPaint();
    await StorageService.clearAccountData(OWNER);
    expect(mockedKeyStore.getPubky()).toBe(OWNER);
    stall.release();
    await expect(pending).rejects.toEqual(
      expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }),
    );
    expect(await StorageService.getContact(PEER, OWNER)).toBeNull();
    expect(await StorageService.hasLinkMessage(OWNER, OWNER, CHAT_MESSAGE_KIND, eventId)).toBe(
      false,
    );
    expect(await StorageService.hasQueueItem('q-signout-teardown')).toBe(false);
  });

  it('does not send a persisted group envelope after an identity switch', async () => {
    const eventId = '00000000-0000-4000-8000-00000000cccc';
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
          id: 'q-group-handoff',
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
        },
      ],
    });
    mockedNative.sendPrivateMessageJson.mockClear();
    switchPaintedOwner();
    await expect(
      LinkService.sendPersistedLinkJson({
        ownerPubky: OWNER,
        senderPubky: OWNER,
        peerPubky: PEER,
        queueId: 'q-group-handoff',
        kind: GROUP_MESSAGE_KIND,
        eventId,
        rawJson: '{}',
        channelId: CHANNEL_ID,
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }));
    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    expect(await StorageService.hasQueueItem('q-group-handoff')).toBe(true);
    expect(await StorageService.getGroupFanoutAggregate(OTHER, CHANNEL_ID, OTHER, eventId)).toEqual(
      [],
    );
    const outcomes = await StorageService.getGroupFanoutAggregate(
      OWNER,
      CHANNEL_ID,
      OWNER,
      eventId,
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe('pending');
  });

  it('does not send a persisted payment envelope after an identity switch', async () => {
    const eventId = '00000000-0000-4000-8000-00000000dddd';
    const sendIntent = buildPreparedSendIntent({
      ownerPubky: OWNER,
      peerPubky: PEER,
      kind: PAYKIT_PAYMENT_REQUEST_KIND,
      eventId,
      rawJson: '{}',
      body: 'pay',
      sentAt: NOW,
      queueId: 'q-pay-handoff',
    });
    await StorageService.persistLinkSendIntent(sendIntent);
    mockedNative.sendPrivateMessageJson.mockClear();
    switchPaintedOwner();
    await expect(
      LinkService.attemptPersistedSend({
        ownerPubky: OWNER,
        senderPubky: OWNER,
        peerPubky: PEER,
        kind: PAYKIT_PAYMENT_REQUEST_KIND,
        eventId,
        queueId: 'q-pay-handoff',
        rawJson: '{}',
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }));
    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
    expect(await StorageService.hasQueueItem('q-pay-handoff')).toBe(true);
    expect(
      await StorageService.hasLinkMessage(OTHER, OTHER, PAYKIT_PAYMENT_REQUEST_KIND, eventId),
    ).toBe(false);
    expect(
      await StorageService.hasLinkMessage(OWNER, OWNER, PAYKIT_PAYMENT_REQUEST_KIND, eventId),
    ).toBe(true);
  });

  async function seedPendingPaymentWithoutQueue(eventId: string): Promise<void> {
    await StorageService.savePaymentRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      direction: 'received',
      paymentRequestId: 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
      eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d101',
      amountValue: '0.001',
      amountAsset: 'btc',
      paymentReference: 'invoice-r9',
      endpointIds: [ENDPOINT_LIGHTNING_BOLT11],
      expiresAt: null,
      status: 'accepted',
      createdAt: NOW,
      updatedAt: NOW,
      proofJson: null,
      reason: null,
      ...EMPTY_PAYMENT_RECORD_EXTRAS,
      pendingEventId: eventId,
    });
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId,
      conversationId: buildDmConversationId(PEER),
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: 'sent',
      kind: PAYKIT_PAYMENT_ACCEPTANCE_KIND,
      rawJson: '{}',
      body: 'pay',
      sentAt: NOW,
      receivedAt: null,
      deliveryState: 'sending',
    });
  }

  it('does not enqueue a payment retry after sign-out paints mid-reconcile', async () => {
    const eventId = '00000000-0000-4000-8000-00000000aaac';
    await seedPendingPaymentWithoutQueue(eventId);
    const stall = installGetDbStall();
    stall.armNth(3);
    const pending = LinkService.recoverPendingSends();
    await stall.waiting;
    await LinkService.clearSession();
    stall.release();
    await pending;
    expect(await StorageService.listDeliveryQueue()).toEqual([]);
    expect(await StorageService.hasQueueItemForMessage(eventId)).toBe(false);
  });

  it('does not enqueue a payment retry for the old owner after a mid-reconcile switch', async () => {
    const eventId = '00000000-0000-4000-8000-00000000aaad';
    await seedPendingPaymentWithoutQueue(eventId);
    const stall = installGetDbStall();
    stall.armNth(3);
    const pending = LinkService.recoverPendingSends();
    await stall.waiting;
    switchPaintedOwner();
    stall.release();
    await pending;
    const queued = await StorageService.listDeliveryQueue();
    expect(queued.filter(item => JSON.parse(item.payload).ownerPubky === OWNER)).toEqual([]);
    expect(await StorageService.hasQueueItemForMessage(eventId)).toBe(false);
  });

  it('restores painted owner when sign-out prelude throws so owned writes still commit', async () => {
    const spy = jest
      .spyOn(StorageService, 'getAllLinks')
      .mockRejectedValueOnce(new Error('sql locked'));
    await expect(LinkService.clearSession()).rejects.toThrow('sql locked');
    spy.mockRestore();
    expect(activeOwnerAtCommit()).toBe(OWNER);
    expect(mockedKeyStore.getLinkSession()).toBe(SESSION_ALIAS);
    expect(await StorageService.getLink(OWNER, PEER)).not.toBeNull();
    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: false,
      isFollower: false,
      isMutual: false,
      addedManually: true,
      firstSeenAt: NOW,
    });
    expect(await StorageService.getContact(PEER, OWNER)).not.toBeNull();
    await simulateRelaunch();
    expect(activeOwnerAtCommit()).toBe(OWNER);
  });

  it('does not restore paint when clearAccountData throws after irreversible start', async () => {
    const spy = jest
      .spyOn(StorageService, 'clearAccountData')
      .mockRejectedValueOnce(new Error('sql locked'));
    await expect(LinkService.clearSession()).rejects.toThrow('sql locked');
    spy.mockRestore();
    expect(activeOwnerAtCommit()).toBe(SIGNING_OUT);
    expect(mockedKeyStore.getLinkSession()).toBeNull();
    expect(mockedKeyStore.getPubky()).toBe(OWNER);
    expect(mockedKeyStore.isSignOutIncomplete()).toBe(true);
    expect(await StorageService.hasSignOutIncompleteJournal()).toBe(true);
    await expect(
      StorageService.upsertContact({
        pubky: PEER,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: false,
        isFollower: false,
        isMutual: false,
        addedManually: true,
        firstSeenAt: NOW,
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }));
    await simulateRelaunch();
    expect(activeOwnerAtCommit()).toBeNull();
    expect(isNeedsSignInPaint()).toBe(true);
    expect(mockedKeyStore.getPubky()).toBeNull();
  });

  it('leaves signing-out paint after successful teardown', async () => {
    await LinkService.clearSession();
    expect(activeOwnerAtCommit()).toBe(SIGNING_OUT);
  });

  it('restores paint when getLinkReceiver throws in the sign-out prelude', async () => {
    const spy = jest
      .spyOn(StorageService, 'getLinkReceiver')
      .mockRejectedValueOnce(new Error('receiver read'));
    await expect(LinkService.clearSession()).rejects.toThrow('receiver read');
    spy.mockRestore();
    expect(activeOwnerAtCommit()).toBe(OWNER);
    expect(await StorageService.getLink(OWNER, PEER)).not.toBeNull();
    expect(mockedKeyStore.getLinkSession()).toBe(SESSION_ALIAS);
    await simulateRelaunch();
    expect(activeOwnerAtCommit()).toBe(OWNER);
  });

  it('restores paint when closing a live handle throws in the prelude', async () => {
    await LinkService.ensureLinkWith(PEER);
    mockedNative.closeLink.mockRejectedValueOnce({ code: 'unavailable', message: 'gone' });
    await expect(LinkService.clearSession()).rejects.toEqual(
      expect.objectContaining({ code: 'unavailable' }),
    );
    expect(activeOwnerAtCommit()).toBe(OWNER);
    expect(await StorageService.getLink(OWNER, PEER)).not.toBeNull();
    await simulateRelaunch();
    expect(activeOwnerAtCommit()).toBe(OWNER);
  });

  it('retries deleteLinkSession and leaves a marker when it keeps failing', async () => {
    mockedKeyStore.deleteLinkSession
      .mockImplementationOnce(() => {
        throw new Error('mmkv remove failed');
      })
      .mockImplementationOnce(() => {
        throw new Error('mmkv remove failed');
      });
    await expect(LinkService.clearSession()).rejects.toThrow('mmkv remove failed');
    expect(activeOwnerAtCommit()).toBe(SIGNING_OUT);
    expect(mockedKeyStore.deleteLinkSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockedKeyStore.isSignOutIncomplete()).toBe(true);
    expect(await StorageService.getLink(OWNER, PEER)).toBeNull();
    await expect(
      StorageService.upsertContact({
        pubky: PEER,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: false,
        isFollower: false,
        isMutual: false,
        addedManually: true,
        firstSeenAt: NOW,
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }));
    await simulateRelaunch();
    expect(mockedKeyStore.getPubky()).toBeNull();
    expect(activeOwnerAtCommit()).toBeNull();
    expect(isNeedsSignInPaint()).toBe(true);
  });

  it('does not restore paint when KeyStore.clearIfPubky throws after teardown', async () => {
    mockedKeyStore.clearIfPubky.mockRejectedValueOnce(new Error('keystore clear'));
    await expect(PubkyService.signOut()).rejects.toThrow('keystore clear');
    expect(activeOwnerAtCommit()).toBe(SIGNING_OUT);
    expect(mockedKeyStore.isSignOutIncomplete()).toBe(true);
    expect(await StorageService.getLink(OWNER, PEER)).toBeNull();
    await simulateRelaunch();
    expect(mockedKeyStore.getPubky()).toBeNull();
    expect(activeOwnerAtCommit()).toBeNull();
    expect(isNeedsSignInPaint()).toBe(true);
  });

  it('rolls back persistLinkSendIntent when the queue payload names a different owner', async () => {
    const eventId = '00000000-0000-4000-8000-00000000ccc1';
    await expect(
      StorageService.persistLinkSendIntent({
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
          id: 'q-forged',
          messageId: eventId,
          recipientPubky: PEER,
          payload: JSON.stringify({
            type: 'link.chat.message',
            ownerPubky: OTHER,
            peerPubky: PEER,
            senderPubky: OTHER,
            kind: CHAT_MESSAGE_KIND,
            eventId,
            rawJson: '{}',
          }),
          attempts: 0,
          nextRetryAt: NOW,
          createdAt: NOW,
        },
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }));
    expect(await StorageService.hasLinkMessage(OWNER, OWNER, CHAT_MESSAGE_KIND, eventId)).toBe(
      false,
    );
    expect(await StorageService.hasQueueItem('q-forged')).toBe(false);
  });

  it('rolls back persistGroupSendIntent when a queue payload names a different owner', async () => {
    const eventId = '00000000-0000-4000-8000-00000000ccc2';
    await expect(
      StorageService.persistGroupSendIntent({
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
            id: 'q-group-forged',
            messageId: eventId,
            recipientPubky: PEER_B,
            payload: JSON.stringify({
              type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
              ownerPubky: OTHER,
              peerPubky: PEER_B,
              senderPubky: OTHER,
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
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }));
    expect(await StorageService.listGroupFanoutOutcomes(OWNER, CHANNEL_ID, OWNER, eventId)).toEqual(
      [],
    );
    expect(await StorageService.hasQueueItem('q-group-forged')).toBe(false);
  });

  it('keeps identity and both markers when PubkyService.signOut wipe fails, then retries', async () => {
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: '00000000-0000-4000-8000-00000000r111',
      conversationId: buildDmConversationId(PEER),
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: 'sent',
      kind: CHAT_MESSAGE_KIND,
      rawJson: '{}',
      body: 'keep-me',
      sentAt: NOW,
      receivedAt: null,
      deliveryState: 'sent',
    });
    const spy = jest
      .spyOn(StorageService, 'clearAccountData')
      .mockRejectedValueOnce(new Error('sql locked'));
    await expect(PubkyService.signOut()).rejects.toThrow('sql locked');
    spy.mockRestore();
    expect(mockedKeyStore.getPubky()).toBe(OWNER);
    expect(mockedKeyStore.isSignOutIncomplete()).toBe(true);
    expect(mockedKeyStore.getSignOutIncompleteOwner()).toBe(OWNER);
    expect(await StorageService.hasSignOutIncompleteJournal()).toBe(true);
    expect(await StorageService.getSignOutIncompleteJournalOwner()).toBe(OWNER);
    expect(activeOwnerAtCommit()).toBe(SIGNING_OUT);
    expect(
      await StorageService.hasLinkMessage(
        OWNER,
        OWNER,
        CHAT_MESSAGE_KIND,
        '00000000-0000-4000-8000-00000000r111',
      ),
    ).toBe(true);
    await PubkyService.signOut();
    expect(mockedKeyStore.getPubky()).toBeNull();
    expect(mockedKeyStore.isSignOutIncomplete()).toBe(false);
    expect(await StorageService.hasSignOutIncompleteJournal()).toBe(false);
    expect(
      await StorageService.hasLinkMessage(
        OWNER,
        OWNER,
        CHAT_MESSAGE_KIND,
        '00000000-0000-4000-8000-00000000r111',
      ),
    ).toBe(false);
    expect(await StorageService.getLink(OWNER, PEER)).toBeNull();
  });

  it('retries the wipe from the marker owner on relaunch and paints nothing', async () => {
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: '00000000-0000-4000-8000-00000000r112',
      conversationId: buildDmConversationId(PEER),
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: 'sent',
      kind: CHAT_MESSAGE_KIND,
      rawJson: '{}',
      body: 'wipe-me',
      sentAt: NOW,
      receivedAt: null,
      deliveryState: 'sent',
    });
    const spy = jest
      .spyOn(StorageService, 'clearAccountData')
      .mockRejectedValueOnce(new Error('sql locked'));
    await expect(PubkyService.signOut()).rejects.toThrow('sql locked');
    spy.mockRestore();
    expect(mockedKeyStore.getSignOutIncompleteOwner()).toBe(OWNER);
    mockedKeyStore.getPubky.mockReturnValue(null);
    await simulateRelaunch();
    expect(
      await StorageService.hasLinkMessage(
        OWNER,
        OWNER,
        CHAT_MESSAGE_KIND,
        '00000000-0000-4000-8000-00000000r112',
      ),
    ).toBe(false);
    expect(mockedKeyStore.getPubky()).toBeNull();
    expect(activeOwnerAtCommit()).toBeNull();
    expect(isNeedsSignInPaint()).toBe(true);
  });

  it('does not restore paint A when the prelude throws after paintOwner(B)', async () => {
    const spy = jest.spyOn(StorageService, 'getAllLinks').mockImplementation(async () => {
      paintOwner(OTHER);
      throw new Error('sql locked');
    });
    await expect(LinkService.clearSession()).rejects.toThrow('sql locked');
    spy.mockRestore();
    expect(activeOwnerAtCommit()).toBe(OTHER);
  });

  it('does not clear B native aliases when a boot wipe runs after B is painted', async () => {
    mockedNative.clearAllNativeSecrets.mockClear();
    mockedNative.signOutSession.mockClear();
    let releaseWipe = (): void => undefined;
    let startedWipe = (): void => undefined;
    const started = new Promise<void>(resolve => {
      startedWipe = resolve;
    });
    const held = new Promise<void>(resolve => {
      releaseWipe = resolve;
    });
    const realClear = StorageService.clearAccountData.bind(StorageService);
    const spy = jest.spyOn(StorageService, 'clearAccountData').mockImplementation(async owner => {
      startedWipe();
      await held;
      spy.mockRestore();
      return realClear(owner);
    });
    const pending = PubkyService.signOut();
    await started;
    mockedKeyStore.getPubky.mockReturnValue(OTHER);
    mockedKeyStore.getLinkSession.mockReturnValue('session-b');
    paintOwner(OTHER);
    releaseWipe();
    await pending;
    expect(mockedNative.signOutSession).toHaveBeenCalledWith(SESSION_ALIAS);
    expect(mockedNative.signOutSession).not.toHaveBeenCalledWith('session-b');
    expect(mockedNative.clearAllNativeSecrets).not.toHaveBeenCalled();
    expect(mockedKeyStore.getPubky()).toBe(OTHER);
    expect(mockedKeyStore.getLinkSession()).toBe('session-b');
  });

  it('waits for an in-flight wipe before signing in as B', async () => {
    mockedNative.signinWithSecret.mockClear();
    mockedNative.signinWithSecret.mockResolvedValue({ sessionAlias: 'session-b', pubky: OTHER });
    mockedKeyStore.setPubky.mockImplementation((pubky: string) => {
      mockedKeyStore.getPubky.mockReturnValue(pubky);
    });
    mockedKeyStore.setLinkSession.mockImplementation((alias: string) => {
      mockedKeyStore.getLinkSession.mockReturnValue(alias);
    });
    let releaseWipe = (): void => undefined;
    let startedWipe = (): void => undefined;
    const started = new Promise<void>(resolve => {
      startedWipe = resolve;
    });
    const held = new Promise<void>(resolve => {
      releaseWipe = resolve;
    });
    const realClear = StorageService.clearAccountData.bind(StorageService);
    const spy = jest.spyOn(StorageService, 'clearAccountData').mockImplementation(async owner => {
      startedWipe();
      await held;
      spy.mockRestore();
      return realClear(owner);
    });
    const pendingWipe = PubkyService.signOut();
    await started;
    const pendingSignin = LinkService.signinWithSecret('b-secret');
    expect(mockedNative.signinWithSecret).not.toHaveBeenCalled();
    releaseWipe();
    await pendingWipe;
    await pendingSignin;
    expect(mockedNative.signinWithSecret).toHaveBeenCalledWith('b-secret');
    expect(mockedKeyStore.getPubky()).toBe(OTHER);
    expect(mockedKeyStore.getLinkSession()).toBe('session-b');
  });

  it('does not paint or wipe when the interrupted-sign-out marker cannot be read', async () => {
    mockedKeyStore.isSignOutIncomplete.mockImplementation(() => {
      throw new Error('mmkv read');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(hydratePersistedAuth()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE);
    warn.mockRestore();
    expect(activeOwnerAtCommit()).toBeNull();
    expect(isNeedsSignInPaint()).toBe(true);
    expect(mockedKeyStore.getPubky()).toBe(OWNER);
    expect(await StorageService.getLink(OWNER, PEER)).not.toBeNull();
    expect(mockedNative.clearAllNativeSecrets).not.toHaveBeenCalled();
  });

  it('aborts sign-out before destruction when the marker write cannot be verified', async () => {
    mockedKeyStore.markSignOutIncomplete.mockImplementation(() => {
      throw new Error('mmkv down');
    });
    await expect(PubkyService.signOut()).rejects.toThrow('sign-out marker write failed');
    expect(activeOwnerAtCommit()).toBe(OWNER);
    expect(mockedKeyStore.getPubky()).toBe(OWNER);
    expect(await StorageService.getLink(OWNER, PEER)).not.toBeNull();
    expect(mockedKeyStore.isSignOutIncomplete()).toBe(false);
  });

  it('rolls back persistLinkSendIntent when the queue payload omits ownerPubky', async () => {
    const eventId = '00000000-0000-4000-8000-00000000ccc3';
    await expect(
      StorageService.persistLinkSendIntent({
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
          id: 'q-missing-owner',
          messageId: eventId,
          recipientPubky: PEER,
          payload: JSON.stringify({
            type: 'link.chat.message',
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
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'LinkSendError', code: 'owner-changed' }));
    expect(await StorageService.hasLinkMessage(OWNER, OWNER, CHAT_MESSAGE_KIND, eventId)).toBe(
      false,
    );
    expect(await StorageService.hasQueueItem('q-missing-owner')).toBe(false);
  });

  it('boot prelude failure keeps signing-out paint, holds drain, and does not send queued DMs', async () => {
    const eventId = '00000000-0000-4000-8000-00000000r121';
    await StorageService.persistLinkSendIntent({
      message: {
        ownerPubky: OWNER,
        eventId,
        conversationId: buildDmConversationId(PEER),
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{}',
        body: 'queued',
        sentAt: NOW,
        receivedAt: null,
        deliveryState: 'sending',
      },
      queueItem: {
        id: 'q-boot-prelude',
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
    mockedKeyStore.markSignOutIncomplete(OWNER);
    await StorageService.persistSignOutIncompleteJournal(OWNER, SESSION_ALIAS);
    mockedNative.sendPrivateMessageJson.mockClear();
    const spy = jest
      .spyOn(StorageService, 'getAllLinks')
      .mockRejectedValueOnce(new Error('sql locked'));
    await simulateRelaunch();
    spy.mockRestore();
    expect(activeOwnerAtCommit()).toBe(SIGNING_OUT);
    expect(shouldHoldPreAuthWork()).toBe(true);
    expect(mockedKeyStore.getPubky()).toBe(OWNER);
    await LinkService.drainRetries();
    expect(mockedNative.sendPrivateMessageJson).not.toHaveBeenCalled();
  });

  it('rejects sign-in after a hung wipe timeout and proceeds once the wipe settles', async () => {
    mockedNative.signinWithSecret.mockClear();
    mockedNative.signinWithSecret.mockResolvedValue({ sessionAlias: 'session-b', pubky: OTHER });
    mockedKeyStore.setPubky.mockImplementation((pubky: string) => {
      mockedKeyStore.getPubky.mockReturnValue(pubky);
    });
    mockedKeyStore.setLinkSession.mockImplementation((alias: string) => {
      mockedKeyStore.getLinkSession.mockReturnValue(alias);
    });
    jest.spyOn(Date, 'now').mockRestore();
    jest.useFakeTimers();
    try {
      // Claim the wipe gate; releaseWipe settles it like a finished wipe.
      const releaseWipe = claimWipeInFlight();
      const pending = LinkService.signinWithSecret('b-secret');
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'WipeWaitTimeoutError',
        code: 'wipe-wait-timeout',
        retryable: true,
      });
      await jest.advanceTimersByTimeAsync(WIPE_WAIT_TIMEOUT_MS);
      await assertion;
      expect(pendingWipeInFlight()).not.toBeNull();
      expect(mockedNative.signinWithSecret).not.toHaveBeenCalled();
      releaseWipe();
      await waitForWipeInFlight();
      await LinkService.signinWithSecret('b-secret');
      expect(mockedNative.signinWithSecret).toHaveBeenCalledWith('b-secret');
    } finally {
      jest.useRealTimers();
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
    }
  });

  it('boot wipe signs out the marker alias when KeyStore names a different owner', async () => {
    const spy = jest
      .spyOn(StorageService, 'clearAccountData')
      .mockRejectedValueOnce(new Error('sql locked'));
    await expect(PubkyService.signOut()).rejects.toThrow('sql locked');
    spy.mockRestore();
    expect(mockedKeyStore.getSignOutIncompleteAlias()).toBe(SESSION_ALIAS);
    mockedKeyStore.getPubky.mockReturnValue(OTHER);
    mockedKeyStore.getLinkSession.mockReturnValue('session-b');
    mockedNative.signOutSession.mockClear();
    mockedNative.clearAllNativeSecrets.mockClear();
    await simulateRelaunch();
    expect(mockedNative.signOutSession).toHaveBeenCalledWith(SESSION_ALIAS);
    expect(mockedNative.signOutSession).not.toHaveBeenCalledWith('session-b');
    expect(mockedNative.clearAllNativeSecrets).not.toHaveBeenCalled();
  });

  it('keeps another owner sign-out journal row when persisting a new marker', async () => {
    await StorageService.persistSignOutIncompleteJournal(OWNER, SESSION_ALIAS);
    await StorageService.persistSignOutIncompleteJournal(OTHER, 'session-b');
    expect(await StorageService.getSignOutIncompleteJournalOwner(OWNER)).toBe(OWNER);
    expect(await StorageService.getSignOutIncompleteJournalOwner(OTHER)).toBe(OTHER);
    expect(await StorageService.getSignOutIncompleteJournalAlias(OWNER)).toBe(SESSION_ALIAS);
    expect(await StorageService.getSignOutIncompleteJournalAlias(OTHER)).toBe('session-b');
  });

  it('offers reset after two failed boot wipes and not after one', async () => {
    mockedKeyStore.markSignOutIncomplete(OWNER);
    await StorageService.persistSignOutIncompleteJournal(OWNER, SESSION_ALIAS);
    const spy = jest
      .spyOn(StorageService, 'getAllLinks')
      .mockRejectedValue(new Error('sql locked'));
    await simulateRelaunch();
    expect(await shouldOfferResetAfterFailedWipe()).toBe(false);
    await simulateRelaunch();
    expect(mockedKeyStore.getSignOutWipeFailureCount(OWNER)).toBe(BOOT_WIPE_FAILURES_BEFORE_RESET);
    expect(await shouldOfferResetAfterFailedWipe()).toBe(true);
    spy.mockRestore();
  });

  it('reset after failed wipe deletes the database file, clears markers, and paints nothing', async () => {
    db?.close();
    const dir = mkdtempSync(join(tmpdir(), 'hypercolor-reset-'));
    const path = join(dir, 'hypercolor.db');
    db = openFileDb(path);
    setDbForTests(db);
    await runMigrations(db);
    mockedKeyStore.markSignOutIncomplete(OWNER);
    await StorageService.persistSignOutIncompleteJournal(OWNER, SESSION_ALIAS);
    mockedKeyStore.setSignOutWipeFailureCount(OWNER, BOOT_WIPE_FAILURES_BEFORE_RESET);
    await StorageService.persistSignOutWipeFailureCount(OWNER, BOOT_WIPE_FAILURES_BEFORE_RESET);
    ensureSignOutPaint();
    mockedNative.signOutSession.mockClear();
    mockedNative.clearAllNativeSecrets.mockClear();
    // KeyStore still names OWNER when reset starts — native wipe must fire.
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    await resetAppDataAfterFailedWipe();
    expect(existsSync(path)).toBe(false);
    expect(mockedKeyStore.isSignOutIncomplete()).toBe(false);
    expect(mockedKeyStore.getSignOutWipeFailureCount(OWNER)).toBe(0);
    expect(activeOwnerAtCommit()).toBeNull();
    expect(isNeedsSignInPaint()).toBe(true);
    expect(mockedNative.signOutSession).toHaveBeenCalledWith(SESSION_ALIAS);
    expect(mockedNative.clearAllNativeSecrets).toHaveBeenCalled();
  });

  it('keeps markers and the failure counter when reset throws midway', async () => {
    mockedKeyStore.markSignOutIncomplete(OWNER);
    await StorageService.persistSignOutIncompleteJournal(OWNER, SESSION_ALIAS);
    mockedKeyStore.setSignOutWipeFailureCount(OWNER, BOOT_WIPE_FAILURES_BEFORE_RESET);
    await StorageService.persistSignOutWipeFailureCount(OWNER, BOOT_WIPE_FAILURES_BEFORE_RESET);
    mockedKeyStore.clearIfPubky.mockRejectedValueOnce(new Error('keystore locked'));
    await expect(resetAppDataAfterFailedWipe()).rejects.toMatchObject({
      code: 'reset-app-data-failed',
      retryable: true,
    });
    expect(mockedKeyStore.isSignOutIncomplete()).toBe(true);
    expect(mockedKeyStore.getSignOutIncompleteOwner()).toBe(OWNER);
    expect(mockedKeyStore.getSignOutWipeFailureCount(OWNER)).toBe(BOOT_WIPE_FAILURES_BEFORE_RESET);
  });

  it('does not touch KeyStore B or native secrets when the marker names A', async () => {
    mockedKeyStore.markSignOutIncomplete(OWNER);
    await StorageService.persistSignOutIncompleteJournal(OWNER, SESSION_ALIAS);
    mockedKeyStore.setSignOutWipeFailureCount(OWNER, BOOT_WIPE_FAILURES_BEFORE_RESET);
    await StorageService.persistSignOutWipeFailureCount(OWNER, BOOT_WIPE_FAILURES_BEFORE_RESET);
    mockedKeyStore.getPubky.mockReturnValue(OTHER);
    mockedKeyStore.getLinkSession.mockReturnValue('session-b');
    paintOwner(OTHER);
    mockedNative.clearAllNativeSecrets.mockClear();
    mockedNative.signOutSession.mockClear();
    mockedKeyStore.clearIfPubky.mockClear();
    await expect(resetAppDataAfterFailedWipe()).rejects.toMatchObject({
      code: 'reset-app-data-failed',
    });
    expect(mockedKeyStore.getPubky()).toBe(OTHER);
    expect(mockedKeyStore.getLinkSession()).toBe('session-b');
    expect(mockedKeyStore.clearIfPubky).not.toHaveBeenCalled();
    expect(mockedNative.clearAllNativeSecrets).not.toHaveBeenCalled();
    expect(mockedNative.signOutSession).not.toHaveBeenCalled();
    expect(mockedKeyStore.isSignOutIncomplete()).toBe(true);
  });

  it('opens the reset hatch for an ownerless corrupt journal marker after two launches', async () => {
    db?.close();
    const dir = mkdtempSync(join(tmpdir(), 'hypercolor-reset-ownerless-'));
    const path = join(dir, 'hypercolor.db');
    db = openFileDb(path);
    setDbForTests(db);
    await runMigrations(db);
    // Journal row whose owner is not a valid pubky: the marker is present
    // but readInterruptedSignOutOwner() can never name an owner.
    await StorageService.persistSignOutIncompleteJournal('ownerless-corrupt-row', SESSION_ALIAS);
    resetPaintedOwnerModuleForTests();
    mockedKeyStore.getPubky.mockReturnValue(null);
    mockedKeyStore.hasPersistedSession.mockResolvedValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await simulateRelaunch();
    expect(warn).toHaveBeenCalledWith(INTERRUPTED_SIGN_OUT_OWNER_MISSING);
    expect(await shouldOfferResetAfterFailedWipe()).toBe(false);
    await simulateRelaunch();
    expect(await shouldOfferResetAfterFailedWipe()).toBe(true);

    await resetAppDataAfterFailedWipe();
    expect(existsSync(path)).toBe(false);
    expect(mockedNative.signOutSession).not.toHaveBeenCalled();
    expect(mockedNative.clearAllNativeSecrets).not.toHaveBeenCalled();
    expect(mockedKeyStore.clearIfPubky).not.toHaveBeenCalled();
    expect(isNeedsSignInPaint()).toBe(true);
  });

  it('refuses an ownerless-marker reset while a live owner is signed in', async () => {
    db?.close();
    const dir = mkdtempSync(join(tmpdir(), 'hypercolor-reset-ownerless-live-'));
    const path = join(dir, 'hypercolor.db');
    db = openFileDb(path);
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.persistSignOutIncompleteJournal('ownerless-corrupt-row', SESSION_ALIAS);
    await StorageService.persistSignOutWipeFailureCount(
      'interrupted-sign-out-owner-unknown',
      BOOT_WIPE_FAILURES_BEFORE_RESET,
    );
    // OTHER is live and painted: the coarse reset would destroy live data.
    mockedKeyStore.getPubky.mockReturnValue(OTHER);
    paintOwner(OTHER);
    await expect(resetAppDataAfterFailedWipe()).rejects.toMatchObject({
      code: 'reset-app-data-failed',
    });
    expect(existsSync(path)).toBe(true);
    expect(mockedKeyStore.getPubky()).toBe(OTHER);
    expect(await StorageService.hasSignOutIncompleteJournal()).toBe(true);
  });
});
