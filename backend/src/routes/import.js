const express = require('express');
const multer  = require('multer');
const xlsx    = require('xlsx');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { encrypt } = require('../services/cryptoService');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseQbEmployeeRow(row) {
  // Split "FIRST LAST" — first word = first name, rest = last name
  const fullName = (row['Employee'] || '').trim();
  const spaceIdx = fullName.indexOf(' ');
  const firstName = spaceIdx > -1 ? fullName.slice(0, spaceIdx) : fullName;
  const lastName  = spaceIdx > -1 ? fullName.slice(spaceIdx + 1) : '';

  // QB Desktop exports SSN as "SS No." — value may be a string "XXX-XX-XXXX"
  // or a raw number 123456789 if Excel stripped the dashes.
  const ssnRaw = row['SS No.'] ?? row['SS#'] ?? row['SSN'] ?? row['Social Security Number'] ?? '';
  let ssn = '';
  if (typeof ssnRaw === 'number') {
    // Zero-pad to 9 digits, then format as XXX-XX-XXXX
    const digits = String(ssnRaw).padStart(9, '0');
    ssn = `${digits.slice(0,3)}-${digits.slice(3,5)}-${digits.slice(5)}`;
  } else {
    ssn = String(ssnRaw).trim();
  }

  // Address field in QB exports includes "STREET CITY, ST ZIP" — strip city/state/zip suffix
  let address = (row['Address'] || '').trim();
  const city  = (row['City']  || '').trim();
  const state = (row['State'] || '').trim();
  const zip   = String(row['Zip'] || '').trim();
  if (city && address.toUpperCase().includes(city.toUpperCase())) {
    const suffix = ` ${city}`.toUpperCase();
    const idx = address.toUpperCase().lastIndexOf(suffix);
    if (idx > 0) address = address.slice(0, idx).trim();
  }

  // Date of Birth is an Excel serial number — convert for display only (not stored)
  let dob = '';
  if (row['Date of Birth'] && typeof row['Date of Birth'] === 'number') {
    const d = xlsx.SSF.parse_date_code(row['Date of Birth']);
    if (d) dob = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }

  return { firstName, lastName, ssn, address, city, state, zip, dob };
}

// POST /api/import/employees/preview
// Body: multipart with field "file" (xlsx/csv) and "clientId"
router.post('/employees/preview', upload.single('file'), (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const db = getDb();
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });

    // Use second sheet if first is QuickBooks tips sheet, otherwise first sheet
    let sheetName = wb.SheetNames[0];
    if (wb.SheetNames.length > 1 && sheetName.toLowerCase().includes('quickbooks')) {
      sheetName = wb.SheetNames[1];
    }
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
    if (rows[0]) console.log('[import preview] columns:', Object.keys(rows[0]), '| SS No. sample:', rows[0]['SS No.'], typeof rows[0]['SS No.']);

    const existing = db.prepare('SELECT first_name, last_name FROM employees WHERE client_id = ?').all(clientId);
    const existingNames = new Set(existing.map(e => `${e.first_name}|${e.last_name}`.toUpperCase()));

    const preview = rows
      .map(row => parseQbEmployeeRow(row))
      .filter(r => r.firstName && r.lastName)
      .map(r => ({
        ...r,
        alreadyExists: existingNames.has(`${r.firstName}|${r.lastName}`.toUpperCase()),
      }));

    res.json({ count: preview.length, rows: preview });
  } catch (err) {
    res.status(400).json({ error: `Could not parse file: ${err.message}` });
  }
});

// POST /api/import/employees
// Body: multipart with field "file" (xlsx/csv), "clientId", optional "skipExisting"
router.post('/employees', upload.single('file'), (req, res) => {
  const { clientId, skipExisting } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });

    let sheetName = wb.SheetNames[0];
    if (wb.SheetNames.length > 1 && sheetName.toLowerCase().includes('quickbooks')) {
      sheetName = wb.SheetNames[1];
    }
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

    const existing = db.prepare('SELECT first_name, last_name FROM employees WHERE client_id = ?').all(clientId);
    const existingNames = new Set(existing.map(e => `${e.first_name}|${e.last_name}`.toUpperCase()));

    const insert = db.prepare(`
      INSERT INTO employees
        (client_id, first_name, last_name, ssn_encrypted, address, city, state, zip, work_state,
         filing_status, pay_type, hourly_rate, annual_salary, pay_frequency, is_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
    `);

    const insertMany = db.transaction((records) => {
      let imported = 0, skipped = 0;
      for (const r of records) {
        const key = `${r.firstName}|${r.lastName}`.toUpperCase();
        if (skipExisting === 'true' && existingNames.has(key)) { skipped++; continue; }
        const homeState = r.state || client.state || 'TX';
        insert.run(
          clientId,
          r.firstName,
          r.lastName,
          r.ssn ? encrypt(r.ssn) : null,
          r.address || null,
          r.city    || null,
          homeState,
          r.zip     || null,
          homeState,  // work_state defaults to same as home state
          'single',
          'hourly',
          0,
          0,
          client.payroll_frequency || 'biweekly',
        );
        imported++;
      }
      return { imported, skipped };
    });

    const parsed = rows
      .map(row => parseQbEmployeeRow(row))
      .filter(r => r.firstName && r.lastName);

    const result = insertMany(parsed);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  }
});

// ── Paycheck import (QB Tax Tracking Detail export) ──────────────────────────

function xlsxDateToStr(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const d = xlsx.SSF.parse_date_code(serial);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
}

function subtractDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function freqDays(freq) {
  if (freq === 'weekly') return 7;
  if (freq === 'semimonthly') return 15;
  if (freq === 'monthly') return 30;
  return 14; // biweekly default
}

function buildChecks(wb, employees, client) {
  // Find the Detail Data sheet
  const sheetName = wb.SheetNames.find(n => n === 'Detail Data') || wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

  // Build employee lookup: full name variants → employee record
  // Handles "FIRST LAST", "FIRST MIDDLE LAST", "FIRST MI LAST", etc.
  function findEmployee(qbName) {
    const upper = (qbName || '').toUpperCase().trim();
    // 1. Exact match on "FIRST LAST"
    for (const e of employees) {
      const exact = `${e.first_name} ${e.last_name}`.toUpperCase();
      if (upper === exact) return e;
    }
    // 2. Exact match with middle name "FIRST MIDDLE LAST"
    for (const e of employees) {
      if (e.middle_name) {
        const withMiddle = `${e.first_name} ${e.middle_name} ${e.last_name}`.toUpperCase();
        if (upper === withMiddle) return e;
      }
    }
    // 3. Fuzzy: first name AND last name both present as substrings (handles middle initials)
    for (const e of employees) {
      const fn = e.first_name.toUpperCase();
      const ln = e.last_name.toUpperCase();
      if (upper.includes(fn) && upper.includes(ln)) return e;
    }
    return null;
  }

  // Group rows by Trans ID
  const byTrans = {};
  rows.forEach(r => {
    const tid = r['Trans ID'];
    if (!tid || r['Type'] !== 'Paycheck') return;
    if (!byTrans[tid]) byTrans[tid] = [];
    byTrans[tid].push(r);
  });

  const checks = [];
  for (const [tid, items] of Object.entries(byTrans)) {
    const first = items[0];
    const emp = findEmployee(first['Name']);
    const checkDate = xlsxDateToStr(first['Date']);
    if (!checkDate) continue;

    const sum = (type) => items
      .filter(r => r['Tax Tracking Type'] === type)
      .reduce((s, r) => s + (Number(r['Amount']) || 0), 0);

    const compensation = sum('Compensation');
    const tips         = sum('Reported Tips');
    const grossWages   = compensation + tips;
    const fit          = Math.abs(sum('Federal Withholding'));
    const eeSS         = Math.abs(sum('Social Security Employee'));
    const eeMedicare   = Math.abs(sum('Medicare Employee'));
    const addlMedicare = Math.abs(sum('Medicare Additional Tax'));
    const erSS         = Math.abs(sum('Social Security Company'));
    const erMedicare   = Math.abs(sum('Medicare Company'));
    const futa         = Math.abs(sum('FUTA'));
    const suta         = Math.abs(sum('SUI Company'));
    const netPay       = grossWages - fit - eeSS - eeMedicare - addlMedicare;
    const totalDeposit = fit + eeSS + eeMedicare + addlMedicare + erSS + erMedicare;

    const freq = emp ? (emp.pay_frequency || 'biweekly') : 'biweekly';
    const periodDays = freqDays(freq);
    const periodEnd   = subtractDays(checkDate, 2);
    const periodStart = subtractDays(periodEnd, periodDays - 1);

    const checkDate_d = new Date(checkDate + 'T00:00:00Z');
    const taxYear    = checkDate_d.getUTCFullYear();
    const taxQuarter = Math.ceil((checkDate_d.getUTCMonth() + 1) / 3);

    checks.push({
      transId:       tid,
      checkNumber:   first['Doc Num'] || null,
      checkDate,
      periodStart,
      periodEnd,
      empName:       first['Name'],
      employeeId:    emp ? emp.id : null,
      empMatched:    !!emp,
      grossWages:    round2(grossWages),
      compensation:  round2(compensation),
      reportedTips:  round2(tips),
      fit:           round2(fit),
      eeSS:          round2(eeSS),
      eeMedicare:    round2(eeMedicare),
      addlMedicare:  round2(addlMedicare),
      erSS:          round2(erSS),
      erMedicare:    round2(erMedicare),
      futa:          round2(futa),
      suta:          round2(suta),
      netPay:        round2(netPay),
      totalDeposit:  round2(totalDeposit),
      taxYear,
      taxQuarter,
      filingStatus:  emp ? (emp.filing_status || 'single') : 'single',
      payFrequency:  freq,
      workState:     emp ? (emp.work_state || emp.state || client.state || 'TX') : (client.state || 'TX'),
    });
  }
  return checks;
}

function round2(n) { return Math.round(n * 100) / 100; }

// POST /api/import/paychecks/preview
router.post('/paychecks/preview', upload.single('file'), (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const employees = db.prepare('SELECT * FROM employees WHERE client_id = ?').all(clientId);
    const existing = new Set(
      db.prepare('SELECT check_number FROM paystubs WHERE client_id = ? AND check_number IS NOT NULL').all(clientId).map(r => String(r.check_number))
    );
    const checks = buildChecks(wb, employees, client).map(c => ({
      ...c,
      alreadyExists: existing.has(String(c.checkNumber)),
    }));
    res.json({ count: checks.length, checks });
  } catch (err) {
    res.status(400).json({ error: `Could not parse file: ${err.message}` });
  }
});

// POST /api/import/paychecks
router.post('/paychecks', upload.single('file'), (req, res) => {
  const { clientId, skipExisting, checkStatus, liabilityStatus } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const employees = db.prepare('SELECT * FROM employees WHERE client_id = ?').all(clientId);
    const existing = new Set(
      db.prepare('SELECT check_number FROM paystubs WHERE client_id = ? AND check_number IS NOT NULL').all(clientId).map(r => String(r.check_number))
    );
    // Dedup by (employee_name, pay_period_start, pay_period_end) — catches re-imports
    // of the same pay period for the same person even when check numbers differ
    const existingPeriods = new Set(
      db.prepare('SELECT employee_name, pay_period_start, pay_period_end FROM paystubs WHERE client_id = ?')
        .all(clientId)
        .map(r => `${(r.employee_name||'').toLowerCase()}|${r.pay_period_start||''}|${r.pay_period_end||''}`)
    );
    const checks = buildChecks(wb, employees, client);

    const insert = db.prepare(`
      INSERT INTO paystubs (
        client_id, employee_id, employee_name,
        pay_period_start, pay_period_end, settlement_date, pay_frequency, filing_status, work_state,
        gross_wages, fit_withholding, employee_ss, employee_medicare, additional_medicare,
        employer_ss, employer_medicare, futa_tax, suta_tax,
        total_deposit, net_pay, tax_year, tax_quarter,
        check_number, check_status, status, status_940, reported_tips
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const insertLineItem = db.prepare(`
      INSERT INTO paystub_line_items (paystub_id, pay_type, description, hours, rate, amount)
      VALUES (?, ?, ?, NULL, NULL, ?)
    `);

    const getExistingStub  = db.prepare('SELECT id, reported_tips FROM paystubs WHERE client_id = ? AND check_number = ?');
    const hasTipItem       = db.prepare("SELECT id FROM paystub_line_items WHERE paystub_id = ? AND pay_type = 'tips'");
    const patchTips        = db.prepare('UPDATE paystubs SET reported_tips = ? WHERE id = ?');

    const VALID_CHECK_STATUSES = ['draft', 'printed', 'deposited', 'direct_deposit_sent', 'direct_deposit_cleared', 'late'];
    const VALID_LIABILITY_STATUSES = ['pending', 'submitted'];
    const resolvedCheckStatus     = VALID_CHECK_STATUSES.includes(checkStatus) ? checkStatus : 'printed';
    const resolvedLiabilityStatus = VALID_LIABILITY_STATUSES.includes(liabilityStatus) ? liabilityStatus : 'pending';

    const importAll = db.transaction((rows) => {
      let imported = 0, skipped = 0, patched = 0;
      for (const c of rows) {
        // Skip if same check number already exists
        if (skipExisting === 'true' && existing.has(String(c.checkNumber))) {
          // Patch reported_tips and tip line item on existing checks when missing
          if (c.reportedTips > 0) {
            const existingStub = getExistingStub.get(clientId, c.checkNumber);
            if (existingStub && !(existingStub.reported_tips > 0)) {
              patchTips.run(c.reportedTips, existingStub.id);
              if (!hasTipItem.get(existingStub.id)) {
                insertLineItem.run(existingStub.id, 'tips', 'Reported Tips', c.reportedTips);
              }
              patched++;
            }
          }
          skipped++;
          continue;
        }
        // Skip if same employee + same pay period already exists (catches re-imports
        // of the same period even when check numbers differ or are missing)
        const periodKey = `${(c.empName||'').toLowerCase()}|${c.periodStart||''}|${c.periodEnd||''}`;
        if (existingPeriods.has(periodKey)) {
          skipped++;
          continue;
        }
        // Track this period so duplicate rows within the same import file are also caught
        existingPeriods.add(periodKey);
        const r = insert.run(
          clientId, c.employeeId || null, c.empName,
          c.periodStart, c.periodEnd, c.checkDate, c.payFrequency, c.filingStatus, c.workState,
          c.grossWages, c.fit, c.eeSS, c.eeMedicare, c.addlMedicare,
          c.erSS, c.erMedicare, c.futa, c.suta,
          c.totalDeposit, c.netPay, c.taxYear, c.taxQuarter,
          c.checkNumber, resolvedCheckStatus, resolvedLiabilityStatus, resolvedLiabilityStatus, c.reportedTips || 0
        );
        const stubId = r.lastInsertRowid;
        if (c.compensation > 0) insertLineItem.run(stubId, 'regular', 'Compensation', c.compensation);
        if (c.reportedTips > 0) insertLineItem.run(stubId, 'tips', 'Reported Tips', c.reportedTips);
        imported++;
      }
      return { imported, skipped, patched };
    });

    const result = importAll(checks);

    // Re-link any still-unlinked paystubs using fuzzy first+last name matching.
    // Handles the case where paychecks were imported before employees existed.
    try {
      const allEmps = db.prepare('SELECT id, first_name, last_name FROM employees WHERE client_id = ?').all(clientId);
      let linked = 0;
      for (const e of allEmps) {
        const fn = e.first_name.toUpperCase();
        const ln = e.last_name.toUpperCase();
        const { changes } = db.prepare(
          `UPDATE paystubs SET employee_id=? WHERE client_id=? AND employee_id IS NULL AND UPPER(employee_name) LIKE ? AND UPPER(employee_name) LIKE ?`
        ).run(e.id, clientId, `%${fn}%`, `%${ln}%`);
        linked += changes;
      }
      if (linked > 0) result.linked = linked;
    } catch (_) {}

    // Update employee_ytd_wages for all linked imported paystubs.
    // Without this, new paychecks created after import would use ytd=0, producing wrong FUTA/SS calculations.
    try {
      const upsertYtd = db.prepare(`
        INSERT INTO employee_ytd_wages (employee_id, tax_year, ytd_gross, ytd_ss_wages, ytd_futa_wages, ytd_suta_wages)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, tax_year) DO UPDATE SET
          ytd_gross      = ytd_gross      + excluded.ytd_gross,
          ytd_ss_wages   = ytd_ss_wages   + excluded.ytd_ss_wages,
          ytd_futa_wages = ytd_futa_wages + excluded.ytd_futa_wages,
          ytd_suta_wages = ytd_suta_wages + excluded.ytd_suta_wages,
          updated_at     = CURRENT_TIMESTAMP
      `);
      // Only count newly imported checks (not skipped/existing ones)
      const imported = checks.filter(c => {
        const key = `${(c.empName||'').toLowerCase()}|${c.periodStart||''}|${c.periodEnd||''}`;
        return c.employeeId; // only linked checks
      });
      // Re-query newly inserted stubs to get final employee_id (after re-link)
      const newStubs = db.prepare(
        `SELECT employee_id, tax_year, gross_wages, employee_ss, futa_tax, suta_tax
         FROM paystubs WHERE client_id=? AND created_at >= datetime('now','-1 minute') AND employee_id IS NOT NULL`
      ).all(clientId);
      const ytdTx = db.transaction(() => {
        for (const s of newStubs) {
          const futaTax = s.futa_tax > 0 ? Math.round((s.futa_tax / 0.006) * 100) / 100 : 0;
          const sutaTax = s.suta_tax > 0 ? Math.round((s.suta_tax / 0.027) * 100) / 100 : 0;
          const ssTax   = Math.round(((s.employee_ss || 0) / 0.062) * 100) / 100;
          upsertYtd.run(s.employee_id, s.tax_year, s.gross_wages, ssTax, futaTax, sutaTax);
        }
      });
      ytdTx();
    } catch (_) {}

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  }
});

module.exports = router;
