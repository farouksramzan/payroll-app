import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

const INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 14px', borderRadius: 0,
  border: '1.5px solid #e2e8f0',
  fontSize: '0.9333rem', color: '#0f172a',
  background: '#fff', outline: 'none',
};
const LABEL_STYLE = {
  display: 'block', fontSize: '0.7333rem', fontWeight: 600, color: '#374151',
  marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase',
};

export default function Register() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const data = await api.register(form.username.trim(), form.password);
      localStorage.setItem('token', data.token);
      setUser(data.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f8fafc',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '36px 20px', fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: '1.4667rem', fontWeight: 800, letterSpacing: '-0.5px', color: '#0f172a' }}>
            Payroll<span style={{ color: '#16a34a' }}>Tax</span> Pro
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 3, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Federal Payroll Tax Engine
          </div>
        </div>

        <h2 style={{ fontSize: '1.4667rem', fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          Create your accountant account
        </h2>
        <p style={{ fontSize: '0.8667rem', color: '#64748b', margin: '0 0 20px' }}>
          Manage payroll for all your client companies under one login.
        </p>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.8667rem', color: '#b91c1c', display: 'flex', gap: 8 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={LABEL_STYLE}>Username</label>
            <input
              type="text"
              placeholder="yourname"
              autoComplete="username"
              required
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              style={INPUT_STYLE}
              onFocus={(e) => e.target.style.borderColor = '#22c55e'}
              onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>Password</label>
            <PasswordInput
              placeholder="Min 8 characters"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>Confirm Password</label>
            <PasswordInput
              placeholder="Repeat password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
            />
          </div>
          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '12px', borderRadius: 9,
            background: loading ? '#15803d' : '#16a34a',
            color: '#fff', fontWeight: 700, fontSize: '1rem',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'background 0.15s',
          }}>
            {loading ? <><span className="spinner" /> Creating account…</> : 'Create Accountant Account →'}
          </button>
        </form>

        <p style={{ marginTop: 16, fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
          A company or employee? Sign up from the{' '}
          <Link to="/login" style={{ color: '#16a34a', fontWeight: 600, textDecoration: 'none' }}>sign-in page</Link>
          {' '}using your role tab.
        </p>
        <p style={{ marginTop: 10, fontSize: '0.8333rem', color: '#64748b', textAlign: 'center' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#16a34a', fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
        </p>
      </div>
    </div>
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
            fontSize: '0.7333rem', fontWeight: 600, color: '#64748b', padding: '4px 6px',
          }}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {caps && (
        <p style={{ fontSize: '0.7333rem', color: '#b45309', margin: '4px 0 0' }}>Caps Lock is on</p>
      )}
    </div>
  );
}
