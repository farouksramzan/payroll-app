'use strict';

/**
 * EFTPS Batch Provider Enrollment Record Generator
 *
 * Generates records in the Batch Provider proprietary fixed-width enrollment format.
 * Reverse-engineered from a real exported enrollment record:
 *
 *   Sample:
 *   890048906            0  0001APOSH AUTOMOTIVE INC                B8726834077736                          DBN3140886376709066071       C
 *
 *   Known values:  Registration ID = 890048906
 *                  Business Name   = APOSH AUTOMOTIVE INC
 *
 *   Derived field layout (1-indexed, total = 134 chars):
 *
 *   Pos   1– 9 ( 9)  Registration ID         EFTPS Batch Provider enrollment number
 *   Pos  10–21 (12)  Spaces                  fixed filler
 *   Pos     22 ( 1)  '0'                     record indicator (constant)
 *   Pos  23–24 ( 2)  Spaces                  fixed filler
 *   Pos  25–28 ( 4)  Sequence Number         zero-padded integer (e.g. '0001')
 *   Pos  29–64 (36)  Business Name           left-aligned, space-padded
 *   Pos     65 ( 1)  Taxpayer Type           'B' = Business
 *   Pos  66–74 ( 9)  EIN                     9 digits, no dashes
 *   Pos  75–78 ( 4)  Batch Provider PIN      4 digits
 *   Pos  79–104 (26) Spaces                  fixed filler
 *   Pos 105–107 ( 3) Bank type code          'DBN' (Demand/Business/New — constant)
 *   Pos 108–116 ( 9) Routing Number          9 digits
 *   Pos 117–126 (10) Account Number          zero-padded to 10 chars
 *   Pos 127–133 ( 7) Spaces                  fixed filler
 *   Pos     134 ( 1) Account Type            'C' = Checking, 'S' = Savings
 *                                                                        = 134
 */

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const lz     = (s, n) => String(s ?? '').padStart(n, '0').slice(-n);

function buildEnrollmentRecord(p) {
  const regId    = digits(p.registrationId).slice(0, 9).padStart(9, '0');
  const seq      = lz(p.sequenceNumber ?? 1, 4);
  const bizName  = String(p.businessName || '').slice(0, 36).padEnd(36, ' ');
  const ein      = digits(p.ein).slice(0, 9).padStart(9, '0');
  const pin      = digits(p.pin).slice(0, 4).padStart(4, '0');
  const routing  = digits(p.routingNumber).slice(0, 9).padStart(9, '0');
  const account  = digits(p.accountNumber).slice(0, 10).padStart(10, '0');
  const acctType = String(p.accountType || 'checking').toLowerCase() === 'savings' ? 'S' : 'C';

  const rec =
    regId          +  // 1–9
    ' '.repeat(12) +  // 10–21
    '0'            +  // 22
    '  '           +  // 23–24
    seq            +  // 25–28
    bizName        +  // 29–64
    'B'            +  // 65
    ein            +  // 66–74
    pin            +  // 75–78
    ' '.repeat(26) +  // 79–104
    'DBN'          +  // 105–107
    routing        +  // 108–116
    account        +  // 117–126
    ' '.repeat(7)  +  // 127–133
    acctType;         // 134

  if (rec.length !== 134) throw new Error(`Enrollment record length ${rec.length} ≠ 134`);
  return rec;
}

/**
 * Generate a complete EFTPS Batch Provider enrollment file for a single client.
 *
 * @param {object} params
 * @param {string} params.ein              Taxpayer EIN (any format)
 * @param {string} params.pin              Batch Provider PIN (4 digits)
 * @param {string} params.businessName     Legal business name
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

module.exports = { generateEnrollmentFile, buildEnrollmentRecord };
