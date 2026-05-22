import express from 'express';
import db from '../db/index.js';
import { newId } from '../db/ids.js';
import { requireAdminKey } from '../middleware/auth.js';

const router = express.Router();

// All subscription management requires admin key
router.use(requireAdminKey);

// List all subscriptions
router.get('/', (req, res) => {
  const subs = db.prepare('SELECT * FROM subscriptions ORDER BY created_at DESC').all();
  res.json(subs.map(s => ({
    ...s,
    event_types: JSON.parse(s.event_types),
    active: Boolean(s.active),
    secret: s.secret ? '[redacted]' : null,
  })));
});

// Get a single subscription
router.get('/:id', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });

  res.json({
    ...sub,
    event_types: JSON.parse(sub.event_types),
    active: Boolean(sub.active),
    secret: sub.secret ? '[redacted]' : null,
  });
});

// Create a subscription
router.post('/', (req, res) => {
  const { target_url, secret, event_types, description } = req.body;

  if (!target_url) return res.status(400).json({ error: 'target_url is required' });
  if (!event_types || !Array.isArray(event_types) || event_types.length === 0) {
    return res.status(400).json({ error: 'event_types must be a non-empty array of patterns' });
  }

  // Validate URL
  try { new URL(target_url); } catch {
    return res.status(400).json({ error: 'target_url must be a valid URL' });
  }

  const id = newId('sub');
  db.prepare(`
    INSERT INTO subscriptions (id, target_url, secret, event_types, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, target_url, secret || null, JSON.stringify(event_types), description || null);

  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  res.status(201).json({
    ...sub,
    event_types: JSON.parse(sub.event_types),
    active: Boolean(sub.active),
  });
});

// Update a subscription (partial)
router.patch('/:id', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });

  const { target_url, secret, event_types, description, active } = req.body;

  const updated = {
    target_url: target_url ?? sub.target_url,
    secret: secret !== undefined ? (secret || null) : sub.secret,
    event_types: event_types ? JSON.stringify(event_types) : sub.event_types,
    description: description !== undefined ? description : sub.description,
    active: active !== undefined ? (active ? 1 : 0) : sub.active,
  };

  db.prepare(`
    UPDATE subscriptions
    SET target_url = ?, secret = ?, event_types = ?, description = ?, active = ?
    WHERE id = ?
  `).run(updated.target_url, updated.secret, updated.event_types,
         updated.description, updated.active, sub.id);

  const result = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(sub.id);
  res.json({
    ...result,
    event_types: JSON.parse(result.event_types),
    active: Boolean(result.active),
    secret: result.secret ? '[redacted]' : null,
  });
});

// Delete (deactivate) a subscription
router.delete('/:id', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });

  db.prepare("UPDATE subscriptions SET active = 0 WHERE id = ?").run(sub.id);
  res.json({ message: 'Subscription deactivated', id: sub.id });
});

export default router;
