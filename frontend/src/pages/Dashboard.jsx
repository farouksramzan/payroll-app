import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

const ISSUED = new Set(['printed', 'deposited']);
const todayStr = () => new Date().toISOString().slice(0, 10);

// ── Merged liabilities panel ───────────────────────────────────────────────────
function MultiLiabPanel({ clientIds, clients }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const prevIds = useRef('');

  useEffect(() => {
    const key = [...clientIds].sort().join(',');
    if (key === prevIds.current) return;
    prevIds.current = key;

    if (clientIds.length === 0) { setRows([]); return; }
    setLoading(true);
    Promise.all(clientIds.map(id => api.getPaystubs(id).then(stubs => ({ id, stubs }))))
      .then(results => {
        const today = todayStr();
        const merged = [];
        results.forEach(({ id, stubs }) => {
          const client = clients.find(c => c.id === id);
          stubs
            .filter(s => ISSUED.has(s.check_status) && (s.status === 'pending' || s.status === 'processing' || s.status === 'failed'))
            .forEach(s => {
              merged.push({
                ...s,
                _clientName: client?.businessName || '—',
                _clientId:   id,
                _due:        s.settlement_due_date || null,
                _late:       s.settlement_due_date ? today > s.settlement_due_date : false,
              });
            });
        });
        merged.sort((a, b) => (a._due || 'zzzz').localeCompare(b._due || 'zzzz'));
        setRows(merged);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientIds, clients]);

  const total = rows.reduce((s, r) => s + (r.total_deposit || 0), 0);

  return (
    <div className="card" style={{ marginTop: 20, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>
          Pending 941 Liabilities — {clientIds.length} {clientIds.length === 1 ? 'company' : 'companies'}
        </div>
        {loading && <span className="spinner spinner-dark" style={{ width: 14, height: 14 }} />}
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 16, color: 'var(--accent)' }}>
          {fmt(total)}
        </div>
      </div>

      {!loading && rows.length === 0 && (
        <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No pending 941 liabilities for selected {clientIds.length === 1 ? 'company' : 'companies'}.
        </div>
      )}

      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Company</th>
              <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Employee</th>
              <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Period</th>
              <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>941 Deposit</th>
              <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}
                style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => window.open(`/clients/${r._clientId}?tab=liabilities`, '_self')}>
                <td style={{ padding: '8px 14px', fontWeight: 600 }}>{r._clientName}</td>
                <td style={{ padding: '8px 14px' }}>{r.employee_name || '—'}</td>
                <td style={{ padding: '8px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                  {fmtDate(r.pay_period_start)} – {fmtDate(r.pay_period_end)}
                </td>
                <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                  {fmt(r.total_deposit)}
                </td>
                <td style={{ padding: '8px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: r._late ? '#dc2626' : r._due ? '#d97706' : 'var(--text-muted)', fontWeight: r._late ? 700 : 400 }}>
                  {r._due ? (r._late ? '⚠ ' : '') + fmtDate(r._due) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
              <td colSpan={3} style={{ padding: '10px 14px', fontWeight: 700, fontSize: 12 }}>Total</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 14, color: 'var(--accent)' }}>{fmt(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [clients, setClients]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [view, setView]         = useState(() => localStorage.getItem('dashView') || 'tiles');
  const [selected, setSelected] = useState(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    api.getClients().then(setClients).finally(() => setLoading(false));
  }, []);

  function switchView(v) {
    setView(v);
    setSelected(new Set());
    localStorage.setItem('dashView', v);
  }

  async function handleDelete(e, client) {
    e.stopPropagation();
    if (!window.confirm(`Delete ${client.businessName}? This cannot be undone.`)) return;
    setDeleting(client.id);
    try {
      await api.deleteClient(client.id);
      setClients(c => c.filter(x => x.id !== client.id));
      setSelected(prev => { const n = new Set(prev); n.delete(client.id); return n; });
    } catch (err) { alert(err.message); }
    finally { setDeleting(null); }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const allSelected = clients.length > 0 && clients.every(c => selected.has(c.id));

  return (
    <div className="dash-page">
      <div className="dash-header">
        <div>
          <div className="dash-title">Your Companies</div>
          <div className="dash-subtitle">{clients.length} {clients.length === 1 ? 'company' : 'companies'} on file</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* View toggle */}
          {clients.length > 0 && (
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
              <button
                onClick={() => switchView('tiles')}
                title="Tile view"
                style={{ padding: '5px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                  background: view === 'tiles' ? '#fff' : 'transparent',
                  color: view === 'tiles' ? 'var(--accent)' : 'var(--text-muted)',
                  boxShadow: view === 'tiles' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                ⊞
              </button>
              <button
                onClick={() => switchView('list')}
                title="List view"
                style={{ padding: '5px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                  background: view === 'list' ? '#fff' : 'transparent',
                  color: view === 'list' ? 'var(--accent)' : 'var(--text-muted)',
                  boxShadow: view === 'list' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                ☰
              </button>
            </div>
          )}
          <Link to="/clients/new" className="btn btn-primary">+ Add Company</Link>
        </div>
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
      ) : view === 'tiles' ? (
        /* ── Tile view ── */
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
      ) : (
        /* ── List view ── */
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* List header */}
            <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 160px 120px 90px 80px 40px', alignItems: 'center', padding: '9px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', gap: 8 }}>
              <div>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={e => setSelected(e.target.checked ? new Set(clients.map(c => c.id)) : new Set())}
                  style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
                />
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Company</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next Payroll</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Schedule</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>State</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</div>
              <div />
            </div>

            {/* List rows */}
            {clients.map((client, i) => {
              const ps = payrollStatus(client.nextPayrollDate);
              const isSel = selected.has(client.id);
              return (
                <div
                  key={client.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px 1fr 160px 120px 90px 80px 40px',
                    alignItems: 'center',
                    padding: '10px 16px',
                    gap: 8,
                    background: isSel ? 'var(--accent-light)' : i % 2 === 0 ? '#fff' : '#f8fafc',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onClick={() => navigate(`/clients/${client.id}`)}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#f1f5f9'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isSel ? 'var(--accent-light)' : i % 2 === 0 ? '#fff' : '#f8fafc'; }}
                >
                  {/* Checkbox — stops row click propagation */}
                  <div onClick={e => { e.stopPropagation(); toggleSelect(client.id); }}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelect(client.id)}
                      style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
                    />
                  </div>

                  {/* Name + EIN */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: 'var(--accent-light)', color: 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800,
                    }}>
                      {initials(client.businessName)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client.businessName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{client.ein}</div>
                    </div>
                    {client.overdueAmount > 0 && (
                      <span className="badge badge-error" style={{ fontSize: 10, flexShrink: 0 }}>Overdue</span>
                    )}
                  </div>

                  {/* Next payroll */}
                  <div style={{ fontSize: 13, color: ps ? '#d97706' : 'var(--text-secondary)', fontWeight: ps ? 600 : 400 }}>
                    {client.nextPayrollDate ? fmtDate(client.nextPayrollDate) : '—'}
                  </div>

                  {/* Deposit schedule */}
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                    {client.depositSchedule || '—'}
                  </div>

                  {/* State */}
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {client.state || 'TX'}
                  </div>

                  {/* Payroll status badge */}
                  <div>
                    {ps
                      ? <span className={`badge ${ps.cls}`} style={{ fontSize: 10 }}>{ps.label}</span>
                      : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                  </div>

                  {/* Delete */}
                  <div onClick={e => e.stopPropagation()}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={e => handleDelete(e, client)}
                      disabled={deleting === client.id}
                      style={{ opacity: 0.35, fontSize: 13, padding: '3px 6px' }}
                      title="Delete"
                    >
                      {deleting === client.id ? <span className="spinner spinner-dark" style={{ width: 11, height: 11 }} /> : '✕'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selection info + merged liabilities */}
          {selected.size > 0 && (
            <>
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{selected.size} {selected.size === 1 ? 'company' : 'companies'} selected</span>
                <button
                  onClick={() => setSelected(new Set())}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, padding: 0, fontWeight: 600 }}>
                  Clear
                </button>
              </div>
              <MultiLiabPanel clientIds={[...selected]} clients={clients} />
            </>
          )}
        </>
      )}
    </div>
  );
}
