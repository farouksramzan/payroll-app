import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Employees() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient]       = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [deleting, setDeleting]   = useState(null);

  useEffect(() => {
    Promise.all([api.getClient(id), api.getEmployees(id)])
      .then(([c, emps]) => { setClient(c); setEmployees(emps); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDelete(emp) {
    if (!window.confirm(`Delete ${emp.fullName}? This cannot be undone.`)) return;
    setDeleting(emp.id);
    try {
      await api.deleteEmployee(emp.id);
      setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/">Dashboard</Link><span>/</span>
          <Link to={`/clients/${id}`}>{client?.businessName}</Link><span>/</span>
          <span>Employees</span>
        </div>
        <div className="page-header-row">
          <div>
            <h2>Employees</h2>
            <p>{client?.businessName} — {employees.length} employee{employees.length !== 1 ? 's' : ''}</p>
          </div>
          <Link to={`/clients/${id}/employees/new`} className="btn btn-primary">+ Add Employee</Link>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <span>⚠</span> {error}
          </div>
        )}

        {employees.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
            <h3 style={{ marginBottom: 8 }}>No employees yet</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
              Add employees to enable per-employee payroll tracking, W-2 generation, and accurate FUTA/SUTA reporting.
            </p>
            <Link to={`/clients/${id}/employees/new`} className="btn btn-primary">Add First Employee</Link>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
                  {['Employee', 'Work State', 'Pay Type', 'Rate', 'Frequency', 'Filing Status', 'Hire Date', 'Status', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <Link to={`/clients/${id}/employees/${emp.id}`} style={{ textDecoration: 'none' }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 14 }}>{emp.fullName}</div>
                      </Link>
                      {emp.hasSSN && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>SSN on file</div>}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }}>{emp.workState || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{emp.payType}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                      {emp.payType === 'hourly'
                        ? `$${Number(emp.hourlyRate || 0).toFixed(2)}/hr`
                        : emp.annualSalary > 0 ? `$${Number(emp.annualSalary).toLocaleString()}/yr` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{emp.payFrequency}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {{ single: 'Single / MFS', married: 'Married / QSS', hoh: 'Head of Household' }[emp.filingStatus] || emp.filingStatus}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{fmtDate(emp.hireDate)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span className={`badge badge-${emp.isActive ? 'success' : 'neutral'}`}>
                        {emp.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                      <Link to={`/clients/${id}/employees/${emp.id}/edit`} className="btn btn-secondary btn-sm" style={{ marginRight: 8 }}>Edit</Link>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(emp)}
                        disabled={deleting === emp.id}
                      >
                        {deleting === emp.id ? <span className="spinner" /> : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
