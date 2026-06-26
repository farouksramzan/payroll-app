import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function InviteAccept() {
  const { token }    = useParams();
  const navigate     = useNavigate();
  const { setUser }  = useAuth();

  const [info,     setInfo]     = useState(null);   // { role, name, clientName }
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    api.getInvite(token)
      .then(setInfo)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return; }
    setSaving(true);
    setError('');
    try {
      const data = await api.acceptInvite(token, email, password);
      localStorage.setItem('token', data.token);
      setUser(data.user);
      if (data.user.role === 'client')   navigate('/client', { replace: true });
      else if (data.user.role === 'employee') navigate('/employee', { replace: true });
      else navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <div className="spinner-border text-primary" />
    </div>
  );

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light px-3">
      <div className="card shadow-sm" style={{ maxWidth: 460, width: '100%' }}>
        <div className="card-body p-4 p-md-5">
          <div className="text-center mb-4">
            <div className="fw-bold fs-4 text-primary mb-1">PayrollTax Pro</div>
            {info && (
              <div>
                <div className="fs-5 fw-semibold">Welcome{info.name ? `, ${info.name}` : ''}!</div>
                <div className="text-muted small mt-1">
                  {info.role === 'client'
                    ? 'Set up your company portal account'
                    : 'Set up your employee portal account'}
                </div>
              </div>
            )}
          </div>

          {error && <div className="alert alert-danger py-2 small">{error}</div>}

          {info ? (
            <form onSubmit={handleSubmit}>
              <div className="mb-3">
                <label className="form-label fw-medium">Email address</label>
                <input
                  type="email"
                  className="form-control"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
                <div className="form-text">This will be your login username.</div>
              </div>

              <div className="mb-3">
                <label className="form-label fw-medium">Create a password</label>
                <input
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoComplete="new-password"
                />
              </div>

              <div className="mb-4">
                <label className="form-label fw-medium">Confirm password</label>
                <input
                  type="password"
                  className="form-control"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  required
                  autoComplete="new-password"
                />
              </div>

              <button type="submit" className="btn btn-primary w-100" disabled={saving}>
                {saving ? <span className="spinner-border spinner-border-sm me-2" /> : null}
                Create Account
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
