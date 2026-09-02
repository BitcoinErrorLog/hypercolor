jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the adversarial group inbound test');
  },
}));

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { clearPaintedOwner, paintOwner } from '../../paintedOwner';
import { LinkService } from '../../link/LinkService';
import { applyGroupInbound } from '../applyGroupInbound';
import { GroupService } from '../GroupService';
import { GROUP_DEFERRED_QUOTA_PER_SENDER, GROUP_DEFERRED_TTL_MS } from '../../../flags/config';
import {
  GROUP_DELETE_KIND,
  GROUP_EDIT_KIND,
  GROUP_MESSAGE_KIND,
  GROUP_REACTION_KIND,
  buildGroupDeleteEnvelope,
  buildGroupEditEnvelope,
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildGroupReactionEnvelope,
  buildPrivateChannelId,
  decodeGroupEnvelope,
  isGroupTimelineVisible,
} from '../../../types/group';

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../link/LinkService', () => ({
  LinkService: {
    sendPersistedLinkJson: jest.fn(),
  },
}));

jest.mock('../../PubkyService', () => ({
  PubkyService: {
    put: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
  },
}));

jest.mock('uuid', () => {
  let seq = 1000;
  return {
    v4: () => {
      seq += 1;
      return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
    },
  };
});

const mockedKeyStore = jest.mocked(KeyStore);
const mockedLink = jest.mocked(LinkService);

const OWNER = 'a'.repeat(52);
const PEER_A = 'b'.repeat(52);
const PEER_B = 'c'.repeat(52);
const STRANGER = 'e'.repeat(52);
const NOW = 1_700_000_000_000;

function eid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

async function inbound(senderPubky: string, rawJson: string, receivedAt = NOW): Promise<void> {
  const envelope = decodeGroupEnvelope(rawJson);
  if (!envelope) throw new Error(`decode failed: ${rawJson}`);
  await applyGroupInbound({
    ownerPubky: OWNER,
    senderPubky,
    envelope,
    rawJson,
    receivedAt,
    peerTrust: 'accepted',
  });
}

async function historyBodies(channelId: string): Promise<string[]> {
  const rows = await StorageService.listGroupMessages(OWNER, channelId);
  return rows.filter(isGroupTimelineVisible).map(m => m.body);
}

describe('group inbound adversarial', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    paintOwner(OWNER);
    mockedLink.sendPersistedLinkJson.mockImplementation(async input => {
      await StorageService.removeFromQueue(input.queueId);
      return 'sent';
    });
  });

  afterEach(() => {
    setDbForTests(null);
    clearPaintedOwner();
    jest.restoreAllMocks();
  });

  async function createPrivateGroup(members: string[] = [PEER_A, PEER_B]): Promise<string> {
    return (await GroupService.createChannel('Crew', members)).channelId;
  }

  it('rejects a removed-member post: absent from history and cannot occupy a later slot', async () => {
    const channelId = await createPrivateGroup();
    await GroupService.removeMember(channelId, PEER_A);

    await inbound(
      PEER_A,
      buildGroupMessageEnvelope({
        channelId,
        eventId: eid(1),
        sentAt: NOW,
        body: 'ghost',
      }).json,
    );

    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, eid(1))).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_A, eid(1))).toBe(true);
    expect(await historyBodies(channelId)).not.toContain('ghost');

    await inbound(
      PEER_B,
      buildGroupMessageEnvelope({
        channelId,
        eventId: eid(1),
        sentAt: NOW + 1,
        body: 'real',
      }).json,
    );
    expect(await StorageService.getGroupMessage(OWNER, channelId, PEER_B, eid(1))).toEqual(
      expect.objectContaining({ body: 'real' }),
    );
  });

  it('rejects a non-member post: absent from history', async () => {
    const channelId = await createPrivateGroup();
    await inbound(
      STRANGER,
      buildGroupMessageEnvelope({
        channelId,
        eventId: eid(2),
        sentAt: NOW,
        body: 'intruder',
      }).json,
    );
    expect(await StorageService.hasGroupMessage(OWNER, channelId, STRANGER, eid(2))).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, STRANGER, eid(2))).toBe(true);
    expect(await historyBodies(channelId)).not.toContain('intruder');
  });

  it('rejects unknown-channel non-create', async () => {
    const channelId = buildPrivateChannelId(PEER_A, eid(3));
    await inbound(
      PEER_A,
      buildGroupMessageEnvelope({
        channelId,
        eventId: eid(4),
        sentAt: NOW,
        body: 'no such channel',
      }).json,
    );
    expect(await StorageService.getGroupChannel(OWNER, channelId)).toBeNull();
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, eid(4))).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_A, eid(4))).toBe(true);
  });

  it('rejects create preemption by a non-founder', async () => {
    const channelId = buildPrivateChannelId(PEER_A, eid(5));
    await inbound(
      STRANGER,
      buildGroupMembershipEnvelope({
        channelId,
        eventId: eid(6),
        sentAt: NOW,
        op: 'create',
        name: 'Hijacked',
        members: [OWNER, STRANGER],
      }).json,
    );
    expect(await StorageService.getGroupChannel(OWNER, channelId)).toBeNull();
    expect(await StorageService.getGroupMember(OWNER, channelId, STRANGER)).toBeNull();
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, STRANGER, eid(6))).toBe(true);
  });

  it('accepts a founder-bound create from the encoded founder', async () => {
    const channelId = buildPrivateChannelId(PEER_A, eid(7));
    await inbound(
      PEER_A,
      buildGroupMembershipEnvelope({
        channelId,
        eventId: eid(8),
        sentAt: NOW,
        op: 'create',
        name: 'Honest',
        members: [OWNER, PEER_A],
      }).json,
    );
    expect(await StorageService.getGroupChannel(OWNER, channelId)).toEqual(
      expect.objectContaining({ createdBy: PEER_A, name: 'Honest', isPublic: false }),
    );
    expect(await StorageService.getGroupMember(OWNER, channelId, PEER_A)).toEqual(
      expect.objectContaining({ role: 'admin', status: 'active' }),
    );
    expect(await StorageService.getGroupMember(OWNER, channelId, OWNER)).toEqual(
      expect.objectContaining({ role: 'member', status: 'active' }),
    );
  });

  it('does not create dual admins from two concurrent creates', async () => {
    const channelId = buildPrivateChannelId(PEER_A, eid(9));
    const founderCreate = buildGroupMembershipEnvelope({
      channelId,
      eventId: eid(10),
      sentAt: NOW,
      op: 'create',
      name: 'Crew',
      members: [OWNER, PEER_A, PEER_B],
    }).json;
    const attackerCreate = buildGroupMembershipEnvelope({
      channelId,
      eventId: eid(11),
      sentAt: NOW + 1,
      op: 'create',
      name: 'Crew takeover',
      members: [OWNER, PEER_B],
    }).json;

    await Promise.all([inbound(PEER_A, founderCreate), inbound(PEER_B, attackerCreate)]);

    const members = await StorageService.listGroupMembers(OWNER, channelId);
    const admins = members.filter(m => m.role === 'admin' && m.status === 'active');
    expect(admins.map(m => m.memberPubky)).toEqual([PEER_A]);
    expect(await StorageService.getGroupChannel(OWNER, channelId)).toEqual(
      expect.objectContaining({ createdBy: PEER_A, name: 'Crew' }),
    );

    await inbound(
      PEER_A,
      buildGroupMembershipEnvelope({
        channelId,
        eventId: eid(12),
        sentAt: NOW + 2,
        op: 'create',
        name: 'Crew',
        members: [OWNER, PEER_A],
      }).json,
    );
    const adminsAfter = (await StorageService.listGroupMembers(OWNER, channelId)).filter(
      m => m.role === 'admin' && m.status === 'active',
    );
    expect(adminsAfter).toHaveLength(1);
  });

  it('rejects cross-peer event-id poisoning: B cannot suppress A', async () => {
    const channelId = await createPrivateGroup();
    const shared = eid(20);
    await inbound(
      PEER_B,
      buildGroupMessageEnvelope({
        channelId,
        eventId: shared,
        sentAt: NOW,
        body: 'from-b',
      }).json,
    );
    await inbound(
      PEER_A,
      buildGroupMessageEnvelope({
        channelId,
        eventId: shared,
        sentAt: NOW + 1,
        body: 'from-a',
      }).json,
    );

    expect(await StorageService.getGroupMessage(OWNER, channelId, PEER_A, shared)).toEqual(
      expect.objectContaining({ body: 'from-a' }),
    );
    expect(await StorageService.getGroupMessage(OWNER, channelId, PEER_B, shared)).toEqual(
      expect.objectContaining({ body: 'from-b' }),
    );
    const chat = (await StorageService.listGroupMessages(OWNER, channelId)).filter(
      m => m.kind === GROUP_MESSAGE_KIND && m.eventId === shared,
    );
    expect(chat).toHaveLength(2);
  });

  it('rejects a cross-channel target reference', async () => {
    const channelA = await createPrivateGroup();
    const channelB = (await GroupService.createChannel('Other', [PEER_A, PEER_B])).channelId;
    await inbound(
      PEER_A,
      buildGroupMessageEnvelope({
        channelId: channelA,
        eventId: eid(21),
        sentAt: NOW,
        body: 'only in A',
      }).json,
    );

    await inbound(
      PEER_B,
      buildGroupReactionEnvelope({
        channelId: channelB,
        eventId: eid(22),
        targetEventId: eid(21),
        targetAuthorPubky: PEER_A,
        emoji: '👍',
        sentAt: NOW + 1,
      }).json,
    );

    expect(await StorageService.hasGroupMessage(OWNER, channelB, PEER_B, eid(22))).toBe(false);
    expect(await StorageService.listGroupDeferredForSender(OWNER, channelB, PEER_B)).toEqual([]);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelB, PEER_B, eid(22))).toBe(true);
    expect(await StorageService.getGroupMessage(OWNER, channelA, PEER_A, eid(21))).toEqual(
      expect.objectContaining({ body: 'only in A', deleted: false }),
    );
  });

  it('rejects deferred non-author edit and delete', async () => {
    const channelId = await createPrivateGroup();
    await inbound(
      PEER_B,
      buildGroupEditEnvelope({
        channelId,
        eventId: eid(23),
        targetEventId: eid(24),
        targetAuthorPubky: PEER_A,
        body: 'hijack-later',
        sentAt: NOW,
      }).json,
    );
    await inbound(
      PEER_B,
      buildGroupDeleteEnvelope({
        channelId,
        eventId: eid(25),
        targetEventId: eid(24),
        targetAuthorPubky: PEER_A,
        sentAt: NOW + 1,
      }).json,
    );

    expect(await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER_B)).toEqual([]);
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_B, eid(23))).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_B, eid(23))).toBe(true);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_B, eid(25))).toBe(true);

    await inbound(
      PEER_A,
      buildGroupMessageEnvelope({
        channelId,
        eventId: eid(24),
        sentAt: NOW + 2,
        body: 'original',
      }).json,
    );
    expect(await StorageService.getGroupMessage(OWNER, channelId, PEER_A, eid(24))).toEqual(
      expect.objectContaining({ body: 'original', deleted: false, editedAt: null }),
    );
  });

  it('rejects a foreign leave that names someone else', async () => {
    const channelId = await createPrivateGroup();
    await inbound(
      PEER_A,
      buildGroupMembershipEnvelope({
        channelId,
        eventId: eid(26),
        sentAt: NOW,
        op: 'leave',
        subjectPubky: PEER_B,
      }).json,
    );
    expect(await StorageService.getGroupMember(OWNER, channelId, PEER_B)).toEqual(
      expect.objectContaining({ status: 'active' }),
    );
    expect(await StorageService.getGroupMember(OWNER, channelId, PEER_A)).toEqual(
      expect.objectContaining({ status: 'active' }),
    );
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, eid(26))).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_A, eid(26))).toBe(true);
  });

  it('evicts deferred rows beyond per-sender quota and past TTL', async () => {
    const channelId = await createPrivateGroup();
    const targetMissing = eid(200);

    for (let i = 0; i < GROUP_DEFERRED_QUOTA_PER_SENDER + 1; i += 1) {
      await inbound(
        PEER_A,
        buildGroupReactionEnvelope({
          channelId,
          eventId: eid(300 + i),
          targetEventId: targetMissing,
          targetAuthorPubky: PEER_A,
          emoji: '👍',
          sentAt: NOW + i,
        }).json,
        NOW + i,
      );
    }

    const deferred = await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER_A);
    expect(deferred).toHaveLength(GROUP_DEFERRED_QUOTA_PER_SENDER);
    expect(deferred.some(d => d.eventId === eid(300))).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_A, eid(300))).toBe(true);
    expect(deferred.every(d => d.kind === GROUP_REACTION_KIND)).toBe(true);

    const staleId = eid(400);
    await inbound(
      PEER_B,
      buildGroupReactionEnvelope({
        channelId,
        eventId: staleId,
        targetEventId: eid(401),
        targetAuthorPubky: PEER_B,
        emoji: '🔥',
        sentAt: NOW,
      }).json,
      NOW - GROUP_DEFERRED_TTL_MS - 1,
    );
    expect(await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER_B)).toHaveLength(
      1,
    );

    await inbound(
      PEER_B,
      buildGroupReactionEnvelope({
        channelId,
        eventId: eid(402),
        targetEventId: eid(403),
        targetAuthorPubky: PEER_B,
        emoji: '😂',
        sentAt: NOW + 10,
      }).json,
      NOW,
    );
    const leftover = await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER_B);
    expect(leftover.map(d => d.eventId)).toEqual([eid(402)]);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_B, staleId)).toBe(true);
  });

  it('keeps owner-account isolation for seen and deferred rows', async () => {
    const OTHER = 'f'.repeat(52);
    const channelId = buildPrivateChannelId(OWNER, eid(50));
    await StorageService.upsertGroupChannel({
      ownerPubky: OWNER,
      channelId,
      name: 'A',
      createdAt: 1,
      updatedAt: 1,
      createdBy: OWNER,
      isPublic: false,
      lastMessageAt: null,
      membershipEpoch: 0,
    });
    paintOwner(OTHER);
    await StorageService.upsertGroupChannel({
      ownerPubky: OTHER,
      channelId,
      name: 'B',
      createdAt: 1,
      updatedAt: 1,
      createdBy: OTHER,
      isPublic: false,
      lastMessageAt: null,
      membershipEpoch: 0,
    });
    paintOwner(OWNER);
    await StorageService.markGroupEventSeen(OWNER, channelId, PEER_A, eid(51), NOW);
    paintOwner(OTHER);
    await StorageService.markGroupEventSeen(OTHER, channelId, PEER_A, eid(51), NOW);
    paintOwner(OWNER);
    await StorageService.saveGroupDeferred({
      ownerPubky: OWNER,
      channelId,
      senderPubky: PEER_A,
      eventId: eid(52),
      kind: GROUP_EDIT_KIND,
      body: 'a',
      rawJson: '{}',
      sentAt: NOW,
      receivedAt: NOW,
      targetEventId: eid(53),
      targetAuthorPubky: PEER_A,
    });
    paintOwner(OTHER);
    await StorageService.saveGroupDeferred({
      ownerPubky: OTHER,
      channelId,
      senderPubky: PEER_A,
      eventId: eid(52),
      kind: GROUP_DELETE_KIND,
      body: '',
      rawJson: '{}',
      sentAt: NOW,
      receivedAt: NOW,
      targetEventId: eid(53),
      targetAuthorPubky: PEER_A,
    });
    paintOwner(OWNER);

    await StorageService.clearAccountData(OWNER);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_A, eid(51))).toBe(false);
    expect(await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER_A)).toEqual([]);
    expect(await StorageService.hasGroupEventSeen(OTHER, channelId, PEER_A, eid(51))).toBe(true);
    expect(await StorageService.listGroupDeferredForSender(OTHER, channelId, PEER_A)).toHaveLength(
      1,
    );
  });

  it('does not persist a reaction missing target_author_pubky', async () => {
    const channelId = await createPrivateGroup();
    const raw = JSON.stringify({
      version: 1,
      kind: GROUP_REACTION_KIND,
      channel_id: channelId,
      event_id: eid(60),
      target_event_id: eid(61),
      emoji: '👍',
      sent_at: NOW,
    });
    expect(decodeGroupEnvelope(raw)).toBeNull();
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, eid(60))).toBe(false);
  });

  it('refuses a gated create even when applyGroupInbound is called directly', async () => {
    const channelId = `${STRANGER}:00000000-0000-4000-8000-00000000aa99`;
    const built = buildGroupMembershipEnvelope({
      channelId,
      eventId: eid(70),
      sentAt: NOW,
      op: 'create',
      name: 'planted',
      members: [OWNER, STRANGER],
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: STRANGER,
      envelope: built.envelope,
      rawJson: built.json,
      receivedAt: NOW,
      peerTrust: 'gated',
    });
    expect(await StorageService.getGroupChannel(OWNER, channelId)).toBeNull();
  });
});
