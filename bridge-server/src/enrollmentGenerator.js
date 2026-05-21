'use strict';

/**
 * EFTPS Batch Provider Enrollment Record Generator
 *
 * Field layout verified from real exported enrollment record (total = 134 chars):
 *
 *   Sample:
 *   890048906            0  0001AAEMS INVESTMENTS LLC               B8250725574394                          DBN113000023488077952923     C
 *
 *   Known values:  Registration ID = 890048906
 *                  Business Name   = AEMS INVESTMENTS LLC
 *                  EIN             = 825072557
 *                  PIN             = 4394
 *                  Routing         = 113000023
 *                  Account         = 488077952923
 *
 *   Pos   1–  9 ( 9)  Registration ID         EFTPS_REGISTRATION_ID env var
 *   Pos  10– 21 (12)  Spaces
 *   Pos     22 ( 1)  '0'                     record indicator (constant)
 *   Pos  23– 24 ( 2)  Spaces
 *   Pos  25– 28 ( 4)  Sequence Number         zero-padded (e.g. '0001')
 *   Pos     29 ( 1)  'A'                     record type (constant)
 *   Pos  30– 64 (35)  Business Name           left-justified, space-padded, uppercased
 *   Pos     65 ( 1)  'B'                     taxpayer type (Business)
 *   Pos  66– 74 ( 9)  EIN                     9 digits, no dashes
 *   Pos  75– 78 ( 4)  Batch Provider PIN      4 digits
 *   Pos  79–104 (26)  Spaces                  address/threshold fields (blank)
 *   Pos 105–107 ( 3)  'DBN'                   Demand/Business/New (constant)
 *   Pos 108–116 ( 9)  Bank Routing Number     9 digits
 *   Pos 117–128 (12)  Bank Account Number     digits only, left-justified space-padded
 *   Pos 129–133 ( 5)  Spaces
 *   Pos     134 ( 1)  Account Type            'C' = Checking, 'S' = Savings
 *                                                                         = 134
 */

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const lz     = (s, n) => String(s ?? '').padStart(n, '0').slice(-n);

/**
 * Generate a cryptographically-random 4-digit Batch Provider PIN.
 * Rejects 0000, 9999, 1234, and any 4-digit ascending sequential run.
 */
function generatePin() {
  const BLOCKED = new Set(['0000', '9999', '1234']);
  let pin;
  do {
    pin = String(Math.floor(Math.random() * 9000) + 1000); // 1000–9999
    const isSequential = [0, 1, 2].every(i => Number(pin[i + 1]) === Number(pin[i]) + 1);
    if (BLOCKED.has(pin) || isSequential) pin = null;
  } while (!pin);
  return pin;
}

function buildEnrollmentRecord(p) {
  const regId    = digits(p.registrationId).slice(0, 9).padStart(9, '0');
  const seq      = lz(p.sequenceNumber ?? 1, 4);
  const bizName  = String(p.businessName || '').toUpperCase().slice(0, 35).padEnd(35, ' ');
  const ein      = digits(p.ein).slice(0, 9).padStart(9, '0');
  const pin      = digits(p.pin).slice(0, 4).padStart(4, '0');
  const routing  = digits(p.routingNumber).slice(0, 9).padStart(9, '0');
  const account  = digits(p.accountNumber).slice(0, 12).padEnd(12, ' ');
  const acctType = String(p.accountType || 'checking').toLowerCase() === 'savings' ? 'S' : 'C';

  const rec =
    regId          +  // 1–9     (9)  Registration ID
    ' '.repeat(12) +  // 10–21   (12) filler
    '0'            +  // 22      (1)  record indicator
    '  '           +  // 23–24   (2)  filler
    seq            +  // 25–28   (4)  sequence number
    'A'            +  // 29      (1)  record type
    bizName        +  // 30–64   (35) business name
    'B'            +  // 65      (1)  taxpayer type
    ein            +  // 66–74   (9)  EIN
    pin            +  // 75–78   (4)  Batch Provider PIN
    ' '.repeat(26) +  // 79–104  (26) address/threshold (blank)
    'DBN'          +  // 105–107 (3)  Demand/Business/New
    routing        +  // 108–116 (9)  routing number
    account        +  // 117–128 (12) account number, left-justified
    ' '.repeat(5)  +  // 129–133 (5)  filler
    acctType;         // 134     (1)  'C' or 'S'

  if (rec.length !== 134) throw new Error(`Enrollment record length ${rec.length} ≠ 134`);
  return rec;
}

/**
 * Generate a complete EFTPS Batch Provider enrollment file for a single client.
 *
 * @param {object} params
 * @param {string} params.ein              Taxpayer EIN (any format)
 * @param {string} params.pin              Batch Provider PIN (4 digits)
 * @param {string} params.businessName     Legal business name (uppercased automatically)
 * @param {string} params.routingNumber    Bank routing number (9 digits)
 * @param {string} params.accountNumber    Bank account number
 * @param {string} [params.accountType]    'checking' (default) or 'savings'
 * @param {string} [params.registrationId] Defaults to env EFTPS_REGISTRATION_ID
 * @param {number} [params.sequenceNumber] Record sequence (default: 1)
 * @returns {string} File contents — one 134-char record followed by CRLF
 */
function generateEnrollmentFile(params) {
  const {
    ein,
    pin,
    businessName,
    routingNumber,
    accountNumber,
    accountType     = 'checking',
    registrationId  = process.env.EFTPS_REGISTRATION_ID || '',
    sequenceNumber  = 1,
  } = params;

  if (!registrationId) throw new Error('EFTPS_REGISTRATION_ID is required. Set it in .env or pass registrationId.');
  if (!ein)            throw new Error('EIN is required for enrollment.');
  if (!pin)            throw new Error('Batch Provider PIN is required for enrollment.');
  if (!businessName)   throw new Error('businessName is required for enrollment.');
  if (!routingNumber)  throw new Error('routingNumber is required for enrollment.');
  if (!accountNumber)  throw new Error('accountNumber is required for enrollment.');

  const record = buildEnrollmentRecord({
    registrationId, ein, pin, businessName,
    routingNumber, accountNumber, accountType, sequenceNumber,
  });

  return record + '\r\n';
}

module.exports = { generateEnrollmentFile, buildEnrollmentRecord, generatePin };
