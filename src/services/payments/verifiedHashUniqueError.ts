/**
 * SQLite unique-constraint matcher for the owner verified-hash index.
 *
 * `idx_payment_requests_owner_verified_hash` is UNIQUE on
 * `(owner_pubky, displayed_payment_hash) WHERE proof_verified = 1`.
 * SQLite reports either that index name or the exact two-column list.
 * Any other UNIQUE (including a future index that merely mentions
 * `displayed_payment_hash`) is not replay and must be rethrown.
 */

export function isVerifiedHashUniqueError(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
  const message = err instanceof Error ? err.message : String(err);
  const isUnique =
    /UNIQUE constraint failed/i.test(message) ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    /CONSTRAINT_UNIQUE/i.test(code);
  if (!isUnique) return false;
  if (/\bidx_payment_requests_owner_verified_hash\b/.test(message)) return true;
  const listed = message.match(/UNIQUE constraint failed:\s*(.+)$/i);
  if (!listed?.[1]) return false;
  const columns = listed[1]
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(part => part.length > 0);
  return (
    columns.length === 2 &&
    columns[0] === 'payment_requests.owner_pubky' &&
    columns[1] === 'payment_requests.displayed_payment_hash'
  );
}
