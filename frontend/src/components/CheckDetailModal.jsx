import { useState, useEffect } from 'react';
import api from '../api/client';

const MONO = { fontFamily: 'JetBrains Mono, monospace' };
function r2(n) { return Math.round((n || 0) * 100) / 100; }
function fmt(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

const STATUS_COLORS = {
  draft:                   { bg: '#eff6ff', color: '#2563eb' },
  late:                    { bg: '#fff1f2', color: '#dc2626' },
  printed:                 { bg: '#f0fdf4', color: '#16a34a' },
  deposited:               { bg: '#f0fdf4', color: '#16a34a' },
  direct_deposit_sent:     { bg: '#fefce8', color: '#ca8a04' },
  direct_deposit_cleared:  { bg: '#f0fdf4', color: '#16a34a' },
  voided:                  { bg: '#f3f4f6', color: '#6b7280' },
};
function StatusBadge({ status }) {
  const cfg = STATUS_COLORS[status] || { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: cfg.bg, color: cfg.color, textTransform: 'capitalize' }}>
      {(status || 'draft').replace(/_/g, ' ')}
    </span>
  );
}

const TR = ({ label, amount, ytdAmount, color, bold, borderTop, negative, editValue, onEditChange }) => {
  const display = negative ? (amount > 0 ? -amount : amount) : amount;
  return (
    <tr style={{ borderTop: borderTop ? '2px solid var(--border)' : undefined }}>
      <td style={{ padding: '5px 0', fontSize: 13, color: bold ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: bold ? 700 : 400, whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ padding: '3px 0 3px 12px', textAlign: 'right', ...MONO, fontSize: 13, fontWeight: bold ? 700 : 500, color: color || (negative && amount > 0 ? '#dc2626' : 'inherit') }}>
        {onEditChange
          ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              <span style={{ ...MONO, fontSize: 13, color: 'var(--text-muted)', marginRight: 1 }}>$</span>
              <input type="text" inputMode="decimal"
                value={editValue}
                onChange={e => onEditChange(e.target.value)}
                placeholder="0.00"
                style={{ ...MONO, background: '#fff', border: '1px solid var(--border)', borderRadius: 0, outline: 'none', width: 80, textAlign: 'right', fontSize: 13, fontWeight: bold ? 700 : 500, color: 'var(--text-primary)', padding: '1px 5px', cursor: 'text', boxSizing: 'border-box' }} />
            </span>
          : typeof display === 'number' ? fmt(display) : display
        }
      </td>
      {ytdAmount !== undefined && (
        <td style={{ padding: '5px 0 5px 12px', textAlign: 'right', ...MONO, fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>{ytdAmount != null ? fmt(ytdAmount) : '—'}</td>
      )}
    </tr>
  );
};

const ColHeader = ({ hasYTD }) => (
  <thead>
    <tr>
      <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>Item Name</th>
      <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Amount</th>
      {hasYTD && <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>YTD</th>}
    </tr>
  </thead>
);

export default function CheckDetailModal({ stub, clientId, onClose, onSaved }) {
  if (!stub) return null;

  const isVoided = stub.check_status === 'voided';
  const curYear = new Date().getFullYear();

  const lineItemsList = stub.lineItems || [];
  const compFromItems = lineItemsList.filter(li => li.pay_type === 'regular' && stub.regular_hours == null).reduce((s, li) => s + (li.amount || 0), 0);
  const displayedTips = stub.reported_tips || lineItemsList.filter(li => li.pay_type === 'tips').reduce((s, li) => s + (li.amount || 0), 0);
  // Fallback for checks with no base line item: derive the BASE comp by removing
  // overtime/tips/bonus/commission from gross — using raw gross_wages here made the
  // save payload re-add those as separate items on top (double-counted gross).
  const initialGross  = r2(compFromItems > 0 ? compFromItems
    : stub.regular_pay != null ? stub.regular_pay
    : Math.max(0, (stub.gross_wages || 0) - (stub.overtime_pay || 0) - (displayedTips || 0) - (stub.bonus || 0) - (stub.commission || 0)));
  const initialFit    = r2(stub.fit_withholding || 0);

  const [ytd, setYtd] = useState({ gross: null, fit: null, eeSS: null, eeMed: null, stateTax: null, futa: null, suta: null, netPay: null, erSS: null, erMed: null });
  const [dateForm, setDateForm] = useState({ start: stub.pay_period_start || '', end: stub.pay_period_end || '', payDate: stub.settlement_date || '' });
  const [grossOverride, setGrossOverride] = useState(String(initialGross));
  const [fitOverride,   setFitOverride]   = useState(String(initialFit));
  const [itemForm, setItemForm] = useState({
    reportedTips:  String(displayedTips        || ''),
    bonus:         String(stub.bonus           || ''),
    commission:    String(stub.commission      || ''),
    reimbursement: String(stub.reimbursement   || ''),
    deduction:     String(stub.deduction       || ''),
    garnishment:   String(stub.garnishment     || ''),
  });
  const [addedItems, setAddedItems] = useState(() => {
    const s = new Set();
    if (displayedTips      > 0) s.add('reportedTips');
    if (stub.bonus         > 0) s.add('bonus');
    if (stub.commission    > 0) s.add('commission');
    if (stub.reimbursement > 0) s.add('reimbursement');
    if (stub.deduction     > 0) s.add('deduction');
    if (stub.garnishment   > 0) s.add('garnishment');
    return s;
  });
  const [otherOpen, setOtherOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!stub.employee_id || !clientId) return;
    api.getPaystubs(clientId).then(allStubs => {
      const empStubs = allStubs.filter(s =>
        s.employee_id === stub.employee_id &&
        s.check_status !== 'voided' &&
        (s.tax_year === curYear || (s.pay_period_end || '').startsWith(String(curYear))) &&
        s.pay_period_end <= (stub.pay_period_end || '9999')
      );
      setYtd({
        gross:    empStubs.reduce((n, s) => n + (s.gross_wages       || 0), 0),
        fit:      empStubs.reduce((n, s) => n + (s.fit_withholding   || 0), 0),
        eeSS:     empStubs.reduce((n, s) => n + (s.employee_ss       || 0), 0),
        eeMed:    empStubs.reduce((n, s) => n + (s.employee_medicare || 0), 0),
        stateTax: empStubs.reduce((n, s) => n + (s.state_income_tax  || 0), 0),
        futa:     empStubs.reduce((n, s) => n + (s.futa_tax          || 0), 0),
        suta:     empStubs.reduce((n, s) => n + (s.suta_tax          || 0), 0),
        netPay:   empStubs.reduce((n, s) => n + (s.net_pay           || 0), 0),
        erSS:     empStubs.reduce((n, s) => n + (s.employer_ss       || 0), 0),
        erMed:    empStubs.reduce((n, s) => n + (s.employer_medicare || 0), 0),
      });
    }).catch(() => {});
  }, [stub.id, clientId]);

  function revertChanges() {
    setGrossOverride(String(initialGross));
    setFitOverride(String(initialFit));
    setItemForm({
      reportedTips:  String(displayedTips        || ''),
      bonus:         String(stub.bonus           || ''),
      commission:    String(stub.commission      || ''),
      reimbursement: String(stub.reimbursement   || ''),
      deduction:     String(stub.deduction       || ''),
      garnishment:   String(stub.garnishment     || ''),
    });
    setDateForm({ start: stub.pay_period_start || '', end: stub.pay_period_end || '', payDate: stub.settlement_date || '' });
    const s = new Set();
    if (displayedTips      > 0) s.add('reportedTips');
    if (stub.bonus         > 0) s.add('bonus');
    if (stub.commission    > 0) s.add('commission');
    if (stub.reimbursement > 0) s.add('reimbursement');
    if (stub.deduction     > 0) s.add('deduction');
    if (stub.garnishment   > 0) s.add('garnishment');
    setAddedItems(s);
    setOtherOpen(false);
  }

  const itemDirty = !isVoided && (
    parseFloat(itemForm.reportedTips  || 0) !== (displayedTips       || 0) ||
    parseFloat(itemForm.bonus         || 0) !== (stub.bonus          || 0) ||
    parseFloat(itemForm.commission    || 0) !== (stub.commission     || 0) ||
    parseFloat(itemForm.reimbursement || 0) !== (stub.reimbursement  || 0) ||
    parseFloat(itemForm.deduction     || 0) !== (stub.deduction      || 0) ||
    parseFloat(itemForm.garnishment   || 0) !== (stub.garnishment    || 0)
  );
  const isDirty = !isVoided && (
    dateForm.start   !== (stub.pay_period_start || '') ||
    dateForm.end     !== (stub.pay_period_end   || '') ||
    dateForm.payDate !== (stub.settlement_date  || '') ||
    parseFloat(grossOverride) !== initialGross ||
    parseFloat(fitOverride)   !== initialFit   ||
    itemDirty
  );

  async function saveChanges() {
    setSaving(true);
    try {
      const payload = { payPeriodStart: dateForm.start, payPeriodEnd: dateForm.end, settlementDate: dateForm.payDate };
      if (parseFloat(grossOverride) !== initialGross) {
        // Preserve the check's pay structure: hourly checks keep a 'regular'
        // base (not 'salary'), overtime stays as its own line item, and
        // tips/bonus/commission ride along so the backend keeps them in gross.
        const baseType = stub.regular_hours != null ? 'regular' : 'salary';
        const tipAmt   = parseFloat(itemForm.reportedTips || 0);
        const bonusAmt = parseFloat(itemForm.bonus        || 0);
        const commAmt  = parseFloat(itemForm.commission   || 0);
        payload.lineItems = [
          { payType: baseType, amount: parseFloat(grossOverride || 0) },
          ...(stub.overtime_pay > 0 ? [{ payType: 'overtime', amount: stub.overtime_pay, hours: stub.overtime_hours || null }] : []),
          ...(tipAmt   > 0 ? [{ payType: 'tips',       amount: tipAmt   }] : []),
          ...(bonusAmt > 0 ? [{ payType: 'bonus',      amount: bonusAmt }] : []),
          ...(commAmt  > 0 ? [{ payType: 'commission', amount: commAmt  }] : []),
        ];
        payload.reportedTips = tipAmt;
        payload.bonus        = bonusAmt;
        payload.commission   = commAmt;
      }
      if (parseFloat(fitOverride) !== initialFit) {
        // A FIT-only edit doesn't need lineItems — sending a lone 'salary' item
        // here was converting hourly checks to salary and dropping overtime,
        // tips, and bonus from gross.
        payload.fitWithholdingOverride = parseFloat(fitOverride || 0);
      }
      if (itemDirty) {
        payload.reportedTips  = parseFloat(itemForm.reportedTips  || 0);
        payload.bonus         = parseFloat(itemForm.bonus         || 0);
        payload.commission    = parseFloat(itemForm.commission    || 0);
        payload.reimbursement = parseFloat(itemForm.reimbursement || 0);
        payload.deduction     = parseFloat(itemForm.deduction     || 0);
        payload.garnishment   = parseFloat(itemForm.garnishment   || 0);
      }
      await api.updatePaystub(stub.id, payload);
      onSaved && onSaved();
      onClose();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  const canEdit = !isVoided && !stub._isPending;
  const set = field => canEdit ? (v => setItemForm(p => ({ ...p, [field]: v }))) : undefined;

  const mainPayRow = stub.regular_hours != null && stub.regular_pay != null
    ? { label: `Hourly  (${stub.regular_hours} hrs)`, amount: stub.regular_pay, editValue: canEdit ? grossOverride : undefined, onEditChange: canEdit ? setGrossOverride : undefined }
    : { label: 'Compensation', amount: initialGross, editValue: canEdit ? grossOverride : undefined, onEditChange: canEdit ? setGrossOverride : undefined };

  const optionalEarnings = [
    { key: 'reportedTips',  label: 'Reported Tips'  },
    { key: 'bonus',         label: 'Bonus'           },
    { key: 'commission',    label: 'Commission'      },
    { key: 'reimbursement', label: 'Reimbursement'  },
  ];
  const optionalDeductions = [
    { key: 'deduction',   label: 'Deduction'   },
    { key: 'garnishment', label: 'Garnishment' },
  ];

  const earningRows = [
    mainPayRow,
    stub.overtime_hours > 0 && stub.overtime_pay > 0 && { label: `Overtime  (${stub.overtime_hours} hrs)`, amount: stub.overtime_pay },
    ...optionalEarnings
      .filter(x => addedItems.has(x.key))
      .map(x => ({ label: x.label, amount: parseFloat(itemForm[x.key] || 0), editValue: canEdit ? itemForm[x.key] : undefined, onEditChange: set(x.key) })),
  ].filter(Boolean);

  const liveGross = r2(
    parseFloat(grossOverride || 0) +
    (stub.overtime_pay || 0) +
    optionalEarnings.filter(x => addedItems.has(x.key)).reduce((s, x) => s + parseFloat(itemForm[x.key] || 0), 0)
  );

  const deductionRows = [
    { label: 'Federal Income Tax', amount: stub.fit_withholding   || 0, ytd: ytd.fit,      editValue: canEdit ? fitOverride : undefined, onEditChange: canEdit ? setFitOverride : undefined },
    { label: 'Social Security',    amount: stub.employee_ss       || 0, ytd: ytd.eeSS      },
    { label: 'Medicare',           amount: stub.employee_medicare || 0, ytd: ytd.eeMed     },
    (stub.additional_medicare || 0) > 0 && { label: 'Addl Medicare', amount: stub.additional_medicare },
    { label: 'State Income Tax',   amount: stub.state_income_tax  || 0, ytd: ytd.stateTax  },
    ...optionalDeductions
      .filter(x => addedItems.has(x.key))
      .map(x => ({ label: x.label, amount: parseFloat(itemForm[x.key] || 0), editValue: canEdit ? itemForm[x.key] : undefined, onEditChange: set(x.key) })),
  ].filter(Boolean);

  const hiddenItems = [...optionalEarnings, ...optionalDeductions].filter(x => !addedItems.has(x.key));

  const employerRows = [
    { label: 'SS Match (Company)',       amount: stub.employer_ss      || 0, ytd: ytd.erSS },
    { label: 'Medicare Match (Company)', amount: stub.employer_medicare || 0, ytd: ytd.erMed },
    { label: 'Federal Unemployment',     amount: stub.futa_tax         || 0, ytd: ytd.futa },
    { label: `${stub.work_state || 'State'} Unemployment`, amount: stub.suta_tax || 0, ytd: ytd.suta },
  ];
  const employerTotal = r2(employerRows.reduce((s, r) => s + r.amount, 0));
  const employerYTD   = ytd.erSS != null ? r2(employerRows.reduce((s, r) => s + (r.ytd || 0), 0)) : null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 740, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, textDecoration: isVoided ? 'line-through' : 'none' }}>{stub.employee_name || '—'}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <StatusBadge status={stub.check_status || 'draft'} />
                {stub.check_number && <span style={{ ...MONO, fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>Check #{stub.check_number}</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
          </div>
          {/* Pay period strip */}
          <div style={{ display: 'flex', marginTop: 14, borderRadius: 8, overflow: 'hidden', border: `1px solid ${isDirty ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-secondary)', transition: 'border-color 0.15s' }}>
            {[
              { label: 'Period Start', key: 'start',   raw: stub.pay_period_start },
              { label: 'Period End',   key: 'end',     raw: stub.pay_period_end   },
              { label: 'Pay Date',     key: 'payDate', raw: stub.settlement_date  },
            ].map(({ label, key, raw }, i, arr) => (
              <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                {isVoided
                  ? <div style={{ ...MONO, fontSize: 13, fontWeight: 600 }}>{fmtDate(raw)}</div>
                  : <input type="date" value={dateForm[key]}
                      onChange={e => setDateForm(f => ({ ...f, [key]: e.target.value }))}
                      style={{ ...MONO, fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', borderRadius: 0, outline: 'none', width: '100%', color: dateForm[key] !== (raw || '') ? 'var(--accent)' : 'var(--text-primary)', cursor: 'pointer' }} />
                }
              </div>
            ))}
          </div>
        </div>

        {/* Two-column body */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          {/* Left — Employee Summary */}
          <div style={{ padding: '18px 20px 16px 24px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Employee Summary</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <ColHeader hasYTD={true} />
              <tbody>
                {earningRows.map(r => (
                  <TR key={r.label} label={r.label} amount={r.amount} color="var(--accent)"
                    editValue={r.editValue} onEditChange={r.onEditChange} />
                ))}
                <TR label="Gross Pay" amount={liveGross} ytdAmount={ytd.gross} color="var(--accent)" bold borderTop />
                {deductionRows.map(r => (
                  <TR key={r.label} label={r.label} amount={r.amount} ytdAmount={r.ytd} negative
                    color={r.amount > 0 ? '#dc2626' : 'var(--text-muted)'}
                    editValue={r.editValue} onEditChange={r.onEditChange} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Right — Company Summary */}
          <div style={{ padding: '18px 24px 16px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Company Summary</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <ColHeader hasYTD={true} />
              <tbody>
                {employerRows.map(r => <TR key={r.label} label={r.label} amount={r.amount} ytdAmount={r.ytd} />)}
                <TR label="Total Company Cost" amount={employerTotal} ytdAmount={employerYTD} bold borderTop color="var(--text-primary)" />
              </tbody>
            </table>
          </div>
        </div>

        {/* Check Amount + tax bar */}
        <div style={{ margin: '0 24px', borderTop: '2px solid var(--border)' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px 4px' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Check Amount</div>
          <div style={{ ...MONO, fontSize: 22, fontWeight: 800, color: '#16a34a' }}>{fmt(stub.net_pay || 0)}</div>
        </div>
        <div style={{ display: 'flex', gap: 0, margin: '12px 24px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          {[
            { label: '941 Tax Deposit', value: fmt(stub.total_deposit || 0) },
            { label: '940 FUTA',        value: fmt(stub.futa_tax      || 0) },
            { label: 'State SUI',       value: fmt(stub.suta_tax      || 0) },
            { label: 'Total Tax Costs', value: fmt(r2((stub.total_deposit || 0) + (stub.futa_tax || 0) + (stub.suta_tax || 0))), accent: true },
          ].map(({ label, value, accent }, i, arr) => (
            <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none', background: accent ? 'var(--accent-light)' : undefined }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
              <div style={{ ...MONO, fontSize: 14, fontWeight: 800, color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Other Payroll Items */}
        {canEdit && hiddenItems.length > 0 && (
          <div style={{ margin: '0 24px', borderTop: '1px solid var(--border)', paddingTop: 10, paddingBottom: 6 }}>
            <button type="button" onClick={() => setOtherOpen(o => !o)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {otherOpen ? '▴' : '▾'} Other Payroll Items
            </button>
            {otherOpen && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {hiddenItems.map(item => (
                  <button key={item.key} type="button"
                    onClick={() => { setAddedItems(prev => new Set([...prev, item.key])); setOtherOpen(false); }}
                    style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    + {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '12px 24px 18px', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>Close</button>
          {clientId && !isVoided && !stub._isPending && (
            <button className="btn btn-ghost" style={{ fontSize: 12, color: '#dc2626' }} onClick={async () => {
              if (!window.confirm('Delete this check? This cannot be undone.')) return;
              try { await api.deletePaystub(stub.id); onSaved && onSaved(); onClose(); } catch (e) { alert(e.message); }
            }}>Delete</button>
          )}
          {clientId && !stub._isPending && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={async () => {
              try { await api.printSelectedChecks(clientId, [stub.id]); } catch (e) { alert(e.message); }
            }}>↓ Paycheck</button>
          )}
          {clientId && !stub._isPending && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={async () => {
              try { await api.printSelectedPaystubs(clientId, [stub.id]); } catch (e) { alert(e.message); }
            }}>↓ Paystub</button>
          )}
          {isDirty && !stub._isPending && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={revertChanges}>Revert</button>
          )}
          {isDirty && !stub._isPending && (
            <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving} onClick={saveChanges}>
              {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
