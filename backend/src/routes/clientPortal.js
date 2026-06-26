'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, requireClient } = require('../middleware/auth');

const router = express.Router();

// All routes require auth + client (or admin) role
router.use(requireAuth, requireClient);

function clientScope(req) {
  // Admin can query any client; client users are locked to their own client
  if (req.user.role === 'admin') return req.query.clientId ? parseInt(req.query.clientId, 10) : null;
  return req.user.clientId;
}

// ── GET /api/client-portal/me ─────────────────────────────────────────────────
// Returns the client record + company info for the logged-in client user
router.get('/me', (req, res) => {
  const db = getDb();
  const clientId = req.user.clientId;
  if (!clientId) return res.status(400).json({ error: 'No client associated with this account' });

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(serializeClient(client));
});

// ── GET /api/client-portal/employees ─────────────────────────────────────────
// Returns all employees for the client's company
router.get('/employees', (req, res) => {
  const db = getDb();
  const clientId = clientScope(req);
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const employees = db.prepare(`
    SELECT e.*, u.email AS portal_email, u.setup_complete AS has_portal_access
    FROM employees e
    LEFT JOIN users u ON u.employee_id = e.id AND u.role = 'employee'
    WHERE e.client_id = ?
    ORDER BY e.last_name, e.first_name
  `).all(clientId);

  res.json(employees.map(serializeEmployee));
});

// ── GET /api/client-portal/paystubs ──────────────────────────────────────────
// Returns payroll history for the client
router.get('/paystubs', (req, res) => {
  const db = getDb();
  const clientId = clientScope(req);
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const { year, quarter } = req.query;

  let query = `
    SELECT pr.*, e.first_name, e.last_name
    FROM payroll_records pr
    JOIN employees e ON pr.employee_id = e.id
    WHERE e.client_id = ?
  `;
  const params = [clientId];

  if (year) { query += ' AND pr.year = ?'; params.push(year); }
  if (quarter) { query += ' AND pr.quarter = ?'; params.push(quarter); }
  query += ' ORDER BY pr.year DESC, pr.quarter DESC, e.last_name, e.first_name';

  const records = db.prepare(query).all(...params);
  res.json(records);
});

// ── GET /api/client-portal/summary ───────────────────────────────────────────
// Dashboard summary: employee count, recent payroll quarter, invite status
router.get('/summary', (req, res) => {
  const db = getDb();
  const clientId = clientScope(req);
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const empCount = db.prepare('SELECT COUNT(*) AS cnt FROM employees WHERE client_id = ?').get(clientId)?.cnt || 0;
  const invitedCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM users WHERE role = 'employee' AND employee_id IN (
      SELECT id FROM employees WHERE client_id = ?
    )
  `).get(clientId)?.cnt || 0;

  const latestPayroll = db.prepare(`
    SELECT year, quarter FROM payroll_records pr
    JOIN employees e ON pr.employee_id = e.id
    WHERE e.client_id = ?
    ORDER BY year DESC, quarter DESC LIMIT 1
  `).get(clientId);

  res.json({
    employeeCount:     empCount,
    invitedCount,
    latestPayrollYear: latestPayroll?.year || null,
    latestPayrollQ:    latestPayroll?.quarter || null,
  });
});

// ── Serializers ───────────────────────────────────────────────────────────────
function serializeClient(c) {
  return {
    id:           c.id,
    businessName: c.business_name,
    ein:          c.ein,
    address:      c.address,
    city:         c.city,
    state:        c.state,
    zip:          c.zip,
    phone:        c.phone,
    email:        c.email,
    contactName:  c.contact_name,
  };
}

function serializeEmployee(e) {
  return {
    id:               e.id,
    firstName:        e.first_name,
    lastName:         e.last_name,
    email:            e.email,
    portalEmail:      e.portal_email || null,
    hasPortalAccess:  !!e.has_portal_access,
    jobTitle:         e.job_title || null,
    payType:          e.pay_type || null,
    payRate:          e.pay_rate || null,
  };
}

module.exports = router;
