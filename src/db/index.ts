import { open } from '@op-engineering/op-sqlite';
import { runMigrations } from './migrations';
import type { SqlExecutor } from './sql';

export type { SqlExecutor, SqlExecuteResult, SqlParams, SqlValue } from './sql';

let _db: SqlExecutor | null = null;
let _testDb: SqlExecutor | null = null;

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
    name: 'hypercolor.db',
    // location defaults to the app Documents directory on both platforms.
  });

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

/** Closes the database. Primarily used in tests. */
export function closeDb(): void {
  if (_testDb) {
    _testDb = null;
    return;
  }
  const db = _db as { close?: () => void } | null;
  db?.close?.();
  _db = null;
}
