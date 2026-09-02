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
} from './schema';
import type { SqlExecutor } from './sql';

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
 */

const CURRENT_VERSION = 16;

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
];

export async function runMigrations(db: SqlExecutor): Promise<void> {
  // Read current schema version
  const versionResult = db.executeSync('PRAGMA user_version');
  const currentVersion: number = (versionResult.rows?.[0]?.user_version as number) ?? 0;

  if (currentVersion > CURRENT_VERSION) {
    return;
  }

  // CURRENT_VERSION stays 16. Unreleased v16 was mutated in place, so a
  // database already stamped 16 may be missing later-wave tables. Replay
  // the idempotent CREATE TABLE/INDEX statements every launch; gate only
  // the duplicate-column ALTER behind PRAGMA table_info.
  if (currentVersion === CURRENT_VERSION) {
    const latest = MIGRATIONS.find(m => m.version === CURRENT_VERSION);
    if (!latest) return;
    db.executeSync('BEGIN');
    try {
      for (const statement of latest.statements) {
        if (/ALTER TABLE/i.test(statement)) continue;
        applyStatement(db, statement);
      }
      ensureBlockedPeersCleanupPending(db);
      db.executeSync('COMMIT');
    } catch (err) {
      db.executeSync('ROLLBACK');
      throw err;
    }
    return;
  }

  const pending = MIGRATIONS.filter(m => m.version > currentVersion);

  for (const migration of pending) {
    db.executeSync('BEGIN');
    try {
      for (const statement of migration.statements) {
        applyStatement(db, statement);
      }
      // Commit and advance the schema version
      db.executeSync(`PRAGMA user_version = ${migration.version}`);
      db.executeSync('COMMIT');
    } catch (err) {
      db.executeSync('ROLLBACK');
      throw new Error(`Migration v${migration.version} failed: ${(err as Error).message}`);
    }
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
      /ALTER TABLE/i.test(statement) &&
      /ADD COLUMN/i.test(statement) &&
      /duplicate column name/i.test(message)
    ) {
      return;
    }
    throw err;
  }
}
