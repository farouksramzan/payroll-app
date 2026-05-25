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

const limiter     = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use(limiter);

// ── Initialize DB ─────────────────────────────────────────────────────────────
getDb();

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',        authLimiter, authRoutes);
app.use('/api/clients',     clientRoutes);
app.use('/api/payroll',     payrollRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/employees',   employeeRoutes);
app.use('/api/reports',     reportRoutes);
app.use('/api/paystubs',    paystubRoutes);
app.use('/api/pay-groups',  payGroupRoutes);
app.get('/api/health',      (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

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
app.get('/api/bridge/job-status/:jobId', (req, res) => {
  const status = bridgeManager.getJobStatus(req.params.jobId);
  if (!status) return res.status(404).json({ error: 'Job not found' });
  res.json(status);
});

// TEMP admin endpoint — remove after use
app.post('/api/admin/set-enrolled', (req, res) => {
  const { secret, ein } = req.body;
  if (secret !== process.env.BRIDGE_SECRET) return res.status(403).json({ error: 'forbidden' });
  const { getDb } = require('./src/database/db');
  const db = getDb();
  db.prepare('UPDATE clients SET eftps_enrolled = 1 WHERE ein = ?').run(ein);
  const row = db.prepare('SELECT business_name, ein, eftps_enrolled FROM clients WHERE ein = ?').get(ein);
  res.json(row || { error: 'not found' });
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
