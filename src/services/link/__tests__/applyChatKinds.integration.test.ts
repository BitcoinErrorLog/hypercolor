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
  },
}));

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../StorageService';
import { paintOwner } from '../../paintedOwner';
import { applyInboundTagOrReceipt } from '../applyChatKinds';
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

  it('defers a DM tag when the target is missing', async () => {
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
    expect(result).toBe('unprocessed');
    expect(await StorageService.listChatTagsForScope(OWNER, buildDmConversationId(PEER))).toEqual(
      [],
    );
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
});
