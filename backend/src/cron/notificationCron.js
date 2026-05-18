'use strict';

const cron = require('node-cron');
const { getDb } = require('../database/db');
const { sendEmail, sendSMS, buildMessages } = require('../services/notificationService');

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return Math.ceil((due - today) / 86400000);
}

function alreadySent(db, clientId, liabilityType, dueDateStr, notifType) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT id FROM notification_log
    WHERE client_id = ? AND liability_type = ? AND due_date = ? AND notif_type = ? AND sent_date = ?
  `).get(clientId, liabilityType, dueDateStr, notifType, today);
  return !!row;
}

function logSent(db, clientId, liabilityType, dueDateStr, notifType, channel, amount, success) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO notification_log (client_id, liability_type, due_date, notif_type, channel, amount, success, sent_date)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(clientId, liabilityType, dueDateStr, notifType, channel, amount, success ? 1 : 0, today);
}

async function checkAndNotify() {
  const db = getDb();
  const clients = db.prepare(`
    SELECT c.*, u.id as user_id
    FROM clients c
    JOIN users u ON c.user_id = u.id
    WHERE (c.notification_email IS NOT NULL AND c.notification_email != '')
       OR (c.notification_phone IS NOT NULL AND c.notification_phone != '')
  `).all();

  for (const client of clients) {
    // Gather all pending 941 liabilities grouped by due date
    const pending941 = db.prepare(`
      SELECT settlement_due_date, SUM(total_deposit) as total
      FROM paystubs
      WHERE client_id = ? AND status = 'pending' AND settlement_due_date IS NOT NULL
      GROUP BY settlement_due_date
    `).all(client.id);

    const pending940 = db.prepare(`
      SELECT settlement_due_date, SUM(futa_tax) as total
      FROM paystubs
      WHERE client_id = ? AND status_940 = 'pending' AND futa_tax > 0 AND settlement_due_date IS NOT NULL
      GROUP BY settlement_due_date
    `).all(client.id);

    const liabilities = [
      ...pending941.map(r => ({ type: '941', dueDate: r.settlement_due_date, amount: r.total })),
      ...pending940.map(r => ({ type: '940', dueDate: r.settlement_due_date, amount: r.total })),
    ];

    for (const liab of liabilities) {
      const days = daysUntil(liab.dueDate);
      if (days === null) continue;

      let notifType = null;
      if (days < 0)    notifType = 'overdue';
      else if (days <= 2) notifType = '2day';
      else if (days <= 5) notifType = '5day';

      if (!notifType) continue;

      const msgs = buildMessages({
        companyName: client.business_name,
        liabilityType: `Form ${liab.type}`,
        amount: liab.amount,
        dueDate: liab.dueDate,
        daysRemaining: days,
      });

      // Email
      if (client.notification_email && !alreadySent(db, client.id, liab.type, liab.dueDate, notifType)) {
        const r = await sendEmail(client.notification_email, msgs.subject, msgs.html);
        logSent(db, client.id, liab.type, liab.dueDate, notifType, 'email', liab.amount, r.success);
      }

      // SMS
      if (client.notification_phone && !alreadySent(db, client.id, liab.type, liab.dueDate, notifType + '_sms')) {
        const r = await sendSMS(client.notification_phone, msgs.sms);
        logSent(db, client.id, liab.type, liab.dueDate, notifType + '_sms', 'sms', liab.amount, r.success);
      }
    }
  }
}

function start() {
  // Run daily at 8:00 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('[NotificationCron] Running liability check…');
    try { await checkAndNotify(); }
    catch (e) { console.error('[NotificationCron] Error:', e.message); }
  });

  // Also run once at startup (after 10s delay) to catch any missed notifications
  setTimeout(async () => {
    try { await checkAndNotify(); }
    catch (e) { console.error('[NotificationCron] Startup check error:', e.message); }
  }, 10000);

  console.log('[NotificationCron] Scheduled daily at 08:00');
}

module.exports = { start, checkAndNotify };
