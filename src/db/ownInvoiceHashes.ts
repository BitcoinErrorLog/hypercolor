import { btcDecimalToMsat, tryDecodeBolt11Invoice } from '../utils/bolt11';
import {
  INVOICE_AMOUNT_UNKNOWN,
  INVOICE_AMOUNTLESS,
  encodeInvoiceAmountMsat,
} from '../services/payments/invoiceAmountBind';
import type { SqlExecutor } from './sql';

export const SCHEMA_META_TABLE = 'schema_meta';
export const OWN_INVOICE_HASH_BACKFILL_META_KEY = 'own_invoice_hashes_amount_backfill';
export const OWN_INVOICE_HASH_BACKFILL_COMPLETE = 'complete';

/** Distinctive FROM clause so tests can assert this scan did or did not run. */
export const OWN_INVOICE_HASH_BACKFILL_SCAN_FROM = 'own_invoice_hashes AS h';

let loggedMissingTable = false;

/**
 * Idempotent column ensure for `own_invoice_hashes`. v16 CREATE TABLE already
 * includes these columns on a fresh install; this path upgrades in-branch
 * databases that ran the earlier v16 (hash-only) table without bumping
 * `user_version`. Parent merge reconciliation (W2c → v17) is integration-owned.
 */
export function ensureOwnInvoiceHashColumns(db: SqlExecutor): void {
  const cols = new Set(
    (db.executeSync('PRAGMA table_info(own_invoice_hashes)').rows ?? []).map(row =>
      String(row.name),
    ),
  );
  if (cols.size === 0) return;
  if (!cols.has('invoice_amount_msat')) {
    db.executeSync('ALTER TABLE own_invoice_hashes ADD COLUMN invoice_amount_msat TEXT');
  }
  if (!cols.has('invoice_expires_at')) {
    db.executeSync('ALTER TABLE own_invoice_hashes ADD COLUMN invoice_expires_at INTEGER');
  }
}

export function ownInvoiceHashesTableExists(db: SqlExecutor): boolean {
  const rows =
    db.executeSync(
      `SELECT 1 AS ok FROM sqlite_master
        WHERE type = 'table' AND name = 'own_invoice_hashes'
        LIMIT 1`,
    ).rows ?? [];
  return rows.length > 0;
}

export function logMissingOwnInvoiceHashTableOnce(): void {
  if (loggedMissingTable) return;
  loggedMissingTable = true;
  console.debug('[db] skipped own_invoice_hashes amount backfill: table absent');
}

function schemaMetaTableExists(db: SqlExecutor): boolean {
  const rows =
    db.executeSync(
      `SELECT 1 AS ok FROM sqlite_master
        WHERE type = 'table' AND name = '${SCHEMA_META_TABLE}'
        LIMIT 1`,
    ).rows ?? [];
  return rows.length > 0;
}

function ensureSchemaMeta(db: SqlExecutor): void {
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA_META_TABLE} (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )`,
  );
}

export function isOwnInvoiceHashBackfillComplete(db: SqlExecutor): boolean {
  if (!schemaMetaTableExists(db)) return false;
  const meta =
    db.executeSync(`SELECT value FROM ${SCHEMA_META_TABLE} WHERE key = ? LIMIT 1`, [
      OWN_INVOICE_HASH_BACKFILL_META_KEY,
    ]).rows ?? [];
  return String(meta[0]?.value ?? '') === OWN_INVOICE_HASH_BACKFILL_COMPLETE;
}

function markOwnInvoiceHashBackfillComplete(db: SqlExecutor): void {
  ensureSchemaMeta(db);
  db.executeSync(
    `INSERT INTO ${SCHEMA_META_TABLE} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [OWN_INVOICE_HASH_BACKFILL_META_KEY, OWN_INVOICE_HASH_BACKFILL_COMPLETE],
  );
}

function bitcoinBindingFromPayload(payload: string): {
  amountMsat: string;
  expiresAt: number | null;
} | null {
  const decoded = tryDecodeBolt11Invoice(payload);
  if (!decoded || decoded.network !== 'bitcoin') return null;
  return {
    amountMsat: encodeInvoiceAmountMsat(decoded.amountMsat),
    expiresAt: decoded.expiresAtMs,
  };
}

/**
 * Fill NULL / sticky-`amountless` amount/expiry from the matching own tip
 * row. Idempotent for known millisatoshis. A successful mainnet decode
 * replaces the `amountless` sentinel. Rows with no matching payload are
 * marked `unknown` so they are not scanned again. After a pass that leaves
 * no NULL amounts, a durable meta key stops later startup scans.
 */
export function backfillOwnInvoiceHashAmounts(db: SqlExecutor): void {
  const rows =
    db.executeSync(
      `SELECT h.owner_pubky AS owner_pubky,
              h.endpoint_identifier AS endpoint_identifier,
              h.payment_hash AS payment_hash,
              t.payload AS payload,
              t.invoice_amount AS invoice_amount,
              t.invoice_expires_at AS invoice_expires_at
         FROM ${OWN_INVOICE_HASH_BACKFILL_SCAN_FROM}
         LEFT JOIN tip_endpoints AS t
           ON t.owner_pubky = h.owner_pubky
          AND t.peer_pubky = h.owner_pubky
          AND t.identifier = h.endpoint_identifier
          AND t.payment_hash = h.payment_hash
        WHERE h.invoice_amount_msat IS NULL
           OR h.invoice_amount_msat = ?`,
      [INVOICE_AMOUNTLESS],
    ).rows ?? [];
  for (const row of rows) {
    const ownerPubky = String(row.owner_pubky);
    const identifier = String(row.endpoint_identifier);
    const paymentHash = String(row.payment_hash);
    const payload = typeof row.payload === 'string' ? row.payload : null;
    const decoded = payload ? tryDecodeBolt11Invoice(payload) : null;
    let amountMsat: string | null = null;
    let expiresAt: number | null =
      typeof row.invoice_expires_at === 'number' ? row.invoice_expires_at : null;

    if (decoded && decoded.network !== 'bitcoin') {
      amountMsat = INVOICE_AMOUNT_UNKNOWN;
      expiresAt = null;
    } else {
      const binding = payload ? bitcoinBindingFromPayload(payload) : null;
      if (binding) {
        amountMsat = binding.amountMsat;
        if (binding.expiresAt !== null) expiresAt = binding.expiresAt;
      } else if (typeof row.invoice_amount === 'string') {
        const msat = btcDecimalToMsat(row.invoice_amount);
        amountMsat = msat === null ? INVOICE_AMOUNT_UNKNOWN : msat.toString();
      } else {
        amountMsat = INVOICE_AMOUNT_UNKNOWN;
      }
    }

    db.executeSync(
      `UPDATE own_invoice_hashes
          SET invoice_amount_msat = ?,
              invoice_expires_at = ?
        WHERE owner_pubky = ? AND endpoint_identifier = ? AND payment_hash = ?`,
      [amountMsat, expiresAt, ownerPubky, identifier, paymentHash],
    );
  }

  const remaining =
    db.executeSync(
      `SELECT 1 AS ok FROM own_invoice_hashes WHERE invoice_amount_msat IS NULL LIMIT 1`,
    ).rows ?? [];
  if (remaining.length === 0) {
    markOwnInvoiceHashBackfillComplete(db);
  }
}

/** Out-of-band v16 repair. Never throws because the table is missing. */
export function repairOwnInvoiceHashes(db: SqlExecutor): void {
  if (!ownInvoiceHashesTableExists(db)) {
    logMissingOwnInvoiceHashTableOnce();
    return;
  }
  ensureOwnInvoiceHashColumns(db);
  if (isOwnInvoiceHashBackfillComplete(db)) return;
  backfillOwnInvoiceHashAmounts(db);
}
