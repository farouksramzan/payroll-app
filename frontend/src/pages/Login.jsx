import { useState, useEffect } from 'react';
import { useNavigate, Navigate, Link, useSearchParams } from 'react-router-dom';
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
  padding: '11px 14px', borderRadius: 0,
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
  const [searchParams] = useSearchParams();

  const [tab,  setTab]  = useState('admin');
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  // Session-expiry state from the API layer (see api/client.js 401 handling)
  const sessionExpired = searchParams.get('expired') === '1';
  const nextParam = searchParams.get('next');
  const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : null;

  // Stack the two panels on narrow screens (phones) so the sign-in form is reachable
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = (e) => setIsNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Login form
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

  // Company signup form
  const [companyForm, setCompanyForm] = useState({ businessName: '', ein: '', contactName: '', email: '', password: '', confirmPassword: '' });

  // Employee signup — 2-step flow
  const [empStep, setEmpStep]     = useState(1); // 1=enter code, 2=name+email+password
  const [empCode, setEmpCode]     = useState('');
  const [empCompany, setEmpCompany] = useState(null); // { clientId, businessName }
  const [empForm, setEmpForm]     = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });

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
    setEmpStep(1); setEmpCode(''); setEmpCompany(null);
    setEmpForm({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
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
      if (safeNext)                   navigate(safeNext, { replace: true });
      else if (u.role === 'client')   navigate(`/company/${u.clientId}`, { replace: true });
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
    if (companyForm.password.length < 8) {
      return setError('Password must be at least 8 characters');
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
      navigate('/onboarding', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Employee step 1: look up company ─────────────────────────────────────
  // ── Employee step 1: verify join code ────────────────────────────────────
  async function handleFindCompany(e) {
    e.preventDefault();
    if (!empCode.trim()) return setError('Enter your company join code');
    setError(''); setLoading(true);
    try {
      const data = await api.lookupCompanyByCode(empCode.trim());
      setEmpCompany(data);
      setEmpStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleBackToStep1() {
    setEmpStep(1);
    setEmpCompany(null);
    setEmpForm({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
    setError('');
  }

  // ── Employee step 2: create account ──────────────────────────────────────
  async function handleClaimEmployee(e) {
    e.preventDefault();
    if (!empForm.firstName.trim() || !empForm.lastName.trim()) return setError('Enter your full name');
    if (empForm.password !== empForm.confirmPassword) return setError('Passwords do not match');
    if (empForm.password.length < 8) return setError('Password must be at least 8 characters');
    setError(''); setLoading(true);
    try {
      const data = await api.claimEmployee({
        joinCode:   empCode.trim().toUpperCase(),
        firstName:  empForm.firstName.trim(),
        lastName:   empForm.lastName.trim(),
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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: isNarrow ? 'column' : 'row', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Left — Marketing panel ─────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        order: isNarrow ? 2 : 0,
        background: 'linear-gradient(150deg, #0f172a 0%, #1e293b 60%, #0f4c35 100%)',
        display: 'flex', flexDirection: 'column',
        padding: isNarrow ? '40px 24px' : '52px 56px', color: '#fff', overflowY: 'auto', minWidth: 0,
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
          <h1 style={{ fontSize: isNarrow ? 28 : 36, fontWeight: 900, lineHeight: 1.15, margin: '0 0 20px', letterSpacing: '-0.5px' }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'repeat(3, 1fr)', gap: 12, marginBottom: 44 }}>
          {STATS.map(s => (
            <div key={s.value} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '16px 14px' }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: '#4ade80', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 44 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 20, padding: '6px 14px' }}>
              <span style={{ fontSize: 14 }}>🤖</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd' }}>Built entirely with Claude Code</span>
            </div>
            <span style={{ fontSize: 12, color: '#475569' }}>·</span>
            <span style={{ fontSize: 12, color: '#475569' }}>React + Node.js + SQLite</span>
          </div>
        </div>
      </div>

      {/* ── Right — Auth panel (first on narrow screens) ──────────────────── */}
      <div style={{
        width: isNarrow ? '100%' : 460,
        flexShrink: 0,
        order: isNarrow ? 1 : 0,
        background: '#f8fafc',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: isNarrow ? '36px 20px' : '52px 44px',
        borderLeft: isNarrow ? 'none' : '1px solid #e2e8f0',
        borderBottom: isNarrow ? '1px solid #e2e8f0' : 'none',
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

          {sessionExpired && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e', display: 'flex', gap: 8 }}>
              <span>⏱</span> Your session expired — sign in to continue.
            </div>
          )}

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
              <AdminLoginForm form={loginForm} setForm={setLoginForm} loading={loading} onSubmit={handleLogin} />
              <p style={{ marginTop: 14, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                Forgot your password? Ask another admin on your account to reset it.
              </p>
              <p style={{ marginTop: 10, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                Don't have an account?{' '}
                <Link to="/register" style={{ color: '#16a34a', fontWeight: 600, textDecoration: 'none' }}>Create one free</Link>
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
                  <PasswordInput value={loginForm.password} autoComplete="current-password"
                    onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                  />
                </div>
                <SubmitBtn loading={loading} label="Sign In as Company" />
              </form>
              <p style={{ marginTop: 14, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                Forgot your password? Contact your accountant to reset it.
              </p>
              <p style={{ marginTop: 10, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
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
                  <PasswordInput placeholder="Min 8 characters" autoComplete="new-password" value={companyForm.password}
                    onChange={e => setCompanyForm(f => ({ ...f, password: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Confirm Password *</label>
                  <PasswordInput placeholder="Repeat password" autoComplete="new-password" value={companyForm.confirmPassword}
                    onChange={e => setCompanyForm(f => ({ ...f, confirmPassword: e.target.value }))}
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
                  <PasswordInput value={loginForm.password} autoComplete="current-password"
                    onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                  />
                </div>
                <SubmitBtn loading={loading} label="Sign In as Employee" />
              </form>
              <p style={{ marginTop: 14, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                Forgot your password? Ask your employer to send you a new invite.
              </p>
              <p style={{ marginTop: 10, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
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
              loading={loading}
              onFind={handleFindCompany}
              onBack={() => switchMode('login')}
            />
          )}

          {tab === 'employee' && mode === 'signup' && empStep === 2 && (
            <EmployeeStep2
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
        <input type="text" placeholder="yourname" autoComplete="username" required value={form.username}
          onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
          style={INPUT_STYLE}
          onFocus={e => e.target.style.borderColor = '#22c55e'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'}
        />
      </div>
      <div>
        <label style={LABEL_STYLE}>Password</label>
        <PasswordInput value={form.password} autoComplete="current-password"
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
        />
      </div>
      <SubmitBtn loading={loading} label="Sign In as Accountant" />
    </form>
  );
}

// Password field with show/hide toggle and a Caps Lock warning.
function PasswordInput({ value, onChange, placeholder = '••••••••', autoComplete, required = true }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          value={value}
          onChange={onChange}
          onKeyUp={e => setCaps(!!(e.getModifierState && e.getModifierState('CapsLock')))}
          style={{ ...INPUT_STYLE, paddingRight: 52 }}
          onFocus={e => e.target.style.borderColor = '#22c55e'}
          onBlur={e => { e.target.style.borderColor = '#e2e8f0'; setCaps(false); }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 600, color: '#64748b', padding: '4px 6px',
          }}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {caps && (
        <p style={{ fontSize: 11, color: '#b45309', margin: '4px 0 0' }}>Caps Lock is on</p>
      )}
    </div>
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

function EmployeeStep1({ empCode, setEmpCode, loading, onFind, onBack }) {
  return (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.3px' }}>Create Employee Account</h2>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>Enter the join code your employer shared with you</p>

      <form onSubmit={onFind} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={LABEL_STYLE}>Company Join Code</label>
          <input
            type="text"
            placeholder="e.g. ABC123"
            value={empCode}
            onChange={e => setEmpCode(e.target.value.toUpperCase())}
            maxLength={8}
            style={{ ...INPUT_STYLE, textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700, fontFamily: 'monospace', fontSize: 18, textAlign: 'center' }}
            onFocus={e => e.target.style.borderColor = '#22c55e'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
            Ask your employer for their 6-character join code to create your account.
          </p>
        </div>
        <SubmitBtn loading={loading} label="Continue" />
      </form>

      <p style={{ marginTop: 20, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
        Already have an account?{' '}
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#16a34a', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
          Sign in
        </button>
      </p>
    </>
  );
}

function EmployeeStep2({ empCompany, empForm, setEmpForm, loading, onSubmit, onBack }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1 }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>Create Your Account</h2>
      </div>

      <div style={{ background: '#f0fdf4', border: '1px solid #d1fae5', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#065f46' }}>
          Joining <strong>{empCompany?.businessName}</strong>
        </div>
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={LABEL_STYLE}>First Name *</label>
            <input type="text" placeholder="Jane" required value={empForm.firstName}
              onChange={e => setEmpForm(f => ({ ...f, firstName: e.target.value }))}
              style={INPUT_STYLE}
              onFocus={e => e.target.style.borderColor = '#22c55e'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>Last Name *</label>
            <input type="text" placeholder="Smith" required value={empForm.lastName}
              onChange={e => setEmpForm(f => ({ ...f, lastName: e.target.value }))}
              style={INPUT_STYLE}
              onFocus={e => e.target.style.borderColor = '#22c55e'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>
        </div>
        <div>
          <label style={LABEL_STYLE}>Email Address *</label>
          <input type="email" placeholder="you@example.com" required value={empForm.email}
            onChange={e => setEmpForm(f => ({ ...f, email: e.target.value }))}
            style={INPUT_STYLE}
            onFocus={e => e.target.style.borderColor = '#22c55e'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>Create Password *</label>
          <PasswordInput placeholder="Min 8 characters" autoComplete="new-password" value={empForm.password}
            onChange={e => setEmpForm(f => ({ ...f, password: e.target.value }))}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>Confirm Password *</label>
          <PasswordInput placeholder="Repeat password" autoComplete="new-password" value={empForm.confirmPassword}
            onChange={e => setEmpForm(f => ({ ...f, confirmPassword: e.target.value }))}
          />
        </div>
        <SubmitBtn loading={loading} label="Create Employee Account" />
      </form>
    </>
  );
}
