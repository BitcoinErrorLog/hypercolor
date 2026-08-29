import Database from 'better-sqlite3';
import type { SqlExecutor, SqlParams, SqlValue } from '../sql';

/**
 * Thin adapter so the REAL migration SQL and StorageService statements run
 * against in-memory SQLite. op-sqlite cannot load under Jest without its
 * native binaries; better-sqlite3 executes the identical SQL strings.
 */
export function openMemoryDb(): SqlExecutor & { raw: Database.Database } {
  const db = new Database(':memory:');
  return {
    raw: db,
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
