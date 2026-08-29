import { getDb } from '../db';
import type {
  Message,
  MessageId,
  Thread,
  Channel,
  ChannelMember,
  Contact,
  DeliveryQueueItem,
  DeliveryStatus,
  PubkyKey,
} from '../types';

/**
 * StorageService — the single point of access for all SQLite persistence.
 *
 * All methods return plain TypeScript objects; no raw SQLite row shapes leak
 * past this boundary. Timestamps are always Unix milliseconds.
 */

const now = () => Date.now();

// ─── Contacts ─────────────────────────────────────────────────────────────

export const StorageService = {
  // ── Contacts ──────────────────────────────────────────────────────────────

  async upsertContact(contact: Contact): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO contacts
        (pubky, display_name, avatar_hash, homeserver, trust_score,
         first_seen_at, last_interaction_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pubky) DO UPDATE SET
         display_name         = excluded.display_name,
         avatar_hash          = excluded.avatar_hash,
         homeserver           = excluded.homeserver,
         trust_score          = excluded.trust_score,
         last_interaction_at  = excluded.last_interaction_at,
         updated_at           = excluded.updated_at`,
      [
        contact.pubky,
        contact.displayName ?? null,
        contact.avatarHash ?? null,
        contact.homeserver ?? null,
        contact.trustScore,
        contact.firstSeenAt,
        contact.lastInteractionAt ?? null,
        contact.firstSeenAt,
        now(),
      ],
    );
  },

  async getContact(pubky: PubkyKey): Promise<Contact | null> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM contacts WHERE pubky = ?', [pubky]);
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToContact(row);
  },

  async getAllContacts(): Promise<Contact[]> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM contacts ORDER BY last_interaction_at DESC');
    return (result.rows ?? []).map(rowToContact);
  },

  async updateTrustScore(pubky: PubkyKey, delta: number): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE contacts
       SET trust_score = MAX(0.0, MIN(1.0, trust_score + ?)),
           updated_at = ?
       WHERE pubky = ?`,
      [delta, now(), pubky],
    );
  },

  async touchContactInteraction(pubky: PubkyKey): Promise<void> {
    const db = await getDb();
    db.executeSync('UPDATE contacts SET last_interaction_at = ?, updated_at = ? WHERE pubky = ?', [
      now(),
      now(),
      pubky,
    ]);
  },

  // ── Threads ───────────────────────────────────────────────────────────────

  async upsertThread(thread: Thread): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO threads
        (id, participant_pubky, last_message, last_message_at,
         unread_count, noise_context_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_message      = excluded.last_message,
         last_message_at   = excluded.last_message_at,
         unread_count      = excluded.unread_count,
         updated_at        = excluded.updated_at`,
      [
        thread.id,
        thread.participantPubky,
        thread.lastMessage ?? null,
        thread.lastMessageAt ?? null,
        thread.unreadCount,
        thread.sb2ContextId ?? null,
        now(),
        now(),
      ],
    );
  },

  async setThreadContextId(threadId: string, contextIdHex: string): Promise<void> {
    const db = await getDb();
    db.executeSync('UPDATE threads SET noise_context_id = ?, updated_at = ? WHERE id = ?', [
      contextIdHex,
      now(),
      threadId,
    ]);
  },

  async getThread(threadId: string): Promise<Thread | null> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM threads WHERE id = ?', [threadId]);
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToThread(row);
  },

  async getThreadForParticipant(participantPubky: PubkyKey): Promise<Thread | null> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM threads WHERE participant_pubky = ? LIMIT 1', [
      participantPubky,
    ]);
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToThread(row);
  },

  async getAllThreads(): Promise<Thread[]> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM threads ORDER BY last_message_at DESC');
    return (result.rows ?? []).map(rowToThread);
  },

  async markThreadRead(threadId: string): Promise<void> {
    const db = await getDb();
    db.executeSync('UPDATE threads SET unread_count = 0, updated_at = ? WHERE id = ?', [
      now(),
      threadId,
    ]);
  },

  async markChannelRead(channelId: string): Promise<void> {
    const db = await getDb();
    db.executeSync('UPDATE channels SET unread_count = 0, updated_at = ? WHERE id = ?', [
      now(),
      channelId,
    ]);
  },

  async incrementThreadUnread(threadId: string): Promise<void> {
    const db = await getDb();
    db.executeSync(
      'UPDATE threads SET unread_count = unread_count + 1, updated_at = ? WHERE id = ?',
      [now(), threadId],
    );
  },

  // ── Channels ──────────────────────────────────────────────────────────────

  async upsertChannel(channel: Channel): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO channels
        (id, name, channel_key_base64, member_count, last_message,
         last_message_at, unread_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name               = excluded.name,
         channel_key_base64 = excluded.channel_key_base64,
         member_count       = excluded.member_count,
         last_message       = excluded.last_message,
         last_message_at    = excluded.last_message_at,
         unread_count       = excluded.unread_count,
         updated_at         = excluded.updated_at`,
      [
        channel.id,
        channel.name,
        channel.channelInboxPkHex ?? null,
        channel.memberCount,
        channel.lastMessage ?? null,
        channel.lastMessageAt ?? null,
        channel.unreadCount,
        now(),
        now(),
      ],
    );
  },

  async getAllChannels(): Promise<Channel[]> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM channels ORDER BY last_message_at DESC');
    return (result.rows ?? []).map(rowToChannel);
  },

  async getChannel(channelId: string): Promise<Channel | null> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM channels WHERE id = ?', [channelId]);
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToChannel(row);
  },

  async getChannelMembers(channelId: string): Promise<ChannelMember[]> {
    const db = await getDb();
    const result = db.executeSync(
      'SELECT * FROM channel_members WHERE channel_id = ? ORDER BY joined_at ASC',
      [channelId],
    );
    return (result.rows ?? []).map(rowToChannelMember);
  },

  async upsertChannelMember(member: ChannelMember): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO channel_members (channel_id, pubky, display_name, joined_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(channel_id, pubky) DO UPDATE SET
         display_name = excluded.display_name`,
      [member.channelId, member.pubky, member.displayName ?? null, member.joinedAt],
    );
  },

  // ── Messages ──────────────────────────────────────────────────────────────

  async saveMessage(message: Message): Promise<void> {
    const db = await getDb();
    const dedupHash = message.id; // id is already SHA-256 of content
    db.executeSync(
      `INSERT OR IGNORE INTO messages
        (id, thread_id, channel_id, sender_pubky, recipient_pubky,
         content, created_at, delivery_status, delivery_path, dedup_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.threadId,
        message.channelId ?? null,
        message.senderPubky,
        message.recipientPubky ?? null,
        message.content,
        message.createdAt,
        message.deliveryStatus,
        message.deliveryPath ?? null,
        dedupHash,
        now(),
      ],
    );
  },

  async getMessagesForThread(threadId: string, limit = 50, beforeMs?: number): Promise<Message[]> {
    const db = await getDb();
    const result = beforeMs
      ? db.executeSync(
          'SELECT * FROM messages WHERE thread_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?',
          [threadId, beforeMs, limit],
        )
      : db.executeSync(
          'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?',
          [threadId, limit],
        );
    return (result.rows ?? []).map(rowToMessage).reverse();
  },

  async getMessagesForChannel(
    channelId: string,
    limit = 50,
    beforeMs?: number,
  ): Promise<Message[]> {
    const db = await getDb();
    const result = beforeMs
      ? db.executeSync(
          'SELECT * FROM messages WHERE channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?',
          [channelId, beforeMs, limit],
        )
      : db.executeSync(
          'SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?',
          [channelId, limit],
        );
    return (result.rows ?? []).map(rowToMessage).reverse();
  },

  async markDelivered(messageId: MessageId, path: string): Promise<void> {
    const db = await getDb();
    db.executeSync(
      "UPDATE messages SET delivery_status = 'delivered', delivery_path = ?, updated_at = ? WHERE id = ?",
      [path, now(), messageId],
    );
  },

  async updateDeliveryStatus(messageId: MessageId, status: DeliveryStatus): Promise<void> {
    const db = await getDb();
    db.executeSync('UPDATE messages SET delivery_status = ?, updated_at = ? WHERE id = ?', [
      status,
      now(),
      messageId,
    ]);
  },

  async isDuplicate(dedupHash: string): Promise<boolean> {
    const db = await getDb();
    const result = db.executeSync('SELECT 1 FROM messages WHERE dedup_hash = ? LIMIT 1', [
      dedupHash,
    ]);
    return (result.rows?.length ?? 0) > 0;
  },

  // ── Delivery Queue ────────────────────────────────────────────────────────

  async enqueue(item: DeliveryQueueItem): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT OR REPLACE INTO delivery_queue
        (id, message_id, recipient_pubky, payload, attempts, next_retry_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.messageId,
        item.recipientPubky,
        item.payload,
        item.attempts,
        item.nextRetryAt,
        item.createdAt,
      ],
    );
  },

  async dequeue(limit = 10): Promise<DeliveryQueueItem[]> {
    const db = await getDb();
    const result = db.executeSync(
      'SELECT * FROM delivery_queue WHERE next_retry_at <= ? ORDER BY next_retry_at ASC LIMIT ?',
      [now(), limit],
    );
    return (result.rows ?? []).map(rowToQueueItem);
  },

  async incrementAttempt(id: string, nextRetryAt: number): Promise<void> {
    const db = await getDb();
    db.executeSync(
      'UPDATE delivery_queue SET attempts = attempts + 1, next_retry_at = ? WHERE id = ?',
      [nextRetryAt, id],
    );
  },

  async removeFromQueue(id: string): Promise<void> {
    const db = await getDb();
    db.executeSync('DELETE FROM delivery_queue WHERE id = ?', [id]);
  },

  // ── Cursor State ──────────────────────────────────────────────────────────

  async getCursor(
    senderPubky: PubkyKey,
    scopeKey: string,
    scopeType: 'dm' | 'channel',
  ): Promise<number> {
    const db = await getDb();
    const result = db.executeSync(
      'SELECT last_cursor_ms FROM cursor_state WHERE sender_pubky = ? AND scope_key = ? AND scope_type = ?',
      [senderPubky, scopeKey, scopeType],
    );
    return (result.rows?.[0]?.last_cursor_ms as number) ?? 0;
  },

  async advanceCursor(
    senderPubky: PubkyKey,
    scopeKey: string,
    scopeType: 'dm' | 'channel',
    cursorMs: number,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO cursor_state (id, sender_pubky, scope_key, scope_type, last_cursor_ms, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(sender_pubky, scope_key, scope_type) DO UPDATE SET
         last_cursor_ms = MAX(last_cursor_ms, excluded.last_cursor_ms),
         updated_at     = excluded.updated_at`,
      [
        `${senderPubky}:${scopeKey}:${scopeType}`,
        senderPubky,
        scopeKey,
        scopeType,
        cursorMs,
        now(),
      ],
    );
  },
};

// ─── Row mappers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToContact(row: any): Contact {
  return {
    pubky: row.pubky,
    displayName: row.display_name ?? undefined,
    avatarHash: row.avatar_hash ?? undefined,
    homeserver: row.homeserver ?? undefined,
    trustScore: row.trust_score,
    firstSeenAt: row.first_seen_at,
    lastInteractionAt: row.last_interaction_at ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToThread(row: any): Thread {
  return {
    id: row.id,
    participantPubky: row.participant_pubky,
    lastMessage: row.last_message ?? undefined,
    lastMessageAt: row.last_message_at ?? undefined,
    unreadCount: row.unread_count,
    sb2ContextId: row.noise_context_id ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToChannel(row: any): Channel {
  return {
    id: row.id,
    name: row.name,
    memberCount: row.member_count,
    lastMessage: row.last_message ?? undefined,
    lastMessageAt: row.last_message_at ?? undefined,
    unreadCount: row.unread_count,
    channelInboxPkHex: row.channel_key_base64 ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToChannelMember(row: any): ChannelMember {
  return {
    channelId: row.channel_id,
    pubky: row.pubky,
    joinedAt: row.joined_at,
    displayName: row.display_name ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMessage(row: any): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    channelId: row.channel_id ?? undefined,
    senderPubky: row.sender_pubky,
    recipientPubky: row.recipient_pubky ?? undefined,
    content: row.content,
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status as DeliveryStatus,
    deliveryPath: row.delivery_path ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToQueueItem(row: any): DeliveryQueueItem {
  return {
    id: row.id,
    messageId: row.message_id,
    recipientPubky: row.recipient_pubky,
    payload: row.payload,
    attempts: row.attempts,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
  };
}
