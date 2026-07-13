import { useState, useRef } from 'react';
import api from '../api/client';

const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FREQ_LABELS = {
  weekly:      'Weekly',
  biweekly:    'Biweekly',
  semimonthly: 'Semimonthly',
  monthly:     'Monthly',
};

const CHECK_STATUS_OPTIONS = [
  { value: 'printed',                label: 'Printed' },
  { value: 'deposited',              label: 'Deposited' },
  { value: 'direct_deposit_sent',    label: 'Direct Deposit Sent' },
  { value: 'direct_deposit_cleared', label: 'Direct Deposit Cleared' },
  { value: 'draft',                  label: 'Draft' },
];

const LIABILITY_STATUS_OPTIONS = [
  { value: 'pending',    label: 'Pending — show in Pay Liabilities' },
  { value: 'processing', label: 'Processing — already submitted to EFTPS' },
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

  const toImport   = preview ? preview.checks.filter(c => !(skipExisting && c.alreadyExists)) : [];
  const unmatched  = preview ? preview.checks.filter(c => !c.empMatched) : [];
  const alreadyExist = preview ? preview.checks.filter(c => c.alreadyExists) : [];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 28, width: '100%', maxWidth: 860, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0 }}>Import Paycheck History</h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>QuickBooks Tax Tracking Detail export (.xlsx)</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {done ? (
          <DoneScreen done={done} onClose={onClose} />
        ) : (
          <>
            <div
              onClick={() => inputRef.current?.click()}
              style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 16, background: file ? 'var(--bg-primary)' : 'transparent' }}
            >
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
                {/* ── Smart import summary ── */}
                <SmartSummary
                  preview={preview}
                  skipExisting={skipExisting}
                  alreadyExistCount={alreadyExist.length}
                  setSkip={setSkip}
                />

                {/* ── Check table ── */}
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 14 }}>
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
                            {!c.empMatched && <div style={{ fontSize: 10, color: '#d97706' }}>Profile will be auto-created</div>}
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
                              : !c.empMatched
                                ? <span className="badge" style={{ fontSize: 10, background: '#fef3c7', color: '#92400e' }}>New emp</span>
                                : <span className="badge badge-success" style={{ fontSize: 10 }}>Ready</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Options bar ── */}
                <div style={{ display: 'flex', gap: 20, padding: '10px 0', borderTop: '1px solid var(--border-light)', marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 600 }}>Check Status</label>
                    <select value={checkStatus} onChange={e => setCheckStatus(e.target.value)} style={selectStyle}>
                      {CHECK_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 600 }}>Liability Status</label>
                    <select value={liabilityStatus} onChange={e => setLiabilityStatus(e.target.value)} style={selectStyle}>
                      {LIABILITY_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Applies to all {toImport.length} check{toImport.length !== 1 ? 's' : ''} being imported
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    onClick={handleImport}
                    disabled={toImport.length === 0 && alreadyExist.length === 0}
                  >
                    {toImport.length > 0
                      ? `Import ${toImport.length} Check${toImport.length !== 1 ? 's' : ''}`
                      : `Fix Group Assignments (${alreadyExist.length} checks)`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const selectStyle = {
  fontSize: 12, padding: '4px 8px', borderRadius: 0,
  border: '1px solid var(--border)', background: 'var(--bg-card)',
  color: 'var(--text-primary)', cursor: 'pointer',
};

// ── Smart summary strip shown between file drop and check table ───────────────
function SmartSummary({ preview, skipExisting, alreadyExistCount, setSkip }) {
  const { payGroupActions, willAutoCreateEmployees } = preview;
  const newEmpsCount = (willAutoCreateEmployees || []).length;
  const groups = payGroupActions || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      {/* Counts row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Found <strong style={{ color: 'var(--text-primary)' }}>{preview.count}</strong> checks
        </span>
        {alreadyExistCount > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            · {alreadyExistCount} already in system
          </span>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={skipExisting} onChange={e => setSkip(e.target.checked)} />
          Skip existing
        </label>
      </div>

      {/* Smart cards row — one card per detected frequency/pay group */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {groups.map(pg => (
          <div key={pg.frequency} style={infoCard(
            pg.action === 'match' ? '#f0fdf4' : '#fdf4ff',
            pg.action === 'match' ? '#166534' : '#6b21a8',
          )}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7 }}>
              {FREQ_LABELS[pg.frequency] || pg.frequency} · {pg.action === 'match' ? 'Matched' : 'Will Create'}
            </span>
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              {pg.action === 'match' ? pg.groupName : pg.suggestedName}
            </span>
            <span style={{ fontSize: 11, opacity: 0.65 }}>{pg.checkCount} check{pg.checkCount !== 1 ? 's' : ''}</span>
          </div>
        ))}

        {/* Auto-create employees */}
        {newEmpsCount > 0 && (
          <div style={infoCard('#fffbeb', '#92400e')}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7 }}>
              New Employee{newEmpsCount !== 1 ? 's' : ''}
            </span>
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              {newEmpsCount} profile{newEmpsCount !== 1 ? 's' : ''} will be auto-created
            </span>
          </div>
        )}
      </div>

      {/* W-4 guidance banner for new employees */}
      {newEmpsCount > 0 && (
        <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 7, padding: '8px 12px', fontSize: 12, color: '#78350f' }}>
          <strong>Action required after import:</strong> The following employee profiles will be created with blank tax settings. Go to each employee and fill in their W-4 info (filing status, allowances, deductions) so future payroll calculations are accurate.
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
            {(willAutoCreateEmployees || []).map(name => (
              <span key={name} style={{ fontFamily: 'monospace', fontWeight: 600 }}>{name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function infoCard(bg, color) {
  return {
    background: bg,
    border: `1px solid ${color}22`,
    borderRadius: 7,
    padding: '6px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    color,
    minWidth: 140,
  };
}

// ── Done screen ───────────────────────────────────────────────────────────────
function DoneScreen({ done, onClose }) {
  const hasNewEmps = done.employeesCreated && done.employeesCreated.length > 0;
  const groups = done.payGroups || [];

  return (
    <div style={{ textAlign: 'center', padding: '28px 0' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
      <h3 style={{ marginBottom: 6 }}>{done.imported} paycheck{done.imported !== 1 ? 's' : ''} imported</h3>

      {(done.skipped > 0 || done.repaired > 0) && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {done.skipped > 0 && <>{done.skipped} skipped</>}
          {done.patched  > 0 && <> · {done.patched} patched with tips</>}
          {done.repaired > 0 && <> · <strong style={{ color: '#166534' }}>{done.repaired} reassigned to correct group</strong></>}
        </p>
      )}

      {/* Pay group results */}
      {groups.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {groups.map(pg => (
            <span key={pg.frequency} style={{
              fontSize: 12, padding: '3px 10px', borderRadius: 20,
              background: pg.action === 'create' ? '#fdf4ff' : '#f0fdf4',
              color: pg.action === 'create' ? '#6b21a8' : '#166534',
              border: `1px solid ${pg.action === 'create' ? '#e9d5ff' : '#bbf7d0'}`,
            }}>
              {pg.action === 'create' ? 'Created' : 'Matched'}: {pg.name} ({pg.checkCount} checks)
            </span>
          ))}
        </div>
      )}

      {/* W-4 guidance for auto-created employees */}
      {hasNewEmps && (
        <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', marginBottom: 16, textAlign: 'left', maxWidth: 520, margin: '0 auto 16px' }}>
          <div style={{ fontWeight: 700, color: '#78350f', marginBottom: 6 }}>
            {done.employeesCreated.length} employee profile{done.employeesCreated.length !== 1 ? 's' : ''} auto-created — action needed
          </div>
          <p style={{ fontSize: 12, color: '#92400e', margin: '0 0 8px' }}>
            These profiles were created with blank tax settings. Please open each employee and fill in their W-4 information (filing status, dependents, additional withholding) before running future payroll.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px' }}>
            {done.employeesCreated.map(e => (
              <span key={e.id} style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: '#78350f' }}>{e.name}</span>
            ))}
          </div>
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
        Pay period dates are estimated — adjust per check if needed.
      </p>
      <button className="btn btn-primary" onClick={onClose}>Done</button>
    </div>
  );
}
