import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

// ── Date helpers (mirrors CompanyWorkspace) ────────────────────────────────────
const FEDERAL_HOLIDAYS = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-05-27','2024-06-19','2024-07-04',
  '2024-09-02','2024-10-14','2024-11-11','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19','2025-07-04',
  '2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03',
  '2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-19','2027-07-05',
  '2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24',
]);
function isBizDay(d) { const w = d.getDay(); return w !== 0 && w !== 6 && !FEDERAL_HOLIDAYS.has(d.toISOString().slice(0, 10)); }
function nextBizDay(d) { const r = new Date(d); while (!isBizDay(r)) r.setDate(r.getDate() + 1); return r; }

function calcIRSDepositDue(payDate, depositSchedule) {
  if (!payDate) return null;
  const d = new Date(payDate + 'T00:00:00'), dow = d.getDay();
  let due;
  if (depositSchedule === 'semiweekly') {
    if (dow >= 3 && dow <= 5) { const n = (3 - dow + 7) % 7 || 7; due = new Date(d); due.setDate(d.getDate() + n); }
    else { const n = (5 - dow + 7) % 7 || 7; due = new Date(d); due.setDate(d.getDate() + n); }
  } else {
    due = new Date(d.getFullYear(), d.getMonth() + 1, 15);
  }
  return nextBizDay(due).toISOString().slice(0, 10);
}

function calcFutaQuarterlyDue(payPeriodEnd) {
  if (!payPeriodEnd) return null;
  const d = new Date(payPeriodEnd + 'T00:00:00');
  const q = Math.ceil((d.getMonth() + 1) / 3);
  const qMons = [3, 6, 9, 0];
  const qDays = [30, 31, 31, 31];
  const qYear = q === 4 ? d.getFullYear() + 1 : d.getFullYear();
  return nextBizDay(new Date(qYear, qMons[q - 1], qDays[q - 1])).toISOString().slice(0, 10);
}

// ── Formatters ─────────────────────────────────────────────────────────────────
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

const LIAB_STATUS = {
  overdue:    { label: 'Tax Overdue', cls: 'badge-error',   title: 'Has overdue EFTPS deposits' },
  'due-soon': { label: 'Due Soon',    cls: 'badge-warning', title: 'EFTPS deposit due within 5 days' },
};

function LiabStatusBadge({ status }) {
  const cfg = LIAB_STATUS[status];
  if (!cfg) return null;
  return <span className={`badge ${cfg.cls}`} style={{ fontSize: 10 }} title={cfg.title}>{cfg.label}</span>;
}

const ISSUED = new Set(['printed', 'deposited']);

// ── Tax detail modal ───────────────────────────────────────────────────────────
function TaxDetailModal({ row, onClose }) {
  if (!row) return null;
  const DL = ({ label, value, accent, bold }) => (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: bold ? 800 : 600, fontSize: 13, color: accent || 'inherit' }}>{value}</div>
    </div>
  );
  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>{title}</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 580, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{row.employee_name || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {row._clientName} · {fmtDate(row.pay_period_start)} – {fmtDate(row.pay_period_end)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        <Section title="Earnings">
          <DL label="Gross Pay" value={fmt(row.gross_wages)} accent="var(--accent)" bold />
          {row.regular_hours != null && <DL label="Reg Hours" value={row.regular_hours} />}
          {row.regular_pay   != null && <DL label="Reg Pay"   value={fmt(row.regular_pay)} />}
          {row.overtime_hours > 0    && <DL label="OT Hours"  value={row.overtime_hours} />}
          {row.overtime_pay   > 0    && <DL label="OT Pay"    value={fmt(row.overtime_pay)} />}
          {row.bonus         > 0     && <DL label="Bonus"         value={fmt(row.bonus)} />}
          {row.commission    > 0     && <DL label="Commission"    value={fmt(row.commission)} />}
          {row.reimbursement > 0     && <DL label="Reimbursement" value={fmt(row.reimbursement)} />}
        </Section>

        <Section title="Employee Withholding">
          <DL label="Federal Income Tax" value={fmt(row.fit_withholding)} />
          <DL label="Social Security"    value={fmt(row.employee_ss)} />
          <DL label="Medicare"           value={fmt(row.employee_medicare)} />
          {row.state_income_tax > 0 && <DL label="State Income Tax" value={fmt(row.state_income_tax)} />}
        </Section>

        <Section title="Employer Taxes">
          <DL label="SS Match"     value={fmt(row.employer_ss)} />
          <DL label="Medicare Match" value={fmt(row.employer_medicare)} />
          {row.futa_tax > 0 && <DL label="FUTA (940)"  value={fmt(row.futa_tax)} />}
          {row.suta_tax > 0 && <DL label="SUI"         value={fmt(row.suta_tax)} />}
        </Section>

        <div style={{ display: 'flex', gap: 16, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, flexWrap: 'wrap' }}>
          <DL label="Gross Pay"   value={fmt(row.gross_wages)}    accent="var(--accent)" bold />
          <DL label="Net Pay"     value={fmt(row.net_pay)}        accent="var(--success, #16a34a)" bold />
          <DL label="941 Deposit" value={fmt(row.total_deposit)}  bold />
          {row.futa_tax > 0 && <DL label="940 FUTA" value={fmt(row.futa_tax)} bold />}
          {row.suta_tax > 0 && <DL label="SUI"      value={fmt(row.suta_tax)} bold />}
        </div>

        {(row._due941 || row._due940 || row._dueSUI) && (
          <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {row._due941 && <div style={{ fontSize: 12 }}><span style={{ color: 'var(--text-muted)' }}>941 Due: </span><span style={{ fontWeight: 600, color: row._late941 ? '#dc2626' : 'inherit' }}>{fmtDate(row._due941)}</span></div>}
            {row._due940 && <div style={{ fontSize: 12 }}><span style={{ color: 'var(--text-muted)' }}>940 Due: </span><span style={{ fontWeight: 600 }}>{fmtDate(row._due940)}</span></div>}
            {row._dueSUI && <div style={{ fontSize: 12 }}><span style={{ color: 'var(--text-muted)' }}>SUI Due: </span><span style={{ fontWeight: 600 }}>{fmtDate(row._dueSUI)}</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Merged liabilities panel ───────────────────────────────────────────────────
function MultiLiabPanel({ clientIds, clients }) {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const prevIds = useRef('');

  useEffect(() => {
    const key = [...clientIds].sort().join(',');
    if (key === prevIds.current) return;
    prevIds.current = key;

    if (clientIds.length === 0) { setRows([]); return; }
    setLoading(true);
    Promise.all(clientIds.map(id => api.getPaystubs(id).then(stubs => ({ id, stubs }))))
      .then(results => {
        const today = new Date().toISOString().slice(0, 10);
        const merged = [];
        results.forEach(({ id, stubs }) => {
          const client = clients.find(c => c.id === id);
          const schedule = client?.depositSchedule || 'monthly';

          stubs
            .filter(s => ISSUED.has(s.check_status))
            .forEach(s => {
              const refDate = s.settlement_date || s.pay_period_end;

              // 941 due date: use stored field, fall back to calculation
              const due941 = s.settlement_due_date || (refDate ? calcIRSDepositDue(refDate, schedule) : null);
              // 940 due date: quarterly
              const due940 = refDate ? calcFutaQuarterlyDue(refDate) : null;
              // SUI due date: same as 940 quarterly (common default)
              const dueSUI = due940;

              const pending941 = s.status     === 'pending' || s.status     === 'processing' || s.status     === 'failed';
              const pending940 = (s.status_940 === 'pending' || s.status_940 === 'processing' || s.status_940 === 'failed') && (s.futa_tax || 0) > 0;
              const pendingSUI = pending941 && (s.suta_tax || 0) > 0;

              if (!pending941 && !pending940 && !pendingSUI) return;

              merged.push({
                ...s,
                _clientName: client?.businessName || '—',
                _clientId:   id,
                _due941:     pending941 ? due941 : null,
                _due940:     pending940 ? due940 : null,
                _dueSUI:     pendingSUI ? dueSUI : null,
                _late941:    pending941 && due941 ? today > due941 : false,
                _late940:    pending940 && due940 ? today > due940 : false,
                _lateSUI:    pendingSUI && dueSUI ? today > dueSUI : false,
                _pending941: pending941,
                _pending940: pending940,
                _pendingSUI: pendingSUI,
              });
            });
        });
        merged.sort((a, b) => {
          const aMin = [a._due941, a._due940, a._dueSUI].filter(Boolean).sort()[0] || 'zzzz';
          const bMin = [b._due941, b._due940, b._dueSUI].filter(Boolean).sort()[0] || 'zzzz';
          return aMin.localeCompare(bMin);
        });
        setRows(merged);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientIds, clients]);

  const total941 = rows.filter(r => r._pending941).reduce((s, r) => s + (r.total_deposit || 0), 0);
  const total940 = rows.filter(r => r._pending940).reduce((s, r) => s + (r.futa_tax || 0), 0);
  const totalSUI = rows.filter(r => r._pendingSUI).reduce((s, r) => s + (r.suta_tax || 0), 0);
  const grandTotal = total941 + total940 + totalSUI;

  const DueCell = ({ due, late }) => (
    <td style={{ padding: '7px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
      color: late ? '#dc2626' : due ? '#d97706' : 'var(--text-muted)', fontWeight: late ? 700 : 400 }}>
      {due ? (late ? '⚠ ' : '') + fmtDate(due) : '—'}
    </td>
  );

  return (
    <>
      {detailRow && <TaxDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
      <div className="card" style={{ marginTop: 20, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '13px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>
            Pending Liabilities — {clientIds.length} {clientIds.length === 1 ? 'company' : 'companies'}
          </div>
          {loading && <span className="spinner spinner-dark" style={{ width: 14, height: 14 }} />}
          <div style={{ display: 'flex', gap: 20 }}>
            {total941 > 0 && <div style={{ fontSize: 12, textAlign: 'right' }}><div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>941</div><div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: 'var(--accent)' }}>{fmt(total941)}</div></div>}
            {total940 > 0 && <div style={{ fontSize: 12, textAlign: 'right' }}><div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>940</div><div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: 'var(--accent)' }}>{fmt(total940)}</div></div>}
            {totalSUI > 0 && <div style={{ fontSize: 12, textAlign: 'right' }}><div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>SUI</div><div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: 'var(--accent)' }}>{fmt(totalSUI)}</div></div>}
            <div style={{ fontSize: 12, textAlign: 'right', borderLeft: '1px solid var(--border)', paddingLeft: 16 }}><div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total</div><div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 15, color: 'var(--accent)' }}>{fmt(grandTotal)}</div></div>
          </div>
        </div>

        {!loading && rows.length === 0 && (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No pending liabilities for selected {clientIds.length === 1 ? 'company' : 'companies'}.
          </div>
        )}

        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                {['Company', 'Employee', 'Period', '941 Deposit', '941 Due', '940 (FUTA)', '940 Due', 'SUI', 'SUI Due'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: h.includes('Deposit') || h.includes('FUTA') || h === 'SUI' ? 'right' : 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}
                  style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={() => setDetailRow(r)}
                  title="Click to view tax breakdown">
                  <td style={{ padding: '8px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{r._clientName}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{r.employee_name || '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {fmtDate(r.pay_period_start)} – {fmtDate(r.pay_period_end)}
                  </td>
                  {/* 941 */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                    {r._pending941 ? fmt(r.total_deposit) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <DueCell due={r._due941} late={r._late941} />
                  {/* 940 */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                    {r._pending940 ? fmt(r.futa_tax) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <DueCell due={r._due940} late={r._late940} />
                  {/* SUI */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                    {r._pendingSUI ? fmt(r.suta_tax) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <DueCell due={r._dueSUI} late={r._lateSUI} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
                <td colSpan={3} style={{ padding: '10px 12px', fontWeight: 700, fontSize: 12 }}>Total</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 13, color: 'var(--accent)' }}>{fmt(total941)}</td>
                <td />
                <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 13, color: 'var(--accent)' }}>{fmt(total940)}</td>
                <td />
                <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 13, color: 'var(--accent)' }}>{fmt(totalSUI)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
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
          {clients.length > 0 && (
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
              <button onClick={() => switchView('tiles')} title="Tile view"
                style={{ padding: '5px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                  background: view === 'tiles' ? '#fff' : 'transparent',
                  color: view === 'tiles' ? 'var(--accent)' : 'var(--text-muted)',
                  boxShadow: view === 'tiles' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>⊞</button>
              <button onClick={() => switchView('list')} title="List view"
                style={{ padding: '5px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                  background: view === 'list' ? '#fff' : 'transparent',
                  color: view === 'list' ? 'var(--accent)' : 'var(--text-muted)',
                  boxShadow: view === 'list' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>☰</button>
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
        <div className="company-grid" style={{ alignItems: 'start' }}>
          {clients.map(client => {
            const ps = payrollStatus(client.nextPayrollDate);
            return (
              <div key={client.id} className="company-tile"
                onClick={() => navigate(`/clients/${client.id}`)}
                role="button" tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/clients/${client.id}`)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, flexShrink: 0 }}>
                    {initials(client.businessName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tile-name">{client.businessName}</div>
                    <div className="tile-ein">EIN: {client.ein}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={e => handleDelete(e, client)} disabled={deleting === client.id}
                    style={{ flexShrink: 0, opacity: 0.4, fontSize: 14, padding: '4px 7px' }} title="Delete">
                    {deleting === client.id ? <span className="spinner spinner-dark" style={{ width: 12, height: 12 }} /> : '✕'}
                  </button>
                </div>
                {client.overdueAmount > 0 && (
                  <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginBottom: 6 }}>
                    ⚠ Tax deposit overdue — ${Number(client.overdueAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                )}
                <div className="tile-badges">
                  <LiabStatusBadge status={client.liabilityStatus} />
                  {ps && <span className={`badge ${ps.cls}`}>{ps.label}</span>}
                  <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>{client.payrollFrequency || 'biweekly'}</span>
                  <span className="badge badge-neutral">{client.state || 'TX'}</span>
                </div>
                <div className="tile-meta">
                  <div className="tile-meta-row">
                    <span className="tile-meta-label">Next payroll</span>
                    <span className="tile-meta-value">{client.nextPayrollDate ? fmtDate(client.nextPayrollDate) : '—'}</span>
                  </div>
                  <div className="tile-meta-row">
                    <span className="tile-meta-label">Deposit schedule</span>
                    <span className="tile-meta-value" style={{ textTransform: 'capitalize' }}>{client.depositSchedule}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── List view ── */
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 160px 130px 70px 100px 36px', alignItems: 'center', padding: '9px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', gap: 8 }}>
              <div>
                <input type="checkbox" checked={allSelected}
                  onChange={e => setSelected(e.target.checked ? new Set(clients.map(c => c.id)) : new Set())}
                  onClick={e => e.stopPropagation()}
                  style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
              </div>
              {['Company', 'Next Payroll', 'Schedule', 'State', 'Status', ''].map((h, i) => (
                <div key={i} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            {clients.map((client, i) => {
              const ps = payrollStatus(client.nextPayrollDate);
              const isSel = selected.has(client.id);
              return (
                <div key={client.id}
                  style={{ display: 'grid', gridTemplateColumns: '40px 1fr 160px 130px 70px 100px 36px', alignItems: 'center', padding: '10px 16px', gap: 8,
                    background: isSel ? 'var(--accent-light)' : i % 2 === 0 ? '#fff' : '#f8fafc',
                    borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s' }}
                  onClick={() => navigate(`/clients/${client.id}`)}>

                  {/* Checkbox — isolated from row click */}
                  <div onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isSel}
                      onChange={() => toggleSelect(client.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
                  </div>

                  {/* Name + EIN */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
                      {initials(client.businessName)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client.businessName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{client.ein}</div>
                    </div>
                    {client.overdueAmount > 0 && <span className="badge badge-error" style={{ fontSize: 10, flexShrink: 0 }}>Overdue</span>}
                  </div>

                  <div style={{ fontSize: 13, color: ps ? '#d97706' : 'var(--text-secondary)', fontWeight: ps ? 600 : 400 }}>
                    {client.nextPayrollDate ? fmtDate(client.nextPayrollDate) : '—'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{client.depositSchedule || '—'}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{client.state || 'TX'}</div>
                  <div><LiabStatusBadge status={client.liabilityStatus} /></div>

                  {/* Delete */}
                  <div onClick={e => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" onClick={e => handleDelete(e, client)} disabled={deleting === client.id}
                      style={{ opacity: 0.35, fontSize: 13, padding: '3px 6px' }} title="Delete">
                      {deleting === client.id ? <span className="spinner spinner-dark" style={{ width: 11, height: 11 }} /> : '✕'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selection info + merged liabilities panel */}
          {selected.size > 0 && (
            <>
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{selected.size} {selected.size === 1 ? 'company' : 'companies'} selected</span>
                <button onClick={() => setSelected(new Set())}
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
