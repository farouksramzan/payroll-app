'use strict';

const express      = require('express');
const PDFDocument  = require('pdfkit');
const { getDb }    = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { decrypt }  = require('../services/cryptoService');
const { calculateWithholding, getTaxPeriod } = require('../services/taxCalculator');
const { submitToEFTPS } = require('../services/eftpsAutomation');
const bridgeManager = require('../ws/bridge');

const router = express.Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

function attachLineItems(db, stubs) {
  const attach = (s) => {
    const items = db.prepare('SELECT * FROM paystub_line_items WHERE paystub_id = ?').all(s.id);
    return { ...s, lineItems: items };
  };
  return Array.isArray(stubs) ? stubs.map(attach) : attach(stubs);
}

function fmtCurrency(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

// ── GET /api/paystubs?clientId=X ──────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const rows = db.prepare(`
    SELECT p.*, e.first_name, e.last_name
    FROM paystubs p
    LEFT JOIN employees e ON p.employee_id = e.id
    WHERE p.client_id = ?
    ORDER BY p.created_at DESC
  `).all(clientId);

  res.json(attachLineItems(db, rows));
});

// ── GET /api/paystubs/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const stub = db.prepare(`
    SELECT p.*, c.business_name, c.ein, e.first_name, e.last_name,
           e.address, e.city, e.state AS emp_state, e.zip
    FROM paystubs p
    JOIN clients c ON p.client_id = c.id
    LEFT JOIN employees e ON p.employee_id = e.id
    WHERE p.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!stub) return res.status(404).json({ error: 'Paystub not found' });
  res.json(attachLineItems(db, stub));
});

// ── POST /api/paystubs — create (Save as Paystub) ────────────────────────────
router.post('/', (req, res) => {
  const {
    clientId, employeeId,
    payPeriodStart, payPeriodEnd, settlementDate, payFrequency,
    filingStatus, step2Checkbox, step3Children, step3Other,
    step4a, step4b, step4c,
    lineItems, grossWages,
    workState, ytdGross,
    notes,
  } = req.body;

  if (!clientId || !payPeriodStart || !payPeriodEnd || !payFrequency) {
    return res.status(400).json({ error: 'clientId, payPeriodStart, payPeriodEnd, payFrequency required' });
  }

  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const items = Array.isArray(lineItems) && lineItems.length > 0 ? lineItems : null;
  const computedGross = items
    ? items.reduce((s, li) => s + parseFloat(li.amount || 0), 0)
    : parseFloat(grossWages || 0);
  if (!computedGross || computedGross <= 0) {
    return res.status(400).json({ error: 'Gross wages must be greater than 0' });
  }

  // Resolve work state
  let effectiveWorkState = workState;
  if (!effectiveWorkState && employeeId) {
    const emp = db.prepare('SELECT work_state, state FROM employees WHERE id = ?').get(employeeId);
    effectiveWorkState = emp?.work_state || emp?.state;
  }
  if (!effectiveWorkState) effectiveWorkState = client.state || 'TX';
  effectiveWorkState = effectiveWorkState.toUpperCase();

  const { quarter, year } = getTaxPeriod(payPeriodEnd);
  const ytdBefore = parseFloat(ytdGross || 0);

  const taxes = calculateWithholding({
    grossWages: computedGross,
    payFrequency,
    filingStatus: filingStatus || 'single',
    step2Checkbox: !!step2Checkbox,
    step3Children: parseInt(step3Children || 0, 10),
    step3Other:    parseInt(step3Other    || 0, 10),
    step4a: parseFloat(step4a || 0),
    step4b: parseFloat(step4b || 0),
    step4c: parseFloat(step4c || 0),
    workState:  effectiveWorkState,
    ytdGross:   ytdBefore,
    sutaRate:   client.suta_rate || null,
  });

  const step3Credits = (parseInt(step3Children || 0, 10) * 2200) + (parseInt(step3Other || 0, 10) * 500);

  // Resolve employee name snapshot
  let employeeName = null;
  if (employeeId) {
    const emp = db.prepare('SELECT first_name, last_name FROM employees WHERE id = ?').get(employeeId);
    if (emp) employeeName = `${emp.first_name} ${emp.last_name}`;
  }

  const result = db.prepare(`
    INSERT INTO paystubs (
      client_id, employee_id, employee_name,
      pay_period_start, pay_period_end, settlement_date, pay_frequency,
      filing_status, step2_checkbox, step3_credits, work_state,
      gross_wages, fit_withholding, employee_ss, employee_medicare,
      additional_medicare, employer_ss, employer_medicare,
      state_income_tax, futa_tax, suta_tax,
      total_deposit, net_pay, ytd_wages_before,
      tax_year, tax_quarter, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    clientId, employeeId || null, employeeName,
    payPeriodStart, payPeriodEnd, settlementDate || null, payFrequency,
    filingStatus || 'single', step2Checkbox ? 1 : 0, step3Credits, effectiveWorkState,
    taxes.grossWages, taxes.fitWithholding, taxes.employeeSS, taxes.employeeMedicare,
    taxes.additionalMedicare || 0, taxes.employerSS, taxes.employerMedicare,
    taxes.stateIncomeTax, taxes.futaTax, taxes.sutaTax,
    taxes.totalDeposit, taxes.netPay, ytdBefore,
    year, quarter, notes || null,
  );

  const stubId = result.lastInsertRowid;

  if (items) {
    const insertItem = db.prepare(`
      INSERT INTO paystub_line_items (paystub_id, pay_type, description, hours, rate, amount)
      VALUES (?,?,?,?,?,?)
    `);
    for (const li of items) {
      insertItem.run(
        stubId,
        li.payType || 'regular',
        li.description || null,
        li.hours ? parseFloat(li.hours) : null,
        li.rate  ? parseFloat(li.rate)  : null,
        parseFloat(li.amount || 0),
      );
    }
  }

  // Update YTD tracking
  if (employeeId) {
    db.prepare(`
      INSERT INTO employee_ytd_wages (employee_id, tax_year, ytd_gross, ytd_ss_wages, ytd_futa_wages, ytd_suta_wages)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(employee_id, tax_year) DO UPDATE SET
        ytd_gross      = ytd_gross      + excluded.ytd_gross,
        ytd_ss_wages   = ytd_ss_wages   + excluded.ytd_ss_wages,
        ytd_futa_wages = ytd_futa_wages + excluded.ytd_futa_wages,
        ytd_suta_wages = ytd_suta_wages + excluded.ytd_suta_wages,
        updated_at     = CURRENT_TIMESTAMP
    `).run(
      employeeId, year,
      computedGross,
      taxes.ssWagesThisPeriod,
      taxes.futaTaxable,
      taxes.sutaTaxable,
    );
  }

  const stub = db.prepare('SELECT * FROM paystubs WHERE id = ?').get(stubId);
  const lineItemsOut = db.prepare('SELECT * FROM paystub_line_items WHERE paystub_id = ?').all(stubId);
  res.status(201).json({ ...stub, lineItems: lineItemsOut });
});

// ── DELETE /api/paystubs/:id ──────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const stub = db.prepare(`
    SELECT p.id, p.status FROM paystubs p
    JOIN clients c ON p.client_id = c.id
    WHERE p.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!stub) return res.status(404).json({ error: 'Paystub not found' });
  if (stub.status === 'submitted') return res.status(400).json({ error: 'Cannot delete a submitted paystub' });
  db.prepare('DELETE FROM paystubs WHERE id = ?').run(stub.id);
  res.json({ message: 'Paystub deleted' });
});

// ── POST /api/paystubs/:id/submit — submit single paystub to EFTPS ────────────
router.post('/:id/submit', async (req, res) => {
  const db = getDb();
  const stub = db.prepare(`
    SELECT p.*, c.ein, c.business_name, c.batch_provider_pin_encrypted,
           c.eftps_internet_password_encrypted, c.eftps_enrollment_number,
           c.deposit_schedule, c.bank_account_number_encrypted,
           c.bank_routing_number, c.bank_account_type
    FROM paystubs p
    JOIN clients c ON p.client_id = c.id
    WHERE p.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);

  if (!stub) return res.status(404).json({ error: 'Paystub not found' });
  if (stub.status === 'submitted') return res.status(400).json({ error: 'Already submitted' });

  const pin = decrypt(stub.batch_provider_pin_encrypted);
  if (!pin) return res.status(400).json({ error: 'Batch Provider PIN not configured' });

  db.prepare("UPDATE paystubs SET status = 'processing' WHERE id = ?").run(stub.id);

  try {
    let result;

    if (bridgeManager.isConnected) {
      const accountNumber = stub.bank_account_number_encrypted
        ? decrypt(stub.bank_account_number_encrypted) : null;
      if (!stub.settlement_date) {
        db.prepare("UPDATE paystubs SET status = 'pending' WHERE id = ?").run(stub.id);
        return res.status(400).json({ error: 'Settlement date is required for ACH bridge submission' });
      }
      result = await bridgeManager.sendJob({
        submissionId:   stub.id,
        ein:            stub.ein,
        pin,
        businessName:   stub.business_name,
        routingNumber:  stub.bank_routing_number,
        accountNumber,
        accountType:    stub.bank_account_type || 'checking',
        taxYear:        stub.tax_year,
        taxQuarter:     stub.tax_quarter,
        settlementDate: stub.settlement_date,
        taxData:        { totalDeposit: stub.total_deposit },
      });
    } else {
      const internetPassword = stub.eftps_internet_password_encrypted
        ? decrypt(stub.eftps_internet_password_encrypted) : null;
      result = await submitToEFTPS({
        ein:             stub.ein,
        pin,
        internetPassword,
        enrollmentNumber: stub.eftps_enrollment_number || null,
        payPeriodEnd:    stub.pay_period_end,
        settlementDate:  stub.settlement_date || null,
        taxYear:         stub.tax_year,
        taxQuarter:      stub.tax_quarter,
        taxData: {
          fitWithholding:   stub.fit_withholding,
          employeeSS:       stub.employee_ss,
          employeeMedicare: stub.employee_medicare,
          employerSS:       stub.employer_ss,
          employerMedicare: stub.employer_medicare,
        },
      });
    }

    if (result.success) {
      db.prepare(`
        UPDATE paystubs SET
          status = 'submitted',
          eftps_confirmation = ?,
          submitted_at = CURRENT_TIMESTAMP,
          submission_error = NULL
        WHERE id = ?
      `).run(result.confirmation || result.achFilePath || result.message, stub.id);
    } else {
      db.prepare("UPDATE paystubs SET status = 'failed', submission_error = ? WHERE id = ?")
        .run(result.error, stub.id);
    }

    const updated = db.prepare('SELECT * FROM paystubs WHERE id = ?').get(stub.id);
    res.json({ paystub: updated, result });
  } catch (err) {
    db.prepare("UPDATE paystubs SET status = 'failed', submission_error = ? WHERE id = ?")
      .run(err.message, stub.id);
    res.status(500).json({ error: 'Submission error', details: err.message });
  }
});

// ── POST /api/paystubs/batch-submit?clientId=X ───────────────────────────────
router.post('/batch-submit', async (req, res) => {
  const { clientId, paystubIds } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const db = getDb();
  const client = db.prepare(`
    SELECT * FROM clients WHERE id = ? AND user_id = ?
  `).get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const pin = decrypt(client.batch_provider_pin_encrypted);
  if (!pin) return res.status(400).json({ error: 'Batch Provider PIN not configured' });

  // Get pending paystubs (either all or specific IDs)
  let pending;
  if (Array.isArray(paystubIds) && paystubIds.length > 0) {
    const placeholders = paystubIds.map(() => '?').join(',');
    pending = db.prepare(
      `SELECT * FROM paystubs WHERE client_id = ? AND status = 'pending' AND id IN (${placeholders})`
    ).all(clientId, ...paystubIds);
  } else {
    pending = db.prepare(
      "SELECT * FROM paystubs WHERE client_id = ? AND status IN ('pending','failed') ORDER BY pay_period_end ASC"
    ).all(clientId);
  }

  if (pending.length === 0) {
    return res.status(400).json({ error: 'No pending paystubs to submit' });
  }

  // Aggregate total deposit
  const totalDeposit = pending.reduce((sum, p) => sum + p.total_deposit, 0);
  const firstStub    = pending[0];

  // Mark all as processing
  const ids = pending.map((p) => p.id);
  db.prepare(`UPDATE paystubs SET status = 'processing' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);

  try {
    let result;

    if (bridgeManager.isConnected) {
      const accountNumber = client.bank_account_number_encrypted
        ? decrypt(client.bank_account_number_encrypted) : null;
      const settlementDate = pending.find((p) => p.settlement_date)?.settlement_date || null;
      if (!settlementDate) {
        db.prepare(`UPDATE paystubs SET status = 'pending' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
        return res.status(400).json({ error: 'At least one paystub must have a settlement date for ACH batch submission' });
      }
      result = await bridgeManager.sendJob({
        submissionId:   `batch-${Date.now()}`,
        ein:            client.ein,
        pin,
        businessName:   client.business_name,
        routingNumber:  client.bank_routing_number,
        accountNumber,
        accountType:    client.bank_account_type || 'checking',
        taxYear:        firstStub.tax_year,
        taxQuarter:     firstStub.tax_quarter,
        settlementDate,
        taxData:        { totalDeposit: Math.round(totalDeposit * 100) / 100 },
      });
    } else {
      const internetPassword = client.eftps_internet_password_encrypted
        ? decrypt(client.eftps_internet_password_encrypted) : null;
      result = await submitToEFTPS({
        ein:             client.ein,
        pin,
        internetPassword,
        enrollmentNumber: client.eftps_enrollment_number || null,
        payPeriodEnd:    firstStub.pay_period_end,
        settlementDate:  pending.find((p) => p.settlement_date)?.settlement_date || null,
        taxYear:         firstStub.tax_year,
        taxQuarter:      firstStub.tax_quarter,
        taxData: {
          fitWithholding:   pending.reduce((s, p) => s + p.fit_withholding, 0),
          employeeSS:       pending.reduce((s, p) => s + p.employee_ss, 0),
          employeeMedicare: pending.reduce((s, p) => s + p.employee_medicare, 0),
          employerSS:       pending.reduce((s, p) => s + p.employer_ss, 0),
          employerMedicare: pending.reduce((s, p) => s + p.employer_medicare, 0),
        },
      });
    }

    const confirmation = result.confirmation || result.achFilePath || result.message || null;

    if (result.success) {
      db.prepare(`
        UPDATE paystubs SET
          status = 'submitted',
          eftps_confirmation = ?,
          submitted_at = CURRENT_TIMESTAMP,
          submission_error = NULL
        WHERE id IN (${ids.map(() => '?').join(',')})
      `).run(confirmation, ...ids);
    } else {
      db.prepare(`
        UPDATE paystubs SET status = 'failed', submission_error = ?
        WHERE id IN (${ids.map(() => '?').join(',')})
      `).run(result.error, ...ids);
    }

    const updated = db.prepare(`SELECT * FROM paystubs WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    res.json({
      submitted: ids.length,
      totalDeposit: Math.round(totalDeposit * 100) / 100,
      confirmation,
      paystubs: updated,
      result,
    });
  } catch (err) {
    db.prepare(`UPDATE paystubs SET status = 'failed', submission_error = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(err.message, ...ids);
    res.status(500).json({ error: 'Batch submission error', details: err.message });
  }
});

// ── GET /api/paystubs/:id/pdf — generate paystub PDF ─────────────────────────
router.get('/:id/pdf', (req, res) => {
  const db = getDb();
  const stub = db.prepare(`
    SELECT p.*, c.business_name, c.ein, c.state AS client_state,
           e.first_name, e.last_name, e.address, e.city,
           e.state AS emp_state, e.zip
    FROM paystubs p
    JOIN clients c ON p.client_id = c.id
    LEFT JOIN employees e ON p.employee_id = e.id
    WHERE p.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!stub) return res.status(404).json({ error: 'Paystub not found' });

  const lineItems = db.prepare('SELECT * FROM paystub_line_items WHERE paystub_id = ?').all(stub.id);

  // YTD data
  const ytd = stub.employee_id
    ? db.prepare('SELECT * FROM employee_ytd_wages WHERE employee_id = ? AND tax_year = ?')
        .get(stub.employee_id, stub.tax_year)
    : null;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="paystub-${stub.id}-${stub.pay_period_end}.pdf"`);

  generatePaystubPDF(stub, lineItems, ytd, res);
});

// ── PDF Generator ─────────────────────────────────────────────────────────────
function generatePaystubPDF(stub, lineItems, ytd, stream) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 40, bufferPages: true });
  doc.pipe(stream);

  const W = 612 - 80; // usable width (letter minus margins)
  const ACCENT = '#1a56db';
  const GRAY   = '#6b7280';
  const DARK   = '#111827';
  const BORDER = '#e5e7eb';

  function fmtMoney(n) { return `$${Number(n || 0).toFixed(2)}`; }
  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Header bar ───────────────────────────────────────────────────────────────
  doc.rect(40, 40, W, 56).fill(ACCENT);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(16)
    .text(stub.business_name || 'Company Name', 52, 52, { width: W - 130 });
  doc.font('Helvetica').fontSize(9)
    .text(`EIN: ${stub.ein || '—'}`, 52, 72);
  doc.font('Helvetica-Bold').fontSize(11)
    .text('EARNINGS STATEMENT', 52, 85, { align: 'right', width: W - 12 });

  // ── Sub-header: period info ──────────────────────────────────────────────────
  doc.fillColor(DARK);
  let y = 108;
  doc.rect(40, y, W, 1).fill(BORDER);
  y += 6;

  function kv(label, value, x, yy, width = 120) {
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(label.toUpperCase(), x, yy, { width });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(value || '—', x, yy + 10, { width });
  }

  const col = W / 4;
  kv('Pay Period', `${fmtDate(stub.pay_period_start)} – ${fmtDate(stub.pay_period_end)}`, 40, y, col * 2 - 10);
  kv('Pay Date',  stub.settlement_date ? fmtDate(stub.settlement_date) : fmtDate(stub.pay_period_end), 40 + col * 2, y);
  kv('Period',   `Q${stub.tax_quarter || '—'} ${stub.tax_year || ''}`, 40 + col * 3, y);

  y += 32;
  doc.rect(40, y, W, 1).fill(BORDER);
  y += 6;

  // Employee name + address (left) and check info (right)
  const empName = stub.employee_name || (stub.first_name ? `${stub.first_name} ${stub.last_name}` : '—');
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(empName, 40, y);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  if (stub.address) doc.text(stub.address, 40, y + 14);
  const cityState = [stub.city, stub.emp_state, stub.zip].filter(Boolean).join(', ');
  if (cityState) doc.text(cityState, 40, stub.address ? y + 24 : y + 14);

  kv('Filing Status', ({ single: 'Single / MFS', married: 'Married / QSS', hoh: 'Head of Household' }[stub.filing_status] || stub.filing_status), 40 + col * 2, y);
  kv('Work State', stub.work_state || stub.client_state || '—', 40 + col * 3, y);

  y += 46;
  doc.rect(40, y, W, 1).fill(BORDER);
  y += 10;

  // ── Earnings table ───────────────────────────────────────────────────────────
  function sectionHeader(label, yy) {
    doc.rect(40, yy, W, 18).fill('#f3f4f6');
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY)
      .text(label.toUpperCase(), 44, yy + 5, { letterSpacing: 0.5 });
    return yy + 18;
  }

  function tableHeader(cols, yy) {
    doc.rect(40, yy, W, 16).fill('#f9fafb');
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY);
    let x = 44;
    for (const { label, width, align } of cols) {
      doc.text(label, x, yy + 4, { width: width - 4, align: align || 'left' });
      x += width;
    }
    return yy + 16;
  }

  function tableRow(cols, vals, yy, shade) {
    if (shade) doc.rect(40, yy, W, 16).fill('#fafafa');
    doc.font('Helvetica').fontSize(9).fillColor(DARK);
    let x = 44;
    for (let i = 0; i < cols.length; i++) {
      const { width, align } = cols[i];
      doc.text(String(vals[i] || '—'), x, yy + 3, { width: width - 4, align: align || 'left' });
      x += width;
    }
    doc.rect(40, yy + 16, W, 0.5).fill('#f3f4f6');
    return yy + 16;
  }

  // Earnings
  y = sectionHeader('Earnings', y);
  const earnCols = [
    { label: 'Description', width: W * 0.40 },
    { label: 'Hours',       width: W * 0.15, align: 'right' },
    { label: 'Rate',        width: W * 0.20, align: 'right' },
    { label: 'Amount',      width: W * 0.25, align: 'right' },
  ];
  y = tableHeader(earnCols, y);

  const PAY_TYPE_LABELS = {
    regular: 'Regular Pay', salary: 'Salary', overtime: 'Overtime (×1.5)',
    holiday: 'Holiday Pay', commission: 'Commission', sick: 'Sick Pay', piecework: 'Piecework',
  };

  if (lineItems.length > 0) {
    lineItems.forEach((li, idx) => {
      y = tableRow(earnCols, [
        PAY_TYPE_LABELS[li.pay_type] || li.pay_type,
        li.hours != null ? li.hours.toFixed(2) : '',
        li.rate  != null ? fmtMoney(li.rate)   : '',
        fmtMoney(li.amount),
      ], y, idx % 2 === 1);
    });
  } else {
    y = tableRow(earnCols, ['Gross Wages', '', '', fmtMoney(stub.gross_wages)], y, false);
  }

  // Gross wages total row
  doc.rect(40, y, W, 18).fill('#eff6ff');
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ACCENT)
    .text('Gross Wages', 44, y + 4, { width: W * 0.75 - 4 })
    .text(fmtMoney(stub.gross_wages), 44 + W * 0.75, y + 4, { width: W * 0.25 - 4, align: 'right' });
  y += 18;

  y += 10;

  // ── Two-column section: Employee Deductions | Employer Taxes ─────────────────
  const halfW = (W - 12) / 2;

  function miniSection(label, rows, x, startY, width) {
    doc.rect(x, startY, width, 16).fill('#f3f4f6');
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY)
      .text(label.toUpperCase(), x + 4, startY + 4, { width: width - 8 });
    let ry = startY + 16;
    rows.forEach(([desc, amt], idx) => {
      if (idx % 2 === 1) doc.rect(x, ry, width, 15).fill('#fafafa');
      doc.font('Helvetica').fontSize(9).fillColor(DARK)
        .text(desc, x + 4, ry + 3, { width: width * 0.65 - 4 })
        .text(amt,  x + 4 + width * 0.65, ry + 3, { width: width * 0.35 - 8, align: 'right' });
      doc.rect(x, ry + 15, width, 0.5).fill('#f3f4f6');
      ry += 15;
    });
    return ry;
  }

  const empDeductRows = [
    ['Federal Income Tax',  fmtMoney(stub.fit_withholding)],
    ['Social Security',     fmtMoney(stub.employee_ss)],
    ['Medicare',            fmtMoney(stub.employee_medicare)],
  ];
  if (stub.additional_medicare > 0) empDeductRows.push(['Additional Medicare', fmtMoney(stub.additional_medicare)]);
  if (stub.state_income_tax > 0)    empDeductRows.push([`${stub.work_state || ''} State Income Tax`, fmtMoney(stub.state_income_tax)]);

  const emplTaxRows = [
    ['SS Match (6.2%)',      fmtMoney(stub.employer_ss)],
    ['Medicare Match (1.45%)', fmtMoney(stub.employer_medicare)],
  ];
  if (stub.futa_tax > 0) emplTaxRows.push(['FUTA (0.6%)', fmtMoney(stub.futa_tax)]);
  if (stub.suta_tax > 0) emplTaxRows.push([`SUI — ${stub.work_state || ''}`, fmtMoney(stub.suta_tax)]);

  const leftBottom  = miniSection('Employee Deductions', empDeductRows,  40,           y, halfW);
  const rightBottom = miniSection('Employer Taxes',      emplTaxRows,    40 + halfW + 12, y, halfW);
  y = Math.max(leftBottom, rightBottom) + 10;

  // ── Totals ───────────────────────────────────────────────────────────────────
  doc.rect(40, y, W, 1).fill(BORDER);
  y += 8;

  const totalDeductions = (stub.fit_withholding || 0) + (stub.employee_ss || 0) +
    (stub.employee_medicare || 0) + (stub.additional_medicare || 0) + (stub.state_income_tax || 0);

  function totalRow(label, amount, highlight) {
    const bg = highlight ? ACCENT : '#f9fafb';
    const fg = highlight ? '#fff' : DARK;
    doc.rect(40 + halfW / 2, y, halfW * 1.5, 20).fill(bg);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(fg)
      .text(label, 44 + halfW / 2, y + 5, { width: halfW * 1.5 * 0.55 })
      .text(amount, 44 + halfW / 2 + halfW * 1.5 * 0.55, y + 5, { width: halfW * 1.5 * 0.45 - 8, align: 'right' });
    y += 20;
  }

  totalRow('Total Deductions (Employee)', fmtMoney(totalDeductions), false);
  y += 2;
  totalRow('Net Pay to Employee', fmtMoney(stub.net_pay), true);
  y += 6;
  totalRow('Total EFTPS Deposit (Employer Liability)', fmtMoney(stub.total_deposit), false);

  // ── YTD section ──────────────────────────────────────────────────────────────
  if (ytd) {
    y += 12;
    doc.rect(40, y, W, 1).fill(BORDER);
    y += 8;
    y = sectionHeader('Year-to-Date Summary', y);
    const ytdCols = [
      { label: 'Gross Wages',  width: W * 0.25, align: 'right' },
      { label: 'SS Wages',     width: W * 0.25, align: 'right' },
      { label: 'FUTA Wages',   width: W * 0.25, align: 'right' },
      { label: 'SUI Wages',    width: W * 0.25, align: 'right' },
    ];
    y = tableHeader(ytdCols, y);
    y = tableRow(ytdCols, [
      fmtMoney(ytd.ytd_gross),
      fmtMoney(ytd.ytd_ss_wages),
      fmtMoney(ytd.ytd_futa_wages),
      fmtMoney(ytd.ytd_suta_wages),
    ], y, false);
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  y += 16;
  doc.rect(40, y, W, 1).fill(BORDER);
  y += 6;
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
    .text(
      `Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ` +
      `Paystub #${stub.id} · Tax Year ${stub.tax_year || '—'} Q${stub.tax_quarter || '—'} · ` +
      `This is a payroll record for ${stub.business_name || 'your employer'}.`,
      40, y, { width: W, align: 'center' }
    );

  doc.end();
}

module.exports = router;
