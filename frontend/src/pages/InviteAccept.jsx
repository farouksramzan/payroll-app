import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const PAGE_STYLE = {
  minHeight: '100vh',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-secondary)', padding: 20,
};
const CARD_STYLE = { maxWidth: 440, width: '100%', padding: '32px 36px' };

function Brand() {
  return (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      <div style={{ fontSize: '1.3333rem', fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
        Payroll<span style={{ color: 'var(--accent)' }}>Tax</span> Pro
      </div>
      <div style={{ fontSize: '0.7333rem', color: 'var(--text-muted)', marginTop: 2, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Federal Payroll Tax Engine
      </div>
    </div>
  );
}

export default function InviteAccept() {
  const { token }    = useParams();
  const navigate     = useNavigate();
  const { setUser }  = useAuth();

  const [info,      setInfo]      = useState(null);   // { role, name, clientName }
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');     // invite is invalid / expired
  const [error,     setError]     = useState('');     // form validation / submit errors
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    api.getInvite(token)
      .then(setInfo)
      .catch(err => setLoadError(err.message || 'This invite link is not valid.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match. Re-enter them and try again.'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return; }
    setSaving(true);
    setError('');
    try {
      const data = await api.acceptInvite(token, email, password);
      localStorage.setItem('token', data.token);
      setUser(data.user);
      if (data.user.role === 'client')   navigate(`/company/${data.user.clientId}`, { replace: true });
      else if (data.user.role === 'employee') navigate('/employee', { replace: true });
      else navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={PAGE_STYLE}>
      <div style={{ textAlign: 'center' }}>
        <span className="spinner spinner-dark" style={{ width: 28, height: 28, borderWidth: 3 }} />
        <div style={{ marginTop: 12, fontSize: '0.8667rem', color: 'var(--text-secondary)' }}>Checking your invite…</div>
      </div>
    </div>
  );

  // ── Invalid / expired invite ─────────────────────────────────────────────
  if (loadError || !info) return (
    <div style={PAGE_STYLE}>
      <div className="card" style={CARD_STYLE}>
        <Brand />
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px', textAlign: 'center' }}>
          This invite link isn't valid
        </h2>
        <p style={{ fontSize: '0.8667rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 8px', textAlign: 'center' }}>
          The link may have expired, already been used, or been copied incompletely.
          Ask your accountant or employer to send you a new invite, then open the newest link.
        </p>
        {loadError && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 20px', textAlign: 'center' }}>
            {loadError}
          </p>
        )}
        <a
          href="/login"
          className="btn btn-secondary"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          Go to sign in
        </a>
      </div>
    </div>
  );

  // ── Set-password form ────────────────────────────────────────────────────
  return (
    <div style={PAGE_STYLE}>
      <div className="card" style={CARD_STYLE}>
        <Brand />
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            Welcome{info.name ? `, ${info.name}` : ''}!
          </h2>
          <p style={{ fontSize: '0.8667rem', color: 'var(--text-secondary)', margin: 0 }}>
            {info.role === 'client'
              ? `Set up your company portal account${info.clientName ? ` for ${info.clientName}` : ''}`
              : `Set up your employee portal account${info.clientName ? ` for ${info.clientName}` : ''}`}
          </p>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <span>⚠</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email address</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 5 }}>
              This will be your login username.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Create a password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Confirm password</label>
            <input
              type="password"
              className="form-input"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              required
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{ width: '100%', justifyContent: 'center', padding: '11px 18px' }}
          >
            {saving ? <><span className="spinner" /> Creating account…</> : 'Create Account'}
          </button>
        </form>

        <p style={{ marginTop: 18, fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}
