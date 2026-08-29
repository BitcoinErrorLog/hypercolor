import { open, type DB } from '@op-engineering/op-sqlite';
import { runMigrations } from './migrations';

let _db: DB | null = null;

/**
 * Returns the singleton op-sqlite database connection.
 * Opens and migrates on the first call, then returns the cached handle.
 *
 * All ops use WAL mode for concurrent read performance and safer crash recovery.
 */
export async function getDb(): Promise<DB> {
  if (_db) return _db;

  const db = open({
    name: 'hypercolor.db',
    // location defaults to the app Documents directory on both platforms.
  });

  // Enable WAL mode and foreign key enforcement before running migrations.
  db.executeSync('PRAGMA journal_mode = WAL');
  db.executeSync('PRAGMA foreign_keys = ON');
  // Clear transient mesh peer data on every startup — BLE state is ephemeral.
  db.executeSync('DELETE FROM mesh_peers');

  await runMigrations(db);

  _db = db;
  return db;
}

/** Closes the database. Primarily used in tests. */
export function closeDb(): void {
  _db?.close();
  _db = null;
}
