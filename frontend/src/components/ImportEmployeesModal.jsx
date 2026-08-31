import { useState, useRef } from 'react';
import api from '../api/client';

// Show only the last 4 of an SSN in the preview — full SSNs shouldn't sit on
// screen during a client screen-share. The full value is still imported.
function maskSSN(ssn) {
  const digits = String(ssn || '').replace(/\D/g, '');
  if (!digits) return null;
  return `•••-••-${digits.slice(-4)}`;
}

export default function ImportEmployeesModal({ clientId, onClose, onImported }) {
  const [file, setFile]             = useState(null);
  const [preview, setPreview]       = useState(null);
  const [skipExisting, setSkip]     = useState(true);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [done, setDone]             = useState(null);
  const inputRef = useRef();

  async function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setError('');
    setPreview(null);
    setLoading(true);
    try {
      const result = await api.previewEmployeeImport(clientId, f);
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
      const result = await api.importEmployees(clientId, file, skipExisting);
      setDone(result);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const toImport = preview ? preview.rows.filter(r => !(skipExisting && r.alreadyExists)) : [];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: 12, padding: 28, width: '100%',
        maxWidth: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0 }}>Import Employees from Excel</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <h3 style={{ marginBottom: 8 }}>{done.imported} employee{done.imported !== 1 ? 's' : ''} imported</h3>
            {done.skipped > 0 && <p style={{ color: 'var(--text-muted)' }}>{done.skipped} skipped (already exist)</p>}
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
              Pay rate, pay type, and filing details will need to be filled in for each employee.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            {/* File picker */}
            <div
              onClick={() => inputRef.current?.click()}
              style={{
                border: '2px dashed var(--border)', borderRadius: 8, padding: '24px 16px',
                textAlign: 'center', cursor: 'pointer', marginBottom: 16,
                background: file ? 'var(--bg-primary)' : 'transparent',
              }}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileChange} />
              {file
                ? <><div style={{ fontWeight: 600 }}>{file.name}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Click to change file</div></>
                : <><div style={{ fontWeight: 600, marginBottom: 4 }}>Click to select file</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>QuickBooks Employee List export (.xlsx) or CSV</div></>
              }
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 16 }}>
              Existing employees are matched by name and skipped — the import never updates them, so no duplicates are created unless you uncheck the skip option.
            </p>

            {loading && (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <div className="spinner spinner-dark" style={{ width: 28, height: 28, margin: '0 auto' }} />
              </div>
            )}

            {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span> {error}</div>}

            {preview && !loading && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Found <strong style={{ color: 'var(--text-primary)' }}>{preview.count}</strong> employees
                    {skipExisting && preview.rows.some(r => r.alreadyExists) && (
                      <span style={{ color: 'var(--warning)' }}> · {preview.rows.filter(r => r.alreadyExists).length} matched by name (will skip)</span>
                    )}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={skipExisting} onChange={e => setSkip(e.target.checked)} />
                    Skip existing employees (matched by name)
                  </label>
                </div>

                {preview.rows.some(r => r.alreadyExists) && (
                  skipExisting ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                      Matching is by name only. If a row marked "Exists" is really a different person with the same name, uncheck the box above — but that re-imports every matched row.
                    </div>
                  ) : (
                    <div className="alert alert-warning" style={{ marginBottom: 10, fontSize: 12 }}>
                      <span>⚠</span> {preview.rows.filter(r => r.alreadyExists).length} row{preview.rows.filter(r => r.alreadyExists).length !== 1 ? 's' : ''} marked "Exists" will be imported as new, duplicate employee records. Leave the box checked unless these are different people who share a name.
                    </div>
                  )
                )}

                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}>
                        {['Name', 'SSN', 'Address', 'City', 'State', 'Status'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-light)', opacity: (skipExisting && r.alreadyExists) ? 0.45 : 1 }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.firstName} {r.lastName}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{maskSSN(r.ssn) || '—'}</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{r.address || '—'}</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{r.city || '—'}</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{r.state || '—'}</td>
                          <td style={{ padding: '8px 12px' }}>
                            {r.alreadyExists
                              ? <span className="badge badge-neutral">Exists</span>
                              : <span className="badge badge-success">New</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    onClick={handleImport}
                    disabled={toImport.length === 0}
                  >
                    Import {toImport.length} Employee{toImport.length !== 1 ? 's' : ''}
                  </button>
                </div>

                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
                  Pay rate, pay type, and W-4 details will default to hourly/$0/single — edit each employee after importing.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
