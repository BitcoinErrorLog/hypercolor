/**
 * Exercises the REAL migration SQL (v1–v4) and the REAL StorageService
 * statements against in-memory SQLite via better-sqlite3. op-sqlite cannot
 * run under Jest without native binaries; this adapter runs the identical
 * SQL strings (see betterSqliteAdapter.ts).
 */
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the SQL integration test');
  },
}));

jest.mock('../../services/KeyStore', () => ({
  KeyStore: {
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../services/attachments/fileIo', () => ({
  deleteCacheFiles: jest.fn().mockResolvedValue(undefined),
  cachePathsForAttachment: ({
    ownerPubky,
    senderPubky,
    eventId,
    localCachePath,
  }: {
    ownerPubky: string;
    senderPubky: string;
    eventId: string;
    localCachePath: string | null;
  }) => {
    const primary = `file:///cache/hypercolor-attachments/${ownerPubky}/${senderPubky}/${eventId}`;
    const paths = [primary, `${primary}.thumb`];
    if (localCachePath) {
      paths.push(localCachePath);
      if (!localCachePath.endsWith('.thumb')) paths.push(`${localCachePath}.thumb`);
    }
    return paths;
  },
}));

import { setDbForTests } from '../index';
import { runMigrations } from '../migrations';
import {
  SCHEMA_V1_STATEMENTS,
  SCHEMA_V2_STATEMENTS,
  SCHEMA_V3_STATEMENTS,
  SCHEMA_V4_STATEMENTS,
  SCHEMA_V5_STATEMENTS,
  SCHEMA_V6_STATEMENTS,
  SCHEMA_V7_STATEMENTS,
  SCHEMA_V8_STATEMENTS,
  SCHEMA_V9_STATEMENTS,
  SCHEMA_V10_STATEMENTS,
  SCHEMA_V11_STATEMENTS,
  SCHEMA_V12_STATEMENTS,
  SCHEMA_V13_STATEMENTS,
  SCHEMA_V16_STATEMENTS,
} from '../schema';
import { StorageService } from '../../services/StorageService';
import { KeyStore } from '../../services/KeyStore';
import { paintOwner } from '../../services/paintedOwner';
import { CHAT_MESSAGE_KIND, type HandshakeBudgetInput } from '../../types/link';
import { GROUP_MEMBERSHIP_KIND, GROUP_MESSAGE_KIND } from '../../types/group';
import { EMPTY_PAYMENT_RECORD_EXTRAS } from '../../types/payment';
import {
  openFileDb as openFileDbRaw,
  openMemoryDb as openMemoryDbRaw,
} from './betterSqliteAdapter';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const liveDbs: Array<{ close: () => void }> = [];

function openMemoryDb(): ReturnType<typeof openMemoryDbRaw> {
  const db = openMemoryDbRaw();
  liveDbs.push(db);
  return db;
}

function openFileDb(path: string): ReturnType<typeof openFileDbRaw> {
  const db = openFileDbRaw(path);
  liveDbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of liveDbs) {
    try {
      db.close();
    } catch {
      // Already closed by the test.
    }
  }
  liveDbs.length = 0;
  setDbForTests(null);
});

beforeEach(() => {
  paintOwner(OWNER);
});

const OWNER = 'a'.repeat(52);
const PEER = 'z'.repeat(52);
const OTHER = 'b'.repeat(52);
const EVENT = '00000000-0000-4000-8000-000000000001';

async function asOwner<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  paintOwner(owner);
  try {
    return await fn();
  } finally {
    paintOwner(OWNER);
  }
}

function applyV3(db: ReturnType<typeof openMemoryDb>): void {
  for (const statement of [
    ...SCHEMA_V1_STATEMENTS,
    ...SCHEMA_V2_STATEMENTS,
    ...SCHEMA_V3_STATEMENTS,
  ]) {
    db.executeSync(statement);
  }
  db.executeSync('PRAGMA user_version = 3');
}

function seedV3LinkRows(db: ReturnType<typeof openMemoryDb>): void {
  db.executeSync(
    `INSERT INTO links (peer_pubky, role, status, snapshot, created_at, updated_at)
     VALUES (?, 'initiator', 'established', 'opaque-cipher', 1, 1)`,
    [PEER],
  );
  db.executeSync(
    `INSERT INTO link_messages
      (event_id, conversation_id, peer_pubky, direction, kind, raw_json,
       body, sent_at, received_at, delivery_state, created_at, updated_at)
     VALUES (?, ?, ?, 'received', ?, '{}', 'hi', 10, 11, 'delivered', 1, 1)`,
    [EVENT, `dm:${PEER}`, PEER, CHAT_MESSAGE_KIND],
  );
  db.executeSync(
    `INSERT INTO link_read_cursors (conversation_id, last_read_at, updated_at)
     VALUES (?, 10, 1)`,
    [`dm:${PEER}`],
  );
}

describe('link schema v4 (real SQL via better-sqlite3)', () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it('enforces foreign_keys like production getDb()', () => {
    const db = openMemoryDb();
    db.executeSync('PRAGMA journal_mode = WAL');
    db.executeSync('PRAGMA foreign_keys = ON');
    expect(db.executeSync('PRAGMA foreign_keys').rows?.[0]?.foreign_keys).toBe(1);
  });

  it('does not copy v3 secret_ref as a receiver alias (force re-provision)', async () => {
    const db = openMemoryDb();
    applyV3(db);
    db.executeSync(
      `INSERT INTO link_receivers
        (owner_pubky, secret_ref, app, runtime, marker_published, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, 1)`,
      [OWNER, 'hypercolor-link-receiver-secret', 'hypercolor', 'mobile'],
    );
    seedV3LinkRows(db);

    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    expect(db.executeSync('SELECT * FROM link_receivers').rows).toEqual([]);
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'link_receivers'",
      ).rows,
    ).toHaveLength(1);

    const link = db.executeSync('SELECT * FROM links').rows?.[0];
    expect(link).toEqual(
      expect.objectContaining({
        owner_pubky: OWNER,
        peer_pubky: PEER,
        snapshot: 'opaque-cipher',
        local_receiver_path: 'hypercolor/wallet',
        consecutive_failures: 0,
      }),
    );
    expect(db.executeSync('SELECT * FROM link_messages').rows?.[0]).toEqual(
      expect.objectContaining({
        owner_pubky: OWNER,
        sender_pubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        event_id: EVENT,
      }),
    );
    expect(db.executeSync('SELECT * FROM link_read_cursors').rows?.[0]).toEqual(
      expect.objectContaining({ owner_pubky: OWNER, conversation_id: `dm:${PEER}` }),
    );
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'link_stream_items'",
      ).rows,
    ).toHaveLength(1);
  });

  it('does not leave empty-owner rows when v3 has no receiver', async () => {
    const db = openMemoryDb();
    applyV3(db);
    seedV3LinkRows(db);

    await runMigrations(db);

    expect(db.executeSync('SELECT * FROM link_receivers').rows).toEqual([]);
    expect(db.executeSync('SELECT * FROM links').rows).toEqual([]);
    expect(db.executeSync('SELECT * FROM link_messages').rows).toEqual([]);
    expect(db.executeSync('SELECT * FROM link_read_cursors').rows).toEqual([]);
    expect(
      db.executeSync("SELECT COUNT(*) AS n FROM links WHERE owner_pubky = ''").rows?.[0]?.n,
    ).toBe(0);
    expect(
      db.executeSync("SELECT COUNT(*) AS n FROM link_messages WHERE owner_pubky = ''").rows?.[0]?.n,
    ).toBe(0);
    expect(
      db.executeSync("SELECT COUNT(*) AS n FROM link_read_cursors WHERE owner_pubky = ''").rows?.[0]
        ?.n,
    ).toBe(0);
  });

  it('runs StorageService statements: scoped dedup, send protocol, sign-out wipe', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.upsertLinkReceiver({
      ownerPubky: OWNER,
      receiverAlias: 'recv-1',
      receiverPath: 'hypercolor/wallet',
      markerPublished: true,
    });

    const sameEvent = EVENT;
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: sameEvent,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: PEER,
      direction: 'received',
      kind: CHAT_MESSAGE_KIND,
      rawJson: '{}',
      body: 'from peer',
      sentAt: 10,
      receivedAt: 11,
      deliveryState: 'delivered',
    });
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: sameEvent,
      conversationId: `dm:${OTHER}`,
      peerPubky: OTHER,
      senderPubky: OTHER,
      direction: 'received',
      kind: CHAT_MESSAGE_KIND,
      rawJson: '{}',
      body: 'from other',
      sentAt: 10,
      receivedAt: 11,
      deliveryState: 'delivered',
    });
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: sameEvent,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: PEER,
      direction: 'received',
      kind: CHAT_MESSAGE_KIND,
      rawJson: '{}',
      body: 'duplicate',
      sentAt: 12,
      receivedAt: 13,
      deliveryState: 'delivered',
    });

    expect(await StorageService.hasLinkMessage(OWNER, PEER, CHAT_MESSAGE_KIND, sameEvent)).toBe(
      true,
    );
    expect(await StorageService.hasLinkMessage(OWNER, OTHER, CHAT_MESSAGE_KIND, sameEvent)).toBe(
      true,
    );
    const forPeer = await StorageService.getLinkMessagesForConversation(OWNER, `dm:${PEER}`);
    expect(forPeer).toHaveLength(1);
    expect(forPeer[0]!.body).toBe('from peer');

    await StorageService.persistLinkSendIntent({
      message: {
        ownerPubky: OWNER,
        eventId: '00000000-0000-4000-8000-000000000002',
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"exact":true}',
        body: 'out',
        sentAt: 20,
        receivedAt: null,
        deliveryState: 'sending',
      },
      queueItem: {
        id: 'q-1',
        messageId: '00000000-0000-4000-8000-000000000002',
        recipientPubky: PEER,
        payload: '{"type":"link.chat.message","rawJson":"{\\"exact\\":true}"}',
        attempts: 0,
        nextRetryAt: 20,
        createdAt: 20,
      },
    });

    const queued = await StorageService.listDeliveryQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toContain('exact');

    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: 'initiator',
      status: 'established',
      snapshot: 'cipher-1',
      remoteNoisePublicKey: 'noise',
      localReceiverPath: 'hypercolor/wallet',
      remoteReceiverPath: 'hypercolor/wallet',
      consecutiveFailures: 0,
    });

    await StorageService.finalizeLinkSend({
      ownerPubky: OWNER,
      peerPubky: PEER,
      senderPubky: OWNER,
      kind: CHAT_MESSAGE_KIND,
      eventId: '00000000-0000-4000-8000-000000000002',
      snapshot: 'cipher-2',
      queueId: 'q-1',
    });

    const sent = await StorageService.getLinkMessage(
      OWNER,
      OWNER,
      CHAT_MESSAGE_KIND,
      '00000000-0000-4000-8000-000000000002',
    );
    expect(sent?.deliveryState).toBe('sent');
    expect((await StorageService.getLink(OWNER, PEER))?.snapshot).toBe('cipher-2');
    expect(await StorageService.listDeliveryQueue()).toHaveLength(0);

    await StorageService.saveLinkStreamItems([
      {
        id: 'st-1',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: 'other.v0',
        rawJson: '{"kind":"other.v0"}',
        receivedAt: 30,
      },
    ]);
    const unprocessed = await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER);
    expect(unprocessed).toHaveLength(1);

    const failures = await StorageService.incrementLinkConsecutiveFailures(OWNER, PEER);
    expect(failures).toBe(1);

    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: true,
      isFollower: false,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 1,
    });
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: 1,
      updatedAt: 1,
      status: 'pending',
    });

    await StorageService.clearAccountData(OWNER);
    expect(await StorageService.getLinkReceiver(OWNER)).toBeNull();
    expect(await StorageService.getLink(OWNER, PEER)).toBeNull();
    expect(await StorageService.getLinkMessagesForConversation(OWNER, `dm:${PEER}`)).toEqual([]);
    expect(await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER)).toEqual([]);
    expect(await StorageService.getContact(PEER, OWNER)).toBeNull();
    expect(await StorageService.getMessageRequest(OWNER, PEER)).toBeNull();
  });

  it('applies v5 contact relationship columns and message_requests', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    const cols = db.executeSync('PRAGMA table_info(contacts)').rows ?? [];
    const names = cols.map(row => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'owner_pubky',
        'is_following',
        'is_follower',
        'is_mutual',
        'added_manually',
      ]),
    );
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_requests'",
      ).rows,
    ).toHaveLength(1);

    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      displayName: 'Zed',
      trustScore: 0.2,
      isFollowing: true,
      isFollower: true,
      isMutual: true,
      addedManually: true,
      firstSeenAt: 10,
    });
    const contact = await StorageService.getContact(PEER, OWNER);
    expect(contact).toEqual(
      expect.objectContaining({
        ownerPubky: OWNER,
        displayName: 'Zed',
        isFollowing: true,
        isFollower: true,
        isMutual: true,
        addedManually: true,
      }),
    );
    expect((await StorageService.getAllContacts(OWNER)).map(c => c.pubky)).toEqual([PEER]);

    const pkCols = cols.filter(row => Number(row.pk) > 0).map(row => row.name);
    expect(pkCols).toEqual(['owner_pubky', 'pubky']);
  });

  it('deletes a declined message request so a later upsert can become pending', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: 1,
      updatedAt: 1,
      status: 'declined',
    });
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: 2,
      updatedAt: 2,
      status: 'pending',
    });
    expect((await StorageService.getMessageRequest(OWNER, PEER))?.status).toBe('declined');

    await StorageService.deleteMessageRequest(OWNER, PEER);
    expect(await StorageService.getMessageRequest(OWNER, PEER)).toBeNull();

    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: 3,
      updatedAt: 3,
      status: 'pending',
    });
    expect((await StorageService.getMessageRequest(OWNER, PEER))?.status).toBe('pending');
  });

  it('keeps independent contact rows per account and does not delete A on B sign-out', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0.2,
      isFollowing: true,
      isFollower: false,
      isMutual: false,
      addedManually: true,
      firstSeenAt: 10,
    });
    await asOwner(OTHER, () =>
      StorageService.upsertContact({
        pubky: PEER,
        ownerPubky: OTHER,
        trustScore: 0.9,
        isFollowing: false,
        isFollower: true,
        isMutual: false,
        addedManually: false,
        firstSeenAt: 11,
      }),
    );

    const forA = await StorageService.getContact(PEER, OWNER);
    const forB = await StorageService.getContact(PEER, OTHER);
    expect(forA).toEqual(
      expect.objectContaining({
        ownerPubky: OWNER,
        isFollowing: true,
        addedManually: true,
        trustScore: 0.2,
      }),
    );
    expect(forB).toEqual(
      expect.objectContaining({
        ownerPubky: OTHER,
        isFollowing: false,
        isFollower: true,
        trustScore: 0.9,
      }),
    );

    await asOwner(OTHER, () => StorageService.updateTrustScore(PEER, 0.1, OTHER));
    expect((await StorageService.getContact(PEER, OWNER))?.trustScore).toBe(0.2);
    expect((await StorageService.getContact(PEER, OTHER))?.trustScore).toBeCloseTo(1.0);

    await StorageService.clearAccountData(OTHER);
    expect(await StorageService.getContact(PEER, OWNER)).toEqual(
      expect.objectContaining({ ownerPubky: OWNER, isFollowing: true }),
    );
    expect(await StorageService.getContact(PEER, OTHER)).toBeNull();
  });

  it('does not demote relationship flags on a plain discovery upsert', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0.4,
      isFollowing: true,
      isFollower: true,
      isMutual: true,
      addedManually: true,
      firstSeenAt: 10,
    });
    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0.1,
      isFollowing: false,
      isFollower: false,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 99,
    });

    expect(await StorageService.getContact(PEER, OWNER)).toEqual(
      expect.objectContaining({
        isFollowing: true,
        isFollower: true,
        isMutual: true,
        addedManually: true,
        trustScore: 0.1,
      }),
    );
  });

  it('routes held stream items in insertion order when received_at ties', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    const arrivedAt = 50;
    await StorageService.saveLinkStreamItems([
      {
        id: 'later-id',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"n":2}',
        receivedAt: arrivedAt,
      },
      {
        id: 'earlier-id',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"n":1}',
        receivedAt: arrivedAt,
      },
    ]);
    // Insert one first, then the other, so rowid order is the arrival order.
    const items = await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER);
    expect(items.map(item => item.id)).toEqual(['later-id', 'earlier-id']);
  });

  it('settles excess unprocessed stream items per peer, keeping the oldest', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.saveLinkStreamItems([
      {
        id: 'keep-1',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"n":1}',
        receivedAt: 10,
      },
      {
        id: 'keep-2',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"n":2}',
        receivedAt: 20,
      },
      {
        id: 'drop-3',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"n":3}',
        receivedAt: 30,
      },
      {
        id: 'other-peer',
        ownerPubky: OWNER,
        peerPubky: OTHER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"n":9}',
        receivedAt: 10,
      },
    ]);

    const settled = await StorageService.settleExcessUnprocessedLinkStreamItems(OWNER, PEER, 2, 2);
    expect(settled).toBe(1);
    expect(
      (await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER)).map(item => item.id),
    ).toEqual(['keep-1', 'keep-2']);
    expect(
      (await StorageService.getUnprocessedLinkStreamItems(OWNER, OTHER)).map(item => item.id),
    ).toEqual(['other-peer']);
    expect(await StorageService.settleExcessUnprocessedLinkStreamItems(OWNER, PEER, 2, 2)).toBe(0);
  });

  it('settles group and non-group unprocessed items on independent budgets', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.saveLinkStreamItems([
      {
        id: 'chat-1',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"n":1}',
        receivedAt: 10,
      },
      {
        id: 'chat-2',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"n":2}',
        receivedAt: 20,
      },
      {
        id: 'chat-3',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"n":3}',
        receivedAt: 30,
      },
      {
        id: 'group-invite',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: GROUP_MEMBERSHIP_KIND,
        rawJson: '{"op":"create"}',
        receivedAt: 40,
      },
    ]);

    const settled = await StorageService.settleExcessUnprocessedLinkStreamItems(OWNER, PEER, 2, 2);
    expect(settled).toBe(1);
    expect(
      (await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER)).map(item => item.id),
    ).toEqual(['chat-1', 'chat-2', 'group-invite']);
  });

  it('partitions settle budgets by peeked envelope kind, not the stored kind column', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.saveLinkStreamItems([
      {
        id: 'mislabeled-chat-1',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: GROUP_MEMBERSHIP_KIND,
        rawJson: JSON.stringify({ kind: CHAT_MESSAGE_KIND, n: 1 }),
        receivedAt: 10,
      },
      {
        id: 'mislabeled-chat-2',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: GROUP_MEMBERSHIP_KIND,
        rawJson: JSON.stringify({ kind: CHAT_MESSAGE_KIND, n: 2 }),
        receivedAt: 20,
      },
      {
        id: 'mislabeled-chat-3',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: GROUP_MEMBERSHIP_KIND,
        rawJson: JSON.stringify({ kind: CHAT_MESSAGE_KIND, n: 3 }),
        receivedAt: 30,
      },
      {
        id: 'mislabeled-invite',
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: JSON.stringify({ kind: GROUP_MEMBERSHIP_KIND, op: 'create' }),
        receivedAt: 40,
      },
    ]);

    const settled = await StorageService.settleExcessUnprocessedLinkStreamItems(OWNER, PEER, 2, 2);
    expect(settled).toBe(1);
    expect(
      (await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER)).map(item => item.id),
    ).toEqual(['mislabeled-chat-1', 'mislabeled-chat-2', 'mislabeled-invite']);
  });

  it('deletes one sender deferred events and seen markers without touching group_messages', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    const channelId = `${OWNER}:00000000-0000-4000-8000-00000000aaaa`;
    const eventId = '00000000-0000-4000-8000-0000000000aa';
    const otherEvent = '00000000-0000-4000-8000-0000000000bb';
    await StorageService.saveGroupMessage({
      ownerPubky: OWNER,
      channelId,
      eventId,
      senderPubky: PEER,
      kind: CHAT_MESSAGE_KIND,
      body: 'keep me',
      rawJson: '{}',
      sentAt: 10,
      receivedAt: 10,
      deliveryState: 'delivered',
      replyToEventId: null,
      replyToAuthorPubky: null,
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    });
    await StorageService.saveGroupDeferred({
      ownerPubky: OWNER,
      channelId,
      senderPubky: PEER,
      eventId: '00000000-0000-4000-8000-0000000000cc',
      kind: 'chat.group.edit.v0',
      body: 'later',
      rawJson: '{}',
      sentAt: 12,
      receivedAt: 12,
      targetEventId: eventId,
      targetAuthorPubky: OWNER,
    });
    await StorageService.saveGroupDeferred({
      ownerPubky: OWNER,
      channelId,
      senderPubky: OTHER,
      eventId: '00000000-0000-4000-8000-0000000000dd',
      kind: 'chat.group.reaction.v0',
      body: '👍',
      rawJson: '{}',
      sentAt: 13,
      receivedAt: 13,
      targetEventId: eventId,
      targetAuthorPubky: OWNER,
    });
    await StorageService.markGroupEventSeen(OWNER, channelId, PEER, otherEvent, 14);
    await StorageService.markGroupEventSeen(OWNER, channelId, OTHER, otherEvent, 15);

    await StorageService.deleteGroupDeferredForSender(OWNER, PEER);
    await StorageService.deleteGroupSeenEventsForSender(OWNER, PEER);

    expect(await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER)).toEqual([]);
    expect(await StorageService.listGroupDeferredForSender(OWNER, channelId, OTHER)).toHaveLength(
      1,
    );
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER, otherEvent)).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, OTHER, otherEvent)).toBe(true);
    expect(await StorageService.getGroupMessage(OWNER, channelId, PEER, eventId)).toEqual(
      expect.objectContaining({ body: 'keep me' }),
    );
  });

  it('backfills empty-owner contacts to the sole receiver and drops ambiguous orphans', async () => {
    const sole = openMemoryDb();
    applyThroughV5(sole);
    sole.executeSync(
      `INSERT INTO link_receivers
        (owner_pubky, receiver_alias, receiver_path, marker_published, created_at, updated_at)
       VALUES (?, 'alias', 'hypercolor/wallet', 1, 1, 1)`,
      [OWNER],
    );
    sole.executeSync(
      `INSERT INTO contacts
        (pubky, owner_pubky, display_name, trust_score, is_following, is_follower,
         is_mutual, added_manually, first_seen_at, created_at, updated_at)
       VALUES (?, '', 'Orphan', 1.0, 0, 1, 0, 0, 1, 1, 1)`,
      [PEER],
    );
    await runMigrations(sole);
    expect(sole.executeSync('SELECT owner_pubky, trust_score FROM contacts').rows?.[0]).toEqual(
      expect.objectContaining({ owner_pubky: OWNER, trust_score: 1.0 }),
    );

    const ambiguous = openMemoryDb();
    applyThroughV5(ambiguous);
    ambiguous.executeSync(
      `INSERT INTO link_receivers
        (owner_pubky, receiver_alias, receiver_path, marker_published, created_at, updated_at)
       VALUES (?, 'a', 'hypercolor/wallet', 1, 1, 1)`,
      [OWNER],
    );
    ambiguous.executeSync(
      `INSERT INTO link_receivers
        (owner_pubky, receiver_alias, receiver_path, marker_published, created_at, updated_at)
       VALUES (?, 'b', 'hypercolor/wallet', 1, 1, 1)`,
      [OTHER],
    );
    ambiguous.executeSync(
      `INSERT INTO contacts
        (pubky, owner_pubky, display_name, trust_score, is_following, is_follower,
         is_mutual, added_manually, first_seen_at, created_at, updated_at)
       VALUES (?, '', 'Shared', 1.0, 0, 1, 0, 0, 1, 1, 1)`,
      [PEER],
    );
    await runMigrations(ambiguous);
    expect(ambiguous.executeSync('SELECT * FROM contacts').rows).toEqual([]);
  });

  it('does not let the WoT gate read another account or an empty-owner leftover', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 1,
      isFollowing: true,
      isFollower: false,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 1,
    });
    expect(await StorageService.getContact(PEER, OTHER)).toBeNull();
    expect(await StorageService.getContact(PEER, '')).toBeNull();
    expect((await StorageService.getAllContacts(OTHER)).map(c => c.pubky)).toEqual([]);
  });

  it('v13 drops research-era tables, keeps delivery_queue, and adds reply_to_author_pubky', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    applyThroughV12(db);
    db.executeSync(
      `INSERT INTO threads
        (id, participant_pubky, unread_count, created_at, updated_at)
       VALUES ('t1', ?, 0, 1, 1)`,
      [PEER],
    );
    expect(db.executeSync('SELECT id FROM threads').rows?.[0]?.id).toBe('t1');

    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    for (const name of ['threads', 'messages', 'channels', 'channel_members', 'cursor_state']) {
      expect(
        db.executeSync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name])
          .rows,
      ).toHaveLength(0);
    }
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'delivery_queue'",
      ).rows,
    ).toHaveLength(1);
    expect(
      db.executeSync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mesh_peers'")
        .rows,
    ).toHaveLength(1);
    const groupCols = (db.executeSync('PRAGMA table_info(group_messages)').rows ?? []).map(
      row => row.name,
    );
    expect(groupCols).toEqual(expect.arrayContaining(['reply_to_author_pubky']));
  });

  it('creates v8 group tables, wipes them on clearAccountData, and isolates accounts', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    for (const name of [
      'group_channels',
      'group_members',
      'group_messages',
      'group_seen_events',
      'group_deferred_events',
    ]) {
      expect(
        db.executeSync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name])
          .rows,
      ).toHaveLength(1);
    }
    const pk = db.executeSync('PRAGMA table_info(group_messages)').rows ?? [];
    const pkCols = pk.filter(row => Number(row.pk) > 0).map(row => row.name);
    expect(pkCols).toEqual(['owner_pubky', 'channel_id', 'sender_pubky', 'event_id']);
    expect(pk.map(row => row.name)).toEqual(expect.arrayContaining(['target_author_pubky']));

    const channelId = '00000000-0000-4000-8000-0000000000aa';
    const eventId = '00000000-0000-4000-8000-0000000000bb';
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
    await asOwner(OTHER, () =>
      StorageService.upsertGroupChannel({
        ownerPubky: OTHER,
        channelId,
        name: 'Other crew',
        createdAt: 1,
        updatedAt: 1,
        createdBy: OTHER,
        isPublic: false,
        lastMessageAt: 11,
        membershipEpoch: 2,
      }),
    );
    await StorageService.upsertGroupMember({
      ownerPubky: OWNER,
      channelId,
      memberPubky: PEER,
      role: 'member',
      addedAt: 1,
      removedAt: null,
      status: 'active',
    });
    await StorageService.saveGroupMessage({
      ownerPubky: OWNER,
      channelId,
      eventId,
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
    await asOwner(OTHER, () =>
      StorageService.saveGroupMessage({
        ownerPubky: OTHER,
        channelId,
        eventId,
        senderPubky: OTHER,
        kind: CHAT_MESSAGE_KIND,
        body: 'other',
        rawJson: '{}',
        sentAt: 11,
        receivedAt: null,
        deliveryState: 'sent',
        replyToEventId: null,
        replyToAuthorPubky: null,
        targetEventId: null,
        targetAuthorPubky: null,
        editedAt: null,
        deleted: false,
      }),
    );
    await StorageService.markGroupEventSeen(OWNER, channelId, PEER, eventId, 10);
    await StorageService.saveGroupDeferred({
      ownerPubky: OWNER,
      channelId,
      senderPubky: PEER,
      eventId: '00000000-0000-4000-8000-0000000000cc',
      kind: 'chat.group.edit.v0',
      body: 'later',
      rawJson: '{}',
      sentAt: 12,
      receivedAt: 12,
      targetEventId: eventId,
      targetAuthorPubky: OWNER,
    });
    await asOwner(OTHER, () =>
      StorageService.markGroupEventSeen(OTHER, channelId, PEER, eventId, 11),
    );
    await asOwner(OTHER, () =>
      StorageService.saveGroupDeferred({
        ownerPubky: OTHER,
        channelId,
        senderPubky: PEER,
        eventId: '00000000-0000-4000-8000-0000000000cc',
        kind: 'chat.group.edit.v0',
        body: 'other-later',
        rawJson: '{}',
        sentAt: 13,
        receivedAt: 13,
        targetEventId: eventId,
        targetAuthorPubky: OTHER,
      }),
    );

    expect(await StorageService.getGroupChannel(OWNER, channelId)).toEqual(
      expect.objectContaining({ name: 'Crew', membershipEpoch: 0 }),
    );
    expect(await StorageService.getGroupChannel(OTHER, channelId)).toEqual(
      expect.objectContaining({ name: 'Other crew', membershipEpoch: 2 }),
    );

    await StorageService.clearAccountData(OWNER);
    expect(await StorageService.getGroupChannel(OWNER, channelId)).toBeNull();
    expect(await StorageService.listGroupMembers(OWNER, channelId)).toEqual([]);
    expect(await StorageService.getGroupMessage(OWNER, channelId, OWNER, eventId)).toBeNull();
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER, eventId)).toBe(false);
    expect(await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER)).toEqual([]);
    expect(await StorageService.getGroupChannel(OTHER, channelId)).toEqual(
      expect.objectContaining({ name: 'Other crew' }),
    );
    expect(await StorageService.getGroupMessage(OTHER, channelId, OTHER, eventId)).toEqual(
      expect.objectContaining({ body: 'other' }),
    );
    expect(await StorageService.hasGroupEventSeen(OTHER, channelId, PEER, eventId)).toBe(true);
    expect(await StorageService.listGroupDeferredForSender(OTHER, channelId, PEER)).toHaveLength(1);
  });

  it('migrates v7 group_messages into the sender-scoped v8 primary key', async () => {
    const db = openMemoryDb();
    applyThroughV7(db);
    db.executeSync(
      `INSERT INTO group_messages
        (owner_pubky, channel_id, event_id, sender_pubky, kind, body, raw_json,
         sent_at, received_at, delivery_state, reply_to_event_id, target_event_id,
         edited_at, deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'hi', '{}', 10, NULL, 'sent', NULL, NULL, NULL, 0, 1, 1)`,
      [OWNER, 'chan-1', EVENT, PEER, CHAT_MESSAGE_KIND],
    );

    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    const row = db.executeSync('SELECT * FROM group_messages').rows?.[0];
    expect(row).toEqual(
      expect.objectContaining({
        owner_pubky: OWNER,
        channel_id: 'chan-1',
        sender_pubky: PEER,
        event_id: EVENT,
        target_author_pubky: null,
        body: 'hi',
      }),
    );
    const pk = db.executeSync('PRAGMA table_info(group_messages)').rows ?? [];
    expect(pk.filter(col => Number(col.pk) > 0).map(col => col.name)).toEqual([
      'owner_pubky',
      'channel_id',
      'sender_pubky',
      'event_id',
    ]);
  });

  it('creates v9 attachments table, wipes them on clearAccountData, and isolates accounts', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    expect(
      db.executeSync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'")
        .rows,
    ).toHaveLength(1);
    const pk = db.executeSync('PRAGMA table_info(attachments)').rows ?? [];
    expect(pk.filter(col => Number(col.pk) > 0).map(col => col.name)).toEqual([
      'owner_pubky',
      'sender_pubky',
      'event_id',
    ]);
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_cleanup'",
      ).rows,
    ).toHaveLength(1);
    expect(pk.map(col => col.name)).toEqual(
      expect.arrayContaining([
        'conversation_id',
        'channel_id',
        'location',
        'key_ref',
        'content_type',
        'size',
        'thumbnail_location',
        'local_cache_path',
        'delivery_state',
        'resolve_state',
      ]),
    );

    const eventA = '00000000-0000-4000-8000-0000000000a1';
    const eventB = '00000000-0000-4000-8000-0000000000b1';
    await StorageService.saveAttachment({
      ownerPubky: OWNER,
      eventId: eventA,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: OWNER,
      direction: 'sent',
      location: `pubky://${OWNER}/pub/hypercolor.app/v1/attachments/${eventA}`,
      keyRef: `att:${OWNER}:${OWNER}:${eventA}`,
      contentType: 'image/jpeg',
      size: 12,
      thumbnailLocation: null,
      localCachePath: 'file:///cache/a',
      createdAt: 10,
      updatedAt: 10,
      deliveryState: 'sent',
      resolveState: 'ready',
    });
    await asOwner(OTHER, () =>
      StorageService.saveAttachment({
        ownerPubky: OTHER,
        eventId: eventB,
        conversationId: `dm:${PEER}`,
        channelId: null,
        senderPubky: OTHER,
        direction: 'sent',
        location: `pubky://${OTHER}/pub/hypercolor.app/v1/attachments/${eventB}`,
        keyRef: `att:${OTHER}:${OTHER}:${eventB}`,
        contentType: 'application/pdf',
        size: 20,
        thumbnailLocation: null,
        localCachePath: 'file:///cache/b',
        createdAt: 11,
        updatedAt: 11,
        deliveryState: 'sent',
        resolveState: 'ready',
      }),
    );

    expect(await StorageService.getAttachment(OWNER, OWNER, eventA)).toEqual(
      expect.objectContaining({ eventId: eventA, keyRef: `att:${OWNER}:${OWNER}:${eventA}` }),
    );
    expect(await StorageService.getAttachment(OTHER, OTHER, eventB)).toEqual(
      expect.objectContaining({ eventId: eventB }),
    );

    await StorageService.clearAccountData(OWNER);

    expect(await StorageService.getAttachment(OWNER, OWNER, eventA)).toBeNull();
    expect(await StorageService.getAttachment(OTHER, OTHER, eventB)).toEqual(
      expect.objectContaining({ eventId: eventB, contentType: 'application/pdf' }),
    );
    expect(KeyStore.deleteAttachmentSecrets).toHaveBeenCalledWith(OWNER, [
      { senderPubky: OWNER, eventId: eventA },
    ]);
  });

  it('lets two senders keep the same event_id after v10', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const sharedEvent = '00000000-0000-4000-8000-0000000000ee';
    await StorageService.saveAttachment({
      ownerPubky: OWNER,
      eventId: sharedEvent,
      conversationId: null,
      channelId: 'chan',
      senderPubky: PEER,
      direction: 'received',
      location: `pubky://${PEER}/pub/hypercolor.app/v1/attachments/${sharedEvent}`,
      keyRef: `att:${OWNER}:${PEER}:${sharedEvent}`,
      contentType: 'image/jpeg',
      size: 4,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 10,
      updatedAt: 10,
      deliveryState: 'delivered',
      resolveState: 'pending',
    });
    await StorageService.saveAttachment({
      ownerPubky: OWNER,
      eventId: sharedEvent,
      conversationId: null,
      channelId: 'chan',
      senderPubky: OTHER,
      direction: 'received',
      location: `pubky://${OTHER}/pub/hypercolor.app/v1/attachments/${sharedEvent}`,
      keyRef: `att:${OWNER}:${OTHER}:${sharedEvent}`,
      contentType: 'image/jpeg',
      size: 8,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 11,
      updatedAt: 11,
      deliveryState: 'delivered',
      resolveState: 'pending',
    });
    expect(await StorageService.getAttachment(OWNER, PEER, sharedEvent)).toEqual(
      expect.objectContaining({ senderPubky: PEER, size: 4 }),
    );
    expect(await StorageService.getAttachment(OWNER, OTHER, sharedEvent)).toEqual(
      expect.objectContaining({ senderPubky: OTHER, size: 8 }),
    );
  });

  it('creates v11 payment tables, wipes them on clearAccountData, and isolates accounts', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    const paymentCols = (db.executeSync('PRAGMA table_info(payment_requests)').rows ?? []).map(
      col => col.name,
    );
    expect(paymentCols).toEqual(
      expect.arrayContaining(['pending_event_id', 'displayed_payment_hash', 'proof_verified']),
    );
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payment_requests'",
      ).rows,
    ).toHaveLength(1);
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payment_events'",
      ).rows,
    ).toHaveLength(1);
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tip_endpoints'",
      ).rows,
    ).toHaveLength(1);

    const pk = db.executeSync('PRAGMA table_info(payment_requests)').rows ?? [];
    expect(pk.filter(col => Number(col.pk) > 0).map(col => col.name)).toEqual([
      'owner_pubky',
      'peer_pubky',
      'payment_request_id',
    ]);

    const requestId = 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33';
    const eventId = '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d101';
    await StorageService.savePaymentRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      direction: 'sent',
      paymentRequestId: requestId,
      eventId,
      amountValue: '0.001',
      amountAsset: 'btc',
      paymentReference: 'invoice-2026-0001',
      endpointIds: ['btc-lightning-bolt11'],
      expiresAt: null,
      status: 'pending',
      createdAt: 10,
      updatedAt: 10,
      proofJson: null,
      reason: null,
      ...EMPTY_PAYMENT_RECORD_EXTRAS,
    });
    await StorageService.savePaymentEvent({
      ownerPubky: OWNER,
      conversationId: `dm:${PEER}`,
      senderPubky: OWNER,
      eventId,
      kind: 'paykit.payment_request',
      paymentRequestId: requestId,
      applied: true,
      receivedAt: 10,
    });
    await StorageService.replaceTipEndpoints(
      OWNER,
      PEER,
      [{ identifier: 'btc-lightning-bolt11', payload: 'lnbc1validinvoiceabc' }],
      10,
    );
    await asOwner(OTHER, () =>
      StorageService.savePaymentRequest({
        ownerPubky: OTHER,
        peerPubky: PEER,
        direction: 'received',
        paymentRequestId: requestId,
        eventId,
        amountValue: '0.002',
        amountAsset: 'btc',
        paymentReference: 'other-invoice',
        endpointIds: ['btc-lightning-bolt11'],
        expiresAt: null,
        status: 'pending',
        createdAt: 11,
        updatedAt: 11,
        proofJson: null,
        reason: null,
        ...EMPTY_PAYMENT_RECORD_EXTRAS,
      }),
    );

    expect(await StorageService.getPaymentRequest(OWNER, PEER, requestId)).toEqual(
      expect.objectContaining({ amountValue: '0.001', paymentReference: 'invoice-2026-0001' }),
    );
    expect(await StorageService.getPaymentRequest(OTHER, PEER, requestId)).toEqual(
      expect.objectContaining({ amountValue: '0.002' }),
    );

    await StorageService.clearAccountData(OWNER);

    expect(await StorageService.getPaymentRequest(OWNER, PEER, requestId)).toBeNull();
    expect(await StorageService.hasPaymentEvent(OWNER, `dm:${PEER}`, OWNER, eventId)).toBe(false);
    expect(await StorageService.listTipEndpoints(OWNER, PEER)).toEqual([]);
    expect(await StorageService.getPaymentRequest(OTHER, PEER, requestId)).toEqual(
      expect.objectContaining({ amountValue: '0.002', paymentReference: 'other-invoice' }),
    );
  });
});

describe('link schema v15 — durable handshake abuse budget (real SQL)', () => {
  afterEach(() => {
    setDbForTests(null);
  });

  async function seedLink(
    peerPubky: string,
    status: 'handshaking' | 'established' = 'handshaking',
  ): Promise<void> {
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky,
      role: 'responder',
      status,
      snapshot: `cipher-${peerPubky.slice(0, 4)}`,
      remoteNoisePublicKey: 'noise',
      localReceiverPath: 'hypercolor/wallet',
      remoteReceiverPath: 'hypercolor/wallet',
      consecutiveFailures: 0,
    });
  }

  async function seedBudget(
    peerPubky: string,
    overrides: Partial<HandshakeBudgetInput> = {},
  ): Promise<void> {
    await StorageService.upsertHandshakeBudget({
      ownerPubky: OWNER,
      peerPubky,
      pendingAdvances: 1,
      nextAdvanceAt: 0,
      exhaustedAt: null,
      ...overrides,
    });
  }

  it('migrates an existing link row off the per-row advance columns', async () => {
    const db = openMemoryDb();
    applyThroughV13(db);
    db.executeSync(
      `INSERT INTO links
        (owner_pubky, peer_pubky, role, status, snapshot, remote_noise_public_key,
         local_receiver_path, remote_receiver_path, consecutive_failures,
         created_at, updated_at)
       VALUES (?, ?, 'responder', 'handshaking', 'cipher', 'noise',
               'hypercolor/wallet', 'hypercolor/wallet', 0, 1, 1)`,
      [OWNER, PEER],
    );

    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    const row = db.executeSync('SELECT * FROM links').rows?.[0] ?? {};
    expect(row).toEqual(expect.objectContaining({ owner_pubky: OWNER, peer_pubky: PEER }));
    expect(Object.keys(row)).not.toContain('pending_advances');
    expect(Object.keys(row)).not.toContain('next_advance_at');
    // A row that predates the budget table has never been charged, so it is
    // due now rather than silently exempt from stepping.
    setDbForTests(db);
    expect(await StorageService.getHandshakeBudget(OWNER, PEER)).toBeNull();
    expect((await StorageService.getDueHandshakingLinks(OWNER)).map(l => l.peerPubky)).toEqual([
      PEER,
    ]);
  });

  it('returns only handshaking links whose budget is due and unexhausted, oldest first', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const soon = 'c'.repeat(52);
    const later = 'd'.repeat(52);
    const notDue = 'e'.repeat(52);
    const spent = 'f'.repeat(52);

    await seedLink(PEER, 'established');
    for (const peer of [soon, later, notDue, spent]) {
      await seedLink(peer);
    }
    // Another owner's handshake must never appear in this account's batch.
    await asOwner(OTHER, () =>
      StorageService.upsertLink({
        ownerPubky: OTHER,
        peerPubky: PEER,
        role: 'responder',
        status: 'handshaking',
        snapshot: 'hs',
        remoteNoisePublicKey: 'noise',
        localReceiverPath: 'hypercolor/wallet',
        remoteReceiverPath: 'hypercolor/wallet',
        consecutiveFailures: 0,
      }),
    );

    await seedBudget(soon, { nextAdvanceAt: 1 });
    await seedBudget(later, { nextAdvanceAt: 2 });
    await seedBudget(notDue, { nextAdvanceAt: Date.now() + 60 * 60 * 1000 });
    await seedBudget(spent, { pendingAdvances: 10, nextAdvanceAt: 1, exhaustedAt: 1 });

    const due = await StorageService.getDueHandshakingLinks(OWNER);
    expect(due.map(link => link.peerPubky)).toEqual([soon, later]);

    const capped = await StorageService.getDueHandshakingLinks(OWNER, 1);
    expect(capped.map(link => link.peerPubky)).toEqual([soon]);
  });

  it('keeps the budget when the link row is deleted and re-adopted', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await seedLink(PEER);
    await seedBudget(PEER, { pendingAdvances: 4, nextAdvanceAt: Date.now() + 60_000 });

    // Exactly what `recoverWedgedLink` / `abandonUnestablishedLink` do, then
    // the peer rewrites message 1 and sync re-adopts it.
    await StorageService.deleteLink(OWNER, PEER);
    await seedLink(PEER);

    expect(await StorageService.getHandshakeBudget(OWNER, PEER)).toEqual(
      expect.objectContaining({ pendingAdvances: 4 }),
    );
    expect(await StorageService.getDueHandshakingLinks(OWNER)).toEqual([]);
  });

  it('preserves exhaustion across an app restart', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hypercolor-budget-')), 'hypercolor.db');
    try {
      const first = openFileDb(file);
      setDbForTests(first);
      await runMigrations(first);
      await seedLink(PEER);
      await seedBudget(PEER, { pendingAdvances: 10, nextAdvanceAt: 1, exhaustedAt: 4242 });
      first.close();

      // A cold start re-opens the same file and re-runs migrations, exactly as
      // the app does. Nothing in-process carries the exhaustion over.
      const second = openFileDb(file);
      setDbForTests(second);
      await runMigrations(second);

      expect(await StorageService.getHandshakeBudget(OWNER, PEER)).toEqual(
        expect.objectContaining({ pendingAdvances: 10, exhaustedAt: 4242 }),
      );
      expect(await StorageService.getDueHandshakingLinks(OWNER)).toEqual([]);
      second.close();
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  it('drops budget rows for the signed-out account only', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await seedBudget(PEER, { pendingAdvances: 7, exhaustedAt: 1 });
    await asOwner(OTHER, () =>
      StorageService.upsertHandshakeBudget({
        ownerPubky: OTHER,
        peerPubky: PEER,
        pendingAdvances: 3,
        nextAdvanceAt: 0,
        exhaustedAt: null,
      }),
    );

    await StorageService.clearAccountData(OWNER);

    expect(await StorageService.getHandshakeBudget(OWNER, PEER)).toBeNull();
    expect(await StorageService.getHandshakeBudget(OTHER, PEER)).toEqual(
      expect.objectContaining({ pendingAdvances: 3 }),
    );
  });

  it('forgets the budget on an explicit clear', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await seedLink(PEER);
    await seedBudget(PEER, { pendingAdvances: 10, nextAdvanceAt: 1, exhaustedAt: 1 });

    await StorageService.clearHandshakeBudget(OWNER, PEER);

    expect(await StorageService.getHandshakeBudget(OWNER, PEER)).toBeNull();
    expect((await StorageService.getDueHandshakingLinks(OWNER)).map(l => l.peerPubky)).toEqual([
      PEER,
    ]);
  });

  it('reports whether a specific queue item is still outstanding', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.enqueue({
      id: 'q-race',
      messageId: EVENT,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: 'link.chat.message',
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: EVENT,
        rawJson: '{}',
      }),
      attempts: 0,
      nextRetryAt: 1,
      createdAt: 1,
    });

    expect(await StorageService.hasQueueItem('q-race')).toBe(true);
    await StorageService.removeFromQueue('q-race');
    expect(await StorageService.hasQueueItem('q-race')).toBe(false);
  });
});

describe('link schema v16 — per-recipient group fan-out outcomes (real SQL)', () => {
  let openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs) {
      try {
        db.close();
      } catch {
        // Already closed by the test.
      }
    }
    openDbs = [];
    setDbForTests(null);
  });

  it('creates group_fanout_outcomes, persists mixed status, and wipes on clearAccountData', async () => {
    const db = openMemoryDb();
    openDbs.push(db);
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'group_fanout_outcomes'",
      ).rows,
    ).toHaveLength(1);

    const channelId = `${OWNER}:00000000-0000-4000-8000-00000000bbbb`;
    const eventId = '00000000-0000-4000-8000-00000000eeee';
    await StorageService.upsertGroupFanoutOutcome({
      ownerPubky: OWNER,
      channelId,
      eventId,
      senderPubky: OWNER,
      recipientPubky: PEER,
      status: 'failed',
      reason: 'blocked',
      updatedAt: 1,
    });
    await StorageService.upsertGroupFanoutOutcome({
      ownerPubky: OWNER,
      channelId,
      eventId,
      senderPubky: OWNER,
      recipientPubky: OTHER,
      status: 'sent',
      reason: null,
      updatedAt: 2,
    });
    await asOwner(OTHER, () =>
      StorageService.upsertGroupFanoutOutcome({
        ownerPubky: OTHER,
        channelId,
        eventId,
        senderPubky: OTHER,
        recipientPubky: PEER,
        status: 'sent',
        reason: null,
        updatedAt: 3,
      }),
    );

    const ownerRows = await StorageService.listGroupFanoutOutcomes(
      OWNER,
      channelId,
      OWNER,
      eventId,
    );
    expect(ownerRows).toHaveLength(2);
    expect(ownerRows.map(row => row.status).sort()).toEqual(['failed', 'sent']);

    await StorageService.insertBlockedPeer(OWNER, PEER);
    expect(await StorageService.listBlockedPeers(OWNER)).toEqual([PEER]);

    await StorageService.clearAccountData(OWNER);
    expect(await StorageService.listGroupFanoutOutcomes(OWNER, channelId, OWNER, eventId)).toEqual(
      [],
    );
    expect(await StorageService.listBlockedPeers(OWNER)).toEqual([]);
    expect(
      await StorageService.listGroupFanoutOutcomes(OTHER, channelId, OTHER, eventId),
    ).toHaveLength(1);
  });

  it('creates blocked_peers and survives a file-backed relaunch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hc-deny-'));
    const path = join(dir, 'hypercolor.db');
    try {
      const first = openFileDb(path);
      setDbForTests(first);
      await runMigrations(first);
      expect(
        first.executeSync(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blocked_peers'",
        ).rows,
      ).toHaveLength(1);
      await StorageService.insertBlockedPeer(OWNER, PEER);
      first.close();
      setDbForTests(null);

      const second = openFileDb(path);
      setDbForTests(second);
      await runMigrations(second);
      expect(await StorageService.listBlockedPeers(OWNER)).toEqual([PEER]);
      expect(await StorageService.hasBlockedPeer(OWNER, PEER)).toBe(true);
      expect(await StorageService.listBlockedPeerCleanupPending(OWNER)).toEqual([PEER]);
      second.close();
      setDbForTests(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds cleanup_pending to a pre-column v16 blocked_peers table', async () => {
    const db = openMemoryDb();
    openDbs.push(db);
    setDbForTests(db);
    db.executeSync(
      `CREATE TABLE blocked_peers (
        owner_pubky TEXT NOT NULL,
        peer_pubky TEXT NOT NULL,
        blocked_at INTEGER NOT NULL,
        PRIMARY KEY (owner_pubky, peer_pubky)
      )`,
    );
    db.executeSync('PRAGMA user_version = 16');
    await runMigrations(db);
    const info = db.executeSync('PRAGMA table_info(blocked_peers)');
    const names = (info.rows ?? []).map(row => String(row.name));
    expect(names).toContain('cleanup_pending');
    await runMigrations(db);
    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    expect(SCHEMA_V16_STATEMENTS.some(s => /cleanup_pending/.test(s))).toBe(true);
  });

  it('replays all v16 CREATE statements on a database already stamped 16', async () => {
    const db = openMemoryDb();
    openDbs.push(db);
    setDbForTests(db);
    db.executeSync('PRAGMA user_version = 16');
    await runMigrations(db);
    const tables = db.executeSync(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('group_fanout_outcomes', 'blocked_peers') ORDER BY name",
    );
    expect((tables.rows ?? []).map(row => String(row.name))).toEqual([
      'blocked_peers',
      'group_fanout_outcomes',
    ]);
    const indexes = db.executeSync(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_group_fanout_outcomes_event', 'idx_blocked_peers_owner') ORDER BY name",
    );
    expect((indexes.rows ?? []).map(row => String(row.name))).toEqual([
      'idx_blocked_peers_owner',
      'idx_group_fanout_outcomes_event',
    ]);
    const info = db.executeSync('PRAGMA table_info(blocked_peers)');
    expect((info.rows ?? []).map(row => String(row.name))).toContain('cleanup_pending');
    await runMigrations(db);
    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(16);
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('group_fanout_outcomes', 'blocked_peers')",
      ).rows,
    ).toHaveLength(2);
  });

  it('seeds pending outcomes with persistGroupSendIntent and rolls back a failed complete', async () => {
    const db = openMemoryDb();
    openDbs.push(db);
    setDbForTests(db);
    await runMigrations(db);
    const channelId = `${OWNER}:00000000-0000-4000-8000-00000000bbbb`;
    const eventId = '00000000-0000-4000-8000-00000000eeee';
    await StorageService.persistGroupSendIntent({
      message: {
        ownerPubky: OWNER,
        channelId,
        eventId,
        senderPubky: OWNER,
        kind: GROUP_MESSAGE_KIND,
        body: 'hi',
        rawJson: '{}',
        sentAt: 1,
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
          id: 'q-fan-1',
          messageId: eventId,
          recipientPubky: PEER,
          payload: '{}',
          attempts: 0,
          nextRetryAt: 1,
          createdAt: 1,
        },
        {
          id: 'q-fan-2',
          messageId: eventId,
          recipientPubky: OTHER,
          payload: '{}',
          attempts: 0,
          nextRetryAt: 1,
          createdAt: 1,
        },
      ],
    });
    const seeded = await StorageService.getGroupFanoutAggregate(OWNER, channelId, OWNER, eventId);
    expect(seeded).toHaveLength(2);
    expect(seeded.every(row => row.status === 'pending')).toBe(true);

    const orig = db.executeSync.bind(db);
    db.executeSync = ((query: string, params?: unknown) => {
      if (/^DELETE FROM delivery_queue WHERE id = \?/i.test(query.trim())) {
        throw new Error('injected delete failure');
      }
      return orig(query, params as never);
    }) as typeof db.executeSync;

    await expect(
      StorageService.completeGroupFanoutRecipient({
        ownerPubky: OWNER,
        channelId,
        eventId,
        senderPubky: OWNER,
        recipientPubky: PEER,
        status: 'failed',
        reason: 'blocked',
        queueId: 'q-fan-1',
        kind: GROUP_MESSAGE_KIND,
      }),
    ).rejects.toThrow('injected delete failure');

    db.executeSync = orig;
    const after = await StorageService.getGroupFanoutAggregate(OWNER, channelId, OWNER, eventId);
    expect(after.every(row => row.status === 'pending')).toBe(true);
    expect(await StorageService.hasQueueItem('q-fan-1')).toBe(true);
    expect(await StorageService.hasQueueItem('q-fan-2')).toBe(true);
    db.close();
  });

  it('does not duplicate outcomes or reset terminal rows when re-persisting the same event', async () => {
    const db = openMemoryDb();
    openDbs.push(db);
    setDbForTests(db);
    await runMigrations(db);
    const channelId = `${OWNER}:00000000-0000-4000-8000-00000000bbbb`;
    const eventId = '00000000-0000-4000-8000-00000000eeee';
    const message = {
      ownerPubky: OWNER,
      channelId,
      eventId,
      senderPubky: OWNER,
      kind: GROUP_MESSAGE_KIND,
      body: 'hi',
      rawJson: '{}',
      sentAt: 1,
      receivedAt: null,
      deliveryState: 'sending' as const,
      replyToEventId: null,
      replyToAuthorPubky: null,
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    };
    await StorageService.persistGroupSendIntent({
      message,
      queueItems: [
        {
          id: 'q-fan-1',
          messageId: eventId,
          recipientPubky: PEER,
          payload: '{}',
          attempts: 0,
          nextRetryAt: 1,
          createdAt: 1,
        },
        {
          id: 'q-fan-2',
          messageId: eventId,
          recipientPubky: OTHER,
          payload: '{}',
          attempts: 0,
          nextRetryAt: 1,
          createdAt: 1,
        },
      ],
    });
    await StorageService.completeGroupFanoutRecipient({
      ownerPubky: OWNER,
      channelId,
      eventId,
      senderPubky: OWNER,
      recipientPubky: PEER,
      status: 'failed',
      reason: 'blocked',
      queueId: 'q-fan-1',
      kind: GROUP_MESSAGE_KIND,
    });
    await StorageService.persistGroupSendIntent({
      message,
      queueItems: [
        {
          id: 'q-fan-3',
          messageId: eventId,
          recipientPubky: PEER,
          payload: '{}',
          attempts: 0,
          nextRetryAt: 2,
          createdAt: 2,
        },
        {
          id: 'q-fan-4',
          messageId: eventId,
          recipientPubky: OTHER,
          payload: '{}',
          attempts: 0,
          nextRetryAt: 2,
          createdAt: 2,
        },
      ],
    });
    const outcomes = await StorageService.getGroupFanoutAggregate(OWNER, channelId, OWNER, eventId);
    expect(outcomes).toHaveLength(2);
    expect(outcomes.find(row => row.recipientPubky === PEER)).toEqual(
      expect.objectContaining({ status: 'failed', reason: 'blocked' }),
    );
    expect(outcomes.find(row => row.recipientPubky === OTHER)).toEqual(
      expect.objectContaining({ status: 'pending' }),
    );
    expect(await StorageService.hasQueueItem('q-fan-1')).toBe(false);
    expect(await StorageService.hasQueueItem('q-fan-2')).toBe(true);
    expect(await StorageService.hasQueueItem('q-fan-3')).toBe(false);
    expect(await StorageService.hasQueueItem('q-fan-4')).toBe(false);
    db.close();
  });
});

function applyThroughV5(db: ReturnType<typeof openMemoryDb>): void {
  for (const statement of [
    ...SCHEMA_V1_STATEMENTS,
    ...SCHEMA_V2_STATEMENTS,
    ...SCHEMA_V3_STATEMENTS,
    ...SCHEMA_V4_STATEMENTS,
    ...SCHEMA_V5_STATEMENTS,
  ]) {
    db.executeSync(statement);
  }
  db.executeSync('PRAGMA user_version = 5');
}

function applyThroughV7(db: ReturnType<typeof openMemoryDb>): void {
  applyThroughV5(db);
  for (const statement of [...SCHEMA_V6_STATEMENTS, ...SCHEMA_V7_STATEMENTS]) {
    db.executeSync(statement);
  }
  db.executeSync('PRAGMA user_version = 7');
}

function applyThroughV12(db: ReturnType<typeof openMemoryDb>): void {
  applyThroughV7(db);
  for (const statement of [
    ...SCHEMA_V8_STATEMENTS,
    ...SCHEMA_V9_STATEMENTS,
    ...SCHEMA_V10_STATEMENTS,
    ...SCHEMA_V11_STATEMENTS,
    ...SCHEMA_V12_STATEMENTS,
  ]) {
    db.executeSync(statement);
  }
  db.executeSync('PRAGMA user_version = 12');
}

function applyThroughV13(db: ReturnType<typeof openMemoryDb>): void {
  applyThroughV12(db);
  for (const statement of SCHEMA_V13_STATEMENTS) {
    db.executeSync(statement);
  }
  db.executeSync('PRAGMA user_version = 13');
}
