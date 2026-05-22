/**
 * Integration tests — spin up the full Express app in-process,
 * using a temp SQLite DB, and hit the real routes.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync } from 'fs';

// Use a temp DB for tests
const tmpDir = mkdtempSync(join(tmpdir(), 'webhook-test-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.ADMIN_KEY = 'test-key';
process.env.PORT = '0'; // random port

let baseUrl;
let server;

// Helper: make an HTTP request
function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: new URL(baseUrl).port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': 'test-key',
        ...headers,
      },
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

before(async () => {
  // Import server after env vars are set
  const { default: app } = await import('../src/server.js').catch(() => {
    // server.js calls app.listen — we need to intercept
    throw new Error('server.js must export the app or we test routes directly');
  });
});

// Since server.js calls listen directly, we test the routes by importing them separately
// with a fresh express app. This is cleaner for integration testing.
before(async () => {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const [subs, evts, dels] = await Promise.all([
    import('../src/routes/subscriptions.js'),
    import('../src/routes/events.js'),
    import('../src/routes/deliveries.js'),
  ]);

  app.use('/subscriptions', subs.default);
  app.use('/events', evts.default);
  app.use('/deliveries', dels.default);
  app.get('/health', (req, res) => res.json({ ok: true }));

  await new Promise(resolve => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('Authentication', () => {
  test('rejects missing admin key', async () => {
    const r = await req('GET', '/subscriptions', null, { 'X-Admin-Key': '' });
    assert.equal(r.status, 401);
  });

  test('rejects wrong admin key', async () => {
    const r = await req('GET', '/subscriptions', null, { 'X-Admin-Key': 'wrong' });
    assert.equal(r.status, 401);
  });

  test('accepts correct admin key', async () => {
    const r = await req('GET', '/subscriptions');
    assert.equal(r.status, 200);
  });
});

// ─── Subscriptions ─────────────────────────────────────────────────────────────

describe('Subscriptions API', () => {
  let createdId;

  test('empty list on start', async () => {
    const r = await req('GET', '/subscriptions');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  test('creates a subscription', async () => {
    const r = await req('POST', '/subscriptions', {
      target_url: 'https://example.com/hook',
      event_types: ['order.*'],
      secret: 'mysecret',
      description: 'Test sub',
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.id.startsWith('sub_'));
    assert.equal(r.body.target_url, 'https://example.com/hook');
    assert.deepEqual(r.body.event_types, ['order.*']);
    assert.equal(r.body.secret, '[redacted]'); // never expose secret
    assert.equal(r.body.active, true);
    createdId = r.body.id;
  });

  test('rejects subscription without target_url', async () => {
    const r = await req('POST', '/subscriptions', { event_types: ['*'] });
    assert.equal(r.status, 400);
  });

  test('rejects invalid URL', async () => {
    const r = await req('POST', '/subscriptions', {
      target_url: 'not-a-url',
      event_types: ['*'],
    });
    assert.equal(r.status, 400);
  });

  test('rejects empty event_types', async () => {
    const r = await req('POST', '/subscriptions', {
      target_url: 'https://example.com/hook',
      event_types: [],
    });
    assert.equal(r.status, 400);
  });

  test('gets subscription by id', async () => {
    const r = await req('GET', `/subscriptions/${createdId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, createdId);
  });

  test('returns 404 for unknown id', async () => {
    const r = await req('GET', '/subscriptions/sub_doesnotexist');
    assert.equal(r.status, 404);
  });

  test('patches subscription', async () => {
    const r = await req('PATCH', `/subscriptions/${createdId}`, {
      description: 'Updated description',
      active: false,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.description, 'Updated description');
    assert.equal(r.body.active, false);
  });

  test('deletes (deactivates) subscription', async () => {
    const r = await req('DELETE', `/subscriptions/${createdId}`);
    assert.equal(r.status, 200);
  });
});

// ─── Events ───────────────────────────────────────────────────────────────────

describe('Events API', () => {
  test('ingest an event', async () => {
    const r = await req('POST', '/events', {
      event_type: 'user.created',
      data: { id: 42, email: 'test@example.com' },
    });
    assert.equal(r.status, 202);
    assert.ok(r.body.id.startsWith('evt_'));
    assert.equal(r.body.event_type, 'user.created');
  });

  test('rejects event without event_type', async () => {
    const r = await req('POST', '/events', { data: { x: 1 } });
    assert.equal(r.status, 400);
  });

  test('rejects event with non-object data', async () => {
    const r = await req('POST', '/events', { event_type: 'x', data: 'string' });
    assert.equal(r.status, 400);
  });

  test('lists events', async () => {
    const r = await req('GET', '/events');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 1);
  });

  test('gets event by id with attempts', async () => {
    const created = await req('POST', '/events', {
      event_type: 'order.placed',
      data: { order_id: 'ord_123' },
    });
    const r = await req('GET', `/events/${created.body.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.event_type, 'order.placed');
    assert.ok(Array.isArray(r.body.delivery_attempts));
  });
});

// ─── Fan-out integration ───────────────────────────────────────────────────────

describe('Fan-out (with matching subscription)', () => {
  test('event matches subscription and creates delivery attempt', async () => {
    // Create a subscription for order.* events
    const sub = await req('POST', '/subscriptions', {
      target_url: 'https://httpbin.org/post',
      event_types: ['order.*'],
    });
    assert.equal(sub.status, 201);

    // Ingest a matching event
    const evt = await req('POST', '/events', {
      event_type: 'order.created',
      data: { id: 'ord_abc' },
    });
    assert.equal(evt.status, 202);

    // Give fan-out worker time to run (it's on a 1s interval)
    await new Promise(r => setTimeout(r, 1500));

    // Check that a delivery attempt was created
    const r = await req('GET', `/events/${evt.body.id}`);
    assert.ok(r.body.delivery_attempts.length >= 1);
    assert.equal(r.body.delivery_attempts[0].subscription_id, sub.body.id);
  });

  test('event does not match subscription of different type', async () => {
    const sub = await req('POST', '/subscriptions', {
      target_url: 'https://httpbin.org/post',
      event_types: ['user.*'],
    });

    const evt = await req('POST', '/events', {
      event_type: 'payment.completed',
      data: { amount: 100 },
    });

    await new Promise(r => setTimeout(r, 1500));

    const r = await req('GET', `/events/${evt.body.id}`);
    // delivery_attempts should be empty (no matching subs)
    const relevantAttempts = r.body.delivery_attempts.filter(
      a => a.subscription_id === sub.body.id
    );
    assert.equal(relevantAttempts.length, 0);
  });
});
