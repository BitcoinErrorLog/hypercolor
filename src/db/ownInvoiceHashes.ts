import { btcDecimalToMsat, tryDecodeBolt11Invoice } from '../utils/bolt11';
import {
  INVOICE_AMOUNTLESS,
  encodeInvoiceAmountMsat,
} from '../services/payments/invoiceAmountBind';
import type { SqlExecutor } from './sql';

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

/**
 * Fill NULL amount/expiry from the matching own tip row. Idempotent: rows that
 * already have `invoice_amount_msat` are left alone. Uses the bolt11 decoder
 * when the payload is still on disk; otherwise converts stored BTC decimals.
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
         FROM own_invoice_hashes AS h
         LEFT JOIN tip_endpoints AS t
           ON t.owner_pubky = h.owner_pubky
          AND t.peer_pubky = h.owner_pubky
          AND t.identifier = h.endpoint_identifier
          AND t.payment_hash = h.payment_hash
        WHERE h.invoice_amount_msat IS NULL`,
    ).rows ?? [];
  for (const row of rows) {
    const ownerPubky = String(row.owner_pubky);
    const identifier = String(row.endpoint_identifier);
    const paymentHash = String(row.payment_hash);
    const payload = typeof row.payload === 'string' ? row.payload : null;
    const decoded = payload ? tryDecodeBolt11Invoice(payload) : null;
    let amountMsat: string | null = null;
    let expiresAt = typeof row.invoice_expires_at === 'number' ? row.invoice_expires_at : null;
    if (decoded) {
      amountMsat = encodeInvoiceAmountMsat(decoded.amountMsat);
      if (decoded.expiresAtMs !== null) expiresAt = decoded.expiresAtMs;
    } else if (row.invoice_amount === null && payload !== null) {
      amountMsat = INVOICE_AMOUNTLESS;
    } else if (typeof row.invoice_amount === 'string') {
      const msat = btcDecimalToMsat(row.invoice_amount);
      amountMsat = msat === null ? null : msat.toString();
    }
    if (amountMsat === null && expiresAt === null) continue;
    db.executeSync(
      `UPDATE own_invoice_hashes
          SET invoice_amount_msat = COALESCE(?, invoice_amount_msat),
              invoice_expires_at = COALESCE(?, invoice_expires_at)
        WHERE owner_pubky = ? AND endpoint_identifier = ? AND payment_hash = ?`,
      [amountMsat, expiresAt, ownerPubky, identifier, paymentHash],
    );
  }
}
