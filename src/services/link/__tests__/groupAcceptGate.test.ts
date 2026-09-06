import { LinkService } from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { RetryQueue } from '../../RetryQueue';
import { FollowsImportSettings } from '../../contacts/followsImportSettings';
import { wireSignOutMarkerMocks } from '../../__tests__/wireSignOutMarkerMocks';
import { subscribeGroupEvents } from '../../group/groupEvents';
import {
  CHAT_MESSAGE_KIND,
  LINK_RECEIVER_PATH,
  buildChatMessageEnvelope,
  type LinkMessage,
  type LinkReceiver,
  type LinkRecord,
  type LinkStreamItem,
} from '../../../types/link';
import {
  GROUP_MEMBERSHIP_KIND,
  GROUP_REACTION_KIND,
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildGroupReactionEnvelope,
  isGroupWireKind,
  peekEnvelopeKind,
  type GroupChannel,
  type GroupDeferredEvent,
  type GroupMember,
  type GroupMessage,
} from '../../../types/group';
import type { MessageRequest } from '../../../types';
import {
  LINK_HELD_NON_GROUP_CAP_PER_PEER,
  LINK_HELD_UNPROCESSED_CAP_PER_PEER,
} from '../../../flags/config';

/**
 * Regression suite for the group accept gate.
 *
 * A peer in the inbox candidate set (any contact, including a bulk
 * follows-import row) is only a PENDING message request until the user says
 * yes. Before the gate, `routeHeldGroupInbound` still handed that peer's
 * `chat.group.membership.v0` `create` to `applyGroupInbound`, whose
 * founder-bound check is self-certifying because the sender picks
 * `channel_id`. A stranger could therefore put a named channel in the
 * victim's channel list, add the victim to its roster, and fire a group
 * notification with zero acceptance.
 */

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
    deleteLinkReceiver: jest.fn(),
    upsertLink: jest.fn(),
    getLink: jest.fn(),
    getAllLinks: jest.fn(),
    recordLastSeenPeerMarkerPk: jest.fn(),
    updateLinkSnapshot: jest.fn(),
    incrementLinkConsecutiveFailures: jest.fn(),
    resetLinkConsecutiveFailures: jest.fn(),
    deleteLink: jest.fn(),
    deleteArchivedLink: jest.fn(),
    saveLinkMessage: jest.fn(),
    persistLinkSendIntent: jest.fn(),
    finalizeLinkSend: jest.fn(),
    hasLinkMessage: jest.fn(),
    getLinkMessage: jest.fn(),
    getLinkMessagesForConversation: jest.fn(),
    updateLinkMessageDeliveryState: jest.fn(),
    updateAttachmentDelivery: jest.fn(),
    countDeliveryQueueForMessage: jest.fn(),
    upsertGroupFanoutOutcome: jest.fn(),
    listGroupFanoutOutcomes: jest.fn(),
    saveLinkStreamItems: jest.fn(),
    getUnprocessedLinkStreamItems: jest.fn(),
    markLinkStreamItemProcessed: jest.fn(),
    deleteLinkStreamItemsForPeer: jest.fn(),
    deleteLinkMessagesForPeer: jest.fn(),
    countLinkMessagesForPeer: jest.fn(),
    settleExcessUnprocessedLinkStreamItems: jest.fn(),
    getLinkReadCursor: jest.fn(),
    setLinkReadCursor: jest.fn(),
    clearAccountData: jest.fn(),
    persistSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
    hasSignOutIncompleteJournal: jest.fn().mockResolvedValue(false),
    getSignOutIncompleteJournalOwner: jest.fn().mockResolvedValue(null),
    clearSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
    retryPendingCleanup: jest.fn(),
    listDeliveryQueue: jest.fn(),
    removeFromQueue: jest.fn(),
    getContact: jest.fn(),
    getAllContacts: jest.fn(),
    setContactRelationshipFlags: jest.fn(),
    getMessageRequest: jest.fn(),
    upsertMessageRequest: jest.fn(),
    acceptDeclinedMessageRequest: jest.fn(),
    deleteMessageRequest: jest.fn(),
    listMessageRequests: jest.fn(),
    countPendingMessageRequests: jest.fn(),
    hasGroupEvent: jest.fn(),
    markGroupEventSeen: jest.fn(),
    getGroupChannel: jest.fn(),
    updateGroupChannelName: jest.fn(),
    touchGroupChannel: jest.fn(),
    bumpGroupMembershipEpoch: jest.fn(),
    insertInboundPrivateCreate: jest.fn(),
    getGroupMember: jest.fn(),
    upsertGroupMember: jest.fn(),
    saveGroupMessage: jest.fn(),
    hasGroupMessage: jest.fn(),
    getGroupMessage: jest.fn(),
    updateGroupMessageDeliveryState: jest.fn(),
    findGroupMessageByAuthorEvent: jest.fn(),
    saveGroupDeferred: jest.fn(),
    listGroupDeferredForTarget: jest.fn(),
    deleteGroupDeferred: jest.fn(),
    deleteGroupDeferredForSender: jest.fn(),
    deleteGroupSeenEventsForSender: jest.fn(),
    applyGroupMessageEdit: jest.fn(),
    tombstoneGroupMessage: jest.fn(),
    getHandshakeBudget: jest.fn(),
    upsertHandshakeBudget: jest.fn(),
    clearHandshakeBudget: jest.fn(),
    hasQueueItem: jest.fn(),
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
    setAttachmentSecret: jest.fn(),
    deleteAttachmentSecrets: jest.fn(),
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

jest.mock('uuid', () => ({ v4: jest.fn(() => 'unused-stream-id') }));

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedStorage = jest.mocked(StorageService);
const mockedKeyStore = jest.mocked(KeyStore);
const mockedRetryQueue = jest.mocked(RetryQueue);

const NOW = 1_700_000_000_000;
const OWNER = 'a'.repeat(52);
const PEER = 'z'.repeat(52);
const OTHER = 'y'.repeat(52);
const SESSION_ALIAS = 'session-alias-1';
const RECEIVER_ALIAS = 'receiver-alias-1';
const PEER_NOISE = 'peer-noise-pk';
const CHANNEL_ID = `${PEER}:00000000-0000-4000-8000-00000000aaaa`;
const CREATE_EVENT_ID = '00000000-0000-4000-8000-0000000000c1';
const MESSAGE_EVENT_ID = '00000000-0000-4000-8000-0000000000c2';
const REACTION_EVENT_ID = '00000000-0000-4000-8000-0000000000c3';
const OTHER_TARGET_EVENT_ID = '00000000-0000-4000-8000-0000000000c4';

const receiverRow: LinkReceiver = {
  ownerPubky: OWNER,
  receiverAlias: RECEIVER_ALIAS,
  receiverPath: LINK_RECEIVER_PATH,
  markerPublished: true,
  receiverRole: 'active' as const,
  lastSeenOwnMarkerPk: null,
  updatedAt: NOW,
};

/** In-memory stand-in for the rows this flow reads and writes. */
type Db = {
  links: Map<string, LinkRecord>;
  requests: Map<string, MessageRequest>;
  streamItems: LinkStreamItem[];
  linkMessages: LinkMessage[];
  channels: Map<string, GroupChannel>;
  members: Map<string, GroupMember>;
  groupMessages: GroupMessage[];
  seenEvents: Set<string>;
  deferred: GroupDeferredEvent[];
};

let db: Db;
/** The store owns stream-item ids so the processed flag has a unique key. */
let streamItemSeq = 0;
let groupNotifications: Array<{ ownerPubky: string; channelId: string }>;
let unsubscribeGroupEvents: () => void;

function memberKey(channelId: string, memberPubky: string): string {
  return `${channelId}|${memberPubky}`;
}

function groupEventKey(channelId: string, senderPubky: string, eventId: string): string {
  return `${channelId}|${senderPubky}|${eventId}`;
}

function parseSeenKey(key: string): { channelId: string; sender: string; eventId: string } {
  const parts = key.split('|');
  return { channelId: parts[0] ?? '', sender: parts[1] ?? '', eventId: parts[2] ?? '' };
}

function establishedLink(): LinkRecord {
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

function membershipCreateJson(name: string): string {
  return buildGroupMembershipEnvelope({
    channelId: CHANNEL_ID,
    eventId: CREATE_EVENT_ID,
    sentAt: NOW,
    op: 'create',
    name,
    members: [OWNER, PEER],
  }).json;
}

function groupMessageJson(body: string): string {
  return buildGroupMessageEnvelope({
    channelId: CHANNEL_ID,
    eventId: MESSAGE_EVENT_ID,
    sentAt: NOW + 1,
    body,
  }).json;
}

function wireInMemoryStorage(): void {
  mockedStorage.getLinkReceiver.mockResolvedValue(receiverRow);
  mockedStorage.clearAccountData.mockResolvedValue(undefined);
  mockedStorage.listDeliveryQueue.mockResolvedValue([]);
  mockedStorage.getHandshakeBudget.mockResolvedValue(null);
  mockedStorage.upsertHandshakeBudget.mockResolvedValue(undefined);
  mockedStorage.clearHandshakeBudget.mockResolvedValue(undefined);
  mockedStorage.hasQueueItem.mockResolvedValue(false);
  mockedStorage.listBlockedPeers.mockResolvedValue([]);
  mockedStorage.listBlockedPeerCleanupPending.mockResolvedValue([]);

  mockedStorage.upsertLink.mockImplementation(async record => {
    db.links.set(record.peerPubky, {
      ...record,
      createdAt: record.createdAt ?? NOW,
      updatedAt: NOW,
    });
  });
  mockedStorage.getLink.mockImplementation(async (_owner, peerPubky) => {
    return db.links.get(peerPubky) ?? null;
  });
  mockedStorage.getAllLinks.mockImplementation(async () => [...db.links.values()]);
  mockedStorage.recordLastSeenPeerMarkerPk.mockImplementation(async (_owner, peerPubky, pk) => {
    const row = db.links.get(peerPubky);
    if (row) db.links.set(peerPubky, { ...row, lastSeenPeerMarkerPk: pk });
  });
  mockedStorage.updateLinkSnapshot.mockImplementation(
    async (_owner, peerPubky, snapshot, status) => {
      const existing = db.links.get(peerPubky);
      if (existing) db.links.set(peerPubky, { ...existing, snapshot, status });
    },
  );
  mockedStorage.deleteLink.mockImplementation(async (_owner, peerPubky) => {
    db.links.delete(peerPubky);
  });
  mockedStorage.resetLinkConsecutiveFailures.mockResolvedValue(undefined);

  mockedStorage.getMessageRequest.mockImplementation(async (_owner, peerPubky) => {
    return db.requests.get(peerPubky) ?? null;
  });
  mockedStorage.upsertMessageRequest.mockImplementation(async request => {
    db.requests.set(request.peerPubky, request);
  });

  mockedStorage.saveLinkStreamItems.mockImplementation(async items => {
    for (const item of items) {
      streamItemSeq += 1;
      db.streamItems.push({ ...item, id: `stream-${streamItemSeq}`, processed: false });
    }
  });
  mockedStorage.getUnprocessedLinkStreamItems.mockImplementation(async (_owner, peerPubky) =>
    db.streamItems.filter(item => item.peerPubky === peerPubky && !item.processed),
  );
  mockedStorage.markLinkStreamItemProcessed.mockImplementation(async id => {
    const item = db.streamItems.find(row => row.id === id);
    if (item) item.processed = true;
  });
  mockedStorage.settleExcessUnprocessedLinkStreamItems.mockImplementation(
    async (
      _owner,
      peerPubky,
      keepOldestGroup = LINK_HELD_UNPROCESSED_CAP_PER_PEER,
      keepOldestOther = LINK_HELD_NON_GROUP_CAP_PER_PEER,
    ) => {
      const unprocessed = db.streamItems.filter(
        item => item.peerPubky === peerPubky && !item.processed,
      );
      const group: LinkStreamItem[] = [];
      const other: LinkStreamItem[] = [];
      for (const item of unprocessed) {
        const kind = peekEnvelopeKind(item.rawJson) ?? item.kind;
        if (kind !== null && isGroupWireKind(kind)) group.push(item);
        else other.push(item);
      }
      const excess = [...group.slice(keepOldestGroup), ...other.slice(keepOldestOther)];
      for (const item of excess) item.processed = true;
      return excess.length;
    },
  );
  mockedStorage.deleteLinkStreamItemsForPeer.mockImplementation(async (_owner, peerPubky) => {
    db.streamItems = db.streamItems.filter(item => item.peerPubky !== peerPubky);
  });
  mockedStorage.deleteLinkMessagesForPeer.mockImplementation(async (_owner, peerPubky) => {
    db.linkMessages = db.linkMessages.filter(row => row.peerPubky !== peerPubky);
  });
  mockedStorage.saveLinkMessage.mockImplementation(async row => {
    db.linkMessages.push(row);
  });
  mockedStorage.hasLinkMessage.mockImplementation(async (_owner, peerPubky, kind, eventId) =>
    db.linkMessages.some(
      row => row.peerPubky === peerPubky && row.kind === kind && row.eventId === eventId,
    ),
  );
  mockedStorage.countLinkMessagesForPeer.mockImplementation(
    async (_owner, peerPubky) => db.linkMessages.filter(row => row.peerPubky === peerPubky).length,
  );

  mockedStorage.getContact.mockResolvedValue(null);
  mockedStorage.getAllContacts.mockResolvedValue([]);

  mockedStorage.hasGroupEvent.mockImplementation(async (_owner, channelId, sender, eventId) => {
    if (db.seenEvents.has(groupEventKey(channelId, sender, eventId))) return true;
    if (
      db.deferred.some(
        ev => ev.channelId === channelId && ev.senderPubky === sender && ev.eventId === eventId,
      )
    ) {
      return true;
    }
    return db.groupMessages.some(
      row => row.channelId === channelId && row.senderPubky === sender && row.eventId === eventId,
    );
  });
  mockedStorage.markGroupEventSeen.mockImplementation(
    async (_owner, channelId, sender, eventId) => {
      db.seenEvents.add(groupEventKey(channelId, sender, eventId));
    },
  );
  mockedStorage.getGroupChannel.mockImplementation(
    async (_owner, channelId) => db.channels.get(channelId) ?? null,
  );
  mockedStorage.insertInboundPrivateCreate.mockImplementation(async ({ channel, members }) => {
    if (db.channels.has(channel.channelId)) return 'exists';
    db.channels.set(channel.channelId, channel);
    for (const member of members) {
      db.members.set(memberKey(member.channelId, member.memberPubky), member);
    }
    return 'inserted';
  });
  mockedStorage.updateGroupChannelName.mockImplementation(async (_owner, channelId, name) => {
    const channel = db.channels.get(channelId);
    if (channel) db.channels.set(channelId, { ...channel, name });
  });
  mockedStorage.touchGroupChannel.mockImplementation(async (_owner, channelId, lastMessageAt) => {
    const channel = db.channels.get(channelId);
    if (channel) db.channels.set(channelId, { ...channel, lastMessageAt });
  });
  mockedStorage.bumpGroupMembershipEpoch.mockImplementation(async (_owner, channelId) => {
    const channel = db.channels.get(channelId);
    if (!channel) return 0;
    const membershipEpoch = channel.membershipEpoch + 1;
    db.channels.set(channelId, { ...channel, membershipEpoch });
    return membershipEpoch;
  });
  mockedStorage.getGroupMember.mockImplementation(
    async (_owner, channelId, memberPubky) =>
      db.members.get(memberKey(channelId, memberPubky)) ?? null,
  );
  mockedStorage.upsertGroupMember.mockImplementation(async member => {
    db.members.set(memberKey(member.channelId, member.memberPubky), member);
  });
  mockedStorage.saveGroupMessage.mockImplementation(async message => {
    db.groupMessages.push(message);
    return true;
  });
  mockedStorage.getGroupMessage.mockImplementation(
    async (_owner, channelId, senderPubky, eventId) =>
      db.groupMessages.find(
        row =>
          row.channelId === channelId && row.senderPubky === senderPubky && row.eventId === eventId,
      ) ?? null,
  );
  mockedStorage.findGroupMessageByAuthorEvent.mockResolvedValue(null);
  mockedStorage.saveGroupDeferred.mockImplementation(async event => {
    const exists = db.deferred.some(
      ev =>
        ev.channelId === event.channelId &&
        ev.senderPubky === event.senderPubky &&
        ev.eventId === event.eventId,
    );
    if (!exists) db.deferred.push(event);
  });
  mockedStorage.listGroupDeferredForTarget.mockImplementation(
    async (_owner, channelId, targetAuthorPubky, targetEventId) =>
      db.deferred.filter(
        ev =>
          ev.channelId === channelId &&
          ev.targetAuthorPubky === targetAuthorPubky &&
          ev.targetEventId === targetEventId,
      ),
  );
  mockedStorage.deleteGroupDeferred.mockImplementation(
    async (_owner, channelId, sender, eventId) => {
      db.deferred = db.deferred.filter(
        ev => !(ev.channelId === channelId && ev.senderPubky === sender && ev.eventId === eventId),
      );
    },
  );
  mockedStorage.deleteGroupDeferredForSender.mockImplementation(async (_owner, senderPubky) => {
    db.deferred = db.deferred.filter(ev => ev.senderPubky !== senderPubky);
  });
  mockedStorage.deleteGroupSeenEventsForSender.mockImplementation(async (_owner, senderPubky) => {
    const next = new Set<string>();
    for (const key of db.seenEvents) {
      if (parseSeenKey(key).sender !== senderPubky) next.add(key);
    }
    db.seenEvents = next;
  });
}

describe('group accept gate', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    FollowsImportSettings.resetForTests();
    streamItemSeq = 0;
    db = {
      links: new Map(),
      requests: new Map(),
      streamItems: [],
      linkMessages: [],
      channels: new Map(),
      members: new Map(),
      groupMessages: [],
      seenEvents: new Set(),
      deferred: [],
    };
    groupNotifications = [];
    unsubscribeGroupEvents = subscribeGroupEvents((ownerPubky, channelId) => {
      groupNotifications.push({ ownerPubky, channelId });
    });

    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.signinWithSecret.mockResolvedValue({ sessionAlias: SESSION_ALIAS, pubky: OWNER });
    mockedNative.adoptAuthSession.mockResolvedValue(undefined);
    mockedNative.signOutSession.mockResolvedValue(undefined);
    mockedNative.clearAllNativeSecrets.mockResolvedValue(undefined);
    mockedNative.removeReceiverMarker.mockResolvedValue(undefined);
    mockedNative.closeLink.mockResolvedValue(undefined);
    mockedNative.clearLinkOutbox.mockResolvedValue(0);
    mockedNative.restoreLink.mockResolvedValue({ linkId: 'restored-1' });
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
    mockedRetryQueue.getDue.mockResolvedValue([]);
    wireInMemoryStorage();

    await LinkService.clearSession();
    mockedKeyStore.clearSignOutIncomplete();
    await mockedStorage.clearSignOutIncompleteJournal();
    await LinkService.signinWithSecret('signin-secret-hex');
  });

  afterEach(() => {
    unsubscribeGroupEvents();
    jest.restoreAllMocks();
  });

  function deliverOnce(rawJsonBatch: string[], claimedKind?: string): void {
    mockedNative.receivePrivateMessages.mockReset();
    mockedNative.receivePrivateMessages
      .mockResolvedValueOnce({
        messages: rawJsonBatch.map(rawJson => ({
          version: 1,
          kind: claimedKind ?? (JSON.parse(rawJson).kind as string),
          rawJson,
        })),
        snapshot: 'est-in',
      })
      .mockResolvedValue({ messages: [], snapshot: 'est-in' });
  }

  function seedSharedChannel(memberPubkys: string[]): void {
    db.channels.set(CHANNEL_ID, {
      ownerPubky: OWNER,
      channelId: CHANNEL_ID,
      name: 'shared',
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: OWNER,
      isPublic: false,
      lastMessageAt: null,
      membershipEpoch: 0,
    });
    for (const memberPubky of memberPubkys) {
      db.members.set(memberKey(CHANNEL_ID, memberPubky), {
        ownerPubky: OWNER,
        channelId: CHANNEL_ID,
        memberPubky,
        role: memberPubky === OWNER ? 'admin' : 'member',
        addedAt: NOW,
        removedAt: null,
        status: 'active',
      });
    }
  }

  it('does not let a pending peer create a channel, roster row, or notification', async () => {
    deliverOnce([membershipCreateJson('attacker-group')]);

    const received = await LinkService.syncInbox([PEER]);

    expect(received).toEqual([]);
    expect(db.requests.get(PEER)?.status).toBe('pending');
    expect(mockedStorage.insertInboundPrivateCreate).not.toHaveBeenCalled();
    expect([...db.channels.keys()]).toEqual([]);
    expect([...db.members.keys()]).toEqual([]);
    expect(db.groupMessages).toEqual([]);
    expect(groupNotifications).toEqual([]);
    // Deferred, not dropped: the row stays unprocessed for accept to replay.
    expect(db.streamItems.filter(item => !item.processed)).toHaveLength(1);
    expect([...db.seenEvents]).toEqual([]);
  });

  it('replays deferred group ops in arrival order once the peer is accepted', async () => {
    deliverOnce([membershipCreateJson('held-group'), groupMessageJson('hello group')]);
    await LinkService.syncInbox([PEER]);

    expect(db.channels.size).toBe(0);
    expect(db.streamItems.filter(item => !item.processed)).toHaveLength(2);

    await LinkService.acceptMessageRequest(PEER);

    expect(db.requests.get(PEER)?.status).toBe('accepted');
    const channel = db.channels.get(CHANNEL_ID);
    expect(channel?.name).toBe('held-group');
    expect(channel?.createdBy).toBe(PEER);
    expect(db.members.get(memberKey(CHANNEL_ID, OWNER))?.status).toBe('active');
    expect(db.members.get(memberKey(CHANNEL_ID, PEER))?.role).toBe('admin');
    expect(db.groupMessages.map(row => row.eventId)).toEqual([CREATE_EVENT_ID, MESSAGE_EVENT_ID]);
    expect(db.groupMessages[1]?.body).toBe('hello group');
    expect(db.streamItems.filter(item => !item.processed)).toHaveLength(0);
    expect(groupNotifications).not.toEqual([]);
  });

  it('discards deferred group ops on decline and leaves no group rows', async () => {
    deliverOnce([membershipCreateJson('attacker-group'), groupMessageJson('spam body')]);
    await LinkService.syncInbox([PEER]);
    expect(db.streamItems).toHaveLength(2);

    await LinkService.declineMessageRequest(PEER);

    expect(db.requests.get(PEER)?.status).toBe('declined');
    expect(db.streamItems).toEqual([]);
    expect([...db.channels.keys()]).toEqual([]);
    expect([...db.members.keys()]).toEqual([]);
    expect(db.groupMessages).toEqual([]);
    expect([...db.seenEvents]).toEqual([]);
    expect(groupNotifications).toEqual([]);

    // Decline is terminal: a re-probe must not resurrect the deferred ops.
    deliverOnce([membershipCreateJson('attacker-group')]);
    await LinkService.syncInbox([PEER]);

    expect([...db.channels.keys()]).toEqual([]);
    expect(db.streamItems).toEqual([]);
  });

  it('still applies an accepted peer create exactly as before', async () => {
    db.links.set(PEER, establishedLink());
    db.requests.set(PEER, {
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'accepted',
    });
    deliverOnce([membershipCreateJson('accepted-group')]);

    await LinkService.syncInbox([PEER]);

    const channel = db.channels.get(CHANNEL_ID);
    expect(channel?.name).toBe('accepted-group');
    expect(channel?.createdBy).toBe(PEER);
    expect(channel?.isPublic).toBe(false);
    expect(db.members.get(memberKey(CHANNEL_ID, OWNER))?.role).toBe('member');
    expect(db.members.get(memberKey(CHANNEL_ID, PEER))?.role).toBe('admin');
    expect(db.groupMessages.map(row => row.eventId)).toEqual([CREATE_EVENT_ID]);
    expect(db.streamItems.filter(item => !item.processed)).toHaveLength(0);
    expect(groupNotifications).toEqual([{ ownerPubky: OWNER, channelId: CHANNEL_ID }]);
  });

  it('applies a pending co-member message on a locally known channel', async () => {
    seedSharedChannel([OWNER, PEER]);
    deliverOnce([groupMessageJson('co-member hello')]);

    await LinkService.syncInbox([PEER]);

    expect(db.requests.get(PEER)?.status).toBe('pending');
    expect(db.groupMessages.map(row => row.body)).toEqual(['co-member hello']);
    expect(db.groupMessages[0]?.senderPubky).toBe(PEER);
    expect(db.streamItems.filter(item => !item.processed)).toHaveLength(0);
    expect(db.streamItems.every(item => item.processed)).toBe(true);
    expect(groupNotifications).toEqual([{ ownerPubky: OWNER, channelId: CHANNEL_ID }]);
  });

  it('on decline drops deferred and seen from that sender but keeps persisted group messages', async () => {
    seedSharedChannel([OWNER, PEER, OTHER]);
    db.links.set(OTHER, { ...establishedLink(), peerPubky: OTHER, role: 'initiator' });
    db.requests.set(OTHER, {
      ownerPubky: OWNER,
      peerPubky: OTHER,
      createdAt: NOW,
      updatedAt: NOW,
      status: 'accepted',
    });
    const reactionJson = buildGroupReactionEnvelope({
      channelId: CHANNEL_ID,
      eventId: REACTION_EVENT_ID,
      targetEventId: OTHER_TARGET_EVENT_ID,
      targetAuthorPubky: OTHER,
      emoji: '👍',
      sentAt: NOW + 1,
    }).json;

    deliverOnce([groupMessageJson('already in history'), reactionJson]);
    await LinkService.syncInbox([PEER]);

    expect(db.groupMessages.some(row => row.body === 'already in history')).toBe(true);
    expect(db.deferred).toHaveLength(1);
    expect(db.deferred[0]?.senderPubky).toBe(PEER);
    expect(db.deferred[0]?.eventId).toBe(REACTION_EVENT_ID);

    await LinkService.declineMessageRequest(PEER);

    expect(db.requests.get(PEER)?.status).toBe('declined');
    expect(db.deferred).toEqual([]);
    expect([...db.seenEvents].every(key => parseSeenKey(key).sender !== PEER)).toBe(true);
    expect(
      db.groupMessages.some(row => row.body === 'already in history' && row.senderPubky === PEER),
    ).toBe(true);

    deliverOnce([
      buildGroupMessageEnvelope({
        channelId: CHANNEL_ID,
        eventId: OTHER_TARGET_EVENT_ID,
        sentAt: NOW + 2,
        body: 'target from other',
      }).json,
    ]);
    await LinkService.syncInbox([OTHER]);

    expect(db.groupMessages.some(row => row.body === 'target from other')).toBe(true);
    expect(db.groupMessages.some(row => row.eventId === REACTION_EVENT_ID)).toBe(false);
    expect(db.groupMessages.filter(row => row.kind === GROUP_REACTION_KIND)).toEqual([]);
  });

  it('caps held unprocessed items per peer and still replays an earlier legitimate batch on accept', async () => {
    deliverOnce([membershipCreateJson('held-group'), groupMessageJson('hello group')]);
    await LinkService.syncInbox([PEER]);
    expect(db.streamItems.filter(item => !item.processed)).toHaveLength(2);

    const flood: string[] = [];
    for (let i = 0; i < LINK_HELD_UNPROCESSED_CAP_PER_PEER + 5; i += 1) {
      const localId = `00000000-0000-4000-8000-${(0xbbbb + i).toString(16).padStart(12, '0')}`;
      const eventId = `00000000-0000-4000-8000-${(0xcccc + i).toString(16).padStart(12, '0')}`;
      flood.push(
        buildGroupMembershipEnvelope({
          channelId: `${PEER}:${localId}`,
          eventId,
          sentAt: NOW + 10 + i,
          op: 'create',
          name: `flood-${i}`,
          members: [OWNER, PEER],
        }).json,
      );
    }
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    deliverOnce(flood);
    await LinkService.syncInbox([PEER]);

    const unprocessed = db.streamItems.filter(item => !item.processed);
    expect(unprocessed).toHaveLength(LINK_HELD_UNPROCESSED_CAP_PER_PEER);
    expect(unprocessed[0]?.rawJson).toContain('held-group');
    expect(unprocessed[1]?.rawJson).toContain('hello group');
    expect(db.channels.size).toBe(0);
    expect(
      warn.mock.calls.some(
        args =>
          typeof args[0] === 'string' &&
          args[0].includes('excess held stream item') &&
          !args[0].includes(PEER),
      ),
    ).toBe(true);

    await LinkService.acceptMessageRequest(PEER);

    expect(db.channels.get(CHANNEL_ID)?.name).toBe('held-group');
    expect(db.groupMessages.some(row => row.body === 'hello group')).toBe(true);
    // Cap kept 66 rows: the original create+message plus 64 flood creates.
    expect(db.channels.size).toBe(LINK_HELD_UNPROCESSED_CAP_PER_PEER - 1);
  });

  it('does not let a held 1:1 flood evict a later group invite', async () => {
    const dms: string[] = [];
    for (let i = 0; i < LINK_HELD_NON_GROUP_CAP_PER_PEER + 5; i += 1) {
      const eventId = `00000000-0000-4000-8000-${(0xdddd + i).toString(16).padStart(12, '0')}`;
      dms.push(
        buildChatMessageEnvelope({
          eventId,
          sentAt: NOW + i,
          body: `dm-${i}`,
        }).json,
      );
    }
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    deliverOnce(dms);
    await LinkService.syncInbox([PEER]);

    deliverOnce([membershipCreateJson('held-group')]);
    await LinkService.syncInbox([PEER]);

    const unprocessed = db.streamItems.filter(item => !item.processed);
    const heldDms = unprocessed.filter(item => item.kind === CHAT_MESSAGE_KIND);
    const heldGroup = unprocessed.filter(item => item.kind !== null && isGroupWireKind(item.kind));
    expect(heldDms).toHaveLength(LINK_HELD_NON_GROUP_CAP_PER_PEER);
    expect(heldDms[0]?.rawJson).toContain('dm-0');
    expect(heldGroup).toHaveLength(1);
    expect(heldGroup[0]?.rawJson).toContain('held-group');
    expect(db.channels.size).toBe(0);

    await LinkService.acceptMessageRequest(PEER);

    expect(db.channels.get(CHANNEL_ID)?.name).toBe('held-group');
    expect(db.linkMessages.filter(row => row.body.startsWith('dm-'))).toHaveLength(
      LINK_HELD_NON_GROUP_CAP_PER_PEER,
    );
    expect(db.linkMessages.some(row => row.body === 'dm-0')).toBe(true);
    expect(
      db.linkMessages.some(row => row.body === `dm-${LINK_HELD_NON_GROUP_CAP_PER_PEER + 4}`),
    ).toBe(false);
  });

  it('does not let a mislabeled 1:1 flood consume the group-replay budget', async () => {
    const decoys: string[] = [];
    for (let i = 0; i < LINK_HELD_UNPROCESSED_CAP_PER_PEER + 5; i += 1) {
      const eventId = `00000000-0000-4000-8000-${(0xeeee + i).toString(16).padStart(12, '0')}`;
      decoys.push(
        buildChatMessageEnvelope({
          eventId,
          sentAt: NOW + i,
          body: `decoy-${i}`,
        }).json,
      );
    }
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    deliverOnce(decoys, GROUP_MEMBERSHIP_KIND);
    await LinkService.syncInbox([PEER]);

    deliverOnce([membershipCreateJson('held-group')]);
    await LinkService.syncInbox([PEER]);

    const unprocessed = db.streamItems.filter(item => !item.processed);
    expect(unprocessed.some(item => item.rawJson.includes('held-group'))).toBe(true);
    expect(db.channels.size).toBe(0);

    await LinkService.acceptMessageRequest(PEER);

    expect(db.channels.get(CHANNEL_ID)?.name).toBe('held-group');
  });
});
