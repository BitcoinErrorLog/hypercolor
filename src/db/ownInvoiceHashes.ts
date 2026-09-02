import { btcDecimalToMsat, tryDecodeBolt11Invoice } from '../utils/bolt11';
import {
  INVOICE_AMOUNT_UNKNOWN,
  INVOICE_AMOUNTLESS,
  encodeInvoiceAmountMsat,
} from '../services/payments/invoiceAmountBind';
import {
  OWN_INVOICE_HASHES_CREATE_SQL,
  OWN_INVOICE_HASHES_SEED_SQL,
  PAYMENT_REQUESTS_VERIFIED_HASH_DEDUP_SQL,
  PAYMENT_REQUESTS_VERIFIED_HASH_INDEX_SQL,
} from './schema';
import type { SqlExecutor } from './sql';

export const SCHEMA_META_TABLE = 'schema_meta';
export const OWN_INVOICE_HASH_BACKFILL_META_KEY = 'own_invoice_hashes_amount_backfill';
export const OWN_INVOICE_HASH_BACKFILL_COMPLETE = 'complete';
export const OWN_INVOICE_HASH_REPAIR_RETRY_META_KEY = 'own_invoice_hashes_repair_retry';

/** Distinctive FROM clause so tests can assert this scan did or did not run. */
export const OWN_INVOICE_HASH_BACKFILL_SCAN_FROM = 'own_invoice_hashes AS h';

let loggedMissingTable = false;
let loggedMissingRuntime = false;

export function isMissingOwnInvoiceHashesTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such table:\s*['"]?own_invoice_hashes['"]?/i.test(message);
}

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
  if (!cols.has('display_context')) {
    db.executeSync('ALTER TABLE own_invoice_hashes ADD COLUMN display_context TEXT');
  }
  if (!cols.has('payment_request_id')) {
    db.executeSync('ALTER TABLE own_invoice_hashes ADD COLUMN payment_request_id TEXT');
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

function tableExists(db: SqlExecutor, name: string): boolean {
  const rows =
    db.executeSync(
      `SELECT 1 AS ok FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1`,
      [name],
    ).rows ?? [];
  return rows.length > 0;
}

/**
 * Additive v16 column on `payment_requests`. Idempotent; no version bump.
 * Integration owns schema numbering at merge.
 */
export function ensurePaymentRequestInvoiceReusedColumn(db: SqlExecutor): void {
  if (!tableExists(db, 'payment_requests')) return;
  const cols = new Set(
    (db.executeSync('PRAGMA table_info(payment_requests)').rows ?? []).map(row => String(row.name)),
  );
  if (!cols.has('invoice_reused')) {
    db.executeSync('ALTER TABLE payment_requests ADD COLUMN invoice_reused INTEGER');
  }
}

export function logMissingOwnInvoiceHashTableOnce(): void {
  if (loggedMissingTable) return;
  loggedMissingTable = true;
  console.debug('[db] skipped own_invoice_hashes amount backfill: table absent');
}

export function logMissingOwnInvoiceHashTableRuntime(): void {
  if (loggedMissingRuntime) return;
  loggedMissingRuntime = true;
  console.warn('[db] own_invoice_hashes table missing; invoice binding skipped');
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

export function ensureSchemaMeta(db: SqlExecutor): void {
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

export function markOwnInvoiceHashRepairRetry(db: SqlExecutor): void {
  ensureSchemaMeta(db);
  db.executeSync(
    `INSERT INTO ${SCHEMA_META_TABLE} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [OWN_INVOICE_HASH_REPAIR_RETRY_META_KEY, String(Date.now())],
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

/**
 * Idempotent v16 own-invoice structural repair. Creates the table on any v16
 * database (including a W2b-stamped v16 that never ran this set). Never throws
 * because the table is missing. Amount backfill is a separate transaction.
 */
export function repairOwnInvoiceHashes(db: SqlExecutor): void {
  db.executeSync(OWN_INVOICE_HASHES_CREATE_SQL);
  if (!ownInvoiceHashesTableExists(db)) {
    logMissingOwnInvoiceHashTableOnce();
    return;
  }
  ensureOwnInvoiceHashColumns(db);
  if (tableExists(db, 'tip_endpoints')) {
    db.executeSync(OWN_INVOICE_HASHES_SEED_SQL);
  }
  if (tableExists(db, 'payment_requests')) {
    ensurePaymentRequestInvoiceReusedColumn(db);
    db.executeSync(PAYMENT_REQUESTS_VERIFIED_HASH_DEDUP_SQL);
    db.executeSync(PAYMENT_REQUESTS_VERIFIED_HASH_INDEX_SQL);
  }
}

/**
 * Amount/expiry backfill. Runs in its own transaction after structural repair
 * so a scan failure cannot roll back CREATE TABLE.
 */
export function runOwnInvoiceHashAmountBackfill(db: SqlExecutor): void {
  if (!ownInvoiceHashesTableExists(db)) {
    logMissingOwnInvoiceHashTableOnce();
    return;
  }
  if (isOwnInvoiceHashBackfillComplete(db)) return;
  if (!tableExists(db, 'tip_endpoints')) return;
  backfillOwnInvoiceHashAmounts(db);
}
