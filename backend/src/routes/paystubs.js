'use strict';

const express      = require('express');
const PDFDocument  = require('pdfkit');
const { getDb }    = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { decrypt, encrypt }  = require('../services/cryptoService');
const { calculateWithholding, getTaxPeriod } = require('../services/taxCalculator');
const { submitToEFTPS } = require('../services/eftpsAutomation');
const bridgeManager = require('../ws/bridge');
const { calcSettlementDueDate } = require('../services/federalHolidays');

const router = express.Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

function generatePin() {
  const BLOCKED = new Set(['0000', '9999', '1234']);
  let pin;
  do {
    pin = String(Math.floor(Math.random() * 9000) + 1000);
    const isSeq = [0, 1, 2].every(i => Number(pin[i + 1]) === Number(pin[i]) + 1);
    if (BLOCKED.has(pin) || isSeq) pin = null;
  } while (!pin);
  return pin;
}

function resolvePin(db, clientId, encryptedPin) {
  if (encryptedPin) return decrypt(encryptedPin);
  const pin = generatePin();
  db.prepare('UPDATE clients SET batch_provider_pin_encrypted = ? WHERE id = ?')
    .run(encrypt(pin), clientId);
  return pin;
}

function attachLineItems(db, stubs) {
  const attach = (s) => {
    const items = db.prepare('SELECT * FROM paystub_line_items WHERE paystub_id = ?').all(s.id);
    return { ...s, lineItems: items };
  };
  return Array.isArray(stubs) ? stubs.map(attach) : attach(stubs);
}

// ── GET /api/paystubs?clientId=X[&employeeId=Y] ───────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { clientId, employeeId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  let sql = `
    SELECT p.*, e.first_name, e.last_name
    FROM paystubs p
    LEFT JOIN employees e ON p.employee_id = e.id
    WHERE p.client_id = ?
  `;
  const params = [clientId];
  if (employeeId) { sql += ' AND p.employee_id = ?'; params.push(employeeId); }
  sql += ' ORDER BY p.pay_period_end DESC, p.created_at DESC';

  res.json(attachLineItems(db, db.prepare(sql).all(...params)));
});

// ── GET /api/paystubs/pay-periods?clientId=X ─────────────────────────────────
router.get('/pay-periods', (req, res) => {
  const db = getDb();
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const periods = db.prepare(`
    SELECT
      pay_period_start, pay_period_end, tax_year, tax_quarter,
      COUNT(*)          AS employee_count,
      SUM(gross_wages)  AS total_gross,
      SUM(total_deposit) AS total_deposit_941,
      SUM(futa_tax)     AS total_futa,
      SUM(net_pay)      AS total_net,
      MIN(check_number) AS first_check,
      MAX(check_number) AS last_check
    FROM paystubs
    WHERE client_id = ?
    GROUP BY pay_period_start, pay_period_end
    ORDER BY pay_period_end DESC
  `).all(clientId);

  res.json(periods);
});

// ── POST /api/paystubs/print-selected — PDF for arbitrary paystub IDs ─────────
// POST /api/paystubs/mark-late — sweep draft checks with a past pay date → 'late'
router.post('/mark-late', (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const result = db.prepare(`
    UPDATE paystubs
    SET check_status = 'late'
    WHERE check_status = 'draft'
      AND settlement_date IS NOT NULL
      AND settlement_date < ?
      AND client_id IN (SELECT id FROM clients WHERE user_id = ?)
  `).run(today, req.user.id);
  res.json({ updated: result.changes });
});

router.post('/print-selected', (req, res) => {
  const { clientId, paystubIds } = req.body;
  if (!clientId || !Array.isArray(paystubIds) || paystubIds.length === 0)
    return res.status(400).json({ error: 'clientId and paystubIds[] required' });

  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const ph = paystubIds.map(() => '?').join(',');
  const stubs = db.prepare(`
    SELECT p.*, e.first_name, e.last_name, e.address AS emp_address,
           e.city AS emp_city, e.state AS emp_state, e.zip AS emp_zip
    FROM paystubs p
    LEFT JOIN employees e ON p.employee_id = e.id
    WHERE p.id IN (${ph}) AND p.client_id = ?
    ORDER BY p.check_number
  `).all(...paystubIds, clientId);

  if (!stubs.length) return res.status(404).json({ error: 'No paystubs found' });

  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="selected-checks.pdf"');
  doc.pipe(res);

  const PW = 612, PH = 792, ML = 36, MR = 36, TW = PW - ML - MR;
  const ACCENT = '#1a2e5a', DARK = '#0f172a', GRAY = '#64748b', BORDER = '#e2e8f0';

  for (const stub of stubs) {
    doc.addPage();
    const empName = stub.employee_name || (stub.first_name ? `${stub.first_name} ${stub.last_name}` : '—');

    doc.rect(ML, 30, TW, 44).fill(ACCENT);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(13)
      .text(client.business_name, ML + 10, 40, { width: TW / 2 });
    doc.font('Helvetica').fontSize(8).text(`EIN: ${client.ein}`, ML + 10, 56);
    doc.font('Helvetica-Bold').fontSize(9)
      .text('PAY STUB — DETACH AND RETAIN', ML + 10, 63, { align: 'right', width: TW - 10 });

    let y = 84;
    function kv2(label, val, x, yy, w = 130) {
      doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(label.toUpperCase(), x, yy, { width: w });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(val || '—', x, yy + 9, { width: w });
    }
    const col = TW / 4;
    kv2('Pay Period', `${stub.pay_period_start} – ${stub.pay_period_end}`, ML, y, col * 2 - 10);
    kv2('Pay Date', stub.settlement_date || stub.pay_period_end || '', ML + col * 2, y);
    kv2('Check #', stub.check_number ? `#${stub.check_number}` : '—', ML + col * 3, y);
    y += 28;

    doc.rect(ML, y, TW, 1).fill(BORDER); y += 8;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(empName, ML, y);
    y += 13;
    const addrParts = [stub.emp_address, [stub.emp_city, stub.emp_state, stub.emp_zip].filter(Boolean).join(', ')].filter(Boolean);
    if (addrParts.length) { doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(addrParts.join('\n'), ML, y); y += addrParts.length * 10 + 4; }
    doc.rect(ML, y, TW, 1).fill(BORDER); y += 8;

    doc.rect(ML, y, TW, 14).fill('#f8fafc');
    doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY).text('EARNINGS', ML + 4, y + 4);
    y += 14;
    const lineItems = db.prepare('SELECT * FROM paystub_line_items WHERE paystub_id = ?').all(stub.id);
    const earnCols = [{ l: 'Description', x: ML + 4, w: 160 }, { l: 'Hours', x: ML + 170, w: 60 }, { l: 'Rate', x: ML + 234, w: 70 }, { l: 'Amount', x: ML + 310, w: 90, right: true }];
    doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY);
    earnCols.forEach(c => doc.text(c.l, c.x, y + 2, { width: c.w, align: c.right ? 'right' : 'left' }));
    y += 12;
    let shade = false;
    for (const li of lineItems) {
      if (shade) doc.rect(ML, y, TW, 13).fill('#f9fafb').fillOpacity(1);
      doc.font('Helvetica').fontSize(8).fillColor(DARK)
        .text((li.description || li.pay_type || '').replace(/_/g, ' '), ML + 4, y + 3, { width: 160 })
        .text(li.hours != null ? String(li.hours) : '', ML + 170, y + 3, { width: 60 })
        .text(li.rate  != null ? `$${Number(li.rate).toFixed(2)}` : '', ML + 234, y + 3, { width: 70 })
        .text(`$${Number(li.amount).toFixed(2)}`, ML + 310, y + 3, { width: 90, align: 'right' });
      y += 13; shade = !shade;
    }
    if (stub.bonus > 0)         { doc.font('Helvetica').fontSize(8).fillColor(DARK).text('Bonus', ML + 4, y + 3, { width: 160 }).text(`$${Number(stub.bonus).toFixed(2)}`, ML + 310, y + 3, { width: 90, align: 'right' }); y += 13; }
    if (stub.commission > 0)    { doc.font('Helvetica').fontSize(8).fillColor(DARK).text('Commission', ML + 4, y + 3, { width: 160 }).text(`$${Number(stub.commission).toFixed(2)}`, ML + 310, y + 3, { width: 90, align: 'right' }); y += 13; }
    if (stub.reimbursement > 0) { doc.font('Helvetica').fontSize(8).fillColor(DARK).text('Reimbursement', ML + 4, y + 3, { width: 160 }).text(`$${Number(stub.reimbursement).toFixed(2)}`, ML + 310, y + 3, { width: 90, align: 'right' }); y += 13; }
    doc.rect(ML, y, TW, 1).fill(BORDER); y += 6;

    const halfW = TW / 2 - 4, leftX = ML, rightX = ML + TW / 2 + 4;
    function section(label, rows, x, startY) {
      doc.rect(x, startY, halfW, 14).fill('#f8fafc');
      doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY).text(label, x + 4, startY + 4);
      let sy = startY + 14;
      for (const [desc, amt] of rows) {
        if (amt !== 0) {
          doc.font('Helvetica').fontSize(8).fillColor(DARK)
            .text(desc, x + 4, sy + 2, { width: halfW - 80 })
            .text(`$${Number(amt).toFixed(2)}`, x + halfW - 76, sy + 2, { width: 72, align: 'right' });
          sy += 13;
        }
      }
      return sy;
    }
    const deductRows = [['Federal Income Tax', stub.fit_withholding],['Social Security (6.2%)', stub.employee_ss],['Medicare (1.45%)', stub.employee_medicare],['State Income Tax', stub.state_income_tax],['Deductions', stub.deduction],['Garnishments', stub.garnishment]];
    const employerRows = [['Social Security Match', stub.employer_ss],['Medicare Match', stub.employer_medicare],['FUTA (0.6%)', stub.futa_tax],['SUI', stub.suta_tax]];
    const lBottom = section('EMPLOYEE DEDUCTIONS', deductRows, leftX, y);
    const rBottom = section('EMPLOYER CONTRIBUTIONS', employerRows, rightX, y);
    y = Math.max(lBottom, rBottom) + 8;

    doc.rect(ML, y, TW, 1).fill(BORDER); y += 8;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('Gross Pay', ML + 4, y).text(`$${Number(stub.gross_wages).toFixed(2)}`, ML + 4, y, { width: TW - 8, align: 'right' }); y += 14;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Total Deductions', ML + 4, y).text(`-$${Number(stub.fit_withholding + stub.employee_ss + stub.employee_medicare + (stub.state_income_tax || 0) + (stub.deduction || 0) + (stub.garnishment || 0)).toFixed(2)}`, ML + 4, y, { width: TW - 8, align: 'right' }); y += 14;
    if (stub.reimbursement > 0) { doc.text('Reimbursements', ML + 4, y).text(`+$${Number(stub.reimbursement).toFixed(2)}`, ML + 4, y, { width: TW - 8, align: 'right' }); y += 14; }
    doc.rect(ML, y, TW, 1).fill(BORDER); y += 6;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text('NET PAY', ML + 4, y).text(`$${Number(stub.net_pay).toFixed(2)}`, ML + 4, y, { width: TW - 8, align: 'right' }); y += 20;

    const detachY = 480;
    doc.dash(4, { space: 4 }).rect(ML, detachY, TW, 0).stroke(BORDER).undash();
    doc.font('Helvetica').fontSize(7).fillColor(GRAY).text('✂  DETACH HERE  ✂', ML, detachY + 2, { width: TW, align: 'center' });

    const CY = detachY + 20, CW = TW, CX = ML;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(client.business_name, CX, CY);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY);
    if (client.business_address) doc.text(client.business_address, CX, CY + 13);
    const companyCity = [client.business_city, client.state, client.business_zip].filter(Boolean).join(', ');
    if (companyCity) doc.text(companyCity, CX, client.business_address ? CY + 23 : CY + 13);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(stub.check_number ? `#${stub.check_number}` : '', CX, CY, { width: CW, align: 'right' });
    const payDate = stub.settlement_date || stub.pay_period_end || new Date().toISOString().slice(0, 10);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Date:', CX + CW - 180, CY + 13).font('Helvetica-Bold').fillColor(DARK).text(payDate, CX + CW - 150, CY + 13);

    let cy = CY + 48;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('PAY TO THE ORDER OF', CX, cy); cy += 12;
    doc.rect(CX, cy, CW - 120, 22).stroke(BORDER);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(empName, CX + 6, cy + 6, { width: CW - 130 });
    doc.rect(CX + CW - 114, cy, 114, 22).fill('#f8fafc').stroke(BORDER);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(`$${Number(stub.net_pay).toFixed(2)}`, CX + CW - 110, cy + 5, { width: 106, align: 'right' });
    cy += 30;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('AMOUNT:', CX, cy); cy += 10;
    doc.rect(CX, cy, CW, 18).stroke(BORDER);
    doc.font('Helvetica').fontSize(8.5).fillColor(DARK).text(numberToWords(stub.net_pay) + ' ****', CX + 6, cy + 4, { width: CW - 12 }); cy += 28;
    const memo = `Pay period: ${stub.pay_period_start} to ${stub.pay_period_end}`;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('MEMO:', CX, cy);
    doc.fillColor(DARK).text(memo, CX + 36, cy);
    doc.rect(CX + CW - 160, cy + 20, 160, 1).fill(DARK);
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text('Authorized Signature', CX + CW - 160, cy + 24, { width: 160, align: 'center' });
    doc.rect(CX - 4, CY - 8, CW + 8, PH - CY - ML + 8 - 10).stroke(BORDER);
  }

  doc.end();

  db.prepare(`
    UPDATE paystubs SET check_status = 'printed'
    WHERE id IN (${ph}) AND client_id = ? AND check_status = 'draft'
  `).run(...paystubIds, clientId);
});

// ── GET /api/paystubs/by-employee?clientId=X&employeeId=Y ────────────────────
// Returns all paystubs for one employee, ordered most-recent first
router.get('/by-employee', (req, res) => {
  const db = getDb();
  const { clientId, employeeId } = req.query;
  if (!clientId || !employeeId) return res.status(400).json({ error: 'clientId and employeeId required' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const rows = db.prepare(`
    SELECT p.*, e.first_name, e.last_name
    FROM paystubs p
    LEFT JOIN employees e ON p.employee_id = e.id
    WHERE p.client_id = ? AND p.employee_id = ?
    ORDER BY p.pay_period_end DESC, p.created_at DESC
  `).all(clientId, employeeId);
  res.json(rows);
});

// ── GET /api/paystubs/credits?clientId=X ─────────────────────────────────────
router.get('/credits', (req, res) => {
  const db = getDb();
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const credits = db.prepare('SELECT * FROM paystub_credits WHERE client_id = ? ORDER BY created_at DESC').all(clientId);
  res.json(credits);
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

  let employeeName = null;
  if (employeeId) {
    const emp = db.prepare('SELECT first_name, last_name FROM employees WHERE id = ?').get(employeeId);
    if (emp) employeeName = `${emp.first_name} ${emp.last_name}`;
  }

  // Atomically assign a check number and write all rows
  const { stubId } = db.transaction(() => {
    const clientRow = db.prepare('SELECT next_check_number FROM clients WHERE id = ?').get(clientId);
    const checkNum  = clientRow.next_check_number || 1001;
    db.prepare('UPDATE clients SET next_check_number = next_check_number + 1 WHERE id = ?').run(clientId);

    const r = db.prepare(`
      INSERT INTO paystubs (
        client_id, employee_id, employee_name,
        pay_period_start, pay_period_end, settlement_date, pay_frequency,
        filing_status, step2_checkbox, step3_credits, work_state,
        gross_wages, fit_withholding, employee_ss, employee_medicare,
        additional_medicare, employer_ss, employer_medicare,
        state_income_tax, futa_tax, suta_tax,
        total_deposit, net_pay, ytd_wages_before,
        tax_year, tax_quarter, notes, check_number
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clientId, employeeId || null, employeeName,
      payPeriodStart, payPeriodEnd, settlementDate || null, payFrequency,
      filingStatus || 'single', step2Checkbox ? 1 : 0, step3Credits, effectiveWorkState,
      taxes.grossWages, taxes.fitWithholding, taxes.employeeSS, taxes.employeeMedicare,
      taxes.additionalMedicare || 0, taxes.employerSS, taxes.employerMedicare,
      taxes.stateIncomeTax, taxes.futaTax, taxes.sutaTax,
      taxes.totalDeposit, taxes.netPay, ytdBefore,
      year, quarter, notes || null, checkNum,
    );

    const sid = r.lastInsertRowid;

    if (items) {
      const insertItem = db.prepare(`
        INSERT INTO paystub_line_items (paystub_id, pay_type, description, hours, rate, amount)
        VALUES (?,?,?,?,?,?)
      `);
      for (const li of items) {
        insertItem.run(sid, li.payType || 'regular', li.description || null,
          li.hours ? parseFloat(li.hours) : null, li.rate ? parseFloat(li.rate) : null,
          parseFloat(li.amount || 0));
      }
    }

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
      `).run(employeeId, year, computedGross, taxes.ssWagesThisPeriod, taxes.futaTaxable, taxes.sutaTaxable);
    }

    return { stubId: sid };
  })();

  const stub = db.prepare('SELECT * FROM paystubs WHERE id = ?').get(stubId);
  const lineItemsOut = db.prepare('SELECT * FROM paystub_line_items WHERE paystub_id = ?').all(stubId);
  res.status(201).json({ ...stub, lineItems: lineItemsOut });
});

// ── PUT /api/paystubs/:id — edit paystub ──────────────────────────────────────
router.put('/:id', (req, res) => {
  const db = getDb();
  const stub = db.prepare(`
    SELECT p.* FROM paystubs p
    JOIN clients c ON p.client_id = c.id
    WHERE p.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!stub) return res.status(404).json({ error: 'Paystub not found' });

  const alreadySubmitted = stub.status === 'submitted' || stub.status_940 === 'submitted';

  const {
    payPeriodStart, payPeriodEnd, settlementDate, settlementDueDate, payFrequency,
    filingStatus, step2Checkbox, step3Children, step3Other,
    step4a, step4b, step4c,
    lineItems, workState, ytdGross, notes,
  } = req.body;

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(stub.client_id);

  const items = Array.isArray(lineItems) && lineItems.length > 0 ? lineItems : null;
  const computedGross = items
    ? items.reduce((s, li) => s + parseFloat(li.amount || 0), 0)
    : stub.gross_wages;

  const effectiveWorkState = ((workState || stub.work_state || client.state || 'TX')).toUpperCase();
  const ytdBefore = parseFloat(ytdGross ?? stub.ytd_wages_before ?? 0);

  const taxes = calculateWithholding({
    grossWages:    computedGross,
    payFrequency:  payFrequency || stub.pay_frequency,
    filingStatus:  filingStatus || stub.filing_status,
    step2Checkbox: step2Checkbox !== undefined ? !!step2Checkbox : !!stub.step2_checkbox,
    step3Children: parseInt(step3Children ?? stub.step3_children ?? 0, 10),
    step3Other:    parseInt(step3Other    ?? stub.step3_other    ?? 0, 10),
    step4a: parseFloat(step4a ?? 0),
    step4b: parseFloat(step4b ?? 0),
    step4c: parseFloat(step4c ?? 0),
    workState:  effectiveWorkState,
    ytdGross:   ytdBefore,
    sutaRate:   client.suta_rate || null,
  });

  const step3Credits =
    (parseInt(step3Children ?? stub.step3_children ?? 0, 10) * 2200) +
    (parseInt(step3Other    ?? stub.step3_other    ?? 0, 10) * 500);

  const { quarter, year } = getTaxPeriod(payPeriodEnd || stub.pay_period_end);

  db.prepare(`
    UPDATE paystubs SET
      pay_period_start = ?, pay_period_end = ?, settlement_date = ?, settlement_due_date = ?,
      pay_frequency = ?, filing_status = ?, step2_checkbox = ?, step3_credits = ?, work_state = ?,
      gross_wages = ?, fit_withholding = ?, employee_ss = ?, employee_medicare = ?,
      additional_medicare = ?, employer_ss = ?, employer_medicare = ?,
      state_income_tax = ?, futa_tax = ?, suta_tax = ?,
      total_deposit = ?, net_pay = ?, ytd_wages_before = ?,
      tax_year = ?, tax_quarter = ?, notes = ?
    WHERE id = ?
  `).run(
    payPeriodStart  || stub.pay_period_start,
    payPeriodEnd    || stub.pay_period_end,
    settlementDate     !== undefined ? (settlementDate     || null) : stub.settlement_date,
    settlementDueDate  !== undefined ? (settlementDueDate  || null) : stub.settlement_due_date,
    payFrequency    || stub.pay_frequency,
    filingStatus    || stub.filing_status,
    step2Checkbox !== undefined ? (step2Checkbox ? 1 : 0) : stub.step2_checkbox,
    step3Credits,
    effectiveWorkState,
    taxes.grossWages, taxes.fitWithholding, taxes.employeeSS, taxes.employeeMedicare,
    taxes.additionalMedicare || 0, taxes.employerSS, taxes.employerMedicare,
    taxes.stateIncomeTax, taxes.futaTax, taxes.sutaTax,
    taxes.totalDeposit, taxes.netPay, ytdBefore,
    year, quarter, notes !== undefined ? (notes || null) : stub.notes,
    stub.id,
  );

  if (items) {
    db.prepare('DELETE FROM paystub_line_items WHERE paystub_id = ?').run(stub.id);
    const insertItem = db.prepare(`
      INSERT INTO paystub_line_items (paystub_id, pay_type, description, hours, rate, amount)
      VALUES (?,?,?,?,?,?)
    `);
    for (const li of items) {
      insertItem.run(
        stub.id,
        li.payType || li.pay_type || 'regular',
        li.description || null,
        li.hours ? parseFloat(li.hours) : null,
        li.rate  ? parseFloat(li.rate)  : null,
        parseFloat(li.amount || 0),
      );
    }
  }

  const updated = db.prepare('SELECT * FROM paystubs WHERE id = ?').get(stub.id);
  const lineItemsOut = db.prepare('SELECT * FROM paystub_line_items WHERE paystub_id = ?').all(stub.id);
  res.json({
    paystub: { ...updated, lineItems: lineItemsOut },
    warning: alreadySubmitted
      ? 'This paystub has already been submitted to EFTPS. Edits do not revise the filed deposit — you must file an amended return separately.'
      : null,
  });
});

// ── DELETE /api/paystubs/:id ──────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const stub = db.prepare(`
    SELECT p.* FROM paystubs p
    JOIN clients c ON p.client_id = c.id
    WHERE p.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!stub) return res.status(404).json({ error: 'Paystub not found' });
  if (stub.status === 'submitted') return res.status(400).json({ error: 'Cannot delete a submitted paystub' });
  if (stub.check_status === 'voided') return res.status(400).json({ error: 'Voided checks cannot be deleted — they must stay for record keeping' });

  db.transaction(() => {
    // Reverse YTD wages
    if (stub.employee_id && stub.gross_wages > 0) {
      const year = stub.tax_year || new Date().getFullYear();
      db.prepare(`
        UPDATE employee_ytd_wages SET
          ytd_gross      = MAX(0, ytd_gross      - ?),
          ytd_ss_wages   = MAX(0, ytd_ss_wages   - ?),
          ytd_futa_wages = MAX(0, ytd_futa_wages - ?),
          ytd_suta_wages = MAX(0, ytd_suta_wages - ?),
          updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = ? AND tax_year = ?
      `).run(stub.gross_wages, stub.gross_wages, stub.gross_wages, stub.gross_wages, stub.employee_id, year);
    }
    db.prepare('DELETE FROM paystub_line_items WHERE paystub_id = ?').run(stub.id);
    db.prepare('DELETE FROM paystubs WHERE id = ?').run(stub.id);
  })();

  res.json({ message: 'Paystub deleted and tax liabilities reversed' });
});

// ── POST /api/paystubs/:id/submit — submit single paystub ────────────────────
// taxType: '941' (FIT + SS + Medicare, code 94105) or '940' (FUTA, code 94007)
router.post('/:id/submit', async (req, res) => {
  const { taxType = '941' } = req.body;
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

  if (taxType === '940') {
    if (!stub.futa_tax || stub.futa_tax <= 0) {
      return res.status(400).json({ error: 'No FUTA tax on this paystub — nothing to submit for 940' });
    }
    if (stub.status_940 === 'submitted') {
      return res.status(400).json({ error: '940/FUTA already submitted for this paystub' });
    }
  } else {
    if (stub.status === 'submitted') return res.status(400).json({ error: '941 already submitted for this paystub' });
  }

  const pin = resolvePin(db, stub.client_id, stub.batch_provider_pin_encrypted);

  // Mark processing
  if (taxType === '940') {
    db.prepare("UPDATE paystubs SET status_940 = 'processing' WHERE id = ?").run(stub.id);
  } else {
    db.prepare("UPDATE paystubs SET status = 'processing' WHERE id = ?").run(stub.id);
  }

  try {
    let result;

    if (bridgeManager.isConnected) {
      const accountNumber = stub.bank_account_number_encrypted
        ? decrypt(stub.bank_account_number_encrypted) : null;
      if (!stub.settlement_date) {
        const resetSql = taxType === '940'
          ? "UPDATE paystubs SET status_940 = 'pending' WHERE id = ?"
          : "UPDATE paystubs SET status = 'pending' WHERE id = ?";
        db.prepare(resetSql).run(stub.id);
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
        taxForm:        taxType,
        taxTypeCode:    taxType === '940' ? '94007' : '94105',
        taxData:        taxType === '940'
          ? { futaTax: stub.futa_tax, totalDeposit: stub.futa_tax }
          : { totalDeposit: stub.total_deposit },
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
        taxForm:         taxType,
        taxData: taxType === '940'
          ? { futaTax: stub.futa_tax, totalDeposit: stub.futa_tax }
          : {
              fitWithholding:   stub.fit_withholding,
              employeeSS:       stub.employee_ss,
              employeeMedicare: stub.employee_medicare,
              employerSS:       stub.employer_ss,
              employerMedicare: stub.employer_medicare,
            },
      });
    }

    if (result.success) {
      const confirmation = result.confirmation || result.achFilePath || result.message;
      if (taxType === '940') {
        db.prepare(`
          UPDATE paystubs SET
            status_940 = 'submitted',
            eftps_940_confirmation = ?,
            eftps_940_submitted_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(confirmation, stub.id);
      } else {
        db.prepare(`
          UPDATE paystubs SET
            status = 'submitted',
            eftps_confirmation = ?,
            submitted_at = CURRENT_TIMESTAMP,
            submission_error = NULL
          WHERE id = ?
        `).run(confirmation, stub.id);
      }
    } else {
      if (taxType === '940') {
        db.prepare("UPDATE paystubs SET status_940 = 'failed' WHERE id = ?").run(stub.id);
      } else {
        db.prepare("UPDATE paystubs SET status = 'failed', submission_error = ? WHERE id = ?")
          .run(result.error, stub.id);
      }
    }

    const updated = db.prepare('SELECT * FROM paystubs WHERE id = ?').get(stub.id);
    res.json({ paystub: updated, result, taxType });
  } catch (err) {
    if (taxType === '940') {
      db.prepare("UPDATE paystubs SET status_940 = 'failed' WHERE id = ?").run(stub.id);
    } else {
      db.prepare("UPDATE paystubs SET status = 'failed', submission_error = ? WHERE id = ?")
        .run(err.message, stub.id);
    }
    res.status(500).json({ error: 'Submission error', details: err.message });
  }
});

// ── POST /api/paystubs/payroll-run — bulk payroll for all employees ───────────
function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T00:00:00');
  switch (frequency) {
    case 'weekly':      d.setDate(d.getDate() + 7);  break;
    case 'biweekly':    d.setDate(d.getDate() + 14); break;
    case 'semimonthly': d.setDate(d.getDate() + 15); break;
    case 'monthly':     d.setMonth(d.getMonth() + 1); break;
    default:            d.setDate(d.getDate() + 14);
  }
  return d.toISOString().slice(0, 10);
}

router.post('/payroll-run', (req, res) => {
  try {
  const db = getDb();
  const { clientId, payPeriodStart, payPeriodEnd, settlementDate, employees, paymentMethod, payGroupId } = req.body;
  if (!clientId || !payPeriodStart || !payPeriodEnd || !Array.isArray(employees)) {
    return res.status(400).json({ error: 'clientId, payPeriodStart, payPeriodEnd, employees required' });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const runId = `run-${Date.now()}`;
  const { quarter, year } = getTaxPeriod(payPeriodEnd);

  const results = db.transaction(() => {
    const created = [];

    const insertStub = db.prepare(`
      INSERT INTO paystubs (
        client_id, employee_id, employee_name,
        pay_period_start, pay_period_end, settlement_date, pay_frequency,
        filing_status, step2_checkbox, step3_credits, work_state,
        gross_wages, fit_withholding, employee_ss, employee_medicare,
        additional_medicare, employer_ss, employer_medicare,
        state_income_tax, futa_tax, suta_tax,
        total_deposit, net_pay, ytd_wages_before,
        tax_year, tax_quarter, check_number, payroll_run_id,
        payment_method, regular_hours, overtime_hours, regular_pay, overtime_pay,
        bonus, commission, reimbursement, deduction, garnishment,
        check_status, settlement_due_date, pay_group_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO paystub_line_items (paystub_id, pay_type, description, hours, rate, amount)
      VALUES (?,?,?,?,?,?)
    `);
    const upsertYTD = db.prepare(`
      INSERT INTO employee_ytd_wages (employee_id, tax_year, ytd_gross, ytd_ss_wages, ytd_futa_wages, ytd_suta_wages)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(employee_id, tax_year) DO UPDATE SET
        ytd_gross      = ytd_gross      + excluded.ytd_gross,
        ytd_ss_wages   = ytd_ss_wages   + excluded.ytd_ss_wages,
        ytd_futa_wages = ytd_futa_wages + excluded.ytd_futa_wages,
        ytd_suta_wages = ytd_suta_wages + excluded.ytd_suta_wages,
        updated_at     = CURRENT_TIMESTAMP
    `);

    for (const empData of employees) {
      if (empData.skip) continue;

      const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND client_id = ?')
        .get(empData.employeeId, clientId);
      if (!emp) continue;

      const lineItems = empData.lineItems || [];
      const computedGross = lineItems.reduce((s, li) => s + parseFloat(li.amount || 0), 0);
      if (computedGross <= 0) continue;

      const effectiveWorkState = (emp.work_state || emp.state || client.state || 'TX').toUpperCase();
      const ytdBefore = parseFloat(empData.ytdGross || 0);

      const taxes = calculateWithholding({
        grossWages:    computedGross,
        payFrequency:  emp.pay_frequency || 'biweekly',
        filingStatus:  emp.filing_status || 'single',
        step2Checkbox: !!emp.step2_checkbox,
        step3Children: emp.step3_children || 0,
        step3Other:    emp.step3_other    || 0,
        step4a: emp.step4a || 0, step4b: emp.step4b || 0, step4c: emp.step4c || 0,
        workState: effectiveWorkState,
        ytdGross:  ytdBefore,
        sutaRate:  client.suta_rate || null,
      });

      // Atomically get + increment check number inside the same transaction
      const checkNum = db.prepare('SELECT next_check_number FROM clients WHERE id = ?').get(clientId).next_check_number || 1001;
      db.prepare('UPDATE clients SET next_check_number = next_check_number + 1 WHERE id = ?').run(clientId);

      const step3Credits = (emp.step3_children || 0) * 2200 + (emp.step3_other || 0) * 500;
      const employeeName = `${emp.first_name} ${emp.last_name}`;

      const r = insertStub.run(
        clientId, emp.id, employeeName,
        payPeriodStart, payPeriodEnd, settlementDate || null, emp.pay_frequency || 'biweekly',
        emp.filing_status || 'single', emp.step2_checkbox ? 1 : 0, step3Credits, effectiveWorkState,
        taxes.grossWages, taxes.fitWithholding, taxes.employeeSS, taxes.employeeMedicare,
        taxes.additionalMedicare || 0, taxes.employerSS, taxes.employerMedicare,
        taxes.stateIncomeTax || 0, taxes.futaTax || 0, taxes.sutaTax || 0,
        taxes.totalDeposit, taxes.netPay, ytdBefore,
        year, quarter, checkNum, runId,
        paymentMethod || 'pending',
        empData.regularHours  != null ? parseFloat(empData.regularHours)  : null,
        empData.overtimeHours != null ? parseFloat(empData.overtimeHours) : null,
        empData.regularPay    != null ? parseFloat(empData.regularPay)    : null,
        empData.overtimePay   != null ? parseFloat(empData.overtimePay)   : null,
        parseFloat(empData.bonus         || 0),
        parseFloat(empData.commission    || 0),
        parseFloat(empData.reimbursement || 0),
        parseFloat(empData.deduction     || 0),
        parseFloat(empData.garnishment   || 0),
        'draft',
        calcSettlementDueDate(settlementDate || payPeriodEnd, client.deposit_schedule || 'monthly'),
        payGroupId || null,
      );

      const stubId = r.lastInsertRowid;
      for (const li of lineItems) {
        insertItem.run(stubId, li.payType || 'regular', li.description || null,
          li.hours ? parseFloat(li.hours) : null, li.rate ? parseFloat(li.rate) : null,
          parseFloat(li.amount || 0));
      }

      upsertYTD.run(emp.id, year, computedGross,
        taxes.ssWagesThisPeriod || 0, taxes.futaTaxable || 0, taxes.sutaTaxable || 0);

      created.push({
        id: stubId, employeeId: emp.id, employeeName, checkNumber: checkNum,
        grossWages: taxes.grossWages, netPay: taxes.netPay,
        totalDeposit: taxes.totalDeposit, fitWithholding: taxes.fitWithholding,
        employeeSS: taxes.employeeSS, employeeMedicare: taxes.employeeMedicare,
        employerSS: taxes.employerSS, employerMedicare: taxes.employerMedicare,
        futaTax: taxes.futaTax || 0, sutaTax: taxes.sutaTax || 0,
      });
    }

    // Auto-advance the client's next payroll date
    if (client.next_payroll_date && created.length > 0) {
      const next = advanceDate(client.next_payroll_date, client.payroll_frequency || 'biweekly');
      db.prepare('UPDATE clients SET next_payroll_date = ? WHERE id = ?').run(next, clientId);
    }

    return created;
  })();

  res.json({ runId, count: results.length, paystubs: results });
  } catch (err) {
    console.error('[payroll-run]', err);
    res.status(500).json({ error: err.message || 'Payroll run failed' });
  }
});

// ── POST /api/paystubs/batch-submit ──────────────────────────────────────────
// ── GET /api/paystubs/run-pdf/:runId — check PDF for a payroll run ────────────
function numberToWords(amount) {
  const dollars = Math.floor(amount);
  const cents   = Math.round((amount - dollars) * 100);
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below100(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
  }
  function below1000(n) {
    if (n < 100) return below100(n);
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + below100(n % 100) : '');
  }
  function toWords(n) {
    if (n === 0) return 'Zero';
    let w = '';
    if (n >= 1000000) { w += below1000(Math.floor(n / 1000000)) + ' Million '; n %= 1000000; }
    if (n >= 1000)    { w += below1000(Math.floor(n / 1000)) + ' Thousand '; n %= 1000; }
    if (n > 0)        { w += below1000(n); }
    return w.trim();
  }
  return `${toWords(dollars)} and ${String(cents).padStart(2, '0')}/100 Dollars`;
}

router.get('/run-pdf/:runId', (req, res) => {
  const db = getDb();
  const { runId } = req.params;
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const stubs = db.prepare(`
    SELECT p.*, e.first_name, e.last_name, e.address AS emp_address, e.city AS emp_city,
           e.state AS emp_state, e.zip AS emp_zip
    FROM paystubs p
    LEFT JOIN employees e ON p.employee_id = e.id
    WHERE p.payroll_run_id = ? AND p.client_id = ?
    ORDER BY p.check_number
  `).all(runId, clientId);

  if (!stubs.length) return res.status(404).json({ error: 'No paystubs found for this run' });

  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-checks-${runId}.pdf"`);
  doc.pipe(res);

  const PW = 612, PH = 792;
  const ACCENT = '#1a2e5a', DARK = '#0f172a', GRAY = '#64748b', BORDER = '#e2e8f0';
  const ML = 36, MR = 36, TW = PW - ML - MR;

  for (const stub of stubs) {
    doc.addPage();
    const empName = stub.employee_name || (stub.first_name ? `${stub.first_name} ${stub.last_name}` : '—');

    // ── Stub section (top 480pt) ──────────────────────────────────────────────
    // Header bar
    doc.rect(ML, 30, TW, 44).fill(ACCENT);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(13)
      .text(client.business_name, ML + 10, 40, { width: TW / 2 });
    doc.font('Helvetica').fontSize(8)
      .text(`EIN: ${client.ein}`, ML + 10, 56);
    doc.font('Helvetica-Bold').fontSize(9)
      .text('PAY STUB — DETACH AND RETAIN', ML + 10, 63, { align: 'right', width: TW - 10 });

    let y = 84;
    function kv2(label, val, x, yy, w = 130) {
      doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(label.toUpperCase(), x, yy, { width: w });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(val || '—', x, yy + 9, { width: w });
    }
    const col = TW / 4;
    kv2('Employee', empName, ML, y, col * 2 - 8);
    kv2('Pay Period', `${stub.pay_period_start} – ${stub.pay_period_end}`, ML + col * 2, y);
    kv2('Pay Date', stub.settlement_date || stub.pay_period_end, ML + col * 3, y);
    y += 28;

    const addrParts = [stub.emp_address, [stub.emp_city, stub.emp_state, stub.emp_zip].filter(Boolean).join(', ')].filter(Boolean);
    if (addrParts.length) {
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(addrParts.join('\n'), ML, y);
      y += addrParts.length * 10 + 4;
    }

    doc.rect(ML, y, TW, 1).fill(BORDER); y += 8;

    // Earnings section
    doc.rect(ML, y, TW, 14).fill('#f8fafc');
    doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY).text('EARNINGS', ML + 4, y + 4);
    y += 14;
    const lineItems = db.prepare('SELECT * FROM paystub_line_items WHERE paystub_id = ?').all(stub.id);
    const earnCols = [{ l: 'Description', x: ML + 4, w: 160 }, { l: 'Hours', x: ML + 170, w: 60 }, { l: 'Rate', x: ML + 234, w: 70 }, { l: 'Amount', x: ML + 310, w: 90, right: true }];
    doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY);
    earnCols.forEach(c => doc.text(c.l, c.x, y + 2, { width: c.w, align: c.right ? 'right' : 'left' }));
    y += 12;
    let shade = false;
    for (const li of lineItems) {
      if (shade) doc.rect(ML, y, TW, 13).fill('#f9fafb').fillOpacity(1);
      doc.font('Helvetica').fontSize(8).fillColor(DARK)
        .text((li.description || li.pay_type || '').replace(/_/g, ' '), ML + 4, y + 3, { width: 160 })
        .text(li.hours != null ? String(li.hours) : '', ML + 170, y + 3, { width: 60 })
        .text(li.rate  != null ? `$${Number(li.rate).toFixed(2)}` : '', ML + 234, y + 3, { width: 70 })
        .text(`$${Number(li.amount).toFixed(2)}`, ML + 310, y + 3, { width: 90, align: 'right' });
      y += 13; shade = !shade;
    }
    if (stub.bonus > 0)         { doc.font('Helvetica').fontSize(8).fillColor(DARK).text('Bonus', ML + 4, y + 3, { width: 160 }).text(`$${Number(stub.bonus).toFixed(2)}`, ML + 310, y + 3, { width: 90, align: 'right' }); y += 13; }
    if (stub.commission > 0)    { doc.font('Helvetica').fontSize(8).fillColor(DARK).text('Commission', ML + 4, y + 3, { width: 160 }).text(`$${Number(stub.commission).toFixed(2)}`, ML + 310, y + 3, { width: 90, align: 'right' }); y += 13; }
    if (stub.reimbursement > 0) { doc.font('Helvetica').fontSize(8).fillColor(DARK).text('Reimbursement', ML + 4, y + 3, { width: 160 }).text(`$${Number(stub.reimbursement).toFixed(2)}`, ML + 310, y + 3, { width: 90, align: 'right' }); y += 13; }

    doc.rect(ML, y, TW, 1).fill(BORDER); y += 6;

    // Deductions + Employer side by side
    const halfW = TW / 2 - 4;
    const leftX = ML, rightX = ML + TW / 2 + 4;

    function section(label, rows, x, startY) {
      doc.rect(x, startY, halfW, 14).fill('#f8fafc');
      doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY).text(label, x + 4, startY + 4);
      let sy = startY + 14;
      for (const [desc, amt] of rows) {
        if (amt !== 0) {
          doc.font('Helvetica').fontSize(8).fillColor(DARK)
            .text(desc, x + 4, sy + 2, { width: halfW - 80 })
            .text(`$${Number(amt).toFixed(2)}`, x + halfW - 76, sy + 2, { width: 72, align: 'right' });
          sy += 13;
        }
      }
      return sy;
    }

    const deductRows = [
      ['Federal Income Tax', stub.fit_withholding],
      ['Social Security (6.2%)', stub.employee_ss],
      ['Medicare (1.45%)', stub.employee_medicare],
      ['State Income Tax', stub.state_income_tax],
      ['Deductions', stub.deduction],
      ['Garnishments', stub.garnishment],
    ];
    const employerRows = [
      ['Social Security Match', stub.employer_ss],
      ['Medicare Match', stub.employer_medicare],
      ['FUTA (0.6%)', stub.futa_tax],
      ['SUI', stub.suta_tax],
    ];

    const lBottom = section('EMPLOYEE DEDUCTIONS', deductRows, leftX, y);
    const rBottom = section('EMPLOYER CONTRIBUTIONS', employerRows, rightX, y);
    y = Math.max(lBottom, rBottom) + 8;

    // Totals
    doc.rect(ML, y, TW, 1).fill(BORDER); y += 8;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK)
      .text('Gross Pay', ML + 4, y)
      .text(`$${Number(stub.gross_wages).toFixed(2)}`, ML + 4, y, { width: TW - 8, align: 'right' });
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text('Total Deductions', ML + 4, y)
      .text(`-$${Number(stub.fit_withholding + stub.employee_ss + stub.employee_medicare + (stub.state_income_tax || 0) + (stub.deduction || 0) + (stub.garnishment || 0)).toFixed(2)}`, ML + 4, y, { width: TW - 8, align: 'right' });
    y += 14;
    if (stub.reimbursement > 0) {
      doc.text('Reimbursements', ML + 4, y)
        .text(`+$${Number(stub.reimbursement).toFixed(2)}`, ML + 4, y, { width: TW - 8, align: 'right' });
      y += 14;
    }
    doc.rect(ML, y, TW, 1).fill(BORDER); y += 6;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT)
      .text('NET PAY', ML + 4, y)
      .text(`$${Number(stub.net_pay).toFixed(2)}`, ML + 4, y, { width: TW - 8, align: 'right' });
    y += 20;

    // Detach line
    const detachY = 480;
    doc.dash(4, { space: 4 }).rect(ML, detachY, TW, 0).stroke(BORDER).undash();
    doc.font('Helvetica').fontSize(7).fillColor(GRAY).text('✂  DETACH HERE  ✂', ML, detachY + 2, { width: TW, align: 'center' });

    // ── Check section (bottom) ────────────────────────────────────────────────
    const CY = detachY + 20;
    const CW = TW, CX = ML;

    // Company info (upper left)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(client.business_name, CX, CY);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY);
    if (client.business_address) doc.text(client.business_address, CX, CY + 13);
    const companyCity = [client.business_city, client.state, client.business_zip].filter(Boolean).join(', ');
    if (companyCity) doc.text(companyCity, CX, client.business_address ? CY + 23 : CY + 13);

    // Check number (upper right)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK)
      .text(stub.check_number ? `#${stub.check_number}` : '', CX, CY, { width: CW, align: 'right' });

    // Date
    const payDate = stub.settlement_date || stub.pay_period_end || new Date().toISOString().slice(0, 10);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text('Date:', CX + CW - 180, CY + 13)
      .font('Helvetica-Bold').fillColor(DARK).text(payDate, CX + CW - 150, CY + 13);

    let cy = CY + 48;

    // Pay to line
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('PAY TO THE ORDER OF', CX, cy);
    cy += 12;
    doc.rect(CX, cy, CW - 120, 22).stroke(BORDER);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(empName, CX + 6, cy + 6, { width: CW - 130 });

    // Amount box
    doc.rect(CX + CW - 114, cy, 114, 22).fill('#f8fafc').stroke(BORDER);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK)
      .text(`$${Number(stub.net_pay).toFixed(2)}`, CX + CW - 110, cy + 5, { width: 106, align: 'right' });

    cy += 30;

    // Amount in words
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('AMOUNT:', CX, cy);
    cy += 10;
    doc.rect(CX, cy, CW, 18).stroke(BORDER);
    const wordsLine = numberToWords(stub.net_pay) + ' ****';
    doc.font('Helvetica').fontSize(8.5).fillColor(DARK).text(wordsLine, CX + 6, cy + 4, { width: CW - 12 });
    cy += 28;

    // Memo line
    const memo = `Pay period: ${stub.pay_period_start} to ${stub.pay_period_end}`;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('MEMO:', CX, cy);
    doc.fillColor(DARK).text(memo, CX + 36, cy);

    // Signature line
    doc.rect(CX + CW - 160, cy + 20, 160, 1).fill(DARK);
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text('Authorized Signature', CX + CW - 160, cy + 24, { width: 160, align: 'center' });

    // Border around whole check
    doc.rect(CX - 4, CY - 8, CW + 8, PH - CY - ML + 8 - 10).stroke(BORDER);
  }

  doc.end();

  // Mark all checks in this run as 'printed'
  db.prepare(`
    UPDATE paystubs SET check_status = 'printed'
    WHERE payroll_run_id = ? AND client_id = ? AND check_status = 'draft'
  `).run(runId, clientId);
});

// taxType '941': aggregate FIT+SS+Medicare (optionally filtered by taxYear+taxQuarter)
// taxType '940': aggregate FUTA for the year (taxYear required)
router.post('/batch-submit', async (req, res) => {
  const { clientId, paystubIds, taxType = '941', taxYear, taxQuarter } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const pin = resolvePin(db, client.id, client.batch_provider_pin_encrypted);

  // Build query for pending paystubs based on taxType
  let pending;
  if (Array.isArray(paystubIds) && paystubIds.length > 0) {
    const ph = paystubIds.map(() => '?').join(',');
    if (taxType === '940') {
      pending = db.prepare(
        `SELECT * FROM paystubs WHERE client_id = ? AND status_940 IN ('pending','processing','failed') AND futa_tax > 0 AND id IN (${ph})`
      ).all(clientId, ...paystubIds);
    } else {
      pending = db.prepare(
        `SELECT * FROM paystubs WHERE client_id = ? AND status IN ('pending','processing','failed') AND id IN (${ph})`
      ).all(clientId, ...paystubIds);
    }
  } else if (taxType === '940') {
    const yearFilter = taxYear ? ' AND tax_year = ?' : '';
    pending = db.prepare(
      `SELECT * FROM paystubs WHERE client_id = ? AND status_940 IN ('pending','processing','failed') AND futa_tax > 0${yearFilter} ORDER BY pay_period_end ASC`
    ).all(...[clientId, taxYear].filter((v) => v !== undefined && v !== null));
  } else {
    // 941 — filter by quarter if provided
    if (taxYear && taxQuarter) {
      pending = db.prepare(
        "SELECT * FROM paystubs WHERE client_id = ? AND status IN ('pending','processing','failed') AND tax_year = ? AND tax_quarter = ? ORDER BY pay_period_end ASC"
      ).all(clientId, taxYear, taxQuarter);
    } else {
      pending = db.prepare(
        "SELECT * FROM paystubs WHERE client_id = ? AND status IN ('pending','processing','failed') ORDER BY pay_period_end ASC"
      ).all(clientId);
    }
  }

  if (pending.length === 0) {
    return res.status(400).json({ error: `No pending ${taxType} paystubs to submit` });
  }

  const ids = pending.map((p) => p.id);
  const firstStub = pending[0];

  // Mark processing
  const processingCol = taxType === '940' ? 'status_940' : 'status';
  db.prepare(`UPDATE paystubs SET ${processingCol} = 'processing' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);

  try {
    let result;
    const settlementDate = pending.find((p) => p.settlement_date)?.settlement_date || null;

    if (bridgeManager.isConnected) {
      const accountNumber = client.bank_account_number_encrypted
        ? decrypt(client.bank_account_number_encrypted) : null;
      if (!settlementDate) {
        db.prepare(`UPDATE paystubs SET ${processingCol} = 'pending' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
        return res.status(400).json({ error: 'At least one paystub must have a settlement date for ACH batch submission' });
      }
      const totalDeposit = taxType === '940'
        ? pending.reduce((s, p) => s + p.futa_tax, 0)
        : pending.reduce((s, p) => s + p.total_deposit, 0);

      const jobPayload = {
        submissionId:   `batch-${taxType}-${Date.now()}`,
        clientId:       client.id,
        ein:            client.ein,
        pin,
        eftpsEnrolled:  client.eftps_enrolled ? 1 : 0,
        businessName:   client.business_name,
        routingNumber:  client.bank_routing_number,
        accountNumber,
        accountType:    client.bank_account_type || 'checking',
        taxYear:        taxYear || firstStub.tax_year,
        taxQuarter:     taxType === '940' ? null : (taxQuarter || firstStub.tax_quarter),
        settlementDate,
        taxForm:        taxType,
        taxTypeCode:    taxType === '940' ? '94007' : '94105',
        taxData:        { totalDeposit: Math.round(totalDeposit * 100) / 100 },
      };

      const jobId = bridgeManager.queueJob(jobPayload, (success, msg) => {
        const dbInst = getDb();
        const ph = ids.map(() => '?').join(',');
        if (success) {
          const confirmation = msg.confirmation || msg.achFilePath || null;
          if (taxType === '940') {
            dbInst.prepare(`UPDATE paystubs SET status_940='submitted', eftps_940_confirmation=?, eftps_940_submitted_at=CURRENT_TIMESTAMP WHERE id IN (${ph})`).run(confirmation, ...ids);
          } else {
            dbInst.prepare(`UPDATE paystubs SET status='submitted', eftps_confirmation=?, submitted_at=CURRENT_TIMESTAMP, submission_error=NULL WHERE id IN (${ph})`).run(confirmation, ...ids);
          }
          // If the bridge generated a new PIN during enrollment, persist it and mark client enrolled
          if (msg.enrollmentPin) {
            try {
              const { encrypt: enc } = require('../services/cryptoService');
              dbInst.prepare('UPDATE clients SET batch_provider_pin_encrypted = ?, eftps_enrolled = 1 WHERE id = ?')
                .run(enc(msg.enrollmentPin), client.id);
              console.log(`[batch-submit] Client ${client.id} marked eftps_enrolled=1, PIN stored`);
            } catch (e) {
              console.error('[batch-submit] Failed to store enrollment PIN:', e.message);
            }
          }
        } else {
          const errMsg = msg.error || 'Bridge processing failed';
          if (taxType === '941') {
            dbInst.prepare(`UPDATE paystubs SET status='failed', submission_error=? WHERE id IN (${ph})`).run(errMsg, ...ids);
          } else {
            dbInst.prepare(`UPDATE paystubs SET status_940='failed' WHERE id IN (${ph})`).run(...ids);
          }
        }
      });

      return res.json({
        jobId,
        submitted: ids.length,
        taxType,
        totalDeposit: Math.round(totalDeposit * 100) / 100,
        status:  'processing',
        message: 'Bridge job queued — polling for updates',
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
        settlementDate,
        taxYear:         taxYear || firstStub.tax_year,
        taxQuarter:      taxType === '940' ? null : (taxQuarter || firstStub.tax_quarter),
        taxForm:         taxType,
        taxData: taxType === '940'
          ? { futaTax: pending.reduce((s, p) => s + p.futa_tax, 0) }
          : {
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
      if (taxType === '940') {
        db.prepare(`
          UPDATE paystubs SET
            status_940 = 'submitted',
            eftps_940_confirmation = ?,
            eftps_940_submitted_at = CURRENT_TIMESTAMP
          WHERE id IN (${ids.map(() => '?').join(',')})
        `).run(confirmation, ...ids);
      } else {
        db.prepare(`
          UPDATE paystubs SET
            status = 'submitted',
            eftps_confirmation = ?,
            submitted_at = CURRENT_TIMESTAMP,
            submission_error = NULL
          WHERE id IN (${ids.map(() => '?').join(',')})
        `).run(confirmation, ...ids);
      }
    } else {
      db.prepare(`
        UPDATE paystubs SET ${processingCol} = 'failed'${taxType === '941' ? ', submission_error = ?' : ''}
        WHERE id IN (${ids.map(() => '?').join(',')})
      `).run(...(taxType === '941' ? [result.error] : []), ...ids);
    }

    const updated = db.prepare(`SELECT * FROM paystubs WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const totalAmount = taxType === '940'
      ? pending.reduce((s, p) => s + p.futa_tax, 0)
      : pending.reduce((s, p) => s + p.total_deposit, 0);

    res.json({
      submitted: ids.length,
      taxType,
      totalDeposit: Math.round(totalAmount * 100) / 100,
      confirmation,
      paystubs: updated,
      result,
    });
  } catch (err) {
    db.prepare(`UPDATE paystubs SET ${processingCol} = 'failed'${taxType === '941' ? ", submission_error = ?" : ''} WHERE id IN (${ids.map(() => '?').join(',')})`).run(...(taxType === '941' ? [err.message] : []), ...ids);
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

  const W      = 612 - 80;
  const ACCENT = '#1a56db';
  const GRAY   = '#6b7280';
  const DARK   = '#111827';
  const BORDER = '#e5e7eb';

  function fmtMoney(n) { return `$${Number(n || 0).toFixed(2)}`; }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  doc.rect(40, 40, W, 56).fill(ACCENT);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(16)
    .text(stub.business_name || 'Company Name', 52, 52, { width: W - 130 });
  doc.font('Helvetica').fontSize(9)
    .text(`EIN: ${stub.ein || '—'}`, 52, 72);
  doc.font('Helvetica-Bold').fontSize(11)
    .text('EARNINGS STATEMENT', 52, 85, { align: 'right', width: W - 12 });

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
  kv('Check #',  stub.check_number ? `#${stub.check_number}` : `Q${stub.tax_quarter || '—'} ${stub.tax_year || ''}`, 40 + col * 3, y);

  y += 32;
  doc.rect(40, y, W, 1).fill(BORDER);
  y += 6;

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

  doc.rect(40, y, W, 18).fill('#eff6ff');
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ACCENT)
    .text('Gross Wages', 44, y + 4, { width: W * 0.75 - 4 })
    .text(fmtMoney(stub.gross_wages), 44 + W * 0.75, y + 4, { width: W * 0.25 - 4, align: 'right' });
  y += 18;
  y += 10;

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
    ['SS Match (6.2%)',        fmtMoney(stub.employer_ss)],
    ['Medicare Match (1.45%)', fmtMoney(stub.employer_medicare)],
  ];
  if (stub.futa_tax > 0) emplTaxRows.push(['FUTA (0.6%)',             fmtMoney(stub.futa_tax)]);
  if (stub.suta_tax > 0) emplTaxRows.push([`SUI — ${stub.work_state || ''}`, fmtMoney(stub.suta_tax)]);

  const leftBottom  = miniSection('Employee Deductions', empDeductRows,  40,              y, halfW);
  const rightBottom = miniSection('Employer Taxes',      emplTaxRows,    40 + halfW + 12, y, halfW);
  y = Math.max(leftBottom, rightBottom) + 10;

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
  totalRow('Total EFTPS 941 Deposit', fmtMoney(stub.total_deposit), false);
  if (stub.futa_tax > 0) {
    y += 2;
    totalRow('FUTA / 940 Deposit', fmtMoney(stub.futa_tax), false);
  }

  if (ytd) {
    y += 12;
    doc.rect(40, y, W, 1).fill(BORDER);
    y += 8;
    y = sectionHeader('Year-to-Date Summary', y);
    const ytdCols = [
      { label: 'Gross Wages', width: W * 0.25, align: 'right' },
      { label: 'SS Wages',    width: W * 0.25, align: 'right' },
      { label: 'FUTA Wages',  width: W * 0.25, align: 'right' },
      { label: 'SUI Wages',   width: W * 0.25, align: 'right' },
    ];
    y = tableHeader(ytdCols, y);
    y = tableRow(ytdCols, [
      fmtMoney(ytd.ytd_gross),
      fmtMoney(ytd.ytd_ss_wages),
      fmtMoney(ytd.ytd_futa_wages),
      fmtMoney(ytd.ytd_suta_wages),
    ], y, false);
  }

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

// ── PUT /api/paystubs/:id/status ─────────────────────────────────────────────
router.put('/:id/status', (req, res) => {
  const db = getDb();
  const stub = db.prepare(`
    SELECT p.* FROM paystubs p
    JOIN clients c ON p.client_id = c.id
    WHERE p.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!stub) return res.status(404).json({ error: 'Paystub not found' });

  const { status } = req.body;

  // EFTPS submission statuses → update the status column (drives liability view)
  if (['submitted', 'pending', 'failed'].includes(status)) {
    db.prepare('UPDATE paystubs SET status = ? WHERE id = ?').run(status, stub.id);
    return res.json({ id: parseInt(req.params.id), status });
  }

  // Check lifecycle statuses → update check_status column
  const checkAllowed = ['draft', 'printed', 'direct_deposit_sent', 'direct_deposit_cleared', 'voided', 'late'];
  if (!checkAllowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare('UPDATE paystubs SET check_status = ? WHERE id = ?').run(status, stub.id);
  res.json({ id: parseInt(req.params.id), checkStatus: status });
});

// ── POST /api/paystubs/:id/void ──────────────────────────────────────────────
router.post('/:id/void', (req, res) => {
  const db = getDb();
  const stub = db.prepare(`
    SELECT p.* FROM paystubs p
    JOIN clients c ON p.client_id = c.id
    WHERE p.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!stub) return res.status(404).json({ error: 'Paystub not found' });
  if (stub.check_status === 'voided') return res.status(400).json({ error: 'Already voided' });

  const { reason } = req.body;
  const now = new Date().toISOString();

  db.transaction(() => {
    // Mark paystub as voided
    db.prepare(`
      UPDATE paystubs SET check_status = 'voided', voided_at = ?, void_reason = ? WHERE id = ?
    `).run(now, reason || null, stub.id);

    // Create negative credit entry
    db.prepare(`
      INSERT INTO paystub_credits (
        client_id, employee_id, employee_name, reference_stub_id,
        gross_credit, fit_credit, employee_ss_credit, employee_medicare_credit,
        employer_ss_credit, employer_medicare_credit, state_tax_credit,
        futa_credit, suta_credit, total_941_credit, total_940_credit
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      stub.client_id, stub.employee_id, stub.employee_name, stub.id,
      -(stub.gross_wages || 0),
      -(stub.fit_withholding || 0),
      -(stub.employee_ss || 0),
      -(stub.employee_medicare || 0),
      -(stub.employer_ss || 0),
      -(stub.employer_medicare || 0),
      -(stub.state_income_tax || 0),
      -(stub.futa_tax || 0),
      -(stub.suta_tax || 0),
      -(stub.total_deposit || 0),
      -(stub.futa_tax || 0),
    );

    // Reverse YTD wages
    const year = stub.tax_year || new Date().getFullYear();
    db.prepare(`
      UPDATE employee_ytd_wages SET
        ytd_gross      = MAX(0, ytd_gross      - ?),
        ytd_ss_wages   = MAX(0, ytd_ss_wages   - ?),
        ytd_futa_wages = MAX(0, ytd_futa_wages - ?),
        ytd_suta_wages = MAX(0, ytd_suta_wages - ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE employee_id = ? AND tax_year = ?
    `).run(
      stub.gross_wages || 0, stub.gross_wages || 0,
      stub.gross_wages || 0, stub.gross_wages || 0,
      stub.employee_id, year,
    );
  })();

  res.json({ message: 'Check voided and credit entry created', stubId: stub.id });
});

module.exports = router;
