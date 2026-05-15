import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function fmtAmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status }) {
  const map = {
    pending:    ['badge-neutral', 'Pending'],
    processing: ['badge-warning', 'Processing'],
    submitted:  ['badge-success', 'Submitted'],
    failed:     ['badge-error', 'Failed'],
    dry_run:    ['badge-accent', 'Dry Run'],
  };
  const [cls, label] = map[status] || ['badge-neutral', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

async function downloadPDF(id, payPeriodEnd) {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api/paystubs/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to generate PDF');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `paystub-${id}-${payPeriodEnd || ''}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Paystubs() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client,       setClient]       = useState(null);
  const [paystubs,     setPaystubs]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [submitting,   setSubmitting]   = useState(null); // paystub id being submitted
  const [batching,     setBatching]     = useState(false);
  const [downloading,  setDownloading]  = useState(null); // paystub id being downloaded
  const [deleting,     setDeleting]     = useState(null);
  const [batchResult,  setBatchResult]  = useState(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);

  useEffect(() => {
    Promise.all([api.getClient(id), api.getPaystubs(id)])
      .then(([c, stubs]) => { setClient(c); setPaystubs(stubs); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    api.getBridgeStatus().then((d) => setBridgeConnected(d.connected)).catch(() => {});
  }, [id]);

  const pending   = paystubs.filter((s) => s.status === 'pending' || s.status === 'failed');
  const submitted = paystubs.filter((s) => s.status === 'submitted' || s.status === 'dry_run');
  const pendingDeposit = pending.reduce((sum, s) => sum + (s.total_deposit || 0), 0);

  async function handleSubmit(stub) {
    if (!window.confirm(`Submit paystub for ${stub.employee_name || 'this employee'} ($${Number(stub.total_deposit).toFixed(2)}) to EFTPS?`)) return;
    setSubmitting(stub.id);
    try {
      const res = await api.submitPaystub(stub.id);
      setPaystubs((prev) => prev.map((s) => s.id === stub.id ? { ...s, ...res.paystub } : s));
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(null);
    }
  }

  async function handleBatchSubmit() {
    if (pending.length === 0) return;
    if (!window.confirm(`Submit all ${pending.length} pending paystubs (total ${fmtAmt(pendingDeposit)}) to EFTPS in one batch?`)) return;
    setBatching(true);
    setBatchResult(null);
    try {
      const res = await api.batchSubmitPaystubs({ clientId: id });
      setBatchResult(res);
      // Refresh paystubs list
      const updated = await api.getPaystubs(id);
      setPaystubs(updated);
    } catch (err) {
      setBatchResult({ error: err.message });
    } finally {
      setBatching(false);
    }
  }

  async function handleDownload(stub) {
    setDownloading(stub.id);
    try {
      await downloadPDF(stub.id, stub.pay_period_end);
    } catch (err) {
      alert(err.message);
    } finally {
      setDownloading(null);
    }
  }

  async function handleDelete(stub) {
    if (!window.confirm(`Delete this paystub? This cannot be undone.`)) return;
    setDeleting(stub.id);
    try {
      await api.deletePaystub(stub.id);
      setPaystubs((prev) => prev.filter((s) => s.id !== stub.id));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <Link to="/">Dashboard</Link><span>/</span>
          <Link to={`/clients/${id}`}>{client?.businessName}</Link><span>/</span>
          <span>Paystubs</span>
        </div>
        <div className="page-header-row">
          <div>
            <h2>Paystubs</h2>
            <p>{client?.businessName} — {paystubs.length} paystub{paystubs.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {pending.length > 0 && (
              <button
                className="btn btn-success"
                onClick={handleBatchSubmit}
                disabled={batching}
              >
                {batching
                  ? <><span className="spinner" /> Submitting…</>
                  : `Submit All Pending (${pending.length})`}
              </button>
            )}
            <Link to={`/clients/${id}/payroll/new`} className="btn btn-primary">+ New Payroll Entry</Link>
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <span>⚠</span> {error}
          </div>
        )}

        {/* Stats row */}
        {paystubs.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Pending Paystubs', value: pending.length, sub: pending.length > 0 ? `${fmtAmt(pendingDeposit)} total deposit` : 'All submitted', accent: pending.length > 0 },
              { label: 'Submitted', value: submitted.length, sub: submitted.length > 0 ? 'Successfully sent to EFTPS' : 'None yet' },
              { label: 'Total Paystubs', value: paystubs.length, sub: `${client?.businessName}` },
            ].map(({ label, value, sub, accent }) => (
              <div key={label} className="card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: accent ? 'var(--warning)' : 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Batch result banner */}
        {batchResult && (
          <div className={`alert ${batchResult.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 16 }}>
            {batchResult.error ? (
              <><span>⚠</span> Batch submission failed: {batchResult.error}</>
            ) : (
              <><span>✓</span> Submitted {batchResult.submitted} paystub{batchResult.submitted !== 1 ? 's' : ''} — total {fmtAmt(batchResult.totalDeposit)}{batchResult.confirmation ? ` · Confirmation: ${batchResult.confirmation}` : ''}</>
            )}
          </div>
        )}

        {/* Bridge status */}
        {bridgeConnected && pending.length > 0 && (
          <div className="alert" style={{ marginBottom: 16, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', color: 'var(--text-primary)' }}>
            <span style={{ color: '#10b981' }}>●</span>
            <div><strong style={{ color: '#10b981' }}>ACH Bridge connected</strong> — batch submit will use the ACH Batch Provider.</div>
          </div>
        )}

        {paystubs.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            <h3 style={{ marginBottom: 8 }}>No paystubs yet</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
              Use "Save as Paystub" when entering payroll to build a queue of paystubs before submitting to EFTPS.
            </p>
            <Link to={`/clients/${id}/payroll/new`} className="btn btn-primary">New Payroll Entry</Link>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
                  {['Employee', 'Pay Period', 'Gross Wages', 'FIT', 'Total Deposit', 'Net Pay', 'Status', 'Date', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paystubs.map((stub) => (
                  <tr key={stub.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                        {stub.employee_name || (stub.first_name ? `${stub.first_name} ${stub.last_name}` : '—')}
                      </div>
                      {stub.work_state && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{stub.work_state} · {stub.pay_frequency}</div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                      <div>{fmtDate(stub.pay_period_start)}</div>
                      <div style={{ color: 'var(--text-muted)' }}>– {fmtDate(stub.pay_period_end)}</div>
                    </td>
                    <td style={{ padding: '11px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmtAmt(stub.gross_wages)}</td>
                    <td style={{ padding: '11px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmtAmt(stub.fit_withholding)}</td>
                    <td style={{ padding: '11px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{fmtAmt(stub.total_deposit)}</td>
                    <td style={{ padding: '11px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--success)' }}>{fmtAmt(stub.net_pay)}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <StatusBadge status={stub.status} />
                      {stub.eftps_confirmation && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>{stub.eftps_confirmation.slice(0, 20)}{stub.eftps_confirmation.length > 20 ? '…' : ''}</div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(stub.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {(stub.status === 'pending' || stub.status === 'failed') && (
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => handleSubmit(stub)}
                            disabled={submitting === stub.id}
                            title="Submit to EFTPS"
                          >
                            {submitting === stub.id ? <span className="spinner" /> : 'Submit'}
                          </button>
                        )}
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleDownload(stub)}
                          disabled={downloading === stub.id}
                          title="Download PDF"
                        >
                          {downloading === stub.id ? <span className="spinner" /> : 'PDF'}
                        </button>
                        {stub.status !== 'submitted' && stub.status !== 'processing' && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(stub)}
                            disabled={deleting === stub.id}
                            title="Delete"
                          >
                            {deleting === stub.id ? <span className="spinner" /> : '×'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
