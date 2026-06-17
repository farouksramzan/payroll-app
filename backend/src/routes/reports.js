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
  const c = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, userId);
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
    const totalSSTax     = round2((employeeSS + employerSS));
    const totalMedTax    = round2((employeeMed + employerMed));
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
    const stAbbr = (client.state || 'TX').substring(0, 2).toUpperCase();       // abbreviation for A record
    const stFips = '48';                                                         // Texas FIPS code (B, E, S records)
    const zip    = (client.business_zip || '').replace(/\D/g, '').padEnd(5).substring(0, 5);
    const yr     = String(parseInt(year));                                       // 4-digit year string
    const qStr   = String(parseInt(quarter)).padStart(2, '0');                  // "01"–"04"
    const period = yr + qStr;                                                    // YYYYQQ e.g. "202602" ← 6-char period field
    // TWC account: strip dashes, exactly 9 digits (QuickFile reads 9 chars from pos 173-181)
    const acct9  = (client.sui_account_number || '').replace(/-/g, '').padEnd(9).substring(0, 9);

    const lines = [];

    // ── A Record: Transmitter ─────────────────────────────────────────────────
    // 'UTAX' at pos 150-153 (immediately after ZIP+4 — no blank gap between them)
    lines.push(P275(
      'A'                                      // pos 1      record id
      + yr                                     // pos 2-5    tax year
      + ein                                    // pos 6-14   EIN
      + L('', 9)                               // pos 15-23  blanks
      + L(client.business_name, 50)            // pos 24-73  transmitter name
      + L(client.business_address, 40)         // pos 74-113 street
      + L(client.business_city, 25)            // pos 114-138 city
      + L(stAbbr, 2)                           // pos 139-140 state abbreviation (TX)
      + L(zip, 5)                              // pos 141-145 ZIP
      + L('', 4)                               // pos 146-149 ZIP+4 (or blanks)
      + 'UTAX'                                 // pos 150-153 filing type ← REQUIRED (no blank before it)
      + L('', 10)                              // pos 154-163 contact name
      + L('', 10)                              // pos 164-173 contact phone
    ));

    // ── Shared employer identity block (B and E records) ─────────────────────
    // Layout engineered so QuickFile finds fields at the positions it expects:
    //   pos 171-172 : FIPS state code '48'
    //   pos 173-181 : TWC UI account number (9 digits, no dashes)
    // Prefix breakdown (all 1-indexed):
    //   1        record type
    //   2-5      year (4)
    //   6-14     EIN (9)
    //   15-23    blanks (9)
    //   24-73    name (50)
    //   74-113   street (40)
    //   114-138  city (25)
    //   139-140  state abbreviation (2)
    //   141-145  ZIP (5)
    //   146-149  ZIP+4 / blanks (4)
    //   150-159  blanks/phone (10)
    //   160-170  blanks (11)
    //   171-172  FIPS state code (2)   ← QuickFile reads state here
    //   173-181  TWC account (9)       ← QuickFile reads account here
    const employerPrefix = (recordType) =>
      recordType
      + yr                                     // pos 2-5
      + ein                                    // pos 6-14
      + L('', 9)                               // pos 15-23
      + L(client.business_name, 50)            // pos 24-73
      + L(client.business_address, 40)         // pos 74-113
      + L(client.business_city, 25)            // pos 114-138
      + L(stAbbr, 2)                           // pos 139-140  state abbr (TX)
      + L(zip, 5)                              // pos 141-145
      + L('', 4)                               // pos 146-149  ZIP+4 / blanks
      + L('', 10)                              // pos 150-159  blanks
      + L('', 11)                              // pos 160-170  blanks
      + stFips                                 // pos 171-172  FIPS '48' ← QuickFile reads here
      + acct9;                                 // pos 173-181  account (9 digits) ← QuickFile reads here

    // ── B Record: Employer Basic Info (required by QuickFile before E) ────────
    lines.push(P275(employerPrefix('B')));

    // ── E Record: Employer Wage Data ──────────────────────────────────────────
    // Continues employer prefix with year, 2 filler blanks, quarter, then counts
    // and wage totals.  QuickFile reads:
    //   year    from pos 182-185 (4 chars)
    //   quarter from pos 188-189 (2 chars) — 2 filler blanks sit at 186-187
    //   month-1 count at pos 190-192 (3 chars)
    //   month-2 count at pos 193-195 (3 chars)
    //   month-3 count at pos 196-198 (3 chars)
    //   total wages    at pos 199-210 (12 chars, cents)
    //   taxable wages  at pos 211-222 (12 chars, cents)
    //   UI tax due     at pos 223-232 (10 chars, cents)
    lines.push(P275(
      employerPrefix('E')
      + yr                                     // pos 182-185  year (4)
      + L('', 2)                               // pos 186-187  filler blanks
      + qStr                                   // pos 188-189  quarter (2) ← QuickFile reads here
      + I(emp12th[0], 3)                       // pos 190-192
      + I(emp12th[1], 3)                       // pos 193-195
      + I(emp12th[2], 3)                       // pos 196-198
      + R(totalWages,   12)                    // pos 199-210
      + R(totalTaxable, 12)                    // pos 211-222
      + R(totalTax,     10)                    // pos 223-232
    ));

    // ── S Records: one per employee ───────────────────────────────────────────
    // QuickFile reads wages from pos 64 and expects the employer account number
    // to appear in each S record.  Layout (all 1-indexed):
    //   pos 1       record type 'S'
    //   pos 2-10    SSN (9, no dashes)
    //   pos 11-30   last name (20)
    //   pos 31-42   first name (12)
    //   pos 43      middle initial (1 blank)
    //   pos 44-52   TWC account (9) ← cross-ref to E record; QuickFile validates here
    //   pos 53-54   FIPS state code (2)
    //   pos 55-58   year (4)
    //   pos 59-60   quarter (2)
    //   pos 61-63   filler blanks (3)
    //   pos 64-75   total wages in cents (12) ← QuickFile reads wages here
    //   pos 76-87   taxable wages in cents (12)
    for (const emp of employees) {
      lines.push(P275(
        'S'                                    // pos 1
        + emp.ssn.padStart(9, '0').substring(0, 9) // pos 2-10  SSN
        + L(emp.lastName,  20)                 // pos 11-30
        + L(emp.firstName, 12)                 // pos 31-42
        + ' '                                  // pos 43     middle initial
        + acct9                                // pos 44-52  TWC account ← QuickFile cross-ref
        + stFips                               // pos 53-54  FIPS '48'
        + yr                                   // pos 55-58  year
        + qStr                                 // pos 59-60  quarter
        + L('', 3)                             // pos 61-63  filler blanks
        + R(emp.wages,   12)                   // pos 64-75  total wages ← QuickFile reads here
        + R(emp.taxable, 12)                   // pos 76-87  taxable wages
      ));
    }

    // ── F Record: Final — must be the very last record ────────────────────────
    lines.push(P275(
      'F'
      + I(1, 10)                               // pos 2-11  number of B/E employer records
      + I(employees.length, 10)                // pos 12-21 total S employee records
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
      const employeeMed = round2(paystubs.reduce((s, r) => s + r.employee_medicare, 0));
      const employerMed = round2(paystubs.reduce((s, r) => s + r.employer_medicare, 0));
      const totalSSTax  = round2(employeeSS + employerSS);
      const totalMedTax = round2(employeeMed + employerMed);
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
