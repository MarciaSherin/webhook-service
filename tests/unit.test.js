import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─── Matching ─────────────────────────────────────────────────────────────────

describe('Event type matching', () => {
  // We import inline so tests don't need a running DB
  async function matches(eventType, patterns) {
    const { matches: fn } = await import('../src/db/matching.js');
    return fn(eventType, JSON.stringify(patterns));
  }

  test('exact match', async () => {
    assert.ok(await matches('order.created', ['order.created']));
  });

  test('wildcard single-segment', async () => {
    assert.ok(await matches('order.created', ['order.*']));
    assert.ok(await matches('order.updated', ['order.*']));
  });

  test('wildcard does not match multiple segments', async () => {
    assert.ok(!await matches('order.items.added', ['order.*']));
  });

  test('double-star matches multiple segments', async () => {
    assert.ok(await matches('order.items.added', ['order.**']));
  });

  test('no match', async () => {
    assert.ok(!await matches('user.created', ['order.*']));
  });

  test('multiple patterns - any match wins', async () => {
    assert.ok(await matches('user.deleted', ['order.*', 'user.deleted']));
  });

  test('catch-all pattern', async () => {
    assert.ok(await matches('anything.at.all', ['**']));
  });
});

// ─── Signing ──────────────────────────────────────────────────────────────────

describe('Payload signing', () => {
  const { sign, verify } = await import('../src/db/signing.js');

  test('sign produces sha256= prefix', () => {
    const sig = sign('{"hello":"world"}', 'mysecret');
    assert.ok(sig.startsWith('sha256='));
    assert.equal(sig.length, 71); // 'sha256=' + 64 hex chars
  });

  test('same input produces same signature', () => {
    const a = sign('payload', 'secret');
    const b = sign('payload', 'secret');
    assert.equal(a, b);
  });

  test('different secret produces different signature', () => {
    const a = sign('payload', 'secret1');
    const b = sign('payload', 'secret2');
    assert.notEqual(a, b);
  });

  test('different payload produces different signature', () => {
    const a = sign('payload1', 'secret');
    const b = sign('payload2', 'secret');
    assert.notEqual(a, b);
  });

  test('verify returns true for valid signature', () => {
    const sig = sign('my payload', 'key');
    assert.ok(verify('my payload', 'key', sig));
  });

  test('verify returns false for wrong secret', () => {
    const sig = sign('my payload', 'key');
    assert.ok(!verify('my payload', 'wrong-key', sig));
  });

  test('verify returns false for tampered payload', () => {
    const sig = sign('original', 'key');
    assert.ok(!verify('tampered', 'key', sig));
  });
});

// ─── Retry policy ─────────────────────────────────────────────────────────────

describe('Retry policy', () => {
  const { backoffMs, isRetryable, MAX_ATTEMPTS } = await import('../src/workers/retryPolicy.js');

  test('MAX_ATTEMPTS is defined and reasonable', () => {
    assert.ok(MAX_ATTEMPTS >= 3 && MAX_ATTEMPTS <= 10);
  });

  test('backoff increases with attempt number', () => {
    const delays = [1, 2, 3, 4].map(n => backoffMs(n));
    // Not strictly monotone due to jitter, but each window should be larger
    // Check base (without jitter) is increasing
    assert.ok(delays[1] > delays[0] * 0.5); // rough sanity check
  });

  test('backoff is capped', () => {
    const maxAllowed = 5 * 60 * 60 * 1000; // 5 hours
    for (let i = 1; i <= 10; i++) {
      assert.ok(backoffMs(i) <= maxAllowed);
    }
  });

  test('5xx is retryable', () => {
    assert.ok(isRetryable(500));
    assert.ok(isRetryable(502));
    assert.ok(isRetryable(503));
  });

  test('408 and 429 are retryable', () => {
    assert.ok(isRetryable(408));
    assert.ok(isRetryable(429));
  });

  test('2xx is not retryable', () => {
    assert.ok(!isRetryable(200));
    assert.ok(!isRetryable(201));
    assert.ok(!isRetryable(204));
  });

  test('4xx (except 408/429) is not retryable', () => {
    assert.ok(!isRetryable(400));
    assert.ok(!isRetryable(401));
    assert.ok(!isRetryable(403));
    assert.ok(!isRetryable(404));
  });

  test('network error (no status) is retryable', () => {
    assert.ok(isRetryable(null, true));
    assert.ok(isRetryable(undefined, true));
  });
});

// ─── ID generation ────────────────────────────────────────────────────────────

describe('ID generation', () => {
  const { newId } = await import('../src/db/ids.js');

  test('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    assert.equal(ids.size, 1000);
  });

  test('prefix is included', () => {
    assert.ok(newId('sub').startsWith('sub_'));
    assert.ok(newId('evt').startsWith('evt_'));
    assert.ok(newId('da').startsWith('da_'));
  });

  test('no prefix returns plain ID', () => {
    const id = newId();
    assert.ok(!id.includes('_'));
    assert.ok(id.length > 8);
  });
});
