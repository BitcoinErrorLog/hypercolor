import Database from 'better-sqlite3';
import type { SqlExecutor, SqlParams, SqlValue } from '../sql';

type TestDb = SqlExecutor & { raw: Database.Database; close: () => void };

/**
 * Thin adapter so the REAL migration SQL and StorageService statements run
 * against in-memory SQLite. op-sqlite cannot load under Jest without its
 * native binaries; better-sqlite3 executes the identical SQL strings.
 */
export function openMemoryDb(): TestDb {
  return adapt(new Database(':memory:'));
}

/**
 * File-backed variant, for the cases where the point of the test is that state
 * survives the process — closing and re-opening the same file is the closest
 * available stand-in for an app restart.
 */
export function openFileDb(path: string): TestDb {
  return adapt(new Database(path));
}

function adapt(db: Database.Database): TestDb {
  // Match production `getDb()` connection preamble so FK-dependent SQL
  // behaves as it does on device.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return {
    raw: db,
    close: () => {
      if (!db.open) return;
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // Closing anyway.
      }
      db.close();
    },
    executeSync(query: string, params: SqlParams | SqlValue[] = []) {
      const sql = query.trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      if (/^PRAGMA\s+user_version\s*=/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      if (/^PRAGMA\s+user_version\s*$/i.test(sql)) {
        const value = db.pragma('user_version', { simple: true }) as number;
        return { rows: [{ user_version: value }] };
      }
      if (/^PRAGMA\s+foreign_keys\s*=/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      if (/^PRAGMA\s+foreign_keys\s*$/i.test(sql)) {
        const value = db.pragma('foreign_keys', { simple: true }) as number;
        return { rows: [{ foreign_keys: value }] };
      }
      if (/^PRAGMA\s+journal_mode\s*=/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
        return { rows: rows as Record<string, unknown>[] };
      }
      if (params.length > 0) stmt.run(...params);
      else stmt.run();
      return { rows: [] };
    },
  };
}
