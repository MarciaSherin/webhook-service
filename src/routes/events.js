import express from 'express';
import db from '../db/index.js';
import { newId } from '../db/ids.js';
import { requireAdminKey } from '../middleware/auth.js';

const router = express.Router();

// Ingest an event (protected)
router.post('/', requireAdminKey, (req, res) => {
  const { event_type, data } = req.body;

  if (!event_type) return res.status(400).json({ error: 'event_type is required' });
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'data must be an object' });
  }

  const id = newId('evt');
  db.prepare(`
    INSERT INTO events (id, event_type, payload)
    VALUES (?, ?, ?)
  `).run(id, event_type, JSON.stringify(data));

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  res.status(202).json({
    ...event,
    data: JSON.parse(event.payload),
    message: 'Event accepted, fan-out in progress',
  });
});

// List recent events
router.get('/', requireAdminKey, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const events = db.prepare(
    'SELECT * FROM events ORDER BY created_at DESC LIMIT ?'
  ).all(limit);

  res.json(events.map(e => ({ ...e, data: JSON.parse(e.payload) })));
});

// Get a single event with its delivery attempts
router.get('/:id', requireAdminKey, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Not found' });

  const attempts = db.prepare(`
    SELECT da.*, s.target_url, s.description as sub_description
    FROM delivery_attempts da
    LEFT JOIN subscriptions s ON da.subscription_id = s.id
    WHERE da.event_id = ?
      AND da.subscription_id != '__none__'
    ORDER BY da.subscription_id, da.attempt_number ASC
  `).all(event.id);

  res.json({
    ...event,
    data: JSON.parse(event.payload),
    delivery_attempts: attempts,
  });
});

export default router;
