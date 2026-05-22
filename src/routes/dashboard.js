import express from 'express';
import db from '../db/index.js';
import { requireAdminForUI } from '../middleware/auth.js';
import { POLICY_DESCRIPTION } from '../workers/retryPolicy.js';
import { manualRetry } from '../workers/deliveryWorker.js';

const router = express.Router();
router.use(requireAdminForUI);

function statusBadge(status) {
  const map = {
    success:     ['#d1fae5', '#065f46', '✓'],
    failed:      ['#fee2e2', '#991b1b', '✗'],
    pending:     ['#fef3c7', '#92400e', '…'],
    retrying:    ['#dbeafe', '#1e40af', '↻'],
    'in-flight': ['#ede9fe', '#4c1d95', '⟳'],
    skipped:     ['#f3f4f6', '#374151', '–'],
  };
  const [bg, fg, icon] = map[status] || ['#f3f4f6', '#374151', '?'];
  return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">${icon} ${status}</span>`;
}

function fmt(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
  return d.toLocaleString();
}

function reltime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} – Webhook Service</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; color: #111; background: #f8f8f8; }
    a { color: #3b3bca; text-decoration: none; }
    a:hover { text-decoration: underline; }
    nav { background: #1e1e2e; color: white; padding: 0 24px; display: flex; align-items: center; gap: 24px; height: 52px; }
    nav .brand { font-weight: 700; font-size: 16px; }
    nav a { color: #a5b4fc; font-size: 13px; }
    nav a:hover { color: white; text-decoration: none; }
    .container { max-width: 1100px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 20px; font-weight: 600; }
    h2 { font-size: 16px; margin: 24px 0 12px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.07); }
    th { text-align: left; padding: 10px 14px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
    td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }
    .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.07); margin-bottom: 20px; }
    .meta { font-size: 12px; color: #6b7280; }
    .mono { font-family: ui-monospace, monospace; font-size: 12px; }
    .btn { display: inline-block; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid #d1d5db; background: white; color: #374151; }
    .btn:hover { background: #f9fafb; text-decoration: none; }
    .btn-primary { background: #3b3bca; color: white; border-color: #3b3bca; }
    .btn-primary:hover { background: #2d2da8; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.07); }
    .stat .num { font-size: 28px; font-weight: 700; line-height: 1; margin-bottom: 4px; }
    .stat .lbl { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .5px; }
    .tag { display: inline-block; background: #ede9fe; color: #4c1d95; border-radius: 4px; padding: 1px 6px; font-size: 11px; font-family: ui-monospace, monospace; margin: 1px; }
    pre { background: #1e1e2e; color: #a5b4fc; padding: 14px; border-radius: 6px; overflow-x: auto; font-size: 12px; margin: 0; white-space: pre-wrap; word-break: break-all; }
    .empty { text-align: center; padding: 40px; color: #9ca3af; }
    .pill-url { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: middle; }
    .refresh-note { font-size: 12px; color: #9ca3af; margin-bottom: 16px; }
  </style>
</head>
<body>
  <nav>
    <span class="brand">🪝 Webhook Service</span>
    <a href="/dashboard">Overview</a>
    <a href="/dashboard/subscriptions">Subscriptions</a>
    <a href="/dashboard/events">Events</a>
    <a href="/dashboard/deliveries">Deliveries</a>
  </nav>
  <div class="container">${body}</div>
  <script>
    if (document.querySelector('[data-autorefresh]')) setTimeout(() => location.reload(), 10000);
  </script>
</body>
</html>`;
}

// Overview
router.get('/', (req, res) => {
  const totalSubs    = db.prepare("SELECT COUNT(*) as n FROM subscriptions WHERE active=1").get().n;
  const totalEvents  = db.prepare("SELECT COUNT(*) as n FROM events").get().n;
  const totalSuccess = db.prepare("SELECT COUNT(*) as n FROM delivery_attempts WHERE status='success'").get().n;
  const totalFailed  = db.prepare("SELECT COUNT(*) as n FROM delivery_attempts WHERE status='failed'").get().n;
  const totalPending = db.prepare("SELECT COUNT(*) as n FROM delivery_attempts WHERE status IN ('pending','retrying','in-flight')").get().n;

  const recentEvents = db.prepare(`
    SELECT e.*,
      SUM(CASE WHEN da.status='success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN da.status='failed'  THEN 1 ELSE 0 END) as failed_count
    FROM events e
    LEFT JOIN delivery_attempts da ON da.event_id = e.id
    GROUP BY e.id ORDER BY e.created_at DESC LIMIT 10
  `).all();

  const body = `
    <h1>Overview <span data-autorefresh></span></h1>
    <p class="refresh-note">Auto-refreshes every 10 seconds</p>
    <div class="stats">
      <div class="stat"><div class="num">${totalSubs}</div><div class="lbl">Active subscriptions</div></div>
      <div class="stat"><div class="num">${totalEvents}</div><div class="lbl">Total events</div></div>
      <div class="stat"><div class="num" style="color:#059669">${totalSuccess}</div><div class="lbl">Successful deliveries</div></div>
      <div class="stat"><div class="num" style="color:#dc2626">${totalFailed}</div><div class="lbl">Failed deliveries</div></div>
      <div class="stat"><div class="num" style="color:#d97706">${totalPending}</div><div class="lbl">Pending / retrying</div></div>
    </div>
    <h2>Recent events</h2>
    ${recentEvents.length === 0 ? '<div class="empty">No events yet. POST to /events to ingest one.</div>' : `
    <table>
      <thead><tr><th>Event ID</th><th>Type</th><th>Age</th><th>✓</th><th>✗</th><th></th></tr></thead>
      <tbody>${recentEvents.map(e => `<tr>
        <td class="mono"><a href="/dashboard/events/${e.id}">${e.id}</a></td>
        <td><span class="tag">${e.event_type}</span></td>
        <td title="${fmt(e.created_at)}">${reltime(e.created_at)}</td>
        <td style="color:#059669;font-weight:600">${e.success_count || 0}</td>
        <td style="color:#dc2626;font-weight:600">${e.failed_count || 0}</td>
        <td><a href="/dashboard/events/${e.id}" class="btn">Detail →</a></td>
      </tr>`).join('')}</tbody>
    </table>`}
    <div class="card" style="margin-top:24px">
      <strong>Retry policy:</strong> <span class="meta">${POLICY_DESCRIPTION}</span>
    </div>`;
  res.send(layout('Overview', body));
});

// Subscriptions list
router.get('/subscriptions', (req, res) => {
  const subs = db.prepare('SELECT * FROM subscriptions ORDER BY created_at DESC').all();
  const body = `
    <h1>Subscriptions</h1>
    ${subs.length === 0 ? '<div class="empty">No subscriptions yet. POST to /subscriptions to create one.</div>' : `
    <table>
      <thead><tr><th>ID</th><th>Target URL</th><th>Patterns</th><th>Secret</th><th>Status</th><th>Created</th><th></th></tr></thead>
      <tbody>${subs.map(s => {
        const patterns = JSON.parse(s.event_types);
        return `<tr>
          <td class="mono" style="font-size:11px">${s.id}</td>
          <td><span class="pill-url" title="${s.target_url}">${s.target_url}</span></td>
          <td>${patterns.map(p => `<span class="tag">${p}</span>`).join(' ')}</td>
          <td>${s.secret ? '🔐' : '—'}</td>
          <td>${s.active ? '<span style="color:#059669;font-weight:600">● Active</span>' : '<span style="color:#9ca3af">○ Inactive</span>'}</td>
          <td class="meta">${reltime(s.created_at)}</td>
          <td><a href="/dashboard/subscriptions/${s.id}" class="btn">Detail →</a></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`}`;
  res.send(layout('Subscriptions', body));
});

// Subscription detail
router.get('/subscriptions/:id', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).send(layout('Not found', '<div class="empty">Subscription not found.</div>'));
  const patterns = JSON.parse(sub.event_types);
  const attempts = db.prepare(`
    SELECT da.*, e.event_type FROM delivery_attempts da
    JOIN events e ON e.id = da.event_id
    WHERE da.subscription_id = ?
    ORDER BY da.created_at DESC LIMIT 20
  `).all(sub.id);
  const body = `
    <h1><a href="/dashboard/subscriptions">Subscriptions</a> → ${sub.id}</h1>
    <div class="card">
      <div style="display:grid;grid-template-columns:140px 1fr;gap:10px 16px;align-items:start">
        <span class="meta">Target URL</span><span class="mono">${sub.target_url}</span>
        <span class="meta">Patterns</span><span>${patterns.map(p => `<span class="tag">${p}</span>`).join(' ')}</span>
        <span class="meta">Signing secret</span><span>${sub.secret ? '🔐 configured' : '—'}</span>
        <span class="meta">Status</span><span>${sub.active ? '<span style="color:#059669;font-weight:600">Active</span>' : '<span style="color:#9ca3af">Inactive</span>'}</span>
        <span class="meta">Description</span><span>${sub.description || '—'}</span>
        <span class="meta">Created</span><span>${fmt(sub.created_at)}</span>
      </div>
    </div>
    <h2>Recent delivery attempts</h2>
    ${attempts.length === 0 ? '<div class="empty">No delivery attempts yet.</div>' : `
    <table>
      <thead><tr><th>Attempt ID</th><th>Event</th><th>Type</th><th>#</th><th>Status</th><th>HTTP</th><th>When</th><th></th></tr></thead>
      <tbody>${attempts.map(a => `<tr>
        <td class="mono" style="font-size:11px">${a.id}</td>
        <td class="mono"><a href="/dashboard/events/${a.event_id}">${a.event_id.slice(0,14)}…</a></td>
        <td><span class="tag">${a.event_type}</span></td>
        <td style="text-align:center">${a.attempt_number}</td>
        <td>${statusBadge(a.status)}</td>
        <td class="mono">${a.http_status || '—'}</td>
        <td class="meta">${reltime(a.created_at)}</td>
        <td>${a.status === 'failed' ? `<form method="POST" action="/dashboard/retry/${a.id}"><button class="btn btn-primary" type="submit">Retry</button></form>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table>`}`;
  res.send(layout(`Sub ${sub.id}`, body));
});

// Events list
router.get('/events', (req, res) => {
  const events = db.prepare(`
    SELECT e.*,
      SUM(CASE WHEN da.status='success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN da.status='failed'  THEN 1 ELSE 0 END) as failed_count,
      SUM(CASE WHEN da.status IN ('pending','retrying','in-flight') THEN 1 ELSE 0 END) as pending_count
    FROM events e
    LEFT JOIN delivery_attempts da ON da.event_id = e.id
    GROUP BY e.id ORDER BY e.created_at DESC LIMIT 100
  `).all();
  const body = `
    <h1>Events <span data-autorefresh></span></h1>
    <p class="refresh-note">Last 100 events · auto-refreshes every 10s</p>
    ${events.length === 0 ? '<div class="empty">No events ingested yet.</div>' : `
    <table>
      <thead><tr><th>Event ID</th><th>Type</th><th>Age</th><th>✓</th><th>✗</th><th>…</th><th></th></tr></thead>
      <tbody>${events.map(e => `<tr>
        <td class="mono"><a href="/dashboard/events/${e.id}">${e.id}</a></td>
        <td><span class="tag">${e.event_type}</span></td>
        <td title="${fmt(e.created_at)}">${reltime(e.created_at)}</td>
        <td style="color:#059669;font-weight:600">${e.success_count || 0}</td>
        <td style="color:#dc2626;font-weight:600">${e.failed_count || 0}</td>
        <td style="color:#d97706">${e.pending_count || 0}</td>
        <td><a href="/dashboard/events/${e.id}" class="btn">Detail →</a></td>
      </tr>`).join('')}</tbody>
    </table>`}`;
  res.send(layout('Events', body));
});

// Event detail
router.get('/events/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).send(layout('Not found', '<div class="empty">Event not found.</div>'));
  const attempts = db.prepare(`
    SELECT da.*, s.target_url, s.description as sub_description
    FROM delivery_attempts da
    LEFT JOIN subscriptions s ON da.subscription_id = s.id
    WHERE da.event_id = ? AND da.subscription_id != '__none__'
    ORDER BY da.subscription_id, da.attempt_number ASC
  `).all(event.id);
  const payload = JSON.parse(event.payload);
  const body = `
    <h1><a href="/dashboard/events">Events</a> → ${event.id}</h1>
    <div class="card">
      <div style="display:grid;grid-template-columns:120px 1fr;gap:10px 16px;align-items:start">
        <span class="meta">Event type</span><span class="tag">${event.event_type}</span>
        <span class="meta">Created</span><span>${fmt(event.created_at)}</span>
        <span class="meta">Payload</span><pre>${JSON.stringify(payload, null, 2)}</pre>
      </div>
    </div>
    <h2>Delivery attempts (${attempts.length})</h2>
    ${attempts.length === 0 ? '<div class="empty">No subscriptions matched this event type.</div>' :
      attempts.map(a => `<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:12px">
          <div>
            <div class="mono">${a.target_url || a.subscription_id}</div>
            ${a.sub_description ? `<div class="meta">${a.sub_description}</div>` : ''}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
            ${statusBadge(a.status)}
            ${a.status === 'failed' ? `<form method="POST" action="/dashboard/retry/${a.id}"><button class="btn btn-primary" type="submit">↻ Retry</button></form>` : ''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;font-size:12px">
          <div><span class="meta">Attempt #</span><br>${a.attempt_number}</div>
          <div><span class="meta">HTTP status</span><br>${a.http_status || '—'}</div>
          <div><span class="meta">Scheduled</span><br>${fmt(a.scheduled_at)}</div>
          <div><span class="meta">Delivered at</span><br>${fmt(a.delivered_at)}</div>
          ${a.next_attempt_at ? `<div><span class="meta">Next attempt</span><br>${fmt(a.next_attempt_at)}</div>` : ''}
        </div>
        ${a.error_message ? `<div style="margin-top:10px;color:#dc2626;font-size:12px">⚠ ${a.error_message}</div>` : ''}
        ${a.response_body ? `<div style="margin-top:10px"><span class="meta">Response:</span><pre style="margin-top:4px">${a.response_body.slice(0,500)}</pre></div>` : ''}
        <div style="margin-top:8px;font-size:11px;color:#9ca3af">ID: ${a.id}</div>
      </div>`).join('')}`;
  res.send(layout(`Event ${event.id}`, body));
});

// Deliveries list
router.get('/deliveries', (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT da.*, s.target_url, e.event_type FROM delivery_attempts da
    LEFT JOIN subscriptions s ON da.subscription_id = s.id
    LEFT JOIN events e ON da.event_id = e.id
    WHERE da.subscription_id != '__none__'`;
  const params = [];
  if (status) { sql += ' AND da.status = ?'; params.push(status); }
  sql += ' ORDER BY da.created_at DESC LIMIT 100';
  const attempts = db.prepare(sql).all(...params);
  const filters = ['', 'pending', 'success', 'failed', 'retrying'].map(s =>
    `<a href="/dashboard/deliveries${s ? '?status='+s : ''}" class="btn${(status===s||(!status&&!s))?' btn-primary':''}" style="text-decoration:none">${s||'all'}</a>`
  ).join(' ');
  const body = `
    <h1>Delivery attempts <span data-autorefresh></span></h1>
    <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap">${filters}</div>
    ${attempts.length === 0 ? '<div class="empty">No delivery attempts found.</div>' : `
    <table>
      <thead><tr><th>Attempt ID</th><th>Event</th><th>Type</th><th>Target URL</th><th>#</th><th>Status</th><th>HTTP</th><th>When</th><th></th></tr></thead>
      <tbody>${attempts.map(a => `<tr>
        <td class="mono" style="font-size:11px">${a.id}</td>
        <td class="mono"><a href="/dashboard/events/${a.event_id}">${a.event_id.slice(0,14)}…</a></td>
        <td><span class="tag">${a.event_type||'?'}</span></td>
        <td><span class="pill-url" title="${a.target_url||''}">${a.target_url||a.subscription_id}</span></td>
        <td style="text-align:center">${a.attempt_number}</td>
        <td>${statusBadge(a.status)}</td>
        <td class="mono">${a.http_status||'—'}</td>
        <td class="meta">${reltime(a.created_at)}</td>
        <td>${a.status==='failed' ? `<form method="POST" action="/dashboard/retry/${a.id}"><button class="btn btn-primary" type="submit">Retry</button></form>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table>`}`;
  res.send(layout('Deliveries', body));
});

// Manual retry from dashboard
router.post('/retry/:id', (req, res) => {
  try { manualRetry(req.params.id); } catch { /* ignore */ }
  res.redirect(req.headers.referer || '/dashboard/deliveries');
});

export default router;
