/**
 * ACH CCD+ File Generator — EFTPS Federal Tax Deposit Format
 *
 * Generates NACHA-compliant CCD+ files with TXP addenda records for
 * submission to the EFTPS Batch Provider software.
 *
 * Reference: IRS Publication 3112 (EFTPS Payment Instruction Booklet)
 *            NACHA Operating Rules — CCD+ with TXP Addenda
 *
 * File structure for a single 941 payment (10 records, 940 bytes total):
 *   1 × File Header     (Record Type 1)
 *   1 × Batch Header    (Record Type 5)
 *   1 × Entry Detail    (Record Type 6) — debit from company bank account
 *   1 × Addenda         (Record Type 7) — TXP tax breakdown
 *   1 × Batch Control   (Record Type 8)
 *   1 × File Control    (Record Type 9)
 *   4 × Padding         (Record Type 9, all 9s) — pad to 10-record block
 *
 * Each record is exactly 94 characters, terminated with \r\n (CRLF).
 */

'use strict';

// ── Padding helpers ───────────────────────────────────────────────────────────
// Right-pad with spaces, truncate if longer than n
const rs = (s, n) => String(s ?? '').slice(0, n).padEnd(n, ' ');
// Left-pad with zeros, keep last n digits if longer
const lz = (s, n) => String(s ?? '').padStart(n, '0').slice(-n);
// Strip non-digits
const digits = (s) => String(s ?? '').replace(/\D/g, '');

// ── Date helpers ─────────────────────────────────────────────────────────────
function yymmdd(dateStr) {
  const d = new Date(dateStr);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function hhmm() {
  const now = new Date();
  return String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
}

// Quarter-end date in YYMMDD for TXP period field
function quarterEndDate(year, quarter) {
  const ends = ['0331', '0630', '0930', '1231'];
  const yy = String(year).slice(-2);
  return `${yy}${ends[quarter - 1]}`;
}

// ACH routing check digit validation (mod-10 weighted sum)
function routingCheckDigit(routing9) {
  const d = digits(routing9).slice(0, 9);
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  const sum = d.split('').reduce((acc, n, i) => acc + parseInt(n) * w[i], 0);
  return String(sum % 10);
}

// Amount in cents as a 10-digit zero-padded string (no decimal point)
function centsStr(dollarAmount, width = 10) {
  const cents = Math.round(parseFloat(dollarAmount || 0) * 100);
  return lz(cents, width);
}

// ── Record builders (each returns exactly 94 chars) ──────────────────────────

/**
 * Record Type 1 — File Header
 * Immediate Destination: Federal Reserve / EFTPS operator routing
 * Immediate Origin:      Company's bank routing
 */
function fileHeader({ destRouting, originRouting, destName, originName, date }) {
  const dest   = (' ' + digits(destRouting).slice(0, 9)).padEnd(10);
  const origin = (' ' + digits(originRouting).slice(0, 9)).padEnd(10);
  const rec = [
    '1',           // Record Type
    '01',          // Priority Code
    dest,          // Immediate Destination (10)
    origin,        // Immediate Origin (10)
    date || yymmdd(new Date().toISOString()),  // File Creation Date YYMMDD (6)
    hhmm(),        // File Creation Time HHMM (4)
    'A',           // File ID Modifier (1)
    '094',         // Record Size (3)
    '10',          // Blocking Factor (2)
    '1',           // Format Code (1)
    rs(destName || 'EFTPS', 23),    // Immediate Destination Name (23)
    rs(originName || 'COMPANY', 23),// Immediate Origin Name (23)
    '        ',    // Reference Code (8)
  ].join('');
  if (rec.length !== 94) throw new Error(`File Header length ${rec.length} ≠ 94`);
  return rec;
}

/**
 * Record Type 5 — Batch Header
 * Service Class 225 = debits only (money leaving company account → IRS)
 */
function batchHeader({ companyName, ein, settlementDate, originRouting, batchNum = 1 }) {
  const einClean = digits(ein).slice(0, 9);
  const rec = [
    '5',           // Record Type
    '225',         // Service Class Code: debits only
    rs(companyName, 16),          // Company Name (16)
    rs('', 20),                   // Company Discretionary Data (20)
    '1' + rs(einClean, 9),        // Company ID: "1" + EIN (10)
    'CCD',         // Standard Entry Class Code (3)
    rs('TAX PMT', 10),            // Company Entry Description (10)
    rs('', 6),                    // Company Descriptive Date (6)
    yymmdd(settlementDate),       // Effective Entry Date YYMMDD (6)
    '   ',         // Settlement Date — filled by ODFI/bank (3)
    '1',           // Originator Status Code (1)
    digits(originRouting).slice(0, 8), // Originating DFI ID (8)
    lz(batchNum, 7),              // Batch Number (7)
  ].join('');
  if (rec.length !== 94) throw new Error(`Batch Header length ${rec.length} ≠ 94`);
  return rec;
}

/**
 * Record Type 6 — Entry Detail (CCD debit from company's bank account)
 * Transaction Code 27 = checking debit, 37 = savings debit
 */
function entryDetail({ bankRouting, bankAccountNumber, bankAccountType, amount, ein, companyName, sequence = 1, originRouting }) {
  const routing9  = digits(bankRouting).slice(0, 9);
  const rdfi8     = routing9.slice(0, 8);
  const checkDig  = routing9[8] || routingCheckDigit(routing9);
  const txnCode   = (bankAccountType || 'checking').toLowerCase() === 'savings' ? '37' : '27';
  const traceODFI = digits(originRouting).slice(0, 8);
  const rec = [
    '6',           // Record Type
    txnCode,       // Transaction Code (2)
    rdfi8,         // Receiving DFI Routing (8) — company's bank
    checkDig,      // Check Digit (1)
    rs(bankAccountNumber, 17),    // DFI Account Number (17)
    centsStr(amount, 10),         // Amount in cents (10)
    rs(digits(ein).slice(0, 9), 15), // Individual ID (EIN, 15)
    rs(companyName, 22),          // Individual Name (22)
    '  ',          // Discretionary Data (2)
    '1',           // Addenda Record Indicator (1)
    traceODFI + lz(sequence, 7), // Trace Number (15)
  ].join('');
  if (rec.length !== 94) throw new Error(`Entry Detail length ${rec.length} ≠ 94`);
  return rec;
}

/**
 * Record Type 7 — Addenda (TXP Tax Payment)
 *
 * TXP format (IRS Publication 3112):
 *   TXP*EIN*TAX-TYPE-CODE*PERIOD-END*AMT-TYPE*AMOUNT\
 *
 * Tax type codes:
 *   94105 — Form 941, quarterly federal tax deposit
 *   94007 — Form 940, FUTA annual
 *
 * Amount type 1 = total federal tax deposit (FIT + SS + Medicare, all components)
 *
 * Amounts: integer cents, 10 digits, zero-padded (no decimal point)
 * Period:  YYMMDD of the last day of the tax quarter
 * Field:   positions 4–83 (80 chars), left-justified, space-padded
 */
function addenda({ ein, taxTypeCode = '94105', taxYear, taxQuarter, amount, sequence = 1 }) {
  const einClean = digits(ein).slice(0, 9);
  const period   = quarterEndDate(taxYear, taxQuarter);
  const amt      = centsStr(amount, 10);
  const txp      = `TXP*${einClean}*${taxTypeCode}*${period}*1*${amt}\\`;

  if (txp.length > 80) throw new Error(`TXP string (${txp.length} chars) exceeds 80-char field limit: ${txp}`);

  const rec = [
    '7',           // Record Type
    '05',          // Addenda Type Code — payment-related info
    rs(txp, 80),   // Payment Related Information (80) — left-justified
    lz(1, 4),      // Sequence Number (4)
    lz(sequence, 7), // Entry Detail Sequence Number (7)
  ].join('');
  if (rec.length !== 94) throw new Error(`Addenda length ${rec.length} ≠ 94`);
  return rec;
}

/**
 * Record Type 8 — Batch Control
 */
function batchControl({ entryCount, entryHash, totalDebitAmount, ein, originRouting, batchNum = 1 }) {
  const einClean = digits(ein).slice(0, 9);
  // Entry hash = sum of first 8 digits of each RDFI routing, take last 10 digits
  const rec = [
    '8',           // Record Type
    '225',         // Service Class Code
    lz(entryCount, 6),            // Entry/Addenda Count (6)
    lz(entryHash, 10),            // Entry Hash (10)
    centsStr(totalDebitAmount, 12), // Total Debit Amount (12)
    lz(0, 12),                    // Total Credit Amount (12) — zero for debit-only
    '1' + rs(einClean, 9),        // Company ID (10)
    rs('', 19),                   // Message Authentication Code (19)
    rs('', 6),                    // Reserved (6)
    digits(originRouting).slice(0, 8), // Originating DFI ID (8)
    lz(batchNum, 7),              // Batch Number (7)
  ].join('');
  if (rec.length !== 94) throw new Error(`Batch Control length ${rec.length} ≠ 94`);
  return rec;
}

/**
 * Record Type 9 — File Control
 */
function fileControl({ blockCount, entryAddendaCount, entryHash, totalDebitAmount }) {
  const rec = [
    '9',           // Record Type
    lz(blockCount, 6),             // Block Count (6)
    lz(entryAddendaCount, 8),      // Entry/Addenda Count (8)
    lz(entryHash, 10),             // Entry Hash (10)
    centsStr(totalDebitAmount, 12),// Total Debit Amount (12)
    lz(0, 12),                     // Total Credit Amount (12)
    rs('', 39),                    // Reserved (39)
  ].join('');
  if (rec.length !== 94) throw new Error(`File Control length ${rec.length} ≠ 94`);
  return rec;
}

// Padding record — all 9s (fills block to multiple of 10 records)
const PADDING = '9'.repeat(94);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a complete ACH CCD+ file for a single EFTPS 941 federal tax deposit.
 *
 * @param {object} params
 * @param {string} params.ein                  EIN (any format)
 * @param {string} params.businessName         Company name
 * @param {string} params.bankRoutingNumber    Company's bank ABA routing (9 digits)
 * @param {string} params.bankAccountNumber    Company's bank account number
 * @param {string} params.bankAccountType      'checking' | 'savings'
 * @param {string} params.settlementDate       ISO date — when EFTPS debits the account
 * @param {number} params.taxYear              e.g. 2026
 * @param {number} params.taxQuarter           1–4
 * @param {object} params.taxData              { fitWithholding, employeeSS, employerSS, employeeMedicare, employerMedicare, totalDeposit }
 * @param {string} [params.destRouting]        Federal Reserve / EFTPS operator routing (default: env EFTPS_FED_ROUTING)
 * @param {string} [params.taxTypeCode]        Default '94105' (Form 941)
 * @returns {string}                           Complete ACH file contents (CRLF line endings)
 */
function generateACH(params) {
  const {
    ein,
    businessName,
    bankRoutingNumber,
    bankAccountNumber,
    bankAccountType,
    settlementDate,
    taxYear,
    taxQuarter,
    taxData,
    destRouting   = process.env.EFTPS_FED_ROUTING || bankRoutingNumber,
    taxTypeCode   = '94105',
  } = params;

  const totalDeposit    = parseFloat(taxData.totalDeposit);
  const bankRouting9    = digits(bankRoutingNumber).slice(0, 9);
  const originRouting   = bankRouting9; // ODFI = company's bank
  const entryHash       = parseInt(bankRouting9.slice(0, 8), 10);
  const today           = new Date().toISOString().slice(0, 10);

  const records = [
    fileHeader({
      destRouting:  destRouting,
      originRouting: originRouting,
      destName:    'EFTPS',
      originName:   businessName,
      date:         yymmdd(today),
    }),
    batchHeader({
      companyName:    businessName,
      ein,
      settlementDate,
      originRouting,
      batchNum:       1,
    }),
    entryDetail({
      bankRouting:       bankRoutingNumber,
      bankAccountNumber,
      bankAccountType,
      amount:           totalDeposit,
      ein,
      companyName:      businessName,
      sequence:         1,
      originRouting,
    }),
    addenda({
      ein,
      taxTypeCode,
      taxYear,
      taxQuarter,
      amount: totalDeposit,
      sequence: 1,
    }),
    batchControl({
      entryCount:        2,   // entry detail + addenda
      entryHash,
      totalDebitAmount:  totalDeposit,
      ein,
      originRouting,
      batchNum:          1,
    }),
    fileControl({
      blockCount:        1,   // one 10-record block
      entryAddendaCount: 2,
      entryHash,
      totalDebitAmount:  totalDeposit,
    }),
  ];

  // Pad to 10 records per block
  while (records.length % 10 !== 0) records.push(PADDING);

  return records.join('\r\n') + '\r\n';
}

module.exports = { generateACH, yymmdd, quarterEndDate, centsStr };
