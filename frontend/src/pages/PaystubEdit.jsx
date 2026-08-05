import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

const CHILD_CREDIT     = 2200;
const DEPENDENT_CREDIT = 500;

const PAY_TYPES = [
  { value: 'regular',    label: 'Regular Pay' },
  { value: 'salary',     label: 'Salary' },
  { value: 'overtime',   label: 'Overtime (×1.5)' },
  { value: 'holiday',    label: 'Holiday Pay' },
  { value: 'commission', label: 'Commission' },
  { value: 'piecework',  label: 'Piecework' },
  { value: 'sick',       label: 'Sick Pay' },
];

const PAY_FREQ_LABELS = {
  weekly:      'Weekly (52×/yr)',
  biweekly:    'Bi-weekly (26×/yr)',
  semimonthly: 'Semi-monthly (24×/yr)',
  monthly:     'Monthly (12×/yr)',
};

const US_STATES = [['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['DC','D.C.']];

function fmtAmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function round2(n) { return Math.round((n || 0) * 100) / 100; }

// Reconstruct a Step 3 children/other split from the stored combined credit total.
// Any total that came from valid inputs (children × $2,200 + other × $500) has an
// exact split, which keeps the recalculated withholding identical to the stored check.
function splitStep3Credits(credits) {
  const cr = Math.round(credits || 0);
  for (let c = Math.floor(cr / CHILD_CREDIT); c >= 0; c--) {
    const rem = cr - c * CHILD_CREDIT;
    if (rem >= 0 && rem % DEPENDENT_CREDIT === 0) return { children: c, other: rem / DEPENDENT_CREDIT, exact: true };
  }
  return { children: 0, other: Math.round(cr / DEPENDENT_CREDIT), exact: false };
}

function Field({ label, hint, required, children }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}{required && <span style={{ color: 'var(--error)' }}> *</span>}</label>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

function TaxPreview({ taxes, loading }) {
  if (!taxes && !loading) return (
    <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Enter pay amounts to preview taxes
    </div>
  );
  return (
    <div>
      {loading && <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}><div className="spinner spinner-dark" style={{ width: 14, height: 14 }} /> Recalculating…</div>}
      {taxes && (
        <div style={{ fontSize: 13 }}>
          {[
            { label: 'Gross Wages',         val: taxes.grossWages,       bold: true },
            { label: 'FIT Withholding',      val: taxes.fitWithholding },
            { label: 'SS (employee)',         val: taxes.employeeSS },
            { label: 'Medicare (employee)',   val: taxes.employeeMedicare },
            ...(taxes.additionalMedicare > 0 ? [{ label: 'Add\'l Medicare', val: taxes.additionalMedicare }] : []),
            ...(taxes.stateIncomeTax > 0    ? [{ label: `${taxes.workState} State Tax`,  val: taxes.stateIncomeTax }] : []),
            { label: 'Net Pay',              val: taxes.netPay,           success: true },
            { label: '941 EFTPS Deposit',    val: taxes.totalDeposit,     accent: true },
            ...(taxes.futaTax > 0  ? [{ label: 'FUTA (940)',  val: taxes.futaTax,  muted: true }] : []),
            ...(taxes.sutaTax > 0  ? [{ label: `SUI — ${taxes.workState}`, val: taxes.sutaTax, muted: true }] : []),
          ].map(({ label, val, bold, accent, success, muted }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 18px', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ color: muted ? 'var(--text-muted)' : 'var(--text-secondary)', fontWeight: bold ? 700 : 400 }}>{label}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: bold || accent || success ? 700 : 500, color: accent ? 'var(--accent)' : success ? 'var(--success)' : muted ? 'var(--text-muted)' : 'var(--text-primary)', fontSize: bold ? 15 : 13 }}>
                {fmtAmt(val)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({ form, label, code, detail, amount, isSubmitted, isProcessing, confirmation, submittedAt, onSubmit, submitting, anySubmitting }) {
  const fmtSubmittedAt = submittedAt
    ? new Date(submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div style={{
      border: `1.5px solid ${isSubmitted ? '#10b981' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
      background: isSubmitted ? 'rgba(16,185,129,0.04)' : 'var(--bg-secondary)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: `1px solid ${isSubmitted ? 'rgba(16,185,129,0.2)' : 'var(--border-light)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Status icon */}
          <div style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 800,
            background: isSubmitted ? '#10b981' : 'transparent',
            border: `2px solid ${isSubmitted ? '#10b981' : 'var(--border)'}`,
            color: isSubmitted ? '#fff' : 'var(--text-muted)',
          }}>
            {isSubmitted ? '✓' : '·'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
              Form {form} — {label}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              EFTPS code {code} · {detail}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15, color: isSubmitted ? '#10b981' : 'var(--accent)' }}>
            {amount}
          </span>
          <button
            className={`btn btn-sm ${isSubmitted ? 'btn-secondary' : 'btn-primary'}`}
            onClick={onSubmit}
            disabled={anySubmitting || isSubmitted || isProcessing}
            style={isSubmitted ? { opacity: 0.6, cursor: 'default' } : {}}
          >
            {submitting ? <span className="spinner" /> : isSubmitted ? '✓ Deposited' : isProcessing ? 'Processing…' : `Submit ${form}`}
          </button>
        </div>
      </div>

      {/* Confirmation panel — shown when submitted */}
      {isSubmitted && confirmation && (
        <div style={{ padding: '10px 16px', background: 'rgba(16,185,129,0.06)' }}>
          <div style={{ fontSize: 11, color: '#10b981', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
            EFTPS Confirmation Number
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 15, fontWeight: 700, color: '#065f46', letterSpacing: '0.5px', wordBreak: 'break-all' }}>
            {confirmation}
          </div>
          {fmtSubmittedAt && (
            <div style={{ fontSize: 11, color: '#10b981', marginTop: 4 }}>
              Deposited {fmtSubmittedAt}
            </div>
          )}
        </div>
      )}

      {/* Pending prompt */}
      {!isSubmitted && (
        <div style={{ padding: '8px 16px', background: 'var(--bg-primary)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {isProcessing
              ? 'A submission for this deposit is already in progress — wait for it to finish before submitting again.'
              : `Not yet deposited — click "Submit ${form}" to pay this deposit via EFTPS.`}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PaystubEdit() {
  const { id: clientId, stubId } = useParams();
  const navigate = useNavigate();
  const [client,    setClient]    = useState(null);
  const [stub,      setStub]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [submitting, setSubmitting] = useState(null); // '941' | '940' | null
  const [saveResult, setSaveResult] = useState(null); // { warning } | null

  // Form state
  const [payPeriodStart,  setPayPeriodStart]  = useState('');
  const [payPeriodEnd,    setPayPeriodEnd]    = useState('');
  const [settlementDate,  setSettlementDate]  = useState('');
  const [payFrequency,    setPayFrequency]    = useState('biweekly');
  const [workState,       setWorkState]       = useState('TX');
  const [ytdGross,        setYtdGross]        = useState('');
  const [filingStatus,    setFilingStatus]    = useState('single');
  const [step2Checkbox,   setStep2Checkbox]   = useState(false);
  const [step3Children,   setStep3Children]   = useState(0);
  const [step3Other,      setStep3Other]      = useState(0);
  const [step4a,          setStep4a]          = useState('');
  const [step4b,          setStep4b]          = useState('');
  const [step4c,          setStep4c]          = useState('');
  const [lineItems,       setLineItems]       = useState([]);
  const [notes,           setNotes]           = useState('');

  // W-4 restore + unsaved-changes tracking
  const [w4Warning,       setW4Warning]       = useState('');
  const [step4Touched,    setStep4Touched]    = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState(null);

  // Tax preview
  const [taxes,       setTaxes]       = useState(null);
  const [calcLoading, setCalcLoading] = useState(false);

  useEffect(() => {
    Promise.all([api.getClient(clientId), api.getPaystub(stubId)])
      .then(async ([c, s]) => {
        setClient(c);
        setStub(s);
        // Pre-populate form
        setPayPeriodStart(s.pay_period_start || '');
        setPayPeriodEnd(s.pay_period_end || '');
        setSettlementDate(s.settlement_date || '');
        setPayFrequency(s.pay_frequency || 'biweekly');
        setWorkState(s.work_state || c.state || 'TX');
        setYtdGross(s.ytd_wages_before > 0 ? String(s.ytd_wages_before) : '');
        setFilingStatus(s.filing_status || 'single');
        setStep2Checkbox(!!s.step2_checkbox);

        // Restore W-4 details. The paystub stores only the combined Step 3 credit
        // total; Step 4 amounts live on the employee record — pull them from there
        // so Save doesn't silently overwrite the stored withholding inputs.
        let emp = null;
        if (s.employee_id) {
          try { emp = await api.getEmployee(s.employee_id); } catch { emp = null; }
        }
        const storedCredits = Math.round(s.step3_credits || 0);
        const empCredits = emp ? (emp.step3Children || 0) * CHILD_CREDIT + (emp.step3Other || 0) * DEPENDENT_CREDIT : null;
        const warnings = [];
        if (emp && empCredits === storedCredits) {
          setStep3Children(emp.step3Children || 0);
          setStep3Other(emp.step3Other || 0);
        } else {
          const split = splitStep3Credits(storedCredits);
          setStep3Children(split.children);
          setStep3Other(split.other);
          if (!split.exact) {
            warnings.push(`Step 3 dependents could not be exactly restored for this check (stored credit total ${fmtAmt(storedCredits)}). Verify the Step 3 fields before saving — Save recalculates withholding from them.`);
          }
        }
        if (emp) {
          setStep4a(emp.step4a > 0 ? String(emp.step4a) : '');
          setStep4b(emp.step4b > 0 ? String(emp.step4b) : '');
          setStep4c(emp.step4c > 0 ? String(emp.step4c) : '');
        } else {
          setStep4a('');
          setStep4b('');
          setStep4c('');
          warnings.push('This check is not linked to an employee record, so W-4 Step 4 amounts (other income, deductions, extra withholding) could not be restored. If the original check used them, re-enter them before saving.');
        }
        setW4Warning(warnings.join(' '));
        setNotes(s.notes || '');
        // Line items
        if (s.lineItems && s.lineItems.length > 0) {
          setLineItems(s.lineItems.map((li) => ({
            payType:     li.pay_type,
            description: li.description || '',
            hours:       li.hours != null ? String(li.hours) : '',
            rate:        li.rate  != null ? String(li.rate)  : '',
            amount:      String(li.amount),
          })));
        } else {
          setLineItems([{ payType: 'regular', description: '', hours: '', rate: '', amount: String(s.gross_wages || '') }]);
        }
      })
      .catch(() => navigate(`/clients/${clientId}/paystubs`))
      .finally(() => setLoading(false));
  }, [clientId, stubId]);

  const grossWages = round2(lineItems.reduce((s, li) => s + parseFloat(li.amount || 0), 0));
  const step3Credits = step3Children * CHILD_CREDIT + step3Other * DEPENDENT_CREDIT;

  // Unsaved-changes detection — compare current form values against the loaded ones
  const formSnapshot = JSON.stringify({
    payPeriodStart, payPeriodEnd, settlementDate, payFrequency, workState, ytdGross,
    filingStatus, step2Checkbox, step3Children, step3Other, step4a, step4b, step4c,
    lineItems, notes,
  });
  const isDirty = initialSnapshot !== null && formSnapshot !== initialSnapshot;

  useEffect(() => {
    if (!loading && stub && initialSnapshot === null) setInitialSnapshot(formSnapshot);
  }, [loading, stub, initialSnapshot, formSnapshot]);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  function handleBack() {
    if (isDirty && !window.confirm('You have unsaved changes to this paycheck. Leave without saving?')) return;
    navigate(-1);
  }

  const recalculate = useCallback(async () => {
    if (!grossWages || grossWages <= 0) { setTaxes(null); return; }
    setCalcLoading(true);
    try {
      const result = await api.calculate({
        grossWages,
        payFrequency,
        filingStatus,
        step2Checkbox,
        step3Children,
        step3Other,
        step4a: parseFloat(step4a || 0),
        step4b: parseFloat(step4b || 0),
        step4c: parseFloat(step4c || 0),
        workState: workState || 'TX',
        ytdGross:  parseFloat(ytdGross || 0),
        sutaRate:  client?.sutaRate ?? null,
      });
      setTaxes(result);
    } catch { setTaxes(null); }
    finally  { setCalcLoading(false); }
  }, [grossWages, payFrequency, filingStatus, step2Checkbox, step3Children, step3Other, step4a, step4b, step4c, workState, ytdGross, client]);

  useEffect(() => {
    const t = setTimeout(recalculate, 400);
    return () => clearTimeout(t);
  }, [recalculate]);

  function updateItem(idx, field, value) {
    setLineItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if ((field === 'hours' || field === 'rate') && updated.hours && updated.rate) {
        const m = updated.payType === 'overtime' ? 1.5 : 1;
        updated.amount = String(round2(parseFloat(updated.hours) * parseFloat(updated.rate) * m));
      }
      if (field === 'payType' && updated.hours && updated.rate) {
        const m = updated.payType === 'overtime' ? 1.5 : 1;
        updated.amount = String(round2(parseFloat(updated.hours) * parseFloat(updated.rate) * m));
      }
      return updated;
    }));
  }

  async function handleSave() {
    if (!payPeriodStart || !payPeriodEnd) { alert('Enter pay period start and end dates.'); return; }
    setSaving(true);
    setSaveResult(null);
    try {
      const items = lineItems.filter((li) => parseFloat(li.amount || 0) > 0);
      const payload = {
        payPeriodStart, payPeriodEnd, settlementDate: settlementDate || null,
        payFrequency, filingStatus, step2Checkbox, step3Children, step3Other,
        lineItems: items,
        workState, ytdGross: parseFloat(ytdGross || 0), notes,
      };
      // Only send Step 4 amounts the user actually edited here. When omitted,
      // the server keeps using the employee's stored W-4 values instead of
      // overwriting them with this form's defaults.
      if (step4Touched) {
        payload.step4a = parseFloat(step4a || 0);
        payload.step4b = parseFloat(step4b || 0);
        payload.step4c = parseFloat(step4c || 0);
      }
      const res = await api.updatePaystub(stubId, payload);
      setStub(res.paystub);
      setSaveResult(res);
      setInitialSnapshot(formSnapshot); // saved — current values are the new baseline
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(taxType) {
    if (!stub) return;
    const status = taxType === '940' ? stub.status_940 : stub.status;
    if (status === 'submitted' || status === 'processing') return; // already deposited or in flight
    const label = taxType === '940' ? 'FUTA (940)' : '941 (FIT + SS + Medicare)';
    if (!window.confirm(`Submit ${label} to EFTPS for this paystub?`)) return;
    setSubmitting(taxType);
    try {
      const res = await api.submitPaystub(stubId, taxType);
      setStub((prev) => ({ ...prev, ...res.paystub }));
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
    </div>
  );

  const is941Submitted  = stub?.status === 'submitted';
  const is940Submitted  = stub?.status_940 === 'submitted';
  const is941Processing = stub?.status === 'processing';
  const is940Processing = stub?.status_940 === 'processing';
  const hasFUTA         = (stub?.futa_tax || 0) > 0 || (taxes?.futaTax || 0) > 0;

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/">Dashboard</Link><span>/</span>
          <Link to={`/clients/${clientId}`}>{client?.businessName}</Link><span>/</span>
          {stub?.employee_id ? (
            <>
              <Link to={`/clients/${clientId}`} state={{ tab: 'employees' }}>Employees</Link><span>/</span>
              <Link to={`/clients/${clientId}/employees/${stub.employee_id}`}>
                {[stub.first_name, stub.last_name].filter(Boolean).join(' ') || 'Employee'}
              </Link><span>/</span>
            </>
          ) : (
            <><Link to={`/clients/${clientId}/paystubs`}>Paystubs</Link><span>/</span></>
          )}
          <span>Edit Paycheck</span>
        </div>
        <div className="page-header-row">
          <div>
            <h2>Edit Paycheck</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              {[stub?.first_name, stub?.last_name].filter(Boolean).join(' ') || client?.businessName}
              {stub?.pay_period_start && ` — ${stub.pay_period_start} to ${stub.pay_period_end}`}
              {stub?.check_number && <span style={{ marginLeft: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 600 }}>Check #{stub.check_number}</span>}
            </p>
          </div>
          <button className="btn btn-secondary" onClick={handleBack}>← Back</button>
        </div>
      </div>

      <div className="page-body">
        {/* Submitted warnings */}
        {(is941Submitted || is940Submitted) && (
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            <span>⚠</span>
            <div>
              <strong>Already submitted:</strong>{' '}
              {[is941Submitted && '941 (federal payroll taxes)', is940Submitted && '940 (FUTA)'].filter(Boolean).join(' and ')}.{' '}
              Edits to this paystub do <strong>not</strong> revise the EFTPS deposit already paid — you must file an amended return separately if amounts change.
            </div>
          </div>
        )}

        {/* Save result */}
        {saveResult && (
          <div className={`alert ${saveResult.warning ? 'alert-warning' : 'alert-success'}`} style={{ marginBottom: 16 }}>
            <span>{saveResult.warning ? '⚠' : '✓'}</span>
            <span>{saveResult.warning || 'Changes saved successfully.'}</span>
          </div>
        )}

        {/* W-4 restore warning */}
        {w4Warning && (
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            <span>⚠</span>
            <span>{w4Warning}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'start' }}>
          {/* Left: form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Pay Period */}
            <div className="card">
              <div className="card-header"><span className="card-title">Pay Period</span></div>
              <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <Field label="Pay Period Start" required>
                  <input className="form-input" type="date" value={payPeriodStart} onChange={(e) => setPayPeriodStart(e.target.value)} />
                </Field>
                <Field label="Pay Period End" required>
                  <input className="form-input" type="date" value={payPeriodEnd} onChange={(e) => setPayPeriodEnd(e.target.value)} />
                </Field>
                <Field label="Settlement Date" hint="EFTPS debit date">
                  <input className="form-input" type="date" value={settlementDate} onChange={(e) => setSettlementDate(e.target.value)} />
                </Field>
                <Field label="Pay Frequency">
                  <select className="form-select" value={payFrequency} onChange={(e) => setPayFrequency(e.target.value)}>
                    {Object.entries(PAY_FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Work State">
                  <select className="form-select" value={workState} onChange={(e) => setWorkState(e.target.value)}>
                    {US_STATES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
                  </select>
                </Field>
                <Field label="YTD Gross (before this period)" hint="Used for SS/FUTA/SUI wage base caps">
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                    <input className="form-input mono" type="number" min="0" step="0.01" value={ytdGross} onChange={(e) => setYtdGross(e.target.value)} placeholder="0.00" style={{ paddingLeft: 24 }} />
                  </div>
                </Field>
              </div>
            </div>

            {/* Pay Line Items */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>Pay Line Items</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLineItems((prev) => [...prev, { payType: 'regular', description: '', hours: '', rate: '', amount: '' }])}>+ Add Line</button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
                      {['Pay Type', 'Description', 'Hours', 'Rate', 'Amount', ''].map((h) => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={{ padding: '8px 10px' }}>
                          <select className="form-select" style={{ fontSize: 12, padding: '5px 8px' }} value={item.payType} onChange={(e) => updateItem(idx, 'payType', e.target.value)}>
                            {PAY_TYPES.map((pt) => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <input className="form-input" style={{ fontSize: 12, padding: '5px 8px' }} placeholder="Optional note" value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} />
                        </td>
                        <td style={{ padding: '8px 10px', width: 80 }}>
                          <input className="form-input mono" style={{ fontSize: 12, padding: '5px 8px' }} type="number" min="0" step="0.25" placeholder="0" value={item.hours} onChange={(e) => updateItem(idx, 'hours', e.target.value)} />
                        </td>
                        <td style={{ padding: '8px 10px', width: 100 }}>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>$</span>
                            <input className="form-input mono" style={{ fontSize: 12, padding: '5px 8px', paddingLeft: 20 }} type="number" min="0" step="0.01" placeholder="0.00" value={item.rate} onChange={(e) => updateItem(idx, 'rate', e.target.value)} />
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', width: 120 }}>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>$</span>
                            <input className="form-input mono" style={{ fontSize: 12, padding: '5px 8px', paddingLeft: 20, fontWeight: 600 }} type="number" min="0" step="0.01" placeholder="0.00" value={item.amount} onChange={(e) => updateItem(idx, 'amount', e.target.value)} />
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <button type="button" aria-label={`Remove pay line ${idx + 1}`} title="Remove line" onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: 'var(--bg-primary)', borderTop: '2px solid var(--border)' }}>
                      <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13 }}>Total Gross Wages</td>
                      <td style={{ padding: '10px 10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>{fmtAmt(grossWages)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* W-4 Fields */}
            <div className="card">
              <div className="card-header"><span className="card-title">W-4 Withholding</span></div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Filing status */}
                <Field label="Filing Status (Step 1)">
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[
                      { v: 'single',  l: 'Single / MFS' },
                      { v: 'married', l: 'Married / QSS' },
                      { v: 'hoh',     l: 'Head of Household' },
                    ].map(({ v, l }) => (
                      <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: `1px solid ${filingStatus === v ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)', background: filingStatus === v ? 'var(--accent-light)' : 'var(--bg-primary)', cursor: 'pointer', fontSize: 13 }}>
                        <input type="radio" name="filingStatus" value={v} checked={filingStatus === v} onChange={() => setFilingStatus(v)} style={{ accentColor: 'var(--accent)' }} />
                        {l}
                      </label>
                    ))}
                  </div>
                </Field>

                {/* Step 2 */}
                <Field label="Step 2 — Multiple Jobs">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: `1px solid ${step2Checkbox ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)', background: step2Checkbox ? 'var(--accent-light)' : 'var(--bg-primary)', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={step2Checkbox} onChange={(e) => setStep2Checkbox(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                    (c) Two jobs total — halves standard deduction and brackets
                  </label>
                </Field>

                {/* Step 3 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label={`Step 3(a) — Qualifying children × $${CHILD_CREDIT.toLocaleString()}`}>
                    <input className="form-input" type="number" min="0" max="20" value={step3Children} onChange={(e) => setStep3Children(parseInt(e.target.value || 0, 10))} style={{ maxWidth: 80 }} />
                  </Field>
                  <Field label={`Step 3(b) — Other dependents × $${DEPENDENT_CREDIT}`}>
                    <input className="form-input" type="number" min="0" max="20" value={step3Other} onChange={(e) => setStep3Other(parseInt(e.target.value || 0, 10))} style={{ maxWidth: 80 }} />
                  </Field>
                </div>

                {/* Step 4 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <Field label="Step 4(a) — Other income (annual)">
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                      <input className="form-input mono" type="number" min="0" value={step4a} onChange={(e) => { setStep4a(e.target.value); setStep4Touched(true); }} placeholder="0" style={{ paddingLeft: 24 }} />
                    </div>
                  </Field>
                  <Field label="Step 4(b) — Deductions (annual)">
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                      <input className="form-input mono" type="number" min="0" value={step4b} onChange={(e) => { setStep4b(e.target.value); setStep4Touched(true); }} placeholder="0" style={{ paddingLeft: 24 }} />
                    </div>
                  </Field>
                  <Field label="Step 4(c) — Extra withholding (per period)">
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                      <input className="form-input mono" type="number" min="0" value={step4c} onChange={(e) => { setStep4c(e.target.value); setStep4Touched(true); }} placeholder="0" style={{ paddingLeft: 24 }} />
                    </div>
                  </Field>
                </div>

                {/* Notes */}
                <Field label="Notes">
                  <textarea className="form-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes (not shown on PDF)" style={{ resize: 'vertical' }} />
                </Field>
              </div>
            </div>

            {/* Submit to EFTPS */}
            <div className="card">
              <div className="card-header"><span className="card-title">EFTPS Submissions</span></div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Form 941 */}
                <SubmissionCard
                  form="941"
                  label="Federal Payroll Taxes"
                  code="94105"
                  detail="FIT + SS + Medicare (quarterly)"
                  amount={fmtAmt(taxes?.totalDeposit ?? stub?.total_deposit)}
                  isSubmitted={is941Submitted}
                  isProcessing={is941Processing}
                  confirmation={stub?.eftps_confirmation}
                  submittedAt={stub?.submitted_at}
                  onSubmit={() => handleSubmit('941')}
                  submitting={submitting === '941'}
                  anySubmitting={submitting !== null}
                />

                {/* Form 940 */}
                {hasFUTA && (
                  <SubmissionCard
                    form="940"
                    label="FUTA Tax"
                    code="94007"
                    detail="Federal Unemployment (annual)"
                    amount={fmtAmt(taxes?.futaTax ?? stub?.futa_tax)}
                    isSubmitted={is940Submitted}
                    isProcessing={is940Processing}
                    confirmation={stub?.eftps_940_confirmation}
                    submittedAt={stub?.eftps_940_submitted_at}
                    onSubmit={() => handleSubmit('940')}
                    submitting={submitting === '940'}
                    anySubmitting={submitting !== null}
                  />
                )}

                {/* SUI */}
                {((taxes?.sutaTax || stub?.suta_tax) || 0) > 0 && (
                  <div style={{ padding: '12px 16px', border: '1px solid #fde68a', borderRadius: 'var(--radius)', background: '#fefce8' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>!</div>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>SUI — State Unemployment Insurance</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14, color: '#92400e', marginLeft: 'auto' }}>{fmtAmt(taxes?.sutaTax ?? stub?.suta_tax)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.6 }}>
                      <strong>Not submitted via EFTPS.</strong> Your {stub?.work_state || workState} SUI is due through your state unemployment agency (TWC in TX, EDD in CA, etc.). File directly through their online portal.
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  EFTPS pays the tax deposits only — it does not file the quarterly Form 941 or annual Form 940 return.{' '}
                  <Link to={`/reports?clientId=${clientId}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>Generate returns on the File Forms page →</Link>
                </div>

              </div>
            </div>

          </div>

          {/* Right: tax preview */}
          <div style={{ position: 'sticky', top: 24 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Tax Preview</div>
              <TaxPreview taxes={taxes} loading={calcLoading} />
            </div>
          </div>
        </div>

        {/* Bottom action bar */}
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end',
          padding: '20px 0', borderTop: '1px solid var(--border)', marginTop: 8,
        }}>
          <button className="btn btn-secondary" onClick={handleBack}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 130 }}>
            {saving ? <><span className="spinner" /> Saving…</> : 'Save Changes'}
          </button>
          <button
            className="btn btn-success"
            onClick={() => handleSubmit('941')}
            disabled={submitting !== null || is941Submitted || is941Processing}
            style={{ minWidth: 130 }}
          >
            {submitting === '941' ? <span className="spinner" /> : is941Submitted ? '✓ 941 Deposited' : is941Processing ? 'Processing…' : 'Submit 941'}
          </button>
          {hasFUTA && (
            <button
              className="btn btn-success"
              onClick={() => handleSubmit('940')}
              disabled={submitting !== null || is940Submitted || is940Processing}
              style={{ minWidth: 130 }}
            >
              {submitting === '940' ? <span className="spinner" /> : is940Submitted ? '✓ 940 Deposited' : is940Processing ? 'Processing…' : 'Submit 940'}
            </button>
          )}
        </div>

      </div>
    </>
  );
}
