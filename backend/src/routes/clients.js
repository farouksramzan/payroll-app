const express = require('express');
const crypto  = require('crypto');
const { getDb } = require('../database/db');
const { requireAuth, requireAdmin, canAccessClient } = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/cryptoService');
const { calcNextDueDate } = require('../services/taxCalculator');

function generateJoinCode(db) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code, attempts = 0;
  do {
    const bytes = crypto.randomBytes(6);
    code = '';
    for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
    attempts++;
  } while (db.prepare('SELECT id FROM clients WHERE join_code = ?').get(code) && attempts < 100);
  return code;
}

const router = express.Router();
router.use(requireAuth);

const FEDERAL_HOLIDAYS = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-05-27','2024-06-19','2024-07-04',
  '2024-09-02','2024-10-14','2024-11-11','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19','2025-07-04',
  '2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03',
  '2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-19','2027-07-05',
  '2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24',
]);
function isBizDay(d) { const w = d.getDay(); return w !== 0 && w !== 6 && !FEDERAL_HOLIDAYS.has(d.toISOString().slice(0, 10)); }
function addBizDays(dateStr, n) {
  const r = new Date(dateStr + 'T00:00:00Z');
  let added = 0;
  while (added < n) { r.setUTCDate(r.getUTCDate() + 1); if (isBizDay(r)) added++; }
  return r.toISOString().slice(0, 10);
}

function calcIRSDepositDue(payDateStr, schedule) {
  if (!payDateStr) return null;
  const d = new Date(payDateStr + 'T00:00:00Z');
  const dow = d.getUTCDay();
  let due;
  if (schedule === 'semiweekly') {
    const n = (dow >= 3 && dow <= 5) ? ((3 - dow + 7) % 7 || 7) : ((5 - dow + 7) % 7 || 7);
    due = new Date(d); due.setUTCDate(d.getUTCDate() + n);
  } else {
    due = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15));
  }
  while (!isBizDay(due)) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString().slice(0, 10);
}

function calcFutaQuarterlyDue(payPeriodEnd) {
  if (!payPeriodEnd) return null;
  const d = new Date(payPeriodEnd + 'T00:00:00Z');
  const q = Math.ceil((d.getUTCMonth() + 1) / 3);
  const qMons = [3, 6, 9, 0];
  const qDays = [30, 31, 31, 31];
  const qYear = q === 4 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  const due = new Date(Date.UTC(qYear, qMons[q - 1], qDays[q - 1]));
  while (!isBizDay(due)) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString().slice(0, 10);
}

function nextPeriodEnd(endStr, frequency) {
  const d = new Date(endStr + 'T00:00:00Z');
  switch (frequency) {
    case 'weekly':      d.setUTCDate(d.getUTCDate() + 7);  break;
    case 'biweekly':    d.setUTCDate(d.getUTCDate() + 14); break;
    case 'semimonthly': {
      const day = d.getUTCDate();
      if (day >= 28) { d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(15); }
      else           { const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return last.toISOString().slice(0, 10); }
      break;
    }
    case 'monthly':   d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    default:          d.setUTCDate(d.getUTCDate() + 14); break;
  }
  return d.toISOString().slice(0, 10);
}

function sanitizeClient(client, includeSecrets = false) {
  const out = {
    id: client.id,
    businessName: client.business_name,
    ein: client.ein,
    state: client.state || 'TX',
    bankRoutingNumber: client.bank_routing_number,
    bankAccountType: client.bank_account_type,
    depositSchedule: client.deposit_schedule,
    eftpsEnrollmentNumber: client.eftps_enrollment_number || null,
    sutaRate: client.suta_rate || 0.027,
    suiRateQ1: client.sui_rate_q1 != null ? client.sui_rate_q1 : null,
    suiRateQ2: client.sui_rate_q2 != null ? client.sui_rate_q2 : null,
    suiRateQ3: client.sui_rate_q3 != null ? client.sui_rate_q3 : null,
    suiRateQ4: client.sui_rate_q4 != null ? client.sui_rate_q4 : null,
    suiAccountNumber: client.sui_account_number || null,
    contactName: client.contact_name,
    contactEmail: client.contact_email,
    contactPhone: client.contact_phone,
    createdAt: client.created_at,
    updatedAt: client.updated_at,
    hasBatchProviderPin: !!client.batch_provider_pin_encrypted && client.batch_provider_pin_encrypted !== '',
    eftpsEnrolled: !!client.eftps_enrolled,
    hasBankAccount: !!client.bank_account_number_encrypted,
    hasInternetPassword: !!client.eftps_internet_password_encrypted,
    twcUsername: client.twc_username || null,
    hasTwcPassword: !!client.twc_password_encrypted,
    payrollFrequency: client.payroll_frequency || 'biweekly',
    nextPayrollDate:  client.next_payroll_date  || null,
    nextCheckNumber:  client.next_check_number  || 1001,
    businessAddress:    client.business_address    || null,
    businessCity:       client.business_city       || null,
    businessZip:        client.business_zip        || null,
    notificationEmail:  client.notification_email  || null,
    notificationPhone:  client.notification_phone  || null,
    bankName:           client.bank_name           || null,
    countyCode:         client.county_code         || null,
    joinCode:           client.join_code           || null,
    selfRegistered:     !!client.self_registered,
    onboardingDone:     !!client.onboarding_done,
    bankAccountLast4: (() => {
      if (!client.bank_account_number_encrypted) return null;
      try { const n = decrypt(client.bank_account_number_encrypted); return n ? n.slice(-4) : null; } catch { return null; }
    })(),
  };
  if (includeSecrets) {
    out.batchProviderPin = client.batch_provider_pin_encrypted ? decrypt(client.batch_provider_pin_encrypted) : null;
    out.bankAccountNumber = decrypt(client.bank_account_number_encrypted);
    out.eftpsInternetPassword = client.eftps_internet_password_encrypted
      ? decrypt(client.eftps_internet_password_encrypted) : null;
  }
  return out;
}

// GET /api/clients
router.get('/', (req, res) => {
  const db = getDb();

  // Client-role users: return just their own company record (no enrichment needed)
  if (req.user.role === 'client') {
    const own = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.user.clientId);
    if (!own) return res.json([]);
    return res.json([sanitizeClient(own)]);
  }

  // Companies this accountant owns OR was granted access to as an additional accountant.
  const clients = db.prepare(`
    SELECT * FROM clients
    WHERE user_id = ? OR id IN (SELECT client_id FROM client_accountants WHERE user_id = ?)
    ORDER BY business_name
  `).all(req.user.id, req.user.id);

  const today = new Date().toISOString().slice(0, 10);

  // Attach next due date, last submission status, and overdue liability totals
  const enriched = clients.map((c) => {
    const lastSub = db
      .prepare('SELECT * FROM submissions WHERE client_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(c.id);
    const nextDue = calcNextDueDate(c.deposit_schedule, lastSub?.pay_period_end);

    // Next pay date: frequency-matched pay groups → static field fallback.
    let nextPayDate = null;
    try {
      const groups = db.prepare('SELECT * FROM pay_groups WHERE client_id = ? AND deleted_at IS NULL').all(c.id);
      const clientFreq = c.payroll_frequency || 'biweekly';

      // Only use groups that match the client's payroll frequency.
      // Groups with other frequencies (e.g., old test groups) would produce wrong dates.
      // If no frequency-matched groups exist, fall back to all groups.
      const preferredGroups = groups.filter(g => g.frequency === clientFreq);
      const activeGroups = preferredGroups.length > 0 ? preferredGroups : groups;

      // Orphan paystubs (pay_group_id IS NULL) are only attributed to groups when
      // preferred (frequency-matched) groups exist — avoids cross-contamination.
      const orphanRow = preferredGroups.length > 0 ? db.prepare(`
        SELECT MAX(pay_period_end) as last_end FROM paystubs
        WHERE client_id = ? AND pay_group_id IS NULL
          AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
          AND pay_period_end IS NOT NULL
      `).get(c.id) : null;

      for (const g of activeGroups) {
        if (!g.frequency) continue;
        const groupRow = db.prepare(`
          SELECT MAX(pay_period_end) as last_end FROM paystubs
          WHERE client_id = ? AND pay_group_id = ?
            AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
            AND pay_period_end IS NOT NULL
        `).get(c.id, g.id);

        const lastEnd = [groupRow?.last_end, orphanRow?.last_end]
          .filter(Boolean).sort().pop() || null;

        let candidateEnd = lastEnd ? nextPeriodEnd(lastEnd.slice(0, 10), g.frequency) : null;
        const firstEnd = (g.first_pay_period_end || '').slice(0, 10);
        if (firstEnd && (!candidateEnd || firstEnd > candidateEnd)) {
          candidateEnd = firstEnd;
        }
        if (!candidateEnd) continue;

        const nextPay = addBizDays(candidateEnd, 2);
        if (!nextPayDate || nextPay < nextPayDate) nextPayDate = nextPay;
      }
    } catch (e) { console.error('[nextPayDate]', c.id, e.message); }

    // Final fallback: static next_payroll_date on the client record.
    // Also used when there are no pay groups (e.g., Habibi with orphan paystubs but
    // no active pay group — the orphan schedule isn't reliable without a group context).
    if (!nextPayDate) nextPayDate = c.next_payroll_date ? c.next_payroll_date.slice(0, 10) : null;

    // Compute overdue/due-soon using JS IRS due-date logic (matches frontend MultiLiabPanel).
    // The SQL settlement_due_date column is often unset, so we compute dates from settlement_date.
    const in5Days = new Date(today); in5Days.setDate(in5Days.getDate() + 5);
    const in5DaysStr = in5Days.toISOString().slice(0, 10);
    const schedule = c.deposit_schedule || 'monthly';

    const pendingStubs = db.prepare(`
      SELECT * FROM paystubs
      WHERE client_id = ?
        AND check_status IN ('printed','deposited','direct_deposit_sent','direct_deposit_cleared')
        AND (status IN ('pending','processing','failed') OR status_940 IN ('pending','processing','failed'))
    `).all(c.id);

    let overdueAmount = 0, dueSoonAmount = 0;
    for (const s of pendingStubs) {
      const refDate = (s.settlement_date || s.pay_period_end || '').slice(0, 10);
      if (!refDate) continue;
      const due941 = (s.settlement_due_date || '').slice(0, 10) || calcIRSDepositDue(refDate, schedule);
      const due940 = calcFutaQuarterlyDue((s.pay_period_end || '').slice(0, 10));
      const p941 = s.status === 'pending' || s.status === 'processing' || s.status === 'failed';
      const p940 = (s.status_940 === 'pending' || s.status_940 === 'processing' || s.status_940 === 'failed') && (s.futa_tax || 0) > 0;
      if (p941 && due941) {
        if (due941 < today) overdueAmount += s.total_deposit || 0;
        else if (due941 <= in5DaysStr) dueSoonAmount += s.total_deposit || 0;
      }
      if (p940 && due940) {
        if (due940 < today) overdueAmount += s.futa_tax || 0;
        else if (due940 <= in5DaysStr) dueSoonAmount += s.futa_tax || 0;
      }
    }

    // Derive a single liability status for the dashboard badge
    const liabilityStatus = overdueAmount > 0 ? 'overdue'
      : dueSoonAmount > 0 ? 'due-soon'
      : 'clear';

    return {
      ...sanitizeClient(c),
      nextDueDate:          nextDue,
      nextPayDate:          nextPayDate || (c.next_payroll_date ? c.next_payroll_date.slice(0, 10) : null),
      payrollFrequency:     c.payroll_frequency  || 'biweekly',
      lastSubmissionStatus: lastSub?.eftps_status || null,
      lastSubmissionDate:   lastSub?.created_at   || null,
      overdueAmount,
      dueSoonAmount,
      liabilityStatus,
    };
  });

  res.json(enriched);
});

// GET /api/clients/:id
// GET /api/clients/accountant-shares — sync relationships this accountant created
// (accountants who continuously receive all my companies), for review/revoke.
// Defined before '/:id' so the literal path isn't captured as an :id param.
router.get('/accountant-shares', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT sl.target_user_id AS userId, u.username, u.email, sl.created_at AS since
    FROM accountant_sync_links sl JOIN users u ON u.id = sl.target_user_id
    WHERE sl.source_user_id = ? ORDER BY sl.created_at DESC
  `).all(req.user.id);
  res.json({ syncedAccountants: rows });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const access = canAccessClient(db, req.params.id, req.user);
  if (!access) return res.status(404).json({ error: 'Client not found' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(access.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(sanitizeClient(client));
});

// POST /api/clients
router.post('/', (req, res) => {
  const { businessName, ein, state, bankAccountNumber, bankRoutingNumber, bankAccountType, batchProviderPin,
    eftpsInternetPassword, eftpsEnrollmentNumber, depositSchedule, sutaRate,
    suiRateQ1, suiRateQ2, suiRateQ3, suiRateQ4, suiAccountNumber,
    contactName, contactEmail, contactPhone,
    payrollFrequency, nextPayrollDate, nextCheckNumber,
    // The Add Company form requires the address — dropping these here meant a
    // freshly created company always showed a blank address afterward.
    businessAddress, businessCity, businessZip, countyCode,
    twcUsername, twcPassword } = req.body;

  if (!businessName || !ein) {
    return res.status(400).json({ error: 'Business name and EIN are required' });
  }
  if (!/^\d{2}-?\d{7}$/.test(ein)) {
    return res.status(400).json({ error: 'EIN must be in format XX-XXXXXXX' });
  }
  if (batchProviderPin && !/^\d{4}$/.test(batchProviderPin)) {
    return res.status(400).json({ error: 'Batch Provider PIN must be exactly 4 digits' });
  }

  const db = getDb();
  const joinCode = generateJoinCode(db);
  const result = db.prepare(`
    INSERT INTO clients (user_id, business_name, ein, state, bank_account_number_encrypted, bank_routing_number,
      bank_account_type, batch_provider_pin_encrypted, eftps_internet_password_encrypted, eftps_enrollment_number,
      deposit_schedule, suta_rate, sui_rate_q1, sui_rate_q2, sui_rate_q3, sui_rate_q4, sui_account_number,
      contact_name, contact_email, contact_phone,
      payroll_frequency, next_payroll_date, next_check_number, twc_username, twc_password_encrypted, join_code,
      business_address, business_city, business_zip, county_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    businessName.trim(),
    ein.trim(),
    (state || 'TX').toUpperCase(),
    bankAccountNumber ? encrypt(bankAccountNumber) : null,
    bankRoutingNumber || null,
    bankAccountType || 'checking',
    batchProviderPin ? encrypt(batchProviderPin) : '',
    eftpsInternetPassword ? encrypt(eftpsInternetPassword) : null,
    eftpsEnrollmentNumber || null,
    depositSchedule || 'monthly',
    sutaRate ? parseFloat(sutaRate) : 0.027,
    suiRateQ1 != null ? parseFloat(suiRateQ1) : null,
    suiRateQ2 != null ? parseFloat(suiRateQ2) : null,
    suiRateQ3 != null ? parseFloat(suiRateQ3) : null,
    suiRateQ4 != null ? parseFloat(suiRateQ4) : null,
    suiAccountNumber || null,
    contactName || null,
    contactEmail || null,
    contactPhone || null,
    payrollFrequency || 'biweekly',
    nextPayrollDate   || null,
    nextCheckNumber   ? parseInt(nextCheckNumber, 10) : 1001,
    twcUsername || null,
    twcPassword ? encrypt(twcPassword) : null,
    joinCode,
    businessAddress || null,
    businessCity    || null,
    businessZip     || null,
    countyCode      || null,
  );

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
  // If this accountant has any "share everything" (sync) relationships, grant the
  // new company to those accountants automatically.
  propagateSyncForSource(db, req.user.id, client.id);
  res.status(201).json(sanitizeClient(client));
});

// PUT /api/clients/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const access = canAccessClient(db, req.params.id, req.user);
  if (!access) return res.status(404).json({ error: 'Client not found' });
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(access.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const { businessName, ein, state, bankAccountNumber, bankRoutingNumber, bankAccountType, batchProviderPin,
    eftpsInternetPassword, eftpsEnrollmentNumber, depositSchedule, sutaRate,
    suiRateQ1, suiRateQ2, suiRateQ3, suiRateQ4, suiAccountNumber,
    contactName, contactEmail, contactPhone,
    payrollFrequency, nextPayrollDate,
    businessAddress, businessCity, businessZip,
    notificationEmail, notificationPhone,
    twcUsername, twcPassword, bankName, countyCode } = req.body;

  if (ein && !/^\d{2}-?\d{7}$/.test(ein)) return res.status(400).json({ error: 'EIN must be in format XX-XXXXXXX' });
  if (batchProviderPin && !/^\d{4}$/.test(batchProviderPin)) return res.status(400).json({ error: 'Batch Provider PIN must be exactly 4 digits' });

  db.prepare(`
    UPDATE clients SET
      business_name = ?,
      ein = ?,
      state = ?,
      bank_account_number_encrypted = ?,
      bank_routing_number = ?,
      bank_account_type = ?,
      batch_provider_pin_encrypted = ?,
      eftps_internet_password_encrypted = ?,
      eftps_enrollment_number = ?,
      deposit_schedule = ?,
      suta_rate = ?,
      sui_rate_q1 = ?,
      sui_rate_q2 = ?,
      sui_rate_q3 = ?,
      sui_rate_q4 = ?,
      sui_account_number = ?,
      contact_name = ?,
      contact_email = ?,
      contact_phone = ?,
      payroll_frequency = ?,
      next_payroll_date = ?,
      business_address = ?,
      business_city = ?,
      business_zip = ?,
      notification_email = ?,
      notification_phone = ?,
      twc_username = ?,
      twc_password_encrypted = ?,
      bank_name = ?,
      county_code = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    businessName || existing.business_name,
    ein || existing.ein,
    state ? state.toUpperCase() : existing.state,
    bankAccountNumber ? encrypt(bankAccountNumber) : existing.bank_account_number_encrypted,
    bankRoutingNumber !== undefined ? bankRoutingNumber : existing.bank_routing_number,
    bankAccountType || existing.bank_account_type,
    batchProviderPin ? encrypt(batchProviderPin) : existing.batch_provider_pin_encrypted,
    eftpsInternetPassword ? encrypt(eftpsInternetPassword) : existing.eftps_internet_password_encrypted,
    eftpsEnrollmentNumber !== undefined ? eftpsEnrollmentNumber : existing.eftps_enrollment_number,
    depositSchedule || existing.deposit_schedule,
    sutaRate !== undefined ? parseFloat(sutaRate) : existing.suta_rate,
    suiRateQ1 !== undefined ? (suiRateQ1 != null ? parseFloat(suiRateQ1) : null) : existing.sui_rate_q1,
    suiRateQ2 !== undefined ? (suiRateQ2 != null ? parseFloat(suiRateQ2) : null) : existing.sui_rate_q2,
    suiRateQ3 !== undefined ? (suiRateQ3 != null ? parseFloat(suiRateQ3) : null) : existing.sui_rate_q3,
    suiRateQ4 !== undefined ? (suiRateQ4 != null ? parseFloat(suiRateQ4) : null) : existing.sui_rate_q4,
    suiAccountNumber !== undefined ? (suiAccountNumber || null) : existing.sui_account_number,
    contactName !== undefined ? contactName : existing.contact_name,
    contactEmail !== undefined ? contactEmail : existing.contact_email,
    contactPhone !== undefined ? contactPhone : existing.contact_phone,
    payrollFrequency || existing.payroll_frequency || 'biweekly',
    nextPayrollDate  !== undefined ? (nextPayrollDate || null) : existing.next_payroll_date,
    businessAddress    !== undefined ? (businessAddress    || null) : existing.business_address,
    businessCity       !== undefined ? (businessCity       || null) : existing.business_city,
    businessZip        !== undefined ? (businessZip        || null) : existing.business_zip,
    notificationEmail  !== undefined ? (notificationEmail  || null) : existing.notification_email,
    notificationPhone  !== undefined ? (notificationPhone  || null) : existing.notification_phone,
    twcUsername !== undefined ? (twcUsername || null) : existing.twc_username,
    twcPassword ? encrypt(twcPassword) : existing.twc_password_encrypted,
    bankName !== undefined ? (bankName || null) : existing.bank_name,
    countyCode !== undefined ? (countyCode || null) : existing.county_code,
    existing.id,
  );

  const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(existing.id);
  res.json(sanitizeClient(updated));
});

// PUT /api/clients/:id/pin  — set EFTPS enrollment PIN directly (no bridge needed)
// Accountant-only: business-owner clients must not touch EFTPS credentials.
router.put('/:id/pin', requireAdmin, (req, res) => {
  const db = getDb();
  const client = canAccessClient(db, req.params.id, req.user);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const { pin } = req.body;
  if (!pin || !/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
  db.prepare('UPDATE clients SET batch_provider_pin_encrypted = ?, eftps_enrolled = 1 WHERE id = ?')
    .run(encrypt(String(pin)), client.id);
  console.log(`[PIN] Updated PIN for "${client.business_name}" (EIN ${client.ein}) via direct endpoint`);
  res.json({ ok: true, message: `PIN updated for ${client.business_name}` });
});

// POST /api/clients/:id/complete-onboarding
router.post('/:id/complete-onboarding', (req, res) => {
  const db = getDb();
  const access = canAccessClient(db, req.params.id, req.user);
  if (!access) return res.status(404).json({ error: 'Client not found' });
  db.prepare('UPDATE clients SET onboarding_done = 1 WHERE id = ?').run(access.id);
  const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(access.id);
  res.json(sanitizeClient(updated));
});

// DELETE /api/clients/:id/paystubs — wipe all paystubs for a client (re-import helper)
// Accountant-only: destructive, not for business-owner clients.
router.delete('/:id/paystubs', requireAdmin, (req, res) => {
  const db = getDb();
  const client = canAccessClient(db, req.params.id, req.user);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const ids = db.prepare('SELECT id FROM paystubs WHERE client_id = ?').all(req.params.id).map(r => r.id);
  if (ids.length === 0) return res.json({ deleted: 0 });
  const ph = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM paystub_line_items WHERE paystub_id IN (${ph})`).run(...ids);
  const { changes } = db.prepare('DELETE FROM paystubs WHERE client_id = ?').run(req.params.id);
  res.json({ deleted: changes });
});

// DELETE /api/clients/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ message: 'Client deleted' });
});

// ── Accountant access (invite additional accountants to manage a company) ──────

function generateAccountantCode(db) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code, attempts = 0;
  do {
    const bytes = crypto.randomBytes(8);
    code = '';
    for (let i = 0; i < 8; i++) code += chars[bytes[i] % chars.length];
    attempts++;
  } while (
    (db.prepare('SELECT id FROM accountant_invites WHERE code = ?').get(code) ||
     db.prepare('SELECT id FROM accountant_bulk_invites WHERE code = ?').get(code)) &&
    attempts < 100
  );
  return code;
}

// Every client id an accountant can manage: companies they own + companies granted
// to them via client_accountants.
function accessibleClientIds(db, userId) {
  return db.prepare(`
    SELECT id FROM clients WHERE user_id = ?
    UNION
    SELECT client_id FROM client_accountants WHERE user_id = ?
  `).all(userId, userId).map(r => r.id);
}

// For a "share everything" (sync) source, grant a single company to every accountant
// synced to them. Called when the source adds/gains a new company. Returns rows added.
function propagateSyncForSource(db, sourceUserId, clientId) {
  const targets = db.prepare('SELECT target_user_id FROM accountant_sync_links WHERE source_user_id = ?').all(sourceUserId);
  let added = 0;
  const ins = db.prepare('INSERT OR IGNORE INTO client_accountants (client_id, user_id, invited_by) VALUES (?, ?, ?)');
  for (const t of targets) {
    if (t.target_user_id === sourceUserId) continue;
    added += ins.run(clientId, t.target_user_id, sourceUserId).changes;
  }
  return added;
}

function accountantList(db, client) {
  const owner = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(client.user_id);
  const linked = db.prepare(`
    SELECT u.id, u.username, u.email, ca.created_at
    FROM client_accountants ca JOIN users u ON u.id = ca.user_id
    WHERE ca.client_id = ? ORDER BY ca.created_at
  `).all(client.id);
  const pending = db.prepare(`
    SELECT code, expires_at, created_at FROM accountant_invites
    WHERE client_id = ? AND used_at IS NULL AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    ORDER BY created_at DESC
  `).all(client.id);
  return {
    owner: owner ? { userId: owner.id, username: owner.username, email: owner.email, primary: true } : null,
    accountants: linked.map(u => ({ userId: u.id, username: u.username, email: u.email, connectedAt: u.created_at, primary: false })),
    pendingInvites: pending.map(p => ({ code: p.code, expiresAt: p.expires_at, createdAt: p.created_at })),
  };
}

// GET /api/clients/:id/accountants — who can manage this company (+ pending invites)
router.get('/:id/accountants', (req, res) => {
  const db = getDb();
  const client = canAccessClient(db, req.params.id, req.user);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(accountantList(db, client));
});

// POST /api/clients/:id/accountant-invites — generate a one-time invite code for
// an accountant. The client (or an existing accountant) shares it; the accountant
// redeems it from their own dashboard to gain access.
router.post('/:id/accountant-invites', (req, res) => {
  const db = getDb();
  const client = canAccessClient(db, req.params.id, req.user);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const code = generateAccountantCode(db);
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO accountant_invites (client_id, code, created_by, expires_at) VALUES (?, ?, ?, ?)')
    .run(client.id, code, req.user.id, expires);
  res.status(201).json({ code, expiresAt: expires, ...accountantList(db, client) });
});

// DELETE /api/clients/:id/accountants/:userId — revoke an accountant's access.
// The primary owner cannot be removed this way.
router.delete('/:id/accountants/:userId', (req, res) => {
  const db = getDb();
  const client = canAccessClient(db, req.params.id, req.user);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const targetId = parseInt(req.params.userId, 10);
  if (targetId === client.user_id) return res.status(400).json({ error: 'Cannot remove the primary accountant' });
  db.prepare('DELETE FROM client_accountants WHERE client_id = ? AND user_id = ?').run(client.id, targetId);
  res.json(accountantList(db, client));
});

// DELETE /api/clients/:id/accountant-invites/:code — cancel a pending invite code.
router.delete('/:id/accountant-invites/:code', (req, res) => {
  const db = getDb();
  const client = canAccessClient(db, req.params.id, req.user);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  db.prepare('DELETE FROM accountant_invites WHERE client_id = ? AND code = ? AND used_at IS NULL')
    .run(client.id, String(req.params.code).toUpperCase());
  res.json(accountantList(db, client));
});

// POST /api/clients/accountant-invites/bulk — generate ONE code that grants a
// redeeming accountant access to ALL companies the inviter can manage.
// mode: 'snapshot' (companies at redeem time) | 'sync' (also future companies).
router.post('/accountant-invites/bulk', requireAdmin, (req, res) => {
  const db = getDb();
  const mode = req.body.mode === 'sync' ? 'sync' : 'snapshot';
  const code = generateAccountantCode(db);
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO accountant_bulk_invites (code, created_by, mode, expires_at) VALUES (?, ?, ?, ?)')
    .run(code, req.user.id, mode, expires);
  const companyCount = accessibleClientIds(db, req.user.id).length;
  res.status(201).json({ code, mode, expiresAt: expires, companyCount });
});

// POST /api/clients/connect — an accountant redeems an invite code to gain access.
// Handles both a per-company code and a bulk "all companies" code. Admin-only.
router.post('/connect', requireAdmin, (req, res) => {
  const db = getDb();
  const code = String(req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Invite code is required' });

  // ── Bulk "all companies" code ───────────────────────────────────────────────
  const bulk = db.prepare('SELECT * FROM accountant_bulk_invites WHERE code = ?').get(code);
  if (bulk) {
    if (bulk.used_at) return res.status(409).json({ error: 'That invite code has already been used' });
    if (bulk.expires_at && bulk.expires_at <= new Date().toISOString()) {
      return res.status(410).json({ error: 'That invite code has expired' });
    }
    if (bulk.created_by === req.user.id) return res.status(409).json({ error: 'That is your own invite code' });

    const clientIds = accessibleClientIds(db, bulk.created_by);
    let granted = 0;
    db.transaction(() => {
      const ins = db.prepare('INSERT OR IGNORE INTO client_accountants (client_id, user_id, invited_by) VALUES (?, ?, ?)');
      for (const cid of clientIds) granted += ins.run(cid, req.user.id, bulk.created_by).changes;
      if (bulk.mode === 'sync') {
        db.prepare('INSERT OR IGNORE INTO accountant_sync_links (source_user_id, target_user_id) VALUES (?, ?)')
          .run(bulk.created_by, req.user.id);
      }
      db.prepare("UPDATE accountant_bulk_invites SET used_at = datetime('now'), used_by = ? WHERE id = ?")
        .run(req.user.id, bulk.id);
    })();

    return res.status(201).json({ bulk: true, mode: bulk.mode, granted, total: clientIds.length });
  }

  // ── Per-company code ────────────────────────────────────────────────────────
  const invite = db.prepare('SELECT * FROM accountant_invites WHERE code = ?').get(code);
  if (!invite) return res.status(404).json({ error: 'That invite code is not valid' });
  if (invite.used_at) return res.status(409).json({ error: 'That invite code has already been used' });
  if (invite.expires_at && invite.expires_at <= new Date().toISOString()) {
    return res.status(410).json({ error: 'That invite code has expired' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invite.client_id);
  if (!client) return res.status(404).json({ error: 'Company no longer exists' });
  if (client.user_id === req.user.id) return res.status(409).json({ error: 'You already own this company' });

  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO client_accountants (client_id, user_id, invited_by) VALUES (?, ?, ?)')
      .run(client.id, req.user.id, invite.created_by);
    db.prepare("UPDATE accountant_invites SET used_at = datetime('now'), used_by = ? WHERE id = ?")
      .run(req.user.id, invite.id);
  })();

  res.status(201).json({ clientId: client.id, businessName: client.business_name });
});

// DELETE /api/clients/accountant-shares/:userId — stop a sync relationship AND revoke
// the access it granted (every company I shared with that accountant).
router.delete('/accountant-shares/:userId', requireAdmin, (req, res) => {
  const db = getDb();
  const targetId = parseInt(req.params.userId, 10);
  if (!targetId) return res.status(400).json({ error: 'Invalid accountant' });
  db.transaction(() => {
    db.prepare('DELETE FROM accountant_sync_links WHERE source_user_id = ? AND target_user_id = ?')
      .run(req.user.id, targetId);
    // Remove access this accountant granted to the target (rows where I was the inviter).
    db.prepare('DELETE FROM client_accountants WHERE user_id = ? AND invited_by = ?')
      .run(targetId, req.user.id);
  })();
  res.json({ ok: true });
});

module.exports = router;
