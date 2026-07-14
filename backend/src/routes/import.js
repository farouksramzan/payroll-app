const express = require('express');
const multer  = require('multer');
const xlsx    = require('xlsx');
const { getDb } = require('../database/db');
const { requireAuth, requireAdmin, canAccessClient } = require('../middleware/auth');
const { encrypt } = require('../services/cryptoService');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const FREQ_NAMES = {
  weekly:      'Weekly Payroll',
  biweekly:    'Biweekly Payroll',
  semimonthly: 'Semimonthly Payroll',
  monthly:     'Monthly Payroll',
};

function parseQbEmployeeRow(row) {
  const fullName = (row['Employee'] || '').trim();
  const spaceIdx = fullName.indexOf(' ');
  const firstName = spaceIdx > -1 ? fullName.slice(0, spaceIdx) : fullName;
  const lastName  = spaceIdx > -1 ? fullName.slice(spaceIdx + 1) : '';

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
  const client = canAccessClient(db, clientId, req.user);
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
  const client = canAccessClient(db, clientId, req.user);
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
          clientId, r.firstName, r.lastName,
          r.ssn ? encrypt(r.ssn) : null,
          r.address || null, r.city || null, homeState, r.zip || null, homeState,
          'single', 'hourly', 0, 0,
          client.payroll_frequency || 'biweekly',
        );
        imported++;
      }
      return { imported, skipped };
    });

    const parsed = rows.map(row => parseQbEmployeeRow(row)).filter(r => r.firstName && r.lastName);
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
  if (freq === 'weekly')      return 7;
  if (freq === 'semimonthly') return 15;
  if (freq === 'monthly')     return 30;
  return 14;
}

function addDaysUTC(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Mirrors the frontend advancePeriod function using UTC arithmetic.
// Used to recalculate canonical period dates so stored pay_period_end values
// exactly match what getPendingPeriods() generates from the pay group anchor.
function advancePeriodUTC(startStr, endStr, freq) {
  const s = new Date(startStr + 'T00:00:00Z');
  const e = new Date(endStr   + 'T00:00:00Z');
  if (freq === 'weekly')   return [addDaysUTC(startStr, 7),  addDaysUTC(endStr, 7)];
  if (freq === 'biweekly') return [addDaysUTC(startStr, 14), addDaysUTC(endStr, 14)];
  if (freq === 'monthly') {
    const ns = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate()));
    const ne = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate()));
    return [ns.toISOString().slice(0, 10), ne.toISOString().slice(0, 10)];
  }
  if (freq === 'semimonthly') {
    const ns = new Date(e); ns.setUTCDate(ns.getUTCDate() + 1);
    const ne = ns.getUTCDate() === 1
      ? new Date(Date.UTC(ns.getUTCFullYear(), ns.getUTCMonth(), 15))
      : new Date(Date.UTC(ns.getUTCFullYear(), ns.getUTCMonth() + 1, 0));
    return [ns.toISOString().slice(0, 10), ne.toISOString().slice(0, 10)];
  }
  return [addDaysUTC(startStr, 14), addDaysUTC(endStr, 14)];
}

// Find which pay group schedule period a check date belongs to.
// Returns { periodStart, periodEnd } for the matching period, or null.
function findCanonicalPeriod(checkDate, anchorStart, anchorEnd, freq) {
  let [s, e] = [anchorStart, anchorEnd];
  for (let i = 0; i < 200; i++) {
    const payWindow = addDaysUTC(e, 10); // generous: check date up to 10 days after period end
    if (checkDate <= payWindow && checkDate >= s) return { periodStart: s, periodEnd: e };
    if (checkDate < s) break;
    [s, e] = advancePeriodUTC(s, e, freq);
  }
  return null;
}

// Detect frequency from a sorted list of unique date strings (YYYY-MM-DD).
// Returns null when there isn't enough signal (single date with no pattern).
// IMPORTANT: gaps are evaluated first so monthly-on-the-1st is never mistaken
// for semimonthly. Day-of-month clustering only breaks a biweekly/semimonthly tie.
function detectFrequencyFromDates(dates) {
  const sorted = [...new Set(dates.filter(Boolean))].sort();
  if (sorted.length < 2) return null;

  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const d1 = new Date(sorted[i - 1] + 'T00:00:00Z');
    const d2 = new Date(sorted[i]     + 'T00:00:00Z');
    const gap = Math.round((d2 - d1) / 86400000);
    if (gap > 0 && gap < 60) gaps.push(gap);
  }
  if (gaps.length === 0) return null;

  // Remove burst-short gaps (≤ 10 days) when they coexist with normal-cycle gaps (> 10 days).
  // Short bursts come from bonus/adjustment checks issued mid-cycle (e.g., a $200 bonus check
  // 5 days after the regular check). We remove ONLY the short bursts, keeping vacation and
  // leave gaps in place so that the median of the remaining gaps correctly identifies the cycle.
  // (The old approach of keeping ONLY long gaps was wrong: a biweekly employee with one vacation
  // gap would have median(vacation gap only) ≥ 25 → wrongly classified as monthly.)
  const shortBursts  = gaps.filter(g => g <= 10);
  const normalAndLong = gaps.filter(g => g > 10);
  const effectiveGaps = (shortBursts.length > 0 && normalAndLong.length > 0)
    ? normalAndLong
    : gaps;

  const sorted_gaps = [...effectiveGaps].sort((a, b) => a - b);
  const median = sorted_gaps[Math.floor(sorted_gaps.length / 2)];

  if (median <= 8)  return 'weekly';
  if (median >= 25) return 'monthly';

  // Gap 9–24 days: biweekly vs semimonthly tiebreaker.
  // Require ≥ 4 data points and ≥ 70% on 1st/2nd/15th/16th for a strong semimonthly signal.
  if (median >= 13 && median <= 17) {
    const dayNums = sorted.map(d => parseInt(d.slice(8, 10), 10));
    const semiHits = dayNums.filter(d => d === 1 || d === 2 || d === 15 || d === 16).length;
    if (sorted.length >= 4 && semiHits / dayNums.length >= 0.70) return 'semimonthly';
  }

  return 'biweekly';
}

// Detect pay frequency per employee from their check dates, returning:
//   empFreqMap  — Map<upperName, frequency>
//   dominantFreq — most common frequency (used as fallback for ambiguous employees)
function detectPerEmployeeFrequency(checks) {
  // Group check dates by employee
  const datesByEmp = new Map();
  for (const c of checks) {
    const key = (c.empName || '').toUpperCase().trim();
    if (!datesByEmp.has(key)) datesByEmp.set(key, []);
    if (c.checkDate) datesByEmp.get(key).push(c.checkDate);
  }

  // Detect frequency for each employee
  const empFreqMap = new Map();
  const freqVotes = {};
  for (const [name, dates] of datesByEmp.entries()) {
    const freq = detectFrequencyFromDates(dates);
    if (freq) {
      empFreqMap.set(name, freq);
      freqVotes[freq] = (freqVotes[freq] || 0) + 1;
    }
    // null → ambiguous, filled below
  }

  // Dominant frequency from employees we could confidently classify
  const dominantFreq =
    Object.entries(freqVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'biweekly';

  // Fill ambiguous employees (single check, not on 1st/15th) with dominant
  for (const name of datesByEmp.keys()) {
    if (!empFreqMap.has(name)) empFreqMap.set(name, dominantFreq);
  }

  return { empFreqMap, dominantFreq };
}

// Dedup fingerprint: employee name + check date + gross wages in cents.
// Survives period-date re-estimation and handles missing/changed check numbers.
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
      if (`${e.first_name} ${e.last_name}`.toUpperCase() === upper) return e;
    }
    for (const e of employees) {
      if (e.middle_name) {
        if (`${e.first_name} ${e.middle_name} ${e.last_name}`.toUpperCase() === upper) return e;
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
    // Compensation paid via salary-type items ("Salary", "Officer Salary Regular").
    // Used to infer pay_type when auto-creating employees.
    const salaryComp = items
      .filter(r => r['Tax Tracking Type'] === 'Compensation' && /salary/i.test(String(r['Payroll Item'] || '')))
      .reduce((s, r) => s + (Number(r['Amount']) || 0), 0);
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

    // Period will be recalculated after per-employee frequency detection;
    // use employee's stored frequency as a placeholder for matched employees.
    const placeholderFreq = emp ? (emp.pay_frequency || 'biweekly') : 'biweekly';
    const periodDays      = freqDays(placeholderFreq);
    const periodEnd       = subtractDays(checkDate, 2);
    const periodStart     = subtractDays(periodEnd, periodDays - 1);

    const checkDate_d = new Date(checkDate + 'T00:00:00Z');

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
      salaryComp:    round2(salaryComp),
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
      taxYear:       checkDate_d.getUTCFullYear(),
      taxQuarter:    Math.ceil((checkDate_d.getUTCMonth() + 1) / 3),
      filingStatus:  emp ? (emp.filing_status || 'single') : 'single',
      payFrequency:  placeholderFreq,
      workState:     emp ? (emp.work_state || emp.state || client.state || 'TX') : (client.state || 'TX'),
    });
  }
  return checks;
}

// Apply detected per-employee frequency to each check's payFrequency and period dates.
// For matched employees we respect their stored schedule; for unmatched we use detected.
function applyPerEmployeeFrequency(checks, empFreqMap) {
  for (const c of checks) {
    const key = (c.empName || '').toUpperCase().trim();
    const detected = empFreqMap.get(key);
    if (!detected) continue;

    // Always store detected frequency for the check (used for pay group assignment)
    c.detectedFrequency = detected;

    // For unmatched employees, recompute period using detected frequency
    if (!c.empMatched) {
      c.payFrequency = detected;
      const days     = freqDays(detected);
      c.periodEnd    = subtractDays(c.checkDate, 2);
      c.periodStart  = subtractDays(c.periodEnd, days - 1);
    }
  }
}

function round2(n) { return Math.round(n * 100) / 100; }

// POST /api/import/paychecks/preview
router.post('/paychecks/preview', upload.single('file'), (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const db = getDb();
  const client = canAccessClient(db, clientId, req.user);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const employees = db.prepare('SELECT * FROM employees WHERE client_id = ?').all(clientId);

    const existingByNum = new Set(
      db.prepare('SELECT check_number FROM paystubs WHERE client_id = ? AND check_number IS NOT NULL')
        .all(clientId).map(r => String(r.check_number))
    );
    const existingFp = new Set(
      db.prepare('SELECT employee_name, settlement_date, gross_wages FROM paystubs WHERE client_id = ?')
        .all(clientId)
        .map(r => checkFingerprint(r.employee_name, r.settlement_date, r.gross_wages))
    );

    let checks = buildChecks(wb, employees, client);

    // Detect frequency per employee from actual check date patterns
    const { empFreqMap, dominantFreq } = detectPerEmployeeFrequency(checks);
    applyPerEmployeeFrequency(checks, empFreqMap);

    // Mark duplicates using check number + robust fingerprint.
    // Only numeric Doc Nums count as check numbers — QB's "E-PAY"/"E-CHECK"
    // markers are shared across many checks and must not match as duplicates.
    checks = checks.map(c => {
      const rawNum = c.checkNumber ? String(c.checkNumber).trim() : '';
      const numKey = /^\d+$/.test(rawNum) ? rawNum : null;
      return {
        ...c,
        alreadyExists:
          (numKey && existingByNum.has(numKey)) ||
          existingFp.has(checkFingerprint(c.empName, c.checkDate, c.grossWages)),
      };
    });

    // Determine pay group action per detected frequency (no DB writes — preview only)
    const uniqueFreqs = [...new Set(empFreqMap.values())];
    const payGroupActions = uniqueFreqs.map(freq => {
      const checksForFreq = checks.filter(c => (c.detectedFrequency || dominantFreq) === freq);
      const existingGroup = db.prepare(
        `SELECT * FROM pay_groups WHERE client_id = ? AND frequency = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`
      ).get(clientId, freq);
      return existingGroup
        ? { frequency: freq, action: 'match',  groupName: existingGroup.name, groupId: existingGroup.id, checkCount: checksForFreq.length }
        : { frequency: freq, action: 'create', suggestedName: FREQ_NAMES[freq] || `${freq} Payroll`,     checkCount: checksForFreq.length };
    }).sort((a, b) => b.checkCount - a.checkCount);

    // Unique unmatched names that will be auto-created on import
    const willAutoCreateEmployees = [
      ...new Set(checks.filter(c => !c.empMatched).map(c => c.empName))
    ];

    res.json({
      count: checks.length,
      checks,
      detectedFrequency: dominantFreq,
      payGroupActions,
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
  const client = canAccessClient(db, clientId, req.user);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    let employees = db.prepare('SELECT * FROM employees WHERE client_id = ?').all(clientId);

    let checks = buildChecks(wb, employees, client);

    // Per-employee frequency detection
    const { empFreqMap, dominantFreq } = detectPerEmployeeFrequency(checks);
    applyPerEmployeeFrequency(checks, empFreqMap);

    // ── Auto-create skeleton employees for unmatched names ────────────────────
    const unmatchedNames = [
      ...new Set(checks.filter(c => !c.empMatched).map(c => (c.empName || '').trim()).filter(Boolean))
    ];

    const createdEmployees = [];
    if (unmatchedNames.length > 0) {
      const insertEmp = db.prepare(`
        INSERT OR IGNORE INTO employees
          (client_id, first_name, last_name, work_state, state, filing_status,
           pay_type, hourly_rate, annual_salary, pay_frequency, is_active, w4_submitted, onboarding_done)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,0,0)
      `);
      db.transaction(() => {
        for (const name of unmatchedNames) {
          const spaceIdx = name.indexOf(' ');
          const firstName = spaceIdx > -1 ? name.slice(0, spaceIdx) : name;
          const rawLast   = spaceIdx > -1 ? name.slice(spaceIdx + 1) : '';
          // Strip QB artifact ". " prefix (e.g. "ROOMI . RAMZAN" → lastName "RAMZAN")
          const lastName  = rawLast.replace(/^\.\s*/, '');
          if (!firstName) continue;
          const key  = name.toUpperCase().trim();
          const freq = empFreqMap.get(key) || dominantFreq;
          const st   = client.state || 'TX';
          // Infer pay type from QB pay items: if most of this employee's
          // compensation came through salary items, create them as salaried
          // with an annual salary estimated from their median check.
          const empChecks = checks.filter(x => (x.empName || '').toUpperCase().trim() === key);
          const totComp   = empChecks.reduce((s, x) => s + (x.compensation || 0), 0);
          const totSalary = empChecks.reduce((s, x) => s + (x.salaryComp   || 0), 0);
          const isSalary  = totComp > 0 && totSalary / totComp >= 0.5;
          let annualSalary = 0;
          if (isSalary) {
            const grosses = empChecks.map(x => x.compensation).filter(g => g > 0).sort((a, b) => a - b);
            const medGross = grosses.length ? grosses[Math.floor(grosses.length / 2)] : 0;
            const ppy = freq === 'weekly' ? 52 : freq === 'biweekly' ? 26 : freq === 'semimonthly' ? 24 : freq === 'monthly' ? 12 : 26;
            annualSalary = Math.round(medGross * ppy);
          }
          const r = insertEmp.run(clientId, firstName, lastName || '(unknown)', st, st, 'single',
            isSalary ? 'salary' : 'hourly', 0, annualSalary, freq);
          if (r.lastInsertRowid) createdEmployees.push({ id: r.lastInsertRowid, name, firstName, lastName });
        }
      })();

      // Reload employees and re-match checks
      employees = db.prepare('SELECT * FROM employees WHERE client_id = ?').all(clientId);
      const empLookup = new Map();
      for (const e of employees) {
        empLookup.set(`${e.first_name} ${e.last_name}`.toUpperCase(), e);
        if (e.middle_name) empLookup.set(`${e.first_name} ${e.middle_name} ${e.last_name}`.toUpperCase(), e);
      }
      for (const c of checks) {
        if (!c.empMatched) {
          const upper = (c.empName || '').toUpperCase().trim();
          const found = empLookup.get(upper) || [...empLookup.entries()].find(([k, e]) => {
            const fn = e.first_name.toUpperCase(), ln = e.last_name.toUpperCase();
            return upper.includes(fn) && upper.includes(ln);
          })?.[1];
          if (found) {
            c.employeeId  = found.id;
            c.empMatched  = true;
            c.filingStatus = found.filing_status || 'single';
            c.workState    = found.work_state || found.state || c.workState;
          }
        }
      }
    }

    // ── Find or create a pay group per detected frequency ─────────────────────
    const uniqueFreqs = [...new Set(empFreqMap.values())];
    const freqToGroupId = new Map();
    const payGroupsResult = [];

    for (const freq of uniqueFreqs) {
      const checksForFreq = checks.filter(c => (c.detectedFrequency || dominantFreq) === freq);
      const earliest = [...checksForFreq].sort((a, b) => a.checkDate.localeCompare(b.checkDate))[0];
      try {
        const existing = db.prepare(
          `SELECT * FROM pay_groups WHERE client_id = ? AND frequency = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`
        ).get(clientId, freq);
        if (existing) {
          freqToGroupId.set(freq, existing.id);
          payGroupsResult.push({ frequency: freq, name: existing.name, id: existing.id, action: 'match', checkCount: checksForFreq.length });
        } else {
          const name = FREQ_NAMES[freq] || `${freq} Payroll`;
          const r = db.prepare(
            `INSERT INTO pay_groups (client_id, name, frequency, first_pay_period_start, first_pay_period_end, pay_date) VALUES (?,?,?,?,?,?)`
          ).run(
            clientId, name, freq,
            earliest?.periodStart || null,
            earliest?.periodEnd   || null,
            earliest?.checkDate   || null,
          );
          freqToGroupId.set(freq, r.lastInsertRowid);
          payGroupsResult.push({ frequency: freq, name, id: r.lastInsertRowid, action: 'create', checkCount: checksForFreq.length });
        }
      } catch (pgErr) {
        console.error(`[import] pay group for ${freq} failed:`, pgErr.message);
      }
    }

    // ── Assign employees to their pay groups ─────────────────────────────────
    // Sets pay_group_id on the employee record (not just the paystub) so the UI
    // correctly places employees inside their group instead of showing them as Unassigned.
    // Only updates employees that are currently unassigned to avoid overwriting manual changes.
    try {
      // Always update to the detected group — repairs employees wrongly assigned by
      // a previous import (e.g. semimonthly mis-classification). Users who manually
      // moved an employee to a different group will need to re-assign afterward, but
      // that's the right tradeoff: import is authoritative on frequency.
      const updateEmpGroup = db.prepare(
        'UPDATE employees SET pay_group_id = ? WHERE id = ?'
      );
      const assignedEmpIds = new Set();
      db.transaction(() => {
        for (const c of checks) {
          if (!c.employeeId || assignedEmpIds.has(c.employeeId)) continue;
          const empKey  = (c.empName || '').toUpperCase().trim();
          const detFreq = empFreqMap.get(empKey) || dominantFreq;
          const groupId = freqToGroupId.get(detFreq);
          if (groupId) {
            updateEmpGroup.run(groupId, c.employeeId);
            assignedEmpIds.add(c.employeeId);
          }
        }
      })();
    } catch (err) {
      console.error('[import] employee pay_group_id assign failed:', err.message);
    }

    // ── Recalculate canonical period dates ───────────────────────────────────
    // Imported checks initially use periodEnd = checkDate - 2 (flat subtraction).
    // The pay group schedule advances via advancePeriod (calendar arithmetic), so
    // subsequent period ends may diverge by 1-3 days from stored values, causing
    // getPendingPeriods() to generate phantom "pending" rows for already-paid periods.
    // Re-map each check to the schedule period that contains its check date so the
    // stored pay_period_end matches what the frontend generates from the anchor.
    try {
      const getGroupAnchor = db.prepare(
        'SELECT first_pay_period_start, first_pay_period_end FROM pay_groups WHERE id = ?'
      );
      const anchorCache = new Map();
      for (const c of checks) {
        const empKey  = (c.empName || '').toUpperCase().trim();
        const detFreq = empFreqMap.get(empKey) || dominantFreq;
        const groupId = freqToGroupId.get(detFreq);
        if (!groupId) continue;
        if (!anchorCache.has(groupId)) anchorCache.set(groupId, getGroupAnchor.get(groupId));
        const anchor = anchorCache.get(groupId);
        if (!anchor?.first_pay_period_start || !anchor?.first_pay_period_end) continue;
        const canonical = findCanonicalPeriod(
          c.checkDate, anchor.first_pay_period_start, anchor.first_pay_period_end, detFreq
        );
        if (canonical) {
          c.periodStart = canonical.periodStart;
          c.periodEnd   = canonical.periodEnd;
        }
      }
    } catch (err) {
      console.warn('[import] canonical period recalc skipped:', err.message);
    }

    // ── Dedup sets ────────────────────────────────────────────────────────────
    const existingByNum = new Set(
      db.prepare('SELECT check_number FROM paystubs WHERE client_id = ? AND check_number IS NOT NULL')
        .all(clientId).map(r => String(r.check_number))
    );
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
    const getExistingStubByNum = db.prepare('SELECT id, reported_tips, pay_group_id, pay_period_start, pay_period_end FROM paystubs WHERE client_id = ? AND check_number = ?');
    const getExistingStubByFp  = db.prepare('SELECT id, reported_tips, pay_group_id, pay_period_start, pay_period_end FROM paystubs WHERE client_id = ? AND employee_name = ? AND settlement_date = ? AND ROUND(gross_wages * 100) = ?');
    const hasTipItem           = db.prepare("SELECT id FROM paystub_line_items WHERE paystub_id = ? AND pay_type = 'tips'");
    const patchTips            = db.prepare('UPDATE paystubs SET reported_tips = ? WHERE id = ?');
    const patchGroup           = db.prepare('UPDATE paystubs SET pay_group_id = ? WHERE id = ? AND (pay_group_id IS NULL OR pay_group_id != ?)');
    const patchPeriod          = db.prepare('UPDATE paystubs SET pay_period_start = ?, pay_period_end = ? WHERE id = ?');

    const VALID_CHECK_STATUSES     = ['draft', 'printed', 'deposited', 'direct_deposit_sent', 'direct_deposit_cleared', 'late'];
    const VALID_LIABILITY_STATUSES = ['pending', 'submitted'];
    const resolvedCheckStatus      = VALID_CHECK_STATUSES.includes(checkStatus)       ? checkStatus       : 'printed';
    const resolvedLiabilityStatus  = VALID_LIABILITY_STATUSES.includes(liabilityStatus) ? liabilityStatus : 'pending';

    const importAll = db.transaction((rows) => {
      let imported = 0, skipped = 0, patched = 0, repaired = 0;
      for (const c of rows) {
        // Only NUMERIC Doc Nums are real check numbers usable for dedup.
        // QB uses markers like "E-PAY" / "E-CHECK" / "e-check" for electronic
        // payments — dozens of different checks share them, so treating them as
        // identifiers silently drops every e-payment after the first.
        const rawNum = c.checkNumber ? String(c.checkNumber).trim() : '';
        const numKey = /^\d+$/.test(rawNum) ? rawNum : null;
        const fp     = checkFingerprint(c.empName, c.checkDate, c.grossWages);

        const empKey     = (c.empName || '').toUpperCase().trim();
        const detFreq    = empFreqMap.get(empKey) || dominantFreq;
        const payGroupId = freqToGroupId.get(detFreq) || null;

        if (skipExisting === 'true' && (
          (numKey && existingByNum.has(numKey)) || existingFp.has(fp)
        )) {
          // Find the existing paystub so we can repair its group assignment and tips
          const existingStub = numKey
            ? getExistingStubByNum.get(clientId, numKey)
            : getExistingStubByFp.get(clientId, c.empName, c.checkDate, Math.round((c.grossWages || 0) * 100));

          if (existingStub) {
            // Patch tips if missing
            if (c.reportedTips > 0 && !(existingStub.reported_tips > 0)) {
              patchTips.run(c.reportedTips, existingStub.id);
              if (!hasTipItem.get(existingStub.id)) {
                insertLineItem.run(existingStub.id, 'tips', 'Reported Tips', c.reportedTips);
              }
              patched++;
            }
            // Re-assign to the correct pay group if wrong or missing
            if (payGroupId && existingStub.pay_group_id !== payGroupId) {
              patchGroup.run(payGroupId, existingStub.id, payGroupId);
              repaired++;
            }
            // Repair stale period dates: older imports stored flat checkDate-2
            // arithmetic; c.periodStart/End hold the canonical schedule-derived
            // period, so syncing them makes the check line up with pending-row
            // generation instead of leaving a phantom "unpaid" period behind.
            if (c.periodStart && c.periodEnd &&
                (existingStub.pay_period_start !== c.periodStart || existingStub.pay_period_end !== c.periodEnd)) {
              patchPeriod.run(c.periodStart, c.periodEnd, existingStub.id);
              repaired++;
            }
          }
          skipped++;
          continue;
        }

        // Track within-import to catch duplicates inside the same file
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
        if (c.reportedTips  > 0) insertLineItem.run(stubId, 'tips',    'Reported Tips',  c.reportedTips);
        imported++;
      }
      return { imported, skipped, patched, repaired };
    });

    const result = importAll(checks);

    // Re-link any still-unlinked paystubs via fuzzy name matching
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

    // Update YTD wage buckets
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
      db.transaction(() => {
        for (const s of newStubs) {
          const futaTax = s.futa_tax   > 0 ? Math.round((s.futa_tax   / 0.006) * 100) / 100 : 0;
          const sutaTax = s.suta_tax   > 0 ? Math.round((s.suta_tax   / 0.027) * 100) / 100 : 0;
          const ssTax   = Math.round(((s.employee_ss || 0) / 0.062) * 100) / 100;
          upsertYtd.run(s.employee_id, s.tax_year, s.gross_wages, ssTax, futaTax, sutaTax);
        }
      })();
    } catch (_) {}

    res.json({
      ...result,
      dominantFrequency: dominantFreq,
      payGroups: payGroupsResult,
      employeesCreated: createdEmployees,
    });
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  }
});

module.exports = router;
