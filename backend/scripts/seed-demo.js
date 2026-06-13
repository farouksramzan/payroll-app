/**
 * seed-demo.js — Seeds realistic demo data into the admin account.
 *
 * SAFE TO RUN MULTIPLE TIMES — fully idempotent.
 * Checks for existing demo companies before inserting anything.
 * Never touches any other user's data.
 *
 * Exported as a function so server.js can call it on startup automatically.
 * Also works as a standalone CLI script.
 */

'use strict';

const path     = require('path');
const Database = require('better-sqlite3');

// ── Pure helpers (no db dependency) ──────────────────────────────────────────

function r2(n) { return Math.round((n || 0) * 100) / 100; }

function calcFIT(annualGross, ppy = 26) {
  const taxable = Math.max(0, annualGross - 16100);
  let tax = 0;
  const brackets = [
    { min: 0,      max: 12225,    rate: 0.10 },
    { min: 12225,  max: 49675,    rate: 0.12 },
    { min: 49675,  max: 105925,   rate: 0.22 },
    { min: 105925, max: Infinity, rate: 0.24 },
  ];
  for (const b of brackets) {
    if (taxable <= b.min) break;
    tax += (Math.min(taxable, b.max) - b.min) * b.rate;
    if (taxable <= b.max) break;
  }
  return Math.round(tax / ppy);
}

function calcPaystubTaxes({ gross, ppy = 26, ytdBefore = 0, suiRate = 0.027 }) {
  const SS_BASE    = 176100;
  const ssWages    = Math.max(0, Math.min(gross, SS_BASE - Math.min(ytdBefore, SS_BASE)));
  const eeSS       = r2(ssWages * 0.062);
  const eeMed      = r2(gross * 0.0145);
  const erSS       = eeSS;
  const erMed      = eeMed;
  const fit        = calcFIT(gross * ppy, ppy);
  const futaTaxable = Math.max(0, Math.min(gross, 7000 - Math.min(ytdBefore, 7000)));
  const futa       = r2(futaTaxable * 0.006);
  const suiTaxable = Math.max(0, Math.min(gross, 9000 - Math.min(ytdBefore, 9000)));
  const suta       = r2(suiTaxable * suiRate);
  const deposit    = r2(fit + eeSS + eeMed + erSS + erMed);
  const netPay     = r2(gross - fit - eeSS - eeMed);
  return { eeSS, eeMed, erSS, erMed, fit, futa, suta, deposit, netPay };
}

function buildWeeklyPeriods(anchorEnd) {
  const periods = [];
  let e = new Date(anchorEnd + 'T00:00:00');
  for (let i = 0; i < 20; i++) {
    const s = new Date(e); s.setDate(s.getDate() - 6);
    periods.unshift({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) });
    e.setDate(e.getDate() - 7);
  }
  return periods;
}

function buildBiweeklyPeriods(anchorEnd) {
  const periods = [];
  let e = new Date(anchorEnd + 'T00:00:00');
  for (let i = 0; i < 10; i++) {
    const s = new Date(e); s.setDate(s.getDate() - 13);
    periods.unshift({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) });
    e.setDate(e.getDate() - 14);
  }
  return periods;
}

function buildSemimonthlyPeriods(anchorEnd) {
  const periods = [];
  let e = new Date(anchorEnd + 'T00:00:00');
  for (let i = 0; i < 10; i++) {
    let s;
    if (e.getDate() === 15) {
      s = new Date(e.getFullYear(), e.getMonth(), 1);
    } else {
      s = new Date(e.getFullYear(), e.getMonth(), 16);
    }
    periods.unshift({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) });
    if (e.getDate() <= 15) {
      e = new Date(e.getFullYear(), e.getMonth(), 0);
    } else {
      e = new Date(e.getFullYear(), e.getMonth(), 15);
    }
  }
  return periods;
}

function addBizDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

// ── Demo data definition ──────────────────────────────────────────────────────

const DEMO_MARKER = '[DEMO]';

const COMPANIES = [
  {
    business_name: `Austin Eats LLC ${DEMO_MARKER}`,
    ein: '47-1234567',
    state: 'TX',
    contact_name: 'Maria Lopez',
    contact_email: 'maria@austineats.com',
    deposit_schedule: 'monthly',
    sui_rate: 0.0271,
    employees: [
      { first_name: 'James',  last_name: 'Nguyen',  pay_type: 'hourly', hourly_rate: 18,     filing_status: 'single',  pay_group: 'Weekly Staff' },
      { first_name: 'Sofia',  last_name: 'Reyes',   pay_type: 'hourly', hourly_rate: 15.5,   filing_status: 'single',  pay_group: 'Weekly Staff' },
      { first_name: 'Marcus', last_name: 'Johnson', pay_type: 'hourly', hourly_rate: 22,     filing_status: 'married', pay_group: 'Weekly Staff' },
      { first_name: 'Priya',  last_name: 'Patel',   pay_type: 'salary', annual_salary: 62400, filing_status: 'single', pay_group: 'Management'  },
    ],
    payGroup:  { name: 'Weekly Staff', frequency: 'weekly',       anchorEnd: '2026-01-04', anchorStart: '2025-12-29', payDate: '2026-01-07' },
    payGroup2: { name: 'Management',   frequency: 'semimonthly',  anchorEnd: '2026-01-15', anchorStart: '2026-01-01', payDate: '2026-01-20' },
  },
  {
    business_name: `Lone Star Staffing Inc. ${DEMO_MARKER}`,
    ein: '82-9876543',
    state: 'TX',
    contact_name: 'Derek Washington',
    contact_email: 'derek@lonestarstaff.com',
    deposit_schedule: 'semiweekly',
    sui_rate: 0.034,
    employees: [
      { first_name: 'Ashley',  last_name: 'Kim',    pay_type: 'hourly', hourly_rate: 24,     filing_status: 'single',  pay_group: 'Biweekly'   },
      { first_name: 'Brandon', last_name: 'Torres', pay_type: 'hourly', hourly_rate: 21,     filing_status: 'married', pay_group: 'Biweekly'   },
      { first_name: 'Rachel',  last_name: 'Chen',   pay_type: 'salary', annual_salary: 78000, filing_status: 'single', pay_group: 'Executives' },
      { first_name: 'Michael', last_name: 'Davis',  pay_type: 'salary', annual_salary: 95000, filing_status: 'married', pay_group: 'Executives' },
    ],
    payGroup:  { name: 'Biweekly',   frequency: 'biweekly',     anchorEnd: '2026-01-10', anchorStart: '2025-12-28', payDate: '2026-01-14' },
    payGroup2: { name: 'Executives', frequency: 'semimonthly',  anchorEnd: '2026-01-15', anchorStart: '2026-01-01', payDate: '2026-01-20' },
  },
];

// ── Core seed function (accepts an existing db instance) ──────────────────────

function seedDemo(db) {
  const adminUser = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!adminUser) {
    console.log('[seed-demo] No admin user found — skipping demo seed.');
    return;
  }
  const adminId = adminUser.id;

  const insertClient = db.prepare(`
    INSERT INTO clients (user_id, business_name, ein, state, contact_name, contact_email,
      suta_rate, deposit_schedule, batch_provider_pin_encrypted, eftps_internet_password_encrypted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'demo', 'demo')
  `);

  const insertEmployee = db.prepare(`
    INSERT INTO employees (client_id, first_name, last_name, pay_type, hourly_rate, annual_salary,
      filing_status, pay_frequency, work_state, is_active, pay_group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TX', 1, ?)
  `);

  const insertPayGroup = db.prepare(`
    INSERT INTO pay_groups (client_id, name, frequency, first_pay_period_start, first_pay_period_end, pay_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertPaystub = db.prepare(`
    INSERT INTO paystubs (
      client_id, employee_id, employee_name,
      pay_period_start, pay_period_end, settlement_date, pay_frequency,
      filing_status, work_state,
      gross_wages, fit_withholding, employee_ss, employee_medicare,
      employer_ss, employer_medicare, state_income_tax,
      futa_tax, suta_tax, total_deposit, net_pay,
      ytd_wages_before, tax_year, tax_quarter,
      check_number, check_status, payment_method,
      regular_hours, regular_pay, overtime_hours, overtime_pay,
      pay_group_id
    ) VALUES (?,?,?, ?,?,?,?, ?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?)
  `);

  const doSeed = db.transaction(() => {
    let checkNum = 2001;

    for (const co of COMPANIES) {
      const existing = db.prepare("SELECT id FROM clients WHERE user_id=? AND business_name=?")
        .get(adminId, co.business_name);
      if (existing) {
        console.log(`[seed-demo] Skipping "${co.business_name}" — already seeded`);
        continue;
      }

      // Company
      const clientId = insertClient.run(
        adminId, co.business_name, co.ein, co.state,
        co.contact_name, co.contact_email, co.sui_rate, co.deposit_schedule
      ).lastInsertRowid;

      // Pay groups
      const pgId1 = insertPayGroup.run(clientId, co.payGroup.name, co.payGroup.frequency,
        co.payGroup.anchorStart, co.payGroup.anchorEnd, co.payGroup.payDate).lastInsertRowid;
      const pgId2 = insertPayGroup.run(clientId, co.payGroup2.name, co.payGroup2.frequency,
        co.payGroup2.anchorStart, co.payGroup2.anchorEnd, co.payGroup2.payDate).lastInsertRowid;

      // Employees
      const emps = {};
      for (const e of co.employees) {
        const pgId = e.pay_group === co.payGroup.name ? pgId1 : pgId2;
        const freq = e.pay_group === co.payGroup.name ? co.payGroup.frequency : co.payGroup2.frequency;
        const empId = insertEmployee.run(
          clientId, e.first_name, e.last_name, e.pay_type,
          e.hourly_rate || 0, e.annual_salary || 0, e.filing_status, freq, pgId
        ).lastInsertRowid;
        emps[`${e.first_name} ${e.last_name}`] = { id: empId, ...e, pgId, freq };
      }

      // Paystub history
      for (const [name, emp] of Object.entries(emps)) {
        const isGroup1 = emp.pgId === pgId1;
        const anchor = isGroup1 ? co.payGroup.anchorEnd : co.payGroup2.anchorEnd;
        const freq   = emp.freq;
        let periods;
        if (freq === 'weekly')        periods = buildWeeklyPeriods(anchor);
        else if (freq === 'biweekly') periods = buildBiweeklyPeriods(anchor);
        else                          periods = buildSemimonthlyPeriods(anchor);

        const hist = periods.filter(p => p.end.startsWith('2026')).slice(0, 6);
        const ppy  = freq === 'weekly' ? 52 : freq === 'biweekly' ? 26 : 24;
        let ytdBefore = 0;

        for (const p of hist) {
          const isSalary  = emp.pay_type === 'salary';
          const regHours  = isSalary ? null : 40;
          const regPay    = isSalary ? r2((emp.annual_salary || 0) / ppy) : r2(40 * (emp.hourly_rate || 0));
          const gross     = regPay;
          const taxes     = calcPaystubTaxes({ gross, ppy, ytdBefore, suiRate: co.sui_rate });
          const qtr       = Math.ceil((new Date(p.end + 'T00:00:00').getMonth() + 1) / 3);
          const settle    = addBizDays(p.end, 2);

          insertPaystub.run(
            clientId, emp.id, name,
            p.start, p.end, settle, freq,
            emp.filing_status, 'TX',
            gross, taxes.fit, taxes.eeSS, taxes.eeMed,
            taxes.erSS, taxes.erMed, 0,
            taxes.futa, taxes.suta, taxes.deposit, taxes.netPay,
            ytdBefore, 2026, qtr,
            checkNum++, 'printed', 'check',
            regHours, regPay, null, 0,
            emp.pgId
          );

          ytdBefore = r2(ytdBefore + gross);
        }
      }

      console.log(`[seed-demo] ✓ Seeded "${co.business_name}"`);
    }
  });

  doSeed();
}

module.exports = { seedDemo };

// ── CLI usage: node backend/scripts/seed-demo.js ──────────────────────────────

if (require.main === module) {
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/payroll.db');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log('\n🌱  Seeding demo data...\n');
  seedDemo(db);
  console.log('\n✅  Done! Login: admin / admin123\n');
}
