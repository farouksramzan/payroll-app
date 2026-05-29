const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/cryptoService');

const router = express.Router();
router.use(requireAuth);

function sanitize(e, withSSN = false) {
  return {
    id: e.id, clientId: e.client_id,
    firstName: e.first_name, lastName: e.last_name,
    fullName: `${e.first_name} ${e.last_name}`,
    address: e.address, city: e.city, state: e.state, zip: e.zip,
    workState: e.work_state || null,
    filingStatus: e.filing_status, step2Checkbox: !!e.step2_checkbox,
    step3Children: e.step3_children, step3Other: e.step3_other,
    step4a: e.step4a, step4b: e.step4b, step4c: e.step4c,
    payType: e.pay_type, hourlyRate: e.hourly_rate, annualSalary: e.annual_salary,
    payFrequency: e.pay_frequency, isActive: !!e.is_active,
    hireDate: e.hire_date, createdAt: e.created_at,
    firstPayPeriodStart: e.first_pay_period_start || null,
    firstPayPeriodEnd:   e.first_pay_period_end   || null,
    payGroupId:   e.pay_group_id || null,
    payGroupName: e.pay_group_name || null,
    payGroupFrequency:   e.pay_group_frequency   || null,
    payGroupFirstStart:  e.pay_group_first_start  || null,
    payGroupFirstEnd:    e.pay_group_first_end    || null,
    hasSSN: !!e.ssn_encrypted,
    ...(withSSN && e.ssn_encrypted ? { ssn: decrypt(e.ssn_encrypted) } : {}),
  };
}

// GET /api/employees?clientId=X
router.get('/', (req, res) => {
  const db = getDb();
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const rows = db.prepare(`
    SELECT e.*,
           pg.name                  AS pay_group_name,
           pg.frequency             AS pay_group_frequency,
           pg.first_pay_period_start AS pay_group_first_start,
           pg.first_pay_period_end   AS pay_group_first_end
    FROM employees e
    LEFT JOIN pay_groups pg ON e.pay_group_id = pg.id
    WHERE e.client_id = ?
    ORDER BY e.last_name, e.first_name
  `).all(clientId);
  res.json(rows.map((e) => sanitize(e)));
});

// GET /api/employees/ytd-batch?clientId=X&year=YYYY
router.get('/ytd-batch', (req, res) => {
  const db = getDb();
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const year = parseInt(req.query.year || new Date().getFullYear(), 10);
  const rows = db.prepare(`
    SELECT y.* FROM employee_ytd_wages y
    JOIN employees e ON y.employee_id = e.id
    WHERE e.client_id = ? AND y.tax_year = ?
  `).all(clientId, year);
  res.json(rows);
});

// GET /api/employees/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const e = db.prepare(`
    SELECT e.*,
           pg.name                  AS pay_group_name,
           pg.frequency             AS pay_group_frequency,
           pg.first_pay_period_start AS pay_group_first_start,
           pg.first_pay_period_end   AS pay_group_first_end
    FROM employees e
    JOIN clients c ON e.client_id = c.id
    LEFT JOIN pay_groups pg ON e.pay_group_id = pg.id
    WHERE e.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!e) return res.status(404).json({ error: 'Employee not found' });
  res.json(sanitize(e, req.query.withSSN === 'true'));
});

// GET /api/employees/:id/ytd?year=2026
router.get('/:id/ytd', (req, res) => {
  const db = getDb();
  const e = db.prepare('SELECT e.id FROM employees e JOIN clients c ON e.client_id = c.id WHERE e.id = ? AND c.user_id = ?').get(req.params.id, req.user.id);
  if (!e) return res.status(404).json({ error: 'Employee not found' });
  const year = parseInt(req.query.year || new Date().getFullYear(), 10);
  const ytd = db.prepare('SELECT * FROM employee_ytd_wages WHERE employee_id = ? AND tax_year = ?').get(req.params.id, year);
  res.json(ytd || { employee_id: req.params.id, tax_year: year, ytd_gross: 0, ytd_ss_wages: 0, ytd_futa_wages: 0, ytd_suta_wages: 0 });
});

// POST /api/employees
router.post('/', (req, res) => {
  const db = getDb();
  const { clientId, firstName, lastName, ssn, address, city, state, zip, workState,
    filingStatus, step2Checkbox, step3Children, step3Other, step4a, step4b, step4c,
    payType, hourlyRate, annualSalary, payFrequency, hireDate,
    firstPayPeriodStart, firstPayPeriodEnd, payGroupId } = req.body;

  if (!clientId || !firstName || !lastName) return res.status(400).json({ error: 'clientId, firstName, lastName required' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const result = db.prepare(`
    INSERT INTO employees (client_id, first_name, last_name, ssn_encrypted, address, city, state, zip, work_state,
      filing_status, step2_checkbox, step3_children, step3_other, step4a, step4b, step4c,
      pay_type, hourly_rate, annual_salary, pay_frequency, hire_date,
      first_pay_period_start, first_pay_period_end, pay_group_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    clientId, firstName.trim(), lastName.trim(), encrypt(ssn),
    address || null, city || null, state || 'TX', zip || null,
    workState ? workState.toUpperCase() : null,
    filingStatus || 'single', step2Checkbox ? 1 : 0,
    parseInt(step3Children || 0), parseInt(step3Other || 0),
    parseFloat(step4a || 0), parseFloat(step4b || 0), parseFloat(step4c || 0),
    payType || 'hourly', parseFloat(hourlyRate || 0), parseFloat(annualSalary || 0),
    payFrequency || 'biweekly', hireDate || null,
    firstPayPeriodStart || null, firstPayPeriodEnd || null,
    payGroupId ? parseInt(payGroupId) : null,
  );
  const emp = db.prepare(`
    SELECT e.*, pg.name AS pay_group_name, pg.frequency AS pay_group_frequency,
           pg.first_pay_period_start AS pay_group_first_start,
           pg.first_pay_period_end   AS pay_group_first_end
    FROM employees e LEFT JOIN pay_groups pg ON e.pay_group_id = pg.id
    WHERE e.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(sanitize(emp));
});

// PUT /api/employees/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const e = db.prepare('SELECT e.* FROM employees e JOIN clients c ON e.client_id = c.id WHERE e.id = ? AND c.user_id = ?').get(req.params.id, req.user.id);
  if (!e) return res.status(404).json({ error: 'Employee not found' });

  const { firstName, lastName, ssn, address, city, state, zip, workState,
    filingStatus, step2Checkbox, step3Children, step3Other, step4a, step4b, step4c,
    payType, hourlyRate, annualSalary, payFrequency, hireDate, isActive,
    firstPayPeriodStart, firstPayPeriodEnd, payGroupId } = req.body;

  db.prepare(`
    UPDATE employees SET
      first_name=?, last_name=?, ssn_encrypted=?, address=?, city=?, state=?, zip=?, work_state=?,
      filing_status=?, step2_checkbox=?, step3_children=?, step3_other=?,
      step4a=?, step4b=?, step4c=?,
      pay_type=?, hourly_rate=?, annual_salary=?, pay_frequency=?,
      hire_date=?, is_active=?,
      first_pay_period_start=?, first_pay_period_end=?, pay_group_id=?
    WHERE id = ?
  `).run(
    firstName  || e.first_name, lastName || e.last_name,
    ssn ? encrypt(ssn) : e.ssn_encrypted,
    address ?? e.address, city ?? e.city, state || e.state, zip ?? e.zip,
    workState !== undefined ? (workState ? workState.toUpperCase() : null) : e.work_state,
    filingStatus || e.filing_status,
    step2Checkbox !== undefined ? (step2Checkbox ? 1 : 0) : e.step2_checkbox,
    step3Children !== undefined ? parseInt(step3Children) : e.step3_children,
    step3Other    !== undefined ? parseInt(step3Other)    : e.step3_other,
    step4a !== undefined ? parseFloat(step4a) : e.step4a,
    step4b !== undefined ? parseFloat(step4b) : e.step4b,
    step4c !== undefined ? parseFloat(step4c) : e.step4c,
    payType || e.pay_type, hourlyRate !== undefined ? parseFloat(hourlyRate) : e.hourly_rate,
    annualSalary !== undefined ? parseFloat(annualSalary) : e.annual_salary,
    payFrequency || e.pay_frequency, hireDate ?? e.hire_date,
    isActive !== undefined ? (isActive ? 1 : 0) : e.is_active,
    firstPayPeriodStart !== undefined ? (firstPayPeriodStart || null) : e.first_pay_period_start,
    firstPayPeriodEnd   !== undefined ? (firstPayPeriodEnd   || null) : e.first_pay_period_end,
    payGroupId !== undefined ? (payGroupId ? parseInt(payGroupId) : null) : e.pay_group_id,
    req.params.id,
  );
  const updated = db.prepare(`
    SELECT e.*, pg.name AS pay_group_name, pg.frequency AS pay_group_frequency,
           pg.first_pay_period_start AS pay_group_first_start,
           pg.first_pay_period_end   AS pay_group_first_end
    FROM employees e LEFT JOIN pay_groups pg ON e.pay_group_id = pg.id
    WHERE e.id = ?
  `).get(req.params.id);
  res.json(sanitize(updated));
});

// DELETE /api/employees/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const e = db.prepare('SELECT e.id FROM employees e JOIN clients c ON e.client_id = c.id WHERE e.id = ? AND c.user_id = ?').get(req.params.id, req.user.id);
  if (!e) return res.status(404).json({ error: 'Employee not found' });
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ message: 'Employee deleted' });
});

module.exports = router;
