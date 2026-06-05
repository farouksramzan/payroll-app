const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/cryptoService');
const { calcNextDueDate } = require('../services/taxCalculator');

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
    contactName: client.contact_name,
    contactEmail: client.contact_email,
    contactPhone: client.contact_phone,
    createdAt: client.created_at,
    updatedAt: client.updated_at,
    hasBatchProviderPin: !!client.batch_provider_pin_encrypted && client.batch_provider_pin_encrypted !== '',
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
  const clients = db.prepare('SELECT * FROM clients WHERE user_id = ? ORDER BY business_name').all(req.user.id);

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
router.get('/:id', (req, res) => {
  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(sanitizeClient(client));
});

// POST /api/clients
router.post('/', (req, res) => {
  const { businessName, ein, state, bankAccountNumber, bankRoutingNumber, bankAccountType, batchProviderPin,
    eftpsInternetPassword, eftpsEnrollmentNumber, depositSchedule, sutaRate,
    contactName, contactEmail, contactPhone,
    payrollFrequency, nextPayrollDate, nextCheckNumber,
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
  const result = db.prepare(`
    INSERT INTO clients (user_id, business_name, ein, state, bank_account_number_encrypted, bank_routing_number,
      bank_account_type, batch_provider_pin_encrypted, eftps_internet_password_encrypted, eftps_enrollment_number,
      deposit_schedule, suta_rate, contact_name, contact_email, contact_phone,
      payroll_frequency, next_payroll_date, next_check_number, twc_username, twc_password_encrypted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    contactName || null,
    contactEmail || null,
    contactPhone || null,
    payrollFrequency || 'biweekly',
    nextPayrollDate   || null,
    nextCheckNumber   ? parseInt(nextCheckNumber, 10) : 1001,
    twcUsername || null,
    twcPassword ? encrypt(twcPassword) : null,
  );

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(sanitizeClient(client));
});

// PUT /api/clients/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const { businessName, ein, state, bankAccountNumber, bankRoutingNumber, bankAccountType, batchProviderPin,
    eftpsInternetPassword, eftpsEnrollmentNumber, depositSchedule, sutaRate,
    contactName, contactEmail, contactPhone,
    payrollFrequency, nextPayrollDate,
    businessAddress, businessCity, businessZip,
    notificationEmail, notificationPhone,
    twcUsername, twcPassword } = req.body;

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
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
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
    req.params.id,
    req.user.id,
  );

  const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  res.json(sanitizeClient(updated));
});

// DELETE /api/clients/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ message: 'Client deleted' });
});

module.exports = router;
