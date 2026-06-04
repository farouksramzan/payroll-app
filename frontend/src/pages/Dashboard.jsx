import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function advancePeriod(s, e, freq) {
  if (freq === 'weekly')      return [addDays(s, 7),  addDays(e, 7)];
  if (freq === 'biweekly')    return [addDays(s, 14), addDays(e, 14)];
  if (freq === 'monthly')     return [new Date(s.getFullYear(), s.getMonth() + 1, s.getDate()), new Date(e.getFullYear(), e.getMonth() + 1, e.getDate())];
  if (freq === 'semimonthly') { const ns = addDays(e, 1); const ne = ns.getDate() === 1 ? new Date(ns.getFullYear(), ns.getMonth(), 15) : new Date(ns.getFullYear(), ns.getMonth() + 1, 0); return [ns, ne]; }
  return [addDays(s, 14), addDays(e, 14)];
}
function calcStartFromEnd(endDate, freq) {
  if (!endDate) return '';
  const e = new Date(endDate + 'T00:00:00');
  let s;
  if (freq === 'weekly')           s = addDays(e, -6);
  else if (freq === 'biweekly')    s = addDays(e, -13);
  else if (freq === 'monthly')     s = new Date(e.getFullYear(), e.getMonth(), 1);
  else if (freq === 'semimonthly') s = e.getDate() <= 15 ? new Date(e.getFullYear(), e.getMonth(), 1) : new Date(e.getFullYear(), e.getMonth(), 16);
  else s = addDays(e, -13);
  return s.toISOString().slice(0, 10);
}
import CheckDetailModal from '../components/CheckDetailModal';

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
function addBizDays(dateStr, n) { let d = new Date(dateStr + 'T00:00:00'), c = 0; while (c < n) { d.setDate(d.getDate() + 1); if (isBizDay(d)) c++; } return d.toISOString().slice(0, 10); }
function calcSendByDate(dueDate) {
  if (!dueDate) return null;
  let d = new Date(dueDate + 'T00:00:00'), count = 0;
  while (count < 2) { d.setDate(d.getDate() - 1); if (isBizDay(d)) count++; }
  return d.toISOString().slice(0, 10);
}

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
function fmtShort(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtPeriod(start, end) {
  if (!start && !end) return '—';
  const s = start ? new Date(start + 'T00:00:00') : null;
  const e = end   ? new Date(end   + 'T00:00:00') : null;
  const mo = { month: 'short', day: 'numeric' };
  if (!s) return e.toLocaleDateString('en-US', mo);
  if (!e) return s.toLocaleDateString('en-US', mo);
  const sStr = s.toLocaleDateString('en-US', mo);
  const eStr = s.getMonth() === e.getMonth() ? e.getDate() : e.toLocaleDateString('en-US', mo);
  return `${sStr} – ${eStr}`;
}
function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function payrollStatus(nextPayDate) {
  if (!nextPayDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(nextPayDate + 'T00:00:00');
  const days = Math.ceil((due - today) / 86400000);
  if (days < 0)  return { label: 'Pay date overdue',    cls: 'badge-error' };
  if (days === 0) return { label: 'Pay date today',      cls: 'badge-warning' };
  if (days <= 5)  return { label: `Pay date in ${days}d`, cls: 'badge-warning' };
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
function TaxDetailModal({ row, onClose, onEdit }) {
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

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {onEdit && <button className="btn btn-primary" onClick={() => onEdit(row)}>Edit Check</button>}
        </div>
      </div>
    </div>
  );
}

// ── Shared style helpers ───────────────────────────────────────────────────────
const SECTION_BTN = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
  padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer',
  textAlign: 'left', borderBottom: '1px solid var(--border)',
};
const BULK_BAR = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  padding: '8px 14px', background: 'var(--accent)', color: '#fff',
  borderBottom: '1px solid rgba(255,255,255,0.15)',
};
const bulkBtn = (extra = {}) => ({
  background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
  borderRadius: 5, color: '#fff', padding: '3px 10px', fontSize: 12,
  cursor: 'pointer', fontWeight: 600, ...extra,
});

const ISSUED_SET = new Set(['printed', 'deposited', 'direct_deposit_sent', 'direct_deposit_cleared']);

// ── LiabSection ────────────────────────────────────────────────────────────────
function LiabSection({ clientIds, clients, open, onToggle }) {
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [selectedLiab, setSelectedLiab] = useState(new Set());
  const [detailRow, setDetailRow]   = useState(null);
  const [submitting, setSubmitting] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const clientKey = useMemo(() => [...clientIds].sort().join(','), [clientIds]);

  useEffect(() => {
    const bump = () => setRefreshTick(t => t + 1);
    const timer = setInterval(bump, 60_000);
    window.addEventListener('focus', bump);
    return () => { clearInterval(timer); window.removeEventListener('focus', bump); };
  }, []);

  function buildLiabRows(results) {
    const today = new Date().toISOString().slice(0, 10);
    // 30-day window — catches monthly depositors (941 due on the 15th of next month)
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().slice(0, 10);
    const merged = [];
    results.forEach(({ id, stubs }) => {
      const client = clients.find(c => c.id == id);
      const schedule = client?.depositSchedule || 'monthly';
      stubs.filter(s => ISSUED_SET.has(s.check_status)).forEach(s => {
        const refDate = s.settlement_date || s.pay_period_end;
        const due941 = s.settlement_due_date || (refDate ? calcIRSDepositDue(refDate, schedule) : null);
        const due940 = refDate ? calcFutaQuarterlyDue(refDate) : null;
        const dueSUI = due940;
        const pending941   = s.status     === 'pending' || s.status     === 'processing' || s.status     === 'failed';
        const submitted941 = s.status     === 'submitted';
        const pending940   = (s.status_940 === 'pending' || s.status_940 === 'processing' || s.status_940 === 'failed') && (s.futa_tax || 0) > 0;
        const submitted940 = s.status_940 === 'submitted' && (s.futa_tax || 0) > 0;
        // SUI uses its own status_sui column, independent of 941; null treated as pending
        const pendingSUI   = (!s.status_sui || s.status_sui === 'pending' || s.status_sui === 'processing' || s.status_sui === 'failed') && (s.suta_tax || 0) > 0;
        const submittedSUI = s.status_sui  === 'submitted' && (s.suta_tax || 0) > 0;
        if (!pending941 && !pending940 && !pendingSUI && !submitted941 && !submitted940 && !submittedSUI) return;
        const late941    = pending941 && due941 && today > due941;
        const late940    = pending940 && due940 && today > due940;
        const lateSUI    = pendingSUI && dueSUI && today > dueSUI;
        const dueSoon941 = !late941 && pending941 && due941 && due941 <= in30Str;
        const dueSoon940 = !late940 && pending940 && due940 && due940 <= in30Str;
        const dueSoonSUI = !lateSUI && pendingSUI && dueSUI && dueSUI <= in30Str;
        const isLate    = late941 || late940 || lateSUI;
        const isDueSoon = !isLate && (dueSoon941 || dueSoon940 || dueSoonSUI);
        if (!isLate && !isDueSoon) return; // hide rows where everything is submitted / not yet due
        merged.push({
          ...s,
          _clientName: client?.businessName || '—', _clientId: id,
          _due941: pending941 ? due941 : null, _due940: pending940 ? due940 : null, _dueSUI: pendingSUI ? dueSUI : null,
          _sendBy941: pending941 ? calcSendByDate(due941) : null,
          _sendBy940: pending940 ? calcSendByDate(due940) : null,
          _sendBySUI: pendingSUI ? calcSendByDate(dueSUI) : null,
          _late941: late941, _late940: late940, _lateSUI: lateSUI,
          _dueSoon941: dueSoon941, _dueSoon940: dueSoon940, _dueSoonSUI: dueSoonSUI,
          _pending941: pending941, _pending940: pending940, _pendingSUI: pendingSUI,
          _submitted941: submitted941, _submitted940: submitted940, _submittedSUI: submittedSUI,
          _isLate: isLate, _isDueSoon: isDueSoon,
        });
      });
    });
    merged.sort((a, b) => {
      const aMin = [a._due941, a._due940, a._dueSUI].filter(Boolean).sort()[0] || 'zzzz';
      const bMin = [b._due941, b._due940, b._dueSUI].filter(Boolean).sort()[0] || 'zzzz';
      return aMin.localeCompare(bMin);
    });
    return merged;
  }

  useEffect(() => {
    if (!clientKey) { setRows([]); return; }
    setLoading(true);
    const ids = clientKey.split(',').filter(Boolean);
    Promise.allSettled(ids.map(id => api.getPaystubs(id).then(stubs => ({ id, stubs }))))
      .then(settled => {
        setRows(buildLiabRows(settled.filter(r => r.status === 'fulfilled').map(r => r.value)));
      })
      .finally(() => setLoading(false));
  }, [clientKey, refreshTick]);

  function triggerReload() { setRefreshTick(t => t + 1); }

  async function checkBridgeOrAbort() {
    try {
      const bs = await api.getBridgeStatus();
      if (!bs.connected) {
        alert('EFTPS bridge is not connected.\n\nStart the bridge service on your local machine to submit tax deposits. No payment was sent.');
        return false;
      }
      return true;
    } catch {
      alert('Could not reach the server to verify bridge status. No payment was sent.');
      return false;
    }
  }

  async function handlePayTaxType(taxType, selectedIds) {
    if (!selectedIds.length) return;
    if (!await checkBridgeOrAbort()) return;
    const byClient = {};
    selectedIds.forEach(id => {
      const r = visibleRows.find(x => x.id === id);
      if (r) (byClient[r._clientId] = byClient[r._clientId] || []).push(id);
    });
    setSubmitting(taxType);
    try {
      for (const [cid, ids] of Object.entries(byClient)) {
        await api.batchSubmitPaystubs({ clientId: Number(cid), paystubIds: ids, taxType });
      }
      setSelectedLiab(new Set());
    } catch (e) { alert(`Submission failed: ${e.message}`); }
    finally { setSubmitting(null); triggerReload(); }
  }

  async function handlePayAll() {
    const byClientTax = {};
    [...selectedLiab].forEach(id => {
      const r = visibleRows.find(x => x.id === id);
      if (!r) return;
      if (r._pending941) { const k = `${r._clientId}-941`; (byClientTax[k] = byClientTax[k] || { clientId: r._clientId, taxType: '941', ids: [] }).ids.push(id); }
      if (r._pending940) { const k = `${r._clientId}-940`; (byClientTax[k] = byClientTax[k] || { clientId: r._clientId, taxType: '940', ids: [] }).ids.push(id); }
      if (r._pendingSUI) { const k = `${r._clientId}-sui`; (byClientTax[k] = byClientTax[k] || { clientId: r._clientId, taxType: 'sui', ids: [] }).ids.push(id); }
    });
    const keys = Object.values(byClientTax);
    if (!keys.length) {
      alert('No pending tax liabilities found for the selected paystubs. They may have already been submitted.');
      return;
    }
    if (!await checkBridgeOrAbort()) return;
    setSubmitting('all');
    try {
      for (const { clientId, taxType, ids } of keys) {
        await api.batchSubmitPaystubs({ clientId: Number(clientId), paystubIds: ids, taxType });
      }
      setSelectedLiab(new Set());
    } catch (e) { alert(`Submission failed: ${e.message}`); }
    finally { setSubmitting(null); triggerReload(); }
  }

  async function handleResetOneTax(stubId, taxType, e) {
    e.stopPropagation();
    try {
      await api.updatePaystubStatus(stubId, 'pending', taxType);
      triggerReload();
    } catch (err) { alert(`Could not reset: ${err.message}`); }
  }

  // Always show only late + due-soon rows
  const visibleRows = rows.filter(r => r._isLate || r._isDueSoon);
  const lateRows    = visibleRows.filter(r => r._isLate);
  const dueSoonRows = visibleRows.filter(r => r._isDueSoon);

  const total941   = visibleRows.filter(r => r._pending941).reduce((s, r) => s + (r.total_deposit || 0), 0);
  const total940   = visibleRows.filter(r => r._pending940).reduce((s, r) => s + (r.futa_tax || 0), 0);
  const totalSUI   = visibleRows.filter(r => r._pendingSUI).reduce((s, r) => s + (r.suta_tax || 0), 0);
  const grandTotal = total941 + total940 + totalSUI;

  const grouped = [];
  const seenClients = [];
  visibleRows.forEach(r => { if (!seenClients.includes(r._clientId)) seenClients.push(r._clientId); });
  seenClients.forEach(cid => grouped.push({ clientId: cid, clientName: visibleRows.find(r => r._clientId === cid)?._clientName || '—', rows: visibleRows.filter(r => r._clientId === cid) }));

  const selSet = selectedLiab;
  const allVis = visibleRows.length > 0 && visibleRows.every(r => selSet.has(r.id));

  function toggleLiab(id) { setSelectedLiab(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  const DueCell = ({ due, late, dueSoon }) => (
    <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
      color: late ? '#dc2626' : dueSoon ? '#d97706' : 'var(--text-muted)', fontWeight: (late || dueSoon) ? 700 : 400 }}>
      {due ? fmtShort(due) : '—'}
    </td>
  );

  // Bulk pay buttons for selected rows
  const sel941Ids = [...selSet].filter(id => { const r = visibleRows.find(x => x.id === id); return r?._pending941; });
  const sel940Ids = [...selSet].filter(id => { const r = visibleRows.find(x => x.id === id); return r?._pending940; });
  const selSUIIds = [...selSet].filter(id => { const r = visibleRows.find(x => x.id === id); return r?._pendingSUI; });
  const lateIds   = visibleRows.filter(r => r._isLate).map(r => r.id);

  return (
    <>
      {detailRow && !detailRow._editing && <TaxDetailModal row={detailRow} onClose={() => setDetailRow(null)} onEdit={r => setDetailRow({ ...r, _editing: true })} />}
      {detailRow?._editing && <CheckDetailModal stub={detailRow} clientId={detailRow._clientId} onClose={() => setDetailRow(null)} onSaved={() => { setDetailRow(null); triggerReload(); }} />}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>

        {/* Accordion header */}
        <button style={SECTION_BTN} onClick={onToggle}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>
            Liabilities
            {lateRows.length > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fee2e2', borderRadius: 99, padding: '2px 7px' }}>{lateRows.length} overdue</span>}
            {dueSoonRows.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#d97706', background: '#fef3c7', borderRadius: 99, padding: '2px 7px' }}>{dueSoonRows.length} due soon</span>}
          </span>
          {loading && <span className="spinner spinner-dark" style={{ width: 12, height: 12 }} />}
          {grandTotal > 0 && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 13, color: 'var(--accent)' }}>{fmt(grandTotal)}</span>}
        </button>

        {open && (<>

          {/* Bulk action bar */}
          <div style={{ ...BULK_BAR, background: 'var(--bg-secondary)', color: 'var(--text)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            {lateIds.length > 0 && (
              <button style={{ ...bulkBtn({ background: '#dc2626', border: '1px solid #b91c1c', color: '#fff' }) }}
                onClick={() => setSelectedLiab(new Set(lateIds))}>
                Select All Late ({lateIds.length})
              </button>
            )}
            {selSet.size > 0 && <>
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-secondary)', marginLeft: lateIds.length ? 8 : 0 }}>{selSet.size} selected</span>
              {sel941Ids.length > 0 && (
                <button style={bulkBtn({ background: '#16a34a', border: '1px solid #15803d', color: '#fff' })}
                  disabled={!!submitting} onClick={() => handlePayTaxType('941', sel941Ids)}>
                  {submitting === '941' ? '…' : `Pay 941 (${sel941Ids.length})`}
                </button>
              )}
              {sel940Ids.length > 0 && (
                <button style={bulkBtn({ background: '#2563eb', border: '1px solid #1d4ed8', color: '#fff' })}
                  disabled={!!submitting} onClick={() => handlePayTaxType('940', sel940Ids)}>
                  {submitting === '940' ? '…' : `Pay 940 (${sel940Ids.length})`}
                </button>
              )}
              {selSUIIds.length > 0 && (
                <button style={bulkBtn({ background: '#7c3aed', border: '1px solid #6d28d9', color: '#fff' })}
                  disabled={!!submitting} onClick={() => handlePayTaxType('sui', selSUIIds)}>
                  {submitting === 'sui' ? '…' : `Pay SUI (${selSUIIds.length})`}
                </button>
              )}
              {selSet.size > 1 && (
                <button style={bulkBtn({ background: '#dc2626', border: '1px solid #b91c1c', color: '#fff' })}
                  disabled={!!submitting} onClick={handlePayAll}>
                  {submitting === 'all' ? '…' : 'Pay All'}
                </button>
              )}
              <button style={{ ...bulkBtn(), marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} onClick={() => setSelectedLiab(new Set())}>Clear</button>
            </>}
          </div>

          {!loading && visibleRows.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No overdue or due-soon liabilities for selected {clientIds.length === 1 ? 'company' : 'companies'}.
            </div>
          )}

          {visibleRows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ width: 36, padding: '7px 10px', textAlign: 'center' }}>
                    <input type="checkbox" checked={allVis} onChange={e => setSelectedLiab(e.target.checked ? new Set(visibleRows.map(r => r.id)) : new Set())} style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  </th>
                  {['Company', 'Employee', 'Period', '941', '941 Send By', '940', '940 Send By', 'SUI', 'SUI Send By'].map(h => (
                    <th key={h} style={{ padding: '7px 8px', textAlign: h.endsWith('941') || h === '940' || h === 'SUI' ? 'right' : 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map(group => (
                  <>
                    <tr key={`hdr-${group.clientId}`} style={{ background: '#f0f4ff', borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        <input type="checkbox"
                          checked={group.rows.length > 0 && group.rows.every(r => selSet.has(r.id))}
                          onChange={e => setSelectedLiab(prev => {
                            const n = new Set(prev);
                            if (e.target.checked) group.rows.forEach(r => n.add(r.id));
                            else group.rows.forEach(r => n.delete(r.id));
                            return n;
                          })}
                          style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                      </td>
                      <td colSpan={9} style={{ padding: '7px 8px', fontWeight: 700, fontSize: 13 }}>{group.clientName}</td>
                    </tr>
                    {group.rows.map((r, i) => (
                      <tr key={r.id} style={{ background: r._isLate ? '#fff5f5' : '#fffdf0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={e => { if (e.target.type !== 'checkbox') setDetailRow(r); }}>
                        <td style={{ padding: '7px 10px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selSet.has(r.id)} onChange={() => toggleLiab(r.id)} style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                        </td>
                        <td style={{ padding: '7px 8px', color: 'var(--text-muted)', fontSize: 11 }}></td>
                        <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{r.employee_name || '—'}</td>
                        <td style={{ padding: '7px 8px', fontSize: 11, whiteSpace: 'nowrap', color: '#555' }}>{fmtPeriod(r.pay_period_start, r.pay_period_end)}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                          {r._pending941 ? fmt(r.total_deposit) : r._submitted941
                            ? <span onClick={e => handleResetOneTax(r.id, '941', e)} title="Click to mark as unpaid" style={{ display:'inline-block', background:'#dcfce7', color:'#16a34a', borderRadius:99, padding:'2px 8px', fontSize:10, fontWeight:700, cursor:'pointer', border:'1px solid #86efac' }}>✓ Sent</span>
                            : <span style={{ color:'var(--text-muted)' }}>—</span>}
                        </td>
                        <DueCell due={r._pending941 ? r._sendBy941 : null} late={r._pending941 ? r._late941 : false} dueSoon={r._pending941 ? r._dueSoon941 : false} />
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                          {r._pending940 ? fmt(r.futa_tax) : r._submitted940
                            ? <span onClick={e => handleResetOneTax(r.id, '940', e)} title="Click to mark as unpaid" style={{ display:'inline-block', background:'#dcfce7', color:'#16a34a', borderRadius:99, padding:'2px 8px', fontSize:10, fontWeight:700, cursor:'pointer', border:'1px solid #86efac' }}>✓ Sent</span>
                            : <span style={{ color:'var(--text-muted)' }}>—</span>}
                        </td>
                        <DueCell due={r._pending940 ? r._sendBy940 : null} late={r._pending940 ? r._late940 : false} dueSoon={r._pending940 ? r._dueSoon940 : false} />
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                          {r._pendingSUI ? fmt(r.suta_tax) : r._submittedSUI
                            ? <span onClick={e => handleResetOneTax(r.id, 'sui', e)} title="Click to mark as unpaid" style={{ display:'inline-block', background:'#dcfce7', color:'#16a34a', borderRadius:99, padding:'2px 8px', fontSize:10, fontWeight:700, cursor:'pointer', border:'1px solid #86efac' }}>✓ Sent</span>
                            : <span style={{ color:'var(--text-muted)' }}>—</span>}
                        </td>
                        <DueCell due={r._pendingSUI ? r._sendBySUI : null} late={r._pendingSUI ? r._lateSUI : false} dueSoon={r._pendingSUI ? r._dueSoonSUI : false} />
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  <td colSpan={4} style={{ padding: '8px 10px', fontWeight: 700, fontSize: 12 }}>Total</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: 'var(--accent)' }}>{fmt(total941)}</td>
                  <td />
                  <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: 'var(--accent)' }}>{fmt(total940)}</td>
                  <td />
                  <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: 'var(--accent)' }}>{fmt(totalSUI)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </>)}
      </div>
    </>
  );
}

// ── PaycheckSection ────────────────────────────────────────────────────────────
function PaycheckSection({ clientIds, clients, open, onToggle }) {
  const navigate = useNavigate();
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [detailStub, setDetailStub] = useState(null);
  const [debugInfo, setDebugInfo]   = useState([]);
  const [hoursEdits, setHoursEdits] = useState({}); // { [rowId]: { reg, ot } }
  const [savingHours, setSavingHours] = useState(new Set());
  const clientKey = useMemo(() => [...clientIds].sort().join(','), [clientIds]);

  async function fetchRows(key) {
    if (!key) { setRows([]); setDebugInfo([]); return; }
    setLoading(true);
    const ids = key.split(',').filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    const in14Str = (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); })();
    const curYear = new Date().getFullYear();
    try {
      const settled = await Promise.allSettled(ids.map(id =>
        Promise.all([
          api.getPaystubs(id),
          api.getPayGroups(id).catch(() => []),
          api.getEmployees(id).catch(() => []),
        ]).then(([stubs, groups, employees]) => ({ id, stubs, groups, employees }))
      ));

      const dbg = [];
      const validResults = [];
      settled.forEach((r, i) => {
        const id = ids[i];
        const client = clients.find(c => c.id == id);
        if (r.status === 'rejected') {
          dbg.push({ name: client?.businessName || `id:${id}`, error: r.reason?.message || 'failed', statuses: [] });
          return;
        }
        const { stubs, groups, employees } = r.value;
        dbg.push({ name: client?.businessName || `id:${id}`, total: stubs.length, statuses: stubs.map(s => s.check_status || 'null') });
        validResults.push({ id, stubs, groups: groups || [], employees: employees || [], client });
      });
      setDebugInfo(dbg);

      const merged = [];

      // Stored paystubs (draft / late) — include hourly rate derived from line items
      validResults.forEach(({ id, stubs, employees, client }) => {
        stubs
          .filter(s => !['printed','deposited','direct_deposit_sent','direct_deposit_cleared','voided'].includes(s.check_status))
          .forEach(s => {
            const payDate = s.settlement_date || (s.pay_period_end ? addBizDays(s.pay_period_end, 2) : null);
            const isLate    = s.check_status === 'late' || (payDate ? payDate < today : false);
            const isDueSoon = !isLate && (payDate ? payDate <= in14Str : false);
            const regItem = (s.lineItems || []).find(li => li.pay_type === 'regular' || li.pay_type === 'hourly');
            const _hourlyRate = regItem?.rate || (s.regular_hours > 0 && s.regular_pay > 0 ? s.regular_pay / s.regular_hours : 0);
            const emp = employees.find(e => e.id === s.employee_id);
            const _payType = emp?.payType || (s.regular_hours > 0 || regItem ? 'hourly' : 'salary');
            const _ddEnabled = emp?.directDeposit?.status === 'active';
            merged.push({ ...s, _clientName: client?.businessName || '—', _clientId: id, _payDate: payDate, _isLate: isLate, _isDueSoon: isDueSoon, _isPending: false, _hourlyRate, _payType, _ddEnabled });
          });
      });

      // Pending periods from pay groups (no stored paystub yet)
      validResults.forEach(({ id, stubs, groups, employees, client }) => {
        groups.forEach(group => {
          if (!group.firstPayPeriodEnd || group.deletedAt) return;
          const freq = group.frequency || 'biweekly';
          const anchor = group.firstPayPeriodStart || calcStartFromEnd(group.firstPayPeriodEnd, freq);
          if (!anchor) return;

          const groupEmps = employees.filter(e => e.payGroupId === group.id);
          const empIds = new Set(groupEmps.map(e => e.id));
          const groupStubs = stubs.filter(s => s.pay_group_id === group.id && s.check_status !== 'voided');
          const fallbackStubs = groupStubs.length > 0 ? groupStubs : stubs.filter(s => s.employee_id && empIds.has(s.employee_id) && s.check_status !== 'voided');
          const paidEnds = new Set(fallbackStubs.map(s => s.pay_period_end));

          let sDate = new Date(anchor + 'T00:00:00'), eDate = new Date(group.firstPayPeriodEnd + 'T00:00:00');
          const pendingPeriods = [];
          for (let i = 0; i < 60; i++) {
            const endStr = eDate.toISOString().slice(0, 10);
            if (!paidEnds.has(endStr)) {
              const payDate = addBizDays(endStr, 2);
              const isLate    = payDate < today;
              const isDueSoon = !isLate && payDate <= in14Str;
              if (isLate || isDueSoon) pendingPeriods.push({ start: sDate.toISOString().slice(0, 10), end: endStr, payDate, isLate, isDueSoon });
              if (!isLate) break;
            }
            [sDate, eDate] = advancePeriod(sDate, eDate, freq);
          }

          pendingPeriods.forEach(period => {
            const rowEmps = groupEmps.length > 0 ? groupEmps : [{ id: `g${group.id}`, firstName: group.name, lastName: '', payType: 'hourly', hourlyRate: 0 }];
            rowEmps.forEach(emp => {
              const ytdGross = stubs
                .filter(s => s.employee_id === emp.id && s.check_status !== 'voided' && (s.tax_year === curYear || (s.pay_period_end || '').startsWith(String(curYear))))
                .reduce((sum, s) => sum + (s.gross_wages || 0), 0);
              merged.push({
                id: `pending-${id}-${group.id}-${period.end}-${emp.id}`,
                employee_name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || group.name,
                pay_period_start: period.start, pay_period_end: period.end,
                net_pay: null, check_status: period.isLate ? 'late' : 'draft',
                _clientName: client?.businessName || '—', _clientId: id,
                _payDate: period.payDate, _isLate: period.isLate, _isDueSoon: period.isDueSoon,
                _isPending: true,
                employee_id: emp.id,
                _employeeId: emp.id, _groupId: group.id,
                _payType: emp.payType || 'hourly',
                _hourlyRate: emp.hourlyRate || 0,
                _annualSalary: emp.annualSalary || 0,
                _payFrequency: emp.payFrequency || freq,
                _ytdGross: ytdGross,
              });
            });
          });
        });
      });

      merged.sort((a, b) => {
        const rank = r => r._isLate ? 0 : r._isDueSoon ? 1 : 2;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return (a._payDate || 'zzzz').localeCompare(b._payDate || 'zzzz');
      });
      setRows(merged);
      setSelected(prev => { const valid = new Set(merged.map(r => r.id)); return new Set([...prev].filter(id => valid.has(id))); });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchRows(clientKey); }, [clientKey]);

  function toggleCheck(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function setHours(rowId, field, val) {
    setHoursEdits(prev => ({ ...prev, [rowId]: { ...(prev[rowId] || {}), [field]: val } }));
  }

  async function handleHoursSave(r) {
    const edit = hoursEdits[r.id];
    if (!edit) return;
    const regHrs = parseFloat(edit.reg ?? '');
    const otHrs  = parseFloat(edit.ot  ?? '');
    if (isNaN(regHrs) && isNaN(otHrs)) return;
    const regItem = (r.lineItems || []).find(li => li.pay_type === 'regular' || li.pay_type === 'hourly');
    const rate = r._hourlyRate || regItem?.rate || (r.regular_hours > 0 && r.regular_pay > 0 ? r.regular_pay / r.regular_hours : 0);
    if (!rate) { alert('Cannot determine hourly rate — open the check to edit hours.'); return; }
    const rh = isNaN(regHrs) ? (r.regular_hours || 0) : regHrs;
    const oh = isNaN(otHrs)  ? (r.overtime_hours || 0) : otHrs;
    const lineItems = [];
    if (rh > 0) lineItems.push({ pay_type: 'regular', description: 'Regular', hours: rh, rate, amount: rh * rate });
    if (oh > 0) lineItems.push({ pay_type: 'overtime', description: 'Overtime', hours: oh, rate: rate * 1.5, amount: oh * rate * 1.5 });
    if (!lineItems.length) return;
    setSavingHours(prev => new Set([...prev, r.id]));
    try {
      await api.updatePaystub(r.id, { lineItems });
      setHoursEdits(prev => { const n = { ...prev }; delete n[r.id]; return n; });
      fetchRows(clientKey);
    } catch (e) { alert(`Save failed: ${e.message}`); }
    finally { setSavingHours(prev => { const n = new Set(prev); n.delete(r.id); return n; }); }
  }

  async function handleRunPending(r) {
    const edit = hoursEdits[r.id] || {};
    const regHrs = parseFloat(edit.reg || 0);
    const otHrs  = parseFloat(edit.ot  || 0);
    if (regHrs + otHrs <= 0) { alert('Enter hours first.'); return; }
    const rate = r._hourlyRate || 0;
    if (!rate) { alert('Pay rate unknown — go to company workspace to run payroll.'); return; }
    const lineItems = [];
    if (regHrs > 0) lineItems.push({ pay_type: 'regular', description: 'Regular', hours: regHrs, rate, amount: regHrs * rate });
    if (otHrs  > 0) lineItems.push({ pay_type: 'overtime', description: 'Overtime', hours: otHrs, rate: rate * 1.5, amount: otHrs * rate * 1.5 });
    setSavingHours(prev => new Set([...prev, r.id]));
    try {
      await api.runPayroll({
        clientId: Number(r._clientId),
        payPeriodStart: r.pay_period_start,
        payPeriodEnd: r.pay_period_end,
        settlementDate: r._payDate,
        payGroupId: r._groupId,
        employees: [{ employeeId: r._employeeId, lineItems, ytdGross: r._ytdGross || 0 }],
      });
      setHoursEdits(prev => { const n = { ...prev }; delete n[r.id]; return n; });
      fetchRows(clientKey);
    } catch (e) { alert(`Payroll run failed: ${e.message}`); }
    finally { setSavingHours(prev => { const n = new Set(prev); n.delete(r.id); return n; }); }
  }

  async function handlePrint() {
    const byClient = {};
    selStored.forEach(r => {
      if (!byClient[r._clientId]) byClient[r._clientId] = [];
      byClient[r._clientId].push(r.id);
    });
    for (const [cid, ids] of Object.entries(byClient)) {
      try { await api.printSelectedChecks(Number(cid), ids); } catch (e) { alert(`Print failed: ${e.message}`); }
    }
  }

  async function handleDD() {
    const ddRows    = selStored.filter(r => r._ddEnabled);
    const skipped   = selStored.filter(r => !r._ddEnabled);
    if (!ddRows.length) {
      alert(`None of the selected employees have direct deposit configured. Set up direct deposit in each employee's profile first.`);
      return;
    }
    if (skipped.length) {
      const names = skipped.map(r => r.employee_name || 'Unknown').join(', ');
      if (!window.confirm(`${skipped.length} employee(s) don't have direct deposit set up and will be skipped:\n\n${names}\n\nContinue for the remaining ${ddRows.length}?`)) return;
    }
    setSubmitting(true);
    try {
      for (const r of ddRows) {
        await api.updatePaystubStatus(r.id, 'direct_deposit_sent');
      }
      setSelected(new Set());
      fetchRows(clientKey);
    } catch (e) { alert(e.message); }
    finally { setSubmitting(false); }
  }

  const grouped = [];
  const seenClients = [];
  rows.forEach(r => { if (!seenClients.includes(r._clientId)) seenClients.push(r._clientId); });
  seenClients.forEach(cid => grouped.push({ clientId: cid, clientName: rows.find(r => r._clientId === cid)?._clientName || '—', rows: rows.filter(r => r._clientId === cid) }));

  const lateCount    = rows.filter(r => r._isLate).length;
  const dueSoonCount = rows.filter(r => r._isDueSoon).length;
  const selCount     = selected.size;
  const allChecked   = rows.length > 0 && rows.every(r => selected.has(r.id));
  const selStored    = rows.filter(r => selected.has(r.id) && !r._isPending);

  return (
    <>
      {detailStub && <CheckDetailModal stub={detailStub} clientId={detailStub._clientId} onClose={() => setDetailStub(null)} onSaved={() => { setDetailStub(null); fetchRows(clientKey); }} />}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
      <button style={SECTION_BTN} onClick={onToggle}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>
          Paychecks
          {lateCount > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fee2e2', borderRadius: 99, padding: '2px 7px' }}>{lateCount} late</span>}
          {dueSoonCount > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#d97706', background: '#fef3c7', borderRadius: 99, padding: '2px 7px' }}>{dueSoonCount} due soon</span>}
          {rows.length - lateCount - dueSoonCount > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 7px' }}>{rows.length - lateCount - dueSoonCount} upcoming</span>}
        </span>
        {loading && <span className="spinner spinner-dark" style={{ width: 12, height: 12 }} />}
      </button>

      {open && (
        <>
          <div style={{ ...BULK_BAR, background: 'var(--bg-secondary)', color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>
            {rows.some(r => r._isLate) && (
              <button style={bulkBtn({ background: '#dc2626', border: '1px solid #b91c1c', color: '#fff' })}
                onClick={() => setSelected(new Set(rows.filter(r => r._isLate).map(r => r.id)))}>
                Select All Late ({rows.filter(r => r._isLate).length})
              </button>
            )}
            {selCount > 0 && <>
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-secondary)', marginLeft: rows.some(r => r._isLate) ? 8 : 0 }}>{selCount} selected</span>
              {selStored.length > 0 && <button style={bulkBtn({ background: '#374151', border: '1px solid #1f2937', color: '#fff' })} onClick={handlePrint}>Print PDF ({selStored.length})</button>}
              {selStored.length > 0 && <button style={bulkBtn({ background: '#2563eb', border: '1px solid #1d4ed8', color: '#fff' })} onClick={handleDD} disabled={submitting}>{submitting ? 'Sending…' : `Direct Deposit (${selStored.length})`}</button>}
              <button style={{ ...bulkBtn(), marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} onClick={() => setSelected(new Set())}>Clear</button>
            </>}
          </div>
          {!loading && rows.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pending paychecks.</div>
          )}
          {rows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ width: 36, padding: '7px 10px', textAlign: 'center' }}>
                    <input type="checkbox" checked={allChecked} onChange={e => setSelected(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  </th>
                  {[
                    { label: 'Employee',     align: 'left'  },
                    { label: 'Period Start', align: 'left'  },
                    { label: 'Period End',   align: 'left'  },
                    { label: 'Pay Date',     align: 'left'  },
                    { label: 'Reg Hrs',      align: 'right' },
                    { label: 'OT Hrs',       align: 'right' },
                    { label: 'Rate',         align: 'right' },
                    { label: 'Net Pay',      align: 'right' },
                    { label: 'Status',       align: 'left'  },
                  ].map(({ label, align }) => (
                    <th key={label} style={{ padding: '7px 10px', textAlign: align, fontWeight: 600, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map(group => (
                  <>
                    <tr key={`hdr-${group.clientId}`} style={{ background: '#f0f4ff', borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        <input type="checkbox"
                          checked={group.rows.length > 0 && group.rows.every(r => selected.has(r.id))}
                          onChange={e => setSelected(prev => {
                            const n = new Set(prev);
                            if (e.target.checked) group.rows.forEach(r => n.add(r.id));
                            else group.rows.forEach(r => n.delete(r.id));
                            return n;
                          })}
                          style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                      </td>
                      <td colSpan={9} style={{ padding: '7px 10px', fontWeight: 700, fontSize: 13 }}>{group.clientName}</td>
                    </tr>
                    {group.rows.map((r, i) => {
                      const isHourly = r._payType === 'hourly';
                      const regItem  = (r.lineItems || []).find(li => li.pay_type === 'regular' || li.pay_type === 'hourly');
                      const rate     = r._hourlyRate || regItem?.rate || (r.regular_hours > 0 && r.regular_pay > 0 ? r.regular_pay / r.regular_hours : 0);
                      const regHrs   = r._isPending ? null : (r.regular_hours  || 0);
                      const otHrs    = r._isPending ? null : (r.overtime_hours || 0);
                      return (
                        <tr key={r.id}
                          style={{ background: r._isLate ? '#fff5f5' : r._isDueSoon ? '#fffbeb' : i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                          onClick={e => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') setDetailStub(r); }}>
                          {/* Checkbox */}
                          <td style={{ padding: '7px 10px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleCheck(r.id)} style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                          </td>
                          {/* Employee */}
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{r.employee_name || '—'}</span>
                            {r.check_number && <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>#{r.check_number}</span>}
                          </td>
                          {/* Period Start */}
                          <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, whiteSpace: 'nowrap', color: '#374151' }}>{fmtDate(r.pay_period_start)}</td>
                          {/* Period End */}
                          <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, whiteSpace: 'nowrap', color: '#374151' }}>{fmtDate(r.pay_period_end)}</td>
                          {/* Pay Date */}
                          <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: r._isLate || r._isDueSoon ? 700 : 400, color: r._isLate ? '#dc2626' : r._isDueSoon ? '#d97706' : '#374151', whiteSpace: 'nowrap' }}>{fmtDate(r._payDate)}</td>
                          {/* Reg Hrs */}
                          <td style={{ padding: '4px 8px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                            {isHourly
                              ? r._isPending
                                ? <input type="number" min="0" step="0.5" value={hoursEdits[r.id]?.reg ?? ''} placeholder="0"
                                    style={{ width: 54, fontSize: 11, padding: '2px 4px', textAlign: 'right', border: '1px solid var(--border)', borderRadius: 3 }}
                                    disabled={savingHours.has(r.id)}
                                    onChange={e => setHours(r.id, 'reg', e.target.value)}
                                  />
                                : <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{regHrs > 0 ? regHrs : '—'}</span>
                              : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                          </td>
                          {/* OT Hrs */}
                          <td style={{ padding: '4px 8px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                            {isHourly
                              ? r._isPending
                                ? <input type="number" min="0" step="0.5" value={hoursEdits[r.id]?.ot ?? ''} placeholder="0"
                                    style={{ width: 54, fontSize: 11, padding: '2px 4px', textAlign: 'right', border: '1px solid var(--border)', borderRadius: 3 }}
                                    disabled={savingHours.has(r.id)}
                                    onChange={e => setHours(r.id, 'ot', e.target.value)}
                                  />
                                : <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{otHrs > 0 ? otHrs : '—'}</span>
                              : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                          </td>
                          {/* Rate */}
                          <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#374151' }}>
                            {isHourly && rate ? Number(rate).toFixed(2) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          {/* Net Pay */}
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: r.net_pay != null && r.net_pay > 0 ? '#16a34a' : 'var(--text-muted)' }}>
                            {r.net_pay != null && r.net_pay > 0 ? fmt(r.net_pay) : '—'}
                          </td>
                          {/* Status */}
                          <td style={{ padding: '7px 10px' }}>
                            {r._isPending && isHourly && (parseFloat(hoursEdits[r.id]?.reg || 0) + parseFloat(hoursEdits[r.id]?.ot || 0) > 0)
                              ? <button onClick={e => { e.stopPropagation(); handleRunPending(r); }} disabled={savingHours.has(r.id)}
                                  style={{ fontSize: 11, padding: '3px 10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>
                                  {savingHours.has(r.id) ? '…' : '▶ Run'}
                                </button>
                              : r._isLate
                                ? <span className="badge badge-error" style={{ fontSize: 10 }}>LATE</span>
                                : r._isDueSoon
                                  ? <span className="badge badge-warning" style={{ fontSize: 10 }}>Due Soon</span>
                                  : <span className="badge" style={{ fontSize: 10, background: '#f3f4f6', color: '#6b7280' }}>UPCOMING</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          )}
          {debugInfo.length > 0 && (
            <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', background: '#f8fafc' }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text)', fontSize: 12 }}>Debug — raw fetch results ({debugInfo.length} companies):</div>
              {debugInfo.map(d => (
                <div key={d.name} style={{ marginTop: 5, fontFamily: 'JetBrains Mono, monospace' }}>
                  <strong style={{ color: 'var(--text)' }}>{d.name}</strong>:{' '}
                  {d.error
                    ? <span style={{ color: '#dc2626' }}>ERROR — {d.error}</span>
                    : <span>{d.total} stubs — unique statuses: [{[...new Set(d.statuses)].join(', ') || 'none'}]</span>}
                  {!d.error && d.statuses.length > 0 && (
                    <div style={{ marginLeft: 12, marginTop: 2, lineHeight: '20px' }}>
                      {d.statuses.map((s, i) => <span key={i} style={{ display: 'inline-block', margin: '1px 3px', padding: '1px 5px', borderRadius: 3, background: s === 'late' ? '#fee2e2' : s === 'draft' ? '#fef3c7' : '#f3f4f6', color: s === 'late' ? '#dc2626' : s === 'draft' ? '#d97706' : '#374151', fontSize: 10, fontWeight: 600 }}>{s}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      </div>
    </>
  );
}

// ── MultiCompanyPanel ──────────────────────────────────────────────────────────
function MultiCompanyPanel({ clientIds, clients }) {
  const [liabOpen,  setLiabOpen]  = useState(true);
  const [checkOpen, setCheckOpen] = useState(true);
  return (
    <>
      <LiabSection     clientIds={clientIds} clients={clients} open={liabOpen}  onToggle={() => setLiabOpen(o  => !o)} />
      <PaycheckSection clientIds={clientIds} clients={clients} open={checkOpen} onToggle={() => setCheckOpen(o => !o)} />
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
    let alive = true;
    const loadClients = (initial = false) => {
      if (initial) setLoading(true);
      api.getClients()
        .then(data => { if (alive) setClients(data); })
        .catch(() => {})
        .finally(() => { if (alive && initial) setLoading(false); });
    };
    loadClients(true);
    const timer = setInterval(() => loadClients(false), 60_000);
    const onFocus = () => loadClients(false);
    window.addEventListener('focus', onFocus);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', onFocus); };
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
            <>
              <button
                onClick={() => setSelected(allSelected ? new Set() : new Set(clients.map(c => c.id)))}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '5px 12px' }}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
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
            </>
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
            const ps = payrollStatus(client.nextPayDate);
            const isSel = selected.has(client.id);
            return (
              <div key={client.id} className="company-tile"
                onClick={() => navigate(`/clients/${client.id}`)}
                role="button" tabIndex={0}
                style={{ outline: isSel ? '2px solid var(--accent)' : undefined, outlineOffset: 2 }}
                onKeyDown={e => e.key === 'Enter' && navigate(`/clients/${client.id}`)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
                  <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => { e.stopPropagation(); toggleSelect(client.id); }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800 }}>
                      {initials(client.businessName)}
                    </div>
                    {isSel && <div style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span></div>}
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
                    <span className="tile-meta-label">Next Pay Date</span>
                    <span className="tile-meta-value">{client.nextPayDate ? fmtDate(client.nextPayDate) : '—'}</span>
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
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 160px 130px 70px 100px 36px', alignItems: 'center', padding: '9px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', gap: 8 }}>
              <div>
                <input type="checkbox" checked={allSelected}
                  onChange={e => setSelected(e.target.checked ? new Set(clients.map(c => c.id)) : new Set())}
                  onClick={e => e.stopPropagation()}
                  style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
              </div>
              {['Company', 'Next Pay Date', 'Schedule', 'State', 'Status', ''].map((h, i) => (
                <div key={i} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            {clients.map((client, i) => {
              const ps = payrollStatus(client.nextPayDate);
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
                  </div>

                  <div style={{ fontSize: 13, color: ps ? '#d97706' : 'var(--text-secondary)', fontWeight: ps ? 600 : 400 }}>
                    {client.nextPayDate ? fmtDate(client.nextPayDate) : '—'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{client.depositSchedule || '—'}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{client.state || 'TX'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    {client.liabilityStatus === 'overdue' && <span className="badge badge-error" style={{ fontSize: 10 }}>Tax Overdue</span>}
                    {ps && ps.cls === 'badge-error' && <span className="badge badge-error" style={{ fontSize: 10 }}>Payroll Overdue</span>}
                  </div>

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
      )}

      {/* Multi-company panel — shown for both tile and list views */}
      {!loading && clients.length > 0 && selected.size > 0 && (
        <>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{selected.size} {selected.size === 1 ? 'company' : 'companies'} selected:</span>
            <span>{clients.filter(c => selected.has(c.id)).map(c => c.businessName).join(', ')}</span>
            <button onClick={() => setSelected(new Set())}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, padding: 0, fontWeight: 600 }}>
              Clear
            </button>
          </div>
          <MultiCompanyPanel clientIds={[...selected]} clients={clients} />
        </>
      )}
    </div>
  );
}
