import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
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

function fmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusBadge(s) {
  if (s === 'submitted') return <span className="badge badge-success">Submitted</span>;
  if (s === 'dry_run')   return <span className="badge badge-accent">Dry Run</span>;
  if (s === 'failed')    return <span className="badge badge-error">Failed</span>;
  if (s === 'processing') return <span className="badge badge-warning">Processing</span>;
  return <span className="badge badge-neutral">Pending</span>;
}

const TAB_STYLE = (active) => ({
  padding: '12px 24px',
  border: 'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  background: 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  fontWeight: active ? 700 : 400,
  cursor: 'pointer',
  fontSize: 14,
  transition: 'color 0.15s',
});

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [client,       setClient]       = useState(null);
  const [recentSubs,   setRecentSubs]   = useState([]);
  const [pendingStubs, setPendingStubs] = useState([]);
  const [employees,    setEmployees]    = useState([]);
  const [ytdMap,       setYtdMap]       = useState({});
  const [loading,      setLoading]      = useState(true);
  const [activeTab,    setActiveTab]    = useState(location.state?.tab || 'overview');
  const [pinInput,     setPinInput]     = useState('');
  const [pinSaving,    setPinSaving]    = useState(false);
  const [pinMsg,       setPinMsg]       = useState(null);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    // Load critical data first; employees + YTD are best-effort so a missing
    // backend endpoint won't redirect the whole page away.
    Promise.all([
      api.getClient(id),
      api.getSubmissions(id),
      api.getPaystubs(id),
    ])
      .then(([c, subs, stubs]) => {
        setClient(c);
        setRecentSubs(subs.slice(0, 10));
        setPendingStubs(stubs.filter((s) => s.status === 'pending' || s.status === 'failed'));
        // Load employees + YTD in parallel but don't let failures blow up the page
        return Promise.all([
          api.getEmployees(id).catch(() => []),
          api.getEmployeeYTDBatch(id, currentYear).catch(() => []),
        ]);
      })
      .then(([emps, ytdRows]) => {
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

  const payRate = (emp) => emp.payType === 'hourly'
    ? `$${Number(emp.hourlyRate).toFixed(2)}/hr`
    : `$${Number(emp.annualSalary).toLocaleString()}/yr`;

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
            <Link to={`/clients/${id}/payroll/new`} className="btn btn-primary">+ New Payroll Entry</Link>
            <Link to={`/clients/${id}/paystubs`} className="btn btn-secondary">
              Paystubs{pendingStubs.length > 0 ? ` (${pendingStubs.length} pending)` : ''}
            </Link>
            <Link to={`/clients/${id}/edit`} className="btn btn-secondary">Edit</Link>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)', paddingLeft: 32 }}>
        <button style={TAB_STYLE(activeTab === 'overview')} onClick={() => setActiveTab('overview')}>Overview</button>
        <button style={TAB_STYLE(activeTab === 'employees')} onClick={() => setActiveTab('employees')}>
          Employees{employees.length > 0 ? ` (${employees.length})` : ''}
        </button>
        <button style={TAB_STYLE(activeTab === 'payroll')} onClick={() => setActiveTab('payroll')}>Payroll History</button>
      </div>

      <div className="page-body">

        {/* ── OVERVIEW TAB ─────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            <div className="card">
              <div className="card-header"><span className="card-title">Client Information</span></div>
              <InfoRow label="Business Name" value={client.businessName} />
              <InfoRow label="EIN" value={client.ein} mono />
              <InfoRow label="State" value={client.state || 'TX'} />
              <InfoRow label="Deposit Schedule" value={client.depositSchedule.charAt(0).toUpperCase() + client.depositSchedule.slice(1)} />
              <InfoRow label="Bank Account" value={client.hasBankAccount ? '••••••  (encrypted)' : 'Not set'} />
              <InfoRow label="Routing Number" value={client.bankRoutingNumber} mono />
              <InfoRow label="Account Type" value={client.bankAccountType} />
            </div>

            <div className="card">
              <div className="card-header"><span className="card-title">Contact</span></div>
              <InfoRow label="Contact Name" value={client.contactName} />
              <InfoRow label="Email" value={client.contactEmail} />
              <InfoRow label="Phone" value={client.contactPhone} />
              <InfoRow label="Added" value={client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '—'} />
              <InfoRow label="Last Updated" value={client.updatedAt ? new Date(client.updatedAt).toLocaleDateString() : '—'} />
            </div>

            {/* EFTPS PIN — admin only, not shown to clients */}
            <div className="card" style={{ gridColumn: '1 / -1', padding: '14px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>EFTPS Enrollment PIN</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{client.hasBatchProviderPin ? '•••• set' : 'not set'} · enrolled: {client.eftpsEnrolled ? 'yes' : 'no'}</span>
                <input
                  type="text" inputMode="numeric" maxLength={4} placeholder="4-digit PIN"
                  value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  style={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: 4, width: 90, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 16, textAlign: 'center' }}
                />
                <button
                  disabled={pinSaving || pinInput.length !== 4}
                  onClick={async () => {
                    setPinSaving(true); setPinMsg(null);
                    try {
                      await api.updateClientPin(id, pinInput);
                      setPinMsg({ ok: true, text: 'PIN saved ✓' });
                      setPinInput('');
                      const updated = await api.getClient(id);
                      setClient(updated);
                    } catch (e) { setPinMsg({ ok: false, text: e.message }); }
                    finally { setPinSaving(false); }
                  }}
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: 13 }}
                >
                  {pinSaving ? '...' : 'Save PIN'}
                </button>
                {pinMsg && <span style={{ fontSize: 12, color: pinMsg.ok ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{pinMsg.text}</span>}
              </div>
            </div>

            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div className="card-header">
                <span className="card-title">Pending Paystubs</span>
                <Link to={`/clients/${id}/paystubs`} className="btn btn-secondary btn-sm">View All Paystubs</Link>
              </div>
              {pendingStubs.length === 0 ? (
                <div style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No pending paystubs.</span>
                  <Link to={`/clients/${id}/payroll/new`} className="btn btn-secondary btn-sm">New Payroll Entry</Link>
                </div>
              ) : (
                <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--warning)', fontFamily: 'JetBrains Mono, monospace', marginRight: 8 }}>
                      {pendingStubs.length}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      pending paystub{pendingStubs.length !== 1 ? 's' : ''} · total deposit{' '}
                      <strong style={{ color: 'var(--accent)' }}>
                        {fmt(pendingStubs.reduce((s, p) => s + (p.total_deposit || 0), 0))}
                      </strong>
                    </span>
                  </div>
                  <Link to={`/clients/${id}/paystubs`} className="btn btn-success btn-sm">Submit All Pending →</Link>
                </div>
              )}
            </div>

          </div>
        )}

        {/* ── EMPLOYEES TAB ────────────────────────────────────────── */}
        {activeTab === 'employees' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Link to={`/clients/${id}/employees/new`} className="btn btn-primary">+ Add Employee</Link>
            </div>

            {employees.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
                <h3 style={{ marginBottom: 8 }}>No employees yet</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Add employees to track payroll per person.</p>
                <Link to={`/clients/${id}/employees/new`} className="btn btn-primary">Add First Employee</Link>
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
                      {['Name', 'Pay Type', 'Pay Rate', 'Work State', `${currentYear} YTD Gross`, ''].map((h) => (
                        <th key={h} style={{ padding: '11px 18px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr
                        key={emp.id}
                        style={{ borderBottom: '1px solid var(--border-light)', cursor: 'pointer', transition: 'background 0.1s' }}
                        onClick={() => navigate(`/clients/${id}/employees/${emp.id}`)}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-primary)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent)' }}>{emp.fullName}</div>
                          {!emp.isActive && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Inactive</div>}
                        </td>
                        <td style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{emp.payType}</td>
                        <td style={{ padding: '14px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{payRate(emp)}</td>
                        <td style={{ padding: '14px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{emp.workState || emp.state || 'TX'}</td>
                        <td style={{ padding: '14px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                          {fmt(ytdMap[emp.id]?.ytd_gross || 0)}
                        </td>
                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>View →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── PAYROLL HISTORY TAB ──────────────────────────────────── */}
        {activeTab === 'payroll' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Link to={`/clients/${id}/submissions`} className="btn btn-secondary">View All Submissions</Link>
            </div>

            {recentSubs.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                <h3 style={{ marginBottom: 8 }}>No submissions yet</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Create a payroll entry to start submitting deposits.</p>
                <Link to={`/clients/${id}/payroll/new`} className="btn btn-primary">New Payroll Entry</Link>
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
                      {['Pay Period', 'Gross Wages', 'FIT Withholding', 'SS + Medicare', 'Total Deposit', 'Status', 'Date'].map((h) => (
                        <th key={h} style={{ padding: '11px 18px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentSubs.map((s) => (
                      <tr key={s.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td className="mono" style={{ padding: '12px 18px', fontSize: 12 }}>{s.pay_period_start} – {s.pay_period_end}</td>
                        <td className="amount" style={{ padding: '12px 18px' }}>{fmt(s.gross_wages)}</td>
                        <td className="amount" style={{ padding: '12px 18px' }}>{fmt(s.fit_withholding)}</td>
                        <td className="amount" style={{ padding: '12px 18px' }}>{fmt(s.employee_ss + s.employee_medicare + s.employer_ss + s.employer_medicare)}</td>
                        <td className="amount" style={{ padding: '12px 18px', color: 'var(--accent)', fontWeight: 600 }}>{fmt(s.total_deposit)}</td>
                        <td style={{ padding: '12px 18px' }}>{statusBadge(s.eftps_status)}</td>
                        <td style={{ padding: '12px 18px', color: 'var(--text-muted)', fontSize: 12 }}>{new Date(s.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </>
  );
}
