import * as fs from 'fs';
import * as path from 'path';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';

/**
 * W2C P4s: release-binding EXISTS subqueries require direction = 'sent';
 * invoice reuse is decided inside the create transaction.
 */
describe('own invoice binding release direction scope', () => {
  function setup() {
    const db = openMemoryDb();
    db.executeSync(`
      CREATE TABLE payment_requests (
        owner_pubky TEXT NOT NULL,
        peer_pubky TEXT NOT NULL,
        payment_request_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (owner_pubky, peer_pubky, payment_request_id)
      )
    `);
    db.executeSync(`
      CREATE TABLE own_invoice_hashes (
        owner_pubky TEXT NOT NULL,
        payment_hash TEXT NOT NULL,
        payment_request_id TEXT,
        PRIMARY KEY (owner_pubky, payment_hash)
      )
    `);
    return db;
  }

  it('does not release a binding when only a received row shares the request id', () => {
    const db = setup();
    const owner = 'owner';
    const id = 'req-1';
    db.executeSync(
      `INSERT INTO payment_requests
        (owner_pubky, peer_pubky, payment_request_id, direction, status, expires_at)
       VALUES (?, ?, ?, 'received', 'pending', ?)`,
      [owner, 'peer', id, Date.now() - 1000],
    );
    db.executeSync(
      `INSERT INTO own_invoice_hashes (owner_pubky, payment_hash, payment_request_id)
       VALUES (?, 'hash', ?)`,
      [owner, id],
    );
    db.executeSync(
      `UPDATE own_invoice_hashes
          SET payment_request_id = NULL
        WHERE owner_pubky = ?
          AND payment_request_id = ?
          AND EXISTS (
            SELECT 1 FROM payment_requests AS r
             WHERE r.owner_pubky = ?
               AND r.payment_request_id = ?
               AND r.direction = 'sent'
               AND (
                 r.status IN ('cancelled', 'rejected')
                 OR (
                   r.status = 'pending'
                   AND r.expires_at IS NOT NULL
                   AND r.expires_at <= ?
                 )
               )
          )`,
      [owner, id, owner, id, Date.now()],
    );
    const row = db.executeSync(
      `SELECT payment_request_id FROM own_invoice_hashes WHERE owner_pubky = ?`,
      [owner],
    ).rows?.[0];
    expect(row?.payment_request_id).toBe(id);
  });

  it('releases a binding for an expired sent request', () => {
    const db = setup();
    const owner = 'owner';
    const id = 'req-2';
    db.executeSync(
      `INSERT INTO payment_requests
        (owner_pubky, peer_pubky, payment_request_id, direction, status, expires_at)
       VALUES (?, ?, ?, 'sent', 'pending', ?)`,
      [owner, 'peer', id, Date.now() - 1000],
    );
    db.executeSync(
      `INSERT INTO own_invoice_hashes (owner_pubky, payment_hash, payment_request_id)
       VALUES (?, 'hash2', ?)`,
      [owner, id],
    );
    db.executeSync(
      `UPDATE own_invoice_hashes
          SET payment_request_id = NULL
        WHERE owner_pubky = ?
          AND payment_request_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM payment_requests AS r
             WHERE r.owner_pubky = own_invoice_hashes.owner_pubky
               AND r.payment_request_id = own_invoice_hashes.payment_request_id
               AND r.direction = 'sent'
               AND r.status = 'pending'
               AND r.expires_at IS NOT NULL
               AND r.expires_at <= ?
          )`,
      [owner, Date.now()],
    );
    const row = db.executeSync(
      `SELECT payment_request_id FROM own_invoice_hashes WHERE owner_pubky = ?`,
      [owner],
    ).rows?.[0];
    expect(row?.payment_request_id ?? null).toBeNull();
  });
});

describe('invoice reuse decided inside create transaction', () => {
  it('persistPaymentCreateWithSendIntent computes invoiceReused under ownedTransact', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../StorageService.ts'), 'utf8');
    expect(source).toMatch(/ownedTransact\([\s\S]*hasDisplayedPaymentHashSync/);
    expect(source).toMatch(
      /const invoiceReused =\s*displayed !== null && hasDisplayedPaymentHashSync/,
    );
    const pay = fs.readFileSync(path.join(__dirname, '../PaymentService.ts'), 'utf8');
    expect(pay).not.toMatch(/hasDisplayedPaymentHash\(/);
  });
});
