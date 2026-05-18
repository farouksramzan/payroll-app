'use strict';
import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function r2(n) { return Math.round((n || 0) * 100) / 100; }
function initials(name) { return name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'; }
const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
const FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Bi-weekly', semimonthly: 'Semi-monthly', monthly: 'Monthly' };

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(dateStr + 'T00:00:00') - today) / 86400000);
}
function isOverdue(dateStr) { const d = daysUntil(dateStr); return d !== null && d < 0; }

// ── Pay Period Calculation ────────────────────────────────────────────────────
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function advancePeriod(s, e, freq) {
  if (freq === 'weekly')      return [addDays(s, 7),  addDays(e, 7)];
  if (freq === 'biweekly')    return [addDays(s, 14), addDays(e, 14)];
  if (freq === 'monthly')     return [new Date(s.getFullYear(), s.getMonth() + 1, s.getDate()), new Date(e.getFullYear(), e.getMonth() + 1, e.getDate())];
  if (freq === 'semimonthly') {
    const ns = addDays(e, 1);
    const ne = ns.getDate() === 1 ? new Date(ns.getFullYear(), ns.getMonth(), 15) : new Date(ns.getFullYear(), ns.getMonth() + 1, 0);
    return [ns, ne];
  }
  return [addDays(s, 14), addDays(e, 14)];
}

function calcUpcomingPeriods(firstStart, firstEnd, freq, count = 14) {
  if (!firstStart || !firstEnd) return [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let s = new Date(firstStart + 'T00:00:00'), e = new Date(firstEnd + 'T00:00:00');
  const result = [];
  while (e < today && result.length < 30) {
    result.push({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), overdue: true });
    [s, e] = advancePeriod(s, e, freq);
  }
  for (let i = 0; i < count; i++) {
    result.push({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), overdue: false });
    [s, e] = advancePeriod(s, e, freq);
  }
  return result;
}

function getCurrentPeriod(firstStart, firstEnd, freq) {
  if (!firstStart || !firstEnd) return { start: '', end: '' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let s = new Date(firstStart + 'T00:00:00'), e = new Date(firstEnd + 'T00:00:00');
  while (e < today) [s, e] = advancePeriod(s, e, freq);
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
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

// ── Check Status Badge ────────────────────────────────────────────────────────
const STATUS_CFG = {
  draft:                  { label: 'Draft',              cls: 'badge-neutral' },
  printed:                { label: 'Printed',            cls: 'badge-accent' },
  direct_deposit_sent:    { label: 'DD Sent',            cls: 'badge-warning' },
  direct_deposit_cleared: { label: 'DD Cleared',         cls: 'badge-success' },
  voided:                 { label: 'VOIDED',             cls: 'badge-error' },
  late:                   { label: 'Late',               cls: 'badge-error' },
};
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, cls: 'badge-neutral' };
  return <span className={`badge ${cfg.cls}`} style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 10 }}>{cfg.label}</span>;
}

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
                <label className="form-label">Work State</label>
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
                    <input className="form-input mono" type="number" min="0" step="0.01" value={form.hourlyRate} onChange={set('hourlyRate')} style={{ paddingLeft: 24 }} />
                  </div>
                </div>
              ) : (
                <div className="form-group" style={{ maxWidth: 220 }}>
                  <label className="form-label">Annual Salary</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                    <input className="form-input mono" type="number" min="0" step="1000" value={form.annualSalary} onChange={set('annualSalary')} style={{ paddingLeft: 24 }} />
                  </div>
                </div>
              )}

              <p className="form-section-title">Pay Period Schedule</p>
              <div className="form-grid">
                <div className="form-group"><label className="form-label">First Pay Period Start</label><input className="form-input" type="date" value={form.firstPayPeriodStart} onChange={set('firstPayPeriodStart')} /></div>
                <div className="form-group"><label className="form-label">First Pay Period End</label><input className="form-input" type="date" value={form.firstPayPeriodEnd} onChange={set('firstPayPeriodEnd')} /></div>
              </div>
              {upcomingPeriods.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '4px 0', fontSize: 12, color: 'var(--accent)' }} onClick={() => setShowPeriods(p => !p)}>
                    {showPeriods ? '▲ Hide' : '▼ Show'} pay periods
                  </button>
                  {showPeriods && (
                    <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)', marginTop: 6 }}>
                      {upcomingPeriods.map((p, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid var(--border)', background: p.overdue ? '#fef2f2' : i % 2 === 0 ? '#fff' : 'var(--bg-secondary)' }}>
                          <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: p.overdue ? '#dc2626' : 'var(--text-primary)' }}>{fmtDate(p.start)} – {fmtDate(p.end)}</span>
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
              <div className="form-group" style={{ maxWidth: 180 }}><label className="form-label">Hire Date</label><input className="form-input" type="date" value={form.hireDate} onChange={set('hireDate')} /></div>
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
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? <span className="spinner" /> : 'Save Changes'}</button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Check History (per employee in Pay Employees) ─────────────────────────────
function CheckHistory({ clientId, employeeId, employeeName }) {
  const [checks, setChecks]   = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [err, setErr]         = useState('');

  useEffect(() => {
    api.getPaystubsByEmployee(clientId, employeeId)
      .then(setChecks)
      .catch(e => setErr(e.message));
  }, [clientId, employeeId]);

  async function handleVoid(stub) {
    const reason = window.prompt(`Void check #${stub.check_number} for ${employeeName}?\n\nReason (optional):`);
    if (reason === null) return; // cancelled
    setVoiding(stub.id);
    try {
      await api.voidPaystub(stub.id, reason);
      setChecks(prev => prev.map(c => c.id === stub.id ? { ...c, check_status: 'voided' } : c));
    } catch (e) { alert(e.message); }
    finally { setVoiding(null); }
  }

  if (checks === null) return <div style={{ padding: '12px 0', textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 18, height: 18, display: 'inline-block' }} /></div>;
  if (err) return <div style={{ color: '#dc2626', fontSize: 12, padding: '8px 0' }}>{err}</div>;
  if (checks.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0', fontStyle: 'italic' }}>No checks issued yet.</div>;

  const canEdit = (s) => s.check_status === 'draft';
  const canVoid = (s) => s.check_status !== 'voided';

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Check History</div>
      <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Check #</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Period</th>
              <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Gross</th>
              <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Net Pay</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Status</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>EFTPS Due</th>
              <th style={{ padding: '6px 10px', width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c, i) => {
              const voided = c.check_status === 'voided';
              const late   = c.check_status === 'late';
              const dueDays = daysUntil(c.settlement_due_date);
              return (
                <tr key={c.id} style={{ background: voided ? '#fef2f2' : i % 2 === 0 ? '#fff' : 'var(--bg-secondary)', borderTop: '1px solid var(--border)', opacity: voided ? 0.7 : 1 }}>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: voided ? '#dc2626' : 'var(--accent)' }}>
                    {c.check_number ? `#${c.check_number}` : '—'}
                    {voided && <span style={{ marginLeft: 6, color: '#dc2626', fontWeight: 800 }}>VOIDED</span>}
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--text-secondary)' }}>
                    {c.pay_period_start} – {c.pay_period_end}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(c.gross_wages)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: voided ? '#dc2626' : 'var(--success)', fontWeight: 600 }}>{voided ? `(${fmt(c.net_pay)})` : fmt(c.net_pay)}</td>
                  <td style={{ padding: '7px 10px' }}><StatusBadge status={c.check_status || 'draft'} /></td>
                  <td style={{ padding: '7px 10px', fontSize: 11, color: isOverdue(c.settlement_due_date) ? '#dc2626' : dueDays !== null && dueDays <= 5 ? '#d97706' : 'var(--text-muted)', fontWeight: isOverdue(c.settlement_due_date) ? 700 : 400 }}>
                    {c.settlement_due_date ? (
                      <>
                        {fmtDate(c.settlement_due_date)}
                        {isOverdue(c.settlement_due_date) && <span style={{ marginLeft: 4 }}>({Math.abs(dueDays)}d overdue)</span>}
                      </>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {canEdit(c) && (
                      <Link to={`/clients/${clientId}/paystubs/${c.id}/edit`} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Edit</Link>
                    )}
                    {canVoid(c) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11, color: '#dc2626', opacity: voiding === c.id ? 0.5 : 1 }}
                        onClick={() => handleVoid(c)}
                        disabled={voiding === c.id}
                      >{voiding === c.id ? '…' : 'Void'}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Employees Tab ─────────────────────────────────────────────────────────────
function EmployeesTab({ clientId, employees, onRefresh }) {
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
                  <div className="emp-meta">{emp.workState || 'TX'} · {FREQ_LABEL[emp.payFrequency] || emp.payFrequency} · {isSalary ? 'Salary' : 'Hourly'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{rate}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{emp.filingStatus === 'married' ? 'Married' : emp.filingStatus === 'hoh' ? 'HoH' : 'Single'}</div>
                </div>
                <span className={`badge ${emp.isActive !== false ? 'badge-success' : 'badge-neutral'}`}>{emp.isActive !== false ? 'Active' : 'Inactive'}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
              </div>
            );
          })}
        </div>
      )}
      {drawerEmpId && (
        <EmployeeDrawer clientId={clientId} empId={drawerEmpId} onClose={() => setDrawerEmpId(null)} onSaved={() => { setDrawerEmpId(null); onRefresh(); }} />
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
      bankAccountNumber: '', batchProviderPin: '', eftpsInternetPassword: '',
      eftpsEnrollmentNumber: client.eftpsEnrollmentNumber || '',
      contactName: client.contactName || '',
      contactEmail: client.contactEmail || '',
      contactPhone: client.contactPhone || '',
      payrollFrequency: client.payrollFrequency || 'biweekly',
      nextPayrollDate: client.nextPayrollDate || '',
      businessAddress: client.businessAddress || '',
      businessCity: client.businessCity || '',
      businessZip: client.businessZip || '',
      notificationEmail: client.notificationEmail || '',
      notificationPhone: client.notificationPhone || '',
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
      setSaved(true); onSaved();
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
          <F label="EIN"><input className="form-input mono" value={form.ein} onChange={set('ein')} placeholder="12-3456789" /></F>
        </div>
        <F label="Street Address"><input className="form-input" value={form.businessAddress} onChange={set('businessAddress')} /></F>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">City</label><input className="form-input" value={form.businessCity} onChange={set('businessCity')} /></div>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">State</label><select className="form-select" value={form.state} onChange={set('state')}>{US_STATES.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}</select></div>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">ZIP</label><input className="form-input mono" value={form.businessZip} onChange={set('businessZip')} maxLength={10} /></div>
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <F label="941 Deposit Schedule" hint="Monthly: 15th of following month. Semi-weekly: Wed or Fri after payroll.">
            <select className="form-select" value={form.depositSchedule} onChange={set('depositSchedule')}>
              <option value="monthly">Monthly Depositor</option>
              <option value="semiweekly">Semi-weekly Depositor</option>
            </select>
          </F>
          <F label="SUI Rate (%)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="form-input mono" type="number" min="0" max="20" step="0.01" value={form.sutaRate} onChange={set('sutaRate')} style={{ maxWidth: 120 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>%</span>
            </div>
          </F>
        </div>
        <div className="form-grid">
          <F label="Default Payroll Frequency">
            <select className="form-select" value={form.payrollFrequency} onChange={set('payrollFrequency')}>
              <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
              <option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option>
            </select>
          </F>
          <F label="Next Payroll Date"><input className="form-input" type="date" value={form.nextPayrollDate} onChange={set('nextPayrollDate')} /></F>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>Tax Deposit Notifications</p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Receive email and SMS reminders 5 days and 2 days before each deposit due date, and immediately when overdue.
        </p>
        <div className="form-grid">
          <F label="Notification Email" hint="SendGrid required — configure SENDGRID_API_KEY in .env">
            <input className="form-input" type="email" value={form.notificationEmail} onChange={set('notificationEmail')} placeholder="accountant@firm.com" />
          </F>
          <F label="Notification Phone (SMS)" hint="Twilio required — configure TWILIO_* in .env. Include country code: +15550000000">
            <input className="form-input" type="tel" value={form.notificationPhone} onChange={set('notificationPhone')} placeholder="+15550000000" />
          </F>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>EFTPS Credentials</p>
        <F label="Batch Provider PIN" hint="Stored encrypted. Leave blank to keep current.">
          <input className="form-input mono" type="password" value={form.batchProviderPin} onChange={set('batchProviderPin')} placeholder="4-digit PIN" maxLength={4} />
        </F>
        <div className="form-grid">
          <F label="EFTPS Internet Password"><input className="form-input mono" type="password" value={form.eftpsInternetPassword} onChange={set('eftpsInternetPassword')} placeholder="(leave blank to keep)" /></F>
          <F label="EFTPS Enrollment Number"><input className="form-input mono" value={form.eftpsEnrollmentNumber} onChange={set('eftpsEnrollmentNumber')} /></F>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>Bank Account</p>
        <div className="form-grid">
          <F label="Account Number"><input className="form-input mono" type="password" value={form.bankAccountNumber} onChange={set('bankAccountNumber')} placeholder="(leave blank to keep)" /></F>
          <F label="Routing Number"><input className="form-input mono" value={form.bankRoutingNumber} onChange={set('bankRoutingNumber')} maxLength={9} /></F>
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
          <F label="Contact Name"><input className="form-input" value={form.contactName} onChange={set('contactName')} /></F>
          <F label="Phone"><input className="form-input" value={form.contactPhone} onChange={set('contactPhone')} /></F>
        </div>
        <F label="Email"><input className="form-input" type="email" value={form.contactEmail} onChange={set('contactEmail')} /></F>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>{saving ? <span className="spinner" /> : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ── Run Payroll Modal ─────────────────────────────────────────────────────────
function RunPayrollModal({ entries, payPeriodStart, payPeriodEnd, settlementDate, clientId, onClose, onDone }) {
  const [step, setStep]         = useState('review');
  const [runResult, setRunResult] = useState(null);
  const [dlLoading, setDlLoading] = useState(false);
  const [err, setErr]           = useState('');

  async function submit(paymentMethod) {
    setStep('processing'); setErr('');
    try {
      const result = await api.runPayroll({
        clientId, payPeriodStart, payPeriodEnd, settlementDate: settlementDate || null, paymentMethod,
        employees: entries.map(r => ({
          employeeId:    r.empId, ytdGross: r.ytdGross || 0, lineItems: r.lineItems,
          regularHours:  r.regularHours, overtimeHours: r.overtimeHours,
          regularPay:    r.regularPay, overtimePay: r.overtimePay,
          bonus: r.bonus || 0, commission: r.commission || 0,
          reimbursement: r.reimbursement || 0, deduction: r.deduction || 0, garnishment: r.garnishment || 0,
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

  const totals = entries.reduce((a, r) => ({ gross: a.gross + (r.grossWages || 0), net: a.net + (r.netPay || 0) }), { gross: 0, net: 0 });

  return (
    <div className="drawer-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 14, width: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{step === 'review' ? 'Review Payroll' : step === 'method' ? 'Payment Method' : step === 'processing' ? 'Processing…' : step === 'print' ? 'Print Checks' : 'Payroll Complete'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{fmtDate(payPeriodStart)} – {fmtDate(payPeriodEnd)}</div>
          </div>
          {step !== 'processing' && <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {err && <div className="alert alert-error" style={{ marginBottom: 16 }}><span>⚠</span>{err}</div>}
          {step === 'review' && (
            <>
              <table className="schedule-table" style={{ marginBottom: 16 }}>
                <thead><tr><th>Employee</th><th className="num">Gross</th><th className="num">Net Pay</th></tr></thead>
                <tbody>
                  {entries.map(r => <tr key={r.empId}><td className="emp-cell">{r.empName}</td><td className="num">{fmt(r.grossWages)}</td><td className="num" style={{ color: 'var(--success)', fontWeight: 700 }}>{fmt(r.netPay)}</td></tr>)}
                  <tr className="total-row"><td>Totals</td><td className="num">{fmt(totals.gross)}</td><td className="num">{fmt(totals.net)}</td></tr>
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={() => setStep('method')}>Continue →</button></div>
            </>
          )}
          {step === 'method' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
              {[['🏦', 'Direct Deposit', 'Mark as direct deposit pending. Bank integration coming soon.', 'direct_deposit'],
                ['🖨️', 'Print Checks', 'Generate professional check PDF with pay stubs.', 'print_check']].map(([icon, title, desc, method]) => (
                <button key={method} className="card" onClick={() => submit(method)}
                  style={{ textAlign: 'left', cursor: 'pointer', border: '2px solid var(--border)', padding: 20, transition: 'border-color 0.15s', background: '#fff' }}
                  onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{desc}</div>
                </button>
              ))}
            </div>
          )}
          {step === 'processing' && <div style={{ padding: '40px 0', textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto 16px' }} /><div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Creating paychecks…</div></div>}
          {step === 'print' && runResult && (
            <div>
              <div className="alert alert-success" style={{ marginBottom: 16 }}><span>✓</span><strong>{runResult.count} paychecks created</strong></div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-primary btn-lg" onClick={handlePrintChecks} disabled={dlLoading}>{dlLoading ? <span className="spinner" /> : 'Download Check PDF'}</button>
                <button className="btn btn-secondary" onClick={() => setStep('done')}>Skip</button>
              </div>
            </div>
          )}
          {step === 'done' && runResult && (
            <div>
              <div className="alert alert-success" style={{ marginBottom: 16 }}><span>✓</span><strong>{runResult.count} paychecks created</strong></div>
              <table className="schedule-table"><thead><tr><th>Employee</th><th>Check #</th><th className="num">Net Pay</th></tr></thead>
                <tbody>{runResult.paystubs.map(p => <tr key={p.id}><td className="emp-cell">{p.employeeName}</td><td style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--accent)' }}>#{p.checkNumber}</td><td className="num" style={{ color: 'var(--success)', fontWeight: 700 }}>{fmt(p.netPay)}</td></tr>)}</tbody>
              </table>
              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                <button className="btn btn-secondary" onClick={handlePrintChecks} disabled={dlLoading}>{dlLoading ? <span className="spinner" /> : 'Download PDF'}</button>
                <button className="btn btn-primary" onClick={() => onDone()}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pay Employees Tab ─────────────────────────────────────────────────────────
function PayEmployeesTab({ clientId, client, employees }) {
  const currentYear = new Date().getFullYear();
  const activeEmps  = employees.filter(e => e.isActive !== false);
  const freqGroups  = [...new Set(activeEmps.map(e => e.payFrequency || 'biweekly'))].sort();
  const [freqGroup, setFreqGroup] = useState(freqGroups[0] || 'biweekly');
  const empsInGroup = activeEmps.filter(e => (e.payFrequency || 'biweekly') === freqGroup);

  const [showHistory, setShowHistory] = useState({});

  function getDefaultPeriod() {
    const anchor = empsInGroup.find(e => e.firstPayPeriodStart && e.firstPayPeriodEnd);
    if (anchor) return getCurrentPeriod(anchor.firstPayPeriodStart, anchor.firstPayPeriodEnd, freqGroup);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (freqGroup === 'weekly') { const m = new Date(today); m.setDate(today.getDate() - today.getDay() + 1); const s = new Date(m); s.setDate(m.getDate() + 6); return { start: m.toISOString().slice(0, 10), end: s.toISOString().slice(0, 10) }; }
    if (freqGroup === 'semimonthly') { const d = today.getDate(); const y = today.getFullYear(), mo = today.getMonth(); return d <= 15 ? { start: `${y}-${String(mo+1).padStart(2,'0')}-01`, end: `${y}-${String(mo+1).padStart(2,'0')}-15` } : { start: `${y}-${String(mo+1).padStart(2,'0')}-16`, end: new Date(y, mo+1, 0).toISOString().slice(0,10) }; }
    if (freqGroup === 'monthly') { const f = new Date(today.getFullYear(), today.getMonth(), 1), l = new Date(today.getFullYear(), today.getMonth() + 1, 0); return { start: f.toISOString().slice(0, 10), end: l.toISOString().slice(0, 10) }; }
    const e = new Date(today); e.setDate(today.getDate() - 1); const s = new Date(e); s.setDate(e.getDate() - 13); return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
  }

  const [periodStart, setPeriodStart]       = useState('');
  const [periodEnd, setPeriodEnd]           = useState('');
  const [settlementDate, setSettlementDate] = useState('');

  useEffect(() => { const p = getDefaultPeriod(); setPeriodStart(p.start); setPeriodEnd(p.end); }, [freqGroup, employees]);

  const [empState, setEmpState]   = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [selected, setSelected]   = useState(new Set());
  const [showModal, setShowModal] = useState(false);
  const calcTimers = useRef({});

  useEffect(() => {
    setEmpState(prev => {
      const next = { ...prev };
      empsInGroup.forEach(emp => {
        if (!next[emp.id]) {
          const ppy = PERIODS_PER_YEAR[emp.payFrequency] || 26;
          const salaryAmt = emp.payType === 'salary' ? r2((emp.annualSalary || 0) / ppy) : 0;
          next[emp.id] = { regHours: '', otHours: '', regRate: String(emp.hourlyRate || ''), otEnabled: true, salaryAmt: String(salaryAmt), bonus: '', commission: '', reimbursement: '', deduction: '', garnishment: '', taxCalc: null, calcLoading: false };
        }
      });
      return next;
    });
  }, [freqGroup, employees]);

  function getEmpData(empId) { return empState[empId] || {}; }

  function updateEmpField(empId, field, value) {
    setEmpState(prev => ({ ...prev, [empId]: { ...(prev[empId] || {}), [field]: value } }));
    if (expandedId === empId) { clearTimeout(calcTimers.current[empId]); calcTimers.current[empId] = setTimeout(() => calcTaxes(empId), 600); }
  }

  function getEmpGross(empId) {
    const emp = empsInGroup.find(e => e.id === empId), data = getEmpData(empId);
    if (!emp) return 0;
    if (emp.payType === 'salary') return r2(parseFloat(data.salaryAmt || 0) + parseFloat(data.bonus || 0) + parseFloat(data.commission || 0));
    const regH = parseFloat(data.regHours || 0), otH = data.otEnabled ? parseFloat(data.otHours || 0) : 0, rate = parseFloat(data.regRate || emp.hourlyRate || 0);
    return r2(r2(Math.min(regH, 40) * rate) + r2(otH * rate * 1.5) + parseFloat(data.bonus || 0) + parseFloat(data.commission || 0));
  }

  async function calcTaxes(empId) {
    const emp = empsInGroup.find(e => e.id === empId), data = getEmpData(empId), gross = getEmpGross(empId);
    if (!emp || gross <= 0) return;
    setEmpState(prev => ({ ...prev, [empId]: { ...prev[empId], calcLoading: true } }));
    try {
      const ytdData = await api.getEmployeeYTD(empId, currentYear).catch(() => ({ ytd_gross: 0 }));
      const taxes = await api.calculate({ grossWages: gross, payFrequency: emp.payFrequency || 'biweekly', filingStatus: emp.filingStatus || 'single', step2Checkbox: !!emp.step2Checkbox, step3Children: emp.step3Children || 0, step3Other: emp.step3Other || 0, step4a: 0, step4b: 0, step4c: 0, workState: emp.workState || client?.state || 'TX', ytdGross: ytdData?.ytd_gross || 0, sutaRate: client?.sutaRate || null });
      setEmpState(prev => ({ ...prev, [empId]: { ...prev[empId], taxCalc: { ...taxes, ytdGross: ytdData?.ytd_gross || 0 }, calcLoading: false } }));
    } catch { setEmpState(prev => ({ ...prev, [empId]: { ...prev[empId], calcLoading: false } })); }
  }

  function handleExpand(empId) { const isOpen = expandedId === empId; setExpandedId(isOpen ? null : empId); if (!isOpen) calcTaxes(empId); }

  function buildEntries() {
    return empsInGroup.filter(emp => selected.has(emp.id)).map(emp => {
      const data = getEmpData(emp.id), tc = data.taxCalc || {}, gross = getEmpGross(emp.id);
      const rate = parseFloat(data.regRate || emp.hourlyRate || 0), regH = parseFloat(data.regHours || 0), otH = data.otEnabled ? parseFloat(data.otHours || 0) : 0;
      const regPay = emp.payType === 'salary' ? parseFloat(data.salaryAmt || 0) : r2(Math.min(regH, 40) * rate);
      const otPay  = emp.payType === 'salary' ? 0 : r2(otH * rate * 1.5);
      const lineItems = [];
      if (emp.payType === 'salary') lineItems.push({ payType: 'salary', description: 'Salary', amount: parseFloat(data.salaryAmt || 0) });
      else { if (regPay > 0) lineItems.push({ payType: 'regular', description: 'Regular', hours: Math.min(regH, 40), rate, amount: regPay }); if (otPay > 0) lineItems.push({ payType: 'overtime', description: 'Overtime', hours: otH, rate: r2(rate * 1.5), amount: otPay }); }
      if (parseFloat(data.bonus        || 0) > 0) lineItems.push({ payType: 'bonus',        description: 'Bonus',        amount: parseFloat(data.bonus) });
      if (parseFloat(data.commission   || 0) > 0) lineItems.push({ payType: 'commission',   description: 'Commission',   amount: parseFloat(data.commission) });
      if (parseFloat(data.reimbursement|| 0) > 0) lineItems.push({ payType: 'reimbursement',description: 'Reimbursement',amount: parseFloat(data.reimbursement) });
      return { empId: emp.id, empName: `${emp.firstName} ${emp.lastName}`, payType: emp.payType, regularHours: emp.payType === 'salary' ? null : Math.min(regH, 40), overtimeHours: emp.payType === 'salary' ? null : otH, regularPay: regPay, overtimePay: otPay, bonus: parseFloat(data.bonus || 0), commission: parseFloat(data.commission || 0), reimbursement: parseFloat(data.reimbursement || 0), deduction: parseFloat(data.deduction || 0), garnishment: parseFloat(data.garnishment || 0), grossWages: tc.grossWages || gross, fitWithholding: tc.fitWithholding || 0, employeeSS: tc.employeeSS || 0, employeeMedicare: tc.employeeMedicare || 0, employerSS: tc.employerSS || 0, employerMedicare: tc.employerMedicare || 0, futaTax: tc.futaTax || 0, sutaTax: tc.sutaTax || 0, netPay: tc.netPay || gross, ytdGross: tc.ytdGross || 0, lineItems };
    });
  }

  function toggleSelect(empId) { setSelected(prev => { const s = new Set(prev); s.has(empId) ? s.delete(empId) : s.add(empId); return s; }); }
  function toggleAll(checked) { setSelected(checked ? new Set(empsInGroup.map(e => e.id)) : new Set()); }
  const allChecked = empsInGroup.length > 0 && empsInGroup.every(e => selected.has(e.id));

  if (activeEmps.length === 0) return <div className="card"><div className="empty-state" style={{ padding: '32px 20px' }}><div className="empty-state-icon">👤</div><h3>No active employees</h3></div></div>;

  const MI = ({ value, onChange }) => (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12 }}>$</span>
      <input className="form-input mono" type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)} style={{ paddingLeft: 20, width: 100, height: 32, fontSize: 13 }} />
    </div>
  );

  return (
    <div>
      {freqGroups.length > 1 && (
        <div className="pay-subtabs" style={{ marginBottom: 16 }}>
          {freqGroups.map(f => <button key={f} className={`pay-subtab${freqGroup === f ? ' active' : ''}`} onClick={() => { setFreqGroup(f); setSelected(new Set()); }}>{FREQ_LABEL[f] || f} <span style={{ opacity: 0.6, fontSize: 11 }}>({activeEmps.filter(e => (e.payFrequency || 'biweekly') === f).length})</span></button>)}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span className="card-title">{FREQ_LABEL[freqGroup]} Pay Run</span>
          {[['Period Start', periodStart, setPeriodStart], ['Period End', periodEnd, setPeriodEnd], ['Settlement Date', settlementDate, setSettlementDate]].map(([label, val, setter]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</label>
              <input className="form-input" type="date" value={val} onChange={e => setter(e.target.value)} style={{ width: 145, height: 32, fontSize: 13 }} />
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={selected.size === 0} onClick={() => setShowModal(true)}>Run Payroll ({selected.size})</button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="schedule-table" style={{ tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} /></th>
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
                const data = getEmpData(emp.id), isOpen = expandedId === emp.id, isSalary = emp.payType === 'salary';
                const rate = parseFloat(data.regRate || emp.hourlyRate || 0), regH = parseFloat(data.regHours || 0), otH = data.otEnabled ? parseFloat(data.otHours || 0) : 0;
                const regPay = isSalary ? parseFloat(data.salaryAmt || 0) : r2(Math.min(regH, 40) * rate);
                const otPay  = isSalary ? 0 : r2((otH + Math.max(0, regH - 40)) * rate * 1.5);
                const gross  = getEmpGross(emp.id), tc = data.taxCalc;
                const histOpen = showHistory[emp.id];

                return [
                  <tr key={emp.id} style={{ background: isOpen ? 'var(--accent-light)' : undefined }}>
                    <td><input type="checkbox" checked={selected.has(emp.id)} onChange={() => toggleSelect(emp.id)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} /></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="emp-avatar" style={{ width: 28, height: 28, fontSize: 10, flexShrink: 0 }}>{initials(`${emp.firstName} ${emp.lastName}`)}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.firstName} {emp.lastName}</div>
                          <button onClick={() => setShowHistory(prev => ({ ...prev, [emp.id]: !prev[emp.id] }))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--accent)', padding: 0, fontWeight: 600 }}>
                            {histOpen ? '▲ Hide' : '▼ History'}
                          </button>
                        </div>
                      </div>
                    </td>
                    <td><span className={`badge ${isSalary ? 'badge-accent' : 'badge-neutral'}`} style={{ fontSize: 11 }}>{isSalary ? 'Salary' : 'Hourly'}</span></td>
                    <td className="num">{isSalary ? <span style={{ color: 'var(--text-muted)' }}>—</span> : <input className="form-input mono" type="number" min="0" step="0.25" value={data.regHours} onChange={e => updateEmpField(emp.id, 'regHours', e.target.value)} style={{ width: 80, height: 30, textAlign: 'right', fontSize: 13 }} />}</td>
                    <td className="num">{isSalary ? <span style={{ color: 'var(--text-muted)' }}>—</span> : (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <input className="form-input mono" type="number" min="0" step="0.25" value={data.otHours} onChange={e => updateEmpField(emp.id, 'otHours', e.target.value)} style={{ width: 64, height: 30, textAlign: 'right', fontSize: 13 }} disabled={!data.otEnabled} />
                        <button onClick={() => updateEmpField(emp.id, 'otEnabled', !data.otEnabled)} style={{ background: data.otEnabled ? 'var(--accent-light)' : 'var(--bg-secondary)', border: `1px solid ${data.otEnabled ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 4, padding: '2px 5px', cursor: 'pointer', fontSize: 10, color: data.otEnabled ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 700, flexShrink: 0 }}>1.5×</button>
                      </div>
                    )}</td>
                    <td className="num">{isSalary ? <MI value={data.salaryAmt} onChange={v => updateEmpField(emp.id, 'salaryAmt', v)} /> : <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{regPay > 0 ? fmt(regPay) : '—'}</span>}</td>
                    <td className="num"><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: otPay > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{isSalary || otPay === 0 ? '—' : fmt(otPay)}</span></td>
                    <td className="num" style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: gross > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{gross > 0 ? fmt(gross) : '—'}</td>
                    <td><button onClick={() => handleExpand(emp.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</button></td>
                  </tr>,
                  // Expanded tax breakdown row
                  isOpen && <tr key={`${emp.id}-exp`}><td colSpan={9} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                    <div style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
                        {[['bonus','Bonus'],['commission','Commission'],['reimbursement','Reimbursement'],['deduction','Deduction'],['garnishment','Garnishment']].map(([field, label]) => (
                          <div key={field} className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: 10 }}>{label}</label>
                            <MI value={data[field] || ''} onChange={v => updateEmpField(emp.id, field, v)} />
                          </div>
                        ))}
                      </div>
                      {data.calcLoading ? <div style={{ textAlign: 'center', padding: '12px 0' }}><div className="spinner spinner-dark" style={{ width: 20, height: 20, display: 'inline-block' }} /></div>
                        : tc ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Employee Contributions</div>
                            {[['Federal Income Tax', tc.fitWithholding],['Social Security (6.2%)', tc.employeeSS],['Medicare (1.45%)', tc.employeeMedicare],['State Income Tax', tc.stateIncomeTax || 0]].map(([l, v]) => v > 0 && <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#dc2626' }}>-{fmt(v)}</span></div>)}
                            <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                              <span>Net Pay</span>
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--success)', fontSize: 14 }}>{fmt(r2(tc.netPay + parseFloat(data.reimbursement || 0) - parseFloat(data.deduction || 0) - parseFloat(data.garnishment || 0)))}</span>
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Employer Contributions</div>
                            {[['Social Security Match', tc.employerSS],['Medicare Match', tc.employerMedicare],['FUTA', tc.futaTax || 0],['SUI', tc.sutaTax || 0]].map(([l, v]) => v > 0 && <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>{fmt(v)}</span></div>)}
                          </div>
                        </div>
                      ) : <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>Enter pay amounts to see tax breakdown</div>}
                    </div>
                  </td></tr>,
                  // Check history row
                  histOpen && <tr key={`${emp.id}-hist`}><td colSpan={9} style={{ padding: '0 20px 16px', background: '#f8fafc' }}>
                    <CheckHistory clientId={clientId} employeeId={emp.id} employeeName={`${emp.firstName} ${emp.lastName}`} />
                  </td></tr>,
                ].filter(Boolean);
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && <RunPayrollModal entries={buildEntries()} payPeriodStart={periodStart} payPeriodEnd={periodEnd} settlementDate={settlementDate} clientId={clientId} onClose={() => setShowModal(false)} onDone={() => { setShowModal(false); setSelected(new Set()); }} />}
    </div>
  );
}

// ── Pay Liabilities — Inline Check Editor ─────────────────────────────────────
function LiabilityCheckEditor({ stub, clientId, client, onUpdated, onClose }) {
  const [form, setForm] = useState({
    grossWages: String(stub.gross_wages || ''),
    filingStatus: stub.filing_status || 'single',
    payFrequency: stub.pay_frequency || 'biweekly',
    workState: stub.work_state || client?.state || 'TX',
    payPeriodStart: stub.pay_period_start || '',
    payPeriodEnd: stub.pay_period_end || '',
    settlementDate: stub.settlement_date || '',
  });
  const [taxes, setTaxes]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  const [accepted, setAccepted] = useState(false);
  const calcTimer = useRef(null);

  const alreadySubmitted = stub.status === 'submitted' || stub.eftps_status === 'submitted';

  useEffect(() => {
    clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(recalc, 500);
  }, [form.grossWages, form.filingStatus, form.payFrequency, form.workState]);

  async function recalc() {
    const gross = parseFloat(form.grossWages || 0);
    if (gross <= 0) return;
    try {
      const result = await api.calculate({ grossWages: gross, payFrequency: form.payFrequency, filingStatus: form.filingStatus, step2Checkbox: false, step3Children: 0, step3Other: 0, step4a: 0, step4b: 0, step4c: 0, workState: form.workState, ytdGross: stub.ytd_wages_before || 0, sutaRate: client?.sutaRate || null });
      setTaxes(result);
    } catch {}
  }

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      await api.updatePaystub(stub.id, {
        grossWages: parseFloat(form.grossWages),
        filingStatus: form.filingStatus,
        payFrequency: form.payFrequency,
        workState: form.workState,
        payPeriodStart: form.payPeriodStart,
        payPeriodEnd: form.payPeriodEnd,
        settlementDate: form.settlementDate || null,
      });
      onUpdated();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  return (
    <div style={{ padding: '16px 20px', background: '#f8fafc', borderTop: '1px solid var(--border)' }}>
      {alreadySubmitted && !accepted && (
        <div style={{ background: '#fff3cd', border: '1px solid #f59e0b', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 8, fontSize: 14 }}>⚠ This check has already been submitted to EFTPS</div>
          <div style={{ color: '#78350f', fontSize: 13, marginBottom: 12 }}>Editing may cause discrepancies between your records and what was submitted. Proceed with caution and notify your tax preparer.</div>
          <button className="btn btn-primary" style={{ background: '#d97706', borderColor: '#d97706' }} onClick={() => setAccepted(true)}>I Understand, Edit Anyway</button>
        </div>
      )}
      {(!alreadySubmitted || accepted) && (
        <>
          {err && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span>{err}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Gross Wages</label><div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12 }}>$</span><input className="form-input mono" type="number" min="0" step="0.01" value={form.grossWages} onChange={set('grossWages')} style={{ paddingLeft: 20, height: 32, fontSize: 13 }} /></div></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Filing Status</label><select className="form-select" value={form.filingStatus} onChange={set('filingStatus')} style={{ height: 32, fontSize: 13 }}><option value="single">Single</option><option value="married">Married</option><option value="hoh">HoH</option></select></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Pay Frequency</label><select className="form-select" value={form.payFrequency} onChange={set('payFrequency')} style={{ height: 32, fontSize: 13 }}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option></select></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Work State</label><select className="form-select" value={form.workState} onChange={set('workState')} style={{ height: 32, fontSize: 13 }}>{US_STATES.map(([c]) => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Period Start</label><input className="form-input" type="date" value={form.payPeriodStart} onChange={set('payPeriodStart')} style={{ height: 32, fontSize: 13 }} /></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Period End</label><input className="form-input" type="date" value={form.payPeriodEnd} onChange={set('payPeriodEnd')} style={{ height: 32, fontSize: 13 }} /></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Settlement Date</label><input className="form-input" type="date" value={form.settlementDate} onChange={set('settlementDate')} style={{ height: 32, fontSize: 13 }} /></div>
          </div>
          {taxes && (
            <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)', marginBottom: 12, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
              {[['FIT', taxes.fitWithholding],['SS', taxes.employeeSS],['Medicare', taxes.employeeMedicare],['State Tax', taxes.stateIncomeTax || 0],['FUTA', taxes.futaTax || 0],['SUI', taxes.sutaTax || 0],['941 Total', taxes.totalDeposit],['Net Pay', taxes.netPay]].map(([l, v]) => (
                <div key={l}><div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{l}</div><div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--accent)' }}>{fmt(v)}</div></div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? <span className="spinner" /> : 'Save Changes'}</button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Pay Liabilities Tab ───────────────────────────────────────────────────────
function PayLiabilitiesTab({ clientId, client }) {
  const [paystubs, setPaystubs]   = useState([]);
  const [credits, setCredits]     = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [selected, setSelected]   = useState(new Set());
  const [submitting, setSubmitting] = useState(null);
  const [result,   setResult]     = useState(null);
  const [expanded, setExpanded]   = useState({ '941': true, '940': false, 'sui': false });
  const [editing,  setEditing]    = useState(null); // stub.id being edited

  const depositSchedule = client?.depositSchedule || 'monthly';

  async function reload() {
    const [stubs, crds] = await Promise.all([api.getPaystubs(clientId), api.getPaystubCredits(clientId)]);
    setPaystubs(stubs);
    setCredits(crds);
    const pending = stubs.filter(s => s.status === 'pending' || s.status === 'failed' || s.status_940 === 'pending' || s.status_940 === 'failed');
    setSelected(new Set(pending.map(s => s.id)));
  }

  useEffect(() => { reload().finally(() => setLoading(false)); }, [clientId]);

  const pending941 = paystubs.filter(s => s.status === 'pending' || s.status === 'failed');
  const pending940 = paystubs.filter(s => (s.status_940 === 'pending' || s.status_940 === 'failed') && s.futa_tax > 0);
  const pendingSUI = paystubs.filter(s => s.suta_tax > 0 && (s.status === 'pending' || s.status === 'failed'));

  const unappCredits = credits.filter(c => !c.applied);
  const credit941 = unappCredits.reduce((s, c) => s + (c.total_941_credit || 0), 0);
  const credit940 = unappCredits.reduce((s, c) => s + (c.total_940_credit || 0), 0);

  const sel941 = pending941.filter(s => selected.has(s.id));
  const sel940 = pending940.filter(s => selected.has(s.id));
  const total941 = sel941.reduce((s, p) => s + p.total_deposit, 0) + credit941;
  const total940 = sel940.reduce((s, p) => s + p.futa_tax, 0) + credit940;
  const totalSUI  = pendingSUI.filter(s => selected.has(s.id)).reduce((s, p) => s + (p.suta_tax || 0), 0);

  async function handleSubmit(taxType) {
    const ids = (taxType === '941' ? sel941 : sel940).map(s => s.id);
    if (!ids.length && credit941 === 0) return;
    const amt = taxType === '941' ? total941 : total940;
    if (!window.confirm(`Submit ${taxType} (${fmt(amt)}) to EFTPS?`)) return;
    setSubmitting(taxType); setResult(null);
    try {
      const res = await api.batchSubmitPaystubs({ clientId, paystubIds: ids, taxType });
      setResult(res); await reload();
    } catch (e) { setResult({ error: e.message }); }
    finally { setSubmitting(null); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 28, height: 28 }} /></div>;

  function LiabilityGroup({ title, stubs, taxType, total, credit, creditLabel }) {
    const isOpen = expanded[taxType];
    const todayStr = new Date().toISOString().slice(0, 10);
    const overdueCount = stubs.filter(s => s.settlement_due_date && s.settlement_due_date < todayStr).length;
    // Earliest due date
    const dueDates = stubs.map(s => s.settlement_due_date).filter(Boolean).sort();
    const nextDue = dueDates[0];

    return (
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        {/* Group header */}
        <div
          onClick={() => setExpanded(prev => ({ ...prev, [taxType]: !prev[taxType] }))}
          style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: isOpen ? 'var(--accent-light)' : undefined, userSelect: 'none' }}
        >
          <span style={{ fontSize: 16, color: 'var(--text-muted)', transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none' }}>›</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {stubs.length} check{stubs.length !== 1 ? 's' : ''}
              {nextDue && <span> · {overdueCount > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠ {overdueCount} overdue · Earliest due {fmtDate(nextDue)}</span> : `Due ${fmtDate(nextDue)}`}</span>}
              {credit < 0 && <span style={{ color: 'var(--success)', marginLeft: 8 }}>Credit: {fmt(credit)}</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 18, color: total > 0 ? 'var(--accent)' : 'var(--success)' }}>{fmt(total)}</div>
            {credit < 0 && <div style={{ fontSize: 11, color: 'var(--success)' }}>incl. {fmt(Math.abs(credit))} credit</div>}
          </div>
        </div>

        {isOpen && (
          <div>
            {/* Select-all bar */}
            <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={stubs.length > 0 && stubs.every(s => selected.has(s.id))} onChange={e => { const next = new Set(selected); stubs.forEach(s => e.target.checked ? next.add(s.id) : next.delete(s.id)); setSelected(next); }} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>SELECT ALL</span>
              {taxType !== 'sui' && (
                <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => handleSubmit(taxType === 'sui' ? '941' : taxType)} disabled={submitting !== null || (taxType === '941' ? sel941.length === 0 : sel940.length === 0)}>
                  {submitting === taxType ? <span className="spinner" /> : `Pay to EFTPS — ${fmt(taxType === '941' ? total941 : total940)}`}
                </button>
              )}
            </div>

            {/* Credit rows */}
            {taxType !== 'sui' && unappCredits.filter(c => taxType === '941' ? (c.total_941_credit || 0) < 0 : (c.total_940_credit || 0) < 0).map(c => (
              <div key={`cr-${c.id}`} style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: '#f0fdf4', display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 14 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--success)' }}>CREDIT — {c.employee_name || 'Void reversal'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Check #{c.reference_stub_id} voided · Will be applied to next payment</div>
                </div>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--success)', fontSize: 14 }}>{fmt(taxType === '941' ? c.total_941_credit : c.total_940_credit)}</span>
              </div>
            ))}

            {/* Individual check rows */}
            {stubs.map(stub => {
              const voided = stub.check_status === 'voided';
              const due = stub.settlement_due_date;
              const over = due && isOverdue(due);
              const dueDays = daysUntil(due);
              const isEditOpen = editing === stub.id;

              return (
                <div key={stub.id}>
                  <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', background: voided ? '#fef2f2' : over ? '#fff7ed' : undefined, opacity: voided ? 0.7 : 1 }}>
                    <input type="checkbox" checked={selected.has(stub.id)} onChange={() => { const n = new Set(selected); n.has(stub.id) ? n.delete(stub.id) : n.add(stub.id); setSelected(n); }} style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0 }} disabled={voided} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: voided ? '#dc2626' : 'var(--text-primary)' }}>
                          {stub.employee_name || '—'}
                          {voided && <span style={{ marginLeft: 6, fontWeight: 800, color: '#dc2626' }}>VOIDED</span>}
                        </span>
                        {stub.check_number && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--accent)' }}>#{stub.check_number}</span>}
                        <StatusBadge status={stub.check_status || 'draft'} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {stub.pay_period_start} – {stub.pay_period_end}
                        {due && (
                          <span style={{ marginLeft: 10, color: over ? '#dc2626' : dueDays <= 5 ? '#d97706' : 'var(--text-muted)', fontWeight: over ? 700 : 400 }}>
                            · EFTPS due {fmtDate(due)}{over && ` (${Math.abs(dueDays)}d overdue)`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {taxType === '941' && stub.total_deposit > 0 && <span className={`badge ${over ? 'badge-error' : 'badge-warning'}`}>941: {fmt(stub.total_deposit)}</span>}
                      {taxType === '940' && stub.futa_tax > 0 && <span className="badge badge-accent">940: {fmt(stub.futa_tax)}</span>}
                      {taxType === 'sui' && stub.suta_tax > 0 && <span className="badge badge-neutral">SUI: {fmt(stub.suta_tax)}</span>}
                    </div>
                    {!voided && (
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, color: isEditOpen ? 'var(--accent)' : undefined }} onClick={() => setEditing(isEditOpen ? null : stub.id)}>
                        {isEditOpen ? 'Close' : 'Edit'}
                      </button>
                    )}
                  </div>
                  {isEditOpen && (
                    <LiabilityCheckEditor stub={stub} clientId={clientId} client={client} onUpdated={() => { setEditing(null); reload(); }} onClose={() => setEditing(null)} />
                  )}
                </div>
              );
            })}

            {stubs.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pending {title.toLowerCase()} liabilities.</div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Deposit schedule banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--accent-light)', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>941 Deposit Schedule:</span>
        <span style={{ color: 'var(--text-secondary)' }}>{depositSchedule === 'semiweekly' ? 'Semi-weekly — deposit by Wed or Fri following payroll' : 'Monthly — deposit by 15th of following month'}</span>
      </div>

      {result && (
        <div className={`alert ${result.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 16 }}>
          <span>{result.error ? '⚠' : '✓'}</span>
          <span>{result.error ? result.error : `Submitted ${result.submitted} paystub${result.submitted !== 1 ? 's' : ''} — ${fmt(result.totalDeposit)}${result.confirmation ? ` · Conf: ${result.confirmation}` : ''}`}</span>
          <button onClick={() => setResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button>
        </div>
      )}

      <LiabilityGroup title="Federal 941" stubs={pending941} taxType="941" total={total941} credit={credit941} />
      <LiabilityGroup title="Federal 940 (FUTA)" stubs={pending940} taxType="940" total={total940} credit={credit940} />
      <LiabilityGroup title="State SUI" stubs={pendingSUI} taxType="sui" total={totalSUI} credit={0} />

      {pending941.length === 0 && pending940.length === 0 && pendingSUI.length === 0 && (
        <div className="card"><div className="empty-state" style={{ padding: '32px 20px' }}><div className="empty-state-icon">✓</div><h3>All caught up</h3><p>No pending liabilities.</p></div></div>
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
  const statusCls = { Past: 'badge-neutral', Due: 'badge-warning', Upcoming: 'badge-success' };
  const forms = [
    ...[1,2,3,4].map(q => ({ id: `941-${year}-q${q}`, name: `Form 941 — Q${q} ${year}`, desc: 'Federal Payroll Tax Return', due: `${qDue[q]}, ${q === 4 ? year + 1 : year}`, status: q < currentQ || year < currentYear ? 'Past' : q === currentQ && year === currentYear ? 'Due' : 'Upcoming', action: () => navigate(`/reports?clientId=${clientId}&form=941&year=${year}&quarter=${q}`) })),
    { id: `940-${year}`, name: `Form 940 — ${year}`, desc: 'FUTA Annual Return', due: `Jan 31, ${year + 1}`, status: year < currentYear ? 'Past' : 'Due', action: () => navigate(`/reports?clientId=${clientId}&form=940&year=${year}`) },
    { id: `w2-${year}`,  name: `W-2 — ${year}`,     desc: 'Wage and Tax Statement (per employee)', due: `Jan 31, ${year + 1}`, status: year < currentYear ? 'Past' : 'Due', action: () => navigate(`/reports?clientId=${clientId}&form=w2&year=${year}`) },
    { id: `w3-${year}`,  name: `W-3 — ${year}`,     desc: 'Transmittal of Wage and Tax Statements', due: `Jan 31, ${year + 1}`, status: year < currentYear ? 'Past' : 'Due', action: () => navigate(`/reports?clientId=${clientId}&form=w3&year=${year}`) },
    { id: `twc-${year}`, name: `State WC — ${year}`, desc: 'State Workforce Commission (SUI)', due: 'Quarterly', status: 'Due', action: () => navigate(`/reports?clientId=${clientId}&form=twc&year=${year}`) },
  ];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Tax Year</span>
        <select className="form-select" value={year} onChange={e => setYear(parseInt(e.target.value))} style={{ width: 120 }}>{[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}</select>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/reports')}>Open Reports Page</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {forms.map(f => <div key={f.id} className="form-file-row"><div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{f.desc}</div></div><span className={`badge ${statusCls[f.status]}`}>{f.status}</span><div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Due {f.due}</div><button className="btn btn-secondary btn-sm" onClick={f.action}>Generate / View</button></div>)}
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
        {[['pay','Pay Employees'],['liabilities','Pay Liabilities'],['forms','File Forms']].map(([k, label]) => <button key={k} className={`pay-subtab${sub === k ? ' active' : ''}`} onClick={() => setSub(k)}>{label}</button>)}
      </div>
      {sub === 'pay'         && <PayEmployeesTab clientId={clientId} client={client} employees={employees} />}
      {sub === 'liabilities' && <PayLiabilitiesTab clientId={clientId} client={client} />}
      {sub === 'forms'       && <FileFormsTab clientId={clientId} />}
    </div>
  );
}

// ── Main Workspace ────────────────────────────────────────────────────────────
export default function CompanyWorkspace() {
  const { id } = useParams(), location = useLocation(), navigate = useNavigate();
  const [client, setClient]       = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState(location.state?.tab || 'employees');

  useEffect(() => { loadAll(); }, [id]);

  async function loadAll() {
    try { const [c, emps] = await Promise.all([api.getClient(id), api.getEmployees(id)]); setClient(c); setEmployees(emps); }
    catch (e) { alert(e.message); navigate('/'); }
    finally { setLoading(false); }
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 60 }}><div className="spinner spinner-dark" style={{ width: 36, height: 36 }} /></div>;

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-title-row">
          <Link to="/" className="workspace-back">← All Companies</Link>
          <div><div className="workspace-name">{client?.businessName}</div></div>
          <span className="workspace-ein">EIN {client?.ein}</span>
          <div style={{ flex: 1 }} />
        </div>
        <div className="ws-tabs">
          {[['employees','Employees'],['company','Company'],['payments','Payments']].map(([k, label]) => (
            <button key={k} className={`ws-tab${activeTab === k ? ' active' : ''}`} onClick={() => setActiveTab(k)}>
              {label}
              {k === 'employees' && employees.length > 0 && <span style={{ marginLeft: 6, background: activeTab === k ? 'var(--accent)' : 'var(--bg-tertiary)', color: activeTab === k ? '#fff' : 'var(--text-muted)', borderRadius: 20, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{employees.length}</span>}
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
