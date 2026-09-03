import { open, type DB } from '@op-engineering/op-sqlite';
import { runMigrations } from './migrations';
import type { SqlExecutor } from './sql';

export type { SqlExecutor, SqlExecuteResult, SqlParams, SqlValue } from './sql';

export const SQLITE_DB_NAME = 'hypercolor.db';

let _db: SqlExecutor | null = null;
let _testDb: SqlExecutor | null = null;
let _nativeDb: DB | null = null;

/**
 * Test seam: inject an in-memory executor (better-sqlite3 adapter) so the
 * real migration SQL and StorageService statements can run without op-sqlite
 * native binaries.
 */
export function setDbForTests(db: SqlExecutor | null): void {
  _testDb = db;
  if (db === null) _db = null;
}

/**
 * Returns the singleton op-sqlite database connection.
 * Opens and migrates on the first call, then returns the cached handle.
 *
 * All ops use WAL mode for concurrent read performance and safer crash recovery.
 */
export async function getDb(): Promise<SqlExecutor> {
  if (_testDb) return _testDb;
  if (_db) return _db;

  const db = open({
    name: SQLITE_DB_NAME,
    // location defaults to the app Documents directory on both platforms.
  });
  _nativeDb = db;

  // Enable WAL mode and foreign key enforcement before running migrations.
  db.executeSync('PRAGMA journal_mode = WAL');
  db.executeSync('PRAGMA foreign_keys = ON');

  const executor: SqlExecutor = {
    executeSync(query, params) {
      return db.executeSync(query, params as never);
    },
  };
  await runMigrations(executor);
  // Clear transient mesh peer data on every startup — BLE state is ephemeral.
  // Must run after migrations so the table exists on a fresh install.
  executor.executeSync('DELETE FROM mesh_peers');
  _db = executor;
  return executor;
}

function closeQuietly(close: (() => void) | undefined): void {
  if (!close) return;
  try {
    close();
  } catch {
    // Already closed.
  }
}

function unlinkSqliteSidecars(basePath: string): void {
  // Jest/node only: the better-sqlite3 adapter exposes a filesystem path.
  // Production uses op-sqlite `db.delete()` instead.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as { unlinkSync: (path: string) => void };
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(`${basePath}${suffix}`);
      } catch {
        // ENOENT is the desired end state.
      }
    }
  } catch {
    // React Native has no `fs`; native delete already ran.
  }
}

/** Closes the database. Primarily used in tests. */
export function closeDb(): void {
  if (_testDb) {
    closeQuietly((_testDb as { close?: () => void }).close);
    _testDb = null;
    _db = null;
    return;
  }
  closeQuietly(_nativeDb ? () => _nativeDb!.close() : undefined);
  _nativeDb = null;
  _db = null;
}

/**
 * Close the handle then delete the SQLite database file and WAL/SHM
 * sidecars. Used by the failed-wipe reset, not by row-scoped sign-out.
 */
export function closeAndDeleteSqliteDatabase(): void {
  if (_nativeDb) {
    _nativeDb.delete();
    _nativeDb = null;
    _db = null;
    return;
  }
  const testDb = _testDb as { close?: () => void; raw?: { name?: string } } | null;
  const testPath =
    typeof testDb?.raw?.name === 'string' && testDb.raw.name !== ':memory:'
      ? testDb.raw.name
      : null;
  closeDb();
  if (testPath) {
    unlinkSqliteSidecars(testPath);
  }
}
