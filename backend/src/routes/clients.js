const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/cryptoService');
const { calcNextDueDate } = require('../services/taxCalculator');

const router = express.Router();
router.use(requireAuth);

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
    hasBatchProviderPin: !!client.batch_provider_pin_encrypted,
    hasBankAccount: !!client.bank_account_number_encrypted,
    hasInternetPassword: !!client.eftps_internet_password_encrypted,
    payrollFrequency: client.payroll_frequency || 'biweekly',
    nextPayrollDate:  client.next_payroll_date  || null,
    nextCheckNumber:  client.next_check_number  || 1001,
  };
  if (includeSecrets) {
    out.batchProviderPin = decrypt(client.batch_provider_pin_encrypted);
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

  // Attach next due date and last submission status to each client
  const enriched = clients.map((c) => {
    const lastSub = db
      .prepare('SELECT * FROM submissions WHERE client_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(c.id);
    const nextDue = calcNextDueDate(c.deposit_schedule, lastSub?.pay_period_end);
    return {
      ...sanitizeClient(c),
      nextDueDate:          nextDue,
      nextPayrollDate:      c.next_payroll_date  || null,
      payrollFrequency:     c.payroll_frequency  || 'biweekly',
      lastSubmissionStatus: lastSub?.eftps_status || null,
      lastSubmissionDate:   lastSub?.created_at   || null,
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
    payrollFrequency, nextPayrollDate, nextCheckNumber } = req.body;

  if (!businessName || !ein || !batchProviderPin) {
    return res.status(400).json({ error: 'Business name, EIN, and Batch Provider PIN are required' });
  }
  if (!/^\d{2}-?\d{7}$/.test(ein)) {
    return res.status(400).json({ error: 'EIN must be in format XX-XXXXXXX' });
  }
  if (!/^\d{4}$/.test(batchProviderPin)) {
    return res.status(400).json({ error: 'Batch Provider PIN must be exactly 4 digits' });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO clients (user_id, business_name, ein, state, bank_account_number_encrypted, bank_routing_number,
      bank_account_type, batch_provider_pin_encrypted, eftps_internet_password_encrypted, eftps_enrollment_number,
      deposit_schedule, suta_rate, contact_name, contact_email, contact_phone,
      payroll_frequency, next_payroll_date, next_check_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    businessName.trim(),
    ein.trim(),
    (state || 'TX').toUpperCase(),
    encrypt(bankAccountNumber),
    bankRoutingNumber || null,
    bankAccountType || 'checking',
    encrypt(batchProviderPin),
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
    payrollFrequency, nextPayrollDate } = req.body;

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
