jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the GroupService test');
  },
}));

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { LinkService } from '../../link/LinkService';
import { PubkyService } from '../../PubkyService';
import { applyGroupInbound } from '../applyGroupInbound';
import { GroupService } from '../GroupService';
import { PRIVATE_GROUP_MEMBER_CAP } from '../../../flags/config';
import {
  GROUP_MESSAGE_KIND,
  PUBLIC_CHANNEL_MESSAGE_KIND,
  buildGroupDeleteEnvelope,
  buildGroupEditEnvelope,
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildGroupReactionEnvelope,
  decodePublicChannelMeta,
} from '../../../types/group';

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
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
  let seq = 0;
  return {
    v4: () => {
      seq += 1;
      return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
    },
  };
});

const mockedKeyStore = jest.mocked(KeyStore);
const mockedLink = jest.mocked(LinkService);
const mockedPubky = jest.mocked(PubkyService);

const OWNER = 'a'.repeat(52);
const PEER_A = 'b'.repeat(52);
const PEER_B = 'c'.repeat(52);
const PEER_C = 'd'.repeat(52);
const STRANGER = 'e'.repeat(52);
const EVENT = '00000000-0000-4000-8000-000000000001';
const EVENT2 = '00000000-0000-4000-8000-000000000002';
const EVENT3 = '00000000-0000-4000-8000-000000000003';
const NOW = 1_700_000_000_000;

describe('GroupService', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedLink.sendPersistedLinkJson.mockImplementation(async input => {
      await StorageService.removeFromQueue(input.queueId);
      return 'sent';
    });
    mockedPubky.put.mockResolvedValue(undefined);
    mockedPubky.get.mockResolvedValue(null);
    mockedPubky.list.mockResolvedValue({ ok: true, urls: [] });
  });

  afterEach(() => {
    setDbForTests(null);
    jest.restoreAllMocks();
  });

  async function createPrivateGroup(): Promise<string> {
    const channel = await GroupService.createChannel('Crew', [PEER_A, PEER_B]);
    expect(channel.channelId.startsWith(`${OWNER}:`)).toBe(true);
    return channel.channelId;
  }

  it('fans out a group message to every active member and skips removed members', async () => {
    const channelId = await createPrivateGroup();
    mockedLink.sendPersistedLinkJson.mockClear();

    await GroupService.removeMember(channelId, PEER_B);
    const removePeers = mockedLink.sendPersistedLinkJson.mock.calls.map(call => call[0]!.peerPubky);
    expect(removePeers).toContain(PEER_B);
    mockedLink.sendPersistedLinkJson.mockClear();

    await GroupService.sendGroupMessage(channelId, 'hello all');

    const peers = mockedLink.sendPersistedLinkJson.mock.calls.map(call => call[0]!.peerPubky);
    expect(peers).toContain(PEER_A);
    expect(peers).not.toContain(PEER_B);
    expect(peers).not.toContain(OWNER);
    const stored = await StorageService.listGroupMessages(OWNER, channelId);
    const chat = stored.find(m => m.kind === GROUP_MESSAGE_KIND);
    expect(chat?.body).toBe('hello all');
  });

  it('applies a membership op from an admin and rejects one from a non-admin', async () => {
    const channelId = await createPrivateGroup();

    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupMembershipEnvelope({
        channelId,
        eventId: EVENT,
        sentAt: NOW + 1,
        op: 'add',
        subjectPubky: PEER_C,
      }).envelope,
      rawJson: '{}',
      receivedAt: NOW + 1,
    });
    expect(await StorageService.getGroupMember(OWNER, channelId, PEER_C)).toBeNull();

    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: OWNER,
      envelope: buildGroupMembershipEnvelope({
        channelId,
        eventId: EVENT2,
        sentAt: NOW + 2,
        op: 'add',
        subjectPubky: PEER_C,
      }).envelope,
      rawJson: '{}',
      receivedAt: NOW + 2,
    });
    expect(await StorageService.getGroupMember(OWNER, channelId, PEER_C)).toEqual(
      expect.objectContaining({ status: 'active', memberPubky: PEER_C }),
    );
  });

  it('rejects edit and delete from a non-author', async () => {
    const channelId = await createPrivateGroup();
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupMessageEnvelope({
        channelId,
        eventId: EVENT,
        sentAt: NOW,
        body: 'original',
      }).envelope,
      rawJson: '{}',
      receivedAt: NOW,
    });

    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_B,
      envelope: buildGroupEditEnvelope({
        channelId,
        eventId: EVENT2,
        targetEventId: EVENT,
        targetAuthorPubky: PEER_A,
        body: 'hijack',
        sentAt: NOW + 1,
      }).envelope,
      rawJson: '{}',
      receivedAt: NOW + 1,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_B,
      envelope: buildGroupDeleteEnvelope({
        channelId,
        eventId: EVENT3,
        targetEventId: EVENT,
        targetAuthorPubky: PEER_A,
        sentAt: NOW + 2,
      }).envelope,
      rawJson: '{}',
      receivedAt: NOW + 2,
    });

    const original = await StorageService.getGroupMessage(OWNER, channelId, PEER_A, EVENT);
    expect(original?.body).toBe('original');
    expect(original?.deleted).toBe(false);
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_B, EVENT2)).toBe(false);
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_B, EVENT3)).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_B, EVENT2)).toBe(true);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_B, EVENT3)).toBe(true);
  });

  it('defers reaction, edit, and delete that reference an unknown target instead of dropping them', async () => {
    const channelId = await createPrivateGroup();
    const EVENT4 = '00000000-0000-4000-8000-000000000004';
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupReactionEnvelope({
        channelId,
        eventId: EVENT,
        targetEventId: EVENT2,
        targetAuthorPubky: PEER_A,
        emoji: '👍',
        sentAt: NOW,
      }).envelope,
      rawJson: '{}',
      receivedAt: NOW,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupEditEnvelope({
        channelId,
        eventId: EVENT3,
        targetEventId: EVENT2,
        targetAuthorPubky: PEER_A,
        body: 'later',
        sentAt: NOW + 1,
      }).envelope,
      rawJson: '{}',
      receivedAt: NOW + 1,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupDeleteEnvelope({
        channelId,
        eventId: EVENT4,
        targetEventId: EVENT2,
        targetAuthorPubky: PEER_A,
        sentAt: NOW + 2,
      }).envelope,
      rawJson: '{}',
      receivedAt: NOW + 2,
    });

    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, EVENT)).toBe(false);
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, EVENT3)).toBe(false);
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, EVENT4)).toBe(false);
    expect(await StorageService.getGroupMessage(OWNER, channelId, PEER_A, EVENT2)).toBeNull();
    const deferred = await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER_A);
    expect(deferred.map(d => d.kind).sort()).toEqual(
      ['chat.group.delete.v0', 'chat.group.edit.v0', 'chat.group.reaction.v0'].sort(),
    );

    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupMessageEnvelope({
        channelId,
        eventId: EVENT2,
        sentAt: NOW + 3,
        body: 'original',
      }).envelope,
      rawJson: '{}',
      receivedAt: NOW + 3,
    });
    const arrived = await StorageService.getGroupMessage(OWNER, channelId, PEER_A, EVENT2);
    expect(arrived?.body).toBe('later');
    expect(arrived?.editedAt).toBe(NOW + 1);
    expect(arrived?.deleted).toBe(true);
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, EVENT)).toBe(true);
    expect(await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER_A)).toEqual([]);
  });

  it('dedups group messages by (owner, channel_id, sender_pubky, event_id)', async () => {
    const channelId = await createPrivateGroup();
    const envelope = buildGroupMessageEnvelope({
      channelId,
      eventId: EVENT,
      sentAt: NOW,
      body: 'once',
    }).envelope;
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope,
      rawJson: '{"n":1}',
      receivedAt: NOW,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope,
      rawJson: '{"n":2}',
      receivedAt: NOW + 5,
    });
    const rows = (await StorageService.listGroupMessages(OWNER, channelId)).filter(
      m => m.kind === GROUP_MESSAGE_KIND && m.eventId === EVENT,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawJson).toBe('{"n":1}');
  });

  it('enqueues retry for a failed member without dropping the message or other sends', async () => {
    const channelId = await createPrivateGroup();
    mockedLink.sendPersistedLinkJson.mockImplementation(async input => {
      if (input.peerPubky === PEER_B) throw new Error('homeserver down');
      await StorageService.removeFromQueue(input.queueId);
      return 'sent';
    });

    const message = await GroupService.sendGroupMessage(channelId, 'partial');
    expect(message.body).toBe('partial');
    expect(await StorageService.getGroupMessage(OWNER, channelId, OWNER, message.eventId)).toEqual(
      expect.objectContaining({ body: 'partial' }),
    );
    const queued = await StorageService.listDeliveryQueue();
    expect(queued.some(item => item.recipientPubky === PEER_B)).toBe(true);
    expect(queued.some(item => item.recipientPubky === PEER_A)).toBe(false);
    expect(mockedLink.sendPersistedLinkJson).toHaveBeenCalledWith(
      expect.objectContaining({ peerPubky: PEER_A }),
    );
  });

  it('enforces the 50-member cap on create and add', async () => {
    const extras = Array.from({ length: PRIVATE_GROUP_MEMBER_CAP }, (_, i) => fakePubky(i + 20));
    await expect(GroupService.createChannel('Too big', extras)).rejects.toThrow(/50/);

    const channelId = await createPrivateGroup();
    const active = await StorageService.countActiveGroupMembers(OWNER, channelId);
    for (let i = 0; i < PRIVATE_GROUP_MEMBER_CAP - active; i += 1) {
      await StorageService.upsertGroupMember({
        ownerPubky: OWNER,
        channelId,
        memberPubky: fakePubky(i + 200),
        role: 'member',
        addedAt: NOW,
        removedAt: null,
        status: 'active',
      });
    }
    await expect(GroupService.addMember(channelId, STRANGER)).rejects.toThrow(/50/);
  });

  it('publishes and reads a public channel and joins by id', async () => {
    const files = new Map<string, string>();
    mockedPubky.put.mockImplementation(async (url, content) => {
      files.set(url, content);
    });
    mockedPubky.get.mockImplementation(async url => files.get(url) ?? null);
    mockedPubky.list.mockImplementation(async prefix => ({
      ok: true,
      urls: [...files.keys()].filter(url => url.startsWith(prefix)),
    }));

    const created = await GroupService.createPublicChannel('Town square');
    expect(created.channelId.startsWith(`${OWNER}:`)).toBe(true);
    const metaUrl = [...files.keys()].find(url => url.endsWith('meta.json'));
    expect(metaUrl).toBeDefined();
    expect(decodePublicChannelMeta(files.get(metaUrl!)!)).toEqual(
      expect.objectContaining({ name: 'Town square', created_by: OWNER }),
    );

    const sent = await GroupService.sendPublicMessage(created.channelId, 'hello public');
    expect(sent.kind).toBe(PUBLIC_CHANNEL_MESSAGE_KIND);
    expect(sent.body).toBe('hello public');

    mockedKeyStore.getPubky.mockReturnValue(PEER_A);
    const joined = await GroupService.joinPublicChannel(created.channelId);
    expect(joined).toEqual(
      expect.objectContaining({
        ownerPubky: PEER_A,
        name: 'Town square',
        isPublic: true,
        channelId: created.channelId,
      }),
    );
    const msgs = await GroupService.listMessages(joined.channelId);
    expect(msgs.some(m => m.body === 'hello public' && m.senderPubky === OWNER)).toBe(true);
  });
});

function fakePubky(seed: number): string {
  return `${seed.toString(16).padStart(4, '0')}${'f'.repeat(48)}`.slice(0, 52);
}
