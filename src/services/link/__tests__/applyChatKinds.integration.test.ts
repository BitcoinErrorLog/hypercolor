jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in applyChatKinds integration tests');
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecret: jest.fn().mockResolvedValue(true),
  },
}));

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../StorageService';
import { paintOwner } from '../../paintedOwner';
import {
  applyInboundTagOrReceipt,
  applyInboundDelete,
  applyPendingChatDeletesForTarget,
} from '../applyChatKinds';
import {
  CHAT_MESSAGE_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_TAG_KIND,
  buildDmConversationId,
} from '../../../types/link';
import { buildChatReceiptEnvelope, buildChatTagEnvelope } from '../../../types/chatKindValidation';
import { buildPrivateChannelId } from '../../../types/group';

const OWNER = 'a'.repeat(52);
const PEER = 'b'.repeat(52);
const OTHER = 'c'.repeat(52);
const TARGET = '00000000-0000-4000-8000-0000000000aa';
const TAG_EVENT = '00000000-0000-4000-8000-0000000000bb';
const liveDbs: Array<{ close: () => void }> = [];

beforeEach(async () => {
  const db = openMemoryDb();
  liveDbs.push(db);
  setDbForTests(db);
  await runMigrations(db);
  paintOwner(OWNER);
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const db of liveDbs) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  liveDbs.length = 0;
  setDbForTests(null);
});

async function seedDm(conversationPeer: string, sender: string, eventId: string): Promise<void> {
  await StorageService.saveLinkMessage({
    ownerPubky: OWNER,
    eventId,
    conversationId: buildDmConversationId(conversationPeer),
    peerPubky: conversationPeer,
    senderPubky: sender,
    direction: sender === OWNER ? 'sent' : 'received',
    kind: CHAT_MESSAGE_KIND,
    rawJson: '{}',
    body: 'hi',
    sentAt: 10,
    receivedAt: sender === OWNER ? null : 11,
    deliveryState: 'sent',
  });
}

describe('applyChatKinds integration', () => {
  it('rejects a DM tag whose target lives in another thread', async () => {
    await seedDm(OTHER, OWNER, TARGET);
    const built = buildChatTagEnvelope({
      eventId: TAG_EVENT,
      sentAt: 20,
      targetEventId: TARGET,
      targetAuthorPubky: OWNER,
      label: 'ok',
      op: 'add',
    });
    const result = await applyInboundTagOrReceipt({
      ownerPubky: OWNER,
      senderPubky: PEER,
      rawJson: built.json,
      peerTrust: 'accepted',
      kindHint: CHAT_TAG_KIND,
    });
    expect(result).toBe('processed');
    expect(await StorageService.listChatTagsForScope(OWNER, buildDmConversationId(PEER))).toEqual(
      [],
    );
  });

  it('durably defers a DM tag when the target is missing', async () => {
    const built = buildChatTagEnvelope({
      eventId: TAG_EVENT,
      sentAt: 20,
      targetEventId: TARGET,
      targetAuthorPubky: OWNER,
      label: 'ok',
      op: 'add',
    });
    const result = await applyInboundTagOrReceipt({
      ownerPubky: OWNER,
      senderPubky: PEER,
      rawJson: built.json,
      peerTrust: 'accepted',
      kindHint: CHAT_TAG_KIND,
    });
    expect(result).toBe('processed');
    expect(await StorageService.listPendingChatTags(OWNER, PEER, PEER, TARGET)).toHaveLength(1);
    expect(await StorageService.listChatTagsForScope(OWNER, buildDmConversationId(PEER))).toEqual(
      [],
    );
  });

  it('retains a delete that arrives before its target and applies it once', async () => {
    const deleteJson = JSON.stringify({
      version: 1,
      kind: 'chat.delete.v0',
      event_id: '00000000-0000-4000-8000-0000000000cc',
      sent_at: 20,
      target_event_id: TARGET,
    });
    await expect(
      applyInboundDelete({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson: deleteJson,
        peerTrust: 'accepted',
      }),
    ).resolves.toBe('processed');
    expect(await StorageService.listPendingChatDeletes(OWNER, PEER, PEER, TARGET)).toHaveLength(1);

    await seedDm(PEER, PEER, TARGET);
    await applyPendingChatDeletesForTarget({
      ownerPubky: OWNER,
      peerPubky: PEER,
      senderPubky: PEER,
      targetEventId: TARGET,
    });
    const row = await StorageService.getLinkMessageByEventId(OWNER, PEER, TARGET);
    expect(row?.deleted).toBe(true);
    expect(await StorageService.listPendingChatDeletes(OWNER, PEER, PEER, TARGET)).toEqual([]);
  });

  it('rejects a DM tag on a tombstoned target', async () => {
    await seedDm(PEER, OWNER, TARGET);
    const existing = await StorageService.getLinkMessageByEventId(OWNER, OWNER, TARGET);
    expect(existing).not.toBeNull();
    jest.spyOn(StorageService, 'getLinkMessageByEventId').mockResolvedValue({
      ...existing!,
      deleted: true,
    });
    const built = buildChatTagEnvelope({
      eventId: TAG_EVENT,
      sentAt: 20,
      targetEventId: TARGET,
      targetAuthorPubky: OWNER,
      label: 'ok',
      op: 'add',
    });
    const result = await applyInboundTagOrReceipt({
      ownerPubky: OWNER,
      senderPubky: PEER,
      rawJson: built.json,
      peerTrust: 'accepted',
      kindHint: CHAT_TAG_KIND,
    });
    expect(result).toBe('processed');
    expect(await StorageService.listChatTagsForScope(OWNER, buildDmConversationId(PEER))).toEqual(
      [],
    );
  });

  it('ignores a cross-thread receipt', async () => {
    await seedDm(OTHER, OWNER, TARGET);
    const built = buildChatReceiptEnvelope({
      eventId: TAG_EVENT,
      sentAt: 20,
      status: 'read',
      eventIds: [TARGET],
    });
    await applyInboundTagOrReceipt({
      ownerPubky: OWNER,
      senderPubky: PEER,
      rawJson: built.json,
      peerTrust: 'accepted',
      kindHint: CHAT_RECEIPT_KIND,
    });
    const row = await StorageService.getLinkMessageByEventId(OWNER, OWNER, TARGET);
    expect(row?.deliveryState).toBe('sent');
  });

  it('ignores a group receipt from a removed member', async () => {
    const channelId = buildPrivateChannelId(OWNER, TARGET);
    await StorageService.upsertGroupChannel({
      ownerPubky: OWNER,
      channelId,
      name: 'Crew',
      createdAt: 1,
      updatedAt: 1,
      createdBy: OWNER,
      isPublic: false,
      lastMessageAt: 10,
      membershipEpoch: 0,
    });
    await StorageService.upsertGroupMember({
      ownerPubky: OWNER,
      channelId,
      memberPubky: PEER,
      role: 'member',
      addedAt: 1,
      removedAt: 2,
      status: 'removed',
    });
    await StorageService.saveGroupMessage({
      ownerPubky: OWNER,
      channelId,
      eventId: TARGET,
      senderPubky: OWNER,
      kind: CHAT_MESSAGE_KIND,
      body: 'hi',
      rawJson: '{}',
      sentAt: 10,
      receivedAt: null,
      deliveryState: 'sent',
      replyToEventId: null,
      replyToAuthorPubky: null,
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    });
    const built = buildChatReceiptEnvelope({
      eventId: TAG_EVENT,
      sentAt: 20,
      status: 'read',
      eventIds: [TARGET],
      channelId,
    });
    await applyInboundTagOrReceipt({
      ownerPubky: OWNER,
      senderPubky: PEER,
      rawJson: built.json,
      peerTrust: 'accepted',
      kindHint: CHAT_RECEIPT_KIND,
    });
    const rows = await StorageService.listGroupMessages(OWNER, channelId, 10);
    expect(rows[0]?.deliveryState).toBe('sent');
  });

  it('tombstones a DM only when the delete sender is the author and redacts stream/queue/backup', async () => {
    await seedDm(PEER, PEER, TARGET);
    await StorageService.saveLinkStreamItems([
      {
        id: 'stream-del',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: JSON.stringify({
          version: 1,
          kind: CHAT_MESSAGE_KIND,
          event_id: TARGET,
          sent_at: 10,
          body: 'secret-body',
        }),
        receivedAt: 11,
      },
    ]);
    await StorageService.persistControlSendIntent({
      ownerPubky: OWNER,
      queueItem: {
        id: 'q-del',
        messageId: TARGET,
        recipientPubky: PEER,
        payload: JSON.stringify({ type: 'link.chat.message', ownerPubky: OWNER, eventId: TARGET }),
        attempts: 0,
        nextRetryAt: 1,
        createdAt: 1,
      },
    });
    const forged = JSON.stringify({
      version: 1,
      kind: 'chat.delete.v0',
      event_id: TAG_EVENT,
      sent_at: 30,
      target_event_id: TARGET,
    });
    const forgedResult = await applyInboundDelete({
      ownerPubky: OWNER,
      senderPubky: OTHER,
      peerPubky: PEER,
      rawJson: forged,
      peerTrust: 'accepted',
    });
    expect(forgedResult).toBe('processed');
    expect((await StorageService.getLinkMessageByEventId(OWNER, PEER, TARGET))?.body).toBe('hi');

    const ok = JSON.stringify({
      version: 1,
      kind: 'chat.delete.v0',
      event_id: TAG_EVENT,
      sent_at: 30,
      target_event_id: TARGET,
    });
    const result = await applyInboundDelete({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: ok,
      peerTrust: 'accepted',
    });
    expect(result).toBe('processed');
    const tomb = await StorageService.getLinkMessageByEventId(OWNER, PEER, TARGET);
    expect(tomb?.deleted).toBe(true);
    expect(tomb?.body).toBe('');
    expect(JSON.parse(tomb?.rawJson ?? '{}').deleted).toBe(true);
    expect(
      (
        await StorageService.getLinkMessagesForConversation(OWNER, buildDmConversationId(PEER), 10)
      )[0]?.body,
    ).toBe('');
    const stream = await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER);
    expect(stream.every(row => !row.rawJson.includes('secret-body'))).toBe(true);
    expect(await StorageService.hasQueueItemForMessage(TARGET)).toBe(false);
    const snapshot = await StorageService.collectOwnerBackup(OWNER);
    const backed = snapshot.linkMessages.find(row => row.eventId === TARGET);
    expect(backed?.body).toBe('');
    expect(backed?.rawJson.includes('secret-body')).toBe(false);
  });
});
