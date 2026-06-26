import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const FREQ_OPTIONS = [
  { value: 'weekly',      label: 'Weekly',       sub: '52 paydays/year' },
  { value: 'biweekly',    label: 'Bi-weekly',    sub: '26 paydays/year' },
  { value: 'semimonthly', label: 'Semi-monthly', sub: '24 paydays/year' },
  { value: 'monthly',     label: 'Monthly',      sub: '12 paydays/year' },
];

const STEPS = [
  { id: 1, label: 'Your Business' },
  { id: 2, label: 'Pay Schedule' },
  { id: 3, label: 'Invite Team' },
  { id: 4, label: "You're set!" },
];

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1.5px solid var(--border)', fontSize: 14,
  color: 'var(--text-primary)', background: 'var(--bg)',
  outline: 'none', boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block', fontSize: 13, fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 6,
};

function Field({ label, error, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {error && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{error}</div>}
    </div>
  );
}

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const clientId = user?.clientId;

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);

  const appUrl = window.location.origin;

  // Step 1: Business Details
  const [biz, setBiz] = useState({
    businessName: '',
    businessAddress: '',
    businessCity: '',
    state: 'TX',
    businessZip: '',
    contactPhone: '',
  });

  // Step 2: Pay Schedule
  const [schedule, setSchedule] = useState({
    payrollFrequency: 'biweekly',
    nextPayrollDate: '',
  });

  // Fetch client data on mount to pre-fill business name + get join code
  useEffect(() => {
    if (!clientId) return;
    api.getClient(clientId).then(c => {
      if (c.businessName) setBiz(b => ({ ...b, businessName: c.businessName }));
      if (c.joinCode) setJoinCode(c.joinCode);
    }).catch(() => {});
  }, [clientId]);

  function updateBiz(k, v) { setBiz(p => ({ ...p, [k]: v })); }
  function updateSchedule(k, v) { setSchedule(p => ({ ...p, [k]: v })); }

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

  async function handleStep2() {
    if (!schedule.nextPayrollDate) return setError('First payroll date is required');
    setError(''); setSaving(true);
    try {
      await api.updateClient(clientId, {
        payrollFrequency: schedule.payrollFrequency,
        nextPayrollDate:  schedule.nextPayrollDate,
      });
      const freqLabel = FREQ_OPTIONS.find(f => f.value === schedule.payrollFrequency)?.label || 'Payroll';
      await api.createPayGroup({
        clientId,
        name:      `${freqLabel} Payroll`,
        frequency: schedule.payrollFrequency,
      });
      setStep(3);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

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

      {/* Progress */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 0 }}>
          {STEPS.map((s, i) => {
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 8px', position: 'relative' }}>
                {i < STEPS.length - 1 && (
                  <div style={{
                    position: 'absolute', top: 26, left: '60%', right: '-40%',
                    height: 2, background: done ? 'var(--accent)' : 'var(--border)', zIndex: 0,
                  }} />
                )}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', zIndex: 1,
                  background: done || active ? 'var(--accent)' : 'var(--bg-tertiary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  color: done || active ? '#fff' : 'var(--text-muted)',
                }}>
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
        <div style={{ width: '100%', maxWidth: 560 }}>

          {/* ── Step 1: Business Details ── */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                Tell us about your business
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>
                We'll use this for payroll documents and tax filings.
              </p>
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
                {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
                <button onClick={handleStep1} disabled={saving} style={{ width: '100%', padding: '12px 0', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 8 }}>
                  {saving ? 'Saving…' : 'Continue →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Pay Schedule ── */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                Set up your pay schedule
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>
                How often do you pay your employees?
              </p>
              <div className="card" style={{ padding: 24 }}>
                <Field label="Pay Frequency">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {FREQ_OPTIONS.map(opt => (
                      <div key={opt.value} onClick={() => updateSchedule('payrollFrequency', opt.value)} style={{
                        border: `2px solid ${schedule.payrollFrequency === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
                        background: schedule.payrollFrequency === opt.value ? 'var(--accent-light, #f0f4ff)' : 'var(--bg)',
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: schedule.payrollFrequency === opt.value ? 'var(--accent)' : 'var(--text-primary)' }}>{opt.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{opt.sub}</div>
                      </div>
                    ))}
                  </div>
                </Field>
                <Field label="First Payroll Date *">
                  <input style={inputStyle} type="date" value={schedule.nextPayrollDate} onChange={e => updateSchedule('nextPayrollDate', e.target.value)} />
                </Field>
                {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button onClick={() => setStep(1)} style={{ flex: 1, padding: '12px 0', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1.5px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    ← Back
                  </button>
                  <button onClick={handleStep2} disabled={saving} style={{ flex: 2, padding: '12px 0', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                    {saving ? 'Saving…' : 'Continue →'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Invite Your Team ── */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                Invite your employees
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>
                Share your company join code so employees can create their own accounts and view paystubs.
              </p>
              <div className="card" style={{ padding: 24 }}>

                {/* Join code display */}
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Your Company Join Code
                  </div>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 12,
                    background: 'var(--bg-secondary)', border: '2px dashed var(--border)',
                    borderRadius: 12, padding: '16px 24px',
                  }}>
                    <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: '0.3em', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>
                      {joinCode || '———'}
                    </span>
                    <button onClick={copyCode} style={{
                      padding: '8px 14px', borderRadius: 8, border: '1.5px solid var(--border)',
                      background: copied ? 'var(--accent)' : 'var(--bg)',
                      color: copied ? '#fff' : 'var(--text-primary)',
                      fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                      {copied ? '✓ Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Instructions */}
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
                    How employees join:
                  </div>
                  {[
                    { n: '1', text: `Go to ${appUrl}` },
                    { n: '2', text: 'Click the Employee tab and select "Create account with join code"' },
                    { n: '3', text: `Enter your company code: ${joinCode || '…'}` },
                    { n: '4', text: 'Enter their name, email, and create a password' },
                  ].map(item => (
                    <div key={item.n} style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {item.n}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.text}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Employee accounts are self-service.</strong>{' '}
                    Each employee creates their own login. You can manage their pay rate, hours, and deductions from the Employees tab in your dashboard. Their paystubs will appear automatically once you run payroll.
                  </div>
                </div>

                {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setStep(2)} style={{ flex: 1, padding: '12px 0', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1.5px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
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
              <h2 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
                You're all set!
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 15, maxWidth: 420, margin: '0 auto 32px' }}>
                Your payroll workspace is ready. Run payroll, manage employees, and track filings from your dashboard.
              </p>
              <div className="card" style={{ padding: 28, maxWidth: 400, margin: '0 auto 24px', textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>What's next</div>
                {[
                  { icon: '📤', title: 'Share your join code', desc: `Code: ${joinCode}  — send it to your team so they can create their accounts.` },
                  { icon: '💸', title: 'Run your first payroll', desc: 'Go to the Payroll tab, enter hours, and generate pay stubs.' },
                  { icon: '👥', title: 'Set employee pay rates', desc: 'Open the Employees tab to set up wages and deductions for each person.' },
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
