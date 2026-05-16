import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
      <span className={mono ? 'mono' : ''} style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>
        {value || '—'}
      </span>
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [recentSubs,    setRecentSubs]    = useState([]);
  const [pendingStubs,  setPendingStubs]  = useState([]);
  const [employees,     setEmployees]     = useState([]);
  const [ytdMap,        setYtdMap]        = useState({});
  const [loading, setLoading] = useState(true);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    Promise.all([
      api.getClient(id),
      api.getSubmissions(id),
      api.getPaystubs(id),
      api.getEmployees(id),
      api.getEmployeeYTDBatch(id, currentYear),
    ])
      .then(([c, subs, stubs, emps, ytdRows]) => {
        setClient(c);
        setRecentSubs(subs.slice(0, 5));
        setPendingStubs(stubs.filter((s) => s.status === 'pending' || s.status === 'failed'));
        setEmployees(emps);
        const map = {};
        ytdRows.forEach((y) => { map[y.employee_id] = y; });
        setYtdMap(map);
      })
      .catch((err) => { alert(err.message); navigate('/'); })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
    </div>
  );

  if (!client) return null;

  function fmtAmt(n) {
    return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function statusBadge(s) {
    if (s === 'submitted') return <span className="badge badge-success">Submitted</span>;
    if (s === 'dry_run') return <span className="badge badge-accent">Dry Run</span>;
    if (s === 'failed') return <span className="badge badge-error">Failed</span>;
    if (s === 'processing') return <span className="badge badge-warning">Processing</span>;
    return <span className="badge badge-neutral">Pending</span>;
  }

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/">Dashboard</Link>
          <span>/</span>
          <span>{client.businessName}</span>
        </div>
        <div className="page-header-row">
          <div>
            <h2>{client.businessName}</h2>
            <p className="mono" style={{ fontSize: 13, marginTop: 4 }}>EIN: {client.ein}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to={`/clients/${id}/payroll/new`} className="btn btn-primary">
              + New Payroll Entry
            </Link>
            <Link to={`/clients/${id}/paystubs`} className="btn btn-secondary">Paystubs{pendingStubs.length > 0 ? ` (${pendingStubs.length} pending)` : ''}</Link>
            <Link to={`/clients/${id}/employees`} className="btn btn-secondary">Employees</Link>
            <Link to={`/clients/${id}/edit`} className="btn btn-secondary">Edit</Link>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Client Info */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Client Information</span>
          </div>
          <InfoRow label="Business Name" value={client.businessName} />
          <InfoRow label="EIN" value={client.ein} mono />
          <InfoRow label="State" value={client.state || 'TX'} />
          <InfoRow label="Deposit Schedule" value={client.depositSchedule.charAt(0).toUpperCase() + client.depositSchedule.slice(1)} />
          <InfoRow label="Batch Provider PIN" value={client.hasBatchProviderPin ? '••••  (encrypted)' : 'Not set'} />
          <InfoRow label="Bank Account" value={client.hasBankAccount ? '••••••  (encrypted)' : 'Not set'} />
          <InfoRow label="Routing Number" value={client.bankRoutingNumber} mono />
          <InfoRow label="Account Type" value={client.bankAccountType} />
        </div>

        {/* Contact Info */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Contact</span>
          </div>
          <InfoRow label="Contact Name" value={client.contactName} />
          <InfoRow label="Email" value={client.contactEmail} />
          <InfoRow label="Phone" value={client.contactPhone} />
          <InfoRow label="Added" value={client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '—'} />
          <InfoRow label="Last Updated" value={client.updatedAt ? new Date(client.updatedAt).toLocaleDateString() : '—'} />
        </div>

        {/* Employees */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <span className="card-title">Employees</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link to={`/clients/${id}/employees/new`} className="btn btn-primary btn-sm">+ Add Employee</Link>
              <Link to={`/clients/${id}/employees`} className="btn btn-secondary btn-sm">Manage</Link>
            </div>
          </div>
          {employees.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 20px' }}>
              <div className="empty-state-icon">👤</div>
              <h3>No employees yet</h3>
              <p>Add employees to run payroll and track paystubs per person.</p>
              <Link to={`/clients/${id}/employees/new`} className="btn btn-primary">Add Employee</Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, padding: '16px 20px' }}>
              {employees.map((emp) => {
                const ytd = ytdMap[emp.id];
                const rate = emp.payType === 'hourly'
                  ? `$${Number(emp.hourlyRate).toFixed(2)}/hr`
                  : `$${Number(emp.annualSalary).toLocaleString()}/yr`;
                return (
                  <Link
                    key={emp.id}
                    to={`/clients/${id}/employees/${emp.id}`}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div style={{
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: '14px 16px',
                      background: 'var(--bg-secondary)',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                      cursor: 'pointer',
                    }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>{emp.fullName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, display: 'flex', gap: 10 }}>
                        <span style={{ textTransform: 'capitalize' }}>{emp.payType}</span>
                        <span>·</span>
                        <span>{emp.payFrequency}</span>
                        <span>·</span>
                        <span>{emp.workState || emp.state || 'TX'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Rate</div>
                          <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{rate}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{currentYear} YTD Gross</div>
                          <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                            ${Number(ytd?.ytd_gross || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                      </div>
                      {!emp.isActive && (
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Inactive</div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Paystubs quick card */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <span className="card-title">Paystubs</span>
            <Link to={`/clients/${id}/paystubs`} className="btn btn-secondary btn-sm">View All</Link>
          </div>
          {pendingStubs.length === 0 ? (
            <div style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No pending paystubs. Save a payroll entry as a paystub to build a batch queue.</span>
              <Link to={`/clients/${id}/payroll/new`} className="btn btn-secondary btn-sm">New Payroll Entry</Link>
            </div>
          ) : (
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--warning)', fontFamily: 'JetBrains Mono, monospace', marginRight: 8 }}>
                  {pendingStubs.length}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  pending paystub{pendingStubs.length !== 1 ? 's' : ''} · total deposit{' '}
                  <strong style={{ color: 'var(--accent)' }}>
                    {fmtAmt(pendingStubs.reduce((s, p) => s + (p.total_deposit || 0), 0))}
                  </strong>
                </span>
              </div>
              <Link to={`/clients/${id}/paystubs`} className="btn btn-success btn-sm">
                Submit All Pending →
              </Link>
            </div>
          )}
        </div>

        {/* Recent submissions */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <span className="card-title">Recent Submissions</span>
            <Link to={`/clients/${id}/submissions`} className="btn btn-secondary btn-sm">View All</Link>
          </div>
          {recentSubs.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-icon">📄</div>
              <h3>No submissions yet</h3>
              <p>Create a payroll entry to start submitting deposits.</p>
              <Link to={`/clients/${id}/payroll/new`} className="btn btn-primary">New Payroll Entry</Link>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Pay Period</th>
                    <th>Gross Wages</th>
                    <th>FIT Withholding</th>
                    <th>SS + Medicare</th>
                    <th>Total Deposit</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSubs.map((s) => (
                    <tr key={s.id}>
                      <td className="mono" style={{ fontSize: 12 }}>{s.pay_period_start} – {s.pay_period_end}</td>
                      <td className="amount">{fmtAmt(s.gross_wages)}</td>
                      <td className="amount">{fmtAmt(s.fit_withholding)}</td>
                      <td className="amount">{fmtAmt(s.employee_ss + s.employee_medicare + s.employer_ss + s.employer_medicare)}</td>
                      <td className="amount" style={{ color: 'var(--accent)' }}>{fmtAmt(s.total_deposit)}</td>
                      <td>{statusBadge(s.eftps_status)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{new Date(s.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
