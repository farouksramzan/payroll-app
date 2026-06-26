import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function EmployeeDashboard() {
  const { user, logout } = useAuth();

  const [me,       setMe]       = useState(null);
  const [paystubs, setPaystubs] = useState([]);
  const [tab,      setTab]      = useState('paystubs');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  // Profile edit state
  const [editing, setEditing]   = useState(false);
  const [form,    setForm]      = useState({});
  const [saving,  setSaving]    = useState(false);
  const [saveMsg, setSaveMsg]   = useState('');

  useEffect(() => {
    Promise.all([api.getEmployeePortalMe(), api.getEmployeePortalPaystubs()])
      .then(([m, p]) => { setMe(m); setForm(buildForm(m)); setPaystubs(p); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function buildForm(m) {
    return {
      email: m.email || '',
      phone: m.phone || '',
      address: m.address || '',
      city: m.city || '',
      state: m.state || '',
      zip: m.zip || '',
    };
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg('');
    try {
      const updated = await api.updateEmployeePortalMe(form);
      setMe(updated);
      setEditing(false);
      setSaveMsg('Profile saved.');
    } catch (err) {
      setSaveMsg(err.message);
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
    <div className="min-vh-100 bg-light">
      {/* Top nav */}
      <nav className="navbar navbar-light bg-white shadow-sm px-3 px-md-4">
        <span className="navbar-brand fw-bold text-primary mb-0">PayrollTax Pro</span>
        <div className="d-flex align-items-center gap-2">
          <span className="text-muted small d-none d-sm-inline">{user?.username}</span>
          <button className="btn btn-sm btn-outline-secondary" onClick={logout}>Sign out</button>
        </div>
      </nav>

      <div className="container-fluid px-3 px-md-4 py-4" style={{ maxWidth: 800 }}>
        {error && <div className="alert alert-danger">{error}</div>}

        {me && (
          <div className="mb-4">
            <h5 className="fw-bold mb-0">{me.firstName} {me.lastName}</h5>
            <p className="text-muted small mb-0">{me.jobTitle || 'Employee'}</p>
          </div>
        )}

        {/* Tabs */}
        <ul className="nav nav-tabs mb-3">
          {[['paystubs', 'My Pay Records'], ['profile', 'My Profile']].map(([k, label]) => (
            <li className="nav-item" key={k}>
              <button
                className={`nav-link${tab === k ? ' active' : ''}`}
                onClick={() => setTab(k)}
              >{label}</button>
            </li>
          ))}
        </ul>

        {tab === 'paystubs' && (
          <div className="card">
            <div className="card-body p-0">
              {paystubs.length === 0 ? (
                <div className="p-4 text-muted">No pay records yet. Your accountant will post them here.</div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Period</th>
                        <th className="text-end">Gross Pay</th>
                        <th className="text-end">Fed. Tax</th>
                        <th className="text-end">SS Tax</th>
                        <th className="text-end">Medicare</th>
                        <th className="text-end">Net Pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paystubs.map(p => (
                        <tr key={p.id}>
                          <td>Q{p.quarter} {p.year}</td>
                          <td className="text-end">${(p.gross_wages || 0).toFixed(2)}</td>
                          <td className="text-end">${(p.federal_income_tax || 0).toFixed(2)}</td>
                          <td className="text-end">${(p.social_security_tax || 0).toFixed(2)}</td>
                          <td className="text-end">${(p.medicare_tax || 0).toFixed(2)}</td>
                          <td className="text-end fw-semibold">${(p.net_pay || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'profile' && me && (
          <div className="card">
            <div className="card-body">
              {saveMsg && <div className={`alert py-2 small ${saving ? 'alert-info' : 'alert-success'}`}>{saveMsg}</div>}

              {!editing ? (
                <>
                  <div className="row g-2 mb-3">
                    {[
                      ['Full name', `${me.firstName} ${me.lastName}`],
                      ['Email', me.email || '—'],
                      ['Phone', me.phone || '—'],
                      ['Address', [me.address, me.city, me.state, me.zip].filter(Boolean).join(', ') || '—'],
                      ['Job title', me.jobTitle || '—'],
                      ['Pay type', me.payType || '—'],
                      ['Pay rate', me.payRate ? `$${me.payRate}` : '—'],
                      ['Hire date', me.hireDate || '—'],
                      ['SSN', me.ssn || '—'],
                      ['Routing #', me.routingNumber || 'Not on file'],
                      ['Account #', me.accountNumber || 'Not on file'],
                      ['Account type', me.accountType || '—'],
                    ].map(([label, value]) => (
                      <div className="col-6" key={label}>
                        <div className="text-muted small">{label}</div>
                        <div className="fw-medium">{value}</div>
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-outline-primary btn-sm" onClick={() => setEditing(true)}>
                    Edit contact info
                  </button>
                </>
              ) : (
                <form onSubmit={handleSave}>
                  <p className="text-muted small mb-3">You can update your contact information below. Pay rate, SSN, and banking info must be updated by your accountant.</p>
                  {[
                    ['email', 'Email', 'email'],
                    ['phone', 'Phone', 'tel'],
                    ['address', 'Street address', 'text'],
                    ['city', 'City', 'text'],
                    ['state', 'State', 'text'],
                    ['zip', 'ZIP code', 'text'],
                  ].map(([field, label, type]) => (
                    <div className="mb-3" key={field}>
                      <label className="form-label fw-medium small">{label}</label>
                      <input
                        type={type}
                        className="form-control"
                        value={form[field]}
                        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <div className="d-flex gap-2">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                      {saving ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                      Save
                    </button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setEditing(false); setForm(buildForm(me)); }}>
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
