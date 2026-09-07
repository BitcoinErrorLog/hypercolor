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
  SCHEMA_V14_STATEMENTS,
  SCHEMA_V15_STATEMENTS,
  SCHEMA_V16_STATEMENTS,
  SCHEMA_V17_STATEMENTS,
  SCHEMA_V18_STATEMENTS,
  SCHEMA_V19_STATEMENTS,
  SCHEMA_V20_STATEMENTS,
  SCHEMA_V21_STATEMENTS,
} from './schema';
import type { SqlExecutor, SqlValue } from './sql';
import {
  markOwnInvoiceHashRepairRetry,
  repairOwnInvoiceHashes,
  runOwnInvoiceHashAmountBackfill,
} from './ownInvoiceHashes';

/**
 * Migration runner for Hypercolor SQLite database.
 *
 * Each migration is a list of SQL statements applied atomically inside a
 * transaction. Versions are stored in the SQLite user_version pragma.
 *
 * Rules:
 * - Never modify an existing migration. Add a new one instead.
 * - Every statement must be idempotent (use IF NOT EXISTS / IF EXISTS).
 * - After adding a migration, bump CURRENT_VERSION.
 *
 * Versioning note (mobile UX integration): W2b and W2c both shipped
 * unreleased `user_version = 16` with different tables. We keep W2b as
 * v16 and add v17 as the idempotent union (W2c own-invoice-hash objects
 * plus W2b CREATE IF NOT EXISTS). That way devices on either v16 shape
 * converge, and v15 devices step through v16 then v17. Idempotent
 * repairs (blocked-peers column, legacy queue owners, own-invoice-hash
 * repair/backfill) still re-run after the version loop.
 */

/** Test seam: current `user_version` after `runMigrations`. Do not hard-code. */
export const CURRENT_SCHEMA_VERSION = 21;
const CURRENT_VERSION = CURRENT_SCHEMA_VERSION;

type Migration = {
  version: number;
  statements: readonly string[];
};

const MIGRATIONS: readonly Migration[] = [
  { version: 1, statements: SCHEMA_V1_STATEMENTS },
  { version: 2, statements: SCHEMA_V2_STATEMENTS },
  { version: 3, statements: SCHEMA_V3_STATEMENTS },
  { version: 4, statements: SCHEMA_V4_STATEMENTS },
  { version: 5, statements: SCHEMA_V5_STATEMENTS },
  { version: 6, statements: SCHEMA_V6_STATEMENTS },
  { version: 7, statements: SCHEMA_V7_STATEMENTS },
  { version: 8, statements: SCHEMA_V8_STATEMENTS },
  { version: 9, statements: SCHEMA_V9_STATEMENTS },
  { version: 10, statements: SCHEMA_V10_STATEMENTS },
  { version: 11, statements: SCHEMA_V11_STATEMENTS },
  { version: 12, statements: SCHEMA_V12_STATEMENTS },
  { version: 13, statements: SCHEMA_V13_STATEMENTS },
  { version: 14, statements: SCHEMA_V14_STATEMENTS },
  { version: 15, statements: SCHEMA_V15_STATEMENTS },
  { version: 16, statements: SCHEMA_V16_STATEMENTS },
  { version: 17, statements: SCHEMA_V17_STATEMENTS },
  { version: 18, statements: SCHEMA_V18_STATEMENTS },
  { version: 19, statements: SCHEMA_V19_STATEMENTS },
  { version: 20, statements: SCHEMA_V20_STATEMENTS },
  { version: 21, statements: SCHEMA_V21_STATEMENTS },
];

export async function runMigrations(db: SqlExecutor): Promise<void> {
  // Read current schema version
  const versionResult = db.executeSync('PRAGMA user_version');
  const currentVersion: number = (versionResult.rows?.[0]?.user_version as number) ?? 0;

  if (currentVersion > CURRENT_VERSION) {
    return;
  }

  // Apply any pending versioned migrations (v15→v16→v17, or v16→v17).
  // v17 statements are all IF NOT EXISTS / idempotent so either prior v16
  // shape can upgrade safely.
  const pending = MIGRATIONS.filter(m => m.version > currentVersion);
  for (const migration of pending) {
    db.executeSync('BEGIN');
    try {
      for (const statement of migration.statements) {
        applyStatement(db, statement);
      }
      db.executeSync(`PRAGMA user_version = ${migration.version}`);
      db.executeSync('COMMIT');
    } catch (err) {
      db.executeSync('ROLLBACK');
      throw new Error(`Migration v${migration.version} failed: ${(err as Error).message}`);
    }
  }

  // Post-version idempotent reconciliation — safe on every launch.
  // Covers: already-at-17 DBs, and CREATE-replay for objects that may
  // predate later in-branch ALTERs on unreleased v16 installs.
  db.executeSync('BEGIN');
  try {
    for (const statement of SCHEMA_V16_STATEMENTS) {
      if (/ALTER TABLE/i.test(statement)) continue;
      applyStatement(db, statement);
    }
    for (const statement of SCHEMA_V17_STATEMENTS) {
      if (/ALTER TABLE/i.test(statement)) continue;
      applyStatement(db, statement);
    }
    for (const statement of SCHEMA_V20_STATEMENTS) {
      if (/ALTER TABLE/i.test(statement)) continue;
      applyStatement(db, statement);
    }
    tryEnableMessageFts(db);
    ensureBlockedPeersCleanupPending(db);
    reconcileLegacyQueueOwners(db);
    db.executeSync('COMMIT');
  } catch (err) {
    db.executeSync('ROLLBACK');
    throw err;
  }

  // W2c own-invoice-hash repair is never startup-fatal: repair commits
  // `invoice_reused` before the rest, then amount backfill commits
  // separately, so a later throw cannot roll back CREATE TABLE.
  try {
    repairOwnInvoiceHashes(db);
  } catch (err) {
    logOwnInvoiceHashRepairFailure(db, err);
  }
  try {
    db.executeSync('BEGIN');
    runOwnInvoiceHashAmountBackfill(db);
    db.executeSync('COMMIT');
  } catch (err) {
    logOwnInvoiceHashRepairFailure(db, err);
  }
}

function logOwnInvoiceHashRepairFailure(db: SqlExecutor, err: unknown): void {
  try {
    db.executeSync('ROLLBACK');
  } catch {
    // Rollback is best-effort if BEGIN never succeeded.
  }
  console.warn(
    '[db] own_invoice_hashes repair failed; will retry next launch',
    err instanceof Error ? err.message : 'unknown error',
  );
  try {
    db.executeSync('BEGIN');
    markOwnInvoiceHashRepairRetry(db);
    db.executeSync('COMMIT');
  } catch {
    try {
      db.executeSync('ROLLBACK');
    } catch {
      // Marker write is best-effort; next launch still retries because the
      // completion key is not set.
    }
  }
}

function tableExists(db: SqlExecutor, name: string): boolean {
  const result = db.executeSync(
    `SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    [name],
  );
  return (result.rows?.length ?? 0) > 0;
}

function payloadOwner(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as { ownerPubky?: unknown };
    return typeof parsed.ownerPubky === 'string' && parsed.ownerPubky.length > 0
      ? parsed.ownerPubky
      : null;
  } catch {
    return null;
  }
}

function distinctOwners(db: SqlExecutor, sql: string, params: SqlValue[]): string[] {
  try {
    const result = db.executeSync(sql, params);
    return [...new Set((result.rows ?? []).map(row => String(row.owner_pubky)))].filter(
      owner => owner.length > 0,
    );
  } catch {
    return [];
  }
}

function deriveLegacyQueueOwner(
  db: SqlExecutor,
  row: { message_id: unknown; recipient_pubky: unknown; payload: unknown },
): string | null {
  let parsed: {
    eventId?: unknown;
    senderPubky?: unknown;
    kind?: unknown;
    channelId?: unknown;
    peerPubky?: unknown;
  } = {};
  try {
    const value = JSON.parse(String(row.payload ?? '')) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    parsed = value as typeof parsed;
  } catch {
    return null;
  }
  const eventId =
    typeof parsed.eventId === 'string' && parsed.eventId.length > 0
      ? parsed.eventId
      : String(row.message_id ?? '');
  const sender = typeof parsed.senderPubky === 'string' ? parsed.senderPubky : null;
  const kind = typeof parsed.kind === 'string' ? parsed.kind : null;
  const peer =
    typeof parsed.peerPubky === 'string' ? parsed.peerPubky : String(row.recipient_pubky ?? '');
  const channelId = typeof parsed.channelId === 'string' ? parsed.channelId : null;

  if (eventId.length > 0 && tableExists(db, 'link_messages')) {
    const owners = distinctOwners(
      db,
      `SELECT DISTINCT owner_pubky FROM link_messages
       WHERE event_id = ?
         AND (? IS NULL OR sender_pubky = ?)
         AND (? IS NULL OR kind = ?)
         AND (? IS NULL OR peer_pubky = ?)`,
      [eventId, sender, sender, kind, kind, peer, peer],
    );
    if (owners.length === 1) return owners[0]!;
    if (owners.length > 1) return null;
  }

  if (eventId.length > 0 && tableExists(db, 'group_messages')) {
    const owners = distinctOwners(
      db,
      `SELECT DISTINCT owner_pubky FROM group_messages
       WHERE event_id = ?
         AND (? IS NULL OR sender_pubky = ?)
         AND (? IS NULL OR channel_id = ?)`,
      [eventId, sender, sender, channelId, channelId],
    );
    if (owners.length === 1) return owners[0]!;
  }
  return null;
}

/**
 * Pre-v4 `delivery_queue` rows have no `payload.ownerPubky`. Backfill from
 * the matching message row when exactly one owner is derivable; otherwise
 * delete — plaintext retention is worse than a lost retry.
 */
function reconcileLegacyQueueOwners(db: SqlExecutor): void {
  if (!tableExists(db, 'delivery_queue')) return;
  const rows =
    db.executeSync('SELECT id, message_id, recipient_pubky, payload FROM delivery_queue').rows ??
    [];
  for (const row of rows) {
    const id = String(row.id);
    const payload = String(row.payload ?? '');
    if (payloadOwner(payload)) continue;
    const derived = deriveLegacyQueueOwner(db, {
      message_id: row.message_id,
      recipient_pubky: row.recipient_pubky,
      payload: row.payload,
    });
    if (!derived) {
      db.executeSync('DELETE FROM delivery_queue WHERE id = ?', [id]);
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      db.executeSync('UPDATE delivery_queue SET payload = ? WHERE id = ?', [
        JSON.stringify({ ...parsed, ownerPubky: derived }),
        id,
      ]);
    } catch {
      db.executeSync('DELETE FROM delivery_queue WHERE id = ?', [id]);
    }
  }
}

function tryEnableMessageFts(db: SqlExecutor): void {
  try {
    db.executeSync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS link_message_fts USING fts5(
        body,
        owner_pubky UNINDEXED,
        conversation_id UNINDEXED,
        event_id UNINDEXED,
        sender_pubky UNINDEXED
      )`,
    );
    db.executeSync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS group_message_fts USING fts5(
        body,
        owner_pubky UNINDEXED,
        channel_id UNINDEXED,
        event_id UNINDEXED,
        sender_pubky UNINDEXED
      )`,
    );
  } catch {
    // op-sqlite / host SQLite without FTS5: indexed LIKE on body_search.
  }
  try {
    db.executeSync(
      `UPDATE link_messages SET body_search = lower(body) WHERE body_search = '' AND body != ''`,
    );
    db.executeSync(
      `UPDATE group_messages SET body_search = lower(body) WHERE body_search = '' AND body != ''`,
    );
  } catch {
    // Columns missing on dual-v16 fixtures without link_messages.
  }
}

function ensureBlockedPeersCleanupPending(db: SqlExecutor): void {
  const info = db.executeSync('PRAGMA table_info(blocked_peers)');
  const names = (info.rows ?? []).map(row => String(row.name));
  if (names.length === 0 || names.includes('cleanup_pending')) return;
  db.executeSync('ALTER TABLE blocked_peers ADD COLUMN cleanup_pending INTEGER NOT NULL DEFAULT 0');
}

/**
 * `ALTER TABLE … ADD COLUMN` is not `IF NOT EXISTS`. The v16 migration
 * CREATE already includes `cleanup_pending`; the following ALTER is for
 * databases that created `blocked_peers` before that column existed.
 */
function applyStatement(db: SqlExecutor, statement: string): void {
  try {
    db.executeSync(statement);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      (/ALTER TABLE/i.test(statement) && /ADD COLUMN/i.test(statement)) ||
      /CREATE INDEX/i.test(statement)
    ) {
      if (/duplicate column name/i.test(message)) return;
      if (/no such table/i.test(message)) {
        console.warn('[migrations] skipping statement: no such table', statement.split('\n')[0]);
        return;
      }
    }
    throw err;
  }
}
