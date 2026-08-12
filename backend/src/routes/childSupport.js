// ── Child Support ─────────────────────────────────────────────────────────────
// Orders (recurring per-employee withholding instructions) and withholdings
// (per-paycheck amounts actually withheld). Withholdings power the Pay
// Liabilities "Child Support" section: pending rows group by vendor + pay date,
// due 7 days after the pay date; paying cuts a printable vendor check using the
// company's next check number.
const express = require('express');
const PDFDocument = require('pdfkit');
const { getDb } = require('../database/db');
const { requireAuth, requireAdmin, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const r2 = (n) => Math.round((n || 0) * 100) / 100;

function employeeClient(db, employeeId) {
  return db.prepare('SELECT client_id FROM employees WHERE id = ?').get(employeeId)?.client_id;
}

// ── GET /api/child-support/orders?clientId= — all orders for a company ────────
router.get('/orders', (req, res) => {
  const db = getDb();
  const clientId = req.query.clientId;
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Client not found' });
  const rows = db.prepare(`
    SELECT o.*, e.first_name || ' ' || e.last_name AS employee_name
    FROM child_support_orders o JOIN employees e ON e.id = o.employee_id
    WHERE e.client_id = ? ORDER BY e.last_name, o.id
  `).all(clientId);
  res.json(rows);
});

// ── GET /api/child-support/orders/employee/:employeeId ────────────────────────
router.get('/orders/employee/:employeeId', (req, res) => {
  const db = getDb();
  const clientId = employeeClient(db, req.params.employeeId);
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Employee not found' });
  res.json(db.prepare('SELECT * FROM child_support_orders WHERE employee_id = ? ORDER BY id').all(req.params.employeeId));
});

// ── POST /api/child-support/orders ────────────────────────────────────────────
router.post('/orders', (req, res) => {
  const db = getDb();
  const { employeeId, vendorName, caseNumber, amount } = req.body;
  const clientId = employeeClient(db, employeeId);
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Employee not found' });
  if (!vendorName || !String(vendorName).trim()) return res.status(400).json({ error: 'Vendor name is required (who the check is made out to)' });
  const amt = r2(parseFloat(amount));
  if (!(amt > 0)) return res.status(400).json({ error: 'Amount per paycheck must be greater than $0' });
  const r = db.prepare('INSERT INTO child_support_orders (employee_id, vendor_name, case_number, amount) VALUES (?,?,?,?)')
    .run(employeeId, String(vendorName).trim(), caseNumber ? String(caseNumber).trim() : null, amt);
  res.status(201).json(db.prepare('SELECT * FROM child_support_orders WHERE id = ?').get(r.lastInsertRowid));
});

// ── PUT /api/child-support/orders/:id ─────────────────────────────────────────
router.put('/orders/:id', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM child_support_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const clientId = employeeClient(db, order.employee_id);
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Order not found' });
  const { vendorName, caseNumber, amount, active } = req.body;
  const amt = amount !== undefined ? r2(parseFloat(amount)) : order.amount;
  if (amount !== undefined && !(amt > 0)) return res.status(400).json({ error: 'Amount per paycheck must be greater than $0' });
  db.prepare('UPDATE child_support_orders SET vendor_name = ?, case_number = ?, amount = ?, active = ? WHERE id = ?').run(
    vendorName !== undefined ? String(vendorName).trim() : order.vendor_name,
    caseNumber !== undefined ? (caseNumber ? String(caseNumber).trim() : null) : order.case_number,
    amt,
    active !== undefined ? (active ? 1 : 0) : order.active,
    order.id,
  );
  res.json(db.prepare('SELECT * FROM child_support_orders WHERE id = ?').get(order.id));
});

// ── DELETE /api/child-support/orders/:id ──────────────────────────────────────
// Past withholdings keep their own vendor/case copy, so deleting an order never
// touches history.
router.delete('/orders/:id', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM child_support_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const clientId = employeeClient(db, order.employee_id);
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Order not found' });
  db.prepare('DELETE FROM child_support_orders WHERE id = ?').run(order.id);
  res.json({ ok: true });
});

// ── GET /api/child-support/withholdings?clientId= ─────────────────────────────
// Joined with the paycheck so the frontend can group by vendor + pay date and
// only count withholdings whose check was actually issued.
router.get('/withholdings', (req, res) => {
  const db = getDb();
  const clientId = req.query.clientId;
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Client not found' });
  const rows = db.prepare(`
    SELECT w.*, p.settlement_date, p.pay_period_end, p.check_status, p.employee_name
    FROM child_support_withholdings w JOIN paystubs p ON p.id = w.paystub_id
    WHERE w.client_id = ? ORDER BY COALESCE(p.settlement_date, p.pay_period_end), w.vendor_name
  `).all(clientId);
  res.json(rows);
});

// Shared: load + validate a set of withholdings for pay/unpay/print.
function loadWithholdings(db, clientId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { error: 'withholdingIds required' };
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT w.*, p.settlement_date, p.pay_period_end, p.employee_name, p.check_status
    FROM child_support_withholdings w JOIN paystubs p ON p.id = w.paystub_id
    WHERE w.id IN (${placeholders}) AND w.client_id = ?
  `).all(...ids, clientId);
  if (rows.length !== ids.length) return { error: 'Some withholdings were not found (the paycheck may have been deleted). Refresh and try again.' };
  return { rows };
}

// ── POST /api/child-support/pay — mark submitted, optionally assigning a check
// number. { clientId, withholdingIds, assignCheckNumber } — admin only.
router.post('/pay', requireAdmin, (req, res) => {
  const db = getDb();
  const { clientId, withholdingIds, assignCheckNumber } = req.body;
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Client not found' });
  const { rows, error } = loadWithholdings(db, clientId, withholdingIds);
  if (error) return res.status(400).json({ error });
  // All-or-nothing: paying a silently-reduced subset would print a check whose
  // amount doesn't match what the caller showed the user.
  const notPending = rows.filter(w => w.status !== 'pending');
  if (notPending.length > 0) {
    return res.status(409).json({ error: 'Some of these withholdings were already paid or cancelled (possibly in another tab). Refresh and try again.' });
  }
  // Only withholdings on ISSUED paychecks are payable — a voided or still-draft
  // check hasn't actually withheld anything yet.
  const ISSUED = new Set(['printed', 'deposited', 'direct_deposit_sent', 'direct_deposit_cleared']);
  const notIssued = rows.filter(w => !ISSUED.has(w.check_status));
  if (notIssued.length > 0) {
    return res.status(409).json({ error: 'Some paychecks behind these withholdings are voided or not yet printed/deposited. Refresh and try again.' });
  }
  const pending = rows;
  const vendors = [...new Set(pending.map(w => w.vendor_name))];
  if (vendors.length > 1) return res.status(400).json({ error: 'One payment covers one vendor — these rows span multiple vendors.' });

  let checkNumber = null;
  db.transaction(() => {
    if (assignCheckNumber) {
      checkNumber = db.prepare('SELECT next_check_number FROM clients WHERE id = ?').get(clientId).next_check_number || 1001;
      db.prepare('UPDATE clients SET next_check_number = next_check_number + 1 WHERE id = ?').run(clientId);
    }
    const mark = db.prepare(`UPDATE child_support_withholdings SET status = 'submitted', check_number = ?, paid_at = datetime('now') WHERE id = ?`);
    for (const w of pending) mark.run(checkNumber, w.id);
  })();

  res.json({
    ok: true, checkNumber, vendor: vendors[0],
    amount: r2(pending.reduce((s, w) => s + w.amount, 0)),
    count: pending.length,
    withholdingIds: pending.map(w => w.id),
  });
});

// ── POST /api/child-support/unpay — Undo back to pending. Admin only. ─────────
router.post('/unpay', requireAdmin, (req, res) => {
  const db = getDb();
  const { clientId, withholdingIds } = req.body;
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Client not found' });
  const { rows, error } = loadWithholdings(db, clientId, withholdingIds);
  if (error) return res.status(400).json({ error });
  const upd = db.prepare(`UPDATE child_support_withholdings SET status = 'pending', check_number = NULL, paid_at = NULL WHERE id = ?`);
  const tx = db.transaction(() => { for (const w of rows) upd.run(w.id); });
  tx();
  res.json({ ok: true, count: rows.length });
});

// ── POST /api/child-support/print-check — vendor check PDF. Admin only. ───────
// Prints for both pending and already-submitted rows (reprint) — payment state
// is changed only by /pay, never by printing.
router.post('/print-check', requireAdmin, (req, res) => {
  const db = getDb();
  const { clientId, withholdingIds, checkNumber } = req.body;
  if (!clientId || !canAccessClient(db, clientId, req.user)) return res.status(404).json({ error: 'Client not found' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  const { rows, error } = loadWithholdings(db, clientId, withholdingIds);
  if (error) return res.status(400).json({ error });
  const vendors = [...new Set(rows.map(w => w.vendor_name))];
  if (vendors.length > 1) return res.status(400).json({ error: 'One check covers one vendor — these rows span multiple vendors.' });

  const vendor = vendors[0];
  const amount = r2(rows.reduce((s, w) => s + w.amount, 0));
  const checkNum = checkNumber || rows.find(w => w.check_number)?.check_number || null;
  const payDate = new Date().toISOString().slice(0, 10);
  const caseNumbers = [...new Set(rows.map(w => w.case_number).filter(Boolean))];

  const DARK = '#111827', GRAY = '#6b7280', BORDER = '#d1d5db';
  const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=child-support-${vendor.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}${checkNum ? `-${checkNum}` : ''}.pdf`);
  doc.pipe(res);

  const ML = 40, TW = 612 - ML * 2;

  // ── Check (top third, classic layout mirrored from the paycheck renderer) ──
  const CY = 40, CX = ML, CW = TW;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(client.business_name, CX, CY);
  doc.font('Helvetica').fontSize(8).fillColor(GRAY);
  if (client.business_address) doc.text(client.business_address, CX, CY + 13);
  const companyCity = [client.business_city, client.state, client.business_zip].filter(Boolean).join(', ');
  if (companyCity) doc.text(companyCity, CX, client.business_address ? CY + 23 : CY + 13);
  if (client.bank_name) doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(client.bank_name, CX, CY + 36);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(checkNum ? `#${checkNum}` : '', CX, CY, { width: CW, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Date:', CX + CW - 180, CY + 13).font('Helvetica-Bold').fillColor(DARK).text(payDate, CX + CW - 150, CY + 13);

  let cy = CY + 56;
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('PAY TO THE ORDER OF', CX, cy); cy += 12;
  doc.rect(CX, cy, CW - 120, 22).stroke(BORDER);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(vendor, CX + 6, cy + 6, { width: CW - 130 });
  doc.rect(CX + CW - 114, cy, 114, 22).fill('#f8fafc').stroke(BORDER);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(`$${amount.toFixed(2)}`, CX + CW - 110, cy + 5, { width: 106, align: 'right' });
  cy += 30;
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('AMOUNT:', CX, cy); cy += 10;
  doc.rect(CX, cy, CW, 18).stroke(BORDER);
  doc.font('Helvetica').fontSize(8.5).fillColor(DARK).text(numberToWords(amount) + ' ****', CX + 6, cy + 4, { width: CW - 12 }); cy += 28;
  const memo = `Child support${caseNumbers.length ? ` — Case ${caseNumbers.join(', ')}` : ''}`;
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('MEMO:', CX, cy);
  doc.fillColor(DARK).text(memo, CX + 36, cy, { width: CW - 240 });
  doc.rect(CX + CW - 160, cy + 20, 160, 1).fill(DARK);
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text('Authorized Signature', CX + CW - 160, cy + 24, { width: 160, align: 'center' });
  doc.rect(CX - 4, CY - 8, CW + 8, 220).stroke(BORDER);

  // ── Remittance stub: which employees/cases this check covers ──
  let y = CY + 240;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text('Remittance detail', ML, y); y += 16;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY);
  doc.text('EMPLOYEE', ML, y, { width: 160 }).text('CASE #', ML + 170, y, { width: 140 })
    .text('PAY DATE', ML + 320, y, { width: 90 }).text('AMOUNT', ML, y, { width: TW, align: 'right' });
  y += 12; doc.rect(ML, y, TW, 1).fill(BORDER); y += 6;
  doc.font('Helvetica').fontSize(8.5).fillColor(DARK);
  for (const w of rows) {
    doc.text(w.employee_name || '—', ML, y, { width: 160 })
      .text(w.case_number || '—', ML + 170, y, { width: 140 })
      .text(w.settlement_date || w.pay_period_end || '—', ML + 320, y, { width: 90 })
      .text(`$${r2(w.amount).toFixed(2)}`, ML, y, { width: TW, align: 'right' });
    y += 14;
  }
  y += 4; doc.rect(ML, y, TW, 1).fill(BORDER); y += 6;
  doc.font('Helvetica-Bold').fontSize(9).text('TOTAL', ML, y).text(`$${amount.toFixed(2)}`, ML, y, { width: TW, align: 'right' });

  doc.end();
});

// Local copy of the paycheck renderer's number-to-words (module-private there).
function numberToWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function words(n) {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + words(n % 100) : '');
    if (n < 1000000) return words(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + words(n % 1000) : '');
    return words(Math.floor(n / 1000000)) + ' Million' + (n % 1000000 ? ' ' + words(n % 1000000) : '');
  }
  const dollars = Math.floor(amount);
  const cents = Math.round((amount - dollars) * 100);
  return `${dollars === 0 ? 'Zero' : words(dollars)} and ${String(cents).padStart(2, '0')}/100 Dollars`;
}

module.exports = router;
