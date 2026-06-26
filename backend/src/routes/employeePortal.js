'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, requireEmployee } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireEmployee);

function getEmpId(req) {
  // Admin can pass ?employeeId=; employee users are locked to their own
  if (req.user.role === 'admin') return req.query.employeeId ? parseInt(req.query.employeeId, 10) : null;
  return req.user.employeeId;
}

// ── GET /api/employee-portal/me ───────────────────────────────────────────────
router.get('/me', (req, res) => {
  const db  = getDb();
  const eid = req.user.employeeId;
  if (!eid) return res.status(400).json({ error: 'No employee record linked to this account' });

  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(eid);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  res.json(serializeEmployee(emp));
});

// ── PATCH /api/employee-portal/me ────────────────────────────────────────────
// Employee can update their own contact info + bank info
router.patch('/me', (req, res) => {
  const db  = getDb();
  const eid = req.user.employeeId;
  if (!eid) return res.status(400).json({ error: 'No employee record linked to this account' });

  const scalarFields = ['address', 'city', 'state', 'zip', 'filing_status', 'step4a', 'step4b', 'step4c'];
  const intFields    = ['step2_checkbox', 'step3_children', 'step3_other'];

  // Map camelCase body keys → snake_case column names
  const keyMap = {
    address: 'address', city: 'city', state: 'state', zip: 'zip',
    filingStatus:  'filing_status',
    step2Checkbox: 'step2_checkbox',
    step3Children: 'step3_children',
    step3Other:    'step3_other',
    step4a: 'step4a', step4b: 'step4b', step4c: 'step4c',
  };

  const updates = {};
  for (const [bodyKey, col] of Object.entries(keyMap)) {
    if (req.body[bodyKey] === undefined) continue;
    if (intFields.includes(col)) {
      updates[col] = req.body[bodyKey] ? 1 : 0;
    } else {
      updates[col] = req.body[bodyKey];
    }
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE employees SET ${setClause} WHERE id = ?`).run(...Object.values(updates), eid);

  const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(eid);
  res.json(serializeEmployee(updated));
});

// ── GET /api/employee-portal/paystubs ────────────────────────────────────────
router.get('/paystubs', (req, res) => {
  const db  = getDb();
  const eid = getEmpId(req);
  if (!eid) return res.status(400).json({ error: 'employeeId required' });

  // Employees can only see their own
  if (req.user.role === 'employee' && eid !== req.user.employeeId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const records = db.prepare(`
    SELECT * FROM paystubs WHERE employee_id = ?
    ORDER BY pay_period_end DESC
  `).all(eid);

  res.json(records);
});

// ── GET /api/employee-portal/paystubs/:id ────────────────────────────────────
router.get('/paystubs/:id', (req, res) => {
  const db     = getDb();
  const record = db.prepare('SELECT * FROM paystubs WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Paystub not found' });

  // Enforce ownership
  if (req.user.role === 'employee' && record.employee_id !== req.user.employeeId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(record);
});

// ── Serializer ────────────────────────────────────────────────────────────────
function serializeEmployee(e) {
  return {
    id:             e.id,
    firstName:      e.first_name,
    lastName:       e.last_name,
    address:        e.address || null,
    city:           e.city || null,
    state:          e.state || null,
    zip:            e.zip || null,
    payType:        e.pay_type || null,
    payRate:        e.pay_type === 'hourly' ? e.hourly_rate : e.annual_salary,
    routingNumber:  e.bank_routing_number  ? `••••${String(e.bank_routing_number).slice(-4)}`  : null,
    accountNumber:  e.bank_account_last4   ? `••••${e.bank_account_last4}`                     : null,
    accountType:    e.bank_account_type    || null,
    hireDate:       e.hire_date || null,
    ssn:            e.ssn_encrypted ? `•••-••-${String(e.ssn_encrypted).slice(-4)}` : null,
    // W-4 fields
    filingStatus:   e.filing_status   || 'single',
    step2Checkbox:  !!e.step2_checkbox,
    step3Children:  e.step3_children  || 0,
    step3Other:     e.step3_other     || 0,
    step4a:         e.step4a          || 0,
    step4b:         e.step4b          || 0,
    step4c:         e.step4c          || 0,
  };
}

module.exports = router;
