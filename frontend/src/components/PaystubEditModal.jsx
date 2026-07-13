import { useState, useEffect } from 'react';
import api from '../api/client';

const EE_SS_RATE  = 0.062;
const EE_MED_RATE = 0.0145;
const SS_WAGE_BASE = 176100;

function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function r2(n) { return Math.round((n || 0) * 100) / 100; }

const ISSUED = new Set(['printed', 'deposited', 'direct_deposit_sent', 'direct_deposit_cleared']);
const MONO = { fontFamily: 'JetBrains Mono, monospace' };

// Derive the "compensation" amount from a paystub object
function getCompensation(stub) {
  if (stub.regular_pay != null) return stub.regular_pay;
  const fromItems = (stub.lineItems || [])
    .filter(li => !li.hours && (li.pay_type === 'regular' || li.pay_type === 'salary'))
    .reduce((s, li) => s + (li.amount || 0), 0);
  if (fromItems > 0) return fromItems;
  return Math.max(0,
    (stub.gross_wages || 0)
    - (stub.reported_tips || 0)
    - (stub.bonus        || 0)
    - (stub.commission   || 0)
    - (stub.reimbursement|| 0)
  );
}

function Field({ label, hint, value, onChange, readOnly }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</div>}
      </div>
      {readOnly
        ? <div style={{ ...MONO, fontSize: 13, fontWeight: 700, color: 'var(--accent)', minWidth: 100, textAlign: 'right' }}>{fmt(parseFloat(value) || 0)}</div>
        : <input type="number" min="0" step="0.01" value={value}
            onChange={e => onChange(e.target.value)}
            style={{ ...MONO, width: 110, textAlign: 'right', fontSize: 13, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 0, padding: '4px 8px', background: 'var(--bg-secondary)', outline: 'none' }}
          />
      }
    </div>
  );
}

export default function PaystubEditModal({ paystub, onClose, onSaved }) {
  if (!paystub) return null;

  const isIssued = ISSUED.has(paystub.check_status);
  const [confirmed, setConfirmed] = useState(!isIssued);
  const [saving, setSaving] = useState(false);

  const initComp  = String(r2(getCompensation(paystub)));
  const initTips  = String(paystub.reported_tips || 0);
  const initBonus = String(paystub.bonus         || 0);
  const initComm  = String(paystub.commission    || 0);
  const initReimb = String(paystub.reimbursement || 0);
  const initFit   = String(r2(paystub.fit_withholding || 0));

  const [comp,  setComp]  = useState(initComp);
  const [tips,  setTips]  = useState(initTips);
  const [bonus, setBonus] = useState(initBonus);
  const [comm,  setComm]  = useState(initComm);
  const [reimb, setReimb] = useState(initReimb);
  const [fit,   setFit]   = useState(initFit);

  const compV  = r2(parseFloat(comp)  || 0);
  const tipsV  = r2(parseFloat(tips)  || 0);
  const bonusV = r2(parseFloat(bonus) || 0);
  const commV  = r2(parseFloat(comm)  || 0);
  const reimbV = r2(parseFloat(reimb) || 0);
  const fitV   = r2(parseFloat(fit)   || 0);

  const taxableGross = r2(compV + tipsV + bonusV + commV);
  const totalGross   = r2(taxableGross + reimbV);

  // Estimate SS/Medicare (client-side, approximate — backend is authoritative on save)
  const ytdBefore = r2(paystub.ytd_wages_before || 0);
  const ssableWages = Math.max(0, Math.min(taxableGross, Math.max(0, SS_WAGE_BASE - ytdBefore)));
  const eeSS  = r2(ssableWages * EE_SS_RATE);
  const eeMed = r2(taxableGross * EE_MED_RATE);
  const netEst = r2(totalGross - fitV - eeSS - eeMed);
  const depEst = r2(fitV + eeSS + eeMed + (paystub.employer_ss || 0) + (paystub.employer_medicare || 0));

  const dirty = comp !== initComp || tips !== initTips || bonus !== initBonus ||
                comm !== initComm || reimb !== initReimb || fit !== initFit;

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        lineItems: [{ payType: 'salary', amount: taxableGross }],
        reportedTips:  tipsV,
        bonus:         bonusV,
        commission:    commV,
        reimbursement: reimbV,
        fitWithholdingOverride: fitV,
      };
      const result = await api.updatePaystub(paystub.id, payload);
      onSaved && onSaved(result.paystub || result);
      onClose();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  // ── Warning screen for issued checks ──────────────────────────────────────────
  if (!confirmed) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="card" style={{ width: 420, maxWidth: '95vw', padding: 28 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Modify Printed Check?</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
            <strong>{paystub.employee_name}</strong> — {paystub.check_status} check
            {paystub.check_number ? ` #${paystub.check_number}` : ''}.
            <br /><br />
            Editing a printed check changes the stored tax values.
            If this check was already deposited to EFTPS, you must file an amended return separately.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => setConfirmed(true)}>Confirm &amp; Edit</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Edit form ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 480, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', padding: 0 }}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{paystub.employee_name || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ textTransform: 'capitalize', fontWeight: 600, color: paystub.check_status === 'draft' ? '#2563eb' : '#16a34a' }}>{paystub.check_status}</span>
              {paystub.check_number && <span style={{ ...MONO }}>Check #{paystub.check_number}</span>}
              {paystub.pay_period_end && <span>{new Date(paystub.pay_period_end + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        {/* Fields */}
        <div style={{ padding: '14px 22px' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Gross Pay Components</div>
          <Field label="Base Pay / Compensation" value={comp}  onChange={setComp}  />
          <Field label="Reported Tips"            hint="taxable" value={tips}  onChange={setTips}  />
          <Field label="Bonus"                    hint="taxable" value={bonus} onChange={setBonus} />
          <Field label="Commission"               hint="taxable" value={comm}  onChange={setComm}  />
          <Field label="Reimbursement"            hint="non-taxable" value={reimb} onChange={setReimb} />

          {/* Gross Pay computed */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '9px 0 5px', borderTop: '2px solid var(--border)', marginTop: 2 }}>
            <div style={{ flex: 1, fontWeight: 800, fontSize: 13 }}>Gross Pay</div>
            <div style={{ ...MONO, fontWeight: 800, fontSize: 15, color: 'var(--accent)' }}>{fmt(totalGross)}</div>
          </div>

          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '14px 0 8px' }}>Tax Withholding</div>
          <Field label="Federal Income Tax" value={fit} onChange={setFit} />
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', color: 'var(--text-muted)', fontSize: 12 }}>
            <div style={{ flex: 1 }}>Social Security (6.2%) <span style={{ fontSize: 10 }}>est.</span></div>
            <div style={{ ...MONO }}>{fmt(eeSS)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', color: 'var(--text-muted)', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}>Medicare (1.45%) <span style={{ fontSize: 10 }}>est.</span></div>
            <div style={{ ...MONO }}>{fmt(eeMed)}</div>
          </div>

          {/* Totals */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12, padding: '10px 0', borderTop: '2px solid var(--border)' }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Net Pay (est.)</div>
              <div style={{ ...MONO, fontWeight: 800, fontSize: 14, color: '#16a34a' }}>{fmt(netEst)}</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>941 Deposit (est.)</div>
              <div style={{ ...MONO, fontWeight: 800, fontSize: 14, color: 'var(--accent)' }}>{fmt(depEst)}</div>
            </div>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>SS/Medicare shown are estimates — backend recalculates exactly on save.</div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 22px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
