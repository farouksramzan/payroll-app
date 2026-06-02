require('dotenv').config();
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const path    = require('path');
const fs      = require('fs');
const { getDb } = require('./src/database/db');
const bridgeManager = require('./src/ws/bridge');
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
const directDepositRoutes = require('./src/routes/directDeposit');
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

const limiter     = rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 });
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
app.get('/api/health',      (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

// ── Debug: inspect next-pay-date computation data ─────────────────────────────
app.get('/api/debug/nextpay', (req, res) => {
  try {
    const db = getDb();
    const clients = db.prepare('SELECT id, business_name, ein, next_payroll_date, payroll_frequency FROM clients ORDER BY business_name').all();
    const result = clients.map(c => {
      const groups = db.prepare('SELECT id, frequency, first_pay_period_end, deleted_at FROM pay_groups WHERE client_id = ?').all(c.id);
      const paystubs = db.prepare(`
        SELECT pay_group_id, check_status, MAX(pay_period_end) as last_end
        FROM paystubs WHERE client_id = ? AND pay_period_end IS NOT NULL
        GROUP BY pay_group_id, check_status
        ORDER BY last_end DESC
      `).all(c.id);
      return { id: c.id, name: c.business_name, ein: c.ein, next_payroll_date: c.next_payroll_date, frequency: c.payroll_frequency, pay_groups: groups, paystub_summary: paystubs };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug: inspect paystub statuses in Railway's live DB ─────────────────────
app.get('/api/debug/paystubs', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare(`
      SELECT id, client_id, employee_id, employee_name,
             check_status, status, status_940,
             gross_wages, total_deposit, pay_period_end, created_at
      FROM   paystubs
      ORDER  BY created_at DESC
      LIMIT  50
    `).all();
    res.json({ count: rows.length, dbPath: process.env.DB_PATH || 'default (data/payroll.db)', rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/debug/client-pin/:ein', (req, res) => {
  try {
    const { decrypt } = require('./src/services/cryptoService');
    const db = getDb();
    const digits = req.params.ein.replace(/\D/g, '');
    const clients = db.prepare('SELECT id, business_name, ein, eftps_enrolled, batch_provider_pin_encrypted FROM clients').all();
    const client = clients.find(c => c.ein.replace(/\D/g, '') === digits);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const pin = client.batch_provider_pin_encrypted ? decrypt(client.batch_provider_pin_encrypted) : null;
    res.json({ id: client.id, business_name: client.business_name, ein: client.ein, eftps_enrolled: client.eftps_enrolled, pin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bridge/job-status/:jobId', (req, res) => {
  const status = bridgeManager.getJobStatus(req.params.jobId);
  if (!status) return res.status(404).json({ error: 'Job not found' });
  res.json(status);
});

app.get('/api/bridge/status', (req, res) => {
  const connected = bridgeManager.isConnected;
  // Log every poll in dev so Railway's log stream shows the real-time state
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Bridge WS] /api/bridge/status → connected=${connected}`);
  }
  res.json({ connected });
});

// ── WebSocket bridge guard ────────────────────────────────────────────────────
// If a plain HTTP request arrives at /ws/bridge (e.g. proxy didn't upgrade),
// return 426 so the client gets a clear signal instead of a 200/HTML response.
app.get('/ws/bridge', (req, res) => {
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

// ── Initialize notifications ──────────────────────────────────────────────────
notificationService.init();
notificationCron.start();

httpServer.listen(PORT, () => {
  console.log(`PayrollTax Pro server on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  console.log(`EFTPS dry-run: ${process.env.EFTPS_DRY_RUN !== 'false'} | headless: ${process.env.EFTPS_HEADLESS !== 'false'}`);
  console.log(`DB: ${process.env.DB_PATH || 'default (local data/)'}`);
  if (!process.env.BRIDGE_SECRET) console.warn('[Bridge WS] WARNING: BRIDGE_SECRET not set — bridge connections will be rejected');
});
