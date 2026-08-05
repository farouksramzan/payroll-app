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

// Texas counties: [county name, TWC 3-digit code]
// TWC codes are the last 3 digits of the county FIPS (odd numbers 1-507)
const TX_COUNTIES = [
  ['Anderson','001'],['Andrews','003'],['Angelina','005'],['Aransas','007'],['Archer','009'],
  ['Armstrong','011'],['Atascosa','013'],['Austin','015'],['Bailey','017'],['Bandera','019'],
  ['Bastrop','021'],['Baylor','023'],['Bee','025'],['Bell','027'],['Bexar','029'],
  ['Blanco','031'],['Borden','033'],['Bosque','035'],['Bowie','037'],['Brazoria','039'],
  ['Brazos','041'],['Brewster','043'],['Briscoe','045'],['Brooks','047'],['Brown','049'],
  ['Burleson','051'],['Burnet','053'],['Caldwell','055'],['Calhoun','057'],['Callahan','059'],
  ['Cameron','061'],['Camp','063'],['Carson','065'],['Cass','067'],['Castro','069'],
  ['Chambers','071'],['Cherokee','073'],['Childress','075'],['Clay','077'],['Cochran','079'],
  ['Coke','081'],['Coleman','083'],['Collin','085'],['Collingsworth','087'],['Colorado','089'],
  ['Comal','091'],['Comanche','093'],['Concho','095'],['Cooke','097'],['Coryell','099'],
  ['Cottle','101'],['Crane','103'],['Crockett','105'],['Crosby','107'],['Culberson','109'],
  ['Dallam','111'],['Dallas','113'],['Dawson','115'],['Deaf Smith','117'],['Delta','119'],
  ['Denton','121'],['DeWitt','123'],['Dickens','125'],['Dimmit','127'],['Donley','129'],
  ['Duval','131'],['Eastland','133'],['Ector','135'],['Edwards','137'],['Ellis','139'],
  ['El Paso','141'],['Erath','143'],['Falls','145'],['Fannin','147'],['Fayette','149'],
  ['Fisher','151'],['Floyd','153'],['Foard','155'],['Fort Bend','157'],['Franklin','159'],
  ['Freestone','161'],['Frio','163'],['Gaines','165'],['Galveston','167'],['Garza','169'],
  ['Gillespie','171'],['Glasscock','173'],['Goliad','175'],['Gonzales','177'],['Gray','179'],
  ['Grayson','181'],['Gregg','183'],['Grimes','185'],['Guadalupe','187'],['Hale','189'],
  ['Hall','191'],['Hamilton','193'],['Hansford','195'],['Hardeman','197'],['Hardin','199'],
  ['Harris','201'],['Harrison','203'],['Hartley','205'],['Haskell','207'],['Hays','209'],
  ['Hemphill','211'],['Henderson','213'],['Hidalgo','215'],['Hill','217'],['Hockley','219'],
  ['Hood','221'],['Hopkins','223'],['Houston','225'],['Howard','227'],['Hudspeth','229'],
  ['Hunt','231'],['Hutchinson','233'],['Irion','235'],['Jack','237'],['Jackson','239'],
  ['Jasper','241'],['Jeff Davis','243'],['Jefferson','245'],['Jim Hogg','247'],['Jim Wells','249'],
  ['Johnson','251'],['Jones','253'],['Karnes','255'],['Kaufman','257'],['Kendall','259'],
  ['Kenedy','261'],['Kent','263'],['Kerr','265'],['Kimble','267'],['King','269'],
  ['Kinney','271'],['Kleberg','273'],['Knox','275'],['Lamar','277'],['Lamb','279'],
  ['Lampasas','281'],['La Salle','283'],['Lavaca','285'],['Lee','287'],['Leon','289'],
  ['Liberty','291'],['Limestone','293'],['Lipscomb','295'],['Live Oak','297'],['Llano','299'],
  ['Loving','301'],['Lubbock','303'],['Lynn','305'],['McCulloch','307'],['McLennan','309'],
  ['McMullen','311'],['Madison','313'],['Marion','315'],['Martin','317'],['Mason','319'],
  ['Matagorda','321'],['Maverick','323'],['Medina','325'],['Menard','327'],['Midland','329'],
  ['Milam','331'],['Mills','333'],['Mitchell','335'],['Montague','337'],['Montgomery','339'],
  ['Moore','341'],['Morris','343'],['Motley','345'],['Nacogdoches','347'],['Navarro','349'],
  ['Newton','351'],['Nolan','353'],['Nueces','355'],['Ochiltree','357'],['Oldham','359'],
  ['Orange','361'],['Palo Pinto','363'],['Panola','365'],['Parker','367'],['Parmer','369'],
  ['Pecos','371'],['Polk','373'],['Potter','375'],['Presidio','377'],['Rains','379'],
  ['Randall','381'],['Reagan','383'],['Real','385'],['Red River','387'],['Reeves','389'],
  ['Refugio','391'],['Roberts','393'],['Robertson','395'],['Rockwall','397'],['Runnels','399'],
  ['Rusk','401'],['Sabine','403'],['San Augustine','405'],['San Jacinto','407'],['San Patricio','409'],
  ['San Saba','411'],['Schleicher','413'],['Scurry','415'],['Shackelford','417'],['Shelby','419'],
  ['Sherman','421'],['Smith','423'],['Somervell','425'],['Starr','427'],['Stephens','429'],
  ['Sterling','431'],['Stonewall','433'],['Sutton','435'],['Swisher','437'],['Tarrant','439'],
  ['Taylor','441'],['Terrell','443'],['Terry','445'],['Throckmorton','447'],['Titus','449'],
  ['Tom Green','451'],['Travis','453'],['Trinity','455'],['Tyler','457'],['Upshur','459'],
  ['Upton','461'],['Uvalde','463'],['Val Verde','465'],['Van Zandt','467'],['Victoria','469'],
  ['Walker','471'],['Waller','473'],['Ward','475'],['Washington','477'],['Webb','479'],
  ['Wharton','481'],['Wheeler','483'],['Wichita','485'],['Wilbarger','487'],['Willacy','489'],
  ['Williamson','491'],['Wilson','493'],['Winkler','495'],['Wise','497'],['Wood','499'],
  ['Yoakum','501'],['Young','503'],['Zapata','505'],['Zavala','507'],
];

const EMPTY = {
  businessName: '', ein: '', state: 'TX',
  businessAddress: '', businessCity: '', businessZip: '',
  depositSchedule: 'monthly', sutaRate: '2.7',
  bankAccountNumber: '', bankRoutingNumber: '', bankAccountType: 'checking',
  contactName: '', contactEmail: '', contactPhone: '',
  payrollFrequency: 'biweekly', nextPayrollDate: '', nextCheckNumber: '1001',
  countyCode: '',
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
        businessAddress: c.businessAddress || '',
        businessCity: c.businessCity || '',
        businessZip: c.businessZip || '',
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
        countyCode: c.countyCode || '',
      });
    }).catch((err) => setApiError(err.message)).finally(() => setLoading(false));
  }, [id, isEdit]);

  function set(field) {
    return (e) => {
      const value = e.target.value;
      setForm((f) => ({ ...f, [field]: value }));
      setErrors((errs) => {
        if (!errs[field]) return errs;
        const next = { ...errs };
        delete next[field];
        return next;
      });
    };
  }

  function validate() {
    const e = {};
    if (!form.businessName.trim()) e.businessName = 'Required';
    if (!form.ein.trim()) e.ein = 'Required';
    else if (!/^\d{2}-?\d{7}$/.test(form.ein.trim())) e.ein = 'Format: XX-XXXXXXX';
    if (!form.businessAddress.trim()) e.businessAddress = 'Required';
    if (!form.businessCity.trim()) e.businessCity = 'Required';
    if (!form.businessZip.trim()) e.businessZip = 'Required';
    if (form.bankRoutingNumber && !/^\d{9}$/.test(form.bankRoutingNumber)) e.bankRoutingNumber = 'Must be 9 digits';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      const order = ['businessName', 'ein', 'businessAddress', 'businessCity', 'businessZip', 'bankRoutingNumber'];
      const first = order.find((k) => errs[k]);
      const el = first && document.getElementById(`field-${first}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
      }
      return;
    }
    setErrors({});
    setSaving(true);
    setApiError('');
    try {
      const payload = { ...form, sutaRate: parseFloat(form.sutaRate || 2.7) / 100 };
      if (!payload.bankAccountNumber) delete payload.bankAccountNumber;
      if (!payload.countyCode) payload.countyCode = null;
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
        <p>{isEdit ? 'Update client information and credentials' : 'Enter business, bank, and contact details. EFTPS enrollment and the Batch Provider PIN are set up afterward in the Company tab.'}</p>
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
              <input id="field-businessName" className="form-input" value={form.businessName} onChange={set('businessName')} placeholder="Acme Corp" />
              {errors.businessName && <p className="form-error-msg">{errors.businessName}</p>}
            </div>

            <div className="form-group" style={{ maxWidth: 320 }}>
              <label className="form-label">EIN <span>*</span></label>
              <input id="field-ein" className="form-input mono" value={form.ein} onChange={set('ein')} placeholder="12-3456789" />
              {errors.ein && <p className="form-error-msg">{errors.ein}</p>}
              <p className="form-hint">Format: XX-XXXXXXX</p>
            </div>

            <div className="form-group" style={{ maxWidth: 280 }}>
              <label className="form-label">941 Deposit Schedule</label>
              <select className="form-select" value={form.depositSchedule} onChange={set('depositSchedule')}>
                <option value="monthly">Monthly</option>
                <option value="semiweekly">Semi-weekly</option>
              </select>
              <p className="form-hint">From the client's IRS notice. Monthly vs semi-weekly sets when federal deposits are due — a wrong schedule can mean late deposits and penalties.</p>
            </div>

            <div className="form-group">
              <label className="form-label">Business Address <span>*</span></label>
              <input id="field-businessAddress" className="form-input" value={form.businessAddress} onChange={set('businessAddress')} placeholder="123 Main St" />
              {errors.businessAddress && <p className="form-error-msg">{errors.businessAddress}</p>}
            </div>

            <div className="form-grid" style={{ gridTemplateColumns: '1fr 180px 100px' }}>
              <div className="form-group">
                <label className="form-label">City <span>*</span></label>
                <input id="field-businessCity" className="form-input" value={form.businessCity} onChange={set('businessCity')} placeholder="San Antonio" />
                {errors.businessCity && <p className="form-error-msg">{errors.businessCity}</p>}
              </div>
              <div className="form-group">
                <label className="form-label">State <span>*</span></label>
                <select className="form-select" value={form.state} onChange={set('state')}>
                  {US_STATES.map(([code, name]) => (
                    <option key={code} value={code}>{code} — {name}</option>
                  ))}
                </select>
                <p className="form-hint">Also used for SUI/state tax calculations.</p>
              </div>
              <div className="form-group">
                <label className="form-label">ZIP <span>*</span></label>
                <input id="field-businessZip" className="form-input mono" value={form.businessZip} onChange={set('businessZip')} placeholder="78201" maxLength={10} />
                {errors.businessZip && <p className="form-error-msg">{errors.businessZip}</p>}
              </div>
            </div>


            {form.state === 'TX' && (
              <div className="form-group" style={{ maxWidth: 320 }}>
                <label className="form-label">County</label>
                <select
                  className="form-select"
                  value={form.countyCode}
                  onChange={(e) => setForm((f) => ({ ...f, countyCode: e.target.value }))}
                >
                  <option value="">— Select county —</option>
                  {TX_COUNTIES.map(([name, code]) => (
                    <option key={code} value={code}>{name} ({code})</option>
                  ))}
                </select>
                <p className="form-hint">Required for TWC QuickFile ICESA submission (county code auto-filled).</p>
              </div>
            )}

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
                <input id="field-bankRoutingNumber" className="form-input mono" value={form.bankRoutingNumber} onChange={set('bankRoutingNumber')} placeholder="9-digit routing number" maxLength={9} />
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
              </div>
              <div className="form-group">
                <label className="form-label">Next Payroll Date</label>
                <input className="form-input" type="date" value={form.nextPayrollDate} onChange={set('nextPayrollDate')} />
              </div>
            </div>

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
