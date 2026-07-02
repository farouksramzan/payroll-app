const express = require('express');
const multer  = require('multer');
const xlsx    = require('xlsx');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { encrypt } = require('../services/cryptoService');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const FREQ_NAMES = {
  weekly:      'Weekly Payroll',
  biweekly:    'Biweekly Payroll',
  semimonthly: 'Semimonthly Payroll',
  monthly:     'Monthly Payroll',
};

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
    const digits = String(ssnRaw).padStart(9, '0');
    ssn = `${digits.slice(0,3)}-${digits.slice(3,5)}-${digits.slice(5)}`;
  } else {
    ssn = String(ssnRaw).trim();
  }

  let address = (row['Address'] || '').trim();
  const city  = (row['City']  || '').trim();
  const state = (row['State'] || '').trim();
  const zip   = String(row['Zip'] || '').trim();
  if (city && address.toUpperCase().includes(city.toUpperCase())) {
    const suffix = ` ${city}`.toUpperCase();
    const idx = address.toUpperCase().lastIndexOf(suffix);
    if (idx > 0) address = address.slice(0, idx).trim();
  }

  let dob = '';
  if (row['Date of Birth'] && typeof row['Date of Birth'] === 'number') {
    const d = xlsx.SSF.parse_date_code(row['Date of Birth']);
    if (d) dob = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }

  return { firstName, lastName, ssn, address, city, state, zip, dob };
}

// POST /api/import/employees/preview
router.post('/employees/preview', upload.single('file'), (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const db = getDb();
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
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
          homeState,
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

// Detect pay frequency from check date patterns in the imported data.
// Uses two signals: day-of-month clustering (semimonthly) and median gap (weekly/biweekly/monthly).
function detectFrequency(checks) {
  const dates = [...new Set(checks.map(c => c.checkDate).filter(Boolean))].sort();
  if (dates.length === 0) return 'biweekly';

  // Semimonthly: pay dates cluster on the 1st and 15th (or 15th and last day of month)
  const dayNums = dates.map(d => parseInt(d.slice(8, 10), 10));
  const semiHits = dayNums.filter(d => d === 1 || d === 15 || d === 16).length;
  if (dates.length >= 2 && semiHits / dates.length >= 0.35) return 'semimonthly';

  if (dates.length < 2) return 'biweekly';

  // Compute gaps between consecutive unique pay dates
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const d1 = new Date(dates[i - 1] + 'T00:00:00Z');
    const d2 = new Date(dates[i] + 'T00:00:00Z');
    const gap = Math.round((d2 - d1) / 86400000);
    if (gap > 0 && gap < 60) gaps.push(gap); // ignore huge gaps (spanning years)
  }

  if (gaps.length === 0) return 'biweekly';

  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  if (median <= 8)  return 'weekly';
  if (median <= 20) return 'biweekly';
  return 'monthly';
}

// Dedup fingerprint: employee name + check date + gross wages in cents.
// Robust against period-date re-estimation and handles missing check numbers.
function checkFingerprint(empName, checkDate, grossWages) {
  return `${(empName || '').toLowerCase().trim()}|${checkDate || ''}|${Math.round((grossWages || 0) * 100)}`;
}

function buildChecks(wb, employees, client) {
  const sheetName = wb.SheetNames.find(n => n === 'Detail Data') || wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

  function findEmployee(qbName) {
    const upper = (qbName || '').toUpperCase().trim();
    for (const e of employees) {
      const exact = `${e.first_name} ${e.last_name}`.toUpperCase();
      if (upper === exact) return e;
    }
    for (const e of employees) {
      if (e.middle_name) {
        const withMiddle = `${e.first_name} ${e.middle_name} ${e.last_name}`.toUpperCase();
        if (upper === withMiddle) return e;
      }
    }
    for (const e of employees) {
      const fn = e.first_name.toUpperCase();
      const ln = e.last_name.toUpperCase();
      if (upper.includes(fn) && upper.includes(ln)) return e;
    }
    return null;
  }

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

    // Frequency and period come from the employee's stored schedule (if matched).
    // Unmatched employees get a placeholder freq that is patched after detection.
    const freq = emp ? (emp.pay_frequency || 'biweekly') : 'biweekly';
    const periodDays  = freqDays(freq);
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

// Re-apply period dates for checks whose employee wasn't matched at build time
// but is now matched after auto-creation; uses the detected (or employee's) frequency.
function patchUnmatchedChecks(checks, detectedFreq, empMap) {
  for (const c of checks) {
    // Attach newly found employee if present in empMap
    if (!c.empMatched && empMap.has(c.empName.toUpperCase().trim())) {
      const emp = empMap.get(c.empName.toUpperCase().trim());
      c.employeeId  = emp.id;
      c.empMatched  = true;
      c.filingStatus = emp.filing_status || 'single';
      c.workState    = emp.work_state || emp.state || c.workState;
    }
    // Recalculate period using detected (or employee's) frequency
    if (!c.empMatched || c.payFrequency === 'biweekly') {
      const freq = c.empMatched
        ? (empMap.get(c.empName.toUpperCase().trim())?.pay_frequency || detectedFreq)
        : detectedFreq;
      c.payFrequency = freq;
      const days = freqDays(freq);
      c.periodEnd   = subtractDays(c.checkDate, 2);
      c.periodStart = subtractDays(c.periodEnd, days - 1);
    }
  }
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

    // Existing check_number dedup set
    const existingByNum = new Set(
      db.prepare('SELECT check_number FROM paystubs WHERE client_id = ? AND check_number IS NOT NULL')
        .all(clientId).map(r => String(r.check_number))
    );

    // Robust fingerprint dedup: employee_name + check_date + gross_wages_cents
    const existingFp = new Set(
      db.prepare('SELECT employee_name, settlement_date, gross_wages FROM paystubs WHERE client_id = ?')
        .all(clientId)
        .map(r => checkFingerprint(r.employee_name, r.settlement_date, r.gross_wages))
    );

    let checks = buildChecks(wb, employees, client);

    // Detect frequency from actual check date patterns in the file
    const detectedFrequency = detectFrequency(checks);

    // Patch unmatched checks to use detected frequency for period calculation
    for (const c of checks) {
      if (!c.empMatched) {
        c.payFrequency = detectedFrequency;
        const days = freqDays(detectedFrequency);
        c.periodEnd   = subtractDays(c.checkDate, 2);
        c.periodStart = subtractDays(c.periodEnd, days - 1);
      }
    }

    // Mark which checks already exist in DB
    checks = checks.map(c => ({
      ...c,
      alreadyExists:
        existingByNum.has(String(c.checkNumber)) ||
        existingFp.has(checkFingerprint(c.empName, c.checkDate, c.grossWages)),
    }));

    // Determine pay group action (no DB write — preview only)
    const existingGroup = db.prepare(
      `SELECT * FROM pay_groups WHERE client_id = ? AND frequency = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`
    ).get(clientId, detectedFrequency);
    const payGroupAction = existingGroup
      ? { action: 'match', groupName: existingGroup.name, groupId: existingGroup.id }
      : { action: 'create', suggestedName: FREQ_NAMES[detectedFrequency] || `${detectedFrequency} Payroll` };

    // Collect unique unmatched employee names that will be auto-created on import
    const willAutoCreateEmployees = [
      ...new Set(checks.filter(c => !c.empMatched).map(c => c.empName))
    ];

    res.json({
      count: checks.length,
      checks,
      detectedFrequency,
      payGroupAction,
      willAutoCreateEmployees,
    });
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
    let employees = db.prepare('SELECT * FROM employees WHERE client_id = ?').all(clientId);

    let checks = buildChecks(wb, employees, client);

    // Detect frequency from actual check date patterns
    const detectedFrequency = detectFrequency(checks);

    // ── Auto-create skeleton employees for unmatched names ────────────────────
    // Creates minimal records flagged for W-4 completion. These get linked to
    // their checks immediately so the import data is connected from day one.
    const unmatchedNames = [...new Set(
      checks.filter(c => !c.empMatched).map(c => (c.empName || '').trim()).filter(Boolean)
    )];

    const createdEmployees = [];
    if (unmatchedNames.length > 0) {
      const insertEmp = db.prepare(`
        INSERT OR IGNORE INTO employees
          (client_id, first_name, last_name, work_state, state, filing_status,
           pay_type, hourly_rate, annual_salary, pay_frequency, is_active, w4_submitted, onboarding_done)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,0,0)
      `);
      const insertTx = db.transaction(() => {
        for (const name of unmatchedNames) {
          const spaceIdx = name.indexOf(' ');
          const firstName = spaceIdx > -1 ? name.slice(0, spaceIdx) : name;
          const lastName  = spaceIdx > -1 ? name.slice(spaceIdx + 1) : '';
          if (!firstName) continue;
          const st = client.state || 'TX';
          const r = insertEmp.run(clientId, firstName, lastName || '(unknown)', st, st, 'single', 'hourly', 0, 0, detectedFrequency);
          if (r.lastInsertRowid) {
            createdEmployees.push({ id: r.lastInsertRowid, name, firstName, lastName });
          }
        }
      });
      insertTx();

      // Reload employee list to include newly created records
      employees = db.prepare('SELECT * FROM employees WHERE client_id = ?').all(clientId);

      // Build a fast lookup: uppercased name → employee
      const empMap = new Map(employees.map(e => [
        `${e.first_name} ${e.last_name}`.toUpperCase(), e
      ]));
      // Also add fuzzy entries for middle-name variations
      for (const e of employees) {
        if (e.middle_name) {
          empMap.set(`${e.first_name} ${e.middle_name} ${e.last_name}`.toUpperCase(), e);
        }
      }

      // Re-match unmatched checks and patch their periods with the detected frequency
      patchUnmatchedChecks(checks, detectedFrequency, empMap);
    } else {
      // Even with fully matched checks, patch any that defaulted to biweekly
      // when the detected frequency is different
      for (const c of checks) {
        if (!c.empMatched) {
          c.payFrequency = detectedFrequency;
          const days = freqDays(detectedFrequency);
          c.periodEnd   = subtractDays(c.checkDate, 2);
          c.periodStart = subtractDays(c.periodEnd, days - 1);
        }
      }
    }

    // ── Find or create pay group ──────────────────────────────────────────────
    // Match an existing group by frequency, or create a new named one.
    // All imported checks are assigned to this group.
    let payGroupId = null;
    let payGroupCreated = false;
    let payGroupName = '';
    try {
      const existingGroup = db.prepare(
        `SELECT * FROM pay_groups WHERE client_id = ? AND frequency = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`
      ).get(clientId, detectedFrequency);

      if (existingGroup) {
        payGroupId   = existingGroup.id;
        payGroupName = existingGroup.name;
      } else {
        const name = FREQ_NAMES[detectedFrequency] || `${detectedFrequency} Payroll`;
        // Anchor the group on the earliest check's period
        const earliest = checks.slice().sort((a, b) => a.checkDate.localeCompare(b.checkDate))[0];
        const r = db.prepare(
          `INSERT INTO pay_groups (client_id, name, frequency, first_pay_period_start, first_pay_period_end, pay_date) VALUES (?,?,?,?,?,?)`
        ).run(
          clientId, name, detectedFrequency,
          earliest ? earliest.periodStart : null,
          earliest ? earliest.periodEnd   : null,
          earliest ? earliest.checkDate   : null,
        );
        payGroupId   = r.lastInsertRowid;
        payGroupName = name;
        payGroupCreated = true;
      }
    } catch (pgErr) {
      // Non-fatal — import continues without pay_group_id
      console.error('[import] pay group find/create failed:', pgErr.message);
    }

    // ── Dedup sets ───────────────────────────────────────────────────────────
    const existingByNum = new Set(
      db.prepare('SELECT check_number FROM paystubs WHERE client_id = ? AND check_number IS NOT NULL')
        .all(clientId).map(r => String(r.check_number))
    );
    // Fingerprint: employee_name + settlement_date + gross_wages_cents
    // More robust than period-date pairs (which are estimated and can drift across imports)
    const existingFp = new Set(
      db.prepare('SELECT employee_name, settlement_date, gross_wages FROM paystubs WHERE client_id = ?')
        .all(clientId)
        .map(r => checkFingerprint(r.employee_name, r.settlement_date, r.gross_wages))
    );

    const insert = db.prepare(`
      INSERT INTO paystubs (
        client_id, employee_id, employee_name,
        pay_period_start, pay_period_end, settlement_date, pay_frequency, filing_status, work_state,
        gross_wages, fit_withholding, employee_ss, employee_medicare, additional_medicare,
        employer_ss, employer_medicare, futa_tax, suta_tax,
        total_deposit, net_pay, tax_year, tax_quarter,
        check_number, check_status, status, status_940, reported_tips, pay_group_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const insertLineItem = db.prepare(`
      INSERT INTO paystub_line_items (paystub_id, pay_type, description, hours, rate, amount)
      VALUES (?, ?, ?, NULL, NULL, ?)
    `);

    const getExistingStub = db.prepare('SELECT id, reported_tips FROM paystubs WHERE client_id = ? AND check_number = ?');
    const hasTipItem      = db.prepare("SELECT id FROM paystub_line_items WHERE paystub_id = ? AND pay_type = 'tips'");
    const patchTips       = db.prepare('UPDATE paystubs SET reported_tips = ? WHERE id = ?');

    const VALID_CHECK_STATUSES    = ['draft', 'printed', 'deposited', 'direct_deposit_sent', 'direct_deposit_cleared', 'late'];
    const VALID_LIABILITY_STATUSES = ['pending', 'submitted'];
    const resolvedCheckStatus     = VALID_CHECK_STATUSES.includes(checkStatus)     ? checkStatus     : 'printed';
    const resolvedLiabilityStatus = VALID_LIABILITY_STATUSES.includes(liabilityStatus) ? liabilityStatus : 'pending';

    const importAll = db.transaction((rows) => {
      let imported = 0, skipped = 0, patched = 0;
      for (const c of rows) {
        const numKey = c.checkNumber ? String(c.checkNumber) : null;
        const fp     = checkFingerprint(c.empName, c.checkDate, c.grossWages);

        // Skip if check already exists (by check number OR by fingerprint)
        if (skipExisting === 'true' && (
          (numKey && existingByNum.has(numKey)) || existingFp.has(fp)
        )) {
          // Patch missing tips on the existing check
          if (c.reportedTips > 0 && numKey) {
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

        // Track fingerprint within this import to catch duplicates inside the same file
        existingFp.add(fp);
        if (numKey) existingByNum.add(numKey);

        const r = insert.run(
          clientId, c.employeeId || null, c.empName,
          c.periodStart, c.periodEnd, c.checkDate, c.payFrequency, c.filingStatus, c.workState,
          c.grossWages, c.fit, c.eeSS, c.eeMedicare, c.addlMedicare,
          c.erSS, c.erMedicare, c.futa, c.suta,
          c.totalDeposit, c.netPay, c.taxYear, c.taxQuarter,
          c.checkNumber, resolvedCheckStatus, resolvedLiabilityStatus, resolvedLiabilityStatus,
          c.reportedTips || 0,
          payGroupId,
        );
        const stubId = r.lastInsertRowid;
        if (c.compensation > 0) insertLineItem.run(stubId, 'regular', 'Compensation', c.compensation);
        if (c.reportedTips  > 0) insertLineItem.run(stubId, 'tips',    'Reported Tips', c.reportedTips);
        imported++;
      }
      return { imported, skipped, patched };
    });

    const result = importAll(checks);

    // Re-link any still-unlinked paystubs via fuzzy name matching.
    // Handles edge cases where name parsing slightly differed.
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

    // Update YTD wage buckets for all newly linked paystubs.
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
      const newStubs = db.prepare(
        `SELECT employee_id, tax_year, gross_wages, employee_ss, futa_tax, suta_tax
         FROM paystubs WHERE client_id=? AND created_at >= datetime('now','-1 minute') AND employee_id IS NOT NULL`
      ).all(clientId);
      const ytdTx = db.transaction(() => {
        for (const s of newStubs) {
          const futaTax = s.futa_tax   > 0 ? Math.round((s.futa_tax   / 0.006) * 100) / 100 : 0;
          const sutaTax = s.suta_tax   > 0 ? Math.round((s.suta_tax   / 0.027) * 100) / 100 : 0;
          const ssTax   = Math.round(((s.employee_ss || 0) / 0.062) * 100) / 100;
          upsertYtd.run(s.employee_id, s.tax_year, s.gross_wages, ssTax, futaTax, sutaTax);
        }
      });
      ytdTx();
    } catch (_) {}

    res.json({
      ...result,
      detectedFrequency,
      payGroupCreated,
      payGroupName,
      payGroupId,
      employeesCreated: createdEmployees,
    });
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  }
});

module.exports = router;
