'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, requireEmployee, canAccessClient } = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/cryptoService');

const router = express.Router();

router.use(requireAuth, requireEmployee);

function getEmpId(req) {
  if (req.user.role === 'admin') {
    // An admin may read an employee's portal data only for a company they can
    // access — never an arbitrary employeeId. Returns null (→ empty) otherwise.
    if (!req.query.employeeId) return null;
    const eid = parseInt(req.query.employeeId, 10);
    const db = getDb();
    const emp = db.prepare('SELECT client_id FROM employees WHERE id = ?').get(eid);
    if (!emp || !canAccessClient(db, emp.client_id, req.user)) return null;
    return eid;
  }
  return req.user.employeeId;
}

// ── GET /api/employee-portal/me ───────────────────────────────────────────────
router.get('/me', (req, res) => {
  const db  = getDb();
  const eid = req.user.employeeId;
  if (!eid) return res.status(400).json({ error: 'No employee record linked to this account' });

  const emp = db.prepare(`
    SELECT e.*, c.business_name AS company_name, c.join_code AS company_join_code
    FROM employees e
    JOIN clients c ON c.id = e.client_id
    WHERE e.id = ?
  `).get(eid);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  res.json(serializeEmployee(emp));
});

// ── PATCH /api/employee-portal/me ────────────────────────────────────────────
router.patch('/me', (req, res) => {
  const db  = getDb();
  const eid = req.user.employeeId;
  if (!eid) return res.status(400).json({ error: 'No employee record linked to this account' });

  const intFields = ['step2_checkbox', 'step3_children', 'step3_other'];
  const W4_KEYS   = ['filingStatus', 'step2Checkbox', 'step3Children', 'step3Other', 'step4a', 'step4b', 'step4c'];

  const keyMap = {
    address: 'address', city: 'city', state: 'state', zip: 'zip',
    filingStatus:  'filing_status',
    step2Checkbox: 'step2_checkbox',
    step3Children: 'step3_children',
    step3Other:    'step3_other',
    step4a: 'step4a', step4b: 'step4b', step4c: 'step4c',
    hireDate:          'hire_date',
    bankRoutingNumber: 'bank_routing_number',
    bankAccountType:   'bank_account_type',
  };

  const updates = {};
  let savingW4 = false;

  for (const [bodyKey, col] of Object.entries(keyMap)) {
    if (req.body[bodyKey] === undefined) continue;
    if (W4_KEYS.includes(bodyKey)) savingW4 = true;
    if (intFields.includes(col)) {
      updates[col] = req.body[bodyKey] ? 1 : 0;
    } else {
      updates[col] = req.body[bodyKey];
    }
  }

  // SSN — encrypt before storing
  if (req.body.ssn) {
    const raw = String(req.body.ssn).replace(/\D/g, '');
    if (raw.length !== 9) return res.status(400).json({ error: 'SSN must be 9 digits' });
    updates['ssn_encrypted'] = encrypt(raw);
  }

  // Bank account number — encrypt + store last 4
  if (req.body.bankAccountNumber) {
    const raw = String(req.body.bankAccountNumber).replace(/\D/g, '');
    if (raw.length < 4) return res.status(400).json({ error: 'Account number must be at least 4 digits' });
    updates['bank_account_number_encrypted'] = encrypt(raw);
    updates['bank_account_last4'] = raw.slice(-4);
  }

  if (savingW4) updates['w4_submitted'] = 1;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE employees SET ${setClause} WHERE id = ?`).run(...Object.values(updates), eid);

  const updated = db.prepare(`
    SELECT e.*, c.business_name AS company_name, c.join_code AS company_join_code
    FROM employees e
    JOIN clients c ON c.id = e.client_id
    WHERE e.id = ?
  `).get(eid);
  res.json(serializeEmployee(updated));
});

// ── POST /api/employee-portal/complete-onboarding ────────────────────────────
router.post('/complete-onboarding', (req, res) => {
  const db  = getDb();
  const eid = req.user.employeeId;
  if (!eid) return res.status(400).json({ error: 'No employee record linked to this account' });
  db.prepare('UPDATE employees SET onboarding_done = 1 WHERE id = ?').run(eid);
  const updated = db.prepare(`
    SELECT e.*, c.business_name AS company_name, c.join_code AS company_join_code
    FROM employees e
    JOIN clients c ON c.id = e.client_id
    WHERE e.id = ?
  `).get(eid);
  res.json(serializeEmployee(updated));
});

// ── GET /api/employee-portal/paystubs ────────────────────────────────────────
router.get('/paystubs', (req, res) => {
  const db  = getDb();
  const eid = getEmpId(req);
  if (!eid) return res.status(400).json({ error: 'employeeId required' });

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

  if (req.user.role === 'employee' && record.employee_id !== req.user.employeeId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(record);
});

// ── Serializer ────────────────────────────────────────────────────────────────
function serializeEmployee(e) {
  let ssnDisplay = null;
  if (e.ssn_encrypted) {
    try {
      const plain = decrypt(e.ssn_encrypted);
      ssnDisplay = plain ? `•••-••-${plain.slice(-4)}` : '•••-••-????';
    } catch {
      ssnDisplay = 'On file';
    }
  }

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
    hireDate:       e.hire_date || null,
    hasSSN:         !!e.ssn_encrypted,
    ssn:            ssnDisplay,
    routingNumber:  e.bank_routing_number  ? `••••${String(e.bank_routing_number).slice(-4)}`  : null,
    accountNumber:  e.bank_account_last4   ? `••••${e.bank_account_last4}`                     : null,
    accountType:    e.bank_account_type    || null,
    hasBankInfo:    !!(e.bank_routing_number && e.bank_account_last4),
    // W-4 fields
    filingStatus:   e.filing_status   || 'single',
    step2Checkbox:  !!e.step2_checkbox,
    step3Children:  e.step3_children  || 0,
    step3Other:     e.step3_other     || 0,
    step4a:         e.step4a          || 0,
    step4b:         e.step4b          || 0,
    step4c:         e.step4c          || 0,
    w4Submitted:    !!e.w4_submitted,
    companyName:     e.company_name      || null,
    companyJoinCode: e.company_join_code || null,
    onboardingDone:  !!e.onboarding_done,
  };
}

module.exports = router;
