import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function fmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function StatusBadge({ status }) {
  if (status === 'submitted') return <span className="badge badge-success">Submitted</span>;
  if (status === 'failed')    return <span className="badge badge-error">Failed</span>;
  if (status === 'processing') return <span className="badge badge-warning">Processing</span>;
  return <span className="badge badge-neutral">Pending</span>;
}

function rowBg(stub) {
  if (stub.status === 'failed' || stub.status_940 === 'failed') return '#fef2f2';
  if (stub.status === 'submitted' && stub.status_940 === 'submitted') return '#f0fdf4';
  if (stub.status === 'submitted') return '#f0f9ff';
  return 'transparent';
}

export default function EmployeeDetail() {
  const { id: clientId, empId } = useParams();
  const navigate = useNavigate();
  const [client,   setClient]   = useState(null);
  const [employee, setEmployee] = useState(null);
  const [ytd,      setYtd]      = useState(null);
  const [paystubs, setPaystubs] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviting,  setInviting]  = useState(false);
  const currentYear = new Date().getFullYear();

  async function handleInvite() {
    setInviting(true);
    try {
      const data = await api.inviteEmployee(empId);
      setInviteUrl(data.inviteUrl);
    } catch (err) {
      alert(err.message);
    } finally {
      setInviting(false);
    }
  }

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
    single: 'Single / MFS', married: 'Married / QSS', hoh: 'Head of Household',
  }[employee.filingStatus] || employee.filingStatus;

  const payRate = employee.payType === 'hourly'
    ? `$${Number(employee.hourlyRate).toFixed(2)}/hr`
    : `$${Number(employee.annualSalary).toLocaleString()}/yr`;

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/">Dashboard</Link>
          <span>/</span>
          <Link to={`/clients/${clientId}`}>{client.businessName}</Link>
          <span>/</span>
          <button
            onClick={() => navigate(`/clients/${clientId}`, { state: { tab: 'employees' } })}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 'inherit' }}
          >
            Employees
          </button>
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
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => navigate(-1)}>← Back</button>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/clients/${clientId}/payroll/new`, {
                state: { employeeId: empId, employeeName: employee.fullName },
              })}
            >
              + New Paycheck
            </button>
            <Link to={`/clients/${clientId}/employees/${empId}/edit`} className="btn btn-secondary">Edit Employee</Link>
            <button className="btn btn-secondary" onClick={handleInvite} disabled={inviting}>
              {inviting ? '…' : '✉ Invite to Portal'}
            </button>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Invite link banner */}
        {inviteUrl && (
          <div className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Employee invite link (valid 7 days)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  readOnly
                  value={inviteUrl}
                  style={{ flex: 1, minWidth: 200, fontSize: 12, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 0, fontFamily: 'monospace' }}
                  onFocus={e => e.target.select()}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { navigator.clipboard.writeText(inviteUrl); }}
                >
                  Copy
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Send this link to the employee. They'll create a password and can then view their paystubs.
              </div>
            </div>
          </div>
        )}

        {/* Employee Info + YTD side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Employee Information</span>
              <Link to={`/clients/${clientId}/employees/${empId}/edit`} className="btn btn-secondary btn-sm">Edit</Link>
            </div>
            <InfoRow label="Pay Type" value={employee.payType === 'hourly' ? 'Hourly' : 'Salary'} />
            <InfoRow label={employee.payType === 'hourly' ? 'Hourly Rate' : 'Annual Salary'} value={payRate} mono />
            <InfoRow label="Pay Frequency" value={payFreqLabel} />
            <InfoRow label="Work State" value={employee.workState || employee.state || 'TX'} />
            <InfoRow label="Filing Status" value={filingLabel} />
            <InfoRow label="SSN on File" value={employee.hasSSN ? 'Yes (encrypted)' : 'Not set'} />
            <InfoRow label="Hire Date" value={employee.hireDate ? new Date(employee.hireDate).toLocaleDateString() : null} />
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">{currentYear} Year-to-Date</span>
            </div>
            <InfoRow label="Gross Wages" value={fmt(ytd?.ytd_gross)} mono />
            <InfoRow label="SS Wages" value={fmt(ytd?.ytd_ss_wages)} mono />
            <InfoRow label="FUTA Wages" value={fmt(ytd?.ytd_futa_wages)} mono />
            <InfoRow label="SUTA Wages" value={fmt(ytd?.ytd_suta_wages)} mono />
            <div style={{ paddingTop: 14, display: 'flex', gap: 20 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{paystubs.length}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Total Paychecks</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--success)' }}>
                  {paystubs.filter((s) => s.status === 'submitted').length}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>941 Filed</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--success)' }}>
                  {paystubs.filter((s) => s.status_940 === 'submitted').length}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>940 Filed</div>
              </div>
            </div>
          </div>

        </div>

        {/* Paycheck History */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-header" style={{ padding: '14px 20px' }}>
            <span className="card-title">Paycheck History</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click any row to open and edit</span>
          </div>

          {paystubs.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-icon">📄</div>
              <h3>No paychecks yet</h3>
              <p>Save a payroll entry as a paystub to see paycheck history here.</p>
              <Link to={`/clients/${clientId}/payroll/new`} className="btn btn-primary">New Payroll Entry</Link>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
                  {['Check #', 'Pay Period', 'Gross Pay', 'Net Pay', '941 Status', '940 Status'].map((h) => (
                    <th key={h} style={{ padding: '11px 18px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                  <th style={{ padding: '11px 18px' }} />
                </tr>
              </thead>
              <tbody>
                {paystubs.map((stub) => (
                  <tr
                    key={stub.id}
                    style={{ borderBottom: '1px solid var(--border-light)', cursor: 'pointer', background: rowBg(stub), transition: 'filter 0.1s' }}
                    onClick={() => navigate(`/clients/${clientId}/paystubs/${stub.id}/edit`)}
                    onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(0.96)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
                  >
                    <td style={{ padding: '14px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
                      {stub.check_number ? `#${stub.check_number}` : '—'}
                    </td>
                    <td className="mono" style={{ padding: '14px 18px', fontSize: 12 }}>
                      {stub.pay_period_start} – {stub.pay_period_end}
                    </td>
                    <td style={{ padding: '14px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600 }}>
                      {fmt(stub.gross_wages)}
                    </td>
                    <td style={{ padding: '14px 18px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                      {fmt(stub.net_pay)}
                    </td>
                    <td style={{ padding: '14px 18px' }}><StatusBadge status={stub.status} /></td>
                    <td style={{ padding: '14px 18px' }}><StatusBadge status={stub.status_940} /></td>
                    <td style={{ padding: '14px 18px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>Edit →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </>
  );
}
