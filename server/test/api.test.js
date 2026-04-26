process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Database from 'better-sqlite3';

const { createApp } = await import('../src/index.js');

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('buyer','supplier'))
    );
    CREATE TABLE rfqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, pickup_date TEXT NOT NULL,
      bid_start_at TEXT NOT NULL, bid_close_initial_at TEXT NOT NULL,
      bid_close_current_at TEXT NOT NULL, forced_bid_close_at TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_window_minutes INTEGER NOT NULL,
      extension_minutes INTEGER NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
      supplier_id INTEGER NOT NULL REFERENCES users(id),
      carrier_name TEXT NOT NULL,
      freight_charges REAL NOT NULL, origin_charges REAL NOT NULL, destination_charges REAL NOT NULL,
      total_price REAL NOT NULL,
      transit_time_days INTEGER NOT NULL, quote_validity_days INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
      event_type TEXT NOT NULL, message TEXT NOT NULL,
      metadata TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const insertUser = db.prepare('INSERT INTO users (name, role) VALUES (?, ?)');
  insertUser.run('Buyer', 'buyer');           // id 1
  insertUser.run('Supplier A', 'supplier');   // id 2
  insertUser.run('Supplier B', 'supplier');   // id 3
  insertUser.run('Supplier C', 'supplier');   // id 4
  return db;
}

function isoNowPlusMinutes(min) {
  return new Date(Date.now() + min * 60 * 1000).toISOString();
}

test('happy path: create RFQ, three suppliers bid, ranks + extensions reflected', async () => {
  const db = setupDb();
  const app = createApp(db);

  // Buyer creates an RFQ where the auction is currently active
  const rfqRes = await request(app)
    .post('/api/rfqs')
    .set('X-User-Id', '1')
    .send({
      referenceId: 'RFQ-T-1',
      name: 'Test Auction',
      pickupDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      bidStartAt: isoNowPlusMinutes(-1),                  // started 1 min ago
      bidCloseAt: isoNowPlusMinutes(5),                   // closes in 5 min
      forcedBidCloseAt: isoNowPlusMinutes(60),
      triggerType: 'L1_RANK_CHANGE',
      triggerWindowMinutes: 10,                            // we are inside the window
      extensionMinutes: 3
    });

  assert.equal(rfqRes.status, 201, JSON.stringify(rfqRes.body));
  const rfqId = rfqRes.body.id;

  // Supplier A bids 1000 (becomes L1)
  const a = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '2')
    .send({ carrierName: 'A', freightCharges: 800, originCharges: 100, destinationCharges: 100, transitTimeDays: 3, quoteValidityDays: 30 });
  assert.equal(a.status, 201);
  assert.equal(a.body.bids[0].supplier.name, 'Supplier A');
  assert.equal(a.body.bids[0].totalPrice, 1000);

  const closeAfterA = a.body.bidCloseCurrentAt;

  // Supplier B bids 900 — should change L1, extending the auction
  const b = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '3')
    .send({ carrierName: 'B', freightCharges: 700, originCharges: 100, destinationCharges: 100, transitTimeDays: 4, quoteValidityDays: 30 });
  assert.equal(b.status, 201);
  assert.equal(b.body.bids[0].supplier.name, 'Supplier B');
  assert.equal(b.body.bids[0].totalPrice, 900);
  assert.ok(b.body.bidCloseCurrentAt > closeAfterA, 'auction should extend after L1 change');
  assert.ok(b.body.activityLog.some(e => e.eventType === 'EXTENSION'));

  // Supplier A re-bids same amount (1000) — must be rejected (not strictly lower)
  const aAgain = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '2')
    .send({ carrierName: 'A', freightCharges: 800, originCharges: 100, destinationCharges: 100, transitTimeDays: 3, quoteValidityDays: 30 });
  assert.equal(aAgain.status, 409);
  assert.equal(aAgain.body.error.code, 'NOT_STRICTLY_LOWER');

  // Supplier C bids 950 — between A and B, no L1 change (B still L1) → no extension under L1_RANK_CHANGE
  const c = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '4')
    .send({ carrierName: 'C', freightCharges: 750, originCharges: 100, destinationCharges: 100, transitTimeDays: 5, quoteValidityDays: 30 });
  assert.equal(c.status, 201);
  // Final order: B (900) < C (950) < A (1000)
  assert.deepEqual(c.body.bids.map(b => b.supplier.name), ['Supplier B', 'Supplier C', 'Supplier A']);

  // Supplier-only enforcement: buyer attempting to bid is rejected
  const buyerBid = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '1')
    .send({ carrierName: 'X', freightCharges: 1, originCharges: 0, destinationCharges: 0, transitTimeDays: 1, quoteValidityDays: 1 });
  assert.equal(buyerBid.status, 403);
});
