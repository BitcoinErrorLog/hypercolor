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
  MessageRequest,
  MessageRequestStatus,
  PubkyKey,
} from '../types';
import type { SqlExecutor } from '../db/sql';
import type {
  LinkDeliveryState,
  LinkMessage,
  LinkMessageDirection,
  LinkReceiver,
  LinkReceiverInput,
  LinkRecord,
  LinkRecordInput,
  LinkRole,
  LinkStreamItem,
  LinkStreamItemInput,
  StoredLinkStatus,
} from '../types/link';
import type {
  GroupChannel,
  GroupDeferredEvent,
  GroupMember,
  GroupMemberStatus,
  GroupMessage,
} from '../types/group';
import { peekEnvelopeKind } from '../types/group';
import { GROUP_DEFERRED_QUOTA_PER_SENDER, GROUP_DEFERRED_TTL_MS } from '../flags/config';
import type { AttachmentRecord, AttachmentResolveState } from '../types/attachment';
import {
  CHAT_ATTACHMENT_KIND,
  decodePersistedAttachmentEnvelope,
  redactAttachmentRawJson,
} from '../types/attachment';
import type {
  PaymentEventRecord,
  PaymentRequestRecord,
  PaymentStatus,
  TipEndpointRecord,
} from '../types/payment';
import { KeyStore } from './KeyStore';
import { cachePathsForAttachment, deleteCacheFiles } from './attachments/fileIo';

/**
 * StorageService — the single point of access for all SQLite persistence.
 *
 * All methods return plain TypeScript objects; no raw SQLite row shapes leak
 * past this boundary. Timestamps are always Unix milliseconds.
 */

const now = () => Date.now();

function transact(db: SqlExecutor, fn: () => void): void {
  db.executeSync('BEGIN IMMEDIATE');
  try {
    fn();
    db.executeSync('COMMIT');
  } catch (err) {
    try {
      db.executeSync('ROLLBACK');
    } catch {
      // Rollback can fail if the connection already aborted the txn.
    }
    throw err;
  }
}

// ─── Contacts ─────────────────────────────────────────────────────────────

export const StorageService = {
  // ── Contacts ──────────────────────────────────────────────────────────────

  async upsertContact(contact: Contact): Promise<void> {
    const db = await getDb();
    const ts = now();
    db.executeSync(
      `INSERT INTO contacts
        (owner_pubky, pubky, display_name, avatar_hash, homeserver, trust_score,
         is_following, is_follower, is_mutual, added_manually,
         first_seen_at, last_interaction_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_pubky, pubky) DO UPDATE SET
         display_name         = COALESCE(excluded.display_name, display_name),
         avatar_hash          = COALESCE(excluded.avatar_hash, avatar_hash),
         homeserver           = COALESCE(excluded.homeserver, homeserver),
         trust_score          = excluded.trust_score,
         is_following         = MAX(is_following, excluded.is_following),
         is_follower          = MAX(is_follower, excluded.is_follower),
         is_mutual            = MAX(is_mutual, excluded.is_mutual),
         added_manually       = MAX(added_manually, excluded.added_manually),
         last_interaction_at  = COALESCE(excluded.last_interaction_at, last_interaction_at),
         updated_at           = excluded.updated_at`,
      [
        contact.ownerPubky,
        contact.pubky,
        contact.displayName ?? null,
        contact.avatarHash ?? null,
        contact.homeserver ?? null,
        contact.trustScore,
        contact.isFollowing ? 1 : 0,
        contact.isFollower ? 1 : 0,
        contact.isMutual ? 1 : 0,
        contact.addedManually ? 1 : 0,
        contact.firstSeenAt,
        contact.lastInteractionAt ?? null,
        contact.firstSeenAt,
        ts,
      ],
    );
  },

  /**
   * Owner-scoped read. The WoT gate and every account-facing caller MUST pass
   * a non-empty `ownerPubky` — the empty-owner fallback was removed in v6.
   * Omitting owner is a legacy unscoped lookup that only returns a row when
   * exactly one contact exists for that pubky (MessageRouter-era callers).
   */
  async getContact(pubky: PubkyKey, ownerPubky?: PubkyKey): Promise<Contact | null> {
    const db = await getDb();
    if (ownerPubky !== undefined) {
      if (ownerPubky === '') return null;
      const result = db.executeSync(
        'SELECT * FROM contacts WHERE owner_pubky = ? AND pubky = ? LIMIT 1',
        [ownerPubky, pubky],
      );
      const row = result.rows?.[0];
      if (!row) return null;
      return rowToContact(row);
    }
    const result = db.executeSync('SELECT * FROM contacts WHERE pubky = ?', [pubky]);
    const rows = result.rows ?? [];
    const only = rows[0];
    if (rows.length !== 1 || !only) return null;
    return rowToContact(only);
  },

  async getAllContacts(ownerPubky?: PubkyKey): Promise<Contact[]> {
    const db = await getDb();
    if (ownerPubky !== undefined && ownerPubky === '') return [];
    const result =
      ownerPubky !== undefined
        ? db.executeSync(
            `SELECT * FROM contacts
             WHERE owner_pubky = ?
             ORDER BY last_interaction_at DESC`,
            [ownerPubky],
          )
        : db.executeSync('SELECT * FROM contacts ORDER BY last_interaction_at DESC');
    return (result.rows ?? []).map(rowToContact);
  },

  /**
   * Authoritative flag write — used when Nexus following is a complete 200.
   * Unlike upsertContact, this CAN clear is_following / is_follower / is_mutual.
   */
  async setContactRelationshipFlags(
    ownerPubky: PubkyKey,
    pubky: PubkyKey,
    flags: { isFollowing: boolean; isFollower: boolean; isMutual: boolean },
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE contacts
       SET is_following = ?, is_follower = ?, is_mutual = ?, updated_at = ?
       WHERE owner_pubky = ? AND pubky = ?`,
      [
        flags.isFollowing ? 1 : 0,
        flags.isFollower ? 1 : 0,
        flags.isMutual ? 1 : 0,
        now(),
        ownerPubky,
        pubky,
      ],
    );
  },

  async updateTrustScore(pubky: PubkyKey, delta: number, ownerPubky?: PubkyKey): Promise<void> {
    const db = await getDb();
    const ts = now();
    if (ownerPubky !== undefined && ownerPubky !== '') {
      db.executeSync(
        `UPDATE contacts
         SET trust_score = MAX(0.0, MIN(1.0, trust_score + ?)),
             updated_at = ?
         WHERE owner_pubky = ? AND pubky = ?`,
        [delta, ts, ownerPubky, pubky],
      );
      return;
    }
    db.executeSync(
      `UPDATE contacts
       SET trust_score = MAX(0.0, MIN(1.0, trust_score + ?)),
           updated_at = ?
       WHERE pubky = ?
         AND (SELECT COUNT(*) FROM contacts WHERE pubky = ?) = 1`,
      [delta, ts, pubky, pubky],
    );
  },

  async touchContactInteraction(pubky: PubkyKey, ownerPubky?: PubkyKey): Promise<void> {
    const db = await getDb();
    const ts = now();
    if (ownerPubky !== undefined && ownerPubky !== '') {
      db.executeSync(
        `UPDATE contacts
         SET last_interaction_at = ?, updated_at = ?
         WHERE owner_pubky = ? AND pubky = ?`,
        [ts, ts, ownerPubky, pubky],
      );
      return;
    }
    db.executeSync(
      `UPDATE contacts
       SET last_interaction_at = ?, updated_at = ?
       WHERE pubky = ?
         AND (SELECT COUNT(*) FROM contacts WHERE pubky = ?) = 1`,
      [ts, ts, pubky, pubky],
    );
  },

  async countLinkMessagesForPeer(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<number> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT COUNT(*) AS n FROM link_messages
       WHERE owner_pubky = ? AND peer_pubky = ?`,
      [ownerPubky, peerPubky],
    );
    return (result.rows?.[0]?.n as number) ?? 0;
  },

  // ── Message requests (WoT inbound gate) ───────────────────────────────────

  async upsertMessageRequest(request: MessageRequest): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO message_requests
        (owner_pubky, peer_pubky, created_at, updated_at, status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_pubky, peer_pubky) DO UPDATE SET
         status     = CASE
           WHEN message_requests.status = 'declined' THEN message_requests.status
           ELSE excluded.status
         END,
         updated_at = CASE
           WHEN message_requests.status = 'declined' THEN message_requests.updated_at
           ELSE excluded.updated_at
         END`,
      [request.ownerPubky, request.peerPubky, request.createdAt, request.updatedAt, request.status],
    );
  },

  async getMessageRequest(
    ownerPubky: PubkyKey,
    peerPubky: PubkyKey,
  ): Promise<MessageRequest | null> {
    const db = await getDb();
    const result = db.executeSync(
      'SELECT * FROM message_requests WHERE owner_pubky = ? AND peer_pubky = ?',
      [ownerPubky, peerPubky],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToMessageRequest(row);
  },

  async listMessageRequests(
    ownerPubky: PubkyKey,
    status?: MessageRequestStatus,
  ): Promise<MessageRequest[]> {
    const db = await getDb();
    const result =
      status !== undefined
        ? db.executeSync(
            `SELECT * FROM message_requests
             WHERE owner_pubky = ? AND status = ?
             ORDER BY created_at DESC`,
            [ownerPubky, status],
          )
        : db.executeSync(
            `SELECT * FROM message_requests
             WHERE owner_pubky = ?
             ORDER BY created_at DESC`,
            [ownerPubky],
          );
    return (result.rows ?? []).map(rowToMessageRequest);
  },

  async countPendingMessageRequests(ownerPubky: PubkyKey): Promise<number> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT COUNT(*) AS n FROM message_requests
       WHERE owner_pubky = ? AND status = 'pending'`,
      [ownerPubky],
    );
    return (result.rows?.[0]?.n as number) ?? 0;
  },

  async deleteLinkStreamItemsForPeer(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
    const db = await getDb();
    const held =
      db.executeSync(
        `SELECT kind, raw_json FROM link_stream_items
         WHERE owner_pubky = ? AND peer_pubky = ?`,
        [ownerPubky, peerPubky],
      ).rows ?? [];
    const refs: { senderPubky: string; eventId: string }[] = [];
    for (const row of held) {
      const raw = typeof row.raw_json === 'string' ? row.raw_json : '';
      const kind =
        typeof row.kind === 'string' && row.kind.length > 0 ? row.kind : peekEnvelopeKind(raw);
      if (kind !== CHAT_ATTACHMENT_KIND) continue;
      const envelope = decodePersistedAttachmentEnvelope(raw);
      if (envelope) refs.push({ senderPubky: peerPubky, eventId: envelope.event_id });
    }
    if (refs.length > 0 && typeof KeyStore.deleteAttachmentSecrets === 'function') {
      try {
        await KeyStore.deleteAttachmentSecrets(ownerPubky, refs);
      } catch {
        // Decline still drops the stream rows.
      }
    }
    db.executeSync('DELETE FROM link_stream_items WHERE owner_pubky = ? AND peer_pubky = ?', [
      ownerPubky,
      peerPubky,
    ]);
  },

  async deleteLinkMessagesForPeer(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
    const db = await getDb();
    db.executeSync('DELETE FROM link_messages WHERE owner_pubky = ? AND peer_pubky = ?', [
      ownerPubky,
      peerPubky,
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
        persistQueuePayload(item.payload),
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

  async deferQueueItem(id: string, nextRetryAt: number): Promise<void> {
    const db = await getDb();
    db.executeSync('UPDATE delivery_queue SET next_retry_at = ? WHERE id = ?', [nextRetryAt, id]);
  },

  async listDeliveryQueue(): Promise<DeliveryQueueItem[]> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM delivery_queue ORDER BY created_at ASC');
    return (result.rows ?? []).map(rowToQueueItem);
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

  // ── Link receivers (Paykit Encrypted Links) ───────────────────────────────

  async upsertLinkReceiver(receiver: LinkReceiverInput): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO link_receivers
        (owner_pubky, receiver_alias, receiver_path, marker_published, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_pubky) DO UPDATE SET
         receiver_alias   = excluded.receiver_alias,
         receiver_path    = excluded.receiver_path,
         marker_published = excluded.marker_published,
         updated_at       = excluded.updated_at`,
      [
        receiver.ownerPubky,
        receiver.receiverAlias,
        receiver.receiverPath,
        receiver.markerPublished ? 1 : 0,
        now(),
        now(),
      ],
    );
  },

  async getLinkReceiver(ownerPubky: PubkyKey): Promise<LinkReceiver | null> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM link_receivers WHERE owner_pubky = ?', [
      ownerPubky,
    ]);
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToLinkReceiver(row);
  },

  async deleteLinkReceiver(ownerPubky: PubkyKey): Promise<void> {
    const db = await getDb();
    db.executeSync('DELETE FROM link_receivers WHERE owner_pubky = ?', [ownerPubky]);
  },

  // ── Links (Paykit Encrypted Links) ────────────────────────────────────────

  async upsertLink(link: LinkRecordInput): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO links
        (owner_pubky, peer_pubky, role, status, snapshot,
         remote_noise_public_key, local_receiver_path, remote_receiver_path,
         consecutive_failures, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_pubky, peer_pubky) DO UPDATE SET
         role                    = excluded.role,
         status                  = excluded.status,
         snapshot                = excluded.snapshot,
         remote_noise_public_key = excluded.remote_noise_public_key,
         local_receiver_path     = excluded.local_receiver_path,
         remote_receiver_path    = excluded.remote_receiver_path,
         consecutive_failures    = excluded.consecutive_failures,
         updated_at              = excluded.updated_at`,
      [
        link.ownerPubky,
        link.peerPubky,
        link.role,
        link.status,
        link.snapshot,
        link.remoteNoisePublicKey,
        link.localReceiverPath,
        link.remoteReceiverPath,
        link.consecutiveFailures,
        now(),
        now(),
      ],
    );
  },

  async getLink(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<LinkRecord | null> {
    const db = await getDb();
    const result = db.executeSync('SELECT * FROM links WHERE owner_pubky = ? AND peer_pubky = ?', [
      ownerPubky,
      peerPubky,
    ]);
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToLink(row);
  },

  async getAllLinks(ownerPubky: PubkyKey): Promise<LinkRecord[]> {
    const db = await getDb();
    const result = db.executeSync(
      'SELECT * FROM links WHERE owner_pubky = ? ORDER BY updated_at DESC',
      [ownerPubky],
    );
    return (result.rows ?? []).map(rowToLink);
  },

  async updateLinkSnapshot(
    ownerPubky: PubkyKey,
    peerPubky: PubkyKey,
    snapshot: string,
    status: StoredLinkStatus,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE links
       SET snapshot = ?, status = ?, consecutive_failures = 0, updated_at = ?
       WHERE owner_pubky = ? AND peer_pubky = ?`,
      [snapshot, status, now(), ownerPubky, peerPubky],
    );
  },

  async resetLinkConsecutiveFailures(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE links
       SET consecutive_failures = 0, updated_at = ?
       WHERE owner_pubky = ? AND peer_pubky = ?`,
      [now(), ownerPubky, peerPubky],
    );
  },

  async incrementLinkConsecutiveFailures(
    ownerPubky: PubkyKey,
    peerPubky: PubkyKey,
  ): Promise<number> {
    const db = await getDb();
    const ts = now();
    db.executeSync(
      `UPDATE links
       SET consecutive_failures = consecutive_failures + 1, updated_at = ?
       WHERE owner_pubky = ? AND peer_pubky = ?`,
      [ts, ownerPubky, peerPubky],
    );
    const result = db.executeSync(
      'SELECT consecutive_failures FROM links WHERE owner_pubky = ? AND peer_pubky = ?',
      [ownerPubky, peerPubky],
    );
    return (result.rows?.[0]?.consecutive_failures as number) ?? 0;
  },

  async deleteLink(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
    const db = await getDb();
    db.executeSync('DELETE FROM links WHERE owner_pubky = ? AND peer_pubky = ?', [
      ownerPubky,
      peerPubky,
    ]);
  },

  // ── Link messages (Paykit Encrypted Links) ────────────────────────────────

  async saveLinkMessage(message: LinkMessage): Promise<void> {
    const db = await getDb();
    insertLinkMessage(db, message);
  },

  /**
   * Atomic pre-send persist: the `sending` row AND the retry item that
   * carries the exact serialized envelope. Closes the crash window where a
   * row exists with no replayable rawJson (or vice versa).
   */
  async persistLinkSendIntent(input: {
    message: LinkMessage;
    queueItem: DeliveryQueueItem;
  }): Promise<void> {
    const db = await getDb();
    transact(db, () => {
      insertLinkMessage(db, input.message);
      insertQueueItem(db, input.queueItem);
    });
  },

  /**
   * Atomic post-send persist: advanced snapshot + delivery `sent` + dequeue.
   * Native has already used the Noise nonce; this commit is the JS-side
   * checkpoint that `recoverPendingSends` treats as "already sent".
   */
  async finalizeLinkSend(input: {
    ownerPubky: PubkyKey;
    peerPubky: PubkyKey;
    senderPubky: PubkyKey;
    kind: string;
    eventId: string;
    snapshot: string;
    queueId: string;
  }): Promise<void> {
    const db = await getDb();
    const ts = now();
    transact(db, () => {
      db.executeSync(
        `UPDATE link_messages
         SET delivery_state = 'sent', updated_at = ?
         WHERE owner_pubky = ? AND sender_pubky = ? AND kind = ? AND event_id = ?`,
        [ts, input.ownerPubky, input.senderPubky, input.kind, input.eventId],
      );
      if (input.kind === CHAT_ATTACHMENT_KIND) {
        db.executeSync(
          `UPDATE attachments
           SET delivery_state = 'sent', updated_at = ?
           WHERE owner_pubky = ? AND sender_pubky = ? AND event_id = ?`,
          [ts, input.ownerPubky, input.senderPubky, input.eventId],
        );
      }
      db.executeSync(
        `UPDATE links
         SET snapshot = ?, status = 'established', consecutive_failures = 0, updated_at = ?
         WHERE owner_pubky = ? AND peer_pubky = ?`,
        [input.snapshot, ts, input.ownerPubky, input.peerPubky],
      );
      db.executeSync('DELETE FROM delivery_queue WHERE id = ?', [input.queueId]);
    });
  },

  async hasLinkMessage(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    kind: string,
    eventId: string,
  ): Promise<boolean> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT 1 FROM link_messages
       WHERE owner_pubky = ? AND sender_pubky = ? AND kind = ? AND event_id = ?
       LIMIT 1`,
      [ownerPubky, senderPubky, kind, eventId],
    );
    return (result.rows?.length ?? 0) > 0;
  },

  async getLinkMessage(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    kind: string,
    eventId: string,
  ): Promise<LinkMessage | null> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM link_messages
       WHERE owner_pubky = ? AND sender_pubky = ? AND kind = ? AND event_id = ?`,
      [ownerPubky, senderPubky, kind, eventId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToLinkMessage(row);
  },

  async getLinkMessagesForConversation(
    ownerPubky: PubkyKey,
    conversationId: string,
    limit = 50,
    beforeMs?: number,
  ): Promise<LinkMessage[]> {
    const db = await getDb();
    const result =
      beforeMs !== undefined
        ? db.executeSync(
            `SELECT * FROM link_messages
             WHERE owner_pubky = ? AND conversation_id = ? AND sent_at < ?
             ORDER BY sent_at DESC LIMIT ?`,
            [ownerPubky, conversationId, beforeMs, limit],
          )
        : db.executeSync(
            `SELECT * FROM link_messages
             WHERE owner_pubky = ? AND conversation_id = ?
             ORDER BY sent_at DESC LIMIT ?`,
            [ownerPubky, conversationId, limit],
          );
    return (result.rows ?? []).map(rowToLinkMessage).reverse();
  },

  async updateLinkMessageDeliveryState(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    kind: string,
    eventId: string,
    state: LinkDeliveryState,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE link_messages
       SET delivery_state = ?, updated_at = ?
       WHERE owner_pubky = ? AND sender_pubky = ? AND kind = ? AND event_id = ?`,
      [state, now(), ownerPubky, senderPubky, kind, eventId],
    );
  },

  // ── Link stream items (inbound raw, before snapshot) ──────────────────────

  async saveLinkStreamItems(items: LinkStreamItemInput[]): Promise<void> {
    if (items.length === 0) return;
    const db = await getDb();
    transact(db, () => {
      for (const item of items) {
        db.executeSync(
          `INSERT OR IGNORE INTO link_stream_items
            (id, owner_pubky, peer_pubky, kind, raw_json, received_at, processed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            item.id,
            item.ownerPubky,
            item.peerPubky,
            item.kind,
            persistRawJson(item.kind, item.rawJson),
            item.receivedAt,
            item.receivedAt,
          ],
        );
      }
    });
  },

  async getUnprocessedLinkStreamItems(
    ownerPubky: PubkyKey,
    peerPubky: PubkyKey,
  ): Promise<LinkStreamItem[]> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM link_stream_items
       WHERE owner_pubky = ? AND peer_pubky = ? AND processed = 0
       ORDER BY received_at ASC, rowid ASC`,
      [ownerPubky, peerPubky],
    );
    return (result.rows ?? []).map(rowToLinkStreamItem);
  },

  async markLinkStreamItemProcessed(id: string): Promise<void> {
    const db = await getDb();
    db.executeSync('UPDATE link_stream_items SET processed = 1 WHERE id = ?', [id]);
  },

  // ── Link read cursors (Paykit Encrypted Links) ────────────────────────────

  async getLinkReadCursor(ownerPubky: PubkyKey, conversationId: string): Promise<number | null> {
    const db = await getDb();
    const result = db.executeSync(
      'SELECT last_read_at FROM link_read_cursors WHERE owner_pubky = ? AND conversation_id = ?',
      [ownerPubky, conversationId],
    );
    const value = result.rows?.[0]?.last_read_at;
    return typeof value === 'number' ? value : null;
  },

  async setLinkReadCursor(
    ownerPubky: PubkyKey,
    conversationId: string,
    lastReadAt: number,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO link_read_cursors (owner_pubky, conversation_id, last_read_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_pubky, conversation_id) DO UPDATE SET
         last_read_at = MAX(last_read_at, excluded.last_read_at),
         updated_at   = excluded.updated_at`,
      [ownerPubky, conversationId, lastReadAt, now()],
    );
  },

  /**
   * Sign-out teardown: collect KeyStore/cache targets first, attempt those
   * deletes, journal any failed key deletions, then drop SQL rows.
   */
  async clearAccountData(ownerPubky: PubkyKey): Promise<void> {
    const db = await getDb();
    const attachmentRows =
      db.executeSync(
        `SELECT event_id, sender_pubky, key_ref, local_cache_path
         FROM attachments WHERE owner_pubky = ?`,
        [ownerPubky],
      ).rows ?? [];
    const refs = attachmentRows.map(row => ({
      senderPubky: String(row.sender_pubky),
      eventId: String(row.event_id),
    }));
    const cachePaths = attachmentRows.flatMap(row =>
      cachePathsForAttachment({
        ownerPubky,
        senderPubky: String(row.sender_pubky),
        eventId: String(row.event_id),
        localCachePath: typeof row.local_cache_path === 'string' ? row.local_cache_path : null,
      }),
    );

    const ownerQueueIds: string[] = [];
    for (const item of await StorageService.listDeliveryQueue()) {
      if (queuePayloadBelongsToOwner(item.payload, ownerPubky)) {
        ownerQueueIds.push(item.id);
      }
    }

    const failedServices: string[] = [];
    try {
      if (typeof KeyStore.deleteAttachmentSecrets === 'function') {
        const deleted = await KeyStore.deleteAttachmentSecrets(ownerPubky, refs);
        if (Array.isArray(deleted)) failedServices.push(...deleted);
      }
      if (typeof KeyStore.clearAttachmentSecretsForOwner === 'function') {
        const leftover = await KeyStore.clearAttachmentSecretsForOwner(ownerPubky);
        if (Array.isArray(leftover)) failedServices.push(...leftover);
      }
    } catch {
      // Keychain is unavailable in some unit tests.
    }
    try {
      await deleteCacheFiles(cachePaths);
    } catch {
      // Cache wipe is best-effort.
    }

    const ts = now();
    transact(db, () => {
      for (const service of [...new Set(failedServices)]) {
        db.executeSync(
          `INSERT OR IGNORE INTO pending_cleanup
            (owner_pubky, target_kind, target, created_at)
           VALUES (?, 'keystore', ?, ?)`,
          [ownerPubky, service, ts],
        );
      }
      for (const id of ownerQueueIds) {
        db.executeSync('DELETE FROM delivery_queue WHERE id = ?', [id]);
      }
      db.executeSync('DELETE FROM attachments WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM payment_events WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM payment_requests WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM tip_endpoints WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM group_deferred_events WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM group_seen_events WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM group_messages WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM group_members WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM group_channels WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM link_stream_items WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM link_messages WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM link_read_cursors WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM links WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM link_receivers WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM message_requests WHERE owner_pubky = ?', [ownerPubky]);
      db.executeSync('DELETE FROM contacts WHERE owner_pubky = ?', [ownerPubky]);
    });
  },

  async retryPendingCleanup(): Promise<void> {
    const db = await getDb();
    const rows =
      db.executeSync('SELECT owner_pubky, target_kind, target FROM pending_cleanup').rows ?? [];
    for (const row of rows) {
      const ownerPubky = String(row.owner_pubky);
      const targetKind = String(row.target_kind);
      const target = String(row.target);
      let ok = false;
      if (
        targetKind === 'keystore' &&
        typeof KeyStore.deleteAttachmentSecretByService === 'function'
      ) {
        try {
          ok = (await KeyStore.deleteAttachmentSecretByService(ownerPubky, target)) === true;
        } catch {
          ok = false;
        }
      } else if (targetKind === 'cache') {
        try {
          await deleteCacheFiles([target]);
          ok = true;
        } catch {
          ok = false;
        }
      }
      if (ok) {
        db.executeSync(
          `DELETE FROM pending_cleanup
           WHERE owner_pubky = ? AND target_kind = ? AND target = ?`,
          [ownerPubky, targetKind, target],
        );
      }
    }
  },

  // ── Attachments (M4) ──────────────────────────────────────────────────────

  async saveAttachment(record: AttachmentRecord): Promise<void> {
    const db = await getDb();
    insertAttachment(db, record);
  },

  async getAttachment(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<AttachmentRecord | null> {
    const db = await getDb();
    const result = db.executeSync(
      'SELECT * FROM attachments WHERE owner_pubky = ? AND sender_pubky = ? AND event_id = ?',
      [ownerPubky, senderPubky, eventId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToAttachment(row);
  },

  async hasAttachment(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<boolean> {
    const db = await getDb();
    const result = db.executeSync(
      'SELECT 1 FROM attachments WHERE owner_pubky = ? AND sender_pubky = ? AND event_id = ? LIMIT 1',
      [ownerPubky, senderPubky, eventId],
    );
    return (result.rows?.length ?? 0) > 0;
  },

  async listAttachmentsForConversation(
    ownerPubky: PubkyKey,
    conversationId: string,
  ): Promise<AttachmentRecord[]> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM attachments
       WHERE owner_pubky = ? AND conversation_id = ?
       ORDER BY created_at ASC`,
      [ownerPubky, conversationId],
    );
    return (result.rows ?? []).map(rowToAttachment);
  },

  async listAttachmentsForChannel(
    ownerPubky: PubkyKey,
    channelId: string,
  ): Promise<AttachmentRecord[]> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM attachments
       WHERE owner_pubky = ? AND channel_id = ?
       ORDER BY created_at ASC`,
      [ownerPubky, channelId],
    );
    return (result.rows ?? []).map(rowToAttachment);
  },

  async updateAttachmentResolve(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    eventId: string,
    patch: { resolveState: AttachmentResolveState; localCachePath?: string | null },
  ): Promise<void> {
    const db = await getDb();
    if (patch.localCachePath !== undefined) {
      db.executeSync(
        `UPDATE attachments
         SET resolve_state = ?, local_cache_path = ?, updated_at = ?
         WHERE owner_pubky = ? AND sender_pubky = ? AND event_id = ?`,
        [patch.resolveState, patch.localCachePath, now(), ownerPubky, senderPubky, eventId],
      );
      return;
    }
    db.executeSync(
      `UPDATE attachments
       SET resolve_state = ?, updated_at = ?
       WHERE owner_pubky = ? AND sender_pubky = ? AND event_id = ?`,
      [patch.resolveState, now(), ownerPubky, senderPubky, eventId],
    );
  },

  async updateAttachmentDelivery(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    eventId: string,
    deliveryState: AttachmentRecord['deliveryState'],
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE attachments
       SET delivery_state = ?, updated_at = ?
       WHERE owner_pubky = ? AND sender_pubky = ? AND event_id = ?`,
      [deliveryState, now(), ownerPubky, senderPubky, eventId],
    );
  },

  // ── Group channels (M3, owner-scoped) ─────────────────────────────────────

  async upsertGroupChannel(channel: GroupChannel): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO group_channels
        (owner_pubky, channel_id, name, created_at, updated_at, created_by,
         is_public, last_message_at, membership_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_pubky, channel_id) DO UPDATE SET
         name              = excluded.name,
         updated_at        = excluded.updated_at,
         last_message_at   = excluded.last_message_at`,
      [
        channel.ownerPubky,
        channel.channelId,
        channel.name,
        channel.createdAt,
        channel.updatedAt,
        channel.createdBy,
        channel.isPublic ? 1 : 0,
        channel.lastMessageAt,
        channel.membershipEpoch,
      ],
    );
  },

  /**
   * Insert a private-group channel only if absent. Never overwrites
   * founder/admin metadata. Members are written in the same transaction.
   */
  async insertInboundPrivateCreate(input: {
    channel: GroupChannel;
    members: GroupMember[];
  }): Promise<'inserted' | 'exists' | 'founder-mismatch'> {
    const db = await getDb();
    let outcome: 'inserted' | 'exists' | 'founder-mismatch' = 'exists';
    transact(db, () => {
      const existing = db.executeSync(
        'SELECT created_by FROM group_channels WHERE owner_pubky = ? AND channel_id = ?',
        [input.channel.ownerPubky, input.channel.channelId],
      ).rows?.[0];
      if (existing) {
        outcome = existing.created_by === input.channel.createdBy ? 'exists' : 'founder-mismatch';
        return;
      }
      db.executeSync(
        `INSERT INTO group_channels
          (owner_pubky, channel_id, name, created_at, updated_at, created_by,
           is_public, last_message_at, membership_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.channel.ownerPubky,
          input.channel.channelId,
          input.channel.name,
          input.channel.createdAt,
          input.channel.updatedAt,
          input.channel.createdBy,
          input.channel.isPublic ? 1 : 0,
          input.channel.lastMessageAt,
          input.channel.membershipEpoch,
        ],
      );
      for (const member of input.members) {
        upsertGroupMemberRow(db, member);
      }
      outcome = 'inserted';
    });
    return outcome;
  },

  async updateGroupChannelName(
    ownerPubky: PubkyKey,
    channelId: string,
    name: string,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE group_channels
       SET name = ?, updated_at = ?
       WHERE owner_pubky = ? AND channel_id = ?`,
      [name, now(), ownerPubky, channelId],
    );
  },

  async getGroupChannel(ownerPubky: PubkyKey, channelId: string): Promise<GroupChannel | null> {
    const db = await getDb();
    const result = db.executeSync(
      'SELECT * FROM group_channels WHERE owner_pubky = ? AND channel_id = ?',
      [ownerPubky, channelId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToGroupChannel(row);
  },

  async listGroupChannels(ownerPubky: PubkyKey): Promise<GroupChannel[]> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM group_channels
       WHERE owner_pubky = ?
       ORDER BY last_message_at DESC, updated_at DESC`,
      [ownerPubky],
    );
    return (result.rows ?? []).map(rowToGroupChannel);
  },

  async touchGroupChannel(
    ownerPubky: PubkyKey,
    channelId: string,
    lastMessageAt: number,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE group_channels
       SET last_message_at = ?, updated_at = ?
       WHERE owner_pubky = ? AND channel_id = ?`,
      [lastMessageAt, now(), ownerPubky, channelId],
    );
  },

  async bumpGroupMembershipEpoch(ownerPubky: PubkyKey, channelId: string): Promise<number> {
    const db = await getDb();
    const ts = now();
    db.executeSync(
      `UPDATE group_channels
       SET membership_epoch = membership_epoch + 1, updated_at = ?
       WHERE owner_pubky = ? AND channel_id = ?`,
      [ts, ownerPubky, channelId],
    );
    const result = db.executeSync(
      'SELECT membership_epoch FROM group_channels WHERE owner_pubky = ? AND channel_id = ?',
      [ownerPubky, channelId],
    );
    return (result.rows?.[0]?.membership_epoch as number) ?? 0;
  },

  async upsertGroupMember(member: GroupMember): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT INTO group_members
        (owner_pubky, channel_id, member_pubky, role, added_at, removed_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_pubky, channel_id, member_pubky) DO UPDATE SET
         role        = excluded.role,
         added_at    = excluded.added_at,
         removed_at  = excluded.removed_at,
         status      = excluded.status`,
      [
        member.ownerPubky,
        member.channelId,
        member.memberPubky,
        member.role,
        member.addedAt,
        member.removedAt,
        member.status,
      ],
    );
  },

  async getGroupMember(
    ownerPubky: PubkyKey,
    channelId: string,
    memberPubky: PubkyKey,
  ): Promise<GroupMember | null> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM group_members
       WHERE owner_pubky = ? AND channel_id = ? AND member_pubky = ?`,
      [ownerPubky, channelId, memberPubky],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToGroupMember(row);
  },

  async listGroupMembers(
    ownerPubky: PubkyKey,
    channelId: string,
    status?: GroupMemberStatus,
  ): Promise<GroupMember[]> {
    const db = await getDb();
    const result =
      status !== undefined
        ? db.executeSync(
            `SELECT * FROM group_members
             WHERE owner_pubky = ? AND channel_id = ? AND status = ?
             ORDER BY added_at ASC`,
            [ownerPubky, channelId, status],
          )
        : db.executeSync(
            `SELECT * FROM group_members
             WHERE owner_pubky = ? AND channel_id = ?
             ORDER BY added_at ASC`,
            [ownerPubky, channelId],
          );
    return (result.rows ?? []).map(rowToGroupMember);
  },

  async countActiveGroupMembers(ownerPubky: PubkyKey, channelId: string): Promise<number> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT COUNT(*) AS n FROM group_members
       WHERE owner_pubky = ? AND channel_id = ? AND status = 'active'`,
      [ownerPubky, channelId],
    );
    return (result.rows?.[0]?.n as number) ?? 0;
  },

  async saveGroupMessage(message: GroupMessage): Promise<boolean> {
    const db = await getDb();
    const existed = await this.hasGroupMessage(
      message.ownerPubky,
      message.channelId,
      message.senderPubky,
      message.eventId,
    );
    if (existed) return false;
    insertGroupMessage(db, message);
    return true;
  },

  async hasGroupMessage(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<boolean> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT 1 FROM group_messages
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?
       LIMIT 1`,
      [ownerPubky, channelId, senderPubky, eventId],
    );
    return (result.rows?.length ?? 0) > 0;
  },

  async getGroupMessage(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<GroupMessage | null> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM group_messages
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?`,
      [ownerPubky, channelId, senderPubky, eventId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToGroupMessage(row);
  },

  async findGroupMessageByAuthorEvent(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<GroupMessage | null> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM group_messages
       WHERE owner_pubky = ? AND sender_pubky = ? AND event_id = ?
       LIMIT 1`,
      [ownerPubky, senderPubky, eventId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return rowToGroupMessage(row);
  },

  async hasGroupEvent(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<boolean> {
    if (await this.hasGroupMessage(ownerPubky, channelId, senderPubky, eventId)) return true;
    const db = await getDb();
    const seen = db.executeSync(
      `SELECT 1 FROM group_seen_events
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?
       LIMIT 1`,
      [ownerPubky, channelId, senderPubky, eventId],
    );
    if ((seen.rows?.length ?? 0) > 0) return true;
    const deferred = db.executeSync(
      `SELECT 1 FROM group_deferred_events
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?
       LIMIT 1`,
      [ownerPubky, channelId, senderPubky, eventId],
    );
    return (deferred.rows?.length ?? 0) > 0;
  },

  async markGroupEventSeen(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
    eventId: string,
    receivedAt: number,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT OR IGNORE INTO group_seen_events
        (owner_pubky, channel_id, sender_pubky, event_id, received_at)
       VALUES (?, ?, ?, ?, ?)`,
      [ownerPubky, channelId, senderPubky, eventId, receivedAt],
    );
  },

  async hasGroupEventSeen(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<boolean> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT 1 FROM group_seen_events
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?
       LIMIT 1`,
      [ownerPubky, channelId, senderPubky, eventId],
    );
    return (result.rows?.length ?? 0) > 0;
  },

  async saveGroupDeferred(event: GroupDeferredEvent): Promise<void> {
    const db = await getDb();
    const cutoff = now() - GROUP_DEFERRED_TTL_MS;
    transact(db, () => {
      const expired = db.executeSync(
        `SELECT sender_pubky, event_id, received_at FROM group_deferred_events
         WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND received_at < ?`,
        [event.ownerPubky, event.channelId, event.senderPubky, cutoff],
      );
      for (const row of expired.rows ?? []) {
        db.executeSync(
          `INSERT OR IGNORE INTO group_seen_events
            (owner_pubky, channel_id, sender_pubky, event_id, received_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            event.ownerPubky,
            event.channelId,
            row.sender_pubky as string,
            row.event_id as string,
            row.received_at as number,
          ],
        );
      }
      db.executeSync(
        `DELETE FROM group_deferred_events
         WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND received_at < ?`,
        [event.ownerPubky, event.channelId, event.senderPubky, cutoff],
      );

      for (;;) {
        const countRow = db.executeSync(
          `SELECT COUNT(*) AS n FROM group_deferred_events
           WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ?`,
          [event.ownerPubky, event.channelId, event.senderPubky],
        ).rows?.[0];
        const count = (countRow?.n as number) ?? 0;
        if (count < GROUP_DEFERRED_QUOTA_PER_SENDER) break;
        const oldest = db.executeSync(
          `SELECT event_id, received_at FROM group_deferred_events
           WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ?
           ORDER BY received_at ASC, sent_at ASC
           LIMIT 1`,
          [event.ownerPubky, event.channelId, event.senderPubky],
        ).rows?.[0];
        if (!oldest) break;
        db.executeSync(
          `INSERT OR IGNORE INTO group_seen_events
            (owner_pubky, channel_id, sender_pubky, event_id, received_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            event.ownerPubky,
            event.channelId,
            event.senderPubky,
            oldest.event_id as string,
            oldest.received_at as number,
          ],
        );
        db.executeSync(
          `DELETE FROM group_deferred_events
           WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?`,
          [event.ownerPubky, event.channelId, event.senderPubky, oldest.event_id as string],
        );
      }

      db.executeSync(
        `INSERT OR IGNORE INTO group_deferred_events
          (owner_pubky, channel_id, sender_pubky, event_id, kind, body, raw_json,
           sent_at, received_at, target_event_id, target_author_pubky)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.ownerPubky,
          event.channelId,
          event.senderPubky,
          event.eventId,
          event.kind,
          event.body,
          event.rawJson,
          event.sentAt,
          event.receivedAt,
          event.targetEventId,
          event.targetAuthorPubky,
        ],
      );
    });
  },

  async listGroupDeferredForTarget(
    ownerPubky: PubkyKey,
    channelId: string,
    targetAuthorPubky: PubkyKey,
    targetEventId: string,
  ): Promise<GroupDeferredEvent[]> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM group_deferred_events
       WHERE owner_pubky = ? AND channel_id = ? AND target_author_pubky = ? AND target_event_id = ?
       ORDER BY sent_at ASC`,
      [ownerPubky, channelId, targetAuthorPubky, targetEventId],
    );
    return (result.rows ?? []).map(rowToGroupDeferred);
  },

  async listGroupDeferredForSender(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
  ): Promise<GroupDeferredEvent[]> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM group_deferred_events
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ?
       ORDER BY received_at ASC, sent_at ASC`,
      [ownerPubky, channelId, senderPubky],
    );
    return (result.rows ?? []).map(rowToGroupDeferred);
  },

  async deleteGroupDeferred(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `DELETE FROM group_deferred_events
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?`,
      [ownerPubky, channelId, senderPubky, eventId],
    );
  },

  async listGroupMessages(
    ownerPubky: PubkyKey,
    channelId: string,
    limit = 100,
    beforeMs?: number,
  ): Promise<GroupMessage[]> {
    const db = await getDb();
    const result =
      beforeMs !== undefined
        ? db.executeSync(
            `SELECT * FROM group_messages
             WHERE owner_pubky = ? AND channel_id = ? AND sent_at < ?
             ORDER BY sent_at DESC LIMIT ?`,
            [ownerPubky, channelId, beforeMs, limit],
          )
        : db.executeSync(
            `SELECT * FROM group_messages
             WHERE owner_pubky = ? AND channel_id = ?
             ORDER BY sent_at DESC LIMIT ?`,
            [ownerPubky, channelId, limit],
          );
    return (result.rows ?? []).map(rowToGroupMessage).reverse();
  },

  async listGroupMessagesForTarget(
    ownerPubky: PubkyKey,
    channelId: string,
    targetAuthorPubky: PubkyKey,
    targetEventId: string,
  ): Promise<GroupMessage[]> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM group_messages
       WHERE owner_pubky = ? AND channel_id = ? AND target_author_pubky = ? AND target_event_id = ?
       ORDER BY sent_at ASC`,
      [ownerPubky, channelId, targetAuthorPubky, targetEventId],
    );
    return (result.rows ?? []).map(rowToGroupMessage);
  },

  async updateGroupMessageDeliveryState(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
    eventId: string,
    state: LinkDeliveryState,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE group_messages
       SET delivery_state = ?, updated_at = ?
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?`,
      [state, now(), ownerPubky, channelId, senderPubky, eventId],
    );
  },

  async applyGroupMessageEdit(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
    eventId: string,
    body: string,
    editedAt: number,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE group_messages
       SET body = ?, edited_at = ?, updated_at = ?
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?`,
      [body, editedAt, now(), ownerPubky, channelId, senderPubky, eventId],
    );
  },

  async tombstoneGroupMessage(
    ownerPubky: PubkyKey,
    channelId: string,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE group_messages
       SET deleted = 1, updated_at = ?
       WHERE owner_pubky = ? AND channel_id = ? AND sender_pubky = ? AND event_id = ?`,
      [now(), ownerPubky, channelId, senderPubky, eventId],
    );
  },

  /**
   * Atomic pre-fan-out persist: the group message row AND one retry item
   * per recipient, before any native send.
   */
  async persistGroupSendIntent(input: {
    message: GroupMessage;
    queueItems: DeliveryQueueItem[];
  }): Promise<void> {
    const db = await getDb();
    transact(db, () => {
      insertGroupMessage(db, input.message);
      for (const item of input.queueItems) {
        insertQueueItem(db, item);
      }
    });
  },

  /**
   * Post-send persist for one fan-out recipient: advanced snapshot + dequeue.
   * Does not rewrite `group_messages.delivery_state` (that is settled after
   * the remaining queue for this event_id is empty).
   */
  async finalizeGroupFanoutSend(input: {
    ownerPubky: PubkyKey;
    peerPubky: PubkyKey;
    snapshot: string;
    queueId: string;
  }): Promise<void> {
    const db = await getDb();
    const ts = now();
    transact(db, () => {
      db.executeSync(
        `UPDATE links
         SET snapshot = ?, status = 'established', consecutive_failures = 0, updated_at = ?
         WHERE owner_pubky = ? AND peer_pubky = ?`,
        [input.snapshot, ts, input.ownerPubky, input.peerPubky],
      );
      db.executeSync('DELETE FROM delivery_queue WHERE id = ?', [input.queueId]);
    });
  },

  async countDeliveryQueueForMessage(messageId: string): Promise<number> {
    const db = await getDb();
    const result = db.executeSync('SELECT COUNT(*) AS n FROM delivery_queue WHERE message_id = ?', [
      messageId,
    ]);
    return (result.rows?.[0]?.n as number) ?? 0;
  },

  // ── Payments (M5) ─────────────────────────────────────────────────────────

  async savePaymentRequest(record: PaymentRequestRecord): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `INSERT OR IGNORE INTO payment_requests
        (owner_pubky, peer_pubky, direction, payment_request_id, event_id,
         amount_value, amount_asset, payment_reference, endpoint_ids, expires_at,
         status, created_at, updated_at, proof_json, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.ownerPubky,
        record.peerPubky,
        record.direction,
        record.paymentRequestId,
        record.eventId,
        record.amountValue,
        record.amountAsset,
        record.paymentReference,
        JSON.stringify(record.endpointIds),
        record.expiresAt,
        record.status,
        record.createdAt,
        record.updatedAt,
        record.proofJson,
        record.reason,
      ],
    );
  },

  async getPaymentRequest(
    ownerPubky: PubkyKey,
    peerPubky: PubkyKey,
    paymentRequestId: string,
  ): Promise<PaymentRequestRecord | null> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM payment_requests
       WHERE owner_pubky = ? AND peer_pubky = ? AND payment_request_id = ?`,
      [ownerPubky, peerPubky, paymentRequestId],
    );
    const row = result.rows?.[0];
    return row ? rowToPaymentRequest(row) : null;
  },

  async listPaymentRequestsForPeer(
    ownerPubky: PubkyKey,
    peerPubky: PubkyKey,
  ): Promise<PaymentRequestRecord[]> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM payment_requests
       WHERE owner_pubky = ? AND peer_pubky = ?
       ORDER BY created_at ASC`,
      [ownerPubky, peerPubky],
    );
    return (result.rows ?? []).map(rowToPaymentRequest);
  },

  async updatePaymentRequest(
    ownerPubky: PubkyKey,
    peerPubky: PubkyKey,
    paymentRequestId: string,
    patch: {
      status: PaymentStatus;
      proofJson?: string | null;
      reason?: string | null;
    },
  ): Promise<void> {
    const db = await getDb();
    db.executeSync(
      `UPDATE payment_requests
       SET status = ?, proof_json = COALESCE(?, proof_json),
           reason = COALESCE(?, reason), updated_at = ?
       WHERE owner_pubky = ? AND peer_pubky = ? AND payment_request_id = ?`,
      [
        patch.status,
        patch.proofJson === undefined ? null : patch.proofJson,
        patch.reason === undefined ? null : patch.reason,
        now(),
        ownerPubky,
        peerPubky,
        paymentRequestId,
      ],
    );
  },

  async savePaymentEvent(record: PaymentEventRecord): Promise<boolean> {
    const db = await getDb();
    const before = db.executeSync(
      `SELECT 1 FROM payment_events
       WHERE owner_pubky = ? AND conversation_id = ? AND sender_pubky = ? AND event_id = ?`,
      [record.ownerPubky, record.conversationId, record.senderPubky, record.eventId],
    );
    if ((before.rows?.length ?? 0) > 0) return false;
    db.executeSync(
      `INSERT OR IGNORE INTO payment_events
        (owner_pubky, conversation_id, sender_pubky, event_id, kind,
         payment_request_id, applied, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.ownerPubky,
        record.conversationId,
        record.senderPubky,
        record.eventId,
        record.kind,
        record.paymentRequestId,
        record.applied ? 1 : 0,
        record.receivedAt,
      ],
    );
    return true;
  },

  async hasPaymentEvent(
    ownerPubky: PubkyKey,
    conversationId: string,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<boolean> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT 1 FROM payment_events
       WHERE owner_pubky = ? AND conversation_id = ? AND sender_pubky = ? AND event_id = ?
       LIMIT 1`,
      [ownerPubky, conversationId, senderPubky, eventId],
    );
    return (result.rows?.length ?? 0) > 0;
  },

  async replaceTipEndpoints(
    ownerPubky: PubkyKey,
    peerPubky: PubkyKey,
    endpoints: readonly { identifier: string; payload: string }[],
    updatedAt: number,
  ): Promise<void> {
    const db = await getDb();
    transact(db, () => {
      db.executeSync('DELETE FROM tip_endpoints WHERE owner_pubky = ? AND peer_pubky = ?', [
        ownerPubky,
        peerPubky,
      ]);
      for (const endpoint of endpoints) {
        db.executeSync(
          `INSERT INTO tip_endpoints (owner_pubky, peer_pubky, identifier, payload, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [ownerPubky, peerPubky, endpoint.identifier, endpoint.payload, updatedAt],
        );
      }
    });
  },

  async listTipEndpoints(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<TipEndpointRecord[]> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT * FROM tip_endpoints
       WHERE owner_pubky = ? AND peer_pubky = ?
       ORDER BY identifier ASC`,
      [ownerPubky, peerPubky],
    );
    return (result.rows ?? []).map(rowToTipEndpoint);
  },
};

// ─── Row mappers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToContact(row: any): Contact {
  const contact: Contact = {
    pubky: row.pubky,
    ownerPubky: typeof row.owner_pubky === 'string' ? row.owner_pubky : '',
    trustScore: row.trust_score,
    isFollowing: row.is_following === 1,
    isFollower: row.is_follower === 1,
    isMutual: row.is_mutual === 1,
    addedManually: row.added_manually === 1,
    firstSeenAt: row.first_seen_at,
  };
  if (row.display_name) contact.displayName = row.display_name;
  if (row.avatar_hash) contact.avatarHash = row.avatar_hash;
  if (row.homeserver) contact.homeserver = row.homeserver;
  if (row.last_interaction_at != null) contact.lastInteractionAt = row.last_interaction_at;
  return contact;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMessageRequest(row: any): MessageRequest {
  return {
    ownerPubky: row.owner_pubky,
    peerPubky: row.peer_pubky,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status as MessageRequestStatus,
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

function insertQueueItem(db: SqlExecutor, item: DeliveryQueueItem): void {
  db.executeSync(
    `INSERT OR REPLACE INTO delivery_queue
      (id, message_id, recipient_pubky, payload, attempts, next_retry_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.messageId,
      item.recipientPubky,
      persistQueuePayload(item.payload),
      item.attempts,
      item.nextRetryAt,
      item.createdAt,
    ],
  );
}

function insertLinkMessage(db: SqlExecutor, message: LinkMessage): void {
  const ts = now();
  db.executeSync(
    `INSERT OR IGNORE INTO link_messages
      (owner_pubky, sender_pubky, kind, event_id, conversation_id, peer_pubky,
       direction, raw_json, body, sent_at, received_at, delivery_state,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.ownerPubky,
      message.senderPubky,
      message.kind,
      message.eventId,
      message.conversationId,
      message.peerPubky,
      message.direction,
      persistRawJson(message.kind, message.rawJson),
      message.body,
      message.sentAt,
      message.receivedAt,
      message.deliveryState,
      ts,
      ts,
    ],
  );
  db.executeSync(
    `UPDATE contacts
     SET last_interaction_at = ?, updated_at = ?
     WHERE owner_pubky = ? AND pubky = ?`,
    [ts, ts, message.ownerPubky, message.peerPubky],
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToLinkReceiver(row: any): LinkReceiver {
  return {
    ownerPubky: row.owner_pubky,
    receiverAlias: row.receiver_alias,
    receiverPath: row.receiver_path,
    markerPublished: row.marker_published === 1,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToLink(row: any): LinkRecord {
  return {
    ownerPubky: row.owner_pubky,
    peerPubky: row.peer_pubky,
    role: row.role as LinkRole,
    status: row.status as StoredLinkStatus,
    snapshot: row.snapshot,
    remoteNoisePublicKey: row.remote_noise_public_key,
    localReceiverPath: row.local_receiver_path,
    remoteReceiverPath: row.remote_receiver_path,
    consecutiveFailures: row.consecutive_failures,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToLinkMessage(row: any): LinkMessage {
  return {
    ownerPubky: row.owner_pubky,
    eventId: row.event_id,
    conversationId: row.conversation_id,
    peerPubky: row.peer_pubky,
    senderPubky: row.sender_pubky,
    direction: row.direction as LinkMessageDirection,
    kind: row.kind,
    rawJson: row.raw_json,
    body: row.body,
    sentAt: row.sent_at,
    receivedAt: row.received_at ?? null,
    deliveryState: row.delivery_state as LinkDeliveryState,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToLinkStreamItem(row: any): LinkStreamItem {
  return {
    id: row.id,
    ownerPubky: row.owner_pubky,
    peerPubky: row.peer_pubky,
    kind: row.kind ?? null,
    rawJson: row.raw_json,
    receivedAt: row.received_at,
    processed: row.processed === 1,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToGroupChannel(row: any): GroupChannel {
  return {
    ownerPubky: row.owner_pubky,
    channelId: row.channel_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    isPublic: row.is_public === 1,
    lastMessageAt: row.last_message_at ?? null,
    membershipEpoch: row.membership_epoch,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToGroupMember(row: any): GroupMember {
  return {
    ownerPubky: row.owner_pubky,
    channelId: row.channel_id,
    memberPubky: row.member_pubky,
    role: row.role,
    addedAt: row.added_at,
    removedAt: row.removed_at ?? null,
    status: row.status,
  };
}

function upsertGroupMemberRow(db: SqlExecutor, member: GroupMember): void {
  db.executeSync(
    `INSERT INTO group_members
      (owner_pubky, channel_id, member_pubky, role, added_at, removed_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_pubky, channel_id, member_pubky) DO UPDATE SET
       role        = CASE WHEN group_members.role = 'admin' THEN 'admin' ELSE excluded.role END,
       added_at    = CASE WHEN group_members.status = 'active' THEN group_members.added_at ELSE excluded.added_at END,
       removed_at  = excluded.removed_at,
       status      = excluded.status`,
    [
      member.ownerPubky,
      member.channelId,
      member.memberPubky,
      member.role,
      member.addedAt,
      member.removedAt,
      member.status,
    ],
  );
}

function insertGroupMessage(db: SqlExecutor, message: GroupMessage): void {
  const ts = now();
  db.executeSync(
    `INSERT OR IGNORE INTO group_messages
      (owner_pubky, channel_id, sender_pubky, event_id, kind, body, raw_json,
       sent_at, received_at, delivery_state, reply_to_event_id, target_event_id,
       target_author_pubky, edited_at, deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.ownerPubky,
      message.channelId,
      message.senderPubky,
      message.eventId,
      message.kind,
      message.body,
      persistRawJson(message.kind, message.rawJson),
      message.sentAt,
      message.receivedAt,
      message.deliveryState,
      message.replyToEventId,
      message.targetEventId,
      message.targetAuthorPubky,
      message.editedAt,
      message.deleted ? 1 : 0,
      ts,
      ts,
    ],
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToGroupMessage(row: any): GroupMessage {
  return {
    ownerPubky: row.owner_pubky,
    channelId: row.channel_id,
    eventId: row.event_id,
    senderPubky: row.sender_pubky,
    kind: row.kind,
    body: row.body,
    rawJson: row.raw_json,
    sentAt: row.sent_at,
    receivedAt: row.received_at ?? null,
    deliveryState: row.delivery_state,
    replyToEventId: row.reply_to_event_id ?? null,
    targetEventId: row.target_event_id ?? null,
    targetAuthorPubky: row.target_author_pubky ?? null,
    editedAt: row.edited_at ?? null,
    deleted: row.deleted === 1,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToGroupDeferred(row: any): GroupDeferredEvent {
  return {
    ownerPubky: row.owner_pubky,
    channelId: row.channel_id,
    senderPubky: row.sender_pubky,
    eventId: row.event_id,
    kind: row.kind,
    body: row.body,
    rawJson: row.raw_json,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    targetEventId: row.target_event_id,
    targetAuthorPubky: row.target_author_pubky,
  };
}

function persistRawJson(kind: string | null | undefined, rawJson: string): string {
  if (kind === CHAT_ATTACHMENT_KIND || peekEnvelopeKind(rawJson) === CHAT_ATTACHMENT_KIND) {
    return redactAttachmentRawJson(rawJson);
  }
  return rawJson;
}

function persistQueuePayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { kind?: unknown; rawJson?: unknown };
    if (parsed.kind === CHAT_ATTACHMENT_KIND && typeof parsed.rawJson === 'string') {
      return JSON.stringify({ ...parsed, rawJson: redactAttachmentRawJson(parsed.rawJson) });
    }
  } catch {
    return payload;
  }
  return payload;
}

function queuePayloadBelongsToOwner(payload: string, ownerPubky: string): boolean {
  try {
    const parsed = JSON.parse(payload) as { ownerPubky?: unknown };
    return parsed.ownerPubky === ownerPubky;
  } catch {
    return false;
  }
}

function insertAttachment(db: SqlExecutor, record: AttachmentRecord): void {
  const ts = now();
  db.executeSync(
    `INSERT OR IGNORE INTO attachments
      (owner_pubky, event_id, conversation_id, channel_id, sender_pubky, direction,
       location, key_ref, content_type, size, thumbnail_location, local_cache_path,
       created_at, updated_at, delivery_state, resolve_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.ownerPubky,
      record.eventId,
      record.conversationId,
      record.channelId,
      record.senderPubky,
      record.direction,
      record.location,
      record.keyRef,
      record.contentType,
      record.size,
      record.thumbnailLocation,
      record.localCachePath,
      record.createdAt || ts,
      record.updatedAt || ts,
      record.deliveryState,
      record.resolveState,
    ],
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAttachment(row: any): AttachmentRecord {
  return {
    ownerPubky: row.owner_pubky,
    eventId: row.event_id,
    conversationId: row.conversation_id ?? null,
    channelId: row.channel_id ?? null,
    senderPubky: row.sender_pubky,
    direction: row.direction,
    location: row.location,
    keyRef: row.key_ref,
    contentType: row.content_type,
    size: row.size,
    thumbnailLocation: row.thumbnail_location ?? null,
    localCachePath: row.local_cache_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveryState: row.delivery_state,
    resolveState: row.resolve_state,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPaymentRequest(row: any): PaymentRequestRecord {
  let endpointIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row.endpoint_ids));
    if (Array.isArray(parsed)) {
      endpointIds = parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    endpointIds = [];
  }
  return {
    ownerPubky: row.owner_pubky,
    peerPubky: row.peer_pubky,
    direction: row.direction,
    paymentRequestId: row.payment_request_id,
    eventId: row.event_id,
    amountValue: row.amount_value,
    amountAsset: row.amount_asset,
    paymentReference: row.payment_reference,
    endpointIds,
    expiresAt: row.expires_at ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    proofJson: row.proof_json ?? null,
    reason: row.reason ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTipEndpoint(row: any): TipEndpointRecord {
  return {
    ownerPubky: row.owner_pubky,
    peerPubky: row.peer_pubky,
    identifier: row.identifier,
    payload: row.payload,
    updatedAt: row.updated_at,
  };
}
