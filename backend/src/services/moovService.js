/**
 * Moov ACH direct deposit service.
 * Uses Moov REST API with OAuth2 client credentials.
 * Env vars required:
 *   MOOV_PUBLIC_KEY           — shown in Moov dashboard (API keys page)
 *   MOOV_PRIVATE_KEY          — shown only once at key creation time
 *   MOOV_FACILITATOR_ACCOUNT_ID  — your platform's Moov account ID (Account settings)
 */

const MOOV_BASE = process.env.MOOV_BASE_URL || 'https://api.moov.io';

function isConfigured() {
  return !!(process.env.MOOV_PUBLIC_KEY && process.env.MOOV_PRIVATE_KEY);
}

async function getToken(additionalScopes = []) {
  const pub  = process.env.MOOV_PUBLIC_KEY;
  const priv = process.env.MOOV_PRIVATE_KEY;
  const origin = process.env.MOOV_ORIGIN || 'https://payroll-app-production-5dde.up.railway.app';
  const basic  = Buffer.from(`${pub}:${priv}`).toString('base64');

  const facilitatorId = process.env.MOOV_FACILITATOR_ACCOUNT_ID || '';
  const scope = [
    '/accounts.write',
    '/accounts.read',
    `/accounts/${facilitatorId}/transfers.write`,
    `/accounts/${facilitatorId}/transfers.read`,
    `/accounts/${facilitatorId}/bank-accounts.write`,
    `/accounts/${facilitatorId}/bank-accounts.read`,
    `/accounts/${facilitatorId}/capabilities.write`,
    `/accounts/${facilitatorId}/capabilities.read`,
    ...additionalScopes,
  ].join(' ');

  const res = await fetch(`${MOOV_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`,
      'Origin': origin,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = `${res.status}`;
    try { const e = JSON.parse(text); msg = e.error_description || e.error || JSON.stringify(e) || msg; } catch {}
    throw new Error(`Moov auth failed: ${msg}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function call(method, path, body, additionalScopes = [], extraHeaders = {}) {
  if (!isConfigured()) throw new Error('Moov not configured. Add MOOV_PUBLIC_KEY and MOOV_PRIVATE_KEY environment variables.');
  const token = await getToken(additionalScopes);
  const facilitatorId = process.env.MOOV_FACILITATOR_ACCOUNT_ID || '';
  const origin = process.env.MOOV_ORIGIN || 'https://payroll-app-production-5dde.up.railway.app';
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Account-ID': facilitatorId,
      'Origin': origin,
      ...extraHeaders,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${MOOV_BASE}${path}`, opts);
  const text = await res.text();
  if (!res.ok) {
    console.error(`[Moov] ${method} ${path} → ${res.status}: ${text}`);
    let msg = `Moov ${method} ${path} → ${res.status}: ${text}`;
    throw new Error(msg);
  }
  if (!text) return {};
  return JSON.parse(text);
}

// Create a Moov individual account for an employee
async function createEmployeeAccount({ firstName, lastName }) {
  return call('POST', '/accounts', {
    accountType: 'individual',
    profile: {
      individual: {
        name: { firstName, lastName },
      },
    },
  });
}

// Link a bank account to a Moov account
async function linkBankAccount(moovAccountId, { routingNumber, accountNumber, bankAccountType, holderName }) {
  return call('POST', `/accounts/${moovAccountId}/bank-accounts`, {
    account: {
      routingNumber,
      accountNumber,
      bankAccountType: bankAccountType || 'checking',
      holderName,
      holderType: 'individual',
    },
  }, [
    `/accounts/${moovAccountId}/bank-accounts.write`,
    `/accounts/${moovAccountId}/bank-accounts.read`,
  ]);
}

// List payment methods for an account
async function getPaymentMethods(moovAccountId) {
  return call('GET', `/accounts/${moovAccountId}/payment-methods`, null, [
    `/accounts/${moovAccountId}/payment-methods.read`,
    `/accounts/${moovAccountId}/bank-accounts.read`,
  ]);
}

// Send a direct deposit (ACH credit) from employer to employee
async function sendDirectDeposit({ sourceAccountId, sourcePaymentMethodId, destAccountId, destPaymentMethodId, netPayCents, description }) {
  const facilitatorId = process.env.MOOV_FACILITATOR_ACCOUNT_ID || '';
  const { randomUUID } = require('crypto');
  return call('POST', '/transfers', {
    source: {
      accountID: sourceAccountId,
      paymentMethodID: sourcePaymentMethodId,
    },
    destination: {
      accountID: destAccountId,
      paymentMethodID: destPaymentMethodId,
    },
    amount: {
      currency: 'USD',
      value: netPayCents,
    },
    description: description || 'Payroll Direct Deposit',
  }, [
    `/accounts/${facilitatorId}/transfers.write`,
    `/accounts/${destAccountId}/transfers.write`,
  ], {
    'X-Idempotency-Key': randomUUID(),
  });
}

module.exports = {
  isConfigured,
  createEmployeeAccount,
  linkBankAccount,
  getPaymentMethods,
  sendDirectDeposit,
};
