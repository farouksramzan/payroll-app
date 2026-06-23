'use strict';

/**
 * icesaService.js
 * Generates a TWC ICESA fixed-width file (275 chars/record, CRLF-terminated).
 * Extracted from reports.js so both the download endpoint and the TWC bridge
 * submission endpoint can share the same generation logic.
 */

const { calculateSUTA } = require('./taxCalculator');
const { decrypt }       = require('./cryptoService');

function round2(n) { return Math.round((n || 0) * 100) / 100; }

function quarterRange(year, quarter) {
  const starts = ['01-01', '04-01', '07-01', '10-01'];
  const ends   = ['03-31', '06-30', '09-30', '12-31'];
  return {
    start: `${year}-${starts[quarter - 1]}`,
    end:   `${year}-${ends[quarter - 1]}`,
  };
}

/**
 * Generate ICESA content for a client/quarter/year.
 * @param {object} db         - better-sqlite3 database instance
 * @param {object} client     - full client row from the DB
 * @param {number} quarter    - 1–4
 * @param {number} year       - e.g. 2026
 * @returns {string}          - ICESA file content (CRLF-terminated lines)
 */
function generateIcesa(db, client, quarter, year) {
  const clientId = client.id;
  const { start, end } = quarterRange(year, quarter);
  const qRateField = `sui_rate_q${quarter}`;
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
  const empCache   = {};
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
  const qMonths  = Q_MONTHS[quarter] || [1,2,3];
  const emp12th  = qMonths.map(mo => {
    const d = `${year}-${String(mo).padStart(2,'0')}-12`;
    const r = db.prepare(`SELECT COUNT(DISTINCT employee_id) AS cnt FROM paystubs
      WHERE client_id=? AND pay_period_start<=? AND pay_period_end>=?
        AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
    `).get(clientId, d, d);
    return r?.cnt || 0;
  });

  // ── ICESA record helpers ──────────────────────────────────────────────────
  const L    = (v, n) => String(v || '').padEnd(n).substring(0, n);
  const R    = (v, n) => String(Math.round((v || 0) * 100)).padStart(n, '0').substring(0, n);
  const I    = (v, n) => String(Math.round(v || 0)).padStart(n, '0').substring(0, n);
  const P275 = s => s.padEnd(275).substring(0, 275);

  const ein        = (client.ein || '').replace(/\D/g, '').padEnd(9).substring(0, 9);
  const stFips     = '48';
  const zip        = (client.business_zip || '').replace(/\D/g, '').padEnd(5).substring(0, 5);
  const yr         = String(year);
  const periodCode = ['03', '06', '09', '12'][quarter - 1];
  const acct9      = (client.sui_account_number || '').replace(/-/g, '').padEnd(9).substring(0, 9);

  const lines = [];

  // ── A Record ─────────────────────────────────────────────────────────────
  lines.push(P275(
    'A'
    + yr
    + ein
    + 'UTAX'
    + L('', 5)
    + L(client.business_name, 50)
    + L(client.business_address, 40)
    + L(client.business_city, 25)
    + stFips
    + L('', 8)
    + L('', 5)
    + L(zip, 5)
  ));

  // ── Shared employer prefix (B + E records) ────────────────────────────────
  const employerPrefix = (recordType) =>
    recordType
    + yr
    + ein
    + L('', 9)
    + L(client.business_name, 50)
    + L(client.business_address, 40)
    + L(client.business_city, 25)
    + stFips
    + L('', 8)
    + L('', 5)
    + L(zip, 5)
    + L('', 2)
    + stFips
    + 'UTAX'
    + L('', 4)
    + stFips
    + acct9;

  // ── B Record ─────────────────────────────────────────────────────────────
  lines.push(P275(employerPrefix('B')));

  // ── E Record ─────────────────────────────────────────────────────────────
  lines.push(P275(
    employerPrefix('E')
    + L(client.naics_code || '', 6)
    + periodCode
    + '1'
  ));

  // ── S Records ────────────────────────────────────────────────────────────
  const validEmployees = Object.values(byEmployee).filter(e => e.ssn && e.ssn.replace(/\D/g, '').length === 9);
  const icesaWages     = round2(validEmployees.reduce((s, e) => s + e.wages,   0));
  const icesaTaxable   = round2(validEmployees.reduce((s, e) => s + e.taxable, 0));
  const icesaTax       = round2(icesaTaxable * sutaRate);

  for (const emp of validEmployees) {
    const excessWages = round2(Math.max(0, emp.wages - emp.taxable));
    lines.push(P275(
      'S'
      + emp.ssn.padStart(9, '0').substring(0, 9)
      + L(emp.lastName,  20)
      + L(emp.firstName, 12)
      + ' '
      + stFips
      + yr
      + R(emp.wages,    14)
      + R(emp.wages,    14)
      + R(excessWages,  14)
      + R(emp.taxable,  14)
      + '000000000000000'
      + '000000000'
      + L('', 2)
      + L('', 3)
      + L('', 8)
      + 'UTAX'
      + acct9
      + L('', 59)
      + periodCode
      + yr
    ));
  }

  // ── T Record ─────────────────────────────────────────────────────────────
  const tRateStr = '.' + String(Math.round(sutaRate * 100000)).padStart(5, '0').substring(0, 5);
  lines.push(P275(
    'T'
    + I(validEmployees.length, 7)
    + 'UTAX'
    + L('', 14)
    + R(icesaWages,   14)
    + L('', 14)
    + R(icesaTaxable, 14)
    + L('', 13)
    + tRateStr
    + R(icesaTax, 13)
    + L('', 11) + L('', 11) + L('', 11) + L('', 11)
    + L('', 4)  + L('', 11) + L('', 4)  + L('', 11)
    + L('', 11) + L('', 13) + L('', 14) + L('', 14)
    + I(emp12th[0] || 0, 7)
    + I(emp12th[1] || 0, 7)
    + I(emp12th[2] || 0, 7)
    + String(parseInt(client.county_code) || 0).padStart(3, '0').substring(0, 3)
    + I(0, 7)
    + L('', 10)
    + L('', 8)
  ));

  // ── F Record ─────────────────────────────────────────────────────────────
  lines.push(P275(
    'F'
    + I(validEmployees.length, 10)
    + I(1, 10)
    + 'UTAX'
    + L('', 15)
    + R(icesaWages,   15)
    + L('', 15)
    + R(icesaTaxable, 15)
  ));

  return lines.join('\r\n') + '\r\n';
}

module.exports = { generateIcesa, quarterRange };
