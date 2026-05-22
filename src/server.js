import express from 'express';
import { startFanOutWorker } from './workers/fanOutWorker.js';
import { startDeliveryWorker } from './workers/deliveryWorker.js';
import subscriptionsRouter from './routes/subscriptions.js';
import eventsRouter from './routes/events.js';
import deliveriesRouter from './routes/deliveries.js';
import dashboardRouter from './routes/dashboard.js';

const PORT = process.env.PORT || 3000;
const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false })); // for dashboard form POSTs

// Simple request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (!req.path.startsWith('/dashboard')) {
      console.log(`${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
    }
  });
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/dashboard'));

app.use('/subscriptions', subscriptionsRouter);
app.use('/events', eventsRouter);
app.use('/deliveries', deliveriesRouter);
app.use('/dashboard', dashboardRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\n🪝 Webhook Delivery Service`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`   Admin key: ${process.env.ADMIN_KEY || 'admin-secret'}\n`);
});

// Start background workers
const fanOutTimer = startFanOutWorker();
const deliveryTimer = startDeliveryWorker();

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down gracefully...`);
  clearInterval(fanOutTimer);
  clearInterval(deliveryTimer);
  server.close(() => {
    console.log('[server] HTTP server closed.');
    process.exit(0);
  });
  // Force exit after 5s if connections don't close
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
