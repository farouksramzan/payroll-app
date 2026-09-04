import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

function fmtAmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Single status line for one tax form — icon + label + amount + confirmation number
function StatusLine({ form, status, amount, confirmation, submittedAt }) {
  const isSubmitted  = status === 'submitted' || status === 'dry_run';
  const isDryRun     = status === 'dry_run';
  const isFailed     = status === 'failed';
  const isProcessing = status === 'processing';

  const iconBg    = isSubmitted ? '#10b981' : isFailed ? 'var(--error)' : isProcessing ? '#d97706' : 'transparent';
  const iconBdr   = isSubmitted ? '#10b981' : isFailed ? 'var(--error)' : isProcessing ? '#d97706' : 'var(--border)';
  const iconColor = (isSubmitted || isFailed || isProcessing) ? '#fff' : 'var(--text-muted)';
  const icon      = isSubmitted ? '✓' : isFailed ? '✕' : isProcessing ? '…' : '·';

  const labelColor = isSubmitted ? '#10b981' : isFailed ? 'var(--error)' : 'var(--text-muted)';
  const labelText  = isSubmitted
    ? (isDryRun ? 'Dry Run' : 'Deposited')
    : isFailed ? 'Failed' : isProcessing ? 'Processing' : 'Pending';

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '4px 0' }}>
      <div style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.6667rem', fontWeight: 800,
        background: iconBg, border: `1.5px solid ${iconBdr}`, color: iconColor,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '0.8rem', lineHeight: 1.3 }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Form {form}</span>
          <span style={{ color: labelColor, fontWeight: 600 }}> — {labelText}</span>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 4, fontSize: '0.7333rem' }}>{fmtAmt(amount)}</span>
        </div>
        {confirmation && (
          <div style={{ fontSize: '0.6667rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2, wordBreak: 'break-all' }}>
            Conf# {confirmation}
          </div>
        )}
        {submittedAt && isSubmitted && !isDryRun && (
          <div style={{ fontSize: '0.6667rem', color: 'var(--text-muted)', marginTop: 1 }}>
            {new Date(submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )}
      </div>
    </div>
  );
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

function SUIModal({ stub, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!stub) return;
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stub, onClose]);

  if (!stub) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sui-modal-title" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 28, maxWidth: 480, width: '100%', outline: 'none' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 id="sui-modal-title" style={{ margin: 0, fontSize: '1.0667rem' }}>SUI — State Unemployment Insurance</h3>
          <button onClick={onClose} aria-label="Close" title="Close" style={{ background: 'none', border: 'none', fontSize: '1.3333rem', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <span>⚠</span>
          <strong>SUI is NOT submitted via EFTPS.</strong>
        </div>
        <p style={{ fontSize: '0.9333rem', lineHeight: 1.7, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Your <strong>{stub.work_state}</strong> State Unemployment Insurance (SUI) deposit of{' '}
          <strong style={{ color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>{fmtAmt(stub.suta_tax)}</strong>{' '}
          is due through your <strong>state unemployment agency</strong> — not EFTPS.
        </p>
        <p style={{ fontSize: '0.8667rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Each state has its own online portal. Examples:
        </p>
        <ul style={{ fontSize: '0.8667rem', color: 'var(--text-muted)', lineHeight: 1.8, marginTop: 8, paddingLeft: 20 }}>
          <li><strong>TX</strong> — Texas Workforce Commission (TWC): twc.texas.gov</li>
          <li><strong>CA</strong> — EDD e-Services for Business: edd.ca.gov</li>
          <li><strong>NY</strong> — NY Department of Labor: labor.ny.gov</li>
          <li><strong>FL</strong> — Florida DEO Connect: connect.myflorida.com</li>
          <li>Other states — search "[State] unemployment tax filing online"</li>
        </ul>
        <div style={{ marginTop: 20, textAlign: 'right' }}>
          <button className="btn btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

function BatchResultBanner({ result, onDismiss }) {
  if (!result) return null;
  return (
    <div className={`alert ${result.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 16 }}>
      {result.error ? (
        <><span>⚠</span> Batch submission failed: {result.error}</>
      ) : (
        <><span>✓</span> Submitted {result.submitted} paystub{result.submitted !== 1 ? 's' : ''} ({result.taxType?.toUpperCase()}) — total {fmtAmt(result.totalDeposit)}{result.confirmation ? ` · Conf: ${result.confirmation}` : ''}</>
      )}
      <button onClick={onDismiss} aria-label="Dismiss message" title="Dismiss" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, fontSize: '1.0667rem' }}>×</button>
    </div>
  );
}

export default function Paystubs() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client,          setClient]          = useState(null);
  const [paystubs,        setPaystubs]        = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');
  const [submitting,      setSubmitting]       = useState(null); // { id, taxType }
  const [batching941,     setBatching941]      = useState(false);
  const [batching940,     setBatching940]      = useState(false);
  const [downloading,     setDownloading]      = useState(null);
  const [deleting,        setDeleting]         = useState(null);
  const [batchResult,     setBatchResult]      = useState(null);
  const [suiStub,         setSuiStub]          = useState(null); // SUI info modal
  const [bridgeConnected, setBridgeConnected]  = useState(false);
  const [viewMode,        setViewMode]         = useState('all'); // 'all' | 'quarterly' | 'annual940'

  useEffect(() => {
    Promise.all([api.getClient(id), api.getPaystubs(id)])
      .then(([c, stubs]) => { setClient(c); setPaystubs(stubs); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    api.getBridgeStatus().then((d) => setBridgeConnected(d.connected)).catch(() => {});
  }, [id]);

  // Computed stats
  const pending941  = paystubs.filter((s) => s.status === 'pending' || s.status === 'failed');
  const pending940  = paystubs.filter((s) => (s.status_940 === 'pending' || s.status_940 === 'failed') && s.futa_tax > 0);
  const submitted941 = paystubs.filter((s) => s.status === 'submitted' || s.status === 'dry_run');
  const totalPending941Deposit  = pending941.reduce((s, p) => s + (p.total_deposit || 0), 0);
  const totalPending940Deposit  = pending940.reduce((s, p) => s + (p.futa_tax || 0), 0);

  // Group paystubs by quarter for quarterly view
  const byQuarter = paystubs.reduce((acc, s) => {
    const key = `${s.tax_year}-Q${s.tax_quarter}`;
    if (!acc[key]) acc[key] = { label: `Q${s.tax_quarter} ${s.tax_year}`, stubs: [] };
    acc[key].stubs.push(s);
    return acc;
  }, {});

  async function handleSubmit(stub, taxType) {
    setSubmitting({ id: stub.id, taxType });
    try {
      const res = await api.submitPaystub(stub.id, taxType);
      setPaystubs((prev) => prev.map((s) => s.id === stub.id ? { ...s, ...res.paystub } : s));
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(null);
    }
  }

  async function handleBatch(taxType, taxYear, taxQuarter) {
    const allPending = taxType === '940' ? pending940 : pending941;
    // When a year/quarter filter is passed, the server submits only that quarter —
    // the confirmation must show that quarter's count and total, not the all-time ones.
    const scoped = (taxYear && taxQuarter)
      ? allPending.filter((s) => Number(s.tax_year) === Number(taxYear) && Number(s.tax_quarter) === Number(taxQuarter))
      : allPending;
    if (scoped.length === 0) return;

    const totalAmt = scoped.reduce((sum, s) => sum + ((taxType === '940' ? s.futa_tax : s.total_deposit) || 0), 0);
    const label    = taxType === '940' ? `940 FUTA` : `941`;
    const filter   = (taxYear && taxQuarter) ? ` for Q${taxQuarter} ${taxYear}` : '';
    if (!window.confirm(`Submit ${scoped.length} pending ${label} paystub${scoped.length !== 1 ? 's' : ''}${filter} (total ${fmtAmt(totalAmt)}) to EFTPS?`)) return;

    taxType === '940' ? setBatching940(true) : setBatching941(true);
    setBatchResult(null);
    try {
      const res = await api.batchSubmitPaystubs({ clientId: id, taxType, taxYear, taxQuarter });
      setBatchResult(res);
      const updated = await api.getPaystubs(id);
      setPaystubs(updated);
    } catch (err) {
      setBatchResult({ error: err.message });
    } finally {
      setBatching941(false);
      setBatching940(false);
    }
  }

  async function handleDownload(stub) {
    setDownloading(stub.id);
    try { await downloadPDF(stub.id, stub.pay_period_end); }
    catch (err) { alert(err.message); }
    finally { setDownloading(null); }
  }

  async function handleDelete(stub) {
    if (!window.confirm('Delete this paystub? This cannot be undone.')) return;
    setDeleting(stub.id);
    try {
      await api.deletePaystub(stub.id);
      setPaystubs((prev) => prev.filter((s) => s.id !== stub.id));
    } catch (err) { alert(err.message); }
    finally { setDeleting(null); }
  }

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36, margin: '0 auto' }} />
    </div>
  );

  function StubTable({ stubs, showGroupHeader }) {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
            {['Check #', 'Employee', 'Pay Period', 'Gross', '941 Deposit', 'FUTA (940)', 'SUI', 'Submission Status', ''].map((h) => (
              <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7333rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stubs.map((stub) => {
            const isSubmitting941 = submitting?.id === stub.id && submitting?.taxType === '941';
            const isSubmitting940 = submitting?.id === stub.id && submitting?.taxType === '940';
            const hasFUTA = (stub.futa_tax || 0) > 0;
            const hasSUI  = (stub.suta_tax || 0) > 0;
            const can941  = stub.status !== 'submitted' && stub.status !== 'processing';
            const can940  = hasFUTA && stub.status_940 !== 'submitted' && stub.status_940 !== 'processing';
            const canDel  = stub.status !== 'submitted' && stub.status !== 'processing' &&
                            stub.status_940 !== 'submitted' && stub.status_940 !== 'processing' && stub.status_940 !== 'dry_run';

            return (
              <tr key={stub.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {stub.check_number ? `#${stub.check_number}` : '—'}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.8667rem' }}>
                    {stub.employee_name || (stub.first_name ? `${stub.first_name} ${stub.last_name}` : '—')}
                  </div>
                  {stub.work_state && <div style={{ fontSize: '0.7333rem', color: 'var(--text-muted)' }}>{stub.work_state}</div>}
                </td>
                <td style={{ padding: '10px 12px', fontSize: '0.8rem', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                  <div>{fmtDate(stub.pay_period_start)}</div>
                  <div style={{ color: 'var(--text-muted)' }}>→ {fmtDate(stub.pay_period_end)}</div>
                </td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8667rem' }}>{fmtAmt(stub.gross_wages)}</td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8667rem', fontWeight: 700, color: 'var(--accent)' }}>{fmtAmt(stub.total_deposit)}</td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8667rem', color: hasFUTA ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {hasFUTA ? fmtAmt(stub.futa_tax) : '—'}
                </td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8667rem', color: hasSUI ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {hasSUI ? fmtAmt(stub.suta_tax) : '—'}
                </td>
                <td style={{ padding: '10px 12px', minWidth: 220 }}>
                  <StatusLine
                    form="941"
                    status={stub.status}
                    amount={stub.total_deposit}
                    confirmation={stub.eftps_confirmation}
                    submittedAt={stub.submitted_at}
                  />
                  {hasFUTA && (
                    <StatusLine
                      form="940"
                      status={stub.status_940 || 'pending'}
                      amount={stub.futa_tax}
                      confirmation={stub.eftps_940_confirmation}
                      submittedAt={stub.eftps_940_submitted_at}
                    />
                  )}
                </td>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {/* Submit 941 */}
                    {can941 && (
                      <button className="btn btn-primary btn-sm" onClick={() => handleSubmit(stub, '941')} disabled={submitting !== null} title="Submit Form 941 (FIT + SS + Medicare) to EFTPS">
                        {isSubmitting941 ? <span className="spinner" /> : '941'}
                      </button>
                    )}
                    {/* Submit 940 */}
                    {can940 && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleSubmit(stub, '940')} disabled={submitting !== null} title="Submit Form 940 (FUTA) to EFTPS">
                        {isSubmitting940 ? <span className="spinner" /> : '940'}
                      </button>
                    )}
                    {/* SUI info */}
                    {hasSUI && (
                      <button className="btn btn-secondary btn-sm" onClick={() => setSuiStub(stub)} title={`SUI ${fmtAmt(stub.suta_tax)} — not via EFTPS`} style={{ background: 'var(--warning-light, #fef3c7)', borderColor: 'var(--warning)', color: 'var(--warning)' }}>
                        SUI
                      </button>
                    )}
                    {/* Edit */}
                    <Link to={`/clients/${id}/paystubs/${stub.id}/edit`} className="btn btn-secondary btn-sm" title="View / Edit paystub">
                      Edit
                    </Link>
                    {/* PDF */}
                    <button className="btn btn-secondary btn-sm" onClick={() => handleDownload(stub)} disabled={downloading === stub.id} title="Download PDF">
                      {downloading === stub.id ? <span className="spinner" /> : 'PDF'}
                    </button>
                    {/* Delete */}
                    {canDel && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(stub)} disabled={deleting === stub.id} title="Delete paystub" aria-label="Delete paystub">
                        {deleting === stub.id ? <span className="spinner" /> : '×'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

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
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {pending941.length > 0 && (
              <button className="btn btn-primary" onClick={() => handleBatch('941')} disabled={batching941 || batching940}>
                {batching941 ? <><span className="spinner" /> Submitting…</> : `Submit All 941 (${pending941.length})`}
              </button>
            )}
            {pending940.length > 0 && (
              <button className="btn btn-secondary" onClick={() => handleBatch('940')} disabled={batching941 || batching940}>
                {batching940 ? <><span className="spinner" /> Submitting…</> : `Submit All 940 FUTA (${pending940.length})`}
              </button>
            )}
            <Link to={`/clients/${id}/payroll/new`} className="btn btn-secondary">+ New Payroll Entry</Link>
          </div>
        </div>
      </div>

      <div className="page-body">
        {error && <div className="alert alert-error" style={{ marginBottom: 20 }}><span>⚠</span> {error}</div>}

        <BatchResultBanner result={batchResult} onDismiss={() => setBatchResult(null)} />

        {bridgeConnected && (pending941.length > 0 || pending940.length > 0) && (
          <div className="alert" style={{ marginBottom: 16, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)' }}>
            <span style={{ color: '#10b981' }}>●</span>
            <div><strong style={{ color: '#10b981' }}>ACH Bridge connected</strong> — batch submit will use the ACH Batch Provider.</div>
          </div>
        )}

        {/* Stats */}
        {paystubs.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
            {[
              { label: 'Pending 941',       value: pending941.length,  sub: fmtAmt(totalPending941Deposit),  accent: pending941.length > 0 },
              { label: 'Pending 940 (FUTA)', value: pending940.length,  sub: fmtAmt(totalPending940Deposit),  accent: pending940.length > 0 },
              { label: 'Submitted 941',      value: submitted941.length, sub: 'Deposited via EFTPS' },
              { label: 'Total Paystubs',     value: paystubs.length,    sub: client?.businessName },
            ].map(({ label, value, sub, accent }) => (
              <div key={label} className="card" style={{ padding: '14px 18px' }}>
                <div style={{ fontSize: '0.6667rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: '1.7333rem', fontWeight: 700, color: accent ? 'var(--warning)' : 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        )}

        {paystubs.length > 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            EFTPS deposits pay the taxes — they don't file the quarterly Form 941 or annual Form 940 return.{' '}
            <Link to={`/reports?clientId=${id}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>File returns on the File Forms page →</Link>
          </div>
        )}

        {/* View mode toggle */}
        {paystubs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[['all', 'All Paystubs'], ['quarterly', 'By Quarter (941)']].map(([mode, label]) => (
              <button key={mode} className={`btn btn-sm ${viewMode === mode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setViewMode(mode)}>{label}</button>
            ))}
          </div>
        )}

        {paystubs.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '2.6667rem', marginBottom: 12 }}>📄</div>
            <h3 style={{ marginBottom: 8 }}>No paystubs yet</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Use "Save as Paystub" when entering payroll to build a queue before submitting.</p>
            <Link to={`/clients/${id}/payroll/new`} className="btn btn-primary">New Payroll Entry</Link>
          </div>
        ) : viewMode === 'quarterly' ? (
          // Quarterly view — grouped by Q/year with per-quarter batch button
          Object.entries(byQuarter).sort(([a], [b]) => b.localeCompare(a)).map(([key, { label, stubs }]) => {
            const qPending941 = stubs.filter((s) => s.status === 'pending' || s.status === 'failed');
            const [year, qStr] = key.split('-Q');
            const quarter = parseInt(qStr, 10);
            return (
              <div key={key} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
                <div style={{ padding: '10px 16px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '0.8667rem' }}>{label}</span>
                    <span style={{ marginLeft: 10, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{stubs.length} paystub{stubs.length !== 1 ? 's' : ''} · 941 deposit {fmtAmt(stubs.reduce((s, p) => s + p.total_deposit, 0))}</span>
                  </div>
                  {qPending941.length > 0 && (
                    <button className="btn btn-primary btn-sm" onClick={() => handleBatch('941', parseInt(year, 10), quarter)} disabled={batching941 || batching940}>
                      {batching941 ? <span className="spinner" /> : `Submit Q${quarter} ${year} 941 (${qPending941.length})`}
                    </button>
                  )}
                </div>
                <StubTable stubs={stubs} />
              </div>
            );
          })
        ) : (
          // Flat list
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <StubTable stubs={paystubs} />
          </div>
        )}

        {/* SUI modal */}
        <SUIModal stub={suiStub} onClose={() => setSuiStub(null)} />
      </div>
    </>
  );
}
