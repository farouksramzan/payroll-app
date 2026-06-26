import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function ClientDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [summary,   setSummary]   = useState(null);
  const [employees, setEmployees] = useState([]);
  const [paystubs,  setPaystubs]  = useState([]);
  const [tab,       setTab]       = useState('overview');
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  useEffect(() => {
    Promise.all([
      api.getClientPortalSummary(),
      api.getClientPortalEmployees(),
      api.getClientPortalPaystubs(),
    ])
      .then(([s, e, p]) => { setSummary(s); setEmployees(e); setPaystubs(p); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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

      <div className="container-fluid px-3 px-md-4 py-4" style={{ maxWidth: 900 }}>
        {error && <div className="alert alert-danger">{error}</div>}

        <h5 className="fw-bold mb-1">Company Dashboard</h5>
        <p className="text-muted small mb-4">Manage your employees and view payroll records.</p>

        {/* Summary cards */}
        {summary && (
          <div className="row g-3 mb-4">
            <div className="col-6 col-md-3">
              <div className="card text-center h-100">
                <div className="card-body py-3">
                  <div className="fs-2 fw-bold text-primary">{summary.employeeCount}</div>
                  <div className="small text-muted">Employees</div>
                </div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card text-center h-100">
                <div className="card-body py-3">
                  <div className="fs-2 fw-bold text-success">{summary.invitedCount}</div>
                  <div className="small text-muted">Portal Access</div>
                </div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card text-center h-100">
                <div className="card-body py-3">
                  <div className="fs-5 fw-bold text-dark">
                    {summary.latestPayrollYear
                      ? `Q${summary.latestPayrollQ} ${summary.latestPayrollYear}`
                      : '—'}
                  </div>
                  <div className="small text-muted">Latest Payroll</div>
                </div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card text-center h-100">
                <div className="card-body py-3">
                  <div className="fs-2 fw-bold text-warning">
                    {summary.employeeCount - summary.invitedCount}
                  </div>
                  <div className="small text-muted">Not Invited</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <ul className="nav nav-tabs mb-3">
          {[['overview', 'Overview'], ['employees', 'Employees'], ['paystubs', 'Pay Records']].map(([k, label]) => (
            <li className="nav-item" key={k}>
              <button
                className={`nav-link${tab === k ? ' active' : ''}`}
                onClick={() => setTab(k)}
              >{label}</button>
            </li>
          ))}
        </ul>

        {tab === 'overview' && (
          <div className="card">
            <div className="card-body">
              <h6 className="fw-semibold mb-3">Recent Pay Records</h6>
              {paystubs.length === 0 ? (
                <p className="text-muted">No payroll records yet.</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Employee</th>
                        <th>Period</th>
                        <th className="text-end">Gross</th>
                        <th className="text-end">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paystubs.slice(0, 10).map(p => (
                        <tr key={p.id}>
                          <td>{p.first_name} {p.last_name}</td>
                          <td className="text-muted small">Q{p.quarter} {p.year}</td>
                          <td className="text-end">${(p.gross_wages || 0).toFixed(2)}</td>
                          <td className="text-end">${(p.net_pay || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'employees' && (
          <div className="card">
            <div className="card-body p-0">
              {employees.length === 0 ? (
                <div className="p-4 text-muted">No employees found.</div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Name</th>
                        <th>Title</th>
                        <th>Portal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map(e => (
                        <tr key={e.id}>
                          <td>
                            <div className="fw-medium">{e.firstName} {e.lastName}</div>
                            <div className="text-muted small">{e.email || e.portalEmail || ''}</div>
                          </td>
                          <td className="text-muted small align-middle">{e.jobTitle || '—'}</td>
                          <td className="align-middle">
                            {e.hasPortalAccess
                              ? <span className="badge bg-success-subtle text-success">Active</span>
                              : <span className="badge bg-secondary-subtle text-secondary">Not invited</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'paystubs' && (
          <div className="card">
            <div className="card-body p-0">
              {paystubs.length === 0 ? (
                <div className="p-4 text-muted">No pay records yet.</div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Employee</th>
                        <th>Period</th>
                        <th className="text-end">Gross</th>
                        <th className="text-end">Federal Tax</th>
                        <th className="text-end">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paystubs.map(p => (
                        <tr key={p.id}>
                          <td>{p.first_name} {p.last_name}</td>
                          <td className="text-muted small">Q{p.quarter} {p.year}</td>
                          <td className="text-end">${(p.gross_wages || 0).toFixed(2)}</td>
                          <td className="text-end">${(p.federal_income_tax || 0).toFixed(2)}</td>
                          <td className="text-end">${(p.net_pay || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
