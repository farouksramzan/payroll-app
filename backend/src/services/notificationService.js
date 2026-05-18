'use strict';

let sgMail = null;
let twilioClient = null;

function init() {
  try {
    if (process.env.SENDGRID_API_KEY) {
      sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      console.log('[Notifications] SendGrid configured');
    }
  } catch (e) { console.warn('[Notifications] SendGrid init failed:', e.message); }

  try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const twilio = require('twilio');
      twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      console.log('[Notifications] Twilio configured');
    }
  } catch (e) { console.warn('[Notifications] Twilio init failed:', e.message); }
}

async function sendEmail(to, subject, html) {
  if (!sgMail || !to) return { success: false, reason: 'not_configured' };
  try {
    await sgMail.send({
      to,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@payrolltaxpro.com',
      subject,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error('[Notifications] Email error:', err.message);
    return { success: false, error: err.message };
  }
}

async function sendSMS(to, body) {
  if (!twilioClient || !to || !process.env.TWILIO_PHONE_NUMBER) return { success: false, reason: 'not_configured' };
  // Normalize phone: ensure + prefix
  const phone = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`;
  try {
    await twilioClient.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to: phone });
    return { success: true };
  } catch (err) {
    console.error('[Notifications] SMS error:', err.message);
    return { success: false, error: err.message };
  }
}

function fmt(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function buildMessages({ companyName, liabilityType, amount, dueDate, daysRemaining }) {
  const urgency = daysRemaining < 0
    ? `OVERDUE by ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) !== 1 ? 's' : ''}`
    : daysRemaining === 0 ? 'DUE TODAY'
    : `due in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`;

  const subject = daysRemaining < 0
    ? `⚠️ OVERDUE: ${liabilityType} tax deposit — ${companyName}`
    : `Reminder: ${liabilityType} deposit ${urgency} — ${companyName}`;

  const accentColor = daysRemaining < 0 ? '#dc2626' : daysRemaining <= 2 ? '#d97706' : '#1a2e5a';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:${accentColor};color:#fff;padding:24px;">
        <h2 style="margin:0;font-size:18px;">Payroll Tax Deposit ${daysRemaining < 0 ? '⚠️ Overdue' : 'Reminder'}</h2>
      </div>
      <div style="padding:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#64748b;width:140px;">Company</td><td style="font-weight:700;">${companyName}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Liability Type</td><td style="font-weight:700;">${liabilityType}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Amount Due</td><td style="font-weight:700;font-size:20px;color:${accentColor};">${fmt(amount)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Settlement Date</td><td style="font-weight:700;">${dueDate}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Status</td><td style="font-weight:700;color:${accentColor};">${urgency.toUpperCase()}</td></tr>
        </table>
        ${daysRemaining < 0 ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:16px;margin-top:16px;color:#dc2626;font-weight:600;">Please remit payment immediately to EFTPS to avoid IRS penalties and interest.</div>` : ''}
        <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;" />
        <p style="color:#64748b;font-size:12px;margin:0;">Sent by Payroll Tax Pro · Manage notifications in Company settings</p>
      </div>
    </div>`;

  const sms = `PayrollTaxPro: ${companyName} — ${liabilityType} ${fmt(amount)} ${urgency} (due ${dueDate}). Log in to submit now.`;

  return { subject, html, sms };
}

module.exports = { init, sendEmail, sendSMS, buildMessages };
