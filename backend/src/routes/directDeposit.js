const express = require('express');
const { getDb } = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/cryptoService');
const moov = require('../services/moovService');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

// GET /api/direct-deposit/moov-test — debug Moov auth
router.get('/moov-test', async (req, res) => {
  const pub  = process.env.MOOV_PUBLIC_KEY;
  const priv = process.env.MOOV_PRIVATE_KEY;
  const facilitatorId = process.env.MOOV_FACILITATOR_ACCOUNT_ID;
  const origin = process.env.MOOV_ORIGIN || 'https://payroll-app-production-5dde.up.railway.app';
  const basic = pub && priv ? Buffer.from(`${pub}:${priv}`).toString('base64') : null;

  try {
    const tokenRes = await fetch('https://api.moov.io/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basic}`,
        'Origin': origin,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: `/accounts/${facilitatorId}/transfers.write /accounts/${facilitatorId}/bank-accounts.write /accounts/${facilitatorId}/bank-accounts.read /accounts.write /accounts.read`,
      }),
    });
    const text = await tokenRes.text();
    res.json({ status: tokenRes.status, body: text, pub: pub?.slice(0,8)+'...', facilitatorId, origin });
  } catch (e) {
    res.json({ error: e.message });
  }
});

function getEmployee(db, empId, userId) {
  return db.prepare(`
    SELECT e.* FROM employees e
    JOIN clients c ON e.client_id = c.id
    WHERE e.id = ? AND (c.user_id = ? OR c.id IN (SELECT client_id FROM client_accountants WHERE user_id = ?))
  `).get(empId, userId, userId);
}

// GET /api/direct-deposit/:employeeId — return DD status (never returns account number)
router.get('/:employeeId', (req, res) => {
  const db = getDb();
  const emp = getEmployee(db, req.params.employeeId, req.user.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  res.json({
    status:         emp.bank_account_status || 'none',
    last4:          emp.bank_account_last4  || null,
    bankAccountType:emp.bank_account_type   || 'checking',
    routingNumber:  emp.bank_routing_number || null,
    moovConfigured: moov.isConfigured(),
  });
});

// POST /api/direct-deposit/:employeeId — save bank account + create Moov account + link bank
router.post('/:employeeId', async (req, res) => {
  const db = getDb();
  const emp = getEmployee(db, req.params.employeeId, req.user.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const { routingNumber, accountNumber, bankAccountType } = req.body;
  if (!routingNumber || !accountNumber) return res.status(400).json({ error: 'routingNumber and accountNumber required' });
  if (!/^\d{9}$/.test(routingNumber)) return res.status(400).json({ error: 'routingNumber must be 9 digits' });
  if (!/^\d{4,17}$/.test(accountNumber)) return res.status(400).json({ error: 'accountNumber must be 4–17 digits' });

  const last4 = accountNumber.slice(-4);
  const type  = bankAccountType || 'checking';

  // Save to DB immediately (encrypted)
  db.prepare(`
    UPDATE employees SET
      bank_routing_number          = ?,
      bank_account_number_encrypted = ?,
      bank_account_type            = ?,
      bank_account_last4           = ?,
      bank_account_status          = 'pending'
    WHERE id = ?
  `).run(routingNumber, encrypt(accountNumber), type, last4, emp.id);

  // If Moov is configured, create/update Moov account + link bank async
  if (moov.isConfigured()) {
    try {
      // Create or reuse Moov account for this employee
      let moovAccountId = emp.moov_account_id;
      if (!moovAccountId) {
        console.log('[DD] Creating Moov account for', emp.first_name, emp.last_name);
        const acct = await moov.createEmployeeAccount({
          firstName: emp.first_name,
          lastName:  emp.last_name,
        });
        console.log('[DD] Moov account created:', JSON.stringify(acct));
        moovAccountId = acct.accountID;
        db.prepare('UPDATE employees SET moov_account_id = ? WHERE id = ?').run(moovAccountId, emp.id);
      }

      // Link bank account
      const holderName = `${emp.first_name} ${emp.last_name}`;
      console.log('[DD] Linking bank account to Moov account', moovAccountId);
      const bankAcct = await moov.linkBankAccount(moovAccountId, {
        routingNumber,
        accountNumber,
        bankAccountType: type,
        holderName,
      });
      console.log('[DD] Bank account linked:', JSON.stringify(bankAcct));

      const moovBankId = bankAcct.bankAccountID;
      db.prepare(`
        UPDATE employees SET
          moov_bank_account_id = ?,
          bank_account_status  = 'active'
        WHERE id = ?
      `).run(moovBankId, emp.id);

      return res.json({ status: 'active', last4, bankAccountType: type, moovAccountId, moovBankAccountId: moovBankId });
    } catch (err) {
      console.error('[DirectDeposit] Moov error:', err.message);
      db.prepare("UPDATE employees SET bank_account_status = 'failed' WHERE id = ?").run(emp.id);
      return res.status(400).json({ error: `Moov error: ${err.message}`, status: 'failed', last4, bankAccountType: type });
    }
  }

  // Moov not configured — saved locally, status stays pending
  res.json({ status: 'pending', last4, bankAccountType: type });
});

// DELETE /api/direct-deposit/:employeeId — remove bank account info
router.delete('/:employeeId', (req, res) => {
  const db = getDb();
  const emp = getEmployee(db, req.params.employeeId, req.user.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  db.prepare(`
    UPDATE employees SET
      bank_routing_number           = NULL,
      bank_account_number_encrypted = NULL,
      bank_account_last4            = NULL,
      bank_account_status           = 'none',
      moov_bank_account_id          = NULL
    WHERE id = ?
  `).run(emp.id);

  res.json({ status: 'none' });
});

// POST /api/direct-deposit/:employeeId/activate — re-attempt Moov linking for pending accounts
router.post('/:employeeId/activate', async (req, res) => {
  const db = getDb();
  const emp = getEmployee(db, req.params.employeeId, req.user.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  if (!emp.bank_account_number_encrypted || !emp.bank_routing_number) {
    return res.status(400).json({ error: 'No bank account saved. Add bank account first.' });
  }
  if (!moov.isConfigured()) {
    return res.status(400).json({ error: 'Moov not configured on this server.' });
  }

  try {
    let moovAccountId = emp.moov_account_id;
    if (!moovAccountId) {
      const acct = await moov.createEmployeeAccount({ firstName: emp.first_name, lastName: emp.last_name });
      moovAccountId = acct.accountID;
      db.prepare('UPDATE employees SET moov_account_id = ? WHERE id = ?').run(moovAccountId, emp.id);
    }
    const accountNumber = decrypt(emp.bank_account_number_encrypted);
    const bankAcct = await moov.linkBankAccount(moovAccountId, {
      routingNumber:   emp.bank_routing_number,
      accountNumber,
      bankAccountType: emp.bank_account_type || 'checking',
      holderName:      `${emp.first_name} ${emp.last_name}`,
    });
    db.prepare(`
      UPDATE employees SET moov_bank_account_id = ?, bank_account_status = 'active' WHERE id = ?
    `).run(bankAcct.bankAccountID, emp.id);
    res.json({ status: 'active', moovBankAccountId: bankAcct.bankAccountID });
  } catch (err) {
    db.prepare("UPDATE employees SET bank_account_status = 'failed' WHERE id = ?").run(emp.id);
    res.status(400).json({ error: err.message, status: 'failed' });
  }
});

module.exports = router;
