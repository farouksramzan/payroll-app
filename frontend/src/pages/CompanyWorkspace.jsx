'use strict';
import React, { useState, useEffect, useRef } from 'react';
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
  pending:                { label: 'Pending',            cls: 'badge-neutral' },
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
  const [payGroups, setPayGroups] = useState([]);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', frequency: 'biweekly', firstPayPeriodEnd: '', payDate: '' });
  const [savingGroup, setSavingGroup] = useState(false);

  useEffect(() => {
    api.getPayGroups(clientId).then(setPayGroups).catch(() => {});
  }, [clientId]);

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
  const [editGroup, setEditGroup]         = useState(null); // group object
  const [payGroups, setPayGroups]         = useState([]);

  useEffect(() => {
    api.getPayGroups(clientId).then(setPayGroups).catch(() => {});
  }, [clientId]);

  function handleGroupSaved() { setEditGroup(null); onRefresh(); api.getPayGroups(clientId).then(setPayGroups); }

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
                <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
              </div>
            );
          })}
        </div>
      )}
      {drawerEmpId && (
        <EmployeeDrawer clientId={clientId} empId={drawerEmpId} onClose={() => setDrawerEmpId(null)} onSaved={() => { setDrawerEmpId(null); onRefresh(); }} />
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

// ── Pay Employees Tab ─────────────────────────────────────────────────────────
function PayEmployeesTab({ clientId, client, employees, onRefresh }) {
  const [payGroups, setPayGroups]     = useState([]);
  const [currentGroupId, setCurrentGroupId] = useState(null);
  const [groupsLoading, setGroupsLoading]   = useState(true);
  const [editGroup, setEditGroup]     = useState(null);
  const [paystubs, setPaystubs]                   = useState([]);
  // pendingRows[periodEnd][empId] = { regHours, otHours, selected }
  const [pendingRows, setPendingRows]             = useState({});
  const [selectedLateStubs, setSelectedLateStubs] = useState(new Set());
  const [running, setRunning]                     = useState(false);
  const [runErr, setRunErr]                       = useState('');
  const [runSuccess, setRunSuccess]               = useState('');
  const [expandedRows, setExpandedRows]           = useState(new Set());
  const [showPrinted, setShowPrinted]             = useState(false);

  useEffect(() => {
    api.getPayGroups(clientId)
      .then(groups => {
        setPayGroups(groups);
        if (groups.length > 0) setCurrentGroupId(groups[0].id);
      })
      .catch(() => {})
      .finally(() => setGroupsLoading(false));
  }, [clientId]);

  useEffect(() => {
    // Sweep draft checks with a past pay date → 'late' in the DB, then reload.
    api.markLateChecks().catch(() => {}).finally(reloadStubs);
  }, [clientId]);

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

    let s = new Date(anchor + 'T00:00:00'), e = new Date(g.firstPayPeriodEnd + 'T00:00:00');
    const pending = [];
    let nonLateCount = 0;
    for (let i = 0; i < 60; i++) {
      const endStr = e.toISOString().slice(0, 10);
      if (!paidEnds.has(endStr)) {
        const payDate = calcDefaultPayDate(endStr);
        const isLate = payDate < todayStr;
        pending.push({ start: s.toISOString().slice(0, 10), end: endStr, payDate, isLate });
        if (!isLate) {
          nonLateCount++;
          if (nonLateCount >= 2) break;
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
      s.employee_id === employeeId &&
      s.check_status !== 'voided' &&
      (s.tax_year === curYear || (s.pay_period_end || '').startsWith(String(curYear))) &&
      (!upToEnd || s.pay_period_end <= upToEnd)
    );
    return {
      gross:    stubs.reduce((n, s) => n + (s.gross_wages        || 0), 0),
      fit:      stubs.reduce((n, s) => n + (s.fit_withholding    || 0), 0),
      eeSS:     stubs.reduce((n, s) => n + (s.employee_ss        || 0), 0),
      eeMed:    stubs.reduce((n, s) => n + (s.employee_medicare  || 0), 0),
      stateTax: stubs.reduce((n, s) => n + (s.state_income_tax   || 0), 0),
      futa:     stubs.reduce((n, s) => n + (s.futa_tax           || 0), 0),
      suta:     stubs.reduce((n, s) => n + (s.suta_tax           || 0), 0),
      netPay:   stubs.reduce((n, s) => n + (s.net_pay            || 0), 0),
    };
  }

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

  function toggleExpand(key) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // Select-all helpers
  function handleSelectAllLate() {
    const newPR = { ...pendingRows };
    pendingPeriods.forEach(period => {
      const pr = { ...(newPR[period.end] || {}) };
      empsInGroup.forEach(emp => { pr[emp.id] = { ...getRow(period.end, emp.id), selected: period.isLate }; });
      newPR[period.end] = pr;
    });
    setPendingRows(newPR);
    const lateIds = history.flatMap(p => p.stubs.filter(s => s.check_status === 'late').map(s => s.id));
    setSelectedLateStubs(new Set(lateIds));
  }
  function handleSelectAllPending() {
    const newPR = { ...pendingRows };
    pendingPeriods.forEach(period => {
      const pr = { ...(newPR[period.end] || {}) };
      empsInGroup.forEach(emp => { pr[emp.id] = { ...getRow(period.end, emp.id), selected: !period.isLate }; });
      newPR[period.end] = pr;
    });
    setPendingRows(newPR);
    setSelectedLateStubs(new Set());
  }
  function handleSelectAllDue() {
    const newPR = { ...pendingRows };
    pendingPeriods.forEach(period => {
      const pr = { ...(newPR[period.end] || {}) };
      empsInGroup.forEach(emp => { pr[emp.id] = { ...getRow(period.end, emp.id), selected: true }; });
      newPR[period.end] = pr;
    });
    setPendingRows(newPR);
    const lateIds = history.flatMap(p => p.stubs.filter(s => s.check_status === 'late').map(s => s.id));
    setSelectedLateStubs(new Set(lateIds));
  }

  const hasLateRows    = pendingPeriods.some(p => p.isLate) || history.some(p => p.stubs.some(s => s.check_status === 'late'));
  const hasPendingRows = pendingPeriods.some(p => !p.isLate);

  // Reusable table renderer for a row list
  function renderTable(rows, startIdx = 0) {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12 }}>
        <colgroup>
          <col style={{ width: 36 }} />
          <col />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 82 }} />
          <col style={{ width: 82 }} />
          <col style={{ width: 92 }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <th style={{ padding: '7px 0 7px 12px' }} />
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'left' }}>Employee</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'left' }}>Period Start</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'left' }}>Period End</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'left' }}>Pay Date</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>Reg Hrs</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>OT Hrs</th>
            <th style={{ padding: '7px 8px', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((rowData, idx) => {
            const isExpanded = expandedRows.has(rowData.key);
            const stripeBg   = (startIdx + idx) % 2 === 0 ? 'var(--bg-primary, #fff)' : '#f8fafc';

            if (rowData.type === 'pending') {
              const { period, emp } = rowData;
              const row      = getRow(period.end, emp.id);
              const isSalary = emp.payType === 'salary';
              const salAmt   = r2((emp.annualSalary || 0) / ppy);
              const rate     = emp.hourlyRate || 0;
              const regH     = parseFloat(row.regHours || 0);
              const otH      = parseFloat(row.otHours  || 0);
              const grossPreview = isSalary ? salAmt : r2(Math.min(regH, 40) * rate + otH * rate * 1.5);
              const status   = period.isLate ? 'late' : 'pending';
              const selBg    = period.isLate ? '#fff5f5' : 'var(--accent-light)';
              const rowBg    = row.selected ? selBg : stripeBg;
              const ytd      = isExpanded ? calcEmpYTD(emp.id, null) : null;
              return (
                <React.Fragment key={rowData.key}>
                  <tr
                    style={{ background: rowBg, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={e => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'INPUT') toggleExpand(rowData.key); }}
                  >
                    <td style={{ padding: '0 0 0 12px' }}>
                      <input type="checkbox" checked={row.selected}
                        style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }}
                        onChange={ev => setRow(period.end, emp.id, 'selected', ev.target.checked)} />
                    </td>
                    <td style={{ padding: '7px 8px', fontWeight: 600 }}>{emp.firstName} {emp.lastName}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{fmtDate(period.start)}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{fmtDate(period.end)}</td>
                    <td style={{ padding: '7px 8px', color: period.isLate ? '#dc2626' : 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{fmtDate(period.payDate)}</td>
                    {isSalary ? (
                      <td colSpan={2} style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 12 }}>
                        {fmt(salAmt)}<span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 3 }}>/period</span>
                      </td>
                    ) : (
                      <>
                        <td style={{ padding: '4px 6px' }}>
                          <input className="form-input mono" type="number" min="0" step="0.5" value={row.regHours} placeholder="0"
                            onChange={ev => setRow(period.end, emp.id, 'regHours', ev.target.value)}
                            style={{ width: '100%', height: 26, fontSize: 12, textAlign: 'right', padding: '0 6px' }} />
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input className="form-input mono" type="number" min="0" step="0.5" value={row.otHours} placeholder="0"
                            onChange={ev => setRow(period.end, emp.id, 'otHours', ev.target.value)}
                            style={{ width: '100%', height: 26, fontSize: 12, textAlign: 'right', padding: '0 6px' }} />
                        </td>
                      </>
                    )}
                    <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                      <StatusBadge status={status} />
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ background: period.isLate ? '#fff5f5' : 'var(--accent-light)', borderBottom: '1px solid var(--border)' }}>
                      <td colSpan={8} style={{ padding: '10px 16px 14px 52px' }}>
                        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 12, marginBottom: 12 }}>
                          <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Pay Type</div><strong>{isSalary ? 'Salary' : 'Hourly'}</strong></div>
                          {isSalary
                            ? <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Annual Salary</div><strong>{fmt(emp.annualSalary || 0)}</strong></div>
                            : <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Rate</div><strong>${rate}/hr</strong></div>}
                          <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Period</div><strong>{fmtDate(period.start)} – {fmtDate(period.end)}</strong></div>
                          <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Pay Date</div><strong style={{ color: period.isLate ? '#dc2626' : undefined }}>{fmtDate(period.payDate)}{period.isLate ? ' — LATE' : ''}</strong></div>
                          <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Gross Preview</div><strong style={{ color: 'var(--accent)' }}>{fmt(grossPreview)}</strong></div>
                        </div>
                        {ytd && (
                          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>YTD {curYear}</div>
                            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
                              <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Gross</div><strong>{fmt(ytd.gross)}</strong></div>
                              <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>FIT</div><strong>{fmt(ytd.fit)}</strong></div>
                              <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>EE SS</div><strong>{fmt(ytd.eeSS)}</strong></div>
                              <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>EE Medicare</div><strong>{fmt(ytd.eeMed)}</strong></div>
                              <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>State Tax</div><strong>{fmt(ytd.stateTax)}</strong></div>
                              <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>FUTA</div><strong>{fmt(ytd.futa)}</strong></div>
                              <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>SUI</div><strong>{fmt(ytd.suta)}</strong></div>
                              <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Net Pay</div><strong style={{ color: 'var(--success, #16a34a)' }}>{fmt(ytd.netPay)}</strong></div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            }

            // History row
            const { stub } = rowData;
            const isLateCheck = stub.check_status === 'late';
            const isVoided    = stub.check_status === 'voided';
            const empObj      = employees.find(e => e.id === stub.employee_id);
            const isSalary    = empObj?.payType === 'salary';
            const rowBg       = isLateCheck ? '#fff5f5' : stripeBg;
            const ytd         = isExpanded ? calcEmpYTD(stub.employee_id, stub.pay_period_end) : null;
            return (
              <React.Fragment key={rowData.key}>
                <tr
                  style={{ background: rowBg, opacity: isVoided ? 0.5 : 1, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={e => { if (e.target.type !== 'checkbox') toggleExpand(rowData.key); }}
                >
                  <td style={{ padding: '0 0 0 12px' }}>
                    {isLateCheck && (
                      <input type="checkbox"
                        checked={selectedLateStubs.has(stub.id)}
                        onChange={() => setSelectedLateStubs(prev => {
                          const next = new Set(prev);
                          next.has(stub.id) ? next.delete(stub.id) : next.add(stub.id);
                          return next;
                        })}
                        style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }} />
                    )}
                  </td>
                  <td style={{ padding: '7px 8px' }}>
                    <span style={{ fontWeight: 600, textDecoration: isVoided ? 'line-through' : 'none' }}>{stub.employee_name}</span>
                    {stub.check_number && (
                      <span style={{ marginLeft: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--accent)' }}>#{stub.check_number}</span>
                    )}
                  </td>
                  <td style={{ padding: '7px 8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{fmtDate(stub.pay_period_start)}</td>
                  <td style={{ padding: '7px 8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{fmtDate(stub.pay_period_end)}</td>
                  <td style={{ padding: '7px 8px', color: isLateCheck ? '#dc2626' : 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{fmtDate(stub.settlement_date)}</td>
                  {isSalary ? (
                    <td colSpan={2} style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--accent)', fontSize: 12 }}>
                      {stub.gross_wages ? fmt(stub.gross_wages) : '—'}
                    </td>
                  ) : (
                    <>
                      <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{stub.regular_hours != null ? stub.regular_hours : '—'}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{stub.overtime_hours > 0 ? stub.overtime_hours : '—'}</td>
                    </>
                  )}
                  <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                    <StatusBadge status={stub.check_status || 'draft'} />
                  </td>
                </tr>
                {isExpanded && (
                  <tr style={{ background: isLateCheck ? '#fff5f5' : 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                    <td colSpan={8} style={{ padding: '10px 16px 14px 52px' }}>
                      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 12, marginBottom: 12 }}>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Gross</div><strong>{fmt(stub.gross_wages || 0)}</strong></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>FIT</div><strong>{fmt(stub.fit_withholding || 0)}</strong></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>EE SS</div><strong>{fmt(stub.employee_ss || 0)}</strong></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>EE Medicare</div><strong>{fmt(stub.employee_medicare || 0)}</strong></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>State Tax</div><strong>{fmt(stub.state_income_tax || 0)}</strong></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Net Pay</div><strong style={{ color: 'var(--success, #16a34a)' }}>{fmt(stub.net_pay || 0)}</strong></div>
                        {stub.check_number && <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Check #</div><strong style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>#{stub.check_number}</strong></div>}
                      </div>
                      {ytd && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>YTD {curYear}</div>
                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Gross</div><strong>{fmt(ytd.gross)}</strong></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>FIT</div><strong>{fmt(ytd.fit)}</strong></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>EE SS</div><strong>{fmt(ytd.eeSS)}</strong></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>EE Medicare</div><strong>{fmt(ytd.eeMed)}</strong></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>State Tax</div><strong>{fmt(ytd.stateTax)}</strong></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>FUTA</div><strong>{fmt(ytd.futa)}</strong></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>SUI</div><strong>{fmt(ytd.suta)}</strong></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Net Pay</div><strong style={{ color: 'var(--success, #16a34a)' }}>{fmt(ytd.netPay)}</strong></div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
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
                onClick={() => { setCurrentGroupId(g.id); setRunErr(''); setRunSuccess(''); setSelectedLateStubs(new Set()); }}
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
        {!isGroupDeleted && hasLateRows && (
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#dc2626', border: '1px solid #fecaca' }} onClick={handleSelectAllLate}>Select All Late</button>
        )}
        {!isGroupDeleted && hasPendingRows && (
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={handleSelectAllPending}>Select All Pending</button>
        )}
        {!isGroupDeleted && (hasLateRows || hasPendingRows) && (
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={handleSelectAllDue}>Select All Due</button>
        )}
        <div style={{ flex: 1 }} />
        {!isGroupDeleted && (pendingPeriods.length > 0 || selectedLateStubs.size > 0) && (
          <button className="btn btn-primary" onClick={handleRunPayroll} disabled={running || totalActionCount === 0}>
            {running ? <span className="spinner" /> : `Run Payroll (${totalActionCount})`}
          </button>
        )}
      </div>

      {isGroupDeleted && (
        <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 12 }}>
          <span>⚠</span> This pay group has been deleted. Historical checks are shown below for reference.
        </div>
      )}
      {runErr     && <div className="alert alert-error"   style={{ marginBottom: 10 }}><span>⚠</span>{runErr}<button onClick={() => setRunErr('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button></div>}
      {runSuccess && <div className="alert alert-success" style={{ marginBottom: 10 }}><span>✓</span>{runSuccess}<button onClick={() => setRunSuccess('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button></div>}

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

// ── Payroll Tab ───────────────────────────────────────────────────────────────
function PayrollTab({ clientId, client, employees, onRefresh }) {
  const [sub, setSub] = useState('pay');
  return (
    <div>
      <div className="pay-subtabs">
        {[['pay','Pay Employees'],['liabilities','Pay Liabilities'],['forms','File Forms']].map(([k, label]) => <button key={k} className={`pay-subtab${sub === k ? ' active' : ''}`} onClick={() => setSub(k)}>{label}</button>)}
      </div>
      {sub === 'pay'         && <PayEmployeesTab clientId={clientId} client={client} employees={employees} onRefresh={onRefresh} />}
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
          {[['employees','Employees'],['company','Company'],['payroll','Payroll']].map(([k, label]) => (
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
        {activeTab === 'payroll'   && <PayrollTab clientId={id} client={client} employees={employees} onRefresh={loadAll} />}
      </div>
    </div>
  );
}
