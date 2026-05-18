'use strict';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function r2(n) { return Math.round((n || 0) * 100) / 100; }
function initials(name) { return name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'; }
const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
const FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Bi-weekly', semimonthly: 'Semi-monthly', monthly: 'Monthly' };

// ── Pay Period Calculation ────────────────────────────────────────────────────
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function advancePeriod(s, e, freq) {
  if (freq === 'weekly')      return [addDays(s, 7),  addDays(e, 7)];
  if (freq === 'biweekly')    return [addDays(s, 14), addDays(e, 14)];
  if (freq === 'monthly') {
    const ns = new Date(s.getFullYear(), s.getMonth() + 1, s.getDate());
    const ne = new Date(e.getFullYear(), e.getMonth() + 1, e.getDate());
    return [ns, ne];
  }
  if (freq === 'semimonthly') {
    const ns = addDays(e, 1);
    const d = ns.getDate();
    let ne;
    if (d === 1)  { ne = new Date(ns.getFullYear(), ns.getMonth(), 15); }
    else          { ne = new Date(ns.getFullYear(), ns.getMonth() + 1, 0); }
    return [ns, ne];
  }
  return [addDays(s, 14), addDays(e, 14)];
}

function calcUpcomingPeriods(firstStart, firstEnd, freq, count = 14) {
  if (!firstStart || !firstEnd) return [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let s = new Date(firstStart + 'T00:00:00');
  let e = new Date(firstEnd   + 'T00:00:00');
  const result = [];
  // advance until we find the first non-expired period or we have history
  while (e < today && result.length < 30) {
    result.push({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), overdue: true });
    [s, e] = advancePeriod(s, e, freq);
  }
  // add future periods
  for (let i = 0; i < count; i++) {
    result.push({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), overdue: false });
    [s, e] = advancePeriod(s, e, freq);
  }
  return result;
}

function getCurrentPeriod(firstStart, firstEnd, freq) {
  if (!firstStart || !firstEnd) return { start: '', end: '' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let s = new Date(firstStart + 'T00:00:00');
  let e = new Date(firstEnd   + 'T00:00:00');
  while (e < today) { [s, e] = advancePeriod(s, e, freq); }
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}

// ── Liability Due Dates ───────────────────────────────────────────────────────
function calc941DueDate(payPeriodEnd, depositSchedule) {
  if (!payPeriodEnd) return null;
  const d = new Date(payPeriodEnd + 'T00:00:00');
  if (depositSchedule === 'semiweekly') {
    // Find next Wednesday or Friday after payPeriodEnd
    const day = d.getDay(); // 0=Sun, 3=Wed, 5=Fri
    let daysToWed = (3 - day + 7) % 7 || 7;
    let daysToFri = (5 - day + 7) % 7 || 7;
    const due = addDays(d, Math.min(daysToWed, daysToFri));
    return due.toISOString().slice(0, 10);
  }
  // Monthly: 15th of next month
  const due = new Date(d.getFullYear(), d.getMonth() + 1, 15);
  return due.toISOString().slice(0, 10);
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00') < today;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.ceil((d - today) / 86400000);
}

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
  const [showPeriods, setShowPeriods] = useState(false);

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
      firstPayPeriodStart: emp.firstPayPeriodStart || '',
      firstPayPeriodEnd:   emp.firstPayPeriodEnd   || '',
    })).catch(e => setErr(e.message));
  }, [empId]);

  function set(field) { return e => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm(f => ({ ...f, [field]: v })); }; }

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      const payload = { clientId, ...form,
        step3Children: parseInt(form.step3Children || 0), step3Other: parseInt(form.step3Other || 0),
        step4a: parseFloat(form.step4a || 0), step4b: parseFloat(form.step4b || 0), step4c: parseFloat(form.step4c || 0),
        hourlyRate: parseFloat(form.hourlyRate || 0), annualSalary: parseFloat(form.annualSalary || 0),
        firstPayPeriodStart: form.firstPayPeriodStart || null,
        firstPayPeriodEnd:   form.firstPayPeriodEnd   || null,
      };
      if (!payload.ssn) delete payload.ssn;
      await api.updateEmployee(empId, payload);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const upcomingPeriods = form && form.firstPayPeriodStart && form.firstPayPeriodEnd
    ? calcUpcomingPeriods(form.firstPayPeriodStart, form.firstPayPeriodEnd, form.payFrequency)
    : [];

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
                <input className="form-input mono" type="password" value={form.ssn} onChange={set('ssn')} placeholder="leave blank to keep" maxLength={11} />
                <p className="form-hint">Stored encrypted with AES-256.</p>
              </div>
              <div className="form-group"><label className="form-label">Street Address</label><input className="form-input" value={form.address} onChange={set('address')} placeholder="123 Main St" /></div>
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

              <p className="form-section-title">Pay Period Schedule</p>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">First Pay Period Start</label>
                  <input className="form-input" type="date" value={form.firstPayPeriodStart} onChange={set('firstPayPeriodStart')} />
                </div>
                <div className="form-group">
                  <label className="form-label">First Pay Period End</label>
                  <input className="form-input" type="date" value={form.firstPayPeriodEnd} onChange={set('firstPayPeriodEnd')} />
                </div>
              </div>
              {upcomingPeriods.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <button className="btn btn-ghost btn-sm" style={{ marginBottom: 8, padding: '4px 0', fontSize: 12, color: 'var(--accent)' }} onClick={() => setShowPeriods(p => !p)}>
                    {showPeriods ? '▲ Hide' : '▼ Show'} pay periods ({upcomingPeriods.length})
                  </button>
                  {showPeriods && (
                    <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
                      {upcomingPeriods.map((p, i) => (
                        <div key={i} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '6px 12px', borderBottom: '1px solid var(--border)',
                          background: p.overdue ? '#fef2f2' : i % 2 === 0 ? '#fff' : 'var(--bg-secondary)',
                        }}>
                          <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: p.overdue ? '#dc2626' : 'var(--text-primary)' }}>
                            {fmtDate(p.start)} – {fmtDate(p.end)}
                          </span>
                          {p.overdue && <span className="badge badge-error" style={{ fontSize: 10 }}>Overdue</span>}
                        </div>
                      ))}
                    </div>
                  )}
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
            const rate = isSalary ? `${fmt(emp.annualSalary)}/yr` : `${fmt(emp.hourlyRate)}/hr`;
            return (
              <div key={emp.id} className="emp-row" onClick={() => setDrawerEmpId(emp.id)}>
                <div className="emp-avatar">{initials(`${emp.firstName} ${emp.lastName}`)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="emp-name">{emp.firstName} {emp.lastName}</div>
                  <div className="emp-meta">
                    {emp.workState || 'TX'} · {FREQ_LABEL[emp.payFrequency] || emp.payFrequency} · {isSalary ? 'Salary' : 'Hourly'}
                    {emp.firstPayPeriodStart && <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 600 }}>• Schedule set</span>}
                  </div>
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
      businessAddress: client.businessAddress || '',
      businessCity: client.businessCity || '',
      businessZip: client.businessZip || '',
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
        <F label="Street Address"><input className="form-input" value={form.businessAddress} onChange={set('businessAddress')} placeholder="123 Business Ave" /></F>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">City</label><input className="form-input" value={form.businessCity} onChange={set('businessCity')} /></div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">State</label>
            <select className="form-select" value={form.state} onChange={set('state')}>
              {US_STATES.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">ZIP</label><input className="form-input mono" value={form.businessZip} onChange={set('businessZip')} maxLength={10} /></div>
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <F label="941 Deposit Schedule" hint="Monthly: deposit by 15th of following month. Semi-weekly: deposit Wed/Fri following payroll.">
            <select className="form-select" value={form.depositSchedule} onChange={set('depositSchedule')}>
              <option value="monthly">Monthly Depositor</option>
              <option value="semiweekly">Semi-weekly Depositor</option>
            </select>
          </F>
          <F label="SUI Rate (%)" hint="New employer default: 2.7%.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="form-input mono" type="number" min="0" max="20" step="0.01" value={form.sutaRate} onChange={set('sutaRate')} style={{ maxWidth: 120 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>%</span>
            </div>
          </F>
        </div>

        <p className="form-section-title">Payroll Schedule</p>
        <div className="form-grid">
          <F label="Default Payroll Frequency">
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
          <input className="form-input mono" type="password" value={form.batchProviderPin} onChange={set('batchProviderPin')} placeholder="4-digit PIN" maxLength={4} />
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

// ── Run Payroll Modal ─────────────────────────────────────────────────────────
function RunPayrollModal({ entries, payPeriodStart, payPeriodEnd, settlementDate, clientId, onClose, onDone }) {
  const [step, setStep]       = useState('review');   // review | method | processing | done
  const [runResult, setRunResult] = useState(null);
  const [dlLoading, setDlLoading] = useState(false);
  const [err, setErr]         = useState('');

  async function submit(paymentMethod) {
    setStep('processing'); setErr('');
    try {
      const result = await api.runPayroll({
        clientId,
        payPeriodStart,
        payPeriodEnd,
        settlementDate: settlementDate || null,
        paymentMethod,
        employees: entries.map(r => ({
          employeeId:   r.empId,
          ytdGross:     r.ytdGross || 0,
          lineItems:    r.lineItems,
          regularHours: r.regularHours,
          overtimeHours:r.overtimeHours,
          regularPay:   r.regularPay,
          overtimePay:  r.overtimePay,
          bonus:        r.bonus        || 0,
          commission:   r.commission   || 0,
          reimbursement:r.reimbursement|| 0,
          deduction:    r.deduction    || 0,
          garnishment:  r.garnishment  || 0,
        })),
      });
      setRunResult(result);
      setStep(paymentMethod === 'print_check' ? 'print' : 'done');
    } catch (e) { setErr(e.message); setStep('method'); }
  }

  async function handlePrintChecks() {
    if (!runResult) return;
    setDlLoading(true);
    try { await api.downloadRunPdf(runResult.runId, clientId); setStep('done'); }
    catch (e) { setErr(e.message); }
    finally { setDlLoading(false); }
  }

  const totals = entries.reduce((a, r) => ({
    gross: a.gross + (r.grossWages || 0),
    net:   a.net   + (r.netPay    || 0),
    taxes: a.taxes + (r.fitWithholding + r.employeeSS + r.employeeMedicare || 0),
  }), { gross: 0, net: 0, taxes: 0 });

  return (
    <div className="drawer-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 14, width: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
              {step === 'review' ? 'Review Payroll' : step === 'method' ? 'Payment Method' : step === 'processing' ? 'Processing…' : step === 'print' ? 'Print Checks' : 'Payroll Complete'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{fmtDate(payPeriodStart)} – {fmtDate(payPeriodEnd)}</div>
          </div>
          {step !== 'processing' && <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 8px' }}>×</button>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {err && <div className="alert alert-error" style={{ marginBottom: 16 }}><span>⚠</span>{err}</div>}

          {step === 'review' && (
            <>
              <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                <table className="schedule-table">
                  <thead><tr><th>Employee</th><th>Pay Type</th><th className="num">Gross</th><th className="num">Taxes</th><th className="num">Net Pay</th></tr></thead>
                  <tbody>
                    {entries.map(r => (
                      <tr key={r.empId}>
                        <td className="emp-cell">{r.empName}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12, textTransform: 'capitalize' }}>{r.payType}</td>
                        <td className="num">{fmt(r.grossWages)}</td>
                        <td className="num">{fmt((r.fitWithholding || 0) + (r.employeeSS || 0) + (r.employeeMedicare || 0))}</td>
                        <td className="num" style={{ color: 'var(--success)', fontWeight: 700 }}>{fmt(r.netPay)}</td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td colSpan={2}>Totals ({entries.length} employees)</td>
                      <td className="num">{fmt(totals.gross)}</td>
                      <td className="num">{fmt(totals.taxes)}</td>
                      <td className="num">{fmt(totals.net)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={() => setStep('method')}>Continue →</button>
              </div>
            </>
          )}

          {step === 'method' && (
            <div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>How do you want to pay these {entries.length} employee{entries.length !== 1 ? 's' : ''}?</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <button
                  className="card"
                  onClick={() => submit('direct_deposit')}
                  style={{ textAlign: 'left', cursor: 'pointer', border: '2px solid var(--border)', padding: '20px', transition: 'border-color 0.15s' }}
                  onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div style={{ fontSize: 28, marginBottom: 10 }}>🏦</div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Direct Deposit</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Mark as direct deposit pending. Bank transfer integration coming soon.</div>
                </button>
                <button
                  className="card"
                  onClick={() => submit('print_check')}
                  style={{ textAlign: 'left', cursor: 'pointer', border: '2px solid var(--border)', padding: '20px', transition: 'border-color 0.15s' }}
                  onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div style={{ fontSize: 28, marginBottom: 10 }}>🖨️</div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Print Checks</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Generate professional check PDF with pay stubs for all employees.</div>
                </button>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto 16px' }} />
              <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Creating paychecks…</div>
            </div>
          )}

          {step === 'print' && runResult && (
            <div>
              <div className="alert alert-success" style={{ marginBottom: 20 }}>
                <span>✓</span>
                <div><strong>{runResult.count} paychecks created</strong> — check numbers #{runResult.paystubs[0]?.checkNumber} – #{runResult.paystubs[runResult.paystubs.length - 1]?.checkNumber}</div>
              </div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 20, fontSize: 14 }}>Your checks are ready. Download the PDF to print on check stock paper.</p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-primary btn-lg" onClick={handlePrintChecks} disabled={dlLoading}>
                  {dlLoading ? <span className="spinner" /> : 'Download Check PDF'}
                </button>
                <button className="btn btn-secondary" onClick={() => setStep('done')}>Skip Download</button>
              </div>
            </div>
          )}

          {step === 'done' && runResult && (
            <div>
              <div className="alert alert-success" style={{ marginBottom: 20 }}>
                <span>✓</span>
                <div><strong>{runResult.count} paychecks created</strong></div>
              </div>
              <table className="schedule-table">
                <thead><tr><th>Employee</th><th>Check #</th><th className="num">Gross</th><th className="num">Net Pay</th></tr></thead>
                <tbody>
                  {runResult.paystubs.map(p => (
                    <tr key={p.id}>
                      <td className="emp-cell">{p.employeeName}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--accent)' }}>#{p.checkNumber}</td>
                      <td className="num">{fmt(p.grossWages)}</td>
                      <td className="num" style={{ color: 'var(--success)', fontWeight: 700 }}>{fmt(p.netPay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
                {runResult.paystubs[0]?.checkNumber && (
                  <button className="btn btn-secondary" onClick={handlePrintChecks} disabled={dlLoading}>
                    {dlLoading ? <span className="spinner" /> : 'Download Check PDF'}
                  </button>
                )}
                <button className="btn btn-primary" onClick={() => onDone()}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pay Employees Tab (QuickBooks-style) ──────────────────────────────────────
function PayEmployeesTab({ clientId, client, employees }) {
  const currentYear = new Date().getFullYear();
  const activeEmps  = employees.filter(e => e.isActive !== false);

  // Frequency groups that have active employees
  const freqGroups = [...new Set(activeEmps.map(e => e.payFrequency || 'biweekly'))].sort();
  const [freqGroup, setFreqGroup] = useState(freqGroups[0] || 'biweekly');

  const empsInGroup = activeEmps.filter(e => (e.payFrequency || 'biweekly') === freqGroup);

  // Calculate current pay period for this frequency group
  function getDefaultPeriod() {
    const anchor = empsInGroup.find(e => e.firstPayPeriodStart && e.firstPayPeriodEnd);
    if (anchor) {
      return getCurrentPeriod(anchor.firstPayPeriodStart, anchor.firstPayPeriodEnd, freqGroup);
    }
    // Fallback: calculate from today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (freqGroup === 'weekly') {
      const monday = new Date(today); monday.setDate(today.getDate() - today.getDay() + 1);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
    }
    if (freqGroup === 'semimonthly') {
      const d = today.getDate();
      if (d <= 15) return { start: `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`, end: `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-15` };
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start: `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-16`, end: lastDay.toISOString().slice(0, 10) };
    }
    if (freqGroup === 'monthly') {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
    }
    // biweekly default
    const defEnd   = new Date(today); defEnd.setDate(today.getDate() - 1);
    const defStart = new Date(defEnd); defStart.setDate(defEnd.getDate() - 13);
    return { start: defStart.toISOString().slice(0, 10), end: defEnd.toISOString().slice(0, 10) };
  }

  const [periodStart,    setPeriodStart]    = useState('');
  const [periodEnd,      setPeriodEnd]      = useState('');
  const [settlementDate, setSettlementDate] = useState('');

  // Reset period when freq group changes
  useEffect(() => {
    const p = getDefaultPeriod();
    setPeriodStart(p.start);
    setPeriodEnd(p.end);
  }, [freqGroup, employees]);

  // Per-employee state: { regHours, otHours, regRate, otEnabled, bonus, commission, reimbursement, deduction, garnishment, taxCalc, calcLoading }
  const [empState, setEmpState]   = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [selected, setSelected]   = useState(new Set());
  const [showModal, setShowModal] = useState(false);

  const calcTimers = useRef({});

  // Initialize emp state when employees change
  useEffect(() => {
    setEmpState(prev => {
      const next = { ...prev };
      empsInGroup.forEach(emp => {
        if (!next[emp.id]) {
          const ppy = PERIODS_PER_YEAR[emp.payFrequency] || 26;
          const salaryAmt = emp.payType === 'salary' ? r2((emp.annualSalary || 0) / ppy) : 0;
          next[emp.id] = {
            regHours: '', otHours: '', regRate: String(emp.hourlyRate || ''), otEnabled: true,
            salaryAmt: String(salaryAmt),
            bonus: '', commission: '', reimbursement: '', deduction: '', garnishment: '',
            taxCalc: null, calcLoading: false,
          };
        }
      });
      return next;
    });
  }, [freqGroup, employees]);

  function getEmpData(empId) { return empState[empId] || {}; }

  function updateEmpField(empId, field, value) {
    setEmpState(prev => {
      const cur = prev[empId] || {};
      const updated = { ...cur, [field]: value };
      // Recalculate gross fields locally
      return { ...prev, [empId]: updated };
    });
    // Debounce tax calculation if employee is expanded
    if (expandedId === empId) {
      clearTimeout(calcTimers.current[empId]);
      calcTimers.current[empId] = setTimeout(() => calcTaxes(empId), 600);
    }
  }

  function getEmpGross(empId) {
    const emp  = empsInGroup.find(e => e.id === empId);
    const data = getEmpData(empId);
    if (!emp) return 0;
    if (emp.payType === 'salary') {
      return r2(parseFloat(data.salaryAmt || 0) + parseFloat(data.bonus || 0) + parseFloat(data.commission || 0));
    }
    const regH = parseFloat(data.regHours || 0);
    const otH  = data.otEnabled ? parseFloat(data.otHours || 0) : 0;
    const rate  = parseFloat(data.regRate || emp.hourlyRate || 0);
    const regPay = r2(regH * rate);
    const otPay  = r2(otH * rate * 1.5);
    return r2(regPay + otPay + parseFloat(data.bonus || 0) + parseFloat(data.commission || 0));
  }

  function getEmpRegularHours(empId) {
    const emp  = empsInGroup.find(e => e.id === empId);
    const data = getEmpData(empId);
    if (emp?.payType === 'salary') return null;
    const regH = parseFloat(data.regHours || 0);
    return Math.min(regH, 40);
  }

  function getEmpOvertimeHours(empId) {
    const emp  = empsInGroup.find(e => e.id === empId);
    const data = getEmpData(empId);
    if (emp?.payType === 'salary') return null;
    if (!data.otEnabled) return 0;
    const otH = parseFloat(data.otHours || 0);
    const regH = parseFloat(data.regHours || 0);
    // Also count hours over 40 from reg hours
    return r2(otH + Math.max(0, regH - 40));
  }

  async function calcTaxes(empId) {
    const emp   = empsInGroup.find(e => e.id === empId);
    const data  = getEmpData(empId);
    const gross = getEmpGross(empId);
    if (!emp || gross <= 0) return;

    setEmpState(prev => ({ ...prev, [empId]: { ...prev[empId], calcLoading: true } }));
    try {
      const ytdData = await api.getEmployeeYTD(empId, currentYear).catch(() => ({ ytd_gross: 0 }));
      const taxes   = await api.calculate({
        grossWages:    gross,
        payFrequency:  emp.payFrequency || 'biweekly',
        filingStatus:  emp.filingStatus || 'single',
        step2Checkbox: !!emp.step2Checkbox,
        step3Children: emp.step3Children || 0,
        step3Other:    emp.step3Other    || 0,
        step4a: 0, step4b: 0, step4c: 0,
        workState: emp.workState || client?.state || 'TX',
        ytdGross:  ytdData?.ytd_gross || 0,
        sutaRate:  client?.sutaRate || null,
      });
      setEmpState(prev => ({ ...prev, [empId]: { ...prev[empId], taxCalc: { ...taxes, ytdGross: ytdData?.ytd_gross || 0 }, calcLoading: false } }));
    } catch {
      setEmpState(prev => ({ ...prev, [empId]: { ...prev[empId], calcLoading: false } }));
    }
  }

  function handleExpand(empId) {
    const isOpen = expandedId === empId;
    setExpandedId(isOpen ? null : empId);
    if (!isOpen) calcTaxes(empId);
  }

  function buildEntries() {
    return empsInGroup
      .filter(emp => selected.has(emp.id))
      .map(emp => {
        const data  = getEmpData(emp.id);
        const tc    = data.taxCalc || {};
        const gross = getEmpGross(emp.id);
        const rate  = parseFloat(data.regRate || emp.hourlyRate || 0);
        const regH  = parseFloat(data.regHours || 0);
        const otH   = data.otEnabled ? parseFloat(data.otHours || 0) : 0;
        const regPay = emp.payType === 'salary' ? parseFloat(data.salaryAmt || 0) : r2(Math.min(regH, 40) * rate);
        const otPay  = emp.payType === 'salary' ? 0 : r2(otH * rate * 1.5);

        const lineItems = [];
        if (emp.payType === 'salary') {
          lineItems.push({ payType: 'salary', description: 'Salary', hours: null, rate: null, amount: parseFloat(data.salaryAmt || 0) });
        } else {
          if (regPay > 0) lineItems.push({ payType: 'regular', description: 'Regular', hours: Math.min(regH, 40), rate, amount: regPay });
          if (otPay > 0)  lineItems.push({ payType: 'overtime', description: 'Overtime', hours: otH, rate: r2(rate * 1.5), amount: otPay });
        }
        if (parseFloat(data.bonus       || 0) > 0) lineItems.push({ payType: 'bonus',       description: 'Bonus',       amount: parseFloat(data.bonus) });
        if (parseFloat(data.commission  || 0) > 0) lineItems.push({ payType: 'commission',  description: 'Commission',  amount: parseFloat(data.commission) });
        if (parseFloat(data.reimbursement||0) > 0) lineItems.push({ payType: 'reimbursement',description: 'Reimbursement', amount: parseFloat(data.reimbursement) });

        return {
          empId:          emp.id,
          empName:        `${emp.firstName} ${emp.lastName}`,
          payType:        emp.payType,
          regularHours:   emp.payType === 'salary' ? null : Math.min(regH, 40),
          overtimeHours:  emp.payType === 'salary' ? null : otH,
          regularPay:     regPay,
          overtimePay:    otPay,
          bonus:          parseFloat(data.bonus        || 0),
          commission:     parseFloat(data.commission   || 0),
          reimbursement:  parseFloat(data.reimbursement|| 0),
          deduction:      parseFloat(data.deduction    || 0),
          garnishment:    parseFloat(data.garnishment  || 0),
          grossWages:     tc.grossWages   || gross,
          fitWithholding: tc.fitWithholding || 0,
          employeeSS:     tc.employeeSS    || 0,
          employeeMedicare:tc.employeeMedicare || 0,
          employerSS:     tc.employerSS    || 0,
          employerMedicare:tc.employerMedicare || 0,
          futaTax:        tc.futaTax  || 0,
          sutaTax:        tc.sutaTax  || 0,
          netPay:         tc.netPay   || gross,
          ytdGross:       tc.ytdGross || 0,
          lineItems,
        };
      });
  }

  function toggleSelect(empId) {
    setSelected(prev => { const s = new Set(prev); s.has(empId) ? s.delete(empId) : s.add(empId); return s; });
  }
  function toggleAll(checked) {
    setSelected(checked ? new Set(empsInGroup.map(e => e.id)) : new Set());
  }

  const allChecked = empsInGroup.length > 0 && empsInGroup.every(e => selected.has(e.id));
  const totalGross = empsInGroup.filter(e => selected.has(e.id)).reduce((s, e) => s + getEmpGross(e.id), 0);

  if (activeEmps.length === 0) return (
    <div className="card">
      <div className="empty-state" style={{ padding: '32px 20px' }}>
        <div className="empty-state-icon">👤</div>
        <h3>No active employees</h3>
        <p>Add employees before running payroll.</p>
      </div>
    </div>
  );

  const MoneyInput = ({ value, onChange, placeholder = '0.00' }) => (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12 }}>$</span>
      <input className="form-input mono" type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={{ paddingLeft: 20, width: 100, height: 32, fontSize: 13 }} />
    </div>
  );

  return (
    <div>
      {/* Frequency tabs */}
      {freqGroups.length > 1 && (
        <div className="pay-subtabs" style={{ marginBottom: 16 }}>
          {freqGroups.map(f => (
            <button key={f} className={`pay-subtab${freqGroup === f ? ' active' : ''}`} onClick={() => { setFreqGroup(f); setSelected(new Set()); }}>
              {FREQ_LABEL[f] || f}
              <span style={{ marginLeft: 6, opacity: 0.7, fontSize: 11 }}>({activeEmps.filter(e => (e.payFrequency || 'biweekly') === f).length})</span>
            </button>
          ))}
        </div>
      )}

      {/* Pay period header */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span className="card-title" style={{ fontWeight: 700, fontSize: 13 }}>{FREQ_LABEL[freqGroup]} Pay Run</span>
          {[['Period Start', periodStart, setPeriodStart], ['Period End', periodEnd, setPeriodEnd], ['Settlement Date', settlementDate, setSettlementDate]].map(([label, val, setter]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</label>
              <input className="form-input" type="date" value={val} onChange={e => setter(e.target.value)} style={{ width: 145, height: 32, fontSize: 13 }} />
            </div>
          ))}
          <div style={{ flex: 1 }} />
          {selected.size > 0 && (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Total gross: <strong style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>{fmt(totalGross)}</strong>
            </span>
          )}
          <button className="btn btn-primary" disabled={selected.size === 0} onClick={() => setShowModal(true)}>
            Run Payroll ({selected.size})
          </button>
        </div>
      </div>

      {/* QuickBooks-style table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="schedule-table" style={{ tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                </th>
                <th>Employee</th>
                <th style={{ width: 80 }}>Pay Type</th>
                <th className="num" style={{ width: 100 }}>Reg Hours</th>
                <th className="num" style={{ width: 100 }}>OT Hours</th>
                <th className="num" style={{ width: 110 }}>Reg Pay</th>
                <th className="num" style={{ width: 110 }}>OT Pay</th>
                <th className="num" style={{ width: 120 }}>Gross</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {empsInGroup.map(emp => {
                const data    = getEmpData(emp.id);
                const isOpen  = expandedId === emp.id;
                const isSalary= emp.payType === 'salary';
                const rate    = parseFloat(data.regRate || emp.hourlyRate || 0);
                const regH    = parseFloat(data.regHours || 0);
                const otH     = data.otEnabled ? parseFloat(data.otHours || 0) : 0;
                const effRegH = Math.min(regH, 40);
                const extraOT = Math.max(0, regH - 40); // hours over 40 from reg hours field
                const regPay  = isSalary ? parseFloat(data.salaryAmt || 0) : r2(effRegH * rate);
                const otPay   = isSalary ? 0 : r2((otH + extraOT) * rate * 1.5);
                const gross   = getEmpGross(emp.id);
                const tc      = data.taxCalc;

                return [
                  // Main row
                  <tr key={emp.id} style={{ background: isOpen ? 'var(--accent-light)' : undefined }}>
                    <td>
                      <input type="checkbox" checked={selected.has(emp.id)} onChange={() => toggleSelect(emp.id)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="emp-avatar" style={{ width: 28, height: 28, fontSize: 10, flexShrink: 0 }}>{initials(`${emp.firstName} ${emp.lastName}`)}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.firstName} {emp.lastName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.workState || client?.state || 'TX'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${isSalary ? 'badge-accent' : 'badge-neutral'}`} style={{ fontSize: 11, textTransform: 'capitalize' }}>
                        {isSalary ? 'Salary' : 'Hourly'}
                      </span>
                    </td>
                    {/* Reg Hours */}
                    <td className="num">
                      {isSalary ? <span style={{ color: 'var(--text-muted)' }}>—</span> : (
                        <input className="form-input mono" type="number" min="0" step="0.25" value={data.regHours} onChange={e => updateEmpField(emp.id, 'regHours', e.target.value)}
                          style={{ width: 80, height: 30, textAlign: 'right', fontSize: 13 }} placeholder="0" />
                      )}
                    </td>
                    {/* OT Hours */}
                    <td className="num">
                      {isSalary ? <span style={{ color: 'var(--text-muted)' }}>—</span> : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                          <input className="form-input mono" type="number" min="0" step="0.25" value={data.otHours} onChange={e => updateEmpField(emp.id, 'otHours', e.target.value)}
                            style={{ width: 64, height: 30, textAlign: 'right', fontSize: 13 }} placeholder="0" disabled={!data.otEnabled} />
                          <button
                            title={data.otEnabled ? 'Overtime enabled (1.5×)' : 'Overtime disabled'}
                            onClick={() => updateEmpField(emp.id, 'otEnabled', !data.otEnabled)}
                            style={{ background: data.otEnabled ? 'var(--accent-light)' : 'var(--bg-secondary)', border: `1px solid ${data.otEnabled ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 4, padding: '2px 5px', cursor: 'pointer', fontSize: 10, color: data.otEnabled ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 700, flexShrink: 0 }}
                          >1.5×</button>
                        </div>
                      )}
                    </td>
                    {/* Reg Pay */}
                    <td className="num">
                      {isSalary ? (
                        <MoneyInput value={data.salaryAmt} onChange={v => updateEmpField(emp.id, 'salaryAmt', v)} />
                      ) : (
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{regPay > 0 ? fmt(regPay) : '—'}</span>
                      )}
                    </td>
                    {/* OT Pay */}
                    <td className="num">
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: otPay > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {isSalary ? '—' : otPay > 0 ? fmt(otPay) : '—'}
                      </span>
                    </td>
                    {/* Gross */}
                    <td className="num" style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: gross > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {gross > 0 ? fmt(gross) : '—'}
                    </td>
                    <td>
                      <button onClick={() => handleExpand(emp.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', padding: '0 4px', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>›</button>
                    </td>
                  </tr>,

                  // Expanded row
                  isOpen && (
                    <tr key={`${emp.id}-exp`}>
                      <td colSpan={9} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                        <div style={{ padding: '16px 20px' }}>
                          {/* Additional pay fields */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
                            {[['bonus', 'Bonus'], ['commission', 'Commission'], ['reimbursement', 'Reimbursement'], ['deduction', 'Deduction'], ['garnishment', 'Garnishment']].map(([field, label]) => (
                              <div key={field} className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: 10 }}>{label}</label>
                                <MoneyInput value={data[field] || ''} onChange={v => updateEmpField(emp.id, field, v)} />
                              </div>
                            ))}
                          </div>
                          {/* Tax breakdown */}
                          {data.calcLoading ? (
                            <div style={{ textAlign: 'center', padding: '12px 0' }}><div className="spinner spinner-dark" style={{ width: 20, height: 20, display: 'inline-block' }} /></div>
                          ) : tc ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Employee Contributions</div>
                                {[['Federal Income Tax', tc.fitWithholding], ['Social Security (6.2%)', tc.employeeSS], ['Medicare (1.45%)', tc.employeeMedicare], ['State Income Tax', tc.stateIncomeTax || 0]].map(([l, v]) => v > 0 && (
                                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                                    <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#dc2626' }}>-{fmt(v)}</span>
                                  </div>
                                ))}
                                {parseFloat(data.deduction  || 0) > 0 && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Deductions</span>
                                    <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#dc2626' }}>-{fmt(parseFloat(data.deduction))}</span>
                                  </div>
                                )}
                                {parseFloat(data.garnishment|| 0) > 0 && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Garnishments</span>
                                    <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#dc2626' }}>-{fmt(parseFloat(data.garnishment))}</span>
                                  </div>
                                )}
                                <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                                  <span>Net Pay</span>
                                  <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--success)', fontSize: 14 }}>
                                    {fmt(r2(tc.netPay + parseFloat(data.reimbursement || 0) - parseFloat(data.deduction || 0) - parseFloat(data.garnishment || 0)))}
                                  </span>
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Employer Contributions</div>
                                {[['Social Security Match (6.2%)', tc.employerSS], ['Medicare Match (1.45%)', tc.employerMedicare], ['FUTA', tc.futaTax || 0], ['SUI', tc.sutaTax || 0]].map(([l, v]) => v > 0 && (
                                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                                    <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>{fmt(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>Enter pay amounts above to see tax breakdown</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                ].filter(Boolean);
              })}

              {/* Totals row */}
              {empsInGroup.length > 0 && selected.size > 0 && (() => {
                const selEmps = empsInGroup.filter(e => selected.has(e.id));
                const tGross = selEmps.reduce((s, e) => s + getEmpGross(e.id), 0);
                const tFIT   = selEmps.reduce((s, e) => s + (getEmpData(e.id).taxCalc?.fitWithholding || 0), 0);
                const tSS    = selEmps.reduce((s, e) => s + (getEmpData(e.id).taxCalc?.employeeSS || 0), 0);
                const tMed   = selEmps.reduce((s, e) => s + (getEmpData(e.id).taxCalc?.employeeMedicare || 0), 0);
                const tNet   = selEmps.reduce((s, e) => s + (getEmpData(e.id).taxCalc?.netPay || getEmpGross(e.id)), 0);
                return (
                  <tr className="total-row">
                    <td colSpan={3}>Totals ({selected.size} of {empsInGroup.length} selected)</td>
                    <td className="num" colSpan={2}></td>
                    <td className="num" colSpan={2} style={{ color: 'var(--text-muted)', fontSize: 12 }}>FIT+SS+Med: {fmt(tFIT + tSS + tMed)}</td>
                    <td className="num">{fmt(tGross)}</td>
                    <td></td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <RunPayrollModal
          entries={buildEntries()}
          payPeriodStart={periodStart}
          payPeriodEnd={periodEnd}
          settlementDate={settlementDate}
          clientId={clientId}
          onClose={() => setShowModal(false)}
          onDone={() => { setShowModal(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}

// ── Pay Liabilities Sub-tab ───────────────────────────────────────────────────
function PayLiabilitiesTab({ clientId, client }) {
  const [paystubs, setPaystubs]     = useState([]);
  const [loading,  setLoading]      = useState(true);
  const [selected, setSelected]     = useState(new Set());
  const [submitting, setSubmitting] = useState(null);
  const [result,   setResult]       = useState(null);

  const depositSchedule = client?.depositSchedule || 'monthly';

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
      {/* Schedule info banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--accent-light)', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>941 Deposit Schedule:</span>
        <span style={{ color: 'var(--text-secondary)' }}>
          {depositSchedule === 'semiweekly' ? 'Semi-weekly Depositor — deposit by Wednesday or Friday following payroll' : 'Monthly Depositor — deposit by 15th of following month'}
        </span>
        <Link to={`/clients/${clientId}`} onClick={() => {}} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--accent)' }}>Change in Company settings</Link>
      </div>

      {/* Tally */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Federal 941', desc: 'FIT + SS + Medicare', amount: total941, count: sel941.length },
          { label: 'Federal 940 (FUTA)', desc: 'Federal Unemployment', amount: total940, count: sel940.length },
          { label: 'State SUI', desc: 'File with state agency', amount: paystubs.filter(s => selected.has(s.id)).reduce((s, p) => s + (p.suta_tax || 0), 0), count: null },
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

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {sel941.length > 0 && (
          <button className="btn btn-primary" onClick={() => handleSubmit('941')} disabled={submitting !== null}>
            {submitting === '941' ? <span className="spinner" /> : `Pay to EFTPS — 941 (${fmt(total941)})`}
          </button>
        )}
        {sel940.length > 0 && (
          <button className="btn btn-secondary" onClick={() => handleSubmit('940')} disabled={submitting !== null}>
            {submitting === '940' ? <span className="spinner" /> : `Pay to EFTPS — 940 FUTA (${fmt(total940)})`}
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
            const due941 = is941Pending ? calc941DueDate(stub.pay_period_end, depositSchedule) : null;
            const over941 = due941 ? isOverdue(due941) : false;
            const days941 = due941 ? daysUntil(due941) : null;
            return (
              <div key={stub.id} className="liab-row" style={{ background: over941 ? '#fef2f2' : undefined }}>
                <input type="checkbox" checked={selected.has(stub.id)} onChange={() => toggleSel(stub.id)} style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: over941 ? '#dc2626' : 'var(--text-primary)' }}>
                    {stub.employee_name || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {stub.pay_period_start} – {stub.pay_period_end}
                    {due941 && (
                      <span style={{ marginLeft: 8, color: over941 ? '#dc2626' : days941 <= 5 ? '#d97706' : 'var(--text-muted)', fontWeight: over941 ? 700 : 400 }}>
                        {over941 ? `941 due ${fmtDate(due941)} (${Math.abs(days941)}d overdue)` : `941 due ${fmtDate(due941)}`}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {is941Pending && <span className={`badge ${over941 ? 'badge-error' : 'badge-warning'}`}>941: {fmt(stub.total_deposit)}</span>}
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
  const navigate    = useNavigate();
  const currentYear = new Date().getFullYear();
  const currentQ    = Math.ceil((new Date().getMonth() + 1) / 3);
  const [year, setYear] = useState(currentYear);

  const qDue = { 1: 'Apr 30', 2: 'Jul 31', 3: 'Oct 31', 4: 'Jan 31' };

  const forms = [
    ...[1,2,3,4].map(q => ({
      id: `941-${year}-q${q}`,
      name: `Form 941 — Q${q} ${year}`,
      desc: 'Federal Payroll Tax Return (FIT + SS + Medicare)',
      due: `${qDue[q]}, ${q === 4 ? year + 1 : year}`,
      status: q < currentQ || year < currentYear ? 'Past' : q === currentQ && year === currentYear ? 'Due' : 'Upcoming',
      action: () => navigate(`/reports?clientId=${clientId}&form=941&year=${year}&quarter=${q}`),
    })),
    { id: `940-${year}`, name: `Form 940 — ${year}`, desc: 'Federal Unemployment Tax Return (FUTA)', due: `Jan 31, ${year + 1}`, status: year < currentYear ? 'Past' : 'Due', action: () => navigate(`/reports?clientId=${clientId}&form=940&year=${year}`) },
    { id: `w2-${year}`,  name: `W-2 — ${year}`,      desc: 'Wage and Tax Statement (one per employee)', due: `Jan 31, ${year + 1}`, status: year < currentYear ? 'Past' : 'Due', action: () => navigate(`/reports?clientId=${clientId}&form=w2&year=${year}`) },
    { id: `w3-${year}`,  name: `W-3 — ${year}`,      desc: 'Transmittal of Wage and Tax Statements', due: `Jan 31, ${year + 1}`, status: year < currentYear ? 'Past' : 'Due', action: () => navigate(`/reports?clientId=${clientId}&form=w3&year=${year}`) },
    { id: `twc-${year}`, name: `State WC — ${year}`,  desc: 'State Workforce Commission (SUI quarterly reports)', due: 'Quarterly', status: 'Due', action: () => navigate(`/reports?clientId=${clientId}&form=twc&year=${year}`) },
  ];

  const statusCls = { Past: 'badge-neutral', Due: 'badge-warning', Upcoming: 'badge-success' };

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
            <span className={`badge ${statusCls[f.status]}`} style={{ flexShrink: 0 }}>{f.status}</span>
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
      {sub === 'liabilities' && <PayLiabilitiesTab clientId={clientId} client={client} />}
      {sub === 'forms'       && <FileFormsTab clientId={clientId} />}
    </div>
  );
}

// ── Main Workspace ────────────────────────────────────────────────────────────
export default function CompanyWorkspace() {
  const { id }       = useParams();
  const location     = useLocation();
  const navigate     = useNavigate();

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
    } catch (e) { alert(e.message); navigate('/'); }
    finally { setLoading(false); }
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
        {activeTab === 'employees' && <EmployeesTab clientId={id} employees={employees} onRefresh={loadAll} />}
        {activeTab === 'company'   && <CompanyTab client={client} onSaved={loadAll} />}
        {activeTab === 'payments'  && <PaymentsTab clientId={id} client={client} employees={employees} />}
      </div>
    </div>
  );
}
