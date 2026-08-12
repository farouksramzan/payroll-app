require('dotenv').config();
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const path    = require('path');
const fs      = require('fs');
const { getDb } = require('./src/database/db');
const bridgeManager    = require('./src/ws/bridge');
const bridgeTwc        = require('./src/ws/bridgeTwc');
const notificationService = require('./src/services/notificationService');
const notificationCron    = require('./src/cron/notificationCron');

const authRoutes       = require('./src/routes/auth');
const clientRoutes     = require('./src/routes/clients');
const payrollRoutes    = require('./src/routes/payroll');
const submissionRoutes = require('./src/routes/submissions');
const employeeRoutes   = require('./src/routes/employees');
const reportRoutes     = require('./src/routes/reports');
const paystubRoutes    = require('./src/routes/paystubs');
const payGroupRoutes   = require('./src/routes/payGroups');
const importRoutes     = require('./src/routes/import');
const directDepositRoutes  = require('./src/routes/directDeposit');
const twcSubmissionRoutes  = require('./src/routes/twcSubmissions');
const childSupportRoutes   = require('./src/routes/childSupport');
const twcPaymentRoutes     = require('./src/routes/twcPayments');
const clientPortalRoutes   = require('./src/routes/clientPortal');
const employeePortalRoutes = require('./src/routes/employeePortal');
const { requireAuth }  = require('./src/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Proxy trust (Railway / any reverse proxy) ─────────────────────────────────
// Required for express-rate-limit to read the real client IP from
// X-Forwarded-For instead of throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// ── CORS ─────────────────────────────────────────────────────────────────────
// In production the backend serves the frontend (same origin), so CORS is only
// needed for local dev. CORS_ORIGIN env var overrides the default.
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : ['http://localhost:5173', 'http://localhost:3001'];

app.use(helmet({
  // Allow inline scripts/styles that Vite injects into the built index.html
  contentSecurityPolicy: false,
}));
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());

// 6000/15min: live tax-preview calls during heavy check editing plus dashboard
// polling were brushing the old 2000 cap from a single office IP — hitting it
// silently froze FIT/state estimates in the check modals.
const limiter     = rateLimit({ windowMs: 15 * 60 * 1000, max: 6000 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max:   50 });
app.use(limiter);

// ── Initialize DB ─────────────────────────────────────────────────────────────
getDb();

// ── Pre-enrolled client PINs ──────────────────────────────────────────────────
// These clients were enrolled in EFTPS before the app existed.
// Always overwrite their PINs with the correct values — a previous resolvePin()
// call may have stored a random wrong PIN before this list was added.
(function seedPreEnrolledClients() {
  try {
    const { encrypt } = require('./src/services/cryptoService');
    const db = getDb();
    const PRE_ENROLLED = [
      { ein: '842408534', pin: '2024' },
      { ein: '990518604', pin: '2024' },
      { ein: '931368386', pin: '2024' },
      { ein: '473050580', pin: '6553' },
      { ein: '853987275', pin: '2691' },
      { ein: '562538997', pin: '4346' },
      { ein: '991845999', pin: '2691' },
      { ein: '993115196', pin: '2691' },
      { ein: '205362094', pin: '2024' },
      { ein: '872041441', pin: '2691' },
      { ein: '863650369', pin: '2024' },
      { ein: '991333276', pin: '2691' },
      { ein: '331784993', pin: '5161' },
      { ein: '825072557', pin: '4394' },
      { ein: '395162505', pin: '7917' },
      { ein: '731662921', pin: '5159' },
      { ein: '872683407', pin: '7736' },
      { ein: '850860201', pin: '4929' },
      { ein: '462614605', pin: '1534' },
      { ein: '332277526', pin: '6145' },
      { ein: '205674633', pin: '0201' },
      { ein: '414959515', pin: '2671' },
      { ein: '475652843', pin: '7526' },
      { ein: '412536879', pin: '2691' },
      { ein: '412510760', pin: '2691' },
    ];
    const allClients = db.prepare('SELECT id, ein FROM clients').all();
    let updated = 0;
    for (const { ein, pin } of PRE_ENROLLED) {
      const digits = ein.replace(/\D/g, '');
      const client = allClients.find(c => c.ein.replace(/\D/g, '') === digits);
      if (!client) continue;
      db.prepare('UPDATE clients SET eftps_enrolled = 1, batch_provider_pin_encrypted = ? WHERE id = ?')
        .run(encrypt(pin), client.id);
      updated++;
    }
    if (updated > 0) console.log(`[Startup] Updated ${updated} pre-enrolled client(s) with correct EFTPS PIN`);
  } catch (err) {
    console.error('[Startup] Pre-enrolled client seed failed:', err.message);
  }
})();

// ── Payroll frequency corrections ────────────────────────────────────────────
(function seedPayrollFrequencies() {
  try {
    const db = getDb();
    const FREQUENCIES = [
      { ein: '562538997', frequency: 'monthly', next_payroll_date: '2026-06-24' }, // Latchme Corp
      { ein: '810979054', frequency: 'monthly', next_payroll_date: '2026-02-17' }, // Habibi Hookah Cafe
    ];
    const allClients = db.prepare('SELECT id, ein FROM clients').all();
    let updated = 0;
    for (const { ein, frequency, next_payroll_date } of FREQUENCIES) {
      const digits = ein.replace(/\D/g, '');
      const client = allClients.find(c => c.ein.replace(/\D/g, '') === digits);
      if (!client) continue;
      db.prepare('UPDATE clients SET payroll_frequency = ?, next_payroll_date = ? WHERE id = ?')
        .run(frequency, next_payroll_date, client.id);
      updated++;
    }
    if (updated > 0) console.log(`[Startup] Updated payroll frequency for ${updated} client(s)`);
  } catch (err) {
    console.error('[Startup] Payroll frequency seed failed:', err.message);
  }
})();

// ── Stale job cleanup ─────────────────────────────────────────────────────────
// Paystubs stuck in 'processing' for over 2 hours likely belong to a bridge
// session that crashed without sending a result. Mark them failed so the UI
// doesn't show a permanent spinner and the operator can resubmit.
(function cleanStaleProcessingJobs() {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const r1 = db.prepare(`
      UPDATE paystubs SET status = 'failed'
      WHERE  status = 'processing' AND created_at < ?
    `).run(cutoff);
    const r2 = db.prepare(`
      UPDATE paystubs SET status_940 = 'failed'
      WHERE  status_940 = 'processing' AND created_at < ?
    `).run(cutoff);
    const changed = r1.changes + r2.changes;
    if (changed > 0) {
      console.log(`[Startup] Marked ${changed} stale 'processing' paystub(s) as 'failed' (941: ${r1.changes}, 940: ${r2.changes})`);
    }
  } catch (err) {
    console.error('[Startup] Stale job cleanup failed:', err.message);
  }
})();

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',        authLimiter, authRoutes);
app.use('/api/clients',     clientRoutes);
app.use('/api/payroll',     payrollRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/employees',   employeeRoutes);
app.use('/api/reports',     reportRoutes);
app.use('/api/paystubs',    paystubRoutes);
app.use('/api/pay-groups',  payGroupRoutes);
app.use('/api/import',          importRoutes);
app.use('/api/direct-deposit', directDepositRoutes);
app.use('/api/twc-submissions',  twcSubmissionRoutes);
app.use('/api/child-support',    childSupportRoutes);
app.use('/api/twc-payments',     twcPaymentRoutes);
app.use('/api/client-portal',   clientPortalRoutes);
app.use('/api/employee-portal', employeePortalRoutes);
app.get('/api/twc-bridge/status', requireAuth, (req, res) => res.json({ connected: bridgeTwc.isConnected, version: bridgeTwc.bridgeVersion || null }));
app.post('/api/twc-bridge/kill',  requireAuth, (req, res) => {
  try { res.json({ ok: true, ...bridgeTwc.killJob() }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/bridge/status', requireAuth, (req, res) => res.json({ connected: bridgeManager.isConnected }));
app.post('/api/bridge/kill',  requireAuth, (req, res) => {
  try { res.json({ ok: true, ...bridgeManager.killJob() }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/health',      (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

app.get('/api/bridge/job-status/:jobId', requireAuth, (req, res) => {
  const status = bridgeManager.getJobStatus(req.params.jobId);
  if (!status) return res.status(404).json({ error: 'Job not found' });
  res.json(status);
});

app.get('/api/bridge/status', requireAuth, (req, res) => {
  const connected = bridgeManager.isConnected;
  res.json({ connected });
});

// ── WebSocket bridge guards ───────────────────────────────────────────────────
app.get('/ws/bridge', (req, res) => {
  res.set('Upgrade', 'websocket').status(426).json({
    error: 'This endpoint requires a WebSocket upgrade (Upgrade: websocket)',
  });
});
app.get('/ws/twc-bridge', (req, res) => {
  res.set('Upgrade', 'websocket').status(426).json({
    error: 'This endpoint requires a WebSocket upgrade (Upgrade: websocket)',
  });
});

// ── Serve React frontend (production) ────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  // React Router — serve index.html for any non-API route
  app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const httpServer = http.createServer(app);
bridgeManager.attach(httpServer);
bridgeTwc.attach(httpServer);

// ── Initialize notifications ──────────────────────────────────────────────────
notificationService.init();
notificationCron.start();

httpServer.listen(PORT, () => {
  console.log(`PayrollTax Pro server on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  console.log(`EFTPS dry-run: ${process.env.EFTPS_DRY_RUN !== 'false'} | headless: ${process.env.EFTPS_HEADLESS !== 'false'}`);
  console.log(`DB: ${process.env.DB_PATH || 'default (local data/)'}`);
  if (!process.env.BRIDGE_SECRET)     console.warn('[Bridge WS] WARNING: BRIDGE_SECRET not set — EFTPS bridge connections will be rejected');
  if (!process.env.BRIDGE_TWC_SECRET) console.warn('[TWC Bridge WS] WARNING: BRIDGE_TWC_SECRET not set — TWC bridge connections will be rejected');
});
