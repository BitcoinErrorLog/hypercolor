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

  // CURRENT_VERSION stays 16 while v16 statements remain additive and
  // idempotent. Databases that already recorded user_version=16 must still
  // pick up in-version DDL (blocked_peers.cleanup_pending).
  if (currentVersion === CURRENT_VERSION) {
    const latest = MIGRATIONS.find(m => m.version === CURRENT_VERSION);
    if (!latest) return;
    db.executeSync('BEGIN');
    try {
      for (const statement of latest.statements) {
        applyStatement(db, statement);
      }
      db.executeSync('COMMIT');
    } catch (err) {
      db.executeSync('ROLLBACK');
      throw new Error(`Migration v${latest.version} reconcile failed: ${(err as Error).message}`);
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

/**
 * `ALTER TABLE … ADD COLUMN` is not `IF NOT EXISTS`. Re-running v16 after a
 * CREATE that already includes the column (or a previous ALTER) must not
 * fail the whole migration.
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
