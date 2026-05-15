import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
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
  firstName: '', lastName: '', ssn: '',
  address: '', city: '', state: 'TX', zip: '',
  workState: '',
  filingStatus: 'single', step2Checkbox: false,
  step3Children: 0, step3Other: 0,
  step4a: '', step4b: '', step4c: '',
  payType: 'hourly', hourlyRate: '', annualSalary: '',
  payFrequency: 'biweekly', hireDate: '', isActive: true,
};

const PAY_FREQ_LABELS = {
  weekly: 'Weekly', biweekly: 'Bi-weekly',
  semimonthly: 'Semi-monthly', monthly: 'Monthly',
};

export default function EmployeeForm() {
  const { id, empId } = useParams();
  const isEdit = !!empId;
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [form, setForm]     = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    const tasks = [api.getClient(id)];
    if (isEdit) tasks.push(api.getEmployee(empId));
    Promise.all(tasks)
      .then(([c, emp]) => {
        setClient(c);
        if (emp) {
          setForm({
            firstName: emp.firstName || '',
            lastName:  emp.lastName  || '',
            ssn: '',
            address: emp.address || '', city: emp.city || '',
            state: emp.state || 'TX', zip: emp.zip || '',
            workState: emp.workState || '',
            filingStatus: emp.filingStatus || 'single',
            step2Checkbox: !!emp.step2Checkbox,
            step3Children: emp.step3Children || 0,
            step3Other:    emp.step3Other    || 0,
            step4a: emp.step4a > 0 ? String(emp.step4a) : '',
            step4b: emp.step4b > 0 ? String(emp.step4b) : '',
            step4c: emp.step4c > 0 ? String(emp.step4c) : '',
            payType: emp.payType || 'hourly',
            hourlyRate: emp.hourlyRate > 0 ? String(emp.hourlyRate) : '',
            annualSalary: emp.annualSalary > 0 ? String(emp.annualSalary) : '',
            payFrequency: emp.payFrequency || 'biweekly',
            hireDate: emp.hireDate || '',
            isActive: emp.isActive !== undefined ? emp.isActive : true,
          });
        }
      })
      .catch((err) => setApiError(err.message))
      .finally(() => setLoading(false));
  }, [id, empId, isEdit]);

  function set(field) {
    return (e) => {
      const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setForm((f) => ({ ...f, [field]: val }));
      setErrors((err) => ({ ...err, [field]: '' }));
    };
  }

  function validate() {
    const e = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim())  e.lastName  = 'Required';
    if (form.ssn && !/^\d{9}$/.test(form.ssn.replace(/\D/g, ''))) e.ssn = 'SSN must be 9 digits';
    if (form.payType === 'hourly' && form.hourlyRate && isNaN(parseFloat(form.hourlyRate))) e.hourlyRate = 'Must be a number';
    if (form.payType === 'salary' && form.annualSalary && isNaN(parseFloat(form.annualSalary))) e.annualSalary = 'Must be a number';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    setApiError('');
    try {
      const payload = {
        clientId: id,
        ...form,
        step3Children: parseInt(form.step3Children || 0),
        step3Other:    parseInt(form.step3Other    || 0),
        step4a: parseFloat(form.step4a || 0),
        step4b: parseFloat(form.step4b || 0),
        step4c: parseFloat(form.step4c || 0),
        hourlyRate:   parseFloat(form.hourlyRate   || 0),
        annualSalary: parseFloat(form.annualSalary || 0),
      };
      if (!payload.ssn) delete payload.ssn;
      if (isEdit) {
        await api.updateEmployee(empId, payload);
      } else {
        await api.createEmployee(payload);
      }
      navigate(`/clients/${id}/employees`);
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
          <Link to="/">Dashboard</Link><span>/</span>
          <Link to={`/clients/${id}`}>{client?.businessName}</Link><span>/</span>
          <Link to={`/clients/${id}/employees`}>Employees</Link><span>/</span>
          <span>{isEdit ? 'Edit Employee' : 'Add Employee'}</span>
        </div>
        <h2>{isEdit ? 'Edit Employee' : 'Add New Employee'}</h2>
        <p>{isEdit ? 'Update employee information and W-4 settings' : 'Enter employee details and withholding preferences'}</p>
      </div>

      <div className="page-body" style={{ maxWidth: 800 }}>
        {apiError && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <span>⚠</span> {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Personal Info */}
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="form-section-title" style={{ marginTop: 0 }}>Personal Information</p>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">First Name <span>*</span></label>
                <input className="form-input" value={form.firstName} onChange={set('firstName')} placeholder="Jane" />
                {errors.firstName && <p className="form-error-msg">{errors.firstName}</p>}
              </div>
              <div className="form-group">
                <label className="form-label">Last Name <span>*</span></label>
                <input className="form-input" value={form.lastName} onChange={set('lastName')} placeholder="Smith" />
                {errors.lastName && <p className="form-error-msg">{errors.lastName}</p>}
              </div>
            </div>

            <div className="form-group" style={{ maxWidth: 280 }}>
              <label className="form-label">Social Security Number {isEdit && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(leave blank to keep current)</span>}</label>
              <input
                className="form-input mono"
                type="password"
                value={form.ssn}
                onChange={set('ssn')}
                placeholder="###-##-####"
                maxLength={11}
              />
              {errors.ssn && <p className="form-error-msg">{errors.ssn}</p>}
              <p className="form-hint">Stored encrypted with AES-256.</p>
            </div>

            <p className="form-section-title">Address</p>
            <div className="form-group">
              <label className="form-label">Street Address</label>
              <input className="form-input" value={form.address} onChange={set('address')} placeholder="123 Main St" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">City</label>
                <input className="form-input" value={form.city} onChange={set('city')} placeholder="Austin" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">State (Address)</label>
                <select className="form-select" value={form.state} onChange={set('state')}>
                  {US_STATES.map(([code, name]) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">ZIP</label>
                <input className="form-input mono" value={form.zip} onChange={set('zip')} placeholder="78701" maxLength={10} />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 16, maxWidth: 320 }}>
              <label className="form-label">State of Work <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(for tax withholding)</span></label>
              <select className="form-select" value={form.workState} onChange={set('workState')}>
                <option value="">— Use client's state default —</option>
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code}>{code} — {name}</option>
                ))}
              </select>
              <p className="form-hint">Override if this employee works in a different state than the business. Determines SUI wage base and state income tax.</p>
            </div>

            <div className="form-group" style={{ marginTop: 16, maxWidth: 200 }}>
              <label className="form-label">Hire Date</label>
              <input className="form-input" type="date" value={form.hireDate} onChange={set('hireDate')} />
            </div>

            {isEdit && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.isActive} onChange={set('isActive')} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
                  <span style={{ fontSize: 13 }}>Employee is active</span>
                </label>
              </div>
            )}
          </div>

          {/* Pay settings */}
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="form-section-title" style={{ marginTop: 0 }}>Pay Settings</p>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Pay Type</label>
                <select className="form-select" value={form.payType} onChange={set('payType')}>
                  <option value="hourly">Hourly</option>
                  <option value="salary">Salary</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Pay Frequency</label>
                <select className="form-select" value={form.payFrequency} onChange={set('payFrequency')}>
                  {Object.entries(PAY_FREQ_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>

            {form.payType === 'hourly' ? (
              <div className="form-group" style={{ maxWidth: 200 }}>
                <label className="form-label">Hourly Rate</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                  <input className="form-input mono" type="number" min="0" step="0.01" value={form.hourlyRate} onChange={set('hourlyRate')} placeholder="0.00" style={{ paddingLeft: 24 }} />
                </div>
                {errors.hourlyRate && <p className="form-error-msg">{errors.hourlyRate}</p>}
              </div>
            ) : (
              <div className="form-group" style={{ maxWidth: 240 }}>
                <label className="form-label">Annual Salary</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                  <input className="form-input mono" type="number" min="0" step="1000" value={form.annualSalary} onChange={set('annualSalary')} placeholder="0" style={{ paddingLeft: 24 }} />
                </div>
                {errors.annualSalary && <p className="form-error-msg">{errors.annualSalary}</p>}
              </div>
            )}
          </div>

          {/* W-4 defaults */}
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="form-section-title" style={{ marginTop: 0 }}>W-4 Withholding Defaults</p>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16 }}>
              These defaults will pre-fill the payroll entry form when this employee is selected.
            </p>

            <div className="form-group">
              <label className="form-label">Filing Status (Step 1)</label>
              <select className="form-select" value={form.filingStatus} onChange={set('filingStatus')} style={{ maxWidth: 360 }}>
                <option value="single">Single or Married filing separately</option>
                <option value="married">Married filing jointly or Qualifying surviving spouse</option>
                <option value="hoh">Head of household</option>
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" checked={form.step2Checkbox} onChange={set('step2Checkbox')} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
              <span style={{ fontSize: 13 }}>Step 2(c): Two jobs total checkbox</span>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Step 3 — Qualifying children (×$2,200)</label>
                <input className="form-input" type="number" min="0" max="20" value={form.step3Children}
                  onChange={(e) => setForm((f) => ({ ...f, step3Children: parseInt(e.target.value || 0) }))} style={{ maxWidth: 80 }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Step 3 — Other dependents (×$500)</label>
                <input className="form-input" type="number" min="0" max="20" value={form.step3Other}
                  onChange={(e) => setForm((f) => ({ ...f, step3Other: parseInt(e.target.value || 0) }))} style={{ maxWidth: 80 }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              {[
                { key: 'step4a', label: 'Step 4(a) Other income (annual)', placeholder: '0' },
                { key: 'step4b', label: 'Step 4(b) Deductions (annual)', placeholder: '0' },
                { key: 'step4c', label: 'Step 4(c) Extra withholding (per period)', placeholder: '0' },
              ].map(({ key, label, placeholder }) => (
                <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">{label}</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>$</span>
                    <input className="form-input mono" type="number" min="0" step="100"
                      value={form[key]} onChange={set(key)} placeholder={placeholder} style={{ paddingLeft: 24 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Link to={`/clients/${id}/employees`} className="btn btn-secondary">Cancel</Link>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : isEdit ? 'Save Changes' : 'Add Employee'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
