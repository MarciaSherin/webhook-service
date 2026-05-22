# Webhook Delivery Service

A reliable webhook delivery service with fan-out, retries, HMAC signing, and a web dashboard.

## Requirements

- Node.js ≥ 20 (uses native `node:test`, `--watch`, `crypto`)
- npm

## Quick start

```bash
git clone <repo>
cd webhook-delivery-service
npm install
npm start
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard)  
Default admin key: `admin-secret`

### Environment variables

| Variable    | Default         | Description                      |
|-------------|-----------------|----------------------------------|
| `PORT`      | `3000`          | HTTP server port                 |
| `ADMIN_KEY` | `admin-secret`  | Shared key for all API requests  |
| `DB_PATH`   | `data/webhooks.db` | SQLite database file path     |

```bash
ADMIN_KEY=my-secret PORT=8080 npm start
```

## API reference

All API endpoints require authentication via header:
```
X-Admin-Key: admin-secret
```
Or `Authorization: Bearer admin-secret`

### Subscriptions

```bash
# Create a subscription
curl -X POST http://localhost:3000/subscriptions \
  -H "X-Admin-Key: admin-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "target_url": "https://your-server.com/webhook",
    "event_types": ["order.*", "user.created"],
    "secret": "optional-signing-secret",
    "description": "My webhook"
  }'

# List subscriptions
curl http://localhost:3000/subscriptions \
  -H "X-Admin-Key: admin-secret"

# Update (partial)
curl -X PATCH http://localhost:3000/subscriptions/<id> \
  -H "X-Admin-Key: admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"active": false}'

# Delete (deactivates)
curl -X DELETE http://localhost:3000/subscriptions/<id> \
  -H "X-Admin-Key: admin-secret"
```

**Event type patterns** use glob syntax via [micromatch](https://github.com/micromatch/micromatch):
- `order.created` — exact match
- `order.*` — any single-segment suffix (`order.created`, `order.updated`)
- `order.**` — any depth (`order.items.added`)
- `**` — catch all

### Events

```bash
# Ingest an event (triggers fan-out to matching subscriptions)
curl -X POST http://localhost:3000/events \
  -H "X-Admin-Key: admin-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "order.created",
    "data": { "order_id": "ord_123", "amount": 4999 }
  }'

# List recent events
curl http://localhost:3000/events \
  -H "X-Admin-Key: admin-secret"

# Get event + all delivery attempts
curl http://localhost:3000/events/<id> \
  -H "X-Admin-Key: admin-secret"
```

### Deliveries

```bash
# List delivery attempts
curl "http://localhost:3000/deliveries?status=failed" \
  -H "X-Admin-Key: admin-secret"

# Manual retry of a failed attempt
curl -X POST http://localhost:3000/deliveries/<attempt-id>/retry \
  -H "X-Admin-Key: admin-secret"
```

### Health

```bash
curl http://localhost:3000/health
```

## Webhook payload format

Each delivery is a POST to the subscriber's target URL with:

```json
{
  "delivery_id": "da_...",
  "event_id": "evt_...",
  "event_type": "order.created",
  "attempt": 1,
  "timestamp": "2024-01-15T10:30:00",
  "data": { "order_id": "ord_123", "amount": 4999 }
}
```

**Headers:**
```
Content-Type: application/json
X-Webhook-Delivery: da_...
X-Webhook-Event: order.created
X-Webhook-Attempt: 1
X-Webhook-Signature: sha256=<hmac-hex>   (only if secret configured)
```

### Verifying signatures

```javascript
const crypto = require('crypto');

function verify(rawBody, secret, signature) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// In your Express handler:
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-webhook-signature'];
  if (!verify(req.body, 'your-secret', sig)) {
    return res.status(401).send('Bad signature');
  }
  // process req.body...
  res.sendStatus(200);
});
```

## Running tests

```bash
npm test
```

Tests cover: event type matching, HMAC signing/verification, retry policy rules, ID generation, API authentication, full CRUD for subscriptions and events, and fan-out integration.

## Dashboard

Visit [http://localhost:3000/dashboard](http://localhost:3000/dashboard) and enter the admin key.

- **Overview** — live stats + recent events
- **Subscriptions** — list, detail, delivery history per subscription
- **Events** — browse all events, drill into delivery attempts per event
- **Deliveries** — filter by status (pending / success / failed / retrying), manual retry button on failed attempts

Dashboard auto-refreshes every 10 seconds.

## What works

- ✅ Subscription CRUD (create, read, update, deactivate)
- ✅ Event ingest with immediate 202 response
- ✅ Fan-out worker: glob pattern matching, atomic delivery attempt creation
- ✅ Delivery worker: HTTP POST with timeout, HMAC signing, status tracking
- ✅ Retry policy: exponential backoff with jitter, configurable max attempts
- ✅ 4xx terminal / 5xx retryable distinction
- ✅ In-flight state to prevent double-delivery across poll ticks
- ✅ Manual retry from API and dashboard
- ✅ Events and delivery attempts persist across restarts (SQLite WAL)
- ✅ Web dashboard with all four views
- ✅ Unit + integration tests for critical paths

## What's incomplete / known limitations

- **No delivery concurrency**: deliveries run serially within each 2s poll tick. For high throughput, you'd want `Promise.allSettled` with a concurrency limit (e.g. `p-limit`).
- **No deduplication for subscribers**: if the process crashes between a successful HTTP response and the DB write, the delivery is retried. Subscribers should be idempotent; `delivery_id` is included in every payload for deduplication.
- **No event pruning**: old events accumulate indefinitely. A production system would archive or delete events older than N days.
- **Single process**: the fan-out and delivery workers use `setInterval` in the same Node.js event loop. A heavier load would benefit from worker threads or a real job queue (BullMQ, etc.).
- **Dashboard is read-only for subscriptions**: you can't create/edit subscriptions from the UI, only via the API.

## What I'd do with more time

1. **Delivery concurrency** with `p-limit` — parallelize up to N deliveries per tick without overwhelming any single endpoint
2. **Event retention policy** — configurable TTL, background cleanup job
3. **Subscription test endpoint** — send a synthetic ping to verify a URL before saving
4. **Metrics endpoint** — per-subscription success rate, p99 delivery latency
5. **Dashboard subscription editor** — create/edit/delete from the UI
6. **Dead letter queue view** — dedicated UI for events that exhausted all retries
