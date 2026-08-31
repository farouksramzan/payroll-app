// ── System ────────────────────────────────────────────────────────────────────
// Small cross-cutting endpoints: which notification channels are configured on
// the server, and per-client tax form filing status (generated/filed).
const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── GET /api/system/notification-config ───────────────────────────────────────
router.get('/notification-config', (req, res) => {
  res.json({
    emailConfigured: !!process.env.SENDGRID_API_KEY,
    smsConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
  });
});

function listFilings(db, clientId) {
  return db.prepare('SELECT form_key, status, updated_at FROM form_filings WHERE client_id = ? ORDER BY form_key')
    .all(clientId)
    .map((r) => ({ formKey: r.form_key, status: r.status, updatedAt: r.updated_at }));
}

// ── GET /api/system/clients/:clientId/form-filings ────────────────────────────
router.get('/clients/:clientId/form-filings', (req, res) => {
  const db = getDb();
  const clientId = req.params.clientId;
  if (!canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Client not found' });
  res.json(listFilings(db, clientId));
});

// ── PUT /api/system/clients/:clientId/form-filings ────────────────────────────
// { formKey, status } — status 'generated'/'filed' upserts; null/'' deletes.
router.put('/clients/:clientId/form-filings', (req, res) => {
  const db = getDb();
  const clientId = req.params.clientId;
  if (!canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Client not found' });
  const { formKey, status } = req.body;
  if (typeof formKey !== 'string' || !formKey.trim() || formKey.length > 64) {
    return res.status(400).json({ error: 'formKey must be a non-empty string of at most 64 characters' });
  }
  if (status === null || status === undefined || status === '') {
    db.prepare('DELETE FROM form_filings WHERE client_id = ? AND form_key = ?').run(clientId, formKey);
  } else if (status === 'generated' || status === 'filed') {
    db.prepare(`
      INSERT INTO form_filings (client_id, form_key, status, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(client_id, form_key) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(clientId, formKey, status);
  } else {
    return res.status(400).json({ error: "status must be 'generated', 'filed', or empty to clear" });
  }
  res.json(listFilings(db, clientId));
});

module.exports = router;
