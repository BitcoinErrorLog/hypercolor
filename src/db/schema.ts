/**
 * Schema migrations for Hypercolor local SQLite.
 *
 * Both W2b and W2c shipped unreleased `user_version = 16` with different
 * tables. Devices may already be on either shape. v16 in this tree keeps
 * the W2b statements (fan-out outcomes + blocked peers). v17 applies the
 * W2c own-invoice-hash statements AND re-applies W2b CREATE IF NOT EXISTS
 * so a W2c-stamped v16 database still gains the contacts/deny-list tables.
 * Every statement is idempotent; ALTER ADD COLUMN is PRAGMA-guarded in
 * the migration runner. A version bump (not an in-place v16 replay alone)
 * gives a clear stamp once the union is present, while idempotent repairs
 * still re-run every launch.
 */

/**
 * Schema v16 — group fan-out outcomes + blocked peers (W2b).
 *
 * Devices that installed W2b already stamp user_version=16 with these objects.
 * Keep this body stable; W2c own-invoice work lands in v17.
 */
export const SCHEMA_V16_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS group_fanout_outcomes (
    owner_pubky      TEXT NOT NULL,
    channel_id       TEXT NOT NULL,
    event_id         TEXT NOT NULL,
    sender_pubky     TEXT NOT NULL,
    recipient_pubky  TEXT NOT NULL,
    status           TEXT NOT NULL,
    reason           TEXT,
    updated_at       INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, channel_id, event_id, sender_pubky, recipient_pubky)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_group_fanout_outcomes_event
    ON group_fanout_outcomes(owner_pubky, channel_id, sender_pubky, event_id)`,
  `CREATE TABLE IF NOT EXISTS blocked_peers (
    owner_pubky       TEXT NOT NULL,
    peer_pubky        TEXT NOT NULL,
    blocked_at        INTEGER NOT NULL,
    cleanup_pending   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_pubky, peer_pubky)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_blocked_peers_owner
    ON blocked_peers(owner_pubky)`,
  `ALTER TABLE blocked_peers ADD COLUMN cleanup_pending INTEGER NOT NULL DEFAULT 0`,
];

export const OWN_INVOICE_HASHES_CREATE_SQL = `CREATE TABLE IF NOT EXISTS own_invoice_hashes (
    owner_pubky           TEXT    NOT NULL,
    endpoint_identifier   TEXT    NOT NULL,
    payment_hash          TEXT    NOT NULL,
    first_seen_at         INTEGER NOT NULL,
    invoice_amount_msat   TEXT,
    invoice_expires_at    INTEGER,
    display_context       TEXT,
    payment_request_id    TEXT,
    PRIMARY KEY (owner_pubky, endpoint_identifier, payment_hash)
  )`;

export const OWN_INVOICE_HASHES_SEED_SQL = `INSERT OR IGNORE INTO own_invoice_hashes
     (owner_pubky, endpoint_identifier, payment_hash, first_seen_at,
      invoice_amount_msat, invoice_expires_at)
   SELECT owner_pubky, identifier, payment_hash, updated_at,
          NULL,
          invoice_expires_at
     FROM tip_endpoints
    WHERE owner_pubky = peer_pubky
      AND payment_hash IS NOT NULL`;

export const PAYMENT_REQUESTS_VERIFIED_HASH_DEDUP_SQL = `UPDATE payment_requests
      SET proof_verified = NULL
    WHERE rowid IN (
      SELECT rowid FROM (
        SELECT p.rowid AS rowid
          FROM payment_requests AS p
         WHERE p.proof_verified = 1
           AND p.displayed_payment_hash IS NOT NULL
           AND EXISTS (
             SELECT 1
               FROM payment_requests AS o
              WHERE o.owner_pubky = p.owner_pubky
                AND o.displayed_payment_hash = p.displayed_payment_hash
                AND o.proof_verified = 1
                AND (
                  o.created_at < p.created_at
                  OR (o.created_at = p.created_at AND o.rowid < p.rowid)
                )
           )
      )
    )`;

export const PAYMENT_REQUESTS_VERIFIED_HASH_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_owner_verified_hash
     ON payment_requests(owner_pubky, displayed_payment_hash)
     WHERE proof_verified = 1`;

/**
 * Schema v17 — W2c own-invoice history + reconciliation of W2b v16 objects.
 *
 * Own-invoice hash tracking (amount/expiry/display context) and the verified
 * payment-hash unique index ship here. W2b CREATE IF NOT EXISTS statements are
 * re-applied so devices that stamped W2c's v16 still gain fan-out outcomes and
 * blocked_peers.
 */
/**
 * Versioned v17 body is CREATE-only. Seed / verified-hash dedup+index run in
 * `repairOwnInvoiceHashes` (own transaction, never startup-fatal) so that:
 * - devices without `tip_endpoints` yet (bare v16 stamp tests, mid-upgrade)
 *   do not fail the version bump on the SEED SELECT;
 * - `invoice_reused` can commit before a later index statement throws, matching
 *   W2c's repair isolation.
 * W2b CREATE IF NOT EXISTS statements are re-applied so a W2c-shaped v16 still
 * gains fan-out outcomes and blocked_peers.
 */
export const SCHEMA_V17_STATEMENTS: readonly string[] = [
  OWN_INVOICE_HASHES_CREATE_SQL,
  `CREATE TABLE IF NOT EXISTS group_fanout_outcomes (
    owner_pubky      TEXT NOT NULL,
    channel_id       TEXT NOT NULL,
    event_id         TEXT NOT NULL,
    sender_pubky     TEXT NOT NULL,
    recipient_pubky  TEXT NOT NULL,
    status           TEXT NOT NULL,
    reason           TEXT,
    updated_at       INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, channel_id, event_id, sender_pubky, recipient_pubky)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_group_fanout_outcomes_event
    ON group_fanout_outcomes(owner_pubky, channel_id, sender_pubky, event_id)`,
  `CREATE TABLE IF NOT EXISTS blocked_peers (
    owner_pubky       TEXT NOT NULL,
    peer_pubky        TEXT NOT NULL,
    blocked_at        INTEGER NOT NULL,
    cleanup_pending   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_pubky, peer_pubky)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_blocked_peers_owner
    ON blocked_peers(owner_pubky)`,
];

/**
 * Schema v18 — W1e single-active receiver role + last-seen marker pks.
 *
 * `receiver_role` is this device's inbox role (`active` | `standby`).
 * `last_seen_own_marker_pk` is the last successfully GETed own marker pk.
 * `last_seen_peer_marker_pk` is the last GETed peer marker pk. Recording the
 * peer pk must not bump `links.updated_at` (age-out clock). Idempotent ALTER.
 * Web's equivalent bump is schema v14; mobile keeps its own numbering.
 */
export const SCHEMA_V18_STATEMENTS: readonly string[] = [
  `ALTER TABLE link_receivers ADD COLUMN receiver_role TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE link_receivers ADD COLUMN last_seen_own_marker_pk TEXT`,
  `ALTER TABLE links ADD COLUMN last_seen_peer_marker_pk TEXT`,
];

/**
 * Schema v19 — durable predecessor snapshot for two-phase established re-key.
 * Live `(owner, peer)` stays established until the new handshake completes.
 */
export const SCHEMA_V19_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS links_archive (
    owner_pubky              TEXT    NOT NULL,
    peer_pubky               TEXT    NOT NULL,
    role                     TEXT    NOT NULL,
    status                   TEXT    NOT NULL,
    snapshot                 TEXT    NOT NULL,
    remote_noise_public_key  TEXT    NOT NULL DEFAULT '',
    local_receiver_path      TEXT    NOT NULL DEFAULT '',
    remote_receiver_path     TEXT    NOT NULL DEFAULT '',
    consecutive_failures     INTEGER NOT NULL DEFAULT 0,
    last_seen_peer_marker_pk TEXT,
    archived_at              INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, peer_pubky)
  )`,
];

/**
 * Schema v20 — local (not on the wire) nicknames, mute/archive, owner display
 * name, and a normalized search column. FTS5 is attempted separately; LIKE
 * on `body_search` is the portable path.
 */
export const SCHEMA_V20_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS contact_nicknames (
    owner_pubky  TEXT    NOT NULL,
    peer_pubky   TEXT    NOT NULL,
    nickname     TEXT    NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, peer_pubky)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_contact_nicknames_owner
    ON contact_nicknames(owner_pubky)`,
  `CREATE TABLE IF NOT EXISTS thread_local_prefs (
    owner_pubky       TEXT    NOT NULL,
    conversation_id   TEXT    NOT NULL,
    muted             INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0,
    updated_at        INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, conversation_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_thread_local_prefs_owner
    ON thread_local_prefs(owner_pubky, archived, muted)`,
  `CREATE TABLE IF NOT EXISTS owner_profiles (
    owner_pubky    TEXT    NOT NULL PRIMARY KEY,
    display_name   TEXT    NOT NULL,
    updated_at     INTEGER NOT NULL
  )`,
  `ALTER TABLE link_messages ADD COLUMN body_search TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE group_messages ADD COLUMN body_search TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS idx_link_messages_body_search
    ON link_messages(owner_pubky, body_search)`,
  `CREATE INDEX IF NOT EXISTS idx_group_messages_body_search
    ON group_messages(owner_pubky, body_search)`,
];

/**
 * Schema v21 — chat.tag.v0 / chat.receipt.v0 device prefs, tags, pins, invites,
 * plus additive `links.chat_kinds_v` for R7 emit-gating.
 * Additive only. Frozen v1–v20 are not rewritten. Same DDL as kinds-v1.md.
 */
export const SCHEMA_V21_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS chat_device_prefs (
  owner_pubky TEXT NOT NULL PRIMARY KEY,
  receipts_enabled INTEGER NOT NULL DEFAULT 1,
  typing_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS chat_tags (
  owner_pubky TEXT NOT NULL,
  conversation_id TEXT,
  channel_id TEXT,
  scope_key TEXT NOT NULL,
  target_event_id TEXT NOT NULL,
  target_author_pubky TEXT NOT NULL,
  tagger_pubky TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((channel_id IS NULL) != (conversation_id IS NULL)),
  PRIMARY KEY (owner_pubky, scope_key, target_author_pubky, target_event_id, tagger_pubky, label)
)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_tags_target
    ON chat_tags(owner_pubky, scope_key, target_author_pubky, target_event_id)`,
  `CREATE TABLE IF NOT EXISTS chat_pins (
  owner_pubky TEXT NOT NULL,
  conversation_id TEXT,
  channel_id TEXT,
  scope_key TEXT NOT NULL,
  target_event_id TEXT NOT NULL,
  target_author_pubky TEXT NOT NULL,
  pinned_by TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  CHECK ((channel_id IS NULL) != (conversation_id IS NULL)),
  PRIMARY KEY (owner_pubky, scope_key)
)`,
  `CREATE TABLE IF NOT EXISTS chat_group_invites (
  owner_pubky TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  sender_pubky TEXT NOT NULL,
  name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (owner_pubky, invite_id)
)`,
  `ALTER TABLE links ADD COLUMN chat_kinds_v INTEGER NOT NULL DEFAULT 0`,
];

/**
 * Schema v22 — DM unsend tombstone flag on `link_messages` (kinds-v1.md
 * `chat.delete.v0` / R3). Additive ALTER. Frozen v1–v21 are not rewritten.
 */
export const SCHEMA_V22_STATEMENTS: readonly string[] = [
  `ALTER TABLE link_messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`,
];

/**
 * Schema v23 — durable receiver advertisement retries and bounded DM delete
 * tombstones. Both records are owner-scoped and are consumed by the link
 * lifecycle, never by an unbounded stream reparse.
 */
export const SCHEMA_V23_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS chat_kinds_advertise_retries (
    owner_pubky       TEXT NOT NULL PRIMARY KEY,
    session_alias     TEXT NOT NULL,
    noise_public_key  TEXT NOT NULL,
    next_retry_at     INTEGER NOT NULL,
    attempts          INTEGER NOT NULL DEFAULT 0,
    updated_at        INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_pending_tombstones (
    owner_pubky       TEXT NOT NULL,
    peer_pubky        TEXT NOT NULL,
    sender_pubky      TEXT NOT NULL,
    target_event_id   TEXT NOT NULL,
    delete_event_id   TEXT NOT NULL,
    raw_json          TEXT NOT NULL,
    sent_at           INTEGER NOT NULL,
    received_at       INTEGER NOT NULL,
    expires_at        INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, peer_pubky, sender_pubky, target_event_id, delete_event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_pending_tombstones_target
    ON chat_pending_tombstones(owner_pubky, peer_pubky, sender_pubky, target_event_id, expires_at)`,
  `CREATE TABLE IF NOT EXISTS chat_pending_tags (
    owner_pubky       TEXT NOT NULL,
    peer_pubky        TEXT NOT NULL,
    sender_pubky      TEXT NOT NULL,
    target_event_id   TEXT NOT NULL,
    tag_event_id      TEXT NOT NULL,
    raw_json          TEXT NOT NULL,
    sent_at           INTEGER NOT NULL,
    received_at       INTEGER NOT NULL,
    expires_at        INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, peer_pubky, sender_pubky, target_event_id, tag_event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_pending_tags_target
    ON chat_pending_tags(owner_pubky, peer_pubky, sender_pubky, target_event_id, expires_at)`,
];

/** Schema v24 — durable, redacted established-link recovery state. */
export const SCHEMA_V24_STATEMENTS: readonly string[] = [
  `ALTER TABLE links ADD COLUMN reconnect_error_category TEXT`,
  `ALTER TABLE links ADD COLUMN reconnect_required_at INTEGER`,
];

/** Schema v25 — redacted per-item inbound routing failures. */
export const SCHEMA_V25_STATEMENTS: readonly string[] = [
  `ALTER TABLE link_stream_items ADD COLUMN processing_error_category TEXT`,
];

/**
 * Schema v15 — move the handshake advance budget off the `links` row.
 *
 * v14 put `pending_advances` / `next_advance_at` on `links`, which is deleted
 * by `recoverWedgedLink` and `abandonUnestablishedLink`. A hostile peer could
 * therefore cycle valid message 1 → pending → malformed message 3 → protocol
 * wipe → re-adoption and get a fresh budget on every cycle, so the budget
 * never decayed and the batch cap only limited the rate.
 *
 * `link_handshake_budgets` is keyed by (owner, peer) and is NOT touched by any
 * link wipe, so it survives wipe, abandonment, re-adoption, role flips,
 * delete/recreate cycles and app restart. `exhausted_at` is the terminal mark:
 * a peer that carries it gets no timer or sync work at all. Only reaching
 * `established`, a deliberate user action, or account teardown removes a row.
 */
export const SCHEMA_V15_STATEMENTS: readonly string[] = [
  // The index has to go first: SQLite refuses to drop an indexed column.
  `DROP INDEX IF EXISTS idx_links_handshake_due`,
  `ALTER TABLE links DROP COLUMN pending_advances`,
  `ALTER TABLE links DROP COLUMN next_advance_at`,
  `CREATE INDEX IF NOT EXISTS idx_links_owner_status ON links(owner_pubky, status)`,
  `CREATE TABLE IF NOT EXISTS link_handshake_budgets (
    owner_pubky      TEXT NOT NULL,
    peer_pubky       TEXT NOT NULL,
    pending_advances INTEGER NOT NULL DEFAULT 0,
    next_advance_at  INTEGER NOT NULL DEFAULT 0,
    exhausted_at     INTEGER,
    updated_at       INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, peer_pubky)
  )`,
];

/**
 * Schema v14 — bound the periodic handshake stepper.
 *
 * `advancePendingLinks` steps every `handshaking` link on the foreground
 * tick. A `pending` advance is not an error, so `consecutive_failures` never
 * increments and nothing ever aged the row out: any peer who writes Noise
 * message 1 and never answers message 3 (including a mere follower picked up
 * by `syncInbox` candidate probing) cost a `restoreHandshake` plus an
 * `advanceHandshake` with homeserver IO on every tick, forever.
 *
 * `pending_advances` counts advances that returned `pending`;
 * `next_advance_at` is the earliest Unix-ms the timer may step the row again
 * (`0` = due now, which is also the correct value for every pre-existing
 * row). Both are reset when the link reaches `established`.
 *
 * Superseded by v15, which moves both onto `link_handshake_budgets` so they
 * survive a link wipe. Kept verbatim because a released migration is never
 * edited; v15 drops the two columns.
 */
export const SCHEMA_V14_STATEMENTS: readonly string[] = [
  `ALTER TABLE links ADD COLUMN pending_advances INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE links ADD COLUMN next_advance_at INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_links_handshake_due
    ON links(owner_pubky, status, next_advance_at)`,
];

/**
 * Schema v13 — retire research-era DM/channel tables; keep the live
 * Encrypted-Link retry queue (`delivery_queue`). Add author scoping on
 * group-message replies (`reply_to_author_pubky`).
 *
 * Dropped (no remaining product callers after M6 UI repoint):
 *   threads, messages, channels, channel_members, cursor_state
 *
 * Kept:
 *   delivery_queue — LinkService / group fan-out retry (M1 nonce-safe path)
 *   mesh_peers     — MeshService still compiles (quarantined, flag off)
 */
export const SCHEMA_V13_STATEMENTS: readonly string[] = [
  `DROP TABLE IF EXISTS threads`,
  `DROP TABLE IF EXISTS messages`,
  `DROP TABLE IF EXISTS channels`,
  `DROP TABLE IF EXISTS channel_members`,
  `DROP TABLE IF EXISTS cursor_state`,
  `ALTER TABLE group_messages ADD COLUMN reply_to_author_pubky TEXT`,
];

/**
 * Schema v12 — payment outbound send-intent + tip validation columns.
 *
 * `payment_requests.pending_event_id` points at the outbound PAM still in
 * `delivery_queue` / `link_messages.sending` so the UI can show `sending`.
 * `displayed_payment_hash` is set only when a bolt11 for this request was
 * decoded for display/handoff. `proof_verified` is 1 only after
 * sha256(preimage) matches that hash.
 *
 * Tip rows store validation outcome: invalid payloads stay as
 * `validation_status = rejected` (hidden from payable UI).
 */
export const SCHEMA_V12_STATEMENTS: readonly string[] = [
  `ALTER TABLE payment_requests ADD COLUMN pending_event_id TEXT`,
  `ALTER TABLE payment_requests ADD COLUMN displayed_payment_hash TEXT`,
  `ALTER TABLE payment_requests ADD COLUMN proof_verified INTEGER`,
  `ALTER TABLE tip_endpoints ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'valid'`,
  `ALTER TABLE tip_endpoints ADD COLUMN invoice_amount TEXT`,
  `ALTER TABLE tip_endpoints ADD COLUMN invoice_expires_at INTEGER`,
  `ALTER TABLE tip_endpoints ADD COLUMN payment_hash TEXT`,
];

/**
 * Schema v11 — Paykit payment requests, sender-scoped event dedup, tip lists.
 *
 * Payments are official Paykit PAMs over Encrypted Links. This app never
 * executes them. Rows are owner-scoped and wiped by `clearAccountData`.
 *
 * `payment_requests` PK is `(owner_pubky, peer_pubky, payment_request_id)`
 * so a request id from peer A cannot be transitioned by peer B.
 *
 * `payment_events` dedup is `(owner_pubky, conversation_id, sender_pubky,
 * event_id)` — the same sender-scoped identity as M3/M4.
 *
 * `tip_endpoints` stores the latest-state private payment list per peer.
 * Locally configured endpoints use `peer_pubky = owner_pubky`.
 */
export const SCHEMA_V11_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS payment_requests (
    owner_pubky           TEXT    NOT NULL,
    peer_pubky            TEXT    NOT NULL,
    direction             TEXT    NOT NULL,
    payment_request_id    TEXT    NOT NULL,
    event_id              TEXT    NOT NULL,
    amount_value          TEXT    NOT NULL,
    amount_asset          TEXT    NOT NULL,
    payment_reference     TEXT    NOT NULL,
    endpoint_ids          TEXT    NOT NULL,
    expires_at            INTEGER,
    status                TEXT    NOT NULL,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    proof_json            TEXT,
    reason                TEXT,
    PRIMARY KEY (owner_pubky, peer_pubky, payment_request_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payment_requests_peer
    ON payment_requests(owner_pubky, peer_pubky, updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS payment_events (
    owner_pubky          TEXT    NOT NULL,
    conversation_id      TEXT    NOT NULL,
    sender_pubky         TEXT    NOT NULL,
    event_id             TEXT    NOT NULL,
    kind                 TEXT    NOT NULL,
    payment_request_id   TEXT,
    applied              INTEGER NOT NULL DEFAULT 0,
    received_at          INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, conversation_id, sender_pubky, event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payment_events_request
    ON payment_events(owner_pubky, payment_request_id)`,

  `CREATE TABLE IF NOT EXISTS tip_endpoints (
    owner_pubky    TEXT    NOT NULL,
    peer_pubky     TEXT    NOT NULL,
    identifier     TEXT    NOT NULL,
    payload        TEXT    NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, peer_pubky, identifier)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tip_endpoints_peer
    ON tip_endpoints(owner_pubky, peer_pubky)`,
];

/**
 * Schema v10 — sender-scoped attachment identity + durable cleanup journal.
 *
 * v9 PK `(owner_pubky, event_id)` let a group member reuse another sender's
 * `event_id` and overwrite that sender's KeyStore secret. Identity is now
 * `(owner_pubky, sender_pubky, event_id)` and the KeyStore service is
 * `hypercolor-attachment-key:{owner}:{sender}:{event}`.
 *
 * `pending_cleanup` holds KeyStore service names (not secrets) whose
 * deletion failed during sign-out so the next launch can retry.
 */
export const SCHEMA_V10_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS attachments_v10 (
    owner_pubky          TEXT    NOT NULL,
    sender_pubky         TEXT    NOT NULL,
    event_id             TEXT    NOT NULL,
    conversation_id      TEXT,
    channel_id           TEXT,
    direction            TEXT    NOT NULL,
    location             TEXT    NOT NULL,
    key_ref              TEXT    NOT NULL,
    content_type         TEXT    NOT NULL,
    size                 INTEGER NOT NULL,
    thumbnail_location   TEXT,
    local_cache_path     TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    delivery_state       TEXT    NOT NULL,
    resolve_state        TEXT    NOT NULL,
    PRIMARY KEY (owner_pubky, sender_pubky, event_id)
  )`,
  `INSERT OR IGNORE INTO attachments_v10
     (owner_pubky, sender_pubky, event_id, conversation_id, channel_id,
      direction, location, key_ref, content_type, size, thumbnail_location,
      local_cache_path, created_at, updated_at, delivery_state, resolve_state)
   SELECT
      owner_pubky, sender_pubky, event_id, conversation_id, channel_id,
      direction, location, key_ref, content_type, size, thumbnail_location,
      local_cache_path, created_at, updated_at, delivery_state, resolve_state
     FROM attachments`,
  `DROP TABLE IF EXISTS attachments`,
  `ALTER TABLE attachments_v10 RENAME TO attachments`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_conversation
    ON attachments(owner_pubky, conversation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_channel
    ON attachments(owner_pubky, channel_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS pending_cleanup (
    owner_pubky    TEXT    NOT NULL,
    target_kind    TEXT    NOT NULL,
    target         TEXT    NOT NULL,
    created_at     INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, target_kind, target)
  )`,
];

/**
 * Schema v9 — encrypted attachments.
 *
 * Ciphertext is world-readable on the sender homeserver. The AEAD key/nonce
 * arrive over the Encrypted Link and are stored in the OS Keychain
 * (`KeyStore` service `hypercolor-attachment-key:{owner_pubky}:{event_id}`).
 * SQLite keeps only `key_ref` — never the key
 * itself — matching the M1 doctrine that link snapshots stay in
 * keychain/encrypted native storage.
 *
 * Plaintext bytes are never stored in SQLite. After resolve they live in a
 * local cache file; `local_cache_path` points at that file.
 *
 * PK is `(owner_pubky, event_id)`. Exactly one of `conversation_id` /
 * `channel_id` is set for a given row (application-enforced).
 * Superseded by v10 for sender-scoped identity.
 */
export const SCHEMA_V9_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS attachments (
    owner_pubky          TEXT    NOT NULL,
    event_id             TEXT    NOT NULL,
    conversation_id      TEXT,
    channel_id           TEXT,
    sender_pubky         TEXT    NOT NULL,
    direction            TEXT    NOT NULL,
    location             TEXT    NOT NULL,
    key_ref              TEXT    NOT NULL,
    content_type         TEXT    NOT NULL,
    size                 INTEGER NOT NULL,
    thumbnail_location   TEXT,
    local_cache_path     TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    delivery_state       TEXT    NOT NULL,
    resolve_state        TEXT    NOT NULL,
    PRIMARY KEY (owner_pubky, event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_conversation
    ON attachments(owner_pubky, conversation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_channel
    ON attachments(owner_pubky, channel_id, created_at DESC)`,
];

/**
 * Schema v8 — sender-scoped group event identity + bounded deferred store.
 *
 * v7 is committed history and is not rewritten. This migration rebuilds
 * `group_messages` so the primary key is
 * `(owner_pubky, channel_id, sender_pubky, event_id)` and adds
 * `target_author_pubky` so reaction/edit/delete resolve a target by
 * `(channel, target_author, target_event_id)`.
 *
 * Existing rows (none expected in production) are copied with
 * `target_author_pubky = NULL`. `INSERT OR IGNORE` keeps the copy
 * idempotent if a sender-scoped duplicate would otherwise collide.
 *
 * `group_seen_events` holds rejected-event dedup markers (never history).
 * `group_deferred_events` holds authorized reaction/edit/delete rows
 * whose target has not arrived yet (quota + TTL enforced in application
 * code). Both are wiped by `clearAccountData(owner_pubky)`.
 */
export const SCHEMA_V8_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS group_messages_v8 (
    owner_pubky          TEXT    NOT NULL,
    channel_id           TEXT    NOT NULL,
    sender_pubky         TEXT    NOT NULL,
    event_id             TEXT    NOT NULL,
    kind                 TEXT    NOT NULL,
    body                 TEXT    NOT NULL,
    raw_json             TEXT    NOT NULL,
    sent_at              INTEGER NOT NULL,
    received_at          INTEGER,
    delivery_state       TEXT    NOT NULL,
    reply_to_event_id    TEXT,
    target_event_id      TEXT,
    target_author_pubky  TEXT,
    edited_at            INTEGER,
    deleted              INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, channel_id, sender_pubky, event_id)
  )`,
  `INSERT OR IGNORE INTO group_messages_v8
     (owner_pubky, channel_id, sender_pubky, event_id, kind, body, raw_json,
      sent_at, received_at, delivery_state, reply_to_event_id, target_event_id,
      target_author_pubky, edited_at, deleted, created_at, updated_at)
   SELECT
      owner_pubky, channel_id, sender_pubky, event_id, kind, body, raw_json,
      sent_at, received_at, delivery_state, reply_to_event_id, target_event_id,
      NULL, edited_at, deleted, created_at, updated_at
     FROM group_messages`,
  `DROP TABLE IF EXISTS group_messages`,
  `ALTER TABLE group_messages_v8 RENAME TO group_messages`,
  `CREATE INDEX IF NOT EXISTS idx_group_messages_channel
    ON group_messages(owner_pubky, channel_id, sent_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_group_messages_target
    ON group_messages(owner_pubky, channel_id, target_author_pubky, target_event_id)`,

  `CREATE TABLE IF NOT EXISTS group_seen_events (
    owner_pubky    TEXT    NOT NULL,
    channel_id     TEXT    NOT NULL,
    sender_pubky   TEXT    NOT NULL,
    event_id       TEXT    NOT NULL,
    received_at    INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, channel_id, sender_pubky, event_id)
  )`,

  `CREATE TABLE IF NOT EXISTS group_deferred_events (
    owner_pubky          TEXT    NOT NULL,
    channel_id           TEXT    NOT NULL,
    sender_pubky         TEXT    NOT NULL,
    event_id             TEXT    NOT NULL,
    kind                 TEXT    NOT NULL,
    body                 TEXT    NOT NULL,
    raw_json             TEXT    NOT NULL,
    sent_at              INTEGER NOT NULL,
    received_at          INTEGER NOT NULL,
    target_event_id      TEXT    NOT NULL,
    target_author_pubky  TEXT    NOT NULL,
    PRIMARY KEY (owner_pubky, channel_id, sender_pubky, event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_group_deferred_target
    ON group_deferred_events(owner_pubky, channel_id, target_author_pubky, target_event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_group_deferred_sender
    ON group_deferred_events(owner_pubky, channel_id, sender_pubky, received_at, sent_at)`,
];

/**
 * Schema v7 — owner-scoped private groups + public channels.
 *
 * v1 `channels` / `channel_members` / `messages` stay in place (research-era,
 * not owner-scoped). M3 does not rewrite them. New group state lives here
 * and is wiped by `clearAccountData(owner_pubky)`.
 *
 * Private groups: pairwise fan-out over Encrypted Links (no shared key).
 * `membership_epoch` is a local bookkeeping counter bumped on remove/leave
 * so UI and tests can observe cutoff; there is no group secret to rotate.
 *
 * `group_messages.target_event_id` holds the referenced event for
 * reaction / edit / delete kinds. `reply_to_event_id` is only for
 * `chat.group.message.v0` threads. Unknown targets stay stored (deferred).
 * Superseded by v8 for sender-scoped identity and the deferred/seen tables.
 */
export const SCHEMA_V7_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS group_channels (
    owner_pubky        TEXT    NOT NULL,
    channel_id         TEXT    NOT NULL,
    name               TEXT    NOT NULL,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    created_by         TEXT    NOT NULL,
    is_public          INTEGER NOT NULL DEFAULT 0,
    last_message_at    INTEGER,
    membership_epoch   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_pubky, channel_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_group_channels_owner_activity
    ON group_channels(owner_pubky, last_message_at DESC, updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS group_members (
    owner_pubky    TEXT    NOT NULL,
    channel_id     TEXT    NOT NULL,
    member_pubky   TEXT    NOT NULL,
    role           TEXT    NOT NULL,
    added_at       INTEGER NOT NULL,
    removed_at     INTEGER,
    status         TEXT    NOT NULL,
    PRIMARY KEY (owner_pubky, channel_id, member_pubky)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_group_members_active
    ON group_members(owner_pubky, channel_id, status)`,

  `CREATE TABLE IF NOT EXISTS group_messages (
    owner_pubky         TEXT    NOT NULL,
    channel_id          TEXT    NOT NULL,
    event_id            TEXT    NOT NULL,
    sender_pubky        TEXT    NOT NULL,
    kind                TEXT    NOT NULL,
    body                TEXT    NOT NULL,
    raw_json            TEXT    NOT NULL,
    sent_at             INTEGER NOT NULL,
    received_at         INTEGER,
    delivery_state      TEXT    NOT NULL,
    reply_to_event_id   TEXT,
    target_event_id     TEXT,
    edited_at           INTEGER,
    deleted             INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    PRIMARY KEY (owner_pubky, channel_id, event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_group_messages_channel
    ON group_messages(owner_pubky, channel_id, sent_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_group_messages_target
    ON group_messages(owner_pubky, channel_id, target_event_id)`,
];

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
 * declines (retire the local link state).
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
