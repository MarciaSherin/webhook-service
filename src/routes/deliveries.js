import express from 'express';
import db from '../db/index.js';
import { manualRetry } from '../workers/deliveryWorker.js';
import { requireAdminKey } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAdminKey);

// List delivery attempts, optionally filtered by event or subscription
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const { event_id, subscription_id, status } = req.query;

  let sql = `
    SELECT da.*, s.target_url, e.event_type
    FROM delivery_attempts da
    LEFT JOIN subscriptions s ON da.subscription_id = s.id
    LEFT JOIN events e ON da.event_id = e.id
    WHERE da.subscription_id != '__none__'
  `;
  const params = [];

  if (event_id) { sql += ' AND da.event_id = ?'; params.push(event_id); }
  if (subscription_id) { sql += ' AND da.subscription_id = ?'; params.push(subscription_id); }
  if (status) { sql += ' AND da.status = ?'; params.push(status); }

  sql += ' ORDER BY da.created_at DESC LIMIT ?';
  params.push(limit);

  const attempts = db.prepare(sql).all(...params);
  res.json(attempts);
});

// Manual retry of a failed delivery
router.post('/:id/retry', (req, res) => {
  try {
    const newAttemptId = manualRetry(req.params.id);
    res.json({ message: 'Retry queued', new_attempt_id: newAttemptId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
