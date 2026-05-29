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

// ── GET /api/reports/twc?clientId=X&year=2026&quarter=1 ──────────────────────
router.get('/twc', (req, res) => {
  try {
    const { clientId, year, quarter } = req.query;
    if (!clientId || !year || !quarter) return res.status(400).json({ error: 'clientId, year, quarter required' });
    const db = getDb();
    const client = assertClient(db, clientId, req.user.id);
    const { start, end } = quarterRange(parseInt(year), parseInt(quarter));
    const sutaRate = client.suta_rate || 0.027;

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
        let ssn = '***-**-****';
        if (s.emp_id && !empSsnCache[s.emp_id]) {
          const emp = db.prepare('SELECT ssn_encrypted FROM employees WHERE id = ?').get(s.emp_id);
          if (emp?.ssn_encrypted) { try { empSsnCache[s.emp_id] = maskSSN(decrypt(emp.ssn_encrypted)); } catch (e) {} }
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

    res.json({
      reportType: 'TWC',
      client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' },
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
      const sutaRate = client.suta_rate || 0.027;
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
      const empSsnCache = {};
      for (const s of subs) {
        const key = s.emp_id || 'aggregate';
        if (!byEmployee[key]) {
          let ssn = '***-**-****';
          if (s.emp_id && !empSsnCache[s.emp_id]) {
            const emp = db.prepare('SELECT ssn_encrypted FROM employees WHERE id = ?').get(s.emp_id);
            if (emp?.ssn_encrypted) { try { empSsnCache[s.emp_id] = maskSSN(decrypt(emp.ssn_encrypted)); } catch (e) {} }
          }
          if (s.emp_id && empSsnCache[s.emp_id]) ssn = empSsnCache[s.emp_id];
          byEmployee[key] = { name: s.first_name ? `${s.first_name} ${s.last_name}` : (s.employee_name || 'All Employees'), ssn, wages: 0, sutaTaxable: 0, sutaTax: 0 };
        }
        const ytd  = (ytdByEmp[key] || 0) + byEmployee[key].wages;
        const suta = calculateSUTA(s.gross_wages, ytd, sutaRate);
        byEmployee[key].wages += s.gross_wages;
        byEmployee[key].sutaTaxable += suta.taxableWages;
        byEmployee[key].sutaTax += suta.sutaTax;
      }
      data = {
        reportType: 'TWC',
        client: { businessName: client.business_name, ein: client.ein, businessAddress: client.business_address, businessCity: client.business_city, businessZip: client.business_zip, state: client.state || 'TX' },
        period: { year: parseInt(year), quarter: parseInt(quarter), start, end },
        sutaRate,
        lines: { totalWages: round2(subs.reduce((s, r) => s + r.gross_wages, 0)), sutaTaxableWages: round2(Object.values(byEmployee).reduce((s, e) => s + e.sutaTaxable, 0)), sutaTax: round2(Object.values(byEmployee).reduce((s, e) => s + e.sutaTax, 0)), wageBase: SUTA_WAGE_BASE },
        byEmployee: Object.values(byEmployee).map((e) => ({ ...e, wages: round2(e.wages), sutaTaxable: round2(e.sutaTaxable), sutaTax: round2(e.sutaTax) })),
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
