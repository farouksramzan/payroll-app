import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../api/client';

const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],
  ['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],
  ['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],
  ['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],
  ['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
  ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],
  ['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
  ['DC','Washington D.C.'],
];

const EMPTY = {
  businessName: '', ein: '', state: 'TX', batchProviderPin: '', eftpsInternetPassword: '', eftpsEnrollmentNumber: '',
  depositSchedule: 'monthly', sutaRate: '2.7',
  bankAccountNumber: '', bankRoutingNumber: '', bankAccountType: 'checking',
  contactName: '', contactEmail: '', contactPhone: '',
  payrollFrequency: 'biweekly', nextPayrollDate: '', nextCheckNumber: '1001',
};

export default function ClientForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    if (!isEdit) return;
    api.getClient(id).then((c) => {
      setForm({
        businessName: c.businessName || '',
        ein: c.ein || '',
        state: c.state || 'TX',
        batchProviderPin: '',
        eftpsInternetPassword: '',
        eftpsEnrollmentNumber: c.eftpsEnrollmentNumber || '',
        depositSchedule: c.depositSchedule || 'monthly',
        sutaRate: c.sutaRate != null ? String(parseFloat(c.sutaRate) * 100) : '2.7',
        bankAccountNumber: '',
        bankRoutingNumber: c.bankRoutingNumber || '',
        bankAccountType: c.bankAccountType || 'checking',
        contactName: c.contactName || '',
        contactEmail: c.contactEmail || '',
        contactPhone: c.contactPhone || '',
        payrollFrequency: c.payrollFrequency || 'biweekly',
        nextPayrollDate: c.nextPayrollDate || '',
        nextCheckNumber: c.nextCheckNumber != null ? String(c.nextCheckNumber) : '1001',
      });
    }).catch((err) => setApiError(err.message)).finally(() => setLoading(false));
  }, [id, isEdit]);

  function set(field) {
    return (e) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      setErrors((err) => ({ ...err, [field]: '' }));
    };
  }

  function validate() {
    const e = {};
    if (!form.businessName.trim()) e.businessName = 'Required';
    if (!form.ein.trim()) e.ein = 'Required';
    else if (!/^\d{2}-?\d{7}$/.test(form.ein.trim())) e.ein = 'Format: XX-XXXXXXX';
    if (!isEdit && !form.batchProviderPin) e.batchProviderPin = 'Required';
    if (form.batchProviderPin && !/^\d{4}$/.test(form.batchProviderPin)) e.batchProviderPin = 'Must be exactly 4 digits';
    if (form.bankRoutingNumber && !/^\d{9}$/.test(form.bankRoutingNumber)) e.bankRoutingNumber = 'Must be 9 digits';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    setApiError('');
    try {
      const payload = { ...form, sutaRate: parseFloat(form.sutaRate || 2.7) / 100 };
      if (!payload.bankAccountNumber) delete payload.bankAccountNumber;
      if (!payload.batchProviderPin) delete payload.batchProviderPin;
      if (!payload.eftpsInternetPassword) delete payload.eftpsInternetPassword;
      if (isEdit) {
        await api.updateClient(id, payload);
        navigate(`/clients/${id}`);
      } else {
        const created = await api.createClient(payload);
        navigate(`/clients/${created.id}`);
      }
    } catch (err) {
      setApiError(err.message);
    } finally {
      setSaving(false);
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
          <Link to="/">Dashboard</Link>
          <span>/</span>
          <span>{isEdit ? 'Edit Client' : 'Add Client'}</span>
        </div>
        <h2>{isEdit ? 'Edit Client' : 'Add New Client'}</h2>
        <p>{isEdit ? 'Update client information and credentials' : 'Enter business details and EFTPS credentials'}</p>
      </div>

      <div className="page-body" style={{ maxWidth: 720 }}>
        {apiError && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <span>⚠</span> {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="card">
            <p className="form-section-title" style={{ marginTop: 0 }}>Business Information</p>

            <div className="form-group">
              <label className="form-label">Business Name <span>*</span></label>
              <input className="form-input" value={form.businessName} onChange={set('businessName')} placeholder="Acme Corp" />
              {errors.businessName && <p className="form-error-msg">{errors.businessName}</p>}
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">EIN <span>*</span></label>
                <input className="form-input mono" value={form.ein} onChange={set('ein')} placeholder="12-3456789" />
                {errors.ein && <p className="form-error-msg">{errors.ein}</p>}
                <p className="form-hint">Format: XX-XXXXXXX</p>
              </div>
              <div className="form-group">
                <label className="form-label">Deposit Schedule</label>
                <select className="form-select" value={form.depositSchedule} onChange={set('depositSchedule')}>
                  <option value="monthly">Monthly</option>
                  <option value="semiweekly">Semi-weekly</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ maxWidth: 280 }}>
              <label className="form-label">State of Business</label>
              <select className="form-select" value={form.state} onChange={set('state')}>
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code}>{code} — {name}</option>
                ))}
              </select>
              <p className="form-hint">Used for SUI wage base and state income tax calculations. Employees can override individually.</p>
            </div>

            <p className="form-section-title">EFTPS Credentials</p>

            <div className="form-group">
              <label className="form-label">Batch Provider PIN {!isEdit && <span>*</span>}</label>
              <input
                className="form-input mono"
                type="password"
                autoComplete="new-password"
                value={form.batchProviderPin}
                onChange={set('batchProviderPin')}
                placeholder={isEdit ? '••••  (leave blank to keep current)' : '4-digit PIN'}
                maxLength={4}
              />
              {errors.batchProviderPin && <p className="form-error-msg">{errors.batchProviderPin}</p>}
              <p className="form-hint">Stored encrypted with AES-256. Never stored in plaintext.</p>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">EFTPS Internet Password</label>
                <input
                  className="form-input mono"
                  type="password"
                  value={form.eftpsInternetPassword}
                  onChange={set('eftpsInternetPassword')}
                  placeholder={isEdit ? '(leave blank to keep current)' : 'Internet password for eftps.gov'}
                />
                <p className="form-hint">Required for online login automation. Stored encrypted.</p>
              </div>
              <div className="form-group">
                <label className="form-label">EFTPS Enrollment Number</label>
                <input
                  className="form-input mono"
                  value={form.eftpsEnrollmentNumber}
                  onChange={set('eftpsEnrollmentNumber')}
                  placeholder="Optional — from EFTPS enrollment letter"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">SUI (State Unemployment) Rate (%)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  className="form-input mono"
                  type="number"
                  min="0"
                  max="20"
                  step="0.01"
                  value={form.sutaRate}
                  onChange={set('sutaRate')}
                  style={{ maxWidth: 120 }}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>%</span>
              </div>
              <p className="form-hint">New employer default is 2.7% (varies by state). Check your state unemployment notice for your assigned rate.</p>
            </div>

            <p className="form-section-title">Bank Account</p>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Account Number</label>
                <input
                  className="form-input mono"
                  type="password"
                  value={form.bankAccountNumber}
                  onChange={set('bankAccountNumber')}
                  placeholder={isEdit ? '(leave blank to keep current)' : 'Account number'}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Routing Number</label>
                <input className="form-input mono" value={form.bankRoutingNumber} onChange={set('bankRoutingNumber')} placeholder="9-digit routing number" maxLength={9} />
                {errors.bankRoutingNumber && <p className="form-error-msg">{errors.bankRoutingNumber}</p>}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Account Type</label>
              <select className="form-select" value={form.bankAccountType} onChange={set('bankAccountType')} style={{ maxWidth: 200 }}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </div>

            <p className="form-section-title">Payroll Schedule</p>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Payroll Frequency</label>
                <select className="form-select" value={form.payrollFrequency} onChange={set('payrollFrequency')}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="semimonthly">Semi-monthly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <p className="form-hint">How often employees are paid. Used for the payroll calendar and tax calculations.</p>
              </div>
              <div className="form-group">
                <label className="form-label">Next Payroll Date</label>
                <input className="form-input" type="date" value={form.nextPayrollDate} onChange={set('nextPayrollDate')} />
                <p className="form-hint">Shown on the dashboard as a reminder. Auto-advances after each payroll run.</p>
              </div>
            </div>

            {!isEdit && (
              <div className="form-group" style={{ maxWidth: 200 }}>
                <label className="form-label">Starting Check Number</label>
                <input className="form-input mono" type="number" min="1" step="1" value={form.nextCheckNumber} onChange={set('nextCheckNumber')} />
                <p className="form-hint">Sequential check numbers are assigned automatically from this starting value.</p>
              </div>
            )}

            <p className="form-section-title">Contact Information</p>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Contact Name</label>
                <input className="form-input" value={form.contactName} onChange={set('contactName')} placeholder="Jane Smith" />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={form.contactPhone} onChange={set('contactPhone')} placeholder="(555) 000-0000" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.contactEmail} onChange={set('contactEmail')} placeholder="jane@acmecorp.com" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
            <Link to={isEdit ? `/clients/${id}` : '/'} className="btn btn-secondary">Cancel</Link>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : isEdit ? 'Save Changes' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
