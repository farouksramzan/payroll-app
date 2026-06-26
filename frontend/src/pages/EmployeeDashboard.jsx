import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function fmt(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px', borderRadius: 6,
  border: '1.5px solid var(--border)',
  fontSize: 13, color: 'var(--text-primary)',
  background: 'var(--bg)', outline: 'none',
};

export default function EmployeeDashboard() {
  const { user, logout } = useAuth();

  const [me,       setMe]       = useState(null);
  const [paystubs, setPaystubs] = useState([]);
  const [tab,      setTab]      = useState('paystubs');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [editing,  setEditing]  = useState(false);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState('');

  useEffect(() => {
    Promise.all([api.getEmployeePortalMe(), api.getEmployeePortalPaystubs()])
      .then(([m, p]) => { setMe(m); setForm(buildForm(m)); setPaystubs(p); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function buildForm(m) {
    return { address: m.address || '', city: m.city || '', state: m.state || '', zip: m.zip || '' };
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setSaveMsg('');
    try {
      const updated = await api.updateEmployeePortalMe(form);
      setMe(updated); setEditing(false); setSaveMsg('Profile updated.');
    } catch (err) {
      setSaveMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="spinner spinner-dark" style={{ width: 36, height: 36 }} />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>

      {/* Nav */}
      <div style={{
        height: 'var(--nav-h)', background: 'var(--accent)',
        display: 'flex', alignItems: 'center', padding: '0 28px',
        gap: 16, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.4px' }}>
          Payroll<span style={{ color: '#7ca4e0' }}>Tax</span> Pro
        </div>
        {me && (
          <>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18 }}>|</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{me.firstName} {me.lastName}</div>
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>{user?.email || user?.username}</span>
        <button
          onClick={logout}
          style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '6px 14px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, maxWidth: 860, margin: '0 auto', width: '100%', padding: '28px 24px' }}>

        {error && (
          <div style={{ background: 'var(--error-light)', border: '1px solid var(--error)', borderRadius: 6, padding: '10px 16px', marginBottom: 20, fontSize: 13, color: 'var(--error)' }}>
            {error}
          </div>
        )}

        {me && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px', margin: 0 }}>
              {me.firstName} {me.lastName}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
              {me.jobTitle || 'Employee'} · {me.payType === 'hourly' ? `$${(me.payRate || 0).toFixed(2)}/hr` : `$${(me.payRate || 0).toLocaleString()}/yr`}
            </p>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'var(--bg-tertiary)', borderRadius: 8, padding: 3, width: 'fit-content' }}>
          {[['paystubs', 'My Pay Records'], ['profile', 'My Profile']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: tab === k ? '#fff' : 'transparent',
                boxShadow: tab === k ? 'var(--shadow)' : 'none',
                fontWeight: tab === k ? 700 : 500,
                fontSize: 13, color: tab === k ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Pay Records tab */}
        {tab === 'paystubs' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
              <span className="card-title">Pay Records</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{paystubs.length} total</span>
            </div>
            {paystubs.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>No pay records yet</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Your accountant will post them here when available.</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                    {['Period', 'Gross Pay', 'Fed. Tax', 'SS Tax', 'Medicare', 'Net Pay'].map(h => (
                      <th key={h} style={{ padding: '10px 18px', textAlign: h === 'Period' ? 'left' : 'right', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paystubs.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border-light)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '13px 18px', fontSize: 13, fontWeight: 600 }}>Q{p.tax_quarter} {p.tax_year}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.gross_wages)}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.fit_withholding)}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.employee_ss)}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{fmt(p.employee_medicare)}</td>
                      <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>{fmt(p.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Profile tab */}
        {tab === 'profile' && me && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Read-only info card */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Employment Information</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Managed by your accountant</span>
              </div>
              {[
                ['Job Title',    me.jobTitle   || '—'],
                ['Pay Type',     me.payType    || '—'],
                ['Pay Rate',     me.payType === 'hourly' ? `$${(me.payRate || 0).toFixed(2)}/hr` : `$${(me.payRate || 0).toLocaleString()}/yr`],
                ['Hire Date',    me.hireDate   || '—'],
                ['SSN on File',  me.ssn        || '—'],
                ['Routing #',    me.routingNumber  || 'Not on file'],
                ['Account #',    me.accountNumber  || 'Not on file'],
                ['Account Type', me.accountType    || '—'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
                  <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Editable contact info */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Contact Information</span>
                {!editing && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>
                )}
              </div>

              {saveMsg && (
                <div style={{ background: 'var(--success-light)', border: '1px solid var(--success)', borderRadius: 6, padding: '8px 14px', marginBottom: 14, fontSize: 13, color: 'var(--success)' }}>
                  {saveMsg}
                </div>
              )}

              {!editing ? (
                <>
                  {[
                    ['Address', [me.address, me.city, me.state, me.zip].filter(Boolean).join(', ') || '—'],
                    ['Email',   me.email  || '—'],
                    ['Phone',   me.phone  || '—'],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border-light)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
                      <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>{value}</span>
                    </div>
                  ))}
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                    You can update your address below. Email and phone changes must be handled by your accountant.
                  </p>
                </>
              ) : (
                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>
                    Update your contact address below. Pay rate, SSN, and banking details must be changed by your accountant.
                  </p>
                  {[
                    ['address', 'Street Address', 'text'],
                    ['city',    'City',           'text'],
                    ['state',   'State',          'text'],
                    ['zip',     'ZIP Code',       'text'],
                  ].map(([field, label, type]) => (
                    <div key={field}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
                      <input type={type} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                        style={INPUT_STYLE}
                        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                      />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                      {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save Changes'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setForm(buildForm(me)); setSaveMsg(''); }}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
