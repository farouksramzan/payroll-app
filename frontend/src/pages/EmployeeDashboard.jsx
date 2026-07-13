import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function fmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px', borderRadius: 0,
  border: '1.5px solid var(--border)',
  fontSize: 13, color: 'var(--text-primary)',
  background: 'var(--bg)', outline: 'none',
};

// ── W-4 Questionnaire ────────────────────────────────────────────────────────

const FILING_OPTIONS = [
  {
    value: 'single',
    label: 'Single or Married filing separately',
    desc: 'You file taxes on your own, or married but file separate returns.',
  },
  {
    value: 'married',
    label: 'Married filing jointly',
    desc: 'You and your spouse combine income on one tax return.',
  },
  {
    value: 'head',
    label: 'Head of household',
    desc: 'You\'re unmarried and pay more than half the cost of a home for a qualifying person.',
  },
];

function W4Wizard({ me, onSaved }) {
  const [step, setStep]       = useState(me.w4Submitted ? 5 : 1);
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [w4, setW4]           = useState({
    filingStatus:  me.filingStatus  || 'single',
    step2Checkbox: me.step2Checkbox || false,
    step3Children: me.step3Children || 0,
    step3Other:    me.step3Other    || 0,
    step4a:        me.step4a        || 0,
    step4b:        me.step4b        || 0,
    step4c:        me.step4c        || 0,
  });

  const dependentCredit =
    Number(w4.step3Children || 0) * 2000 +
    Number(w4.step3Other    || 0) * 500;

  async function handleSave() {
    setSaving(true); setSaveMsg('');
    try {
      const updated = await api.updateEmployeePortalMe(w4);
      onSaved(updated);
      setSaveMsg('W-4 saved successfully.');
      setStep(5); // done screen
    } catch (err) {
      setSaveMsg(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  const TOTAL_STEPS = 4;

  const stepLabel = [
    '', 'Filing Status', 'Multiple Jobs', 'Dependents', 'Other Adjustments',
  ][step] || 'Done';

  return (
    <div className="card" style={{ maxWidth: 600 }}>

      {/* Header */}
      <div style={{ padding: '20px 24px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
            W-4 Withholding Setup
          </h3>
          {step <= TOTAL_STEPS && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
              Step {step} of {TOTAL_STEPS}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {step <= TOTAL_STEPS && (
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginBottom: 24 }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: 'var(--accent)',
              width: `${(step / TOTAL_STEPS) * 100}%`,
              transition: 'width 0.3s',
            }} />
          </div>
        )}
      </div>

      <div style={{ padding: '0 24px 24px' }}>

        {/* ── Step 1: Filing Status ───────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              How do you file your taxes?
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              This determines how much federal income tax is withheld from your paycheck.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {FILING_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '14px 16px', borderRadius: 8, cursor: 'pointer',
                    border: `2px solid ${w4.filingStatus === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                    background: w4.filingStatus === opt.value ? 'rgba(var(--accent-rgb, 30,86,160), 0.04)' : 'var(--bg)',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    name="filingStatus"
                    value={opt.value}
                    checked={w4.filingStatus === opt.value}
                    onChange={() => setW4(f => ({ ...f, filingStatus: opt.value }))}
                    style={{ accentColor: 'var(--accent)', marginTop: 2, flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        {/* ── Step 2: Multiple Jobs ───────────────────────────────────────────── */}
        {step === 2 && (
          <>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Do you have more than one job, or does your spouse work?
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              If you (or your spouse, if married filing jointly) have income from multiple jobs, checking this box ensures enough tax is withheld.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { val: false, label: 'No — I have one job and my spouse doesn\'t work (or I\'m single with one job)' },
                { val: true,  label: 'Yes — I have multiple jobs or my spouse also works' },
              ].map(opt => (
                <label
                  key={String(opt.val)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 16px', borderRadius: 8, cursor: 'pointer',
                    border: `2px solid ${w4.step2Checkbox === opt.val ? 'var(--accent)' : 'var(--border)'}`,
                    background: w4.step2Checkbox === opt.val ? 'rgba(var(--accent-rgb, 30,86,160), 0.04)' : 'var(--bg)',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    name="step2"
                    checked={w4.step2Checkbox === opt.val}
                    onChange={() => setW4(f => ({ ...f, step2Checkbox: opt.val }))}
                    style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{opt.label}</span>
                </label>
              ))}
            </div>
            <div style={{
              marginTop: 16, padding: '10px 14px', borderRadius: 6,
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)',
              fontSize: 12, color: 'var(--text-muted)',
            }}>
              Answering "Yes" increases withholding at the higher tax bracket — this prevents a tax bill at filing time.
            </div>
          </>
        )}

        {/* ── Step 3: Dependents ─────────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Do you have qualifying dependents?
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Claiming dependents reduces your withholding. Leave at 0 if you don't qualify or prefer higher withholding.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                padding: '16px', borderRadius: 8,
                border: '1.5px solid var(--border)', background: 'var(--bg)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Children under age 17
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                  Worth $2,000 each in tax credit
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setW4(f => ({ ...f, step3Children: Math.max(0, f.step3Children - 1) }))}
                    style={{ width: 32, height: 32, borderRadius: 6, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >−</button>
                  <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', minWidth: 32, textAlign: 'center' }}>{w4.step3Children}</span>
                  <button
                    type="button"
                    onClick={() => setW4(f => ({ ...f, step3Children: f.step3Children + 1 }))}
                    style={{ width: 32, height: 32, borderRadius: 6, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >+</button>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
                    = {fmt(w4.step3Children * 2000)} credit
                  </span>
                </div>
              </div>

              <div style={{
                padding: '16px', borderRadius: 8,
                border: '1.5px solid var(--border)', background: 'var(--bg)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Other dependents
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                  Worth $500 each (parents, older children, etc.)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setW4(f => ({ ...f, step3Other: Math.max(0, f.step3Other - 1) }))}
                    style={{ width: 32, height: 32, borderRadius: 6, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >−</button>
                  <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', minWidth: 32, textAlign: 'center' }}>{w4.step3Other}</span>
                  <button
                    type="button"
                    onClick={() => setW4(f => ({ ...f, step3Other: f.step3Other + 1 }))}
                    style={{ width: 32, height: 32, borderRadius: 6, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >+</button>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
                    = {fmt(w4.step3Other * 500)} credit
                  </span>
                </div>
              </div>

              {dependentCredit > 0 && (
                <div style={{
                  padding: '10px 14px', borderRadius: 6,
                  background: 'var(--success-light)', border: '1px solid var(--success)',
                  fontSize: 13, color: 'var(--success)', fontWeight: 600,
                }}>
                  Total dependent credit: {fmt(dependentCredit)} — this reduces your annual withholding by approximately this amount.
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Step 4: Other Adjustments ──────────────────────────────────────── */}
        {step === 4 && (
          <>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Any other adjustments? <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: 13 }}>(optional)</span>
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Most people can skip this step. Only fill in if you have non-job income, extra deductions, or want additional tax withheld.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                {
                  key: 'step4a',
                  label: '4(a) Other income (annual)',
                  desc: 'Non-job income like dividends, interest, or freelance work. Leave blank if none.',
                  placeholder: '0.00',
                },
                {
                  key: 'step4b',
                  label: '4(b) Deductions (annual)',
                  desc: 'If you expect to itemize deductions and they\'ll exceed the standard deduction. Leave blank if unsure.',
                  placeholder: '0.00',
                },
                {
                  key: 'step4c',
                  label: '4(c) Extra withholding per paycheck',
                  desc: 'Want a buffer? Add a flat dollar amount to be withheld each pay period.',
                  placeholder: '0.00',
                },
              ].map(field => (
                <div key={field.key}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {field.label}
                  </label>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{field.desc}</div>
                  <div style={{ position: 'relative', maxWidth: 200 }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={field.placeholder}
                      value={w4[field.key] || ''}
                      onChange={e => setW4(f => ({ ...f, [field.key]: parseFloat(e.target.value) || 0 }))}
                      style={{ ...INPUT_STYLE, paddingLeft: 22, maxWidth: 200 }}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Done screen ────────────────────────────────────────────────────── */}
        {step === 5 && (
          <div style={{ padding: '4px 0 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8l4 4 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>W-4 on file</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Your preferences are saved and used for payroll calculations.</div>
              </div>
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary btn-sm" onClick={() => setStep(1)}>Edit</button>
            </div>

            {/* Summary rows */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {[
                {
                  label: 'Filing Status',
                  value: FILING_OPTIONS.find(o => o.value === w4.filingStatus)?.label || w4.filingStatus,
                  sub: 'Step 1',
                },
                {
                  label: 'Multiple Jobs / Spouse Works',
                  value: w4.step2Checkbox ? 'Yes — higher withholding applied' : 'No',
                  sub: 'Step 2',
                },
                {
                  label: 'Children under 17',
                  value: w4.step3Children > 0
                    ? `${w4.step3Children} child${w4.step3Children !== 1 ? 'ren' : ''} — ${fmt(w4.step3Children * 2000)} credit`
                    : 'None',
                  sub: 'Step 3',
                },
                {
                  label: 'Other Dependents',
                  value: w4.step3Other > 0
                    ? `${w4.step3Other} dependent${w4.step3Other !== 1 ? 's' : ''} — ${fmt(w4.step3Other * 500)} credit`
                    : 'None',
                  sub: 'Step 3',
                },
                {
                  label: 'Other Income (annual)',
                  value: w4.step4a > 0 ? fmt(w4.step4a) : 'Not specified',
                  sub: 'Step 4a',
                },
                {
                  label: 'Deductions (annual)',
                  value: w4.step4b > 0 ? fmt(w4.step4b) : 'Not specified',
                  sub: 'Step 4b',
                },
                {
                  label: 'Extra Withholding per Period',
                  value: w4.step4c > 0 ? fmt(w4.step4c) : 'None',
                  sub: 'Step 4c',
                },
              ].map((row, i, arr) => (
                <div key={row.label} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--border-light)' : 'none',
                  background: 'var(--bg)',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{row.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{row.sub}</div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, textAlign: 'right', maxWidth: '55%' }}>
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {saveMsg && step !== 5 && (
          <div style={{ marginTop: 12, padding: '8px 14px', borderRadius: 6, background: 'var(--error-light)', border: '1px solid var(--error)', fontSize: 13, color: 'var(--error)' }}>
            {saveMsg}
          </div>
        )}

        {/* Navigation */}
        {step <= TOTAL_STEPS && (
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            {step > 1 && (
              <button className="btn btn-secondary btn-sm" onClick={() => setStep(s => s - 1)}>
                Back
              </button>
            )}
            <div style={{ flex: 1 }} />
            {step < TOTAL_STEPS ? (
              <button className="btn btn-primary btn-sm" onClick={() => setStep(s => s + 1)}>
                Next
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={handleSave}>
                {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save W-4'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function FieldRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: last ? 'none' : '1px solid var(--border-light)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  );
}

function SensitiveInput({ value, onChange, placeholder, maxLength }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
        style={{ ...INPUT_STYLE, paddingRight: 44 }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, padding: '2px 4px' }}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function EmployeeDashboard() {
  const { user, logout } = useAuth();
  const navigate          = useNavigate();

  const [me,          setMe]          = useState(null);
  const [paystubs,    setPaystubs]    = useState([]);
  const [tab,         setTab]         = useState('paystubs');
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [editSection, setEditSection] = useState(null); // 'contact' | 'tax' | 'bank'
  const [form,        setForm]        = useState({});
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState('');

  useEffect(() => {
    Promise.all([api.getEmployeePortalMe(), api.getEmployeePortalPaystubs()])
      .then(([m, p]) => {
        if (!m.onboardingDone) {
          navigate('/employee/onboarding', { replace: true });
          return;
        }
        setMe(m);
        setPaystubs(p);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function startEdit(section, fields) {
    setForm(fields);
    setEditSection(section);
    setSaveMsg('');
  }

  function cancelEdit() {
    setEditSection(null);
    setForm({});
    setSaveMsg('');
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setSaveMsg('');
    try {
      const updated = await api.updateEmployeePortalMe(form);
      setMe(updated);
      setEditSection(null);
      setForm({});
      setSaveMsg('Saved successfully.');
    } catch (err) {
      setSaveMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36 }} />
    </div>
  );

  const TABS = [
    ['paystubs', 'My Pay Records'],
    ['w4',       'My W-4'],
    ['profile',  'My Profile'],
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>

      {/* Nav */}
      <div style={{
        height: 'var(--nav-h)', background: 'var(--accent)',
        display: 'flex', alignItems: 'center', padding: '0 28px',
        gap: 16, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.4px' }}>
          Payroll<span style={{ color: '#7ca4e0' }}>Tax</span> Pro
        </div>
        {me && (
          <>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18 }}>|</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{me.firstName} {me.lastName}</div>
            {me.companyName && (
              <>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>at</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{me.companyName}</div>
              </>
            )}
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>{user?.email || user?.username}</span>
        <button
          onClick={logout}
          style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '6px 14px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, maxWidth: 860, margin: '0 auto', width: '100%', padding: '28px 24px' }}>

        {error && (
          <div style={{ background: 'var(--error-light)', border: '1px solid var(--error)', borderRadius: 6, padding: '10px 16px', marginBottom: 20, fontSize: 13, color: 'var(--error)' }}>
            {error}
          </div>
        )}

        {me && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px', margin: 0 }}>
              {me.firstName} {me.lastName}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
              Employee · {me.payType === 'hourly' ? `$${(me.payRate || 0).toFixed(2)}/hr` : `$${(me.payRate || 0).toLocaleString()}/yr`}
              {me.companyName && <> · <strong style={{ color: 'var(--text-primary)' }}>{me.companyName}</strong></>}
            </p>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'var(--bg-tertiary)', borderRadius: 8, padding: 3, width: 'fit-content' }}>
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: tab === k ? '#fff' : 'transparent',
                boxShadow: tab === k ? 'var(--shadow)' : 'none',
                fontWeight: tab === k ? 700 : 500,
                fontSize: 13, color: tab === k ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Pay Records tab */}
        {tab === 'paystubs' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
              <span className="card-title">Pay Records</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{paystubs.length} total</span>
            </div>
            {paystubs.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>No pay records yet</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Your accountant will post them here when available.</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                    {['Period', 'Gross Pay', 'Fed. Tax', 'SS Tax', 'Medicare', 'Net Pay'].map(h => (
                      <th key={h} style={{ padding: '10px 18px', textAlign: h === 'Period' ? 'left' : 'right', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paystubs.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border-light)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '13px 18px', fontSize: 13, fontWeight: 600 }}>Q{p.tax_quarter} {p.tax_year}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.gross_wages)}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.fit_withholding)}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.employee_ss)}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.employee_medicare)}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>{fmt(p.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* W-4 tab — key on w4Submitted so wizard resets to summary when status changes */}
        {tab === 'w4' && me && (
          <W4Wizard key={String(me.w4Submitted)} me={me} onSaved={updated => setMe(updated)} />
        )}

        {/* Profile tab */}
        {tab === 'profile' && me && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {saveMsg && (
              <div style={{ background: 'var(--success-light)', border: '1px solid var(--success)', borderRadius: 6, padding: '10px 16px', fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
                {saveMsg}
              </div>
            )}

            {/* ── Company ─────────────────────────────────────────────────── */}
            {me.companyName && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Company</span>
                </div>
                <FieldRow label="Company Name" value={me.companyName} />
                <FieldRow label="Employee Join Code" value={me.companyJoinCode} last />
              </div>
            )}

            {/* ── Pay Info (read-only — set by accountant) ─────────────────── */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Pay Information</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Set by your accountant</span>
              </div>
              <FieldRow label="Pay Type" value={me.payType} />
              <FieldRow label="Pay Rate" value={me.payType === 'hourly' ? `$${(me.payRate || 0).toFixed(2)}/hr` : `$${(me.payRate || 0).toLocaleString()}/yr`} last />
            </div>

            {/* ── Tax & Employment ─────────────────────────────────────────── */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Tax &amp; Employment</span>
                {editSection !== 'tax' && (
                  <button className="btn btn-secondary btn-sm" onClick={() => startEdit('tax', { ssn: '', hireDate: me.hireDate || '' })}>
                    {me.hasSSN && me.hireDate ? 'Edit' : 'Add Info'}
                  </button>
                )}
              </div>

              {editSection === 'tax' ? (
                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <FormField label="Social Security Number (SSN)">
                    <SensitiveInput
                      value={form.ssn || ''}
                      onChange={e => setForm(f => ({ ...f, ssn: e.target.value.replace(/\D/g, '') }))}
                      placeholder={me.hasSSN ? 'Enter new SSN to update' : '9 digits, no dashes'}
                      maxLength={9}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      Stored encrypted. Enter 9 digits with no dashes or spaces.{me.hasSSN ? ` Current: ${me.ssn}` : ''}
                    </div>
                  </FormField>
                  <FormField label="Hire Date">
                    <input
                      type="date"
                      value={form.hireDate || ''}
                      onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))}
                      style={INPUT_STYLE}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                  </FormField>
                  {saving && <div style={{ fontSize: 12, color: 'var(--error)' }}>{saveMsg}</div>}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                      {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <FieldRow label="SSN on File" value={me.hasSSN ? me.ssn : 'Not provided'} />
                  <FieldRow label="Hire Date" value={me.hireDate} last />
                  {!me.hasSSN && (
                    <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 12, color: 'var(--error)' }}>
                      Your SSN is required for payroll tax filing. Please add it above.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Direct Deposit ───────────────────────────────────────────── */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Direct Deposit</span>
                {editSection !== 'bank' && (
                  <button className="btn btn-secondary btn-sm" onClick={() => startEdit('bank', {
                    bankRoutingNumber: '',
                    bankAccountNumber: '',
                    bankAccountType:   me.accountType || 'checking',
                  })}>
                    {me.hasBankInfo ? 'Update' : 'Add Account'}
                  </button>
                )}
              </div>

              {editSection === 'bank' ? (
                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <FormField label="Routing Number">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.bankRoutingNumber || ''}
                      onChange={e => setForm(f => ({ ...f, bankRoutingNumber: e.target.value.replace(/\D/g, '') }))}
                      placeholder={me.routingNumber ? `Current: ${me.routingNumber}` : '9-digit ABA routing number'}
                      maxLength={9}
                      style={INPUT_STYLE}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                  </FormField>
                  <FormField label="Account Number">
                    <SensitiveInput
                      value={form.bankAccountNumber || ''}
                      onChange={e => setForm(f => ({ ...f, bankAccountNumber: e.target.value.replace(/\D/g, '') }))}
                      placeholder={me.accountNumber ? `Current: ${me.accountNumber}` : 'Enter account number'}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Stored encrypted. Only the last 4 digits are visible after saving.</div>
                  </FormField>
                  <FormField label="Account Type">
                    <select
                      value={form.bankAccountType || 'checking'}
                      onChange={e => setForm(f => ({ ...f, bankAccountType: e.target.value }))}
                      style={{ ...INPUT_STYLE, cursor: 'pointer' }}
                    >
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </select>
                  </FormField>
                  {saveMsg && editSection === 'bank' && <div style={{ fontSize: 12, color: 'var(--error)' }}>{saveMsg}</div>}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                      {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <FieldRow label="Routing #"    value={me.routingNumber  || 'Not on file'} />
                  <FieldRow label="Account #"    value={me.accountNumber  || 'Not on file'} />
                  <FieldRow label="Account Type" value={me.accountType    ? me.accountType.charAt(0).toUpperCase() + me.accountType.slice(1) : '—'} last />
                  {!me.hasBankInfo && (
                    <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 12, color: 'var(--error)' }}>
                      Bank account required for direct deposit. Please add your account details above.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Contact Address ──────────────────────────────────────────── */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Contact Address</span>
                {editSection !== 'contact' && (
                  <button className="btn btn-secondary btn-sm" onClick={() => startEdit('contact', { address: me.address || '', city: me.city || '', state: me.state || '', zip: me.zip || '' })}>Edit</button>
                )}
              </div>

              {editSection === 'contact' ? (
                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    ['address', 'Street Address'],
                    ['city',    'City'],
                    ['state',   'State'],
                    ['zip',     'ZIP Code'],
                  ].map(([field, label]) => (
                    <FormField key={field} label={label}>
                      <input
                        type="text"
                        value={form[field] || ''}
                        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                        style={INPUT_STYLE}
                        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                      />
                    </FormField>
                  ))}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                      {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </form>
              ) : (
                <FieldRow label="Address" value={[me.address, me.city, me.state, me.zip].filter(Boolean).join(', ')} last />
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
