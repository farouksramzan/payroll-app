require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const path    = require('path');
const fs      = require('fs');
const { getDb } = require('./src/database/db');

const authRoutes       = require('./src/routes/auth');
const clientRoutes     = require('./src/routes/clients');
const payrollRoutes    = require('./src/routes/payroll');
const submissionRoutes = require('./src/routes/submissions');
const employeeRoutes   = require('./src/routes/employees');
const reportRoutes     = require('./src/routes/reports');

const app  = express();
const PORT = process.env.PORT || 3001;

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

const limiter     = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
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
app.get('/api/health',      (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

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

app.listen(PORT, () => {
  console.log(`PayrollTax Pro server on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  console.log(`EFTPS dry-run: ${process.env.EFTPS_DRY_RUN !== 'false'} | headless: ${process.env.EFTPS_HEADLESS !== 'false'}`);
  console.log(`DB: ${process.env.DB_PATH || 'default (local data/)'}`);
});
