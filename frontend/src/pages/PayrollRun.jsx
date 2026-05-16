import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function fmtAmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

const PAY_TYPES = [
  { value: 'regular',    label: 'Regular' },
  { value: 'salary',     label: 'Salary' },
  { value: 'overtime',   label: 'Overtime' },
  { value: 'holiday',    label: 'Holiday' },
  { value: 'sick',       label: 'Sick' },
  { value: 'commission', label: 'Commission' },
];

export default function PayrollRun() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client,    setClient]    = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);

  const [payPeriodStart, setPayPeriodStart] = useState('');
  const [payPeriodEnd,   setPayPeriodEnd]   = useState('');
  const [settlementDate, setSettlementDate] = useState('');

  // { [empId]: { skip, ytdGross, lineItems: [{payType, hours, rate, amount}] } }
  const [empData, setEmpData] = useState({});

  const [saving,    setSaving]    = useState(false);
  const [runResult, setRunResult] = useState(null);

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    // Default pay period: previous 14 days
    const today = new Date();
    const end   = new Date(today);
    end.setDate(today.getDate() - 1);
    const start = new Date(end);
    start.setDate(end.getDate() - 13);
    setPayPeriodEnd(end.toISOString().slice(0, 10));
    setPayPeriodStart(start.toISOString().slice(0, 10));

    Promise.all([
      api.getClient(id),
      api.getEmployees(id),
      api.getEmployeeYTDBatch(id, currentYear).catch(() => []),
    ]).then(([c, emps, ytd]) => {
      setClient(c);
      const active = emps.filter((e) => e.isActive !== false && e.is_active !== 0);
      setEmployees(active);

      const ytdMap = {};
      ytd.forEach((y) => { ytdMap[y.employee_id] = y; });

      const data = {};
      active.forEach((emp) => {
        const ytdGross = ytdMap[emp.id]?.ytd_gross || 0;
        const isSalary = emp.payType === 'salary';
        const periods  = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
        const rate     = isSalary
          ? round2((emp.annualSalary || 0) / (periods[emp.payFrequency] || 26))
          : emp.hourlyRate || 0;

        data[emp.id] = {
          skip: false,
          ytdGross,
          lineItems: [isSalary
            ? { payType: 'salary',   hours: '', rate: '', amount: String(rate) }
            : { payType: 'regular',  hours: '', rate: String(rate), amount: '' }],
        };
      });
      setEmpData(data);
    }).catch((err) => {
      alert(err.message);
      navigate(`/clients/${id}`);
    }).finally(() => setLoading(false));
  }, [id]);

  function getGross(empId) {
    return (empData[empId]?.lineItems || []).reduce((s, li) => s + parseFloat(li.amount || 0), 0);
  }

  function toggleSkip(empId) {
    setEmpData((prev) => ({ ...prev, [empId]: { ...prev[empId], skip: !prev[empId].skip } }));
  }

  function updateItem(empId, idx, field, value) {
    setEmpData((prev) => {
      const entry = { ...prev[empId] };
      const items = [...entry.lineItems];
      const item  = { ...items[idx], [field]: value };
      if (field === 'hours' || field === 'rate') {
        if (item.hours && item.rate) {
          const m = item.payType === 'overtime' ? 1.5 : 1;
          item.amount = String(round2(parseFloat(item.hours) * parseFloat(item.rate) * m));
        }
      }
      items[idx] = item;
      return { ...prev, [empId]: { ...entry, lineItems: items } };
    });
  }

  function addLine(empId) {
    setEmpData((prev) => ({
      ...prev,
      [empId]: {
        ...prev[empId],
        lineItems: [...(prev[empId]?.lineItems || []), { payType: 'regular', hours: '', rate: '', amount: '' }],
      },
    }));
  }

  function removeLine(empId, idx) {
    setEmpData((prev) => {
      const items = prev[empId].lineItems.filter((_, i) => i !== idx);
      return { ...prev, [empId]: { ...prev[empId], lineItems: items } };
    });
  }

  const activeEmployees = employees.filter((e) => !empData[e.id]?.skip);
  const totalGross      = activeEmployees.reduce((s, e) => s + getGross(e.id), 0);
  const canProceed      = payPeriodStart && payPeriodEnd && activeEmployees.some((e) => getGross(e.id) > 0);

  async function handleRun() {
    setSaving(true);
    try {
      const payload = employees
        .filter((e) => !empData[e.id]?.skip)
        .map((e) => ({
          employeeId: e.id,
          skip:       false,
          ytdGross:   empData[e.id]?.ytdGross || 0,
          lineItems:  (empData[e.id]?.lineItems || [])
            .filter((li) => parseFloat(li.amount || 0) > 0)
            .map((li) => ({
              payType:     li.payType,
              description: li.description || null,
              hours:       li.hours  ? parseFloat(li.hours)  : null,
              rate:        li.rate   ? parseFloat(li.rate)   : null,
              amount:      parseFloat(li.amount || 0),
            })),
        }));

      const result = await api.runPayroll({
        clientId: id,
        payPeriodStart,
        payPeriodEnd,
        settlementDate: settlementDate || null,
        employees: payload,
      });
      setRunResult(result);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
    </div>
  );

  // ── Success screen ────────────────────────────────────────────────────────────
  if (runResult) {
    const totals = runResult.paystubs.reduce((acc, p) => ({
      gross:   acc.gross   + p.grossWages,
      net:     acc.net     + p.netPay,
      deposit: acc.deposit + p.totalDeposit,
      futa:    acc.futa    + p.futaTax,
    }), { gross: 0, net: 0, deposit: 0, futa: 0 });

    return (
      <>
        <div className="page-header">
          <div className="breadcrumb">
            <Link to="/">Dashboard</Link><span>/</span>
            <Link to={`/clients/${id}`}>{client?.businessName}</Link><span>/</span>
            <span>Payroll Complete</span>
          </div>
          <h2>Payroll Complete</h2>
          <p>{runResult.count} paychecks created — {payPeriodStart} to {payPeriodEnd}</p>
        </div>

        <div className="page-body">
          <div className="alert alert-success" style={{ marginBottom: 20 }}>
            <span>✓</span>
            <strong>{runResult.count} paychecks saved successfully.</strong>
            <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 12 }}>Run ID: {runResult.runId}</span>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
                  {['Employee', 'Check #', 'Gross Pay', 'Net Pay', '941 Deposit', 'FUTA (940)'].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runResult.paystubs.map((p, idx) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-light)', background: idx % 2 === 1 ? 'var(--bg-primary)' : 'transparent' }}>
                    <td style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13 }}>{p.employeeName}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>#{p.checkNumber}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmtAmt(p.grossWages)}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--success)' }}>{fmtAmt(p.netPay)}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{fmtAmt(p.totalDeposit)}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: p.futaTax > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {p.futaTax > 0 ? fmtAmt(p.futaTax) : '—'}
                    </td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--bg-primary)', borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                  <td colSpan={2} style={{ padding: '10px 16px', fontSize: 13 }}>Totals</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmtAmt(totals.gross)}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--success)' }}>{fmtAmt(totals.net)}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--accent)' }}>{fmtAmt(totals.deposit)}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmtAmt(totals.futa)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <Link to={`/clients/${id}`} state={{ tab: 'payroll' }} className="btn btn-primary">View Payroll History</Link>
            <Link to={`/clients/${id}/paystubs`} className="btn btn-secondary">Submit to EFTPS</Link>
            <button onClick={() => setRunResult(null)} className="btn btn-secondary">Run Another Payroll</button>
          </div>
        </div>
      </>
    );
  }

  // ── Entry screen ──────────────────────────────────────────────────────────────
  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/">Dashboard</Link><span>/</span>
          <Link to={`/clients/${id}`}>{client?.businessName}</Link><span>/</span>
          <span>Run Payroll</span>
        </div>
        <div className="page-header-row">
          <div>
            <h2>Run Payroll</h2>
            <p>{client?.businessName} — Enter hours or confirm wages for each employee</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate(`/clients/${id}`)}>← Back</button>
        </div>
      </div>

      <div className="page-body">
        {/* Pay Period */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">Pay Period</span></div>
          <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 640 }}>
            <div className="form-group">
              <label className="form-label">Pay Period Start <span>*</span></label>
              <input className="form-input" type="date" value={payPeriodStart} onChange={(e) => setPayPeriodStart(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Pay Period End <span>*</span></label>
              <input className="form-input" type="date" value={payPeriodEnd} onChange={(e) => setPayPeriodEnd(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Settlement Date</label>
              <input className="form-input" type="date" value={settlementDate} onChange={(e) => setSettlementDate(e.target.value)} />
              <p className="form-hint">EFTPS debit date</p>
            </div>
          </div>
        </div>

        {/* Employee list */}
        {employees.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>No active employees found. Add employees to run payroll.</p>
            <Link to={`/clients/${id}/employees/new`} className="btn btn-primary">Add Employee</Link>
          </div>
        ) : employees.map((emp) => {
          const data    = empData[emp.id] || {};
          const skipped = data.skip;
          const isSalary = emp.payType === 'salary';
          const gross   = getGross(emp.id);

          return (
            <div key={emp.id} className="card" style={{ marginBottom: 16, opacity: skipped ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: skipped ? 0 : 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {emp.fullName || `${emp.firstName} ${emp.lastName}`}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {isSalary ? 'Salary' : 'Hourly'} · {emp.payFrequency || 'biweekly'} · {emp.workState || emp.state || 'TX'}
                    </div>
                  </div>
                  {!skipped && gross > 0 && (
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--accent)', fontSize: 15 }}>
                      {fmtAmt(gross)}
                    </span>
                  )}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={skipped}
                    onChange={() => toggleSkip(emp.id)}
                    style={{ width: 15, height: 15, accentColor: 'var(--error)' }}
                  />
                  Skip
                </label>
              </div>

              {!skipped && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
                        {['Pay Type', 'Hours', 'Rate', 'Amount', ''].map((h) => (
                          <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.lineItems || []).map((li, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td style={{ padding: '6px 8px', width: 130 }}>
                            <select className="form-select" style={{ fontSize: 12, padding: '4px 6px' }} value={li.payType}
                              onChange={(e) => updateItem(emp.id, idx, 'payType', e.target.value)}>
                              {PAY_TYPES.map((pt) => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '6px 8px', width: 90 }}>
                            {!isSalary && (
                              <input className="form-input mono" type="number" min="0" step="0.25" placeholder="0"
                                value={li.hours} style={{ fontSize: 12, padding: '4px 7px' }}
                                onChange={(e) => updateItem(emp.id, idx, 'hours', e.target.value)} />
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', width: 110 }}>
                            {!isSalary && (
                              <div style={{ position: 'relative' }}>
                                <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12 }}>$</span>
                                <input className="form-input mono" type="number" min="0" step="0.01" placeholder="0.00"
                                  value={li.rate} style={{ fontSize: 12, padding: '4px 7px 4px 18px' }}
                                  onChange={(e) => updateItem(emp.id, idx, 'rate', e.target.value)} />
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', width: 130 }}>
                            <div style={{ position: 'relative' }}>
                              <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12 }}>$</span>
                              <input className="form-input mono" type="number" min="0" step="0.01" placeholder="0.00"
                                value={li.amount} style={{ fontSize: 12, padding: '4px 7px 4px 18px', fontWeight: 600 }}
                                onChange={(e) => updateItem(emp.id, idx, 'amount', e.target.value)} />
                            </div>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', width: 36 }}>
                            {(data.lineItems || []).length > 1 && (
                              <button type="button" onClick={() => removeLine(emp.id, idx)}
                                style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 16 }}>×</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-light)' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addLine(emp.id)}>+ Add Line</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Footer summary + action */}
        {employees.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', marginTop: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{activeEmployees.length}</strong> employee{activeEmployees.length !== 1 ? 's' : ''} included
              {totalGross > 0 && (
                <span style={{ marginLeft: 14, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>
                  Total gross: {fmtAmt(totalGross)}
                </span>
              )}
            </div>
            <button
              className="btn btn-primary"
              onClick={handleRun}
              disabled={!canProceed || saving}
              style={{ minWidth: 180 }}
            >
              {saving
                ? <><span className="spinner" /> Processing…</>
                : `Save ${activeEmployees.filter((e) => getGross(e.id) > 0).length} Paychecks`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
