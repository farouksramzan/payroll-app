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
  me: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  // Clients
  getClients: () => request('/clients'),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) => request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClient: (id) => request(`/clients/${id}`, { method: 'DELETE' }),

  // Employees
  getEmployees: (clientId) => request(`/employees?clientId=${clientId}`),
  getEmployee: (id) => request(`/employees/${id}`),
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
  updatePaystubStatus: (id, status) => request(`/paystubs/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  voidPaystub: (id, reason) => request(`/paystubs/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
  getPaystubCredits: (clientId) => request(`/paystubs/credits?clientId=${clientId}`),
  markLateChecks: () => request('/paystubs/mark-late', { method: 'POST' }),
  batchSubmitPaystubs: (data) => request('/paystubs/batch-submit', { method: 'POST', body: JSON.stringify(data) }),
  getBridgeJobStatus: (jobId) => request(`/bridge/job-status/${jobId}`),
  printSelectedChecks: async (clientId, paystubIds) => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/paystubs/print-selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clientId, paystubIds }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'PDF failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'selected-checks.pdf'; a.click();
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

  // Reports
  get941: (clientId, year, quarter) => request(`/reports/941?clientId=${clientId}&year=${year}&quarter=${quarter}`),
  get940: (clientId, year) => request(`/reports/940?clientId=${clientId}&year=${year}`),
  getTWC: (clientId, year, quarter) => request(`/reports/twc?clientId=${clientId}&year=${year}&quarter=${quarter}`),
  getW2: (clientId, year) => request(`/reports/w2?clientId=${clientId}&year=${year}`),
  getW3: (clientId, year) => request(`/reports/w3?clientId=${clientId}&year=${year}`),
};

export default api;
