const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    return;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const api = {
  // Auth
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username, password) => request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  // Clients
  getClients: () => request('/clients'),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) => request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateClientPin: (id, pin) => request(`/clients/${id}/pin`, { method: 'PUT', body: JSON.stringify({ pin }) }),
  deleteClient: (id) => request(`/clients/${id}`, { method: 'DELETE' }),

  // Employees
  getEmployees: (clientId) => request(`/employees?clientId=${clientId}`),
  getEmployee: (id, withSSN = false) => request(`/employees/${id}${withSSN ? '?withSSN=true' : ''}`),
  getEmployeeYTD: (id, year) => request(`/employees/${id}/ytd?year=${year}`),
  getEmployeeYTDBatch: (clientId, year) => request(`/employees/ytd-batch?clientId=${clientId}&year=${year}`),
  createEmployee: (data) => request('/employees', { method: 'POST', body: JSON.stringify(data) }),
  updateEmployee: (id, data) => request(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmployee: (id) => request(`/employees/${id}`, { method: 'DELETE' }),

  // Payroll calculator
  calculate: (data) => request('/payroll/calculate', { method: 'POST', body: JSON.stringify(data) }),
  getStates: () => request('/payroll/states'),

  // Submissions
  getSubmissions: (clientId) => request(`/submissions${clientId ? `?clientId=${clientId}` : ''}`),
  getSubmission: (id) => request(`/submissions/${id}`),
  createSubmission: (data) => request('/submissions', { method: 'POST', body: JSON.stringify(data) }),
  submitToEFTPS: (id) => request(`/submissions/${id}/submit`, { method: 'POST' }),
  submitViaBridge: (id) => request(`/submissions/${id}/submit-bridge`, { method: 'POST' }),

  // Paystubs
  getPaystubs: (clientId, employeeId) => request(`/paystubs?clientId=${clientId}${employeeId ? `&employeeId=${employeeId}` : ''}`),
  getPaystubsByEmployee: (clientId, employeeId) => request(`/paystubs/by-employee?clientId=${clientId}&employeeId=${employeeId}`),
  getPaystub: (id) => request(`/paystubs/${id}`),
  createPaystub: (data) => request('/paystubs', { method: 'POST', body: JSON.stringify(data) }),
  updatePaystub: (id, data) => request(`/paystubs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePaystub: (id) => request(`/paystubs/${id}`, { method: 'DELETE' }),
  submitPaystub: (id, taxType = '941') => request(`/paystubs/${id}/submit`, { method: 'POST', body: JSON.stringify({ taxType }) }),
  updatePaystubStatus: (id, status, taxType) => request(`/paystubs/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, taxType }) }),
  voidPaystub: (id, reason) => request(`/paystubs/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
  getPaystubCredits: (clientId) => request(`/paystubs/credits?clientId=${clientId}`),
  markLateChecks: () => request('/paystubs/mark-late', { method: 'POST' }),
  markPendingPeriods: (data) => request('/paystubs/mark-pending', { method: 'POST', body: JSON.stringify(data) }),
  batchSubmitPaystubs: (data) => request('/paystubs/batch-submit', { method: 'POST', body: JSON.stringify(data) }),
  batchResetTax: (clientIds, taxTypes) => request('/paystubs/batch-reset-tax', { method: 'POST', body: JSON.stringify({ clientIds, taxTypes }) }),
  getBridgeJobStatus: (jobId) => request(`/bridge/job-status/${jobId}`),
  printSelectedChecks: async (clientId, paystubIds, design = 'classic') => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/paystubs/print-selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clientId, paystubIds, design }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'PDF failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `checks-${design}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  printSelectedPaystubs: async (clientId, paystubIds) => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/paystubs/paystub-selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clientId, paystubIds }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'PDF failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'selected-paystubs.pdf'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  downloadSuiReport: async (clientId, paystubIds) => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/paystubs/sui-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clientId, paystubIds }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to generate SUI report'); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : 'TWC_SUI_Report.csv';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  getPayPeriods: (clientId) => request(`/paystubs/pay-periods?clientId=${clientId}`),
  runPayroll: (data) => request('/paystubs/payroll-run', { method: 'POST', body: JSON.stringify(data) }),
  downloadRunPdf: async (runId, clientId) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/paystubs/run-pdf/${runId}?clientId=${clientId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'PDF failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `payroll-checks-${runId}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  // Pay Groups
  getPayGroups: (clientId) => request(`/pay-groups?clientId=${clientId}`),
  getPayGroup: (id) => request(`/pay-groups/${id}`),
  getPayGroupEmployees: (id) => request(`/pay-groups/${id}/employees`),
  createPayGroup: (data) => request('/pay-groups', { method: 'POST', body: JSON.stringify(data) }),
  updatePayGroup: (id, data) => request(`/pay-groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePayGroup: (id) => request(`/pay-groups/${id}`, { method: 'DELETE' }),

  // ACH Bridge
  getBridgeStatus: () => request('/bridge/status'),
  getTwcBridgeStatus: () => request('/twc-bridge/status'),

  // TWC bridge submissions
  createTwcSubmission: (clientId, quarter, year) =>
    request('/twc-submissions', { method: 'POST', body: JSON.stringify({ clientId, quarter, year }) }),
  getTwcSubmission: (id) => request(`/twc-submissions/${id}`),
  listTwcSubmissions: (clientId) => request(`/twc-submissions?clientId=${clientId}`),

  // Reports
  get941: (clientId, year, quarter) => request(`/reports/941?clientId=${clientId}&year=${year}&quarter=${quarter}`),
  get940: (clientId, year) => request(`/reports/940?clientId=${clientId}&year=${year}`),
  getTWC: (clientId, year, quarter) => request(`/reports/twc?clientId=${clientId}&year=${year}&quarter=${quarter}`),
  downloadTWCIcesa: async (clientId, year, quarter) => {
    const token = localStorage.getItem('token');
    const qs = new URLSearchParams({ clientId, year, quarter });
    const res = await fetch(`/api/reports/twc-icesa?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'ICESA generation failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    a.href = url; a.download = match ? match[1] : `TWC_Q${quarter}_${year}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  getW2: (clientId, year) => request(`/reports/w2?clientId=${clientId}&year=${year}`),
  getW3: (clientId, year) => request(`/reports/w3?clientId=${clientId}&year=${year}`),
  downloadReportPdf: async (form, clientId, year, quarter) => {
    const token = localStorage.getItem('token');
    const qs = new URLSearchParams({ form, clientId, year, ...(quarter ? { quarter } : {}) });
    const res = await fetch(`/api/reports/pdf?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'PDF failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = `${form.replace(/[^a-z0-9]/gi, '-')}-${year}${quarter ? `-Q${quarter}` : ''}.pdf`;
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  // Self-service signup
  registerCompany: (data) => request('/auth/register-company', { method: 'POST', body: JSON.stringify(data) }),
  lookupCompanyByCode: (code) => request(`/auth/company-by-code/${encodeURIComponent(code)}`),
  claimEmployee: (data) => request('/auth/claim-employee', { method: 'POST', body: JSON.stringify(data) }),
  completeOnboarding: (clientId) => request(`/clients/${clientId}/complete-onboarding`, { method: 'POST' }),

  // Invite system
  inviteClient: (clientId) => request('/auth/invite-client', { method: 'POST', body: JSON.stringify({ clientId }) }),
  inviteEmployee: (employeeId) => request('/auth/invite-employee', { method: 'POST', body: JSON.stringify({ employeeId }) }),
  getInvite: (token) => request(`/auth/invite/${token}`),
  acceptInvite: (token, email, password) => request('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token, email, password }) }),
  updateSetupStep: (step, complete = false) => request('/auth/setup-step', { method: 'PATCH', body: JSON.stringify({ step, complete }) }),

  // Client portal
  getClientPortalMe: () => request('/client-portal/me'),
  getClientPortalEmployees: (clientId) => request(`/client-portal/employees${clientId ? `?clientId=${clientId}` : ''}`),
  getClientPortalPaystubs: (params = {}) => request(`/client-portal/paystubs?${new URLSearchParams(params)}`),
  getClientPortalSummary: (clientId) => request(`/client-portal/summary${clientId ? `?clientId=${clientId}` : ''}`),

  // Employee portal
  getEmployeePortalMe: () => request('/employee-portal/me'),
  updateEmployeePortalMe: (data) => request('/employee-portal/me', { method: 'PATCH', body: JSON.stringify(data) }),
  getEmployeePortalPaystubs: () => request('/employee-portal/paystubs'),
  getEmployeePortalPaystub: (id) => request(`/employee-portal/paystubs/${id}`),
  completeEmployeeOnboarding: () => request('/employee-portal/complete-onboarding', { method: 'POST' }),

  // Preparer info
  getPreparerInfo: () => request('/auth/preparer'),
  savePreparerInfo: (data) => request('/auth/preparer', { method: 'PUT', body: JSON.stringify(data) }),

  // User management (admin only)
  getUsers: () => request('/auth/users'),
  createUser: (username, password) => request('/auth/users', { method: 'POST', body: JSON.stringify({ username, password }) }),
  deleteUser: (id) => request(`/auth/users/${id}`, { method: 'DELETE' }),

  // Employee import
  previewEmployeeImport: async (clientId, file) => {
    const token = localStorage.getItem('token');
    const form = new FormData();
    form.append('clientId', clientId);
    form.append('file', file);
    const res = await fetch(`${BASE}/import/employees/preview`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Preview failed');
    return data;
  },

  previewPaycheckImport: async (clientId, file) => {
    const token = localStorage.getItem('token');
    const form = new FormData();
    form.append('clientId', clientId);
    form.append('file', file);
    const res = await fetch(`${BASE}/import/paychecks/preview`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Preview failed');
    return data;
  },

  importPaychecks: async (clientId, file, skipExisting, checkStatus, liabilityStatus) => {
    const token = localStorage.getItem('token');
    const form = new FormData();
    form.append('clientId', clientId);
    form.append('file', file);
    form.append('skipExisting', skipExisting ? 'true' : 'false');
    if (checkStatus)     form.append('checkStatus', checkStatus);
    if (liabilityStatus) form.append('liabilityStatus', liabilityStatus);
    const res = await fetch(`${BASE}/import/paychecks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    return data;
  },

  // Direct Deposit
  getDirectDeposit: (employeeId) => request(`/direct-deposit/${employeeId}`),
  saveDirectDeposit: (employeeId, data) => request(`/direct-deposit/${employeeId}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteDirectDeposit: (employeeId) => request(`/direct-deposit/${employeeId}`, { method: 'DELETE' }),
  activateDirectDeposit: (employeeId) => request(`/direct-deposit/${employeeId}/activate`, { method: 'POST' }),

  importEmployees: async (clientId, file, skipExisting) => {
    const token = localStorage.getItem('token');
    const form = new FormData();
    form.append('clientId', clientId);
    form.append('file', file);
    form.append('skipExisting', skipExisting ? 'true' : 'false');
    const res = await fetch(`${BASE}/import/employees`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    return data;
  },
};

export default api;
