'use strict';
import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import ImportEmployeesModal from '../components/ImportEmployeesModal';
import ImportPaychecksModal from '../components/ImportPaychecksModal';

// ── Helpers ───────────────────────────────────────────────────────────────────
const EE_SS_RATE       = 0.062;
const EE_MEDICARE_RATE = 0.0145;

function fmt(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtShort(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtPeriod(start, end) {
  if (!start && !end) return '—';
  const s = start ? new Date(start + 'T00:00:00') : null;
  const e = end   ? new Date(end   + 'T00:00:00') : null;
  const mo = { month: 'short', day: 'numeric' };
  if (!s) return e.toLocaleDateString('en-US', mo);
  if (!e) return s.toLocaleDateString('en-US', mo);
  const sStr = s.toLocaleDateString('en-US', mo);
  const eStr = s.getMonth() === e.getMonth() ? e.getDate() : e.toLocaleDateString('en-US', mo);
  return `${sStr} – ${eStr}`;
}
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

function prevPeriod(s, e, freq) {
  if (freq === 'weekly')      return [addDays(s, -7),  addDays(e, -7)];
  if (freq === 'biweekly')    return [addDays(s, -14), addDays(e, -14)];
  if (freq === 'monthly')     return [new Date(s.getFullYear(), s.getMonth() - 1, s.getDate()), new Date(e.getFullYear(), e.getMonth() - 1, e.getDate())];
  if (freq === 'semimonthly') {
    const ne = addDays(s, -1);
    const ns = ne.getDate() === 15
      ? new Date(ne.getFullYear(), ne.getMonth(), 1)
      : new Date(ne.getFullYear(), ne.getMonth(), 16);
    return [ns, ne];
  }
  return [addDays(s, -14), addDays(e, -14)];
}

const FEDERAL_HOLIDAYS = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-05-27','2024-06-19','2024-07-04',
  '2024-09-02','2024-10-14','2024-11-11','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19','2025-07-04',
  '2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03',
  '2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-19','2027-07-05',
  '2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24',
]);
function isBizDay(d) { const w = d.getDay(); return w !== 0 && w !== 6 && !FEDERAL_HOLIDAYS.has(d.toISOString().slice(0, 10)); }
function addBizDays(d, n) { const r = new Date(d); let added = 0; while (added < n) { r.setDate(r.getDate() + 1); if (isBizDay(r)) added++; } return r; }
function nextBizDay(d) { const r = new Date(d); while (!isBizDay(r)) r.setDate(r.getDate() + 1); return r; }
function calcDefaultPayDate(periodEnd) { if (!periodEnd) return ''; return addBizDays(new Date(periodEnd + 'T00:00:00'), 2).toISOString().slice(0, 10); }
function calcStartFromEnd(endDate, freq) {
  if (!endDate) return '';
  const e = new Date(endDate + 'T00:00:00');
  let s;
  if (freq === 'weekly')        s = addDays(e, -6);
  else if (freq === 'biweekly') s = addDays(e, -13);
  else if (freq === 'monthly')  s = new Date(e.getFullYear(), e.getMonth(), 1);
  else if (freq === 'semimonthly') s = e.getDate() <= 15 ? new Date(e.getFullYear(), e.getMonth(), 1) : new Date(e.getFullYear(), e.getMonth(), 16);
  else s = addDays(e, -13);
  return s.toISOString().slice(0, 10);
}
function calcIRSDepositDue(payDate, depositSchedule) {
  if (!payDate) return '';
  const d = new Date(payDate + 'T00:00:00'), dow = d.getDay();
  let due;
  if (depositSchedule === 'semiweekly') {
    if (dow >= 3 && dow <= 5) { const n = (3 - dow + 7) % 7 || 7; due = new Date(d); due.setDate(d.getDate() + n); }
    else { const n = (5 - dow + 7) % 7 || 7; due = new Date(d); due.setDate(d.getDate() + n); }
  } else { due = new Date(d.getFullYear(), d.getMonth() + 1, 15); }
  return nextBizDay(due).toISOString().slice(0, 10);
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
  upcoming:               { label: 'Upcoming',           cls: 'badge-neutral' },
  'due-soon':             { label: 'Due Soon',           cls: 'badge-warning' },
  pending:                { label: 'Upcoming',           cls: 'badge-neutral' },
  draft:                  { label: 'Draft',              cls: 'badge-neutral' },
  printed:                { label: 'Printed',            cls: 'badge-accent' },
  direct_deposit_sent:    { label: 'Deposited',          cls: 'badge-success' },
  direct_deposit_cleared: { label: 'Deposited',          cls: 'badge-success' },
  voided:                 { label: 'VOIDED',             cls: 'badge-error' },
  late:                   { label: 'Late',               cls: 'badge-error' },
};
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, cls: 'badge-neutral' };
  return <span className={`badge ${cfg.cls}`} style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 10 }}>{cfg.label}</span>;
}

// ── Employee Drawer ───────────────────────────────────────────────────────────
function EmployeeDrawer({ clientId, empId, onClose, onSaved, onDeleted }) {
  const [form, setForm]       = useState(null);
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSsn, setShowSsn]   = useState(false);
  const [err, setErr]           = useState('');
  const [payGroups, setPayGroups] = useState([]);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', frequency: 'biweekly', firstPayPeriodEnd: '', payDate: '' });
  const [savingGroup, setSavingGroup] = useState(false);
  const [dd, setDd]             = useState(null); // { status, last4, bankAccountType, routingNumber }
  const [ddForm, setDdForm]     = useState({ routingNumber: '', accountNumber: '', confirmAccount: '', bankAccountType: 'checking' });
  const [ddEdit, setDdEdit]     = useState(false);
  const [ddSaving, setDdSaving] = useState(false);
  const [ddErr, setDdErr]       = useState('');

  useEffect(() => {
    api.getPayGroups(clientId).then(setPayGroups).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    if (!empId) return;
    api.getDirectDeposit(empId).then(setDd).catch(() => {});
    api.getEmployee(empId, true).then(emp => setForm({
      firstName: emp.firstName || '', lastName: emp.lastName || '', ssn: emp.ssn || '',
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
      payGroupId: emp.payGroupId ? String(emp.payGroupId) : '',
    })).catch(e => setErr(e.message));
  }, [empId]);

  function set(field) { return e => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm(f => ({ ...f, [field]: v })); }; }
  function setNG(field) { return e => setNewGroup(g => ({ ...g, [field]: e.target.value })); }
  function setNGEndDate(val) { setNewGroup(g => ({ ...g, firstPayPeriodEnd: val, payDate: val ? calcDefaultPayDate(val) : '' })); }

  async function handleCreateGroup() {
    if (!newGroup.name.trim()) { alert('Group name required'); return; }
    setSavingGroup(true);
    try {
      const payload = {
        clientId, ...newGroup,
        firstPayPeriodStart: calcStartFromEnd(newGroup.firstPayPeriodEnd, newGroup.frequency) || null,
      };
      const created = await api.createPayGroup(payload);
      setPayGroups(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(f => ({ ...f, payGroupId: String(created.id), payFrequency: created.frequency }));
      setShowNewGroup(false);
      setNewGroup({ name: '', frequency: 'biweekly', firstPayPeriodEnd: '', payDate: '' });
    } catch (e) { alert(e.message); }
    finally { setSavingGroup(false); }
  }

  function handleGroupChange(e) {
    const val = e.target.value;
    if (val === '__new__') { setShowNewGroup(true); setForm(f => ({ ...f, payGroupId: '' })); return; }
    setShowNewGroup(false);
    const targetGroup = payGroups.find(g => String(g.id) === val);
    // Date consistency check: employee's current group end must match target group's end
    if (targetGroup && targetGroup.firstPayPeriodEnd) {
      const currentGroupObj = payGroups.find(g => String(g.id) === form.payGroupId);
      const empEnd = currentGroupObj?.firstPayPeriodEnd;
      if (empEnd && empEnd !== targetGroup.firstPayPeriodEnd) {
        setErr(`Cannot assign to "${targetGroup.name}". The group's first period end date (${fmtDate(targetGroup.firstPayPeriodEnd)}) does not match this employee's current group (${fmtDate(empEnd)}). All employees in a pay group must share the same pay period schedule.`);
        return;
      }
    }
    setErr('');
    setForm(f => ({ ...f, payGroupId: val, ...(targetGroup ? { payFrequency: targetGroup.frequency } : {}) }));
  }

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      const payload = { clientId, ...form,
        step3Children: parseInt(form.step3Children || 0), step3Other: parseInt(form.step3Other || 0),
        step4a: parseFloat(form.step4a || 0), step4b: parseFloat(form.step4b || 0), step4c: parseFloat(form.step4c || 0),
        hourlyRate: parseFloat(form.hourlyRate || 0), annualSalary: parseFloat(form.annualSalary || 0),
        payGroupId: form.payGroupId ? parseInt(form.payGroupId) : null,
      };
      if (!payload.ssn) delete payload.ssn;
      await api.updateEmployee(empId, payload);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function handleSaveDd() {
    if (ddForm.accountNumber !== ddForm.confirmAccount) { setDdErr('Account numbers do not match'); return; }
    if (!/^\d{9}$/.test(ddForm.routingNumber)) { setDdErr('Routing number must be 9 digits'); return; }
    if (!/^\d{4,17}$/.test(ddForm.accountNumber)) { setDdErr('Account number must be 4–17 digits'); return; }
    setDdSaving(true); setDdErr('');
    try {
      const result = await api.saveDirectDeposit(empId, { routingNumber: ddForm.routingNumber, accountNumber: ddForm.accountNumber, bankAccountType: ddForm.bankAccountType });
      setDd(result);
      setDdEdit(false);
      setDdForm({ routingNumber: '', accountNumber: '', confirmAccount: '', bankAccountType: 'checking' });
    } catch (e) { setDdErr(e.message); }
    finally { setDdSaving(false); }
  }

  async function handleRemoveDd() {
    if (!window.confirm('Remove direct deposit bank account for this employee?')) return;
    setDdSaving(true);
    try {
      const result = await api.deleteDirectDeposit(empId);
      setDd(result);
      setDdEdit(false);
    } catch (e) { setDdErr(e.message); }
    finally { setDdSaving(false); }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${form?.firstName} ${form?.lastName}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteEmployee(empId);
      onDeleted?.();
    } catch (e) { setErr(e.message); setDeleting(false); }
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
                <div style={{ position: 'relative' }}>
                  <input className="form-input mono" type={showSsn ? 'text' : 'password'} value={form.ssn} onChange={set('ssn')} placeholder="leave blank to keep" maxLength={11} style={{ paddingRight: 36 }} />
                  <button type="button" onClick={() => setShowSsn(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1, padding: 0 }} title={showSsn ? 'Hide SSN' : 'Show SSN'}>
                    {showSsn ? '🙈' : '👁'}
                  </button>
                </div>
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

              <p className="form-section-title">Pay Group</p>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Assigned Pay Group</label>
                <select className="form-select" value={showNewGroup ? '__new__' : (form.payGroupId || '')} onChange={handleGroupChange}>
                  <option value="">— No pay group —</option>
                  {payGroups.filter(g => !g.deletedAt).map(g => <option key={g.id} value={String(g.id)}>{g.name} ({FREQ_LABEL[g.frequency] || g.frequency})</option>)}
                  <option value="__new__">+ Create New Pay Group…</option>
                </select>
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
                      Period will start: <strong>{fmtDate(calcStartFromEnd(newGroup.firstPayPeriodEnd, newGroup.frequency))}</strong>
                    </div>
                  )}
                  <div className="form-group" style={{ marginBottom: 4 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Pay Date</label>
                    <input className="form-input" type="date" value={newGroup.payDate} onChange={e => setNewGroup(g => ({ ...g, payDate: e.target.value }))} />
                  </div>
                  {newGroup.firstPayPeriodEnd && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      Default (2 biz days after period end): <strong>{fmtDate(calcDefaultPayDate(newGroup.firstPayPeriodEnd))}</strong>
                    </div>
                  )}
                  {newGroup.payDate && !isBizDay(new Date(newGroup.payDate + 'T00:00:00')) && (() => {
                    const suggested = nextBizDay(new Date(newGroup.payDate + 'T00:00:00')).toISOString().slice(0, 10);
                    return (
                      <div style={{ fontSize: 11, color: '#d97706', marginBottom: 10 }}>
                        ⚠ Weekend or holiday — suggest: <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 11, padding: 0 }} onClick={() => setNewGroup(g => ({ ...g, payDate: suggested }))}>{fmtDate(suggested)}</button>
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn btn-primary btn-sm" onClick={handleCreateGroup} disabled={savingGroup}>{savingGroup ? <span className="spinner" /> : 'Create & Assign'}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setShowNewGroup(false); setForm(f => ({ ...f, payGroupId: '' })); }}>Cancel</button>
                  </div>
                </div>
              )}

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
                  {form.payGroupId && <p className="form-hint">Auto-set from pay group. Override if different.</p>}
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

              {/* ── Direct Deposit ── */}
              <p className="form-section-title">Direct Deposit</p>
              {dd && (
                <div style={{ marginBottom: 16 }}>
                  {/* Status badge + info */}
                  {dd.status === 'active' && !ddEdit && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#16a34a' }}>✓ Active — Direct Deposit Enabled</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {dd.bankAccountType === 'savings' ? 'Savings' : 'Checking'} ···· {dd.last4}
                          {dd.routingNumber && <span style={{ marginLeft: 10 }}>Routing: {dd.routingNumber}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => { setDdEdit(true); setDdErr(''); }}>Change</button>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#dc2626' }} onClick={handleRemoveDd} disabled={ddSaving}>Remove</button>
                      </div>
                    </div>
                  )}
                  {dd.status === 'pending' && !ddEdit && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#d97706' }}>⏳ Pending — Bank account saved, not yet verified with Moov</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{dd.bankAccountType} ···· {dd.last4}</div>
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={async () => { setDdSaving(true); setDdErr(''); try { const r = await api.activateDirectDeposit(empId); setDd(r); } catch(e) { setDdErr(e.message); } finally { setDdSaving(false); } }} disabled={ddSaving}>{ddSaving ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Retry Moov Connection'}</button>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => { setDdEdit(true); setDdErr(''); }}>Change Account</button>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#dc2626' }} onClick={handleRemoveDd} disabled={ddSaving}>Remove</button>
                      </div>
                    </div>
                  )}
                  {dd.status === 'failed' && !ddEdit && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#dc2626' }}>✗ Failed — Moov rejected the bank account</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{dd.bankAccountType} ···· {dd.last4}</div>
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={() => { setDdEdit(true); setDdErr(''); }}>Enter New Account</button>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#dc2626' }} onClick={handleRemoveDd} disabled={ddSaving}>Remove</button>
                      </div>
                    </div>
                  )}
                  {dd.status === 'none' && !ddEdit && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not set up</div>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => { setDdEdit(true); setDdErr(''); }}>+ Set Up Direct Deposit</button>
                    </div>
                  )}

                  {/* Bank account form */}
                  {ddEdit && (
                    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 14px 10px', marginTop: dd.status !== 'none' ? 12 : 0 }}>
                      {ddErr && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}><span>⚠</span>{ddErr}</div>}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: 11 }}>Routing Number</label>
                          <input className="form-input mono" type="text" inputMode="numeric" maxLength={9} value={ddForm.routingNumber}
                            onChange={e => setDdForm(f => ({ ...f, routingNumber: e.target.value.replace(/\D/g, '') }))}
                            placeholder="9 digits" style={{ height: 32, fontSize: 13 }} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: 11 }}>Account Type</label>
                          <select className="form-select" value={ddForm.bankAccountType} onChange={e => setDdForm(f => ({ ...f, bankAccountType: e.target.value }))} style={{ height: 32, fontSize: 13 }}>
                            <option value="checking">Checking</option>
                            <option value="savings">Savings</option>
                          </select>
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 10 }}>
                        <label className="form-label" style={{ fontSize: 11 }}>Account Number</label>
                        <input className="form-input mono" type="password" value={ddForm.accountNumber}
                          onChange={e => setDdForm(f => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') }))}
                          placeholder="Account number" style={{ height: 32, fontSize: 13 }} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 12 }}>
                        <label className="form-label" style={{ fontSize: 11 }}>Confirm Account Number</label>
                        <input className="form-input mono" type="text" value={ddForm.confirmAccount}
                          onChange={e => setDdForm(f => ({ ...f, confirmAccount: e.target.value.replace(/\D/g, '') }))}
                          placeholder="Re-enter account number" style={{ height: 32, fontSize: 13 }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={handleSaveDd} disabled={ddSaving} style={{ fontSize: 12 }}>
                          {ddSaving ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Save & Connect'}
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => { setDdEdit(false); setDdErr(''); }}>Cancel</button>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Account info is encrypted with AES-256. Linked via Moov ACH.</p>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.isActive} onChange={set('isActive')} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                  <span style={{ fontSize: 13 }}>Employee is active</span>
                </label>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{ fontSize: 12 }}
                >
                  {deleting ? <span className="spinner" /> : 'Delete Employee'}
                </button>
              </div>
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

// ── Row background by check status ───────────────────────────────────────────
function checkRowBg(status, selected) {
  if (selected) return '#e8f5ee';
  if (status === 'voided')                 return '#fef2f2';
  if (status === 'draft')                  return '#fffbeb';
  if (status === 'printed')               return '#f0fdf4';
  if (status === 'direct_deposit_sent')    return '#f0f9ff';
  if (status === 'direct_deposit_cleared') return '#f0fdf4';
  if (status === 'late')                   return '#fff7ed';
  return '#fff';
}

// ── Check History (per employee in Pay Employees) ─────────────────────────────
function CheckHistory({ clientId, employeeId, employeeName, selectedChecks, onToggleCheck, onChecksLoaded, onVoidCheck, onDeleteCheck }) {
  const [checks, setChecks]     = useState(null);
  const [actioning, setActioning] = useState(null); // stub.id being actioned
  const [err, setErr]           = useState('');

  useEffect(() => {
    api.getPaystubsByEmployee(clientId, employeeId)
      .then(data => { setChecks(data); onChecksLoaded?.(employeeId, data); })
      .catch(e => setErr(e.message));
  }, [clientId, employeeId]);

  async function handleVoid(stub) {
    const reason = window.prompt(`Void check #${stub.check_number || stub.id} for ${employeeName}?\n\nReason (optional):`);
    if (reason === null) return;
    setActioning(stub.id);
    try {
      await api.voidPaystub(stub.id, reason);
      const updated = checks.map(c => c.id === stub.id ? { ...c, check_status: 'voided' } : c);
      setChecks(updated);
      onChecksLoaded?.(employeeId, updated);
      onVoidCheck?.(stub.id);
    } catch (e) { alert(e.message); }
    finally { setActioning(null); }
  }

  async function handleDelete(stub) {
    if (!window.confirm(`Are you sure you want to delete this check?\n\nThis will reverse all associated tax liabilities.\n\nCheck #${stub.check_number || stub.id} · ${employeeName} · ${fmt(stub.net_pay)}`)) return;
    setActioning(stub.id);
    try {
      await api.deletePaystub(stub.id);
      const updated = checks.filter(c => c.id !== stub.id);
      setChecks(updated);
      onChecksLoaded?.(employeeId, updated);
      onDeleteCheck?.(stub.id);
    } catch (e) { alert(e.message); }
    finally { setActioning(null); }
  }

  if (checks === null) return <div style={{ padding: '12px 0', textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 18, height: 18, display: 'inline-block' }} /></div>;
  if (err) return <div style={{ color: '#dc2626', fontSize: 12, padding: '8px 0' }}>{err}</div>;
  if (checks.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0', fontStyle: 'italic' }}>No checks issued yet.</div>;

  const allSelectableIds = checks.filter(c => c.check_status !== 'voided' && c.check_status !== 'direct_deposit_cleared').map(c => c.id);
  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every(id => selectedChecks?.has(id));

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Check History</div>
      <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)' }}>
              <th style={{ padding: '6px 8px', width: 32 }}>
                <input type="checkbox" checked={allSelected} onChange={e => allSelectableIds.forEach(id => { if (e.target.checked !== (selectedChecks?.has(id) ?? false)) onToggleCheck?.(id); })} style={{ accentColor: 'var(--accent)', width: 13, height: 13 }} />
              </th>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Check #</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Period</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Gross</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Net Pay</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Status</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>EFTPS Due</th>
              <th style={{ padding: '6px 8px', width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => {
              const voided   = c.check_status === 'voided';
              const isDraft  = !c.check_status || c.check_status === 'draft';
              const dueDays  = daysUntil(c.settlement_due_date);
              const isSel    = selectedChecks?.has(c.id) ?? false;
              const canSel   = !voided && c.check_status !== 'direct_deposit_cleared';
              const busy     = actioning === c.id;
              return (
                <tr key={c.id} style={{ background: checkRowBg(c.check_status, isSel), borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 8px' }}>
                    {canSel && <input type="checkbox" checked={isSel} onChange={() => onToggleCheck?.(c.id)} style={{ accentColor: 'var(--accent)', width: 13, height: 13 }} />}
                  </td>
                  <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: voided ? '#dc2626' : 'var(--accent)', textDecoration: voided ? 'line-through' : 'none' }}>
                    {c.check_number ? `#${c.check_number}` : isDraft ? <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>Draft</span> : '—'}
                  </td>
                  <td style={{ padding: '7px 8px', color: 'var(--text-secondary)', textDecoration: voided ? 'line-through' : 'none' }}>
                    {c.pay_period_start} – {c.pay_period_end}
                  </td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', textDecoration: voided ? 'line-through' : 'none' }}>{fmt(c.gross_wages)}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: voided ? '#dc2626' : 'var(--success)', fontWeight: 600, textDecoration: voided ? 'line-through' : 'none' }}>
                    {voided ? `(${fmt(c.net_pay)})` : fmt(c.net_pay)}
                  </td>
                  <td style={{ padding: '7px 8px' }}><StatusBadge status={c.check_status || 'draft'} /></td>
                  <td style={{ padding: '7px 8px', fontSize: 11, color: isOverdue(c.settlement_due_date) ? '#dc2626' : dueDays !== null && dueDays <= 5 ? '#d97706' : 'var(--text-muted)', fontWeight: isOverdue(c.settlement_due_date) ? 700 : 400 }}>
                    {c.settlement_due_date ? (
                      <>{fmtDate(c.settlement_due_date)}{isOverdue(c.settlement_due_date) && <span style={{ marginLeft: 4 }}>({Math.abs(dueDays)}d overdue)</span>}</>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '7px 8px' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {c.check_status === 'draft' && (
                        <Link to={`/clients/${clientId}/paystubs/${c.id}/edit`} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Edit</Link>
                      )}
                      {!voided && (
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#dc2626', opacity: busy ? 0.5 : 1 }} onClick={() => handleVoid(c)} disabled={busy}>
                          {busy ? '…' : 'Void'}
                        </button>
                      )}
                      {!voided && (
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#6b7280', opacity: busy ? 0.5 : 1 }} onClick={() => handleDelete(c)} disabled={busy} title="Delete check and reverse tax liabilities">
                          {busy ? '…' : 'Del'}
                        </button>
                      )}
                    </div>
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

// ── Pay Group Editor Modal ────────────────────────────────────────────────────
function PayGroupEditorModal({ group, clientId, allGroups, onSaved, onClose, onDeleted, onMoved }) {
  const [form, setForm] = useState({
    name: group.name,
    frequency: group.frequency,
    firstPayPeriodEnd: group.firstPayPeriodEnd || '',
    payDate: group.payDate || (group.firstPayPeriodEnd ? calcDefaultPayDate(group.firstPayPeriodEnd) : ''),
  });
  const [employees, setEmployees] = useState(null);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [err, setErr]             = useState('');
  const [showPeriods, setShowPeriods] = useState(false);

  const computedStart = calcStartFromEnd(form.firstPayPeriodEnd, form.frequency);
  const autoPayDate   = form.firstPayPeriodEnd ? calcDefaultPayDate(form.firstPayPeriodEnd) : '';
  const payDateInvalid = form.payDate && !isBizDay(new Date(form.payDate + 'T00:00:00'));
  const payDateSuggested = payDateInvalid ? nextBizDay(new Date(form.payDate + 'T00:00:00')).toISOString().slice(0, 10) : null;

  useEffect(() => {
    api.getPayGroupEmployees(group.id).then(setEmployees).catch(() => setEmployees([]));
  }, [group.id]);

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }
  function handleEndChange(val) { setForm(f => ({ ...f, firstPayPeriodEnd: val, payDate: val ? calcDefaultPayDate(val) : '' })); }

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      await api.updatePayGroup(group.id, {
        ...form,
        firstPayPeriodStart: computedStart || null,
        firstPayPeriodEnd: form.firstPayPeriodEnd || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function handleMoveEmployee(emp, newGroupId) {
    const targetGroup = newGroupId ? allGroups.find(g => String(g.id) === String(newGroupId)) : null;
    if (targetGroup && targetGroup.firstPayPeriodEnd && group.firstPayPeriodEnd &&
        targetGroup.firstPayPeriodEnd !== group.firstPayPeriodEnd) {
      alert(`Cannot move ${emp.firstName} ${emp.lastName} to "${targetGroup.name}". The group's first period end date (${fmtDate(targetGroup.firstPayPeriodEnd)}) does not match this group's (${fmtDate(group.firstPayPeriodEnd)}). All employees in a pay group must share the same pay period schedule.`);
      return;
    }
    try {
      await api.updateEmployee(emp.id, { clientId, payGroupId: newGroupId ? parseInt(newGroupId) : null });
      setEmployees(prev => prev.filter(e => e.id !== emp.id));
      onMoved?.();
    } catch (e) { alert(e.message); }
  }

  async function handleDeleteGroup() {
    if (!window.confirm(
      `Deleting this pay group will unassign all employees from it. Their paycheck history will be preserved. Continue?`
    )) return;
    setDeleting(true); setErr('');
    try {
      await api.deletePayGroup(group.id);
      onDeleted?.();
    } catch (e) { setErr(e.message); setDeleting(false); }
  }

  const upcomingPeriods = computedStart && form.firstPayPeriodEnd
    ? calcUpcomingPeriods(computedStart, form.firstPayPeriodEnd, form.frequency, 6)
    : [];

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" style={{ width: 520 }}>
        <div className="drawer-header">
          <div className="drawer-title">Edit Pay Group</div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          {err && <div className="alert alert-error" style={{ marginBottom: 14 }}><span>⚠</span>{err}</div>}

          <p className="form-section-title" style={{ marginTop: 0 }}>Group Details</p>
          <div className="form-group"><label className="form-label">Group Name</label><input className="form-input" value={form.name} onChange={set('name')} /></div>
          <div className="form-group">
            <label className="form-label">Pay Frequency</label>
            <select className="form-select" value={form.frequency} onChange={set('frequency')}>
              <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
              <option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 4 }}>
            <label className="form-label">First Period End Date</label>
            <input className="form-input" type="date" value={form.firstPayPeriodEnd} onChange={e => handleEndChange(e.target.value)} />
          </div>
          {computedStart && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Period will start: <strong>{fmtDate(computedStart)}</strong>
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 4 }}>
            <label className="form-label">Pay Date</label>
            <input className="form-input" type="date" value={form.payDate} onChange={set('payDate')} />
          </div>
          {autoPayDate && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              Default (2 business days after period end): <strong>{fmtDate(autoPayDate)}</strong>
            </div>
          )}
          {payDateInvalid && (
            <div style={{ fontSize: 12, color: '#d97706', marginBottom: 14 }}>
              ⚠ Falls on a weekend or holiday — suggest:{' '}
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 12, padding: 0 }} onClick={() => setForm(f => ({ ...f, payDate: payDateSuggested }))}>
                {fmtDate(payDateSuggested)}
              </button>
            </div>
          )}

          {upcomingPeriods.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, color: 'var(--accent)', padding: '4px 0' }} onClick={() => setShowPeriods(p => !p)}>
                {showPeriods ? '▲ Hide' : '▼ Show'} upcoming periods
              </button>
              {showPeriods && (
                <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)', marginTop: 6 }}>
                  {upcomingPeriods.map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid var(--border)', background: p.overdue ? '#fef2f2' : i % 2 === 0 ? '#fff' : 'var(--bg-secondary)' }}>
                      <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: p.overdue ? '#dc2626' : 'var(--text-primary)' }}>{fmtDate(p.start)} – {fmtDate(p.end)}</span>
                      {p.overdue && <span className="badge badge-error" style={{ fontSize: 10 }}>Overdue</span>}
                      {!p.overdue && i === 0 && <span className="badge badge-warning" style={{ fontSize: 10 }}>Current</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="form-section-title">Employees in This Group ({employees ? employees.length : '…'})</p>
          {employees === null ? (
            <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner spinner-dark" style={{ width: 20, height: 20, display: 'inline-block' }} /></div>
          ) : employees.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>No employees assigned to this group.</div>
          ) : (
            <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {employees.map((emp, i) => (
                <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', background: i % 2 === 0 ? '#fff' : 'var(--bg-secondary)' }}>
                  <div className="emp-avatar" style={{ width: 28, height: 28, fontSize: 10, flexShrink: 0 }}>{initials(`${emp.firstName} ${emp.lastName}`)}</div>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{emp.firstName} {emp.lastName}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Move to:</span>
                    <select style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: '#fff' }}
                      defaultValue=""
                      onChange={e => { if (e.target.value) handleMoveEmployee(emp, e.target.value === '__none__' ? null : e.target.value); }}>
                      <option value="">— select —</option>
                      <option value="__none__">Remove from group</option>
                      {allGroups.filter(g => g.id !== group.id && !g.deletedAt).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="drawer-footer">
          <button className="btn btn-ghost" style={{ color: '#dc2626', marginRight: 'auto' }} onClick={handleDeleteGroup} disabled={deleting || saving}>
            {deleting ? <span className="spinner" /> : '🗑 Delete Group'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || deleting}>{saving ? <span className="spinner" /> : 'Save Changes'}</button>
        </div>
      </div>
    </>
  );
}

// ── Employees Tab ─────────────────────────────────────────────────────────────
function EmployeesTab({ clientId, employees, onRefresh }) {
  const [drawerEmpId, setDrawerEmpId]     = useState(null);
  const [editGroup, setEditGroup]         = useState(null);
  const [payGroups, setPayGroups]         = useState([]);
  const [showImport, setShowImport]       = useState(false);

  useEffect(() => {
    api.getPayGroups(clientId).then(setPayGroups).catch(() => {});
  }, [clientId]);

  function handleGroupSaved() { setEditGroup(null); onRefresh(); api.getPayGroups(clientId).then(setPayGroups); }


  return (
    <div>
      {showImport && (
        <ImportEmployeesModal
          clientId={clientId}
          onClose={() => setShowImport(false)}
          onImported={() => { onRefresh(); }}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-secondary" onClick={() => setShowImport(true)}>Import from Excel</button>
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
            const groupObj = payGroups.find(g => g.id === emp.payGroupId);
            return (
              <div key={emp.id} className="emp-row" onClick={() => setDrawerEmpId(emp.id)}>
                <div className="emp-avatar">{initials(`${emp.firstName} ${emp.lastName}`)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="emp-name">{emp.firstName} {emp.lastName}</div>
                  <div className="emp-meta" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{emp.workState || 'TX'} · {isSalary ? 'Salary' : 'Hourly'}</span>
                    {emp.payGroupName ? (
                      <button
                        onClick={e => { e.stopPropagation(); const g = groupObj || { id: emp.payGroupId, name: emp.payGroupName, frequency: emp.payGroupFrequency || emp.payFrequency, firstPayPeriodStart: emp.payGroupFirstStart, firstPayPeriodEnd: emp.payGroupFirstEnd }; setEditGroup(g); }}
                        style={{ background: 'var(--accent-light)', border: 'none', borderRadius: 4, padding: '1px 7px', fontSize: 11, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
                      >
                        {emp.payGroupName}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>No pay group</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{rate}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{emp.filingStatus === 'married' ? 'Married' : emp.filingStatus === 'hoh' ? 'HoH' : 'Single'}</div>
                </div>
                <span className={`badge ${emp.isActive !== false ? 'badge-success' : 'badge-neutral'}`}>{emp.isActive !== false ? 'Active' : 'Inactive'}</span>
                {emp.directDeposit?.status === 'active' && <span className="badge" style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: 10, fontWeight: 700 }}>DD</span>}
                <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
              </div>
            );
          })}
        </div>
      )}
      {drawerEmpId && (
        <EmployeeDrawer clientId={clientId} empId={drawerEmpId} onClose={() => setDrawerEmpId(null)} onSaved={() => { setDrawerEmpId(null); onRefresh(); }} onDeleted={() => { setDrawerEmpId(null); onRefresh(); }} />
      )}
      {editGroup && (
        <PayGroupEditorModal group={editGroup} clientId={clientId} allGroups={payGroups} onSaved={handleGroupSaved} onClose={() => setEditGroup(null)} onDeleted={handleGroupSaved} onMoved={onRefresh} />
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
      suiRateQ1: client.suiRateQ1 != null ? String(parseFloat(client.suiRateQ1) * 100) : '',
      suiRateQ2: client.suiRateQ2 != null ? String(parseFloat(client.suiRateQ2) * 100) : '',
      suiRateQ3: client.suiRateQ3 != null ? String(parseFloat(client.suiRateQ3) * 100) : '',
      suiRateQ4: client.suiRateQ4 != null ? String(parseFloat(client.suiRateQ4) * 100) : '',
      suiAccountNumber: client.suiAccountNumber || '',
      bankRoutingNumber: client.bankRoutingNumber || '',
      bankAccountType: client.bankAccountType || 'checking',
      bankAccountNumber: '', batchProviderPin: '',
      twcUsername: client.twcUsername || '', twcPassword: '',
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
      const payload = {
        ...form,
        suiRateQ1: form.suiRateQ1 ? parseFloat(form.suiRateQ1) / 100 : null,
        suiRateQ2: form.suiRateQ2 ? parseFloat(form.suiRateQ2) / 100 : null,
        suiRateQ3: form.suiRateQ3 ? parseFloat(form.suiRateQ3) / 100 : null,
        suiRateQ4: form.suiRateQ4 ? parseFloat(form.suiRateQ4) / 100 : null,
        suiAccountNumber: form.suiAccountNumber || null,
      };
      if (!payload.bankAccountNumber) delete payload.bankAccountNumber;
      if (!payload.batchProviderPin) delete payload.batchProviderPin;
      if (!payload.twcPassword) delete payload.twcPassword;
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
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          {[['Q1','suiRateQ1'],['Q2','suiRateQ2'],['Q3','suiRateQ3'],['Q4','suiRateQ4']].map(([q, key]) => (
            <F key={q} label={`SUI Rate ${q} (%)`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="form-input mono" type="number" min="0" max="20" step="0.001" value={form[key]} onChange={set(key)} style={{ maxWidth: 120 }} placeholder="e.g. 0.32" />
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>%</span>
              </div>
            </F>
          ))}
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
        <p className="form-section-title" style={{ marginTop: 0 }}>TWC (Texas SUI) Credentials</p>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          UTS portal login at apps.twc.texas.gov — used to automate quarterly SUI filing and payment.
        </div>
        <F label="TWC Account Number" hint="Your TWC unemployment tax account number (e.g. 10-818766-2). Printed on SUI report.">
          <input className="form-input mono" value={form.suiAccountNumber} onChange={set('suiAccountNumber')} placeholder="##-######-#" />
        </F>
        <div className="form-grid">
          <F label="TWC Username"><input className="form-input mono" value={form.twcUsername} onChange={set('twcUsername')} placeholder="UTS username" autoComplete="off" /></F>
          <F label="TWC Password" hint="Stored encrypted. Leave blank to keep current."><input className="form-input mono" type="password" value={form.twcPassword} onChange={set('twcPassword')} placeholder="(leave blank to keep)" autoComplete="new-password" /></F>
        </div>
        {client.hasTwcPassword && !form.twcPassword && (
          <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}>✓ Password saved</div>
        )}
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

// ── Pay Employees Tab ─────────────────────────────────────────────────────────
function PayEmployeesTab({ clientId, client, employees, onRefresh, refreshTick = 0 }) {
  const [showPaycheckImport, setShowPaycheckImport] = useState(false);
  const [payGroups, setPayGroups]     = useState([]);
  const [currentGroupId, setCurrentGroupId] = useState(null);
  const [groupsLoading, setGroupsLoading]   = useState(true);
  const [editGroup, setEditGroup]     = useState(null);
  const [paystubs, setPaystubs]                   = useState([]);
  // pendingRows[periodEnd][empId] = { regHours, otHours, rate, selected }
  const [pendingRows, setPendingRows] = useState(() => {
    try { const s = localStorage.getItem(`pendingRows_${clientId}`); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(`pendingRows_${clientId}`, JSON.stringify(pendingRows)); } catch {}
  }, [pendingRows, clientId]);
  const [rateUpdatePrompt, setRateUpdatePrompt]   = useState(null); // { empId, newRate, periodEnd }
  const [selectedLateStubs, setSelectedLateStubs]     = useState(new Set());
  const [selectedHistoryStubs, setSelectedHistoryStubs] = useState(new Set());
  const [bulkBusy, setBulkBusy]                       = useState(false);
  const [running, setRunning]                         = useState(false);
  const [runErr, setRunErr]                       = useState('');
  const [runSuccess, setRunSuccess]               = useState('');
  const [detailModal, setDetailModal]             = useState(null); // rowData object
  const [showPrinted, setShowPrinted]             = useState(false);
  const [printModal, setPrintModal]               = useState(null); // { ids: [], mode: 'paycheck'|'paystub' }
  const [drawerEmpId, setDrawerEmpId]             = useState(null);
  const [periodEdit, setPeriodEdit]               = useState(null); // { id, start, end, payDate }
  const [savingPeriod, setSavingPeriod]           = useState(false);
  const [empStatusDrop, setEmpStatusDrop]         = useState(null); // { stub, top, right }
  const [periodOverrides, setPeriodOverrides]     = useState(() => { // { [periodEnd]: { start, end, payDate } }
    try { const s = localStorage.getItem(`periodOverrides_${clientId}`); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(`periodOverrides_${clientId}`, JSON.stringify(periodOverrides)); } catch {}
  }, [periodOverrides, clientId]);
  const [ungroupedModal, setUngroupedModal]       = useState(false);
  const [ugForm, setUgForm]                       = useState({ employeeId: '', start: '', end: '', payDate: '', regHours: '', otHours: '', rate: '', payType: 'regular', tips: '', bonus: '', commission: '', cashAdvance: '', mileage: '' });
  const [ugOtherOpen, setUgOtherOpen]             = useState(false);
  const [ugPreview, setUgPreview]                 = useState(null); // calculated check data before committing
  const [ugRunning, setUgRunning]                 = useState(false);
  const [ugErr, setUgErr]                         = useState('');

  useEffect(() => {
    api.getPayGroups(clientId)
      .then(groups => {
        setPayGroups(groups);
        if (groups.length > 0) setCurrentGroupId(prev => prev ?? groups[0].id);
      })
      .catch(() => {})
      .finally(() => setGroupsLoading(false));
  }, [clientId, refreshTick]);

  useEffect(() => {
    // Sweep draft checks with a past pay date → 'late' in the DB, then reload.
    api.markLateChecks().catch(() => {}).finally(reloadStubs);
  }, [clientId, refreshTick]);

  async function reloadStubs() {
    try { setPaystubs(await api.getPaystubs(clientId)); } catch {}
  }

  const activeEmps    = employees.filter(e => e.isActive);
  const UNASSIGNED_ID = '__unassigned__';
  const currentGroup  = payGroups.find(g => g.id === currentGroupId) || null;
  const unassignedEmps = activeEmps.filter(e => !e.payGroupId);
  const empsInGroup   = currentGroupId === UNASSIGNED_ID
    ? unassignedEmps
    : activeEmps.filter(e => e.payGroupId === currentGroupId);
  const isGroupDeleted = currentGroup ? !!currentGroup.deletedAt : false;

  const tabs = [
    ...payGroups,
    ...(unassignedEmps.length > 0 ? [{ id: UNASSIGNED_ID, name: `Unassigned (${unassignedEmps.length})`, frequency: 'biweekly' }] : []),
  ];

  // Returns ALL unpaid periods from the anchor: late periods (pay date passed) first,
  // then at most one upcoming period (pay date in the future).
  function getPendingPeriods() {
    const g = currentGroup;
    if (!g || g.id === UNASSIGNED_ID || !g.firstPayPeriodEnd || g.deletedAt) return [];
    const anchor = g.firstPayPeriodStart || calcStartFromEnd(g.firstPayPeriodEnd, g.frequency);
    if (!anchor) return [];
    const freq = g.frequency || 'biweekly';

    // Consistent with getHistory: prefer pay_group_id filter, fall back to employee_id
    const byGroupId = paystubs.filter(s => s.pay_group_id === currentGroupId && s.check_status !== 'voided');
    const groupStubs = byGroupId.length > 0 ? byGroupId : (() => {
      const empIds = new Set(empsInGroup.map(e => e.id));
      return paystubs.filter(s => s.employee_id && empIds.has(s.employee_id) && s.check_status !== 'voided');
    })();

    const paidEnds = new Set(groupStubs.map(s => s.pay_period_end));
    const todayStr = new Date().toISOString().slice(0, 10);

    // Compute calendar-day offset between configured payDate and firstPayPeriodEnd
    // so subsequent periods inherit the same offset (e.g. if group payDate is 2 days after period end, keep that pattern)
    const configuredPayDateOffset = (g.payDate && g.firstPayPeriodEnd)
      ? Math.round((new Date(g.payDate + 'T00:00:00') - new Date(g.firstPayPeriodEnd + 'T00:00:00')) / 86400000)
      : null;

    function calcGroupPayDate(endStr) {
      if (configuredPayDateOffset === null) return calcDefaultPayDate(endStr);
      const d = new Date(endStr + 'T00:00:00');
      d.setDate(d.getDate() + configuredPayDateOffset);
      // Push forward past weekends
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }

    let s = new Date(anchor + 'T00:00:00'), e = new Date(g.firstPayPeriodEnd + 'T00:00:00');
    const pending = [];
    let nonLateCount = 0;
    for (let i = 0; i < 60; i++) {
      const endStr = e.toISOString().slice(0, 10);
      if (!paidEnds.has(endStr)) {
        const payDate = calcGroupPayDate(endStr);
        const isLate = payDate < todayStr;
        pending.push({ start: s.toISOString().slice(0, 10), end: endStr, payDate, isLate });
        if (!isLate) {
          nonLateCount++;
          if (nonLateCount >= 1) break;
        }
      }
      [s, e] = advancePeriod(s, e, freq);
    }
    return pending;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const curYear  = new Date().getFullYear();
  const ppy = PERIODS_PER_YEAR[currentGroup?.frequency || 'biweekly'] || 26;

  // YTD aggregation from loaded paystubs (up to and including upToEnd)
  function calcEmpYTD(employeeId, upToEnd) {
    const stubs = paystubs.filter(s =>
      // eslint-disable-next-line eqeqeq
      s.employee_id == employeeId &&
      s.check_status !== 'voided' &&
      // eslint-disable-next-line eqeqeq
      (s.tax_year == curYear || (s.pay_period_end || '').startsWith(String(curYear))) &&
      (!upToEnd || s.pay_period_end <= upToEnd)
    );
    return {
      gross:      stubs.reduce((n, s) => n + (s.gross_wages        || 0), 0),
      fit:        stubs.reduce((n, s) => n + (s.fit_withholding    || 0), 0),
      eeSS:       stubs.reduce((n, s) => n + (s.employee_ss        || 0), 0),
      eeMed:      stubs.reduce((n, s) => n + (s.employee_medicare  || 0), 0),
      stateTax:   stubs.reduce((n, s) => n + (s.state_income_tax   || 0), 0),
      futa:       stubs.reduce((n, s) => n + (s.futa_tax           || 0), 0),
      suta:       stubs.reduce((n, s) => n + (s.suta_tax           || 0), 0),
      netPay:     stubs.reduce((n, s) => n + (s.net_pay            || 0), 0),
      erSS:       stubs.reduce((n, s) => n + (s.employer_ss        || 0), 0),
      erMed:      stubs.reduce((n, s) => n + (s.employer_medicare  || 0), 0),
      regPay:     stubs.reduce((n, s) => n + (s.regular_pay        || 0), 0),
      otPay:      stubs.reduce((n, s) => n + (s.overtime_pay       || 0), 0),
      tips:       stubs.reduce((n, s) => n + (s.reported_tips      || 0), 0),
      bonus:      stubs.reduce((n, s) => n + (s.bonus              || 0), 0),
      commission: stubs.reduce((n, s) => n + (s.commission         || 0), 0),
    };
  }

  const pendingPeriods = getPendingPeriods();

  // Existing paystubs for this group, grouped by pay period end date
  const history = (() => {
    const empIds = new Set(empsInGroup.map(e => e.id));
    const byGroupId = paystubs.filter(s => s.pay_group_id === currentGroupId);
    // Also include ungrouped checks (pay_group_id = null) for employees in this group
    const ungrouped = paystubs.filter(s => s.pay_group_id == null && s.employee_id && empIds.has(s.employee_id));
    const groupStubs = byGroupId.length > 0
      ? [...byGroupId, ...ungrouped.filter(u => !byGroupId.some(b => b.id === u.id))]
      : paystubs.filter(s => s.employee_id && empIds.has(s.employee_id));
    const map = {};
    groupStubs.forEach(stub => {
      const end = stub.pay_period_end;
      if (!map[end]) map[end] = { end, stubs: [] };
      map[end].stubs.push(stub);
    });
    return Object.values(map).sort((a, b) => b.end.localeCompare(a.end));
  })();

  // Split rows: main (pending + late history), printed (processed history)
  const PRINTED_STATUSES = new Set(['printed','direct_deposit_sent','direct_deposit_cleared','voided']);
  const mainRows    = [];
  const printedRows = [];

  pendingPeriods.forEach(period => {
    empsInGroup.forEach(emp => {
      mainRows.push({ type: 'pending', period, emp, key: `p-${period.end}-${emp.id}` });
    });
  });
  history.forEach(period => {
    period.stubs.forEach(stub => {
      const row = { type: 'history', stub, key: `h-${stub.id}` };
      if (PRINTED_STATUSES.has(stub.check_status)) printedRows.push(row);
      else mainRows.push(row);
    });
  });

  const [expandedOther, setExpandedOther] = useState(new Set());

  function getRow(periodEnd, empId) {
    return (pendingRows[periodEnd] || {})[empId] || { regHours: '', otHours: '', tips: '', bonus: '', commission: '', cashAdvance: '', mileage: '', selected: false };
  }
  function setRow(periodEnd, empId, field, value) {
    setPendingRows(prev => ({
      ...prev,
      [periodEnd]: { ...(prev[periodEnd] || {}), [empId]: { ...((prev[periodEnd] || {})[empId] || {}), [field]: value } },
    }));
  }

  const selectedPendingCount = pendingPeriods.reduce((n, period) =>
    n + empsInGroup.filter(emp => getRow(period.end, emp.id).selected).length, 0);
  // Count late/draft stubs selected via the multi-select checkboxes
  const selectedHistoryLateIds = [...selectedHistoryStubs].filter(id => {
    const stub = history.flatMap(p => p.stubs).find(s => s.id === id);
    return stub && (stub.check_status === 'late' || stub.check_status === 'draft');
  });
  const totalActionCount = selectedPendingCount + selectedLateStubs.size + selectedHistoryLateIds.length;

  async function handleRunPayroll(forceMethod = null) {
    setRunErr(''); setRunSuccess('');
    for (const period of pendingPeriods) {
      for (const emp of empsInGroup) {
        const row = getRow(period.end, emp.id);
        if (!row.selected) continue;
        if (emp.payType !== 'salary') {
          const regH = parseFloat(row.regHours || 0);
          const otH  = parseFloat(row.otHours  || 0);
          if (regH === 0 && otH === 0) {
            setRunErr(`Please enter hours for ${emp.firstName} ${emp.lastName} before processing payroll.`);
            return;
          }
        }
      }
    }
    setRunning(true);
    try {
      const allNewIds = [];
      for (const period of pendingPeriods) {
        const selectedEmps = empsInGroup.filter(emp => getRow(period.end, emp.id).selected);
        if (selectedEmps.length === 0) continue;
        const payrollEmps = selectedEmps.map(emp => {
          const row = getRow(period.end, emp.id);
          const isSalary = emp.payType === 'salary';
          const regH = parseFloat(row.regHours || 0);
          const otH  = parseFloat(row.otHours  || 0);
          const tips = parseFloat(row.tips || 0);
          const bonusAmt = parseFloat(row.bonus || 0);
          const commAmt  = parseFloat(row.commission || 0);
          const cashAdv  = parseFloat(row.cashAdvance || 0);
          const mileAmt  = parseFloat(row.mileage || 0);
          const rate = parseFloat(row.rate) || emp.hourlyRate || 0;
          const regPay = isSalary ? r2((emp.annualSalary || 0) / ppy) : r2(regH * rate);
          const otPay  = isSalary ? 0 : r2(otH * rate * 1.5);
          const lineItems = [
            ...(isSalary
              ? [{ payType: 'salary', description: 'Salary', amount: regPay }]
              : [
                  ...(regH > 0 ? [{ payType: 'regular',  description: 'Regular',  hours: regH, rate, amount: regPay }] : []),
                  ...(otH  > 0 ? [{ payType: 'overtime', description: 'Overtime', hours: otH,  rate: rate * 1.5, amount: otPay }] : []),
                ]),
            ...(tips      > 0 ? [{ payType: 'tips',       description: 'Reported Tips',      amount: tips }] : []),
            ...(bonusAmt  > 0 ? [{ payType: 'bonus',      description: 'Bonus',              amount: bonusAmt }] : []),
            ...(commAmt   > 0 ? [{ payType: 'commission', description: 'Commission',         amount: commAmt }] : []),
          ];
          const ytd = calcEmpYTD(emp.id, null);
          return { employeeId: emp.id, lineItems, ytdGross: ytd.gross, regularHours: regH || null, overtimeHours: otH || null, regularPay: regPay, overtimePay: otPay, bonus: bonusAmt, commission: commAmt, reimbursement: mileAmt, deduction: cashAdv, reportedTips: tips };
        });
        const ov = periodOverrides[period.end] || {};
        const res = await api.runPayroll({ clientId, payPeriodStart: ov.start || period.start, payPeriodEnd: ov.end || period.end, settlementDate: ov.payDate || period.payDate, payGroupId: currentGroupId, employees: payrollEmps });
        if (res?.paystubs) res.paystubs.forEach(s => allNewIds.push({ id: s.id, directDeposit: s.directDeposit }));
      }
      // Include selected late stubs — route based on forceMethod or employee DD status
      selectedLateStubs.forEach(id => {
        const stub = paystubs.find(s => s.id === id);
        const emp = stub ? activeEmps.find(e => e.id === stub.employee_id) : null;
        const isDD = forceMethod === 'dd' || (forceMethod !== 'print' && emp?.directDeposit?.status === 'active');
        allNewIds.push({ id, directDeposit: isDD });
      });
      selectedHistoryLateIds.forEach(id => {
        const stub = paystubs.find(s => s.id === id);
        const emp = stub ? activeEmps.find(e => e.id === stub.employee_id) : null;
        const isDD = forceMethod === 'dd' || (forceMethod !== 'print' && emp?.directDeposit?.status === 'active');
        allNewIds.push({ id, directDeposit: isDD });
      });
      // Override directDeposit on new stubs based on forceMethod
      if (forceMethod === 'print' || forceMethod === 'paystub') allNewIds.forEach(s => s.directDeposit = false);
      if (forceMethod === 'dd')    allNewIds.forEach(s => s.directDeposit = true);
      // DD employees: mark as direct_deposit_sent; print checks: mark as printed
      const ddIds    = allNewIds.filter(s => s.directDeposit).map(s => s.id);
      const printIds = allNewIds.filter(s => !s.directDeposit).map(s => s.id);
      await Promise.all([
        ...printIds.map(id => api.updatePaystubStatus(id, 'printed').catch(() => {})),
        ...ddIds.map(id => api.updatePaystubStatus(id, 'direct_deposit_sent').catch(() => {})),
      ]);
      await reloadStubs();
      setPendingRows({});
      setPeriodOverrides({});
      setSelectedLateStubs(new Set());
      const ddCount = ddIds.length;
      const printMode = forceMethod === 'paystub' ? 'paystub' : 'paycheck';
      if (printIds.length > 0) {
        setPrintModal({ ids: printIds, mode: printMode });
      } else if (ddCount > 0) {
        setRunSuccess(`Payroll complete — ${ddCount} direct deposit${ddCount !== 1 ? 's' : ''} initiated via Moov.`);
      } else {
        setRunSuccess('Payroll complete — no checks were generated.');
      }
      if (printIds.length > 0 && ddCount > 0) {
        // Both: show print dialog, success message will show after close
        setRunSuccess(`+ ${ddCount} direct deposit${ddCount !== 1 ? 's' : ''} sent via Moov.`);
      }
    } catch (err) {
      setRunErr(err.message || 'Payroll run failed');
    } finally {
      setRunning(false);
    }
  }

  async function handleSavePeriod(stubId) {
    if (!periodEdit || periodEdit.id !== stubId) return;
    setSavingPeriod(true);
    try {
      await api.updatePaystub(stubId, { payPeriodStart: periodEdit.start, payPeriodEnd: periodEdit.end, settlementDate: periodEdit.payDate });
      await reloadStubs();
      setPeriodEdit(null);
    } catch (e) { alert(e.message); }
    finally { setSavingPeriod(false); }
  }

  useEffect(() => {
    if (!empStatusDrop) return;
    const close = () => setEmpStatusDrop(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [empStatusDrop]);

  async function handleEmpStatusChange(drop, newStatus) {
    setEmpStatusDrop(null);
    try {
      if (drop.stub) {
        // History row — just update the status
        await api.updatePaystub(drop.stub.id, { checkStatus: newStatus });
      } else {
        // Pending row — run payroll for this one employee, then set status
        const { period, emp } = drop;
        const isSalary = emp.payType === 'salary';
        const rowData2 = getRow(period.end, emp.id);
        const rate     = parseFloat(rowData2.rate) || emp.hourlyRate || 0;
        const regH     = isSalary ? 0 : parseFloat(rowData2.regHours || 0);
        const otH      = isSalary ? 0 : parseFloat(rowData2.otHours  || 0);
        const tips2    = parseFloat(rowData2.tips || 0);
        const bonus2   = parseFloat(rowData2.bonus || 0);
        const comm2    = parseFloat(rowData2.commission || 0);
        const cashAdv2 = parseFloat(rowData2.cashAdvance || 0);
        const mile2    = parseFloat(rowData2.mileage || 0);
        const regPay   = isSalary ? r2((emp.annualSalary || 0) / ppy) : r2(regH * rate);
        const otPay    = isSalary ? 0 : r2(otH * rate * 1.5);
        const lineItems = [
          ...(isSalary
            ? [{ payType: 'salary', description: 'Salary', amount: regPay }]
            : [
                ...(regPay > 0 ? [{ payType: 'regular',  description: 'Regular Pay',  hours: regH, rate, amount: regPay }] : []),
                ...(otPay  > 0 ? [{ payType: 'overtime', description: 'Overtime Pay', hours: otH, rate: rate * 1.5, amount: otPay }] : []),
              ]),
          ...(tips2  > 0 ? [{ payType: 'tips',       description: 'Reported Tips', amount: tips2  }] : []),
          ...(bonus2 > 0 ? [{ payType: 'bonus',      description: 'Bonus',         amount: bonus2 }] : []),
          ...(comm2  > 0 ? [{ payType: 'commission', description: 'Commission',    amount: comm2  }] : []),
        ];
        const ytd = calcEmpYTD(emp.id, null);
        const payrollEmp = {
          employeeId: emp.id,
          lineItems,
          ytdGross:    ytd.gross,
          regularHours: isSalary ? null : regH,
          overtimeHours: isSalary ? null : otH,
          regularPay: regPay,
          overtimePay: otPay,
          bonus: bonus2, commission: comm2, reimbursement: mile2, deduction: cashAdv2, reportedTips: tips2,
        };
        const res = await api.runPayroll({
          clientId,
          payPeriodStart: period.start,
          payPeriodEnd: period.end,
          settlementDate: period.payDate,
          payGroupId: currentGroupId,
          employees: [payrollEmp],
        });
        const newId = res?.paystubs?.[0]?.id;
        if (newId && newStatus !== 'draft') {
          await api.updatePaystub(newId, { checkStatus: newStatus });
        }
      }
      await reloadStubs();
    } catch (e) { alert(e.message || 'Failed to update status'); }
  }

  // Select-all helper — selects Late + Due Soon (within 5 days), toggles on repeat click
  function handleSelectAllDue() {
    const isDueSoon = p => !p.isLate && daysUntil(p.payDate) !== null && daysUntil(p.payDate) <= 5;
    const duePeriods = pendingPeriods.filter(p => p.isLate || isDueSoon(p));
    const lateHistIds = history.flatMap(p => p.stubs.filter(s => s.check_status === 'late').map(s => s.id));
    const allSel = duePeriods.every(p => empsInGroup.every(e => getRow(p.end, e.id).selected))
      && lateHistIds.every(id => selectedLateStubs.has(id));
    const newPR = { ...pendingRows };
    duePeriods.forEach(period => {
      const pr = { ...(newPR[period.end] || {}) };
      empsInGroup.forEach(emp => { pr[emp.id] = { ...getRow(period.end, emp.id), selected: !allSel }; });
      newPR[period.end] = pr;
    });
    setPendingRows(newPR);
    setSelectedLateStubs(allSel ? new Set() : new Set(lateHistIds));
  }

  async function handleBulkStatusChange(newStatus) {
    setBulkBusy(true);
    try {
      await Promise.all([...selectedHistoryStubs].map(id => api.updatePaystub(id, { checkStatus: newStatus })));
      await reloadStubs();
      setSelectedHistoryStubs(new Set());
    } catch (e) { alert(e.message || 'Failed to update status'); }
    finally { setBulkBusy(false); }
  }

  async function handleBulkDelete() {
    const count = selectedHistoryStubs.size;
    if (!window.confirm(`Delete ${count} check${count !== 1 ? 's' : ''}?\n\nThis will reverse all associated tax liabilities and cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      for (const id of selectedHistoryStubs) {
        await api.deletePaystub(id).catch(() => {});
      }
      await reloadStubs();
      setSelectedHistoryStubs(new Set());
    } catch (e) { alert(e.message || 'Delete failed'); }
    finally { setBulkBusy(false); }
  }

  async function handleUgCalculate() {
    setUgErr('');
    const { employeeId, start, end, payDate, regHours, otHours, payType } = ugForm;
    if (!employeeId || !start || !end || !payDate) { setUgErr('All fields required.'); return; }
    const emp = activeEmps.find(e => e.id === Number(employeeId));
    if (!emp) { setUgErr('Employee not found.'); return; }
    const isSalary = payType === 'salary' || emp.payType === 'salary';
    const ugTips   = parseFloat(ugForm.tips        || 0);
    const ugBonus  = parseFloat(ugForm.bonus        || 0);
    const ugComm   = parseFloat(ugForm.commission   || 0);
    const ugCashAdv = parseFloat(ugForm.cashAdvance || 0);
    const ugMile   = parseFloat(ugForm.mileage      || 0);
    const regH     = parseFloat(regHours || 0);
    const otH      = parseFloat(otHours  || 0);
    if (!isSalary && regH === 0 && otH === 0 && ugTips === 0 && ugBonus === 0 && ugComm === 0) {
      setUgErr('Enter hours or other payroll items.'); return;
    }
    setUgRunning(true);
    try {
      const rate   = parseFloat(ugForm.rate) || emp.hourlyRate || 0;
      const regPay = isSalary ? r2((emp.annualSalary || 0) / ppy) : r2(Math.min(regH, 40) * rate);
      const otPay  = isSalary ? 0 : r2(otH * rate * 1.5);
      const gross  = r2(regPay + otPay + ugTips + ugBonus + ugComm);
      const ytd    = calcEmpYTD(emp.id, null);
      const calc   = await api.calculate({
        grossWages:    gross,
        payFrequency:  emp.payFrequency || 'monthly',
        filingStatus:  emp.filingStatus || 'single',
        step2Checkbox: emp.step2Checkbox || false,
        step3Children: emp.step3Children || 0,
        step3Other:    emp.step3Other    || 0,
        step4a:        emp.step4a        || 0,
        step4b:        emp.step4b        || 0,
        step4c:        emp.step4c        || 0,
        workState:     emp.workState     || client?.state || 'TX',
        ytdGross:      ytd.gross,
        sutaRate:      client?.suiRateQ1 || client?.suiRateQ2 || client?.suiRateQ3 || client?.suiRateQ4 || null,
      });
      setUgPreview({ emp, isSalary, regH, otH, rate, regPay, otPay, gross, ugTips, ugBonus, ugComm, ugCashAdv, ugMile, calc, ytd });
    } catch (e) {
      setUgErr(e.message || 'Failed to calculate.');
    } finally {
      setUgRunning(false);
    }
  }

  async function handleUngroupedRun(method = 'print') {
    if (!ugPreview) return;
    const { emp, isSalary, regH, otH, rate, regPay, otPay, ugTips, ugBonus, ugComm, ugCashAdv, ugMile } = ugPreview;
    const { start, end, payDate } = ugForm;
    setUgRunning(true);
    try {
      const lineItems = [
        ...(isSalary
          ? [{ payType: 'salary', description: 'Salary', amount: regPay }]
          : [
              ...(regH > 0 ? [{ payType: 'regular',  description: 'Regular',  hours: regH, rate, amount: regPay }] : []),
              ...(otH  > 0 ? [{ payType: 'overtime', description: 'Overtime', hours: otH,  rate: rate * 1.5, amount: otPay }] : []),
            ]),
        ...(ugTips  > 0 ? [{ payType: 'tips',       description: 'Reported Tips', amount: ugTips  }] : []),
        ...(ugBonus > 0 ? [{ payType: 'bonus',      description: 'Bonus',         amount: ugBonus }] : []),
        ...(ugComm  > 0 ? [{ payType: 'commission', description: 'Commission',    amount: ugComm  }] : []),
      ];
      const ytd = calcEmpYTD(emp.id, null);
      const res = await api.runPayroll({
        clientId, payPeriodStart: start, payPeriodEnd: end, settlementDate: payDate,
        employees: [{ employeeId: emp.id, lineItems, ytdGross: ytd.gross, regularHours: regH || null, overtimeHours: otH || null, regularPay: regPay, overtimePay: otPay, bonus: ugBonus, commission: ugComm, reimbursement: ugMile, deduction: ugCashAdv, reportedTips: ugTips }],
      });
      const newIds = (res?.paystubs || []).map(s => s.id);
      const isDD = method === 'dd' && emp.bank_account_status === 'active';
      const statusToSet = isDD ? 'direct_deposit_sent' : 'printed';
      await Promise.all(newIds.map(id => api.updatePaystubStatus(id, statusToSet).catch(() => {})));
      await reloadStubs();
      const enteredRate = parseFloat(ugForm.rate);
      setUngroupedModal(false);
      setUgPreview(null);
      setUgForm({ employeeId: '', start: '', end: '', payDate: '', regHours: '', otHours: '', rate: '', payType: 'regular', tips: '', bonus: '', commission: '', cashAdvance: '', mileage: '' });
      setUgOtherOpen(false);
      if (!isDD && newIds.length > 0) setPrintModal({ ids: newIds, mode: method === 'paystub' ? 'paystub' : 'paycheck' });
      else if (isDD) setRunSuccess(`Direct deposit initiated for ${emp.firstName} ${emp.lastName}.`);
      if (!isSalary && !isNaN(enteredRate) && enteredRate !== emp.hourlyRate) {
        setRateUpdatePrompt({ empId: emp.id, newRate: enteredRate });
      }
    } catch (e) {
      setUgErr(e.message || 'Failed to run payroll.');
    } finally {
      setUgRunning(false);
    }
  }

  const hasLateRows    = pendingPeriods.some(p => p.isLate) || history.some(p => p.stubs.some(s => s.check_status === 'late' || s.check_status === 'draft'));
  const hasDueSoonRows = pendingPeriods.some(p => !p.isLate && daysUntil(p.payDate) !== null && daysUntil(p.payDate) <= 5);

  // For draft history checks, derive the visual status from the pay date instead of showing "Draft"
  function deriveDisplayStatus(stub) {
    if (stub.check_status !== 'draft') return stub.check_status || 'draft';
    const payDate = stub.settlement_date;
    if (!payDate) return 'upcoming';
    const today = new Date().toISOString().slice(0, 10);
    if (payDate < today) return 'late';
    const days = daysUntil(payDate);
    if (days !== null && days <= 5) return 'due-soon';
    return 'upcoming';
  }

  // Check detail modal — shows full breakdown for pending or history rows, with editable dates and gross
  function CheckDetailModal({ rowData, onClose }) {
    if (!rowData) return null;

    const MONO = { fontFamily: 'JetBrains Mono, monospace' };

    // Reusable table row: label | amount | ytd amount
    const TR = ({ label, amount, ytdAmount, color, bold, borderTop, negative, editValue, onEditChange, editSuffix, noDollarSign }) => {
      const display = negative ? (amount > 0 ? -amount : amount) : amount;
      return (
        <tr style={{ borderTop: borderTop ? '2px solid var(--border)' : undefined }}>
          <td style={{ padding: '5px 0', fontSize: 13, color: bold ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: bold ? 700 : 400, whiteSpace: 'nowrap' }}>{label}</td>
          <td style={{ padding: '3px 0 3px 12px', textAlign: 'right', ...MONO, fontSize: 13, fontWeight: bold ? 700 : 500, color: color || (negative && amount > 0 ? '#dc2626' : 'inherit') }}>
            {onEditChange
              ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  {!noDollarSign && <span style={{ ...MONO, fontSize: 13, color: 'var(--text-muted)', marginRight: 1 }}>$</span>}
                  <input type="text" inputMode="decimal"
                    value={editValue}
                    onChange={e => onEditChange(e.target.value)}
                    placeholder="0.00"
                    style={{ ...MONO, background: '#fff', border: '1px solid var(--border)', borderRadius: 4, outline: 'none', width: 80, textAlign: 'right', fontSize: 13, fontWeight: bold ? 700 : 500, color: 'var(--text-primary)', padding: '1px 5px', cursor: 'text', boxSizing: 'border-box' }} />
                  {editSuffix && <span style={{ ...MONO, fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{editSuffix}</span>}
                </span>
              : typeof display === 'number' ? fmt(display) : display
            }
          </td>
          {ytdAmount !== undefined && (
            <td style={{ padding: '5px 0 5px 12px', textAlign: 'right', ...MONO, fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>{ytdAmount != null ? fmt(ytdAmount) : '—'}</td>
          )}
        </tr>
      );
    };

    const ColHeader = ({ hasYTD }) => (
      <thead>
        <tr>
          <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>Item Name</th>
          <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Amount</th>
          {hasYTD && <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>YTD</th>}
        </tr>
      </thead>
    );

    const Overlay = ({ children }) => (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        {children}
      </div>
    );

    // ── Pending row ──────────────────────────────────────────────────────────────
    if (rowData.type === 'pending') {
      const { period, emp } = rowData;
      const row      = getRow(period.end, emp.id);
      const isSalary = emp.payType === 'salary';
      const salAmt   = r2((emp.annualSalary || 0) / ppy);
      const rate     = parseFloat(row.rate) || emp.hourlyRate || 0;
      const regH     = parseFloat(row.regHours || 0);
      const otH      = parseFloat(row.otHours  || 0);
      const regPay   = isSalary ? salAmt : r2(regH * rate);
      const otPay    = isSalary ? 0 : r2(otH * rate * 1.5);
      const gross    = r2(regPay + otPay);
      const ytd      = calcEmpYTD(emp.id, null);

      // Editable dates for pending rows (stored as overrides, used when payroll is run)
      const ov = periodOverrides[period.end] || {};
      const [dateForm, setDateForm] = useState({ start: ov.start || period.start || '', end: ov.end || period.end || '', payDate: ov.payDate || period.payDate || '' });
      const pendingDirty = dateForm.start !== period.start || dateForm.end !== period.end || dateForm.payDate !== period.payDate;

      const pendingItemDefs = [
        { field: 'tips',        label: 'Reported Tips',           hint: 'taxable',     isDeduction: false },
        { field: 'bonus',       label: 'Bonus',                   hint: 'taxable',     isDeduction: false },
        { field: 'commission',  label: 'Commission',              hint: 'taxable',     isDeduction: false },
        { field: 'mileage',     label: 'Mileage / Reimbursement', hint: 'non-taxable', isDeduction: false },
        { field: 'cashAdvance', label: 'Cash Advance',            hint: 'deduction',   isDeduction: true  },
      ];
      const [addedPendingItems, setAddedPendingItems] = useState(() => {
        const s = new Set();
        if (parseFloat(row.tips        || 0) > 0) s.add('tips');
        if (parseFloat(row.bonus       || 0) > 0) s.add('bonus');
        if (parseFloat(row.commission  || 0) > 0) s.add('commission');
        if (parseFloat(row.mileage     || 0) > 0) s.add('mileage');
        if (parseFloat(row.cashAdvance || 0) > 0) s.add('cashAdvance');
        return s;
      });
      const [pendingOtherOpen, setPendingOtherOpen] = useState(false);
      const addedPendingEarnings  = pendingItemDefs.filter(x => !x.isDeduction && addedPendingItems.has(x.field));
      const hiddenPendingItems    = pendingItemDefs.filter(x => !addedPendingItems.has(x.field));
      const liveGross  = r2(regPay + otPay + addedPendingEarnings.reduce((s, x) => s + parseFloat(row[x.field] || 0), 0));
      const estSSCalc  = r2(liveGross * EE_SS_RATE);
      const estMedCalc = r2(liveGross * EE_MEDICARE_RATE);
      const estCashAdv = addedPendingItems.has('cashAdvance') ? parseFloat(row.cashAdvance || 0) : 0;
      // Override values (user-editable) — fall back to calculated estimates
      const dispSS     = row.ssOverride    !== undefined ? parseFloat(row.ssOverride    || 0) : estSSCalc;
      const dispMed    = row.medOverride   !== undefined ? parseFloat(row.medOverride   || 0) : estMedCalc;
      const dispErSS   = row.erSsOverride  !== undefined ? parseFloat(row.erSsOverride  || 0) : r2(liveGross * EE_SS_RATE);
      const dispErMed  = row.erMedOverride !== undefined ? parseFloat(row.erMedOverride || 0) : r2(liveGross * EE_MEDICARE_RATE);
      const estNet     = r2(liveGross - dispSS - dispMed - estCashAdv);
      // Employer estimates
      const estFutaTaxable = Math.max(0, Math.min(liveGross, 7000 - ytd.gross));
      const estFutaCalc= r2(estFutaTaxable * 0.006);
      const curQtr     = Math.ceil((new Date().getMonth() + 1) / 3);
      const suiRateEst = [client?.suiRateQ1, client?.suiRateQ2, client?.suiRateQ3, client?.suiRateQ4][curQtr - 1] ?? 0.027;
      const estSutaTaxable = Math.max(0, Math.min(liveGross, 9000 - ytd.gross));
      const estSutaCalc= r2(estSutaTaxable * suiRateEst);
      const dispFuta   = row.futaOverride !== undefined ? parseFloat(row.futaOverride || 0) : estFutaCalc;
      const dispSuta   = row.suiOverride  !== undefined ? parseFloat(row.suiOverride  || 0) : estSutaCalc;

      // Live federal + state tax estimate via calculate API
      const [liveCalc, setLiveCalc] = useState(null);
      useEffect(() => {
        if (liveGross <= 0) { setLiveCalc(null); return; }
        const payFreqStr = ppy === 52 ? 'weekly' : ppy === 26 ? 'biweekly' : ppy === 24 ? 'semimonthly' : 'monthly';
        api.calculate({
          grossWages: liveGross,
          payFrequency: payFreqStr,
          filingStatus: emp.filingStatus || 'single',
          step2Checkbox: emp.step2Checkbox || false,
          step3Children: emp.step3Children || 0,
          step3Other: emp.step3Other || 0,
          step4a: emp.step4a || 0,
          step4b: emp.step4b || 0,
          step4c: emp.step4c || 0,
          workState: emp.workState || 'TX',
          ytdGross: ytd.gross,
          sutaRate: suiRateEst,
        }).then(r => setLiveCalc(r)).catch(() => setLiveCalc(null));
      }, [liveGross]);

      const estFITCalc   = liveCalc?.fitWithholding  ?? null;
      const estStateTaxCalc = liveCalc?.stateIncomeTax  ?? null;
      const dispFIT      = row.fitOverride   !== undefined ? parseFloat(row.fitOverride   || 0) : estFITCalc;
      const dispStateTax = row.stateOverride !== undefined ? parseFloat(row.stateOverride || 0) : estStateTaxCalc;
      const estNetFull  = (dispFIT != null && dispStateTax != null)
        ? r2(liveGross - dispFIT - dispSS - dispMed - dispStateTax - estCashAdv)
        : (liveCalc != null
          ? r2(liveGross - (liveCalc.fitWithholding || 0) - dispSS - dispMed - (liveCalc.stateIncomeTax || 0) - estCashAdv)
          : estNet);

      // Sum estimates from ALL OTHER pending periods for this employee
      // (current period is added separately below via liveGross / disp* values)
      const otherPendingTotals = Object.entries(pendingRows).reduce((acc, [pEnd, empMap]) => {
        if (pEnd === period.end) return acc; // skip current period — handled by liveGross
        const r2emp = empMap[String(emp.id)] || empMap[emp.id];
        if (!r2emp) return acc;
        const eIsSalary = emp.payType === 'salary';
        const eRate     = parseFloat(r2emp.rate) || emp.hourlyRate || 0;
        const eRegH     = parseFloat(r2emp.regHours || 0);
        const eOtH      = parseFloat(r2emp.otHours  || 0);
        const eReg      = eIsSalary ? r2((emp.annualSalary || 0) / ppy) : r2(eRegH * eRate);
        const eOt       = eIsSalary ? 0 : r2(eOtH * eRate * 1.5);
        const eTips     = parseFloat(r2emp.tips       || 0);
        const eBonus    = parseFloat(r2emp.bonus      || 0);
        const eComm     = parseFloat(r2emp.commission || 0);
        const eGross    = r2(eReg + eOt + eTips + eBonus + eComm);
        const eSS       = r2emp.ssOverride    !== undefined ? parseFloat(r2emp.ssOverride    || 0) : r2(eGross * EE_SS_RATE);
        const eMed      = r2emp.medOverride   !== undefined ? parseFloat(r2emp.medOverride   || 0) : r2(eGross * EE_MEDICARE_RATE);
        const eFIT      = r2emp.fitOverride   !== undefined ? parseFloat(r2emp.fitOverride   || 0) : 0;
        const eState    = r2emp.stateOverride !== undefined ? parseFloat(r2emp.stateOverride || 0) : 0;
        const eCashAdv  = parseFloat(r2emp.cashAdvance  || 0);
        const eErSS     = r2emp.erSsOverride  !== undefined ? parseFloat(r2emp.erSsOverride  || 0) : r2(eGross * EE_SS_RATE);
        const eErMed    = r2emp.erMedOverride !== undefined ? parseFloat(r2emp.erMedOverride || 0) : r2(eGross * EE_MEDICARE_RATE);
        const eRunningGross = acc.gross + ytd.gross;
        const eFutaTaxable  = Math.max(0, Math.min(eGross, 7000 - eRunningGross));
        const eSutaTaxable  = Math.max(0, Math.min(eGross, 9000 - eRunningGross));
        const eFuta     = r2emp.futaOverride !== undefined ? parseFloat(r2emp.futaOverride || 0) : r2(eFutaTaxable * 0.006);
        const eSuta     = r2emp.suiOverride  !== undefined ? parseFloat(r2emp.suiOverride  || 0) : r2(eSutaTaxable * suiRateEst);
        const eNet      = r2(eGross - eSS - eMed - eFIT - eState - eCashAdv);
        return {
          gross:      r2(acc.gross      + eGross),
          eeSS:       r2(acc.eeSS      + eSS),
          eeMed:      r2(acc.eeMed     + eMed),
          fit:        r2(acc.fit       + eFIT),
          stateTax:   r2(acc.stateTax  + eState),
          netPay:     r2(acc.netPay    + eNet),
          erSS:       r2(acc.erSS      + eErSS),
          erMed:      r2(acc.erMed     + eErMed),
          futa:       r2(acc.futa      + eFuta),
          suta:       r2(acc.suta      + eSuta),
          regPay:     r2(acc.regPay    + eReg),
          otPay:      r2(acc.otPay     + eOt),
          tips:       r2(acc.tips      + eTips),
          bonus:      r2(acc.bonus     + eBonus),
          commission: r2(acc.commission + eComm),
        };
      }, { gross: 0, eeSS: 0, eeMed: 0, fit: 0, stateTax: 0, netPay: 0, erSS: 0, erMed: 0, futa: 0, suta: 0, regPay: 0, otPay: 0, tips: 0, bonus: 0, commission: 0 });

      // Current-period per-type values
      const curTips     = parseFloat(row.tips       || 0);
      const curBonus    = parseFloat(row.bonus      || 0);
      const curComm     = parseFloat(row.commission || 0);

      // YTD = printed checks + all other pending periods + this period
      const ytdWithCurrent = {
        gross:      r2(ytd.gross      + otherPendingTotals.gross      + liveGross),
        eeSS:       r2(ytd.eeSS      + otherPendingTotals.eeSS      + dispSS),
        eeMed:      r2(ytd.eeMed     + otherPendingTotals.eeMed     + dispMed),
        fit:        r2(ytd.fit       + otherPendingTotals.fit       + (dispFIT      ?? 0)),
        stateTax:   r2(ytd.stateTax  + otherPendingTotals.stateTax  + (dispStateTax ?? 0)),
        netPay:     r2(ytd.netPay    + otherPendingTotals.netPay    + estNetFull),
        erSS:       r2(ytd.erSS      + otherPendingTotals.erSS      + dispErSS),
        erMed:      r2(ytd.erMed     + otherPendingTotals.erMed     + dispErMed),
        futa:       r2(ytd.futa      + otherPendingTotals.futa      + dispFuta),
        suta:       r2(ytd.suta      + otherPendingTotals.suta      + dispSuta),
        regPay:     r2(ytd.regPay    + otherPendingTotals.regPay    + regPay),
        otPay:      r2(ytd.otPay     + otherPendingTotals.otPay     + otPay),
        tips:       r2(ytd.tips      + otherPendingTotals.tips      + curTips),
        bonus:      r2(ytd.bonus     + otherPendingTotals.bonus     + curBonus),
        commission: r2(ytd.commission + otherPendingTotals.commission + curComm),
      };

      return (
        <Overlay>
          <div className="card" style={{ width: 640, maxWidth: '95vw', maxHeight: '92vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>{emp.firstName} {emp.lastName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {isSalary ? 'Salary' : 'Hourly'} · {period.isLate ? <span style={{ color: '#dc2626', fontWeight: 700 }}>LATE</span> : 'Pending'}
                  </div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
              </div>
              {/* Pay period strip — editable */}
              <div style={{ display: 'flex', marginTop: 14, borderRadius: 8, overflow: 'hidden', border: `1px solid ${pendingDirty ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-secondary)', transition: 'border-color 0.15s' }}>
                {[
                  { label: 'Period Start', key: 'start' },
                  { label: 'Period End',   key: 'end'   },
                  { label: 'Pay Date',     key: 'payDate' },
                ].map(({ label, key }, i, arr) => (
                  <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                    <input type="date" value={dateForm[key]} onChange={e => setDateForm(f => ({ ...f, [key]: e.target.value }))}
                      style={{ ...MONO, fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', outline: 'none', width: '100%', color: dateForm[key] !== (key === 'start' ? period.start : key === 'end' ? period.end : period.payDate) ? 'var(--accent)' : period.isLate && key === 'payDate' ? '#dc2626' : 'var(--text-primary)', cursor: 'pointer' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Body: Employee Summary + Company Summary, each with YTD column */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)' }}>

              {/* Employee Summary */}
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Employee Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 22 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>Item Name</th>
                    <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>YTD</th>
                  </tr>
                </thead>
                <tbody>
                  {isSalary
                    ? <TR label="Salary / Period" amount={salAmt} ytdAmount={ytdWithCurrent.regPay} color="var(--accent)" />
                    : <>
                        <TR label="Hourly Rate" amount={rate} ytdAmount={null} color="var(--accent)"
                          editValue={row.rate !== undefined ? String(row.rate) : String(emp.hourlyRate || '')}
                          onEditChange={v => setRow(period.end, emp.id, 'rate', v)}
                          editSuffix="/hr" noDollarSign={false} />
                        <TR label={`Reg Hours @ $${rate % 1 === 0 ? rate : rate.toFixed(2)} /hr`} amount={regPay} ytdAmount={ytdWithCurrent.regPay} color="var(--accent)" />
                        {otPay > 0 && <TR label={`OT Hours @ $${(rate * 1.5) % 1 === 0 ? (rate * 1.5) : (rate * 1.5).toFixed(2)} /hr`} amount={otPay} ytdAmount={ytdWithCurrent.otPay} color="var(--accent)" />}
                      </>
                  }
                  {addedPendingEarnings.map(item => (
                    <TR key={item.field} label={item.label} amount={parseFloat(row[item.field] || 0)}
                      ytdAmount={ytdWithCurrent[item.field] ?? null} color="var(--accent)"
                      editValue={row[item.field] || ''} onEditChange={v => setRow(period.end, emp.id, item.field, v)} />
                  ))}
                  <TR label="Gross Pay"            amount={liveGross}    ytdAmount={ytdWithCurrent.gross}    color="var(--accent)" bold borderTop />
                  {addedPendingItems.has('cashAdvance') && (
                    <TR label="Cash Advance"       amount={parseFloat(row.cashAdvance || 0)} ytdAmount={null} negative color="#dc2626"
                      editValue={row.cashAdvance || ''} onEditChange={v => setRow(period.end, emp.id, 'cashAdvance', v)} />
                  )}
                  <TR label="Social Security (est.)" amount={dispSS}  ytdAmount={ytdWithCurrent.eeSS}     negative color="#dc2626"
                    editValue={row.ssOverride !== undefined ? row.ssOverride : String(estSSCalc)} onEditChange={v => setRow(period.end, emp.id, 'ssOverride', v)} />
                  <TR label="Medicare (est.)"        amount={dispMed} ytdAmount={ytdWithCurrent.eeMed}    negative color="#dc2626"
                    editValue={row.medOverride !== undefined ? row.medOverride : String(estMedCalc)} onEditChange={v => setRow(period.end, emp.id, 'medOverride', v)} />
                  <TR label="Federal Income Tax"     amount={dispFIT      ?? 'calculating…'} ytdAmount={ytdWithCurrent.fit}      negative={dispFIT != null}      color={dispFIT != null && dispFIT > 0 ? '#dc2626' : 'var(--text-muted)'}
                    editValue={row.fitOverride !== undefined ? row.fitOverride : (estFITCalc != null ? String(estFITCalc) : '')} onEditChange={v => setRow(period.end, emp.id, 'fitOverride', v)} />
                  <TR label="State Income Tax"       amount={dispStateTax ?? '—'}            ytdAmount={ytdWithCurrent.stateTax} negative={dispStateTax != null} color={dispStateTax != null && dispStateTax > 0 ? '#dc2626' : 'var(--text-muted)'}
                    editValue={row.stateOverride !== undefined ? row.stateOverride : (estStateTaxCalc != null ? String(estStateTaxCalc) : '')} onEditChange={v => setRow(period.end, emp.id, 'stateOverride', v)} />
                  <TR label="Net Pay (est.)"         amount={estNetFull} ytdAmount={ytdWithCurrent.netPay}   color="#16a34a" bold borderTop />
                </tbody>
              </table>

              {/* Company Summary */}
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Company Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>Item Name</th>
                    <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>YTD</th>
                  </tr>
                </thead>
                <tbody>
                  <TR label="SS Match (est.)"              amount={dispErSS}  ytdAmount={ytdWithCurrent.erSS}  color="var(--text-secondary)"
                    editValue={row.erSsOverride !== undefined ? row.erSsOverride : String(r2(liveGross * EE_SS_RATE))} onEditChange={v => setRow(period.end, emp.id, 'erSsOverride', v)} />
                  <TR label="Medicare Match (est.)"        amount={dispErMed} ytdAmount={ytdWithCurrent.erMed} color="var(--text-secondary)"
                    editValue={row.erMedOverride !== undefined ? row.erMedOverride : String(r2(liveGross * EE_MEDICARE_RATE))} onEditChange={v => setRow(period.end, emp.id, 'erMedOverride', v)} />
                  <TR label="Federal Unemployment (est.)"  amount={dispFuta}  ytdAmount={ytdWithCurrent.futa}  color="var(--text-secondary)"
                    editValue={row.futaOverride !== undefined ? row.futaOverride : String(estFutaCalc)} onEditChange={v => setRow(period.end, emp.id, 'futaOverride', v)} />
                  <TR label="State Unemployment (est.)"    amount={dispSuta}  ytdAmount={ytdWithCurrent.suta}  color="var(--text-secondary)"
                    editValue={row.suiOverride !== undefined ? row.suiOverride : String(estSutaCalc)} onEditChange={v => setRow(period.end, emp.id, 'suiOverride', v)} />
                </tbody>
              </table>
            </div>
            {/* Other Payroll Items */}
            {hiddenPendingItems.length > 0 && (
              <div style={{ margin: '0 24px', borderTop: '1px solid var(--border)', paddingTop: 10, paddingBottom: 6 }}>
                <button type="button" onClick={() => setPendingOtherOpen(o => !o)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {pendingOtherOpen ? '▴' : '▾'} Other Payroll Items
                </button>
                {pendingOtherOpen && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {hiddenPendingItems.map(item => (
                      <button key={item.field} type="button"
                        onClick={() => { setAddedPendingItems(prev => new Set([...prev, item.field])); setPendingOtherOpen(false); }}
                        style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        + {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Save date overrides footer */}
            <div style={{ padding: '10px 24px 18px', display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', marginTop: 10 }}>
              <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>Close</button>
              {pendingDirty && (
                <button className="btn btn-primary" style={{ fontSize: 12 }}
                  onClick={() => { setPeriodOverrides(prev => ({ ...prev, [period.end]: { start: dateForm.start, end: dateForm.end, payDate: dateForm.payDate } })); onClose(); }}>
                  Save Dates
                </button>
              )}
            </div>
          </div>
        </Overlay>
      );
    }

    // ── History (printed/deposited) row ──────────────────────────────────────────
    const { stub } = rowData;
    const isVoided = stub.check_status === 'voided';
    const ytd = calcEmpYTD(stub.employee_id, stub.pay_period_end);

    // Editable date / gross / other payroll items state (hooks must be at top of history branch)
    const lineItemsList = stub.lineItems || [];
    const compFromItems = lineItemsList.filter(li => li.pay_type === 'regular' && stub.regular_hours == null).reduce((s, li) => s + (li.amount || 0), 0);
    const displayedTips = stub.reported_tips || lineItemsList.filter(li => li.pay_type === 'tips').reduce((s, li) => s + (li.amount || 0), 0);
    const initialGross  = r2(compFromItems > 0 ? compFromItems : stub.regular_pay != null ? stub.regular_pay : (stub.gross_wages || 0));
    const initialFit    = r2(stub.fit_withholding || 0);

    const [dateForm, setDateForm]     = useState({ start: stub.pay_period_start || '', end: stub.pay_period_end || '', payDate: stub.settlement_date || '' });
    const [grossOverride, setGrossOverride] = useState(String(initialGross));
    const [fitOverride, setFitOverride]     = useState(String(initialFit));
    const [itemForm, setItemForm]   = useState({
      reportedTips:  String(displayedTips       || ''),
      bonus:         String(stub.bonus          || ''),
      commission:    String(stub.commission     || ''),
      reimbursement: String(stub.reimbursement  || ''),
      deduction:     String(stub.deduction      || ''),
      garnishment:   String(stub.garnishment    || ''),
    });
    const [addedItems, setAddedItems] = useState(() => {
      const s = new Set();
      if (displayedTips      > 0) s.add('reportedTips');
      if (stub.bonus         > 0) s.add('bonus');
      if (stub.commission    > 0) s.add('commission');
      if (stub.reimbursement > 0) s.add('reimbursement');
      if (stub.deduction     > 0) s.add('deduction');
      if (stub.garnishment   > 0) s.add('garnishment');
      return s;
    });
    const [otherOpen, setOtherOpen] = useState(false);
    const [editSaving, setEditSaving] = useState(false);
    const itemDirty = !isVoided && (
      parseFloat(itemForm.reportedTips  || 0) !== (displayedTips       || 0) ||
      parseFloat(itemForm.bonus         || 0) !== (stub.bonus          || 0) ||
      parseFloat(itemForm.commission    || 0) !== (stub.commission     || 0) ||
      parseFloat(itemForm.reimbursement || 0) !== (stub.reimbursement  || 0) ||
      parseFloat(itemForm.deduction     || 0) !== (stub.deduction      || 0) ||
      parseFloat(itemForm.garnishment   || 0) !== (stub.garnishment    || 0)
    );
    const isDirty = !isVoided && (
      dateForm.start   !== (stub.pay_period_start || '') ||
      dateForm.end     !== (stub.pay_period_end   || '') ||
      dateForm.payDate !== (stub.settlement_date  || '') ||
      parseFloat(grossOverride) !== initialGross ||
      parseFloat(fitOverride)   !== initialFit   ||
      itemDirty
    );
    async function saveModalEdits() {
      setEditSaving(true);
      try {
        const payload = { payPeriodStart: dateForm.start, payPeriodEnd: dateForm.end, settlementDate: dateForm.payDate };
        if (parseFloat(grossOverride) !== initialGross) {
          payload.lineItems = [{ payType: 'salary', amount: parseFloat(grossOverride) }];
        }
        if (parseFloat(fitOverride) !== initialFit) {
          payload.fitWithholdingOverride = parseFloat(fitOverride || 0);
          if (!payload.lineItems) payload.lineItems = [{ payType: 'salary', amount: parseFloat(grossOverride) }];
        }
        if (itemDirty) {
          payload.reportedTips  = parseFloat(itemForm.reportedTips  || 0);
          payload.bonus         = parseFloat(itemForm.bonus         || 0);
          payload.commission    = parseFloat(itemForm.commission    || 0);
          payload.reimbursement = parseFloat(itemForm.reimbursement || 0);
          payload.deduction     = parseFloat(itemForm.deduction     || 0);
          payload.garnishment   = parseFloat(itemForm.garnishment   || 0);
        }
        await api.updatePaystub(stub.id, payload);
        await reloadStubs();
        onClose();
      } catch (e) { alert(e.message); }
      finally { setEditSaving(false); }
    }

    const canEdit = !isVoided;
    const set = field => canEdit ? (v => setItemForm(p => ({ ...p, [field]: v }))) : undefined;

    const mainPayRow = stub.regular_hours != null && stub.regular_pay != null
      ? { label: `Hourly  (${stub.regular_hours} hrs)`, amount: stub.regular_pay, editValue: canEdit ? grossOverride : undefined, onEditChange: canEdit ? setGrossOverride : undefined }
      : { label: 'Compensation', amount: compFromItems > 0 ? compFromItems : (stub.gross_wages || 0), editValue: canEdit ? grossOverride : undefined, onEditChange: canEdit ? setGrossOverride : undefined };

    const optionalEarnings = [
      { key: 'reportedTips',  label: 'Reported Tips'  },
      { key: 'bonus',         label: 'Bonus'           },
      { key: 'commission',    label: 'Commission'      },
      { key: 'reimbursement', label: 'Reimbursement'  },
    ];
    const optionalDeductions = [
      { key: 'deduction',   label: 'Deduction'   },
      { key: 'garnishment', label: 'Garnishment' },
    ];

    const earningRows = [
      mainPayRow,
      stub.overtime_hours > 0 && stub.overtime_pay > 0 && { label: `Overtime  (${stub.overtime_hours} hrs)`, amount: stub.overtime_pay },
      ...optionalEarnings
        .filter(x => addedItems.has(x.key))
        .map(x => ({ label: x.label, amount: parseFloat(itemForm[x.key] || 0), editValue: canEdit ? itemForm[x.key] : undefined, onEditChange: set(x.key) })),
    ].filter(Boolean);

    const liveGross = r2(
      parseFloat(grossOverride || 0) +
      (stub.overtime_pay || 0) +
      optionalEarnings.filter(x => addedItems.has(x.key)).reduce((s, x) => s + parseFloat(itemForm[x.key] || 0), 0)
    );

    const deductionRows = [
      { label: 'Federal Income Tax', amount: stub.fit_withholding   || 0, ytd: ytd.fit,     editValue: canEdit ? fitOverride : undefined, onEditChange: canEdit ? setFitOverride : undefined },
      { label: 'Social Security',    amount: stub.employee_ss       || 0, ytd: ytd.eeSS     },
      { label: 'Medicare',           amount: stub.employee_medicare || 0, ytd: ytd.eeMed    },
      (stub.additional_medicare || 0) > 0 && { label: 'Addl Medicare', amount: stub.additional_medicare, ytd: 0 },
      { label: 'State Income Tax',   amount: stub.state_income_tax  || 0, ytd: ytd.stateTax },
      ...optionalDeductions
        .filter(x => addedItems.has(x.key))
        .map(x => ({ label: x.label, amount: parseFloat(itemForm[x.key] || 0), editValue: canEdit ? itemForm[x.key] : undefined, onEditChange: set(x.key) })),
    ].filter(Boolean);

    const hiddenItems = [...optionalEarnings, ...optionalDeductions].filter(x => !addedItems.has(x.key));

    const employerRows = [
      { label: 'SS Match (Company)',       amount: stub.employer_ss      || 0, ytd: ytd.erSS   ?? 0 },
      { label: 'Medicare Match (Company)', amount: stub.employer_medicare || 0, ytd: ytd.erMed  ?? 0 },
      { label: 'Federal Unemployment',     amount: stub.futa_tax         || 0, ytd: ytd.futa },
      { label: `${stub.work_state || 'State'} Unemployment`, amount: stub.suta_tax || 0, ytd: ytd.suta },
    ];
    const employerTotal = r2(employerRows.reduce((s, r) => s + r.amount, 0));
    const employerYTD   = r2(employerRows.reduce((s, r) => s + (r.ytd || 0), 0));

    return (
      <Overlay>
        <div className="card" style={{ width: 740, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>

          {/* Header */}
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 20, textDecoration: isVoided ? 'line-through' : 'none' }}>{stub.employee_name}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <StatusBadge status={stub.check_status || 'draft'} />
                  {stub.check_number && <span style={{ ...MONO, fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>Check #{stub.check_number}</span>}
                </div>
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
            </div>
            {/* Pay period strip — editable for non-voided checks */}
            <div style={{ display: 'flex', marginTop: 14, borderRadius: 8, overflow: 'hidden', border: `1px solid ${isDirty ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-secondary)', transition: 'border-color 0.15s' }}>
              {[
                { label: 'Period Start', key: 'start',   raw: stub.pay_period_start },
                { label: 'Period End',   key: 'end',     raw: stub.pay_period_end   },
                { label: 'Pay Date',     key: 'payDate', raw: stub.settlement_date  },
              ].map(({ label, key, raw }, i, arr) => (
                <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                  {isVoided
                    ? <div style={{ ...MONO, fontSize: 13, fontWeight: 600 }}>{fmtDate(raw)}</div>
                    : <input type="date" value={dateForm[key]}
                        onChange={e => setDateForm(f => ({ ...f, [key]: e.target.value }))}
                        style={{ ...MONO, fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', outline: 'none', width: '100%', color: dateForm[key] !== (raw || '') ? 'var(--accent)' : 'var(--text-primary)', cursor: 'pointer' }} />
                  }
                </div>
              ))}
            </div>
          </div>

          {/* Two-column body */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>

            {/* Left — Employee Summary */}
            <div style={{ padding: '18px 20px 0 24px', borderRight: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Employee Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <ColHeader hasYTD={true} />
                <tbody>
                  {earningRows.map(r => (
                    <TR key={r.label} label={r.label} amount={r.amount} color="var(--accent)"
                      editValue={r.editValue} onEditChange={r.onEditChange} />
                  ))}
                  <TR label="Gross Pay" amount={liveGross} ytdAmount={ytd.gross} color="var(--accent)" bold borderTop />
                  {deductionRows.map(r => (
                    <TR key={r.label} label={r.label} amount={r.amount} ytdAmount={r.ytd} negative
                      color={r.amount > 0 ? '#dc2626' : 'var(--text-muted)'}
                      editValue={r.editValue} onEditChange={r.onEditChange} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Right — Company Summary */}
            <div style={{ padding: '18px 24px 0 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Company Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <ColHeader hasYTD={true} />
                <tbody>
                  {employerRows.map(r => <TR key={r.label} label={r.label} amount={r.amount} ytdAmount={r.ytd} />)}
                  <TR label="Total Company Cost" amount={employerTotal} ytdAmount={employerYTD} bold borderTop color="var(--text-primary)" />
                </tbody>
              </table>
            </div>
          </div>

          {/* Check Amount + tax bar */}
          <div style={{ margin: '16px 24px 0', borderTop: '2px solid var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px 4px' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Check Amount</div>
            <div style={{ ...MONO, fontSize: 22, fontWeight: 800, color: '#16a34a' }}>{fmt(stub.net_pay || 0)}</div>
          </div>
          <div style={{ display: 'flex', gap: 0, margin: '12px 24px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            {[
              { label: '941 Tax Deposit', value: fmt(stub.total_deposit || 0) },
              { label: '940 FUTA',        value: fmt(stub.futa_tax      || 0) },
              { label: 'State SUI',       value: fmt(stub.suta_tax      || 0) },
              { label: 'Total Tax Costs', value: fmt(r2((stub.total_deposit || 0) + (stub.futa_tax || 0) + (stub.suta_tax || 0))), accent: true },
            ].map(({ label, value, accent }, i, arr) => (
              <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none', background: accent ? 'var(--accent-light)' : undefined }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ ...MONO, fontSize: 14, fontWeight: 800, color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Other Payroll Items */}
          {canEdit && hiddenItems.length > 0 && (
            <div style={{ margin: '0 24px', borderTop: '1px solid var(--border)', paddingTop: 10, paddingBottom: 6 }}>
              <button type="button" onClick={() => setOtherOpen(o => !o)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {otherOpen ? '▴' : '▾'} Other Payroll Items
              </button>
              {otherOpen && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {hiddenItems.map(item => (
                    <button key={item.key} type="button"
                      onClick={() => { setAddedItems(prev => new Set([...prev, item.key])); setOtherOpen(false); }}
                      style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      + {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer: save/close */}
          <div style={{ padding: '12px 24px 18px', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>Close</button>
            {!isVoided && (
              <button className="btn btn-ghost" style={{ fontSize: 12, color: '#dc2626' }} onClick={async () => {
                if (!window.confirm('Delete this check? This cannot be undone.')) return;
                try { await api.deletePaystub(stub.id); onClose(); reloadStubs(); } catch (e) { alert(e.message); }
              }}>Delete</button>
            )}
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={async () => {
              try { await api.printSelectedChecks(clientId, [stub.id]); } catch (e) { alert(e.message); }
            }}>↓ Paycheck</button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={async () => {
              try { await api.printSelectedPaystubs(clientId, [stub.id]); } catch (e) { alert(e.message); }
            }}>↓ Paystub</button>
            {isDirty && (
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => {
                setGrossOverride(String(initialGross));
                setFitOverride(String(initialFit));
                setItemForm({ reportedTips: String(displayedTips || ''), bonus: String(stub.bonus || ''), commission: String(stub.commission || ''), reimbursement: String(stub.reimbursement || ''), deduction: String(stub.deduction || ''), garnishment: String(stub.garnishment || '') });
                setDateForm({ start: stub.pay_period_start || '', end: stub.pay_period_end || '', payDate: stub.settlement_date || '' });
                const s = new Set();
                if (displayedTips > 0) s.add('reportedTips');
                if (stub.bonus > 0) s.add('bonus');
                if (stub.commission > 0) s.add('commission');
                if (stub.reimbursement > 0) s.add('reimbursement');
                if (stub.deduction > 0) s.add('deduction');
                if (stub.garnishment > 0) s.add('garnishment');
                setAddedItems(s);
                setOtherOpen(false);
              }}>Revert</button>
            )}
            {isDirty && (
              <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={editSaving} onClick={saveModalEdits}>
                {editSaving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </Overlay>
    );
  }

  // Flat table renderer — clicking a row opens CheckDetailModal
  function renderTable(rows, startIdx = 0) {
    const selectableIds = rows
      .filter(r => r.type === 'history' && r.stub.check_status !== 'voided')
      .map(r => r.stub.id);
    const allSel = selectableIds.length > 0 && selectableIds.every(id => selectedHistoryStubs.has(id));
    const someSel = selectableIds.some(id => selectedHistoryStubs.has(id));
    function toggleAll() {
      setSelectedHistoryStubs(prev => {
        const next = new Set(prev);
        if (allSel) selectableIds.forEach(id => next.delete(id));
        else selectableIds.forEach(id => next.add(id));
        return next;
      });
    }
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12 }}>
        <colgroup>
          <col style={{ width: 36 }} />
          <col />
          <col style={{ width: 84 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 82 }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <th style={{ padding: '7px 0 7px 12px' }}>
              {selectableIds.length > 0 && (
                <input type="checkbox" checked={allSel} ref={el => { if (el) el.indeterminate = someSel && !allSel; }}
                  onChange={toggleAll}
                  style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }} />
              )}
            </th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'left' }}>Employee</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'left' }}>Period Start</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'left' }}>Period End</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'left' }}>Pay Date</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>Reg Hrs</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>OT Hrs</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>Rate</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>Net Pay</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((rowData, idx) => {
            const stripeBg = (startIdx + idx) % 2 === 0 ? 'var(--bg-primary, #fff)' : '#f8fafc';

            if (rowData.type === 'pending') {
              const { period: rawPeriod, emp } = rowData;
              // Apply any saved date overrides from the detail modal
              const ov = periodOverrides[rawPeriod.end] || {};
              const period = { ...rawPeriod, start: ov.start || rawPeriod.start, end: ov.end || rawPeriod.end, payDate: ov.payDate || rawPeriod.payDate };
              const row      = getRow(rawPeriod.end, emp.id);
              const isSalary = emp.payType === 'salary';
              const salAmt   = r2((emp.annualSalary || 0) / ppy);
              const rate     = parseFloat(row.rate) || emp.hourlyRate || 0;
              const regH     = parseFloat(row.regHours || 0);
              const otH      = parseFloat(row.otHours  || 0);
              const tipsAmt  = parseFloat(row.tips || 0);
              const bonusAmt = parseFloat(row.bonus || 0);
              const commAmt  = parseFloat(row.commission || 0);
              const basePay  = isSalary ? salAmt : r2(regH * rate + otH * rate * 1.5);
              const grossPreview = r2(basePay + tipsAmt + bonusAmt + commAmt);
              const estEeSS    = r2(grossPreview * EE_SS_RATE);
              const estEeMed   = r2(grossPreview * EE_MEDICARE_RATE);
              // Rough FIT estimate using annualized percentage method (single filer, 2026 std deduction)
              const annualGross = grossPreview * ppy;
              const taxableAnn  = Math.max(0, annualGross - 16100);
              const annualFIT   = taxableAnn <= 12225 ? taxableAnn * 0.10 : 1222.5 + (Math.min(taxableAnn, 49675) - 12225) * 0.12 + Math.max(0, taxableAnn - 49675) * 0.22;
              const estFIT      = Math.round(annualFIT / ppy);
              const estNetPay  = r2(grossPreview - estEeSS - estEeMed - estFIT);
              const daysToPayDate = daysUntil(period.payDate);
              const isLate   = period.payDate < new Date().toISOString().slice(0, 10);
              const status   = isLate ? 'late' : (daysToPayDate !== null && daysToPayDate <= 5 ? 'due-soon' : 'upcoming');
              const selBg    = isLate ? '#fff5f5' : status === 'due-soon' ? '#fffbeb' : 'var(--accent-light)';
              const rowBg    = row.selected ? selBg : stripeBg;
              return (
                <React.Fragment key={rowData.key}>
                <tr
                  style={{ background: rowBg, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={e => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') setDetailModal(rowData); }}
                >
                  <td style={{ padding: '0 0 0 12px' }}>
                    <input type="checkbox" checked={row.selected}
                      style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }}
                      onChange={ev => setRow(period.end, emp.id, 'selected', ev.target.checked)} />
                  </td>
                  <td style={{ padding: '7px 8px', fontWeight: 600 }}>
                    <button onClick={e => { e.stopPropagation(); setDrawerEmpId(emp.id); }}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: 12, color: 'var(--accent)', textDecoration: 'underline' }}>
                      {emp.firstName} {emp.lastName}
                    </button>
                  </td>
                  <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: ov.start ? 'var(--accent)' : '#222' }}>{fmtDate(period.start)}</td>
                  <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: ov.end ? 'var(--accent)' : '#222' }}>{fmtDate(period.end)}</td>
                  <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: isLate ? '#dc2626' : ov.payDate ? 'var(--accent)' : '#222' }}>{fmtDate(period.payDate)}</td>
                  {isSalary ? (
                    <>
                      <td colSpan={3} style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 11 }}>salary</td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '4px 6px' }}>
                        <input className="form-input mono" type="text" inputMode="decimal" value={row.regHours} placeholder="0"
                          onChange={ev => setRow(period.end, emp.id, 'regHours', ev.target.value)}
                          style={{ width: '100%', height: 26, fontSize: 12, textAlign: 'right', padding: '0 6px' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input className="form-input mono" type="text" inputMode="decimal" value={row.otHours} placeholder="0"
                          onChange={ev => setRow(period.end, emp.id, 'otHours', ev.target.value)}
                          style={{ width: '100%', height: 26, fontSize: 12, textAlign: 'right', padding: '0 6px' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input className="form-input mono" type="text" inputMode="decimal"
                          value={row.rate !== undefined ? row.rate : String(emp.hourlyRate || '')}
                          placeholder={String(emp.hourlyRate || '')}
                          onChange={ev => setRow(period.end, emp.id, 'rate', ev.target.value)}
                          onBlur={ev => {
                            const entered = parseFloat(ev.target.value);
                            if (!isNaN(entered) && entered !== emp.hourlyRate) {
                              setRateUpdatePrompt({ empId: emp.id, newRate: entered, periodEnd: period.end });
                            }
                          }}
                          style={{ width: '100%', height: 26, fontSize: 12, textAlign: 'right', padding: '0 6px' }} />
                      </td>
                    </>
                  )}
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: grossPreview > 0 ? 'var(--success, #16a34a)' : '#aaa', fontSize: 13 }}>
                    {grossPreview > 0 ? fmt(estNetPay) : '—'}
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                    <span style={{ cursor: 'pointer' }} title="Click to change status"
                      onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setEmpStatusDrop(empStatusDrop?.period?.end === period.end && empStatusDrop?.emp?.id === emp.id ? null : { period, emp, top: r.bottom + 4, right: window.innerWidth - r.right }); }}>
                      <StatusBadge status={status} />
                    </span>
                  </td>
                </tr>
                </React.Fragment>
              );
            }

            // History row
            const { stub } = rowData;
            const isLateCheck    = stub.check_status === 'late';
            const isDraftCheck   = stub.check_status === 'draft';
            const isVoided       = stub.check_status === 'voided';
            const displayStatus  = deriveDisplayStatus(stub);
            const rowBg          = (isLateCheck || (isDraftCheck && displayStatus === 'late')) ? '#fff5f5'
                                 : displayStatus === 'due-soon' ? '#fffbeb'
                                 : stripeBg;
            const canEditPeriod  = !isVoided;
            const isEditingPeriod = periodEdit?.id === stub.id;
            return (
              <tr key={rowData.key}
                style={{ background: rowBg, opacity: isVoided ? 0.5 : 1, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={e => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') setDetailModal(rowData); }}
              >
                <td style={{ padding: '0 0 0 12px' }}>
                  {!isVoided && (
                    <input type="checkbox"
                      checked={selectedHistoryStubs.has(stub.id)}
                      onChange={e => { e.stopPropagation(); setSelectedHistoryStubs(prev => { const next = new Set(prev); next.has(stub.id) ? next.delete(stub.id) : next.add(stub.id); return next; }); }}
                      style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }} />
                  )}
                </td>
                <td style={{ padding: '7px 8px' }}>
                  {stub.employee_id ? (
                    <button onClick={e => { e.stopPropagation(); setDrawerEmpId(stub.employee_id); }}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: 13, color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: isVoided ? 'line-through' : 'underline' }}>
                      {stub.employee_name}
                    </button>
                  ) : (
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#111', textDecoration: isVoided ? 'line-through' : 'none' }}>{stub.employee_name}</span>
                  )}
                  {stub.check_number && <span style={{ marginLeft: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>#{stub.check_number}</span>}
                </td>
                {isEditingPeriod ? (
                  <td colSpan={3} style={{ padding: '4px 8px' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="date" value={periodEdit.start}
                        onChange={e => setPeriodEdit(p => ({ ...p, start: e.target.value }))}
                        style={{ height: 26, fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px' }} />
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>–</span>
                      <input type="date" value={periodEdit.end}
                        onChange={e => { const end = e.target.value; setPeriodEdit(p => ({ ...p, end, payDate: end ? calcDefaultPayDate(end) : p.payDate })); }}
                        style={{ height: 26, fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px' }} />
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Pay:</span>
                      <input type="date" value={periodEdit.payDate}
                        onChange={e => setPeriodEdit(p => ({ ...p, payDate: e.target.value }))}
                        style={{ height: 26, fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px' }} />
                      <button className="btn btn-primary btn-sm" style={{ fontSize: 10, padding: '0 8px', height: 26 }}
                        onClick={() => handleSavePeriod(stub.id)} disabled={savingPeriod}>
                        {savingPeriod ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Save'}
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '0 6px', height: 26 }}
                        onClick={() => setPeriodEdit(null)}>×</button>
                    </div>
                  </td>
                ) : (
                  <>
                    <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: '#222',
                      cursor: canEditPeriod ? 'pointer' : 'default' }}
                      onClick={canEditPeriod ? e => { e.stopPropagation(); setPeriodEdit({ id: stub.id, start: stub.pay_period_start || '', end: stub.pay_period_end || '', payDate: stub.settlement_date || '' }); } : undefined}
                      title={canEditPeriod ? 'Click to edit period' : ''}>
                      {fmtDate(stub.pay_period_start)}{canEditPeriod && <span style={{ marginLeft: 3, opacity: 0.35, fontSize: 9 }}>✏</span>}
                    </td>
                    <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: '#222' }}>{fmtDate(stub.pay_period_end)}</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: displayStatus === 'late' ? '#dc2626' : '#222' }}>{fmtDate(stub.settlement_date)}</td>
                  </>
                )}
                <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#111', fontSize: 12 }}>{stub.regular_hours != null ? stub.regular_hours : '—'}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#111', fontSize: 12 }}>{stub.overtime_hours > 0 ? stub.overtime_hours : '—'}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#111', fontSize: 12 }}>{
                  (() => {
                    const regItem = (stub.lineItems || []).find(li => li.pay_type === 'regular');
                    return regItem?.rate != null ? `$${Number(regItem.rate).toFixed(2)}` : '—';
                  })()
                }</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--success, #16a34a)', fontSize: 13 }}>
                  {stub.net_pay != null ? fmt(stub.net_pay) : '—'}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                  {!isVoided ? (
                    <span style={{ cursor: 'pointer' }} title="Click to change status"
                      onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setEmpStatusDrop(empStatusDrop?.stub?.id === stub.id ? null : { stub, top: r.bottom + 4, right: window.innerWidth - r.right }); }}>
                      <StatusBadge status={displayStatus} />
                    </span>
                  ) : (
                    <StatusBadge status={displayStatus} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div>
      {/* Tab strip */}
      {tabs.length > 0 && (
        <div className="pay-subtabs" style={{ marginBottom: 12 }}>
          {tabs.map(g => {
            const deleted = !!g.deletedAt;
            return (
              <button key={g.id} className={`pay-subtab${currentGroupId === g.id ? ' active' : ''}`}
                onClick={() => { setCurrentGroupId(g.id); setRunErr(''); setRunSuccess(''); setSelectedLateStubs(new Set()); setSelectedHistoryStubs(new Set()); }}
                style={deleted ? { opacity: 0.5, fontStyle: 'italic' } : {}}>
                {g.name}{deleted ? ' (Deleted)' : ''}
                {g.id !== UNASSIGNED_ID && !deleted && (
                  <span style={{ opacity: 0.6, fontSize: 11, marginLeft: 4 }}>
                    ({activeEmps.filter(e => e.payGroupId === g.id).length})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Group header + action bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {currentGroup && currentGroup.id !== UNASSIGNED_ID && (
          <>
            <span style={{ fontWeight: 700, fontSize: 14, fontStyle: isGroupDeleted ? 'italic' : 'normal', opacity: isGroupDeleted ? 0.6 : 1 }}>{currentGroup.name}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{FREQ_LABEL[currentGroup.frequency] || currentGroup.frequency}</span>
            {!isGroupDeleted && <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setEditGroup(currentGroup)}>Edit Group</button>}
            {isGroupDeleted && <span className="badge badge-error" style={{ fontSize: 10 }}>Deleted</span>}
            <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          </>
        )}
        {!isGroupDeleted && (hasLateRows || hasDueSoonRows) && (
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={handleSelectAllDue}>Select All Due</button>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setShowPaycheckImport(true)}>
          ↑ Import from QB
        </button>
        {!isGroupDeleted && (
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setUngroupedModal(true)}>
            + Ungrouped Check
          </button>
        )}
        {!isGroupDeleted && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleRunPayroll('print')}
              disabled={running || totalActionCount === 0}
              title="Process payroll and download paychecks"
            >
              {running ? <span className="spinner" /> : `🖨 Print Paycheck${totalActionCount > 0 ? ` (${totalActionCount})` : ''}`}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleRunPayroll('paystub')}
              disabled={running || totalActionCount === 0}
              title="Process payroll and download pay stubs"
            >
              {running ? <span className="spinner" /> : `📄 Print Paystub${totalActionCount > 0 ? ` (${totalActionCount})` : ''}`}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => handleRunPayroll('dd')}
              disabled={running || totalActionCount === 0}
              title="Process payroll and send via direct deposit"
            >
              {running ? <span className="spinner" /> : `⚡ Direct Deposit${totalActionCount > 0 ? ` (${totalActionCount})` : ''}`}
            </button>
          </div>
        )}
      </div>

      {isGroupDeleted && (
        <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 12 }}>
          <span>⚠</span> This pay group has been deleted. Historical checks are shown below for reference.
        </div>
      )}
      {runErr     && <div className="alert alert-error"   style={{ marginBottom: 10 }}><span>⚠</span>{runErr}<button onClick={() => setRunErr('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button></div>}
      {runSuccess && <div className="alert alert-success" style={{ marginBottom: 10 }}><span>✓</span>{runSuccess}<button onClick={() => setRunSuccess('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button></div>}

      {/* Bulk action bar */}
      {selectedHistoryStubs.size > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--accent)', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{selectedHistoryStubs.size} check{selectedHistoryStubs.size !== 1 ? 's' : ''} selected</span>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.3)' }} />
          <span style={{ fontSize: 12, opacity: 0.85 }}>Change status:</span>
          {[
            { value: 'printed',                label: 'Printed' },
            { value: 'direct_deposit_cleared', label: 'Deposited' },
            { value: 'draft',                  label: 'Upcoming' },
          ].map(({ value, label }) => (
            <button key={value} disabled={bulkBusy}
              onClick={() => handleBulkStatusChange(value)}
              style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 5, color: '#fff', padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
              {label}
            </button>
          ))}
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.3)' }} />
          <button disabled={bulkBusy} onClick={async () => {
            setBulkBusy(true);
            try { await api.printSelectedChecks(clientId, [...selectedHistoryStubs]); } catch (e) { alert(e.message); }
            finally { setBulkBusy(false); }
          }} style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 5, color: '#fff', padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            ↓ Paycheck
          </button>
          <button disabled={bulkBusy} onClick={async () => {
            setBulkBusy(true);
            try { await api.printSelectedPaystubs(clientId, [...selectedHistoryStubs]); } catch (e) { alert(e.message); }
            finally { setBulkBusy(false); }
          }} style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 5, color: '#fff', padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            ↓ Paystub
          </button>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.3)' }} />
          <button disabled={bulkBusy} onClick={handleBulkDelete}
            style={{ background: '#dc2626', border: 'none', borderRadius: 5, color: '#fff', padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
            {bulkBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Delete'}
          </button>
          <button onClick={() => setSelectedHistoryStubs(new Set())}
            style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 5, color: '#fff', padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      )}

      {/* Main table: pending + late checks */}
      {mainRows.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
          {renderTable(mainRows, 0)}
        </div>
      )}

      {/* Empty state */}
      {mainRows.length === 0 && printedRows.length === 0 && (
        <div className="card">
          <div className="empty-state" style={{ padding: '32px 20px' }}>
            <div className="empty-state-icon">📋</div>
            <h3>No payroll history</h3>
            <p>Set up this pay group with a first period end date to get started.</p>
          </div>
        </div>
      )}

      {/* Collapsible: Printed & Deposited Checks */}
      {printedRows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowPrinted(p => !p)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}
          >
            <span style={{ fontSize: 11, transition: 'transform 0.15s', display: 'inline-block', transform: showPrinted ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            Printed &amp; Deposited Checks ({printedRows.length})
          </button>
          {showPrinted && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 6 }}>
              {renderTable(printedRows, mainRows.length)}
            </div>
          )}
        </div>
      )}

      {/* Check detail modal */}
      {detailModal && <CheckDetailModal rowData={detailModal} onClose={() => setDetailModal(null)} />}

      {/* Rate change confirmation */}
      {rateUpdatePrompt && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
          <div className="card" style={{ width: 380, padding: 28, borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Rate Changed to ${(rateUpdatePrompt.newRate || 0).toFixed(2)}/hr</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
              Would you like this rate to be changed for all future checks for this employee?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setRateUpdatePrompt(null)}>
                No, just one time change
              </button>
              <button className="btn btn-primary" onClick={async () => {
                const { empId, newRate } = rateUpdatePrompt;
                setRateUpdatePrompt(null);
                const emp = activeEmps.find(e => e.id === empId);
                if (!emp) return;
                try {
                  await api.updateEmployee(empId, { ...emp, hourlyRate: newRate });
                  if (onRefresh) await onRefresh();
                } catch (e) {
                  console.error('Failed to update employee rate:', e);
                }
              }}>
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Employee status dropdown — fixed so it's never clipped by overflow:hidden */}
      {empStatusDrop && (
        <div onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: empStatusDrop.top, right: empStatusDrop.right, zIndex: 9999, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', minWidth: 230, padding: '4px 0' }}>
          {[
            { value: 'draft',                  label: 'Upcoming / Due Soon / Late', badge: 'upcoming'              },
            { value: 'printed',                label: 'Printed',                    badge: 'printed'               },
            { value: 'direct_deposit_cleared', label: 'Deposited',                  badge: 'direct_deposit_cleared' },
          ].map(({ value, label, badge }) => {
            const curStatus = empStatusDrop.stub?.check_status ?? (empStatusDrop.period ? 'draft' : 'draft');
            const isCur = curStatus === value;
            return (
              <button key={value} onClick={() => handleEmpStatusChange(empStatusDrop, value)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', background: isCur ? 'var(--accent-light)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <StatusBadge status={badge} />
                <span style={{ fontSize: 12, fontWeight: isCur ? 700 : 400 }}>{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Employee edit drawer */}
      {drawerEmpId && (
        <EmployeeDrawer clientId={clientId} empId={drawerEmpId}
          onClose={() => setDrawerEmpId(null)}
          onSaved={() => { setDrawerEmpId(null); onRefresh?.(); }} />
      )}

      {/* Pay Group Editor */}
      {editGroup && editGroup.id !== UNASSIGNED_ID && (
        <PayGroupEditorModal group={editGroup} clientId={clientId} allGroups={payGroups}
          onSaved={() => { setEditGroup(null); api.getPayGroups(clientId).then(setPayGroups); }}
          onClose={() => setEditGroup(null)}
          onMoved={() => { onRefresh?.(); }}
          onDeleted={() => {
            const deletedId = editGroup.id;
            setEditGroup(null);
            onRefresh?.();
            api.getPayGroups(clientId).then(groups => {
              setPayGroups(groups);
              const next = groups.find(g => g.id !== deletedId && !g.deletedAt);
              setCurrentGroupId(next ? next.id : (unassignedEmps.length > 0 ? UNASSIGNED_ID : null));
            });
          }} />
      )}

      {/* Print Checks Modal */}
      {printModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}
          onClick={e => { if (e.target === e.currentTarget) setPrintModal(null); }}>
          <div className="card" style={{ width: 420, maxWidth: '92vw', padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Payroll Complete!</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 22 }}>
              {printModal.ids.length} check{printModal.ids.length !== 1 ? 's' : ''} processed and marked as printed.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={async () => {
                try { await api.printSelectedChecks(clientId, printModal.ids); } catch (e) { alert(e.message); }
                setPrintModal(null);
              }}>
                ↓ Download Paycheck
              </button>
              <button className="btn btn-secondary" onClick={async () => {
                try { await api.printSelectedPaystubs(clientId, printModal.ids); } catch (e) { alert(e.message); }
                setPrintModal(null);
              }}>
                ↓ Download Paystub
              </button>
              <button className="btn btn-ghost" onClick={() => setPrintModal(null)}>Not Now</button>
            </div>
          </div>
        </div>
      )}

      {showPaycheckImport && (
        <ImportPaychecksModal clientId={clientId} onClose={() => setShowPaycheckImport(false)} onImported={() => { setShowPaycheckImport(false); onRefresh(); }} />
      )}

      {/* Ungrouped Payroll Modal */}
      {ungroupedModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}
          onClick={e => { if (e.target === e.currentTarget) { setUngroupedModal(false); setUgPreview(null); setUgOtherOpen(false); } }}>

          {/* ── Step 1: Form ── */}
          {!ugPreview && (
            <div className="card" style={{ width: 480, maxWidth: '95vw', padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Ungrouped Check</div>
                <button onClick={() => { setUngroupedModal(false); setUgOtherOpen(false); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
              </div>
              {ugErr && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{ugErr}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Employee
                  <select className="form-input" value={ugForm.employeeId}
                    onChange={e => setUgForm(f => ({ ...f, employeeId: e.target.value, rate: '' }))}
                    style={{ marginTop: 4, width: '100%' }}>
                    <option value="">Select employee…</option>
                    {activeEmps.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                  </select>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Period Start
                    <input className="form-input" type="date" value={ugForm.start}
                      onChange={e => setUgForm(f => ({ ...f, start: e.target.value }))}
                      style={{ marginTop: 4, width: '100%' }} />
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Period End
                    <input className="form-input" type="date" value={ugForm.end}
                      onChange={e => { const end = e.target.value; setUgForm(f => ({ ...f, end, payDate: end ? calcDefaultPayDate(end) : f.payDate })); }}
                      style={{ marginTop: 4, width: '100%' }} />
                  </label>
                </div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Pay Date
                  <input className="form-input" type="date" value={ugForm.payDate}
                    onChange={e => setUgForm(f => ({ ...f, payDate: e.target.value }))}
                    style={{ marginTop: 4, width: '100%' }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Pay Type
                  <select className="form-input" value={ugForm.payType}
                    onChange={e => setUgForm(f => ({ ...f, payType: e.target.value }))}
                    style={{ marginTop: 4, width: '100%' }}>
                    <option value="regular">Regular (Hourly)</option>
                    <option value="salary">Salary</option>
                  </select>
                </label>
                {ugForm.payType !== 'salary' && (() => {
                  const ugEmp = activeEmps.find(e => e.id === Number(ugForm.employeeId));
                  const empRate = ugEmp?.hourlyRate || '';
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Reg Hours
                        <input className="form-input mono" type="number" min="0" step="0.5" value={ugForm.regHours} placeholder="0"
                          onChange={e => setUgForm(f => ({ ...f, regHours: e.target.value }))}
                          style={{ marginTop: 4, width: '100%' }} />
                      </label>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>OT Hours
                        <input className="form-input mono" type="number" min="0" step="0.5" value={ugForm.otHours} placeholder="0"
                          onChange={e => setUgForm(f => ({ ...f, otHours: e.target.value }))}
                          style={{ marginTop: 4, width: '100%' }} />
                      </label>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Hourly Rate
                        <input className="form-input mono" type="number" min="0" step="0.01"
                          value={ugForm.rate !== '' ? ugForm.rate : empRate}
                          placeholder={String(empRate || '0.00')}
                          onChange={e => setUgForm(f => ({ ...f, rate: e.target.value }))}
                          style={{ marginTop: 4, width: '100%' }} />
                      </label>
                    </div>
                  );
                })()}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <button type="button" onClick={() => setUgOtherOpen(o => !o)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {ugOtherOpen ? '▴' : '▾'} Other Payroll Items (tips, bonus, etc.)
                  </button>
                  {ugOtherOpen && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                      {[
                        { label: 'Reported Tips', field: 'tips', hint: 'taxable' },
                        { label: 'Bonus', field: 'bonus', hint: 'taxable' },
                        { label: 'Commission', field: 'commission', hint: 'taxable' },
                        { label: 'Mileage Reimbursement', field: 'mileage', hint: 'non-taxable' },
                        { label: 'Cash Advance', field: 'cashAdvance', hint: 'deduction' },
                      ].map(({ label, field, hint }) => (
                        <label key={field} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                          {label} <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)' }}>({hint})</span>
                          <input className="form-input mono" type="number" min="0" step="0.01" value={ugForm[field] || ''} placeholder="0.00"
                            onChange={e => setUgForm(f => ({ ...f, [field]: e.target.value }))}
                            style={{ marginTop: 4, width: '100%' }} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                <button className="btn btn-ghost" onClick={() => { setUngroupedModal(false); setUgOtherOpen(false); }}>Cancel</button>
                <button className="btn btn-primary" onClick={handleUgCalculate} disabled={ugRunning}>
                  {ugRunning ? <span className="spinner" /> : 'Preview Check →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Full check preview ── */}
          {ugPreview && (() => {
            const { emp, isSalary, regH, otH, rate, regPay, otPay, gross, ugTips, ugBonus, ugComm, ugCashAdv, ugMile, calc, ytd } = ugPreview;
            const netPay    = r2(gross - (calc.fitWithholding || 0) - (calc.employeeSS || 0) - (calc.employeeMedicare || 0) - (calc.additionalMedicare || 0) - (calc.stateIncomeTax || 0) - ugCashAdv);
            const erTotal   = r2((calc.employerSS || 0) + (calc.employerMedicare || 0) + (calc.futaTax || 0) + (calc.sutaTax || 0));
            const dep941    = r2((calc.fitWithholding || 0) + (calc.employeeSS || 0) + (calc.employerSS || 0) + (calc.employeeMedicare || 0) + (calc.employerMedicare || 0) + (calc.additionalMedicare || 0));
            const hasDD     = emp.bank_account_status === 'active';
            const MONO      = { fontFamily: 'JetBrains Mono, monospace' };
            const Row = ({ label, amount, ytdAmt, color, bold, borderTop, negative }) => {
              const display = negative ? (amount > 0 ? -amount : amount) : amount;
              return (
                <tr style={{ borderTop: borderTop ? '2px solid var(--border)' : undefined }}>
                  <td style={{ padding: '5px 0', fontSize: 12, color: bold ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: bold ? 700 : 400 }}>{label}</td>
                  <td style={{ padding: '5px 0 5px 10px', textAlign: 'right', ...MONO, fontSize: 12, fontWeight: bold ? 700 : 500, color: color || (negative && amount > 0 ? '#dc2626' : 'inherit') }}>
                    {typeof display === 'number' ? fmt(display) : display}
                  </td>
                  {ytdAmt !== undefined && (
                    <td style={{ padding: '5px 0 5px 10px', textAlign: 'right', ...MONO, fontSize: 11, color: 'var(--text-muted)' }}>{fmt(ytdAmt)}</td>
                  )}
                </tr>
              );
            };
            return (
              <div className="card" style={{ width: 740, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>
                {/* Header */}
                <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 20 }}>{emp.firstName} {emp.lastName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{isSalary ? 'Salary' : 'Hourly'} · Ungrouped Check · Preview</div>
                    </div>
                    <button onClick={() => { setUngroupedModal(false); setUgPreview(null); setUgOtherOpen(false); }}
                      style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
                  </div>
                  <div style={{ display: 'flex', marginTop: 14, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    {[['Period Start', ugForm.start], ['Period End', ugForm.end], ['Pay Date', ugForm.payDate]].map(([label, val], i, arr) => (
                      <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                        <div style={{ ...MONO, fontSize: 13, fontWeight: 600 }}>{fmtDate(val)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Two-column body */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
                  {/* Employee Summary */}
                  <div style={{ padding: '18px 20px 18px 24px', borderRight: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Employee Summary</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'left' }}>Item Name</th>
                        <th style={{ padding: '0 0 6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '0 0 6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>YTD</th>
                      </tr></thead>
                      <tbody>
                        {!isSalary && regH > 0 && <Row label={`Hourly (${regH} hrs)`} amount={regPay} color="var(--accent)" />}
                        {!isSalary && otH  > 0 && <Row label={`Overtime (${otH} hrs)`} amount={otPay}  color="var(--accent)" />}
                        {isSalary && <Row label="Salary / Period" amount={regPay} color="var(--accent)" />}
                        {ugTips  > 0 && <Row label="Reported Tips"  amount={ugTips}  color="var(--accent)" />}
                        {ugBonus > 0 && <Row label="Bonus"          amount={ugBonus} color="var(--accent)" />}
                        {ugComm  > 0 && <Row label="Commission"     amount={ugComm}  color="var(--accent)" />}
                        <Row label="Gross Pay"         amount={gross}                        ytdAmt={ytd.gross}    color="var(--accent)" bold borderTop />
                        <Row label="Federal Income Tax" amount={calc.fitWithholding || 0}    ytdAmt={ytd.fit}      negative color={(calc.fitWithholding || 0) > 0 ? '#dc2626' : 'var(--text-muted)'} />
                        <Row label="Social Security"    amount={calc.employeeSS || 0}        ytdAmt={ytd.eeSS}     negative color={(calc.employeeSS || 0) > 0 ? '#dc2626' : 'var(--text-muted)'} />
                        <Row label="Medicare"           amount={calc.employeeMedicare || 0}  ytdAmt={ytd.eeMed}    negative color={(calc.employeeMedicare || 0) > 0 ? '#dc2626' : 'var(--text-muted)'} />
                        <Row label="State Income Tax"   amount={calc.stateIncomeTax || 0}    ytdAmt={ytd.stateTax} negative color={(calc.stateIncomeTax || 0) > 0 ? '#dc2626' : 'var(--text-muted)'} />
                        {ugCashAdv > 0 && <Row label="Cash Advance (deduction)" amount={ugCashAdv} negative color="#dc2626" />}
                      </tbody>
                    </table>
                  </div>
                  {/* Company Summary */}
                  <div style={{ padding: '18px 24px 18px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Company Summary</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'left' }}>Item Name</th>
                        <th style={{ padding: '0 0 6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '0 0 6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>YTD</th>
                      </tr></thead>
                      <tbody>
                        <Row label="SS Match (Company)"       amount={calc.employerSS || 0}       ytdAmt={ytd.erSS ?? 0}  />
                        <Row label="Medicare Match (Company)" amount={calc.employerMedicare || 0}  ytdAmt={ytd.erMed ?? 0} />
                        <Row label="Federal Unemployment"     amount={calc.futaTax || 0}           ytdAmt={ytd.futa}       />
                        <Row label={`${emp.workState || 'State'} Unemployment`} amount={calc.sutaTax || 0} ytdAmt={ytd.suta} />
                        <Row label="Total Company Cost"       amount={erTotal}                     ytdAmt={r2((ytd.erSS ?? 0) + (ytd.erMed ?? 0) + ytd.futa + ytd.suta)} bold borderTop color="var(--text-primary)" />
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Check Amount */}
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Check Amount</div>
                  <div style={{ ...MONO, fontWeight: 800, fontSize: 22, color: '#16a34a' }}>{fmt(netPay)}</div>
                </div>

                {/* Tax deposit tiles */}
                <div style={{ padding: '14px 24px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {[
                    { label: '941 TAX DEPOSIT', value: fmt(dep941) },
                    { label: '940 FUTA',         value: fmt(calc.futaTax || 0) },
                    { label: 'STATE SUI',         value: fmt(calc.sutaTax || 0) },
                    { label: 'TOTAL TAX COSTS',   value: fmt(r2(dep941 + (calc.futaTax || 0) + (calc.sutaTax || 0))), highlight: true },
                  ].map(({ label, value, highlight }) => (
                    <div key={label} style={{ background: highlight ? 'var(--accent-light, #f0fdf4)' : 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                      <div style={{ ...MONO, fontWeight: 700, fontSize: 14 }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Footer buttons */}
                <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {ugErr && <span style={{ fontSize: 12, color: '#dc2626', flex: 1 }}>{ugErr}</span>}
                  <button className="btn btn-ghost" onClick={() => setUgPreview(null)} disabled={ugRunning}>← Back</button>
                  <button className="btn btn-secondary" onClick={() => handleUngroupedRun('print')} disabled={ugRunning}>
                    {ugRunning ? <span className="spinner" /> : '🖨 Print Paycheck'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleUngroupedRun('paystub')} disabled={ugRunning}>
                    {ugRunning ? <span className="spinner" /> : '📄 Print Paystub'}
                  </button>
                  <button className="btn btn-primary" onClick={() => handleUngroupedRun('dd')} disabled={ugRunning || !hasDD}
                    title={!hasDD ? 'No active direct deposit on file for this employee' : ''}>
                    {ugRunning ? <span className="spinner" /> : '⚡ Direct Deposit'}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}



// ── Pay Liabilities — Inline Check Editor ─────────────────────────────────────
function LiabilityCheckEditor({ stub, clientId, client, onUpdated, onClose }) {
  const depositSchedule = client?.depositSchedule || 'monthly';

  function calcSettlementDue(payDate) {
    if (!payDate) return '';
    return calcIRSDepositDue(payDate, depositSchedule);
  }

  const initialSettlementDue = stub.settlement_due_date ||
    (stub.settlement_date ? calcSettlementDue(stub.settlement_date) : '');

  const [form, setForm] = useState({
    grossWages: String(stub.gross_wages || ''),
    filingStatus: stub.filing_status || 'single',
    payFrequency: stub.pay_frequency || 'biweekly',
    workState: stub.work_state || client?.state || 'TX',
    payPeriodStart: stub.pay_period_start || '',
    payPeriodEnd: stub.pay_period_end || '',
    settlementDate: stub.settlement_date || '',
    settlementDueDate: initialSettlementDue,
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
      const result = await api.calculate({ grossWages: gross, payFrequency: form.payFrequency, filingStatus: form.filingStatus, step2Checkbox: false, step3Children: 0, step3Other: 0, step4a: 0, step4b: 0, step4c: 0, workState: form.workState, ytdGross: stub.ytd_wages_before || 0, sutaRate: client?.suiRateQ1 || client?.suiRateQ2 || client?.suiRateQ3 || client?.suiRateQ4 || null });
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
        settlementDueDate: form.settlementDueDate || null,
      });
      onUpdated();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  function handlePayDateChange(val) {
    setForm(f => ({
      ...f,
      settlementDate: val,
      settlementDueDate: val ? calcSettlementDue(val) : '',
    }));
  }

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Period Start</label><input className="form-input" type="date" value={form.payPeriodStart} onChange={set('payPeriodStart')} style={{ height: 32, fontSize: 13 }} /></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Period End</label><input className="form-input" type="date" value={form.payPeriodEnd} onChange={set('payPeriodEnd')} style={{ height: 32, fontSize: 13 }} /></div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Pay Date</label>
              <input className="form-input" type="date" value={form.settlementDate} onChange={e => handlePayDateChange(e.target.value)} style={{ height: 32, fontSize: 13 }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Settlement Date <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-muted)', fontSize: 10 }}>(EFTPS)</span></label>
              <input className="form-input" type="date" value={form.settlementDueDate} onChange={set('settlementDueDate')} style={{ height: 32, fontSize: 13 }} />
              {form.settlementDueDate && (
                <div style={{ fontSize: 10, color: isOverdue(form.settlementDueDate) ? '#dc2626' : 'var(--text-muted)', marginTop: 3, fontWeight: isOverdue(form.settlementDueDate) ? 700 : 400 }}>
                  {isOverdue(form.settlementDueDate) ? '⚠ Overdue' : `Due ${fmtDate(form.settlementDueDate)}`}
                </div>
              )}
            </div>
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

// ── Liability shared helpers ──────────────────────────────────────────────────
function calcLiabilityDue(stub, taxType, schedule) {
  const refDate = stub.settlement_date || stub.pay_period_end;
  if (!refDate) return null;
  const d = new Date(refDate + 'T00:00:00');
  const q = Math.ceil((d.getMonth() + 1) / 3);
  const qMons = [3, 6, 9, 0];  // Apr, Jul, Oct, Jan
  const qDays = [30, 31, 31, 31];
  const qYear = q === 4 ? d.getFullYear() + 1 : d.getFullYear();

  if (taxType === '941') {
    if (schedule === 'semiweekly') return calcIRSDepositDue(refDate, 'semiweekly');
    if (schedule === 'quarterly')  return nextBizDay(new Date(qYear, qMons[q - 1], qDays[q - 1])).toISOString().slice(0, 10);
    return nextBizDay(new Date(d.getFullYear(), d.getMonth() + 1, 15)).toISOString().slice(0, 10); // monthly
  }
  if (taxType === '940') {
    if (schedule === 'annually') return nextBizDay(new Date(d.getFullYear() + 1, 0, 31)).toISOString().slice(0, 10);
    return nextBizDay(new Date(qYear, qMons[q - 1], qDays[q - 1])).toISOString().slice(0, 10); // quarterly
  }
  // SUI
  if (schedule === 'monthly')  return nextBizDay(new Date(d.getFullYear(), d.getMonth() + 1, 15)).toISOString().slice(0, 10);
  if (schedule === 'annually') return nextBizDay(new Date(d.getFullYear() + 1, 0, 31)).toISOString().slice(0, 10);
  return nextBizDay(new Date(qYear, qMons[q - 1], qDays[q - 1])).toISOString().slice(0, 10); // quarterly
}

function calcSendByDate(dueDate) {
  if (!dueDate) return null;
  let d = new Date(dueDate + 'T00:00:00'), count = 0;
  while (count < 2) { d.setDate(d.getDate() - 1); if (isBizDay(d)) count++; }
  return d.toISOString().slice(0, 10);
}

function calcLiabilityStatus(stub, taxType, sendBy, due, todayStr) {
  const submitted = taxType === '940' ? stub.status_940 === 'submitted' : taxType === 'sui' ? (stub.status_sui || 'pending') === 'submitted' : stub.status === 'submitted';
  if (submitted) return 'completed';
  if (!due) return 'upcoming';
  if (todayStr > due) return 'late';
  if (sendBy && todayStr >= sendBy) return 'due-soon';
  const days = daysUntil(sendBy || due);
  if (days !== null && days <= 5) return 'due-soon';
  return 'upcoming';
}

const LIAB_STATUS_CFG = {
  upcoming:  { label: 'Upcoming',  cls: 'badge-neutral' },
  'due-soon':{ label: 'Due Soon',  cls: 'badge-warning' },
  late:      { label: 'Late',      cls: 'badge-error'   },
  completed: { label: 'Sent',      cls: 'badge-success' },
};
function LiabStatusBadge({ status }) {
  const cfg = LIAB_STATUS_CFG[status] || LIAB_STATUS_CFG.upcoming;
  return <span className={`badge ${cfg.cls}`} style={{ fontWeight: 700, fontSize: 10 }}>{cfg.label}</span>;
}

const SUI_AGENCIES = {
  AL: 'Alabama Dept. of Labor',
  AK: 'Alaska Dept. of Labor & Workforce Dev.',
  AZ: 'Arizona Dept. of Economic Security',
  AR: 'Arkansas Division of Workforce Services',
  CA: 'California Employment Dev. Dept. (EDD)',
  CO: 'Colorado Dept. of Labor & Employment',
  CT: 'Connecticut Dept. of Labor',
  DE: 'Delaware Dept. of Labor',
  FL: 'Florida Dept. of Commerce — DEO',
  GA: 'Georgia Dept. of Labor',
  HI: 'Hawaii Dept. of Labor & Industrial Relations',
  ID: 'Idaho Dept. of Labor',
  IL: 'Illinois Dept. of Employment Security',
  IN: 'Indiana Dept. of Workforce Development',
  IA: 'Iowa Workforce Development',
  KS: 'Kansas Dept. of Labor',
  KY: 'Kentucky Education & Workforce Cabinet',
  LA: 'Louisiana Workforce Commission',
  ME: 'Maine Dept. of Labor',
  MD: 'Maryland Dept. of Labor',
  MA: 'Massachusetts Dept. of Unemployment Assistance',
  MI: 'Michigan Unemployment Insurance Agency',
  MN: 'Minnesota Dept. of Employment & Economic Dev.',
  MS: 'Mississippi Dept. of Employment Security',
  MO: 'Missouri Division of Employment Security',
  MT: 'Montana Dept. of Labor & Industry',
  NE: 'Nebraska Dept. of Labor',
  NV: 'Nevada Employment Security Division',
  NH: 'New Hampshire Employment Security',
  NJ: 'New Jersey Dept. of Labor',
  NM: 'New Mexico Dept. of Workforce Solutions',
  NY: 'New York Dept. of Labor',
  NC: 'North Carolina Division of Employment Security',
  ND: 'North Dakota Job Service',
  OH: 'Ohio Dept. of Job & Family Services',
  OK: 'Oklahoma Employment Security Commission',
  OR: 'Oregon Employment Dept.',
  PA: 'Pennsylvania Office of Unemployment Compensation',
  RI: 'Rhode Island Dept. of Labor & Training',
  SC: 'South Carolina Dept. of Employment & Workforce',
  SD: 'South Dakota Dept. of Labor & Regulation',
  TN: 'Tennessee Dept. of Labor & Workforce Dev.',
  TX: 'Texas Workforce Commission',
  UT: 'Utah Dept. of Workforce Services',
  VT: 'Vermont Dept. of Labor',
  VA: 'Virginia Employment Commission',
  WA: 'Washington Employment Security Dept.',
  WV: 'West Virginia Workforce West Virginia',
  WI: 'Wisconsin Dept. of Workforce Development',
  WY: 'Wyoming Dept. of Workforce Services',
  DC: 'DC Dept. of Employment Services',
};

function liabilityVendor(taxType, workState) {
  if (taxType === '941' || taxType === '940') return 'United States Treasury';
  return SUI_AGENCIES[workState] || `${workState || 'State'} Dept. of Labor`;
}

// Shared detail modal for both pending and sent liabilities
function LiabilityDetailModal({ stub, taxType, due, sendBy, todayStr, onClose, onStubChange, onDelete, onPay, clientId }) {
  if (!stub) return null;
  const [settlementDate, setSettlementDate] = React.useState(stub.eftps_settlement_date || due || '');
  const [savingSettlement, setSavingSettlement] = React.useState(false);
  const [payingNow, setPayingNow] = React.useState(false);
  const settlementInputRef = React.useRef(null);
  const liabStatus = calcLiabilityStatus(stub, taxType, sendBy, due, todayStr);
  const vendor = liabilityVendor(taxType, stub.work_state);
  const liabilityAmount = taxType === '941' ? (stub.total_deposit || 0)
                        : taxType === '940' ? (stub.futa_tax || 0)
                        : (stub.suta_tax || 0);

  // Employee paycheck rows
  const earningRows = [
    stub.regular_hours != null && stub.regular_pay != null && { label: `Hourly  (${stub.regular_hours} hrs)`, amount: stub.regular_pay, positive: true },
    stub.overtime_hours > 0 && stub.overtime_pay > 0       && { label: `Overtime  (${stub.overtime_hours} hrs)`, amount: stub.overtime_pay, positive: true },
    stub.bonus > 0         && { label: 'Bonus',         amount: stub.bonus,         positive: true },
    stub.commission > 0    && { label: 'Commission',    amount: stub.commission,    positive: true },
    stub.reimbursement > 0 && { label: 'Reimbursement', amount: stub.reimbursement, positive: true },
  ].filter(Boolean);

  // If no line items, show gross as a single row
  const showGrossLine = earningRows.length === 0;

  const deductionRows = [
    { label: 'Federal Income Tax',   amount: stub.fit_withholding   || 0 },
    { label: 'Social Security',      amount: stub.employee_ss       || 0 },
    { label: 'Medicare',             amount: stub.employee_medicare || 0 },
    stub.additional_medicare > 0 && { label: 'Addl Medicare',       amount: stub.additional_medicare },
    stub.state_income_tax > 0    && { label: 'State Income Tax',    amount: stub.state_income_tax },
  ].filter(Boolean);

  const employerRows = [
    { label: 'SS Match (Company)',       amount: stub.employer_ss      || 0 },
    { label: 'Medicare Match (Company)', amount: stub.employer_medicare || 0 },
    { label: 'Federal Unemployment',     amount: stub.futa_tax         || 0 },
    { label: `${stub.work_state || 'State'} Unemployment`, amount: stub.suta_tax || 0 },
  ];

  const employerTotal = r2((stub.employer_ss || 0) + (stub.employer_medicare || 0) + (stub.futa_tax || 0) + (stub.suta_tax || 0));

  const MONO = { fontFamily: 'JetBrains Mono, monospace' };

  // Reusable table row
  const Row = ({ label, amount, color, bold, borderTop, indent }) => (
    <tr style={{ borderTop: borderTop ? '1px solid var(--border)' : undefined }}>
      <td style={{ padding: '7px 0 7px 8px', paddingLeft: indent ? 20 : 8, fontSize: 13, color: color || 'var(--text-secondary)', fontWeight: bold ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '7px 8px 7px 0', textAlign: 'right', ...MONO, fontSize: 13, fontWeight: bold ? 700 : 500, color: color || 'inherit' }}>{fmt(amount)}</td>
    </tr>
  );

  const dateColor = liabStatus === 'late' ? '#dc2626' : liabStatus === 'due-soon' ? '#d97706' : 'var(--text-secondary)';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 700, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>

        {/* ── Header ── */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: 'var(--text-primary)', marginBottom: 2 }}>{vendor}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Re: {stub.employee_name}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge status={stub.check_status || 'draft'} />
                <LiabStatusBadge status={liabStatus} />
                {stub.check_number && <span style={{ ...MONO, fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>Check #{stub.check_number}</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>

          {/* Pay period strip */}
          <div style={{ display: 'flex', gap: 0, marginTop: 16, background: 'var(--bg-secondary)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {[
              { label: 'Period Start',  value: fmtDate(stub.pay_period_start), color: null },
              { label: 'Period End',    value: fmtDate(stub.pay_period_end),   color: null },
              { label: 'Pay Date',      value: fmtDate(stub.settlement_date),  color: null },
              sendBy && { label: 'Send By', value: fmtDate(sendBy), color: liabStatus === 'due-soon' || liabStatus === 'late' ? dateColor : null },
            ].filter(Boolean).map(({ label, value, color }, i, arr) => (
              <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ ...MONO, fontSize: 13, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</div>
              </div>
            ))}
            {due && (
              <div style={{ flex: 1, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Settlement Date</div>
                <div style={{ ...MONO, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
                  onClick={() => settlementInputRef.current?.showPicker?.()}>
                  {fmtDate(settlementDate || due)}
                </div>
                <input
                  ref={settlementInputRef}
                  type="date"
                  value={settlementDate || due}
                  max={due}
                  onChange={e => setSettlementDate(e.target.value)}
                  onBlur={async () => {
                    const val = settlementDate || due;
                    if (val === (stub.eftps_settlement_date || due)) return;
                    setSavingSettlement(true);
                    try {
                      await api.updatePaystub(stub.id, { eftpsSettlementDate: val === due ? null : val });
                      if (onStubChange) onStubChange(stub.id, { eftps_settlement_date: val === due ? null : val });
                    } catch (e) { alert(e.message); }
                    finally { setSavingSettlement(false); }
                  }}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                />
                {savingSettlement
                  ? <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>saving…</div>
                  : (!settlementDate || settlementDate === due) && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>* IRS due date</div>
                }
              </div>
            )}
          </div>
        </div>

        {/* ── Two-column body ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

          {/* Left — Employee Paycheck */}
          <div style={{ padding: '20px 20px 0 24px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Employee Summary</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {/* Earnings */}
                {earningRows.map(r => <Row key={r.label} label={r.label} amount={r.amount} color="var(--accent)" />)}
                {showGrossLine && <Row label="Gross Pay" amount={stub.gross_wages || 0} color="var(--accent)" />}
                {!showGrossLine && (
                  <Row label="Gross Pay" amount={stub.gross_wages || 0} color="var(--accent)" bold borderTop />
                )}
                {/* Deductions */}
                {deductionRows.map(r => (
                  <Row key={r.label} label={r.label} amount={-r.amount} color={r.amount > 0 ? '#dc2626' : 'var(--text-muted)'} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Right — Employer Costs */}
          <div style={{ padding: '20px 24px 0 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Company Summary</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {employerRows.map(r => <Row key={r.label} label={r.label} amount={r.amount} />)}
                <Row label="Total Employer Cost" amount={employerTotal} bold borderTop color="var(--text-primary)" />
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Footer — Check Amount + Tax Deposits ── */}
        <div style={{ margin: '16px 24px 0', borderTop: '2px solid var(--border)' }} />

        {/* Check Amount — liability amount payable to vendor */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px 4px' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {taxType === '941' ? '941 Tax Deposit' : taxType === '940' ? '940 FUTA Payment' : 'SUI Payment'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Payable to {vendor}</div>
          </div>
          <div style={{ ...MONO, fontSize: 22, fontWeight: 800, color: '#16a34a' }}>{fmt(liabilityAmount)}</div>
        </div>

        <div style={{ padding: '0 24px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button style={{ background: 'none', border: 'none', fontSize: 12, color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
            onClick={async () => {
              if (!window.confirm('Delete this check? This cannot be undone.')) return;
              if (onDelete) onDelete();
            }}>Delete</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={async () => {
              try { await api.printSelectedChecks(clientId, [stub.id]); } catch (e) { alert(e.message); }
            }}>↓ Paycheck</button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={async () => {
              try { await api.printSelectedPaystubs(clientId, [stub.id]); } catch (e) { alert(e.message); }
            }}>↓ Paystub</button>
            {taxType === 'sui' && (stub.status_sui || 'pending') !== 'submitted' && onPay && (
              <button className="btn btn-primary" style={{ fontSize: 12 }}
                disabled={payingNow}
                onClick={async () => {
                  setPayingNow(true);
                  try { await onPay(stub); } finally { setPayingNow(false); }
                }}>
                {payingNow ? 'Generating…' : '↓ Download SUI Report'}
              </button>
            )}
            {taxType === 'sui' && (stub.status_sui || 'pending') === 'submitted' && (
              <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Submitted</span>
            )}
          </div>
        </div>

        {/* Tax deposit summary bar */}
        <div style={{ display: 'flex', gap: 0, margin: '0 24px 20px', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          {[
            { label: '941 Tax Deposit',   value: fmt(stub.total_deposit || 0) },
            { label: '940 FUTA',          value: fmt(stub.futa_tax      || 0) },
            { label: 'State SUI',         value: fmt(stub.suta_tax      || 0) },
            { label: 'Total Tax Costs',   value: fmt(r2((stub.total_deposit || 0) + (stub.futa_tax || 0) + (stub.suta_tax || 0))), accent: true },
          ].map(({ label, value, accent }, i, arr) => (
            <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none', background: accent ? 'var(--accent-light)' : undefined }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
              <div style={{ ...MONO, fontSize: 14, fontWeight: 800, color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Pay Liabilities Tab ───────────────────────────────────────────────────────
function PayLiabilitiesTab({ clientId, client }) {
  const [paystubs, setPaystubs]     = useState([]);
  const [credits, setCredits]       = useState([]);
  const [loading,  setLoading]      = useState(true);
  const [selected941, setSelected941] = useState(new Set());
  const [selected940, setSelected940] = useState(new Set());
  const [selectedSUI, setSelectedSUI] = useState(new Set());
  const [submitting, setSubmitting] = useState(null);
  const [result,   setResult]       = useState(null);
  const [expanded, setExpanded]     = useState({ '941': true, '940': false, 'sui': false });
  const [liabilityModal, setLiabilityModal] = useState(null); // { stub, taxType, due, sendBy }
  const [sched941, setSched941] = useState(client?.depositSchedule || 'monthly');
  const [sched940, setSched940] = useState('quarterly');
  const [schedSUI, setSchedSUI] = useState('quarterly');
  const [markingPaid, setMarkingPaid] = useState(null);
  const [sentOpen, setSentOpen] = useState(false);
  const [statusDropdown, setStatusDropdown] = useState(null); // { stub, top, right }
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [activeJobId,      setActiveJobId]      = useState(null);
  const [activeJobTaxType, setActiveJobTaxType] = useState(null);
  const [jobStatus,        setJobStatus]        = useState(null);   // 'enrollment_pending' | 'completed' | 'failed'
  const [jobMessage,       setJobMessage]       = useState('');
  const pollRef = useRef(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  // Close liability status dropdown on outside click
  useEffect(() => {
    if (!statusDropdown) return;
    const close = () => setStatusDropdown(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [statusDropdown]);

  async function handleStatusChange(stub, newComputedStatus) {
    const dbStatus = newComputedStatus === 'completed' ? 'submitted' : 'pending';
    const taxType  = statusDropdown?.taxType;
    setStatusDropdown(null);
    setUpdatingStatus(stub.id);
    try { await api.updatePaystubStatus(stub.id, dbStatus, taxType); await reload(); }
    catch (e) { alert(e.message); }
    finally { setUpdatingStatus(null); }
  }

  const ISSUED    = new Set(['printed', 'deposited', 'direct_deposit_sent', 'direct_deposit_cleared']);
  const UNPAID_941 = (s) => s.status     === 'pending' || s.status     === 'processing' || s.status     === 'failed';
  const UNPAID_940 = (s) => s.status_940 === 'pending' || s.status_940 === 'processing' || s.status_940 === 'failed';
  const UNPAID_SUI = (s) => (s.status_sui || 'pending') === 'pending' || s.status_sui === 'processing' || s.status_sui === 'failed';

  async function reload({ keepSelections = false, skipJobRestore = false } = {}) {
    const [stubs, crds] = await Promise.all([api.getPaystubs(clientId), api.getPaystubCredits(clientId)]);
    setPaystubs(stubs); setCredits(crds);
    const pending941Ids = new Set(stubs.filter(s => ISSUED.has(s.check_status) && UNPAID_941(s)).map(s => s.id));
    const pending940Ids = new Set(stubs.filter(s => ISSUED.has(s.check_status) && UNPAID_940(s) && s.futa_tax > 0).map(s => s.id));
    const pendingSUIIds = new Set(stubs.filter(s => ISSUED.has(s.check_status) && s.suta_tax > 0 && UNPAID_SUI(s)).map(s => s.id));
    if (keepSelections) {
      // Preserve the user's selection choices; only remove stubs that are no longer pending
      setSelected941(prev => new Set([...prev].filter(id => pending941Ids.has(id))));
      setSelected940(prev => new Set([...prev].filter(id => pending940Ids.has(id))));
      setSelectedSUI(prev => new Set([...prev].filter(id => pendingSUIIds.has(id))));
    } else {
      setSelected941(pending941Ids);
      setSelected940(pending940Ids);
      setSelectedSUI(pendingSUIIds);
    }

    // Restore polling after page reload — but NOT when we just finished/failed a job,
    // otherwise a 'processing' stub left over from a Railway restart causes an infinite loop.
    if (!skipJobRestore) {
      const processingStub = stubs.find(s =>
        (s.status === 'processing' || s.status_940 === 'processing') && s.bridge_job_id
      );
      if (processingStub) {
        setActiveJobId(prev => prev || processingStub.bridge_job_id);
        setActiveJobTaxType(prev => prev || (processingStub.status === 'processing' ? '941' : '940'));
        setJobStatus(prev => prev || processingStub.bridge_status || 'processing');
      }
    }
  }
  useEffect(() => { reload().finally(() => setLoading(false)); }, [clientId]);

  const pending941 = paystubs.filter(s => ISSUED.has(s.check_status) && UNPAID_941(s));
  const pending940 = paystubs.filter(s => ISSUED.has(s.check_status) && UNPAID_940(s) && s.futa_tax > 0);
  const pendingSUI = paystubs.filter(s => ISSUED.has(s.check_status) && s.suta_tax > 0 && UNPAID_SUI(s));

  const unappCredits = credits.filter(c => !c.applied);
  const credit941 = unappCredits.reduce((s, c) => s + (c.total_941_credit || 0), 0);
  const credit940 = unappCredits.reduce((s, c) => s + (c.total_940_credit || 0), 0);

  // Compute totals for selected stubs using schedule-derived due dates
  function enrichedStubs(stubs, taxType, schedule) {
    return stubs.map(s => {
      const due    = calcLiabilityDue(s, taxType, schedule);
      const sendBy = calcSendByDate(due);
      const status = calcLiabilityStatus(s, taxType, sendBy, due, todayStr);
      return { ...s, _due: due, _sendBy: sendBy, _status: status };
    });
  }
  const e941 = enrichedStubs(pending941, '941', sched941);
  const e940 = enrichedStubs(pending940, '940', sched940);
  const eSUI = enrichedStubs(pendingSUI, 'sui', schedSUI);

  const sel941 = e941.filter(s => selected941.has(s.id));
  const sel940 = e940.filter(s => selected940.has(s.id));
  const selSUI = eSUI.filter(s => selectedSUI.has(s.id));
  const total941 = sel941.reduce((s, p) => s + p.total_deposit, 0) + credit941;
  const total940 = sel940.reduce((s, p) => s + p.futa_tax, 0) + credit940;
  const totalSUI = selSUI.reduce((s, p) => s + (p.suta_tax || 0), 0);

  // Poll job status every 60s while a bridge job is active
  useEffect(() => {
    if (!activeJobId) return;

    async function checkJobStatus() {
      try {
        const s = await api.getBridgeJobStatus(activeJobId);
        setJobStatus(s.status);
        setJobMessage(s.message || '');
        if (s.status === 'completed' || s.status === 'failed') {
          clearInterval(pollRef.current);
          setActiveJobId(null);
          setActiveJobTaxType(null);
          await reload({ skipJobRestore: true });
        }
      } catch (err) {
        // 404 = Railway restarted and lost the job record — treat as failure
        const msg = err?.message || '';
        if (msg.includes('Job not found') || msg.includes('404')) {
          clearInterval(pollRef.current);
          setActiveJobId(null);
          setActiveJobTaxType(null);
          setJobStatus('failed');
          await reload({ skipJobRestore: true });
        }
        // All other errors (network blip, 5xx) are transient — keep polling
      }
    }

    checkJobStatus(); // immediate check on mount (catches Railway restarts fast)
    pollRef.current = setInterval(checkJobStatus, 60_000);
    return () => clearInterval(pollRef.current);
  }, [activeJobId]);

  // Clear polling on unmount
  useEffect(() => () => clearInterval(pollRef.current), []);

  async function handleSubmit(taxType) {
    if (taxType === 'sui') {
      const ids = selSUI.map(s => s.id);
      if (!ids.length) return;
      setSubmitting('sui');
      try {
        await api.downloadSuiReport(clientId, ids);
      } catch (e) { alert(e.message); }
      finally { setSubmitting(null); }
      return;
    }
    const sel = taxType === '941' ? sel941 : sel940;
    const ids = sel.map(s => s.id);
    if (!ids.length && credit941 === 0) return;
    const amt = taxType === '941' ? total941 : total940;
    if (!window.confirm(`Submit ${taxType.toUpperCase()} (${fmt(amt)}) to EFTPS?`)) return;
    setSubmitting(taxType); setResult(null);
    try {
      const res = await api.batchSubmitPaystubs({ clientId, paystubIds: ids, taxType });
      setResult(res);
      if (res.jobId) {
        setActiveJobId(res.jobId);
        setActiveJobTaxType(taxType);
        setJobStatus('processing');
        setJobMessage('');
      }
      await reload({ keepSelections: true });
    } catch (e) { setResult({ error: e.message }); }
    finally { setSubmitting(null); }
  }

  async function handleMarkPaid(stub, taxType) {
    setMarkingPaid(stub.id);
    try {
      await api.updatePaystubStatus(stub.id, 'submitted', taxType);
      await reload();
    } catch (e) { alert(e.message); }
    finally { setMarkingPaid(null); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 28, height: 28 }} /></div>;

  // Group enriched stubs by deposit period (settlement due date)
  function groupByPeriod(stubs, taxType) {
    const map = {};
    stubs.forEach(s => {
      const key = s._due || 'unknown';
      if (!map[key]) map[key] = { due: s._due, sendBy: s._sendBy, stubs: [] };
      map[key].stubs.push(s);
    });
    return Object.values(map).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  }

  function LiabilityGroup({ title, enriched, taxType, total, credit, selected, setSelected }) {
    const isOpen = expanded[taxType];
    const lateCount    = enriched.filter(s => s._status === 'late').length;
    const dueSoonCount = enriched.filter(s => s._status === 'due-soon').length;
    const nextDue      = [...enriched].sort((a, b) => (a._due || '').localeCompare(b._due || ''))[0];

    return (
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div onClick={() => setExpanded(prev => ({ ...prev, [taxType]: !prev[taxType] }))}
          style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: isOpen ? 'var(--accent-light)' : undefined, userSelect: 'none' }}>
          <span style={{ fontSize: 16, color: 'var(--text-muted)', display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none' }}>›</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {enriched.length} check{enriched.length !== 1 ? 's' : ''}
              {lateCount > 0 && <span style={{ color: '#dc2626', fontWeight: 700, marginLeft: 6 }}>⚠ {lateCount} late</span>}
              {dueSoonCount > 0 && <span style={{ color: '#d97706', fontWeight: 600, marginLeft: 6 }}>{dueSoonCount} due soon</span>}
              {nextDue?._due && <span style={{ marginLeft: 6 }}>· Next deposit {fmtDate(nextDue._due)}</span>}
              {credit < 0 && <span style={{ color: 'var(--success)', marginLeft: 8 }}>Credit: {fmt(credit)}</span>}
            </div>
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 18, color: total > 0 ? 'var(--accent)' : 'var(--success)' }}>{fmt(total)}</div>
        </div>

        {isOpen && (
          <div>
            {/* Toolbar */}
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox"
                checked={enriched.length > 0 && enriched.every(s => selected.has(s.id))}
                onChange={e => { const next = new Set(selected); enriched.forEach(s => e.target.checked ? next.add(s.id) : next.delete(s.id)); setSelected(next); }}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>SELECT ALL</span>
              {taxType === 'sui' ? (
                <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}
                  onClick={() => handleSubmit('sui')}
                  disabled={submitting !== null || selSUI.length === 0}>
                  {submitting === 'sui' ? 'Generating…' : `↓ Download SUI Report — ${fmt(totalSUI)}`}
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}
                  onClick={() => handleSubmit(taxType)}
                  disabled={submitting !== null || activeJobId !== null || (taxType === '941' ? sel941.length === 0 : sel940.length === 0)}>
                  {(submitting === taxType || (activeJobId && activeJobTaxType === taxType)) ? 'Sent' : `Pay to EFTPS — ${fmt(taxType === '941' ? total941 : total940)}`}
                </button>
              )}
            </div>

            {/* Credits */}
            {taxType !== 'sui' && unappCredits.filter(c => taxType === '941' ? (c.total_941_credit || 0) < 0 : (c.total_940_credit || 0) < 0).map(c => (
              <div key={`cr-${c.id}`} style={{ padding: '9px 16px', borderBottom: '1px solid var(--border)', background: '#f0fdf4', display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 14 }} />
                <div style={{ flex: 1, fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>CREDIT — {c.employee_name || 'Void reversal'}</div>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--success)', fontSize: 13 }}>{fmt(taxType === '941' ? c.total_941_credit : c.total_940_credit)}</span>
              </div>
            ))}

            {/* Flat check rows — no period headers, no column headers */}
            {enriched.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pending {title.toLowerCase()} liabilities.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 100 }} />
                </colgroup>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ width: 36 }} />
                    <th style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' }}>Employee</th>
                    <th style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' }}>Pay Period</th>
                    <th style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' }}>Send By</th>
                    <th style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' }}>IRS Due</th>
                    <th style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((stub, idx) => {
                    const voided   = stub.check_status === 'voided';
                    const stripeBg = idx % 2 === 0 ? 'var(--bg-primary, #fff)' : '#f8fafc';
                    const lateBg   = stub._status === 'late' ? '#fff5f5' : stub._status === 'due-soon' ? '#fffbeb' : null;
                    const rowBg    = voided ? '#fef2f2' : lateBg || stripeBg;
                    const amount   = taxType === '941' ? (stub.total_deposit || 0) : taxType === '940' ? (stub.futa_tax || 0) : (stub.suta_tax || 0);
                    return (
                      <tr key={stub.id}
                        style={{ background: rowBg, opacity: voided ? 0.6 : 1, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={e => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'BUTTON' && !e.target.closest('[data-dropdown]')) setLiabilityModal({ stub, taxType, due: stub._due, sendBy: stub._sendBy }); }}>
                        <td style={{ padding: '0 0 0 14px' }}>
                          <input type="checkbox" checked={selected.has(stub.id)}
                            onChange={() => { const n = new Set(selected); n.has(stub.id) ? n.delete(stub.id) : n.add(stub.id); setSelected(n); }}
                            style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }} disabled={voided} />
                        </td>
                        <td style={{ padding: '8px 8px' }}>
                          <span style={{ fontWeight: 600, textDecoration: voided ? 'line-through' : 'none' }}>{stub.employee_name || '—'}</span>
                          {stub.check_number && <span style={{ marginLeft: 5, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--accent)' }}>#{stub.check_number}</span>}
                        </td>
                        <td style={{ padding: '8px 8px', fontSize: 12, color: '#555' }}>
                          {fmtPeriod(stub.pay_period_start, stub.pay_period_end)}
                        </td>
                        <td style={{ padding: '8px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: stub._status === 'late' ? '#dc2626' : stub._status === 'due-soon' ? '#d97706' : '#222' }}>
                          {fmtShort(stub._sendBy)}
                        </td>
                        <td style={{ padding: '8px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: stub._status === 'late' ? '#dc2626' : '#222' }}>
                          {fmtShort(stub._due)}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#111', fontSize: 13 }}>
                          {fmt(amount)}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          {updatingStatus === stub.id ? (
                            <span className="spinner" style={{ width: 12, height: 12 }} />
                          ) : (
                            <span data-dropdown style={{ cursor: 'pointer' }}
                              onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setStatusDropdown(statusDropdown?.stub?.id === stub.id ? null : { stub, taxType, top: r.bottom + 4, right: window.innerWidth - r.right }); }}>
                              <LiabStatusBadge status={stub._status} />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Frequency selectors */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>941 Deposit Schedule</div>
            <select className="form-select" value={sched941} onChange={e => setSched941(e.target.value)} style={{ fontSize: 12, height: 30, width: '100%' }}>
              <option value="monthly">Monthly — 15th of following month</option>
              <option value="semiweekly">Semi-weekly — Wed/Fri after pay date</option>
              <option value="quarterly">Quarterly — when filing Form 941</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>940 Payment Schedule</div>
            <select className="form-select" value={sched940} onChange={e => setSched940(e.target.value)} style={{ fontSize: 12, height: 30, width: '100%' }}>
              <option value="quarterly">Quarterly — if liability over $500</option>
              <option value="annually">Annually — Jan 31 (if under $500)</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>State SUI Schedule</div>
            <select className="form-select" value={schedSUI} onChange={e => setSchedSUI(e.target.value)} style={{ fontSize: 12, height: 30, width: '100%' }}>
              <option value="quarterly">Quarterly</option>
              <option value="monthly">Monthly</option>
              <option value="annually">Annually</option>
            </select>
          </div>
        </div>
      </div>

      {/* Live job status banner (polling) */}
      {activeJobId && (
        <div className="alert alert-info" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="spinner spinner-dark" style={{ width: 14, height: 14, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            {(jobStatus === 'enrollment_pending' || paystubs.some(s => s.bridge_status === 'enrollment_pending'))
              ? 'This is your first payment with us — enrollment is in progress. This can take 15 minutes to 1 hour. Please check back later.'
              : 'Payment sent — please check back in 5–10 minutes to confirm it was processed.'}
          </span>
        </div>
      )}
      {!activeJobId && jobStatus === 'completed' && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <span>✓</span>
          <span>Congrats! Your payment has been sent to EFTPS. To see if it has been settled, please visit the EFTPS website.</span>
          <button onClick={() => { setJobStatus(null); setJobMessage(''); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button>
        </div>
      )}
      {!activeJobId && jobStatus === 'failed' && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span>⚠</span>
          <span>Please call or text (210) 238-6850. A technical error has occurred and will be fixed immediately if you reach out!</span>
          <button onClick={() => { setJobStatus(null); setJobMessage(''); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button>
        </div>
      )}
      {paystubs.some(s => s.submission_error === 'BRIDGE_DISCONNECTED' && s.status === 'failed') && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span>⚠</span>
          <span>Please call or text (210) 238-6850. A technical error has occurred and will be fixed immediately if you reach out!</span>
        </div>
      )}
      {result && !activeJobId && jobStatus !== 'completed' && jobStatus !== 'failed' && (
        <div className={`alert ${result.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 16 }}>
          <span>{result.error ? '⚠' : '✓'}</span>
          <span>{result.error ? result.error : `Submitted ${result.submitted} paystub${result.submitted !== 1 ? 's' : ''} — ${fmt(result.totalDeposit)}${result.confirmation ? ` · Conf: ${result.confirmation}` : ''}`}</span>
          <button onClick={() => setResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button>
        </div>
      )}

      {/* Select All Due */}
      {(() => {
        const due941 = e941.filter(s => s._status === 'due-soon' || s._status === 'late');
        const due940 = e940.filter(s => s._status === 'due-soon' || s._status === 'late');
        const dueSUI = eSUI.filter(s => s._status === 'due-soon' || s._status === 'late');
        const totalDue = due941.length + due940.length + dueSUI.length;
        if (totalDue === 0) return null;
        const allSel = due941.every(s => selected941.has(s.id))
                    && due940.every(s => selected940.has(s.id))
                    && dueSUI.every(s => selectedSUI.has(s.id));
        return (
          <div style={{ marginBottom: 10 }}>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
              onClick={() => {
                setSelected941(prev => { const n = new Set(prev); if (allSel) due941.forEach(s => n.delete(s.id)); else due941.forEach(s => n.add(s.id)); return n; });
                setSelected940(prev => { const n = new Set(prev); if (allSel) due940.forEach(s => n.delete(s.id)); else due940.forEach(s => n.add(s.id)); return n; });
                setSelectedSUI(prev => { const n = new Set(prev); if (allSel) dueSUI.forEach(s => n.delete(s.id)); else dueSUI.forEach(s => n.add(s.id)); return n; });
              }}>
              {allSel ? 'Deselect All Due' : 'Select All Due'}
            </button>
          </div>
        );
      })()}

      {(() => {
        const totalSelected = selected941.size + selected940.size + selectedSUI.size;
        if (totalSelected < 2) return null;
        const allSelectedIds = [...selected941, ...selected940, ...selectedSUI];
        const clearAll = () => { setSelected941(new Set()); setSelected940(new Set()); setSelectedSUI(new Set()); };

        async function bulkSetLiabStatus(dbStatus) {
          try {
            const ops = [];
            selected941.forEach(id => ops.push(api.updatePaystubStatus(id, dbStatus, '941').catch(() => {})));
            selected940.forEach(id => ops.push(api.updatePaystubStatus(id, dbStatus, '940').catch(() => {})));
            selectedSUI.forEach(id => ops.push(api.updatePaystubStatus(id, dbStatus, 'sui').catch(() => {})));
            await Promise.all(ops);
            clearAll(); await reload();
          } catch (e) { alert(e.message); }
        }

        const btnStyle = { background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 5, color: '#fff', padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 };
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--accent)', color: '#fff', padding: '8px 14px', borderRadius: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{totalSelected} check{totalSelected !== 1 ? 's' : ''} selected</span>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.3)' }} />
            <span style={{ fontSize: 12, opacity: 0.85 }}>Change status:</span>
            <button style={btnStyle} onClick={() => bulkSetLiabStatus('pending')}>Due Soon / Late</button>
            <button style={btnStyle} onClick={() => bulkSetLiabStatus('submitted')}>Sent</button>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.3)' }} />
            <button onClick={async () => {
              try { await api.printSelectedChecks(clientId, allSelectedIds); } catch (e) { alert(e.message); }
            }} style={btnStyle}>↓ Paycheck</button>
            <button onClick={async () => {
              try { await api.printSelectedPaystubs(clientId, allSelectedIds); } catch (e) { alert(e.message); }
            }} style={btnStyle}>↓ Paystub</button>
            <button onClick={clearAll}
              style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 5, color: '#fff', padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        );
      })()}

      <LiabilityGroup title="Federal 941" enriched={e941} taxType="941" total={total941} credit={credit941} selected={selected941} setSelected={setSelected941} />
      <LiabilityGroup title="Federal 940 (FUTA)" enriched={e940} taxType="940" total={total940} credit={credit940} selected={selected940} setSelected={setSelected940} />
      <LiabilityGroup title="State SUI" enriched={eSUI} taxType="sui" total={totalSUI} credit={0} selected={selectedSUI} setSelected={setSelectedSUI} />

      {pending941.length === 0 && pending940.length === 0 && pendingSUI.length === 0 && (
        <div className="card"><div className="empty-state" style={{ padding: '32px 20px' }}><div className="empty-state-icon">✓</div><h3>All caught up</h3><p>No pending liabilities.</p></div></div>
      )}

      {/* Sent Checks — always visible collapsible section */}
      {(() => {
        const sent941 = paystubs.filter(s => s.status === 'submitted');
        const sent940 = paystubs.filter(s => s.status_940 === 'submitted' && s.futa_tax > 0);
        const sentSUI = paystubs.filter(s => s.suta_tax > 0 && (s.status_sui || 'pending') === 'submitted');
        const totalSent = sent941.length + sent940.length + sentSUI.length;

        function enrichSent(stubs, taxType, schedule) {
          return stubs.map(s => {
            const due    = calcLiabilityDue(s, taxType, schedule);
            const sendBy = calcSendByDate(due);
            return { ...s, _due: due, _sendBy: sendBy, _status: 'completed' };
          });
        }
        const se941 = enrichSent(sent941, '941', sched941);
        const se940 = enrichSent(sent940, '940', sched940);
        const seSUI = enrichSent(sentSUI, 'sui', schedSUI);

        function SentTypeGroup({ title, enriched, taxType }) {
          const [open, setOpen] = useState(false);
          const gtotal = enriched.reduce((n, s) => n + (taxType === '941' ? (s.total_deposit || 0) : taxType === '940' ? (s.futa_tax || 0) : (s.suta_tax || 0)), 0);
          return (
            <div style={{ marginBottom: 6 }}>
              <button onClick={() => setOpen(p => !p)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, width: '100%' }}>
                <span style={{ fontSize: 10, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                {title} ({enriched.length})
                {enriched.length > 0 && <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', color: 'var(--success)', fontWeight: 700, fontSize: 12 }}>{fmt(gtotal)}</span>}
              </button>
              {open && (
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 4 }}>
                  {enriched.length === 0 ? (
                    <div style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: 12 }}>No sent checks.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <colgroup><col /><col style={{ width: 160 }} /><col style={{ width: 84 }} /><col style={{ width: 84 }} /><col style={{ width: 96 }} /><col style={{ width: 80 }} /></colgroup>
                      <tbody>
                        {enriched.map((stub, idx) => {
                          const amount = taxType === '941' ? (stub.total_deposit || 0) : taxType === '940' ? (stub.futa_tax || 0) : (stub.suta_tax || 0);
                          return (
                            <tr key={stub.id}
                              style={{ background: idx % 2 === 0 ? 'var(--bg-primary, #fff)' : '#f8fafc', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                              onClick={e => { if (e.target.tagName !== 'BUTTON') setLiabilityModal({ stub, taxType, due: stub._due, sendBy: stub._sendBy }); }}>
                              <td style={{ padding: '8px 8px' }}>
                                <span style={{ fontWeight: 600 }}>{stub.employee_name || '—'}</span>
                                {stub.check_number && <span style={{ marginLeft: 5, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--accent)' }}>#{stub.check_number}</span>}
                              </td>
                              <td style={{ padding: '8px 8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>{fmtDate(stub.pay_period_start)} – {fmtDate(stub.pay_period_end)}</td>
                              <td style={{ padding: '8px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(stub._sendBy)}</td>
                              <td style={{ padding: '8px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(stub._due)}</td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--success)', fontSize: 12 }}>{fmt(amount)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '1px 6px', height: 22 }}
                                  onClick={async e => {
                                    e.stopPropagation();
                                    if (!window.confirm('Mark this payment as pending again?')) return;
                                    try { await api.updatePaystubStatus(stub.id, 'pending', taxType); await reload(); } catch (ex) { alert(ex.message); }
                                  }}>
                                  Undo
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        }

        return (
          <div style={{ marginTop: 16 }}>
            <button onClick={() => setSentOpen(p => !p)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
              <span style={{ fontSize: 11, display: 'inline-block', transform: sentOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
              Sent Checks {totalSent > 0 ? `(${totalSent})` : ''}
            </button>
            {sentOpen && (
              <div style={{ marginTop: 6 }}>
                {totalSent === 0 ? (
                  <div style={{ padding: '12px 4px', color: 'var(--text-muted)', fontSize: 13 }}>No sent checks yet.</div>
                ) : (
                  <>
                    <SentTypeGroup title="Federal 941" enriched={se941} taxType="941" />
                    <SentTypeGroup title="Federal 940 (FUTA)" enriched={se940} taxType="940" />
                    <SentTypeGroup title="State SUI" enriched={seSUI} taxType="sui" />
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {liabilityModal && (
        <LiabilityDetailModal stub={liabilityModal.stub} taxType={liabilityModal.taxType}
          due={liabilityModal.due} sendBy={liabilityModal.sendBy} todayStr={todayStr}
          clientId={clientId}
          onClose={() => setLiabilityModal(null)}
          onStubChange={(id, patch) => {
            setPaystubs(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
          }}
          onDelete={async () => {
            try { await api.deletePaystub(liabilityModal.stub.id); setLiabilityModal(null); await reload(); } catch (e) { alert(e.message); }
          }}
          onPay={async (stub) => {
            try {
              await api.downloadSuiReport(clientId, [stub.id]);
              setLiabilityModal(null);
            } catch (e) { alert(e.message); }
          }} />
      )}

      {/* Liability status dropdown — fixed position so it's never clipped by overflow:hidden */}
      {statusDropdown && (
        <div onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: statusDropdown.top, right: statusDropdown.right, zIndex: 9999, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', minWidth: 150, padding: '4px 0' }}>
          {['upcoming', 'due-soon', 'late', 'completed'].map(s => {
            const isCur = statusDropdown.stub._status === s;
            return (
              <button key={s} onClick={() => handleStatusChange(statusDropdown.stub, s)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: isCur ? 'var(--accent-light)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <LiabStatusBadge status={s} />
                {isCur && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>✓</span>}
              </button>
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
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/reports?tab=preparer')}>Preparer Info</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {forms.map(f => <div key={f.id} className="form-file-row"><div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{f.desc}</div></div><span className={`badge ${statusCls[f.status]}`}>{f.status}</span><div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Due {f.due}</div><button className="btn btn-secondary btn-sm" onClick={f.action}>Generate / View</button></div>)}
      </div>
    </div>
  );
}


// ── Payroll Tab ───────────────────────────────────────────────────────────────
function PayrollTab({ clientId, client, employees, onRefresh, refreshTick = 0 }) {
  const [searchParams] = useSearchParams();
  const [sub, setSub] = useState(() => searchParams.get('tab') === 'liabilities' ? 'liabilities' : 'pay');
  return (
    <div>
      <div className="pay-subtabs">
        {[['pay','Pay Employees'],['liabilities','Pay Liabilities'],['forms','File Forms']].map(([k, label]) => <button key={k} className={`pay-subtab${sub === k ? ' active' : ''}`} onClick={() => setSub(k)}>{label}</button>)}
      </div>
      {sub === 'pay'         && <PayEmployeesTab clientId={clientId} client={client} employees={employees} onRefresh={onRefresh} refreshTick={refreshTick} />}
      {sub === 'liabilities' && <PayLiabilitiesTab clientId={clientId} client={client} refreshTick={refreshTick} />}
      {sub === 'forms'       && <FileFormsTab clientId={clientId} />}
    </div>
  );
}

// ── Main Workspace ────────────────────────────────────────────────────────────
const WS_TAB_KEY = 'ws_activeTab';

// ── Users Panel (admin only) ──────────────────────────────────────────────────
function UsersPanel() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    try { setUsers(await api.getUsers()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreateError('');
    if (!newUsername.trim()) { setCreateError('Username is required'); return; }
    if (newPassword.length < 6) { setCreateError('Password must be at least 6 characters'); return; }
    setCreating(true);
    try {
      await api.createUser(newUsername.trim(), newPassword);
      setNewUsername('');
      setNewPassword('');
      await loadUsers();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(u) {
    if (!window.confirm(`Delete user "${u.username}"? All their data will be permanently removed.`)) return;
    try {
      await api.deleteUser(u.id);
      await loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" /></div>;
  if (error) return <div style={{ padding: 24, color: 'var(--danger)' }}>{error}</div>;

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>User Management</h2>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>Users</div>
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Username</th>
              <th>Created</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.username}{u.id === 1 && <span style={{ marginLeft: 6, fontSize: 11, background: 'var(--accent-light)', color: 'var(--accent)', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>admin</span>}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                <td>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={u.id === 1 || u.id === currentUser?.id}
                    onClick={() => handleDelete(u)}
                    title={u.id === 1 ? 'Cannot delete admin' : u.id === currentUser?.id ? 'Cannot delete yourself' : `Delete ${u.username}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>Create User</div>
        <form onSubmit={handleCreate} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {createError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{createError}</div>}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Username</label>
              <input
                className="form-control"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                placeholder="e.g. jsmith"
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Password</label>
              <input
                className="form-control"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min. 6 characters"
                autoComplete="new-password"
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CompanyWorkspace() {
  const { user } = useAuth();
  const { id } = useParams(), location = useLocation(), navigate = useNavigate();
  const [client, setClient]       = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [activeTab, setActiveTab] = useState(
    location.state?.tab || sessionStorage.getItem(WS_TAB_KEY) || 'employees'
  );

  useEffect(() => { sessionStorage.setItem(WS_TAB_KEY, activeTab); }, [activeTab]);
  useEffect(() => { loadAll(); }, [id]);

  async function loadAll() {
    try { const [c, emps] = await Promise.all([api.getClient(id), api.getEmployees(id)]); setClient(c); setEmployees(emps); }
    catch (e) { alert(e.message); navigate('/'); }
    finally { setLoading(false); }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
      setRefreshTick(t => t + 1);
    } finally {
      setRefreshing(false);
    }
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
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh data"
            style={{ background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer', padding: '4px 6px', borderRadius: 6, color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', opacity: refreshing ? 0.5 : 1 }}
          >
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }}>↻</span>
          </button>
        </div>
        <div className="ws-tabs">
          {[['employees','Employees'],['company','Company'],['payroll','Payroll'],...(user?.username === 'admin' ? [['users','Users']] : [])].map(([k, label]) => (
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
        {activeTab === 'payroll'   && <PayrollTab clientId={id} client={client} employees={employees} onRefresh={loadAll} refreshTick={refreshTick} />}
        {activeTab === 'users'     && user?.username === 'admin' && <UsersPanel />}
      </div>
    </div>
  );
}
