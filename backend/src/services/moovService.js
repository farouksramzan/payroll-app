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

async function getToken() {
  const pub  = process.env.MOOV_PUBLIC_KEY;
  const priv = process.env.MOOV_PRIVATE_KEY;
  const origin = process.env.MOOV_ORIGIN || 'https://payroll-app-production-5dde.up.railway.app';
  const basic  = Buffer.from(`${pub}:${priv}`).toString('base64');

  const res = await fetch(`${MOOV_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${basic}`,
      'Origin': origin,
    },
    body: JSON.stringify({
      grant_type:    'client_credentials',
      client_id:     pub,
      client_secret: priv,
      scope:         '/accounts.read /accounts.write /bank-accounts.read /bank-accounts.write /transfers.read /transfers.write',
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

async function call(method, path, body) {
  if (!isConfigured()) throw new Error('Moov not configured. Add MOOV_PUBLIC_KEY and MOOV_PRIVATE_KEY environment variables.');
  const token = await getToken();
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
      value: netPayCents,
    },
    description: description || 'Payroll Direct Deposit',
  });
}

module.exports = {
  isConfigured,
  createEmployeeAccount,
  linkBankAccount,
  getPaymentMethods,
  sendDirectDeposit,
};
