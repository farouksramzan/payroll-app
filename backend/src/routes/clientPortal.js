'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, requireClient } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireClient);

function clientScope(req) {
  if (req.user.role === 'admin') return req.query.clientId ? parseInt(req.query.clientId, 10) : null;
  return req.user.clientId;
}

// ── GET /api/client-portal/me ─────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const db = getDb();
  const clientId = req.user.clientId;
  if (!clientId) return res.status(400).json({ error: 'No client associated with this account' });

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(serializeClient(client));
});

// ── GET /api/client-portal/employees ─────────────────────────────────────────
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
router.get('/paystubs', (req, res) => {
  const db = getDb();
  const clientId = clientScope(req);
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const { year, quarter } = req.query;

  let query = `
    SELECT p.*, e.first_name, e.last_name
    FROM paystubs p
    JOIN employees e ON p.employee_id = e.id
    WHERE e.client_id = ?
  `;
  const params = [clientId];

  if (year)    { query += ' AND p.tax_year = ?';    params.push(year); }
  if (quarter) { query += ' AND p.tax_quarter = ?'; params.push(quarter); }
  query += ' ORDER BY p.tax_year DESC, p.tax_quarter DESC, e.last_name, e.first_name';

  const records = db.prepare(query).all(...params);
  res.json(records);
});

// ── GET /api/client-portal/summary ───────────────────────────────────────────
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
    SELECT tax_year AS year, tax_quarter AS quarter
    FROM paystubs p
    JOIN employees e ON p.employee_id = e.id
    WHERE e.client_id = ?
    ORDER BY p.tax_year DESC, p.tax_quarter DESC LIMIT 1
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
    address:      c.business_address || null,
    city:         c.business_city    || null,
    state:        c.state            || null,
    zip:          c.business_zip     || null,
    phone:        c.contact_phone    || null,
    email:        c.contact_email    || null,
    contactName:  c.contact_name     || null,
    joinCode:       c.join_code       || null,
    selfRegistered: !!c.self_registered,
    onboardingDone: !!c.onboarding_done,
  };
}

function serializeEmployee(e) {
  return {
    id:              e.id,
    firstName:       e.first_name,
    lastName:        e.last_name,
    portalEmail:     e.portal_email || null,
    hasPortalAccess: !!e.has_portal_access,
    payType:         e.pay_type     || null,
    payRate:         e.pay_type === 'hourly' ? e.hourly_rate : e.annual_salary,
  };
}

module.exports = router;
