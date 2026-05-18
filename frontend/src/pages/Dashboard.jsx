import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function fmtDate(d) {
  if (!d) return null;
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function payrollStatus(nextPayrollDate) {
  if (!nextPayrollDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(nextPayrollDate + 'T00:00:00');
  const days = Math.ceil((due - today) / 86400000);
  if (days < 0)  return { label: 'Payroll overdue',    cls: 'badge-error' };
  if (days === 0) return { label: 'Payroll due today',  cls: 'badge-warning' };
  if (days <= 5)  return { label: `Payroll in ${days}d`, cls: 'badge-warning' };
  return null;
}

function initials(name) {
  return name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
}

export default function Dashboard() {
  const [clients, setClients]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [deleting, setDeleting] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.getClients().then(setClients).finally(() => setLoading(false));
  }, []);

  async function handleDelete(e, client) {
    e.stopPropagation();
    if (!window.confirm(`Delete ${client.businessName}? This cannot be undone.`)) return;
    setDeleting(client.id);
    try {
      await api.deleteClient(client.id);
      setClients(c => c.filter(x => x.id !== client.id));
    } catch (err) { alert(err.message); }
    finally { setDeleting(null); }
  }

  return (
    <div className="dash-page">
      <div className="dash-header">
        <div>
          <div className="dash-title">Your Companies</div>
          <div className="dash-subtitle">{clients.length} {clients.length === 1 ? 'company' : 'companies'} on file</div>
        </div>
        <Link to="/clients/new" className="btn btn-primary">+ Add Company</Link>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <div className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
        </div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏢</div>
          <h3>No companies yet</h3>
          <p>Add your first company to start managing payroll and tax submissions.</p>
          <Link to="/clients/new" className="btn btn-primary">Add Company</Link>
        </div>
      ) : (
        <div className="company-grid">
          {clients.map(client => {
            const ps = payrollStatus(client.nextPayrollDate);
            return (
              <div
                key={client.id}
                className="company-tile"
                onClick={() => navigate(`/clients/${client.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/clients/${client.id}`)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10,
                    background: 'var(--accent-light)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 800, flexShrink: 0,
                  }}>
                    {initials(client.businessName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tile-name">{client.businessName}</div>
                    <div className="tile-ein">EIN: {client.ein}</div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={e => handleDelete(e, client)}
                    disabled={deleting === client.id}
                    style={{ flexShrink: 0, opacity: 0.4, fontSize: 14, padding: '4px 7px' }}
                    title="Delete"
                  >
                    {deleting === client.id ? <span className="spinner spinner-dark" style={{ width: 12, height: 12 }} /> : '✕'}
                  </button>
                </div>

                {client.overdueAmount > 0 && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#dc2626', fontSize: 14 }}>⚠</span>
                    <div>
                      <div style={{ color: '#dc2626', fontWeight: 700, fontSize: 13 }}>Tax Deposit Overdue</div>
                      <div style={{ color: '#dc2626', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600 }}>
                        ${Number(client.overdueAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="tile-badges">
                  {ps && <span className={`badge ${ps.cls}`}>{ps.label}</span>}
                  <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>{client.payrollFrequency || 'biweekly'}</span>
                  <span className="badge badge-neutral">{client.state || 'TX'}</span>
                </div>

                <div className="tile-meta">
                  {client.nextPayrollDate && (
                    <div className="tile-meta-row">
                      <span className="tile-meta-label">Next payroll</span>
                      <span className="tile-meta-value">{fmtDate(client.nextPayrollDate)}</span>
                    </div>
                  )}
                  <div className="tile-meta-row">
                    <span className="tile-meta-label">Deposit schedule</span>
                    <span className="tile-meta-value" style={{ textTransform: 'capitalize' }}>{client.depositSchedule}</span>
                  </div>
                  {client.lastSubmissionDate && (
                    <div className="tile-meta-row">
                      <span className="tile-meta-label">Last submission</span>
                      <span className="tile-meta-value">{fmtDate(client.lastSubmissionDate)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
