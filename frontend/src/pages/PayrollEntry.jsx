import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

const CHILD_CREDIT     = 2200;
const DEPENDENT_CREDIT = 500;

const NO_SIT_STATES = new Set(['AK','FL','NV','NH','SD','TN','TX','WA','WY']);

const PAY_FREQ_LABELS = {
  weekly:      'Weekly (52×/yr)',
  biweekly:    'Bi-weekly (26×/yr)',
  semimonthly: 'Semi-monthly (24×/yr)',
  monthly:     'Monthly (12×/yr)',
};

const PAY_TYPES = [
  { value: 'regular',    label: 'Regular Pay' },
  { value: 'salary',     label: 'Salary' },
  { value: 'overtime',   label: 'Overtime (×1.5)' },
  { value: 'holiday',    label: 'Holiday Pay' },
  { value: 'commission', label: 'Commission' },
  { value: 'piecework',  label: 'Piecework' },
  { value: 'sick',       label: 'Sick Pay' },
];

function fmtAmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// ── W-4 Step Header ──────────────────────────────────────────────────────────
function W4Step({ number, title, subtitle, children, optional }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      marginBottom: 14,
      background: 'var(--bg-secondary)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', borderBottom: '1px solid var(--border)' }}>
        <div style={{
          background: 'var(--bg-primary)',
          padding: '14px 16px',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 2 }}>
            Step {number}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', lineHeight: 1.3 }}>{title}</div>
          {optional && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>Optional</div>}
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  );
}

// ── Tax Breakdown Panel ───────────────────────────────────────────────────────
function SectionHeader({ label }) {
  return (
    <div style={{ padding: '6px 18px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-primary)' }}>
      {label}
    </div>
  );
}

function TaxPanel({ taxes, loading, error }) {
  const hasAdditionalMedicare = taxes?.additionalMedicare > 0;
  const hasSIT = taxes?.stateIncomeTax > 0;
  const hasFUTA = taxes?.futaTax > 0;
  const hasSUTA = taxes?.sutaTax > 0;

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      position: 'sticky',
      top: 24,
      maxHeight: 'calc(100vh - 48px)',
      overflowY: 'auto',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Tax Breakdown</span>
        {loading && <div className="spinner spinner-dark" style={{ width: 16, height: 16 }} />}
      </div>

      {error && (
        <div style={{ padding: '12px 18px' }}>
          <div className="alert alert-error" style={{ fontSize: 12 }}>⚠ {error}</div>
        </div>
      )}

      {!taxes && !loading && !error && (
        <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Add pay line items to preview
        </div>
      )}

      {taxes && (
        <>
          {/* Gross wages */}
          <div style={{ padding: '12px 18px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Gross Wages</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
              {fmtAmt(taxes.grossWages)}
            </div>
            {taxes.workState && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Work state: <strong>{taxes.workState}</strong>
                {taxes.ytdGrossBefore > 0 && <> · YTD before: <strong>{fmtAmt(taxes.ytdGrossBefore)}</strong></>}
              </div>
            )}
          </div>

          {/* Employee withholdings */}
          <SectionHeader label="Employee Withholdings" />
          <BreakRow label="Federal Income Tax" sub="W-4 Percentage Method" amount={taxes.fitWithholding} />
          <BreakRow
            label={`Social Security${taxes.ssWagesThisPeriod < taxes.grossWages ? ' (partial — wage base)' : ''}`}
            sub={`6.2% · base $${(taxes.ssWageBase || 176100).toLocaleString()}`}
            amount={taxes.employeeSS}
            dimmed={taxes.ssWagesThisPeriod === 0}
          />
          <BreakRow label="Medicare" sub="1.45% — no wage limit" amount={taxes.employeeMedicare} />
          {hasAdditionalMedicare && (
            <BreakRow label="Additional Medicare" sub="0.9% on wages over $200K" amount={taxes.additionalMedicare} />
          )}
          {hasSIT && (
            <BreakRow
              label={`${taxes.workState} Income Tax`}
              sub="State withholding"
              amount={taxes.stateIncomeTax}
            />
          )}

          {/* Net pay */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 18px',
            background: 'rgba(16,185,129,0.07)',
            borderTop: '1px solid rgba(16,185,129,0.2)',
            borderBottom: '1px solid rgba(16,185,129,0.2)',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Net Pay to Employee</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>After all employee deductions</div>
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 700, color: 'var(--success)' }}>
              {fmtAmt(taxes.netPay)}
            </div>
          </div>

          {/* Employer FICA */}
          <SectionHeader label="Employer FICA (EFTPS)" />
          <BreakRow label="SS Match" sub="6.2% employer share" amount={taxes.employerSS} />
          <BreakRow label="Medicare Match" sub="1.45% employer share" amount={taxes.employerMedicare} />

          {/* Total EFTPS deposit */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '13px 18px',
            background: 'var(--bg-tertiary)',
            borderTop: '2px solid var(--border)',
          }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13.5 }}>Total EFTPS Deposit</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>FIT + FICA (employee + employer)</div>
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 19, fontWeight: 700, color: 'var(--accent)' }}>
              {fmtAmt(taxes.totalDeposit)}
            </div>
          </div>

          {/* Employer-only state/federal taxes (not part of EFTPS 941 deposit) */}
          {(hasFUTA || hasSUTA) && (
            <>
              <SectionHeader label="Employer-Only Taxes (not in 941 deposit)" />
              {hasFUTA && (
                <BreakRow
                  label={`FUTA${taxes.futaTaxable < taxes.grossWages ? ' (partial — wage base)' : ''}`}
                  sub={`0.6% net · $7,000 wage base${taxes.futaTaxable === 0 ? ' — wage base reached' : ''}`}
                  amount={taxes.futaTax}
                  dimmed={taxes.futaTaxable === 0}
                />
              )}
              {hasSUTA && (
                <BreakRow
                  label={`SUI — ${taxes.workState}${taxes.sutaTaxable < taxes.grossWages ? ' (partial)' : ''}`}
                  sub={`${((taxes.sutaRate || 0) * 100).toFixed(2)}% · $${(taxes.suiWageBase || 0).toLocaleString()} base`}
                  amount={taxes.sutaTax}
                  dimmed={taxes.sutaTaxable === 0}
                />
              )}
            </>
          )}
          {!hasFUTA && !hasSUTA && taxes.ytdGrossBefore >= 7000 && (
            <div style={{ padding: '10px 18px', fontSize: 11.5, color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)', background: 'var(--bg-primary)' }}>
              FUTA/SUI wage bases reached — no additional liability this period.
            </div>
          )}

          {taxes.credits > 0 && (
            <div style={{ padding: '10px 18px', fontSize: 11.5, color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)', background: 'var(--bg-primary)' }}>
              Step 3 credits: <strong style={{ color: 'var(--success)' }}>{fmtAmt(taxes.credits)}</strong> applied against annual FIT
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BreakRow({ label, sub, amount, dimmed }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 18px', borderBottom: '1px solid var(--border-light)',
      opacity: dimmed ? 0.5 : 1,
    }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13.5, fontWeight: 600, color: dimmed ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {fmtAmt(amount)}
      </div>
    </div>
  );
}

// ── Pay Line Items Table ──────────────────────────────────────────────────────
function LineItemsTable({ items, onChange }) {
  function addItem() {
    onChange([...items, { payType: 'regular', description: '', hours: '', rate: '', amount: '' }]);
  }

  function updateItem(idx, field, value) {
    const next = items.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      // Auto-calculate amount when hours + rate are set (except for overtime which uses ×1.5)
      if ((field === 'hours' || field === 'rate') && updated.hours && updated.rate) {
        const multiplier = updated.payType === 'overtime' ? 1.5 : 1;
        updated.amount = String(round2(parseFloat(updated.hours) * parseFloat(updated.rate) * multiplier));
      }
      // On payType change, recalc if hours+rate present
      if (field === 'payType' && updated.hours && updated.rate) {
        const multiplier = updated.payType === 'overtime' ? 1.5 : 1;
        updated.amount = String(round2(parseFloat(updated.hours) * parseFloat(updated.rate) * multiplier));
      }
      return updated;
    });
    onChange(next);
  }

  function removeItem(idx) {
    onChange(items.filter((_, i) => i !== idx));
  }

  const total = items.reduce((s, li) => s + parseFloat(li.amount || 0), 0);

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      overflow: 'hidden', background: 'var(--bg-secondary)',
    }}>
      <div style={{
        padding: '12px 20px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 13 }}>Pay Line Items</span>
        </div>
        <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={addItem}>
          + Add Line
        </button>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No pay items yet. Click &ldquo;+ Add Line&rdquo; to add regular pay, overtime, etc.
        </div>
      ) : (
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
              {items.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <select
                      className="form-select"
                      style={{ fontSize: 12, padding: '5px 8px' }}
                      value={item.payType}
                      onChange={(e) => updateItem(idx, 'payType', e.target.value)}
                    >
                      {PAY_TYPES.map((pt) => (
                        <option key={pt.value} value={pt.value}>{pt.label}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <input
                      className="form-input"
                      style={{ fontSize: 12, padding: '5px 8px' }}
                      placeholder="Optional note"
                      value={item.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                    />
                  </td>
                  <td style={{ padding: '8px 10px', width: 80 }}>
                    <input
                      className="form-input mono"
                      style={{ fontSize: 12, padding: '5px 8px' }}
                      type="number" min="0" step="0.25" placeholder="0"
                      value={item.hours}
                      onChange={(e) => updateItem(idx, 'hours', e.target.value)}
                    />
                  </td>
                  <td style={{ padding: '8px 10px', width: 100 }}>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>$</span>
                      <input
                        className="form-input mono"
                        style={{ fontSize: 12, padding: '5px 8px', paddingLeft: 20 }}
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={item.rate}
                        onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                      />
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', width: 120 }}>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>$</span>
                      <input
                        className="form-input mono"
                        style={{ fontSize: 12, padding: '5px 8px', paddingLeft: 20, fontWeight: 600 }}
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={item.amount}
                        onChange={(e) => updateItem(idx, 'amount', e.target.value)}
                      />
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                      title="Remove"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg-primary)', borderTop: '2px solid var(--border)' }}>
                <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13 }}>Total Gross Wages</td>
                <td style={{ padding: '10px 10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>
                  {fmtAmt(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PayrollEntry() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient]     = useState(null);
  const [employees, setEmployees] = useState([]);
  const [step, setStep]         = useState(1);

  // Employee + period
  const [employeeId,    setEmployeeId]    = useState('');
  const [payPeriodStart, setPayPeriodStart] = useState('');
  const [payPeriodEnd,   setPayPeriodEnd]   = useState('');
  const [settlementDate, setSettlementDate] = useState('');
  const [payFrequency,   setPayFrequency]   = useState('biweekly');

  // State tax params
  const [workState,  setWorkState]  = useState('');
  const [ytdGross,   setYtdGross]   = useState('');
  const [ytdLoading, setYtdLoading] = useState(false);

  // Pay line items
  const [lineItems, setLineItems] = useState([
    { payType: 'regular', description: '', hours: '', rate: '', amount: '' },
  ]);

  // W-4 fields (auto-fill from selected employee)
  const [filingStatus,  setFilingStatus]  = useState('single');
  const [step2Checkbox, setStep2Checkbox] = useState(false);
  const [step3Children, setStep3Children] = useState(0);
  const [step3Other,    setStep3Other]    = useState(0);
  const [step4a, setStep4a] = useState('');
  const [step4b, setStep4b] = useState('');
  const [step4c, setStep4c] = useState('');

  // Calculation state
  const [taxes,       setTaxes]       = useState(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError,   setCalcError]   = useState('');

  // Submission state
  const [submission,      setSubmission]      = useState(null);
  const [saving,          setSaving]          = useState(false);
  const [savingPaystub,   setSavingPaystub]   = useState(false);
  const [submitting,      setSubmitting]      = useState(false);
  const [submitResult,    setSubmitResult]    = useState(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);

  useEffect(() => {
    api.getClient(id).then((c) => { setClient(c); setWorkState(c.state || 'TX'); }).catch(() => navigate('/'));
    api.getEmployees(id).then(setEmployees).catch(() => {});
    const checkBridge = () => api.getBridgeStatus().then((d) => setBridgeConnected(d.connected)).catch(() => {});
    checkBridge();
    const t = setInterval(checkBridge, 10000);
    return () => clearInterval(t);
  }, [id]);

  // When employee is selected, prefill W-4 defaults + fetch YTD wages
  useEffect(() => {
    if (!employeeId) {
      setWorkState(client?.state || 'TX');
      setYtdGross('');
      return;
    }
    const emp = employees.find((e) => String(e.id) === String(employeeId));
    if (!emp) return;
    setFilingStatus(emp.filingStatus || 'single');
    setStep2Checkbox(!!emp.step2Checkbox);
    setStep3Children(emp.step3Children || 0);
    setStep3Other(emp.step3Other || 0);
    setStep4a(emp.step4a > 0 ? String(emp.step4a) : '');
    setStep4b(emp.step4b > 0 ? String(emp.step4b) : '');
    setStep4c(emp.step4c > 0 ? String(emp.step4c) : '');
    setPayFrequency(emp.payFrequency || 'biweekly');
    setWorkState(emp.workState || client?.state || 'TX');
    if (emp.payType === 'hourly' && emp.hourlyRate > 0) {
      setLineItems([{ payType: 'regular', description: '', hours: '', rate: String(emp.hourlyRate), amount: '' }]);
    } else if (emp.payType === 'salary' && emp.annualSalary > 0) {
      const periods = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
      const perPeriod = round2(emp.annualSalary / (periods[emp.payFrequency] || 26));
      setLineItems([{ payType: 'salary', description: 'Salary', hours: '', rate: '', amount: String(perPeriod) }]);
    }
    // Fetch YTD wages for current tax year
    const year = new Date().getFullYear();
    setYtdLoading(true);
    api.getEmployeeYTD(emp.id, year)
      .then((ytd) => { setYtdGross(ytd.ytd_gross > 0 ? String(ytd.ytd_gross) : ''); })
      .catch(() => {})
      .finally(() => setYtdLoading(false));
  }, [employeeId, employees]);

  const grossWages = round2(lineItems.reduce((s, li) => s + parseFloat(li.amount || 0), 0));
  const step3Credits = step3Children * CHILD_CREDIT + step3Other * DEPENDENT_CREDIT;

  const calculate = useCallback(async () => {
    if (!grossWages || grossWages <= 0) { setTaxes(null); return; }
    setCalcLoading(true);
    setCalcError('');
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
    } catch (err) {
      setCalcError(err.message);
      setTaxes(null);
    } finally {
      setCalcLoading(false);
    }
  }, [grossWages, payFrequency, filingStatus, step2Checkbox, step3Children, step3Other, step4a, step4b, step4c, workState, ytdGross, client]);

  useEffect(() => {
    const t = setTimeout(calculate, 350);
    return () => clearTimeout(t);
  }, [calculate]);

  async function handleSave() {
    if (!taxes) { alert('Complete pay line items to generate a tax calculation.'); return; }
    if (!payPeriodStart || !payPeriodEnd) { alert('Enter the pay period start and end dates.'); return; }
    setSaving(true);
    try {
      const items = lineItems.filter((li) => parseFloat(li.amount || 0) > 0);
      const sub = await api.createSubmission({
        clientId: id,
        employeeId: employeeId || null,
        payPeriodStart,
        payPeriodEnd,
        settlementDate: settlementDate || null,
        filingStatus,
        payFrequency,
        step2Checkbox,
        step3Children,
        step3Other,
        step4a: parseFloat(step4a || 0),
        step4b: parseFloat(step4b || 0),
        step4c: parseFloat(step4c || 0),
        lineItems: items,
        workState: workState || null,
        ytdGross:  parseFloat(ytdGross || 0),
      });
      setSubmission(sub);
      setStep(3);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEFTPSSubmit() {
    if (!submission) return;
    setSubmitting(true);
    try {
      const result = await api.submitToEFTPS(submission.id);
      setSubmitResult(result);
    } catch (err) {
      setSubmitResult({ error: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveAsPaystub() {
    if (!taxes) { alert('Complete pay line items to generate a tax calculation.'); return; }
    if (!payPeriodStart || !payPeriodEnd) { alert('Enter the pay period start and end dates.'); return; }
    setSavingPaystub(true);
    try {
      const items = lineItems.filter((li) => parseFloat(li.amount || 0) > 0);
      await api.createPaystub({
        clientId: id,
        employeeId: employeeId || null,
        payPeriodStart,
        payPeriodEnd,
        settlementDate: settlementDate || null,
        filingStatus,
        payFrequency,
        step2Checkbox,
        step3Children,
        step3Other,
        step4a: parseFloat(step4a || 0),
        step4b: parseFloat(step4b || 0),
        step4c: parseFloat(step4c || 0),
        lineItems: items,
        workState: workState || null,
        ytdGross:  parseFloat(ytdGross || 0),
      });
      navigate(`/clients/${id}/paystubs`);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingPaystub(false);
    }
  }

  async function handleBridgeSubmit() {
    if (!submission) return;
    setSubmitting(true);
    try {
      const result = await api.submitViaBridge(submission.id);
      setSubmitResult(result);
    } catch (err) {
      setSubmitResult({ error: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  if (!client) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/">Dashboard</Link><span>/</span>
          <Link to={`/clients/${id}`}>{client.businessName}</Link><span>/</span>
          <span>New Payroll Entry</span>
        </div>
        <div className="page-header-row">
          <div>
            <h2>Payroll Tax Entry</h2>
            <p>{client.businessName} — EIN: {client.ein}</p>
          </div>
          {step === 1 && taxes && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary btn-lg" onClick={handleSaveAsPaystub} disabled={savingPaystub || !payPeriodStart || !payPeriodEnd}>
                {savingPaystub ? <><span className="spinner" /> Saving…</> : 'Save as Paystub'}
              </button>
              <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving || !payPeriodStart || !payPeriodEnd}>
                {saving ? <><span className="spinner" /> Saving…</> : 'Review & Submit to EFTPS →'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="page-body">
        {/* Step indicator */}
        <div className="steps" style={{ marginBottom: 24 }}>
          <div className={`step${step >= 1 ? (step > 1 ? ' done' : ' active') : ''}`}>
            <div className="step-num">{step > 1 ? '✓' : '1'}</div>
            <div className="step-label">Payroll & W-4</div>
          </div>
          <div className="step-connector" />
          <div className={`step${step >= 3 ? ' active' : ''}`}>
            <div className="step-num">2</div>
            <div className="step-label">Submit to EFTPS</div>
          </div>
        </div>

        {/* ── Form + Live Preview ─────────────────────────────────────────── */}
        {step === 1 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
            <div>

              {/* Employee + Period */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--bg-secondary)', marginBottom: 14 }}>
                <div style={{ padding: '12px 20px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>Pay Period & Employee</span>
                </div>
                <div style={{ padding: '18px 20px' }}>
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Employee</label>
                      <select className="form-select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                        <option value="">— No specific employee —</option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>{e.fullName}</option>
                        ))}
                      </select>
                      {employees.length === 0 && (
                        <p className="form-hint">
                          <Link to={`/clients/${id}/employees/new`}>Add employees</Link> to enable per-employee payroll tracking.
                        </p>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Pay Frequency</label>
                      <select className="form-select" value={payFrequency} onChange={(e) => setPayFrequency(e.target.value)}>
                        {Object.entries(PAY_FREQ_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 4, marginBottom: 4 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Work State <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(for state taxes)</span></label>
                      <select className="form-select" value={workState} onChange={(e) => setWorkState(e.target.value)}>
                        {[['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['DC','D.C.']].map(([code, name]) => (
                          <option key={code} value={code}>{code} — {name}</option>
                        ))}
                      </select>
                      {NO_SIT_STATES.has(workState) && (
                        <p className="form-hint">{workState} has no state income tax.</p>
                      )}
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">
                        YTD Gross Wages (before this period)
                        {ytdLoading && <span className="spinner spinner-dark" style={{ width: 12, height: 12, marginLeft: 6 }} />}
                      </label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                        <input className="form-input mono" type="number" min="0" step="0.01" value={ytdGross}
                          onChange={(e) => setYtdGross(e.target.value)} placeholder="0.00" style={{ paddingLeft: 24 }} />
                      </div>
                      <p className="form-hint">Used to apply SS ($176,100), FUTA ($7,000), and SUI wage base caps correctly.</p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 4 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Pay Period Start <span style={{ color: 'var(--error)' }}>*</span></label>
                      <input className="form-input" type="date" value={payPeriodStart} onChange={(e) => setPayPeriodStart(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Pay Period End <span style={{ color: 'var(--error)' }}>*</span></label>
                      <input className="form-input" type="date" value={payPeriodEnd} onChange={(e) => setPayPeriodEnd(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Settlement Date</label>
                      <input className="form-input" type="date" value={settlementDate} onChange={(e) => setSettlementDate(e.target.value)} />
                      <p className="form-hint">EFTPS debit date (≥2 banking days out)</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Pay line items */}
              <div style={{ marginBottom: 14 }}>
                <LineItemsTable items={lineItems} onChange={setLineItems} />
              </div>

              {/* W-4 label */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 6,
                padding: '10px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              }}>
                <div style={{ background: 'var(--accent)', color: '#fff', fontWeight: 800, fontSize: 15, padding: '4px 10px', borderRadius: 4, letterSpacing: '-0.3px' }}>W-4</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Employee's Withholding Certificate</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Form W-4 (2026) — IRS Percentage Method</div>
                </div>
                <div style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 18, color: 'var(--text-muted)' }}>2026</div>
              </div>

              {/* Step 1: Filing Status */}
              <W4Step number="1" title="Enter Personal Information" subtitle="Filing status determines your standard deduction and tax rate">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { value: 'single',  label: 'Single or Married filing separately' },
                    { value: 'married', label: 'Married filing jointly or Qualifying surviving spouse' },
                    { value: 'hoh',     label: 'Head of household', hint: "Check only if you're unmarried and pay more than half the costs of keeping up a home for yourself and a qualifying individual." },
                  ].map(({ value, label, hint }) => (
                    <label key={value} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
                      borderRadius: 'var(--radius)',
                      border: `1px solid ${filingStatus === value ? 'var(--accent)' : 'var(--border)'}`,
                      background: filingStatus === value ? 'var(--accent-light)' : 'var(--bg-primary)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                      <input type="radio" name="filingStatus" value={value} checked={filingStatus === value}
                        onChange={() => setFilingStatus(value)}
                        style={{ marginTop: 2, accentColor: 'var(--accent)', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: filingStatus === value ? 600 : 400, color: 'var(--text-primary)' }}>{label}</div>
                        {hint && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{hint}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              </W4Step>

              {/* Step 2: Multiple jobs */}
              <W4Step number="2" title="Multiple Jobs or Spouse Works" subtitle="Complete if you hold more than one job at a time, or are married filing jointly and your spouse also works" optional>
                <label style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                  borderRadius: 'var(--radius)',
                  border: `1px solid ${step2Checkbox ? 'var(--accent)' : 'var(--border)'}`,
                  background: step2Checkbox ? 'var(--accent-light)' : 'var(--bg-primary)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  <input type="checkbox" checked={step2Checkbox} onChange={(e) => setStep2Checkbox(e.target.checked)}
                    style={{ marginTop: 2, accentColor: 'var(--accent)', width: 15, height: 15, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>(c) Two jobs total — check this box</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                      If there are only two jobs total, you may check this box. Do the same on Form W-4 for the other job.
                      This option is accurate when both jobs have similar pay. Checking this box{' '}
                      <strong style={{ color: 'var(--warning)' }}>halves the standard deduction and tax brackets</strong>{' '}
                      for this job's withholding calculation.
                    </div>
                  </div>
                </label>
                {step2Checkbox && (
                  <div className="alert alert-warning" style={{ marginTop: 10, fontSize: 12 }}>
                    Complete Steps 3–4 on only ONE W-4 (the highest-paying job). Leave those steps blank for the other job.
                  </div>
                )}
              </W4Step>

              {/* Step 3: Dependents */}
              <W4Step number="3" title="Claim Dependent and Other Credits" subtitle="If your total income will be $200,000 or less ($400,000 or less if married filing jointly)" optional>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label className="form-label">(a) Qualifying children under age 17 <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>× $2,200</span></label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input className="form-input" type="number" min="0" max="20" value={step3Children}
                        onChange={(e) => setStep3Children(parseInt(e.target.value || 0, 10))} style={{ maxWidth: 80 }} />
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
                        = {fmtAmt(step3Children * CHILD_CREDIT)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="form-label">(b) Other dependents <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>× $500</span></label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input className="form-input" type="number" min="0" max="20" value={step3Other}
                        onChange={(e) => setStep3Other(parseInt(e.target.value || 0, 10))} style={{ maxWidth: 80 }} />
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
                        = {fmtAmt(step3Other * DEPENDENT_CREDIT)}
                      </div>
                    </div>
                  </div>
                </div>
                {step3Credits > 0 && (
                  <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--success-light)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 500 }}>Total Step 3 credits (line 3)</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>{fmtAmt(step3Credits)}</span>
                  </div>
                )}
              </W4Step>

              {/* Step 4: Other adjustments */}
              <W4Step number="4" title="Other Adjustments" subtitle="Fine-tune withholding for additional income, deductions, or extra withholding per period" optional>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { key: 'step4a', val: step4a, set: setStep4a, letter: '(a)', title: 'Other income (not from jobs)', hint: 'If you want tax withheld for other income you expect this year — interest, dividends, retirement income. Enter the annual amount.', note: '4(a) annual' },
                    { key: 'step4b', val: step4b, set: setStep4b, letter: '(b)', title: 'Deductions', hint: 'Use the Deductions Worksheet (W-4 page 4) if you expect to claim deductions other than the standard deduction. Enter the result here to reduce withholding.', note: '4(b) annual' },
                    { key: 'step4c', val: step4c, set: setStep4c, letter: '(c)', title: 'Extra withholding', hint: 'Enter any additional tax you want withheld each pay period. This is also where the Multiple Jobs Worksheet result (Step 2b, line 4) is entered.', note: '4(c) per period' },
                  ].map(({ key, val, set, letter, title, hint, note }, i) => (
                    <div key={key}>
                      {i > 0 && <div style={{ height: 1, background: 'var(--border-light)', marginBottom: 14 }} />}
                      <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 12, alignItems: 'start' }}>
                        <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 14, paddingTop: 1 }}>{letter}</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{title}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{hint}</div>
                        </div>
                        <div style={{ minWidth: 140 }}>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                            <input className="form-input mono" type="number" min="0" step={key === 'step4c' ? '1' : '100'}
                              value={val} onChange={(e) => set(e.target.value)} placeholder="0" style={{ paddingLeft: 24 }} />
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3, textAlign: 'right' }}>{note}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </W4Step>

              {/* Save bottom */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, gap: 12, flexWrap: 'wrap' }}>
                <Link to={`/clients/${id}`} className="btn btn-secondary">Cancel</Link>
                <button className="btn btn-secondary btn-lg" onClick={handleSaveAsPaystub}
                  disabled={savingPaystub || !taxes || !payPeriodStart || !payPeriodEnd}>
                  {savingPaystub ? <><span className="spinner" /> Saving…</> : 'Save as Paystub'}
                </button>
                <button className="btn btn-primary btn-lg" onClick={handleSave}
                  disabled={saving || !taxes || !payPeriodStart || !payPeriodEnd}>
                  {saving ? <><span className="spinner" /> Saving…</> : 'Review & Submit to EFTPS →'}
                </button>
              </div>
            </div>

            {/* Right: live tax preview */}
            <TaxPanel taxes={taxes} loading={calcLoading} error={calcError} />
          </div>
        )}

        {/* ── EFTPS Submission step ──────────────────────────────────────── */}
        {step === 3 && submission && (
          <div style={{ maxWidth: 640 }}>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                Submission Summary — {client.businessName}
              </div>

              {/* Meta grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', borderBottom: '1px solid var(--border)' }}>
                {[
                  { label: 'Filing Status', value: { single: 'Single / MFS', married: 'Married / QSS', hoh: 'Head of Household' }[submission.filing_status] },
                  { label: 'Pay Frequency', value: submission.pay_frequency.charAt(0).toUpperCase() + submission.pay_frequency.slice(1) },
                  { label: 'Work State', value: submission.work_state || '—' },
                  { label: 'Step 3 Credits', value: fmtAmt(submission.step3_credits) },
                  { label: 'Settlement Date', value: submission.settlement_date || '(not set)' },
                  { label: 'Tax Period', value: `Q${submission.tax_quarter} ${submission.tax_year}` },
                ].map(({ label, value }) => (
                  <div key={label} style={{ padding: '10px 16px', borderRight: '1px solid var(--border-light)' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginTop: 3 }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Line items */}
              {submission.lineItems && submission.lineItems.length > 0 && (
                <div style={{ borderBottom: '1px solid var(--border)' }}>
                  <div style={{ padding: '8px 20px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--bg-primary)' }}>
                    Pay Line Items
                  </div>
                  {submission.lineItems.map((li, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 20px', borderBottom: '1px solid var(--border-light)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {PAY_TYPES.find((pt) => pt.value === li.pay_type)?.label || li.pay_type}
                        {li.description ? ` — ${li.description}` : ''}
                        {li.hours ? ` (${li.hours}h)` : ''}
                      </span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 13 }}>{fmtAmt(li.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tax amounts */}
              {[
                { label: 'Gross Wages', amount: submission.gross_wages },
                { label: 'Federal Income Tax Withholding', amount: submission.fit_withholding, accent: true },
                { label: 'Social Security (employee + employer)', amount: (submission.employee_ss || 0) + (submission.employer_ss || 0) },
                { label: 'Medicare (employee + employer)', amount: (submission.employee_medicare || 0) + (submission.employer_medicare || 0) },
                ...(submission.state_income_tax > 0 ? [{ label: `${submission.work_state || ''} State Income Tax`, amount: submission.state_income_tax }] : []),
                { label: 'Net Pay to Employee', amount: submission.net_pay, success: true },
              ].map(({ label, amount, accent, success }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 20px', borderBottom: '1px solid var(--border-light)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 13.5, color: accent ? 'var(--accent)' : success ? 'var(--success)' : 'var(--text-primary)' }}>
                    {fmtAmt(amount)}
                  </span>
                </div>
              ))}
              {/* Employer-only taxes */}
              {((submission.futa_tax || 0) > 0 || (submission.suta_tax || 0) > 0) && (
                <div style={{ padding: '8px 20px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Employer-Only Taxes (not in 941 deposit)</div>
                  {(submission.futa_tax || 0) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>FUTA (0.6% net)</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>{fmtAmt(submission.futa_tax)}</span>
                    </div>
                  )}
                  {(submission.suta_tax || 0) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>SUI — {submission.work_state || ''}</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>{fmtAmt(submission.suta_tax)}</span>
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 20px', background: 'var(--bg-tertiary)', borderTop: '2px solid var(--border)' }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>Total EFTPS Deposit</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 20, color: 'var(--accent)' }}>
                  {fmtAmt(submission.total_deposit)}
                </span>
              </div>

              <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-primary)', display: 'flex', gap: 20 }}>
                <span>Pay period: {submission.pay_period_start} — {submission.pay_period_end}</span>
                <span>EIN: {client.ein}</span>
              </div>
            </div>

            {!submitResult && (
              <>
                {bridgeConnected ? (
                  <div className="alert" style={{ marginBottom: 16, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', color: 'var(--text-primary)' }}>
                    <span style={{ color: '#10b981' }}>●</span>
                    <div>
                      <strong style={{ color: '#10b981' }}>ACH Bridge connected</strong> — Computer 2 is online.
                      Use <em>Submit via ACH Bridge</em> to generate and deliver an ACH CCD+ file directly to EFTPS Batch Provider.
                    </div>
                  </div>
                ) : (
                  <div className="alert alert-info" style={{ marginBottom: 16 }}>
                    <span>ℹ</span>
                    <div>
                      Clicking Submit launches a Playwright browser session to log into <strong>eftps.gov</strong> and file this deposit.
                      To use ACH Batch Provider instead, start the bridge service on Computer 2.
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Link to={`/clients/${id}/submissions`} className="btn btn-secondary">Save for Later</Link>
                  {bridgeConnected && (
                    <button className="btn btn-success btn-lg" onClick={handleBridgeSubmit} disabled={submitting} style={{ flex: 1, justifyContent: 'center' }}>
                      {submitting ? <><span className="spinner" /> Submitting via Bridge…</> : '⟳ Submit via ACH Bridge'}
                    </button>
                  )}
                  <button
                    className="btn btn-lg"
                    onClick={handleEFTPSSubmit}
                    disabled={submitting}
                    style={{ flex: 1, justifyContent: 'center', background: bridgeConnected ? 'var(--bg-secondary)' : 'var(--success)', color: bridgeConnected ? 'var(--text-secondary)' : '#fff', border: '1px solid var(--border)' }}
                  >
                    {submitting ? <><span className="spinner" /> Submitting to EFTPS…</> : '⟳ Submit via EFTPS.gov'}
                  </button>
                </div>
              </>
            )}

            {submitResult && (
              <div
                className={`alert ${submitResult.submission?.eftps_status === 'submitted' || submitResult.submission?.eftps_status === 'dry_run' ? 'alert-success' : 'alert-error'}`}
                style={{ flexDirection: 'column', gap: 10 }}
              >
                {(submitResult.submission?.eftps_status === 'submitted' || submitResult.submission?.eftps_status === 'dry_run') ? (
                  <>
                    <strong>✓ {submitResult.submission.eftps_status === 'dry_run' ? 'Dry Run Complete' : 'Successfully Submitted'}</strong>
                    <div>Confirmation: <span style={{ fontFamily: 'monospace' }}>{submitResult.submission.eftps_confirmation || '—'}</span></div>
                    {submitResult.bridgeResult?.achFilePath && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        ACH file: <span style={{ fontFamily: 'monospace' }}>{submitResult.bridgeResult.achFilePath.split(/[\\/]/).pop()}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <strong>✗ Submission Failed</strong>
                    <div>{submitResult.submission?.submission_error || submitResult.error}</div>
                  </>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <Link to={`/clients/${id}/submissions`} className="btn btn-secondary btn-sm">View History</Link>
                  <Link to="/" className="btn btn-secondary btn-sm">Dashboard</Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
