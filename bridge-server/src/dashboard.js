'use strict';

const express = require('express');
const path    = require('path');

const DASH_PORT = parseInt(process.env.DASHBOARD_PORT || '4000');

function buildDashboard(bridgeClient, jobLog) {
  const app = express();
  app.use(express.json());

  // ── SSE endpoint for real-time status push ───────────────────────────────
  const sseClients = new Set();

  function broadcast(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch { sseClients.delete(res); }
    }
  }

  bridgeClient.on('statusChange', (status) => broadcast({ type: 'status', status }));
  bridgeClient.on('log',         (msg)    => broadcast({ type: 'log',    msg, ts: new Date().toISOString() }));
  bridgeClient.on('jobStart',    (job)    => broadcast({ type: 'jobStart', submissionId: job.submissionId }));
  bridgeClient.on('jobComplete', (ev)     => broadcast({ type: 'jobComplete', ...ev }));

  app.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    // Send current status immediately on connect
    res.write(`data: ${JSON.stringify({ type: 'status', status: bridgeClient.status, stats: bridgeClient.stats })}\n\n`);
  });

  // ── JSON API ─────────────────────────────────────────────────────────────
  app.get('/api/status', (req, res) => {
    res.json({
      status:  bridgeClient.status,
      stats:   bridgeClient.stats,
      config: {
        railwayUrl:    (process.env.RAILWAY_WS_URL || '').replace(/\/\/.*@/, '//***@'),
        watchedFolder: process.env.WATCHED_FOLDER_PATH,
        batchMode:     process.env.BATCH_PROVIDER_MODE || 'folder',
      },
    });
  });

  app.get('/api/jobs', (req, res) => {
    res.json(jobLog.slice(-50).reverse());
  });

  app.post('/api/reconnect', (req, res) => {
    bridgeClient.stop();
    bridgeClient.intentionalClose = false;
    bridgeClient.start();
    res.json({ ok: true });
  });

  // ── Dashboard HTML ────────────────────────────────────────────────────────
  app.get('/', (req, res) => {
    res.send(DASHBOARD_HTML);
  });

  const server = app.listen(DASH_PORT, '127.0.0.1', () => {
    console.log(`[Bridge] Dashboard → http://localhost:${DASH_PORT}`);
  });

  return server;
}

// Inline dashboard HTML — no build step required
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PayrollTax Pro — Bridge</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0d1b2a;color:#f1f5f9;font-size:14px;line-height:1.5}
  header{background:#1a2c42;padding:16px 24px;display:flex;align-items:center;gap:16px;border-bottom:1px solid #2d4263}
  header h1{font-size:18px;font-weight:700;color:#f1f5f9}header h1 span{color:#2563eb}
  header .subtitle{font-size:12px;color:#64748b}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}
  .pill.connected{background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.3)}
  .pill.disconnected,.pill.connecting{background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.2)}
  .pill.connecting{color:#f59e0b;background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.2)}
  .dot{width:7px;height:7px;border-radius:50%;background:currentColor}
  main{padding:24px;max-width:1100px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:24px}
  .stat{background:#1a2c42;border:1px solid #2d4263;border-radius:10px;padding:16px}
  .stat-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
  .stat-value{font-size:26px;font-weight:700;font-family:monospace}
  .panel{background:#1a2c42;border:1px solid #2d4263;border-radius:10px;margin-bottom:20px;overflow:hidden}
  .panel-header{padding:12px 18px;background:#0d1b2a;border-bottom:1px solid #2d4263;font-weight:700;font-size:13px;display:flex;justify-content:space-between;align-items:center}
  .log{padding:12px 18px;font-family:monospace;font-size:12px;max-height:280px;overflow-y:auto;display:flex;flex-direction:column-reverse}
  .log-entry{padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04);color:#94a3b8}
  .log-entry .ts{color:#475569;margin-right:8px}
  table{width:100%;border-collapse:collapse}
  th{padding:9px 14px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;text-align:left;background:#0d1b2a;border-bottom:1px solid #2d4263}
  td{padding:10px 14px;border-bottom:1px solid #1e3a5f;font-size:13px}
  .badge{display:inline-flex;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
  .badge.success{background:rgba(16,185,129,.15);color:#10b981}
  .badge.error{background:rgba(239,68,68,.12);color:#ef4444}
  .badge.pending{background:rgba(245,158,11,.12);color:#f59e0b}
  .mono{font-family:monospace}
  btn{padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600}
  #reconnect-btn{background:#2563eb;color:#fff;padding:6px 16px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600}
  #reconnect-btn:hover{background:#1d4ed8}
  .empty{padding:32px;text-align:center;color:#475569}
</style>
</head>
<body>
<header>
  <div>
    <h1>Payroll<span>Tax</span> Pro — Bridge</h1>
    <div class="subtitle">Local ACH bridge service</div>
  </div>
  <div id="status-pill" class="pill disconnected"><span class="dot"></span><span id="status-text">Connecting…</span></div>
  <button id="reconnect-btn" onclick="reconnect()">Reconnect</button>
</header>
<main>
  <div class="grid">
    <div class="stat"><div class="stat-label">Jobs Received</div><div class="stat-value" id="s-received">—</div></div>
    <div class="stat"><div class="stat-label">Succeeded</div><div class="stat-value" id="s-ok" style="color:#10b981">—</div></div>
    <div class="stat"><div class="stat-label">Failed</div><div class="stat-value" id="s-fail" style="color:#ef4444">—</div></div>
    <div class="stat"><div class="stat-label">Reconnects</div><div class="stat-value" id="s-reconn">—</div></div>
    <div class="stat"><div class="stat-label">Connected Since</div><div class="stat-value" id="s-since" style="font-size:14px;padding-top:6px">—</div></div>
  </div>

  <div class="panel">
    <div class="panel-header">Recent Submissions <span id="job-count" style="color:#64748b;font-weight:400;font-size:12px"></span></div>
    <div id="job-table-wrap">
      <div class="empty">No submissions yet</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">Live Log</div>
    <div class="log" id="log"></div>
  </div>
</main>

<script>
const logEl    = document.getElementById('log');
const pillEl   = document.getElementById('status-pill');
const textEl   = document.getElementById('status-text');
const tableEl  = document.getElementById('job-table-wrap');
const countEl  = document.getElementById('job-count');

function setStatus(s) {
  pillEl.className = 'pill ' + s;
  textEl.textContent = s.charAt(0).toUpperCase() + s.slice(1);
}

function addLog(msg, ts) {
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = '<span class="ts">' + (ts||new Date().toISOString()).slice(11,19) + '</span>' + escHtml(msg);
  logEl.prepend(div);
  while (logEl.children.length > 200) logEl.lastChild.remove();
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderStats(stats) {
  if (!stats) return;
  document.getElementById('s-received').textContent = stats.jobsReceived ?? '—';
  document.getElementById('s-ok').textContent       = stats.jobsSucceeded ?? '—';
  document.getElementById('s-fail').textContent     = stats.jobsFailed ?? '—';
  document.getElementById('s-reconn').textContent   = stats.reconnectCount ?? '—';
  const since = stats.connectedAt ? new Date(stats.connectedAt).toLocaleTimeString() : '—';
  document.getElementById('s-since').textContent    = since;
}

function loadJobs() {
  fetch('/api/jobs').then(r=>r.json()).then(jobs => {
    if (!jobs.length) { tableEl.innerHTML='<div class="empty">No submissions yet</div>'; return; }
    countEl.textContent = jobs.length + ' entries';
    tableEl.innerHTML = '<table><thead><tr>' +
      '<th>Time</th><th>Sub ID</th><th>Amount</th><th>Status</th><th>Confirmation</th><th>ACH File</th>' +
      '</tr></thead><tbody>' +
      jobs.map(j => {
        const status = j.success ? 'success' : j.error ? 'error' : 'pending';
        const label  = j.success ? 'Success' : j.error ? 'Failed' : 'Pending';
        const amt    = j.job?.taxData?.totalDeposit != null ? '$' + Number(j.job.taxData.totalDeposit).toFixed(2) : '—';
        return '<tr>' +
          '<td class="mono">' + (j.ts||'').slice(11,19) + '</td>' +
          '<td class="mono">' + (j.job?.submissionId||'—') + '</td>' +
          '<td class="mono">' + amt + '</td>' +
          '<td><span class="badge ' + status + '">' + label + '</span></td>' +
          '<td class="mono">' + escHtml(j.result?.confirmation || j.error || '—') + '</td>' +
          '<td style="font-size:11px;color:#475569">' + escHtml((j.result?.achFilePath||'').split(/[\\/]/).pop() || '—') + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  }).catch(()=>{});
}

// SSE
const es = new EventSource('/events');
es.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'status')      { setStatus(msg.status); renderStats(msg.stats); }
  if (msg.type === 'log')         { addLog(msg.msg, msg.ts); }
  if (msg.type === 'jobComplete') { loadJobs(); }
};
es.onerror = () => setStatus('disconnected');

function reconnect() {
  fetch('/api/reconnect', {method:'POST'}).catch(()=>{});
  addLog('Reconnect requested…');
}

// Initial load
fetch('/api/status').then(r=>r.json()).then(d => {
  setStatus(d.status);
  renderStats(d.stats);
}).catch(()=>{});
loadJobs();
setInterval(loadJobs, 15000);
</script>
</body>
</html>`;

module.exports = { buildDashboard };
