import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function fmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px', borderRadius: 6,
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
  const [step, setStep]       = useState(1);
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
          <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
              W-4 Saved
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Your withholding preferences have been saved and will be used for future payroll calculations.
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, textAlign: 'left',
              background: 'var(--bg-secondary)', borderRadius: 8, padding: '14px 16px', marginBottom: 20,
            }}>
              {[
                ['Filing Status', FILING_OPTIONS.find(o => o.value === w4.filingStatus)?.label || w4.filingStatus],
                ['Multiple Jobs', w4.step2Checkbox ? 'Yes' : 'No'],
                ['Children under 17', w4.step3Children],
                ['Other dependents', w4.step3Other],
                ['Extra income', w4.step4a > 0 ? fmt(w4.step4a) : '—'],
                ['Deductions', w4.step4b > 0 ? fmt(w4.step4b) : '—'],
                ['Extra withholding', w4.step4c > 0 ? fmt(w4.step4c) + '/period' : '—'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{val}</div>
                </div>
              ))}
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setStep(1)}
            >
              Edit W-4
            </button>
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

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function EmployeeDashboard() {
  const { user, logout } = useAuth();

  const [me,       setMe]       = useState(null);
  const [paystubs, setPaystubs] = useState([]);
  const [tab,      setTab]      = useState('paystubs');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [editing,  setEditing]  = useState(false);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState('');

  useEffect(() => {
    Promise.all([api.getEmployeePortalMe(), api.getEmployeePortalPaystubs()])
      .then(([m, p]) => { setMe(m); setForm(buildForm(m)); setPaystubs(p); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function buildForm(m) {
    return { address: m.address || '', city: m.city || '', state: m.state || '', zip: m.zip || '' };
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setSaveMsg('');
    try {
      const updated = await api.updateEmployeePortalMe(form);
      setMe(updated); setEditing(false); setSaveMsg('Profile updated.');
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
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
              Employee · {me.payType === 'hourly' ? `$${(me.payRate || 0).toFixed(2)}/hr` : `$${(me.payRate || 0).toLocaleString()}/yr`}
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

        {/* W-4 tab */}
        {tab === 'w4' && me && (
          <W4Wizard me={me} onSaved={updated => setMe(updated)} />
        )}

        {/* Profile tab */}
        {tab === 'profile' && me && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Read-only info card */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Employment Information</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Managed by your accountant</span>
              </div>
              {[
                ['Pay Type',     me.payType    || '—'],
                ['Pay Rate',     me.payType === 'hourly' ? `$${(me.payRate || 0).toFixed(2)}/hr` : `$${(me.payRate || 0).toLocaleString()}/yr`],
                ['Hire Date',    me.hireDate   || '—'],
                ['SSN on File',  me.ssn        || '—'],
                ['Routing #',    me.routingNumber  || 'Not on file'],
                ['Account #',    me.accountNumber  || 'Not on file'],
                ['Account Type', me.accountType    || '—'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
                  <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Editable contact info */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Contact Information</span>
                {!editing && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>
                )}
              </div>

              {saveMsg && (
                <div style={{ background: 'var(--success-light)', border: '1px solid var(--success)', borderRadius: 6, padding: '8px 14px', marginBottom: 14, fontSize: 13, color: 'var(--success)' }}>
                  {saveMsg}
                </div>
              )}

              {!editing ? (
                <>
                  {[
                    ['Address', [me.address, me.city, me.state, me.zip].filter(Boolean).join(', ') || '—'],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border-light)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
                      <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>{value}</span>
                    </div>
                  ))}
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                    You can update your address below. Email and phone changes must be handled by your accountant.
                  </p>
                </>
              ) : (
                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>
                    Update your contact address below. Pay rate, SSN, and banking details must be changed by your accountant.
                  </p>
                  {[
                    ['address', 'Street Address', 'text'],
                    ['city',    'City',           'text'],
                    ['state',   'State',          'text'],
                    ['zip',     'ZIP Code',       'text'],
                  ].map(([field, label, type]) => (
                    <div key={field}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
                      <input type={type} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                        style={INPUT_STYLE}
                        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                      />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                      {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save Changes'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setForm(buildForm(me)); setSaveMsg(''); }}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
