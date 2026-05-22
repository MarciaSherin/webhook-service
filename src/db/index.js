import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/webhooks.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// WAL mode for better read concurrency
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id          TEXT PRIMARY KEY,
    target_url  TEXT NOT NULL,
    secret      TEXT,
    event_types TEXT NOT NULL,
    description TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS delivery_attempts (
    id              TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    attempt_number  INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'pending',
    http_status     INTEGER,
    response_body   TEXT,
    error_message   TEXT,
    next_attempt_at TEXT,
    scheduled_at    TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_delivery_status
    ON delivery_attempts(status, next_attempt_at);

  CREATE INDEX IF NOT EXISTS idx_delivery_event
    ON delivery_attempts(event_id);

  CREATE INDEX IF NOT EXISTS idx_delivery_sub
    ON delivery_attempts(subscription_id);

  CREATE INDEX IF NOT EXISTS idx_events_created
    ON events(created_at DESC);
`);

/**
 * Wrapper to run a function inside a BEGIN/COMMIT transaction.
 * Rolls back on error, matching better-sqlite3's .transaction() API.
 */
export function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

export default db;
