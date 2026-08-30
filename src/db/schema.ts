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
 * Schema v6 — per-account contacts (composite PK) + v5 owner backfill.
 *
 * v5 added `owner_pubky` with DEFAULT '' and kept `pubky` as the sole PK.
 * That let two signed-in accounts clobber one row (ON CONFLICT(pubky)
 * re-homes owner_pubky) and let `clearAccountData(B)` delete A's contacts.
 * Queries that filtered `owner_pubky = ? OR owner_pubky = ''` also made
 * leftover empty-owner rows readable by every account, including mesh-
 * discovered strangers carrying a stale trust score.
 *
 * v6 rebuilds `contacts` with PRIMARY KEY (owner_pubky, pubky).
 *
 * Empty-owner backfill:
 *   - If exactly one non-empty `link_receivers.owner_pubky` exists, re-home
 *     `owner_pubky = ''` rows to that account (this device has a single
 *     known messaging identity).
 *   - If zero or several owners exist, DELETE the empty-owner rows rather
 *     than leave them shared. Ambiguous orphans are not guessable.
 *
 * Mesh-created rows: retained when they already have a real owner; empty-
 * owner mesh leftovers follow the same backfill/delete rule. MeshService
 * must not write `owner_pubky = ''` after this migration.
 *
 * threads FK: v1 declared `threads.participant_pubky REFERENCES contacts(pubky)`.
 * That FK is invalid against a composite PK (and was already invalid as a
 * FK to a column that is no longer unique once two accounts can share a
 * peer). The minimal correct fix is to drop the FK and enforce contact
 * existence in application code. DMs live in `link_messages` (owner-scoped);
 * `threads` is a v1 leftover and is not given its own owner_pubky here.
 */
export const SCHEMA_V6_STATEMENTS: readonly string[] = [
  // Re-home empty-owner contacts only when this device has exactly one account.
  `UPDATE contacts
      SET owner_pubky = (
        SELECT owner_pubky FROM link_receivers
         WHERE owner_pubky != ''
         LIMIT 1
      )
    WHERE owner_pubky = ''
      AND (SELECT COUNT(*) FROM link_receivers WHERE owner_pubky != '') = 1`,

  // Shared leftovers are worse than data loss: drop unscoped rows.
  `DELETE FROM contacts WHERE owner_pubky = ''`,

  // Fold relationship flags onto the newest duplicate before the PK rebuild.
  `UPDATE contacts
      SET is_following = (
            SELECT MAX(c2.is_following) FROM contacts c2
             WHERE c2.owner_pubky = contacts.owner_pubky AND c2.pubky = contacts.pubky
          ),
          is_follower = (
            SELECT MAX(c2.is_follower) FROM contacts c2
             WHERE c2.owner_pubky = contacts.owner_pubky AND c2.pubky = contacts.pubky
          ),
          is_mutual = (
            SELECT MAX(c2.is_mutual) FROM contacts c2
             WHERE c2.owner_pubky = contacts.owner_pubky AND c2.pubky = contacts.pubky
          ),
          added_manually = (
            SELECT MAX(c2.added_manually) FROM contacts c2
             WHERE c2.owner_pubky = contacts.owner_pubky AND c2.pubky = contacts.pubky
          )
    WHERE rowid IN (
      SELECT MAX(rowid) FROM contacts GROUP BY owner_pubky, pubky
    )`,
  `DELETE FROM contacts
    WHERE rowid NOT IN (
      SELECT MAX(rowid) FROM contacts GROUP BY owner_pubky, pubky
    )`,

  // Drop the v1 threads→contacts(pubky) FK before rebuilding contacts.
  `CREATE TABLE IF NOT EXISTS threads_v6 (
    id                  TEXT    NOT NULL PRIMARY KEY,
    participant_pubky   TEXT    NOT NULL,
    last_message        TEXT,
    last_message_at     INTEGER,
    unread_count        INTEGER NOT NULL DEFAULT 0,
    noise_context_id    TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  )`,
  `INSERT OR IGNORE INTO threads_v6
     (id, participant_pubky, last_message, last_message_at,
      unread_count, noise_context_id, created_at, updated_at)
   SELECT id, participant_pubky, last_message, last_message_at,
          unread_count, noise_context_id, created_at, updated_at
     FROM threads`,
  `DROP TABLE IF EXISTS threads`,
  `ALTER TABLE threads_v6 RENAME TO threads`,
  `CREATE INDEX IF NOT EXISTS idx_threads_last_message_at
    ON threads(last_message_at DESC)`,

  `CREATE TABLE IF NOT EXISTS contacts_v6 (
    owner_pubky         TEXT    NOT NULL,
    pubky               TEXT    NOT NULL,
    display_name        TEXT,
    avatar_hash         TEXT,
    homeserver          TEXT,
    trust_score         REAL    NOT NULL DEFAULT 0.0,
    is_following        INTEGER NOT NULL DEFAULT 0,
    is_follower         INTEGER NOT NULL DEFAULT 0,
    is_mutual           INTEGER NOT NULL DEFAULT 0,
    added_manually      INTEGER NOT NULL DEFAULT 0,
    first_seen_at       INTEGER NOT NULL,
    last_interaction_at INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, pubky)
  )`,
  `INSERT OR IGNORE INTO contacts_v6
     (owner_pubky, pubky, display_name, avatar_hash, homeserver, trust_score,
      is_following, is_follower, is_mutual, added_manually,
      first_seen_at, last_interaction_at, created_at, updated_at)
   SELECT owner_pubky, pubky, display_name, avatar_hash, homeserver, trust_score,
          is_following, is_follower, is_mutual, added_manually,
          first_seen_at, last_interaction_at, created_at, updated_at
     FROM contacts
    WHERE owner_pubky != ''`,
  `DROP TABLE IF EXISTS contacts`,
  `ALTER TABLE contacts_v6 RENAME TO contacts`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_pubky)`,
];

/**
 * Schema v5 — contacts relationship flags + owner scope, and message requests.
 *
 * v4 is committed history and is not rewritten. Contacts keep `pubky` as the
 * primary key so the v1 `threads.participant_pubky → contacts(pubky)` FK
 * stays valid. `owner_pubky` is the M1 account scope: queries filter on it.
 * Relationship flags are stored columns (not derived-only) so Nexus +
 * homeserver follows can merge independently.
 *
 * `message_requests` is the WoT gate: inbound links from peers who are not
 * mutual/following and who are below the trust threshold sit here as
 * pending until the user accepts (promote to a normal conversation) or
 * declines (wipe the link + clear the outbox).
 *
 * Superseded by v6 for the contacts primary key and the threads FK.
 */
export const SCHEMA_V5_STATEMENTS: readonly string[] = [
  `ALTER TABLE contacts ADD COLUMN owner_pubky TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE contacts ADD COLUMN is_following INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE contacts ADD COLUMN is_follower INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE contacts ADD COLUMN is_mutual INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE contacts ADD COLUMN added_manually INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_pubky)`,
  `CREATE TABLE IF NOT EXISTS message_requests (
    owner_pubky  TEXT    NOT NULL,
    peer_pubky   TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    status       TEXT    NOT NULL,
    PRIMARY KEY (owner_pubky, peer_pubky)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_message_requests_owner_status
    ON message_requests(owner_pubky, status, created_at DESC)`,
];

/**
 * Schema v4 — account-scoped Encrypted Links, opaque AEAD snapshots, stream
 * items, and (owner, sender, kind, event_id) dedup. v3 is committed history
 * and is not rewritten; this migration rebuilds the v3 tables.
 *
 * Combined v4 data policy (do not carry unreachable or native-incompatible
 * rows):
 * - Receivers are NOT copied. v3 `secret_ref` is the JS keychain service
 *   name (`hypercolor-link-receiver-secret`), not a native-minted alias.
 *   Copying it into `receiver_alias` makes `getReceiverPublicKey` reject
 *   forever with no delete path. The table is created empty; the next
 *   `enable()` / `provisionReceiver` mints a real native alias (and
 *   self-heals if a stale row is ever present).
 * - Links, messages, and cursors are copied ONLY when a v3 receiver row
 *   exists with a non-empty `owner_pubky`. The previous COALESCE(..., '')
 *   fallback created rows no real-owner query (or `clearAccountData`)
 *   could ever see. With no receiver, those tables are created empty.
 * - Copied v3 `links.snapshot` values are plaintext JS snapshots. Native
 *   AEAD restore rejects them as `protocol`; `handleLinkFailure` wipes
 *   the row and re-handshakes. That is the intended self-heal — we still
 *   copy owned link rows so the wipe/re-handshake runs against a real
 *   owner instead of leaving silent orphans.
 *
 * SENSITIVITY:
 * - The receiver Noise SECRET and homeserver bearer NEVER enter SQLite (or
 *   JS). Rows store only opaque aliases minted by native.
 * - `links.snapshot` is opaque AEAD ciphertext produced natively under a
 *   per-install device key. TypeScript must never parse it.
 * - `link_messages.body` / `raw_json` and `link_stream_items.raw_json` are
 *   plaintext message history, local to this device. Bodies never enter logs.
 */
export const SCHEMA_V4_STATEMENTS: readonly string[] = [
  // ── Receivers: native alias + official path. Never copy v3 secret_ref.
  `CREATE TABLE IF NOT EXISTS link_receivers_v4 (
    owner_pubky       TEXT    NOT NULL PRIMARY KEY,
    receiver_alias    TEXT    NOT NULL,   -- opaque native alias; NEVER a secret
    receiver_path     TEXT    NOT NULL,   -- official {app}/wallet or {app}/server
    marker_published  INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  )`,
  // v3 receivers stay in place until owned links/messages/cursors are copied,
  // then the v3 table is dropped without copying secret_ref.

  // ── Links: owner-scoped PK, remote noise key, both paths, failure counter
  `CREATE TABLE IF NOT EXISTS links_v4 (
    owner_pubky              TEXT    NOT NULL,
    peer_pubky               TEXT    NOT NULL,
    role                     TEXT    NOT NULL,        -- 'initiator' | 'responder'
    status                   TEXT    NOT NULL,        -- 'handshaking' | 'established'
    snapshot                 TEXT    NOT NULL,        -- opaque AEAD ciphertext; never parse in JS
    remote_noise_public_key  TEXT    NOT NULL DEFAULT '',
    local_receiver_path      TEXT    NOT NULL DEFAULT '',
    remote_receiver_path     TEXT    NOT NULL DEFAULT '',
    consecutive_failures     INTEGER NOT NULL DEFAULT 0,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, peer_pubky)
  )`,
  `INSERT OR IGNORE INTO links_v4
     (owner_pubky, peer_pubky, role, status, snapshot,
      remote_noise_public_key, local_receiver_path, remote_receiver_path,
      consecutive_failures, created_at, updated_at)
   SELECT
     (SELECT owner_pubky FROM link_receivers LIMIT 1),
     peer_pubky,
     role,
     status,
     snapshot,
     '',
     'hypercolor/wallet',
     'hypercolor/wallet',
     0,
     created_at,
     updated_at
   FROM links
   WHERE EXISTS (SELECT 1 FROM link_receivers WHERE owner_pubky != '')`,
  `DROP TABLE IF EXISTS links`,
  `ALTER TABLE links_v4 RENAME TO links`,
  `CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_pubky, updated_at DESC)`,

  // ── Messages: owner + sender in the dedup key
  `CREATE TABLE IF NOT EXISTS link_messages_v4 (
    owner_pubky     TEXT    NOT NULL,
    sender_pubky    TEXT    NOT NULL,
    kind            TEXT    NOT NULL,
    event_id        TEXT    NOT NULL,
    conversation_id TEXT    NOT NULL,
    peer_pubky      TEXT    NOT NULL,
    direction       TEXT    NOT NULL,              -- 'sent' | 'received'
    raw_json        TEXT    NOT NULL,
    body            TEXT    NOT NULL,
    sent_at         INTEGER NOT NULL,
    received_at     INTEGER,
    delivery_state  TEXT    NOT NULL,              -- 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, sender_pubky, kind, event_id)
  )`,
  `INSERT OR IGNORE INTO link_messages_v4
     (owner_pubky, sender_pubky, kind, event_id, conversation_id, peer_pubky,
      direction, raw_json, body, sent_at, received_at, delivery_state,
      created_at, updated_at)
   SELECT
     (SELECT owner_pubky FROM link_receivers LIMIT 1),
     CASE
       WHEN direction = 'sent'
         THEN (SELECT owner_pubky FROM link_receivers LIMIT 1)
       ELSE peer_pubky
     END,
     kind,
     event_id,
     conversation_id,
     peer_pubky,
     direction,
     raw_json,
     body,
     sent_at,
     received_at,
     delivery_state,
     created_at,
     updated_at
   FROM link_messages
   WHERE EXISTS (SELECT 1 FROM link_receivers WHERE owner_pubky != '')`,
  `DROP TABLE IF EXISTS link_messages`,
  `ALTER TABLE link_messages_v4 RENAME TO link_messages`,
  `CREATE INDEX IF NOT EXISTS idx_link_messages_conversation
    ON link_messages(owner_pubky, conversation_id, sent_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_link_messages_delivery
    ON link_messages(owner_pubky, delivery_state)`,

  // ── Read cursors: owner-scoped
  `CREATE TABLE IF NOT EXISTS link_read_cursors_v4 (
    owner_pubky      TEXT    NOT NULL,
    conversation_id  TEXT    NOT NULL,
    last_read_at     INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, conversation_id)
  )`,
  `INSERT OR IGNORE INTO link_read_cursors_v4
     (owner_pubky, conversation_id, last_read_at, updated_at)
   SELECT
     (SELECT owner_pubky FROM link_receivers LIMIT 1),
     conversation_id,
     last_read_at,
     updated_at
   FROM link_read_cursors
   WHERE EXISTS (SELECT 1 FROM link_receivers WHERE owner_pubky != '')`,
  `DROP TABLE IF EXISTS link_read_cursors`,
  `ALTER TABLE link_read_cursors_v4 RENAME TO link_read_cursors`,

  // Drop v3 receivers last so the copies above can read a real owner, then
  // replace with an empty v4 table (force native re-provision).
  `DROP TABLE IF EXISTS link_receivers`,
  `ALTER TABLE link_receivers_v4 RENAME TO link_receivers`,

  // ── Inbound stream (every raw item, before snapshot advance)
  `CREATE TABLE IF NOT EXISTS link_stream_items (
    id            TEXT    NOT NULL PRIMARY KEY,
    owner_pubky   TEXT    NOT NULL,
    peer_pubky    TEXT    NOT NULL,
    kind          TEXT,
    raw_json      TEXT    NOT NULL,
    received_at   INTEGER NOT NULL,
    processed     INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_link_stream_items_dedup
    ON link_stream_items(owner_pubky, peer_pubky, raw_json)`,
  `CREATE INDEX IF NOT EXISTS idx_link_stream_items_unprocessed
    ON link_stream_items(owner_pubky, peer_pubky, processed)`,
];

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
