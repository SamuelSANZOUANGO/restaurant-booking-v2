/**
 * database.js
 * -----------
 * Better-SQLite3 database initialisation.
 * Creates the schema on first run and seeds a few restaurant tables.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Ensure data directory exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS restaurant_tables (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number INTEGER NOT NULL UNIQUE,
    capacity    INTEGER NOT NULL,
    location    TEXT    NOT NULL DEFAULT 'main'  -- 'main', 'terrace', 'private'
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id            TEXT    PRIMARY KEY,          -- UUID
    table_id      INTEGER NOT NULL REFERENCES restaurant_tables(id),
    customer_name TEXT    NOT NULL,
    customer_email TEXT   NOT NULL,
    customer_phone TEXT,
    party_size    INTEGER NOT NULL,
    booking_date  TEXT    NOT NULL,             -- ISO date YYYY-MM-DD
    booking_time  TEXT    NOT NULL,             -- HH:MM
    duration_min  INTEGER NOT NULL DEFAULT 90,
    status        TEXT    NOT NULL DEFAULT 'confirmed'
                          CHECK(status IN ('confirmed','cancelled','completed','no_show')),
    notes         TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_date   ON bookings(booking_date);
  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
  CREATE INDEX IF NOT EXISTS idx_bookings_table  ON bookings(table_id);
`);

// ── Seed restaurant tables ─────────────────────────────────────────────────
const tableCount = db.prepare('SELECT COUNT(*) as c FROM restaurant_tables').get();
if (tableCount.c === 0) {
  const insert = db.prepare(
    'INSERT INTO restaurant_tables (table_number, capacity, location) VALUES (?, ?, ?)'
  );
  const seedTables = db.transaction(() => {
    // Main hall
    for (let i = 1; i <= 8; i++) insert.run(i, i % 2 === 0 ? 4 : 2, 'main');
    // Terrace
    for (let i = 9; i <= 14; i++) insert.run(i, 4, 'terrace');
    // Private dining
    insert.run(15, 10, 'private');
    insert.run(16, 12, 'private');
  });
  seedTables();
  console.log('✅ Database seeded with 16 restaurant tables');
}

module.exports = db;
