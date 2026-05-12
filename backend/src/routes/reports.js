const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { calculateFUTA, calculateSUTA, FUTA_WAGE_BASE, SUTA_WAGE_BASE } = require('../services/taxCalculator');
const { decrypt } = require('../services/cryptoService');

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

    const subs = db.prepare(`
      SELECT s.*, e.first_name, e.last_name
      FROM submissions s
      LEFT JOIN employees e ON s.employee_id = e.id
      WHERE s.client_id = ? AND s.pay_period_end >= ? AND s.pay_period_end <= ?
      ORDER BY s.pay_period_end
    `).all(clientId, start, end);

    const employees = db.prepare('SELECT * FROM employees WHERE client_id = ? AND is_active = 1').all(clientId);
    const empCount  = employees.length || (subs.length > 0 ? 1 : 0);

    const wages          = round2(subs.reduce((s, r) => s + r.gross_wages, 0));
    const fitWithheld    = round2(subs.reduce((s, r) => s + r.fit_withholding, 0));
    const employeeSS     = round2(subs.reduce((s, r) => s + r.employee_ss, 0));
    const employerSS     = round2(subs.reduce((s, r) => s + r.employer_ss, 0));
    const employeeMed    = round2(subs.reduce((s, r) => s + r.employee_medicare, 0));
    const employerMed    = round2(subs.reduce((s, r) => s + r.employer_medicare, 0));
    const totalSSTax     = round2((employeeSS + employerSS));     // × 12.4% combined
    const totalMedTax    = round2((employeeMed + employerMed));   // × 2.9% combined
    const totalTaxes     = round2(fitWithheld + totalSSTax + totalMedTax);
    const totalDeposited = round2(subs.filter((s) => s.eftps_status === 'submitted' || s.eftps_status === 'dry_run').reduce((sum, r) => sum + r.total_deposit, 0));
    const balanceDue     = round2(totalTaxes - totalDeposited);

    res.json({
      reportType: '941',
      client: { businessName: client.business_name, ein: client.ein },
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
      submissions: subs.map((s) => ({
        id: s.id, payPeriodEnd: s.pay_period_end,
        grossWages: s.gross_wages, fitWithholding: s.fit_withholding,
        ssTotal: round2(s.employee_ss + s.employer_ss),
        medTotal: round2(s.employee_medicare + s.employer_medicare),
        totalDeposit: s.total_deposit, eftpsStatus: s.eftps_status,
        employeeName: s.first_name ? `${s.first_name} ${s.last_name}` : null,
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
      SELECT s.*, e.id as emp_id, e.first_name, e.last_name
      FROM submissions s
      LEFT JOIN employees e ON s.employee_id = e.id
      WHERE s.client_id = ? AND s.pay_period_end >= ? AND s.pay_period_end <= ?
      ORDER BY s.employee_id, s.pay_period_end
    `).all(clientId, `${year}-01-01`, `${year}-12-31`);

    // Calculate FUTA per employee (or aggregate if no employee records)
    const byEmployee = {};
    for (const s of subs) {
      const key = s.emp_id || 'aggregate';
      if (!byEmployee[key]) byEmployee[key] = { name: s.first_name ? `${s.first_name} ${s.last_name}` : 'All Employees', wages: 0, futaTaxable: 0, futaTax: 0 };
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
      client: { businessName: client.business_name, ein: client.ein },
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
      SELECT s.*, e.id as emp_id, e.first_name, e.last_name
      FROM submissions s
      LEFT JOIN employees e ON s.employee_id = e.id
      WHERE s.client_id = ? AND s.pay_period_end >= ? AND s.pay_period_end <= ?
      ORDER BY s.employee_id, s.pay_period_end
    `).all(clientId, start, end);

    // Need YTD wages from prior quarters for wage base tracking
    const ytdSubs = db.prepare(`
      SELECT s.gross_wages, s.employee_id
      FROM submissions s
      WHERE s.client_id = ? AND s.pay_period_end >= ? AND s.pay_period_end < ?
      ORDER BY s.employee_id, s.pay_period_end
    `).all(clientId, `${year}-01-01`, start);

    const ytdByEmp = {};
    for (const s of ytdSubs) {
      const k = s.employee_id || 'aggregate';
      ytdByEmp[k] = (ytdByEmp[k] || 0) + s.gross_wages;
    }

    const byEmployee = {};
    for (const s of subs) {
      const key = s.emp_id || 'aggregate';
      if (!byEmployee[key]) byEmployee[key] = { name: s.first_name ? `${s.first_name} ${s.last_name}` : 'All Employees', wages: 0, sutaTaxable: 0, sutaTax: 0 };
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
      client: { businessName: client.business_name, ein: client.ein },
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
        SELECT * FROM submissions
        WHERE client_id = ? AND employee_id = ? AND pay_period_end >= ? AND pay_period_end <= ?
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
      client: { businessName: client.business_name, ein: client.ein },
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
      SELECT * FROM submissions
      WHERE client_id = ? AND pay_period_end >= ? AND pay_period_end <= ?
    `).all(clientId, `${year}-01-01`, `${year}-12-31`);

    const empCount = db.prepare('SELECT COUNT(*) as cnt FROM employees WHERE client_id = ?').get(clientId).cnt;

    res.json({
      reportType: 'W-3',
      client: { businessName: client.business_name, ein: client.ein },
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

module.exports = router;
