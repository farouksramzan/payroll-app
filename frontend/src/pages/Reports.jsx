import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];
const QUARTERS = [1, 2, 3, 4];
const QUARTER_LABELS = { 1: 'Q1 (Jan–Mar)', 2: 'Q2 (Apr–Jun)', 3: 'Q3 (Jul–Sep)', 4: 'Q4 (Oct–Dec)' };
const REPORT_TYPES = [
  { value: '941',  label: 'Form 941',     subtitle: 'Employer\'s Quarterly Federal Tax Return' },
  { value: '940',  label: 'Form 940',     subtitle: 'Employer\'s Annual FUTA Tax Return' },
  { value: 'twc',  label: 'TWC / SUTA',   subtitle: 'Texas Workforce Commission Quarterly Report' },
  { value: 'w2',   label: 'W-2',          subtitle: 'Employee Wage and Tax Statement' },
  { value: 'w3',   label: 'W-3',          subtitle: 'Transmittal of Wage and Tax Statements' },
];

function fmtAmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  return `${(Number(n || 0) * 100).toFixed(2)}%`;
}

// ── Report renderers ──────────────────────────────────────────────────────────
function Report941({ data }) {
  const { client, period, lines, submissions } = data;
  return (
    <div className="report-doc">
      <div className="report-header">
        <div>
          <div className="report-form-number">Form 941</div>
          <div className="report-form-title">Employer's Quarterly Federal Tax Return</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Period</div>
          <div style={{ fontWeight: 700 }}>Q{period.quarter} {period.year}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{period.start} — {period.end}</div>
        </div>
      </div>
      <div className="report-entity">
        <strong>{client.businessName}</strong> &nbsp;|&nbsp; EIN: {client.ein}
      </div>

      <table className="report-table">
        <tbody>
          <ReportRow line="1" label="Number of employees who received wages, tips, or other compensation" value={lines.line1_employees} mono={false} />
          <ReportRow line="2" label="Wages, tips, and other compensation" value={fmtAmt(lines.line2_wages)} />
          <ReportRow line="3" label="Federal income tax withheld from wages, tips, and other compensation" value={fmtAmt(lines.line3_fitWithheld)} />
          <tr><td colSpan={3} className="report-section-header">Part 2 — Tax Liability for This Quarter</td></tr>
          <ReportRow line="5a" label="Taxable Social Security wages × 12.4%" value={fmtAmt(lines.line5a_ssTax)} sub={`Wages: ${fmtAmt(lines.line5a_ssWages)}`} />
          <ReportRow line="5c" label="Taxable Medicare wages &amp; tips × 2.9%" value={fmtAmt(lines.line5c_medTax)} sub={`Wages: ${fmtAmt(lines.line5c_medWages)}`} />
          <ReportRow line="6"  label="Total taxes before adjustments (line 3 + 5a + 5c)" value={fmtAmt(lines.line6_totalTaxes)} highlight />
          <ReportRow line="13" label="Total deposits for this quarter" value={fmtAmt(lines.line13_deposited)} />
          <ReportRow line="14" label="Balance due" value={fmtAmt(lines.line14_balanceDue)} highlight={lines.line14_balanceDue > 0} />
        </tbody>
      </table>

      {submissions.length > 0 && (
        <>
          <div className="report-section-title">Supporting Submissions ({submissions.length})</div>
          <table className="report-table">
            <thead>
              <tr>
                {['Pay Period End', 'Employee', 'Gross Wages', 'FIT', 'SS Total', 'Med Total', 'Deposit', 'Status'].map((h) => (
                  <th key={h} style={{ padding: '7px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textAlign: h === 'Employee' ? 'left' : 'right', background: 'var(--bg-primary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '7px 10px', fontSize: 12 }}>{s.payPeriodEnd}</td>
                  <td style={{ padding: '7px 10px', fontSize: 12 }}>{s.employeeName || '—'}</td>
                  {[s.grossWages, s.fitWithholding, s.ssTotal, s.medTotal, s.totalDeposit].map((v, i) => (
                    <td key={i} style={{ padding: '7px 10px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>{fmtAmt(v)}</td>
                  ))}
                  <td style={{ padding: '7px 10px', fontSize: 11 }}>
                    <span className={`badge badge-${s.eftpsStatus === 'submitted' ? 'success' : s.eftpsStatus === 'failed' ? 'error' : 'neutral'}`}>
                      {s.eftpsStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Report940({ data }) {
  const { client, period, lines, byEmployee } = data;
  return (
    <div className="report-doc">
      <div className="report-header">
        <div>
          <div className="report-form-number">Form 940</div>
          <div className="report-form-title">Employer's Annual Federal Unemployment (FUTA) Tax Return</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700 }}>Tax Year {period.year}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>FUTA Wage Base: {fmtAmt(lines.wageBase)}/employee</div>
        </div>
      </div>
      <div className="report-entity"><strong>{client.businessName}</strong> &nbsp;|&nbsp; EIN: {client.ein}</div>

      <table className="report-table">
        <tbody>
          <ReportRow line="3"  label="Total payments to all employees" value={fmtAmt(lines.line3_totalPayments)} />
          <ReportRow line="5"  label="Total taxable FUTA wages (after $7,000 wage base cap)" value={fmtAmt(lines.line5_futaTaxableWages)} />
          <ReportRow line="6"  label="FUTA tax before adjustments (line 5 × 6%)" value={fmtAmt(lines.line6_futaBeforeCredit)} />
          <ReportRow line="8"  label="State unemployment tax credit (5.4%)" value={`(${fmtAmt(lines.line8_stateCredit)})`} />
          <ReportRow line="12" label="Net FUTA tax (0.6% net rate)" value={fmtAmt(lines.line12_netFuta)} highlight />
        </tbody>
      </table>

      {byEmployee.length > 0 && (
        <>
          <div className="report-section-title">FUTA by Employee</div>
          <table className="report-table">
            <thead>
              <tr>
                {['Employee', 'Total Wages', 'FUTA Taxable', 'FUTA Tax (0.6%)'].map((h) => (
                  <th key={h} style={{ padding: '7px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textAlign: h === 'Employee' ? 'left' : 'right', background: 'var(--bg-primary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '7px 10px', fontSize: 13, fontWeight: 500 }}>{e.name}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, textAlign: 'right' }}>{fmtAmt(e.wages)}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, textAlign: 'right' }}>{fmtAmt(e.futaTaxable)}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, textAlign: 'right', fontWeight: 600 }}>{fmtAmt(e.futaTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ReportTWC({ data }) {
  const { client, period, sutaRate, lines, byEmployee } = data;
  return (
    <div className="report-doc">
      <div className="report-header">
        <div>
          <div className="report-form-number">TWC / SUTA</div>
          <div className="report-form-title">Texas Workforce Commission Quarterly Wage Report</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700 }}>Q{period.quarter} {period.year}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Rate: {fmtPct(sutaRate)} | Wage Base: {fmtAmt(lines.wageBase)}/employee</div>
        </div>
      </div>
      <div className="report-entity"><strong>{client.businessName}</strong> &nbsp;|&nbsp; EIN: {client.ein}</div>

      <table className="report-table">
        <tbody>
          <ReportRow label="Total wages paid this quarter" value={fmtAmt(lines.totalWages)} />
          <ReportRow label={`SUTA taxable wages (after $${Number(lines.wageBase).toLocaleString()} wage base cap)`} value={fmtAmt(lines.sutaTaxableWages)} />
          <ReportRow label={`SUTA tax due (taxable wages × ${fmtPct(sutaRate)})`} value={fmtAmt(lines.sutaTax)} highlight />
        </tbody>
      </table>

      {byEmployee.length > 0 && (
        <>
          <div className="report-section-title">SUTA by Employee</div>
          <table className="report-table">
            <thead>
              <tr>
                {['Employee', 'Total Wages', 'SUTA Taxable', 'SUTA Tax'].map((h) => (
                  <th key={h} style={{ padding: '7px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textAlign: h === 'Employee' ? 'left' : 'right', background: 'var(--bg-primary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '7px 10px', fontSize: 13, fontWeight: 500 }}>{e.name}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, textAlign: 'right' }}>{fmtAmt(e.wages)}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, textAlign: 'right' }}>{fmtAmt(e.sutaTaxable)}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, textAlign: 'right', fontWeight: 600 }}>{fmtAmt(e.sutaTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ReportW2({ data }) {
  const { client, period, w2s } = data;
  return (
    <div className="report-doc">
      <div className="report-header">
        <div>
          <div className="report-form-number">W-2</div>
          <div className="report-form-title">Wage and Tax Statement — {period.year}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700 }}>{w2s.length} Employee{w2s.length !== 1 ? 's' : ''}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Texas (No State Income Tax)</div>
        </div>
      </div>
      <div className="report-entity"><strong>{client.businessName}</strong> &nbsp;|&nbsp; EIN: {client.ein}</div>

      {w2s.map((w) => (
        <div key={w.employeeId} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: 14 }}>{w.firstName} {w.lastName}</strong>
              <span style={{ marginLeft: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>SSN: {w.ssn}</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[w.address, w.city, w.state, w.zip].filter(Boolean).join(', ')}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 0 }}>
            {[
              { box: '1', label: 'Wages, tips, other comp.', value: fmtAmt(w.box1_wages) },
              { box: '2', label: 'Federal income tax withheld', value: fmtAmt(w.box2_fitWithheld) },
              { box: '3', label: 'Social Security wages', value: fmtAmt(w.box3_ssWages) },
              { box: '4', label: 'SS tax withheld', value: fmtAmt(w.box4_ssTax) },
              { box: '5', label: 'Medicare wages & tips', value: fmtAmt(w.box5_medWages) },
              { box: '6', label: 'Medicare tax withheld', value: fmtAmt(w.box6_medTax) },
              { box: '15', label: 'State', value: w.box15_state },
              { box: '16', label: 'State wages', value: fmtAmt(w.box16_stateWages) },
              { box: '17', label: 'State income tax', value: fmtAmt(w.box17_stateTax) },
            ].map(({ box, label, value }) => (
              <div key={box} style={{ padding: '10px 14px', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Box {box} — {label}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, marginTop: 4 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportW3({ data }) {
  const { client, period, totals } = data;
  return (
    <div className="report-doc">
      <div className="report-header">
        <div>
          <div className="report-form-number">W-3</div>
          <div className="report-form-title">Transmittal of Wage and Tax Statements — {period.year}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700 }}>{totals.employeeCount} Employee{totals.employeeCount !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div className="report-entity"><strong>{client.businessName}</strong> &nbsp;|&nbsp; EIN: {client.ein}</div>

      <table className="report-table">
        <tbody>
          <ReportRow line="1"  label="Total wages, tips, and other compensation (Box 1)" value={fmtAmt(totals.box1_wages)} />
          <ReportRow line="2"  label="Total federal income tax withheld (Box 2)" value={fmtAmt(totals.box2_fitWithheld)} />
          <ReportRow line="3"  label="Total Social Security wages (Box 3)" value={fmtAmt(totals.box3_ssWages)} />
          <ReportRow line="4"  label="Total Social Security tax withheld (Box 4)" value={fmtAmt(totals.box4_ssTax)} />
          <ReportRow line="5"  label="Total Medicare wages &amp; tips (Box 5)" value={fmtAmt(totals.box5_medWages)} />
          <ReportRow line="6"  label="Total Medicare tax withheld (Box 6)" value={fmtAmt(totals.box6_medTax)} highlight />
          <ReportRow line="15" label="State" value={totals.box15_state} mono={false} />
          <ReportRow line="16" label="Total state wages (Box 16)" value={fmtAmt(totals.box16_stateWages)} />
          <ReportRow line="17" label="Total state income tax (Box 17 — TX $0)" value={fmtAmt(totals.box17_stateTax)} />
        </tbody>
      </table>
    </div>
  );
}

function ReportRow({ line, label, value, sub, highlight, mono = true }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)', background: highlight ? 'rgba(37,99,235,0.06)' : 'transparent' }}>
      {line !== undefined && (
        <td style={{ padding: '9px 12px', fontSize: 11, fontWeight: 700, color: 'var(--accent)', width: 36, verticalAlign: 'top' }}>{line}</td>
      )}
      <td style={{ padding: '9px 12px', fontSize: 13, color: 'var(--text-secondary)', paddingLeft: line === undefined ? 12 : 0 }}>
        <div>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
      </td>
      <td style={{
        padding: '9px 14px', textAlign: 'right',
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        fontSize: 13, fontWeight: highlight ? 700 : 600,
        color: highlight ? 'var(--accent)' : 'var(--text-primary)',
        whiteSpace: 'nowrap',
      }}>{value}</td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Reports() {
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [reportType, setReportType] = useState('941');
  const [year, setYear]       = useState(CURRENT_YEAR);
  const [quarter, setQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const printRef = useRef(null);

  const needsQuarter = reportType === '941' || reportType === 'twc';

  useEffect(() => {
    // Pre-populate controls from URL params (set by CompanyWorkspace "File Forms")
    const paramForm    = searchParams.get('form');
    const paramYear    = searchParams.get('year');
    const paramQuarter = searchParams.get('quarter');
    if (paramForm)    setReportType(paramForm);
    if (paramYear)    setYear(Number(paramYear));
    if (paramQuarter) setQuarter(Number(paramQuarter));
  }, []);

  useEffect(() => {
    const paramClientId = searchParams.get('clientId');
    api.getClients().then((cs) => {
      setClients(cs);
      if (paramClientId) {
        setClientId(paramClientId);
      } else if (cs.length > 0) {
        setClientId(String(cs[0].id));
      }
    }).catch(() => {});
  }, []);

  async function handleGenerate() {
    if (!clientId) { setError('Select a client first'); return; }
    setLoading(true);
    setError('');
    setData(null);
    try {
      let result;
      if (reportType === '941')     result = await api.get941(clientId, year, quarter);
      else if (reportType === '940') result = await api.get940(clientId, year);
      else if (reportType === 'twc') result = await api.getTWC(clientId, year, quarter);
      else if (reportType === 'w2')  result = await api.getW2(clientId, year);
      else if (reportType === 'w3')  result = await api.getW3(clientId, year);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <>
      <div className="page-header">
        <h2>Tax Reports</h2>
        <p>Generate Form 941, 940, TWC, W-2, and W-3 reports for any client and period</p>
      </div>

      <div className="page-body">
        {/* Controls */}
        <div className="card" style={{ marginBottom: 24, padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Client</label>
              <select className="form-select" value={clientId} onChange={(e) => { setClientId(e.target.value); setData(null); }}>
                <option value="">— Select a client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.businessName}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Report Type</label>
              <select className="form-select" value={reportType} onChange={(e) => { setReportType(e.target.value); setData(null); }}>
                {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.subtitle}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Tax Year</label>
              <select className="form-select" value={year} onChange={(e) => { setYear(Number(e.target.value)); setData(null); }}>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {needsQuarter && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Quarter</label>
                <select className="form-select" value={quarter} onChange={(e) => { setQuarter(Number(e.target.value)); setData(null); }}>
                  {QUARTERS.map((q) => <option key={q} value={q}>{QUARTER_LABELS[q]}</option>)}
                </select>
              </div>
            )}

            <div>
              <button className="btn btn-primary" onClick={handleGenerate} disabled={loading || !clientId}>
                {loading ? <><span className="spinner" /> Generating…</> : 'Generate Report'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <span>⚠</span> {error}
          </div>
        )}

        {data && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 16 }} className="no-print">
              <button className="btn btn-secondary" onClick={handlePrint}>Print / Save PDF</button>
            </div>
            <div ref={printRef}>
              {data.reportType === '941' && <Report941 data={data} />}
              {data.reportType === '940' && <Report940 data={data} />}
              {data.reportType === 'TWC' && <ReportTWC data={data} />}
              {data.reportType === 'W-2' && <ReportW2  data={data} />}
              {data.reportType === 'W-3' && <ReportW3  data={data} />}
            </div>
          </>
        )}

        {!data && !loading && !error && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <p>Select a client and report type above, then click Generate Report.</p>
          </div>
        )}
      </div>
    </>
  );
}
