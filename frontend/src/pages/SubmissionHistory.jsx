import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';

function fmtAmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusBadge(s) {
  if (s === 'submitted')  return <span className="badge badge-success">✓ Submitted</span>;
  if (s === 'dry_run')    return <span className="badge badge-accent">Dry Run</span>;
  if (s === 'failed')     return <span className="badge badge-error">✗ Failed</span>;
  if (s === 'processing') return <span className="badge badge-warning">⟳ Processing</span>;
  return <span className="badge badge-neutral">Pending</span>;
}

export default function SubmissionHistory() {
  const { id: clientId } = useParams();
  const [submissions, setSubmissions] = useState([]);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [submitting, setSubmitting] = useState(null);

  useEffect(() => {
    const promises = [api.getSubmissions(clientId)];
    if (clientId) promises.push(api.getClient(clientId));
    Promise.all(promises)
      .then(([subs, c]) => { setSubmissions(subs); if (c) setClient(c); })
      .finally(() => setLoading(false));
  }, [clientId]);

  async function handleSubmit(subId) {
    setSubmitting(subId);
    try {
      const result = await api.submitToEFTPS(subId);
      setSubmissions((prev) =>
        prev.map((s) => (s.id === subId ? result.submission : s))
      );
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(null);
    }
  }

  // Dry runs never move money — keep them out of the deposited totals
  const submittedReal  = submissions.filter((s) => s.eftps_status === 'submitted');
  const dryRuns        = submissions.filter((s) => s.eftps_status === 'dry_run');
  const totalDeposited = submittedReal.reduce((sum, s) => sum + s.total_deposit, 0);
  const totalDryRun    = dryRuns.reduce((sum, s) => sum + s.total_deposit, 0);

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/">Dashboard</Link>
          {client && <><span>/</span><Link to={`/clients/${clientId}`}>{client.businessName}</Link></>}
          <span>/</span>
          <span>Submission History</span>
        </div>
        <div className="page-header-row">
          <div>
            <h2>{client ? `${client.businessName} — History` : 'All Submissions'}</h2>
            <p>{submissions.length} submission{submissions.length !== 1 ? 's' : ''} recorded</p>
          </div>
          {clientId && (
            <Link to={`/clients/${clientId}/payroll/new`} className="btn btn-primary">
              + New Payroll Entry
            </Link>
          )}
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-row" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-label">Total Submissions</div>
            <div className="stat-value">{submissions.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Successfully Submitted</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>
              {submittedReal.length}
            </div>
            {dryRuns.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                + {dryRuns.length} dry run{dryRuns.length !== 1 ? 's' : ''} (not counted)
              </div>
            )}
          </div>
          <div className="stat-card">
            <div className="stat-label">Pending</div>
            <div className="stat-value" style={{ color: 'var(--warning)' }}>
              {submissions.filter((s) => s.eftps_status === 'pending').length}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Deposited</div>
            <div className="stat-value" style={{ fontSize: 20, color: 'var(--accent)' }}>{fmtAmt(totalDeposited)}</div>
            {totalDryRun > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Dry runs: {fmtAmt(totalDryRun)} — no money moved
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
          </div>
        ) : submissions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📄</div>
            <h3>No submissions yet</h3>
            <p>Payroll entries will appear here after creation.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    {!clientId && <th>Client</th>}
                    <th>Pay Period</th>
                    <th>Gross Wages</th>
                    <th>FIT</th>
                    <th>SS</th>
                    <th>Medicare</th>
                    <th>Total Deposit</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((s) => (
                    <>
                      <tr
                        key={s.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                      >
                        <td className="mono" style={{ color: 'var(--text-muted)' }}>
                          <button
                            type="button"
                            aria-expanded={expanded === s.id}
                            aria-label={`${expanded === s.id ? 'Hide' : 'Show'} details for submission #${s.id}`}
                            onClick={(e) => { e.stopPropagation(); setExpanded(expanded === s.id ? null : s.id); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <span aria-hidden="true" style={{ fontSize: 10 }}>{expanded === s.id ? '▾' : '▸'}</span>
                            #{s.id}
                          </button>
                        </td>
                        {!clientId && <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{s.business_name}</td>}
                        <td className="mono" style={{ fontSize: 12 }}>{s.pay_period_start}<br />{s.pay_period_end}</td>
                        <td className="amount">{fmtAmt(s.gross_wages)}</td>
                        <td className="amount">{fmtAmt(s.fit_withholding)}</td>
                        <td className="amount">{fmtAmt(s.employee_ss + s.employer_ss)}</td>
                        <td className="amount">{fmtAmt(s.employee_medicare + s.employer_medicare)}</td>
                        <td className="amount" style={{ color: 'var(--accent)' }}>{fmtAmt(s.total_deposit)}</td>
                        <td>{statusBadge(s.eftps_status)}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          {s.eftps_submitted_at ? new Date(s.eftps_submitted_at).toLocaleDateString() : '—'}
                        </td>
                        <td>
                          {(s.eftps_status === 'pending' || s.eftps_status === 'failed') && (
                            <button
                              className="btn btn-success btn-sm"
                              onClick={(e) => { e.stopPropagation(); handleSubmit(s.id); }}
                              disabled={submitting === s.id}
                            >
                              {submitting === s.id ? <span className="spinner" /> : 'Submit'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded === s.id && (
                        <tr key={`${s.id}-detail`}>
                          <td colSpan={clientId ? 10 : 11} style={{ background: 'var(--bg-primary)', padding: '12px 20px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, fontSize: 12.5 }}>
                              <div>
                                <div style={{ color: 'var(--text-muted)' }}>Filing Status</div>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                  {{ single: 'Single / MFS', married: 'Married / QSS', hoh: 'Head of Household' }[s.filing_status] || s.filing_status}
                                </div>
                              </div>
                              <div>
                                <div style={{ color: 'var(--text-muted)' }}>Pay Frequency</div>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 500, textTransform: 'capitalize' }}>{s.pay_frequency}</div>
                              </div>
                              <div>
                                <div style={{ color: 'var(--text-muted)' }}>Step 2 Multiple Jobs</div>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{s.step2_checkbox ? 'Yes' : 'No'}</div>
                              </div>
                              <div>
                                <div style={{ color: 'var(--text-muted)' }}>Step 3 Credits</div>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{s.step3_credits > 0 ? fmtAmt(s.step3_credits) : '—'}</div>
                              </div>
                              <div>
                                <div style={{ color: 'var(--text-muted)' }}>Confirmation #</div>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'monospace' }}>{s.eftps_confirmation || '—'}</div>
                              </div>
                              {s.submission_error && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <div style={{ color: 'var(--error)', marginTop: 4 }}>Error: {s.submission_error}</div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
