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
 * Schema v3 — Paykit Encrypted Links messaging (replaces the research-stack
 * envelope transport for DMs).
 *
 * SENSITIVITY:
 * - The receiver Noise SECRET key is NEVER stored in SQLite. It lives in the
 *   OS keychain via KeyStore; `link_receivers.secret_ref` only names that
 *   keychain entry.
 * - `links.snapshot` JSON serializes UNENCRYPTED and contains Noise key
 *   material. Device-local only — never sync, export, or log it.
 * - `link_messages.body` / `raw_json` are plaintext message history, local to
 *   this device by design. Bodies never enter logs or telemetry.
 */
export const SCHEMA_V3_STATEMENTS: readonly string[] = [
  // ── Link receivers (one per account) ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS link_receivers (
    owner_pubky       TEXT    NOT NULL PRIMARY KEY,
    secret_ref        TEXT    NOT NULL,   -- KeyStore keychain service name, never the secret
    app               TEXT    NOT NULL,   -- receiver path segment: app
    runtime           TEXT    NOT NULL,   -- receiver path segment: runtime
    marker_published  INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  )`,

  // ── Encrypted Links (one per counterparty) ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS links (
    peer_pubky   TEXT    NOT NULL PRIMARY KEY,
    role         TEXT    NOT NULL,        -- 'initiator' | 'responder'
    status       TEXT    NOT NULL,        -- 'handshaking' | 'established'
    snapshot     TEXT    NOT NULL,        -- snapshot JSON; contains key material, device-local only
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  )`,

  // ── Link messages (event_id-deduped history) ─────────────────────────────
  `CREATE TABLE IF NOT EXISTS link_messages (
    event_id        TEXT    NOT NULL PRIMARY KEY,  -- sender-minted UUID, the dedup key
    conversation_id TEXT    NOT NULL,              -- dm:{counterpartyPubky}
    peer_pubky      TEXT    NOT NULL,
    direction       TEXT    NOT NULL,              -- 'sent' | 'received'
    kind            TEXT    NOT NULL,              -- e.g. 'chat.message.v0'
    raw_json        TEXT    NOT NULL,              -- full wire envelope
    body            TEXT    NOT NULL,
    sent_at         INTEGER NOT NULL,              -- sender wall clock (Unix ms)
    received_at     INTEGER,                       -- local arrival time; NULL for sent messages
    delivery_state  TEXT    NOT NULL,              -- 'sending' | 'sent' | 'delivered' | 'read'
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_link_messages_conversation
    ON link_messages(conversation_id, sent_at DESC)`,

  // ── Per-conversation read cursors ────────────────────────────────────────
  // Device-local read checkpoint: the newest timestamp this device has shown
  // the user for a conversation. Drives the honest local unread badge — it
  // counts only messages that already arrived on THIS device.
  `CREATE TABLE IF NOT EXISTS link_read_cursors (
    conversation_id TEXT    NOT NULL PRIMARY KEY,
    last_read_at    INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  )`,
];

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
