import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import founderImg from '../assets/founder.jpg';

const STATS = [
  { value: '$3–12', label: 'per check charged by QuickBooks / ADP / Paychex' },
  { value: '$0', label: 'per check with PayrollTax Pro' },
  { value: '2026', label: 'IRS tables built in — always current' },
];

const FEATURES = [
  {
    icon: '⚡',
    title: 'Live Tax Calculations',
    desc: 'FIT, Social Security, Medicare, FUTA, and state SUI computed instantly as you enter hours. No waiting, no guessing.',
  },
  {
    icon: '🏦',
    title: 'Direct EFTPS Submission',
    desc: 'Submit 941 and 940 deposits directly from the app. Tracks deadlines, semiweekly vs. monthly schedules, and confirmation numbers.',
  },
  {
    icon: '💸',
    title: 'Direct Deposit via ACH',
    desc: 'Pay employees via direct deposit without routing through a payroll processor. Setup takes minutes per employee.',
  },
  {
    icon: '📊',
    title: 'Multi-Client Management',
    desc: 'Built for independent accountants. Manage multiple companies under one login — completely isolated, no data crossover.',
  },
];

const ROLE_TABS = [
  { key: 'admin',    label: 'Accountant', icon: '🧾', hint: 'Sign in to your accountant dashboard' },
  { key: 'client',   label: 'Company',    icon: '🏢', hint: 'Sign in to your company portal' },
  { key: 'employee', label: 'Employee',   icon: '👤', hint: 'Sign in to view your paystubs' },
];

const INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 14px', borderRadius: 9,
  border: '1.5px solid #e2e8f0',
  fontSize: 14, color: '#0f172a',
  background: '#fff', outline: 'none',
};
const LABEL_STYLE = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#374151',
  marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase',
};

export default function Login() {
  const { user, login, setUser } = useAuth();
  const navigate = useNavigate();

  const [tab,  setTab]  = useState('admin');
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  // Login form
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

  // Company signup form
  const [companyForm, setCompanyForm] = useState({ businessName: '', ein: '', contactName: '', email: '', password: '', confirmPassword: '' });

  // Employee signup — 2-step flow
  const [empStep, setEmpStep]     = useState(1); // 1=enter code, 2=pick name + set password
  const [empCode, setEmpCode]     = useState('');
  const [empCompany, setEmpCompany] = useState(null); // { clientId, businessName, employees }
  const [empSelected, setEmpSelected] = useState(null); // { id, firstName, lastName }
  const [empForm, setEmpForm]     = useState({ email: '', password: '', confirmPassword: '' });

  if (user) {
    if (user.role === 'client')   return <Navigate to={`/company/${user.clientId}`} replace />;
    if (user.role === 'employee') return <Navigate to="/employee" replace />;
    return <Navigate to="/" replace />;
  }

  function switchTab(key) {
    setTab(key);
    setMode('login');
    setError('');
    setLoginForm({ username: '', password: '' });
    setCompanyForm({ businessName: '', ein: '', contactName: '', email: '', password: '', confirmPassword: '' });
    setEmpStep(1); setEmpCode(''); setEmpCompany(null); setEmpSelected(null);
    setEmpForm({ email: '', password: '', confirmPassword: '' });
  }

  function switchMode(m) {
    setMode(m);
    setError('');
  }

  // ── Login submit ──────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const u = await login(loginForm.username, loginForm.password);
      if (u.role === 'client')        navigate(`/company/${u.clientId}`, { replace: true });
      else if (u.role === 'employee') navigate('/employee', { replace: true });
      else                            navigate('/',         { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Company signup submit ─────────────────────────────────────────────────
  async function handleCompanySignup(e) {
    e.preventDefault();
    if (companyForm.password !== companyForm.confirmPassword) {
      return setError('Passwords do not match');
    }
    setError(''); setLoading(true);
    try {
      const data = await api.registerCompany({
        businessName: companyForm.businessName,
        ein:          companyForm.ein,
        contactName:  companyForm.contactName,
        email:        companyForm.email,
        password:     companyForm.password,
      });
      localStorage.setItem('token', data.token);
      setUser(data.user);
      navigate(`/company/${data.user.clientId}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Employee step 1: look up company ─────────────────────────────────────
  async function handleFindCompany(e) {
    e.preventDefault();
    if (!empCode.trim()) return setError('Enter your company join code');
    setError(''); setLoading(true);
    try {
      const data = await api.lookupCompanyByCode(empCode.trim());
      setEmpCompany(data);
      if (data.employees.length === 0) {
        setError('No unclaimed employee profiles found at this company. Ask your accountant to add you first.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSelectEmployee(emp) {
    setEmpSelected(emp);
    setEmpStep(2);
    setError('');
  }

  function handleBackToStep1() {
    setEmpStep(1);
    setEmpSelected(null);
    setEmpForm({ email: '', password: '', confirmPassword: '' });
    setError('');
  }

  // ── Employee step 2: claim profile ───────────────────────────────────────
  async function handleClaimEmployee(e) {
    e.preventDefault();
    if (empForm.password !== empForm.confirmPassword) return setError('Passwords do not match');
    setError(''); setLoading(true);
    try {
      const data = await api.claimEmployee({
        joinCode:   empCode.trim().toUpperCase(),
        employeeId: empSelected.id,
        email:      empForm.email,
        password:   empForm.password,
      });
      localStorage.setItem('token', data.token);
      setUser(data.user);
      navigate('/employee', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const activeTab = ROLE_TABS.find(t => t.key === tab);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Left — Marketing panel ─────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        background: 'linear-gradient(150deg, #0f172a 0%, #1e293b 60%, #0f4c35 100%)',
        display: 'flex', flexDirection: 'column',
        padding: '52px 56px', color: '#fff', overflowY: 'auto', minWidth: 0,
      }}>
        <div style={{ marginBottom: 52 }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: '#fff' }}>
            Payroll<span style={{ color: '#4ade80' }}>Tax</span> Pro
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Federal Payroll Tax Engine
          </div>
        </div>

        <div style={{ marginBottom: 44 }}>
          <div style={{
            display: 'inline-block', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 20, padding: '4px 14px', fontSize: 11, fontWeight: 700, color: '#fca5a5',
            letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 20,
          }}>
            The Problem We're Solving
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.15, margin: '0 0 20px', letterSpacing: '-0.5px' }}>
            Per-check fees are{' '}
            <span style={{ color: '#f87171' }}>killing independent accountants.</span>
          </h1>
          <p style={{ fontSize: 15, color: '#cbd5e1', lineHeight: 1.75, margin: 0, maxWidth: 480 }}>
            QuickBooks, ADP, Paychex, and Gusto charge{' '}
            <strong style={{ color: '#fff' }}>$3–12 per check processed</strong>.
            A small accounting firm managing 10 clients with 15 employees each
            runs biweekly — that's <strong style={{ color: '#fbbf24' }}>$11,000–44,000 a year</strong>{' '}
            handed to software vendors before a single dollar of profit.
          </p>
          <div style={{
            marginTop: 24, padding: '16px 20px', background: 'rgba(74,222,128,0.08)',
            border: '1px solid rgba(74,222,128,0.25)', borderRadius: 12, fontSize: 14, color: '#86efac', lineHeight: 1.6,
          }}>
            <strong style={{ color: '#4ade80' }}>We built PayrollTax Pro</strong> to strip that cost to zero —
            a full federal tax engine with direct EFTPS submission and ACH direct deposit,
            at <strong style={{ color: '#4ade80' }}>no per-transaction cost</strong>.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 44 }}>
          {STATS.map(s => (
            <div key={s.value} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '16px 14px' }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: '#4ade80', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 44 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '16px' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 5 }}>{f.title}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.55 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        <div style={{
          marginBottom: 32, padding: '20px', background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, display: 'flex', gap: 18, alignItems: 'flex-start',
        }}>
          <img src={founderImg} alt="Farouk Ramzan" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', objectPosition: 'center top', flexShrink: 0, border: '2px solid rgba(74,222,128,0.4)' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#f1f5f9', marginBottom: 2 }}>Farouk Ramzan</div>
            <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Founder</div>
            <p style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7, margin: 0 }}>
              Farouk spent months working with independent accountants to design a payroll platform
              that is not only <strong style={{ color: '#fff' }}>cheaper than competitors</strong> —
              so these accountants can keep their small businesses alive — but also
              easier to use and learn for brand-new independent accountants entering the field.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 20, padding: '6px 14px' }}>
              <span style={{ fontSize: 14 }}>🤖</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd' }}>Built entirely with Claude Code</span>
            </div>
            <span style={{ fontSize: 12, color: '#475569' }}>·</span>
            <span style={{ fontSize: 12, color: '#475569' }}>React + Node.js + SQLite</span>
          </div>
        </div>
      </div>

      {/* ── Right — Auth panel ────────────────────────────────────────────── */}
      <div style={{
        width: 460,
        flexShrink: 0,
        background: '#f8fafc',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '52px 44px',
        borderLeft: '1px solid #e2e8f0',
        overflowY: 'auto',
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          {/* Role tabs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 28, background: '#e2e8f0', borderRadius: 12, padding: 4 }}>
            {ROLE_TABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => switchTab(t.key)}
                style={{
                  padding: '9px 6px', borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: tab === t.key ? '#fff' : 'transparent',
                  boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                  fontWeight: tab === t.key ? 700 : 500,
                  fontSize: 12, color: tab === t.key ? '#0f172a' : '#64748b',
                  transition: 'all 0.15s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                }}
              >
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#b91c1c', display: 'flex', gap: 8 }}>
              <span>⚠</span> {error}
            </div>
          )}

          {/* ── Accountant tab ─────────────────────────────────────────── */}
          {tab === 'admin' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.3px' }}>Sign in</h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>{activeTab.hint}</p>
              <div style={{ background: '#fff', border: '1px solid #bae6fd', borderRadius: 10, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>👀</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', marginBottom: 2 }}>Demo account</div>
                  <div style={{ fontSize: 12, color: '#475569' }}>
                    <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>admin</code>
                    {' / '}
                    <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>admin123</code>
                  </div>
                </div>
              </div>
              <AdminLoginForm form={loginForm} setForm={setLoginForm} loading={loading} onSubmit={handleLogin} />
              <p style={{ marginTop: 20, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                Don't have an account?{' '}
                <a href="/register" style={{ color: '#16a34a', fontWeight: 600, textDecoration: 'none' }}>Create one free</a>
              </p>
            </>
          )}

          {/* ── Company tab ────────────────────────────────────────────── */}
          {tab === 'client' && mode === 'login' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.3px' }}>Company Sign In</h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>Sign in to your company portal</p>
              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={LABEL_STYLE}>Email address</label>
                  <input type="email" placeholder="you@company.com" autoComplete="email" required value={loginForm.username}
                    onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Password</label>
                  <input type="password" placeholder="••••••••" autoComplete="current-password" required value={loginForm.password}
                    onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <SubmitBtn loading={loading} label="Sign In as Company" />
              </form>
              <p style={{ marginTop: 20, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
                New company?{' '}
                <button onClick={() => switchMode('signup')} style={{ background: 'none', border: 'none', color: '#16a34a', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  Create an account
                </button>
              </p>
            </>
          )}

          {tab === 'client' && mode === 'signup' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.3px' }}>Create Company Account</h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>Register your business and get started</p>
              <form onSubmit={handleCompanySignup} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>Business Name *</label>
                  <input type="text" placeholder="Acme Corp" required value={companyForm.businessName}
                    onChange={e => setCompanyForm(f => ({ ...f, businessName: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>EIN *</label>
                  <input type="text" placeholder="XX-XXXXXXX" required value={companyForm.ein}
                    onChange={e => setCompanyForm(f => ({ ...f, ein: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Contact Name</label>
                  <input type="text" placeholder="John Smith" value={companyForm.contactName}
                    onChange={e => setCompanyForm(f => ({ ...f, contactName: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Email Address *</label>
                  <input type="email" placeholder="you@company.com" required value={companyForm.email}
                    onChange={e => setCompanyForm(f => ({ ...f, email: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Password *</label>
                  <input type="password" placeholder="Min 8 characters" required value={companyForm.password}
                    onChange={e => setCompanyForm(f => ({ ...f, password: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Confirm Password *</label>
                  <input type="password" placeholder="Repeat password" required value={companyForm.confirmPassword}
                    onChange={e => setCompanyForm(f => ({ ...f, confirmPassword: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <SubmitBtn loading={loading} label="Create Company Account" />
              </form>
              <p style={{ marginTop: 16, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
                Already have an account?{' '}
                <button onClick={() => switchMode('login')} style={{ background: 'none', border: 'none', color: '#16a34a', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  Sign in
                </button>
              </p>
            </>
          )}

          {/* ── Employee tab ────────────────────────────────────────────── */}
          {tab === 'employee' && mode === 'login' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.3px' }}>Employee Sign In</h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>Sign in to view your paystubs</p>
              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={LABEL_STYLE}>Email address</label>
                  <input type="email" placeholder="you@example.com" autoComplete="email" required value={loginForm.username}
                    onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Password</label>
                  <input type="password" placeholder="••••••••" autoComplete="current-password" required value={loginForm.password}
                    onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                    style={INPUT_STYLE}
                    onFocus={e => e.target.style.borderColor = '#22c55e'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                </div>
                <SubmitBtn loading={loading} label="Sign In as Employee" />
              </form>
              <p style={{ marginTop: 20, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
                New employee?{' '}
                <button onClick={() => switchMode('signup')} style={{ background: 'none', border: 'none', color: '#16a34a', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  Create account with join code
                </button>
              </p>
            </>
          )}

          {tab === 'employee' && mode === 'signup' && empStep === 1 && (
            <EmployeeStep1
              empCode={empCode} setEmpCode={setEmpCode}
              empCompany={empCompany}
              loading={loading}
              onFind={handleFindCompany}
              onSelect={handleSelectEmployee}
              onBack={() => switchMode('login')}
            />
          )}

          {tab === 'employee' && mode === 'signup' && empStep === 2 && (
            <EmployeeStep2
              empSelected={empSelected}
              empCompany={empCompany}
              empForm={empForm} setEmpForm={setEmpForm}
              loading={loading}
              onSubmit={handleClaimEmployee}
              onBack={handleBackToStep1}
            />
          )}

        </div>
      </div>
    </div>
  );
}

function AdminLoginForm({ form, setForm, loading, onSubmit }) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={LABEL_STYLE}>Username</label>
        <input type="text" placeholder="admin" autoComplete="username" required value={form.username}
          onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
          style={INPUT_STYLE}
          onFocus={e => e.target.style.borderColor = '#22c55e'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'}
        />
      </div>
      <div>
        <label style={LABEL_STYLE}>Password</label>
        <input type="password" placeholder="••••••••" autoComplete="current-password" required value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          style={INPUT_STYLE}
          onFocus={e => e.target.style.borderColor = '#22c55e'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'}
        />
      </div>
      <SubmitBtn loading={loading} label="Sign In as Accountant" />
    </form>
  );
}

function SubmitBtn({ loading, label }) {
  return (
    <button type="submit" disabled={loading} style={{
      marginTop: 4, padding: '12px', borderRadius: 9,
      background: loading ? '#86efac' : '#16a34a',
      color: '#fff', fontWeight: 700, fontSize: 15,
      border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      transition: 'background 0.15s',
    }}>
      {loading ? <span className="spinner" /> : `${label} →`}
    </button>
  );
}

function EmployeeStep1({ empCode, setEmpCode, empCompany, loading, onFind, onSelect, onBack }) {
  return (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.3px' }}>Create Employee Account</h2>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>Enter the join code your company shared with you</p>

      <form onSubmit={onFind} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          placeholder="ABC123"
          value={empCode}
          onChange={e => setEmpCode(e.target.value.toUpperCase())}
          maxLength={8}
          style={{ ...INPUT_STYLE, flex: 1, textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, fontFamily: 'monospace' }}
          onFocus={e => e.target.style.borderColor = '#22c55e'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'}
        />
        <button type="submit" disabled={loading} style={{
          padding: '11px 16px', borderRadius: 9, background: '#16a34a', color: '#fff',
          fontWeight: 600, fontSize: 13, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', flexShrink: 0,
        }}>
          {loading ? '…' : 'Find'}
        </button>
      </form>

      {empCompany && (
        <div style={{ background: '#fff', border: '1px solid #d1fae5', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#065f46', marginBottom: 12 }}>
            🏢 {empCompany.businessName}
          </div>
          {empCompany.employees.length === 0 ? (
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>No unclaimed profiles at this company. Ask your accountant to add you.</p>
          ) : (
            <>
              <p style={{ fontSize: 12, color: '#374151', marginBottom: 10 }}>Select your name:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {empCompany.employees.map(emp => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => onSelect(emp)}
                    style={{
                      padding: '10px 14px', borderRadius: 8, border: '1.5px solid #d1fae5',
                      background: '#f0fdf4', cursor: 'pointer', textAlign: 'left',
                      fontSize: 13, fontWeight: 600, color: '#065f46',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { e.target.style.background = '#dcfce7'; e.target.style.borderColor = '#86efac'; }}
                    onMouseLeave={e => { e.target.style.background = '#f0fdf4'; e.target.style.borderColor = '#d1fae5'; }}
                  >
                    {emp.firstName} {emp.lastName}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <p style={{ marginTop: 8, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
        Already have an account?{' '}
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#16a34a', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
          Sign in
        </button>
      </p>
    </>
  );
}

function EmployeeStep2({ empSelected, empCompany, empForm, setEmpForm, loading, onSubmit, onBack }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1 }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>Set Up Your Account</h2>
      </div>

      <div style={{ background: '#f0fdf4', border: '1px solid #d1fae5', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#065f46' }}>
          <strong>{empSelected.firstName} {empSelected.lastName}</strong> at <strong>{empCompany.businessName}</strong>
        </div>
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={LABEL_STYLE}>Your Email Address *</label>
          <input type="email" placeholder="you@example.com" required value={empForm.email}
            onChange={e => setEmpForm(f => ({ ...f, email: e.target.value }))}
            style={INPUT_STYLE}
            onFocus={e => e.target.style.borderColor = '#22c55e'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>Create Password *</label>
          <input type="password" placeholder="Min 8 characters" required value={empForm.password}
            onChange={e => setEmpForm(f => ({ ...f, password: e.target.value }))}
            style={INPUT_STYLE}
            onFocus={e => e.target.style.borderColor = '#22c55e'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>Confirm Password *</label>
          <input type="password" placeholder="Repeat password" required value={empForm.confirmPassword}
            onChange={e => setEmpForm(f => ({ ...f, confirmPassword: e.target.value }))}
            style={INPUT_STYLE}
            onFocus={e => e.target.style.borderColor = '#22c55e'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>
        <SubmitBtn loading={loading} label="Create Employee Account" />
      </form>
    </>
  );
}
