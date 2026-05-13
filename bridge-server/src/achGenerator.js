/**
 * EFTPS Batch Provider Import Record Generator
 *
 * Generates records in the EFTPS Batch Provider proprietary fixed-width format.
 * This is NOT NACHA ACH — the Batch Provider uses its own 77-character format.
 *
 * Field layout verified against a real exported payment record and the
 * Batch Provider Payment Inquiry screen:
 *
 *   Sample:  890048906    202605120030001P3317849935161B9410520260620260515000000000142380
 *   Screen:  EIN=331784993  Type=Business  Payment=May 15 2026  Form=941
 *            Created=May 12 2026  Period=202606  Amount=$1,423.80
 *
 *   Pos  1– 9 ( 9)  Registration ID    EFTPS Batch Provider enrollment number
 *   Pos 10–13 ( 4)  Spaces             fixed filler
 *   Pos 14–21 ( 8)  Created Date       YYYYMMDD (UTC — date file is generated)
 *   Pos 22–28 ( 7)  Sequence Number    zero-padded integer
 *   Pos 29    ( 1)  Record Type        'P' = Payment
 *   Pos 30–38 ( 9)  EIN                9 digits, zero-padded, no dashes
 *   Pos 39–42 ( 4)  EFTPS PIN          4 digits, zero-padded
 *   Pos 43    ( 1)  Taxpayer Type      'B' = Business
 *   Pos 44–48 ( 5)  Tax Type Code      e.g. '94105' (Form 941 quarterly)
 *   Pos 49–54 ( 6)  Tax Period         YYYYMM — last month of the tax quarter
 *   Pos 55–62 ( 8)  Settlement Date    YYYYMMDD — when EFTPS debits the account
 *   Pos 63–77 (15)  Amount             total deposit in cents, zero-padded
 *                                                                       = 77
 */

'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const lz     = (s, n) => String(s ?? '').padStart(n, '0').slice(-n);

// ISO date string → YYYYMMDD (UTC, avoids timezone rollback on date-only strings)
function yyyymmdd(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) throw new Error(`yyyymmdd: invalid date "${dateStr}"`);
  const yyyy = String(d.getUTCFullYear());
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;  // exactly 8 chars
}

// Quarter number (1–4) → 2-digit end-month string ('03','06','09','12')
function quarterEndMonth(quarter) {
  const months = { 1: '03', 2: '06', 3: '09', 4: '12' };
  const m = months[quarter];
  if (!m) throw new Error(`Invalid tax quarter: ${quarter} (must be 1–4)`);
  return m;
}

// Dollar amount → 15-digit zero-padded cents string
function centsStr(dollarAmount) {
  const cents = Math.round(parseFloat(dollarAmount || 0) * 100);
  return lz(cents, 15);
}

// ── Record builder ────────────────────────────────────────────────────────────

/**
 * Build one 77-character Batch Provider payment record.
 *
 * @param {object} p
 * @param {string} p.registrationId   EFTPS Batch Provider registration number (9 digits)
 * @param {string} p.ein              Taxpayer EIN (any format)
 * @param {string} p.pin              EFTPS PIN (4 digits)
 * @param {number} p.taxYear          e.g. 2026
 * @param {number} p.taxQuarter       1–4
 * @param {string} p.settlementDate   ISO date — when EFTPS debits the account
 * @param {number} p.totalDeposit     Total tax deposit in dollars
 * @param {string} [p.taxTypeCode]    Default '94105' (Form 941)
 * @param {string} [p.createdDate]    ISO date for pos 14-21 (default: today UTC)
 * @param {number} [p.sequenceNumber] 7-digit sequence (default: 1 → '0000001')
 * @returns {string} Exactly 77 characters
 */
function buildRecord(p) {
  const regId   = digits(p.registrationId).slice(0, 9).padStart(9, '0');
  const ein     = digits(p.ein).slice(0, 9).padStart(9, '0');
  const pin     = digits(p.pin).slice(0, 4).padStart(4, '0');
  const taxCode = String(p.taxTypeCode || '94105').slice(0, 5).padEnd(5, ' ');
  const created = yyyymmdd(p.createdDate || new Date().toISOString().slice(0, 10));
  const seq     = lz(p.sequenceNumber ?? 1, 7);
  const period  = String(p.taxYear) + quarterEndMonth(p.taxQuarter);  // YYYYMM
  const settle  = yyyymmdd(p.settlementDate);                          // YYYYMMDD
  const amount  = centsStr(p.totalDeposit);

  const rec = regId + '    ' + created + seq + 'P' + ein + pin + 'B' + taxCode + period + settle + amount;

  if (rec.length !== 77) throw new Error(`Record length ${rec.length} ≠ 77`);
  return rec;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a complete EFTPS Batch Provider import file for a single payment.
 *
 * @param {object} params
 * @param {string} params.ein              Taxpayer EIN
 * @param {string} params.pin              EFTPS PIN (4 digits)
 * @param {number} params.taxYear          e.g. 2026
 * @param {number} params.taxQuarter       1–4
 * @param {string} params.settlementDate   ISO date — when EFTPS debits the account
 * @param {object} params.taxData          Must include { totalDeposit }
 * @param {string} [params.registrationId] EFTPS registration ID (default: env EFTPS_REGISTRATION_ID)
 * @param {string} [params.taxTypeCode]    Default '94105' (Form 941 quarterly)
 * @param {number} [params.sequenceNumber] Record sequence (default: 1)
 * @returns {string} File contents — one 77-char record followed by CRLF
 */
function generateBatchProviderFile(params) {
  const {
    ein,
    pin,
    taxYear,
    taxQuarter,
    settlementDate,
    taxData,
    registrationId  = process.env.EFTPS_REGISTRATION_ID || '',
    taxTypeCode     = '94105',
    sequenceNumber  = 1,
  } = params;

  if (!registrationId) {
    throw new Error('EFTPS Registration ID is required. Set EFTPS_REGISTRATION_ID in .env or pass registrationId.');
  }
  if (!pin)            throw new Error('Batch Provider PIN is required.');
  if (!taxYear)        throw new Error('taxYear is required.');
  if (!taxQuarter)     throw new Error('taxQuarter is required (1–4).');
  if (!settlementDate) throw new Error('settlementDate is required.');
  if (taxData?.totalDeposit == null) throw new Error('taxData.totalDeposit is required.');

  const record = buildRecord({
    registrationId,
    ein,
    pin,
    taxYear,
    taxQuarter,
    taxTypeCode,
    settlementDate,
    totalDeposit: taxData.totalDeposit,
    sequenceNumber,
  });

  return record + '\r\n';
}

module.exports = { generateBatchProviderFile, buildRecord, yyyymmdd, quarterEndMonth, centsStr };
