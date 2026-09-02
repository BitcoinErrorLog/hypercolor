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
 */

/** Test seam: current `user_version` after `runMigrations`. Do not hard-code 16. */
export const CURRENT_SCHEMA_VERSION = 16;
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
];

export async function runMigrations(db: SqlExecutor): Promise<void> {
  // Read current schema version
  const versionResult = db.executeSync('PRAGMA user_version');
  const currentVersion: number = (versionResult.rows?.[0]?.user_version as number) ?? 0;

  if (currentVersion < CURRENT_VERSION) {
    const pending = MIGRATIONS.filter(m => m.version > currentVersion);

    for (const migration of pending) {
      db.executeSync('BEGIN');
      try {
        for (const statement of migration.statements) {
          db.executeSync(statement);
        }
        db.executeSync(`PRAGMA user_version = ${migration.version}`);
        db.executeSync('COMMIT');
      } catch (err) {
        db.executeSync('ROLLBACK');
        throw new Error(`Migration v${migration.version} failed: ${(err as Error).message}`);
      }
    }
  }

  // In-branch v16 databases may predate amount/expiry columns or the table
  // itself (W2b-stamped v16). Idempotent; no version bump. Never startup-fatal:
  // `repairOwnInvoiceHashes` commits `invoice_reused` before the rest of
  // repair, then this runner commits amount backfill separately, so a later
  // throw cannot roll back CREATE TABLE or the additive column. Backfill
  // errors are logged and retried next launch.
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
