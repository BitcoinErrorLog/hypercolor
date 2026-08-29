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

import { setDbForTests } from '../index';
import { runMigrations } from '../migrations';
import { SCHEMA_V1_STATEMENTS, SCHEMA_V2_STATEMENTS, SCHEMA_V3_STATEMENTS } from '../schema';
import { StorageService } from '../../services/StorageService';
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

    expect(db.executeSync('PRAGMA user_version').rows?.[0]?.user_version).toBe(4);
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

    await StorageService.clearAccountData(OWNER);
    expect(await StorageService.getLinkReceiver(OWNER)).toBeNull();
    expect(await StorageService.getLink(OWNER, PEER)).toBeNull();
    expect(await StorageService.getLinkMessagesForConversation(OWNER, `dm:${PEER}`)).toEqual([]);
    expect(await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER)).toEqual([]);
  });
});
