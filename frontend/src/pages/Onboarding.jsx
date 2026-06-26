import { useState } from 'react';
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
  { id: 3, label: 'First Employee' },
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

  // Step 3: First Employee (optional)
  const [emp, setEmp] = useState({
    firstName: '',
    lastName: '',
    filingStatus: 'single',
    payType: 'hourly',
    payRate: '',
  });
  const [skipEmployee, setSkipEmployee] = useState(false);

  function updateBiz(k, v) { setBiz(p => ({ ...p, [k]: v })); }
  function updateSchedule(k, v) { setSchedule(p => ({ ...p, [k]: v })); }
  function updateEmp(k, v) { setEmp(p => ({ ...p, [k]: v })); }

  async function handleStep1() {
    if (!biz.businessName.trim()) return setError('Business name is required');
    setError(''); setSaving(true);
    try {
      await api.updateClient(clientId, {
        businessName: biz.businessName.trim(),
        businessAddress: biz.businessAddress.trim() || undefined,
        businessCity: biz.businessCity.trim() || undefined,
        state: biz.state,
        businessZip: biz.businessZip.trim() || undefined,
        contactPhone: biz.contactPhone.trim() || undefined,
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
        nextPayrollDate: schedule.nextPayrollDate,
      });
      // Create a default pay group for this company
      const freqLabel = FREQ_OPTIONS.find(f => f.value === schedule.payrollFrequency)?.label || 'Payroll';
      await api.createPayGroup({
        clientId,
        name: `${freqLabel} Payroll`,
        frequency: schedule.payrollFrequency,
      });
      setStep(3);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleStep3() {
    setError(''); setSaving(true);
    try {
      if (!skipEmployee && emp.firstName.trim() && emp.lastName.trim()) {
        const rate = parseFloat(emp.payRate);
        if (!rate || rate <= 0) { setError('Enter a valid pay rate'); setSaving(false); return; }
        await api.createEmployee({
          clientId,
          firstName: emp.firstName.trim(),
          lastName: emp.lastName.trim(),
          filingStatus: emp.filingStatus,
          payType: emp.payType,
          [emp.payType === 'hourly' ? 'hourlyRate' : 'annualSalary']: rate,
        });
      }
      await api.completeOnboarding(clientId);
      setStep(4);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleFinish() {
    navigate(`/company/${clientId}`, { replace: true });
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
                    height: 2, background: done ? 'var(--accent)' : 'var(--border)',
                    zIndex: 0,
                  }} />
                )}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', zIndex: 1,
                  background: done ? 'var(--accent)' : active ? 'var(--accent)' : 'var(--bg-tertiary)',
                  border: active && !done ? '2px solid var(--accent)' : 'none',
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
                We'll use this information for payroll documents and filings.
              </p>
              <div className="card" style={{ padding: 24 }}>
                <Field label="Business Name *" error={error && error.includes('Business') ? error : ''}>
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
                {error && !error.includes('Business') && (
                  <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>
                )}
                <button
                  onClick={handleStep1}
                  disabled={saving}
                  style={{ width: '100%', padding: '12px 0', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 8 }}
                >
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
                      <div
                        key={opt.value}
                        onClick={() => updateSchedule('payrollFrequency', opt.value)}
                        style={{
                          border: `2px solid ${schedule.payrollFrequency === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
                          background: schedule.payrollFrequency === opt.value ? 'var(--accent-light, #f0f4ff)' : 'var(--bg)',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 14, color: schedule.payrollFrequency === opt.value ? 'var(--accent)' : 'var(--text-primary)' }}>
                          {opt.label}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{opt.sub}</div>
                      </div>
                    ))}
                  </div>
                </Field>
                <Field label="First Payroll Date *" error={error && error.includes('date') ? error : ''}>
                  <input style={inputStyle} type="date" value={schedule.nextPayrollDate} onChange={e => updateSchedule('nextPayrollDate', e.target.value)} />
                </Field>
                {error && !error.includes('date') && (
                  <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>
                )}
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

          {/* ── Step 3: First Employee ── */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                Add your first employee
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>
                You can add more employees later from your dashboard.
              </p>
              <div className="card" style={{ padding: 24 }}>
                {!skipEmployee ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Field label="First Name">
                        <input style={inputStyle} value={emp.firstName} onChange={e => updateEmp('firstName', e.target.value)} placeholder="Jane" />
                      </Field>
                      <Field label="Last Name">
                        <input style={inputStyle} value={emp.lastName} onChange={e => updateEmp('lastName', e.target.value)} placeholder="Smith" />
                      </Field>
                    </div>
                    <Field label="Pay Type">
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {[{ v: 'hourly', l: 'Hourly' }, { v: 'salary', l: 'Salary' }].map(o => (
                          <div key={o.v} onClick={() => updateEmp('payType', o.v)} style={{ border: `2px solid ${emp.payType === o.v ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer', textAlign: 'center', background: emp.payType === o.v ? 'var(--accent-light, #f0f4ff)' : 'var(--bg)', fontWeight: 700, color: emp.payType === o.v ? 'var(--accent)' : 'var(--text-primary)' }}>
                            {o.l}
                          </div>
                        ))}
                      </div>
                    </Field>
                    <Field label={emp.payType === 'hourly' ? 'Hourly Rate ($)' : 'Annual Salary ($)'} error={error}>
                      <input style={inputStyle} type="number" min="0" step="0.01" value={emp.payRate} onChange={e => updateEmp('payRate', e.target.value)} placeholder={emp.payType === 'hourly' ? '18.00' : '55000'} />
                    </Field>
                    <Field label="Filing Status">
                      <select style={inputStyle} value={emp.filingStatus} onChange={e => updateEmp('filingStatus', e.target.value)}>
                        <option value="single">Single</option>
                        <option value="married">Married</option>
                        <option value="married_withholding_at_higher_single_rate">Married (withhold at single rate)</option>
                        <option value="head_of_household">Head of Household</option>
                      </select>
                    </Field>
                    <button onClick={() => setSkipEmployee(true)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '4px 0', marginBottom: 8 }}>
                      Skip for now →
                    </button>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Skipping employee setup</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>You can add employees any time from the Employees tab.</div>
                    <button onClick={() => setSkipEmployee(false)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, cursor: 'pointer' }}>
                      ← Add one now
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button onClick={() => setStep(2)} style={{ flex: 1, padding: '12px 0', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1.5px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    ← Back
                  </button>
                  <button onClick={handleStep3} disabled={saving} style={{ flex: 2, padding: '12px 0', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                    {saving ? 'Saving…' : skipEmployee ? 'Finish Setup →' : 'Add Employee & Finish →'}
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
                Your payroll workspace is ready. You can run payroll, manage employees, and track filings from your dashboard.
              </p>
              <div className="card" style={{ padding: 28, maxWidth: 400, margin: '0 auto 24px', textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>What's next</div>
                {[
                  { icon: '👥', title: 'Add more employees', desc: 'Go to the Employees tab to add your full team.' },
                  { icon: '💸', title: 'Run your first payroll', desc: 'Use the Payroll tab to generate pay stubs.' },
                  { icon: '📋', title: 'Review tax filings', desc: 'Check the Payroll tab to track 941 liabilities.' },
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
              <button
                onClick={handleFinish}
                style={{ padding: '14px 40px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 16, cursor: 'pointer', letterSpacing: '-0.2px' }}
              >
                Go to My Dashboard →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
