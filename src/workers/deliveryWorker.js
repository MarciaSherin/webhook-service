import db from '../db/index.js';
import { sign } from '../db/signing.js';
import { backoffMs, isRetryable, MAX_ATTEMPTS } from './retryPolicy.js';
import { newId } from '../db/ids.js';

const POLL_INTERVAL_MS = 2000;
const DELIVERY_TIMEOUT_MS = 30_000;
const BATCH_SIZE = 10;

async function deliverOne(attempt) {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(attempt.subscription_id);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(attempt.event_id);

  if (!sub || !event) {
    db.prepare(`
      UPDATE delivery_attempts
      SET status = 'failed', error_message = 'subscription or event not found',
          delivered_at = datetime('now')
      WHERE id = ?
    `).run(attempt.id);
    return;
  }

  const payload = {
    delivery_id: attempt.id,
    event_id: event.id,
    event_type: event.event_type,
    attempt: attempt.attempt_number,
    timestamp: event.created_at,
    data: JSON.parse(event.payload),
  };

  const bodyStr = JSON.stringify(payload);

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'WebhookService/1.0',
    'X-Webhook-Delivery': attempt.id,
    'X-Webhook-Event': event.event_type,
    'X-Webhook-Attempt': String(attempt.attempt_number),
  };

  if (sub.secret) {
    headers['X-Webhook-Signature'] = sign(bodyStr, sub.secret);
  }

  let httpStatus = null;
  let responseBody = null;
  let errorMessage = null;
  let success = false;
  let networkError = false;

  try {
    const { default: fetch } = await import('node-fetch');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    try {
      const response = await fetch(sub.target_url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: controller.signal,
      });

      httpStatus = response.status;
      const text = await response.text();
      responseBody = text.slice(0, 1024);
      success = httpStatus >= 200 && httpStatus < 300;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    networkError = true;
    errorMessage = err.name === 'AbortError' ? 'Request timed out' : err.message;
  }

  const shouldRetry = !success && isRetryable(httpStatus, networkError);
  const nextAttemptNumber = attempt.attempt_number + 1;
  const canRetry = shouldRetry && nextAttemptNumber <= MAX_ATTEMPTS;

  if (success) {
    db.prepare(`
      UPDATE delivery_attempts
      SET status = 'success', http_status = ?, response_body = ?,
          delivered_at = datetime('now'), next_attempt_at = NULL
      WHERE id = ?
    `).run(httpStatus, responseBody, attempt.id);
  } else if (canRetry) {
    const delayMs = backoffMs(attempt.attempt_number);
    const nextAt = new Date(Date.now() + delayMs).toISOString();

    db.prepare(`
      UPDATE delivery_attempts
      SET status = 'retrying', http_status = ?, response_body = ?,
          error_message = ?, next_attempt_at = ?
      WHERE id = ?
    `).run(httpStatus, responseBody, errorMessage, nextAt, attempt.id);

    db.prepare(`
      INSERT INTO delivery_attempts
        (id, event_id, subscription_id, attempt_number, status, scheduled_at, next_attempt_at)
      VALUES (?, ?, ?, ?, 'pending', datetime('now'), ?)
    `).run(
      newId('da'),
      attempt.event_id,
      attempt.subscription_id,
      nextAttemptNumber,
      nextAt
    );
  } else {
    db.prepare(`
      UPDATE delivery_attempts
      SET status = 'failed', http_status = ?, response_body = ?,
          error_message = ?, next_attempt_at = NULL, delivered_at = datetime('now')
      WHERE id = ?
    `).run(
      httpStatus,
      responseBody,
      errorMessage || `Terminal failure after ${attempt.attempt_number} attempt(s)`,
      attempt.id
    );
  }
}

async function tick() {
  const now = new Date().toISOString();
  const due = db.prepare(`
    SELECT * FROM delivery_attempts
    WHERE status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY next_attempt_at ASC
    LIMIT ?
  `).all(now, BATCH_SIZE);

  for (const attempt of due) {
    // Atomically claim to prevent double-processing
    const result = db.prepare(`
      UPDATE delivery_attempts
      SET status = 'in-flight'
      WHERE id = ? AND status = 'pending'
    `).run(attempt.id);

    if (result.changes === 0) continue;

    try {
      await deliverOne(attempt);
    } catch (err) {
      console.error(`[delivery] Unexpected error on attempt ${attempt.id}:`, err);
      db.prepare(`
        UPDATE delivery_attempts SET status = 'pending' WHERE id = ?
      `).run(attempt.id);
    }
  }
}

export function manualRetry(attemptId) {
  const attempt = db.prepare('SELECT * FROM delivery_attempts WHERE id = ?').get(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  if (attempt.status !== 'failed') throw new Error('Only failed deliveries can be retried');

  const newAttemptId = newId('da');
  db.prepare(`
    INSERT INTO delivery_attempts
      (id, event_id, subscription_id, attempt_number, status, scheduled_at)
    VALUES (?, ?, ?, ?, 'pending', datetime('now'))
  `).run(
    newAttemptId,
    attempt.event_id,
    attempt.subscription_id,
    attempt.attempt_number + 1
  );

  return newAttemptId;
}

export function startDeliveryWorker() {
  console.log(`[delivery-worker] Starting, polling every ${POLL_INTERVAL_MS}ms`);
  tick().catch(console.error);
  return setInterval(() => tick().catch(console.error), POLL_INTERVAL_MS);
}
