'use strict';
import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function r2(n) { return Math.round((n || 0) * 100) / 100; }
function initials(name) { return name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'; }

const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],
  ['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],
  ['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],
  ['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],
  ['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
  ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],
  ['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
  ['DC','Washington D.C.'],
];

// ── Employee Drawer ───────────────────────────────────────────────────────────
function EmployeeDrawer({ clientId, empId, onClose, onSaved }) {
  const [form, setForm]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  useEffect(() => {
    if (!empId) return;
    api.getEmployee(empId).then(emp => setForm({
      firstName: emp.firstName || '', lastName: emp.lastName || '', ssn: '',
      address: emp.address || '', city: emp.city || '', state: emp.state || 'TX', zip: emp.zip || '',
      workState: emp.workState || '',
      filingStatus: emp.filingStatus || 'single',
      step2Checkbox: !!emp.step2Checkbox,
      step3Children: emp.step3Children || 0, step3Other: emp.step3Other || 0,
      step4a: emp.step4a > 0 ? String(emp.step4a) : '',
      step4b: emp.step4b > 0 ? String(emp.step4b) : '',
      step4c: emp.step4c > 0 ? String(emp.step4c) : '',
      payType: emp.payType || 'hourly',
      hourlyRate: emp.hourlyRate > 0 ? String(emp.hourlyRate) : '',
      annualSalary: emp.annualSalary > 0 ? String(emp.annualSalary) : '',
      payFrequency: emp.payFrequency || 'biweekly',
      hireDate: emp.hireDate || '', isActive: emp.isActive !== false,
    })).catch(e => setErr(e.message));
  }, [empId]);

  function set(field) { return e => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm(f => ({ ...f, [field]: v })); }; }

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      const payload = { clientId, ...form, step3Children: parseInt(form.step3Children || 0), step3Other: parseInt(form.step3Other || 0), step4a: parseFloat(form.step4a || 0), step4b: parseFloat(form.step4b || 0), step4c: parseFloat(form.step4c || 0), hourlyRate: parseFloat(form.hourlyRate || 0), annualSalary: parseFloat(form.annualSalary || 0) };
      if (!payload.ssn) delete payload.ssn;
      await api.updateEmployee(empId, payload);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div className="drawer-title">{form ? `${form.firstName} ${form.lastName}` : 'Employee'}</div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          {err && <div className="alert alert-error" style={{ marginBottom: 16 }}><span>⚠</span>{err}</div>}
          {!form ? (
            <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 28, height: 28 }} /></div>
          ) : (
            <>
              <p className="form-section-title" style={{ marginTop: 0 }}>Personal Information</p>
              <div className="form-grid">
                <div className="form-group"><label className="form-label">First Name</label><input className="form-input" value={form.firstName} onChange={set('firstName')} /></div>
                <div className="form-group"><label className="form-label">Last Name</label><input className="form-input" value={form.lastName} onChange={set('lastName')} /></div>
              </div>
              <div className="form-group">
                <label className="form-label">SSN <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)', textTransform: 'none' }}>(leave blank to keep current)</span></label>
                <input className="form-input mono" type="password" value={form.ssn} onChange={set('ssn')} placeholder="leave blank to keep" />
                <p className="form-hint">Stored encrypted with AES-256.</p>
              </div>
              <div className="form-group"><label className="form-label">Address</label><input className="form-input" value={form.address} onChange={set('address')} placeholder="123 Main St" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">City</label><input className="form-input" value={form.city} onChange={set('city')} /></div>
                <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">State</label><select className="form-select" value={form.state} onChange={set('state')}>{US_STATES.map(([c]) => <option key={c} value={c}>{c}</option>)}</select></div>
                <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">ZIP</label><input className="form-input mono" value={form.zip} onChange={set('zip')} maxLength={10} /></div>
              </div>
              <div className="form-group" style={{ marginTop: 14 }}>
                <label className="form-label">Work State (tax withholding)</label>
                <select className="form-select" value={form.workState} onChange={set('workState')}>
                  <option value="">— Use company default —</option>
                  {US_STATES.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
                </select>
              </div>

              <p className="form-section-title">Pay Settings</p>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Pay Type</label>
                  <select className="form-select" value={form.payType} onChange={set('payType')}>
                    <option value="hourly">Hourly</option><option value="salary">Salary</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Pay Frequency</label>
                  <select className="form-select" value={form.payFrequency} onChange={set('payFrequency')}>
                    <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
                    <option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              {form.payType === 'hourly' ? (
                <div className="form-group" style={{ maxWidth: 180 }}>
                  <label className="form-label">Hourly Rate</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                    <input className="form-input mono" type="number" min="0" step="0.01" value={form.hourlyRate} onChange={set('hourlyRate')} placeholder="0.00" style={{ paddingLeft: 24 }} />
                  </div>
                </div>
              ) : (
                <div className="form-group" style={{ maxWidth: 220 }}>
                  <label className="form-label">Annual Salary</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                    <input className="form-input mono" type="number" min="0" step="1000" value={form.annualSalary} onChange={set('annualSalary')} placeholder="0" style={{ paddingLeft: 24 }} />
                  </div>
                </div>
              )}

              <p className="form-section-title">W-4 Withholding</p>
              <div className="form-group">
                <label className="form-label">Filing Status</label>
                <select className="form-select" value={form.filingStatus} onChange={set('filingStatus')} style={{ maxWidth: 340 }}>
                  <option value="single">Single / Married filing separately</option>
                  <option value="married">Married filing jointly</option>
                  <option value="hoh">Head of household</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 14 }}>
                <input type="checkbox" checked={form.step2Checkbox} onChange={set('step2Checkbox')} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                <span style={{ fontSize: 13 }}>Step 2(c): Two jobs checkbox</span>
              </label>
              <div className="form-grid">
                <div className="form-group"><label className="form-label">Qualifying children (×$2,200)</label><input className="form-input" type="number" min="0" max="20" value={form.step3Children} onChange={e => setForm(f => ({ ...f, step3Children: parseInt(e.target.value || 0) }))} style={{ maxWidth: 80 }} /></div>
                <div className="form-group"><label className="form-label">Other dependents (×$500)</label><input className="form-input" type="number" min="0" max="20" value={form.step3Other} onChange={e => setForm(f => ({ ...f, step3Other: parseInt(e.target.value || 0) }))} style={{ maxWidth: 80 }} /></div>
              </div>

              <div className="form-group" style={{ maxWidth: 180 }}>
                <label className="form-label">Hire Date</label>
                <input className="form-input" type="date" value={form.hireDate} onChange={set('hireDate')} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isActive} onChange={set('isActive')} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                <span style={{ fontSize: 13 }}>Employee is active</span>
              </label>
            </>
          )}
        </div>
        {form && (
          <div className="drawer-footer">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Employees Tab ─────────────────────────────────────────────────────────────
function EmployeesTab({ clientId, employees, onRefresh }) {
  const navigate = useNavigate();
  const [drawerEmpId, setDrawerEmpId] = useState(null);

  const FREQ = { weekly: 'Weekly', biweekly: 'Bi-weekly', semimonthly: 'Semi-monthly', monthly: 'Monthly' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Link to={`/clients/${clientId}/employees/new`} className="btn btn-primary">+ Add Employee</Link>
      </div>

      {employees.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <div className="empty-state-icon">👤</div>
            <h3>No employees yet</h3>
            <p>Add your first employee to get started.</p>
            <Link to={`/clients/${clientId}/employees/new`} className="btn btn-primary">Add Employee</Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {employees.map(emp => {
            const isSalary = emp.payType === 'salary';
            const rate = isSalary
              ? `${fmt(emp.annualSalary)}/yr`
              : `${fmt(emp.hourlyRate)}/hr`;
            return (
              <div key={emp.id} className="emp-row" onClick={() => setDrawerEmpId(emp.id)}>
                <div className="emp-avatar">{initials(`${emp.firstName} ${emp.lastName}`)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="emp-name">{emp.firstName} {emp.lastName}</div>
                  <div className="emp-meta">{emp.workState || 'TX'} · {FREQ[emp.payFrequency] || emp.payFrequency} · {isSalary ? 'Salary' : 'Hourly'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{rate}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {emp.filingStatus === 'married' ? 'Married' : emp.filingStatus === 'hoh' ? 'HoH' : 'Single'}
                  </div>
                </div>
                <span className={`badge ${emp.isActive !== false ? 'badge-success' : 'badge-neutral'}`}>
                  {emp.isActive !== false ? 'Active' : 'Inactive'}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
              </div>
            );
          })}
        </div>
      )}

      {drawerEmpId && (
        <EmployeeDrawer
          clientId={clientId}
          empId={drawerEmpId}
          onClose={() => setDrawerEmpId(null)}
          onSaved={() => { setDrawerEmpId(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ── Company Tab ───────────────────────────────────────────────────────────────
function CompanyTab({ client, onSaved }) {
  const [form, setForm]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err, setErr]       = useState('');

  useEffect(() => {
    if (!client) return;
    setForm({
      businessName: client.businessName || '',
      ein: client.ein || '',
      state: client.state || 'TX',
      depositSchedule: client.depositSchedule || 'monthly',
      sutaRate: client.sutaRate != null ? String(parseFloat(client.sutaRate) * 100) : '2.7',
      bankRoutingNumber: client.bankRoutingNumber || '',
      bankAccountType: client.bankAccountType || 'checking',
      bankAccountNumber: '',
      batchProviderPin: '',
      eftpsInternetPassword: '',
      eftpsEnrollmentNumber: client.eftpsEnrollmentNumber || '',
      contactName: client.contactName || '',
      contactEmail: client.contactEmail || '',
      contactPhone: client.contactPhone || '',
      payrollFrequency: client.payrollFrequency || 'biweekly',
      nextPayrollDate: client.nextPayrollDate || '',
    });
  }, [client]);

  function set(field) { return e => { setForm(f => ({ ...f, [field]: e.target.value })); setSaved(false); }; }

  async function handleSave() {
    setSaving(true); setErr(''); setSaved(false);
    try {
      const payload = { ...form, sutaRate: parseFloat(form.sutaRate || 2.7) / 100 };
      if (!payload.bankAccountNumber) delete payload.bankAccountNumber;
      if (!payload.batchProviderPin) delete payload.batchProviderPin;
      if (!payload.eftpsInternetPassword) delete payload.eftpsInternetPassword;
      await api.updateClient(client.id, payload);
      setSaved(true);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  if (!form) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 28, height: 28 }} /></div>;

  const F = ({ label, hint, children }) => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );

  return (
    <div style={{ maxWidth: 760 }}>
      {err   && <div className="alert alert-error"   style={{ marginBottom: 16 }}><span>⚠</span>{err}</div>}
      {saved && <div className="alert alert-success" style={{ marginBottom: 16 }}><span>✓</span>Changes saved.</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>Business Information</p>
        <div className="form-grid">
          <F label="Business Name"><input className="form-input" value={form.businessName} onChange={set('businessName')} /></F>
          <F label="EIN" hint="Format: XX-XXXXXXX"><input className="form-input mono" value={form.ein} onChange={set('ein')} placeholder="12-3456789" /></F>
        </div>
        <div className="form-grid">
          <F label="State of Business">
            <select className="form-select" value={form.state} onChange={set('state')}>
              {US_STATES.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
            </select>
          </F>
          <F label="EFTPS Deposit Schedule">
            <select className="form-select" value={form.depositSchedule} onChange={set('depositSchedule')}>
              <option value="monthly">Monthly</option>
              <option value="semiweekly">Semi-weekly</option>
            </select>
          </F>
        </div>
        <F label="SUI Rate (%)" hint="New employer default: 2.7%. Check your state unemployment notice for your assigned rate.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="form-input mono" type="number" min="0" max="20" step="0.01" value={form.sutaRate} onChange={set('sutaRate')} style={{ maxWidth: 120 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>%</span>
          </div>
        </F>

        <p className="form-section-title">Payroll Schedule</p>
        <div className="form-grid">
          <F label="Payroll Frequency">
            <select className="form-select" value={form.payrollFrequency} onChange={set('payrollFrequency')}>
              <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
              <option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option>
            </select>
          </F>
          <F label="Next Payroll Date" hint="Auto-advances after each payroll run.">
            <input className="form-input" type="date" value={form.nextPayrollDate} onChange={set('nextPayrollDate')} />
          </F>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>EFTPS Credentials</p>
        <F label="Batch Provider PIN" hint="Stored encrypted. Leave blank to keep current.">
          <input className="form-input mono" type="password" value={form.batchProviderPin} onChange={set('batchProviderPin')} placeholder="4-digit PIN (leave blank to keep)" maxLength={4} />
        </F>
        <div className="form-grid">
          <F label="EFTPS Internet Password" hint="Leave blank to keep current.">
            <input className="form-input mono" type="password" value={form.eftpsInternetPassword} onChange={set('eftpsInternetPassword')} placeholder="(leave blank to keep)" />
          </F>
          <F label="EFTPS Enrollment Number">
            <input className="form-input mono" value={form.eftpsEnrollmentNumber} onChange={set('eftpsEnrollmentNumber')} placeholder="Optional" />
          </F>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>Bank Account</p>
        <div className="form-grid">
          <F label="Account Number" hint="Leave blank to keep current.">
            <input className="form-input mono" type="password" value={form.bankAccountNumber} onChange={set('bankAccountNumber')} placeholder="(leave blank to keep)" />
          </F>
          <F label="Routing Number">
            <input className="form-input mono" value={form.bankRoutingNumber} onChange={set('bankRoutingNumber')} placeholder="9-digit routing number" maxLength={9} />
          </F>
        </div>
        <F label="Account Type">
          <select className="form-select" value={form.bankAccountType} onChange={set('bankAccountType')} style={{ maxWidth: 200 }}>
            <option value="checking">Checking</option><option value="savings">Savings</option>
          </select>
        </F>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>Contact Information</p>
        <div className="form-grid">
          <F label="Contact Name"><input className="form-input" value={form.contactName} onChange={set('contactName')} placeholder="Jane Smith" /></F>
          <F label="Phone"><input className="form-input" value={form.contactPhone} onChange={set('contactPhone')} placeholder="(555) 000-0000" /></F>
        </div>
        <F label="Email"><input className="form-input" type="email" value={form.contactEmail} onChange={set('contactEmail')} placeholder="jane@company.com" /></F>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner" /> : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// ── Pay Employees Sub-tab ─────────────────────────────────────────────────────
function PayEmployeesTab({ clientId, client, employees }) {
  const currentYear = new Date().getFullYear();

  const today = new Date();
  const defEnd   = new Date(today); defEnd.setDate(today.getDate() - 1);
  const defStart = new Date(defEnd); defStart.setDate(defEnd.getDate() - 13);

  const [payPeriodStart, setStart]    = useState(defStart.toISOString().slice(0, 10));
  const [payPeriodEnd,   setEnd]      = useState(defEnd.toISOString().slice(0, 10));
  const [settlementDate, setSettle]   = useState('');

  const [expandedId, setExpandedId]   = useState(null);
  const [inputs, setInputs]           = useState({});     // { [empId]: { hours, rate, amount, extraAmount, extraDesc } }
  const [calculating, setCalculating] = useState(null);
  const [runEntries, setRunEntries]   = useState([]);     // calculated rows for schedule table
  const [selected, setSelected]       = useState(new Set());
  const [running,  setRunning]        = useState(false);
  const [runResult, setRunResult]     = useState(null);

  const activeEmps = employees.filter(e => e.isActive !== false);

  // init inputs from employee defaults
  useEffect(() => {
    const init = {};
    activeEmps.forEach(emp => {
      const isSalary = emp.payType === 'salary';
      const periods  = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
      const salaryAmt = isSalary ? r2((emp.annualSalary || 0) / (periods[emp.payFrequency] || 26)) : 0;
      init[emp.id] = { hours: '', rate: String(emp.hourlyRate || ''), amount: isSalary ? String(salaryAmt) : '', extraAmount: '', extraDesc: '' };
    });
    setInputs(init);
  }, [employees]);

  function getGross(empId) {
    const inp = inputs[empId] || {};
    const main  = parseFloat(inp.amount  || 0);
    const extra = parseFloat(inp.extraAmount || 0);
    return r2(main + extra);
  }

  function updateInput(empId, field, value) {
    setInputs(prev => {
      const inp = { ...prev[empId], [field]: value };
      const emp = activeEmps.find(e => e.id === empId);
      if ((field === 'hours' || field === 'rate') && emp?.payType === 'hourly' && inp.hours && inp.rate) {
        inp.amount = String(r2(parseFloat(inp.hours) * parseFloat(inp.rate)));
      }
      return { ...prev, [empId]: inp };
    });
  }

  async function addToRun(emp) {
    const gross = getGross(emp.id);
    if (!gross || gross <= 0) { alert('Enter hours or amount first.'); return; }
    setCalculating(emp.id);
    try {
      const ytdData = await api.getEmployeeYTD(emp.id, currentYear).catch(() => ({ ytdGross: 0 }));
      const inp     = inputs[emp.id] || {};
      const taxes   = await api.calculate({
        grossWages:    gross,
        payFrequency:  emp.payFrequency || 'biweekly',
        filingStatus:  emp.filingStatus || 'single',
        step2Checkbox: !!emp.step2Checkbox,
        step3Children: emp.step3Children || 0,
        step3Other:    emp.step3Other    || 0,
        step4a: 0, step4b: 0, step4c: 0,
        workState:     emp.workState || client?.state || 'TX',
        ytdGross:      ytdData?.ytd_gross || 0,
        sutaRate:      client?.sutaRate || null,
      });

      const lineItems = [{ payType: emp.payType === 'salary' ? 'salary' : 'regular', hours: inp.hours ? parseFloat(inp.hours) : null, rate: inp.rate ? parseFloat(inp.rate) : null, amount: parseFloat(inp.amount || 0) }];
      if (parseFloat(inp.extraAmount || 0) > 0) lineItems.push({ payType: 'regular', description: inp.extraDesc || 'Additional pay', hours: null, rate: null, amount: parseFloat(inp.extraAmount) });

      const entry = {
        empId: emp.id,
        empName: `${emp.firstName} ${emp.lastName}`,
        payType: emp.payType,
        hours: inp.hours,
        grossWages:      taxes.grossWages,
        fitWithholding:  taxes.fitWithholding,
        employeeSS:      taxes.employeeSS,
        employeeMedicare:taxes.employeeMedicare,
        employerSS:      taxes.employerSS,
        employerMedicare:taxes.employerMedicare,
        futaTax:         taxes.futaTax  || 0,
        sutaTax:         taxes.sutaTax  || 0,
        netPay:          taxes.netPay,
        totalDeposit:    taxes.totalDeposit,
        ytdGross:        ytdData?.ytd_gross || 0,
        lineItems,
      };

      setRunEntries(prev => {
        const filtered = prev.filter(r => r.empId !== emp.id);
        return [...filtered, entry];
      });
      setSelected(prev => { const s = new Set(prev); s.add(emp.id); return s; });
      setExpandedId(null);
    } catch (e) { alert(e.message); }
    finally { setCalculating(null); }
  }

  function removeFromRun(empId) {
    setRunEntries(prev => prev.filter(r => r.empId !== empId));
    setSelected(prev => { const s = new Set(prev); s.delete(empId); return s; });
  }

  function toggleSelect(empId) { setSelected(prev => { const s = new Set(prev); s.has(empId) ? s.delete(empId) : s.add(empId); return s; }); }
  function toggleAll(checked) { setSelected(checked ? new Set(runEntries.map(r => r.empId)) : new Set()); }

  async function handleStartPayroll() {
    const toRun = runEntries.filter(r => selected.has(r.empId));
    if (!toRun.length) return;
    if (!payPeriodStart || !payPeriodEnd) { alert('Set pay period dates.'); return; }
    setRunning(true);
    try {
      const result = await api.runPayroll({
        clientId,
        payPeriodStart,
        payPeriodEnd,
        settlementDate: settlementDate || null,
        employees: toRun.map(r => ({ employeeId: r.empId, skip: false, ytdGross: r.ytdGross, lineItems: r.lineItems })),
      });
      setRunResult(result);
    } catch (e) { alert(e.message); }
    finally { setRunning(false); }
  }

  if (runResult) {
    const totals = runResult.paystubs.reduce((a, p) => ({ gross: a.gross + p.grossWages, net: a.net + p.netPay, dep: a.dep + p.totalDeposit }), { gross: 0, net: 0, dep: 0 });
    return (
      <div>
        <div className="alert alert-success" style={{ marginBottom: 20 }}>
          <span>✓</span>
          <div><strong>{runResult.count} paychecks created</strong> for {payPeriodStart} – {payPeriodEnd}</div>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <table className="schedule-table">
            <thead><tr><th>Employee</th><th>Check #</th><th className="num">Gross</th><th className="num">Net Pay</th><th className="num">941 Deposit</th></tr></thead>
            <tbody>
              {runResult.paystubs.map(p => (
                <tr key={p.id}>
                  <td className="emp-cell">{p.employeeName}</td>
                  <td className="accent" style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>#{p.checkNumber}</td>
                  <td className="num">{fmt(p.grossWages)}</td>
                  <td className="num" style={{ color: 'var(--success)', fontWeight: 600 }}>{fmt(p.netPay)}</td>
                  <td className="num accent">{fmt(p.totalDeposit)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={2}>Totals</td>
                <td className="num">{fmt(totals.gross)}</td>
                <td className="num">{fmt(totals.net)}</td>
                <td className="num">{fmt(totals.dep)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button className="btn btn-secondary" onClick={() => { setRunResult(null); setRunEntries([]); setSelected(new Set()); }}>
          Run Another Payroll
        </button>
      </div>
    );
  }

  const allChecked = runEntries.length > 0 && runEntries.every(r => selected.has(r.empId));
  const totalGross = runEntries.filter(r => selected.has(r.empId)).reduce((s, r) => s + r.grossWages, 0);

  return (
    <div>
      {/* Pay period */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header" style={{ marginBottom: 12 }}><span className="card-title">Pay Period</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, maxWidth: 560 }}>
          {[['Pay Period Start', payPeriodStart, setStart], ['Pay Period End', payPeriodEnd, setEnd], ['Settlement Date', settlementDate, setSettle]].map(([label, val, setter]) => (
            <div key={label} className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">{label}</label>
              <input className="form-input" type="date" value={val} onChange={e => setter(e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {/* Employee accordion */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">Employees</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click to expand pay entry</span>
        </div>
        {activeEmps.length === 0 ? (
          <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No active employees.</div>
        ) : activeEmps.map(emp => {
          const isOpen   = expandedId === emp.id;
          const inRun    = runEntries.some(r => r.empId === emp.id);
          const isSalary = emp.payType === 'salary';
          const inp      = inputs[emp.id] || {};
          const gross    = getGross(emp.id);

          return (
            <div key={emp.id} className="acc-row">
              <div className={`acc-header${isOpen ? ' open' : ''}`} onClick={() => setExpandedId(isOpen ? null : emp.id)}>
                <span className={`acc-chevron${isOpen ? ' open' : ''}`}>▶</span>
                <div className="emp-avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(`${emp.firstName} ${emp.lastName}`)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{emp.firstName} {emp.lastName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isSalary ? 'Salary' : 'Hourly'} · {emp.payFrequency}</div>
                </div>
                {inRun && <span className="badge badge-success">In run</span>}
                {gross > 0 && !inRun && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{fmt(gross)}</span>}
              </div>
              {isOpen && (
                <div className="acc-panel">
                  <div style={{ display: 'grid', gridTemplateColumns: isSalary ? '1fr 1fr' : '100px 120px 140px 1fr', gap: 14, alignItems: 'end', marginBottom: 14 }}>
                    {!isSalary && (
                      <>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Hours</label>
                          <input className="form-input mono" type="number" min="0" step="0.25" placeholder="0" value={inp.hours} onChange={e => updateInput(emp.id, 'hours', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Rate ($/hr)</label>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>$</span>
                            <input className="form-input mono" type="number" min="0" step="0.01" value={inp.rate} onChange={e => updateInput(emp.id, 'rate', e.target.value)} style={{ paddingLeft: 20 }} />
                          </div>
                        </div>
                      </>
                    )}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">{isSalary ? 'This Period Amount' : 'Gross Pay'}</label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>$</span>
                        <input className="form-input mono" type="number" min="0" step="0.01" value={inp.amount} onChange={e => updateInput(emp.id, 'amount', e.target.value)} style={{ paddingLeft: 20, fontWeight: 600 }} />
                      </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Additional Pay</label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>$</span>
                        <input className="form-input mono" type="number" min="0" step="0.01" placeholder="0" value={inp.extraAmount} onChange={e => updateInput(emp.id, 'extraAmount', e.target.value)} style={{ paddingLeft: 20 }} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => addToRun(emp)}
                      disabled={calculating === emp.id || gross <= 0}
                    >
                      {calculating === emp.id ? <span className="spinner" /> : inRun ? 'Update in Run' : 'Add to Payroll Run'}
                    </button>
                    {inRun && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--error)' }} onClick={() => removeFromRun(emp.id)}>Remove</button>}
                    {gross > 0 && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Gross: {fmt(gross)}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Schedule table */}
      {runEntries.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="card-title">Payroll Run — {runEntries.length} employee{runEntries.length !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {selected.size > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total gross: <strong style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>{fmt(totalGross)}</strong></span>}
              <button
                className="btn btn-primary"
                onClick={handleStartPayroll}
                disabled={selected.size === 0 || running}
              >
                {running ? <span className="spinner" /> : `Start Payroll (${selected.size})`}
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="schedule-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                  </th>
                  <th>Employee</th>
                  <th>Type</th>
                  <th className="num">Hours</th>
                  <th className="num">Gross</th>
                  <th className="num">FIT</th>
                  <th className="num">SS</th>
                  <th className="num">Medicare</th>
                  <th className="num">FUTA</th>
                  <th className="num">SUI</th>
                  <th className="num">Net Pay</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {runEntries.map(r => (
                  <tr key={r.empId} style={{ opacity: selected.has(r.empId) ? 1 : 0.45 }}>
                    <td><input type="checkbox" checked={selected.has(r.empId)} onChange={() => toggleSelect(r.empId)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} /></td>
                    <td className="emp-cell">{r.empName}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12, textTransform: 'capitalize' }}>{r.payType}</td>
                    <td className="num">{r.hours || '—'}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmt(r.grossWages)}</td>
                    <td className="num">{fmt(r.fitWithholding)}</td>
                    <td className="num">{fmt(r.employeeSS)}</td>
                    <td className="num">{fmt(r.employeeMedicare)}</td>
                    <td className="num">{r.futaTax > 0 ? fmt(r.futaTax) : '—'}</td>
                    <td className="num">{r.sutaTax > 0 ? fmt(r.sutaTax) : '—'}</td>
                    <td className="num" style={{ color: 'var(--success)', fontWeight: 700 }}>{fmt(r.netPay)}</td>
                    <td>
                      <button onClick={() => removeFromRun(r.empId)} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 15, opacity: 0.6 }} title="Remove">×</button>
                    </td>
                  </tr>
                ))}
                {runEntries.length > 1 && (() => {
                  const sel = runEntries.filter(r => selected.has(r.empId));
                  const T = k => sel.reduce((s, r) => s + (r[k] || 0), 0);
                  return (
                    <tr className="total-row">
                      <td colSpan={4}>Totals ({selected.size} selected)</td>
                      <td className="num">{fmt(T('grossWages'))}</td>
                      <td className="num">{fmt(T('fitWithholding'))}</td>
                      <td className="num">{fmt(T('employeeSS'))}</td>
                      <td className="num">{fmt(T('employeeMedicare'))}</td>
                      <td className="num">{fmt(T('futaTax'))}</td>
                      <td className="num">{fmt(T('sutaTax'))}</td>
                      <td className="num">{fmt(T('netPay'))}</td>
                      <td></td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pay Liabilities Sub-tab ───────────────────────────────────────────────────
function PayLiabilitiesTab({ clientId }) {
  const [paystubs, setPaystubs]       = useState([]);
  const [loading,  setLoading]        = useState(true);
  const [selected, setSelected]       = useState(new Set());
  const [submitting, setSubmitting]   = useState(null); // '941' | '940' | null
  const [result,   setResult]         = useState(null);

  useEffect(() => {
    api.getPaystubs(clientId).then(stubs => {
      setPaystubs(stubs);
      const pending = stubs.filter(s => s.status === 'pending' || s.status === 'failed' || s.status_940 === 'pending' || s.status_940 === 'failed');
      setSelected(new Set(pending.map(s => s.id)));
    }).finally(() => setLoading(false));
  }, [clientId]);

  const pending941 = paystubs.filter(s => s.status === 'pending' || s.status === 'failed');
  const pending940 = paystubs.filter(s => (s.status_940 === 'pending' || s.status_940 === 'failed') && s.futa_tax > 0);

  const sel941 = pending941.filter(s => selected.has(s.id));
  const sel940 = pending940.filter(s => selected.has(s.id));
  const total941 = sel941.reduce((s, p) => s + p.total_deposit, 0);
  const total940 = sel940.reduce((s, p) => s + p.futa_tax, 0);

  function toggleSel(id) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); }

  async function handleSubmit(taxType) {
    const ids = (taxType === '941' ? sel941 : sel940).map(s => s.id);
    if (!ids.length) return;
    if (!window.confirm(`Submit ${taxType} (${fmt(taxType === '941' ? total941 : total940)}) to EFTPS?`)) return;
    setSubmitting(taxType); setResult(null);
    try {
      const res = await api.batchSubmitPaystubs({ clientId, paystubIds: ids, taxType });
      setResult(res);
      const updated = await api.getPaystubs(clientId);
      setPaystubs(updated);
    } catch (e) { setResult({ error: e.message }); }
    finally { setSubmitting(null); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 28, height: 28 }} /></div>;

  const allPending = [...pending941, ...pending940.filter(s => !pending941.find(p => p.id === s.id))];

  return (
    <div>
      {/* Tally */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Federal 941', desc: 'FIT + SS + Medicare', amount: total941, count: sel941.length },
          { label: 'Federal 940 (FUTA)', desc: 'Federal Unemployment', amount: total940, count: sel940.length },
          { label: 'State SUI', desc: 'Not via EFTPS — file with state', amount: paystubs.filter(s => selected.has(s.id)).reduce((s, p) => s + (p.suta_tax || 0), 0), count: null },
        ].map(({ label, desc, amount, count }) => (
          <div key={label} className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: amount > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{fmt(amount)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{count !== null ? `${count} paystub${count !== 1 ? 's' : ''} selected` : desc}</div>
          </div>
        ))}
      </div>

      {result && (
        <div className={`alert ${result.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 16 }}>
          <span>{result.error ? '⚠' : '✓'}</span>
          <span>{result.error ? result.error : `Submitted ${result.submitted} paystub${result.submitted !== 1 ? 's' : ''} — ${fmt(result.totalDeposit)}${result.confirmation ? ` · Conf: ${result.confirmation}` : ''}`}</span>
          <button onClick={() => setResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button>
        </div>
      )}

      {/* Submit buttons */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {sel941.length > 0 && (
          <button className="btn btn-primary" onClick={() => handleSubmit('941')} disabled={submitting !== null}>
            {submitting === '941' ? <span className="spinner" /> : `Pay 941 — ${fmt(total941)}`}
          </button>
        )}
        {sel940.length > 0 && (
          <button className="btn btn-secondary" onClick={() => handleSubmit('940')} disabled={submitting !== null}>
            {submitting === '940' ? <span className="spinner" /> : `Pay 940 FUTA — ${fmt(total940)}`}
          </button>
        )}
      </div>

      {allPending.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: '32px 20px' }}>
            <div className="empty-state-icon">✓</div>
            <h3>All caught up</h3>
            <p>No pending tax liabilities to submit.</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox"
              checked={allPending.every(s => selected.has(s.id))}
              onChange={e => setSelected(e.target.checked ? new Set(allPending.map(s => s.id)) : new Set())}
              style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>SELECT ALL</span>
          </div>
          {allPending.map(stub => {
            const is941Pending = stub.status === 'pending' || stub.status === 'failed';
            const is940Pending = (stub.status_940 === 'pending' || stub.status_940 === 'failed') && stub.futa_tax > 0;
            return (
              <div key={stub.id} className="liab-row">
                <input type="checkbox" checked={selected.has(stub.id)} onChange={() => toggleSel(stub.id)} style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                    {stub.employee_name || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {stub.pay_period_start} – {stub.pay_period_end}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {is941Pending && <span className="badge badge-warning">941: {fmt(stub.total_deposit)}</span>}
                  {is940Pending && <span className="badge badge-accent">940: {fmt(stub.futa_tax)}</span>}
                  {stub.suta_tax > 0 && <span className="badge badge-neutral">SUI: {fmt(stub.suta_tax)}</span>}
                </div>
                <Link to={`/clients/${clientId}/paystubs/${stub.id}/edit`} className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>Edit</Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── File Forms Sub-tab ────────────────────────────────────────────────────────
function FileFormsTab({ clientId }) {
  const navigate = useNavigate();
  const currentYear  = new Date().getFullYear();
  const currentQ     = Math.ceil((new Date().getMonth() + 1) / 3);
  const [year, setYear] = useState(currentYear);

  const quarters = [1, 2, 3, 4];
  const qDue = { 1: 'Apr 30', 2: 'Jul 31', 3: 'Oct 31', 4: 'Jan 31' };

  function openReport(path) { navigate(path); }

  const forms = [
    ...quarters.map(q => ({
      id: `941-${year}-q${q}`,
      name: `Form 941 — Q${q} ${year}`,
      desc: 'Federal Payroll Tax Return (FIT + SS + Medicare)',
      due: `${qDue[q]}, ${q === 4 ? year + 1 : year}`,
      isPast: q < currentQ || year < currentYear,
      action: () => navigate(`/reports?clientId=${clientId}&form=941&year=${year}&quarter=${q}`),
    })),
    {
      id: `940-${year}`,
      name: `Form 940 — ${year}`,
      desc: 'Federal Unemployment Tax Return (FUTA)',
      due: `Jan 31, ${year + 1}`,
      isPast: year < currentYear,
      action: () => navigate(`/reports?clientId=${clientId}&form=940&year=${year}`),
    },
    {
      id: `w2-${year}`,
      name: `W-2 — ${year}`,
      desc: 'Wage and Tax Statement (per employee)',
      due: `Jan 31, ${year + 1}`,
      isPast: year < currentYear,
      action: () => navigate(`/reports?clientId=${clientId}&form=w2&year=${year}`),
    },
    {
      id: `w3-${year}`,
      name: `W-3 — ${year}`,
      desc: 'Transmittal of Wage and Tax Statements',
      due: `Jan 31, ${year + 1}`,
      isPast: year < currentYear,
      action: () => navigate(`/reports?clientId=${clientId}&form=w3&year=${year}`),
    },
    {
      id: `twc-${year}`,
      name: `State WC — ${year}`,
      desc: 'State Workforce Commission (SUI quarterly reports)',
      due: 'Quarterly',
      isPast: year < currentYear,
      action: () => navigate(`/reports?clientId=${clientId}&form=twc&year=${year}`),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Tax Year</span>
        <select className="form-select" value={year} onChange={e => setYear(parseInt(e.target.value))} style={{ width: 120 }}>
          {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/reports')}>Open Reports Page</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {forms.map(f => (
          <div key={f.id} className="form-file-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{f.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{f.desc}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Due {f.due}</div>
            <button className="btn btn-secondary btn-sm" onClick={f.action}>Generate / View</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Payments Tab ──────────────────────────────────────────────────────────────
function PaymentsTab({ clientId, client, employees }) {
  const [sub, setSub] = useState('pay');
  return (
    <div>
      <div className="pay-subtabs">
        {[['pay', 'Pay Employees'], ['liabilities', 'Pay Liabilities'], ['forms', 'File Forms']].map(([k, label]) => (
          <button key={k} className={`pay-subtab${sub === k ? ' active' : ''}`} onClick={() => setSub(k)}>{label}</button>
        ))}
      </div>
      {sub === 'pay'         && <PayEmployeesTab clientId={clientId} client={client} employees={employees} />}
      {sub === 'liabilities' && <PayLiabilitiesTab clientId={clientId} />}
      {sub === 'forms'       && <FileFormsTab clientId={clientId} />}
    </div>
  );
}

// ── Main Workspace ────────────────────────────────────────────────────────────
export default function CompanyWorkspace() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [client,    setClient]    = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState(location.state?.tab || 'employees');

  useEffect(() => { loadAll(); }, [id]);

  async function loadAll() {
    try {
      const [c, emps] = await Promise.all([api.getClient(id), api.getEmployees(id)]);
      setClient(c);
      setEmployees(emps);
    } catch (e) {
      alert(e.message);
      navigate('/');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 60 }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36 }} />
    </div>
  );

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-title-row">
          <Link to="/" className="workspace-back">← All Companies</Link>
          <div>
            <div className="workspace-name">{client?.businessName}</div>
          </div>
          <span className="workspace-ein">EIN {client?.ein}</span>
          <div style={{ flex: 1 }} />
          <Link to={`/clients/${id}/edit`} className="btn btn-secondary btn-sm">Edit Company</Link>
        </div>

        <div className="ws-tabs">
          {[['employees', 'Employees'], ['company', 'Company'], ['payments', 'Payments']].map(([k, label]) => (
            <button key={k} className={`ws-tab${activeTab === k ? ' active' : ''}`} onClick={() => setActiveTab(k)}>
              {label}
              {k === 'employees' && employees.length > 0 && (
                <span style={{ marginLeft: 6, background: activeTab === k ? 'var(--accent)' : 'var(--bg-tertiary)', color: activeTab === k ? '#fff' : 'var(--text-muted)', borderRadius: 20, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>
                  {employees.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="workspace-body">
        {activeTab === 'employees' && (
          <EmployeesTab clientId={id} employees={employees} onRefresh={loadAll} />
        )}
        {activeTab === 'company' && (
          <CompanyTab client={client} onSaved={loadAll} />
        )}
        {activeTab === 'payments' && (
          <PaymentsTab clientId={id} client={client} employees={employees} />
        )}
      </div>
    </div>
  );
}
