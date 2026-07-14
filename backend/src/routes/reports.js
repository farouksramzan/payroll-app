const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { calculateFUTA, calculateSUTA, FUTA_WAGE_BASE, SUTA_WAGE_BASE } = require('../services/taxCalculator');
const { decrypt } = require('../services/cryptoService');
const { generateFormHtml } = require('../utils/formHtml');
const { htmlToPdf } = require('../utils/pdf');

const router = express.Router();
router.use(requireAuth);

function round2(n) { return Math.round((n || 0) * 100) / 100; }

function assertClient(db, clientId, userId) {
  // Accessible if this accountant owns the client OR was granted access to it.
  const c = db.prepare(`
    SELECT * FROM clients
    WHERE id = ? AND (user_id = ? OR id IN (SELECT client_id FROM client_accountants WHERE user_id = ?))
  `).get(clientId, userId, userId);
  if (!c) throw Object.assign(new Error('Client not found'), { status: 404 });
  return c;
}

function quarterRange(year, quarter) {
  const starts = ['01-01', '04-01', '07-01', '10-01'];
  const ends   = ['03-31', '06-30', '09-30', '12-31'];
  return {
    start: `${year}-${starts[quarter - 1]}`,
    end:   `${year}-${ends[quarter - 1]}`,
  };
}

// ── GET /api/reports/941?clientId=X&year=2026&quarter=1 ──────────────────────
router.get('/941', (req, res) => {
  try {
    const { clientId, year, quarter } = req.query;
    if (!clientId || !year || !quarter) return res.status(400).json({ error: 'clientId, year, quarter required' });
    const db = getDb();
    const client = assertClient(db, clientId, req.user.id);
    const { start, end } = quarterRange(parseInt(year), parseInt(quarter));

    // Query paystubs (actual issued checks) for the quarter — exclude failed deposits
    const paystubs = db.prepare(`
      SELECT p.*, e.first_name, e.last_name
      FROM paystubs p
      LEFT JOIN employees e ON p.employee_id = e.id
      WHERE p.client_id = ?
        AND p.pay_period_end >= ?
        AND p.pay_period_end <= ?
        AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
      ORDER BY p.pay_period_end
    `).all(clientId, start, end);

    const employees = db.prepare('SELECT * FROM employees WHERE client_id = ? AND is_active = 1').all(clientId);
    const empCount  = employees.length || (paystubs.length > 0 ? 1 : 0);

    const wages          = round2(paystubs.reduce((s, r) => s + r.gross_wages, 0));
    const fitWithheld    = round2(paystubs.reduce((s, r) => s + r.fit_withholding, 0));
    const employeeSS     = round2(paystubs.reduce((s, r) => s + r.employee_ss, 0));
    const employerSS     = round2(paystubs.reduce((s, r) => s + r.employer_ss, 0));
    const employeeMed    = round2(paystubs.reduce((s, r) => s + r.employee_medicare, 0));
    const employerMed    = round2(paystubs.reduce((s, r) => s + r.employer_medicare, 0));
    const additionalMed  = round2(paystubs.reduce((s, r) => s + (r.additional_medicare || 0), 0));
    const totalSSTax     = round2((employeeSS + employerSS));
    const totalMedTax    = round2((employeeMed + employerMed + additionalMed));
    const totalTaxes     = round2(fitWithheld + totalSSTax + totalMedTax);
    const totalDeposited = round2(paystubs.filter((s) => s.status === 'submitted' || s.status === 'dry_run').reduce((sum, r) => sum + r.total_deposit, 0));
    const balanceDue     = round2(totalTaxes - totalDeposited);

    res.json({
      reportType: '941',
      client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' },
      period: { year: parseInt(year), quarter: parseInt(quarter), start, end },
      lines: {
        line1_employees:     empCount,
        line2_wages:         wages,
        line3_fitWithheld:   fitWithheld,
        line5a_ssWages:      wages,
        line5a_ssTax:        totalSSTax,
        line5c_medWages:     wages,
        line5c_medTax:       totalMedTax,
        line5d_additionalMedTax: additionalMed,
        line6_totalTaxes:    totalTaxes,
        line13_deposited:    totalDeposited,
        line14_balanceDue:   balanceDue,
      },
      // Exclude failed deposits from the supporting table
      submissions: paystubs
        .filter((s) => s.status !== 'failed')
        .map((s) => ({
          id: s.id, payPeriodEnd: s.pay_period_end,
          grossWages: s.gross_wages, fitWithholding: s.fit_withholding,
          ssTotal: round2(s.employee_ss + s.employer_ss),
          medTotal: round2(s.employee_medicare + s.employer_medicare),
          totalDeposit: s.total_deposit, eftpsStatus: s.status,
          employeeName: s.first_name ? `${s.first_name} ${s.last_name}` : (s.employee_name || null),
        })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/reports/940?clientId=X&year=2026 ────────────────────────────────
router.get('/940', (req, res) => {
  try {
    const { clientId, year } = req.query;
    if (!clientId || !year) return res.status(400).json({ error: 'clientId, year required' });
    const db = getDb();
    const client = assertClient(db, clientId, req.user.id);

    const subs = db.prepare(`
      SELECT p.*, p.employee_id as emp_id, e.first_name, e.last_name
      FROM paystubs p
      LEFT JOIN employees e ON p.employee_id = e.id
      WHERE p.client_id = ?
        AND p.pay_period_end >= ?
        AND p.pay_period_end <= ?
        AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
      ORDER BY p.employee_id, p.pay_period_end
    `).all(clientId, `${year}-01-01`, `${year}-12-31`);

    // Calculate FUTA per employee (or aggregate if no employee records)
    const byEmployee = {};
    for (const s of subs) {
      const key = s.emp_id || 'aggregate';
      if (!byEmployee[key]) byEmployee[key] = { name: s.first_name ? `${s.first_name} ${s.last_name}` : (s.employee_name || 'All Employees'), wages: 0, futaTaxable: 0, futaTax: 0 };
      const ytd = byEmployee[key].wages;
      const futa = calculateFUTA(s.gross_wages, ytd);
      byEmployee[key].wages      += s.gross_wages;
      byEmployee[key].futaTaxable += futa.taxableWages;
      byEmployee[key].futaTax    += futa.futaTax;
    }

    const totalWages     = round2(subs.reduce((s, r) => s + r.gross_wages, 0));
    const futaTaxable    = round2(Object.values(byEmployee).reduce((s, e) => s + e.futaTaxable, 0));
    const futaTax        = round2(Object.values(byEmployee).reduce((s, e) => s + e.futaTax, 0));
    const futaBeforeCredit = round2(futaTaxable * 0.06);

    res.json({
      reportType: '940',
      client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' },
      period: { year: parseInt(year) },
      lines: {
        line3_totalPayments:   totalWages,
        line5_futaTaxableWages: futaTaxable,
        line6_futaBeforeCredit: futaBeforeCredit,
        line8_stateCredit:     round2(futaTaxable * 0.054),
        line12_netFuta:        futaTax,
        wageBase:              FUTA_WAGE_BASE,
      },
      byEmployee: Object.values(byEmployee).map((e) => ({
        ...e,
        wages:       round2(e.wages),
        futaTaxable: round2(e.futaTaxable),
        futaTax:     round2(e.futaTax),
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/reports/twc-icesa?clientId=X&year=2026&quarter=1 ────────────────
// Generates a TWC-ICESA fixed-width file for TWC QuickFile 5.x.
// Correct record order: A (Transmitter) → E (Employer+totals) → S×N (Employees) → F (Final)
// Each record is exactly 275 characters, CRLF-terminated.
// Key TWC requirements:
//   • No 'B' record — 'E' is the employer header and comes BEFORE S records
//   • State code in E/S records must be FIPS '48' (Texas), not abbreviation
//   • A record must have 'UTAX' at pos 154-157
//   • TWC account number at pos 159-168 of E record
//   • Quarter (pos 169-170) + year (pos 171-174) in E record
router.get('/twc-icesa', (req, res) => {
  try {
    const { clientId, year, quarter } = req.query;
    if (!clientId || !year || !quarter) return res.status(400).json({ error: 'clientId, year, quarter required' });
    const db = getDb();
    const client = assertClient(db, clientId, req.user.id);

    const { start, end } = quarterRange(parseInt(year), parseInt(quarter));
    const qRateField = `sui_rate_q${parseInt(quarter)}`;
    const sutaRate = client[qRateField] != null ? client[qRateField] : (client.suta_rate || 0.027);

    const subs = db.prepare(`
      SELECT p.*, p.employee_id AS emp_id, e.first_name, e.last_name
      FROM paystubs p LEFT JOIN employees e ON p.employee_id = e.id
      WHERE p.client_id = ? AND p.pay_period_end >= ? AND p.pay_period_end <= ?
        AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
      ORDER BY p.employee_id, p.pay_period_end
    `).all(clientId, start, end);

    const ytdSubs = db.prepare(`
      SELECT p.gross_wages, p.employee_id FROM paystubs p
      WHERE p.client_id = ? AND p.pay_period_end >= ? AND p.pay_period_end < ?
        AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
    `).all(clientId, `${year}-01-01`, start);

    const ytdByEmp = {};
    for (const s of ytdSubs) {
      const k = s.employee_id || 'agg';
      ytdByEmp[k] = (ytdByEmp[k] || 0) + s.gross_wages;
    }

    const byEmployee = {};
    const empCache = {};
    for (const s of subs) {
      const key = s.emp_id || 'agg';
      if (!byEmployee[key]) {
        if (s.emp_id && !empCache[s.emp_id]) {
          const emp = db.prepare('SELECT ssn_encrypted, first_name, last_name FROM employees WHERE id = ?').get(s.emp_id);
          let ssn = '';
          if (emp?.ssn_encrypted) {
            try { ssn = decrypt(emp.ssn_encrypted).replace(/\D/g, ''); } catch (_) {}
          }
          empCache[s.emp_id] = { ssn, firstName: emp?.first_name || '', lastName: emp?.last_name || '' };
        }
        const c = empCache[s.emp_id] || {};
        byEmployee[key] = {
          ssn: c.ssn || '',
          firstName: (c.firstName || s.first_name || '').toUpperCase(),
          lastName:  (c.lastName  || s.last_name  || '').toUpperCase(),
          wages: 0, taxable: 0,
        };
      }
      const ytd  = (ytdByEmp[key] || 0) + byEmployee[key].wages;
      const suta = calculateSUTA(s.gross_wages, ytd, sutaRate);
      byEmployee[key].wages   += s.gross_wages;
      byEmployee[key].taxable += suta.taxableWages;
    }

    // Employee count on the 12th of each quarter month
    const Q_MONTHS = { 1:[1,2,3], 2:[4,5,6], 3:[7,8,9], 4:[10,11,12] };
    const qMonths = Q_MONTHS[parseInt(quarter)] || [1,2,3];
    const emp12th = qMonths.map(mo => {
      const d = `${year}-${String(mo).padStart(2,'0')}-12`;
      const r = db.prepare(`SELECT COUNT(DISTINCT employee_id) AS cnt FROM paystubs
        WHERE client_id=? AND pay_period_start<=? AND pay_period_end>=?
          AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
      `).get(clientId, d, d);
      return r?.cnt || 0;
    });

    const employees    = Object.values(byEmployee);
    const totalWages   = round2(employees.reduce((s, e) => s + e.wages,   0));
    const totalTaxable = round2(employees.reduce((s, e) => s + e.taxable, 0));
    const totalTax     = round2(totalTaxable * sutaRate);

    // ── ICESA record helpers ──────────────────────────────────────────────────
    const L    = (v, n) => String(v || '').padEnd(n).substring(0, n);          // left-justify, space-pad
    const R    = (v, n) => String(Math.round((v || 0) * 100)).padStart(n, '0').substring(0, n); // dollars→cents, right-zero-pad
    const I    = (v, n) => String(Math.round(v || 0)).padStart(n, '0').substring(0, n);          // integer, right-zero-pad
    const P275 = s => s.padEnd(275).substring(0, 275);                         // pad/trim to exactly 275 chars

    const ein    = (client.ein || '').replace(/\D/g, '').padEnd(9).substring(0, 9);
    const stFips = '48';                                                         // Texas FIPS code
    const zip    = (client.business_zip || '').replace(/\D/g, '').padEnd(5).substring(0, 5);
    const yr     = String(parseInt(year));                                       // 4-digit year string
    const qStr   = String(parseInt(quarter)).padStart(2, '0');                  // "01"–"04" (unused in period)
    // TWC period code = last month of the quarter (TWC ICESA spec, confirmed by QuickFile)
    // Q1→'03', Q2→'06', Q3→'09', Q4→'12'
    const periodCode = ['03', '06', '09', '12'][parseInt(quarter) - 1];
    // TWC account: strip dashes, exactly 9 digits (QuickFile reads 9 chars from pos 173-181)
    const acct9  = (client.sui_account_number || '').replace(/-/g, '').padEnd(9).substring(0, 9);

    const lines = [];

    // ── A Record: Transmitter ─────────────────────────────────────────────────
    // Per TWC ICESA spec: 'UTAX' (taxing entity code) at pos 15-18, right after EIN.
    // pos 139-140: FIPS state code; pos 154-158: ZIP code
    lines.push(P275(
      'A'                                      // pos 1
      + yr                                     // pos 2-5    tax year
      + ein                                    // pos 6-14   EIN
      + 'UTAX'                                 // pos 15-18  taxing entity code ← REQUIRED HERE
      + L('', 5)                               // pos 19-23  blanks
      + L(client.business_name, 50)            // pos 24-73  transmitter name
      + L(client.business_address, 40)         // pos 74-113 street
      + L(client.business_city, 25)            // pos 114-138 city
      + stFips                                 // pos 139-140 FIPS '48'
      + L('', 8)                               // pos 141-148 blanks
      + L('', 5)                               // pos 149-153 ZIP+4 / blanks
      + L(zip, 5)                              // pos 154-158 ZIP code
    ));

    // ── Shared employer identity block (B and E records) ─────────────────────
    // Per TWC ICESA spec and confirmed by QuickFile error messages:
    //   pos 139-140 : FIPS state code '48'              (spec field)
    //   pos 163-166 : 'UTAX'                            (spec field)
    //   pos 171-172 : FIPS state code '48'              (QuickFile reads state here)
    //   pos 173-181 : TWC UI account number (9 digits)  (QuickFile reads account here)
    // Prefix layout (1-indexed):
    //   1       record type (1)
    //   2-5     year (4)
    //   6-14    EIN (9)
    //   15-23   blanks (9)
    //   24-73   name (50)
    //   74-113  street (40)
    //   114-138 city (25)
    //   139-140 FIPS state (2)
    //   141-148 blanks (8)
    //   149-153 ZIP+4 / blanks (5)
    //   154-158 ZIP code (5)
    //   159-160 blanks (2)
    //   161-162 FIPS state (2)  [second state code per spec]
    //   163-166 'UTAX' (4)
    //   167-170 blanks (4)
    //   171-172 FIPS state (2)  [QuickFile reads state here]
    //   173-181 account (9)     [QuickFile reads account here]
    const employerPrefix = (recordType) =>
      recordType
      + yr                                     // pos 2-5
      + ein                                    // pos 6-14
      + L('', 9)                               // pos 15-23
      + L(client.business_name, 50)            // pos 24-73
      + L(client.business_address, 40)         // pos 74-113
      + L(client.business_city, 25)            // pos 114-138
      + stFips                                 // pos 139-140  FIPS '48'
      + L('', 8)                               // pos 141-148
      + L('', 5)                               // pos 149-153  ZIP+4 / blanks
      + L(zip, 5)                              // pos 154-158  ZIP code
      + L('', 2)                               // pos 159-160  blanks
      + stFips                                 // pos 161-162  FIPS state (spec field)
      + 'UTAX'                                 // pos 163-166  taxing entity code
      + L('', 4)                               // pos 167-170  blanks
      + stFips                                 // pos 171-172  FIPS '48' ← QuickFile reads state here
      + acct9;                                 // pos 173-181  account (9) ← QuickFile reads account here

    // ── B Record: Basic Employer Info — required by QuickFile before E ────────
    // QuickFile 5.x requires record order: A → B → E → S → F.
    // B record uses the same employer prefix block (pos 1-181) as E, padded to 275.
    lines.push(P275(employerPrefix('B')));

    // ── E Record: Employer Record ──────────────────────────────────────────────
    // After the 181-char employer prefix:
    //   pos 182-187 : NAICS code (6, blanks if unknown)
    //   pos 188-189 : TWC reporting period (2) ← last month of quarter: Q2='06'
    //   pos 190     : has-workers indicator '1'
    lines.push(P275(
      employerPrefix('E')
      + L(client.naics_code || '', 6)          // pos 182-187  NAICS code or blanks
      + periodCode                             // pos 188-189  period: '03'/'06'/'09'/'12'
      + '1'                                    // pos 190      has S records
    ));

    // ── S Records: one per employee ───────────────────────────────────────────
    // Confirmed field positions (empirically verified across QuickFile test rounds):
    //   pos 44-45   : FIPS state code '48'           (confirmed round 6)
    //   pos 46-49   : reporting year (4)              (replaces 4 blanks — only free 4-char slot)
    //   pos 50-63   : quarterly gross wages (14 chars, cents) ← 14-char confirmed by rounds 7/9
    //   pos 64-77   : quarterly UI total wages (14 chars, cents) ← QuickFile reads 14-char from pos 64
    //   pos 78-91   : quarterly UI excess wages (14 chars, cents)
    //   pos 92-105  : quarterly UI taxable wages (14 chars, cents) ← QuickFile reads 14-char from pos 92
    //   pos 106-120 : SDI taxable wages (15 zeros — TX has no SDI)
    //   pos 121-129 : tip wages (9 zeros)
    //   pos 130-131 : weeks worked (blanks)
    //   pos 132-134 : hours worked (blanks)
    //   pos 135-142 : blanks (8)
    //   pos 143-146 : 'UTAX'                          (confirmed round 7)
    //   pos 147-155 : TWC account number (9)          (confirmed round 7)
    //   pos 156-214 : blanks (59)
    //   pos 215-216 : ending month of quarter (2)     ← ICESA MMYYYY combined field, part 1
    //   pos 217-220 : reporting year (4)              ← ICESA MMYYYY combined field, part 2
    // Skip employees with no SSN (unlinked paystub aggregates)
    const validEmployees = employees.filter(e => e.ssn && e.ssn.replace(/\D/g, '').length === 9);
    // Recompute wage totals from valid employees ONLY — totalWages above includes unlinked paystubs
    // that are excluded from S records, which would cause a T/F vs S-sum mismatch in QuickFile.
    const icesaWages    = round2(validEmployees.reduce((s, e) => s + e.wages,   0));
    const icesaTaxable  = round2(validEmployees.reduce((s, e) => s + e.taxable, 0));
    const icesaTax      = round2(icesaTaxable * sutaRate);
    for (const emp of validEmployees) {
      const excessWages = round2(Math.max(0, emp.wages - emp.taxable));
      lines.push(P275(
        'S'                                    // pos 1
        + emp.ssn.padStart(9, '0').substring(0, 9) // pos 2-10  SSN
        + L(emp.lastName,  20)                 // pos 11-30
        + L(emp.firstName, 12)                 // pos 31-42
        + ' '                                  // pos 43     middle initial
        + stFips                               // pos 44-45  FIPS '48'
        + yr                                   // pos 46-49  year ← only free 4-char slot before wages
        + R(emp.wages,   14)                   // pos 50-63  gross wages (14)
        + R(emp.wages,   14)                   // pos 64-77  UI total wages (14) ← QuickFile reads 14-char here
        + R(excessWages, 14)                   // pos 78-91  UI excess wages (14)
        + R(emp.taxable, 14)                   // pos 92-105 UI taxable wages (14) ← QuickFile reads 14-char here
        + '000000000000000'                    // pos 106-120 SDI taxable (15 zeros, TX has no SDI)
        + '000000000'                          // pos 121-129 tip wages (9 zeros)
        + L('', 2)                             // pos 130-131 weeks worked
        + L('', 3)                             // pos 132-134 hours worked
        + L('', 8)                             // pos 135-142 blanks
        + 'UTAX'                               // pos 143-146 taxing entity code
        + acct9                                // pos 147-155 TWC account
        + L('', 59)                            // pos 156-214 blanks
        + periodCode                           // pos 215-216 MMYYYY part 1: ending month of quarter
        + yr                                   // pos 217-220 MMYYYY part 2: year
      ));
    }

    // ── T Record: State Employer Total — required after all S records ─────────
    // Per TWC ICESA spec: one T record per E record, summarizing all S records.
    // Tax rate format: decimal point + 5 digits, e.g. 2.7% → '.02700'
    const tRateStr = '.' + String(Math.round(sutaRate * 100000)).padStart(5, '0').substring(0, 5);
    lines.push(P275(
      'T'
      + I(validEmployees.length, 7)            // pos 2-8   employee count for this E record
      + 'UTAX'                                 // pos 9-12  taxing entity code
      + L('', 14)                              // pos 13-26 gross wages = blanks (per spec)
      + R(icesaWages, 14)                       // pos 27-40 UI total wages (14, cents)
      + L('', 14)                              // pos 41-54 excess wages = blanks (per spec)
      + R(icesaTaxable, 14)                    // pos 55-68 UI taxable wages (14, cents)
      + L('', 13)                              // pos 69-81 tip wages = blanks
      + tRateStr                               // pos 82-87 UI tax rate (e.g. '.02700')
      + R(icesaTax, 13)                        // pos 88-100 taxes due (13, cents)
      + L('', 11)                              // pos 101-111 prior underpayment = blanks
      + L('', 11)                              // pos 112-122 interest = blanks
      + L('', 11)                              // pos 123-133 penalty = blanks
      + L('', 11)                              // pos 134-144 credit = blanks
      + L('', 4)                               // pos 145-148 employer assessment rate = blanks
      + L('', 11)                              // pos 149-159 employer assessment amt = blanks
      + L('', 4)                               // pos 160-163 employee assessment rate = blanks
      + L('', 11)                              // pos 164-174 employee assessment amt = blanks
      + L('', 11)                              // pos 175-185 total payment due = blanks
      + L('', 13)                              // pos 186-198 allocation amount = blanks
      + L('', 14)                              // pos 199-212 wages for state income tax = blanks
      + L('', 14)                              // pos 213-226 state income tax withheld = blanks
      + I(emp12th[0] || 0, 7)                  // pos 227-233 month 1 employment (12th-day count)
      + I(emp12th[1] || 0, 7)                  // pos 234-240 month 2 employment
      + I(emp12th[2] || 0, 7)                  // pos 241-247 month 3 employment
      + String(parseInt(client.county_code) || 0).padStart(3, '0').substring(0, 3) // pos 248-250 county code (odd 1-507)
      + I(0, 7)                                // pos 251-257 outside-county employees (zeros)
      + L('', 10)                              // pos 258-267 document control number = blanks
      + L('', 8)                               // pos 268-275 blanks
    ));

    // ── F Record: Final — must be the very last record ────────────────────────
    // Per TWC ICESA spec:
    //   pos 2-11  : total S records in file (10)
    //   pos 12-21 : total E records in file (10)
    //   pos 22-25 : 'UTAX' taxing entity code
    //   pos 26-40 : total gross wages = blanks (per spec)
    //   pos 41-55 : total UI total wages (15, cents)
    //   pos 56-70 : total excess wages = blanks (per spec)
    //   pos 71-85 : total UI taxable wages (15, cents)
    lines.push(P275(
      'F'
      + I(validEmployees.length, 10)           // pos 2-11  total S employee records
      + I(1, 10)                               // pos 12-21 total E employer records
      + 'UTAX'                                 // pos 22-25 taxing entity code
      + L('', 15)                              // pos 26-40 total gross wages = blanks
      + R(icesaWages, 15)                       // pos 41-55 total UI wages (15, cents)
      + L('', 15)                              // pos 56-70 total excess wages = blanks
      + R(icesaTaxable, 15)                    // pos 71-85 total taxable wages (15, cents)
    ));

    const bizSlug = (client.business_name || 'report').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
    const filename = `TWC_Q${quarter}_${year}_${bizSlug}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\r\n') + '\r\n'); // CRLF line endings (Windows / QuickFile)
  } catch (err) {
    console.error('twc-icesa error:', err);
    res.status(500).json({ error: 'Failed to generate ICESA file', detail: err.message });
  }
});

// ── GET /api/reports/twc?clientId=X&year=2026&quarter=1 ──────────────────────
router.get('/twc', (req, res) => {
  try {
    const { clientId, year, quarter } = req.query;
    if (!clientId || !year || !quarter) return res.status(400).json({ error: 'clientId, year, quarter required' });
    const db = getDb();
    const client = assertClient(db, clientId, req.user.id);
    const { start, end } = quarterRange(parseInt(year), parseInt(quarter));
    const qRateField = `sui_rate_q${parseInt(quarter)}`;
    const sutaRate = client[qRateField] != null ? client[qRateField] : (client.suta_rate || 0.027);

    const subs = db.prepare(`
      SELECT p.*, p.employee_id as emp_id, e.first_name, e.last_name
      FROM paystubs p
      LEFT JOIN employees e ON p.employee_id = e.id
      WHERE p.client_id = ?
        AND p.pay_period_end >= ?
        AND p.pay_period_end <= ?
        AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
      ORDER BY p.employee_id, p.pay_period_end
    `).all(clientId, start, end);

    // Need YTD wages from prior quarters for wage base tracking
    const ytdSubs = db.prepare(`
      SELECT p.gross_wages, p.employee_id
      FROM paystubs p
      WHERE p.client_id = ?
        AND p.pay_period_end >= ?
        AND p.pay_period_end < ?
        AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
      ORDER BY p.employee_id, p.pay_period_end
    `).all(clientId, `${year}-01-01`, start);

    const ytdByEmp = {};
    for (const s of ytdSubs) {
      const k = s.employee_id || 'aggregate';
      ytdByEmp[k] = (ytdByEmp[k] || 0) + s.gross_wages;
    }

    const byEmployee = {};
    const empSsnCache = {};
    for (const s of subs) {
      const key = s.emp_id || 'aggregate';
      if (!byEmployee[key]) {
        let ssn = '';
        if (s.emp_id && !empSsnCache[s.emp_id]) {
          const emp = db.prepare('SELECT ssn_encrypted FROM employees WHERE id = ?').get(s.emp_id);
          if (emp?.ssn_encrypted) {
            try {
              const raw = decrypt(emp.ssn_encrypted).replace(/\D/g, '');
              empSsnCache[s.emp_id] = raw.length === 9 ? raw.replace(/(\d{3})(\d{2})(\d{4})/, '$1-$2-$3') : raw;
            } catch (e) {}
          }
        }
        if (s.emp_id && empSsnCache[s.emp_id]) ssn = empSsnCache[s.emp_id];
        byEmployee[key] = { name: s.first_name ? `${s.first_name} ${s.last_name}` : (s.employee_name || 'All Employees'), ssn, wages: 0, sutaTaxable: 0, sutaTax: 0 };
      }
      const ytd  = (ytdByEmp[key] || 0) + byEmployee[key].wages;
      const suta = calculateSUTA(s.gross_wages, ytd, sutaRate);
      byEmployee[key].wages       += s.gross_wages;
      byEmployee[key].sutaTaxable += suta.taxableWages;
      byEmployee[key].sutaTax     += suta.sutaTax;
    }

    const totalWages    = round2(subs.reduce((s, r) => s + r.gross_wages, 0));
    const sutaTaxable   = round2(Object.values(byEmployee).reduce((s, e) => s + e.sutaTaxable, 0));
    const sutaTax       = round2(Object.values(byEmployee).reduce((s, e) => s + e.sutaTax, 0));

    // Count distinct employees whose pay period includes the 12th of each quarter month
    const QUARTER_MONTHS = { 1: [1,2,3], 2: [4,5,6], 3: [7,8,9], 4: [10,11,12] };
    const qMonths = QUARTER_MONTHS[parseInt(quarter)] || [1,2,3];
    const emp12th = qMonths.map(month => {
      const the12th = `${year}-${String(month).padStart(2,'0')}-12`;
      const row = db.prepare(`
        SELECT COUNT(DISTINCT employee_id) as cnt FROM paystubs
        WHERE client_id = ? AND pay_period_start <= ? AND pay_period_end >= ?
          AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
      `).get(clientId, the12th, the12th);
      return row?.cnt || 0;
    });

    res.json({
      reportType: 'TWC',
      client: {
        businessName: client.business_name,
        ein: client.ein,
        businessAddress: client.business_address,
        businessCity: client.business_city,
        businessZip: client.business_zip,
        state: client.state || 'TX',
        suiAccountNumber: client.sui_account_number || '',
        naicsCode: client.naics_code || '',
        countyCode: client.county_code || '',
      },
      period: { year: parseInt(year), quarter: parseInt(quarter), start, end },
      sutaRate,
      lines: {
        totalWages,
        sutaTaxableWages: sutaTaxable,
        sutaTax,
        wageBase: SUTA_WAGE_BASE,
      },
      byEmployee: Object.values(byEmployee).map((e) => ({
        ...e,
        wages:       round2(e.wages),
        sutaTaxable: round2(e.sutaTaxable),
        sutaTax:     round2(e.sutaTax),
      })),
      emp12th,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/reports/w2?clientId=X&year=2026 ─────────────────────────────────
router.get('/w2', (req, res) => {
  try {
    const { clientId, year } = req.query;
    if (!clientId || !year) return res.status(400).json({ error: 'clientId, year required' });
    const db = getDb();
    const client = assertClient(db, clientId, req.user.id);
    const employees = db.prepare('SELECT * FROM employees WHERE client_id = ?').all(clientId);

    if (employees.length === 0) return res.status(400).json({ error: 'No employees found for this client. Add employees first to generate W-2s.' });

    const w2s = employees.map((emp) => {
      const subs = db.prepare(`
        SELECT * FROM paystubs
        WHERE client_id = ? AND employee_id = ? AND pay_period_end >= ? AND pay_period_end <= ?
          AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
      `).all(clientId, emp.id, `${year}-01-01`, `${year}-12-31`);

      const box1  = round2(subs.reduce((s, r) => s + r.gross_wages, 0));        // wages
      const box2  = round2(subs.reduce((s, r) => s + r.fit_withholding, 0));    // FIT withheld
      const box3  = round2(subs.reduce((s, r) => s + r.gross_wages, 0));        // SS wages
      const box4  = round2(subs.reduce((s, r) => s + r.employee_ss, 0));        // SS tax withheld
      const box5  = round2(subs.reduce((s, r) => s + r.gross_wages, 0));        // Medicare wages
      const box6  = round2(subs.reduce((s, r) => s + r.employee_medicare, 0));  // Medicare tax withheld
      const box16 = box1; // State wages = federal wages (TX has no state income tax)
      const box17 = 0;    // TX has no state income tax

      return {
        employeeId:   emp.id,
        firstName:    emp.first_name,
        lastName:     emp.last_name,
        ssn:          emp.ssn_encrypted ? maskSSN(decrypt(emp.ssn_encrypted)) : '***-**-****',
        address:      emp.address, city: emp.city, state: emp.state, zip: emp.zip,
        box1_wages:   box1,  box2_fitWithheld: box2,
        box3_ssWages: box3,  box4_ssTax:       box4,
        box5_medWages: box5, box6_medTax:       box6,
        box15_state:  'TX',  box16_stateWages:  box16, box17_stateTax: box17,
        submissionCount: subs.length,
      };
    });

    res.json({
      reportType: 'W-2',
      client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' },
      period: { year: parseInt(year) },
      w2s,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/reports/w3?clientId=X&year=2026 ─────────────────────────────────
router.get('/w3', (req, res) => {
  try {
    const { clientId, year } = req.query;
    if (!clientId || !year) return res.status(400).json({ error: 'clientId, year required' });
    const db = getDb();
    const client = assertClient(db, clientId, req.user.id);

    const subs = db.prepare(`
      SELECT * FROM paystubs
      WHERE client_id = ? AND pay_period_end >= ? AND pay_period_end <= ?
        AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
    `).all(clientId, `${year}-01-01`, `${year}-12-31`);

    const empCount = db.prepare('SELECT COUNT(*) as cnt FROM employees WHERE client_id = ?').get(clientId).cnt;

    res.json({
      reportType: 'W-3',
      client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' },
      period: { year: parseInt(year) },
      totals: {
        employeeCount:   empCount,
        box1_wages:      round2(subs.reduce((s, r) => s + r.gross_wages, 0)),
        box2_fitWithheld: round2(subs.reduce((s, r) => s + r.fit_withholding, 0)),
        box3_ssWages:    round2(subs.reduce((s, r) => s + r.gross_wages, 0)),
        box4_ssTax:      round2(subs.reduce((s, r) => s + r.employee_ss, 0)),
        box5_medWages:   round2(subs.reduce((s, r) => s + r.gross_wages, 0)),
        box6_medTax:     round2(subs.reduce((s, r) => s + r.employee_medicare, 0)),
        box15_state:     'TX',
        box16_stateWages: round2(subs.reduce((s, r) => s + r.gross_wages, 0)),
        box17_stateTax:  0,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function maskSSN(ssn) {
  if (!ssn) return '***-**-****';
  const clean = ssn.replace(/\D/g, '');
  return `***-**-${clean.slice(-4)}`;
}

// ── GET /api/reports/pdf?form=941&clientId=X&year=2026&quarter=1 ─────────────
router.get('/pdf', async (req, res) => {
  try {
    const { form, clientId, year, quarter } = req.query;
    if (!form || !clientId || !year) return res.status(400).json({ error: 'form, clientId, year required' });

    const db = getDb();
    const client = assertClient(db, clientId, req.user.id);

    // Fetch preparer info
    const userRow = db.prepare('SELECT preparer_info FROM users WHERE id = ?').get(req.user.id);
    let pr = null;
    if (userRow?.preparer_info) {
      try { pr = JSON.parse(userRow.preparer_info); } catch (e) {}
    }

    let data;

    if (form === '941') {
      if (!quarter) return res.status(400).json({ error: 'quarter required for 941' });
      const { start, end } = quarterRange(parseInt(year), parseInt(quarter));
      const paystubs = db.prepare(`
        SELECT p.*, e.first_name, e.last_name
        FROM paystubs p
        LEFT JOIN employees e ON p.employee_id = e.id
        WHERE p.client_id = ?
          AND p.pay_period_end >= ? AND p.pay_period_end <= ?
          AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
        ORDER BY p.pay_period_end
      `).all(clientId, start, end);
      const employees = db.prepare('SELECT * FROM employees WHERE client_id = ? AND is_active = 1').all(clientId);
      const empCount  = employees.length || (paystubs.length > 0 ? 1 : 0);
      const wages       = round2(paystubs.reduce((s, r) => s + r.gross_wages, 0));
      const fitWithheld = round2(paystubs.reduce((s, r) => s + r.fit_withholding, 0));
      const employeeSS  = round2(paystubs.reduce((s, r) => s + r.employee_ss, 0));
      const employerSS  = round2(paystubs.reduce((s, r) => s + r.employer_ss, 0));
      const employeeMed    = round2(paystubs.reduce((s, r) => s + r.employee_medicare, 0));
      const employerMed    = round2(paystubs.reduce((s, r) => s + r.employer_medicare, 0));
      const additionalMed2 = round2(paystubs.reduce((s, r) => s + (r.additional_medicare || 0), 0));
      const totalSSTax  = round2(employeeSS + employerSS);
      const totalMedTax = round2(employeeMed + employerMed + additionalMed2);
      const totalTaxes  = round2(fitWithheld + totalSSTax + totalMedTax);
      const totalDeposited = round2(paystubs.filter((s) => s.status === 'submitted' || s.status === 'dry_run').reduce((sum, r) => sum + r.total_deposit, 0));
      data = {
        reportType: '941',
        client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' },
        period: { year: parseInt(year), quarter: parseInt(quarter), start, end },
        lines: { line1_employees: empCount, line2_wages: wages, line3_fitWithheld: fitWithheld, line5a_ssWages: wages, line5a_ssTax: totalSSTax, line5c_medWages: wages, line5c_medTax: totalMedTax, line6_totalTaxes: totalTaxes, line13_deposited: totalDeposited, line14_balanceDue: round2(totalTaxes - totalDeposited) },
        submissions: paystubs.filter((s) => s.status !== 'failed').map((s) => ({ id: s.id, payPeriodEnd: s.pay_period_end, grossWages: s.gross_wages, fitWithholding: s.fit_withholding, ssTotal: round2(s.employee_ss + s.employer_ss), medTotal: round2(s.employee_medicare + s.employer_medicare), totalDeposit: s.total_deposit, eftpsStatus: s.status, employeeName: s.first_name ? `${s.first_name} ${s.last_name}` : (s.employee_name || null) })),
      };

    } else if (form === '940') {
      const subs = db.prepare(`
        SELECT p.*, p.employee_id as emp_id, e.first_name, e.last_name
        FROM paystubs p
        LEFT JOIN employees e ON p.employee_id = e.id
        WHERE p.client_id = ?
          AND p.pay_period_end >= ? AND p.pay_period_end <= ?
          AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
        ORDER BY p.employee_id, p.pay_period_end
      `).all(clientId, `${year}-01-01`, `${year}-12-31`);
      const byEmployee = {};
      for (const s of subs) {
        const key = s.emp_id || 'aggregate';
        if (!byEmployee[key]) byEmployee[key] = { name: s.first_name ? `${s.first_name} ${s.last_name}` : (s.employee_name || 'All Employees'), wages: 0, futaTaxable: 0, futaTax: 0 };
        const ytd = byEmployee[key].wages;
        const futa = calculateFUTA(s.gross_wages, ytd);
        byEmployee[key].wages += s.gross_wages;
        byEmployee[key].futaTaxable += futa.taxableWages;
        byEmployee[key].futaTax += futa.futaTax;
      }
      const totalWages  = round2(subs.reduce((s, r) => s + r.gross_wages, 0));
      const futaTaxable = round2(Object.values(byEmployee).reduce((s, e) => s + e.futaTaxable, 0));
      const futaTax     = round2(Object.values(byEmployee).reduce((s, e) => s + e.futaTax, 0));
      data = {
        reportType: '940',
        client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' },
        period: { year: parseInt(year) },
        lines: { line3_totalPayments: totalWages, line5_futaTaxableWages: futaTaxable, line6_futaBeforeCredit: round2(futaTaxable * 0.06), line8_stateCredit: round2(futaTaxable * 0.054), line12_netFuta: futaTax, wageBase: FUTA_WAGE_BASE },
        byEmployee: Object.values(byEmployee).map((e) => ({ ...e, wages: round2(e.wages), futaTaxable: round2(e.futaTaxable), futaTax: round2(e.futaTax) })),
      };

    } else if (form === 'TWC') {
      if (!quarter) return res.status(400).json({ error: 'quarter required for TWC' });
      const { start, end } = quarterRange(parseInt(year), parseInt(quarter));
      const qRateField2 = `sui_rate_q${parseInt(quarter)}`;
      const sutaRate = client[qRateField2] != null ? client[qRateField2] : (client.suta_rate || 0.027);
      const subs = db.prepare(`
        SELECT p.*, p.employee_id as emp_id, e.first_name, e.last_name
        FROM paystubs p
        LEFT JOIN employees e ON p.employee_id = e.id
        WHERE p.client_id = ?
          AND p.pay_period_end >= ? AND p.pay_period_end <= ?
          AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
        ORDER BY p.employee_id, p.pay_period_end
      `).all(clientId, start, end);
      const ytdSubs = db.prepare(`
        SELECT p.gross_wages, p.employee_id FROM paystubs p
        WHERE p.client_id = ? AND p.pay_period_end >= ? AND p.pay_period_end < ?
          AND p.check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
      `).all(clientId, `${year}-01-01`, start);
      const ytdByEmp = {};
      for (const s of ytdSubs) { const k = s.employee_id || 'aggregate'; ytdByEmp[k] = (ytdByEmp[k] || 0) + s.gross_wages; }
      const byEmployee = {};
      const empSsnCache2 = {};
      for (const s of subs) {
        const key = s.emp_id || 'aggregate';
        if (!byEmployee[key]) {
          let ssn = '';
          if (s.emp_id && !empSsnCache2[s.emp_id]) {
            const emp = db.prepare('SELECT ssn_encrypted FROM employees WHERE id = ?').get(s.emp_id);
            if (emp?.ssn_encrypted) {
              try {
                const raw = decrypt(emp.ssn_encrypted).replace(/\D/g, '');
                empSsnCache2[s.emp_id] = raw.length === 9 ? raw.replace(/(\d{3})(\d{2})(\d{4})/, '$1-$2-$3') : raw;
              } catch (e) {}
            }
          }
          if (s.emp_id && empSsnCache2[s.emp_id]) ssn = empSsnCache2[s.emp_id];
          byEmployee[key] = { name: s.first_name ? `${s.first_name} ${s.last_name}` : (s.employee_name || 'All Employees'), ssn, wages: 0, sutaTaxable: 0, sutaTax: 0 };
        }
        const ytd  = (ytdByEmp[key] || 0) + byEmployee[key].wages;
        const suta = calculateSUTA(s.gross_wages, ytd, sutaRate);
        byEmployee[key].wages += s.gross_wages;
        byEmployee[key].sutaTaxable += suta.taxableWages;
        byEmployee[key].sutaTax += suta.sutaTax;
      }
      const QUARTER_MONTHS2 = { 1: [1,2,3], 2: [4,5,6], 3: [7,8,9], 4: [10,11,12] };
      const qMonths2 = QUARTER_MONTHS2[parseInt(quarter)] || [1,2,3];
      const emp12th2 = qMonths2.map(month => {
        const the12th = `${year}-${String(month).padStart(2,'0')}-12`;
        const row = db.prepare(`
          SELECT COUNT(DISTINCT employee_id) as cnt FROM paystubs
          WHERE client_id = ? AND pay_period_start <= ? AND pay_period_end >= ?
            AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
        `).get(clientId, the12th, the12th);
        return row?.cnt || 0;
      });
      data = {
        reportType: 'TWC',
        client: {
          businessName: client.business_name,
          ein: client.ein,
          businessAddress: client.business_address,
          businessCity: client.business_city,
          businessZip: client.business_zip,
          state: client.state || 'TX',
          suiAccountNumber: client.sui_account_number || '',
          naicsCode: client.naics_code || '',
          countyCode: client.county_code || '',
        },
        period: { year: parseInt(year), quarter: parseInt(quarter), start, end },
        sutaRate,
        lines: { totalWages: round2(subs.reduce((s, r) => s + r.gross_wages, 0)), sutaTaxableWages: round2(Object.values(byEmployee).reduce((s, e) => s + e.sutaTaxable, 0)), sutaTax: round2(Object.values(byEmployee).reduce((s, e) => s + e.sutaTax, 0)), wageBase: SUTA_WAGE_BASE },
        byEmployee: Object.values(byEmployee).map((e) => ({ ...e, wages: round2(e.wages), sutaTaxable: round2(e.sutaTaxable), sutaTax: round2(e.sutaTax) })),
        emp12th: emp12th2,
      };

    } else if (form === 'W-2') {
      const employees = db.prepare('SELECT * FROM employees WHERE client_id = ?').all(clientId);
      if (employees.length === 0) return res.status(400).json({ error: 'No employees found' });
      const w2s = employees.map((emp) => {
        const subs = db.prepare(`SELECT * FROM paystubs WHERE client_id = ? AND employee_id = ? AND pay_period_end >= ? AND pay_period_end <= ? AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')`).all(clientId, emp.id, `${year}-01-01`, `${year}-12-31`);
        const box1 = round2(subs.reduce((s, r) => s + r.gross_wages, 0));
        return { employeeId: emp.id, firstName: emp.first_name, lastName: emp.last_name, ssn: emp.ssn_encrypted ? maskSSN(decrypt(emp.ssn_encrypted)) : '***-**-****', address: emp.address, city: emp.city, state: emp.state, zip: emp.zip, box1_wages: box1, box2_fitWithheld: round2(subs.reduce((s, r) => s + r.fit_withholding, 0)), box3_ssWages: box1, box4_ssTax: round2(subs.reduce((s, r) => s + r.employee_ss, 0)), box5_medWages: box1, box6_medTax: round2(subs.reduce((s, r) => s + r.employee_medicare, 0)), box15_state: 'TX', box16_stateWages: box1, box17_stateTax: 0 };
      });
      data = { reportType: 'W-2', client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' }, period: { year: parseInt(year) }, w2s };

    } else if (form === 'W-3') {
      const subs = db.prepare(`SELECT * FROM paystubs WHERE client_id = ? AND pay_period_end >= ? AND pay_period_end <= ? AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')`).all(clientId, `${year}-01-01`, `${year}-12-31`);
      const empCount = db.prepare('SELECT COUNT(*) as cnt FROM employees WHERE client_id = ?').get(clientId).cnt;
      data = { reportType: 'W-3', client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' }, period: { year: parseInt(year) }, totals: { employeeCount: empCount, box1_wages: round2(subs.reduce((s, r) => s + r.gross_wages, 0)), box2_fitWithheld: round2(subs.reduce((s, r) => s + r.fit_withholding, 0)), box3_ssWages: round2(subs.reduce((s, r) => s + r.gross_wages, 0)), box4_ssTax: round2(subs.reduce((s, r) => s + r.employee_ss, 0)), box5_medWages: round2(subs.reduce((s, r) => s + r.gross_wages, 0)), box6_medTax: round2(subs.reduce((s, r) => s + r.employee_medicare, 0)), box15_state: 'TX', box16_stateWages: round2(subs.reduce((s, r) => s + r.gross_wages, 0)), box17_stateTax: 0 } };

    } else {
      return res.status(400).json({ error: `Unknown form type: ${form}` });
    }

    const html = generateFormHtml(data, pr);
    const pdf  = await htmlToPdf(html);

    const filename = `${form.replace(/[^a-z0-9]/gi, '-')}-${year}${quarter ? `-Q${quarter}` : ''}.pdf`;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
