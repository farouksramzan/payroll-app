import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function fmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ClientDashboard() {
  const { user, logout } = useAuth();

  const [clientInfo, setClientInfo] = useState(null);
  const [summary,    setSummary]    = useState(null);
  const [employees,  setEmployees]  = useState([]);
  const [paystubs,   setPaystubs]   = useState([]);
  const [tab,        setTab]        = useState('overview');
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [codeCopied, setCodeCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getClientPortalMe(),
      api.getClientPortalSummary(),
      api.getClientPortalEmployees(),
      api.getClientPortalPaystubs(),
    ])
      .then(([me, s, e, p]) => { setClientInfo(me); setSummary(s); setEmployees(e); setPaystubs(p); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function copyJoinCode() {
    if (clientInfo?.joinCode) {
      navigator.clipboard.writeText(clientInfo.joinCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36 }} />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>

      {/* Nav */}
      <div style={{
        height: 'var(--nav-h)', background: 'var(--accent)',
        display: 'flex', alignItems: 'center', padding: '0 28px',
        gap: 16, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.4px' }}>
          Payroll<span style={{ color: '#7ca4e0' }}>Tax</span> Pro
        </div>
        {clientInfo?.businessName && (
          <>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18 }}>|</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{clientInfo.businessName}</div>
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>{user?.email || user?.username}</span>
        <button
          onClick={logout}
          style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '6px 14px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, maxWidth: 960, margin: '0 auto', width: '100%', padding: '28px 24px' }}>

        {error && (
          <div style={{ background: 'var(--error-light)', border: '1px solid var(--error)', borderRadius: 6, padding: '10px 16px', marginBottom: 20, fontSize: 13, color: 'var(--error)' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px', margin: 0 }}>Company Dashboard</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>Manage your employees and view payroll records.</p>
        </div>

        {/* Summary cards */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
            <StatCard value={summary.employeeCount} label="Total Employees" color="var(--accent)" />
            <StatCard value={summary.invitedCount} label="Portal Access" color="var(--success)" />
            <StatCard
              value={summary.latestPayrollYear ? `Q${summary.latestPayrollQ} ${summary.latestPayrollYear}` : '—'}
              label="Latest Payroll"
              color="var(--text-primary)"
              mono
            />
            <StatCard value={summary.employeeCount - summary.invitedCount} label="Not Yet Invited" color="var(--warning)" />
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'var(--bg-tertiary)', borderRadius: 8, padding: 3, width: 'fit-content' }}>
          {[['overview', 'Overview'], ['employees', 'Employees'], ['paystubs', 'Pay Records']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: tab === k ? '#fff' : 'transparent',
                boxShadow: tab === k ? 'var(--shadow)' : 'none',
                fontWeight: tab === k ? 700 : 500,
                fontSize: 13, color: tab === k ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === 'overview' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
              <span className="card-title">Recent Pay Records</span>
            </div>
            {paystubs.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                No payroll records yet.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                    {['Employee', 'Period', 'Gross Pay', 'Net Pay'].map(h => (
                      <th key={h} style={{ padding: '10px 18px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paystubs.slice(0, 10).map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 600 }}>{p.first_name} {p.last_name}</td>
                      <td style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text-muted)' }}>Q{p.tax_quarter} {p.tax_year}</td>
                      <td style={{ padding: '12px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.gross_wages)}</td>
                      <td style={{ padding: '12px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{fmt(p.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Employees tab */}
        {tab === 'employees' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Join code card */}
            {clientInfo?.joinCode && (
              <div className="card" style={{ borderLeft: '4px solid var(--accent)', padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Employee Join Code</div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px', maxWidth: 500 }}>
                      Share this code with employees so they can create a portal account. They go to the login page, click "Employee" tab, then "Create account with join code."
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        fontSize: 24, fontWeight: 800, letterSpacing: '0.25em',
                        color: 'var(--accent)', background: 'var(--accent-light)',
                        padding: '8px 18px', borderRadius: 8, border: '2px solid rgba(45,106,79,0.2)',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        {clientInfo.joinCode}
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={copyJoinCode}
                        style={{ minWidth: 64 }}
                      >
                        {codeCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Employee list */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="card-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
                <span className="card-title">Employees ({employees.length})</span>
              </div>
              {employees.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                  No employees found.
                </div>
              ) : (
                employees.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border-light)', gap: 14 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'var(--accent-light)', color: 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, flexShrink: 0,
                    }}>
                      {(e.firstName?.[0] || '?')}{(e.lastName?.[0] || '')}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{e.firstName} {e.lastName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {e.portalEmail || 'No portal email'} · {e.payType === 'hourly' ? `$${(e.payRate || 0).toFixed(2)}/hr` : `$${(e.payRate || 0).toLocaleString()}/yr`}
                      </div>
                    </div>
                    {e.hasPortalAccess
                      ? <span className="badge badge-success">Portal Active</span>
                      : <span className="badge badge-neutral">No Access</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Pay Records tab */}
        {tab === 'paystubs' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
              <span className="card-title">All Pay Records</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{paystubs.length} records</span>
            </div>
            {paystubs.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                No pay records yet.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                    {['Employee', 'Period', 'Gross Pay', 'Federal Tax', 'Net Pay'].map(h => (
                      <th key={h} style={{ padding: '10px 18px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paystubs.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border-light)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 600 }}>{p.first_name} {p.last_name}</td>
                      <td style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text-muted)' }}>Q{p.tax_quarter} {p.tax_year}</td>
                      <td style={{ padding: '12px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.gross_wages)}</td>
                      <td style={{ padding: '12px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.fit_withholding)}</td>
                      <td style={{ padding: '12px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{fmt(p.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

function StatCard({ value, label, color, mono }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '20px 16px' }}>
      <div style={{
        fontSize: 28, fontWeight: 900,
        color: color || 'var(--text-primary)',
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        lineHeight: 1, marginBottom: 8,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</div>
    </div>
  );
}
