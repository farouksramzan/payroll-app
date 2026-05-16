import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function fmt(n, decimals = 2) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border-light)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
      <span className={mono ? 'mono' : ''} style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>
        {value || '—'}
      </span>
    </div>
  );
}

function YtdBar({ label, value, max }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(value)}</span>
      </div>
      <div style={{ height: 6, background: 'var(--border-light)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

function rowBg(stub) {
  if (stub.status === 'failed' || stub.status_940 === 'failed') return '#fef2f2';
  if (stub.status === 'submitted' && stub.status_940 === 'submitted') return '#f0fdf4';
  if (stub.status === 'submitted') return '#eff6ff';
  return 'transparent';
}

function StatusDot({ status }) {
  const colors = { submitted: '#22c55e', failed: '#ef4444', processing: '#f59e0b', pending: '#94a3b8' };
  const labels = { submitted: 'Filed', failed: 'Failed', processing: 'Processing', pending: 'Pending' };
  const s = status || 'pending';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: colors[s] || colors.pending,
        display: 'inline-block', flexShrink: 0,
      }} />
      <span style={{ color: colors[s] || colors.pending, fontWeight: 500 }}>{labels[s] || 'Pending'}</span>
    </span>
  );
}

export default function EmployeeDetail() {
  const { id: clientId, empId } = useParams();
  const navigate = useNavigate();
  const [client,   setClient]   = useState(null);
  const [employee, setEmployee] = useState(null);
  const [ytd,      setYtd]      = useState(null);
  const [paystubs, setPaystubs] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    Promise.all([
      api.getClient(clientId),
      api.getEmployee(empId),
      api.getEmployeeYTD(empId, currentYear),
      api.getPaystubs(clientId, empId),
    ])
      .then(([c, emp, ytdData, stubs]) => {
        setClient(c);
        setEmployee(emp);
        setYtd(ytdData);
        setPaystubs(stubs);
      })
      .catch((err) => { alert(err.message); navigate(`/clients/${clientId}`); })
      .finally(() => setLoading(false));
  }, [clientId, empId]);

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
    </div>
  );
  if (!employee || !client) return null;

  const payFreqLabel = {
    weekly: 'Weekly', biweekly: 'Bi-Weekly', semimonthly: 'Semi-Monthly', monthly: 'Monthly',
  }[employee.payFrequency] || employee.payFrequency;

  const filingLabel = {
    single: 'Single', married: 'Married Filing Jointly', 'head_of_household': 'Head of Household',
  }[employee.filingStatus] || employee.filingStatus;

  const ytdGross = ytd?.ytd_gross || 0;

  // Running YTD as we go through rows (already sorted DESC, so we compute from the end)
  const runningYtd = [];
  let running = 0;
  [...paystubs].reverse().forEach((s) => { running += s.gross_wages || 0; runningYtd.unshift(running); });

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/">Dashboard</Link>
          <span>/</span>
          <Link to={`/clients/${clientId}`}>{client.businessName}</Link>
          <span>/</span>
          <Link to={`/clients/${clientId}/employees`}>Employees</Link>
          <span>/</span>
          <span>{employee.fullName}</span>
        </div>
        <div className="page-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2>{employee.fullName}</h2>
            {employee.isActive
              ? <span className="badge badge-success">Active</span>
              : <span className="badge badge-neutral">Inactive</span>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to={`/clients/${clientId}/payroll/new`} className="btn btn-primary">+ New Payroll Entry</Link>
            <Link to={`/clients/${clientId}/employees/${empId}/edit`} className="btn btn-secondary">Edit Employee</Link>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Employee Info */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Employee Information</span>
          </div>
          <InfoRow label="Pay Type" value={employee.payType === 'hourly' ? 'Hourly' : 'Salary'} />
          {employee.payType === 'hourly'
            ? <InfoRow label="Hourly Rate" value={`$${Number(employee.hourlyRate).toFixed(2)}/hr`} mono />
            : <InfoRow label="Annual Salary" value={`$${Number(employee.annualSalary).toLocaleString()}/yr`} mono />}
          <InfoRow label="Pay Frequency" value={payFreqLabel} />
          <InfoRow label="Work State" value={employee.workState || employee.state || 'TX'} />
          <InfoRow label="Filing Status" value={filingLabel} />
          {employee.step2Checkbox && <InfoRow label="W-4 Step 2 (MJ)" value="Yes" />}
          {(employee.step3Children > 0 || employee.step3Other > 0) && (
            <InfoRow label="W-4 Step 3 Credits" value={fmt(employee.step3Children + employee.step3Other, 0).replace('$', '$')} mono />
          )}
          <InfoRow label="SSN on File" value={employee.hasSSN ? 'Yes (encrypted)' : 'Not set'} />
          <InfoRow label="Hire Date" value={employee.hireDate ? new Date(employee.hireDate).toLocaleDateString() : null} />
          <InfoRow label="Added" value={employee.createdAt ? new Date(employee.createdAt).toLocaleDateString() : null} />
        </div>

        {/* YTD Summary */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">{currentYear} Year-to-Date</span>
          </div>
          <div style={{ padding: '16px 0' }}>
            <YtdBar label="Gross Wages" value={ytdGross} max={ytdGross} />
            <YtdBar label="SS Wages" value={ytd?.ytd_ss_wages || 0} max={ytdGross} />
            <YtdBar label="FUTA Wages" value={ytd?.ytd_futa_wages || 0} max={ytdGross} />
            <YtdBar label="SUTA Wages" value={ytd?.ytd_suta_wages || 0} max={ytdGross} />
          </div>
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total Paychecks</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{paystubs.length}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>941 Submitted</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>
                {paystubs.filter((s) => s.status === 'submitted').length}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>940 Submitted</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>
                {paystubs.filter((s) => s.status_940 === 'submitted').length}
              </span>
            </div>
          </div>
        </div>

        {/* Paycheck History */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <span className="card-title">Paycheck History</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click any row to view or edit</span>
          </div>
          {paystubs.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-icon">📄</div>
              <h3>No paychecks yet</h3>
              <p>Save a payroll entry as a paystub to see paycheck history here.</p>
              <Link to={`/clients/${clientId}/payroll/new`} className="btn btn-primary">New Payroll Entry</Link>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Pay Period</th>
                    <th style={{ textAlign: 'right' }}>Gross</th>
                    <th style={{ textAlign: 'right' }}>FIT</th>
                    <th style={{ textAlign: 'right' }}>SS+Med</th>
                    <th style={{ textAlign: 'right' }}>FUTA</th>
                    <th style={{ textAlign: 'right' }}>SUI</th>
                    <th style={{ textAlign: 'right' }}>Net Pay</th>
                    <th style={{ textAlign: 'right' }}>YTD Gross</th>
                    <th>941</th>
                    <th>940</th>
                  </tr>
                </thead>
                <tbody>
                  {paystubs.map((stub, idx) => (
                    <tr
                      key={stub.id}
                      style={{ background: rowBg(stub), cursor: 'pointer' }}
                      onClick={() => navigate(`/clients/${clientId}/paystubs/${stub.id}/edit`)}
                      onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(0.96)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
                    >
                      <td className="mono" style={{ fontSize: 12 }}>
                        {stub.pay_period_start} – {stub.pay_period_end}
                      </td>
                      <td className="amount">{fmt(stub.gross_wages)}</td>
                      <td className="amount">{fmt(stub.fit_withholding)}</td>
                      <td className="amount">{fmt((stub.employee_ss || 0) + (stub.employee_medicare || 0) + (stub.employer_ss || 0) + (stub.employer_medicare || 0))}</td>
                      <td className="amount">{fmt(stub.futa_tax)}</td>
                      <td className="amount">{fmt(stub.suta_tax)}</td>
                      <td className="amount" style={{ color: 'var(--accent)', fontWeight: 600 }}>{fmt(stub.net_pay)}</td>
                      <td className="amount" style={{ color: 'var(--text-muted)' }}>{fmt(runningYtd[idx])}</td>
                      <td><StatusDot status={stub.status} /></td>
                      <td><StatusDot status={stub.status_940} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
