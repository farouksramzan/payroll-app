/**
 * Moov ACH direct deposit service.
 * Uses Moov REST API v2026 with OAuth2 client credentials.
 * Env vars required:
 *   MOOV_CLIENT_ID
 *   MOOV_CLIENT_SECRET
 *   MOOV_FACILITATOR_ACCOUNT_ID  — your platform's Moov account ID
 */

const MOOV_BASE = process.env.MOOV_BASE_URL || 'https://api.moov.io';

function isConfigured() {
  return !!(process.env.MOOV_CLIENT_ID && process.env.MOOV_CLIENT_SECRET);
}

async function getToken(scope) {
  const res = await fetch(`${MOOV_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id:     process.env.MOOV_CLIENT_ID,
      client_secret: process.env.MOOV_CLIENT_SECRET,
      ...(scope ? { scope } : {}),
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`Moov auth failed: ${e.error_description || e.error || res.status}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function call(method, path, body, scope) {
  if (!isConfigured()) throw new Error('Moov not configured. Add MOOV_CLIENT_ID and MOOV_CLIENT_SECRET environment variables.');
  const token = await getToken(scope);
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${MOOV_BASE}${path}`, opts);
  const text = await res.text();
  if (!res.ok) {
    let msg = `Moov ${res.status}`;
    try { const e = JSON.parse(text); msg = e.error || e.message || JSON.stringify(e) || msg; } catch {}
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
    capabilities: ['transfers'],
  });
}

// Link a bank account to a Moov account
async function linkBankAccount(moovAccountId, { routingNumber, accountNumber, bankAccountType, holderName }) {
  return call('POST', `/accounts/${moovAccountId}/bank-accounts`, {
    routingNumber,
    accountNumber,
    bankAccountType: bankAccountType || 'checking',
    holderName,
    holderType: 'individual',
  });
}

// List payment methods for an account
async function getPaymentMethods(moovAccountId) {
  return call('GET', `/accounts/${moovAccountId}/payment-methods`);
}

// Find the ACH payment method ID for an account
async function getAchPaymentMethodId(moovAccountId) {
  const methods = await getPaymentMethods(moovAccountId);
  const list = Array.isArray(methods) ? methods : (methods.paymentMethods || []);
  const ach = list.find(m => m.paymentMethodType === 'ach-credit-standard' || m.paymentMethodType === 'ach-credit-same-day');
  return ach?.paymentMethodID || null;
}

// Send a direct deposit (ACH credit) from employer to employee
async function sendDirectDeposit({ sourceAccountId, sourcePaymentMethodId, destAccountId, destPaymentMethodId, netPayCents, description }) {
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
      value: netPayCents, // in cents
    },
    description: description || 'Payroll Direct Deposit',
  });
}

module.exports = {
  isConfigured,
  createEmployeeAccount,
  linkBankAccount,
  getPaymentMethods,
  getAchPaymentMethodId,
  sendDirectDeposit,
};
