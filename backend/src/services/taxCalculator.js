/**
 * Federal payroll tax engine — 2020+ W-4 Percentage Method
 * 2026 values: standard deductions from W-4 (2026) Deductions Worksheet page 4.
 * Brackets are 2026 estimates; verify against IRS Pub 15-T 2026 when published.
 */

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

// 2026 W-4 Step 3 credit amounts (from page 1 of the 2026 W-4)
const CHILD_CREDIT     = 2200;
const DEPENDENT_CREDIT = 500;

const PAY_PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

// 2026 SS wage base (estimated; verify with SSA announcement)
const SS_WAGE_BASE  = 180000;
const SS_RATE       = 0.062;
const MEDICARE_RATE = 0.0145;

// FUTA: 6% gross, 0.6% net after full state credit; $7,000 wage base per employee
const FUTA_WAGE_BASE    = 7000;
const FUTA_RATE_NET     = 0.006;  // after 5.4% SUTA credit
const FUTA_RATE_GROSS   = 0.06;

// Texas TWC (SUTA): $9,000 wage base; new-employer rate 2.7%
const SUTA_WAGE_BASE    = 9000;

/**
 * Calculate per-period FIT withholding using 2020+ W-4 Percentage Method.
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
}) {
  const periods = PAY_PERIODS[payFrequency] || 26;

  // Annualize + add Step 4(a) other income
  const adjustedAnnual = grossWages * periods + (step4a || 0);

  // Standard deduction, halved when Step 2(c) checkbox is checked
  let stdDed = STANDARD_DEDUCTION[filingStatus] || STANDARD_DEDUCTION.single;
  if (step2Checkbox) stdDed /= 2;

  // Step 4(b) subtracts additional deductions on top of standard deduction
  const taxableAnnual = Math.max(0, adjustedAnnual - stdDed - (step4b || 0));

  // Tax brackets, halved thresholds when Step 2(c) is checked
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

  // Subtract Step 3 credits
  const credits = (step3Children || 0) * CHILD_CREDIT + (step3Other || 0) * DEPENDENT_CREDIT;
  const annualWithholding = Math.max(0, annualTax - credits);

  // Per-period FIT + Step 4(c) extra withholding
  const fitWithholding = Math.max(0, annualWithholding / periods + (step4c || 0));

  // FICA — Social Security
  const annualSSWages = Math.min(grossWages * periods, SS_WAGE_BASE);
  const employeeSS    = round2((annualSSWages / periods) * SS_RATE);
  const employerSS    = employeeSS;

  // FICA — Medicare (no wage base limit)
  const employeeMedicare = round2(grossWages * MEDICARE_RATE);
  const employerMedicare  = employeeMedicare;

  const totalDeposit = round2(fitWithholding + employeeSS + employeeMedicare + employerSS + employerMedicare);

  // Net pay to employee
  const netPay = round2(grossWages - fitWithholding - employeeSS - employeeMedicare);

  return {
    grossWages:        round2(grossWages),
    fitWithholding:    round2(fitWithholding),
    employeeSS,
    employeeMedicare,
    employerSS,
    employerMedicare,
    totalDeposit,
    netPay,
    credits:           round2(credits),
    annualTaxable:     round2(taxableAnnual),
  };
}

/**
 * FUTA liability for a single pay period.
 * ytdWages = YTD wages BEFORE this period (to apply $7,000 wage base correctly).
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
 * Texas TWC SUTA liability for a single pay period.
 */
function calculateSUTA(grossWages, ytdWages = 0, sutaRate = 0.027) {
  const taxable = Math.max(0, Math.min(grossWages, SUTA_WAGE_BASE - Math.min(ytdWages, SUTA_WAGE_BASE)));
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
  // Semi-weekly: Wed/Thu paydays → next Monday; Fri–Tue → next Wednesday
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
  calculateFUTA,
  calculateSUTA,
  calcNextDueDate,
  getTaxPeriod,
  nextBankingDay,
  CHILD_CREDIT,
  DEPENDENT_CREDIT,
  FUTA_WAGE_BASE,
  FUTA_RATE_NET,
  SUTA_WAGE_BASE,
};
