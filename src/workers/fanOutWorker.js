import db, { transaction } from '../db/index.js';
import { matches } from '../db/matching.js';
import { newId } from '../db/ids.js';

const POLL_INTERVAL_MS = 1000;

const insertAttempt = () => db.prepare(`
  INSERT INTO delivery_attempts
    (id, event_id, subscription_id, attempt_number, status, scheduled_at)
  VALUES (?, ?, ?, 1, 'pending', datetime('now'))
`);

function fanOutEvent(event) {
  const subscriptions = db.prepare(
    "SELECT * FROM subscriptions WHERE active = 1"
  ).all();

  const matching = subscriptions.filter(sub =>
    matches(event.event_type, sub.event_types)
  );

  if (matching.length === 0) return 0;

  const doFanOut = transaction((event, subs) => {
    const stmt = db.prepare(`
      INSERT INTO delivery_attempts
        (id, event_id, subscription_id, attempt_number, status, scheduled_at)
      VALUES (?, ?, ?, 1, 'pending', datetime('now'))
    `);
    for (const sub of subs) {
      stmt.run(newId('da'), event.id, sub.id);
    }
  });

  doFanOut(event, matching);
  return matching.length;
}

function tick() {
  const unfannedEvents = db.prepare(`
    SELECT e.* FROM events e
    WHERE NOT EXISTS (
      SELECT 1 FROM delivery_attempts da WHERE da.event_id = e.id
    )
    ORDER BY e.created_at ASC
    LIMIT 100
  `).all();

  for (const event of unfannedEvents) {
    const count = fanOutEvent(event);
    if (count > 0) {
      console.log(`[fan-out] Event ${event.id} (${event.event_type}) → ${count} subscription(s)`);
    } else {
      // Sentinel: no subscriptions matched — mark as processed so we don't re-scan
      db.prepare(`
        INSERT OR IGNORE INTO delivery_attempts
          (id, event_id, subscription_id, attempt_number, status, scheduled_at)
        VALUES (?, ?, '__none__', 0, 'skipped', datetime('now'))
      `).run(newId('da'), event.id);
    }
  }
}

export function startFanOutWorker() {
  console.log(`[fan-out-worker] Starting, polling every ${POLL_INTERVAL_MS}ms`);
  tick();
  return setInterval(tick, POLL_INTERVAL_MS);
}
