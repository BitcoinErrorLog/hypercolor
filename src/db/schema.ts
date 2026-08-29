/**
 * SQLite schema v1 for Hypercolor.
 *
 * All DDL statements are plain SQL. The migration runner in migrations.ts
 * applies them in sequence, gated by a `schema_version` user-pragma.
 *
 * Design rules:
 * - IDs are always TEXT (hex or UUID strings) — never auto-increment integers.
 * - Timestamps are INTEGER (Unix milliseconds).
 * - Binary blobs (encrypted envelopes) are stored as TEXT base64 to avoid
 *   BLOB encoding issues across the JS bridge.
 * - Every table has `created_at` and `updated_at` columns.
 * - WAL mode and foreign key enforcement are enabled at connection open time.
 */

/**
 * Schema v2 — add noise_context_id to threads for SB2 per-thread context binding.
 * Column repurposed: channel_key_base64 in channels now stores X25519 inbox pk hex.
 */
export const SCHEMA_V2_STATEMENTS: readonly string[] = [
  `ALTER TABLE threads ADD COLUMN noise_context_id TEXT`,
];

export const SCHEMA_V1_STATEMENTS: readonly string[] = [
  // ── Contacts ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS contacts (
    pubky           TEXT    NOT NULL PRIMARY KEY,
    display_name    TEXT,
    avatar_hash     TEXT,
    homeserver      TEXT,
    trust_score     REAL    NOT NULL DEFAULT 0.0,
    first_seen_at   INTEGER NOT NULL,
    last_interaction_at INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  )`,

  // ── Threads (DM pairwise conversations) ───────────────────────────────────
  `CREATE TABLE IF NOT EXISTS threads (
    id                  TEXT    NOT NULL PRIMARY KEY,
    participant_pubky   TEXT    NOT NULL REFERENCES contacts(pubky),
    last_message        TEXT,
    last_message_at     INTEGER,
    unread_count        INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_threads_last_message_at
    ON threads(last_message_at DESC)`,

  // ── Channels (group conversations) ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS channels (
    id                  TEXT    NOT NULL PRIMARY KEY,
    name                TEXT    NOT NULL,
    channel_key_base64  TEXT,                   -- X25519 inbox public key (hex) for SealedBlob encryption
    member_count        INTEGER NOT NULL DEFAULT 0,
    last_message        TEXT,
    last_message_at     INTEGER,
    unread_count        INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS channel_members (
    channel_id      TEXT    NOT NULL REFERENCES channels(id),
    pubky           TEXT    NOT NULL,
    display_name    TEXT,
    joined_at       INTEGER NOT NULL,
    PRIMARY KEY (channel_id, pubky)
  )`,

  // ── Messages ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS messages (
    id                  TEXT    NOT NULL PRIMARY KEY,
    thread_id           TEXT,
    channel_id          TEXT,
    sender_pubky        TEXT    NOT NULL,
    recipient_pubky     TEXT,
    content             TEXT    NOT NULL,
    created_at          INTEGER NOT NULL,
    delivery_status     TEXT    NOT NULL DEFAULT 'pending',
    delivery_path       TEXT,
    dedup_hash          TEXT    NOT NULL,
    updated_at          INTEGER NOT NULL,
    CHECK (thread_id IS NOT NULL OR channel_id IS NOT NULL)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_messages_thread_id
    ON messages(thread_id, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_messages_channel_id
    ON messages(channel_id, created_at DESC)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedup_hash
    ON messages(dedup_hash)`,

  // ── Delivery queue (retry-able outbox) ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS delivery_queue (
    id              TEXT    NOT NULL PRIMARY KEY,
    message_id      TEXT    NOT NULL,
    recipient_pubky TEXT    NOT NULL,
    payload         TEXT    NOT NULL,  -- base64-encoded OutboxEnvelope
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_retry_at   INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_delivery_queue_next_retry
    ON delivery_queue(next_retry_at ASC)`,

  // ── Cursor state (SSE catch-up) ────────────────────────────────────────────
  // Tracks the most recently processed cursor for each (sender, recipient)
  // or (sender, channel) outbox path so we can resume from the right point
  // after a reconnect.
  `CREATE TABLE IF NOT EXISTS cursor_state (
    id              TEXT    NOT NULL PRIMARY KEY,
    sender_pubky    TEXT    NOT NULL,
    scope_key       TEXT    NOT NULL,   -- recipientPubky or channelId
    scope_type      TEXT    NOT NULL,   -- 'dm' | 'channel'
    last_cursor_ms  INTEGER NOT NULL DEFAULT 0,
    updated_at      INTEGER NOT NULL,
    UNIQUE (sender_pubky, scope_key, scope_type)
  )`,

  // ── Mesh peers (transient, cleared on startup) ────────────────────────────
  `CREATE TABLE IF NOT EXISTS mesh_peers (
    pubky_hash      TEXT    NOT NULL PRIMARY KEY,
    pubky           TEXT,
    rssi            INTEGER,
    last_seen_at    INTEGER NOT NULL,
    connected       INTEGER NOT NULL DEFAULT 0
  )`,
];
