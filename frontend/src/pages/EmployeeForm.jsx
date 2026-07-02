import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';

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

const FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Bi-weekly', semimonthly: 'Semi-monthly', monthly: 'Monthly' };

const FEDERAL_HOLIDAYS = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-05-27','2024-06-19','2024-07-04','2024-09-02','2024-10-14','2024-11-11','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19','2025-07-04','2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
]);
function isBizDay(d) { const w = d.getDay(); return w !== 0 && w !== 6 && !FEDERAL_HOLIDAYS.has(d.toISOString().slice(0, 10)); }
function addBizDays(d, n) { const r = new Date(d); let added = 0; while (added < n) { r.setDate(r.getDate() + 1); if (isBizDay(r)) added++; } return r; }
function nextBizDay(d) { const r = new Date(d); while (!isBizDay(r)) r.setDate(r.getDate() + 1); return r; }
function calcDefaultPayDate(periodEnd) { if (!periodEnd) return ''; return addBizDays(new Date(periodEnd + 'T00:00:00'), 2).toISOString().slice(0, 10); }
function calcStartFromEnd(endDate, freq) {
  if (!endDate) return '';
  const e = new Date(endDate + 'T00:00:00');
  const days = { weekly: 6, biweekly: 13, semimonthly: null, monthly: null }[freq];
  if (days !== null && days !== undefined) { const s = new Date(e); s.setDate(s.getDate() - days); return s.toISOString().slice(0, 10); }
  if (freq === 'semimonthly') { return e.getDate() <= 15 ? `${endDate.slice(0, 7)}-01` : `${endDate.slice(0, 7)}-16`; }
  if (freq === 'monthly') { return `${endDate.slice(0, 7)}-01`; }
  return '';
}
function fmtDate(s) { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${m}/${d}/${y}`; }

const EMPTY = {
  firstName: '', middleName: '', lastName: '', ssn: '',
  address: '', city: '', state: 'TX', zip: '',
  workState: '',
  filingStatus: 'single', step2Checkbox: false,
  step3Children: 0, step3Other: 0,
  step4a: '', step4b: '', step4c: '',
  payType: 'hourly', hourlyRate: '', annualSalary: '',
  payFrequency: 'biweekly', payGroupId: '', hireDate: '', isActive: true,
};

export default function EmployeeForm() {
  const { id, empId } = useParams();
  const isEdit = !!empId;
  const navigate = useNavigate();
  const location = useLocation();
  const isClientMode = location.pathname.startsWith('/company/');
  const [client, setClient] = useState(null);
  const [form, setForm]     = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');

  const [showSsn, setShowSsn]           = useState(false);
  const [payGroups, setPayGroups]       = useState([]);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroup, setNewGroup]         = useState({ name: '', frequency: 'biweekly', firstPayPeriodEnd: '', payDate: '' });
  const [savingGroup, setSavingGroup]   = useState(false);

  useEffect(() => {
    api.getPayGroups(id).then(setPayGroups).catch(() => {});
  }, [id]);

  useEffect(() => {
    const tasks = [api.getClient(id)];
    if (isEdit) tasks.push(api.getEmployee(empId, true));
    Promise.all(tasks)
      .then(([c, emp]) => {
        setClient(c);
        if (emp) {
          setForm({
            firstName:  emp.firstName  || '',
            middleName: emp.middleName || '',
            lastName:   emp.lastName   || '',
            ssn: emp.ssn || '',
            address: emp.address || '', city: emp.city || '',
            state: emp.state || 'TX', zip: emp.zip || '',
            workState: emp.workState || '',
            filingStatus: emp.filingStatus || 'single',
            step2Checkbox: !!emp.step2Checkbox,
            step3Children: emp.step3Children || 0,
            step3Other:    emp.step3Other    || 0,
            step4a: emp.step4a > 0 ? String(emp.step4a) : '',
            step4b: emp.step4b > 0 ? String(emp.step4b) : '',
            step4c: emp.step4c > 0 ? String(emp.step4c) : '',
            payType: emp.payType || 'hourly',
            hourlyRate: emp.hourlyRate > 0 ? String(emp.hourlyRate) : '',
            annualSalary: emp.annualSalary > 0 ? String(emp.annualSalary) : '',
            payFrequency: emp.payFrequency || 'biweekly',
            payGroupId: emp.payGroupId ? String(emp.payGroupId) : '',
            hireDate: emp.hireDate || '',
            isActive: emp.isActive !== undefined ? emp.isActive : true,
          });
        }
      })
      .catch((err) => setApiError(err.message))
      .finally(() => setLoading(false));
  }, [id, empId, isEdit]);

  function set(field) {
    return (e) => {
      const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setForm((f) => ({ ...f, [field]: val }));
      setErrors((err) => ({ ...err, [field]: '' }));
    };
  }
  function setNG(field) { return e => setNewGroup(g => ({ ...g, [field]: e.target.value })); }
  function setNGEndDate(val) { setNewGroup(g => ({ ...g, firstPayPeriodEnd: val, payDate: val ? calcDefaultPayDate(val) : '' })); }

  function handleGroupChange(e) {
    const val = e.target.value;
    if (val === '__new__') { setShowNewGroup(true); setForm(f => ({ ...f, payGroupId: '' })); return; }
    setShowNewGroup(false);
    const g = payGroups.find(g => String(g.id) === val);
    setForm(f => ({ ...f, payGroupId: val, ...(g ? { payFrequency: g.frequency } : {}) }));
  }

  async function handleCreateGroup() {
    if (!newGroup.name.trim()) { alert('Group name required'); return; }
    setSavingGroup(true);
    try {
      const created = await api.createPayGroup({
        clientId: id, ...newGroup,
        firstPayPeriodStart: calcStartFromEnd(newGroup.firstPayPeriodEnd, newGroup.frequency) || null,
      });
      setPayGroups(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(f => ({ ...f, payGroupId: String(created.id), payFrequency: created.frequency }));
      setShowNewGroup(false);
      setNewGroup({ name: '', frequency: 'biweekly', firstPayPeriodEnd: '', payDate: '' });
    } catch (e) { alert(e.message); }
    finally { setSavingGroup(false); }
  }

  function validate() {
    const e = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim())  e.lastName  = 'Required';
    if (form.ssn && !/^\d{9}$/.test(form.ssn.replace(/\D/g, ''))) e.ssn = 'SSN must be 9 digits';
    if (form.payType === 'hourly' && form.hourlyRate && isNaN(parseFloat(form.hourlyRate))) e.hourlyRate = 'Must be a number';
    if (form.payType === 'salary' && form.annualSalary && isNaN(parseFloat(form.annualSalary))) e.annualSalary = 'Must be a number';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    setApiError('');
    try {
      const payload = {
        clientId: id,
        ...form,
        step3Children: parseInt(form.step3Children || 0),
        step3Other:    parseInt(form.step3Other    || 0),
        step4a: parseFloat(form.step4a || 0),
        step4b: parseFloat(form.step4b || 0),
        step4c: parseFloat(form.step4c || 0),
        hourlyRate:   parseFloat(form.hourlyRate   || 0),
        annualSalary: parseFloat(form.annualSalary || 0),
        payGroupId: form.payGroupId ? parseInt(form.payGroupId) : null,
      };
      if (!payload.ssn) delete payload.ssn;
      if (isEdit) {
        await api.updateEmployee(empId, payload);
      } else {
        await api.createEmployee(payload);
      }
      navigate(isClientMode ? `/company/${id}` : `/clients/${id}/employees`);
    } catch (err) {
      setApiError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          {isClientMode ? (
            <><Link to={`/company/${id}`}>{client?.businessName}</Link><span>/</span></>
          ) : (
            <><Link to="/">Dashboard</Link><span>/</span><Link to={`/clients/${id}`}>{client?.businessName}</Link><span>/</span><Link to={`/clients/${id}/employees`}>Employees</Link><span>/</span></>
          )}
          <span>{isEdit ? 'Edit Employee' : 'Add Employee'}</span>
        </div>
        <h2>{isEdit ? 'Edit Employee' : 'Add New Employee'}</h2>
        <p>{isEdit ? 'Update employee information and W-4 settings' : 'Enter employee details and withholding preferences'}</p>
      </div>

      <div className="page-body" style={{ maxWidth: 800 }}>
        {apiError && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <span>⚠</span> {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Personal Info */}
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="form-section-title" style={{ marginTop: 0 }}>Personal Information</p>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">First Name <span>*</span></label>
                <input className="form-input" value={form.firstName} onChange={set('firstName')} placeholder="Jane" />
                {errors.firstName && <p className="form-error-msg">{errors.firstName}</p>}
              </div>
              <div className="form-group">
                <label className="form-label">Middle Name / Initial <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>(optional)</span></label>
                <input className="form-input" value={form.middleName} onChange={set('middleName')} placeholder="D or Danielle" />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name <span>*</span></label>
                <input className="form-input" value={form.lastName} onChange={set('lastName')} placeholder="Smith" />
                {errors.lastName && <p className="form-error-msg">{errors.lastName}</p>}
              </div>
            </div>

            <div className="form-group" style={{ maxWidth: 280 }}>
              <label className="form-label">Social Security Number {isEdit && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(leave blank to keep current)</span>}</label>
              <div style={{ position: 'relative' }}>
                <input className="form-input mono" type={showSsn ? 'text' : 'password'} value={form.ssn} onChange={set('ssn')} placeholder="###-##-####" maxLength={11} style={{ paddingRight: 36 }} />
                <button type="button" onClick={() => setShowSsn(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1, padding: 0 }} title={showSsn ? 'Hide SSN' : 'Show SSN'}>
                  {showSsn ? '🙈' : '👁'}
                </button>
              </div>
              {errors.ssn && <p className="form-error-msg">{errors.ssn}</p>}
              <p className="form-hint">Stored encrypted with AES-256.</p>
            </div>

            <p className="form-section-title">Address</p>
            <div className="form-group">
              <label className="form-label">Street Address</label>
              <input className="form-input" value={form.address} onChange={set('address')} placeholder="123 Main St" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">City</label>
                <input className="form-input" value={form.city} onChange={set('city')} placeholder="Austin" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">State (Address)</label>
                <select className="form-select" value={form.state} onChange={set('state')}>
                  {US_STATES.map(([code]) => <option key={code} value={code}>{code}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">ZIP</label>
                <input className="form-input mono" value={form.zip} onChange={set('zip')} placeholder="78701" maxLength={10} />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 16, maxWidth: 320 }}>
              <label className="form-label">State of Work <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(for tax withholding)</span></label>
              <select className="form-select" value={form.workState} onChange={set('workState')}>
                <option value="">— Use client's state default —</option>
                {US_STATES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
              </select>
              <p className="form-hint">Override if this employee works in a different state than the business.</p>
            </div>

            <div className="form-group" style={{ marginTop: 16, maxWidth: 200 }}>
              <label className="form-label">Hire Date</label>
              <input className="form-input" type="date" value={form.hireDate} onChange={set('hireDate')} />
            </div>

            {isEdit && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.isActive} onChange={set('isActive')} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
                  <span style={{ fontSize: 13 }}>Employee is active</span>
                </label>
              </div>
            )}
          </div>

          {/* Pay settings */}
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="form-section-title" style={{ marginTop: 0 }}>Pay Settings</p>

            {/* Pay Group */}
            <div className="form-group">
              <label className="form-label">Pay Group</label>
              <select className="form-select" value={showNewGroup ? '__new__' : (form.payGroupId || '')} onChange={handleGroupChange} style={{ maxWidth: 360 }}>
                <option value="">— No pay group —</option>
                {payGroups.filter(g => !g.deletedAt).map(g => (
                  <option key={g.id} value={String(g.id)}>{g.name} ({FREQ_LABEL[g.frequency] || g.frequency})</option>
                ))}
                <option value="__new__">+ Create New Pay Group…</option>
              </select>
              {form.payGroupId && !showNewGroup && (
                <p className="form-hint">Pay frequency auto-set from group: <strong>{FREQ_LABEL[form.payFrequency] || form.payFrequency}</strong></p>
              )}
            </div>

            {showNewGroup && (
              <div style={{ background: 'var(--accent-light)', borderRadius: 8, padding: '14px 14px 10px', marginBottom: 14, border: '1px solid var(--accent-mid)' }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--accent)', marginBottom: 10, textTransform: 'uppercase' }}>New Pay Group</div>
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>Group Name</label>
                  <input className="form-input" value={newGroup.name} onChange={setNG('name')} placeholder="e.g. Biweekly 1" />
                </div>
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>Frequency</label>
                  <select className="form-select" value={newGroup.frequency} onChange={setNG('frequency')}>
                    <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
                    <option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 4 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>First Period End Date</label>
                  <input className="form-input" type="date" value={newGroup.firstPayPeriodEnd} onChange={e => setNGEndDate(e.target.value)} />
                </div>
                {newGroup.firstPayPeriodEnd && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Period starts: <strong>{fmtDate(calcStartFromEnd(newGroup.firstPayPeriodEnd, newGroup.frequency))}</strong>
                    &nbsp;·&nbsp;Default pay date: <strong>{fmtDate(calcDefaultPayDate(newGroup.firstPayPeriodEnd))}</strong>
                  </div>
                )}
                {newGroup.payDate && !isBizDay(new Date(newGroup.payDate + 'T00:00:00')) && (() => {
                  const suggested = nextBizDay(new Date(newGroup.payDate + 'T00:00:00')).toISOString().slice(0, 10);
                  return <div style={{ fontSize: 11, color: '#d97706', marginBottom: 8 }}>⚠ Weekend/holiday — suggest: <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 11, padding: 0 }} onClick={() => setNewGroup(g => ({ ...g, payDate: suggested }))}>{fmtDate(suggested)}</button></div>;
                })()}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleCreateGroup} disabled={savingGroup}>{savingGroup ? <span className="spinner" /> : 'Create & Assign'}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowNewGroup(false); setForm(f => ({ ...f, payGroupId: '' })); }}>Cancel</button>
                </div>
              </div>
            )}

            <div className="form-group" style={{ marginTop: 4 }}>
              <label className="form-label">Pay Type</label>
              <select className="form-select" value={form.payType} onChange={set('payType')} style={{ maxWidth: 220 }}>
                <option value="hourly">Hourly</option>
                <option value="salary">Salary</option>
              </select>
            </div>

            {form.payType === 'hourly' ? (
              <div className="form-group" style={{ maxWidth: 200 }}>
                <label className="form-label">Hourly Rate</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                  <input className="form-input mono" type="number" min="0" step="0.01" value={form.hourlyRate} onChange={set('hourlyRate')} placeholder="0.00" style={{ paddingLeft: 24 }} />
                </div>
                {errors.hourlyRate && <p className="form-error-msg">{errors.hourlyRate}</p>}
              </div>
            ) : (
              <div className="form-group" style={{ maxWidth: 240 }}>
                <label className="form-label">Annual Salary</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                  <input className="form-input mono" type="number" min="0" step="1000" value={form.annualSalary} onChange={set('annualSalary')} placeholder="0" style={{ paddingLeft: 24 }} />
                </div>
                {errors.annualSalary && <p className="form-error-msg">{errors.annualSalary}</p>}
              </div>
            )}
          </div>

          {/* W-4 defaults */}
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="form-section-title" style={{ marginTop: 0 }}>W-4 Withholding Defaults</p>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16 }}>
              These defaults will pre-fill the payroll entry form when this employee is selected.
            </p>

            <div className="form-group">
              <label className="form-label">Filing Status (Step 1)</label>
              <select className="form-select" value={form.filingStatus} onChange={set('filingStatus')} style={{ maxWidth: 360 }}>
                <option value="single">Single or Married filing separately</option>
                <option value="married">Married filing jointly or Qualifying surviving spouse</option>
                <option value="hoh">Head of household</option>
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" checked={form.step2Checkbox} onChange={set('step2Checkbox')} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
              <span style={{ fontSize: 13 }}>Step 2(c): Two jobs total checkbox</span>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Step 3 — Qualifying children (×$2,200)</label>
                <input className="form-input" type="number" min="0" max="20" value={form.step3Children}
                  onChange={(e) => setForm((f) => ({ ...f, step3Children: parseInt(e.target.value || 0) }))} style={{ maxWidth: 80 }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Step 3 — Other dependents (×$500)</label>
                <input className="form-input" type="number" min="0" max="20" value={form.step3Other}
                  onChange={(e) => setForm((f) => ({ ...f, step3Other: parseInt(e.target.value || 0) }))} style={{ maxWidth: 80 }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              {[
                { key: 'step4a', label: 'Step 4(a) Other income (annual)', placeholder: '0' },
                { key: 'step4b', label: 'Step 4(b) Deductions (annual)', placeholder: '0' },
                { key: 'step4c', label: 'Step 4(c) Extra withholding (per period)', placeholder: '0' },
              ].map(({ key, label, placeholder }) => (
                <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">{label}</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                    <input className="form-input mono" type="number" min="0" step="100"
                      value={form[key]} onChange={set(key)} placeholder={placeholder} style={{ paddingLeft: 24 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Link to={isClientMode ? `/company/${id}` : `/clients/${id}/employees`} className="btn btn-secondary">Cancel</Link>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : isEdit ? 'Save Changes' : 'Add Employee'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
