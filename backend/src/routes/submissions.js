const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { calculateWithholding, getTaxPeriod } = require('../services/taxCalculator');
const { submitToEFTPS } = require('../services/eftpsAutomation');
const { decrypt } = require('../services/cryptoService');
const bridgeManager = require('../ws/bridge');

const router = express.Router();
router.use(requireAuth);

function attachLineItems(db, submissions) {
  if (!Array.isArray(submissions)) {
    const items = db.prepare('SELECT * FROM pay_line_items WHERE submission_id = ?').all(submissions.id);
    return { ...submissions, lineItems: items };
  }
  return submissions.map((s) => {
    const items = db.prepare('SELECT * FROM pay_line_items WHERE submission_id = ?').all(s.id);
    return { ...s, lineItems: items };
  });
}

// GET /api/submissions?clientId=X
router.get('/', (req, res) => {
  const db = getDb();
  const { clientId } = req.query;

  if (clientId) {
    const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
  }

  const query = clientId
    ? `SELECT s.*, c.business_name, e.first_name, e.last_name
       FROM submissions s
       JOIN clients c ON s.client_id = c.id
       LEFT JOIN employees e ON s.employee_id = e.id
       WHERE s.client_id = ? AND c.user_id = ? ORDER BY s.created_at DESC`
    : `SELECT s.*, c.business_name, e.first_name, e.last_name
       FROM submissions s
       JOIN clients c ON s.client_id = c.id
       LEFT JOIN employees e ON s.employee_id = e.id
       WHERE c.user_id = ? ORDER BY s.created_at DESC LIMIT 100`;

  const rows = clientId
    ? db.prepare(query).all(clientId, req.user.id)
    : db.prepare(query).all(req.user.id);

  res.json(attachLineItems(db, rows));
});

// GET /api/submissions/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const sub = db
    .prepare(`SELECT s.*, c.business_name, e.first_name, e.last_name
              FROM submissions s
              JOIN clients c ON s.client_id = c.id
              LEFT JOIN employees e ON s.employee_id = e.id
              WHERE s.id = ? AND c.user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  res.json(attachLineItems(db, sub));
});

// POST /api/submissions — create (calculate + save)
router.post('/', (req, res) => {
  const {
    clientId,
    employeeId,
    payPeriodStart,
    payPeriodEnd,
    settlementDate,
    filingStatus,
    payFrequency,
    step2Checkbox,
    step3Children,
    step3Other,
    step4a,
    step4b,
    step4c,
    lineItems,     // array of { payType, description, hours, rate, amount }
    grossWages,    // fallback if no lineItems
  } = req.body;

  if (!clientId || !payPeriodStart || !payPeriodEnd || !filingStatus || !payFrequency) {
    return res.status(400).json({ error: 'clientId, payPeriodStart, payPeriodEnd, filingStatus, payFrequency required' });
  }

  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Gross wages = sum of line items or explicit value
  const items = Array.isArray(lineItems) && lineItems.length > 0 ? lineItems : null;
  const computedGross = items
    ? items.reduce((sum, li) => sum + parseFloat(li.amount || 0), 0)
    : parseFloat(grossWages || 0);

  if (!computedGross || computedGross <= 0) {
    return res.status(400).json({ error: 'Gross wages must be greater than 0 (add pay line items or set grossWages)' });
  }

  const taxes = calculateWithholding({
    grossWages:    computedGross,
    payFrequency,
    filingStatus,
    step2Checkbox: !!step2Checkbox,
    step3Children: parseInt(step3Children || 0, 10),
    step3Other:    parseInt(step3Other    || 0, 10),
    step4a: parseFloat(step4a || 0),
    step4b: parseFloat(step4b || 0),
    step4c: parseFloat(step4c || 0),
  });

  const step3Credits = (parseInt(step3Children || 0, 10) * 2200) + (parseInt(step3Other || 0, 10) * 500);
  const { quarter, year } = getTaxPeriod(payPeriodEnd);

  const result = db.prepare(`
    INSERT INTO submissions (
      client_id, employee_id, pay_period_start, pay_period_end, settlement_date,
      gross_wages, filing_status, pay_frequency,
      step2_checkbox, step3_children, step3_other, step3_credits,
      step4a, step4b, step4c,
      fit_withholding, employee_ss, employee_medicare, employer_ss, employer_medicare,
      total_deposit, net_pay, tax_year, tax_quarter, eftps_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    clientId,
    employeeId || null,
    payPeriodStart,
    payPeriodEnd,
    settlementDate || null,
    taxes.grossWages,
    filingStatus,
    payFrequency,
    step2Checkbox ? 1 : 0,
    parseInt(step3Children || 0, 10),
    parseInt(step3Other    || 0, 10),
    step3Credits,
    parseFloat(step4a || 0),
    parseFloat(step4b || 0),
    parseFloat(step4c || 0),
    taxes.fitWithholding,
    taxes.employeeSS,
    taxes.employeeMedicare,
    taxes.employerSS,
    taxes.employerMedicare,
    taxes.totalDeposit,
    taxes.netPay,
    year,
    quarter,
  );

  const subId = result.lastInsertRowid;

  // Save line items
  if (items) {
    const insertItem = db.prepare(`
      INSERT INTO pay_line_items (submission_id, pay_type, description, hours, rate, amount)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const li of items) {
      insertItem.run(
        subId,
        li.payType || 'regular',
        li.description || null,
        li.hours ? parseFloat(li.hours) : null,
        li.rate  ? parseFloat(li.rate)  : null,
        parseFloat(li.amount || 0),
      );
    }
  }

  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId);
  const lineItemsOut = db.prepare('SELECT * FROM pay_line_items WHERE submission_id = ?').all(subId);
  res.status(201).json({ ...submission, lineItems: lineItemsOut });
});

// POST /api/submissions/:id/submit — trigger EFTPS Playwright automation
router.post('/:id/submit', async (req, res) => {
  const db = getDb();
  const sub = db
    .prepare(`SELECT s.*, c.ein, c.eftps_pin_encrypted, c.eftps_internet_password_encrypted,
                     c.eftps_enrollment_number, c.deposit_schedule
              FROM submissions s
              JOIN clients c ON s.client_id = c.id
              WHERE s.id = ? AND c.user_id = ?`)
    .get(req.params.id, req.user.id);

  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  if (sub.eftps_status === 'submitted') return res.status(400).json({ error: 'Already submitted to EFTPS' });

  const pin = decrypt(sub.eftps_pin_encrypted);
  if (!pin) return res.status(400).json({ error: 'EFTPS PIN not configured for this client' });

  const internetPassword = sub.eftps_internet_password_encrypted
    ? decrypt(sub.eftps_internet_password_encrypted) : null;

  db.prepare("UPDATE submissions SET eftps_status = 'processing' WHERE id = ?").run(sub.id);

  try {
    const result = await submitToEFTPS({
      ein:             sub.ein,
      pin,
      internetPassword,
      enrollmentNumber: sub.eftps_enrollment_number || null,
      payPeriodEnd:    sub.pay_period_end,
      settlementDate:  sub.settlement_date || null,
      taxYear:         sub.tax_year,
      taxQuarter:      sub.tax_quarter,
      taxData: {
        fitWithholding:   sub.fit_withholding,
        employeeSS:       sub.employee_ss,
        employeeMedicare: sub.employee_medicare,
        employerSS:       sub.employer_ss,
        employerMedicare: sub.employer_medicare,
      },
    });

    if (result.success) {
      db.prepare(`
        UPDATE submissions SET
          eftps_status = ?,
          eftps_confirmation = ?,
          eftps_submitted_at = CURRENT_TIMESTAMP,
          submission_error = NULL
        WHERE id = ?
      `).run(result.dryRun ? 'dry_run' : 'submitted', result.confirmation || result.message, sub.id);
    } else {
      db.prepare("UPDATE submissions SET eftps_status = 'failed', submission_error = ? WHERE id = ?")
        .run(result.error, sub.id);
    }

    const updated = db.prepare('SELECT * FROM submissions WHERE id = ?').get(sub.id);
    res.json({ submission: updated, eftpsResult: result });
  } catch (err) {
    db.prepare("UPDATE submissions SET eftps_status = 'failed', submission_error = ? WHERE id = ?")
      .run(err.message, sub.id);
    res.status(500).json({ error: 'EFTPS automation error', details: err.message });
  }
});

// POST /api/submissions/:id/submit-bridge — send job to local ACH bridge
router.post('/:id/submit-bridge', async (req, res) => {
  if (!bridgeManager.isConnected) {
    return res.status(503).json({ error: 'ACH Bridge is not connected. Start the bridge service on Computer 2.' });
  }

  const db = getDb();
  const sub = db
    .prepare(`SELECT s.*, c.ein, c.business_name,
                     c.bank_routing_number, c.bank_account_number_encrypted, c.bank_account_type,
                     c.eftps_enrollment_number
              FROM submissions s
              JOIN clients c ON s.client_id = c.id
              WHERE s.id = ? AND c.user_id = ?`)
    .get(req.params.id, req.user.id);

  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  if (sub.eftps_status === 'submitted') return res.status(400).json({ error: 'Already submitted' });

  const bankAccountNumber = sub.bank_account_number_encrypted
    ? decrypt(sub.bank_account_number_encrypted) : null;

  if (!sub.bank_routing_number || !bankAccountNumber) {
    return res.status(400).json({ error: 'Bank account details not configured for this client' });
  }
  if (!sub.settlement_date) {
    return res.status(400).json({ error: 'Settlement date is required for ACH bridge submission' });
  }

  db.prepare("UPDATE submissions SET eftps_status = 'processing' WHERE id = ?").run(sub.id);

  try {
    const result = await bridgeManager.sendJob({
      submissionId:      sub.id,
      ein:               sub.ein,
      businessName:      sub.business_name,
      bankRoutingNumber: sub.bank_routing_number,
      bankAccountNumber: bankAccountNumber,
      bankAccountType:   sub.bank_account_type || 'checking',
      settlementDate:    sub.settlement_date,
      taxYear:           sub.tax_year,
      taxQuarter:        sub.tax_quarter,
      taxData: {
        fitWithholding:   sub.fit_withholding,
        employeeSS:       sub.employee_ss,
        employeeMedicare: sub.employee_medicare,
        employerSS:       sub.employer_ss,
        employerMedicare: sub.employer_medicare,
        totalDeposit:     sub.total_deposit,
      },
    });

    db.prepare(`
      UPDATE submissions SET
        eftps_status = 'submitted',
        eftps_confirmation = ?,
        eftps_submitted_at = CURRENT_TIMESTAMP,
        submission_error = NULL
      WHERE id = ?
    `).run(result.confirmation || result.achFilePath, sub.id);

    const updated = db.prepare('SELECT * FROM submissions WHERE id = ?').get(sub.id);
    res.json({ submission: updated, bridgeResult: result });

  } catch (err) {
    db.prepare("UPDATE submissions SET eftps_status = 'failed', submission_error = ? WHERE id = ?")
      .run(err.message, sub.id);
    res.status(500).json({ error: 'ACH bridge error', details: err.message });
  }
});

module.exports = router;
