/**
 * Federal & state payroll tax engine — 2026
 *
 * Federal: 2020+ W-4 Percentage Method (IRS Pub 15-T 2026)
 * State: Per-state SUI + SIT from stateTaxRates.js
 */

const STATE_TAX_RATES = require('../data/stateTaxRates');

const STANDARD_DEDUCTION = { single: 16100, married: 32200, hoh: 24150 };

const BRACKETS = {
  single: [
    { min: 0,       max: 12225,   rate: 0.10 },
    { min: 12225,   max: 49675,   rate: 0.12 },
    { min: 49675,   max: 105925,  rate: 0.22 },
    { min: 105925,  max: 202200,  rate: 0.24 },
    { min: 202200,  max: 256800,  rate: 0.32 },
    { min: 256800,  max: 641850,  rate: 0.35 },
    { min: 641850,  max: Infinity, rate: 0.37 },
  ],
  married: [
    { min: 0,       max: 24450,   rate: 0.10 },
    { min: 24450,   max: 99375,   rate: 0.12 },
    { min: 99375,   max: 211900,  rate: 0.22 },
    { min: 211900,  max: 404550,  rate: 0.24 },
    { min: 404550,  max: 513800,  rate: 0.32 },
    { min: 513800,  max: 770450,  rate: 0.35 },
    { min: 770450,  max: Infinity, rate: 0.37 },
  ],
  hoh: [
    { min: 0,       max: 17425,   rate: 0.10 },
    { min: 17425,   max: 66475,   rate: 0.12 },
    { min: 66475,   max: 105925,  rate: 0.22 },
    { min: 105925,  max: 202200,  rate: 0.24 },
    { min: 202200,  max: 256800,  rate: 0.32 },
    { min: 256800,  max: 641850,  rate: 0.35 },
    { min: 641850,  max: Infinity, rate: 0.37 },
  ],
};

const CHILD_CREDIT     = 2200;
const DEPENDENT_CREDIT = 500;

const PAY_PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

// 2026 SS wage base (SSA announced $176,100 for 2025; estimated same or $180,000 for 2026)
const SS_WAGE_BASE  = 176100;
const SS_RATE       = 0.062;
const MEDICARE_RATE = 0.0145;
const ADD_MEDICARE_RATE = 0.009;   // Additional Medicare on wages > $200,000
const ADD_MEDICARE_THRESHOLD = 200000;

const FUTA_WAGE_BASE    = 7000;
const FUTA_RATE_NET     = 0.006;   // after 5.4% state credit
const FUTA_RATE_GROSS   = 0.06;

/**
 * Calculate per-period FIT withholding using 2026 W-4 Percentage Method.
 */
function calculateWithholding({
  grossWages,
  payFrequency,
  filingStatus = 'single',
  step2Checkbox = false,
  step3Children = 0,
  step3Other    = 0,
  step4a = 0,
  step4b = 0,
  step4c = 0,
  // State tax params
  workState     = null,
  ytdGross      = 0,   // YTD gross wages before this period (for SS/FUTA/SUTA caps)
  sutaRate      = null, // override; falls back to state's new-employer rate
}) {
  const periods = PAY_PERIODS[payFrequency] || 26;

  // ── Federal Income Tax ────────────────────────────────────────────────────────
  const adjustedAnnual = grossWages * periods + (step4a || 0);
  let stdDed = STANDARD_DEDUCTION[filingStatus] || STANDARD_DEDUCTION.single;
  if (step2Checkbox) stdDed /= 2;
  const taxableAnnual = Math.max(0, adjustedAnnual - stdDed - (step4b || 0));

  let brackets = (BRACKETS[filingStatus] || BRACKETS.single).map((b) => ({ ...b }));
  if (step2Checkbox) {
    brackets = brackets.map((b) => ({
      ...b,
      min: b.min / 2,
      max: b.max === Infinity ? Infinity : b.max / 2,
    }));
  }

  let annualTax = 0;
  for (const b of brackets) {
    if (taxableAnnual <= b.min) break;
    annualTax += (Math.min(taxableAnnual, b.max) - b.min) * b.rate;
    if (taxableAnnual <= b.max) break;
  }

  const credits = (step3Children || 0) * CHILD_CREDIT + (step3Other || 0) * DEPENDENT_CREDIT;
  const annualWithholding = Math.max(0, annualTax - credits);
  const fitWithholding = round2(Math.max(0, annualWithholding / periods + (step4c || 0)));

  // ── FICA — Social Security (wage base cap via YTD) ────────────────────────────
  const ssWagesThisPeriod = Math.max(0, Math.min(grossWages, SS_WAGE_BASE - Math.min(ytdGross, SS_WAGE_BASE)));
  const employeeSS   = round2(ssWagesThisPeriod * SS_RATE);
  const employerSS   = employeeSS;

  // ── FICA — Medicare ───────────────────────────────────────────────────────────
  const employeeMedicare = round2(grossWages * MEDICARE_RATE);
  const employerMedicare = employeeMedicare;

  // Additional Medicare (employee only, on wages over $200K/yr)
  const ytdAfter = ytdGross + grossWages;
  const addMedBase = Math.max(0, Math.min(grossWages, ytdAfter - ADD_MEDICARE_THRESHOLD));
  const additionalMedicare = round2(addMedBase * ADD_MEDICARE_RATE);

  // ── FUTA ──────────────────────────────────────────────────────────────────────
  const futaResult = calculateFUTA(grossWages, ytdGross);

  // ── SUTA ──────────────────────────────────────────────────────────────────────
  const state = (workState || 'TX').toUpperCase();
  const stateData = STATE_TAX_RATES[state];
  const suiWageBase   = stateData?.sui?.wageBase ?? 9000;
  const effectiveSutaRate = sutaRate != null ? sutaRate : (stateData?.sui?.newEmployerRate ?? 0.027);
  const sutaResult = calculateSUTA(grossWages, ytdGross, effectiveSutaRate, suiWageBase);

  // ── State Income Tax ──────────────────────────────────────────────────────────
  const stateIncomeTax = calculateStateSIT(grossWages, periods, state, filingStatus);

  // ── Totals ────────────────────────────────────────────────────────────────────
  // EFTPS deposit = FIT + employee FICA + employer FICA (+ additional medicare if applicable)
  const totalDeposit = round2(
    fitWithholding + employeeSS + employeeMedicare + additionalMedicare +
    employerSS + employerMedicare
  );

  const netPay = round2(grossWages - fitWithholding - employeeSS - employeeMedicare - additionalMedicare - stateIncomeTax);

  return {
    grossWages:          round2(grossWages),
    fitWithholding,
    employeeSS,
    employeeMedicare,
    additionalMedicare,
    employerSS,
    employerMedicare,
    stateIncomeTax,
    futaTax:             futaResult.futaTax,
    futaTaxable:         futaResult.taxableWages,
    sutaTax:             sutaResult.sutaTax,
    sutaTaxable:         sutaResult.taxableWages,
    sutaRate:            effectiveSutaRate,
    suiWageBase,
    workState:           state,
    totalDeposit,
    netPay,
    credits:             round2(credits),
    annualTaxable:       round2(taxableAnnual),
    ssWageBase:          SS_WAGE_BASE,
    ssWagesThisPeriod,
    ytdGrossBefore:      ytdGross,
  };
}

/**
 * State income tax per pay period using state brackets or flat rate.
 */
function calculateStateSIT(grossWages, periods, state, filingStatus = 'single') {
  const stateData = STATE_TAX_RATES[state?.toUpperCase()];
  if (!stateData?.sit) return 0;

  const sit = stateData.sit;

  if (sit.type === 'flat') {
    return round2(grossWages * sit.rate);
  }

  if (sit.type === 'brackets') {
    const fs = filingStatus === 'hoh' ? 'hoh' : (filingStatus === 'married' ? 'married' : 'single');
    const brackets = sit.brackets?.[fs] || sit.brackets?.single || [];
    const stdDed = sit.standardDeduction?.[fs] || 0;

    const annualGross  = grossWages * periods;
    const taxableAnnual = Math.max(0, annualGross - stdDed);

    let annualTax = 0;
    for (const b of brackets) {
      if (taxableAnnual <= b.min) break;
      annualTax += (Math.min(taxableAnnual, b.max) - b.min) * b.rate;
      if (taxableAnnual <= b.max) break;
    }

    return round2(annualTax / periods);
  }

  return 0;
}

/**
 * FUTA liability for a single pay period.
 * ytdWages = YTD gross wages BEFORE this period.
 */
function calculateFUTA(grossWages, ytdWages = 0) {
  const taxable = Math.max(0, Math.min(grossWages, FUTA_WAGE_BASE - Math.min(ytdWages, FUTA_WAGE_BASE)));
  return {
    taxableWages:        round2(taxable),
    futaTax:             round2(taxable * FUTA_RATE_NET),
    futaTaxBeforeCredit: round2(taxable * FUTA_RATE_GROSS),
  };
}

/**
 * State SUI liability for a single pay period.
 * sutaRate defaults to the state's new-employer rate if not provided.
 * ytdWages = YTD gross wages BEFORE this period.
 */
function calculateSUTA(grossWages, ytdWages = 0, sutaRate = 0.027, sutaWageBase = 9000) {
  const taxable = Math.max(0, Math.min(grossWages, sutaWageBase - Math.min(ytdWages, sutaWageBase)));
  return {
    taxableWages: round2(taxable),
    sutaTax:      round2(taxable * sutaRate),
  };
}

/**
 * Compute the next EFTPS deposit due date given the deposit schedule and pay period end.
 */
function calcNextDueDate(depositSchedule, payPeriodEnd) {
  const base = payPeriodEnd ? new Date(payPeriodEnd) : new Date();
  if (depositSchedule === 'monthly') {
    return new Date(base.getFullYear(), base.getMonth() + 1, 15).toISOString().slice(0, 10);
  }
  const day = base.getDay();
  const daysUntil = (day === 3 || day === 4)
    ? (1 + 7 - day) % 7 || 7
    : (3 + 7 - day) % 7 || 7;
  const due = new Date(base);
  due.setDate(due.getDate() + daysUntil);
  return due.toISOString().slice(0, 10);
}

/**
 * Returns the federal quarter (1–4) and year for a given date string.
 */
function getTaxPeriod(dateStr) {
  const d = new Date(dateStr || Date.now());
  return { quarter: Math.ceil((d.getMonth() + 1) / 3), year: d.getFullYear() };
}

/**
 * Returns the next banking day from a given date (skips Sat/Sun).
 */
function nextBankingDay(fromDate) {
  const d = new Date(fromDate || Date.now());
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

module.exports = {
  calculateWithholding,
  calculateStateSIT,
  calculateFUTA,
  calculateSUTA,
  calcNextDueDate,
  getTaxPeriod,
  nextBankingDay,
  STATE_TAX_RATES,
  CHILD_CREDIT,
  DEPENDENT_CREDIT,
  FUTA_WAGE_BASE,
  FUTA_RATE_NET,
  SS_WAGE_BASE,
};
