'use strict';

/**
 * twcPayments.js
 * REST routes for TWC SUI online payment jobs.
 *
 * POST /api/twc-payments           — create and dispatch a payment job
 * GET  /api/twc-payments?clientId= — list payments for a client
 * GET  /api/twc-payments/:id       — get single payment status
 */

const express   = require('express');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const bridgeTwc = require('../ws/bridgeTwc');

const router = express.Router();
router.use(requireAuth);

// POST /api/twc-payments
router.post('/', (req, res) => {
  const { clientId, twcAccountNumber, amount, paymentDate, bankName } = req.body;
  if (!clientId || !twcAccountNumber || !amount || !paymentDate) {
    return res.status(400).json({ error: 'clientId, twcAccountNumber, amount, and paymentDate are required' });
  }
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const row = db.prepare(`
    INSERT INTO twc_payments (user_id, client_id, twc_account_number, amount, payment_date, bank_name, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(req.user.id, clientId, twcAccountNumber, amountNum, paymentDate, bankName || null);

  const paymentId = row.lastInsertRowid;

  if (!bridgeTwc.isConnected) {
    return res.status(201).json({ ...serializePayment(db.prepare('SELECT * FROM twc_payments WHERE id=?').get(paymentId)), bridgeOffline: true });
  }

  // Enqueue the job. The bridge manager runs jobs one at a time in FIFO order,
  // so several payments (same or different accounts) can be submitted at once and
  // will drain automatically instead of being rejected. Status flows:
  // queued → processing → completed/failed.
  try {
    db.prepare(`UPDATE twc_payments SET status='queued', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(paymentId);
    const jobId = bridgeTwc.queueJob(
      { type: 'twc_payment', paymentId, twcAccountNumber, amount: amountNum, paymentDate, bankName: bankName || null, clientName: client.business_name },
      (success, msg) => {
        db.prepare(`
          UPDATE twc_payments
          SET status=?, confirmation_number=?, bank_name_confirmed=?, error=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).run(
          success ? 'completed' : 'failed',
          msg.confirmationNumber || null,
          msg.bankName || null,
          msg.error || null,
          paymentId,
        );
      },
      10 * 60 * 1000,
      // onDispatch: fires when this job leaves the queue and is sent to the bridge
      () => {
        db.prepare(`UPDATE twc_payments SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(paymentId);
      },
    );
    db.prepare(`UPDATE twc_payments SET job_id=? WHERE id=?`).run(jobId, paymentId);
  } catch (err) {
    db.prepare(`UPDATE twc_payments SET status='pending', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(paymentId);
    return res.status(500).json({ error: err.message });
  }

  res.status(201).json(serializePayment(db.prepare('SELECT * FROM twc_payments WHERE id=?').get(paymentId)));
});

// GET /api/twc-payments?clientId=
router.get('/', (req, res) => {
  const { clientId } = req.query;
  const db = getDb();
  if (clientId) {
    const client = db.prepare('SELECT id FROM clients WHERE id=? AND user_id=?').get(clientId, req.user.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    return res.json(db.prepare('SELECT * FROM twc_payments WHERE client_id=? ORDER BY created_at DESC LIMIT 50').all(clientId).map(serializePayment));
  }
  res.json(db.prepare(`
    SELECT p.* FROM twc_payments p JOIN clients c ON p.client_id=c.id WHERE c.user_id=? ORDER BY p.created_at DESC LIMIT 100
  `).all(req.user.id).map(serializePayment));
});

// GET /api/twc-payments/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT p.* FROM twc_payments p JOIN clients c ON p.client_id=c.id WHERE p.id=? AND c.user_id=?
  `).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Payment not found' });
  res.json(serializePayment(row));
});

function serializePayment(row) {
  return {
    id:                 row.id,
    clientId:           row.client_id,
    twcAccountNumber:   row.twc_account_number,
    amount:             row.amount,
    paymentDate:        row.payment_date,
    bankName:           row.bank_name,
    status:             row.status,
    confirmationNumber: row.confirmation_number || null,
    bankNameConfirmed:  row.bank_name_confirmed || null,
    error:              row.error               || null,
    jobId:              row.job_id              || null,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  };
}

module.exports = router;
