import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
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

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab]   = useState('admin');
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) {
    if (user.role === 'client')   return <Navigate to="/client"   replace />;
    if (user.role === 'employee') return <Navigate to="/employee" replace />;
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const loggedInUser = await login(form.username, form.password);
      if (loggedInUser.role === 'client')        navigate('/client',   { replace: true });
      else if (loggedInUser.role === 'employee') navigate('/employee', { replace: true });
      else                                       navigate('/',         { replace: true });
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
        display: 'flex',
        flexDirection: 'column',
        padding: '52px 56px',
        color: '#fff',
        overflowY: 'auto',
        minWidth: 0,
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 52 }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: '#fff' }}>
            Payroll<span style={{ color: '#4ade80' }}>Tax</span> Pro
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Federal Payroll Tax Engine
          </div>
        </div>

        {/* Problem statement — FRONT AND CENTER */}
        <div style={{ marginBottom: 44 }}>
          <div style={{
            display: 'inline-block',
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 20,
            padding: '4px 14px',
            fontSize: 11,
            fontWeight: 700,
            color: '#fca5a5',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 20,
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
            Hundreds of independent payroll accountants have closed because of it.
          </p>

          <div style={{
            marginTop: 24,
            padding: '16px 20px',
            background: 'rgba(74,222,128,0.08)',
            border: '1px solid rgba(74,222,128,0.25)',
            borderRadius: 12,
            fontSize: 14,
            color: '#86efac',
            lineHeight: 1.6,
          }}>
            <strong style={{ color: '#4ade80' }}>We built PayrollTax Pro</strong> to strip that cost to zero —
            a full federal tax engine with direct EFTPS submission and ACH direct deposit,
            at <strong style={{ color: '#4ade80' }}>no per-transaction cost</strong>.
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 44 }}>
          {STATS.map(s => (
            <div key={s.value} style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding: '16px 14px',
            }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: '#4ade80', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Features */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 44 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 12,
              padding: '16px',
            }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 5 }}>{f.title}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.55 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Founder section */}
        <div style={{
          marginBottom: 32,
          padding: '20px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          display: 'flex',
          gap: 18,
          alignItems: 'flex-start',
        }}>
          <img
            src={founderImg}
            alt="Farouk Ramzan"
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              objectFit: 'cover',
              objectPosition: 'center top',
              flexShrink: 0,
              border: '2px solid rgba(74,222,128,0.4)',
            }}
          />
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

        {/* Claude Code badge */}
        <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.35)',
              borderRadius: 20, padding: '6px 14px',
            }}>
              <span style={{ fontSize: 14 }}>🤖</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd' }}>Built entirely with Claude Code</span>
            </div>
            <span style={{ fontSize: 12, color: '#475569' }}>·</span>
            <span style={{ fontSize: 12, color: '#475569' }}>React + Node.js + SQLite</span>
          </div>
        </div>
      </div>

      {/* ── Right — Login form ─────────────────────────────────────────────── */}
      <div style={{
        width: 440,
        flexShrink: 0,
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '52px 44px',
        borderLeft: '1px solid #e2e8f0',
      }}>
        <div style={{ width: '100%', maxWidth: 360 }}>

          {/* Role tabs */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 6,
            marginBottom: 28,
            background: '#e2e8f0',
            borderRadius: 12,
            padding: 4,
          }}>
            {ROLE_TABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => { setTab(t.key); setError(''); setForm({ username: '', password: '' }); }}
                style={{
                  padding: '9px 6px',
                  borderRadius: 9,
                  border: 'none',
                  cursor: 'pointer',
                  background: tab === t.key ? '#fff' : 'transparent',
                  boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                  fontWeight: tab === t.key ? 700 : 500,
                  fontSize: 12,
                  color: tab === t.key ? '#0f172a' : '#64748b',
                  transition: 'all 0.15s',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* Form header */}
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.3px' }}>
            Sign in
          </h2>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>{activeTab.hint}</p>

          {/* Demo credentials — accountant only */}
          {tab === 'admin' && (
            <div style={{
              background: '#fff',
              border: '1px solid #bae6fd',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
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
          )}

          {/* Client/Employee hint */}
          {tab !== 'admin' && (
            <div style={{
              background: '#fff',
              border: '1px solid #d1fae5',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 20,
              fontSize: 12,
              color: '#065f46',
              lineHeight: 1.5,
            }}>
              <strong>First time?</strong> Ask your accountant for an invite link to create your account.
              Once you've set up a password, sign in here with your email.
            </div>
          )}

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#b91c1c', display: 'flex', gap: 8 }}>
              <span>⚠</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {tab === 'admin' ? 'Username' : 'Email address'}
              </label>
              <input
                type={tab === 'admin' ? 'text' : 'email'}
                placeholder={tab === 'admin' ? 'admin' : 'you@example.com'}
                autoComplete={tab === 'admin' ? 'username' : 'email'}
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                required
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '11px 14px', borderRadius: 9,
                  border: '1.5px solid #e2e8f0',
                  fontSize: 14, color: '#0f172a',
                  background: '#fff', outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = '#22c55e'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '11px 14px', borderRadius: 9,
                  border: '1.5px solid #e2e8f0',
                  fontSize: 14, color: '#0f172a',
                  background: '#fff', outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = '#22c55e'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 4, padding: '12px', borderRadius: 9,
                background: loading ? '#86efac' : '#16a34a',
                color: '#fff', fontWeight: 700, fontSize: 15,
                border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.15s',
              }}
            >
              {loading ? <span className="spinner" /> : `Sign In as ${activeTab.label} →`}
            </button>
          </form>

          {tab === 'admin' && (
            <p style={{ marginTop: 20, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
              Don't have an account?{' '}
              <Link to="/register" style={{ color: '#16a34a', fontWeight: 600, textDecoration: 'none' }}>Create one free</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
