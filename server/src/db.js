import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PATH = path.resolve(__dirname, '..', 'data.sqlite');

export function openDatabase(filePath = DEFAULT_PATH) {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL,
      role  TEXT NOT NULL CHECK (role IN ('buyer', 'supplier'))
    );

    CREATE TABLE IF NOT EXISTS rfqs (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id             TEXT NOT NULL UNIQUE,
      name                     TEXT NOT NULL,
      pickup_date              TEXT NOT NULL,
      bid_start_at             TEXT NOT NULL,
      bid_close_initial_at     TEXT NOT NULL,
      bid_close_current_at     TEXT NOT NULL,
      forced_bid_close_at      TEXT NOT NULL,
      trigger_type             TEXT NOT NULL CHECK (trigger_type IN
                                  ('BID_RECEIVED','ANY_RANK_CHANGE','L1_RANK_CHANGE')),
      trigger_window_minutes   INTEGER NOT NULL CHECK (trigger_window_minutes > 0),
      extension_minutes        INTEGER NOT NULL CHECK (extension_minutes > 0),
      created_by               INTEGER NOT NULL REFERENCES users(id),
      created_at               TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bids (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id               INTEGER NOT NULL REFERENCES rfqs(id),
      supplier_id          INTEGER NOT NULL REFERENCES users(id),
      carrier_name         TEXT NOT NULL,
      freight_charges      REAL NOT NULL CHECK (freight_charges >= 0),
      origin_charges       REAL NOT NULL CHECK (origin_charges >= 0),
      destination_charges  REAL NOT NULL CHECK (destination_charges >= 0),
      total_price          REAL NOT NULL,
      transit_time_days    INTEGER NOT NULL CHECK (transit_time_days >= 0),
      quote_validity_days  INTEGER NOT NULL CHECK (quote_validity_days > 0),
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bids_rfq_supplier_created ON bids(rfq_id, supplier_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS activity_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id      INTEGER NOT NULL REFERENCES rfqs(id),
      event_type  TEXT NOT NULL,
      message     TEXT NOT NULL,
      metadata    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_log_rfq_created ON activity_log(rfq_id, created_at DESC);
  `);
}
