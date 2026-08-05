import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

// ABA routing-number checksum — catches most single-digit typos before a
// paycheck gets misrouted.
function validRoutingNumber(rn) {
  if (!/^\d{9}$/.test(rn)) return false;
  const d = rn.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

const INPUT = {
  width: '100%', boxSizing: 'border-box',
  padding: '10px 13px', borderRadius: 0,
  border: '1.5px solid var(--border)',
  fontSize: 14, color: 'var(--text-primary)',
  background: 'var(--bg)', outline: 'none',
};

const FILING_OPTIONS = [
  { value: 'single',  label: 'Single or Married filing separately', desc: 'You file taxes on your own, or married but file separate returns.' },
  { value: 'married', label: 'Married filing jointly',              desc: 'You and your spouse combine income on one tax return.' },
  { value: 'head',    label: 'Head of household',                   desc: "You're unmarried and pay more than half the cost of a home for a qualifying person." },
];

const STEPS = [
  { id: 1, label: 'Welcome'         },
  { id: 2, label: 'Personal Info'   },
  { id: 3, label: 'Filing Status'   },
  { id: 4, label: 'Multiple Jobs'   },
  { id: 5, label: 'Dependents'      },
  { id: 6, label: 'Other Adjustments' },
  { id: 7, label: 'Direct Deposit'  },
  { id: 8, label: 'Home Address'    },
  { id: 9, label: 'All Done!'       },
];

function RadioCard({ selected, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: '14px 16px', borderRadius: 10,
        border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'rgba(30,86,160,0.04)' : 'var(--bg)',
        transition: 'all 0.15s', display: 'flex', alignItems: 'flex-start', gap: 12,
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'var(--accent)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </button>
  );
}

function Counter({ value, onChange, min = 0 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))}
        style={{ width: 36, height: 36, borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        −
      </button>
      <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', minWidth: 32, textAlign: 'center' }}>{value}</span>
      <button type="button" onClick={() => onChange(value + 1)}
        style={{ width: 36, height: 36, borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        +
      </button>
    </div>
  );
}

function SensitiveInput({ value, onChange, placeholder, maxLength }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input type={show ? 'text' : 'password'} value={value} onChange={onChange}
        placeholder={placeholder} maxLength={maxLength}
        style={{ ...INPUT, paddingRight: 56 }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
      <button type="button" onClick={() => setShow(s => !s)}
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export default function EmployeeOnboarding() {
  const navigate  = useNavigate();
  const { user }  = useAuth();

  const [step, setStep]     = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [me, setMe]         = useState(null);

  const [data, setData] = useState({
    ssn:                '',
    hireDate:           '',
    filingStatus:       'single',
    step2Checkbox:      false,
    step3Children:      0,
    step3Other:         0,
    step4a:             '',
    step4b:             '',
    step4c:             '',
    bankRoutingNumber:  '',
    bankAccountNumber:  '',
    bankAccountConfirm: '',
    bankAccountType:    'checking',
    address:            '',
    city:               '',
    state:              '',
    zip:                '',
  });

  // Prefill from anything already saved server-side (each step persists as you
  // go, so a refresh mid-wizard doesn't lose progress). SSN and account numbers
  // are never sent back in plain text — hasSSN / hasBankInfo tell us they're on
  // file so we don't force re-typing them.
  useEffect(() => {
    api.getEmployeePortalMe().then(m => {
      if (m.onboardingDone) { navigate('/employee', { replace: true }); return; }
      setMe(m);
      setData(d => ({
        ...d,
        hireDate:        m.hireDate      || d.hireDate,
        filingStatus:    m.filingStatus  || d.filingStatus,
        step2Checkbox:   !!m.step2Checkbox,
        step3Children:   m.step3Children || 0,
        step3Other:      m.step3Other    || 0,
        step4a:          m.step4a > 0 ? String(m.step4a) : d.step4a,
        step4b:          m.step4b > 0 ? String(m.step4b) : d.step4b,
        step4c:          m.step4c > 0 ? String(m.step4c) : d.step4c,
        bankAccountType: m.accountType   || d.bankAccountType,
        address:         m.address       || d.address,
        city:            m.city          || d.city,
        state:           m.state         || d.state,
        zip:             m.zip           || d.zip,
      }));
    }).catch(() => {});
  }, []);

  function set(field) {
    return e => setData(d => ({ ...d, [field]: e.target.value }));
  }

  function validate() {
    if (step === 2) {
      const digits = data.ssn.replace(/\D/g, '');
      if (digits.length === 0 && !me?.hasSSN) return 'SSN must be exactly 9 digits.';
      if (digits.length > 0 && digits.length !== 9) return 'SSN must be exactly 9 digits.';
    }
    if (step === 7) {
      const routing = data.bankRoutingNumber.replace(/\D/g, '');
      const account = data.bankAccountNumber.replace(/\D/g, '');
      const confirm = data.bankAccountConfirm.replace(/\D/g, '');
      // Nothing entered: fine if bank info is already on file — otherwise
      // point at the paper-check skip below.
      if (!routing && !account) {
        if (me?.hasBankInfo) return null;
        return 'Enter your bank details, or choose "I\'m paid by paper check" below to skip this step.';
      }
      if (!validRoutingNumber(routing))
        return "That routing number doesn't look right. Check the 9-digit number at the bottom-left of a check.";
      if (account.length < 4)
        return 'Please enter a valid account number (at least 4 digits).';
      if (account !== confirm)
        return "Account numbers don't match. Re-enter them to confirm.";
    }
    if (step === 8) {
      if (!data.address.trim()) return 'Please enter your street address.';
      if (!data.city.trim())    return 'Please enter your city.';
      if (!data.state)          return 'Please select your state.';
      if (!/^\d{5}(-\d{4})?$/.test(data.zip.trim())) return 'Please enter a valid 5-digit ZIP code.';
    }
    return null;
  }

  // Fields to persist for the step being completed — partial PATCHes so a
  // refresh or dropped session never throws away typed SSN/bank data.
  function stepPayload() {
    if (step === 2) {
      const p = {};
      const digits = data.ssn.replace(/\D/g, '');
      if (digits.length === 9) p.ssn = digits;
      if (data.hireDate)       p.hireDate = data.hireDate;
      return p;
    }
    if (step === 3) return { filingStatus: data.filingStatus };
    if (step === 4) return { step2Checkbox: data.step2Checkbox };
    if (step === 5) return { step3Children: data.step3Children, step3Other: data.step3Other };
    if (step === 6) return {
      step4a: parseFloat(data.step4a) || 0,
      step4b: parseFloat(data.step4b) || 0,
      step4c: parseFloat(data.step4c) || 0,
    };
    if (step === 7) {
      const routing = data.bankRoutingNumber.replace(/\D/g, '');
      const account = data.bankAccountNumber.replace(/\D/g, '');
      if (!routing && !account) return {}; // already on file — nothing new to save
      return { bankRoutingNumber: routing, bankAccountNumber: account, bankAccountType: data.bankAccountType };
    }
    return {};
  }

  async function next() {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    const payload = stepPayload();
    if (Object.keys(payload).length === 0) { setStep(s => s + 1); return; }
    setSaving(true);
    try {
      await api.updateEmployeePortalMe(payload);
      setStep(s => s + 1);
    } catch (e2) {
      setError(`${e2.message || 'Something went wrong.'} Your other answers are saved — fix this and try again.`);
    } finally {
      setSaving(false);
    }
  }

  // Paper-check path: direct deposit must never lock someone out of the
  // portal. The dashboard's "bank account required" nudge follows up later.
  function skipBank() {
    setData(d => ({ ...d, bankRoutingNumber: '', bankAccountNumber: '', bankAccountConfirm: '' }));
    setError('');
    setStep(8);
  }

  function back() { setError(''); setStep(s => s - 1); }

  async function finish() {
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true); setError('');
    try {
      // Earlier steps were saved as you went — only the address is left.
      await api.updateEmployeePortalMe({
        address: data.address.trim(),
        city:    data.city.trim(),
        state:   data.state,
        zip:     data.zip.trim(),
      });
      await api.completeEmployeeOnboarding();
      setStep(9);
    } catch (err2) {
      setError(err2.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const CONTENT_STEPS = STEPS.length - 1; // exclude welcome
  const progress = step === 1 ? 0 : ((step - 1) / (STEPS.length - 2)) * 100;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>

      {/* Nav */}
      <div style={{ height: 'var(--nav-h)', background: 'var(--accent)', display: 'flex', alignItems: 'center', padding: '0 28px', boxShadow: '0 2px 8px rgba(0,0,0,0.18)', flexShrink: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.4px' }}>
          Payroll<span style={{ color: '#7ca4e0' }}>Tax</span> Pro
        </div>
      </div>

      {/* Progress bar */}
      {step > 1 && step < 9 && (
        <div style={{ height: 3, background: 'var(--border)', flexShrink: 0 }}>
          <div style={{ height: '100%', background: 'var(--accent)', width: `${progress}%`, transition: 'width 0.4s ease' }} />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
        <div style={{ width: '100%', maxWidth: 520 }}>

          {/* ── Step 1: Welcome ──────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="card" style={{ textAlign: 'center', padding: '48px 40px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>👋</div>
              <h1 style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.4px' }}>
                Welcome aboard!
              </h1>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 28, maxWidth: 380, margin: '0 auto 28px' }}>
                Before you can view your dashboard, we need to collect a few details for payroll — your tax withholding info, direct deposit (optional — paper checks work too), and contact details.
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 28 }}>This takes about 2 minutes.</p>
              <button className="btn btn-primary" style={{ width: '100%', padding: '12px', fontSize: 15, fontWeight: 700 }} onClick={next}>
                Get Started
              </button>
            </div>
          )}

          {/* ── Step 2: Personal Info ─────────────────────────────────────────── */}
          {step === 2 && (
            <div className="card" style={{ padding: '36px 36px 28px' }}>
              <StepLabel step={1} total={7} label="Personal Information" />
              <h2 style={H2}>Let's start with your basic details.</h2>
              <p style={SUB}>This information is used for payroll tax filings. Your SSN is stored encrypted.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <Field label="Social Security Number (SSN)">
                  <SensitiveInput
                    value={data.ssn}
                    onChange={e => setData(d => ({ ...d, ssn: e.target.value.replace(/\D/g, '') }))}
                    placeholder={me?.hasSSN ? 'Already on file — leave blank to keep it' : 'Enter 9 digits, no dashes'}
                    maxLength={9}
                  />
                  <Hint>{me?.hasSSN ? 'Your SSN is saved and encrypted. Only enter it again to change it.' : 'e.g. 123456789 — stored encrypted, never shared'}</Hint>
                </Field>
                <Field label="Hire Date (optional)">
                  <input type="date" value={data.hireDate} onChange={set('hireDate')}
                    style={INPUT}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border)'}
                  />
                  <Hint>Not sure? Leave it blank — your employer can add it later.</Hint>
                </Field>
              </div>

              <NavRow onBack={back} onNext={next} error={error} saving={saving} />
            </div>
          )}

          {/* ── Step 3: Filing Status ─────────────────────────────────────────── */}
          {step === 3 && (
            <div className="card" style={{ padding: '36px 36px 28px' }}>
              <StepLabel step={2} total={7} label="W-4 — Filing Status" />
              <h2 style={H2}>How do you file your taxes?</h2>
              <p style={SUB}>This sets your federal income tax withholding bracket.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {FILING_OPTIONS.map(opt => (
                  <RadioCard key={opt.value} selected={data.filingStatus === opt.value} onClick={() => setData(d => ({ ...d, filingStatus: opt.value }))}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{opt.desc}</div>
                  </RadioCard>
                ))}
              </div>
              <NavRow onBack={back} onNext={next} error={error} saving={saving} />
            </div>
          )}

          {/* ── Step 4: Multiple Jobs ─────────────────────────────────────────── */}
          {step === 4 && (
            <div className="card" style={{ padding: '36px 36px 28px' }}>
              <StepLabel step={3} total={7} label="W-4 — Multiple Jobs" />
              <h2 style={H2}>Do you have more than one job, or does your spouse work?</h2>
              <p style={SUB}>Answering "Yes" increases withholding so you don't owe at tax time.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {[
                  { val: false, label: 'No', desc: 'I have one job and my spouse doesn\'t work (or I\'m single with one job).' },
                  { val: true,  label: 'Yes', desc: 'I have multiple jobs, or my spouse also works.' },
                ].map(opt => (
                  <RadioCard key={String(opt.val)} selected={data.step2Checkbox === opt.val} onClick={() => setData(d => ({ ...d, step2Checkbox: opt.val }))}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{opt.desc}</div>
                  </RadioCard>
                ))}
              </div>
              <NavRow onBack={back} onNext={next} error={error} saving={saving} />
            </div>
          )}

          {/* ── Step 5: Dependents ───────────────────────────────────────────── */}
          {step === 5 && (
            <div className="card" style={{ padding: '36px 36px 28px' }}>
              <StepLabel step={4} total={7} label="W-4 — Dependents" />
              <h2 style={H2}>Do you have qualifying dependents?</h2>
              <p style={SUB}>Claiming dependents reduces your withholding. Leave at 0 if none.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 24 }}>
                <div style={{ padding: '18px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Children under age 17</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>Worth $2,000 each in tax credit</div>
                  <Counter value={data.step3Children} onChange={v => setData(d => ({ ...d, step3Children: v }))} />
                </div>
                <div style={{ padding: '18px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Other dependents</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>Worth $500 each (parents, older children, etc.)</div>
                  <Counter value={data.step3Other} onChange={v => setData(d => ({ ...d, step3Other: v }))} />
                </div>
              </div>
              <NavRow onBack={back} onNext={next} error={error} saving={saving} />
            </div>
          )}

          {/* ── Step 6: Other Adjustments ─────────────────────────────────────── */}
          {step === 6 && (
            <div className="card" style={{ padding: '36px 36px 28px' }}>
              <StepLabel step={5} total={7} label="W-4 — Other Adjustments" />
              <h2 style={H2}>Any other withholding adjustments? <span style={{ fontWeight: 500, fontSize: 16, color: 'var(--text-muted)' }}>Optional</span></h2>
              <p style={SUB}>Most people skip this. Only fill in if you have non-job income, itemized deductions, or want extra withheld.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                {[
                  { key: 'step4a', label: '4(a) Other annual income', desc: 'Dividends, interest, freelance, etc.' },
                  { key: 'step4b', label: '4(b) Annual deductions',   desc: 'If you\'ll itemize and exceed the standard deduction.' },
                  { key: 'step4c', label: '4(c) Extra per paycheck',  desc: 'Additional flat amount to withhold each pay period.' },
                ].map(f => (
                  <Field key={f.key} label={f.label}>
                    <Hint>{f.desc}</Hint>
                    <div style={{ position: 'relative', maxWidth: 220, marginTop: 6 }}>
                      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 14 }}>$</span>
                      <input type="number" min="0" step="0.01" placeholder="0.00"
                        value={data[f.key]} onChange={set(f.key)}
                        style={{ ...INPUT, paddingLeft: 24, maxWidth: 220 }}
                        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                      />
                    </div>
                  </Field>
                ))}
              </div>
              <NavRow onBack={back} onNext={next} error={error} nextLabel="Next" saving={saving} />
            </div>
          )}

          {/* ── Step 7: Direct Deposit ────────────────────────────────────────── */}
          {step === 7 && (
            <div className="card" style={{ padding: '36px 36px 28px' }}>
              <StepLabel step={6} total={7} label="Direct Deposit" />
              <h2 style={H2}>Where should we deposit your pay?</h2>
              <p style={SUB}>Your account number is stored encrypted. Only the last 4 digits will be visible after saving.</p>

              {me?.hasBankInfo && (
                <p style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600, marginBottom: 16 }}>
                  A bank account is already on file. Leave these blank to keep it, or enter new details to replace it.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <Field label="Routing Number (9 digits)">
                  <input type="text" inputMode="numeric"
                    value={data.bankRoutingNumber}
                    onChange={e => setData(d => ({ ...d, bankRoutingNumber: e.target.value.replace(/\D/g,'') }))}
                    placeholder="e.g. 021000021" maxLength={9}
                    style={INPUT}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border)'}
                  />
                  <Hint>Found at the bottom-left of a check.</Hint>
                </Field>
                <Field label="Account Number">
                  <SensitiveInput
                    value={data.bankAccountNumber}
                    onChange={e => setData(d => ({ ...d, bankAccountNumber: e.target.value.replace(/\D/g,'') }))}
                    placeholder="Enter account number"
                  />
                </Field>
                <Field label="Re-enter Account Number">
                  <SensitiveInput
                    value={data.bankAccountConfirm}
                    onChange={e => setData(d => ({ ...d, bankAccountConfirm: e.target.value.replace(/\D/g,'') }))}
                    placeholder="Type your account number again"
                  />
                  <Hint>Typos here misroute paychecks — we double-check so you don't have to worry.</Hint>
                </Field>
                <Field label="Account Type">
                  <select value={data.bankAccountType} onChange={set('bankAccountType')}
                    style={{ ...INPUT, cursor: 'pointer' }}>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                  </select>
                </Field>
              </div>
              <NavRow onBack={back} onNext={next} error={error} saving={saving} />
              <button
                type="button"
                onClick={skipBank}
                disabled={saving}
                style={{ width: '100%', marginTop: 14, padding: '9px 0', background: 'none', border: '1.5px dashed var(--border)', borderRadius: 0, color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                I'm paid by paper check / I'll add this later — skip this step
              </button>
            </div>
          )}

          {/* ── Step 8: Home Address ──────────────────────────────────────────── */}
          {step === 8 && (
            <div className="card" style={{ padding: '36px 36px 28px' }}>
              <StepLabel step={7} total={7} label="Home Address" />
              <h2 style={H2}>What's your home address?</h2>
              <p style={SUB}>Used for your employment records and W-2. You can update this anytime from your profile.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  ['address', 'Street Address'],
                  ['city',    'City'],
                ].map(([field, label]) => (
                  <Field key={field} label={label}>
                    <input type="text" value={data[field]} onChange={set(field)}
                      style={INPUT}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                  </Field>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="State">
                    <select value={data.state} onChange={set('state')} style={{ ...INPUT, cursor: 'pointer' }}>
                      <option value="">Select state</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="ZIP Code">
                    <input type="text" inputMode="numeric" value={data.zip} onChange={set('zip')}
                      maxLength={10}
                      style={INPUT}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                  </Field>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
                <button className="btn btn-secondary" style={{ padding: '10px 20px' }} onClick={back}>Back</button>
                <div style={{ flex: 1 }} />
                <button
                  className="btn btn-primary"
                  style={{ padding: '10px 28px', fontWeight: 700 }}
                  disabled={saving}
                  onClick={finish}
                >
                  {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Save & Finish'}
                </button>
              </div>
              {error && <p style={{ color: 'var(--error)', fontSize: 12, marginTop: 10 }}>{error}</p>}
            </div>
          )}

          {/* ── Step 9: Done ─────────────────────────────────────────────────── */}
          {step === 9 && (
            <div className="card" style={{ textAlign: 'center', padding: '48px 40px' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', background: 'var(--success)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
              }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M5 14l7 7 11-11" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h1 style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.4px' }}>
                You're all set!
              </h1>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 32, maxWidth: 380, margin: '0 auto 32px' }}>
                Your information has been saved. Your accountant will have everything they need for payroll. You can update any of these details from your profile at any time.
              </p>
              <button
                className="btn btn-primary"
                style={{ padding: '12px 32px', fontSize: 15, fontWeight: 700 }}
                onClick={() => navigate('/employee', { replace: true })}
              >
                Go to My Dashboard
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Small shared sub-components ───────────────────────────────────────────────

const H2 = { fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px', letterSpacing: '-0.3px' };
const SUB = { fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 };

function StepLabel({ step, total, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Step {step} of {total}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      {children}
    </div>
  );
}

function Hint({ children }) {
  return <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>{children}</p>;
}

function NavRow({ onBack, onNext, error, nextLabel = 'Next', saving }) {
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-secondary" style={{ padding: '10px 20px' }} onClick={onBack} disabled={saving}>Back</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" style={{ padding: '10px 28px', fontWeight: 700 }} onClick={onNext} disabled={saving}>
          {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : nextLabel}
        </button>
      </div>
      {error && <p style={{ color: 'var(--error)', fontSize: 12, marginTop: 10, margin: '10px 0 0' }}>{error}</p>}
    </div>
  );
}
