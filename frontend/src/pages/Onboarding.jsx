import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Bi-weekly', semimonthly: 'Semi-monthly', monthly: 'Monthly' };

const STEPS = [
  { id: 1, label: 'Your Business' },
  { id: 2, label: 'Pay Groups' },
  { id: 3, label: 'Invite Team' },
  { id: 4, label: "You're set!" },
];

// ── Date helpers (mirrored from CompanyWorkspace) ────────────────────────────
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

const FEDERAL_HOLIDAYS = new Set([
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
  if (freq === 'weekly')          s = addDays(e, -6);
  else if (freq === 'biweekly')   s = addDays(e, -13);
  else if (freq === 'monthly')    s = new Date(e.getFullYear(), e.getMonth(), 1);
  else if (freq === 'semimonthly') s = e.getDate() <= 15 ? new Date(e.getFullYear(), e.getMonth(), 1) : new Date(e.getFullYear(), e.getMonth(), 16);
  else s = addDays(e, -13);
  return s.toISOString().slice(0, 10);
}

// ── Styles ───────────────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 0,
  border: '1.5px solid var(--border)', fontSize: 14,
  color: 'var(--text-primary)', background: 'var(--bg)',
  outline: 'none', boxSizing: 'border-box',
};
const labelStyle = {
  display: 'block', fontSize: 13, fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 6,
};

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// ── Pay Group Form (inline, reusable) ────────────────────────────────────────
function PayGroupForm({ value, onChange, onSave, onCancel, saving, isFirst }) {
  const periodStart = calcStartFromEnd(value.firstPayPeriodEnd, value.frequency);
  const isWeekend   = value.payDate && !isBizDay(new Date(value.payDate + 'T00:00:00'));
  const suggestedPD = isWeekend ? nextBizDay(new Date(value.payDate + 'T00:00:00')).toISOString().slice(0, 10) : null;

  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1.5px solid var(--border)', borderRadius: 10, padding: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {isFirst ? 'Pay Group Details' : 'New Pay Group'}
      </div>

      <Field label="Group Name *">
        <input
          style={inputStyle}
          value={value.name}
          onChange={e => onChange('name', e.target.value)}
          placeholder='e.g. "Bi-weekly Hourly" or "Salaried Staff"'
        />
      </Field>

      <Field label="Pay Frequency *">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {Object.entries(FREQ_LABEL).map(([k, lbl]) => (
            <div
              key={k}
              onClick={() => {
                onChange('frequency', k);
                if (value.firstPayPeriodEnd)
                  onChange('payDate', calcDefaultPayDate(value.firstPayPeriodEnd));
              }}
              style={{
                border: `2px solid ${value.frequency === k ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                background: value.frequency === k ? 'var(--accent-light, #eef7f0)' : 'var(--bg)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: value.frequency === k ? 'var(--accent)' : 'var(--text-primary)' }}>{lbl}</div>
            </div>
          ))}
        </div>
      </Field>

      <Field
        label="First Pay Period End Date *"
        hint={periodStart ? `Period runs: ${fmtDate(periodStart)} → ${fmtDate(value.firstPayPeriodEnd)}` : undefined}
      >
        <input
          style={inputStyle}
          type="date"
          value={value.firstPayPeriodEnd}
          onChange={e => {
            onChange('firstPayPeriodEnd', e.target.value);
            onChange('payDate', calcDefaultPayDate(e.target.value));
          }}
        />
      </Field>

      <Field
        label="Pay Date (Check Date) *"
        hint={!isWeekend && value.payDate ? `${fmtDate(value.payDate)} (auto: 2 business days after period end)` : undefined}
      >
        <input
          style={inputStyle}
          type="date"
          value={value.payDate}
          onChange={e => onChange('payDate', e.target.value)}
        />
        {isWeekend && suggestedPD && (
          <div style={{ fontSize: 11, color: '#d97706', marginTop: 4 }}>
            ⚠ Weekend or holiday —{' '}
            <button
              type="button"
              onClick={() => onChange('payDate', suggestedPD)}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, fontSize: 11, cursor: 'pointer', padding: 0 }}
            >
              Use {fmtDate(suggestedPD)} instead
            </button>
          </div>
        )}
      </Field>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{ flex: 1, padding: '10px 0', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          {saving ? 'Saving…' : isFirst ? 'Save Pay Group' : 'Add Pay Group'}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{ padding: '10px 16px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1.5px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Onboarding component ─────────────────────────────────────────────────
export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const clientId = user?.clientId;

  const [step, setStep]   = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied]     = useState(false);

  const appUrl = window.location.origin;

  // Step 1: Business Details
  const [biz, setBiz] = useState({
    businessName: '', businessAddress: '', businessCity: '', state: 'TX', businessZip: '', contactPhone: '',
  });

  // Step 2: Pay Groups
  const [payGroups, setPayGroups] = useState([]);        // saved groups
  const [showAddForm, setShowAddForm] = useState(true);  // show the add-group form
  const [groupForm, setGroupForm] = useState({ name: '', frequency: 'biweekly', firstPayPeriodEnd: '', payDate: '' });
  const [groupSaving, setGroupSaving] = useState(false);

  function updateBiz(k, v) { setBiz(p => ({ ...p, [k]: v })); }
  function updateGroupForm(k, v) { setGroupForm(p => ({ ...p, [k]: v })); }

  // Fetch client data + already-saved pay groups on mount, and resume at the
  // right step — a mid-wizard refresh should never force re-entering data
  // (or creating a duplicate pay group) that's already saved server-side.
  useEffect(() => {
    if (!clientId) return;
    Promise.all([
      api.getClient(clientId),
      api.getPayGroups(clientId).catch(() => []),
    ]).then(([c, groups]) => {
      setBiz(b => ({
        ...b,
        businessName:    c.businessName    || b.businessName,
        businessAddress: c.businessAddress || b.businessAddress,
        businessCity:    c.businessCity    || b.businessCity,
        state:           c.state           || b.state,
        businessZip:     c.businessZip     || b.businessZip,
        contactPhone:    c.contactPhone    || b.contactPhone,
      }));
      if (c.joinCode) setJoinCode(c.joinCode);
      if (groups.length > 0) {
        // Steps 1 & 2 already done — show saved groups and resume at Invite Team
        setPayGroups(groups);
        setShowAddForm(false);
        setStep(3);
      } else if (c.businessAddress || c.businessCity || c.businessZip || c.contactPhone) {
        // Business details already saved — resume at Pay Groups
        setStep(2);
      }
    }).catch(() => {});
  }, [clientId]);

  // ── Step 1 ───────────────────────────────────────────────────────────────
  async function handleStep1() {
    if (!biz.businessName.trim()) return setError('Business name is required');
    setError(''); setSaving(true);
    try {
      await api.updateClient(clientId, {
        businessName:    biz.businessName.trim(),
        businessAddress: biz.businessAddress.trim() || undefined,
        businessCity:    biz.businessCity.trim() || undefined,
        state:           biz.state,
        businessZip:     biz.businessZip.trim() || undefined,
        contactPhone:    biz.contactPhone.trim() || undefined,
      });
      setStep(2);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  // ── Step 2: save a pay group ──────────────────────────────────────────────
  async function handleSaveGroup() {
    if (!groupForm.name.trim())          return setError('Group name is required');
    if (!groupForm.firstPayPeriodEnd)    return setError('First period end date is required');
    if (!groupForm.payDate)              return setError('Pay date is required');
    setError(''); setGroupSaving(true);
    try {
      const created = await api.createPayGroup({
        clientId,
        name:                groupForm.name.trim(),
        frequency:           groupForm.frequency,
        firstPayPeriodEnd:   groupForm.firstPayPeriodEnd,
        firstPayPeriodStart: calcStartFromEnd(groupForm.firstPayPeriodEnd, groupForm.frequency) || null,
        payDate:             groupForm.payDate,
      });
      setPayGroups(prev => [...prev, created]);
      setGroupForm({ name: '', frequency: 'biweekly', firstPayPeriodEnd: '', payDate: '' });
      setShowAddForm(false);
    } catch (e) { setError(e.message); }
    finally { setGroupSaving(false); }
  }

  async function handleRemoveGroup(id) {
    try { await api.deletePayGroup(id); setPayGroups(prev => prev.filter(g => g.id !== id)); }
    catch (e) { setError(e.message); }
  }

  function handleProceedToStep3() {
    if (payGroups.length === 0) return setError('Add at least one pay group to continue');
    setError('');
    setStep(3);
  }

  // ── Step 3: complete onboarding ───────────────────────────────────────────
  async function handleStep3() {
    setError(''); setSaving(true);
    try {
      await api.completeOnboarding(clientId);
      setStep(4);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function copyCode() {
    navigator.clipboard.writeText(joinCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: 'var(--nav-h)', background: 'var(--accent)', display: 'flex', alignItems: 'center', padding: '0 24px' }}>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 17, letterSpacing: '-0.3px' }}>PayrollTax Pro</span>
      </div>

      {/* Progress bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 24px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex' }}>
          {STEPS.map((s, i) => {
            const done = step > s.id, active = step === s.id;
            return (
              <div key={s.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 8px', position: 'relative' }}>
                {i < STEPS.length - 1 && (
                  <div style={{ position: 'absolute', top: 26, left: '60%', right: '-40%', height: 2, background: done ? 'var(--accent)' : 'var(--border)', zIndex: 0 }} />
                )}
                <div style={{ width: 28, height: 28, borderRadius: '50%', zIndex: 1, background: done || active ? 'var(--accent)' : 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: done || active ? '#fff' : 'var(--text-muted)' }}>
                  {done ? '✓' : s.id}
                </div>
                <div style={{ fontSize: 11, marginTop: 6, color: active ? 'var(--accent)' : 'var(--text-muted)', fontWeight: active ? 700 : 400, textAlign: 'center' }}>
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '40px 24px' }}>
        <div style={{ width: '100%', maxWidth: 580 }}>

          {/* ── Step 1: Business Details ── */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>Tell us about your business</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>We'll use this for payroll documents and tax filings.</p>
              <div className="card" style={{ padding: 24 }}>
                <Field label="Business Name *">
                  <input style={inputStyle} value={biz.businessName} onChange={e => updateBiz('businessName', e.target.value)} placeholder="Acme Corp" />
                </Field>
                <Field label="Street Address">
                  <input style={inputStyle} value={biz.businessAddress} onChange={e => updateBiz('businessAddress', e.target.value)} placeholder="123 Main St" />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: 12 }}>
                  <Field label="City">
                    <input style={inputStyle} value={biz.businessCity} onChange={e => updateBiz('businessCity', e.target.value)} placeholder="Austin" />
                  </Field>
                  <Field label="State">
                    <select style={inputStyle} value={biz.state} onChange={e => updateBiz('state', e.target.value)}>
                      {US_STATES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="ZIP">
                    <input style={inputStyle} value={biz.businessZip} onChange={e => updateBiz('businessZip', e.target.value)} placeholder="78701" maxLength={10} />
                  </Field>
                </div>
                <Field label="Business Phone">
                  <input style={inputStyle} value={biz.contactPhone} onChange={e => updateBiz('contactPhone', e.target.value)} placeholder="(512) 555-0100" type="tel" />
                </Field>
                {error && <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
                <button onClick={handleStep1} disabled={saving} style={{ width: '100%', padding: '12px 0', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 8 }}>
                  {saving ? 'Saving…' : 'Continue →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Pay Groups ── */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>Set up pay groups</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8 }}>
                Pay groups define a pay schedule — frequency, period dates, and check date. You can create multiple groups for different employee types (e.g. hourly weekly, salaried bi-weekly).
              </p>

              {/* Saved groups list */}
              {payGroups.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {payGroups.map(g => (
                    <div key={g.id} className="card" style={{ padding: '14px 18px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{g.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {FREQ_LABEL[g.frequency]} · Period ends {fmtDate(g.firstPayPeriodEnd)} · Pay date {fmtDate(g.payDate)}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveGroup(g.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}
                        title="Remove"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add group form */}
              {showAddForm ? (
                <div style={{ marginBottom: 16 }}>
                  {error && <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
                  <PayGroupForm
                    value={groupForm}
                    onChange={updateGroupForm}
                    onSave={handleSaveGroup}
                    onCancel={payGroups.length > 0 ? () => { setShowAddForm(false); setError(''); } : null}
                    saving={groupSaving}
                    isFirst={payGroups.length === 0}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  style={{ width: '100%', padding: '11px 0', background: 'var(--bg)', border: '2px dashed var(--border)', borderRadius: 8, color: 'var(--accent)', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 16 }}
                >
                  + Add Another Pay Group
                </button>
              )}

              {error && !showAddForm && <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => { setStep(1); setError(''); }} style={{ flex: 1, padding: '12px 0', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1.5px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={handleProceedToStep3}
                  disabled={payGroups.length === 0}
                  style={{ flex: 2, padding: '12px 0', background: payGroups.length === 0 ? 'var(--bg-tertiary)' : 'var(--accent)', color: payGroups.length === 0 ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: payGroups.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                  Continue → {payGroups.length > 0 && `(${payGroups.length} group${payGroups.length > 1 ? 's' : ''} added)`}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Invite Your Team ── */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>Invite your employees</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>
                Share your company join code so employees can create their own accounts and view paystubs.
              </p>
              <div className="card" style={{ padding: 24 }}>
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Your Company Join Code
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: 'var(--bg-secondary)', border: '2px dashed var(--border)', borderRadius: 12, padding: '16px 24px' }}>
                    <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: '0.3em', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>
                      {joinCode || '———'}
                    </span>
                    <button onClick={copyCode} style={{ padding: '8px 14px', borderRadius: 8, border: '1.5px solid var(--border)', background: copied ? 'var(--accent)' : 'var(--bg)', color: copied ? '#fff' : 'var(--text-primary)', fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}>
                      {copied ? '✓ Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Option A: employee self-registers */}
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 20, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{ background: 'var(--accent)', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>OPTION A</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Employees self-register with the join code</div>
                  </div>
                  {[
                    { n: '1', text: `Share this code with your employee: ${joinCode || '…'}` },
                    { n: '2', text: `They go to ${appUrl} → Employee tab → "Create account with join code"` },
                    { n: '3', text: 'They enter the code, their name, email, and create a password' },
                    { n: '4', text: 'They appear in your Employees tab — you then set their pay rate and pay group' },
                  ].map(item => (
                    <div key={item.n} style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{item.n}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.text}</div>
                    </div>
                  ))}
                </div>

                {/* Option B: company adds manually */}
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 800, letterSpacing: '0.4px', border: '1px solid var(--border)' }}>OPTION B</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>You add employees manually from the dashboard</div>
                  </div>
                  {[
                    { n: '1', text: 'Go to your dashboard → Employees tab → "+ Add Employee"' },
                    { n: '2', text: 'Fill in their name, pay type, rate, pay group, and W-4 settings' },
                    { n: '3', text: 'Share the join code so they can create a login and view their paystubs' },
                  ].map(item => (
                    <div key={item.n} style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 22, height: 22, borderRadius: '50%', background: 'var(--bg-tertiary)', border: '1.5px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{item.n}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.text}</div>
                    </div>
                  ))}
                </div>

                {error && <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => { setStep(2); setError(''); }} style={{ flex: 1, padding: '12px 0', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1.5px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    ← Back
                  </button>
                  <button onClick={handleStep3} disabled={saving} style={{ flex: 2, padding: '12px 0', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                    {saving ? 'Finishing…' : 'Done, go to dashboard →'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Done ── */}
          {step === 4 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>You're all set!</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 15, maxWidth: 420, margin: '0 auto 32px' }}>
                Your payroll workspace is ready. Run payroll, manage employees, and track filings from your dashboard.
              </p>
              <div className="card" style={{ padding: 28, maxWidth: 420, margin: '0 auto 24px', textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>What's next</div>
                {[
                  { icon: '📤', title: 'Share your join code', desc: `Code: ${joinCode} — send it to your team so they can create their accounts.` },
                  { icon: '👥', title: 'Set employee pay rates', desc: 'Open the Employees tab to add wages, assign pay groups, and set deductions.' },
                  { icon: '💸', title: 'Run your first payroll', desc: 'Go to the Payroll tab, enter hours, and generate pay stubs.' },
                ].map(item => (
                  <div key={item.title} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    <div style={{ fontSize: 20, minWidth: 28 }}>{item.icon}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => navigate(`/company/${clientId}`, { replace: true })} style={{ padding: '14px 40px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>
                Go to My Dashboard →
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
