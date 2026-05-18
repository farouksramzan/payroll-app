'use strict';
const express     = require('express');
const { getDb }   = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function sanitizeGroup(g) {
  return {
    id: g.id,
    clientId: g.client_id,
    name: g.name,
    frequency: g.frequency,
    firstPayPeriodStart: g.first_pay_period_start || null,
    firstPayPeriodEnd:   g.first_pay_period_end   || null,
    createdAt: g.created_at,
  };
}

// GET /api/pay-groups?clientId=X
router.get('/', (req, res) => {
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const db = getDb();
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const groups = db.prepare('SELECT * FROM pay_groups WHERE client_id = ? ORDER BY name ASC').all(clientId);
  res.json(groups.map(sanitizeGroup));
});

// GET /api/pay-groups/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const g = db.prepare(`
    SELECT pg.* FROM pay_groups pg
    JOIN clients c ON pg.client_id = c.id
    WHERE pg.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!g) return res.status(404).json({ error: 'Pay group not found' });
  res.json(sanitizeGroup(g));
});

// GET /api/pay-groups/:id/employees
router.get('/:id/employees', (req, res) => {
  const db = getDb();
  const g = db.prepare(`
    SELECT pg.* FROM pay_groups pg
    JOIN clients c ON pg.client_id = c.id
    WHERE pg.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!g) return res.status(404).json({ error: 'Pay group not found' });
  const employees = db.prepare(`
    SELECT id, first_name, last_name, pay_type, pay_group_id, is_active
    FROM employees WHERE pay_group_id = ?
    ORDER BY last_name, first_name
  `).all(g.id);
  res.json(employees.map(e => ({
    id: e.id, firstName: e.first_name, lastName: e.last_name,
    payType: e.pay_type, payGroupId: e.pay_group_id, isActive: !!e.is_active,
  })));
});

// POST /api/pay-groups
router.post('/', (req, res) => {
  const { clientId, name, frequency, firstPayPeriodStart, firstPayPeriodEnd } = req.body;
  if (!clientId || !name) return res.status(400).json({ error: 'clientId and name required' });
  const db = getDb();
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const result = db.prepare(`
    INSERT INTO pay_groups (client_id, name, frequency, first_pay_period_start, first_pay_period_end)
    VALUES (?, ?, ?, ?, ?)
  `).run(clientId, name.trim(), frequency || 'biweekly', firstPayPeriodStart || null, firstPayPeriodEnd || null);
  res.status(201).json(sanitizeGroup(db.prepare('SELECT * FROM pay_groups WHERE id = ?').get(result.lastInsertRowid)));
});

// PUT /api/pay-groups/:id
router.put('/:id', (req, res) => {
  const { name, frequency, firstPayPeriodStart, firstPayPeriodEnd } = req.body;
  const db = getDb();
  const g = db.prepare(`
    SELECT pg.* FROM pay_groups pg
    JOIN clients c ON pg.client_id = c.id
    WHERE pg.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!g) return res.status(404).json({ error: 'Pay group not found' });
  db.prepare(`
    UPDATE pay_groups SET name = ?, frequency = ?, first_pay_period_start = ?, first_pay_period_end = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : g.name,
    frequency || g.frequency,
    firstPayPeriodStart !== undefined ? (firstPayPeriodStart || null) : g.first_pay_period_start,
    firstPayPeriodEnd   !== undefined ? (firstPayPeriodEnd   || null) : g.first_pay_period_end,
    g.id,
  );
  res.json(sanitizeGroup(db.prepare('SELECT * FROM pay_groups WHERE id = ?').get(g.id)));
});

// DELETE /api/pay-groups/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const g = db.prepare(`
    SELECT pg.* FROM pay_groups pg
    JOIN clients c ON pg.client_id = c.id
    WHERE pg.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!g) return res.status(404).json({ error: 'Pay group not found' });
  const empCount = db.prepare('SELECT COUNT(*) as n FROM employees WHERE pay_group_id = ?').get(g.id).n;
  if (empCount > 0) return res.status(400).json({ error: `Cannot delete — ${empCount} employee(s) still assigned to this group` });
  db.prepare('DELETE FROM pay_groups WHERE id = ?').run(g.id);
  res.json({ message: 'Pay group deleted' });
});

module.exports = router;
