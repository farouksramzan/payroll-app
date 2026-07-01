import { useState, useRef } from 'react';
import api from '../api/client';

const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CHECK_STATUS_OPTIONS = [
  { value: 'printed',                   label: 'Printed' },
  { value: 'deposited',                 label: 'Deposited' },
  { value: 'direct_deposit_sent',       label: 'Direct Deposit Sent' },
  { value: 'direct_deposit_cleared',    label: 'Direct Deposit Cleared' },
  { value: 'draft',                     label: 'Draft' },
];

const LIABILITY_STATUS_OPTIONS = [
  { value: 'pending',   label: 'Pending' },
  { value: 'submitted', label: 'Submitted' },
];

export default function ImportPaychecksModal({ clientId, onClose, onImported }) {
  const [file, setFile]               = useState(null);
  const [preview, setPreview]         = useState(null);
  const [skipExisting, setSkip]       = useState(true);
  const [checkStatus, setCheckStatus] = useState('printed');
  const [liabilityStatus, setLiabilityStatus] = useState('pending');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [done, setDone]               = useState(null);
  const inputRef = useRef();

  async function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setError('');
    setPreview(null);
    setLoading(true);
    try {
      const result = await api.previewPaycheckImport(clientId, f);
      setPreview(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.importPaychecks(clientId, file, skipExisting, checkStatus, liabilityStatus);
      setDone(result);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const toImport = preview ? preview.checks.filter(c => !(skipExisting && c.alreadyExists)) : [];
  const unmatched = preview ? preview.checks.filter(c => !c.empMatched) : [];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 28, width: '100%', maxWidth: 820, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0 }}>Import Paycheck History</h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>QuickBooks Tax Tracking Detail export (.xlsx)</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <h3 style={{ marginBottom: 8 }}>{done.imported} paycheck{done.imported !== 1 ? 's' : ''} imported</h3>
            {done.skipped > 0 && <p style={{ color: 'var(--text-muted)' }}>{done.skipped} skipped (check numbers already exist{done.patched > 0 ? `, ${done.patched} patched with tips` : ''})</p>}
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>Paychecks are marked as printed / 941 completed. Pay period dates are estimated — adjust per check if needed.</p>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div onClick={() => inputRef.current?.click()} style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 16, background: file ? 'var(--bg-primary)' : 'transparent' }}>
              <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileChange} />
              {file
                ? <><div style={{ fontWeight: 600 }}>{file.name}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Click to change file</div></>
                : <><div style={{ fontWeight: 600, marginBottom: 4 }}>Click to select file</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>QuickBooks Tax Tracking Detail export — must include the "Detail Data" sheet</div></>
              }
            </div>

            {loading && <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner spinner-dark" style={{ width: 28, height: 28, margin: '0 auto' }} /></div>}
            {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span> {error}</div>}

            {preview && !loading && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Found <strong style={{ color: 'var(--text-primary)' }}>{preview.count}</strong> checks
                    {unmatched.length > 0 && <span style={{ color: '#f59e0b', marginLeft: 8 }}>· {unmatched.length} employee{unmatched.length !== 1 ? 's' : ''} not matched (import employees first)</span>}
                    {skipExisting && preview.checks.some(c => c.alreadyExists) && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· {preview.checks.filter(c => c.alreadyExists).length} already exist (will skip)</span>}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={skipExisting} onChange={e => setSkip(e.target.checked)} />
                    Skip existing check numbers
                  </label>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>
                        {['Check#', 'Date', 'Employee', 'Gross', 'Tips', 'FIT', 'SS+Med', 'Net Pay', '941 Deposit', 'Status'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.checks.map((c, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-light)', opacity: (skipExisting && c.alreadyExists) ? 0.4 : 1, background: !c.empMatched ? '#fffbeb' : 'transparent' }}>
                          <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{c.checkNumber || '—'}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{c.checkDate}</td>
                          <td style={{ padding: '7px 10px' }}>
                            <div style={{ fontWeight: 600, fontSize: 12 }}>{c.empName}</div>
                            {!c.empMatched && <div style={{ fontSize: 10, color: '#f59e0b' }}>Not found in employees</div>}
                          </td>
                          <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{fmt(c.grossWages)}</td>
                          <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: c.reportedTips > 0 ? '#7c3aed' : 'var(--text-muted)' }}>{c.reportedTips > 0 ? fmt(c.reportedTips) : '—'}</td>
                          <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#dc2626' }}>{fmt(c.fit)}</td>
                          <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#dc2626' }}>{fmt(c.eeSS + c.eeMedicare)}</td>
                          <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(c.netPay)}</td>
                          <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{fmt(c.totalDeposit)}</td>
                          <td style={{ padding: '7px 10px' }}>
                            {c.alreadyExists
                              ? <span className="badge badge-neutral" style={{ fontSize: 10 }}>Exists</span>
                              : c.empMatched
                                ? <span className="badge badge-success" style={{ fontSize: 10 }}>Ready</span>
                                : <span className="badge" style={{ fontSize: 10, background: '#fef3c7', color: '#92400e' }}>No employee</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: 20, padding: '12px 0', borderTop: '1px solid var(--border-light)', marginBottom: 4, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 600 }}>Paycheck Status</label>
                    <select
                      value={checkStatus}
                      onChange={e => setCheckStatus(e.target.value)}
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}
                    >
                      {CHECK_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 600 }}>Liability Status</label>
                    <select
                      value={liabilityStatus}
                      onChange={e => setLiabilityStatus(e.target.value)}
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}
                    >
                      {LIABILITY_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, alignSelf: 'center' }}>
                    Applies to all {toImport.length} check{toImport.length !== 1 ? 's' : ''} being imported
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleImport} disabled={toImport.length === 0}>
                    Import {toImport.length} Check{toImport.length !== 1 ? 's' : ''}
                  </button>
                </div>

                {unmatched.length > 0 && (
                  <p style={{ fontSize: 12, color: '#92400e', marginTop: 10, textAlign: 'center', background: '#fef3c7', padding: '6px 12px', borderRadius: 6 }}>
                    Unmatched employees will still be imported with their check data — link them to an employee manually afterward.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
