// ── Employee Pay Items ────────────────────────────────────────────────────────
// Per-employee payroll item setup, QuickBooks-style. Earning rates are named
// extra hourly rates (quick-picks when entering hours on a check). Default
// items pre-fill the six per-check amounts (reportedTips/bonus/commission/
// reimbursement/deduction/garnishment) on every new check — an explicit
// per-check value always wins. A default's optional annual limit caps what
// future checks receive at the remainder of the employee's calendar-year YTD.
// Mounted at /api — routes carry full /employees/... and /clients/... paths.
const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const r2 = (n) => Math.round((n || 0) * 100) / 100;

const ITEM_TYPES = ['reportedTips', 'bonus', 'commission', 'reimbursement', 'deduction', 'garnishment'];
const ITEM_COLUMNS = {
  reportedTips:  'reported_tips',
  bonus:         'bonus',
  commission:    'commission',
  reimbursement: 'reimbursement',
  deduction:     'deduction',
  garnishment:   'garnishment',
};

function employeeClient(db, employeeId) {
  return db.prepare('SELECT client_id FROM employees WHERE id = ?').get(employeeId)?.client_id;
}

// This calendar year's total for one item — voided checks excluded, year taken
// from the stub's settlement date.
function ytdUsedFor(db, employeeId, itemType, year) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(${ITEM_COLUMNS[itemType]}), 0) AS total FROM paystubs
    WHERE employee_id = ? AND check_status != 'voided'
      AND COALESCE(settlement_date, pay_period_end) LIKE ?
  `).get(employeeId, `${year}-%`);
  return r2(row.total);
}

function effectiveNext(amount, annualLimit, ytdUsed) {
  return annualLimit == null ? r2(amount) : Math.max(0, Math.min(r2(amount), r2(annualLimit - ytdUsed)));
}

function defaultItemJson(db, row, ytdUsedOverride) {
  const year = new Date().getFullYear();
  const ytdUsed = ytdUsedOverride !== undefined ? ytdUsedOverride : ytdUsedFor(db, row.employee_id, row.item_type, year);
  return {
    id: row.id,
    itemType: row.item_type,
    amount: row.amount,
    annualLimit: row.annual_limit,
    ytdUsed,
    effectiveNext: effectiveNext(row.amount, row.annual_limit, ytdUsed),
  };
}

function payItemsForEmployee(db, employeeId) {
  const rates = db.prepare('SELECT * FROM employee_earning_rates WHERE employee_id = ? ORDER BY id').all(employeeId);
  const defaults = db.prepare('SELECT * FROM employee_default_items WHERE employee_id = ? ORDER BY id').all(employeeId);
  return {
    earningRates: rates.map(r => ({ id: r.id, name: r.name, hourlyRate: r.hourly_rate })),
    defaultItems: defaults.map(d => defaultItemJson(db, d)),
  };
}

// ── GET /api/employees/:empId/pay-items — rates + defaults for one employee ───
router.get('/employees/:empId/pay-items', (req, res) => {
  const db = getDb();
  const clientId = employeeClient(db, req.params.empId);
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Employee not found' });
  res.json(payItemsForEmployee(db, req.params.empId));
});

// ── POST /api/employees/:empId/earning-rates ──────────────────────────────────
router.post('/employees/:empId/earning-rates', (req, res) => {
  const db = getDb();
  const clientId = employeeClient(db, req.params.empId);
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Employee not found' });
  const { name, hourlyRate } = req.body;
  const trimmed = name != null ? String(name).trim() : '';
  if (!trimmed || trimmed.length > 60) return res.status(400).json({ error: 'Rate name must be 1-60 characters' });
  const rate = r2(parseFloat(hourlyRate));
  if (!(rate > 0) || rate > 10000) return res.status(400).json({ error: 'Hourly rate must be greater than $0 and no more than $10,000' });
  const r = db.prepare('INSERT INTO employee_earning_rates (employee_id, name, hourly_rate) VALUES (?,?,?)')
    .run(req.params.empId, trimmed, rate);
  const row = db.prepare('SELECT * FROM employee_earning_rates WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json({ id: row.id, name: row.name, hourlyRate: row.hourly_rate });
});

// ── DELETE /api/employees/:empId/earning-rates/:rateId ────────────────────────
router.delete('/employees/:empId/earning-rates/:rateId', (req, res) => {
  const db = getDb();
  const clientId = employeeClient(db, req.params.empId);
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Employee not found' });
  const row = db.prepare('SELECT * FROM employee_earning_rates WHERE id = ? AND employee_id = ?')
    .get(req.params.rateId, req.params.empId);
  if (!row) return res.status(404).json({ error: 'Rate not found' });
  db.prepare('DELETE FROM employee_earning_rates WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ── PUT /api/employees/:empId/default-items — upsert by itemType ──────────────
router.put('/employees/:empId/default-items', (req, res) => {
  const db = getDb();
  const clientId = employeeClient(db, req.params.empId);
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Employee not found' });
  const { itemType, amount, annualLimit } = req.body;
  if (!ITEM_TYPES.includes(itemType)) return res.status(400).json({ error: 'Unknown item type' });
  const amt = r2(parseFloat(amount));
  if (!(amt >= 0) || amt > 1000000) return res.status(400).json({ error: 'Amount must be between $0 and $1,000,000' });
  let limit = null;
  if (annualLimit != null && annualLimit !== '') {
    limit = r2(parseFloat(annualLimit));
    if (!(limit > 0)) return res.status(400).json({ error: 'Annual limit must be greater than $0 (leave it blank for no limit)' });
  }
  db.prepare(`
    INSERT INTO employee_default_items (employee_id, item_type, amount, annual_limit)
    VALUES (?,?,?,?)
    ON CONFLICT(employee_id, item_type) DO UPDATE SET amount = excluded.amount, annual_limit = excluded.annual_limit
  `).run(req.params.empId, itemType, amt, limit);
  const row = db.prepare('SELECT * FROM employee_default_items WHERE employee_id = ? AND item_type = ?')
    .get(req.params.empId, itemType);
  res.json(defaultItemJson(db, row));
});

// ── DELETE /api/employees/:empId/default-items/:itemType ──────────────────────
router.delete('/employees/:empId/default-items/:itemType', (req, res) => {
  const db = getDb();
  const clientId = employeeClient(db, req.params.empId);
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Employee not found' });
  if (!ITEM_TYPES.includes(req.params.itemType)) return res.status(400).json({ error: 'Unknown item type' });
  db.prepare('DELETE FROM employee_default_items WHERE employee_id = ? AND item_type = ?')
    .run(req.params.empId, req.params.itemType);
  res.json({ ok: true });
});

// ── GET /api/clients/:clientId/employee-pay-items — whole-company map ─────────
router.get('/clients/:clientId/employee-pay-items', (req, res) => {
  const db = getDb();
  const clientId = req.params.clientId;
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Client not found' });
  const rates = db.prepare(`
    SELECT r.* FROM employee_earning_rates r JOIN employees e ON e.id = r.employee_id
    WHERE e.client_id = ? ORDER BY r.id
  `).all(clientId);
  const defaults = db.prepare(`
    SELECT d.* FROM employee_default_items d JOIN employees e ON e.id = d.employee_id
    WHERE e.client_id = ? ORDER BY d.id
  `).all(clientId);
  const out = {};
  const entry = (empId) => {
    if (!out[empId]) out[empId] = { earningRates: [], defaultItems: [] };
    return out[empId];
  };
  for (const r of rates) entry(r.employee_id).earningRates.push({ id: r.id, name: r.name, hourlyRate: r.hourly_rate });
  // One grouped YTD query for the whole company instead of a SUM per default row.
  const year = new Date().getFullYear();
  const sums = defaults.length ? db.prepare(`
    SELECT employee_id,
      COALESCE(SUM(reported_tips), 0) AS reportedTips,
      COALESCE(SUM(bonus),         0) AS bonus,
      COALESCE(SUM(commission),    0) AS commission,
      COALESCE(SUM(reimbursement), 0) AS reimbursement,
      COALESCE(SUM(deduction),     0) AS deduction,
      COALESCE(SUM(garnishment),   0) AS garnishment
    FROM paystubs
    WHERE check_status != 'voided'
      AND COALESCE(settlement_date, pay_period_end) LIKE ?
      AND employee_id IN (SELECT id FROM employees WHERE client_id = ?)
    GROUP BY employee_id
  `).all(`${year}-%`, clientId) : [];
  const sumsByEmp = Object.fromEntries(sums.map(x => [x.employee_id, x]));
  for (const d of defaults) {
    const ytdUsed = r2((sumsByEmp[d.employee_id] || {})[d.item_type] || 0);
    entry(d.employee_id).defaultItems.push(defaultItemJson(db, d, ytdUsed));
  }
  res.json(out);
});

module.exports = router;
