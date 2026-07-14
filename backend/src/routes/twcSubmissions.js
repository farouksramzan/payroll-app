'use strict';

/**
 * twcSubmissions.js
 * REST routes for TWC QuickFile bridge submission jobs.
 *
 * POST   /api/twc-submissions           — create a new submission job
 * GET    /api/twc-submissions           — list submissions (clientId query param)
 * GET    /api/twc-submissions/:id       — get single submission status
 * GET    /api/twc-bridge/status         — is the TWC bridge connected?
 */

const express   = require('express');
const { getDb } = require('../database/db');
const { requireAuth, requireAdmin, canAccessClient } = require('../middleware/auth');
const { generateIcesa } = require('../services/icesaService');
const bridgeTwc = require('../ws/bridgeTwc');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

// ── POST /api/twc-submissions ─────────────────────────────────────────────────
// Creates a pending TWC submission, generates the ICESA content, and if the
// TWC bridge is currently connected dispatches the job immediately.
router.post('/', (req, res) => {
  const { clientId, quarter, year } = req.body;
  if (!clientId || !quarter || !year) {
    return res.status(400).json({ error: 'clientId, quarter, and year are required' });
  }

  const db = getDb();
  const client = canAccessClient(db, clientId, req.user);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Generate ICESA content
  let icesaContent;
  try {
    icesaContent = generateIcesa(db, client, parseInt(quarter), parseInt(year));
  } catch (err) {
    console.error('[twc-submissions] ICESA generation failed:', err);
    return res.status(500).json({ error: 'Failed to generate ICESA file', detail: err.message });
  }

  // Filename for the bridge to use when saving locally
  const bizSlug  = (client.business_name || 'report').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
  const filename = `TWC_Q${quarter}_${year}_${bizSlug}.txt`;

  // Insert submission record
  const result = db.prepare(`
    INSERT INTO twc_submissions (user_id, client_id, quarter, year, status, icesa_content, filename)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(req.user.id, clientId, parseInt(quarter), parseInt(year), icesaContent, filename);

  const submissionId = result.lastInsertRowid;

  // Dispatch immediately if bridge is live
  if (bridgeTwc.isConnected) {
    try {
      db.prepare(`UPDATE twc_submissions SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(submissionId);
      bridgeTwc.queueJob(
        { submissionId, filename, icesaContent, clientName: client.business_name, quarter, year },
        (success, msg) => {
          // result is persisted in bridgeTwc._handleResult — nothing extra needed here
          console.log(`[twc-submissions] Job ${submissionId} done: ${success ? 'OK' : msg.error}`);
        },
      );
    } catch (err) {
      // If queuing fails (bridge disconnected between the check and the send), revert to pending
      db.prepare(`UPDATE twc_submissions SET status='pending', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(submissionId);
      console.warn('[twc-submissions] Failed to queue job immediately:', err.message);
    }
  }

  const submission = db.prepare('SELECT * FROM twc_submissions WHERE id = ?').get(submissionId);
  res.status(201).json(serializeSubmission(submission));
});

// ── GET /api/twc-submissions ──────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { clientId } = req.query;
  const db = getDb();
  let rows;
  if (clientId) {
    // Verify ownership
    const client = canAccessClient(db, clientId, req.user);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    rows = db.prepare(`SELECT * FROM twc_submissions WHERE client_id = ? ORDER BY created_at DESC LIMIT 50`).all(clientId);
  } else {
    rows = db.prepare(`
      SELECT ts.* FROM twc_submissions ts
      JOIN clients c ON ts.client_id = c.id
      WHERE (c.user_id = ? OR c.id IN (SELECT client_id FROM client_accountants WHERE user_id = ?))
      ORDER BY ts.created_at DESC LIMIT 100
    `).all(req.user.id, req.user.id);
  }
  res.json(rows.map(serializeSubmission));
});

// ── GET /api/twc-submissions/:id ──────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT ts.* FROM twc_submissions ts
    JOIN clients c ON ts.client_id = c.id
    WHERE ts.id = ? AND (c.user_id = ? OR c.id IN (SELECT client_id FROM client_accountants WHERE user_id = ?))
  `).get(req.params.id, req.user.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Submission not found' });
  res.json(serializeSubmission(row));
});

// ── GET /api/twc-bridge/status ────────────────────────────────────────────────
// Exposed without auth check on path — auth via requireAuth middleware at top.
router.get('/bridge-status', (req, res) => {
  res.json({ connected: bridgeTwc.isConnected });
});

function serializeSubmission(row) {
  return {
    id:                 row.id,
    clientId:           row.client_id,
    quarter:            row.quarter,
    year:               row.year,
    status:             row.status,
    filename:           row.filename,
    confirmationNumber: row.confirmation_number || null,
    error:              row.error               || null,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  };
}

module.exports = router;
