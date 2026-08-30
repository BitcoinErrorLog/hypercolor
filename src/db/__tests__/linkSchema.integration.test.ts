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
    deleteAttachmentSecrets: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/attachments/fileIo', () => ({
  deleteCacheFiles: jest.fn().mockResolvedValue(undefined),
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
} from '../schema';
import { StorageService } from '../../services/StorageService';
import { KeyStore } from '../../services/KeyStore';
import { CHAT_MESSAGE_KIND } from '../../types/link';
import { openMemoryDb } from './betterSqliteAdapter';

const OWNER = 'a'.repeat(52);
const PEER = 'z'.repeat(52);
const OTHER = 'b'.repeat(52);
const EVENT = '00000000-0000-4000-8000-000000000001';

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

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(9);
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

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(9);
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
    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OTHER,
      trustScore: 0.9,
      isFollowing: false,
      isFollower: true,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 11,
    });

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

    await StorageService.updateTrustScore(PEER, 0.1, OTHER);
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

  it('drops the threads→contacts(pubky) FK so a composite contacts PK is valid', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    db.executeSync(
      `INSERT INTO threads
        (id, participant_pubky, unread_count, created_at, updated_at)
       VALUES ('t1', ?, 0, 1, 1)`,
      [PEER],
    );
    expect(db.executeSync('SELECT id FROM threads').rows?.[0]?.id).toBe('t1');
  });

  it('creates v8 group tables, wipes them on clearAccountData, and isolates accounts', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(9);
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
    await StorageService.upsertGroupChannel({
      ownerPubky: OTHER,
      channelId,
      name: 'Other crew',
      createdAt: 1,
      updatedAt: 1,
      createdBy: OTHER,
      isPublic: false,
      lastMessageAt: 11,
      membershipEpoch: 2,
    });
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
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    });
    await StorageService.saveGroupMessage({
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
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    });
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
    await StorageService.markGroupEventSeen(OTHER, channelId, PEER, eventId, 11);
    await StorageService.saveGroupDeferred({
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
    });

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

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(9);
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

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(9);
    expect(
      db.executeSync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'")
        .rows,
    ).toHaveLength(1);
    const pk = db.executeSync('PRAGMA table_info(attachments)').rows ?? [];
    expect(pk.filter(col => Number(col.pk) > 0).map(col => col.name)).toEqual([
      'owner_pubky',
      'event_id',
    ]);
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
      keyRef: `att:${OWNER}:${eventA}`,
      contentType: 'image/jpeg',
      size: 12,
      thumbnailLocation: null,
      localCachePath: 'file:///cache/a',
      createdAt: 10,
      updatedAt: 10,
      deliveryState: 'sent',
      resolveState: 'ready',
    });
    await StorageService.saveAttachment({
      ownerPubky: OTHER,
      eventId: eventB,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: OTHER,
      direction: 'sent',
      location: `pubky://${OTHER}/pub/hypercolor.app/v1/attachments/${eventB}`,
      keyRef: `att:${OTHER}:${eventB}`,
      contentType: 'application/pdf',
      size: 20,
      thumbnailLocation: null,
      localCachePath: 'file:///cache/b',
      createdAt: 11,
      updatedAt: 11,
      deliveryState: 'sent',
      resolveState: 'ready',
    });

    expect(await StorageService.getAttachment(OWNER, eventA)).toEqual(
      expect.objectContaining({ eventId: eventA, keyRef: `att:${OWNER}:${eventA}` }),
    );
    expect(await StorageService.getAttachment(OTHER, eventB)).toEqual(
      expect.objectContaining({ eventId: eventB }),
    );

    await StorageService.clearAccountData(OWNER);

    expect(await StorageService.getAttachment(OWNER, eventA)).toBeNull();
    expect(await StorageService.getAttachment(OTHER, eventB)).toEqual(
      expect.objectContaining({ eventId: eventB, contentType: 'application/pdf' }),
    );
    expect(KeyStore.deleteAttachmentSecrets).toHaveBeenCalledWith(OWNER, [eventA]);
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
