'use strict';

require('dotenv').config();

const BridgeClient    = require('./src/wsClient');
const { buildDashboard } = require('./src/dashboard');

// ── Job log (kept in memory, last 200 entries) ────────────────────────────────
const jobLog = [];

// ── Wire up bridge client ─────────────────────────────────────────────────────
const bridge = new BridgeClient();

bridge.on('log', (msg) => {
  console.log(`[Bridge] ${new Date().toISOString().slice(11, 19)}  ${msg}`);
});

bridge.on('error', (err) => {
  // Suppress uncaught-exception; errors are already logged via 'log' event
  console.error(`[Bridge] ERROR: ${err.message}`);
});

bridge.on('jobComplete', (ev) => {
  jobLog.push({ ...ev, ts: new Date().toISOString() });
  if (jobLog.length > 200) jobLog.shift();
});

// ── Start dashboard & bridge ──────────────────────────────────────────────────
buildDashboard(bridge, jobLog);
bridge.start();

// ── Graceful shutdown (PM2 SIGINT / Ctrl-C) ───────────────────────────────────
function shutdown() {
  console.log('[Bridge] Shutting down…');
  bridge.stop();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
