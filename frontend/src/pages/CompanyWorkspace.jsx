'use strict';
import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import ImportEmployeesModal from '../components/ImportEmployeesModal';
import ImportPaychecksModal from '../components/ImportPaychecksModal';
import { deleteCheckConfirm } from '../utils/checkConfirm';
import { validRoutingNumber } from '../utils/validators';

// ── Helpers ───────────────────────────────────────────────────────────────────
const EE_SS_RATE       = 0.062;
const EE_MEDICARE_RATE = 0.0145;

function fmt(n) { const v = Number(n || 0); return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtShort(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtPeriod(start, end) {
  if (!start && !end) return '—';
  const s = start ? new Date(start + 'T00:00:00') : null;
  const e = end   ? new Date(end   + 'T00:00:00') : null;
  const mo = { month: 'short', day: 'numeric' };
  if (!s) return e.toLocaleDateString('en-US', mo);
  if (!e) return s.toLocaleDateString('en-US', mo);
  const sStr = s.toLocaleDateString('en-US', mo);
  const eStr = s.getMonth() === e.getMonth() ? e.getDate() : e.toLocaleDateString('en-US', mo);
  return `${sStr} – ${eStr}`;
}
function r2(n) { return Math.round((n || 0) * 100) / 100; }
function cleanDecimal(s) {
  const v = String(s).replace(/[^0-9.]/g, '');
  const i = v.indexOf('.');
  return i === -1 ? v : v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
}
function periodDateWarning(start, end, pay) {
  if (start && end && end < start) return 'Period ends before it starts';
  if (end && pay && pay < end) return 'Pay date is before the period end';
  if (end && pay) {
    const d = new Date(end + 'T00:00:00');
    d.setDate(d.getDate() + 60);
    if (pay > d.toISOString().slice(0, 10)) return 'Pay date is more than 60 days after the period end — double-check the year';
  }
  return null;
}
// Per-period salary for a pending row: honor row.salaryOverride when it's a
// usable number (commas stripped, negatives clamped to 0); otherwise fall back
// to annual/ppy. A blank or non-numeric override reverts to the default rather
// than silently paying $0, so clearing the field can't accidentally zero a check.
function effPeriodSalary(row, emp, ppy) {
  const ov = row == null ? undefined : row.salaryOverride;
  if (ov !== undefined && String(ov).trim() !== '') {
    const n = parseFloat(String(ov).replace(/,/g, ''));
    if (!isNaN(n)) return r2(Math.max(0, n));
  }
  return r2((emp.annualSalary || 0) / ppy);
}
function initials(name) { return name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'; }
const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
const FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Bi-weekly', semimonthly: 'Semi-monthly', monthly: 'Monthly' };

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(dateStr + 'T00:00:00') - today) / 86400000);
}
function isOverdue(dateStr) { const d = daysUntil(dateStr); return d !== null && d < 0; }

// ── Pay Period Calculation ────────────────────────────────────────────────────
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function advancePeriod(s, e, freq) {
  if (freq === 'weekly')      return [addDays(s, 7),  addDays(e, 7)];
  if (freq === 'biweekly')    return [addDays(s, 14), addDays(e, 14)];
  if (freq === 'monthly')     return [new Date(s.getFullYear(), s.getMonth() + 1, s.getDate()), new Date(e.getFullYear(), e.getMonth() + 1, e.getDate())];
  if (freq === 'semimonthly') {
    const ns = addDays(e, 1);
    const ne = ns.getDate() === 1 ? new Date(ns.getFullYear(), ns.getMonth(), 15) : new Date(ns.getFullYear(), ns.getMonth() + 1, 0);
    return [ns, ne];
  }
  return [addDays(s, 14), addDays(e, 14)];
}

function calcUpcomingPeriods(firstStart, firstEnd, freq, count = 14) {
  if (!firstStart || !firstEnd) return [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let s = new Date(firstStart + 'T00:00:00'), e = new Date(firstEnd + 'T00:00:00');
  const result = [];
  while (e < today && result.length < 30) {
    result.push({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), overdue: true });
    [s, e] = advancePeriod(s, e, freq);
  }
  for (let i = 0; i < count; i++) {
    result.push({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), overdue: false });
    [s, e] = advancePeriod(s, e, freq);
  }
  return result;
}

function getCurrentPeriod(firstStart, firstEnd, freq) {
  if (!firstStart || !firstEnd) return { start: '', end: '' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let s = new Date(firstStart + 'T00:00:00'), e = new Date(firstEnd + 'T00:00:00');
  while (e < today) [s, e] = advancePeriod(s, e, freq);
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}

function prevPeriod(s, e, freq) {
  if (freq === 'weekly')      return [addDays(s, -7),  addDays(e, -7)];
  if (freq === 'biweekly')    return [addDays(s, -14), addDays(e, -14)];
  if (freq === 'monthly')     return [new Date(s.getFullYear(), s.getMonth() - 1, s.getDate()), new Date(e.getFullYear(), e.getMonth() - 1, e.getDate())];
  if (freq === 'semimonthly') {
    const ne = addDays(s, -1);
    const ns = ne.getDate() === 15
      ? new Date(ne.getFullYear(), ne.getMonth(), 1)
      : new Date(ne.getFullYear(), ne.getMonth(), 16);
    return [ns, ne];
  }
  return [addDays(s, -14), addDays(e, -14)];
}

const FEDERAL_HOLIDAYS = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-05-27','2024-06-19','2024-07-04',
  '2024-09-02','2024-10-14','2024-11-11','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19','2025-07-04',
  '2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03',
  '2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-19','2027-07-05',
  '2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24',
]);
function isBizDay(d) { const w = d.getDay(); return w !== 0 && w !== 6 && !FEDERAL_HOLIDAYS.has(d.toISOString().slice(0, 10)); }
function addBizDays(d, n) { const r = new Date(d); let added = 0; while (added < n) { r.setDate(r.getDate() + 1); if (isBizDay(r)) added++; } return r; }
function nextBizDay(d) { const r = new Date(d); while (!isBizDay(r)) r.setDate(r.getDate() + 1); return r; }
function calcDefaultPayDate(periodEnd) { if (!periodEnd) return ''; return addBizDays(new Date(periodEnd + 'T00:00:00'), 2).toISOString().slice(0, 10); }
function calcStartFromEnd(endDate, freq) {
  if (!endDate) return '';
  const e = new Date(endDate + 'T00:00:00');
  let s;
  if (freq === 'weekly')        s = addDays(e, -6);
  else if (freq === 'biweekly') s = addDays(e, -13);
  else if (freq === 'monthly')  s = new Date(e.getFullYear(), e.getMonth(), 1);
  else if (freq === 'semimonthly') s = e.getDate() <= 15 ? new Date(e.getFullYear(), e.getMonth(), 1) : new Date(e.getFullYear(), e.getMonth(), 16);
  else s = addDays(e, -13);
  return s.toISOString().slice(0, 10);
}
// Child support per-check override semantics: undefined OR a cleared ("") field
// means "use the employee's order default"; only a real number overrides. Returns
// the effective amount for display/estimates.
function csEffectiveAmount(row, csDefault) {
  const v = row?.childSupport;
  if (v === undefined || String(v).trim() === '') return csDefault || 0;
  return parseFloat(v) || 0;
}
// The payload variant: undefined = let the backend withhold order defaults.
function csOverrideForPayload(row) {
  const v = row?.childSupport;
  if (v === undefined || String(v).trim() === '') return undefined;
  return parseFloat(v) || 0;
}

function calcIRSDepositDue(payDate, depositSchedule) {
  if (!payDate) return '';
  const d = new Date(payDate + 'T00:00:00'), dow = d.getDay();
  let due;
  if (depositSchedule === 'semiweekly') {
    if (dow >= 3 && dow <= 5) { const n = (3 - dow + 7) % 7 || 7; due = new Date(d); due.setDate(d.getDate() + n); }
    else { const n = (5 - dow + 7) % 7 || 7; due = new Date(d); due.setDate(d.getDate() + n); }
  } else { due = new Date(d.getFullYear(), d.getMonth() + 1, 15); }
  return nextBizDay(due).toISOString().slice(0, 10);
}

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

// ── Check Status Badge ────────────────────────────────────────────────────────
const STATUS_CFG = {
  upcoming:               { label: 'Upcoming',           cls: 'badge-neutral' },
  'due-soon':             { label: 'Due Soon',           cls: 'badge-warning' },
  pending:                { label: 'Upcoming',           cls: 'badge-neutral' },
  draft:                  { label: 'Draft',              cls: 'badge-neutral' },
  printed:                { label: 'Printed',            cls: 'badge-accent' },
  direct_deposit_sent:    { label: 'Deposited',          cls: 'badge-success' },
  direct_deposit_cleared: { label: 'Deposited',          cls: 'badge-success' },
  voided:                 { label: 'VOIDED',             cls: 'badge-error' },
  late:                   { label: 'Late',               cls: 'badge-error' },
};
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, cls: 'badge-neutral' };
  return <span className={`badge ${cfg.cls}`} style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 12 }}>{cfg.label}</span>;
}

// ── Employee Drawer ───────────────────────────────────────────────────────────
function EmployeeDrawer({ clientId, empId, onClose, onSaved, onDeleted }) {
  const [form, setForm]       = useState(null);
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSsn, setShowSsn]   = useState(false);
  const [err, setErr]           = useState('');
  const [errField, setErrField] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delAck, setDelAck]     = useState(false);
  const [payGroups, setPayGroups] = useState([]);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', frequency: 'biweekly', firstPayPeriodEnd: '', payDate: '' });
  const [savingGroup, setSavingGroup] = useState(false);
  const [dd, setDd]             = useState(null); // { status, last4, bankAccountType, routingNumber }
  const [csOrders, setCsOrders] = useState([]);   // child support orders for this employee
  const [csForm, setCsForm]     = useState(null); // { vendorName, caseNumber, amount } | null (add form open)
  const [csBusy, setCsBusy]     = useState(false);
  const [csErr, setCsErr]       = useState('');
  // Sectioned drawer: one short tab per topic instead of a single long scroll
  const [tab, setTab] = useState('personal');
  const [ddForm, setDdForm]     = useState({ routingNumber: '', accountNumber: '', confirmAccount: '', bankAccountType: 'checking' });
  const [ddEdit, setDdEdit]     = useState(false);
  const [ddSaving, setDdSaving] = useState(false);
  const [ddErr, setDdErr]       = useState('');

  useEffect(() => {
    api.getPayGroups(clientId).then(setPayGroups).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    if (!empId) return;
    setTab('personal');
    api.getEmployeeChildSupport(empId).then(setCsOrders).catch(() => {});
    api.getDirectDeposit(empId).then(setDd).catch(() => {});
    api.getEmployee(empId, true).then(emp => setForm({
      // ssn intentionally starts blank: the label promises "leave blank to keep
      // current", so prefilling the decrypted SSN made every unrelated save re-send
      // it and contradicted the label.
      firstName: emp.firstName || '', lastName: emp.lastName || '', ssn: '', ssnOnFile: !!emp.ssn,
      address: emp.address || '', city: emp.city || '', state: emp.state || 'TX', zip: emp.zip || '',
      workState: emp.workState || '',
      filingStatus: emp.filingStatus || 'single',
      step2Checkbox: !!emp.step2Checkbox,
      step3Children: emp.step3Children || 0, step3Other: emp.step3Other || 0,
      step4a: emp.step4a > 0 ? String(emp.step4a) : '',
      step4b: emp.step4b > 0 ? String(emp.step4b) : '',
      step4c: emp.step4c > 0 ? String(emp.step4c) : '',
      fitExempt: !!emp.fitExempt,
      payType: emp.payType || 'hourly',
      hourlyRate: emp.hourlyRate > 0 ? String(emp.hourlyRate) : '',
      annualSalary: emp.annualSalary > 0 ? String(emp.annualSalary) : '',
      payFrequency: emp.payFrequency || 'biweekly',
      hireDate: emp.hireDate || '', isActive: emp.isActive !== false,
      payGroupId: emp.payGroupId ? String(emp.payGroupId) : '',
    })).catch(e => setErr(e.message));
  }, [empId]);

  const dirtyRef = useRef(false); // unsaved edits — guard against silent discard on overlay click
  const mainDirtyRef = useRef(false); // main-form edits only — so a DD/CS sub-form save/cancel can't disarm the guard for them
  const drawerRef = useRef(null);
  const confirmDeleteRef = useRef(false);
  confirmDeleteRef.current = confirmDelete;

  function set(field) { return e => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; dirtyRef.current = true; mainDirtyRef.current = true; setForm(f => ({ ...f, [field]: v })); }; }
  function setNG(field) { return e => setNewGroup(g => ({ ...g, [field]: e.target.value })); }

  function requestClose() {
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Discard them?')) return;
    onClose();
  }

  // Escape closes the drawer (with the same unsaved-changes guard); Tab cycles
  // inside the drawer so keyboard focus can't escape to the page behind it.
  useEffect(() => {
    const onKey = e => {
      if (confirmDeleteRef.current) return; // the delete confirm dialog owns the keyboard
      if (e.key === 'Escape') { requestClose(); return; }
      if (e.key !== 'Tab' || !drawerRef.current) return;
      const focusables = Array.from(drawerRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = drawerRef.current.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) { e.preventDefault(); last.focus(); }
      } else {
        if (!inside || active === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move focus into the drawer on open, restore it on close.
  useEffect(() => {
    const prev = document.activeElement;
    drawerRef.current?.focus({ preventScroll: true });
    return () => { prev?.focus?.(); };
  }, []);

  // Browser Back closes the drawer (through the unsaved-changes guard) instead
  // of leaving the workspace and losing edits. The marker is pushed from a
  // timeout and gated on armedRef so StrictMode's mount/cleanup/mount cycle
  // can't leave a stray entry whose history.back() instantly closes the drawer.
  const poppedRef = useRef(false);
  const armedRef = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      window.history.pushState({ empDrawer: true }, '');
      armedRef.current = true;
    }, 0);
    const onPop = () => {
      if (!armedRef.current) return;
      poppedRef.current = true;
      if (dirtyRef.current && !window.confirm('You have unsaved changes. Discard them?')) {
        window.history.pushState({ empDrawer: true }, '');
        poppedRef.current = false;
        return;
      }
      armedRef.current = false;
      onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      clearTimeout(t);
      window.removeEventListener('popstate', onPop);
      if (armedRef.current && !poppedRef.current && window.history.state?.empDrawer) window.history.back();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const warn = e => { if (!dirtyRef.current) return; e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function setNGEndDate(val) { setNewGroup(g => ({ ...g, firstPayPeriodEnd: val, payDate: val ? calcDefaultPayDate(val) : '' })); }

  async function handleCreateGroup() {
    if (!newGroup.name.trim()) { alert('Group name required'); return; }
    setSavingGroup(true);
    try {
      const payload = {
        clientId, ...newGroup,
        firstPayPeriodStart: calcStartFromEnd(newGroup.firstPayPeriodEnd, newGroup.frequency) || null,
      };
      const created = await api.createPayGroup(payload);
      setPayGroups(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(f => ({ ...f, payGroupId: String(created.id), payFrequency: created.frequency }));
      setShowNewGroup(false);
      setNewGroup({ name: '', frequency: 'biweekly', firstPayPeriodEnd: '', payDate: '' });
    } catch (e) { alert(e.message); }
    finally { setSavingGroup(false); }
  }

  function handleGroupChange(e) {
    const val = e.target.value;
    if (val === '__new__') { setShowNewGroup(true); setForm(f => ({ ...f, payGroupId: '' })); return; }
    setShowNewGroup(false);
    const targetGroup = payGroups.find(g => String(g.id) === val);
    // Date consistency check: employee's current group end must match target group's end
    if (targetGroup && targetGroup.firstPayPeriodEnd) {
      const currentGroupObj = payGroups.find(g => String(g.id) === form.payGroupId);
      const empEnd = currentGroupObj?.firstPayPeriodEnd;
      if (empEnd && empEnd !== targetGroup.firstPayPeriodEnd) {
        setErr(`Cannot assign to "${targetGroup.name}". The group's first period end date (${fmtDate(targetGroup.firstPayPeriodEnd)}) does not match this employee's current group (${fmtDate(empEnd)}). All employees in a pay group must share the same pay period schedule.`);
        return;
      }
    }
    setErr('');
    setForm(f => ({ ...f, payGroupId: val, ...(targetGroup ? { payFrequency: targetGroup.frequency } : {}) }));
  }

  function failSave(message, tabKey, field) { setTab(tabKey); setErrField(field); setErr(message); }

  async function handleSave() {
    setErrField('');
    if (ddEdit && (ddForm.routingNumber || ddForm.accountNumber || ddForm.confirmAccount)) { setTab('dd'); setErr('Finish or cancel the bank account form first.'); return; }
    // The drawer previously saved with zero validation — blanked names silently
    // reverted server-side and malformed SSNs were stored as-is. Each error
    // switches to the tab that owns the field so it's never hidden off-screen.
    if (!form.firstName.trim()) { failSave('First and last name are required.', 'personal', 'firstName'); return; }
    if (!form.lastName.trim()) { failSave('First and last name are required.', 'personal', 'lastName'); return; }
    if (form.ssn && !/^\d{3}-?\d{2}-?\d{4}$/.test(form.ssn.trim())) { failSave('SSN must be 9 digits (XXX-XX-XXXX). Leave it blank to keep the current one.', 'personal', 'ssn'); return; }
    if (form.payType === 'hourly' && form.hourlyRate && !(parseFloat(form.hourlyRate) > 0)) { failSave('Hourly rate must be a positive number.', 'pay', 'hourlyRate'); return; }
    if (form.payType === 'salary' && form.annualSalary && !(parseFloat(form.annualSalary) > 0)) { failSave('Annual salary must be a positive number.', 'pay', 'annualSalary'); return; }
    setSaving(true); setErr('');
    try {
      const payload = { clientId, ...form,
        step3Children: parseInt(form.step3Children || 0), step3Other: parseInt(form.step3Other || 0),
        step4a: parseFloat(form.step4a || 0), step4b: parseFloat(form.step4b || 0), step4c: parseFloat(form.step4c || 0),
        hourlyRate: parseFloat(form.hourlyRate || 0), annualSalary: parseFloat(form.annualSalary || 0),
        payGroupId: form.payGroupId ? parseInt(form.payGroupId) : null,
      };
      delete payload.ssnOnFile;
      if (!payload.ssn) delete payload.ssn;
      await api.updateEmployee(empId, payload);
      dirtyRef.current = false;
      mainDirtyRef.current = false;
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function handleSaveDd() {
    if (ddForm.accountNumber !== ddForm.confirmAccount) { setDdErr('Account numbers do not match'); return; }
    if (!/^\d{9}$/.test(ddForm.routingNumber)) { setDdErr('Routing number must be 9 digits'); return; }
    if (!validRoutingNumber(ddForm.routingNumber)) { setDdErr('That routing number doesn\'t look right'); return; }
    if (!/^\d{4,17}$/.test(ddForm.accountNumber)) { setDdErr('Account number must be 4–17 digits'); return; }
    setDdSaving(true); setDdErr('');
    try {
      const result = await api.saveDirectDeposit(empId, { routingNumber: ddForm.routingNumber, accountNumber: ddForm.accountNumber, bankAccountType: ddForm.bankAccountType });
      setDd(result);
      setDdEdit(false);
      setDdForm({ routingNumber: '', accountNumber: '', confirmAccount: '', bankAccountType: 'checking' });
      dirtyRef.current = mainDirtyRef.current;
    } catch (e) { setDdErr(e.message); }
    finally { setDdSaving(false); }
  }

  async function handleRemoveDd() {
    if (!window.confirm('Remove direct deposit bank account for this employee?')) return;
    setDdSaving(true);
    try {
      const result = await api.deleteDirectDeposit(empId);
      setDd(result);
      setDdEdit(false);
    } catch (e) { setDdErr(e.message); }
    finally { setDdSaving(false); }
  }

  async function handleCsAdd() {
    const amt = parseFloat(csForm.amount);
    if (!csForm.vendorName.trim()) { setCsErr('Vendor name is required — it’s who the check is made out to.'); return; }
    if (!(amt > 0)) { setCsErr('Amount per paycheck must be greater than $0.'); return; }
    setCsBusy(true); setCsErr('');
    try {
      const created = await api.createChildSupportOrder({ employeeId: empId, vendorName: csForm.vendorName, caseNumber: csForm.caseNumber, amount: amt });
      setCsOrders(prev => [...prev, created]);
      setCsForm(null);
      dirtyRef.current = mainDirtyRef.current;
    } catch (e) { setCsErr(e.message); }
    finally { setCsBusy(false); }
  }

  async function handleCsToggle(order) {
    try {
      const updated = await api.updateChildSupportOrder(order.id, { active: order.active ? 0 : 1 });
      setCsOrders(prev => prev.map(o => o.id === order.id ? updated : o));
    } catch (e) { setCsErr(e.message); }
  }

  async function handleCsDelete(order) {
    if (!window.confirm(`Remove the ${fmt(order.amount)}/check child support order payable to ${order.vendor_name}?\n\nPast paychecks and pending remittances keep their history — only future withholding stops.`)) return;
    try {
      await api.deleteChildSupportOrder(order.id);
      setCsOrders(prev => prev.filter(o => o.id !== order.id));
    } catch (e) { setCsErr(e.message); }
  }

  function handleDelete() { setDelAck(false); setConfirmDelete(true); }

  async function handleDeleteConfirmed() {
    setDeleting(true);
    try {
      await api.deleteEmployee(empId);
      setConfirmDelete(false);
      setDeleting(false);
      dirtyRef.current = false;
      mainDirtyRef.current = false;
      if (onDeleted) onDeleted(); else onClose();
    } catch (e) { setErr(e.message); setDeleting(false); setConfirmDelete(false); }
  }

  async function handleMarkInactive() {
    setSaving(true); setErr('');
    try {
      await api.updateEmployee(empId, { clientId, isActive: false });
      dirtyRef.current = false;
      setConfirmDelete(false);
      onSaved();
    } catch (e) { setErr(e.message); setConfirmDelete(false); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={requestClose} />
      <div className="drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={form ? `Edit ${form.firstName} ${form.lastName}` : 'Edit employee'}>
        <div className="drawer-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0, paddingBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            {form && (
              <div aria-hidden="true" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>
                {(form.firstName[0] || '') + (form.lastName[0] || '')}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="drawer-title" style={{ marginBottom: form ? 5 : 0 }}>{form ? `${form.firstName} ${form.lastName}` : 'Employee'}</div>
              {form && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button"
                    onClick={() => { dirtyRef.current = true; mainDirtyRef.current = true; setForm(f => ({ ...f, isActive: !f.isActive })); }}
                    title="Click to toggle active status (saved with Save Changes)"
                    style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 99, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em',
                      border: `1px solid ${form.isActive ? '#86efac' : '#d1d5db'}`,
                      background: form.isActive ? '#f0fdf4' : 'var(--bg-secondary)', color: form.isActive ? '#16a34a' : 'var(--text-muted)' }}>
                    {form.isActive ? '● Active' : '○ Inactive'}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {form.payType === 'salary'
                      ? `${form.annualSalary ? fmt(parseFloat(form.annualSalary)) : '—'}/yr`
                      : `${form.hourlyRate ? fmt(parseFloat(form.hourlyRate)) : '—'}/hr`}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {FREQ_LABEL[form.payFrequency] || form.payFrequency}</span>
                  </span>
                  {form.payGroupId && (() => {
                    const g = payGroups.find(x => String(x.id) === String(form.payGroupId));
                    return g ? <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '1px 8px', borderRadius: 99 }}>{g.name}</span> : null;
                  })()}
                  {form.fitExempt && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-light)', padding: '2px 8px', borderRadius: 99 }}>EXEMPT</span>}
                </div>
              )}
            </div>
            <button className="drawer-close" onClick={requestClose} aria-label="Close">×</button>
          </div>
          {form && (
            <div role="tablist" aria-label="Employee profile sections" style={{ display: 'flex', gap: 2, marginTop: 12, flexWrap: 'wrap' }}>
              {[
                ['personal', 'Personal'],
                ['pay', 'Pay'],
                ['w4', 'W-4 Tax'],
                ['dd', 'Direct Deposit'],
                ['cs', 'Child Support'],
              ].map(([k, label]) => {
                const active = tab === k;
                const ddStatusLabel = dd?.status === 'active' ? 'Direct deposit active' : dd?.status === 'pending' ? 'Direct deposit pending' : dd?.status === 'failed' ? 'Direct deposit failed' : undefined;
                const marker = k === 'dd'
                  ? <span title={ddStatusLabel} aria-label={ddStatusLabel} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dd?.status === 'active' ? '#16a34a' : dd?.status === 'pending' ? '#d97706' : dd?.status === 'failed' ? '#dc2626' : '#d1d5db' }} />
                      {dd?.status === 'failed' && <span style={{ fontSize: 11.5, fontWeight: 800, color: '#dc2626' }}>!</span>}
                      {dd?.status === 'active' && <span style={{ fontSize: 11.5, fontWeight: 800, color: '#16a34a' }}>✓</span>}
                    </span>
                  : k === 'cs' && csOrders.length > 0
                    ? <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, background: active ? 'var(--accent)' : 'var(--bg-tertiary)', color: active ? '#fff' : 'var(--text-muted)', borderRadius: 99, padding: '0 7px' }}>{csOrders.length}</span>
                    : null;
                return (
                  <button key={k} role="tab" aria-selected={active} onClick={() => setTab(k)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '9px 13px', fontSize: 15, whiteSpace: 'nowrap',
                      fontWeight: active ? 700 : 500, color: active ? 'var(--accent)' : 'var(--text-secondary)',
                      borderBottom: `3px solid ${active ? 'var(--accent)' : 'transparent'}`, marginBottom: -1 }}>
                    {label}{marker}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="drawer-body">
          {err && <div className="alert alert-error" style={{ marginBottom: 16 }}><span>⚠</span>{err}</div>}
          {!form ? (
            <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 28, height: 28 }} /></div>
          ) : (
            <>
              {tab === 'personal' && (<>
              <div className="form-grid">
                <div className="form-group"><label className="form-label">First Name <span>*</span></label><input className="form-input" value={form.firstName} onChange={set('firstName')} style={errField === 'firstName' ? { borderColor: 'var(--error)' } : undefined} /></div>
                <div className="form-group"><label className="form-label">Last Name <span>*</span></label><input className="form-input" value={form.lastName} onChange={set('lastName')} style={errField === 'lastName' ? { borderColor: 'var(--error)' } : undefined} /></div>
              </div>
              <div className="form-group">
                <label className="form-label">SSN <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)', textTransform: 'none' }}>{form.ssnOnFile ? '(on file — type here only to replace it)' : '(none on file yet)'}</span></label>
                <div style={{ position: 'relative' }}>
                  <input className="form-input mono" type={showSsn ? 'text' : 'password'} value={form.ssn} onChange={set('ssn')} placeholder={form.ssnOnFile ? 'leave blank to keep current' : 'XXX-XX-XXXX'} maxLength={11} style={{ paddingRight: 36, ...(errField === 'ssn' ? { borderColor: 'var(--error)' } : {}) }} />
                  <button type="button" onClick={() => setShowSsn(v => !v)} aria-label={showSsn ? 'Hide SSN' : 'Show SSN'} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1, padding: 0 }} title={showSsn ? 'Hide SSN' : 'Show SSN'}>
                    {showSsn ? '🙈' : '👁'}
                  </button>
                </div>
                <p className="form-hint">Stored encrypted with AES-256.</p>
              </div>
              <div className="form-group"><label className="form-label">Street Address</label><input className="form-input" value={form.address} onChange={set('address')} placeholder="123 Main St" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">City</label><input className="form-input" value={form.city} onChange={set('city')} /></div>
                <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">State</label><select className="form-select" value={form.state} onChange={set('state')}>{US_STATES.map(([c]) => <option key={c} value={c}>{c}</option>)}</select></div>
                <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">ZIP</label><input className="form-input mono" value={form.zip} onChange={set('zip')} maxLength={10} /></div>
              </div>
              <div className="form-group" style={{ marginTop: 14 }}>
                <label className="form-label">Work State</label>
                <select className="form-select" value={form.workState} onChange={set('workState')}>
                  <option value="">— Use company default —</option>
                  {US_STATES.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
                </select>
              </div>

              <div className="form-group" style={{ marginTop: 14, maxWidth: 180 }}><label className="form-label">Hire Date</label><input className="form-input" type="date" value={form.hireDate} onChange={set('hireDate')} /></div>
              <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Leaving the company? Use the Active toggle above — deleting erases pay history.</span>
                <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting} style={{ fontSize: 12, flexShrink: 0 }}>
                  {deleting ? <span className="spinner" /> : 'Delete Employee'}
                </button>
              </div>
              </>)}

              {tab === 'pay' && (<>
              <p className="form-section-title" style={{ marginTop: 0 }}>Pay Group</p>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Assigned Pay Group</label>
                <select className="form-select" value={showNewGroup ? '__new__' : (form.payGroupId || '')} onChange={handleGroupChange}>
                  <option value="">— No pay group —</option>
                  {payGroups.filter(g => !g.deletedAt).map(g => <option key={g.id} value={String(g.id)}>{g.name} ({FREQ_LABEL[g.frequency] || g.frequency})</option>)}
                  <option value="__new__">+ Create New Pay Group…</option>
                </select>
              </div>
              {showNewGroup && (
                <div style={{ background: 'var(--accent-light)', borderRadius: 8, padding: '14px 14px 10px', marginBottom: 14, border: '1px solid var(--accent-mid)' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--accent)', marginBottom: 10, textTransform: 'uppercase' }}>New Pay Group</div>
                  <div className="form-group" style={{ marginBottom: 10 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Group Name</label>
                    <input className="form-input" value={newGroup.name} onChange={setNG('name')} placeholder="e.g. Biweekly 1" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 10 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Frequency</label>
                    <select className="form-select" value={newGroup.frequency} onChange={setNG('frequency')}>
                      <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
                      <option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 4 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>First Period End Date</label>
                    <input className="form-input" type="date" value={newGroup.firstPayPeriodEnd} onChange={e => setNGEndDate(e.target.value)} />
                  </div>
                  {newGroup.firstPayPeriodEnd && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                      Period will start: <strong>{fmtDate(calcStartFromEnd(newGroup.firstPayPeriodEnd, newGroup.frequency))}</strong>
                    </div>
                  )}
                  <div className="form-group" style={{ marginBottom: 4 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Pay Date</label>
                    <input className="form-input" type="date" value={newGroup.payDate} onChange={e => setNewGroup(g => ({ ...g, payDate: e.target.value }))} />
                  </div>
                  {newGroup.firstPayPeriodEnd && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      Default (2 biz days after period end): <strong>{fmtDate(calcDefaultPayDate(newGroup.firstPayPeriodEnd))}</strong>
                    </div>
                  )}
                  {newGroup.payDate && !isBizDay(new Date(newGroup.payDate + 'T00:00:00')) && (() => {
                    const suggested = nextBizDay(new Date(newGroup.payDate + 'T00:00:00')).toISOString().slice(0, 10);
                    return (
                      <div style={{ fontSize: 11, color: '#d97706', marginBottom: 10 }}>
                        ⚠ Weekend or holiday — suggest: <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 11, padding: 0 }} onClick={() => setNewGroup(g => ({ ...g, payDate: suggested }))}>{fmtDate(suggested)}</button>
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn btn-primary btn-sm" onClick={handleCreateGroup} disabled={savingGroup}>{savingGroup ? <span className="spinner" /> : 'Create & Assign'}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setShowNewGroup(false); setForm(f => ({ ...f, payGroupId: '' })); }}>Cancel</button>
                  </div>
                </div>
              )}

              <p className="form-section-title">Pay Settings</p>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Pay Type</label>
                  <select className="form-select" value={form.payType} onChange={set('payType')}>
                    <option value="hourly">Hourly</option><option value="salary">Salary</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Pay Frequency</label>
                  <select className="form-select" value={form.payFrequency} onChange={set('payFrequency')}>
                    <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
                    <option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option>
                  </select>
                  {form.payGroupId && <p className="form-hint">Auto-set from pay group. Override if different.</p>}
                </div>
              </div>
              {form.payType === 'hourly' ? (
                <div className="form-group" style={{ maxWidth: 180 }}>
                  <label className="form-label">Hourly Rate</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                    <input className="form-input mono" type="number" min="0" step="0.01" value={form.hourlyRate} onChange={set('hourlyRate')} style={{ paddingLeft: 24, ...(errField === 'hourlyRate' ? { borderColor: 'var(--error)' } : {}) }} />
                  </div>
                </div>
              ) : (
                <div className="form-group" style={{ maxWidth: 220 }}>
                  <label className="form-label">Annual Salary</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                    <input className="form-input mono" type="number" min="0" step="1000" value={form.annualSalary} onChange={set('annualSalary')} style={{ paddingLeft: 24, ...(errField === 'annualSalary' ? { borderColor: 'var(--error)' } : {}) }} />
                  </div>
                </div>
              )}

              </>)}

              {tab === 'w4' && (<>
              <div className="form-group">
                <label className="form-label">Filing Status</label>
                <select className="form-select" value={form.filingStatus} onChange={set('filingStatus')} style={{ maxWidth: 340 }}>
                  <option value="single">Single / Married filing separately</option>
                  <option value="married">Married filing jointly</option>
                  <option value="hoh">Head of household</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 14 }}>
                <input type="checkbox" checked={form.step2Checkbox} onChange={set('step2Checkbox')} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                <span style={{ fontSize: 13 }}>Step 2(c): Two jobs checkbox</span>
              </label>
              <div className="form-grid">
                <div className="form-group"><label className="form-label">Qualifying children (×$2,200)</label><input className="form-input" type="number" min="0" max="20" value={form.step3Children} onChange={e => setForm(f => ({ ...f, step3Children: parseInt(e.target.value || 0) }))} style={{ maxWidth: 80 }} /></div>
                <div className="form-group"><label className="form-label">Other dependents (×$500)</label><input className="form-input" type="number" min="0" max="20" value={form.step3Other} onChange={e => setForm(f => ({ ...f, step3Other: parseInt(e.target.value || 0) }))} style={{ maxWidth: 80 }} /></div>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 6, padding: '9px 10px', border: `1px solid ${form.fitExempt ? 'var(--warning)' : 'var(--border)'}`, background: form.fitExempt ? 'var(--warning-light)' : 'transparent' }}>
                <input type="checkbox" checked={form.fitExempt} onChange={set('fitExempt')} style={{ accentColor: 'var(--warning)', width: 14, height: 14, marginTop: 2 }} />
                <span style={{ fontSize: 13 }}>
                  <strong>Exempt — don&rsquo;t withhold federal income tax</strong>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    For employees who claimed Exempt on their W-4. No federal income tax (including extra withholding) is taken; Social Security and Medicare still apply.
                  </span>
                </span>
              </label>
              <div className="form-group" style={{ opacity: form.fitExempt ? 0.5 : 1 }}>
                <label className="form-label">Extra Withholding <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)', textTransform: 'none' }}>(W-4 Step 4c — per paycheck)</span></label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                  <input className="form-input mono" type="number" min="0" step="0.01" value={form.step4c} onChange={set('step4c')} placeholder="0.00" style={{ maxWidth: 120 }} disabled={form.fitExempt} />
                </div>
                <p className="form-hint">{form.fitExempt ? 'Ignored while Exempt is checked.' : 'Withheld as additional federal income tax on every paycheck, on top of the calculated amount.'}</p>
              </div>
              </>)}

              {/* ── Child Support ── */}
              {tab === 'cs' && (<>
              {csErr && <div className="alert alert-error" role="alert" style={{ marginBottom: 10, fontSize: 12 }}><span>⚠</span>{csErr}</div>}
              {csOrders.length === 0 && !csForm && (
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 10px' }}>No withholding orders. Add one to withhold child support from every paycheck automatically.</p>
              )}
              {csOrders.map(o => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', marginBottom: 6, background: o.active ? '#fff' : 'var(--bg-secondary)', opacity: o.active ? 1 : 0.65 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.vendor_name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{o.case_number ? `Case ${o.case_number} · ` : ''}{fmt(o.amount)} per paycheck{o.active ? '' : ' · paused'}</div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => handleCsToggle(o)}>{o.active ? 'Pause' : 'Resume'}</button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#dc2626' }} onClick={() => handleCsDelete(o)}>Remove</button>
                </div>
              ))}
              {csForm ? (
                <div style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-mid)', padding: '12px 12px 10px', marginBottom: 14 }}>
                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Vendor (check payable to)</label>
                    <input className="form-input" value={csForm.vendorName} onChange={e => { dirtyRef.current = true; setCsForm(f => ({ ...f, vendorName: e.target.value })); }} placeholder="e.g. TX Child Support SDU" />
                  </div>
                  <div className="form-grid" style={{ marginBottom: 8 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: 11 }}>Case / Cause #</label>
                      <input className="form-input mono" value={csForm.caseNumber} onChange={e => { dirtyRef.current = true; setCsForm(f => ({ ...f, caseNumber: e.target.value })); }} placeholder="optional" />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: 11 }}>Amount per paycheck ($)</label>
                      <input className="form-input mono" type="number" min="0.01" step="0.01" value={csForm.amount} onChange={e => { dirtyRef.current = true; setCsForm(f => ({ ...f, amount: e.target.value })); }} placeholder="150.00" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCsForm(null); setCsErr(''); dirtyRef.current = mainDirtyRef.current; }}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={csBusy} onClick={handleCsAdd}>{csBusy ? 'Adding…' : 'Add Order'}</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginBottom: 16 }} onClick={() => { setCsForm({ vendorName: '', caseNumber: '', amount: '' }); setCsErr(''); }}>
                  + Add Child Support Order
                </button>
              )}

              </>)}

              {/* ── Direct Deposit ── */}
              {tab === 'dd' && (<>
              {!dd && <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading…</p>}
              {dd && (
                <div style={{ marginBottom: 16 }}>
                  {/* Status badge + info */}
                  {dd.status === 'active' && !ddEdit && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#16a34a', marginBottom: 8 }}>✓ Direct Deposit Active</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {dd.routingNumber && (
                              <span className="ref-num">
                                <span className="ref-num-label">Routing</span>
                                {dd.routingNumber.replace(/(\d{4})(\d{4})(\d{1})/, '$1 $2 $3')}
                              </span>
                            )}
                            <span className="ref-num">
                              <span className="ref-num-label">{dd.bankAccountType === 'savings' ? 'Savings' : 'Checking'}</span>
                              ···· {dd.last4}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setDdEdit(true); setDdErr(''); }}>Change</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} onClick={handleRemoveDd} disabled={ddSaving}>Remove</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {dd.status === 'pending' && !ddEdit && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '14px 16px' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#d97706', marginBottom: 6 }}>⏳ Pending — Awaiting bank verification</div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        {dd.routingNumber && <span className="ref-num"><span className="ref-num-label">Routing</span>{dd.routingNumber.replace(/(\d{4})(\d{4})(\d{1})/, '$1 $2 $3')}</span>}
                        <span className="ref-num"><span className="ref-num-label">{dd.bankAccountType === 'savings' ? 'Savings' : 'Checking'}</span>···· {dd.last4}</span>
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={async () => { setDdSaving(true); setDdErr(''); try { const r = await api.activateDirectDeposit(empId); setDd(r); } catch(e) { setDdErr(e.message); } finally { setDdSaving(false); } }} disabled={ddSaving}>{ddSaving ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Retry Bank Verification'}</button>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => { setDdEdit(true); setDdErr(''); }}>Change Account</button>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#dc2626' }} onClick={handleRemoveDd} disabled={ddSaving}>Remove</button>
                      </div>
                      <p className="form-hint" style={{ marginTop: 8, marginBottom: 0 }}>Verification is handled by our payment partner (Moov).</p>
                    </div>
                  )}
                  {dd.status === 'failed' && !ddEdit && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '14px 16px' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#dc2626', marginBottom: 6 }}>✗ Failed — Bank account not accepted</div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        {dd.routingNumber && <span className="ref-num"><span className="ref-num-label">Routing</span>{dd.routingNumber.replace(/(\d{4})(\d{4})(\d{1})/, '$1 $2 $3')}</span>}
                        <span className="ref-num"><span className="ref-num-label">{dd.bankAccountType === 'savings' ? 'Savings' : 'Checking'}</span>···· {dd.last4}</span>
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={() => { setDdEdit(true); setDdErr(''); }}>Enter New Account</button>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#dc2626' }} onClick={handleRemoveDd} disabled={ddSaving}>Remove</button>
                      </div>
                    </div>
                  )}
                  {dd.status === 'none' && !ddEdit && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not set up</div>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => { setDdEdit(true); setDdErr(''); }}>+ Set Up Direct Deposit</button>
                    </div>
                  )}

                  {/* Bank account form */}
                  {ddEdit && (
                    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 16px 12px', marginTop: dd.status !== 'none' ? 12 : 0 }}>
                      {ddErr && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span>{ddErr}</div>}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Routing Number</label>
                          <input className="form-input mono" type="text" inputMode="numeric" maxLength={9} value={ddForm.routingNumber}
                            onChange={e => { dirtyRef.current = true; setDdForm(f => ({ ...f, routingNumber: e.target.value.replace(/\D/g, '') })); }}
                            placeholder="9 digits" />
                          <div className="form-hint" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{ddForm.routingNumber ? ddForm.routingNumber.replace(/(\d{4})(\d{4})(\d{1})/, '$1 $2 $3') : 'e.g. 0210 0002 8'}</span>
                            <span style={{ color: ddForm.routingNumber.length === 9 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>{ddForm.routingNumber.length}/9</span>
                          </div>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Account Type</label>
                          <select className="form-select" value={ddForm.bankAccountType} onChange={e => { dirtyRef.current = true; setDdForm(f => ({ ...f, bankAccountType: e.target.value })); }}>
                            <option value="checking">Checking</option>
                            <option value="savings">Savings</option>
                          </select>
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 12 }}>
                        <label className="form-label">Account Number</label>
                        <input className="form-input mono" type="password" value={ddForm.accountNumber}
                          onChange={e => { dirtyRef.current = true; setDdForm(f => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') })); }}
                          placeholder="Account number" />
                      </div>
                      <div className="form-group" style={{ marginBottom: 14 }}>
                        <label className="form-label">
                          Confirm Account Number
                          {ddForm.confirmAccount && ddForm.accountNumber && (
                            <span style={{ marginLeft: 8, fontWeight: 700, fontSize: 11, textTransform: 'none', color: ddForm.confirmAccount === ddForm.accountNumber ? 'var(--success)' : '#dc2626' }}>
                              {ddForm.confirmAccount === ddForm.accountNumber ? '✓ Match' : '✗ Mismatch'}
                            </span>
                          )}
                        </label>
                        <input className="form-input mono" type="text" value={ddForm.confirmAccount}
                          onChange={e => { dirtyRef.current = true; setDdForm(f => ({ ...f, confirmAccount: e.target.value.replace(/\D/g, '') })); }}
                          placeholder="Re-enter account number" />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={handleSaveDd} disabled={ddSaving}>
                          {ddSaving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save & Connect'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setDdEdit(false); setDdErr(''); setDdForm({ routingNumber: '', accountNumber: '', confirmAccount: '', bankAccountType: 'checking' }); dirtyRef.current = mainDirtyRef.current; }}>Cancel</button>
                      </div>
                      <p className="form-hint" style={{ marginTop: 10 }}>Account info is encrypted with AES-256.</p>
                    </div>
                  )}
                </div>
              )}
              </>)}
            </>
          )}
        </div>
        {form && (
          <div className="drawer-footer">
            <button className="btn btn-secondary" onClick={requestClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? <span className="spinner" /> : 'Save Changes'}</button>
          </div>
        )}
      </div>
      {confirmDelete && (
        <ModalOverlay onClose={() => setConfirmDelete(false)}>
          <div className="card" style={{ width: 440, maxWidth: '92vw', padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Delete {form?.firstName} {form?.lastName} permanently?</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 14 }}>
              All of their paychecks and wage history will be deleted from every report. If they simply stopped working here, mark them Inactive instead so their history is kept.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 16, fontSize: 12.5 }}>
              <input type="checkbox" checked={delAck} onChange={e => setDelAck(e.target.checked)} style={{ accentColor: '#dc2626', width: 14, height: 14 }} />
              I understand this cannot be undone
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-primary btn-sm" onClick={handleMarkInactive} disabled={saving || deleting}>{saving ? <span className="spinner" /> : 'Mark Inactive instead'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: '#dc2626', opacity: delAck ? 1 : 0.5 }} onClick={handleDeleteConfirmed} disabled={!delAck || deleting}>
                {deleting ? <span className="spinner" /> : 'Delete permanently'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

// ── Row background by check status ───────────────────────────────────────────
function checkRowBg(status, selected) {
  if (selected) return '#e8f5ee';
  if (status === 'voided')                 return '#fef2f2';
  if (status === 'draft')                  return '#fffbeb';
  if (status === 'printed')               return '#f0fdf4';
  if (status === 'direct_deposit_sent')    return '#f0f9ff';
  if (status === 'direct_deposit_cleared') return '#f0fdf4';
  if (status === 'late')                   return '#fff7ed';
  return '#fff';
}

// ── Check History (per employee in Pay Employees) ─────────────────────────────
function CheckHistory({ clientId, employeeId, employeeName, selectedChecks, onToggleCheck, onChecksLoaded, onVoidCheck, onDeleteCheck }) {
  const [checks, setChecks]     = useState(null);
  const [actioning, setActioning] = useState(null); // stub.id being actioned
  const [err, setErr]           = useState('');

  useEffect(() => {
    api.getPaystubsByEmployee(clientId, employeeId)
      .then(data => { setChecks(data); onChecksLoaded?.(employeeId, data); })
      .catch(e => setErr(e.message));
  }, [clientId, employeeId]);

  async function handleVoid(stub) {
    const reason = window.prompt(`Void check #${stub.check_number || stub.id} for ${employeeName}?\n\nReason (optional):`);
    if (reason === null) return;
    setActioning(stub.id);
    try {
      await api.voidPaystub(stub.id, reason);
      const updated = checks.map(c => c.id === stub.id ? { ...c, check_status: 'voided' } : c);
      setChecks(updated);
      onChecksLoaded?.(employeeId, updated);
      onVoidCheck?.(stub.id);
    } catch (e) { alert(e.message); }
    finally { setActioning(null); }
  }

  async function handleDelete(stub) {
    if (!window.confirm(`Are you sure you want to delete this check?\n\nThis will reverse all associated tax liabilities.\n\nCheck #${stub.check_number || stub.id} · ${employeeName} · ${fmt(stub.net_pay)}`)) return;
    setActioning(stub.id);
    try {
      await api.deletePaystub(stub.id);
      const updated = checks.filter(c => c.id !== stub.id);
      setChecks(updated);
      onChecksLoaded?.(employeeId, updated);
      onDeleteCheck?.(stub.id);
    } catch (e) { alert(e.message); }
    finally { setActioning(null); }
  }

  if (checks === null) return <div style={{ padding: '12px 0', textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 18, height: 18, display: 'inline-block' }} /></div>;
  if (err) return <div style={{ color: '#dc2626', fontSize: 12, padding: '8px 0' }}>{err}</div>;
  if (checks.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0', fontStyle: 'italic' }}>No checks issued yet.</div>;

  const allSelectableIds = checks.filter(c => c.check_status !== 'voided' && c.check_status !== 'direct_deposit_cleared').map(c => c.id);
  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every(id => selectedChecks?.has(id));

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Check History</div>
      <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)' }}>
              <th style={{ padding: '7px 10px', width: 34 }}>
                <input type="checkbox" checked={allSelected} onChange={e => allSelectableIds.forEach(id => { if (e.target.checked !== (selectedChecks?.has(id) ?? false)) onToggleCheck?.(id); })} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
              </th>
              <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.05em' }}>CHECK #</th>
              <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.05em' }}>PERIOD</th>
              <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.05em' }}>GROSS</th>
              <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.05em' }}>NET PAY</th>
              <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.05em' }}>STATUS</th>
              <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.05em' }}>EFTPS DUE</th>
              <th style={{ padding: '7px 10px', width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => {
              const voided   = c.check_status === 'voided';
              const isDraft  = !c.check_status || c.check_status === 'draft';
              const dueDays  = daysUntil(c.settlement_due_date);
              const isSel    = selectedChecks?.has(c.id) ?? false;
              const canSel   = !voided && c.check_status !== 'direct_deposit_cleared';
              const busy     = actioning === c.id;
              return (
                <tr key={c.id} style={{ background: checkRowBg(c.check_status, isSel), borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 10px' }}>
                    {canSel && <input type="checkbox" checked={isSel} onChange={() => onToggleCheck?.(c.id)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />}
                  </td>
                  <td style={{ padding: '10px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 800, color: voided ? '#dc2626' : 'var(--accent)', textDecoration: voided ? 'line-through' : 'none' }}>
                    {c.check_number ? `#${c.check_number}` : isDraft ? <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>Draft</span> : '—'}
                  </td>
                  <td style={{ padding: '10px 10px', color: 'var(--text-secondary)', textDecoration: voided ? 'line-through' : 'none', fontVariantNumeric: 'tabular-nums' }}>
                    {c.pay_period_start} – {c.pay_period_end}
                  </td>
                  <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', textDecoration: voided ? 'line-through' : 'none', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.gross_wages)}</td>
                  <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: voided ? '#dc2626' : 'var(--success)', fontWeight: 700, textDecoration: voided ? 'line-through' : 'none', fontVariantNumeric: 'tabular-nums' }}>
                    {(() => { const np = Math.round(((c.gross_wages||0)-(c.fit_withholding||0)-(c.employee_ss||0)-(c.employee_medicare||0)-(c.additional_medicare||0)-(c.state_income_tax||0)-(c.deduction||0)-(c.garnishment||0)+(c.reimbursement||0))*100)/100; return voided ? `(${fmt(np)})` : fmt(np); })()}
                  </td>
                  <td style={{ padding: '10px 10px' }}><StatusBadge status={c.check_status || 'draft'} /></td>
                  <td style={{ padding: '10px 10px', fontSize: 12, color: isOverdue(c.settlement_due_date) ? '#dc2626' : dueDays !== null && dueDays <= 5 ? '#d97706' : 'var(--text-muted)', fontWeight: isOverdue(c.settlement_due_date) ? 700 : 400 }}>
                    {c.settlement_due_date ? (
                      <>{fmtDate(c.settlement_due_date)}{isOverdue(c.settlement_due_date) && <span style={{ marginLeft: 4 }}>({Math.abs(dueDays)}d overdue)</span>}</>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '10px 10px' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {c.check_status === 'draft' && (
                        <Link to={`/clients/${clientId}/paystubs/${c.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
                      )}
                      {!voided && (
                        <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626', opacity: busy ? 0.5 : 1 }} onClick={() => handleVoid(c)} disabled={busy}>
                          {busy ? '…' : 'Void'}
                        </button>
                      )}
                      {!voided && (
                        <button className="btn btn-ghost btn-sm" style={{ color: '#6b7280', opacity: busy ? 0.5 : 1 }} onClick={() => handleDelete(c)} disabled={busy} title="Delete check and reverse tax liabilities">
                          {busy ? '…' : 'Del'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Pay Group Editor Modal ────────────────────────────────────────────────────
function PayGroupEditorModal({ group, clientId, allGroups, hasIssuedChecks, onSaved, onClose, onDeleted, onMoved }) {
  const [form, setForm] = useState({
    name: group.name,
    frequency: group.frequency,
    firstPayPeriodEnd: group.firstPayPeriodEnd || '',
    payDate: group.payDate || (group.firstPayPeriodEnd ? calcDefaultPayDate(group.firstPayPeriodEnd) : ''),
  });
  const [employees, setEmployees] = useState(null);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [err, setErr]             = useState('');
  const [showPeriods, setShowPeriods] = useState(false);

  const computedStart = calcStartFromEnd(form.firstPayPeriodEnd, form.frequency);
  const autoPayDate   = form.firstPayPeriodEnd ? calcDefaultPayDate(form.firstPayPeriodEnd) : '';
  const payDateInvalid = form.payDate && !isBizDay(new Date(form.payDate + 'T00:00:00'));
  const payDateSuggested = payDateInvalid ? nextBizDay(new Date(form.payDate + 'T00:00:00')).toISOString().slice(0, 10) : null;

  useEffect(() => {
    api.getPayGroupEmployees(group.id).then(setEmployees).catch(() => setEmployees([]));
  }, [group.id]);

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }
  function handleEndChange(val) { setForm(f => ({ ...f, firstPayPeriodEnd: val, payDate: val ? calcDefaultPayDate(val) : '' })); }

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      await api.updatePayGroup(group.id, {
        ...form,
        firstPayPeriodStart: computedStart || null,
        firstPayPeriodEnd: form.firstPayPeriodEnd || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function handleMoveEmployee(emp, newGroupId) {
    const targetGroup = newGroupId ? allGroups.find(g => String(g.id) === String(newGroupId)) : null;
    if (targetGroup && targetGroup.firstPayPeriodEnd && group.firstPayPeriodEnd &&
        targetGroup.firstPayPeriodEnd !== group.firstPayPeriodEnd) {
      alert(`Cannot move ${emp.firstName} ${emp.lastName} to "${targetGroup.name}". The group's first period end date (${fmtDate(targetGroup.firstPayPeriodEnd)}) does not match this group's (${fmtDate(group.firstPayPeriodEnd)}). All employees in a pay group must share the same pay period schedule.`);
      return;
    }
    try {
      await api.updateEmployee(emp.id, { clientId, payGroupId: newGroupId ? parseInt(newGroupId) : null });
      setEmployees(prev => prev.filter(e => e.id !== emp.id));
      onMoved?.();
    } catch (e) { alert(e.message); }
  }

  async function handleDeleteGroup() {
    const msg = hasIssuedChecks
      ? `"${group.name}" has printed/deposited checks, so it will be ARCHIVED: employees are unassigned and the group becomes non-functional, but its check history stays available in the Archived menu. Continue?`
      : `"${group.name}" has no printed or deposited checks, so it will be PERMANENTLY DELETED and cannot be recovered. Continue?`;
    if (!window.confirm(msg)) return;
    setDeleting(true); setErr('');
    try {
      await api.deletePayGroup(group.id);
      onDeleted?.();
    } catch (e) { setErr(e.message); setDeleting(false); }
  }

  const upcomingPeriods = computedStart && form.firstPayPeriodEnd
    ? calcUpcomingPeriods(computedStart, form.firstPayPeriodEnd, form.frequency, 6)
    : [];

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" style={{ width: 520 }}>
        <div className="drawer-header">
          <div className="drawer-title">Edit Pay Group</div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          {err && <div className="alert alert-error" style={{ marginBottom: 14 }}><span>⚠</span>{err}</div>}

          <p className="form-section-title" style={{ marginTop: 0 }}>Group Details</p>
          <div className="form-group"><label className="form-label">Group Name</label><input className="form-input" value={form.name} onChange={set('name')} /></div>
          <div className="form-group">
            <label className="form-label">Pay Frequency</label>
            <select className="form-select" value={form.frequency} onChange={set('frequency')}>
              <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
              <option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 4 }}>
            <label className="form-label">First Period End Date</label>
            <input className="form-input" type="date" value={form.firstPayPeriodEnd} onChange={e => handleEndChange(e.target.value)} />
          </div>
          {computedStart && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Period will start: <strong>{fmtDate(computedStart)}</strong>
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 4 }}>
            <label className="form-label">Pay Date</label>
            <input className="form-input" type="date" value={form.payDate} onChange={set('payDate')} />
          </div>
          {autoPayDate && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              Default (2 business days after period end): <strong>{fmtDate(autoPayDate)}</strong>
            </div>
          )}
          {payDateInvalid && (
            <div style={{ fontSize: 12, color: '#d97706', marginBottom: 14 }}>
              ⚠ Falls on a weekend or holiday — suggest:{' '}
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 12, padding: 0 }} onClick={() => setForm(f => ({ ...f, payDate: payDateSuggested }))}>
                {fmtDate(payDateSuggested)}
              </button>
            </div>
          )}

          {upcomingPeriods.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, color: 'var(--accent)', padding: '4px 0' }} onClick={() => setShowPeriods(p => !p)}>
                {showPeriods ? '▲ Hide' : '▼ Show'} upcoming periods
              </button>
              {showPeriods && (
                <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)', marginTop: 6 }}>
                  {upcomingPeriods.map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid var(--border)', background: p.overdue ? '#fef2f2' : i % 2 === 0 ? '#fff' : 'var(--bg-secondary)' }}>
                      <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: p.overdue ? '#dc2626' : 'var(--text-primary)' }}>{fmtDate(p.start)} – {fmtDate(p.end)}</span>
                      {p.overdue && <span className="badge badge-error" style={{ fontSize: 10 }}>Overdue</span>}
                      {!p.overdue && i === 0 && <span className="badge badge-warning" style={{ fontSize: 10 }}>Current</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="form-section-title">Employees in This Group ({employees ? employees.length : '…'})</p>
          {employees === null ? (
            <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner spinner-dark" style={{ width: 20, height: 20, display: 'inline-block' }} /></div>
          ) : employees.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>No employees assigned to this group.</div>
          ) : (
            <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {employees.map((emp, i) => (
                <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', background: i % 2 === 0 ? '#fff' : 'var(--bg-secondary)' }}>
                  <div className="emp-avatar" style={{ width: 28, height: 28, fontSize: 10, flexShrink: 0 }}>{initials(`${emp.firstName} ${emp.lastName}`)}</div>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{emp.firstName} {emp.lastName}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Move to:</span>
                    <select style={{ fontSize: 12, padding: '3px 6px', borderRadius: 0, border: '1px solid var(--border)', background: '#fff' }}
                      defaultValue=""
                      onChange={e => { if (e.target.value) handleMoveEmployee(emp, e.target.value === '__none__' ? null : e.target.value); }}>
                      <option value="">— select —</option>
                      <option value="__none__">Remove from group</option>
                      {allGroups.filter(g => g.id !== group.id && !g.deletedAt).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="drawer-footer">
          <button className="btn btn-ghost" style={{ color: '#dc2626', marginRight: 'auto' }} onClick={handleDeleteGroup} disabled={deleting || saving}>
            {deleting ? <span className="spinner" /> : '🗑 Delete Group'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || deleting}>{saving ? <span className="spinner" /> : 'Save Changes'}</button>
        </div>
      </div>
    </>
  );
}

// ── Employees Tab ─────────────────────────────────────────────────────────────
function EmployeesTab({ clientId, employees, onRefresh, clientMode = false }) {
  const [drawerEmpId, setDrawerEmpId]     = useState(null);
  const [editGroup, setEditGroup]         = useState(null);
  const [payGroups, setPayGroups]         = useState([]);
  const [showImport, setShowImport]       = useState(false);
  const [empSearch, setEmpSearch]         = useState('');
  const [empFilter, setEmpFilter]         = useState('all'); // 'all' | 'active' | 'inactive'

  useEffect(() => {
    api.getPayGroups(clientId).then(setPayGroups).catch(() => {});
  }, [clientId]);

  function handleGroupSaved() { setEditGroup(null); onRefresh(); api.getPayGroups(clientId).then(setPayGroups); }

  const visibleEmployees = [...employees]
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
    .filter(e => empFilter === 'all' ? true : empFilter === 'active' ? e.isActive !== false : e.isActive === false)
    .filter(e => {
      const q = empSearch.trim().toLowerCase();
      if (!q) return true;
      return `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || (e.payGroupName || '').toLowerCase().includes(q);
    });


  return (
    <div>
      {showImport && (
        <ImportEmployeesModal
          clientId={clientId}
          onClose={() => setShowImport(false)}
          onImported={() => { onRefresh(); }}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-secondary" onClick={() => setShowImport(true)}>Import from Excel</button>
        <Link to={clientMode ? `/company/${clientId}/employees/new` : `/clients/${clientId}/employees/new`} className="btn btn-primary">+ Add Employee</Link>
      </div>
      {(employees.length > 10 || empSearch || empFilter !== 'all') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', maxWidth: '100%' }}>
            <span style={{ position: 'absolute', left: 10, fontSize: 13, color: 'var(--text-muted)', pointerEvents: 'none' }}>🔍</span>
            <input
              type="text"
              value={empSearch}
              onChange={e => setEmpSearch(e.target.value)}
              placeholder="Search employees…"
              aria-label="Search employees by name or pay group"
              style={{ fontSize: 13, padding: '6px 28px 6px 30px', borderRadius: 0, border: '1px solid var(--border)', background: '#fff', width: 220, maxWidth: '100%', outline: 'none' }} />
            {empSearch && (
              <button onClick={() => setEmpSearch('')} aria-label="Clear search"
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: 4 }}>×</button>
            )}
          </div>
          <div style={{ display: 'flex', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
            {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([k, label]) => (
              <button key={k} onClick={() => setEmpFilter(k)}
                style={{ padding: '5px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1, fontWeight: 600,
                  background: empFilter === k ? '#fff' : 'transparent',
                  color: empFilter === k ? 'var(--accent)' : 'var(--text-muted)',
                  boxShadow: empFilter === k ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {employees.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <div className="empty-state-icon">👤</div>
            <h3>No employees yet</h3>
            <p>Add your first employee to get started.</p>
            <Link to={clientMode ? `/company/${clientId}/employees/new` : `/clients/${clientId}/employees/new`} className="btn btn-primary">Add Employee</Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {visibleEmployees.length === 0 && (
            <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No employees match.</div>
          )}
          {visibleEmployees.map(emp => {
            const isSalary = emp.payType === 'salary';
            const rateUnset = !(isSalary ? emp.annualSalary : emp.hourlyRate);
            const rate = isSalary ? `${fmt(emp.annualSalary)}/yr` : `${fmt(emp.hourlyRate)}/hr`;
            const groupObj = payGroups.find(g => g.id === emp.payGroupId);
            return (
              <div key={emp.id} className="emp-row" onClick={() => setDrawerEmpId(emp.id)}>
                <div className="emp-avatar">{initials(`${emp.firstName} ${emp.lastName}`)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="emp-name">{emp.firstName} {emp.lastName}</div>
                  <div className="emp-meta" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{emp.workState || 'TX'} · {isSalary ? 'Salary' : 'Hourly'}</span>
                    {emp.payGroupName ? (
                      <button
                        onClick={e => { e.stopPropagation(); const g = groupObj || { id: emp.payGroupId, name: emp.payGroupName, frequency: emp.payGroupFrequency || emp.payFrequency, firstPayPeriodStart: emp.payGroupFirstStart, firstPayPeriodEnd: emp.payGroupFirstEnd }; setEditGroup(g); }}
                        style={{ background: 'var(--accent-light)', border: 'none', borderRadius: 4, padding: '1px 7px', fontSize: 11, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
                      >
                        {emp.payGroupName}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>No pay group</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: rateUnset ? 'var(--warning)' : 'var(--accent)' }}>{rateUnset ? 'Rate not set' : rate}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{emp.filingStatus === 'married' ? 'Married' : emp.filingStatus === 'hoh' ? 'HoH' : 'Single'}</div>
                </div>
                <span className={`badge ${emp.isActive !== false ? 'badge-success' : 'badge-neutral'}`}>{emp.isActive !== false ? 'Active' : 'Inactive'}</span>
                {emp.directDeposit?.status === 'active' && <span className="badge" style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: 10, fontWeight: 700 }}>DD</span>}
                <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
              </div>
            );
          })}
        </div>
      )}
      {drawerEmpId && (
        <EmployeeDrawer clientId={clientId} empId={drawerEmpId} onClose={() => setDrawerEmpId(null)} onSaved={() => { setDrawerEmpId(null); onRefresh(); }} onDeleted={() => { setDrawerEmpId(null); onRefresh(); }} />
      )}
      {editGroup && (
        <PayGroupEditorModal group={editGroup} clientId={clientId} allGroups={payGroups} onSaved={handleGroupSaved} onClose={() => setEditGroup(null)} onDeleted={handleGroupSaved} onMoved={onRefresh} />
      )}
    </div>
  );
}

// Defined outside CompanyTab so it's a stable reference and never causes remounts
function FormField({ label, hint, children }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

// ── Company Tab ───────────────────────────────────────────────────────────────
function CompanyTab({ client, onSaved }) {
  const [form, setForm]           = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [err, setErr]             = useState('');
  const [changingAccount, setChangingAccount] = useState(false);
  const [accountDraft, setAccountDraft]       = useState('');
  const [showAccountNum, setShowAccountNum]   = useState(true);
  const [accountSaving, setAccountSaving]     = useState(false);
  const [accountErr, setAccountErr]           = useState('');
  const [pinDraft, setPinDraft]   = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinMsg, setPinMsg]       = useState('');
  const [invalidField, setInvalidField] = useState(null);
  const [notifConfig, setNotifConfig]   = useState(null);
  const saveTimerRef = useRef(null);
  const flushDraftsRef = useRef(null);
  const loadedClientIdRef = useRef(null); // re-init the form only when SWITCHING companies
  const saveChainRef = useRef(Promise.resolve()); // serializes autosaves so a slow old save can't overwrite a newer one

  useEffect(() => {
    if (!client) return;
    // Re-initializing on every `client` object (each autosave round-trip creates a
    // fresh object via onSaved→reload) was resetting the form mid-typing and wiping
    // in-flight edits, PIN drafts, and the bank-account draft. Only rebuild when the
    // user actually opens a different company.
    if (loadedClientIdRef.current === client.id) return;
    if (loadedClientIdRef.current != null && flushDraftsRef.current) flushDraftsRef.current(loadedClientIdRef.current);
    loadedClientIdRef.current = client.id;
    touchedRef.current = new Set();
    setChangingAccount(false);
    setAccountDraft('');
    setAccountErr('');
    setShowAccountNum(true);
    setPinDraft(''); setPinMsg(''); setPinSaving(false);
    setForm({
      businessName:     client.businessName    || '',
      ein:              client.ein             || '',
      state:            client.state           || 'TX',
      depositSchedule:  client.depositSchedule || 'monthly',
      suiRateQ1: client.suiRateQ1 != null ? String(parseFloat(client.suiRateQ1) * 100) : '',
      suiRateQ2: client.suiRateQ2 != null ? String(parseFloat(client.suiRateQ2) * 100) : '',
      suiRateQ3: client.suiRateQ3 != null ? String(parseFloat(client.suiRateQ3) * 100) : '',
      suiRateQ4: client.suiRateQ4 != null ? String(parseFloat(client.suiRateQ4) * 100) : '',
      suiAccountNumber: client.suiAccountNumber || '',
      countyCode:       client.countyCode      || '',
      bankRoutingNumber: client.bankRoutingNumber || '',
      bankAccountType:  client.bankAccountType || 'checking',
      bankAccountLast4: client.bankAccountLast4 || '',
      bankName:         client.bankName        || '',
      nextCheckNumber:  String(client.nextCheckNumber || 1001),
      contactName:      client.contactName     || '',
      contactEmail:     client.contactEmail    || '',
      contactPhone:     client.contactPhone    || '',
      businessAddress:  client.businessAddress || '',
      businessCity:     client.businessCity    || '',
      businessZip:      client.businessZip     || '',
      notificationEmail: client.notificationEmail || '',
      notificationPhone: client.notificationPhone || '',
    });
  }, [client]);

  useEffect(() => {
    api.getNotificationConfig().then(setNotifConfig).catch(() => {});
  }, []);

  // Don't autosave invalid compliance data — a half-typed EIN or 5-digit routing
  // number silently persisting would poison EFTPS files and tax forms downstream.
  function validateForSave(f) {
    if (!f.businessName.trim()) return { field: 'businessName', msg: 'Business name can’t be empty — not saved yet' };
    if (f.ein && !/^\d{2}-?\d{7}$/.test(f.ein.trim())) return { field: 'ein', msg: 'EIN must be 9 digits (XX-XXXXXXX) — not saved yet' };
    if (f.bankRoutingNumber && !/^\d{9}$/.test(f.bankRoutingNumber.trim())) return { field: 'bankRoutingNumber', msg: 'Routing number must be exactly 9 digits — not saved yet' };
    if (f.bankRoutingNumber && !validRoutingNumber(f.bankRoutingNumber.trim())) return { field: 'bankRoutingNumber', msg: 'That routing number doesn’t look right — check it against a voided check.' };
    if (f.businessZip && !/^\d{5}(-\d{4})?$/.test(f.businessZip.trim())) return { field: 'businessZip', msg: 'ZIP must be 5 digits — not saved yet' };
    return null;
  }

  function doSave(currentForm) {
    const invalid = validateForSave(currentForm);
    if (invalid) { setErr(invalid.msg); setInvalidField(invalid.field); setSaveStatus('error'); return; }
    setSaveStatus('saving'); setErr(''); setInvalidField(null);
    // Chain saves: overlapping requests could land out of order server-side and
    // let a stale payload overwrite a newer one.
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        const payload = {
          ...currentForm,
          suiRateQ1: currentForm.suiRateQ1 ? parseFloat(currentForm.suiRateQ1) / 100 : null,
          suiRateQ2: currentForm.suiRateQ2 ? parseFloat(currentForm.suiRateQ2) / 100 : null,
          suiRateQ3: currentForm.suiRateQ3 ? parseFloat(currentForm.suiRateQ3) / 100 : null,
          suiRateQ4: currentForm.suiRateQ4 ? parseFloat(currentForm.suiRateQ4) / 100 : null,
          suiAccountNumber: currentForm.suiAccountNumber || null,
          countyCode: currentForm.countyCode || null,
        };
        delete payload.bankAccountLast4;
        delete payload.bankAccountNumber; // account number saved separately via saveAccountNumber()
        // depositSchedule is also editable from the Pay Liabilities tab; since this
        // form's snapshot only refreshes on company switch, sending it untouched
        // would silently revert a schedule changed over there. Send only if the
        // user edited it HERE (the backend PUT keeps absent fields unchanged).
        if (!touchedRef.current.has('depositSchedule')) delete payload.depositSchedule;
        await api.updateClient(client.id, payload);
        setSaveStatus('saved'); onSaved();
      } catch (e) { setErr(e.message); setSaveStatus('error'); }
    });
    return saveChainRef.current;
  }

  async function savePin() {
    const clean = String(pinDraft).replace(/\D/g, '');
    if (!/^\d{4}$/.test(clean)) { setPinMsg('PIN must be exactly 4 digits'); return; }
    setPinSaving(true); setPinMsg('');
    try {
      await api.updateClientPin(client.id, clean);
      setPinDraft('');
      setPinMsg('saved');
      onSaved();
    } catch (e) { setPinMsg(e.message || 'Failed to save PIN'); }
    finally { setPinSaving(false); }
  }

  async function saveAccountNumber() {
    const clean = accountDraft.replace(/[\s-]/g, '');
    if (!clean) return;
    if (!/^\d{4,17}$/.test(clean)) { setAccountErr('Account numbers are 4–17 digits'); return; }
    setAccountSaving(true); setErr(''); setAccountErr('');
    try {
      await api.updateClient(client.id, { bankAccountNumber: clean });
      const last4 = clean.slice(-4);
      setForm(f => ({ ...f, bankAccountLast4: last4 }));
      setChangingAccount(false);
      setAccountDraft('');
      setSaveStatus('saved');
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setAccountSaving(false); }
  }

  const pendingFormRef = useRef(null); // last form still inside the debounce window
  const touchedRef = useRef(new Set()); // fields the user actually edited in THIS tab

  flushDraftsRef.current = (forClientId) => {
    if (!accountDraft.trim() && !pinDraft) return;
    const cleanAcct = accountDraft.replace(/[\s-]/g, '');
    const cleanPin  = String(pinDraft).replace(/\D/g, '');
    const acctOk = accountDraft.trim() !== '' && /^\d{4,17}$/.test(cleanAcct);
    const pinOk  = pinDraft !== '' && /^\d{4}$/.test(cleanPin);
    if ((accountDraft.trim() && !acctOk) || (pinDraft && !pinOk)) {
      window.alert('The bank account number / EFTPS PIN you typed isn’t valid, so it wasn’t saved. Re-enter it on the Company tab when you’re ready.');
    }
    if (!acctOk && !pinOk) return;
    if (!window.confirm('You typed a bank account number / EFTPS PIN but didn’t save it. Save it now? (Cancel discards it.)')) return;
    const jobs = [];
    if (acctOk) jobs.push(api.updateClient(forClientId, { bankAccountNumber: cleanAcct }));
    if (pinOk)  jobs.push(api.updateClientPin(forClientId, cleanPin));
    Promise.all(jobs).then(() => onSaved?.()).catch(e => window.alert(`Couldn’t save: ${e.message || 'try again on the Company tab.'}`));
  };

  function set(field) {
    return e => {
      const val = e.target.value;
      touchedRef.current.add(field);
      setForm(f => {
        const newForm = { ...f, [field]: val };
        pendingFormRef.current = newForm;
        setSaveStatus('idle'); setErr(''); setInvalidField(null);
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => { pendingFormRef.current = null; doSave(newForm); }, 1400);
        return newForm;
      });
    };
  }

  // Flush a pending debounce on unmount (switching tabs/companies inside the 1.4s
  // window was silently dropping the last edit).
  useEffect(() => () => {
    clearTimeout(saveTimerRef.current);
    if (pendingFormRef.current) doSave(pendingFormRef.current);
    if (loadedClientIdRef.current != null && flushDraftsRef.current) flushDraftsRef.current(loadedClientIdRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!form) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 28, height: 28 }} /></div>;

  const F = FormField;
  const saveIndicator = saveStatus === 'saving' ? (
    <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
      <span className="spinner spinner-dark" style={{ width: 12, height: 12 }} /> Saving…
    </span>
  ) : saveStatus === 'saved' ? (
    <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✓ Saved</span>
  ) : saveStatus === 'error' ? (
    <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>⚠ {err || 'Save failed'}</span>
  ) : null;

  return (
    <div style={{ maxWidth: 760 }}>
      {/* Auto-save indicator — floats top right */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', minHeight: 22, marginBottom: 8 }}>
        {saveIndicator}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>Business Information</p>
        <div className="form-grid">
          <F label="Business Name"><input className="form-input" style={invalidField === 'businessName' ? { borderColor: '#dc2626' } : undefined} value={form.businessName} onChange={set('businessName')} />{invalidField === 'businessName' && <p className="form-hint" style={{ color: '#dc2626' }}>{err}</p>}</F>
          <F label="EIN"><input className="form-input mono" style={invalidField === 'ein' ? { borderColor: '#dc2626' } : undefined} value={form.ein} onChange={set('ein')} placeholder="12-3456789" />{invalidField === 'ein' && <p className="form-hint" style={{ color: '#dc2626' }}>{err}</p>}</F>
        </div>
        <F label="Street Address"><input className="form-input" value={form.businessAddress} onChange={set('businessAddress')} /></F>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">City</label><input className="form-input" value={form.businessCity} onChange={set('businessCity')} /></div>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">State</label><select className="form-select" value={form.state} onChange={set('state')}>{US_STATES.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}</select></div>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">ZIP</label><input className="form-input mono" style={invalidField === 'businessZip' ? { borderColor: '#dc2626' } : undefined} value={form.businessZip} onChange={set('businessZip')} maxLength={10} />{invalidField === 'businessZip' && <p className="form-hint" style={{ color: '#dc2626' }}>{err}</p>}</div>
        </div>
        <div style={{ marginTop: 14 }}>
          <F label="IRS 941 Deposit Schedule" hint="Monthly: taxes due by the 15th of the following month. Semi-weekly: taxes due Wed or Fri after each payroll.">
            <select className="form-select" style={{ maxWidth: 280 }} value={form.depositSchedule} onChange={set('depositSchedule')}>
              <option value="monthly">Monthly Depositor</option>
              <option value="semiweekly">Semi-weekly Depositor</option>
            </select>
          </F>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>EFTPS — Federal Tax Deposits</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Enrollment status:</span>
          {client.eftpsEnrolled ? (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              ✓ Enrolled{client.hasBatchProviderPin ? ' · PIN on file' : ''}
            </span>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)' }}>Not enrolled</span>
          )}
        </div>
        <F
          label={client.hasBatchProviderPin ? 'Update Batch Provider PIN' : 'Batch Provider PIN'}
          hint="Already enrolled this company in EFTPS Batch Provider yourself? Enter its 4-digit PIN here. This marks the company enrolled so tax deposits use this PIN — the bridge won't try to auto-enroll it."
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="form-input mono"
              value={pinDraft}
              onChange={e => { setPinDraft(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinMsg(''); }}
              onKeyDown={e => { if (e.key === 'Enter') savePin(); }}
              placeholder="••••"
              maxLength={4}
              inputMode="numeric"
              style={{ maxWidth: 96, letterSpacing: 6, textAlign: 'center' }}
            />
            <button type="button" className="btn btn-primary" disabled={pinSaving || pinDraft.length !== 4} onClick={savePin}>
              {pinSaving ? 'Saving…' : (client.eftpsEnrolled ? 'Update PIN' : 'Save PIN & mark enrolled')}
            </button>
            {pinMsg === 'saved'
              ? <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✓ Saved</span>
              : pinMsg
                ? <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>⚠ {pinMsg}</span>
                : null}
          </div>
        </F>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        {(() => {
          const st = form.state || 'TX';
          const agencyName = SUI_AGENCIES[st] || `${st} Dept. of Labor`;
          return (
            <>
              <p className="form-section-title" style={{ marginTop: 0 }}>{agencyName} — State Unemployment</p>
              <F label="SUI Account Number" hint="Your state UI employer account number. Printed on quarterly SUI report.">
                <input className="form-input mono" value={form.suiAccountNumber} onChange={set('suiAccountNumber')} placeholder="e.g. 10-818766-2" style={{ maxWidth: 280 }} />
              </F>
              {form.state === 'TX' && (
                <F label="County" hint="Required for TWC QuickFile ICESA submission.">
                  <select className="form-select" value={form.countyCode} onChange={set('countyCode')} style={{ maxWidth: 320 }}>
                    <option value="">— Select county —</option>
                    {TX_COUNTIES.map(([name, code]) => (
                      <option key={code} value={code}>{name} ({code})</option>
                    ))}
                  </select>
                </F>
              )}
              <div className="form-grid" style={{ marginTop: 4 }}>
                {[['Q1','suiRateQ1'],['Q2','suiRateQ2'],['Q3','suiRateQ3'],['Q4','suiRateQ4']].map(([q, key]) => (
                  <F key={q} label={`SUI Rate ${q} (%)`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input className="form-input mono" type="number" min="0" max="20" step="0.001" value={form[key]} onChange={set(key)} style={{ maxWidth: 110 }} placeholder="e.g. 0.32" />
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>%</span>
                    </div>
                  </F>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>Bank Account</p>
        <F label="Bank Name" hint="Printed on checks (e.g. BANK OF AMERICA)">
          <input className="form-input" value={form.bankName || ''} onChange={set('bankName')} placeholder="e.g. BANK OF AMERICA" />
        </F>
        <div className="form-grid">
          <div>
            <label className="form-label">Account Number</label>
            {changingAccount ? (
              <>
                <div style={{ position: 'relative' }}>
                  <input
                    className="form-input mono"
                    type={showAccountNum ? 'text' : 'password'}
                    value={accountDraft}
                    onChange={e => { setAccountDraft(e.target.value); setAccountErr(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') saveAccountNumber(); if (e.key === 'Escape') { setChangingAccount(false); setAccountDraft(''); setAccountErr(''); } }}
                    placeholder="Enter account number"
                    autoFocus
                    style={{ paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccountNum(v => !v)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15, padding: 0, lineHeight: 1 }}
                    title={showAccountNum ? 'Hide' : 'Show'}
                  >{showAccountNum ? '🙈' : '👁'}</button>
                </div>
                {accountErr && <p className="form-hint" style={{ color: '#dc2626' }}>{accountErr}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={saveAccountNumber}
                    disabled={!accountDraft.trim() || accountSaving}
                  >{accountSaving ? 'Saving…' : 'Save Account Number'}</button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setChangingAccount(false); setAccountDraft(''); setAccountErr(''); }}
                  >Cancel</button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', background: form.bankAccountLast4 ? 'var(--bg-secondary)' : '#fef2f2', border: `1px solid ${form.bankAccountLast4 ? 'var(--border)' : '#fca5a5'}`, borderRadius: 'var(--radius)', minHeight: 46 }}>
                <span className="mono" style={{ color: form.bankAccountLast4 ? 'var(--text-primary)' : '#dc2626', fontWeight: form.bankAccountLast4 ? 400 : 700, letterSpacing: '0.05em' }}>
                  {form.bankAccountLast4 ? `···· ${form.bankAccountLast4}` : 'Required — no account on file'}
                </span>
                <button type="button" onClick={() => { setChangingAccount(true); setAccountDraft(''); setAccountErr(''); setShowAccountNum(true); }}
                  className={form.bankAccountLast4 ? undefined : 'btn btn-primary btn-sm'}
                  style={form.bankAccountLast4
                    ? { marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--accent)', fontWeight: 600, padding: 0 }
                    : { marginLeft: 'auto', fontSize: 12 }}>
                  {form.bankAccountLast4 ? 'Change' : 'Add Account Number'}
                </button>
              </div>
            )}
            {!form.bankAccountLast4 && !changingAccount && (
              <p className="form-hint" style={{ color: '#dc2626' }}>Paychecks and EFTPS tax payments are drawn from this account — payments can&rsquo;t be submitted without it.</p>
            )}
          </div>
          <div>
            <label className="form-label">Routing Number</label>
            <input className="form-input mono" style={invalidField === 'bankRoutingNumber' ? { borderColor: '#dc2626' } : undefined} value={form.bankRoutingNumber} onChange={set('bankRoutingNumber')} maxLength={9} />
            {invalidField === 'bankRoutingNumber' && <p className="form-hint" style={{ color: '#dc2626' }}>{err}</p>}
            {form.bankRoutingNumber && (
              <div className="form-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>
                  {form.bankRoutingNumber.replace(/(\d{4})(\d{4})(\d{1})/, '$1 $2 $3')}
                </span>
                <span style={{ color: form.bankRoutingNumber.length === 9 ? 'var(--success)' : 'var(--warning)', fontWeight: 700 }}>
                  {form.bankRoutingNumber.length}/9 digits
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="form-grid" style={{ marginTop: 4 }}>
          <F label="Account Type">
            <select className="form-select" value={form.bankAccountType} onChange={set('bankAccountType')}>
              <option value="checking">Checking</option><option value="savings">Savings</option>
            </select>
          </F>
          <F label="Next Check Number" hint="Number assigned to the next paycheck. Update if your physical check stock starts at a different number.">
            <input className="form-input mono" type="number" min="1" step="1" value={form.nextCheckNumber} onChange={set('nextCheckNumber')} />
          </F>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>Contact Information</p>
        <div className="form-grid">
          <F label="Contact Name"><input className="form-input" value={form.contactName} onChange={set('contactName')} /></F>
          <F label="Phone"><input className="form-input" value={form.contactPhone} onChange={set('contactPhone')} /></F>
        </div>
        <F label="Email"><input className="form-input" type="email" value={form.contactEmail} onChange={set('contactEmail')} /></F>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <p className="form-section-title" style={{ marginTop: 0 }}>Tax Deposit Notifications</p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
          Email and SMS reminders 5 days and 2 days before each 941 deposit due date, and immediately when overdue.
        </p>
        <div className="form-grid">
          <F label="Notification Email" hint={notifConfig && !notifConfig.emailConfigured ? 'Email reminders aren’t set up on this server yet — ask your administrator to enable them.' : undefined}>
            <input className="form-input" type="email" value={form.notificationEmail} onChange={set('notificationEmail')} placeholder="accountant@firm.com" />
          </F>
          <F label="Notification Phone (SMS)" hint={notifConfig && !notifConfig.smsConfigured ? 'Text reminders aren’t set up on this server yet — ask your administrator to enable them.' : undefined}>
            <input className="form-input" type="tel" value={form.notificationPhone} onChange={set('notificationPhone')} placeholder="+15550000000" />
          </F>
        </div>
      </div>
    </div>
  );
}

// ── Pay Employees Tab — shared stable sub-components ─────────────────────────
// Defined at module scope so React never unmounts/remounts them on re-renders,
// which would destroy input focus mid-typing.

const PRINTED_STATUSES = new Set(['printed','deposited','direct_deposit_sent','direct_deposit_cleared','voided']);
const MODAL_MONO = { fontFamily: 'JetBrains Mono, monospace' };

function ModalTR({ label, amount, ytdAmount, color, bold, borderTop, negative, editValue, onEditChange, editSuffix, noDollarSign }) {
  const display = negative ? (amount > 0 ? -amount : amount) : amount;
  return (
    <tr style={{ borderTop: borderTop ? '2px solid var(--border)' : undefined }}>
      <td style={{ padding: '5px 0', fontSize: 13, color: bold ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: bold ? 700 : 400, whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ padding: '3px 0 3px 12px', textAlign: 'right', ...MODAL_MONO, fontSize: 13, fontWeight: bold ? 700 : 500, color: color || (negative && amount > 0 ? '#dc2626' : 'inherit') }}>
        {onEditChange
          ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              {!noDollarSign && <span style={{ ...MODAL_MONO, fontSize: 13, color: 'var(--text-muted)', marginRight: 1 }}>$</span>}
              <input type="text" inputMode="decimal"
                value={editValue}
                onChange={e => onEditChange(e.target.value)}
                placeholder="0.00"
                style={{ ...MODAL_MONO, background: '#fff', border: '1px solid var(--border)', borderRadius: 0, outline: 'none', width: 80, textAlign: 'right', fontSize: 13, fontWeight: bold ? 700 : 500, color: 'var(--text-primary)', padding: '1px 5px', cursor: 'text', boxSizing: 'border-box' }} />
              {editSuffix && <span style={{ ...MODAL_MONO, fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{editSuffix}</span>}
            </span>
          : typeof display === 'number' ? fmt(display) : display
        }
      </td>
      {ytdAmount !== undefined && (
        <td style={{ padding: '5px 0 5px 12px', textAlign: 'right', ...MODAL_MONO, fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>{ytdAmount != null ? fmt(ytdAmount) : '—'}</td>
      )}
    </tr>
  );
}

function ModalColHeader({ hasYTD }) {
  return (
    <thead>
      <tr>
        <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>Item Name</th>
        <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Amount</th>
        {hasYTD && <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>YTD</th>}
      </tr>
    </thead>
  );
}

function ModalOverlay({ children, onClose }) {
  const ref = useRef(null);
  // Escape must call the CURRENT onClose — capturing the mount-time closure made
  // Escape see stale isDirty=false in CheckDetailModal and silently discard edits.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Escape closes; focus moves into the dialog on open so keyboard/screen-reader
  // users aren't left interacting with the page behind the overlay.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" style={{ outline: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: '100%' }}>
        {children}
      </div>
    </div>
  );
}

// ── Pay Employees Tab ─────────────────────────────────────────────────────────

function CheckDetailModal({ rowData, onClose, reloadStubs, clientId, client, employees, calcEmpYTD, ppy, pendingRows, setPendingRows, getRow, skipPending, periodOverrides, setPeriodOverrides, csDefaults }) {
    if (!rowData) return null;

    // Use module-scope stable components (ModalTR, ModalColHeader, ModalOverlay)
    // so React never remounts inputs on re-renders (which would kill focus).
    const TR = ModalTR;
    const ColHeader = ModalColHeader;

    // ── Pending row ──────────────────────────────────────────────────────────────
    if (rowData.type === 'pending') {
      const { period, emp } = rowData;
      // Buffer edits in LOCAL state and flush to the shared pendingRows on
      // save/close. Writing to pendingRows on every keystroke re-renders the
      // parent table, which remounts this modal and steals input focus — and it
      // also made the Save button unable to track tax edits. `row` now points at
      // the local buffer so all existing reads work unchanged.
      const savedRow = getRow(period.end, emp.id);
      const [localRow, setLocalRow] = useState(() => ({ ...savedRow }));
      const initialRowRef = useRef(savedRow);
      const row = localRow;
      // Clearing an override field reverts to the automatic estimate. Storing the
      // empty string used to pin the value at $0 forever — the classic symptom was
      // "no matter what salary I enter, federal/state tax stays 0".
      const setField = (field, v) => setLocalRow(r => ({
        ...r,
        [field]: (v === '' && /Override$/.test(field)) ? undefined : v,
      }));
      const flushLocal = () => setPendingRows(prev => ({
        ...prev,
        [period.end]: { ...(prev[period.end] || {}), [emp.id]: { ...((prev[period.end] || {})[emp.id] || {}), ...localRow } },
      }));
      const closeWithFlush = () => { flushLocal(); onClose(); };
      const isSalary = emp.payType === 'salary';
      // Salary / period is editable (row.salaryOverride); falls back to annual/ppy.
      const salAmt   = effPeriodSalary(row, emp, ppy);
      const rate     = parseFloat(row.rate) || emp.hourlyRate || 0;
      const regH     = parseFloat(row.regHours || 0);
      const otH      = parseFloat(row.otHours  || 0);
      const regPay   = isSalary ? salAmt : r2(regH * rate);
      const otPay    = isSalary ? 0 : r2(otH * rate * 1.5);
      const gross    = r2(regPay + otPay);
      const ytd      = calcEmpYTD(emp.id, null);

      // Editable dates for pending rows (stored as overrides, used when payroll is run)
      const ov = periodOverrides[period.end] || {};
      const [dateForm, setDateForm] = useState({ start: ov.start || period.start || '', end: ov.end || period.end || '', payDate: ov.payDate || period.payDate || '' });
      const committedDateRef = useRef({ start: ov.start || period.start || '', end: ov.end || period.end || '', payDate: ov.payDate || period.payDate || '' });
      const dateDirty = JSON.stringify(dateForm) !== JSON.stringify(committedDateRef.current);
      const overridesDirty = JSON.stringify(localRow) !== JSON.stringify(initialRowRef.current);
      const pendingDirty = dateDirty || overridesDirty;

      // Autosave pending edits (tax/earning overrides + dates) — flush to the shared
      // pending state on a debounce so they persist like the printed-check modal.
      // Safe because CheckDetailModal is now a top-level component that doesn't
      // remount when the parent re-renders on flush.
      const [pendSaveStatus, setPendSaveStatus] = useState('idle');
      const pendSaveTimerRef = useRef(null);
      const pendStatusTimerRef = useRef(null);
      function savePending() {
        flushLocal();
        setPeriodOverrides(prev => ({ ...prev, [period.end]: { start: dateForm.start, end: dateForm.end, payDate: dateForm.payDate } }));
        initialRowRef.current = { ...localRow };
        committedDateRef.current = { ...dateForm };
        setPendSaveStatus('saved');
        if (pendStatusTimerRef.current) clearTimeout(pendStatusTimerRef.current);
        pendStatusTimerRef.current = setTimeout(() => setPendSaveStatus('idle'), 2000);
      }
      useEffect(() => {
        if (!pendingDirty) return;
        if (dateForm.start && dateForm.end && dateForm.end < dateForm.start) { setPendSaveStatus('idle'); return; }
        if (pendSaveTimerRef.current) clearTimeout(pendSaveTimerRef.current);
        setPendSaveStatus('saving');
        pendSaveTimerRef.current = setTimeout(() => savePending(), 800);
        return () => { if (pendSaveTimerRef.current) clearTimeout(pendSaveTimerRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [JSON.stringify(localRow), JSON.stringify(dateForm)]);

      const pendingItemDefs = [
        { field: 'tips',        label: 'Reported Tips',           hint: 'taxable',     isDeduction: false },
        { field: 'bonus',       label: 'Bonus',                   hint: 'taxable',     isDeduction: false },
        { field: 'commission',  label: 'Commission',              hint: 'taxable',     isDeduction: false },
        { field: 'mileage',     label: 'Mileage / Reimbursement', hint: 'non-taxable', isDeduction: false },
        { field: 'cashAdvance', label: 'Cash Advance',            hint: 'deduction',   isDeduction: true  },
      ];
      // Child support: default comes from the employee's active orders; an edited
      // value on this row overrides the total for this check only (clearing the
      // field reverts to the default).
      const csDefault = r2((csDefaults || {})[emp.id] || 0);
      const csEffective = csEffectiveAmount(row, csDefault);
      const [addedPendingItems, setAddedPendingItems] = useState(() => {
        const s = new Set();
        if (parseFloat(row.tips        || 0) > 0) s.add('tips');
        if (parseFloat(row.bonus       || 0) > 0) s.add('bonus');
        if (parseFloat(row.commission  || 0) > 0) s.add('commission');
        if (parseFloat(row.mileage     || 0) > 0) s.add('mileage');
        if (parseFloat(row.cashAdvance || 0) > 0) s.add('cashAdvance');
        return s;
      });
      const [pendingOtherOpen, setPendingOtherOpen] = useState(false);
      const addedPendingEarnings  = pendingItemDefs.filter(x => !x.isDeduction && addedPendingItems.has(x.field));
      const hiddenPendingItems    = pendingItemDefs.filter(x => !addedPendingItems.has(x.field));
      const liveGross  = r2(regPay + otPay + addedPendingEarnings.reduce((s, x) => s + parseFloat(row[x.field] || 0), 0));
      const estSSCalc  = r2(liveGross * EE_SS_RATE);
      const estMedCalc = r2(liveGross * EE_MEDICARE_RATE);
      const estCashAdv = addedPendingItems.has('cashAdvance') ? parseFloat(row.cashAdvance || 0) : 0;
      // Override values (user-editable) — fall back to calculated estimates
      const dispSS     = row.ssOverride    !== undefined ? parseFloat(row.ssOverride    || 0) : estSSCalc;
      const dispMed    = row.medOverride   !== undefined ? parseFloat(row.medOverride   || 0) : estMedCalc;
      const dispErSS   = row.erSsOverride  !== undefined ? parseFloat(row.erSsOverride  || 0) : r2(liveGross * EE_SS_RATE);
      const dispErMed  = row.erMedOverride !== undefined ? parseFloat(row.erMedOverride || 0) : r2(liveGross * EE_MEDICARE_RATE);
      const estNet     = r2(liveGross - dispSS - dispMed - estCashAdv - csEffective);
      // Employer estimates
      const estFutaTaxable = Math.max(0, Math.min(liveGross, 7000 - ytd.gross));
      const estFutaCalc= r2(estFutaTaxable * 0.006);
      const curQtr     = Math.ceil((new Date().getMonth() + 1) / 3);
      const suiRateEst = [client?.suiRateQ1, client?.suiRateQ2, client?.suiRateQ3, client?.suiRateQ4][curQtr - 1] ?? 0.027;
      const estSutaTaxable = Math.max(0, Math.min(liveGross, 9000 - ytd.gross));
      const estSutaCalc= r2(estSutaTaxable * suiRateEst);
      const dispFuta   = row.futaOverride !== undefined ? parseFloat(row.futaOverride || 0) : estFutaCalc;
      const dispSuta   = row.suiOverride  !== undefined ? parseFloat(row.suiOverride  || 0) : estSutaCalc;

      // Live federal + state tax estimate via calculate API
      const [liveCalc, setLiveCalc] = useState(null);
      useEffect(() => {
        if (liveGross <= 0) { setLiveCalc(null); return; }
        const payFreqStr = ppy === 52 ? 'weekly' : ppy === 26 ? 'biweekly' : ppy === 24 ? 'semimonthly' : 'monthly';
        api.calculate({
          grossWages: liveGross,
          payFrequency: payFreqStr,
          filingStatus: emp.filingStatus || 'single',
          step2Checkbox: emp.step2Checkbox || false,
          step3Children: emp.step3Children || 0,
          step3Other: emp.step3Other || 0,
          step4a: emp.step4a || 0,
          step4b: emp.step4b || 0,
          step4c: emp.step4c || 0,
          fitExempt: !!emp.fitExempt,
          workState: emp.workState || 'TX',
          ytdGross: ytd.gross,
          sutaRate: suiRateEst,
        }).then(r => setLiveCalc(r)).catch(() => setLiveCalc(null));
      }, [liveGross]);

      const estFITCalc   = liveCalc?.fitWithholding  ?? null;
      const estStateTaxCalc = liveCalc?.stateIncomeTax  ?? null;
      const dispFIT      = row.fitOverride   !== undefined ? parseFloat(row.fitOverride   || 0) : estFITCalc;
      const dispStateTax = row.stateOverride !== undefined ? parseFloat(row.stateOverride || 0) : estStateTaxCalc;
      const estNetFull  = (dispFIT != null && dispStateTax != null)
        ? r2(liveGross - dispFIT - dispSS - dispMed - dispStateTax - estCashAdv - csEffective)
        : (liveCalc != null
          ? r2(liveGross - (liveCalc.fitWithholding || 0) - dispSS - dispMed - (liveCalc.stateIncomeTax || 0) - estCashAdv - csEffective)
          : estNet);

      // Sum estimates from ALL OTHER pending periods for this employee
      // (current period is added separately below via liveGross / disp* values)
      const otherPendingTotals = Object.entries(pendingRows).reduce((acc, [pEnd, empMap]) => {
        if (pEnd === period.end) return acc; // skip current period — handled by liveGross
        const r2emp = empMap[String(emp.id)] || empMap[emp.id];
        if (!r2emp) return acc;
        const eIsSalary = emp.payType === 'salary';
        const eRate     = parseFloat(r2emp.rate) || emp.hourlyRate || 0;
        const eRegH     = parseFloat(r2emp.regHours || 0);
        const eOtH      = parseFloat(r2emp.otHours  || 0);
        const eReg      = eIsSalary ? effPeriodSalary(r2emp, emp, ppy) : r2(eRegH * eRate);
        const eOt       = eIsSalary ? 0 : r2(eOtH * eRate * 1.5);
        const eTips     = parseFloat(r2emp.tips       || 0);
        const eBonus    = parseFloat(r2emp.bonus      || 0);
        const eComm     = parseFloat(r2emp.commission || 0);
        const eGross    = r2(eReg + eOt + eTips + eBonus + eComm);
        const eSS       = r2emp.ssOverride    !== undefined ? parseFloat(r2emp.ssOverride    || 0) : r2(eGross * EE_SS_RATE);
        const eMed      = r2emp.medOverride   !== undefined ? parseFloat(r2emp.medOverride   || 0) : r2(eGross * EE_MEDICARE_RATE);
        const eFIT      = r2emp.fitOverride   !== undefined ? parseFloat(r2emp.fitOverride   || 0) : 0;
        const eState    = r2emp.stateOverride !== undefined ? parseFloat(r2emp.stateOverride || 0) : 0;
        const eCashAdv  = parseFloat(r2emp.cashAdvance  || 0);
        const eErSS     = r2emp.erSsOverride  !== undefined ? parseFloat(r2emp.erSsOverride  || 0) : r2(eGross * EE_SS_RATE);
        const eErMed    = r2emp.erMedOverride !== undefined ? parseFloat(r2emp.erMedOverride || 0) : r2(eGross * EE_MEDICARE_RATE);
        const eRunningGross = acc.gross + ytd.gross;
        const eFutaTaxable  = Math.max(0, Math.min(eGross, 7000 - eRunningGross));
        const eSutaTaxable  = Math.max(0, Math.min(eGross, 9000 - eRunningGross));
        const eFuta     = r2emp.futaOverride !== undefined ? parseFloat(r2emp.futaOverride || 0) : r2(eFutaTaxable * 0.006);
        const eSuta     = r2emp.suiOverride  !== undefined ? parseFloat(r2emp.suiOverride  || 0) : r2(eSutaTaxable * suiRateEst);
        const eNet      = r2(eGross - eSS - eMed - eFIT - eState - eCashAdv);
        return {
          gross:      r2(acc.gross      + eGross),
          eeSS:       r2(acc.eeSS      + eSS),
          eeMed:      r2(acc.eeMed     + eMed),
          fit:        r2(acc.fit       + eFIT),
          stateTax:   r2(acc.stateTax  + eState),
          netPay:     r2(acc.netPay    + eNet),
          erSS:       r2(acc.erSS      + eErSS),
          erMed:      r2(acc.erMed     + eErMed),
          futa:       r2(acc.futa      + eFuta),
          suta:       r2(acc.suta      + eSuta),
          regPay:     r2(acc.regPay    + eReg),
          otPay:      r2(acc.otPay     + eOt),
          tips:       r2(acc.tips      + eTips),
          bonus:      r2(acc.bonus     + eBonus),
          commission: r2(acc.commission + eComm),
        };
      }, { gross: 0, eeSS: 0, eeMed: 0, fit: 0, stateTax: 0, netPay: 0, erSS: 0, erMed: 0, futa: 0, suta: 0, regPay: 0, otPay: 0, tips: 0, bonus: 0, commission: 0 });

      // Current-period per-type values
      const curTips     = parseFloat(row.tips       || 0);
      const curBonus    = parseFloat(row.bonus      || 0);
      const curComm     = parseFloat(row.commission || 0);

      // YTD = printed checks + all other pending periods + this period
      const ytdWithCurrent = {
        gross:      r2(ytd.gross      + otherPendingTotals.gross      + liveGross),
        eeSS:       r2(ytd.eeSS      + otherPendingTotals.eeSS      + dispSS),
        eeMed:      r2(ytd.eeMed     + otherPendingTotals.eeMed     + dispMed),
        fit:        r2(ytd.fit       + otherPendingTotals.fit       + (dispFIT      ?? 0)),
        stateTax:   r2(ytd.stateTax  + otherPendingTotals.stateTax  + (dispStateTax ?? 0)),
        netPay:     r2(ytd.netPay    + otherPendingTotals.netPay    + estNetFull),
        erSS:       r2(ytd.erSS      + otherPendingTotals.erSS      + dispErSS),
        erMed:      r2(ytd.erMed     + otherPendingTotals.erMed     + dispErMed),
        futa:       r2(ytd.futa      + otherPendingTotals.futa      + dispFuta),
        suta:       r2(ytd.suta      + otherPendingTotals.suta      + dispSuta),
        regPay:     r2(ytd.regPay    + otherPendingTotals.regPay    + regPay),
        otPay:      r2(ytd.otPay     + otherPendingTotals.otPay     + otPay),
        tips:       r2(ytd.tips      + otherPendingTotals.tips      + curTips),
        bonus:      r2(ytd.bonus     + otherPendingTotals.bonus     + curBonus),
        commission: r2(ytd.commission + otherPendingTotals.commission + curComm),
      };

      return (
        <ModalOverlay onClose={closeWithFlush}>
          <div className="card" style={{ width: 740, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>{emp.firstName} {emp.lastName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {isSalary ? 'Salary' : 'Hourly'} · {period.isLate ? <span style={{ color: '#dc2626', fontWeight: 700 }}>LATE</span> : 'Pending'}
                  </div>
                </div>
                <button onClick={closeWithFlush} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
              </div>
              {/* Pay period strip — editable */}
              <div style={{ display: 'flex', marginTop: 14, borderRadius: 8, overflow: 'hidden', border: `1px solid ${pendingDirty ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-secondary)', transition: 'border-color 0.15s' }}>
                {[
                  { label: 'Period Start', key: 'start' },
                  { label: 'Period End',   key: 'end'   },
                  { label: 'Pay Date',     key: 'payDate' },
                ].map(({ label, key }, i, arr) => (
                  <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                    <input type="date" value={dateForm[key]} onChange={e => setDateForm(f => ({ ...f, [key]: e.target.value }))}
                      style={{ ...MODAL_MONO, fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', outline: 'none', width: '100%', color: dateForm[key] !== (key === 'start' ? period.start : key === 'end' ? period.end : period.payDate) ? 'var(--accent)' : period.isLate && key === 'payDate' ? '#dc2626' : 'var(--text-primary)', cursor: 'pointer' }} />
                  </div>
                ))}
              </div>
              {periodDateWarning(dateForm.start, dateForm.end, dateForm.payDate) && (
                <div style={{ color: 'var(--error)', fontSize: 11, fontWeight: 600, marginTop: 6 }}>
                  {periodDateWarning(dateForm.start, dateForm.end, dateForm.payDate)}
                </div>
              )}
            </div>

            {/* Body: Employee Summary | Company Summary side-by-side (matches the printed-check "Ali Faisal" format) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>

              {/* Left — Employee Summary */}
              <div style={{ padding: '18px 20px 0 24px', borderRight: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Employee Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>Item Name</th>
                    <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>YTD</th>
                  </tr>
                </thead>
                <tbody>
                  {isSalary
                    ? <TR label="Salary / Period" amount={salAmt} ytdAmount={ytdWithCurrent.regPay} color="var(--accent)"
                        editValue={row.salaryOverride !== undefined ? row.salaryOverride : String(salAmt)}
                        onEditChange={v => setField('salaryOverride', v)} />
                    : <>
                        <TR label="Hourly Rate" amount={rate} ytdAmount={null} color="var(--accent)"
                          editValue={row.rate !== undefined ? String(row.rate) : String(emp.hourlyRate || '')}
                          onEditChange={v => setField('rate', v)}
                          editSuffix="/hr" noDollarSign={false} />
                        <TR label="Regular Hours" amount={regH} ytdAmount={null} color="var(--accent)"
                          editValue={row.regHours !== undefined ? String(row.regHours) : ''}
                          onEditChange={v => setField('regHours', v)}
                          editSuffix="hrs" noDollarSign={true} />
                        <TR label="Overtime Hours" amount={otH} ytdAmount={null} color="var(--accent)"
                          editValue={row.otHours !== undefined ? String(row.otHours) : ''}
                          onEditChange={v => setField('otHours', v)}
                          editSuffix="hrs" noDollarSign={true} />
                        <TR label="Regular Pay" amount={regPay} ytdAmount={ytdWithCurrent.regPay} color="var(--text-secondary)" />
                        {otPay > 0 && <TR label="Overtime Pay" amount={otPay} ytdAmount={ytdWithCurrent.otPay} color="var(--text-secondary)" />}
                      </>
                  }
                  {addedPendingEarnings.map(item => (
                    <TR key={item.field} label={item.label} amount={parseFloat(row[item.field] || 0)}
                      ytdAmount={ytdWithCurrent[item.field] ?? null} color="var(--accent)"
                      editValue={row[item.field] || ''} onEditChange={v => setField(item.field, v)} />
                  ))}
                  <TR label="Gross Pay"            amount={liveGross}    ytdAmount={ytdWithCurrent.gross}    color="var(--accent)" bold borderTop />
                  {addedPendingItems.has('cashAdvance') && (
                    <TR label="Cash Advance"       amount={parseFloat(row.cashAdvance || 0)} ytdAmount={null} negative color="#dc2626"
                      editValue={row.cashAdvance || ''} onEditChange={v => setField('cashAdvance', v)} />
                  )}
                  {(csDefault > 0 || row.childSupport !== undefined) && (
                    <TR label="Child Support"      amount={csEffective} ytdAmount={null} negative color="#dc2626"
                      editValue={row.childSupport !== undefined ? row.childSupport : String(csDefault)} onEditChange={v => setField('childSupport', v)} />
                  )}
                  <TR label="Social Security (est.)" amount={dispSS}  ytdAmount={ytdWithCurrent.eeSS}     negative color="#dc2626"
                    editValue={row.ssOverride !== undefined ? row.ssOverride : String(estSSCalc)} onEditChange={v => setField('ssOverride', v)} />
                  <TR label="Medicare (est.)"        amount={dispMed} ytdAmount={ytdWithCurrent.eeMed}    negative color="#dc2626"
                    editValue={row.medOverride !== undefined ? row.medOverride : String(estMedCalc)} onEditChange={v => setField('medOverride', v)} />
                  <TR label="Federal Income Tax"     amount={dispFIT      ?? 'calculating…'} ytdAmount={ytdWithCurrent.fit}      negative={dispFIT != null}      color={dispFIT != null && dispFIT > 0 ? '#dc2626' : 'var(--text-muted)'}
                    editValue={row.fitOverride !== undefined ? row.fitOverride : (estFITCalc != null ? String(estFITCalc) : '')} onEditChange={v => setField('fitOverride', v)} />
                  {(emp.step4c || 0) > 0 && (
                    <tr><td colSpan={3} style={{ padding: '0 0 4px', fontSize: 10, color: 'var(--text-muted)' }}>includes {fmt(emp.step4c)} extra withholding (W-4)</td></tr>
                  )}
                  <TR label="State Income Tax"       amount={dispStateTax ?? '—'}            ytdAmount={ytdWithCurrent.stateTax} negative={dispStateTax != null} color={dispStateTax != null && dispStateTax > 0 ? '#dc2626' : 'var(--text-muted)'}
                    editValue={row.stateOverride !== undefined ? row.stateOverride : (estStateTaxCalc != null ? String(estStateTaxCalc) : '')} onEditChange={v => setField('stateOverride', v)} />
                </tbody>
              </table>
              </div>

              {/* Right — Company Summary */}
              <div style={{ padding: '18px 24px 0 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Company Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>Item Name</th>
                    <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '0 0 6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>YTD</th>
                  </tr>
                </thead>
                <tbody>
                  <TR label="SS Match (est.)"              amount={dispErSS}  ytdAmount={ytdWithCurrent.erSS}  color="var(--text-secondary)"
                    editValue={row.erSsOverride !== undefined ? row.erSsOverride : String(r2(liveGross * EE_SS_RATE))} onEditChange={v => setField('erSsOverride', v)} />
                  <TR label="Medicare Match (est.)"        amount={dispErMed} ytdAmount={ytdWithCurrent.erMed} color="var(--text-secondary)"
                    editValue={row.erMedOverride !== undefined ? row.erMedOverride : String(r2(liveGross * EE_MEDICARE_RATE))} onEditChange={v => setField('erMedOverride', v)} />
                  <TR label="Federal Unemployment (est.)"  amount={dispFuta}  ytdAmount={ytdWithCurrent.futa}  color="var(--text-secondary)"
                    editValue={row.futaOverride !== undefined ? row.futaOverride : String(estFutaCalc)} onEditChange={v => setField('futaOverride', v)} />
                  <TR label="State Unemployment (est.)"    amount={dispSuta}  ytdAmount={ytdWithCurrent.suta}  color="var(--text-secondary)"
                    editValue={row.suiOverride !== undefined ? row.suiOverride : String(estSutaCalc)} onEditChange={v => setField('suiOverride', v)} />
                  <TR label="Total Company Cost" amount={r2(dispErSS + dispErMed + dispFuta + dispSuta)}
                    ytdAmount={r2((ytdWithCurrent.erSS||0)+(ytdWithCurrent.erMed||0)+(ytdWithCurrent.futa||0)+(ytdWithCurrent.suta||0))}
                    bold borderTop color="var(--text-primary)" />
                </tbody>
              </table>
              </div>
            </div>

            {/* Check Amount (est.) — full-width banner, matches the printed-check modal */}
            <div style={{ margin: '16px 24px 0', borderTop: '2px solid var(--border)' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px 8px' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Check Amount (est.)</div>
              <div style={{ ...MODAL_MONO, fontSize: 22, fontWeight: 800, color: r2(estNetFull) === 0 ? 'var(--warning)' : '#16a34a' }}>{r2(estNetFull) === 0 ? '⚠ ' : ''}{fmt(estNetFull)}</div>
            </div>
            {/* Other Payroll Items */}
            {hiddenPendingItems.length > 0 && (
              <div style={{ margin: '0 24px', borderTop: '1px solid var(--border)', paddingTop: 10, paddingBottom: 6 }}>
                <button type="button" onClick={() => setPendingOtherOpen(o => !o)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {pendingOtherOpen ? '▴' : '▾'} Other Payroll Items
                </button>
                {pendingOtherOpen && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {hiddenPendingItems.map(item => (
                      <button key={item.field} type="button"
                        onClick={() => { setAddedPendingItems(prev => new Set([...prev, item.field])); setPendingOtherOpen(false); }}
                        style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        + {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Save date overrides footer */}
            <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '2px solid var(--border)', padding: '12px 24px', display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', boxShadow: '0 -2px 10px rgba(0,0,0,0.07)', zIndex: 10 }}>
              <button
                onClick={() => {
                  if (!window.confirm(`Remove ${emp.fullName} from this pay period? They won't appear for this period again (future periods are unaffected).`)) return;
                  skipPending(period.end, emp.id);
                  onClose();
                }}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginRight: 'auto' }}>
                🗑 Remove
              </button>
              <button className="btn btn-ghost" onClick={closeWithFlush} style={{ fontSize: 13 }}>Close</button>
              {/* Autosave status — pending edits save automatically */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110, justifyContent: 'flex-end' }}>
                {pendSaveStatus === 'saving' && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span className="spinner" style={{ width: 13, height: 13 }} /> Saving…
                  </span>
                )}
                {pendSaveStatus === 'saved' && (
                  <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>✓ Saved</span>
                )}
                {pendSaveStatus === 'idle' && pendingDirty && (
                  <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 500 }}>Unsaved…</span>
                )}
              </div>
            </div>
          </div>
        </ModalOverlay>
      );
    }

    // ── History (printed/deposited) row ──────────────────────────────────────────
    // stub is LOCAL state: after an autosave we update it here (setStub) instead of
    // reloading the parent's paystub list — reloading re-renders PayEmployeesTab,
    // which remounts this modal and steals input focus. The parent table is
    // refreshed once, on close, via onClose (which calls reloadStubs).
    const [stub, setStub] = useState(rowData.stub);
    const savedSinceOpenRef = useRef(false);
    const isVoided = stub.check_status === 'voided';
    const [checkDesign, setCheckDesign] = useState(() => localStorage.getItem('checkDesign') || 'classic');
    const ytd = calcEmpYTD(stub.employee_id, stub.pay_period_end);

    // Editable date / gross / other payroll items state (hooks must be at top of history branch)
    const lineItemsList = stub.lineItems || [];
    const displayedTips = stub.reported_tips || lineItemsList.filter(li => li.pay_type === 'tips').reduce((s, li) => s + (li.amount || 0), 0);
    // initialGross = base compensation derived ALWAYS from stub.gross_wages so that
    // liveGross = initialGross + OT + tips + bonus + commission = stub.gross_wages exactly.
    // This is the only formula that guarantees the modal's Check Amount matches the
    // inline net pay cell (both computed from the same gross_wages).
    const initialGross  = r2(
      Math.max(0,
        (stub.gross_wages    || 0)
        - (stub.overtime_pay || 0)
        - (displayedTips     || 0)
        - (stub.bonus        || 0)
        - (stub.commission   || 0)
      )
    );
    const initialFit    = r2(stub.fit_withholding    || 0);
    const initialSS     = r2(stub.employee_ss        || 0);
    const initialMed    = r2(stub.employee_medicare  || 0);

    const [dateForm, setDateForm]     = useState({ start: stub.pay_period_start || '', end: stub.pay_period_end || '', payDate: stub.settlement_date || '' });
    const [grossOverride, setGrossOverride] = useState(String(initialGross));
    const [fitOverride, setFitOverride]     = useState(String(initialFit));
    const [ssOverride,  setSsOverride]      = useState(String(initialSS));
    const [medOverride, setMedOverride]     = useState(String(initialMed));
    // Company Summary (employer taxes) are editable too — "all items ought to be editable".
    const [erSsOverride,  setErSsOverride]  = useState(String(r2(stub.employer_ss       || 0)));
    const [erMedOverride, setErMedOverride] = useState(String(r2(stub.employer_medicare || 0)));
    const [futaOverride,  setFutaOverride]  = useState(String(r2(stub.futa_tax          || 0)));
    const [sutaOverride,  setSutaOverride]  = useState(String(r2(stub.suta_tax          || 0)));
    const [itemForm, setItemForm]   = useState({
      reportedTips:  String(displayedTips       || ''),
      bonus:         String(stub.bonus          || ''),
      commission:    String(stub.commission     || ''),
      reimbursement: String(stub.reimbursement  || ''),
      deduction:     String(stub.deduction      || ''),
      garnishment:   String(stub.garnishment    || ''),
    });
    const [addedItems, setAddedItems] = useState(() => {
      const s = new Set();
      if (displayedTips      > 0) s.add('reportedTips');
      if (stub.bonus         > 0) s.add('bonus');
      if (stub.commission    > 0) s.add('commission');
      if (stub.reimbursement > 0) s.add('reimbursement');
      if (stub.deduction     > 0) s.add('deduction');
      if (stub.garnishment   > 0) s.add('garnishment');
      return s;
    });
    const [otherOpen, setOtherOpen] = useState(false);
    // Track whether user has manually overridden each tax field so auto-estimates
    // don't overwrite explicit user input (and so we know when to pin to the DB).
    const [fitManual,  setFitManual]  = useState(false);
    const [ssManual,   setSsManual]   = useState(false);
    const [medManual,  setMedManual]  = useState(false);
    // Employer-tax manual pins — once the user edits a Company Summary field we
    // stop auto-recomputing it from gross and always send it back on save.
    const [erSsManual,  setErSsManual]  = useState(false);
    const [erMedManual, setErMedManual] = useState(false);
    const [futaManual,  setFutaManual]  = useState(false);
    const [sutaManual,  setSutaManual]  = useState(false);
    // Live state income tax + additional Medicare (recomputed as gross changes) so
    // the modal's preview matches the backend even before the save round-trips.
    const [liveStateTax, setLiveStateTax] = useState(r2(stub.state_income_tax   || 0));
    const [liveAddlMed,  setLiveAddlMed]  = useState(r2(stub.additional_medicare || 0));

    // "committed" = the values as of the last successful save (initially = DB values).
    // isDirty compares current form state against committed so autosave resets correctly
    // after each save without needing to close/reopen the modal.
    const [committed, setCommitted] = useState({
      gross: String(initialGross), fit: String(initialFit), ss: String(initialSS), med: String(initialMed),
      erSs: String(r2(stub.employer_ss || 0)), erMed: String(r2(stub.employer_medicare || 0)),
      futa: String(r2(stub.futa_tax || 0)), suta: String(r2(stub.suta_tax || 0)),
      dateStart: stub.pay_period_start || '', dateEnd: stub.pay_period_end || '', datePayDate: stub.settlement_date || '',
      tips: String(displayedTips || ''), bonus: String(stub.bonus || ''), commission: String(stub.commission || ''),
      reimbursement: String(stub.reimbursement || ''), deduction: String(stub.deduction || ''), garnishment: String(stub.garnishment || ''),
    });

    const isDirty = !isVoided && (
      parseFloat(grossOverride || 0) !== parseFloat(committed.gross || 0) ||
      parseFloat(fitOverride   || 0) !== parseFloat(committed.fit   || 0) ||
      parseFloat(ssOverride    || 0) !== parseFloat(committed.ss    || 0) ||
      parseFloat(medOverride   || 0) !== parseFloat(committed.med   || 0) ||
      parseFloat(erSsOverride  || 0) !== parseFloat(committed.erSs  || 0) ||
      parseFloat(erMedOverride || 0) !== parseFloat(committed.erMed || 0) ||
      parseFloat(futaOverride  || 0) !== parseFloat(committed.futa  || 0) ||
      parseFloat(sutaOverride  || 0) !== parseFloat(committed.suta  || 0) ||
      dateForm.start   !== committed.dateStart ||
      dateForm.end     !== committed.dateEnd   ||
      dateForm.payDate !== committed.datePayDate ||
      parseFloat(itemForm.reportedTips  || 0) !== parseFloat(committed.tips         || 0) ||
      parseFloat(itemForm.bonus         || 0) !== parseFloat(committed.bonus        || 0) ||
      parseFloat(itemForm.commission    || 0) !== parseFloat(committed.commission   || 0) ||
      parseFloat(itemForm.reimbursement || 0) !== parseFloat(committed.reimbursement|| 0) ||
      parseFloat(itemForm.deduction     || 0) !== parseFloat(committed.deduction    || 0) ||
      parseFloat(itemForm.garnishment   || 0) !== parseFloat(committed.garnishment  || 0)
    );

    const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
    const autoSaveTimerRef = useRef(null);
    const savedStatusTimerRef = useRef(null);
    const isSavingRef = useRef(false);
    const needsResaveRef = useRef(false); // edits arrived while a save was in flight

    async function saveEdits() {
      // If a save is already running, remember that more edits came in and
      // re-save once it finishes — otherwise the concurrent edit is lost.
      if (isSavingRef.current) { needsResaveRef.current = true; return; }
      isSavingRef.current = true;
      setSaveStatus('saving');
      try {
        // The taxable base (what FIT/SS/Medicare are computed on) changes only when
        // gross/tips/bonus/commission change. If it didn't change, we preserve the
        // stored taxes (including any prior manual override) by sending them back;
        // if it DID change and the user hasn't pinned a value, we let the backend
        // recompute the tax authoritatively from the new gross.
        const taxBaseChanged =
          parseFloat(grossOverride || 0)         !== parseFloat(committed.gross || 0) ||
          parseFloat(itemForm.reportedTips || 0) !== parseFloat(committed.tips  || 0) ||
          parseFloat(itemForm.bonus || 0)        !== parseFloat(committed.bonus || 0) ||
          parseFloat(itemForm.commission || 0)   !== parseFloat(committed.commission || 0);

        const payload = { payPeriodStart: dateForm.start, payPeriodEnd: dateForm.end, settlementDate: dateForm.payDate };
        if (parseFloat(grossOverride || 0) !== parseFloat(committed.gross || 0)) {
          const baseType = stub.regular_hours != null ? 'regular' : 'salary';
          const tipAmt   = parseFloat(itemForm.reportedTips || 0);
          const bonusAmt = parseFloat(itemForm.bonus        || 0);
          const commAmt  = parseFloat(itemForm.commission   || 0);
          payload.lineItems = [
            { payType: baseType, amount: parseFloat(grossOverride || 0) },
            // Preserve overtime as its own line item so the backend keeps it in
            // gross/net (dropping it here was silently zeroing overtime pay).
            ...(stub.overtime_pay > 0 ? [{ payType: 'overtime', amount: stub.overtime_pay, hours: stub.overtime_hours || null }] : []),
            ...(tipAmt   > 0 ? [{ payType: 'tips',       amount: tipAmt   }] : []),
            ...(bonusAmt > 0 ? [{ payType: 'bonus',      amount: bonusAmt }] : []),
            ...(commAmt  > 0 ? [{ payType: 'commission', amount: commAmt  }] : []),
          ];
          payload.reportedTips = tipAmt;
          payload.bonus        = bonusAmt;
          payload.commission   = commAmt;
        }
        // Send a tax override when the user pinned it, OR when the tax base didn't
        // change (to preserve the stored value). When the base changed and the user
        // didn't pin it, omit it so the backend recomputes from the new gross —
        // this avoids the stale-FIT-estimate race and matches the stored net_pay.
        if (fitManual || !taxBaseChanged) payload.fitWithholdingOverride      = parseFloat(fitOverride || 0);
        if (ssManual  || !taxBaseChanged) payload.ssWithholdingOverride       = parseFloat(ssOverride  || 0);
        if (medManual || !taxBaseChanged) payload.medicareWithholdingOverride = parseFloat(medOverride || 0);
        // Employer-tax (Company Summary) overrides: same rule — send when the
        // user pinned the field, or when the tax base didn't change (preserve).
        if (erSsManual  || !taxBaseChanged) payload.employerSsOverride       = parseFloat(erSsOverride  || 0);
        if (erMedManual || !taxBaseChanged) payload.employerMedicareOverride = parseFloat(erMedOverride || 0);
        if (futaManual  || !taxBaseChanged) payload.futaOverride             = parseFloat(futaOverride  || 0);
        if (sutaManual  || !taxBaseChanged) payload.sutaOverride             = parseFloat(sutaOverride  || 0);
        payload.reportedTips  = parseFloat(itemForm.reportedTips  || 0);
        payload.bonus         = parseFloat(itemForm.bonus         || 0);
        payload.commission    = parseFloat(itemForm.commission    || 0);
        payload.reimbursement = parseFloat(itemForm.reimbursement || 0);
        payload.deduction     = parseFloat(itemForm.deduction     || 0);
        payload.garnishment   = parseFloat(itemForm.garnishment   || 0);

        const resp  = await api.updatePaystub(stub.id, payload);
        const saved = resp && resp.paystub ? resp.paystub : null;
        savedSinceOpenRef.current = true;

        if (saved) {
          // Update this modal's LOCAL stub (no parent re-render → no remount → the
          // input keeps focus). The inline table row is refreshed on close.
          setStub(saved);
          if (!fitManual) setFitOverride(String(r2(saved.fit_withholding   || 0)));
          if (!ssManual)  setSsOverride (String(r2(saved.employee_ss       || 0)));
          if (!medManual) setMedOverride(String(r2(saved.employee_medicare || 0)));
          if (!erSsManual)  setErSsOverride (String(r2(saved.employer_ss       || 0)));
          if (!erMedManual) setErMedOverride(String(r2(saved.employer_medicare || 0)));
          if (!futaManual)  setFutaOverride (String(r2(saved.futa_tax          || 0)));
          if (!sutaManual)  setSutaOverride (String(r2(saved.suta_tax          || 0)));
          setLiveStateTax(r2(saved.state_income_tax   || 0));
          setLiveAddlMed (r2(saved.additional_medicare || 0));
        }
        // Advance the baseline from what the backend actually stored (not local
        // estimates), so isDirty settles instead of firing a spurious re-save.
        setCommitted({
          gross: grossOverride,
          fit:  saved && !fitManual ? String(r2(saved.fit_withholding   || 0)) : fitOverride,
          ss:   saved && !ssManual  ? String(r2(saved.employee_ss       || 0)) : ssOverride,
          med:  saved && !medManual ? String(r2(saved.employee_medicare || 0)) : medOverride,
          erSs:  saved && !erSsManual  ? String(r2(saved.employer_ss       || 0)) : erSsOverride,
          erMed: saved && !erMedManual ? String(r2(saved.employer_medicare || 0)) : erMedOverride,
          futa:  saved && !futaManual  ? String(r2(saved.futa_tax          || 0)) : futaOverride,
          suta:  saved && !sutaManual  ? String(r2(saved.suta_tax          || 0)) : sutaOverride,
          dateStart: dateForm.start, dateEnd: dateForm.end, datePayDate: dateForm.payDate,
          tips: itemForm.reportedTips, bonus: itemForm.bonus, commission: itemForm.commission,
          reimbursement: itemForm.reimbursement, deduction: itemForm.deduction, garnishment: itemForm.garnishment,
        });
        setSaveStatus('saved');
        if (savedStatusTimerRef.current) clearTimeout(savedStatusTimerRef.current);
        savedStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (e) {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
        alert('Save failed: ' + e.message);
      } finally {
        isSavingRef.current = false;
        // A save was requested while this one was running — run it now so the
        // later edits (e.g. a field changed mid-save) aren't dropped.
        if (needsResaveRef.current) {
          needsResaveRef.current = false;
          if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = setTimeout(() => saveEdits(), 150);
        }
      }
    }

    // Autosave: debounce 900ms after any form value changes
    useEffect(() => {
      if (!isDirty) return;
      if (dateForm.start && dateForm.end && dateForm.end < dateForm.start) { setSaveStatus('idle'); return; }
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => saveEdits(), 900);
      return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [grossOverride, fitOverride, ssOverride, medOverride,
        erSsOverride, erMedOverride, futaOverride, sutaOverride,
        dateForm.start, dateForm.end, dateForm.payDate,
        itemForm.reportedTips, itemForm.bonus, itemForm.commission,
        itemForm.reimbursement, itemForm.deduction, itemForm.garnishment]);

    const canEdit = !isVoided;
    const set = field => canEdit ? (v => setItemForm(p => ({ ...p, [field]: v }))) : undefined;

    const mainPayRow = stub.regular_hours != null && stub.regular_pay != null
      ? { label: `Hourly  (${stub.regular_hours} hrs)`, amount: stub.regular_pay, editValue: canEdit ? grossOverride : undefined, onEditChange: canEdit ? setGrossOverride : undefined }
      : { label: 'Compensation', amount: initialGross, editValue: canEdit ? grossOverride : undefined, onEditChange: canEdit ? setGrossOverride : undefined };

    const optionalEarnings = [
      { key: 'reportedTips',  label: 'Reported Tips'  },
      { key: 'bonus',         label: 'Bonus'           },
      { key: 'commission',    label: 'Commission'      },
      { key: 'reimbursement', label: 'Reimbursement'  },
    ];
    const optionalDeductions = [
      { key: 'deduction',   label: 'Deduction'   },
      { key: 'garnishment', label: 'Garnishment' },
    ];

    const earningRows = [
      mainPayRow,
      stub.overtime_hours > 0 && stub.overtime_pay > 0 && { label: `Overtime  (${stub.overtime_hours} hrs)`, amount: stub.overtime_pay },
      ...optionalEarnings
        .filter(x => addedItems.has(x.key))
        .map(x => ({ label: x.label, amount: parseFloat(itemForm[x.key] || 0), editValue: canEdit ? itemForm[x.key] : undefined, onEditChange: set(x.key) })),
    ].filter(Boolean);

    const liveGross = r2(
      parseFloat(grossOverride || 0) +
      (stub.overtime_pay || 0) +
      optionalEarnings.filter(x => addedItems.has(x.key) && x.key !== 'reimbursement').reduce((s, x) => s + parseFloat(itemForm[x.key] || 0), 0)
    );

    // Auto-update SS/Medicare/FIT estimates when gross changes due to tip/bonus/commission edits.
    // IMPORTANT: skip the very first render — the saved values from the DB are authoritative on open.
    // Only recalculate when liveGross actually changes after the modal is mounted.
    const prevLiveGross = useRef(liveGross); // initialised to mount-time value
    const fitCalcTimer  = useRef(null);
    useEffect(() => {
      const prev = prevLiveGross.current;
      prevLiveGross.current = liveGross;
      if (isVoided || liveGross === prev) return; // nothing changed yet
      if (!ssManual)  setSsOverride(String(r2(liveGross * 0.062)));
      if (!medManual) setMedOverride(String(r2(liveGross * 0.0145)));
      // Employer SS/Medicare match the employee side (same rate). FUTA/SUTA
      // depend on wage-base caps, so the backend recomputes those on save.
      if (!erSsManual)  setErSsOverride(String(r2(liveGross * 0.062)));
      if (!erMedManual) setErMedOverride(String(r2(liveGross * 0.0145)));
      if (liveGross > 0) {
        // Recompute FIT (unless manually pinned) plus state income tax and
        // additional Medicare from the new gross, so the live preview matches
        // what the backend will store. Debounced: one request per pause in
        // typing, not one per keystroke (keystroke-rate calls could trip the
        // API rate limit, and the old silent catch left FIT/state frozen at
        // their pre-edit values while SS/Medicare kept moving).
        clearTimeout(fitCalcTimer.current);
        fitCalcTimer.current = setTimeout(() => {
          // Use the employee's REAL W-4 (extra withholding / exempt) so the live
          // FIT matches what the backend stores on save.
          const emp = (employees || []).find(x => x.id === stub.employee_id);
          const doCalc = () => api.calculate({
            grossWages:    liveGross,
            payFrequency:  stub.pay_frequency   || 'biweekly',
            filingStatus:  stub.filing_status   || 'single',
            step2Checkbox: !!stub.step2_checkbox,
            step3Children: stub.step3_children  || 0,
            step3Other:    stub.step3_other     || 0,
            step4a: emp?.step4a || 0, step4b: emp?.step4b || 0, step4c: emp?.step4c || 0,
            fitExempt: !!emp?.fitExempt,
            workState: stub.work_state || 'TX',
            ytdGross:  stub.ytd_wages_before    || 0,
          });
          doCalc()
            .catch(() => new Promise(r => setTimeout(r, 800)).then(doCalc)) // one retry
            .then(res => {
              if (!res) return;
              if (!fitManual) setFitOverride(String(r2(res.fitWithholding || 0)));
              setLiveStateTax(r2(res.stateIncomeTax   || 0));
              setLiveAddlMed (r2(res.additionalMedicare || 0));
            })
            .catch(() => {});
        }, 350);
      }
      return () => clearTimeout(fitCalcTimer.current);
    }, [liveGross]);

    // Clamp at 0 to match the backend — a check can't be written for a negative
    // amount, so the modal's "Check Amount" never goes below zero either.
    const liveNetPay = Math.max(0, r2(
      liveGross
      - parseFloat(fitOverride || 0)
      - parseFloat(ssOverride  || 0)
      - parseFloat(medOverride || 0)
      - liveAddlMed
      - liveStateTax
      - parseFloat(itemForm.deduction   || 0)
      - parseFloat(itemForm.garnishment || 0)
      - (stub.child_support || 0)
      + parseFloat(itemForm.reimbursement || 0)
    ));

    const deductionRows = [
      { label: 'Federal Income Tax', amount: stub.fit_withholding   || 0, ytd: ytd.fit,
        editValue: canEdit ? fitOverride : undefined,
        onEditChange: canEdit ? (v => { setFitManual(v !== ''); setFitOverride(v); }) : undefined },
      { label: 'Social Security', amount: stub.employee_ss       || 0, ytd: ytd.eeSS,
        editValue: canEdit ? ssOverride  : undefined,
        onEditChange: canEdit ? (v => { setSsManual(v !== '');  setSsOverride(v);  }) : undefined },
      { label: 'Medicare',        amount: stub.employee_medicare || 0, ytd: ytd.eeMed,
        editValue: canEdit ? medOverride : undefined,
        onEditChange: canEdit ? (v => { setMedManual(v !== ''); setMedOverride(v); }) : undefined },
      liveAddlMed > 0 && { label: 'Addl Medicare', amount: liveAddlMed, ytd: 0 },
      { label: 'State Income Tax',   amount: liveStateTax, ytd: ytd.stateTax },
      ...optionalDeductions
        .filter(x => addedItems.has(x.key))
        .map(x => ({ label: x.label, amount: parseFloat(itemForm[x.key] || 0), editValue: canEdit ? itemForm[x.key] : undefined, onEditChange: set(x.key) })),
      // Read-only: withheld per the employee's child support orders. Adjust the
      // amount on future checks via the employee's orders, not here.
      (stub.child_support || 0) > 0 && { label: 'Child Support', amount: stub.child_support },
    ].filter(Boolean);

    const hiddenItems = [...optionalEarnings, ...optionalDeductions].filter(x => !addedItems.has(x.key));

    const employerRows = [
      { label: 'SS Match (Company)',       amount: parseFloat(erSsOverride  || 0), ytd: ytd.erSS   ?? 0,
        editValue: canEdit ? erSsOverride  : undefined,
        onEditChange: canEdit ? (v => { setErSsManual(v !== '');  setErSsOverride(v);  }) : undefined },
      { label: 'Medicare Match (Company)', amount: parseFloat(erMedOverride || 0), ytd: ytd.erMed  ?? 0,
        editValue: canEdit ? erMedOverride : undefined,
        onEditChange: canEdit ? (v => { setErMedManual(v !== ''); setErMedOverride(v); }) : undefined },
      { label: 'Federal Unemployment',     amount: parseFloat(futaOverride  || 0), ytd: ytd.futa,
        editValue: canEdit ? futaOverride  : undefined,
        onEditChange: canEdit ? (v => { setFutaManual(v !== '');  setFutaOverride(v);  }) : undefined },
      { label: `${stub.work_state || 'State'} Unemployment`, amount: parseFloat(sutaOverride || 0), ytd: ytd.suta,
        editValue: canEdit ? sutaOverride : undefined,
        onEditChange: canEdit ? (v => { setSutaManual(v !== ''); setSutaOverride(v); }) : undefined },
    ];
    const employerTotal = r2(employerRows.reduce((s, r) => s + r.amount, 0));
    const employerYTD   = r2(employerRows.reduce((s, r) => s + (r.ytd || 0), 0));

    // Closing inside the 900ms autosave debounce was silently discarding the last
    // edit — flush any dirty state before the modal unmounts.
    const closeWithSave = () => {
      if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
      // Same guard as the autosave: never persist an inverted period range.
      if (isDirty && !(dateForm.start && dateForm.end && dateForm.end < dateForm.start)) saveEdits();
      onClose();
    };

    return (
      <ModalOverlay onClose={closeWithSave}>
        <div className="card" style={{ width: 740, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>

          {/* Header */}
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 20, textDecoration: isVoided ? 'line-through' : 'none' }}>{stub.employee_name}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <StatusBadge status={stub.check_status || 'draft'} />
                  {stub.check_number && <span style={{ ...MODAL_MONO, fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>Check #{stub.check_number}</span>}
                </div>
              </div>
              <button onClick={closeWithSave} aria-label="Save and close" style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
            </div>
            {/* Pay period strip — editable for non-voided checks */}
            <div style={{ display: 'flex', marginTop: 14, borderRadius: 8, overflow: 'hidden', border: `1px solid ${isDirty ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-secondary)', transition: 'border-color 0.15s' }}>
              {[
                { label: 'Period Start', key: 'start',   raw: stub.pay_period_start },
                { label: 'Period End',   key: 'end',     raw: stub.pay_period_end   },
                { label: 'Pay Date',     key: 'payDate', raw: stub.settlement_date  },
              ].map(({ label, key, raw }, i, arr) => (
                <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                  {isVoided
                    ? <div style={{ ...MODAL_MONO, fontSize: 13, fontWeight: 600 }}>{fmtDate(raw)}</div>
                    : <input type="date" value={dateForm[key]}
                        onChange={e => setDateForm(f => ({ ...f, [key]: e.target.value }))}
                        style={{ ...MODAL_MONO, fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', outline: 'none', width: '100%', color: dateForm[key] !== (raw || '') ? 'var(--accent)' : 'var(--text-primary)', cursor: 'pointer' }} />
                  }
                </div>
              ))}
            </div>
            {!isVoided && periodDateWarning(dateForm.start, dateForm.end, dateForm.payDate) && (
              <div style={{ color: 'var(--error)', fontSize: 11, fontWeight: 600, marginTop: 6 }}>
                {periodDateWarning(dateForm.start, dateForm.end, dateForm.payDate)}
              </div>
            )}
          </div>

          {/* Two-column body */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>

            {/* Left — Employee Summary */}
            <div style={{ padding: '18px 20px 0 24px', borderRight: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Employee Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <ColHeader hasYTD={true} />
                <tbody>
                  {earningRows.map(r => (
                    <TR key={r.label} label={r.label} amount={r.amount} color="var(--accent)"
                      editValue={r.editValue} onEditChange={r.onEditChange} />
                  ))}
                  <TR label="Gross Pay" amount={liveGross} ytdAmount={ytd.gross} color="var(--accent)" bold borderTop />
                  {deductionRows.map(r => (
                    <TR key={r.label} label={r.label} amount={r.amount} ytdAmount={r.ytd} negative
                      color={r.amount > 0 ? '#dc2626' : 'var(--text-muted)'}
                      editValue={r.editValue} onEditChange={r.onEditChange} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Right — Company Summary */}
            <div style={{ padding: '18px 24px 0 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Company Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <ColHeader hasYTD={true} />
                <tbody>
                  {employerRows.map(r => <TR key={r.label} label={r.label} amount={r.amount} ytdAmount={r.ytd} editValue={r.editValue} onEditChange={r.onEditChange} />)}
                  <TR label="Total Company Cost" amount={employerTotal} ytdAmount={employerYTD} bold borderTop color="var(--text-primary)" />
                </tbody>
              </table>
            </div>
          </div>

          {/* Check Amount + tax bar */}
          <div style={{ margin: '16px 24px 0', borderTop: '2px solid var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px 4px' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Check Amount</div>
            <div style={{ ...MODAL_MONO, fontSize: 22, fontWeight: 800, color: '#16a34a' }}>{fmt(liveNetPay)}</div>
          </div>
          <div style={{ display: 'flex', gap: 0, margin: '12px 24px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            {(() => {
              // 941 deposit = employee FIT + SS + Med (+ addl med) + employer SS + Med,
              // computed live from the current overrides so the bar matches the
              // Company Summary edits before the autosave round-trips.
              const live941 = r2(
                parseFloat(fitOverride || 0) + parseFloat(ssOverride || 0) + parseFloat(medOverride || 0)
                + liveAddlMed + parseFloat(erSsOverride || 0) + parseFloat(erMedOverride || 0)
              );
              const liveFuta = parseFloat(futaOverride || 0);
              const liveSuta = parseFloat(sutaOverride || 0);
              return [
                { label: '941 Tax Deposit', value: fmt(live941) },
                { label: '940 FUTA',        value: fmt(liveFuta) },
                { label: 'State SUI',       value: fmt(liveSuta) },
                { label: 'Total Tax Costs', value: fmt(r2(live941 + liveFuta + liveSuta)), accent: true },
              ];
            })().map(({ label, value, accent }, i, arr) => (
              <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none', background: accent ? 'var(--accent-light)' : undefined }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ ...MODAL_MONO, fontSize: 14, fontWeight: 800, color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Other Payroll Items */}
          {canEdit && hiddenItems.length > 0 && (
            <div style={{ margin: '0 24px', borderTop: '1px solid var(--border)', paddingTop: 10, paddingBottom: 6 }}>
              <button type="button" onClick={() => setOtherOpen(o => !o)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {otherOpen ? '▴' : '▾'} Other Payroll Items
              </button>
              {otherOpen && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {hiddenItems.map(item => (
                    <button key={item.key} type="button"
                      onClick={() => { setAddedItems(prev => new Set([...prev, item.key])); setOtherOpen(false); }}
                      style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      + {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer: always-visible sticky bar */}
          <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '2px solid var(--border)', padding: '14px 24px', display: 'flex', gap: 8, alignItems: 'center', zIndex: 10, boxShadow: '0 -2px 10px rgba(0,0,0,0.07)' }}>
            {!isVoided && (
              <button onClick={async () => {
                const who = stub.employee_name || 'this employee';
                if (!window.confirm(deleteCheckConfirm({ name: who, amount: fmt(r2(stub.net_pay || 0)), checkNumber: stub.check_number }))) return;
                try { await api.deletePaystub(stub.id); onClose(); reloadStubs(); }
                catch (e) {
                  // The backend blocks deleting checks whose 941/940 deposit was
                  // already submitted (409). Offer the explicit override.
                  if (/already submitted/i.test(e.message || '')) {
                    if (window.confirm(`${e.message}\n\nDelete anyway?`)) {
                      try { await api.deletePaystub(stub.id, { force: true }); onClose(); reloadStubs(); }
                      catch (e2) { alert(e2.message); }
                    }
                  } else alert(e.message);
                }
              }} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                🗑 Delete
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={async () => {
              if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
                autoSaveTimerRef.current = null;
                if (isDirty) await saveEdits();
              }
              onClose();
            }} style={{ fontSize: 13 }}>Close</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <button className="btn btn-ghost" style={{ fontSize: 13, borderRadius: '6px 0 0 6px', borderRight: 'none' }}
                onClick={async () => {
                  try { await api.printSelectedChecks(clientId, [stub.id], checkDesign); } catch (e) { alert(e.message); }
                }}>
                ↓ Paycheck
              </button>
              <select
                value={checkDesign}
                onChange={e => { setCheckDesign(e.target.value); localStorage.setItem('checkDesign', e.target.value); }}
                style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 0, padding: '6px 4px', background: 'var(--bg-primary)', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <option value="classic">Classic</option>
                <option value="micr">MICR (Check Printer)</option>
                <option value="top">Top Check</option>
              </select>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={async () => {
              try { await api.printSelectedPaystubs(clientId, [stub.id]); } catch (e) { alert(e.message); }
            }}>↓ Paystub</button>
            {isDirty && (
              <button onClick={() => {
                if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
                setGrossOverride(committed.gross);
                setFitOverride(committed.fit);
                setSsOverride(committed.ss);
                setMedOverride(committed.med);
                setItemForm({ reportedTips: committed.tips, bonus: committed.bonus, commission: committed.commission, reimbursement: committed.reimbursement, deduction: committed.deduction, garnishment: committed.garnishment });
                setDateForm({ start: committed.dateStart, end: committed.dateEnd, payDate: committed.datePayDate });
                const s = new Set();
                if (parseFloat(committed.tips)         > 0) s.add('reportedTips');
                if (parseFloat(committed.bonus)        > 0) s.add('bonus');
                if (parseFloat(committed.commission)   > 0) s.add('commission');
                if (parseFloat(committed.reimbursement)> 0) s.add('reimbursement');
                if (parseFloat(committed.deduction)    > 0) s.add('deduction');
                if (parseFloat(committed.garnishment)  > 0) s.add('garnishment');
                setAddedItems(s);
                setOtherOpen(false);
                // Clear manual-tax flags so reverted tax fields re-derive on the
                // next gross change instead of staying stuck "manual".
                setFitManual(false); setSsManual(false); setMedManual(false);
                setSaveStatus('idle');
              }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)' }}>Revert</button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110, justifyContent: 'flex-end' }}>
              {saveStatus === 'saving' && (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span className="spinner" style={{ width: 13, height: 13 }} /> Saving…
                </span>
              )}
              {saveStatus === 'saved' && (
                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>✓ Saved</span>
              )}
              {saveStatus === 'error' && (
                <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>✗ Error</span>
              )}
              {saveStatus === 'idle' && isDirty && (
                <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 500 }}>Unsaved…</span>
              )}
            </div>
          </div>
        </div>
      </ModalOverlay>
    );
  }

function PayEmployeesTab({ clientId, client, employees, onRefresh, refreshEmployees, refreshTick = 0, onGoToEmployees }) {
  const [showPaycheckImport, setShowPaycheckImport] = useState(false);
  // Active child-support order totals per employee — auto-withheld on every run,
  // editable per check in the detail modal.
  const [csTotals, setCsTotals] = useState({});
  const [csRefetch, setCsRefetch] = useState(0); // bumped when the employee drawer closes (orders may have changed)
  useEffect(() => {
    api.getChildSupportOrders(clientId).then(orders => {
      const m = {};
      for (const o of orders) if (o.active) m[o.employee_id] = r2((m[o.employee_id] || 0) + (o.amount || 0));
      setCsTotals(m);
    }).catch(() => {});
  }, [clientId, refreshTick, csRefetch]);
  const [payGroups, setPayGroups]     = useState([]);
  const [currentGroupId, setCurrentGroupId] = useState(() => {
    // Restore the group the user last had open for this company.
    const s = sessionStorage.getItem(`payGroup_${clientId}`);
    if (!s) return null;
    if (s === '__unassigned__') return s;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? null : n;
  });
  const [archiveMenuOpen, setArchiveMenuOpen] = useState(false);
  const [groupsLoading, setGroupsLoading]   = useState(true);
  const [editGroup, setEditGroup]     = useState(null);
  const [paystubs, setPaystubs]                   = useState([]);
  const [stubsLoaded, setStubsLoaded]             = useState(false);
  const [stubsError, setStubsError]               = useState(false);
  // pendingRows[periodEnd][empId] = { regHours, otHours, rate, selected }
  const [pendingRows, setPendingRows] = useState(() => {
    try {
      const s = localStorage.getItem(`pendingRows_${clientId}`);
      const rows = s ? JSON.parse(s) : {};
      // Strip empty-string tax overrides saved by older builds — they pinned the
      // display at $0 forever ("no matter what salary, federal tax stays 0").
      for (const periodMap of Object.values(rows)) {
        for (const row of Object.values(periodMap || {})) {
          for (const k of Object.keys(row || {})) {
            if (/Override$/.test(k) && row[k] === '') delete row[k];
          }
        }
      }
      return rows;
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(`pendingRows_${clientId}`, JSON.stringify(pendingRows)); } catch {}
  }, [pendingRows, clientId]);
  const [skippedPending, setSkippedPending] = useState(() => {
    try { const s = localStorage.getItem(`skippedPending_${clientId}`); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(`skippedPending_${clientId}`, JSON.stringify([...skippedPending])); } catch {}
  }, [skippedPending, clientId]);
  function skipPending(periodEnd, empId) {
    setSkippedPending(prev => new Set([...prev, `${periodEnd}_${empId}`]));
  }
  const [rateUpdatePrompt, setRateUpdatePrompt]   = useState(null); // { empId, newRate, periodEnd }
  const [selectedLateStubs, setSelectedLateStubs]     = useState(new Set());
  const [selectedHistoryStubs, setSelectedHistoryStubs] = useState(new Set());
  const [bulkBusy, setBulkBusy]                       = useState(false);
  const [running, setRunning]                         = useState(false);
  const [runErr, setRunErr]                       = useState('');
  const [runSuccess, setRunSuccess]               = useState('');
  const [detailModal, setDetailModal]             = useState(null); // rowData object
  const [showPrinted, setShowPrinted]             = useState(true);
  const [printModal, setPrintModal]               = useState(null); // { ids: [], mode: 'paycheck'|'paystub' }
  const [printModalBusy, setPrintModalBusy]       = useState(null); // 'paycheck' | 'paystub' | null
  const [printModalErr, setPrintModalErr]         = useState('');
  const [drawerEmpId, setDrawerEmpId]             = useState(null);
  const [periodEdit, setPeriodEdit]               = useState(null); // { id, start, end, payDate }
  const [savingPeriod, setSavingPeriod]           = useState(false);
  const [empStatusDrop, setEmpStatusDrop]         = useState(null); // { stub, top, right }
  const [empStatusBusy, setEmpStatusBusy]         = useState(null); // the in-flight drop — guards double-fire → duplicate paycheck
  const [periodOverrides, setPeriodOverrides]     = useState(() => { // { [periodEnd]: { start, end, payDate } }
    try { const s = localStorage.getItem(`periodOverrides_${clientId}`); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(`periodOverrides_${clientId}`, JSON.stringify(periodOverrides)); } catch {}
  }, [periodOverrides, clientId]);
  const [ungroupedModal, setUngroupedModal]       = useState(false);
  const [ugForm, setUgForm]                       = useState({ employeeId: '', start: '', end: '', payDate: '', regHours: '', otHours: '', rate: '', payType: 'regular', tips: '', bonus: '', commission: '', cashAdvance: '', mileage: '' });
  const [ugOtherOpen, setUgOtherOpen]             = useState(false);
  const [ugPreview, setUgPreview]                 = useState(null); // calculated check data before committing
  const [ugRunning, setUgRunning]                 = useState(false);
  const [ugErr, setUgErr]                         = useState('');
  // Real FIT/state tax estimates per pending row, keyed by `${empId}_${periodEnd}_${grossCents}`
  const [calcCache, setCalcCache]                 = useState({});

  useEffect(() => {
    api.getPayGroups(clientId)
      .then(groups => {
        setPayGroups(groups);
        // Keep whatever the user had open (including a restored selection) as
        // long as it still exists; only default to the first ACTIVE group when
        // there's no valid selection — never auto-land on an archived one.
        const firstActive = groups.find(g => !g.deletedAt);
        setCurrentGroupId(prev => {
          if (prev === '__unassigned__') return prev;
          if (prev != null && groups.some(g => g.id === prev)) return prev;
          return firstActive ? firstActive.id : prev;
        });
      })
      .catch(() => {})
      .finally(() => setGroupsLoading(false));
  }, [clientId, refreshTick]);

  // Remember the selected group per company so refreshes and tab switches come
  // back to the same screen instead of the first group.
  useEffect(() => {
    if (currentGroupId != null) sessionStorage.setItem(`payGroup_${clientId}`, String(currentGroupId));
  }, [currentGroupId, clientId]);

  useEffect(() => {
    // Sweep draft checks with a past pay date → 'late' in the DB, then reload.
    api.markLateChecks().catch(() => {}).finally(reloadStubs);
  }, [clientId, refreshTick]);

  async function reloadStubs() {
    try {
      const stubs = await api.getPaystubs(clientId);
      setPaystubs(stubs);
      setStubsLoaded(true);
      setStubsError(false);
    } catch {
      setStubsError(true);
    }
    // employees is a prop owned by the parent — refresh it WITHOUT the parent's
    // full refresh: that bumps refreshTick, whose effect calls reloadStubs again
    // (infinite request loop).
    if (refreshEmployees) refreshEmployees();
  }

  const activeEmps    = employees.filter(e => e.isActive);
  const UNASSIGNED_ID = '__unassigned__';
  const currentGroup  = payGroups.find(g => g.id === currentGroupId) || null;
  const unassignedEmps = activeEmps.filter(e => !e.payGroupId);
  const empsInGroup   = currentGroupId === UNASSIGNED_ID
    ? unassignedEmps
    : activeEmps.filter(e => e.payGroupId === currentGroupId);
  const isGroupDeleted = currentGroup ? !!currentGroup.deletedAt : false;

  // Active groups get real tabs; archived (soft-deleted) groups are tucked into a
  // small "Archived" menu so their check history stays reachable without clutter.
  const activeGroups   = payGroups.filter(g => !g.deletedAt);
  const archivedGroups = payGroups.filter(g => g.deletedAt);
  const tabs = [
    ...activeGroups,
    ...(unassignedEmps.length > 0 ? [{ id: UNASSIGNED_ID, name: `Unassigned (${unassignedEmps.length})`, frequency: 'biweekly' }] : []),
  ];

  // Returns ALL unpaid periods from the anchor: late periods (pay date passed) first,
  // then at most one upcoming period (pay date in the future).
  function getPendingPeriods() {
    if (!stubsLoaded || stubsError) return [];
    const g = currentGroup;
    if (!g || g.id === UNASSIGNED_ID || !g.firstPayPeriodEnd || g.deletedAt) return [];
    const anchor = g.firstPayPeriodStart || calcStartFromEnd(g.firstPayPeriodEnd, g.frequency);
    if (!anchor) return [];
    const freq = g.frequency || 'biweekly';

    // paidEnds includes ALL stubs (even voided) so that a deleted/voided pending
    // period is hidden from the schedule immediately after marking it.
    const byGroupId = paystubs.filter(s => s.pay_group_id === currentGroupId);
    const allGroupStubs = byGroupId.length > 0 ? byGroupId : (() => {
      const empIds = new Set(empsInGroup.map(e => e.id));
      return paystubs.filter(s => s.employee_id && empIds.has(s.employee_id));
    })();

    const paidEnds = new Set(allGroupStubs.map(s => s.pay_period_end));
    const todayStr = new Date().toISOString().slice(0, 10);

    // Compute calendar-day offset between configured payDate and firstPayPeriodEnd
    // so subsequent periods inherit the same offset (e.g. if group payDate is 2 days after period end, keep that pattern)
    const configuredPayDateOffset = (g.payDate && g.firstPayPeriodEnd)
      ? Math.round((new Date(g.payDate + 'T00:00:00') - new Date(g.firstPayPeriodEnd + 'T00:00:00')) / 86400000)
      : null;

    function calcGroupPayDate(endStr) {
      if (configuredPayDateOffset === null) return calcDefaultPayDate(endStr);
      const d = new Date(endStr + 'T00:00:00');
      d.setDate(d.getDate() + configuredPayDateOffset);
      // Push forward past weekends
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }

    let s = new Date(anchor + 'T00:00:00'), e = new Date(g.firstPayPeriodEnd + 'T00:00:00');
    const pending = [];
    let nonLateCount = 0;
    for (let i = 0; i < 60; i++) {
      const endStr = e.toISOString().slice(0, 10);
      if (!paidEnds.has(endStr)) {
        const payDate = calcGroupPayDate(endStr);
        const isLate = payDate < todayStr;
        pending.push({ start: s.toISOString().slice(0, 10), end: endStr, payDate, isLate });
        if (!isLate) {
          nonLateCount++;
          if (nonLateCount >= 1) break;
        }
      }
      [s, e] = advancePeriod(s, e, freq);
    }
    return pending;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const curYear  = new Date().getFullYear();
  const ppy = PERIODS_PER_YEAR[currentGroup?.frequency || 'biweekly'] || 26;

  // YTD aggregation from loaded paystubs (up to and including upToEnd)
  function calcEmpYTD(employeeId, upToEnd) {
    if (employeeId == null) return { gross:0, fit:0, eeSS:0, eeMed:0, stateTax:0, futa:0, suta:0, netPay:0, erSS:0, erMed:0, regPay:0, otPay:0, tips:0, bonus:0, commission:0 };
    const stubs = paystubs.filter(s =>
      s.employee_id === employeeId &&
      s.check_status !== 'voided' &&
      (s.tax_year === curYear || (s.pay_period_end || '').startsWith(String(curYear))) &&
      (!upToEnd || s.pay_period_end <= upToEnd)
    );
    return {
      gross:      stubs.reduce((n, s) => n + (s.gross_wages        || 0), 0),
      fit:        stubs.reduce((n, s) => n + (s.fit_withholding    || 0), 0),
      eeSS:       stubs.reduce((n, s) => n + (s.employee_ss        || 0), 0),
      eeMed:      stubs.reduce((n, s) => n + (s.employee_medicare  || 0), 0),
      stateTax:   stubs.reduce((n, s) => n + (s.state_income_tax   || 0), 0),
      futa:       stubs.reduce((n, s) => n + (s.futa_tax           || 0), 0),
      suta:       stubs.reduce((n, s) => n + (s.suta_tax           || 0), 0),
      netPay:     stubs.reduce((n, s) => n + (s.net_pay            || 0), 0),
      erSS:       stubs.reduce((n, s) => n + (s.employer_ss        || 0), 0),
      erMed:      stubs.reduce((n, s) => n + (s.employer_medicare  || 0), 0),
      regPay:     stubs.reduce((n, s) => n + (s.regular_pay        || 0), 0),
      otPay:      stubs.reduce((n, s) => n + (s.overtime_pay       || 0), 0),
      tips:       stubs.reduce((n, s) => n + (s.reported_tips      || 0), 0),
      bonus:      stubs.reduce((n, s) => n + (s.bonus              || 0), 0),
      commission: stubs.reduce((n, s) => n + (s.commission         || 0), 0),
    };
  }

  const pendingPeriods = getPendingPeriods();

  // Existing paystubs for this group, grouped by pay period end date
  const history = (() => {
    const empIds = new Set(empsInGroup.map(e => e.id));
    const byGroupId = paystubs.filter(s => s.pay_group_id === currentGroupId);
    // For the Unassigned bucket, show only paystubs with no pay_group_id (avoids
    // showing the same check in both a named group and Unassigned simultaneously).
    // For named groups, also pull in any legacy ungrouped checks for group members.
    const groupStubs = currentGroupId === UNASSIGNED_ID
      ? paystubs.filter(s => !s.pay_group_id && s.employee_id && empIds.has(s.employee_id))
      : byGroupId.length > 0
        ? [...byGroupId, ...paystubs.filter(s => s.pay_group_id == null && s.employee_id && empIds.has(s.employee_id) && !byGroupId.some(b => b.id === s.id))]
        : paystubs.filter(s => s.employee_id && empIds.has(s.employee_id));
    const map = {};
    groupStubs.forEach(stub => {
      const end = stub.pay_period_end;
      if (!map[end]) map[end] = { end, stubs: [] };
      map[end].stubs.push(stub);
    });
    return Object.values(map).sort((a, b) => b.end.localeCompare(a.end));
  })();

  // Split rows: main (pending + late history), printed (processed history)
  const mainRows    = [];
  const printedRows = [];

  // Build a settlement-date index per employee for the current group. This is used
  // below as a secondary "is this period already paid?" check for imported checks
  // whose stored pay_period_end may be off by 1-3 days from the schedule-generated
  // period end (due to pay-date variation month to month).
  const stubSettleDatesByEmp = new Map();
  if (currentGroupId && currentGroupId !== UNASSIGNED_ID) {
    const byId = paystubs.filter(s => s.pay_group_id === currentGroupId);
    const grpStubs = byId.length > 0 ? byId : (() => {
      const ids = new Set(empsInGroup.map(e => e.id));
      return paystubs.filter(s => s.employee_id && ids.has(s.employee_id));
    })();
    grpStubs.forEach(stub => {
      if (!stub.employee_id || !stub.settlement_date) return;
      if (!stubSettleDatesByEmp.has(stub.employee_id)) stubSettleDatesByEmp.set(stub.employee_id, []);
      stubSettleDatesByEmp.get(stub.employee_id).push(stub.settlement_date);
    });
  }

  pendingPeriods.forEach(period => {
    empsInGroup.forEach(emp => {
      if (skippedPending.has(`${period.end}_${emp.id}`)) return;
      const empDates = stubSettleDatesByEmp.get(emp.id);
      if (empDates && empDates.length > 0) {
        // Tenure window: no pending rows for periods before the employee's first
        // check (not hired yet) or starting 45+ days after their last check
        // (no longer employed). Employees with no check history at all are new
        // hires — they keep their pending rows.
        const firstCheck = empDates.reduce((a, b) => (a < b ? a : b));
        const lastCheck  = empDates.reduce((a, b) => (a > b ? a : b));
        if (period.end < firstCheck) return;
        const dormant = new Date(period.start + 'T00:00:00');
        dormant.setDate(dormant.getDate() - 45);
        if (lastCheck < dormant.toISOString().slice(0, 10)) return;
        // Historical hole: the period's pay date is 90+ days past AND the
        // employee was paid again afterward — the company clearly moved on
        // (leave of absence, seasonal gap). Not actionable payroll.
        const stale = new Date();
        stale.setDate(stale.getDate() - 90);
        if (period.payDate < stale.toISOString().slice(0, 10) && lastCheck > period.payDate) return;
        // Suppress phantom pending when the employee already has a check whose
        // settlement date falls within [period.start … payDate + 5 days].
        const buf = new Date(period.payDate + 'T00:00:00');
        buf.setDate(buf.getDate() + 5);
        const bufEnd = buf.toISOString().slice(0, 10);
        if (empDates.some(sd => sd >= period.start && sd <= bufEnd)) return;
      }
      mainRows.push({ type: 'pending', period, emp, key: `p-${period.end}-${emp.id}` });
    });
  });
  history.forEach(period => {
    period.stubs.forEach(stub => {
      const row = { type: 'history', stub, key: `h-${stub.id}` };
      if (PRINTED_STATUSES.has(stub.check_status)) printedRows.push(row);
      else mainRows.push(row);
    });
  });

  const [expandedOther, setExpandedOther] = useState(new Set());

  function getRow(periodEnd, empId) {
    return (pendingRows[periodEnd] || {})[empId] || { regHours: '', otHours: '', tips: '', bonus: '', commission: '', cashAdvance: '', mileage: '', selected: false };
  }
  function setRow(periodEnd, empId, field, value) {
    setPendingRows(prev => ({
      ...prev,
      [periodEnd]: { ...(prev[periodEnd] || {}), [empId]: { ...((prev[periodEnd] || {})[empId] || {}), [field]: value } },
    }));
  }

  // Shared estimate for a pending row — used by the grid cells and the tfoot totals
  // so the two can never disagree.
  function pendingRowEst(periodEnd, emp) {
    const row      = getRow(periodEnd, emp.id);
    const isSalary = emp.payType === 'salary';
    const salAmt   = effPeriodSalary(row, emp, ppy);
    const rate     = parseFloat(row.rate) || emp.hourlyRate || 0;
    const regH     = parseFloat(row.regHours || 0);
    const otH      = parseFloat(row.otHours  || 0);
    const tipsAmt  = parseFloat(row.tips || 0);
    const bonusAmt = parseFloat(row.bonus || 0);
    const commAmt  = parseFloat(row.commission || 0);
    const basePay  = isSalary ? salAmt : r2(regH * rate + otH * rate * 1.5);
    const grossPreview = r2(basePay + tipsAmt + bonusAmt + commAmt);
    const estEeSS    = r2(grossPreview * EE_SS_RATE);
    const estEeMed   = r2(grossPreview * EE_MEDICARE_RATE);
    const cached     = calcCache[`${emp.id}_${periodEnd}_${Math.round(grossPreview * 100)}`];
    const estFIT     = emp.fitExempt ? 0 : cached != null ? (cached.fitWithholding || 0) : Math.round(((taxAnn => taxAnn <= 12225 ? taxAnn * 0.10 : 1222.5 + (Math.min(taxAnn, 49675) - 12225) * 0.12 + Math.max(0, taxAnn - 49675) * 0.22)(Math.max(0, grossPreview * ppy - 16100))) / ppy);
    const estStateTax = cached != null ? (cached.stateIncomeTax || 0) : 0;
    const dispEeSS    = row.ssOverride    !== undefined ? parseFloat(row.ssOverride    || 0) : estEeSS;
    const dispEeMed   = row.medOverride   !== undefined ? parseFloat(row.medOverride   || 0) : estEeMed;
    const dispFITest  = row.fitOverride   !== undefined ? parseFloat(row.fitOverride   || 0) : estFIT;
    const dispStateEst= row.stateOverride !== undefined ? parseFloat(row.stateOverride || 0) : estStateTax;
    const cashAdvEst  = parseFloat(row.cashAdvance || 0);
    const csEst       = csEffectiveAmount(row, csTotals[emp.id]);
    const estNetPay   = r2(grossPreview - dispEeSS - dispEeMed - dispFITest - dispStateEst - cashAdvEst - csEst);
    return { row, regH, otH, grossPreview, estNetPay };
  }

  // Pre-compute real FIT+state tax per pending row via the calculate API (same as the check detail modal).
  // Keyed by `${empId}_${periodEnd}_${grossCents}` so stale entries are ignored.
  // Debounced 300ms so rapid keystrokes don't spawn a wave of API calls on every character,
  // which previously caused cascading setCalcCache re-renders that stole input focus.
  useEffect(() => {
    if (!empsInGroup.length || !pendingPeriods.length) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const payFreqStr = ppy === 52 ? 'weekly' : ppy === 26 ? 'biweekly' : ppy === 24 ? 'semimonthly' : 'monthly';
      pendingPeriods.forEach(period => {
        empsInGroup.forEach(emp => {
          const row   = getRow(period.end, emp.id);
          const isSal = emp.payType === 'salary';
          const salAmt = effPeriodSalary(row, emp, ppy);
          const rate  = parseFloat(row.rate) || emp.hourlyRate || 0;
          const gross = r2(
            (isSal ? salAmt : r2(parseFloat(row.regHours || 0) * rate + parseFloat(row.otHours || 0) * rate * 1.5))
            + parseFloat(row.tips || 0) + parseFloat(row.bonus || 0) + parseFloat(row.commission || 0)
          );
          if (gross <= 0) return;
          const key = `${emp.id}_${period.end}_${Math.round(gross * 100)}`;
          if (calcCache[key]) return;
          const ytdGross = calcEmpYTD(emp.id, period.end).gross;
          api.calculate({
            grossWages: gross, payFrequency: payFreqStr,
            filingStatus: emp.filingStatus || 'single',
            step2Checkbox: !!emp.step2Checkbox,
            step3Children: emp.step3Children || 0, step3Other: emp.step3Other || 0,
            step4a: emp.step4a || 0, step4b: emp.step4b || 0, step4c: emp.step4c || 0,
            fitExempt: !!emp.fitExempt,
            workState: emp.workState || client?.state || 'TX',
            ytdGross,
            sutaRate: client?.suiRateQ1 ?? client?.sutaRate ?? 0.027,
          }).then(res => { if (!cancelled) setCalcCache(prev => ({ ...prev, [key]: res })); }).catch(() => {});
        });
      });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGroupId, ppy, pendingPeriods.length, JSON.stringify(pendingRows), empsInGroup.length]);

  const selectedPendingCount = pendingPeriods.reduce((n, period) =>
    n + empsInGroup.filter(emp => getRow(period.end, emp.id).selected).length, 0);
  // Count late/draft stubs selected via the multi-select checkboxes
  const selectedHistoryLateIds = [...selectedHistoryStubs].filter(id => {
    const stub = history.flatMap(p => p.stubs).find(s => s.id === id);
    return stub && (stub.check_status === 'late' || stub.check_status === 'draft');
  });
  const totalActionCount = selectedPendingCount + selectedLateStubs.size + selectedHistoryLateIds.length;

  async function handleRunPayroll(forceMethod = null) {
    setRunErr(''); setRunSuccess('');
    for (const period of pendingPeriods) {
      for (const emp of empsInGroup) {
        const row = getRow(period.end, emp.id);
        if (!row.selected) continue;
        if (emp.payType !== 'salary') {
          const regH = parseFloat(row.regHours || 0);
          const otH  = parseFloat(row.otHours  || 0);
          if (isNaN(regH) || isNaN(otH) || (row.rate !== undefined && String(row.rate).trim() !== '' && isNaN(parseFloat(row.rate)))) {
            setRunErr(`The hours or rate for ${emp.firstName} ${emp.lastName} aren't a valid number — fix them before processing payroll.`);
            return;
          }
          if (regH === 0 && otH === 0) {
            setRunErr(`Please enter hours for ${emp.firstName} ${emp.lastName} before processing payroll.`);
            return;
          }
          const effRate = parseFloat(row.rate) || emp.hourlyRate || 0;
          if (effRate <= 0) {
            setRunErr(`Please enter an hourly rate for ${emp.firstName} ${emp.lastName} before processing payroll.`);
            return;
          }
        } else {
          // Salary is editable now — block a $0 gross so a cleared/zeroed salary
          // (with no other earnings) can't be silently dropped by the backend
          // while the run still reports success.
          const salGross = r2(effPeriodSalary(row, emp, ppy)
            + parseFloat(row.tips || 0) + parseFloat(row.bonus || 0) + parseFloat(row.commission || 0));
          if (salGross <= 0) {
            setRunErr(`Please enter a salary amount for ${emp.firstName} ${emp.lastName} before processing payroll.`);
            return;
          }
        }
      }
    }

    // ── Review before running ────────────────────────────────────────────────
    // These buttons create real checks, consume check numbers, and book tax
    // liabilities — and the backend can fire real ACH transfers. Summarize what
    // is about to happen and make the payment method explicit per employee.
    const reviewRows = [];
    for (const period of pendingPeriods) {
      for (const emp of empsInGroup) {
        const row = getRow(period.end, emp.id);
        if (!row.selected) continue;
        const isSalary = emp.payType === 'salary';
        const rate = parseFloat(row.rate) || emp.hourlyRate || 0;
        const gross = isSalary
          ? r2(effPeriodSalary(row, emp, ppy) + parseFloat(row.tips || 0) + parseFloat(row.bonus || 0) + parseFloat(row.commission || 0))
          : r2(parseFloat(row.regHours || 0) * rate + parseFloat(row.otHours || 0) * rate * 1.5
              + parseFloat(row.tips || 0) + parseFloat(row.bonus || 0) + parseFloat(row.commission || 0));
        const hasDD = emp.directDeposit?.status === 'active';
        reviewRows.push({ emp, gross, hasDD });
      }
    }
    if (forceMethod === 'dd') {
      const noDD = reviewRows.filter(r => !r.hasDD);
      if (noDD.length > 0) {
        setRunErr(`Direct deposit isn't set up for: ${noDD.map(r => `${r.emp.firstName} ${r.emp.lastName}`).join(', ')}. ` +
          `They would be marked "deposited" without any money moving. Set up their bank details first, or deselect them and use Print Paycheck.`);
        return;
      }
    }
    const lateCount = selectedLateStubs.size + selectedHistoryLateIds.length;
    if (reviewRows.length + lateCount > 0) {
      const totalGross = reviewRows.reduce((s, r) => s + r.gross, 0);
      const methodLabel = forceMethod === 'dd' ? 'paid by direct deposit (real ACH transfers)'
                        : forceMethod === 'paystub' ? 'processed as paper checks (print pay stubs)'
                        : 'processed as paper checks (print paychecks)';
      const lines = [
        `Run payroll for ${reviewRows.length + lateCount} check${reviewRows.length + lateCount === 1 ? '' : 's'}${reviewRows.length ? ` — total gross ${fmt(totalGross)}` : ''}?`,
        '',
        `They will be ${methodLabel}.`,
        'This creates the checks and books their tax liabilities.',
      ];
      if (!window.confirm(lines.join('\n'))) return;
    }

    setRunning(true);
    try {
      const allNewIds = [];
      const processedKeys = []; // which [periodEnd][empId] rows this run consumed
      for (const period of pendingPeriods) {
        const selectedEmps = empsInGroup.filter(emp => getRow(period.end, emp.id).selected);
        if (selectedEmps.length === 0) continue;
        const payrollEmps = selectedEmps.map(emp => {
          const row = getRow(period.end, emp.id);
          const isSalary = emp.payType === 'salary';
          const regH = parseFloat(row.regHours || 0);
          const otH  = parseFloat(row.otHours  || 0);
          const tips = parseFloat(row.tips || 0);
          const bonusAmt = parseFloat(row.bonus || 0);
          const commAmt  = parseFloat(row.commission || 0);
          const cashAdv  = parseFloat(row.cashAdvance || 0);
          const mileAmt  = parseFloat(row.mileage || 0);
          const rate = parseFloat(row.rate) || emp.hourlyRate || 0;
          const regPay = isSalary ? effPeriodSalary(row, emp, ppy) : r2(regH * rate);
          const otPay  = isSalary ? 0 : r2(otH * rate * 1.5);
          const lineItems = [
            ...(isSalary
              ? [{ payType: 'salary', description: 'Salary', amount: regPay }]
              : [
                  ...(regH > 0 ? [{ payType: 'regular',  description: 'Regular',  hours: regH, rate, amount: regPay }] : []),
                  ...(otH  > 0 ? [{ payType: 'overtime', description: 'Overtime', hours: otH,  rate: rate * 1.5, amount: otPay }] : []),
                ]),
            ...(tips      > 0 ? [{ payType: 'tips',       description: 'Reported Tips',      amount: tips }] : []),
            ...(bonusAmt  > 0 ? [{ payType: 'bonus',      description: 'Bonus',              amount: bonusAmt }] : []),
            ...(commAmt   > 0 ? [{ payType: 'commission', description: 'Commission',         amount: commAmt }] : []),
          ];
          const ytd = calcEmpYTD(emp.id, null);
          const csOv = csOverrideForPayload(row);
          return { employeeId: emp.id, lineItems, ytdGross: ytd.gross, regularHours: regH || null, overtimeHours: otH || null, regularPay: regPay, overtimePay: otPay, bonus: bonusAmt, commission: commAmt, reimbursement: mileAmt, deduction: cashAdv, reportedTips: tips,
            // Only send when edited on this check — absent (or a cleared field)
            // lets the backend withhold the employee's active order amounts.
            ...(csOv !== undefined ? { childSupport: csOv } : {}) };
        });
        const ov = periodOverrides[period.end] || {};
        // paymentMethod tells the backend whether to fire ACH transfers: 'print'/'paystub'
        // must never move money even for DD-active employees (double-pay risk).
        const res = await api.runPayroll({ clientId, payPeriodStart: ov.start || period.start, payPeriodEnd: ov.end || period.end, settlementDate: ov.payDate || period.payDate, payGroupId: currentGroupId, employees: payrollEmps, paymentMethod: forceMethod || 'auto' });
        if (res?.paystubs) res.paystubs.forEach(s => allNewIds.push({ id: s.id, directDeposit: s.directDeposit }));
        processedKeys.push(...selectedEmps.map(emp => ({ periodEnd: period.end, empId: emp.id })));
      }
      // Include selected late stubs — route based on forceMethod or employee DD status
      selectedLateStubs.forEach(id => {
        const stub = paystubs.find(s => s.id === id);
        const emp = stub ? activeEmps.find(e => e.id === stub.employee_id) : null;
        const isDD = forceMethod === 'dd' || (forceMethod !== 'print' && emp?.directDeposit?.status === 'active');
        allNewIds.push({ id, directDeposit: isDD });
      });
      selectedHistoryLateIds.forEach(id => {
        const stub = paystubs.find(s => s.id === id);
        const emp = stub ? activeEmps.find(e => e.id === stub.employee_id) : null;
        const isDD = forceMethod === 'dd' || (forceMethod !== 'print' && emp?.directDeposit?.status === 'active');
        allNewIds.push({ id, directDeposit: isDD });
      });
      // Override directDeposit on new stubs based on forceMethod
      if (forceMethod === 'print' || forceMethod === 'paystub') allNewIds.forEach(s => s.directDeposit = false);
      if (forceMethod === 'dd')    allNewIds.forEach(s => s.directDeposit = true);
      // DD employees: mark as direct_deposit_sent; print checks: mark as printed
      const ddIds    = allNewIds.filter(s => s.directDeposit).map(s => s.id);
      const printIds = allNewIds.filter(s => !s.directDeposit).map(s => s.id);
      await Promise.all([
        ...printIds.map(id => api.updatePaystubStatus(id, 'printed').catch(() => {})),
        ...ddIds.map(id => api.updatePaystubStatus(id, 'direct_deposit_sent').catch(() => {})),
      ]);
      await reloadStubs();
      // Only clear the rows this run actually processed — wiping the whole map was
      // destroying hours/rates the accountant had typed for OTHER pay groups/periods.
      setPendingRows(prev => {
        const next = { ...prev };
        for (const { periodEnd, empId } of processedKeys) {
          if (next[periodEnd]) {
            next[periodEnd] = { ...next[periodEnd] };
            delete next[periodEnd][empId];
            if (Object.keys(next[periodEnd]).length === 0) delete next[periodEnd];
          }
        }
        return next;
      });
      setPeriodOverrides(prev => {
        const processedEnds = new Set(processedKeys.map(k => k.periodEnd));
        const next = {};
        for (const [end, ov] of Object.entries(prev)) if (!processedEnds.has(end)) next[end] = ov;
        return next;
      });
      setSelectedLateStubs(new Set());
      const ddCount = ddIds.length;
      const printMode = forceMethod === 'paystub' ? 'paystub' : 'paycheck';
      if (printIds.length > 0) {
        setPrintModal({ ids: printIds, mode: printMode });
        if (ddCount > 0) {
          setRunSuccess(`Payroll complete — ${printIds.length} check${printIds.length !== 1 ? 's' : ''} to print and ${ddCount} direct deposit${ddCount !== 1 ? 's' : ''} initiated.`);
        }
      } else if (ddCount > 0) {
        setRunSuccess(`Payroll complete — ${ddCount} direct deposit${ddCount !== 1 ? 's' : ''} initiated.`);
      } else {
        setRunErr('Nothing was processed — no employees were selected or every selected row was empty.');
      }
    } catch (err) {
      setRunErr(err.message || 'Payroll run failed');
    } finally {
      setRunning(false);
    }
  }

  async function handleSavePeriod(stubId) {
    if (!periodEdit || periodEdit.id !== stubId) return;
    setSavingPeriod(true);
    try {
      await api.updatePaystub(stubId, { payPeriodStart: periodEdit.start, payPeriodEnd: periodEdit.end, settlementDate: periodEdit.payDate });
      await reloadStubs();
      setPeriodEdit(null);
    } catch (e) { alert(e.message); }
    finally { setSavingPeriod(false); }
  }

  useEffect(() => {
    if (!empStatusDrop) return;
    const close = () => setEmpStatusDrop(null);
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', close, true);
    };
  }, [empStatusDrop]);

  async function handleEmpStatusChange(drop, newStatus) {
    if (empStatusBusy) return; // a run is already in flight — a second click would duplicate the paycheck
    setEmpStatusDrop(null);
    // Setting a status on a PENDING row actually runs payroll — make that explicit.
    if (!drop.stub && newStatus !== 'draft') {
      const emp = drop.emp;
      const ok = window.confirm(`This runs payroll for ${emp.firstName} ${emp.lastName} (creates the check and its tax liabilities), then marks it ${newStatus === 'printed' ? 'Printed' : 'Deposited'}. Continue?`);
      if (!ok) return;
    }
    setEmpStatusBusy(drop);
    try {
      if (drop.stub) {
        // History row — just update the status
        await api.updatePaystub(drop.stub.id, { checkStatus: newStatus });
      } else {
        // Pending row — run payroll for this one employee, then set status
        const { period, emp } = drop;
        const isSalary = emp.payType === 'salary';
        const rowData2 = getRow(period.end, emp.id);
        const rate     = parseFloat(rowData2.rate) || emp.hourlyRate || 0;
        const regH     = isSalary ? 0 : parseFloat(rowData2.regHours || 0);
        const otH      = isSalary ? 0 : parseFloat(rowData2.otHours  || 0);
        const tips2    = parseFloat(rowData2.tips || 0);
        const bonus2   = parseFloat(rowData2.bonus || 0);
        const comm2    = parseFloat(rowData2.commission || 0);
        const cashAdv2 = parseFloat(rowData2.cashAdvance || 0);
        const mile2    = parseFloat(rowData2.mileage || 0);
        const regPay   = isSalary ? effPeriodSalary(rowData2, emp, ppy) : r2(regH * rate);
        const otPay    = isSalary ? 0 : r2(otH * rate * 1.5);
        // Guard a $0 gross (e.g. a cleared/zeroed salary or no hours) — the
        // backend would silently create no check while we'd still set the status.
        if (r2(regPay + otPay + tips2 + bonus2 + comm2) <= 0) {
          alert(`Can't run payroll for ${emp.firstName} ${emp.lastName} — gross pay is $0. Enter an amount first.`);
          return;
        }
        const lineItems = [
          ...(isSalary
            ? [{ payType: 'salary', description: 'Salary', amount: regPay }]
            : [
                ...(regPay > 0 ? [{ payType: 'regular',  description: 'Regular Pay',  hours: regH, rate, amount: regPay }] : []),
                ...(otPay  > 0 ? [{ payType: 'overtime', description: 'Overtime Pay', hours: otH, rate: rate * 1.5, amount: otPay }] : []),
              ]),
          ...(tips2  > 0 ? [{ payType: 'tips',       description: 'Reported Tips', amount: tips2  }] : []),
          ...(bonus2 > 0 ? [{ payType: 'bonus',      description: 'Bonus',         amount: bonus2 }] : []),
          ...(comm2  > 0 ? [{ payType: 'commission', description: 'Commission',    amount: comm2  }] : []),
        ];
        const ytd = calcEmpYTD(emp.id, null);
        const payrollEmp = {
          employeeId: emp.id,
          lineItems,
          ytdGross:    ytd.gross,
          regularHours: isSalary ? null : regH,
          overtimeHours: isSalary ? null : otH,
          regularPay: regPay,
          overtimePay: otPay,
          bonus: bonus2, commission: comm2, reimbursement: mile2, deduction: cashAdv2, reportedTips: tips2,
          ...(csOverrideForPayload(rowData2) !== undefined ? { childSupport: csOverrideForPayload(rowData2) } : {}),
        };
        const res = await api.runPayroll({
          clientId,
          payPeriodStart: period.start,
          payPeriodEnd: period.end,
          settlementDate: period.payDate,
          payGroupId: currentGroupId,
          employees: [payrollEmp],
          // 'printed' must NEVER fire ACH (double-pay); 'deposited' keeps the
          // legacy per-employee DD behavior.
          paymentMethod: newStatus === 'printed' ? 'print' : 'auto',
        });
        const newId = res?.paystubs?.[0]?.id;
        if (newId && newStatus !== 'draft') {
          await api.updatePaystub(newId, { checkStatus: newStatus });
        }
      }
      await reloadStubs();
    } catch (e) { alert(e.message || 'Failed to update status'); }
    finally { setEmpStatusBusy(null); }
  }

  // Select-all helper — selects Late + Due Soon (within 5 days), toggles on repeat click
  function handleSelectAllDue() {
    const isDueSoon = p => !p.isLate && daysUntil(p.payDate) !== null && daysUntil(p.payDate) <= 5;
    const duePeriods = pendingPeriods.filter(p => p.isLate || isDueSoon(p));
    const lateHistIds = history.flatMap(p => p.stubs.filter(s => s.check_status === 'late').map(s => s.id));
    // Don't select hourly employees with no hours entered — running them would just
    // fail one-by-one at process time.
    const isSelectable = (period, emp) => {
      const row = getRow(period.end, emp.id);
      return emp.payType === 'salary' || parseFloat(row.regHours || 0) > 0 || parseFloat(row.otHours || 0) > 0;
    };
    // "All selected?" must only consider selectable rows — a blank-hours employee can
    // never be selected, so counting them made the toggle stick permanently on.
    const allSel = duePeriods.every(p => empsInGroup.every(e => !isSelectable(p, e) || getRow(p.end, e.id).selected))
      && lateHistIds.every(id => selectedLateStubs.has(id));
    const newPR = { ...pendingRows };
    duePeriods.forEach(period => {
      const pr = { ...(newPR[period.end] || {}) };
      empsInGroup.forEach(emp => {
        const row = getRow(period.end, emp.id);
        pr[emp.id] = { ...row, selected: !allSel && isSelectable(period, emp) };
      });
      newPR[period.end] = pr;
    });
    setPendingRows(newPR);
    setSelectedLateStubs(allSel ? new Set() : new Set(lateHistIds));
  }

  async function handleBulkStatusChange(newStatus) {
    setBulkBusy(true);
    // Collect per-item outcomes — an all-or-nothing Promise.all told the user
    // nothing about which checks actually updated.
    const results = await Promise.allSettled([...selectedHistoryStubs].map(id => api.updatePaystub(id, { checkStatus: newStatus })));
    const failed = results.filter(r => r.status === 'rejected');
    await reloadStubs();
    setSelectedHistoryStubs(new Set());
    setBulkBusy(false);
    if (failed.length > 0) {
      alert(`${results.length - failed.length} of ${results.length} checks updated. ${failed.length} failed: ${failed[0].reason?.message || 'unknown error'}\nThe list shows what actually saved.`);
    }
  }

  async function handleBulkDelete() {
    const count = selectedHistoryStubs.size;
    if (!window.confirm(`Delete ${count} check${count !== 1 ? 's' : ''}?\n\nTheir wages and tax liabilities are removed from every report. This cannot be undone.`)) return;
    setBulkBusy(true);
    let deleted = 0; const errors = [];
    for (const id of selectedHistoryStubs) {
      try { await api.deletePaystub(id); deleted++; }
      catch (e) { errors.push(e.message); }
    }
    await reloadStubs();
    setSelectedHistoryStubs(new Set());
    setBulkBusy(false);
    if (errors.length > 0) {
      alert(`Deleted ${deleted} of ${count} checks. ${errors.length} couldn't be deleted: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`);
    }
  }

  async function handleUgCalculate() {
    setUgErr('');
    const { employeeId, start, end, payDate, regHours, otHours, payType } = ugForm;
    if (!employeeId || !start || !end || !payDate) { setUgErr('All fields required.'); return; }
    const emp = activeEmps.find(e => e.id === Number(employeeId));
    if (!emp) { setUgErr('Employee not found.'); return; }
    const isSalary = payType === 'salary' || emp.payType === 'salary';
    const ugTips   = parseFloat(ugForm.tips        || 0);
    const ugBonus  = parseFloat(ugForm.bonus        || 0);
    const ugComm   = parseFloat(ugForm.commission   || 0);
    const ugCashAdv = parseFloat(ugForm.cashAdvance || 0);
    const ugMile   = parseFloat(ugForm.mileage      || 0);
    const regH     = parseFloat(regHours || 0);
    const otH      = parseFloat(otHours  || 0);
    if (!isSalary && regH === 0 && otH === 0 && ugTips === 0 && ugBonus === 0 && ugComm === 0) {
      setUgErr('Enter hours or other payroll items.'); return;
    }
    setUgRunning(true);
    try {
      const rate   = parseFloat(ugForm.rate) || emp.hourlyRate || 0;
      const regPay = isSalary ? r2((emp.annualSalary || 0) / ppy) : r2(Math.min(regH, 40) * rate);
      const otPay  = isSalary ? 0 : r2(otH * rate * 1.5);
      const gross  = r2(regPay + otPay + ugTips + ugBonus + ugComm);
      const ytd    = calcEmpYTD(emp.id, null);
      const calc   = await api.calculate({
        grossWages:    gross,
        payFrequency:  emp.payFrequency || 'monthly',
        filingStatus:  emp.filingStatus || 'single',
        step2Checkbox: emp.step2Checkbox || false,
        step3Children: emp.step3Children || 0,
        step3Other:    emp.step3Other    || 0,
        step4a:        emp.step4a        || 0,
        step4b:        emp.step4b        || 0,
        step4c:        emp.step4c        || 0,
        fitExempt:     !!emp.fitExempt,
        workState:     emp.workState     || client?.state || 'TX',
        ytdGross:      ytd.gross,
        sutaRate:      client?.suiRateQ1 || client?.suiRateQ2 || client?.suiRateQ3 || client?.suiRateQ4 || null,
      });
      setUgPreview({ emp, isSalary, regH, otH, rate, regPay, otPay, gross, ugTips, ugBonus, ugComm, ugCashAdv, ugMile, calc, ytd });
    } catch (e) {
      setUgErr(e.message || 'Failed to calculate.');
    } finally {
      setUgRunning(false);
    }
  }

  async function handleUngroupedRun(method = 'print') {
    if (!ugPreview) return;
    const { emp, isSalary, regH, otH, rate, regPay, otPay, ugTips, ugBonus, ugComm, ugCashAdv, ugMile } = ugPreview;
    const { start, end, payDate } = ugForm;
    setUgRunning(true);
    try {
      const lineItems = [
        ...(isSalary
          ? [{ payType: 'salary', description: 'Salary', amount: regPay }]
          : [
              ...(regH > 0 ? [{ payType: 'regular',  description: 'Regular',  hours: regH, rate, amount: regPay }] : []),
              ...(otH  > 0 ? [{ payType: 'overtime', description: 'Overtime', hours: otH,  rate: rate * 1.5, amount: otPay }] : []),
            ]),
        ...(ugTips  > 0 ? [{ payType: 'tips',       description: 'Reported Tips', amount: ugTips  }] : []),
        ...(ugBonus > 0 ? [{ payType: 'bonus',      description: 'Bonus',         amount: ugBonus }] : []),
        ...(ugComm  > 0 ? [{ payType: 'commission', description: 'Commission',    amount: ugComm  }] : []),
      ];
      const ytd = calcEmpYTD(emp.id, null);
      const res = await api.runPayroll({
        clientId, payPeriodStart: start, payPeriodEnd: end, settlementDate: payDate,
        employees: [{ employeeId: emp.id, lineItems, ytdGross: ytd.gross, regularHours: regH || null, overtimeHours: otH || null, regularPay: regPay, overtimePay: otPay, bonus: ugBonus, commission: ugComm, reimbursement: ugMile, deduction: ugCashAdv, reportedTips: ugTips }],
        paymentMethod: method === 'dd' ? 'dd' : 'print',
      });
      const newIds = (res?.paystubs || []).map(s => s.id);
      const isDD = method === 'dd' && emp.directDeposit?.status === 'active';
      const statusToSet = isDD ? 'direct_deposit_sent' : 'printed';
      await Promise.all(newIds.map(id => api.updatePaystubStatus(id, statusToSet).catch(() => {})));
      await reloadStubs();
      const enteredRate = parseFloat(ugForm.rate);
      setUngroupedModal(false);
      setUgPreview(null);
      setUgForm({ employeeId: '', start: '', end: '', payDate: '', regHours: '', otHours: '', rate: '', payType: 'regular', tips: '', bonus: '', commission: '', cashAdvance: '', mileage: '' });
      setUgOtherOpen(false);
      if (!isDD && newIds.length > 0) setPrintModal({ ids: newIds, mode: method === 'paystub' ? 'paystub' : 'paycheck' });
      else if (isDD) setRunSuccess(`Direct deposit initiated for ${emp.firstName} ${emp.lastName}.`);
      if (!isSalary && !isNaN(enteredRate) && enteredRate !== emp.hourlyRate) {
        setRateUpdatePrompt({ empId: emp.id, newRate: enteredRate });
      }
    } catch (e) {
      setUgErr(e.message || 'Failed to run payroll.');
    } finally {
      setUgRunning(false);
    }
  }

  const hasLateRows    = pendingPeriods.some(p => p.isLate) || history.some(p => p.stubs.some(s => s.check_status === 'late' || s.check_status === 'draft'));
  const hasDueSoonRows = pendingPeriods.some(p => !p.isLate && daysUntil(p.payDate) !== null && daysUntil(p.payDate) <= 5);

  // For draft history checks, derive the visual status from the pay date instead of showing "Draft"
  function deriveDisplayStatus(stub) {
    if (stub.check_status !== 'draft') return stub.check_status || 'draft';
    const payDate = stub.settlement_date;
    if (!payDate) return 'upcoming';
    const today = new Date().toISOString().slice(0, 10);
    if (payDate < today) return 'late';
    const days = daysUntil(payDate);
    if (days !== null && days <= 5) return 'due-soon';
    return 'upcoming';
  }

  // Check detail modal — shows full breakdown for pending or history rows, with editable dates and gross

  // Flat table renderer — clicking a row opens CheckDetailModal
  function renderTable(rows, startIdx = 0) {
    // History rows (Printed & Deposited — have stubs in DB, support delete/status)
    const selectableIds = rows
      .filter(r => r.type === 'history' && r.stub.check_status !== 'voided')
      .map(r => r.stub.id);
    const allHistSel = selectableIds.length > 0 && selectableIds.every(id => selectedHistoryStubs.has(id));
    const someHistSel = selectableIds.some(id => selectedHistoryStubs.has(id));

    // Pending rows (scheduled, not yet run — no stub in DB)
    const pendingRowsInTable = rows.filter(r => r.type === 'pending');
    const allPendSel = pendingRowsInTable.length > 0 && pendingRowsInTable.every(r => getRow(r.period.end, r.emp.id).selected);
    const somePendSel = pendingRowsInTable.some(r => getRow(r.period.end, r.emp.id).selected);

    // Combined select-all state
    const totalSelectable = selectableIds.length + pendingRowsInTable.length;
    const allSel = totalSelectable > 0
      && (selectableIds.length === 0 || allHistSel)
      && (pendingRowsInTable.length === 0 || allPendSel);
    const someSel = someHistSel || somePendSel;

    function toggleAll() {
      const shouldSelect = !allSel;
      // Toggle history rows
      setSelectedHistoryStubs(prev => {
        const next = new Set(prev);
        selectableIds.forEach(id => shouldSelect ? next.add(id) : next.delete(id));
        return next;
      });
      // Toggle pending rows (batch update to avoid stale-state issues)
      if (pendingRowsInTable.length > 0) {
        setPendingRows(prev => {
          const next = { ...prev };
          pendingRowsInTable.forEach(r => {
            next[r.period.end] = {
              ...(next[r.period.end] || {}),
              [r.emp.id]: { ...((next[r.period.end] || {})[r.emp.id] || {}), selected: shouldSelect },
            };
          });
          return next;
        });
      }
    }

    // Column totals for the rendered rows (voided checks excluded)
    const totals = { reg: 0, ot: 0, net: 0 };
    const selTotals = { reg: 0, ot: 0, net: 0, count: 0 };
    rows.forEach(r => {
      let regH = 0, otH = 0, net = 0, sel = false;
      if (r.type === 'pending') {
        const est = pendingRowEst(r.period.end, r.emp);
        regH = est.regH || 0;
        otH  = est.otH  || 0;
        net  = est.grossPreview > 0 && !isNaN(est.estNetPay) ? est.estNetPay : 0;
        sel  = !!est.row.selected;
      } else {
        const s = r.stub;
        if (s.check_status === 'voided') return;
        regH = s.regular_hours || 0;
        otH  = s.overtime_hours || 0;
        net  = s.net_pay != null ? s.net_pay : r2(
          (s.gross_wages || 0) - (s.fit_withholding || 0) - (s.employee_ss || 0) - (s.employee_medicare || 0)
          - (s.additional_medicare || 0) - (s.state_income_tax || 0) - (s.deduction || 0) - (s.garnishment || 0)
          + (s.reimbursement || 0));
        sel  = selectedHistoryStubs.has(s.id) || selectedLateStubs.has(s.id);
      }
      totals.reg += regH; totals.ot += otH; totals.net += net;
      if (sel) { selTotals.reg += regH; selTotals.ot += otH; selTotals.net += net; selTotals.count++; }
    });
    const footCell = { padding: '10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 13 };

    return (
      /* min-width stops the fixed columns collapsing into each other on phones —
         the grid scrolls sideways inside .table-scroll instead of overlapping text */
      <div className="table-scroll">
      {/* fixed cols total 730px — keep ≥160px for the employee-name column */}
      <table style={{ width: '100%', minWidth: 960, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 15 }}>
        <colgroup>
          <col style={{ width: 40 }} />
          <col />
          <col style={{ width: 70 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 62 }} />
          <col style={{ width: 62 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 110 }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: '2px solid #d0d7de', background: '#f6f8fa' }}>
            <th style={{ padding: '11px 0 11px 14px' }}>
              {totalSelectable > 0 && (
                <input type="checkbox" checked={allSel} ref={el => { if (el) el.indeterminate = someSel && !allSel; }}
                  onChange={toggleAll}
                  style={{ accentColor: 'var(--accent)', width: 16, height: 16, cursor: 'pointer' }} />
              )}
            </th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Employee</th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Check #</th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Period Start</th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Period End</th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pay Date</th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Reg Hrs</th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>OT Hrs</th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rate</th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Net Pay</th>
            <th style={{ padding: '11px 10px', fontWeight: 700, fontSize: 12, color: '#5a6a7e', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((rowData, idx) => {
            const stripeBg = (startIdx + idx) % 2 === 0 ? 'var(--bg-primary, #fff)' : '#f8fafc';

            if (rowData.type === 'pending') {
              const { period: rawPeriod, emp } = rowData;
              // Apply any saved date overrides from the detail modal
              const ov = periodOverrides[rawPeriod.end] || {};
              const period = { ...rawPeriod, start: ov.start || rawPeriod.start, end: ov.end || rawPeriod.end, payDate: ov.payDate || rawPeriod.payDate };
              const isSalary = emp.payType === 'salary';
              // Respects the manual overrides the detail modal writes to the row, so
              // this inline net pay equals the modal's "Net Pay (est.)" instead of
              // ignoring an edited FIT/SS/Medicare/state value.
              const { row, grossPreview, estNetPay } = pendingRowEst(rawPeriod.end, emp);
              const daysToPayDate = daysUntil(period.payDate);
              const isLate   = period.payDate < new Date().toISOString().slice(0, 10);
              const status   = isLate ? 'late' : (daysToPayDate !== null && daysToPayDate <= 5 ? 'due-soon' : 'upcoming');
              const selBg    = isLate ? '#fff5f5' : status === 'due-soon' ? '#fffbeb' : 'var(--accent-light)';
              const rowBg    = row.selected ? selBg : stripeBg;
              return (
                <React.Fragment key={rowData.key}>
                <tr
                  style={{ background: rowBg, borderBottom: '1px solid #e1e7ed', cursor: 'pointer' }}
                  onClick={e => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') setDetailModal(rowData); }}
                >
                  <td style={{ padding: '0 0 0 14px' }}>
                    <input type="checkbox" checked={row.selected}
                      style={{ accentColor: 'var(--accent)', width: 16, height: 16, cursor: 'pointer' }}
                      onChange={ev => setRow(rawPeriod.end, emp.id, 'selected', ev.target.checked)} />
                  </td>
                  <td style={{ padding: '7px 8px', fontWeight: 600 }}>
                    <button onClick={e => { e.stopPropagation(); setDrawerEmpId(emp.id); }}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: 15, color: 'var(--accent)', textDecoration: 'underline' }}>
                      {emp.firstName} {emp.lastName}
                    </button>
                  </td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--text-muted)' }}>—</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, color: ov.start ? 'var(--accent)' : '#222' }}>{fmtDate(period.start)}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, color: ov.end ? 'var(--accent)' : '#222' }}>{fmtDate(period.end)}</td>
                  <td style={{ padding: '12px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, color: isLate ? '#dc2626' : ov.payDate ? 'var(--accent)' : '#222' }}>{fmtDate(period.payDate)}</td>
                  {isSalary ? (
                    <>
                      <td colSpan={3} style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 11 }}>salary</td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '4px 6px' }}>
                        <input className="form-input mono" type="text" inputMode="decimal" value={row.regHours} placeholder="0"
                          onChange={ev => setRow(rawPeriod.end, emp.id, 'regHours', cleanDecimal(ev.target.value))}
                          onFocus={ev => ev.target.select()}
                          style={{ width: '100%', height: 46, fontSize: 16, textAlign: 'right', padding: '0 8px', borderRadius: 0, border: `2px solid ${row.regHours && isNaN(parseFloat(row.regHours)) ? 'var(--error)' : '#b0bec5'}`, fontWeight: 700, background: '#fff', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.08)' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input className="form-input mono" type="text" inputMode="decimal" value={row.otHours} placeholder="0"
                          onChange={ev => setRow(rawPeriod.end, emp.id, 'otHours', cleanDecimal(ev.target.value))}
                          onFocus={ev => ev.target.select()}
                          style={{ width: '100%', height: 46, fontSize: 16, textAlign: 'right', padding: '0 8px', borderRadius: 0, border: `2px solid ${row.otHours && isNaN(parseFloat(row.otHours)) ? 'var(--error)' : '#b0bec5'}`, fontWeight: 700, background: '#fff', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.08)' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input className="form-input mono" type="text" inputMode="decimal"
                          value={row.rate !== undefined ? row.rate : String(emp.hourlyRate || '')}
                          placeholder={String(emp.hourlyRate || '')}
                          onChange={ev => setRow(rawPeriod.end, emp.id, 'rate', cleanDecimal(ev.target.value))}
                          onFocus={ev => ev.target.select()}
                          onBlur={ev => {
                            const entered = parseFloat(ev.target.value);
                            if (!isNaN(entered) && entered !== emp.hourlyRate) {
                              const next = ev.relatedTarget;
                              const isMovingToInput = next && (next.tagName === 'INPUT' || next.tagName === 'SELECT');
                              if (!isMovingToInput) {
                                setRateUpdatePrompt({ empId: emp.id, newRate: entered, periodEnd: rawPeriod.end });
                              }
                            }
                          }}
                          style={{ width: '100%', height: 46, fontSize: 16, textAlign: 'right', padding: '0 8px', borderRadius: 0, border: `2px solid ${row.rate !== undefined && String(row.rate).trim() !== '' && isNaN(parseFloat(row.rate)) ? 'var(--error)' : '#b0bec5'}`, fontWeight: 700, background: '#fff', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.08)' }} />
                      </td>
                    </>
                  )}
                  <td title="Estimated — final net pay is computed when payroll runs"
                    style={{ padding: '12px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: grossPreview > 0 ? 'var(--success, #16a34a)' : '#aaa', fontSize: 15 }}>
                    {grossPreview > 0 ? <>{fmt(estNetPay)}<span style={{ fontSize: 10, fontWeight: 500, color: '#9ca3af', marginLeft: 3 }}>est.</span></> : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    {empStatusBusy && !empStatusBusy.stub && empStatusBusy.period?.end === period.end && empStatusBusy.emp?.id === emp.id ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
                        <span className="spinner spinner-dark" style={{ width: 12, height: 12 }} /> Creating check…
                      </span>
                    ) : (
                    <button type="button" title="Click to change status"
                      aria-label={`Change status for ${emp.firstName} ${emp.lastName}`}
                      aria-expanded={!!(empStatusDrop?.period?.end === period.end && empStatusDrop?.emp?.id === emp.id)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const openUp = r.bottom + 200 > window.innerHeight; setEmpStatusDrop(empStatusDrop?.period?.end === period.end && empStatusDrop?.emp?.id === emp.id ? null : { period, emp, ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }), right: window.innerWidth - r.right }); }}>
                      <StatusBadge status={status} />
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>▾</span>
                    </button>
                    )}
                  </td>
                </tr>
                </React.Fragment>
              );
            }

            // History row
            const { stub } = rowData;
            const isLateCheck    = stub.check_status === 'late';
            const isDraftCheck   = stub.check_status === 'draft';
            const isVoided       = stub.check_status === 'voided';
            const displayStatus  = deriveDisplayStatus(stub);
            const rowBg          = (isLateCheck || (isDraftCheck && displayStatus === 'late')) ? '#fff5f5'
                                 : displayStatus === 'due-soon' ? '#fffbeb'
                                 : stripeBg;
            const canEditPeriod  = !isVoided;
            const isEditingPeriod = periodEdit?.id === stub.id;
            return (
              <tr key={rowData.key}
                data-tour-id={startIdx > 0 && idx === 0 ? 'tour-first-check' : undefined}
                style={{ background: rowBg, opacity: isVoided ? 0.5 : 1, borderBottom: '1px solid #e1e7ed', cursor: 'pointer' }}
                onClick={e => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') setDetailModal(rowData); }}
              >
                <td style={{ padding: '0 0 0 14px' }}>
                  {!isVoided && (
                    <input type="checkbox"
                      checked={selectedHistoryStubs.has(stub.id)}
                      onChange={e => { e.stopPropagation(); setSelectedHistoryStubs(prev => { const next = new Set(prev); next.has(stub.id) ? next.delete(stub.id) : next.add(stub.id); return next; }); }}
                      style={{ accentColor: 'var(--accent)', width: 16, height: 16, cursor: 'pointer' }} />
                  )}
                </td>
                <td style={{ padding: '7px 8px' }}>
                  {stub.employee_id ? (
                    <button onClick={e => { e.stopPropagation(); setDrawerEmpId(stub.employee_id); }}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: 15, color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: isVoided ? 'line-through' : 'underline' }}>
                      {stub.employee_name}
                    </button>
                  ) : (
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#111', textDecoration: isVoided ? 'line-through' : 'none' }}>{stub.employee_name}</span>
                  )}
                </td>
                <td style={{ padding: '14px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: stub.check_number ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {stub.check_number ? `#${stub.check_number}` : '—'}
                </td>
                {isEditingPeriod ? (
                  <td colSpan={3} style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="date" value={periodEdit.start}
                        onChange={e => setPeriodEdit(p => ({ ...p, start: e.target.value }))}
                        style={{ height: 36, fontSize: 13, border: '1px solid var(--border)', borderRadius: 0, padding: '0 4px' }} />
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>–</span>
                      <input type="date" value={periodEdit.end}
                        onChange={e => { const end = e.target.value; setPeriodEdit(p => ({ ...p, end, payDate: end ? calcDefaultPayDate(end) : p.payDate })); }}
                        style={{ height: 36, fontSize: 13, border: '1px solid var(--border)', borderRadius: 0, padding: '0 4px' }} />
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Pay:</span>
                      <input type="date" value={periodEdit.payDate}
                        onChange={e => setPeriodEdit(p => ({ ...p, payDate: e.target.value }))}
                        style={{ height: 36, fontSize: 13, border: '1px solid var(--border)', borderRadius: 0, padding: '0 4px' }} />
                      <button className="btn btn-primary btn-sm" style={{ fontSize: 10, padding: '0 8px', height: 26 }}
                        onClick={() => handleSavePeriod(stub.id)}
                        disabled={savingPeriod || !!(periodEdit.start && periodEdit.end && periodEdit.end < periodEdit.start)}>
                        {savingPeriod ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Save'}
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '0 6px', height: 26 }}
                        onClick={() => setPeriodEdit(null)}>×</button>
                      {periodDateWarning(periodEdit.start, periodEdit.end, periodEdit.payDate) && (
                        <span style={{ color: 'var(--error)', fontSize: 11, fontWeight: 600, width: '100%' }}>
                          {periodDateWarning(periodEdit.start, periodEdit.end, periodEdit.payDate)}
                        </span>
                      )}
                    </div>
                  </td>
                ) : (
                  <>
                    <td style={{ padding: '14px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, color: '#222' }}>
                      {fmtDate(stub.pay_period_start)}
                    </td>
                    <td style={{ padding: '14px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, color: '#222' }}>{fmtDate(stub.pay_period_end)}</td>
                    <td style={{ padding: '14px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, color: displayStatus === 'late' ? '#dc2626' : '#222' }}>
                      {fmtDate(stub.settlement_date)}
                      {canEditPeriod && (
                        <button type="button" aria-label="Edit pay period" title="Edit pay period"
                          onClick={e => { e.stopPropagation(); setPeriodEdit({ id: stub.id, start: stub.pay_period_start || '', end: stub.pay_period_end || '', payDate: stub.settlement_date || '' }); }}
                          style={{ background: 'none', border: 'none', padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', marginLeft: 2 }}>✎</button>
                      )}
                    </td>
                  </>
                )}
                <td style={{ padding: '14px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#111', fontSize: 14 }}>{stub.regular_hours != null ? stub.regular_hours : '—'}</td>
                <td style={{ padding: '14px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#111', fontSize: 14 }}>{stub.overtime_hours > 0 ? stub.overtime_hours : '—'}</td>
                <td style={{ padding: '14px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#111', fontSize: 14 }}>{
                  (() => {
                    const regItem = (stub.lineItems || []).find(li => li.pay_type === 'regular');
                    return regItem?.rate != null ? `$${Number(regItem.rate).toFixed(2)}` : '—';
                  })()
                }</td>
                <td style={{ padding: '14px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#16a34a', fontSize: 16 }}>
                  {/* Authoritative net pay computed and stored by the backend — the
                      same value the detail modal shows after save, so the two agree. */}
                  {stub.net_pay != null ? fmt(r2(stub.net_pay))
                    : (stub.gross_wages != null ? fmt(r2(
                        (stub.gross_wages        || 0)
                        - (stub.fit_withholding   || 0)
                        - (stub.employee_ss       || 0)
                        - (stub.employee_medicare || 0)
                        - (stub.additional_medicare || 0)
                        - (stub.state_income_tax  || 0)
                        - (stub.deduction         || 0)
                        - (stub.garnishment       || 0)
                        + (stub.reimbursement     || 0)
                      )) : '—')}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {empStatusBusy?.stub?.id === stub.id ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
                        <span className="spinner spinner-dark" style={{ width: 12, height: 12 }} /> Updating…
                      </span>
                    ) : !isVoided ? (
                      <button type="button" title="Click to change status"
                        aria-label={`Change status for ${stub.employee_name}`}
                        aria-expanded={!!(empStatusDrop?.stub?.id === stub.id)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const openUp = r.bottom + 200 > window.innerHeight; setEmpStatusDrop(empStatusDrop?.stub?.id === stub.id ? null : { stub, ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }), right: window.innerWidth - r.right }); }}>
                        <StatusBadge status={displayStatus} />
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>▾</span>
                      </button>
                    ) : (
                      <StatusBadge status={displayStatus} />
                    )}
                    {!isVoided && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '5px 10px', height: 'auto', lineHeight: 1.4 }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--error)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                        aria-label={`Delete check #${stub.check_number || stub.id} for ${stub.employee_name}`}
                        onClick={e => { e.stopPropagation(); if (window.confirm(deleteCheckConfirm({ name: stub.employee_name, amount: fmt(r2(stub.net_pay || 0)), checkNumber: stub.check_number }))) { api.deletePaystub(stub.id).then(reloadStubs).catch(er => alert(er.message)); } }}
                        title="Delete check and reverse tax liabilities"
                      >Delete</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)' }}>
            <td colSpan={6} style={{ ...footCell, fontFamily: 'inherit', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total</td>
            <td style={footCell}>{r2(totals.reg)}</td>
            <td style={footCell}>{r2(totals.ot)}</td>
            <td />
            <td style={footCell}>{fmt(r2(totals.net))}</td>
            <td />
          </tr>
          {selTotals.count > 0 && (
            <tr>
              <td colSpan={6} style={{ ...footCell, paddingTop: 0, fontFamily: 'inherit', fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Selected ({selTotals.count})</td>
              <td style={{ ...footCell, paddingTop: 0, color: 'var(--accent)' }}>{r2(selTotals.reg)}</td>
              <td style={{ ...footCell, paddingTop: 0, color: 'var(--accent)' }}>{r2(selTotals.ot)}</td>
              <td />
              <td style={{ ...footCell, paddingTop: 0, color: 'var(--accent)' }}>{fmt(r2(selTotals.net))}</td>
              <td />
            </tr>
          )}
        </tfoot>
      </table>
      </div>
    );
  }

  return (
    <div>
      {/* Tab strip */}
      {(tabs.length > 0 || archivedGroups.length > 0) && (
        <div className="pay-subtabs" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {tabs.map(g => (
            <button key={g.id} className={`pay-subtab${currentGroupId === g.id ? ' active' : ''}`}
              onClick={() => { setCurrentGroupId(g.id); setRunErr(''); setRunSuccess(''); setSelectedLateStubs(new Set()); setSelectedHistoryStubs(new Set()); }}>
              {g.name}
              {g.id !== UNASSIGNED_ID && (
                <span style={{ opacity: 0.6, fontSize: 11, marginLeft: 4 }}>
                  ({activeEmps.filter(e => e.payGroupId === g.id).length})
                </span>
              )}
            </button>
          ))}

          {/* Archived groups — compact, non-intrusive dropdown at the end */}
          {archivedGroups.length > 0 && (
            <div style={{ position: 'relative', marginLeft: 'auto' }}>
              <button
                onClick={() => setArchiveMenuOpen(o => !o)}
                title="Archived pay groups — check history preserved, group non-functional"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: isGroupDeleted ? 'var(--accent-light)' : 'transparent',
                  border: `1px solid ${isGroupDeleted ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 7, padding: '5px 10px', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, color: isGroupDeleted ? 'var(--accent)' : 'var(--text-muted)',
                }}>
                🗄 Archived <span style={{ opacity: 0.7 }}>({archivedGroups.length})</span>
                <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
              </button>
              {archiveMenuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setArchiveMenuOpen(false)} />
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 5, background: 'var(--bg-primary, #fff)', border: '1px solid var(--border)', borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', zIndex: 50, minWidth: 220, padding: 5 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 10px 6px' }}>Archived Groups</div>
                    {archivedGroups.map(g => (
                      <button key={g.id}
                        onClick={() => { setCurrentGroupId(g.id); setArchiveMenuOpen(false); setRunErr(''); setRunSuccess(''); setSelectedLateStubs(new Set()); setSelectedHistoryStubs(new Set()); }}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', background: currentGroupId === g.id ? 'var(--accent-light)' : 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        <span>{g.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{FREQ_LABEL[g.frequency] || g.frequency}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Group header + action bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {currentGroup && currentGroup.id !== UNASSIGNED_ID && (
          <>
            <span style={{ fontWeight: 700, fontSize: 14, fontStyle: isGroupDeleted ? 'italic' : 'normal', opacity: isGroupDeleted ? 0.6 : 1 }}>{currentGroup.name}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{FREQ_LABEL[currentGroup.frequency] || currentGroup.frequency}</span>
            {!isGroupDeleted && <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setEditGroup(currentGroup)}>Edit Group</button>}
            {isGroupDeleted && <span className="badge badge-warning" style={{ fontSize: 10 }}>Archived</span>}
            <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          </>
        )}
        {!isGroupDeleted && (hasLateRows || hasDueSoonRows) && (
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={handleSelectAllDue}>Select All Due</button>
        )}
        <div style={{ flex: 1 }} />
        {!isGroupDeleted && (
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setShowPaycheckImport(true)}>
            ↑ Import from QB
          </button>
        )}
        {!isGroupDeleted && (
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setUngroupedModal(true)}>
            + Ungrouped Check
          </button>
        )}
        {!isGroupDeleted && empsInGroup.length > 0 && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleRunPayroll('print')}
              disabled={running || totalActionCount === 0}
              title="Process payroll and download paychecks"
            >
              {running ? <span className="spinner" /> : `🖨 Print Paycheck${totalActionCount > 0 ? ` (${totalActionCount})` : ''}`}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleRunPayroll('paystub')}
              disabled={running || totalActionCount === 0}
              title="Process payroll and download pay stubs"
            >
              {running ? <span className="spinner" /> : `📄 Print Paystub${totalActionCount > 0 ? ` (${totalActionCount})` : ''}`}
            </button>
            <button
              className={running || totalActionCount === 0 ? 'btn btn-secondary' : 'btn btn-primary'}
              onClick={() => handleRunPayroll('dd')}
              disabled={running || totalActionCount === 0}
              title="Process payroll and send via direct deposit"
            >
              {running ? <span className="spinner" /> : `⚡ Direct Deposit${totalActionCount > 0 ? ` (${totalActionCount})` : ''}`}
            </button>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {(selectedHistoryStubs.size > 0 || totalActionCount > 0) && (() => {
        const btn = { background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 5, color: '#fff', padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 };
        const totalSel = selectedHistoryStubs.size + totalActionCount;

        // Collect pending rows currently selected
        const selectedPendingData = pendingPeriods.flatMap(period =>
          empsInGroup.filter(emp => getRow(period.end, emp.id).selected).map(emp => ({
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            periodStart: period.start,
            periodEnd: period.end,
            settlementDate: period.payDate,
            payFrequency: currentGroup?.frequency || 'biweekly',
          }))
        );

        const selEstNet = r2(
          pendingPeriods.reduce((sum, period) => sum + empsInGroup.reduce((s2, emp) => {
            const est = pendingRowEst(period.end, emp);
            return est.row.selected && est.grossPreview > 0 && !isNaN(est.estNetPay) ? s2 + est.estNetPay : s2;
          }, 0), 0)
          + [...new Set([...selectedHistoryStubs, ...selectedLateStubs])].reduce((sum, id) => {
            const stub = history.flatMap(p => p.stubs).find(s => s.id === id);
            return stub ? sum + (stub.net_pay || 0) : sum;
          }, 0)
        );

        async function handlePendingStatus(newStatus) {
          if (selectedPendingData.length === 0) return;
          // Only "voided" is allowed for pending rows — any other status (Printed, Deposited)
          // requires actual payroll to be run first. Calling mark-pending with those statuses
          // creates $0 paystub records which is the root cause of the "everything went to $0" bug.
          if (newStatus !== 'voided') {
            const label = newStatus === 'printed' ? 'Printed' : newStatus === 'direct_deposit_cleared' ? 'Deposited' : newStatus;
            alert(`Cannot mark pending checks as "${label}".\n\nPending periods have no payroll data yet. Run payroll for these periods first using the Print Paycheck / Direct Deposit buttons above the table, then change the status of the created checks.`);
            return;
          }
          setBulkBusy(true);
          try {
            await api.markPendingPeriods({ clientId, groupId: currentGroupId, periods: selectedPendingData, status: 'voided' });
            await reloadStubs();
            setSelectedLateStubs(new Set());
            setPendingRows(prev => {
              const next = {};
              for (const [end, empMap] of Object.entries(prev)) {
                next[end] = {};
                for (const [empId, row] of Object.entries(empMap)) next[end][empId] = { ...row, selected: false };
              }
              return next;
            });
          } catch (e) { alert(e.message); }
          finally { setBulkBusy(false); }
        }

        function clearAll() {
          setSelectedHistoryStubs(new Set());
          setSelectedLateStubs(new Set());
          setPendingRows(prev => {
            const next = {};
            for (const [end, empMap] of Object.entries(prev)) {
              next[end] = {};
              for (const [empId, row] of Object.entries(empMap)) next[end][empId] = { ...row, selected: false };
            }
            return next;
          });
        }

        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#15803d', color: '#fff', padding: '9px 16px', borderRadius: 10, marginBottom: 12, flexWrap: 'wrap', boxShadow: '0 2px 12px rgba(21,128,61,0.25)' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>✓ {totalSel} check{totalSel !== 1 ? 's' : ''} selected · est. net {fmt(selEstNet)}</span>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.3)' }} />

            {/* Download PDFs — history checks only */}
            {selectedHistoryStubs.size > 0 && <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <button disabled={bulkBusy} onClick={async () => { setBulkBusy(true); try { await api.printSelectedChecks(clientId, [...selectedHistoryStubs], localStorage.getItem('checkDesign') || 'classic'); } catch (e) { alert(e.message); } finally { setBulkBusy(false); } }} style={{ ...btn, borderRadius: '6px 0 0 6px', borderRight: 'none' }}>↓ Paycheck PDF</button>
                <select
                  defaultValue={localStorage.getItem('checkDesign') || 'classic'}
                  onChange={e => localStorage.setItem('checkDesign', e.target.value)}
                  style={{ fontSize: 11, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '4px 6px', cursor: 'pointer', height: 28 }}>
                  <option value="classic" style={{ color: '#000' }}>Classic</option>
                  <option value="micr" style={{ color: '#000' }}>MICR (Check Printer)</option>
                  <option value="top" style={{ color: '#000' }}>Top Check</option>
                </select>
              </div>
              <button disabled={bulkBusy} onClick={async () => { setBulkBusy(true); try { await api.printSelectedPaystubs(clientId, [...selectedHistoryStubs]); } catch (e) { alert(e.message); } finally { setBulkBusy(false); } }} style={btn}>↓ Paystub PDF</button>
              <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.3)' }} />
            </>}

            {/* Status change — works for both pending and history */}
            <span style={{ fontSize: 12, opacity: 0.85 }}>Status:</span>
            {[
              { value: 'printed',                label: 'Printed' },
              { value: 'direct_deposit_cleared', label: 'Deposited' },
              { value: 'draft',                  label: 'Upcoming' },
            ].map(({ value, label }) => (
              <button key={value} disabled={bulkBusy} onClick={async () => {
                setBulkBusy(true);
                try {
                  // Update history checks inline (without handleBulkStatusChange which double-manages bulkBusy)
                  if (selectedHistoryStubs.size > 0) {
                    const ids = [...selectedHistoryStubs];
                    const results = await Promise.allSettled(ids.map(id => api.updatePaystub(id, { checkStatus: value })));
                    const failedIds = ids.filter((id, i) => results[i].status === 'rejected');
                    setSelectedHistoryStubs(new Set(failedIds));
                    if (failedIds.length > 0) {
                      const firstErr = results.find(r => r.status === 'rejected')?.reason?.message || 'unknown error';
                      alert(`${ids.length - failedIds.length} of ${ids.length} checks updated. ${failedIds.length} failed: ${firstErr}\nThe failed checks stay selected.`);
                    }
                  }
                  // Mark pending periods with the chosen status
                  if (selectedPendingData.length > 0) await handlePendingStatus(value);
                  await reloadStubs();
                } catch (e) { alert(e.message || 'Failed'); }
                finally { setBulkBusy(false); }
              }} style={btn}>{label}</button>
            ))}
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.3)' }} />

            {/* Delete */}
            <button disabled={bulkBusy} onClick={async () => {
              const histIds = [...selectedHistoryStubs];
              const allStubs = history.flatMap(p => p.stubs);
              const histNet = r2(histIds.reduce((sum, id) => sum + (allStubs.find(s => s.id === id)?.net_pay || 0), 0));
              const pendCount = selectedPendingData.length;
              const parts = [];
              if (histIds.length > 0) parts.push(`Delete ${histIds.length} issued check${histIds.length !== 1 ? 's' : ''} (total net ${fmt(histNet)})? Their wages and tax liabilities are removed from every report.`);
              if (pendCount > 0) parts.push(`${pendCount} pending period${pendCount !== 1 ? 's' : ''} will be voided instead.`);
              parts.push('This cannot be undone.');
              if (!window.confirm(parts.join(' '))) return;
              setBulkBusy(true);
              try {
                // Delete history checks inline
                if (histIds.length > 0) {
                  const results = await Promise.allSettled(histIds.map(id => api.deletePaystub(id)));
                  const failedIds = histIds.filter((id, i) => results[i].status === 'rejected');
                  setSelectedHistoryStubs(new Set(failedIds));
                  if (failedIds.length > 0) alert(`Deleted ${histIds.length - failedIds.length} of ${histIds.length} checks — ${failedIds.length} failed.`);
                }
                // Void pending periods so they disappear from the schedule
                if (selectedPendingData.length > 0) await handlePendingStatus('voided');
                await reloadStubs();
              } catch (e) { alert(e.message); }
              finally { setBulkBusy(false); }
            }} style={{ background: '#dc2626', border: 'none', borderRadius: 5, color: '#fff', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>
              {bulkBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '🗑 Delete'}
            </button>

            <button onClick={clearAll} style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 5, color: '#fff', padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>✕ Cancel</button>
          </div>
        );
      })()}

      {isGroupDeleted && (
        <div className="alert alert-warning" style={{ marginBottom: 12, fontSize: 12 }}>
          <span>🗄</span> This pay group is archived — it's non-functional, but its check history is kept below for reference.
        </div>
      )}
      {runErr     && <div className="alert alert-error"   style={{ marginBottom: 10 }}><span>⚠</span>{runErr}<button onClick={() => setRunErr('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button></div>}
      {runSuccess && <div className="alert alert-success" style={{ marginBottom: 10 }}><span>✓</span>{runSuccess}<button onClick={() => setRunSuccess('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button></div>}

      {stubsError && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          <span>⚠</span> Couldn&apos;t load paychecks —
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={reloadStubs}>Retry</button>
        </div>
      )}
      {!stubsLoaded && !stubsError && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '18px 20px', marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span className="spinner spinner-dark" style={{ width: 14, height: 14 }} /> Loading paychecks…
        </div>
      )}

      {stubsLoaded && (() => {
        // Only count skips whose period would actually generate a row right now —
        // keys for periods since paid/voided are stale and restoring them is a no-op.
        const currentEnds = new Set(pendingPeriods.map(p => p.end));
        const skippedForGroup = [...skippedPending].filter(k => {
          const cut = k.lastIndexOf('_');
          const empId = Number(k.slice(cut + 1));
          return currentEnds.has(k.slice(0, cut)) && empsInGroup.some(e => e.id === empId);
        });
        if (skippedForGroup.length === 0) return null;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            <span>Removed from this run: {skippedForGroup.length}</span>
            <span>·</span>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}
              onClick={() => setSkippedPending(prev => { const next = new Set(prev); skippedForGroup.forEach(k => next.delete(k)); return next; })}>
              Restore
            </button>
          </div>
        );
      })()}

      {/* Main table: pending + late checks */}
      {stubsLoaded && mainRows.length > 0 && (
        <div className="card" data-tour-id="tour-pending-section" style={{ padding: 0, overflow: 'visible', marginBottom: 12 }}>
          <div style={{ overflowX: 'auto' }}>
            {renderTable(mainRows, 0)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {stubsLoaded && !stubsError && mainRows.length === 0 && printedRows.length === 0 && (
        <div className="card">
          <div className="empty-state" style={{ padding: '32px 20px' }}>
            {employees.length === 0 ? (
              <>
                <div className="empty-state-icon">👤</div>
                <h3>Add employees first</h3>
                <p>Payroll needs at least one employee. Add your team on the Employees tab.</p>
                {onGoToEmployees && <button className="btn btn-primary" onClick={onGoToEmployees}>Go to Employees</button>}
              </>
            ) : activeGroups.length === 0 ? (
              <>
                <div className="empty-state-icon">📋</div>
                <h3>Create a pay group</h3>
                <p>Pay groups set the pay schedule. Create one from an employee&apos;s profile (Pay Group field).</p>
                {onGoToEmployees && <button className="btn btn-primary" onClick={onGoToEmployees}>Go to Employees</button>}
              </>
            ) : (
              <>
                <div className="empty-state-icon">📋</div>
                <h3>No payroll history</h3>
                <p>Set up this pay group with a first period end date to get started.</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Collapsible: Printed & Deposited Checks */}
      {stubsLoaded && printedRows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            data-tour-id="tour-printed-toggle"
            onClick={() => setShowPrinted(p => !p)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}
          >
            <span style={{ fontSize: 11, transition: 'transform 0.15s', display: 'inline-block', transform: showPrinted ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            Printed &amp; Deposited Checks ({printedRows.length})
          </button>
          {showPrinted && (
            <div className="card" data-tour-id="tour-printed-section" style={{ padding: 0, overflow: 'visible', marginTop: 6 }}>
              <div style={{ overflowX: 'auto' }}>
                {renderTable(printedRows, mainRows.length)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Check detail modal */}
      {detailModal && <CheckDetailModal rowData={detailModal} onClose={() => { reloadStubs(); setDetailModal(null); }}
        reloadStubs={reloadStubs} clientId={clientId} client={client} calcEmpYTD={calcEmpYTD} ppy={ppy}
        pendingRows={pendingRows} setPendingRows={setPendingRows} getRow={getRow} skipPending={skipPending}
        periodOverrides={periodOverrides} setPeriodOverrides={setPeriodOverrides} csDefaults={csTotals} employees={employees} />}

      {/* Rate change confirmation */}
      {rateUpdatePrompt && (
        <ModalOverlay onClose={() => setRateUpdatePrompt(null)}>
          <div className="card" style={{ width: 380, padding: 28, borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Rate Changed to ${(rateUpdatePrompt.newRate || 0).toFixed(2)}/hr</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
              Would you like this rate to be changed for all future checks for this employee?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setRateUpdatePrompt(null)}>
                No, just one time change
              </button>
              <button className="btn btn-primary" onClick={async () => {
                const { empId, newRate } = rateUpdatePrompt;
                setRateUpdatePrompt(null);
                const emp = activeEmps.find(e => e.id === empId);
                if (!emp) return;
                try {
                  await api.updateEmployee(empId, { ...emp, hourlyRate: newRate });
                  if (onRefresh) await onRefresh();
                } catch (e) {
                  console.error('Failed to update employee rate:', e);
                }
              }}>
                Yes
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Employee status dropdown — fixed so it's never clipped by overflow:hidden */}
      {empStatusDrop && (
        <div onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: empStatusDrop.top, bottom: empStatusDrop.bottom, right: empStatusDrop.right, zIndex: 9999, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', minWidth: 230, padding: '4px 0' }}>
          {[
            { value: 'draft',                  label: 'Upcoming / Due Soon / Late', badge: 'upcoming'              },
            { value: 'printed',                label: 'Printed',                    badge: 'printed'               },
            { value: 'direct_deposit_cleared', label: 'Deposited',                  badge: 'direct_deposit_cleared' },
          ].map(({ value, label, badge }) => {
            const curStatus = empStatusDrop.stub?.check_status ?? (empStatusDrop.period ? 'draft' : 'draft');
            const isCur = curStatus === value;
            // A pending row has no check yet — choosing a status RUNS payroll first. Say so.
            const isPendingRun = !empStatusDrop.stub && value !== 'draft';
            return (
              <button key={value} disabled={!!empStatusBusy} onClick={() => handleEmpStatusChange(empStatusDrop, value)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', background: isCur ? 'var(--accent-light)' : 'none', border: 'none', cursor: empStatusBusy ? 'wait' : 'pointer', textAlign: 'left', opacity: empStatusBusy ? 0.6 : 1 }}>
                <StatusBadge status={badge} />
                <span style={{ fontSize: 12, fontWeight: isCur ? 700 : 400 }}>{isPendingRun ? `Run payroll & mark ${label}` : label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Employee edit drawer */}
      {drawerEmpId && (
        <EmployeeDrawer clientId={clientId} empId={drawerEmpId}
          onClose={() => { setDrawerEmpId(null); setCsRefetch(t => t + 1); }}
          onSaved={() => { setDrawerEmpId(null); setCsRefetch(t => t + 1); onRefresh?.(); }}
          onDeleted={() => { setDrawerEmpId(null); setCsRefetch(t => t + 1); onRefresh?.(); }} />
      )}

      {/* Pay Group Editor */}
      {editGroup && editGroup.id !== UNASSIGNED_ID && (() => {
        // Mirror the backend rule: a group has "history worth keeping" if any
        // non-draft check is linked to it directly or via one of its employees.
        // Use ALL employees (incl. inactive/terminated) — the backend counts them
        // too, so the confirm message can't contradict the actual outcome.
        const grpEmpIds = new Set(employees.filter(e => e.payGroupId === editGroup.id).map(e => e.id));
        const editGroupHasChecks = paystubs.some(s =>
          s.check_status !== 'draft' && (s.pay_group_id === editGroup.id || grpEmpIds.has(s.employee_id)));
        return (
        <PayGroupEditorModal group={editGroup} clientId={clientId} allGroups={payGroups} hasIssuedChecks={editGroupHasChecks}
          onSaved={() => { setEditGroup(null); api.getPayGroups(clientId).then(setPayGroups); }}
          onClose={() => setEditGroup(null)}
          onMoved={() => { onRefresh?.(); }}
          onDeleted={() => {
            const deletedId = editGroup.id;
            // The deleted group's employees are about to become unassigned, so a
            // Unassigned tab will exist even if there were none before.
            const willHaveUnassigned = unassignedEmps.length > 0
              || activeEmps.some(e => e.payGroupId === deletedId);
            setEditGroup(null);
            onRefresh?.();
            // Re-fetch paystubs too: archiving back-fills pay_group_id onto
            // employee-linked checks, so the stale client copy would otherwise
            // render the archived group's history empty until a full reload.
            api.getPaystubs(clientId).then(setPaystubs).catch(() => {});
            api.getPayGroups(clientId).then(groups => {
              setPayGroups(groups);
              const next = groups.find(g => g.id !== deletedId && !g.deletedAt);
              setCurrentGroupId(next ? next.id : (willHaveUnassigned ? UNASSIGNED_ID : null));
            });
          }} />
        );
      })()}

      {/* Print Checks Modal */}
      {printModal && (
        <ModalOverlay onClose={() => { if (printModalBusy) return; setPrintModal(null); setPrintModalErr(''); }}>
          <div className="card" style={{ width: 420, maxWidth: '92vw', padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Payroll Complete!</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 22 }}>
              {printModal.ids.length} check{printModal.ids.length !== 1 ? 's' : ''} processed and marked as printed.
            </div>
            {printModalErr && (
              <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, marginBottom: 12 }}>⚠ {printModalErr}</div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <button className="btn btn-primary" disabled={!!printModalBusy} style={{ borderRadius: '6px 0 0 6px', borderRight: 'none' }} onClick={async () => {
                  setPrintModalBusy('paycheck'); setPrintModalErr('');
                  try {
                    await api.printSelectedChecks(clientId, printModal.ids, localStorage.getItem('checkDesign') || 'classic');
                    setPrintModal(null);
                  } catch (e) { setPrintModalErr(e.message || 'Download failed — try again.'); }
                  finally { setPrintModalBusy(null); }
                }}>
                  {printModalBusy === 'paycheck' ? 'Preparing PDF…' : '↓ Download Paycheck'}
                </button>
                <select
                  defaultValue={localStorage.getItem('checkDesign') || 'classic'}
                  onChange={e => localStorage.setItem('checkDesign', e.target.value)}
                  style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 0, padding: '4px 6px', cursor: 'pointer', height: 32 }}>
                  <option value="classic">Classic</option>
                  <option value="micr">MICR (Check Printer)</option>
                  <option value="top">Top Check</option>
                </select>
              </div>
              <button className="btn btn-secondary" disabled={!!printModalBusy} onClick={async () => {
                setPrintModalBusy('paystub'); setPrintModalErr('');
                try {
                  await api.printSelectedPaystubs(clientId, printModal.ids);
                  setPrintModal(null);
                } catch (e) { setPrintModalErr(e.message || 'Download failed — try again.'); }
                finally { setPrintModalBusy(null); }
              }}>
                {printModalBusy === 'paystub' ? 'Preparing PDF…' : '↓ Download Paystub'}
              </button>
              <button className="btn btn-ghost" onClick={() => { setPrintModal(null); setPrintModalErr(''); }}>Not Now</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showPaycheckImport && (
        <ImportPaychecksModal clientId={clientId} onClose={() => setShowPaycheckImport(false)} onImported={() => { setShowPaycheckImport(false); onRefresh(); }} />
      )}

      {/* Ungrouped Payroll Modal */}
      {ungroupedModal && (
        <ModalOverlay onClose={() => { setUngroupedModal(false); setUgPreview(null); setUgOtherOpen(false); }}>

          {/* ── Step 1: Form ── */}
          {!ugPreview && (
            <div className="card" style={{ width: 480, maxWidth: '95vw', padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Ungrouped Check</div>
                <button className="drawer-close" aria-label="Close" onClick={() => { setUngroupedModal(false); setUgOtherOpen(false); }}>×</button>
              </div>
              {ugErr && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{ugErr}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Employee
                  <select className="form-input" value={ugForm.employeeId}
                    onChange={e => setUgForm(f => ({ ...f, employeeId: e.target.value, rate: '' }))}
                    style={{ marginTop: 4, width: '100%' }}>
                    <option value="">Select employee…</option>
                    {activeEmps.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                  </select>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Period Start
                    <input className="form-input" type="date" value={ugForm.start}
                      onChange={e => setUgForm(f => ({ ...f, start: e.target.value }))}
                      style={{ marginTop: 4, width: '100%' }} />
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Period End
                    <input className="form-input" type="date" value={ugForm.end}
                      onChange={e => { const end = e.target.value; setUgForm(f => ({ ...f, end, payDate: end ? calcDefaultPayDate(end) : f.payDate })); }}
                      style={{ marginTop: 4, width: '100%' }} />
                  </label>
                </div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Pay Date
                  <input className="form-input" type="date" value={ugForm.payDate}
                    onChange={e => setUgForm(f => ({ ...f, payDate: e.target.value }))}
                    style={{ marginTop: 4, width: '100%' }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Pay Type
                  <select className="form-input" value={ugForm.payType}
                    onChange={e => setUgForm(f => ({ ...f, payType: e.target.value }))}
                    style={{ marginTop: 4, width: '100%' }}>
                    <option value="regular">Regular (Hourly)</option>
                    <option value="salary">Salary</option>
                  </select>
                </label>
                {ugForm.payType !== 'salary' && (() => {
                  const ugEmp = activeEmps.find(e => e.id === Number(ugForm.employeeId));
                  const empRate = ugEmp?.hourlyRate || '';
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Reg Hours
                        <input className="form-input mono" type="number" min="0" step="0.5" value={ugForm.regHours} placeholder="0"
                          onChange={e => setUgForm(f => ({ ...f, regHours: e.target.value }))}
                          style={{ marginTop: 4, width: '100%' }} />
                      </label>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>OT Hours
                        <input className="form-input mono" type="number" min="0" step="0.5" value={ugForm.otHours} placeholder="0"
                          onChange={e => setUgForm(f => ({ ...f, otHours: e.target.value }))}
                          style={{ marginTop: 4, width: '100%' }} />
                      </label>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Hourly Rate
                        <input className="form-input mono" type="number" min="0" step="0.01"
                          value={ugForm.rate !== '' ? ugForm.rate : empRate}
                          placeholder={String(empRate || '0.00')}
                          onChange={e => setUgForm(f => ({ ...f, rate: e.target.value }))}
                          style={{ marginTop: 4, width: '100%' }} />
                      </label>
                    </div>
                  );
                })()}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <button type="button" onClick={() => setUgOtherOpen(o => !o)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {ugOtherOpen ? '▴' : '▾'} Other Payroll Items (tips, bonus, etc.)
                  </button>
                  {ugOtherOpen && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                      {[
                        { label: 'Reported Tips', field: 'tips', hint: 'taxable' },
                        { label: 'Bonus', field: 'bonus', hint: 'taxable' },
                        { label: 'Commission', field: 'commission', hint: 'taxable' },
                        { label: 'Mileage Reimbursement', field: 'mileage', hint: 'non-taxable' },
                        { label: 'Cash Advance', field: 'cashAdvance', hint: 'deduction' },
                      ].map(({ label, field, hint }) => (
                        <label key={field} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                          {label} <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)' }}>({hint})</span>
                          <input className="form-input mono" type="number" min="0" step="0.01" value={ugForm[field] || ''} placeholder="0.00"
                            onChange={e => setUgForm(f => ({ ...f, [field]: e.target.value }))}
                            style={{ marginTop: 4, width: '100%' }} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                <button className="btn btn-ghost" onClick={() => { setUngroupedModal(false); setUgOtherOpen(false); }}>Cancel</button>
                <button className="btn btn-primary" onClick={handleUgCalculate} disabled={ugRunning}>
                  {ugRunning ? <span className="spinner" /> : 'Preview Check →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Full check preview ── */}
          {ugPreview && (() => {
            const { emp, isSalary, regH, otH, rate, regPay, otPay, gross, ugTips, ugBonus, ugComm, ugCashAdv, ugMile, calc, ytd } = ugPreview;
            // The backend auto-withholds active child support orders on EVERY run,
            // including ungrouped checks — the preview must show it or the printed
            // net won't match this screen.
            const ugCS      = r2(csTotals[emp.id] || 0);
            const netPay    = Math.max(0, r2(gross - (calc.fitWithholding || 0) - (calc.employeeSS || 0) - (calc.employeeMedicare || 0) - (calc.additionalMedicare || 0) - (calc.stateIncomeTax || 0) - ugCashAdv - ugCS));
            const erTotal   = r2((calc.employerSS || 0) + (calc.employerMedicare || 0) + (calc.futaTax || 0) + (calc.sutaTax || 0));
            const dep941    = r2((calc.fitWithholding || 0) + (calc.employeeSS || 0) + (calc.employerSS || 0) + (calc.employeeMedicare || 0) + (calc.employerMedicare || 0) + (calc.additionalMedicare || 0));
            const hasDD     = emp.directDeposit?.status === 'active';
            const MONO      = { fontFamily: 'JetBrains Mono, monospace' };
            const Row = ({ label, amount, ytdAmt, color, bold, borderTop, negative }) => {
              const display = negative ? (amount > 0 ? -amount : amount) : amount;
              return (
                <tr style={{ borderTop: borderTop ? '2px solid var(--border)' : undefined }}>
                  <td style={{ padding: '5px 0', fontSize: 12, color: bold ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: bold ? 700 : 400 }}>{label}</td>
                  <td style={{ padding: '5px 0 5px 10px', textAlign: 'right', ...MONO, fontSize: 12, fontWeight: bold ? 700 : 500, color: color || (negative && amount > 0 ? '#dc2626' : 'inherit') }}>
                    {typeof display === 'number' ? fmt(display) : display}
                  </td>
                  {ytdAmt !== undefined && (
                    <td style={{ padding: '5px 0 5px 10px', textAlign: 'right', ...MONO, fontSize: 11, color: 'var(--text-muted)' }}>{fmt(ytdAmt)}</td>
                  )}
                </tr>
              );
            };
            return (
              <div className="card" style={{ width: 740, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>
                {/* Header */}
                <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 20 }}>{emp.firstName} {emp.lastName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{isSalary ? 'Salary' : 'Hourly'} · Ungrouped Check · Preview</div>
                    </div>
                    <button className="drawer-close" aria-label="Close" onClick={() => { setUngroupedModal(false); setUgPreview(null); setUgOtherOpen(false); }}>×</button>
                  </div>
                  <div style={{ display: 'flex', marginTop: 14, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    {[['Period Start', ugForm.start], ['Period End', ugForm.end], ['Pay Date', ugForm.payDate]].map(([label, val], i, arr) => (
                      <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                        <div style={{ ...MONO, fontSize: 13, fontWeight: 600 }}>{fmtDate(val)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Two-column body */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
                  {/* Employee Summary */}
                  <div style={{ padding: '18px 20px 18px 24px', borderRight: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Employee Summary</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'left' }}>Item Name</th>
                        <th style={{ padding: '0 0 6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '0 0 6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>YTD</th>
                      </tr></thead>
                      <tbody>
                        {!isSalary && regH > 0 && <Row label={`Hourly (${regH} hrs)`} amount={regPay} color="var(--accent)" />}
                        {!isSalary && otH  > 0 && <Row label={`Overtime (${otH} hrs)`} amount={otPay}  color="var(--accent)" />}
                        {isSalary && <Row label="Salary / Period" amount={regPay} color="var(--accent)" />}
                        {ugTips  > 0 && <Row label="Reported Tips"  amount={ugTips}  color="var(--accent)" />}
                        {ugBonus > 0 && <Row label="Bonus"          amount={ugBonus} color="var(--accent)" />}
                        {ugComm  > 0 && <Row label="Commission"     amount={ugComm}  color="var(--accent)" />}
                        <Row label="Gross Pay"         amount={gross}                        ytdAmt={ytd.gross}    color="var(--accent)" bold borderTop />
                        <Row label="Federal Income Tax" amount={calc.fitWithholding || 0}    ytdAmt={ytd.fit}      negative color={(calc.fitWithholding || 0) > 0 ? '#dc2626' : 'var(--text-muted)'} />
                        <Row label="Social Security"    amount={calc.employeeSS || 0}        ytdAmt={ytd.eeSS}     negative color={(calc.employeeSS || 0) > 0 ? '#dc2626' : 'var(--text-muted)'} />
                        <Row label="Medicare"           amount={calc.employeeMedicare || 0}  ytdAmt={ytd.eeMed}    negative color={(calc.employeeMedicare || 0) > 0 ? '#dc2626' : 'var(--text-muted)'} />
                        <Row label="State Income Tax"   amount={calc.stateIncomeTax || 0}    ytdAmt={ytd.stateTax} negative color={(calc.stateIncomeTax || 0) > 0 ? '#dc2626' : 'var(--text-muted)'} />
                        {ugCashAdv > 0 && <Row label="Cash Advance (deduction)" amount={ugCashAdv} negative color="#dc2626" />}
                        {ugCS > 0 && <Row label="Child Support (auto-withheld)" amount={ugCS} negative color="#dc2626" />}
                      </tbody>
                    </table>
                  </div>
                  {/* Company Summary */}
                  <div style={{ padding: '18px 24px 18px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Company Summary</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={{ padding: '0 0 6px 0', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'left' }}>Item Name</th>
                        <th style={{ padding: '0 0 6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '0 0 6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>YTD</th>
                      </tr></thead>
                      <tbody>
                        <Row label="SS Match (Company)"       amount={calc.employerSS || 0}       ytdAmt={ytd.erSS ?? 0}  />
                        <Row label="Medicare Match (Company)" amount={calc.employerMedicare || 0}  ytdAmt={ytd.erMed ?? 0} />
                        <Row label="Federal Unemployment"     amount={calc.futaTax || 0}           ytdAmt={ytd.futa}       />
                        <Row label={`${emp.workState || 'State'} Unemployment`} amount={calc.sutaTax || 0} ytdAmt={ytd.suta} />
                        <Row label="Total Company Cost"       amount={erTotal}                     ytdAmt={r2((ytd.erSS ?? 0) + (ytd.erMed ?? 0) + ytd.futa + ytd.suta)} bold borderTop color="var(--text-primary)" />
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Check Amount */}
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Check Amount</div>
                  <div style={{ ...MONO, fontWeight: 800, fontSize: 22, color: '#16a34a' }}>{fmt(netPay)}</div>
                </div>

                {/* Tax deposit tiles */}
                <div style={{ padding: '14px 24px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {[
                    { label: '941 TAX DEPOSIT', value: fmt(dep941) },
                    { label: '940 FUTA',         value: fmt(calc.futaTax || 0) },
                    { label: 'STATE SUI',         value: fmt(calc.sutaTax || 0) },
                    { label: 'TOTAL TAX COSTS',   value: fmt(r2(dep941 + (calc.futaTax || 0) + (calc.sutaTax || 0))), highlight: true },
                  ].map(({ label, value, highlight }) => (
                    <div key={label} style={{ background: highlight ? 'var(--accent-light, #f0fdf4)' : 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                      <div style={{ ...MONO, fontWeight: 700, fontSize: 14 }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Footer buttons */}
                <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {ugErr && <span style={{ fontSize: 12, color: '#dc2626', flex: 1 }}>{ugErr}</span>}
                  <button className="btn btn-ghost" onClick={() => setUgPreview(null)} disabled={ugRunning}>← Back</button>
                  <button className="btn btn-secondary" onClick={() => handleUngroupedRun('print')} disabled={ugRunning}>
                    {ugRunning ? <span className="spinner" /> : '🖨 Print Paycheck'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleUngroupedRun('paystub')} disabled={ugRunning}>
                    {ugRunning ? <span className="spinner" /> : '📄 Print Paystub'}
                  </button>
                  <button className="btn btn-primary" onClick={() => handleUngroupedRun('dd')} disabled={ugRunning || !hasDD}
                    title={!hasDD ? 'No active direct deposit on file for this employee' : ''}>
                    {ugRunning ? <span className="spinner" /> : '⚡ Direct Deposit'}
                  </button>
                </div>
              </div>
            );
          })()}
        </ModalOverlay>
      )}
    </div>
  );
}



// ── Pay Liabilities — Inline Check Editor ─────────────────────────────────────
function LiabilityCheckEditor({ stub, clientId, client, onUpdated, onClose }) {
  const depositSchedule = client?.depositSchedule || 'monthly';

  function calcSettlementDue(payDate) {
    if (!payDate) return '';
    return calcIRSDepositDue(payDate, depositSchedule);
  }

  const initialSettlementDue = stub.settlement_due_date ||
    (stub.settlement_date ? calcSettlementDue(stub.settlement_date) : '');

  const [form, setForm] = useState({
    grossWages: String(stub.gross_wages || ''),
    filingStatus: stub.filing_status || 'single',
    payFrequency: stub.pay_frequency || 'biweekly',
    workState: stub.work_state || client?.state || 'TX',
    payPeriodStart: stub.pay_period_start || '',
    payPeriodEnd: stub.pay_period_end || '',
    settlementDate: stub.settlement_date || '',
    settlementDueDate: initialSettlementDue,
  });
  const [taxes, setTaxes]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  const [accepted, setAccepted] = useState(false);
  const calcTimer = useRef(null);

  const alreadySubmitted = stub.status === 'submitted' || stub.eftps_status === 'submitted';

  useEffect(() => {
    clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(recalc, 500);
  }, [form.grossWages, form.filingStatus, form.payFrequency, form.workState]);

  async function recalc() {
    const gross = parseFloat(form.grossWages || 0);
    if (gross <= 0) return;
    try {
      const result = await api.calculate({ grossWages: gross, payFrequency: form.payFrequency, filingStatus: form.filingStatus, step2Checkbox: false, step3Children: 0, step3Other: 0, step4a: 0, step4b: 0, step4c: 0, workState: form.workState, ytdGross: stub.ytd_wages_before || 0, sutaRate: client?.suiRateQ1 || client?.suiRateQ2 || client?.suiRateQ3 || client?.suiRateQ4 || null });
      setTaxes(result);
    } catch {}
  }

  async function handleSave() {
    if (form.payPeriodStart && form.payPeriodEnd && form.payPeriodEnd < form.payPeriodStart) return;
    setSaving(true); setErr('');
    try {
      await api.updatePaystub(stub.id, {
        grossWages: parseFloat(form.grossWages),
        filingStatus: form.filingStatus,
        payFrequency: form.payFrequency,
        workState: form.workState,
        payPeriodStart: form.payPeriodStart,
        payPeriodEnd: form.payPeriodEnd,
        settlementDate: form.settlementDate || null,
        settlementDueDate: form.settlementDueDate || null,
      });
      onUpdated();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  function handlePayDateChange(val) {
    setForm(f => ({
      ...f,
      settlementDate: val,
      settlementDueDate: val ? calcSettlementDue(val) : '',
    }));
  }

  return (
    <div style={{ padding: '16px 20px', background: '#f8fafc', borderTop: '1px solid var(--border)' }}>
      {alreadySubmitted && !accepted && (
        <div style={{ background: '#fff3cd', border: '1px solid #f59e0b', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 8, fontSize: 14 }}>⚠ This check has already been submitted to EFTPS</div>
          <div style={{ color: '#78350f', fontSize: 13, marginBottom: 12 }}>Editing may cause discrepancies between your records and what was submitted. Proceed with caution and notify your tax preparer.</div>
          <button className="btn btn-primary" style={{ background: '#d97706', borderColor: '#d97706' }} onClick={() => setAccepted(true)}>I Understand, Edit Anyway</button>
        </div>
      )}
      {(!alreadySubmitted || accepted) && (
        <>
          {err && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span>{err}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Gross Wages</label><div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12 }}>$</span><input className="form-input mono" type="number" min="0" step="0.01" value={form.grossWages} onChange={set('grossWages')} style={{ paddingLeft: 20, height: 32, fontSize: 13 }} /></div></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Filing Status</label><select className="form-select" value={form.filingStatus} onChange={set('filingStatus')} style={{ height: 32, fontSize: 13 }}><option value="single">Single</option><option value="married">Married</option><option value="hoh">HoH</option></select></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Pay Frequency</label><select className="form-select" value={form.payFrequency} onChange={set('payFrequency')} style={{ height: 32, fontSize: 13 }}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option></select></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Work State</label><select className="form-select" value={form.workState} onChange={set('workState')} style={{ height: 32, fontSize: 13 }}>{US_STATES.map(([c]) => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Period Start</label><input className="form-input" type="date" value={form.payPeriodStart} onChange={set('payPeriodStart')} style={{ height: 32, fontSize: 13 }} /></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontSize: 11 }}>Period End</label><input className="form-input" type="date" value={form.payPeriodEnd} onChange={set('payPeriodEnd')} style={{ height: 32, fontSize: 13 }} /></div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Pay Date</label>
              <input className="form-input" type="date" value={form.settlementDate} onChange={e => handlePayDateChange(e.target.value)} style={{ height: 32, fontSize: 13 }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Settlement Date <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-muted)', fontSize: 10 }}>(EFTPS)</span></label>
              <input className="form-input" type="date" value={form.settlementDueDate} onChange={set('settlementDueDate')} style={{ height: 32, fontSize: 13 }} />
              {form.settlementDueDate && (
                <div style={{ fontSize: 10, color: isOverdue(form.settlementDueDate) ? '#dc2626' : 'var(--text-muted)', marginTop: 3, fontWeight: isOverdue(form.settlementDueDate) ? 700 : 400 }}>
                  {isOverdue(form.settlementDueDate) ? '⚠ Overdue' : `Due ${fmtDate(form.settlementDueDate)}`}
                </div>
              )}
            </div>
          </div>
          {periodDateWarning(form.payPeriodStart, form.payPeriodEnd, form.settlementDate) && (
            <div style={{ color: 'var(--error)', fontSize: 11, fontWeight: 600, marginTop: -6, marginBottom: 12 }}>
              {periodDateWarning(form.payPeriodStart, form.payPeriodEnd, form.settlementDate)}
            </div>
          )}
          {taxes && (
            <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)', marginBottom: 12, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
              {[['FIT', taxes.fitWithholding],['SS', taxes.employeeSS],['Medicare', taxes.employeeMedicare],['State Tax', taxes.stateIncomeTax || 0],['FUTA', taxes.futaTax || 0],['SUI', taxes.sutaTax || 0],['941 Total', taxes.totalDeposit],['Net Pay', taxes.netPay]].map(([l, v]) => (
                <div key={l}><div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{l}</div><div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--accent)' }}>{fmt(v)}</div></div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !!(form.payPeriodStart && form.payPeriodEnd && form.payPeriodEnd < form.payPeriodStart)}>{saving ? <span className="spinner" /> : 'Save Changes'}</button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Liability shared helpers ──────────────────────────────────────────────────
function calcLiabilityDue(stub, taxType, schedule) {
  const refDate = stub.settlement_date || stub.pay_period_end;
  if (!refDate) return null;
  const d = new Date(refDate + 'T00:00:00');
  const q = Math.ceil((d.getMonth() + 1) / 3);
  const qMons = [3, 6, 9, 0];  // Apr, Jul, Oct, Jan
  const qDays = [30, 31, 31, 31];
  const qYear = q === 4 ? d.getFullYear() + 1 : d.getFullYear();

  if (taxType === '941') {
    if (schedule === 'semiweekly') return calcIRSDepositDue(refDate, 'semiweekly');
    if (schedule === 'quarterly')  return nextBizDay(new Date(qYear, qMons[q - 1], qDays[q - 1])).toISOString().slice(0, 10);
    return nextBizDay(new Date(d.getFullYear(), d.getMonth() + 1, 15)).toISOString().slice(0, 10); // monthly
  }
  if (taxType === '940') {
    if (schedule === 'annually') return nextBizDay(new Date(d.getFullYear() + 1, 0, 31)).toISOString().slice(0, 10);
    return nextBizDay(new Date(qYear, qMons[q - 1], qDays[q - 1])).toISOString().slice(0, 10); // quarterly
  }
  // SUI
  if (schedule === 'monthly')  return nextBizDay(new Date(d.getFullYear(), d.getMonth() + 1, 15)).toISOString().slice(0, 10);
  if (schedule === 'annually') return nextBizDay(new Date(d.getFullYear() + 1, 0, 31)).toISOString().slice(0, 10);
  return nextBizDay(new Date(qYear, qMons[q - 1], qDays[q - 1])).toISOString().slice(0, 10); // quarterly
}

function calcSendByDate(dueDate) {
  if (!dueDate) return null;
  let d = new Date(dueDate + 'T00:00:00'), count = 0;
  while (count < 2) { d.setDate(d.getDate() - 1); if (isBizDay(d)) count++; }
  return d.toISOString().slice(0, 10);
}

function calcLiabilityStatus(stub, taxType, sendBy, due, todayStr) {
  const submitted = taxType === '940' ? stub.status_940 === 'submitted' : taxType === 'sui' ? (stub.status_sui || 'pending') === 'submitted' : stub.status === 'submitted';
  if (submitted) return 'completed';
  if (!due) return 'upcoming';
  if (todayStr > due) return 'late';
  if (sendBy && todayStr >= sendBy) return 'due-soon';
  const days = daysUntil(sendBy || due);
  if (days !== null && days <= 5) return 'due-soon';
  return 'upcoming';
}

const LIAB_STATUS_CFG = {
  upcoming:  { label: 'Upcoming',  cls: 'badge-neutral' },
  'due-soon':{ label: 'Due Soon',  cls: 'badge-warning' },
  late:      { label: 'Late',      cls: 'badge-error'   },
  completed: { label: 'Sent',      cls: 'badge-success' },
};
function LiabStatusBadge({ status }) {
  const cfg = LIAB_STATUS_CFG[status] || LIAB_STATUS_CFG.upcoming;
  return <span className={`badge ${cfg.cls}`} style={{ fontWeight: 700, fontSize: 10 }}>{cfg.label}</span>;
}

const SUI_AGENCIES = {
  AL: 'Alabama Dept. of Labor',
  AK: 'Alaska Dept. of Labor & Workforce Dev.',
  AZ: 'Arizona Dept. of Economic Security',
  AR: 'Arkansas Division of Workforce Services',
  CA: 'California Employment Dev. Dept. (EDD)',
  CO: 'Colorado Dept. of Labor & Employment',
  CT: 'Connecticut Dept. of Labor',
  DE: 'Delaware Dept. of Labor',
  FL: 'Florida Dept. of Commerce — DEO',
  GA: 'Georgia Dept. of Labor',
  HI: 'Hawaii Dept. of Labor & Industrial Relations',
  ID: 'Idaho Dept. of Labor',
  IL: 'Illinois Dept. of Employment Security',
  IN: 'Indiana Dept. of Workforce Development',
  IA: 'Iowa Workforce Development',
  KS: 'Kansas Dept. of Labor',
  KY: 'Kentucky Education & Workforce Cabinet',
  LA: 'Louisiana Workforce Commission',
  ME: 'Maine Dept. of Labor',
  MD: 'Maryland Dept. of Labor',
  MA: 'Massachusetts Dept. of Unemployment Assistance',
  MI: 'Michigan Unemployment Insurance Agency',
  MN: 'Minnesota Dept. of Employment & Economic Dev.',
  MS: 'Mississippi Dept. of Employment Security',
  MO: 'Missouri Division of Employment Security',
  MT: 'Montana Dept. of Labor & Industry',
  NE: 'Nebraska Dept. of Labor',
  NV: 'Nevada Employment Security Division',
  NH: 'New Hampshire Employment Security',
  NJ: 'New Jersey Dept. of Labor',
  NM: 'New Mexico Dept. of Workforce Solutions',
  NY: 'New York Dept. of Labor',
  NC: 'North Carolina Division of Employment Security',
  ND: 'North Dakota Job Service',
  OH: 'Ohio Dept. of Job & Family Services',
  OK: 'Oklahoma Employment Security Commission',
  OR: 'Oregon Employment Dept.',
  PA: 'Pennsylvania Office of Unemployment Compensation',
  RI: 'Rhode Island Dept. of Labor & Training',
  SC: 'South Carolina Dept. of Employment & Workforce',
  SD: 'South Dakota Dept. of Labor & Regulation',
  TN: 'Tennessee Dept. of Labor & Workforce Dev.',
  TX: 'Texas Workforce Commission',
  UT: 'Utah Dept. of Workforce Services',
  VT: 'Vermont Dept. of Labor',
  VA: 'Virginia Employment Commission',
  WA: 'Washington Employment Security Dept.',
  WV: 'West Virginia Workforce West Virginia',
  WI: 'Wisconsin Dept. of Workforce Development',
  WY: 'Wyoming Dept. of Workforce Services',
  DC: 'DC Dept. of Employment Services',
};

function liabilityVendor(taxType, workState) {
  if (taxType === '941' || taxType === '940') return 'United States Treasury';
  return SUI_AGENCIES[workState] || `${workState || 'State'} Dept. of Labor`;
}

// Shared detail modal for both pending and sent liabilities
function LiabilityDetailModal({ stub, taxType, due, sendBy, todayStr, onClose, onStubChange, onDelete, onPay, clientId }) {
  if (!stub) return null;
  const [settlementDate, setSettlementDate] = React.useState(stub.eftps_settlement_date || due || '');
  const [savingSettlement, setSavingSettlement] = React.useState(false);
  const [payingNow, setPayingNow] = React.useState(false);
  const settlementInputRef = React.useRef(null);
  const liabStatus = calcLiabilityStatus(stub, taxType, sendBy, due, todayStr);
  const vendor = liabilityVendor(taxType, stub.work_state);
  const liabilityAmount = taxType === '941' ? (stub.total_deposit || 0)
                        : taxType === '940' ? (stub.futa_tax || 0)
                        : (stub.suta_tax || 0);

  // Employee paycheck rows
  const earningRows = [
    stub.regular_hours != null && stub.regular_pay != null && { label: `Hourly  (${stub.regular_hours} hrs)`, amount: stub.regular_pay, positive: true },
    stub.overtime_hours > 0 && stub.overtime_pay > 0       && { label: `Overtime  (${stub.overtime_hours} hrs)`, amount: stub.overtime_pay, positive: true },
    stub.bonus > 0         && { label: 'Bonus',         amount: stub.bonus,         positive: true },
    stub.commission > 0    && { label: 'Commission',    amount: stub.commission,    positive: true },
    stub.reimbursement > 0 && { label: 'Reimbursement', amount: stub.reimbursement, positive: true },
  ].filter(Boolean);

  // If no line items, show gross as a single row
  const showGrossLine = earningRows.length === 0;

  const deductionRows = [
    { label: 'Federal Income Tax',   amount: stub.fit_withholding   || 0 },
    { label: 'Social Security',      amount: stub.employee_ss       || 0 },
    { label: 'Medicare',             amount: stub.employee_medicare || 0 },
    stub.additional_medicare > 0 && { label: 'Addl Medicare',       amount: stub.additional_medicare },
    stub.state_income_tax > 0    && { label: 'State Income Tax',    amount: stub.state_income_tax },
  ].filter(Boolean);

  const employerRows = [
    { label: 'SS Match (Company)',       amount: stub.employer_ss      || 0 },
    { label: 'Medicare Match (Company)', amount: stub.employer_medicare || 0 },
    { label: 'Federal Unemployment',     amount: stub.futa_tax         || 0 },
    { label: `${stub.work_state || 'State'} Unemployment`, amount: stub.suta_tax || 0 },
  ];

  const employerTotal = r2((stub.employer_ss || 0) + (stub.employer_medicare || 0) + (stub.futa_tax || 0) + (stub.suta_tax || 0));

  const MONO = { fontFamily: 'JetBrains Mono, monospace' };

  // Reusable table row
  const Row = ({ label, amount, color, bold, borderTop, indent }) => (
    <tr style={{ borderTop: borderTop ? '1px solid var(--border)' : undefined }}>
      <td style={{ padding: '7px 0 7px 8px', paddingLeft: indent ? 20 : 8, fontSize: 13, color: color || 'var(--text-secondary)', fontWeight: bold ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '7px 8px 7px 0', textAlign: 'right', ...MONO, fontSize: 13, fontWeight: bold ? 700 : 500, color: color || 'inherit' }}>{fmt(amount)}</td>
    </tr>
  );

  const dateColor = liabStatus === 'late' ? '#dc2626' : liabStatus === 'due-soon' ? '#d97706' : 'var(--text-secondary)';

  return (
    <ModalOverlay onClose={onClose}>
      <div className="card" style={{ width: 700, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>

        {/* ── Header ── */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: 'var(--text-primary)', marginBottom: 2 }}>{vendor}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Re: {stub.employee_name}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge status={stub.check_status || 'draft'} />
                <LiabStatusBadge status={liabStatus} />
                {stub.check_number && <span style={{ ...MONO, fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>Check #{stub.check_number}</span>}
              </div>
            </div>
            <button className="drawer-close" aria-label="Close" onClick={onClose}>×</button>
          </div>

          {/* Pay period strip */}
          <div style={{ display: 'flex', gap: 0, marginTop: 16, background: 'var(--bg-secondary)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {[
              { label: 'Period Start',  value: fmtDate(stub.pay_period_start), color: null },
              { label: 'Period End',    value: fmtDate(stub.pay_period_end),   color: null },
              { label: 'Pay Date',      value: fmtDate(stub.settlement_date),  color: null },
              sendBy && { label: 'Send By', value: fmtDate(sendBy), color: liabStatus === 'due-soon' || liabStatus === 'late' ? dateColor : null },
            ].filter(Boolean).map(({ label, value, color }, i, arr) => (
              <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ ...MONO, fontSize: 13, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</div>
              </div>
            ))}
            {due && (
              <div style={{ flex: 1, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Settlement Date</div>
                <div style={{ ...MONO, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
                  onClick={() => settlementInputRef.current?.showPicker?.()}>
                  {fmtDate(settlementDate || due)}
                </div>
                <input
                  ref={settlementInputRef}
                  type="date"
                  value={settlementDate || due}
                  max={due}
                  onChange={e => setSettlementDate(e.target.value)}
                  onBlur={async () => {
                    const val = settlementDate || due;
                    if (val === (stub.eftps_settlement_date || due)) return;
                    setSavingSettlement(true);
                    try {
                      await api.updatePaystub(stub.id, { eftpsSettlementDate: val === due ? null : val });
                      if (onStubChange) onStubChange(stub.id, { eftps_settlement_date: val === due ? null : val });
                    } catch (e) { alert(e.message); }
                    finally { setSavingSettlement(false); }
                  }}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                />
                {savingSettlement
                  ? <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>saving…</div>
                  : (!settlementDate || settlementDate === due) && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>* IRS due date</div>
                }
              </div>
            )}
          </div>
        </div>

        {/* ── Two-column body ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

          {/* Left — Employee Paycheck */}
          <div style={{ padding: '20px 20px 0 24px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Employee Summary</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {/* Earnings */}
                {earningRows.map(r => <Row key={r.label} label={r.label} amount={r.amount} color="var(--accent)" />)}
                {showGrossLine && <Row label="Gross Pay" amount={stub.gross_wages || 0} color="var(--accent)" />}
                {!showGrossLine && (
                  <Row label="Gross Pay" amount={stub.gross_wages || 0} color="var(--accent)" bold borderTop />
                )}
                {/* Deductions */}
                {deductionRows.map(r => (
                  <Row key={r.label} label={r.label} amount={-r.amount} color={r.amount > 0 ? '#dc2626' : 'var(--text-muted)'} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Right — Employer Costs */}
          <div style={{ padding: '20px 24px 0 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Company Summary</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {employerRows.map(r => <Row key={r.label} label={r.label} amount={r.amount} />)}
                <Row label="Total Employer Cost" amount={employerTotal} bold borderTop color="var(--text-primary)" />
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Footer — Check Amount + Tax Deposits ── */}
        <div style={{ margin: '16px 24px 0', borderTop: '2px solid var(--border)' }} />

        {/* Check Amount — liability amount payable to vendor */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px 4px' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {taxType === '941' ? '941 Tax Deposit' : taxType === '940' ? '940 FUTA Payment' : 'SUI Payment'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Payable to {vendor}</div>
          </div>
          <div style={{ ...MONO, fontSize: 22, fontWeight: 800, color: '#16a34a' }}>{fmt(liabilityAmount)}</div>
        </div>

        <div style={{ padding: '0 24px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button style={{ background: 'none', border: 'none', fontSize: 12, color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
            onClick={async () => {
              if (!window.confirm('Delete this check? This cannot be undone.')) return;
              if (onDelete) onDelete();
            }}>Delete</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, borderRadius: '6px 0 0 6px', borderRight: 'none' }} onClick={async () => {
                try { await api.printSelectedChecks(clientId, [stub.id], localStorage.getItem('checkDesign') || 'classic'); } catch (e) { alert(e.message); }
              }}>↓ Paycheck</button>
              <select
                defaultValue={localStorage.getItem('checkDesign') || 'classic'}
                onChange={e => localStorage.setItem('checkDesign', e.target.value)}
                style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 0, padding: '4px 6px', cursor: 'pointer', height: 28 }}>
                <option value="classic">Classic</option>
                <option value="micr">MICR (Check Printer)</option>
                <option value="top">Top Check</option>
              </select>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={async () => {
              try { await api.printSelectedPaystubs(clientId, [stub.id]); } catch (e) { alert(e.message); }
            }}>↓ Paystub</button>
            {taxType === 'sui' && (stub.status_sui || 'pending') !== 'submitted' && onPay && (
              <button className="btn btn-primary" style={{ fontSize: 12 }}
                disabled={payingNow}
                onClick={async () => {
                  setPayingNow(true);
                  try { await onPay(stub); } finally { setPayingNow(false); }
                }}>
                {payingNow ? 'Generating…' : '↓ Download SUI Report'}
              </button>
            )}
            {taxType === 'sui' && (stub.status_sui || 'pending') === 'submitted' && (
              <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Submitted</span>
            )}
          </div>
        </div>

        {/* Tax deposit summary bar */}
        <div style={{ display: 'flex', gap: 0, margin: '0 24px 20px', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          {[
            { label: '941 Tax Deposit',   value: fmt(stub.total_deposit || 0) },
            { label: '940 FUTA',          value: fmt(stub.futa_tax      || 0) },
            { label: 'State SUI',         value: fmt(stub.suta_tax      || 0) },
            { label: 'Total Tax Costs',   value: fmt(r2((stub.total_deposit || 0) + (stub.futa_tax || 0) + (stub.suta_tax || 0))), accent: true },
          ].map(({ label, value, accent }, i, arr) => (
            <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none', background: accent ? 'var(--accent-light)' : undefined }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
              <div style={{ ...MONO, fontSize: 14, fontWeight: 800, color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── Pay Liabilities Tab ───────────────────────────────────────────────────────
function PayLiabilitiesTab({ clientId, client, refreshTick = 0 }) {
  const [paystubs, setPaystubs]     = useState([]);
  const [credits, setCredits]       = useState([]);
  const [csWithholdings, setCsWithholdings] = useState([]); // child support rows joined w/ paycheck
  const [csBusyKey, setCsBusyKey]   = useState(null);       // vendor|payDate while paying/printing
  const [loading,  setLoading]      = useState(true);
  const [loadError, setLoadError]   = useState(null);
  const [submitting, setSubmitting] = useState(null);
  const [result,   setResult]       = useState(null);
  const [periodModal, setPeriodModal] = useState(null); // { period, taxType } | null
  // Schedules drive due dates, Send By dates, and Late flags — they were throwaway
  // local state, silently reverting to defaults on every visit. 941 persists to the
  // client record (it's a real DB field); 940/SUI persist per-client in localStorage.
  const [sched941, setSched941State] = useState(client?.depositSchedule || 'monthly');
  const [sched940, setSched940State] = useState(() => localStorage.getItem(`sched940_${clientId}`) || 'quarterly');
  const [schedSUI, setSchedSUIState] = useState(() => localStorage.getItem(`schedSUI_${clientId}`) || 'quarterly');
  useEffect(() => { if (client?.depositSchedule) setSched941State(client.depositSchedule); }, [client?.depositSchedule]);
  const setSched941 = v => {
    const prev = sched941;
    setSched941State(v);
    api.updateClient(clientId, { depositSchedule: v }).catch(() => {
      setSched941State(prev);
      alert('Couldn’t save the deposit schedule — try again.');
    });
  };
  const setSched940 = v => { setSched940State(v); localStorage.setItem(`sched940_${clientId}`, v); };
  const setSchedSUI = v => { setSchedSUIState(v); localStorage.setItem(`schedSUI_${clientId}`, v); };
  const [activeJobId,      setActiveJobId]      = useState(null);
  const [activeJobTaxType, setActiveJobTaxType] = useState(null);
  const [activeJobPeriodDue, setActiveJobPeriodDue] = useState(null); // which period row is actually sending
  const [jobStatus,        setJobStatus]        = useState(null);   // 'enrollment_pending' | 'completed' | 'failed'
  const [jobMessage,       setJobMessage]       = useState('');
  const [twcPayModal,      setTwcPayModal]      = useState(null); // { amount, defaultDate } | null
  const [eftpsPayModal,    setEftpsPayModal]    = useState(null); // { period, taxType } | null
  const [twcPayJob,        setTwcPayJob]        = useState(null); // { id, status, confirmationNumber, error } | null
  const twcPollRef = useRef(null);
  const pollRef = useRef(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  const ISSUED    = new Set(['printed', 'deposited', 'direct_deposit_sent', 'direct_deposit_cleared']);
  const UNPAID_941 = (s) => s.status     === 'pending' || s.status     === 'processing' || s.status     === 'failed';
  const UNPAID_940 = (s) => s.status_940 === 'pending' || s.status_940 === 'processing' || s.status_940 === 'failed';
  const UNPAID_SUI = (s) => (s.status_sui || 'pending') === 'pending' || s.status_sui === 'processing' || s.status_sui === 'failed';

  async function reload({ keepSelections = false, skipJobRestore = false } = {}) {
    let stubs, crds, csw;
    try {
      [stubs, crds, csw] = await Promise.all([
        api.getPaystubs(clientId),
        api.getPaystubCredits(clientId),
        api.getChildSupportWithholdings(clientId).catch(() => []),
      ]);
    } catch (e) {
      setLoadError(e.message || 'Load failed');
      return;
    }
    setLoadError(null);
    setPaystubs(stubs); setCredits(crds); setCsWithholdings(csw);
    if (!skipJobRestore) {
      const processingStub = stubs.find(s =>
        (s.status === 'processing' || s.status_940 === 'processing') && s.bridge_job_id
      );
      if (processingStub) {
        const restoredType = processingStub.status === 'processing' ? '941' : '940';
        setActiveJobId(prev => prev || processingStub.bridge_job_id);
        setActiveJobTaxType(prev => prev || restoredType);
        // Restore which period row is sending too, so its button reads "Sending…"
        // after a page refresh instead of none of them.
        setActiveJobPeriodDue(prev => prev || calcLiabilityDue(processingStub, restoredType, restoredType === '941' ? sched941 : sched940) || 'unknown');
        setJobStatus(prev => prev || processingStub.bridge_status || 'processing');
      }
    }
  }
  // refreshTick: re-fetch when data changes elsewhere (imports, drawer saves, ↻)
  useEffect(() => { reload().finally(() => setLoading(false)); }, [clientId, refreshTick]);

  const pending941 = paystubs.filter(s => ISSUED.has(s.check_status) && UNPAID_941(s));
  const pending940 = paystubs.filter(s => ISSUED.has(s.check_status) && UNPAID_940(s) && s.futa_tax > 0);
  const pendingSUI = paystubs.filter(s => ISSUED.has(s.check_status) && s.suta_tax > 0 && UNPAID_SUI(s));

  const unappCredits = credits.filter(c => !c.applied);
  const credit941 = unappCredits.reduce((s, c) => s + (c.total_941_credit || 0), 0);
  const credit940 = unappCredits.reduce((s, c) => s + (c.total_940_credit || 0), 0);

  // ── Child support liabilities ────────────────────────────────────────────────
  // Pending withholdings on issued checks, grouped by vendor + pay date. The
  // remittance is due 7 calendar days after the pay date (standard TX/most-state
  // rule), so Late/Due Soon flags key off that.
  const csAddDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const csPendingGroups = (() => {
    const map = {};
    for (const w of csWithholdings) {
      if (w.status !== 'pending' || !ISSUED.has(w.check_status)) continue;
      const payDate = w.settlement_date || w.pay_period_end || 'unknown';
      const key = `${w.vendor_name}|${payDate}`;
      if (!map[key]) map[key] = { key, vendor: w.vendor_name, payDate, due: payDate !== 'unknown' ? csAddDays(payDate, 7) : null, rows: [], total: 0 };
      map[key].rows.push(w);
      map[key].total = r2(map[key].total + w.amount);
    }
    return Object.values(map).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  })();
  const csSentGroups = (() => {
    const map = {};
    for (const w of csWithholdings) {
      if (w.status !== 'submitted') continue;
      // Full paid_at timestamp: two "Mark Sent" batches on the same day must stay
      // separate rows, or one Undo would revert both payments.
      const key = `${w.vendor_name}|${w.check_number || ''}|${w.paid_at || ''}`;
      if (!map[key]) map[key] = { key, vendor: w.vendor_name, checkNumber: w.check_number, paidAt: w.paid_at, rows: [], total: 0 };
      map[key].rows.push(w);
      map[key].total = r2(map[key].total + w.amount);
    }
    return Object.values(map).sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''));
  })();

  async function handleCsPay(group, { print }) {
    if (csBusyKey) return;
    const ok = window.confirm(print
      ? `Print a ${fmt(group.total)} check to ${group.vendor}?\n\nThis uses the company's next check number and marks ${group.rows.length} withholding${group.rows.length === 1 ? '' : 's'} paid.`
      : `Mark ${fmt(group.total)} to ${group.vendor} as paid outside this app?\n\nUse Undo under Sent child support if this was a mistake.`);
    if (!ok) return;
    setCsBusyKey(group.key);
    try {
      const ids = group.rows.map(w => w.id);
      const res = await api.payChildSupport({ clientId, withholdingIds: ids, assignCheckNumber: !!print });
      if (print) {
        try { await api.printChildSupportCheck(clientId, ids, res.checkNumber); }
        catch (e) {
          alert(`The payment was recorded (check #${res.checkNumber}) but the PDF failed: ${e.message}\nUse Reprint under "Sent child support" to try again.`);
        }
      }
    } catch (e) { alert(e.message); }
    finally {
      // Always reload — the payment may have succeeded even if the print didn't,
      // and a stale "pending" row would invite a double payment.
      setCsBusyKey(null);
      await reload();
    }
  }

  async function handleCsUndo(group) {
    if (!window.confirm(`Move this ${fmt(group.total)} ${group.vendor} payment back to pending?`)) return;
    try { await api.unpayChildSupport({ clientId, withholdingIds: group.rows.map(w => w.id) }); await reload(); }
    catch (e) { alert(e.message); }
  }

  function buildPeriods(stubs, taxType, schedule) {
    const map = {};
    stubs.forEach(s => {
      const due    = calcLiabilityDue(s, taxType, schedule);
      const sendBy = calcSendByDate(due);
      const status = calcLiabilityStatus(s, taxType, sendBy, due, todayStr);
      const key    = due || 'unknown';
      if (!map[key]) map[key] = { due, sendBy, status, stubs: [], total: 0 };
      map[key].stubs.push({ ...s, _due: due, _sendBy: sendBy, _status: status });
      const amt = taxType === '941' ? (s.total_deposit || 0)
                : taxType === '940' ? (s.futa_tax      || 0)
                : (s.suta_tax || 0);
      map[key].total += amt;
    });
    return Object.values(map).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  }

  const periods941 = buildPeriods(pending941, '941', sched941);
  const periods940 = buildPeriods(pending940, '940', sched940);
  const periodsSUI = buildPeriods(pendingSUI, 'sui', schedSUI);

  const total941 = periods941.reduce((s, p) => s + p.total, 0) + credit941;
  const total940 = periods940.reduce((s, p) => s + p.total, 0) + credit940;

  // Unapplied credit belongs to exactly ONE period — the earliest-due pending one,
  // capped at that period's total. Handing the full credit to every period's confirm
  // dialog and detail modal was double-counting it (two pending periods would both
  // promise the same reduction), and sent-history periods showed totals reduced by
  // credit that was never part of that payment.
  function creditForPeriod(period, taxType) {
    const credit = taxType === '941' ? credit941 : taxType === '940' ? credit940 : 0;
    if (!credit || !period) return 0;
    if (period.status === 'completed') return 0;        // sent-history rows never get pending credit
    const list = taxType === '941' ? periods941 : taxType === '940' ? periods940 : [];
    // Match the earliest pending period BY VALUE — the period lists are rebuilt
    // every render, so an object captured at click time (e.g. by the pay dialog)
    // never matches by identity.
    if (!list.length || list[0].due !== period.due) return 0;
    return Math.max(credit, -period.total);             // credit is negative; never push below $0
  }
  const totalSUI = periodsSUI.reduce((s, p) => s + p.total, 0);

  // Poll job status every 60s while a bridge job is active
  useEffect(() => {
    if (!activeJobId) return;

    async function checkJobStatus() {
      try {
        const s = await api.getBridgeJobStatus(activeJobId);
        setJobStatus(s.status);
        setJobMessage(s.message || '');
        if (s.status === 'completed' || s.status === 'failed') {
          clearInterval(pollRef.current);
          setActiveJobId(null);
          setActiveJobTaxType(null);
          setActiveJobPeriodDue(null);
          await reload({ skipJobRestore: true });
        }
      } catch (err) {
        // 404 = Railway restarted and lost the job record — treat as failure
        const msg = err?.message || '';
        if (msg.includes('Job not found') || msg.includes('404')) {
          clearInterval(pollRef.current);
          setActiveJobId(null);
          setActiveJobTaxType(null);
          setActiveJobPeriodDue(null);
          setJobStatus('failed');
          await reload({ skipJobRestore: true });
        }
        // All other errors (network blip, 5xx) are transient — keep polling
      }
    }

    checkJobStatus(); // immediate check on mount (catches Railway restarts fast)
    pollRef.current = setInterval(checkJobStatus, 60_000);
    return () => clearInterval(pollRef.current);
  }, [activeJobId]);

  // Clear polling on unmount
  useEffect(() => () => clearInterval(pollRef.current), []);
  useEffect(() => () => clearInterval(twcPollRef.current), []);

  async function handleSubmitPeriod(period, taxType) {
    if (taxType === 'sui') {
      const ids = period.stubs.map(s => s.id);
      setSubmitting('sui');
      try { await api.downloadSuiReport(clientId, ids); }
      catch (e) { alert(e.message); }
      finally { setSubmitting(null); }
      return;
    }
    // 941/940 → the pay dialog picks a valid settlement date (a late liability's
    // original due date is in the past, which EFTPS rejects outright).
    setEftpsPayModal({ period, taxType });
  }

  async function submitEftpsPeriod(period, taxType, settlementDate) {
    const ids = period.stubs.map(s => s.id);
    setSubmitting(taxType); setResult(null);
    try {
      const res = await api.batchSubmitPaystubs({ clientId, paystubIds: ids, taxType, settlementDate });
      setEftpsPayModal(null);
      setResult(res);
      if (res.jobId) {
        setActiveJobId(res.jobId);
        setActiveJobTaxType(taxType);
        setActiveJobPeriodDue(period.due || 'unknown');
        setJobStatus('processing');
        setJobMessage('');
      }
      await reload({ skipJobRestore: false });
    } catch (e) { setResult({ error: e.message }); }
    finally { setSubmitting(null); }
  }

  const [periodStatusBusy, setPeriodStatusBusy] = useState(null); // period.due|taxType while updating

  async function togglePeriodStatus(period, taxType, newDbStatus) {
    const busyKey = `${taxType}|${period.due || 'unknown'}`;
    if (periodStatusBusy) return; // double-click guard
    if (newDbStatus === 'submitted') {
      const label = taxType === 'sui' ? 'State SUI' : `Federal ${taxType.toUpperCase()}`;
      const ok = window.confirm(
        `Mark the ${label} period${period.due ? ` due ${fmtDate(period.due)}` : ''} — ${fmt(period.total)} — as paid outside this app?\n\n` +
        `This moves ${period.stubs.length} check${period.stubs.length === 1 ? '' : 's'} into Sent history. Use Undo there if this was a mistake.`
      );
      if (!ok) return;
    }
    setPeriodStatusBusy(busyKey);
    // Sequential (not Promise.all) so one failure doesn't leave an unknown number
    // of the remaining stubs flipped; report exactly what happened either way.
    let done = 0; let failErr = null;
    for (const s of period.stubs) {
      try { await api.updatePaystubStatus(s.id, newDbStatus, taxType); done++; }
      catch (e) { failErr = e; break; }
    }
    setPeriodStatusBusy(null);
    if (failErr) {
      alert(`Only ${done} of ${period.stubs.length} checks were updated before an error: ${failErr.message}\nThe list below reflects what actually saved.`);
    }
    await reload();
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" style={{ width: 28, height: 28 }} /></div>;

  function LiabilitySection({ sections, togglePeriodStatus }) {
    // sections: array of { title, taxType, periods, credit }
    const hasAny = sections.some(sec => sec.periods.length > 0);
    if (!hasAny) return null;

    const csPendingTotal = r2(csPendingGroups.reduce((s, g) => s + g.total, 0));
    // Clamp each section at 0 — a credit larger than what's owed never produces a
    // negative payment (the pay dialogs cap applied credit the same way).
    const grandTotal = r2(sections.reduce((s, sec) => sec.periods.length === 0 ? s : s + Math.max(0, sec.periods.reduce((a, p) => a + p.total, 0) + sec.credit), 0) + csPendingTotal);

    const TH = {
      padding: '8px 14px',
      fontSize: 11,
      fontWeight: 700,
      color: '#6b7280',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      textAlign: 'left',
      background: '#f8f9fa',
      borderBottom: '1px solid #d1d5db',
    };

    return (
      <div className="table-scroll" style={{ background: '#fff', border: '1.5px solid #9faab6', borderRadius: 4, marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <colgroup>
            <col style={{ width: 130 }} />
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 60 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 230 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH}>Tax</th>
              <th style={TH}>Pay Dates</th>
              <th style={TH} title="Submit the payment by this date so it settles by the IRS deadline (2 business days before the due date)">Send By</th>
              <th style={TH}>Checks</th>
              <th style={{ ...TH, textAlign: 'right' }}>Amount</th>
              <th style={TH} />
            </tr>
          </thead>
          <tbody>
            {sections.map((sec, secIdx) => {
              if (sec.periods.length === 0) return null;
              const sectionTotal = sec.periods.reduce((s, p) => s + p.total, 0) + sec.credit;
              const lateCount    = sec.periods.filter(p => p.status === 'late').length;
              return (
                <React.Fragment key={sec.taxType}>
                  {secIdx > 0 && (
                    <tr><td colSpan={6} style={{ height: 0, padding: 0, borderTop: '2px solid #9faab6' }} /></tr>
                  )}
                  <tr style={{ background: '#f8f9fa' }}>
                    <td colSpan={6} style={{ padding: '9px 16px', borderLeft: '3px solid #6b7280', fontWeight: 700, fontSize: 13, color: '#374151' }}>
                      {sec.title}
                      {lateCount > 0 && <span style={{ color: '#dc2626', fontWeight: 600, marginLeft: 12, fontSize: 12 }}>{lateCount} overdue</span>}
                    </td>
                  </tr>

                  {sec.periods.map(period => {
                    const isLate    = period.status === 'late';
                    const isDueSoon = period.status === 'due-soon';
                    const payDates  = [...new Set(period.stubs.map(s => s.settlement_date || s.pay_period_end).filter(Boolean))].sort();
                    const dateLabel = payDates.length === 0 ? '—'
                                    : payDates.length === 1 ? fmtDate(payDates[0])
                                    : `${fmtDate(payDates[0])} – ${fmtDate(payDates[payDates.length - 1])}`;
                    return (
                      <tr key={period.due || 'unknown'}
                        style={{ background: '#fff', borderTop: '1px solid #e5e7eb', cursor: 'pointer' }}
                        tabIndex={0} role="button" aria-label={`View ${sec.title} period details — ${fmt(period.total)}`}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPeriodModal({ period, taxType: sec.taxType }); } }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#fafafa'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                        onClick={() => setPeriodModal({ period, taxType: sec.taxType })}>
                        <td style={{ padding: '14px 16px', color: '#9ca3af', fontSize: 13 }} />
                        <td style={{ padding: '14px 14px', color: '#374151', fontSize: 14 }}>{dateLabel}</td>
                        <td style={{ padding: '14px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600,
                          color: isLate ? '#dc2626' : isDueSoon ? '#d97706' : '#374151' }}
                          title={period.due ? `IRS due date: ${fmtDate(period.due)}` : undefined}>
                          {fmtDate(period.sendBy || period.due)}
                          {isLate    && <span style={{ marginLeft: 6, fontFamily: 'inherit', fontWeight: 600, fontSize: 12 }}>(Late)</span>}
                          {isDueSoon && !isLate && <span style={{ marginLeft: 6, fontFamily: 'inherit', fontWeight: 500, fontSize: 12 }}>(Due Soon)</span>}
                        </td>
                        <td style={{ padding: '14px 14px', fontSize: 14, color: '#6b7280' }}>{period.stubs.length}</td>
                        <td style={{ padding: '14px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15, color: '#111' }}>
                          {fmt(period.total)}
                        </td>
                        <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                            <button
                              onClick={e => { e.stopPropagation(); togglePeriodStatus(period, sec.taxType, 'submitted'); }}
                              disabled={periodStatusBusy !== null || (activeJobId !== null && activeJobTaxType === sec.taxType)}
                              title={activeJobId !== null && activeJobTaxType === sec.taxType ? 'A payment for this tax type is processing — wait for it to finish' : 'Record this period as paid outside the app'}
                              style={{ background: 'none', border: 'none', color: '#16a34a', fontSize: 13, textDecoration: 'underline', padding: '2px 0', whiteSpace: 'nowrap',
                                cursor: periodStatusBusy || (activeJobId && activeJobTaxType === sec.taxType) ? 'not-allowed' : 'pointer',
                                opacity: periodStatusBusy || (activeJobId && activeJobTaxType === sec.taxType) ? 0.5 : 1 }}>
                              {periodStatusBusy === `${sec.taxType}|${period.due || 'unknown'}` ? 'Updating…' : 'Mark Sent'}
                            </button>
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ fontSize: 13, whiteSpace: 'nowrap' }}
                              disabled={submitting !== null || activeJobId !== null}
                              title={activeJobId !== null ? 'Another payment is processing — one payment at a time' : undefined}
                              onClick={e => { e.stopPropagation(); handleSubmitPeriod(period, sec.taxType); }}>
                              {sec.taxType === 'sui' ? '↓ SUI Report'
                                : activeJobId && activeJobTaxType === sec.taxType && activeJobPeriodDue === (period.due || 'unknown') ? 'Sending…'
                                : 'Pay to EFTPS'}
                            </button>
                            {sec.taxType === 'sui' && (client?.state || 'TX') === 'TX' && (
                              <button
                                className="btn btn-sm"
                                style={{ fontSize: 13, whiteSpace: 'nowrap', background: '#0369a1', color: '#fff', border: 'none' }}
                                disabled={twcPayJob?.status === 'processing'}
                                onClick={e => { e.stopPropagation(); setTwcPayModal({ amount: period.total, defaultDate: new Date(Date.now() + 86400000).toISOString().slice(0,10) }); }}>
                                Pay TWC
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Subtotal row */}
                  <tr style={{ background: '#f8f9fa', borderTop: '1px solid #e5e7eb' }}>
                    <td colSpan={4} style={{ padding: '10px 14px' }}>
                      {sec.credit < 0 && (
                        <span style={{ fontSize: 13, color: '#16a34a' }}>
                          (Credit: {fmt(sec.credit)} applied)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15, color: '#111' }}>
                      {fmt(sectionTotal)}
                    </td>
                    <td />
                  </tr>
                </React.Fragment>
              );
            })}

            {/* Total due row */}
            <tr style={{ background: '#fff', borderTop: '2px solid #9faab6' }}>
              <td colSpan={4} style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, fontSize: 13, color: '#374151' }}>Total due</td>
              <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 15, color: '#111' }}>{fmt(grandTotal)}</div>
                {csPendingTotal > 0 && (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, whiteSpace: 'nowrap' }}>incl. child support: {fmt(csPendingTotal)}</div>
                )}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  function PeriodDetailModal({ period, taxType, credit, onClose }) {
    const [statusBusy, setStatusBusy] = useState(false);
    const title = taxType === '941' ? 'Federal 941' : taxType === '940' ? 'Federal 940 (FUTA)' : 'State SUI';
    const isLate      = period.status === 'late';
    const isDueSoon   = period.status === 'due-soon';
    const isSent      = period.status === 'completed';
    const periodTotal = period.total + credit;
    const TH = { padding: '8px 14px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' };

    async function toggleAllStatus(newDbStatus) {
      setStatusBusy(true);
      const results = await Promise.allSettled(period.stubs.map(s => api.updatePaystubStatus(s.id, newDbStatus, taxType)));
      setStatusBusy(false);
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length) {
        alert(`${results.length - failed.length} of ${results.length} checks updated. ${failed.length} failed: ${failed[0].reason?.message || 'unknown error'}\nThe list reflects what actually saved.`);
      }
      onClose();
      await reload();
    }

    return (
      <ModalOverlay onClose={onClose}>
        <div className="card" style={{ width: 600, maxWidth: '96vw', maxHeight: '85vh', overflowY: 'auto', padding: 0, borderRadius: 12 }}>
          {/* Header */}
          <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 800, fontSize: 18 }}>{title}</span>
                <span style={{ color: isLate ? '#dc2626' : isDueSoon ? '#d97706' : isSent ? '#16a34a' : '#666', fontSize: 13, fontWeight: 600 }}>
                  {isLate ? 'Late' : isDueSoon ? 'Due Soon' : isSent ? '✓ Sent' : 'Upcoming'}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                IRS Deposit Due:{' '}
                <strong style={{ color: isLate ? '#dc2626' : isDueSoon ? '#d97706' : 'var(--text-primary)' }}>
                  {fmtDate(period.due)}
                </strong>
                {period.sendBy && !isSent && (
                  <span style={{ marginLeft: 10, color: 'var(--text-muted)' }}>· Send by {fmtDate(period.sendBy)}</span>
                )}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
          </div>

          {/* Check list */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                <th style={TH}>Employee</th>
                <th style={TH}>Pay Period</th>
                <th style={TH}>Pay Date</th>
                <th style={{ ...TH, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {period.stubs.map((stub, i) => {
                const amount = taxType === '941' ? (stub.total_deposit || 0)
                             : taxType === '940' ? (stub.futa_tax      || 0)
                             : (stub.suta_tax || 0);
                return (
                  <tr key={stub.id} style={{ borderBottom: '1px solid var(--border-light)', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ padding: '11px 16px', fontWeight: 600 }}>
                      {stub.employee_name || '—'}
                      {stub.check_number ? <span style={{ marginLeft: 5, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--accent)' }}>#{stub.check_number}</span> : null}
                    </td>
                    <td style={{ padding: '11px 10px', fontSize: 12, color: 'var(--text-muted)' }}>{fmtPeriod(stub.pay_period_start, stub.pay_period_end)}</td>
                    <td style={{ padding: '11px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{fmtDate(stub.settlement_date)}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{fmt(amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Credit row */}
          {credit < 0 && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', background: '#f0fdf4' }}>
              <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>Credit / Overpayment</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--success)', fontWeight: 700 }}>{fmt(credit)}</span>
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: '14px 24px', borderTop: '2px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Total  </span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 20, color: isSent ? 'var(--success)' : 'var(--accent)' }}>{fmt(periodTotal)}</span>
            </div>
            <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 13 }}>Close</button>
            {/* Status toggle */}
            {isSent ? (
              <button className="btn btn-ghost" style={{ fontSize: 13, color: '#d97706', borderColor: '#d97706' }}
                disabled={statusBusy}
                onClick={() => toggleAllStatus('pending')}>
                {statusBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Mark as Pending'}
              </button>
            ) : (
              <button className="btn btn-ghost" style={{ fontSize: 13, color: '#16a34a', borderColor: '#16a34a' }}
                disabled={statusBusy}
                onClick={() => toggleAllStatus('submitted')}>
                {statusBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '✓ Mark as Sent'}
              </button>
            )}
            {!isSent && (
              <button
                className="btn btn-primary"
                style={{ fontSize: 13 }}
                disabled={submitting !== null || activeJobId !== null}
                onClick={() => { onClose(); handleSubmitPeriod(period, taxType); }}>
                {taxType === 'sui' ? '↓ SUI Report' : 'Pay to EFTPS'}
              </button>
            )}
          </div>
        </div>
      </ModalOverlay>
    );
  }

  return (
    <div>
      {/* Frequency selectors */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>941 Deposit Schedule</div>
            <select className="form-select" value={sched941} onChange={e => setSched941(e.target.value)} style={{ fontSize: 12, height: 30, width: '100%' }}>
              <option value="monthly">Monthly — 15th of following month</option>
              <option value="semiweekly">Semi-weekly — Wed/Fri after pay date</option>
              <option value="quarterly">Quarterly — when filing Form 941</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>940 Payment Schedule</div>
            <select className="form-select" value={sched940} onChange={e => setSched940(e.target.value)} style={{ fontSize: 12, height: 30, width: '100%' }}>
              <option value="quarterly">Quarterly — if liability over $500</option>
              <option value="annually">Annually — Jan 31 (if under $500)</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>State SUI Schedule</div>
            <select className="form-select" value={schedSUI} onChange={e => setSchedSUI(e.target.value)} style={{ fontSize: 12, height: 30, width: '100%' }}>
              <option value="quarterly">Quarterly</option>
              <option value="monthly">Monthly</option>
              <option value="annually">Annually</option>
            </select>
          </div>
        </div>
      </div>

      {/* Live job status banner */}
      {activeJobId && (
        <div className="alert alert-info" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="spinner spinner-dark" style={{ width: 14, height: 14, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            {(jobStatus === 'enrollment_pending' || paystubs.some(s => s.bridge_status === 'enrollment_pending'))
              ? 'This is your first payment with us — enrollment is in progress. This can take 15 minutes to 1 hour. Please check back later.'
              : 'Payment sent — please check back in 5–10 minutes to confirm it was processed.'}
          </span>
          <button
            style={{ marginLeft: 'auto', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
            onClick={async () => {
              if (!window.confirm('Cancel the payment that is currently processing?\n\nIf it hasn’t reached EFTPS yet, it will NOT be sent and you can resubmit right away. If it may have already gone through, check the EFTPS website before paying again so you don’t double-pay.')) return;
              try {
                const r = await api.killBridgeJob();
                setActiveJobId(null); setActiveJobTaxType(null); setActiveJobPeriodDue(null);
                setJobStatus('cancelled');
                setJobMessage(r?.cancelled ? `Cancelled ${r.cancelled} job(s)` : 'Cancelled');
              } catch (e) { alert(e.message); }
            }}>
            Cancel Payment
          </button>
        </div>
      )}
      {!activeJobId && jobStatus === 'completed' && (
        <div className="alert alert-success" role="status" style={{ marginBottom: 16 }}>
          <span>✓</span>
          <span>Payment submitted to EFTPS. It settles on the scheduled date — you can confirm it on the EFTPS website.</span>
          <button onClick={() => { setJobStatus(null); setJobMessage(''); }} aria-label="Dismiss" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button>
        </div>
      )}
      {!activeJobId && jobStatus === 'cancelled' && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 16 }}>
          <span>✋</span>
          <span>Payment cancelled — this app did not send it. Ready for a fresh submission whenever you are.{jobMessage ? ` (${jobMessage})` : ''}</span>
          <button onClick={() => { setJobStatus(null); setJobMessage(''); }} aria-label="Dismiss" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button>
        </div>
      )}
      {!activeJobId && jobStatus === 'failed' && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
          <span>⚠</span>
          <span>
            The payment didn&rsquo;t go through — no money was sent.
            {jobMessage ? ` Details: ${jobMessage}` : ''} Fix the issue and resubmit, or contact support if it keeps failing.
          </span>
          <button onClick={() => { setJobStatus(null); setJobMessage(''); }} aria-label="Dismiss" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button>
        </div>
      )}
      {jobStatus !== 'failed' && paystubs.some(s => s.submission_error === 'BRIDGE_DISCONNECTED' && s.status === 'failed') && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
          <span>⚠</span>
          <span>A payment failed because the payment computer (bridge) was offline — no money was sent. Start the bridge, then resubmit the period below.</span>
        </div>
      )}
      {result && !activeJobId && jobStatus !== 'completed' && jobStatus !== 'failed' && (
        <div className={`alert ${result.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 16 }}>
          <span>{result.error ? '⚠' : '✓'}</span>
          <span>{result.error ? result.error : `Payment submitted — ${fmt(result.totalDeposit)} covering ${result.submitted} check${result.submitted !== 1 ? 's' : ''}${result.confirmation ? ` · Conf: ${result.confirmation}` : ''}`}</span>
          <button onClick={() => setResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>×</button>
        </div>
      )}

      {loadError && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="empty-state" style={{ padding: '32px 20px' }}>
            <div className="empty-state-icon">⚠</div>
            <h3>Couldn&rsquo;t load liabilities</h3>
            <p>Check your connection, then try again.</p>
            <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }}
              onClick={() => { setLoading(true); reload().finally(() => setLoading(false)); }}>
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Pending liabilities — single unified card */}
      {!loadError && <LiabilitySection
        sections={[
          { title: 'Federal 941',        taxType: '941', periods: periods941, credit: credit941 },
          { title: 'Federal 940 (FUTA)', taxType: '940', periods: periods940, credit: credit940 },
          { title: 'State SUI',          taxType: 'sui', periods: periodsSUI,  credit: 0 },
        ]}
        togglePeriodStatus={togglePeriodStatus}
      />}

      {/* Child support — vendor remittance checks, due 7 days after each pay date */}
      {!loadError && csPendingGroups.length > 0 && (
        <div className="table-scroll" style={{ background: '#fff', border: '1.5px solid #9faab6', borderRadius: 4, marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {['Vendor', 'Pay Date', 'Due', 'Employees', 'Amount', ''].map((h, i) => (
                  <th key={h || 'actions'} style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: i === 4 ? 'right' : 'left', background: '#f8f9fa', borderBottom: '1px solid #d1d5db' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: '#f8f9fa' }}>
                <td colSpan={6} style={{ padding: '9px 16px', borderLeft: '3px solid #6b7280', fontWeight: 700, fontSize: 13, color: '#374151' }}>
                  Child Support
                  {csPendingGroups.some(g => g.due && todayStr > g.due) && <span style={{ color: '#dc2626', fontWeight: 600, marginLeft: 12, fontSize: 12 }}>{csPendingGroups.filter(g => g.due && todayStr > g.due).length} overdue</span>}
                </td>
              </tr>
              {csPendingGroups.map(g => {
                const isLate = g.due && todayStr > g.due;
                const isDueSoon = !isLate && g.due && daysUntil(g.due) !== null && daysUntil(g.due) <= 3;
                const busy = csBusyKey === g.key;
                return (
                  <tr key={g.key} style={{ background: '#fff', borderTop: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '14px 14px', fontWeight: 600, color: '#374151' }}>
                      {g.vendor}
                      <div style={{ fontSize: 11.5, fontWeight: 400, color: '#9ca3af' }}>{[...new Set(g.rows.map(w => w.case_number).filter(Boolean))].map(c => `Case ${c}`).join(' · ')}</div>
                    </td>
                    <td style={{ padding: '14px 14px', color: '#374151' }}>{fmtDate(g.payDate === 'unknown' ? null : g.payDate)}</td>
                    <td style={{ padding: '14px 14px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: isLate ? '#dc2626' : isDueSoon ? '#d97706' : '#374151' }}
                      title="Child support must be remitted within 7 days of the pay date">
                      {fmtDate(g.due)}
                      {isLate && <span style={{ marginLeft: 6, fontSize: 12 }}>(Late)</span>}
                      {isDueSoon && <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 500 }}>(Due Soon)</span>}
                    </td>
                    <td style={{ padding: '14px 14px', fontSize: 13, color: '#6b7280' }}>{[...new Set(g.rows.map(w => w.employee_name).filter(Boolean))].join(', ') || g.rows.length}</td>
                    <td style={{ padding: '14px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15, color: '#111' }}>{fmt(g.total)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleCsPay(g, { print: false })}
                          disabled={csBusyKey !== null}
                          title="Record this remittance as paid outside the app"
                          style={{ background: 'none', border: 'none', color: '#16a34a', fontSize: 13, textDecoration: 'underline', padding: '2px 0', whiteSpace: 'nowrap', cursor: csBusyKey ? 'not-allowed' : 'pointer', opacity: csBusyKey ? 0.5 : 1 }}>
                          Mark Sent
                        </button>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: 13, whiteSpace: 'nowrap' }}
                          disabled={csBusyKey !== null}
                          onClick={() => handleCsPay(g, { print: true })}>
                          {busy ? 'Printing…' : '🖨 Print Check'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: '#f8f9fa', borderTop: '1px solid #e5e7eb' }}>
                <td colSpan={4} style={{ padding: '10px 14px' }} />
                <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 15 }}>{fmt(r2(csPendingGroups.reduce((s, g) => s + g.total, 0)))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!loadError && periods941.length === 0 && periods940.length === 0 && periodsSUI.length === 0 && csPendingGroups.length === 0 && (
        <div className="card">
          <div className="empty-state" style={{ padding: '32px 20px' }}>
            <div className="empty-state-icon">✓</div>
            <h3>All caught up</h3>
            <p>No pending liabilities.</p>
          </div>
        </div>
      )}

      {/* Sent child support — collapsible, with Undo and reprint */}
      {csSentGroups.length > 0 && (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', padding: '10px 14px', background: '#fff', border: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Sent child support ({csSentGroups.length}) <span style={{ float: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#16a34a', fontWeight: 700 }}>{fmt(r2(csSentGroups.reduce((s, g) => s + g.total, 0)))}</span>
          </summary>
          <div className="table-scroll" style={{ background: '#fff', border: '1px solid var(--border)', borderTop: 'none' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {csSentGroups.map(g => (
                  <tr key={g.key} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#6b7280' }}>{g.vendor}</td>
                    <td style={{ padding: '11px 14px', color: '#6b7280', fontSize: 12.5 }}>{g.checkNumber ? `Check #${g.checkNumber}` : 'Paid outside app'}{g.paidAt ? ` · ${fmtDate(g.paidAt.slice(0, 10))}` : ''}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#16a34a' }}>{fmt(g.total)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={async () => { try { await api.printChildSupportCheck(clientId, g.rows.map(w => w.id), g.checkNumber); } catch (e) { alert(e.message); } }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12.5, textDecoration: 'underline', marginRight: 10 }}>
                        Reprint
                      </button>
                      <button onClick={() => handleCsUndo(g)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 12.5, textDecoration: 'underline' }}>
                        Undo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Sent / Submitted history — single collapsible flat table */}
      {(() => {
        const sent941 = paystubs.filter(s => ISSUED.has(s.check_status) && s.status === 'submitted');
        const sent940 = paystubs.filter(s => ISSUED.has(s.check_status) && s.status_940 === 'submitted' && s.futa_tax > 0);
        const sentSUI = paystubs.filter(s => ISSUED.has(s.check_status) && s.suta_tax > 0 && (s.status_sui || 'pending') === 'submitted');
        if (sent941.length + sent940.length + sentSUI.length === 0) return null;

        function buildSentPeriods(stubs, taxType, schedule) {
          const map = {};
          stubs.forEach(s => {
            const due    = calcLiabilityDue(s, taxType, schedule);
            const sendBy = calcSendByDate(due);
            const key    = due || 'unknown';
            if (!map[key]) map[key] = { due, sendBy, status: 'completed', stubs: [], total: 0 };
            map[key].stubs.push({ ...s, _due: due, _sendBy: sendBy, _status: 'completed' });
            const amt = taxType === '941' ? (s.total_deposit || 0)
                      : taxType === '940' ? (s.futa_tax      || 0)
                      : (s.suta_tax || 0);
            map[key].total += amt;
          });
          return Object.values(map).sort((a, b) => (b.due || '').localeCompare(a.due || ''));
        }

        const sp941 = buildSentPeriods(sent941, '941', sched941);
        const sp940 = buildSentPeriods(sent940, '940', sched940);
        const spSUI = buildSentPeriods(sentSUI, 'sui', schedSUI);

        // Flatten all sent periods into one list with taxType label
        const allSent = [
          ...sp941.map(p => ({ ...p, taxType: '941', taxLabel: 'Federal 941' })),
          ...sp940.map(p => ({ ...p, taxType: '940', taxLabel: 'Federal 940' })),
          ...spSUI.map(p => ({ ...p, taxType: 'sui', taxLabel: 'State SUI'   })),
        ].sort((a, b) => (b.due || '').localeCompare(a.due || ''));

        const totalSent = allSent.reduce((s, p) => s + p.total, 0);

        function SentHistory() {
          const [open, setOpen] = useState(false);
          const TH = {
            padding: '8px 14px',
            fontSize: 11,
            fontWeight: 700,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            textAlign: 'left',
            background: '#f8f9fa',
            borderBottom: '1px solid #d1d5db',
          };
          return (
            <div className="table-scroll" style={{ background: '#fff', border: '1.5px solid #9faab6', borderRadius: 4, marginTop: 20 }}>
              {/* Collapsible header */}
              <button
                onClick={() => setOpen(o => !o)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: open ? '1px solid #d1d5db' : 'none' }}>
                <span style={{ fontSize: 11, color: '#9ca3af', transform: open ? 'rotate(90deg)' : 'rotate(0)', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#374151', flex: 1 }}>
                  Sent / Submitted ({allSent.length})
                </span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15, color: '#16a34a' }}>
                  {fmt(totalSent)}
                </span>
              </button>

              {open && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <colgroup>
                    <col style={{ width: 130 }} />
                    <col />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 60 }} />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 80 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={TH}>Tax</th>
                      <th style={TH}>Pay Dates</th>
                      <th style={TH} title="Submit the payment by this date so it settles by the IRS deadline (2 business days before the due date)">Send By</th>
                      <th style={TH}>Checks</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Amount</th>
                      <th style={TH} />
                    </tr>
                  </thead>
                  <tbody>
                    {allSent.map((period, idx) => {
                      const payDates  = [...new Set(period.stubs.map(s => s.settlement_date || s.pay_period_end).filter(Boolean))].sort();
                      const dateLabel = payDates.length === 0 ? '—'
                                      : payDates.length === 1 ? fmtDate(payDates[0])
                                      : `${fmtDate(payDates[0])} – ${fmtDate(payDates[payDates.length - 1])}`;
                      return (
                        <tr key={`${period.taxType}-${period.due || idx}`}
                          style={{ background: '#fff', borderTop: '1px solid #e5e7eb', cursor: 'pointer' }}
                          tabIndex={0} role="button" aria-label={`View sent ${period.taxLabel} period — ${fmt(period.total)}`}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPeriodModal({ period, taxType: period.taxType }); } }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#fafafa'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                          onClick={() => setPeriodModal({ period, taxType: period.taxType })}>
                          <td style={{ padding: '14px 14px', fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{period.taxLabel}</td>
                          <td style={{ padding: '14px 14px', color: '#374151' }}>{dateLabel}</td>
                          <td style={{ padding: '14px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: '#6b7280' }}
                            title={period.due ? `IRS due date: ${fmtDate(period.due)}` : undefined}>{fmtDate(period.sendBy || period.due)}</td>
                          <td style={{ padding: '14px 14px', fontSize: 14, color: '#6b7280' }}>{period.stubs.length}</td>
                          <td style={{ padding: '14px 14px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15, color: '#16a34a' }}>
                            {fmt(period.total)}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            <button
                              onClick={e => { e.stopPropagation(); togglePeriodStatus(period, period.taxType, 'pending'); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 13, textDecoration: 'underline', padding: '2px 0' }}>
                              Undo
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        }

        return <SentHistory />;
      })()}

      {/* Period detail modal */}
      {periodModal && (
        <PeriodDetailModal
          period={periodModal.period}
          taxType={periodModal.taxType}
          credit={creditForPeriod(periodModal.period, periodModal.taxType)}
          onClose={() => setPeriodModal(null)}
        />
      )}

      {/* EFTPS pay dialog (settlement-date picker; handles late liabilities) */}
      {eftpsPayModal && (
        <EftpsPayModal
          period={eftpsPayModal.period}
          taxType={eftpsPayModal.taxType}
          credit={creditForPeriod(eftpsPayModal.period, eftpsPayModal.taxType)}
          submitting={submitting !== null}
          onSubmit={(date) => submitEftpsPeriod(eftpsPayModal.period, eftpsPayModal.taxType, date)}
          onClose={() => { if (submitting === null) setEftpsPayModal(null); }}
        />
      )}

      {/* TWC Payment modal */}
      {twcPayModal && (
        <TwcPaymentModal
          client={client}
          defaultAmount={twcPayModal.amount}
          defaultDate={twcPayModal.defaultDate}
          twcPayJob={twcPayJob}
          onSubmit={async ({ amount, paymentDate }) => {
            const acctNum = client?.suiAccountNumber;
            if (!acctNum) { alert('No TWC Account Number on file. Add it in the Company tab → State Unemployment section.'); return; }
            try {
              const res = await api.createTwcPayment({ clientId, twcAccountNumber: acctNum, amount, paymentDate });
              setTwcPayJob({ id: res.id, status: res.status, confirmationNumber: res.confirmationNumber, error: res.error, bridgeOffline: res.bridgeOffline });
              if (!res.bridgeOffline) {
                clearInterval(twcPollRef.current);
                twcPollRef.current = setInterval(async () => {
                  const updated = await api.getTwcPayment(res.id).catch(() => null);
                  if (!updated) return;
                  setTwcPayJob({ id: updated.id, status: updated.status, confirmationNumber: updated.confirmationNumber, error: updated.error });
                  if (updated.status === 'completed' || updated.status === 'failed') clearInterval(twcPollRef.current);
                }, 8_000);
              }
            } catch (e) { alert(e.message); }
          }}
          onClose={() => {
            // While a payment is live (processing / awaiting CAPTCHA) the modal is the
            // only progress view and the Pay TWC button is disabled — don't let a stray
            // Escape or backdrop click dismiss it.
            if (twcPayJob && twcPayJob.status !== 'completed' && twcPayJob.status !== 'failed' && !twcPayJob.bridgeOffline) return;
            setTwcPayModal(null);
            // Clear finished jobs so the next open shows a fresh form, not a stale result.
            setTwcPayJob(prev => prev && (prev.status === 'completed' || prev.status === 'failed') ? null : prev);
          }}
          onReset={() => setTwcPayJob(null)}
          onCancelled={() => setTwcPayJob(prev => prev ? { ...prev, status: 'failed', error: 'Cancelled by user' } : prev)}
        />
      )}
    </div>
  );
}

function TwcPaymentModal({ client, defaultAmount, defaultDate, twcPayJob, onSubmit, onClose, onReset, onCancelled }) {
  const [amount, setAmount]           = useState(defaultAmount ? defaultAmount.toFixed(2) : '');
  const [paymentDate, setPaymentDate] = useState(defaultDate || '');
  const [submitting, setSubmitting]   = useState(false);

  const acctNum = client?.suiAccountNumber;
  const done    = twcPayJob?.status === 'completed' || twcPayJob?.status === 'failed';

  async function handleSubmit() {
    const amtNum = parseFloat(amount);
    if (!amtNum || amtNum <= 0) { alert('Enter a valid amount'); return; }
    if (!paymentDate) { alert('Enter a payment date'); return; }
    setSubmitting(true);
    await onSubmit({ amount: amtNum, paymentDate });
    setSubmitting(false);
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 28, width: 480, maxWidth: '94vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Pay TWC SUI Online</h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              ACH debit via TWC Unemployment Tax Services
            </p>
          </div>
          <button className="drawer-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {/* Account info */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>TWC Account</div>
          {acctNum
            ? <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{acctNum}</span>
            : <span style={{ color: '#dc2626' }}>Not set — add it in Company tab → State Unemployment</span>
          }
        </div>

        {/* Job status display */}
        {twcPayJob && (
          <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: twcPayJob.status === 'completed' ? '#f0fdf4' : twcPayJob.status === 'failed' ? '#fff5f5' : twcPayJob.status === 'needs_captcha' ? '#fffbeb' : '#f0f9ff', border: `1px solid ${twcPayJob.status === 'completed' ? '#bbf7d0' : twcPayJob.status === 'failed' ? '#fecaca' : twcPayJob.status === 'needs_captcha' ? '#fde68a' : '#bae6fd'}` }}>
            {twcPayJob.status === 'completed' && (
              <>
                <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 4 }}>Payment scheduled</div>
                {twcPayJob.confirmationNumber && <div style={{ fontSize: 13 }}>Confirmation #<strong style={{ fontFamily: 'monospace' }}>{twcPayJob.confirmationNumber}</strong></div>}
              </>
            )}
            {twcPayJob.status === 'failed' && (
              <div style={{ color: '#dc2626', fontWeight: 600 }}>Failed: {twcPayJob.error || 'Unknown error'}</div>
            )}
            {twcPayJob.status === 'needs_captcha' && (
              <div style={{ color: '#92400e', fontWeight: 600 }}>Waiting for CAPTCHA — solve it in the browser window on the payment computer, then click Logon.</div>
            )}
            {twcPayJob.status === 'queued' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#0369a1' }}>
                <span className="spinner spinner-dark" style={{ width: 14, height: 14, flexShrink: 0 }} />
                <span>Queued — waiting for the bridge to finish other payments. It will run automatically.</span>
              </div>
            )}
            {twcPayJob.status === 'processing' && !twcPayJob.confirmationNumber && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#0369a1' }}>
                <span className="spinner spinner-dark" style={{ width: 14, height: 14, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>Browser automation in progress on the payment computer…</span>
                <button
                  style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 9px', fontSize: 12, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                  onClick={async () => {
                    if (!window.confirm('Cancel this TWC payment? If it already reached the state site it may still go through — check TWC before retrying.')) return;
                    try { await api.killTwcBridgeJob(); } catch (_) {}
                    onCancelled();
                  }}>
                  Cancel Payment
                </button>
              </div>
            )}
            {twcPayJob.bridgeOffline && (
              <div style={{ color: '#92400e' }}>
                <strong>The payment computer is offline.</strong> Start it — the job is saved and will run when it reconnects.
              </div>
            )}
          </div>
        )}

        {!twcPayJob && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Amount ($)</label>
                <input className="form-input mono" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Payment Date</label>
                <input className="form-input" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              The bank on file in TWC will be used. The payment computer must be online for the payment to run.
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
          {/* A failed attempt must not brick the modal — clear the job and show the form again */}
          {twcPayJob?.status === 'failed' && onReset && (
            <button className="btn btn-primary" onClick={onReset}>Try Again</button>
          )}
          {!twcPayJob && (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || !acctNum}>
              {submitting ? 'Sending…' : 'Submit Payment'}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── EFTPS pay dialog ─────────────────────────────────────────────────────────
// Replaces the plain confirm for 941/940 payments. Its job: a valid settlement
// date every time. EFTPS rejects past dates outright, so paying a LATE liability
// defaults to the earliest acceptable business day and the date stays editable.
function EftpsPayModal({ period, taxType, credit, submitting, onSubmit, onClose }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const minBiz = (() => { let d = addDays(new Date(), 1); while (!isBizDay(d)) d = addDays(d, 1); return d.toISOString().slice(0, 10); })();
  const isLate = !!(period.due && period.due < todayStr);
  const [date, setDate] = useState(() => (period.due && period.due >= minBiz) ? period.due : minBiz);
  const amt = r2(period.total + (credit || 0));
  const label = taxType === '940' ? 'Federal 940 (FUTA)' : 'Federal 941';
  const dateObj = date ? new Date(date + 'T00:00:00') : null;
  const nonBiz = dateObj && !isBizDay(dateObj);
  const tooEarly = date && date < minBiz;
  const suggested = dateObj && nonBiz ? nextBizDay(dateObj).toISOString().slice(0, 10) : null;
  const invalid = !date || nonBiz || tooEarly;

  return (
    <ModalOverlay onClose={onClose}>
      <div className="card" style={{ width: 460, maxWidth: '94vw', padding: 24 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Pay {label} to EFTPS</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          {period.stubs.length} check{period.stubs.length === 1 ? '' : 's'}
          {period.due ? <> · originally due <strong style={{ color: isLate ? '#dc2626' : 'inherit' }}>{fmtDate(period.due)}</strong></> : null}
        </div>

        {isLate && (
          <div className="alert alert-warning" style={{ marginBottom: 14, fontSize: 12.5 }}>
            <span>⚠</span>
            <span>This deposit&rsquo;s due date has passed — EFTPS won&rsquo;t accept a past date. It will settle on the day you pick below (earliest: {fmtDate(minBiz)}). Late-deposit penalties/interest, if any, are assessed by the IRS separately.</span>
          </div>
        )}

        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Period total</span><span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{fmt(period.total)}</span></div>
          {credit ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)' }}><span>Credit applied</span><span style={{ fontFamily: 'JetBrains Mono, monospace' }}>−{fmt(-credit)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6, fontWeight: 700 }}><span>To submit</span><span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmt(amt)}</span></div>
            </>
          ) : null}
        </div>

        <div className="form-group" style={{ marginBottom: 6 }}>
          <label className="form-label">Settlement date <span style={{ fontWeight: 400, fontSize: 10, textTransform: 'none', color: 'var(--text-muted)' }}>(when the IRS pulls the money)</span></label>
          <input className="form-input" type="date" value={date} min={minBiz} onChange={e => setDate(e.target.value)} style={{ maxWidth: 200 }} />
        </div>
        {tooEarly && <p style={{ fontSize: 12, color: '#dc2626', margin: '0 0 8px' }}>Earliest possible settlement is {fmtDate(minBiz)} — EFTPS needs at least one business day.</p>}
        {!tooEarly && nonBiz && suggested && (
          <p style={{ fontSize: 12, color: '#d97706', margin: '0 0 8px' }}>
            That&rsquo;s a weekend or federal holiday — use{' '}
            <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 12, padding: 0 }} onClick={() => setDate(suggested)}>{fmtDate(suggested)}</button>
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary" disabled={submitting || invalid} onClick={() => onSubmit(date)}>
            {submitting ? 'Submitting…' : `Submit ${fmt(amt)}`}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── File Forms Sub-tab ────────────────────────────────────────────────────────
function FileFormsTab({ clientId }) {
  const navigate    = useNavigate();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [filings, setFilings] = useState({});
  useEffect(() => {
    let live = true;
    setFilings({}); // never show the previous company's filing badges while (re)loading
    api.getFormFilings(clientId)
      .then(rows => { if (live && Array.isArray(rows)) setFilings(Object.fromEntries(rows.map(r => [r.formKey, r.status]))); })
      .catch(() => {});
    return () => { live = false; };
  }, [clientId, year]);
  const setFiling = (formKey, status, quiet = false) => {
    const prev = filings[formKey];
    setFilings(f => { const next = { ...f }; if (status) next[formKey] = status; else delete next[formKey]; return next; });
    api.setFormFiling(clientId, formKey, status).catch(e => {
      setFilings(f => { const next = { ...f }; if (prev) next[formKey] = prev; else delete next[formKey]; return next; });
      if (!quiet) window.alert(`Couldn’t update the filing status: ${e.message || 'try again.'}`);
    });
  };
  const qDue = { 1: 'Apr 30', 2: 'Jul 31', 3: 'Oct 31', 4: 'Jan 31' };
  const statusCls = { Past: 'badge-neutral', Due: 'badge-warning', Upcoming: 'badge-neutral' };
  // Status comes from the actual filing window, not the calendar quarter: a form is
  // 'Due' from the moment its period ends until its deadline, 'Past' only after the
  // deadline. (The old `q < currentQ → Past` logic marked Q2's 941 "Past" in July,
  // 9 days before its Jul 31 deadline.)
  const todayStr = new Date().toISOString().slice(0, 10);
  const qEnd      = (y, q) => [`${y}-03-31`, `${y}-06-30`, `${y}-09-30`, `${y}-12-31`][q - 1];
  const qDeadline = (y, q) => q === 4 ? `${y + 1}-01-31` : [`${y}-04-30`, `${y}-07-31`, `${y}-10-31`][q - 1];
  const quarterStatus = (y, q) => todayStr > qDeadline(y, q) ? 'Past' : todayStr > qEnd(y, q) ? 'Due' : 'Upcoming';
  const annualStatus  = (y) => todayStr > `${y + 1}-01-31` ? 'Past' : todayStr > `${y}-12-31` ? 'Due' : 'Upcoming';
  const twcStatus = [1, 2, 3, 4].some(q => quarterStatus(year, q) === 'Due') ? 'Due'
                  : [1, 2, 3, 4].every(q => quarterStatus(year, q) === 'Past') ? 'Past' : 'Upcoming';
  const forms = [
    ...[1,2,3,4].map(q => ({ id: `941-${year}-q${q}`, name: `Form 941 — Q${q} ${year}`, desc: 'Federal Payroll Tax Return', due: `${qDue[q]}, ${q === 4 ? year + 1 : year}`, status: quarterStatus(year, q), action: () => navigate(`/reports?clientId=${clientId}&form=941&year=${year}&quarter=${q}`) })),
    { id: `940-${year}`, name: `Form 940 — ${year}`, desc: 'FUTA Annual Return', due: `Jan 31, ${year + 1}`, status: annualStatus(year), action: () => navigate(`/reports?clientId=${clientId}&form=940&year=${year}`) },
    { id: `w2-${year}`,  name: `W-2 — ${year}`,     desc: 'Wage and Tax Statement (per employee)', due: `Jan 31, ${year + 1}`, status: annualStatus(year), action: () => navigate(`/reports?clientId=${clientId}&form=w2&year=${year}`) },
    { id: `w3-${year}`,  name: `W-3 — ${year}`,     desc: 'Transmittal of Wage and Tax Statements', due: `Jan 31, ${year + 1}`, status: annualStatus(year), action: () => navigate(`/reports?clientId=${clientId}&form=w3&year=${year}`) },
    { id: `twc-${year}`, name: `State WC — ${year}`, desc: 'State Workforce Commission (SUI)', due: 'Quarterly', status: twcStatus, action: () => navigate(`/reports?clientId=${clientId}&form=twc&year=${year}`) },
  ];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Tax Year</span>
        <select className="form-select" value={year} onChange={e => setYear(parseInt(e.target.value))} style={{ width: 120 }}>{[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}</select>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/reports?clientId=${clientId}&tab=preparer`)}>Preparer Info</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {forms.map(f => {
          const filing = filings[f.id];
          return (
            <div key={f.id} className="form-file-row">
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{f.desc}</div></div>
              {filing === 'filed'
                ? <span className="badge badge-success">Filed ✓</span>
                : f.status === 'Past'
                  ? <span className="badge badge-error">Past — not filed</span>
                  : filing === 'generated'
                    ? <span className="badge badge-neutral">Generated</span>
                    : <span className={`badge ${statusCls[f.status]}`}>{f.status}</span>}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Due {f.due}</div>
              <button type="button" onClick={() => setFiling(f.id, filing === 'filed' ? null : 'filed')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--accent)', fontWeight: 600, padding: 0, flexShrink: 0 }}>
                {filing === 'filed' ? 'Mark not filed' : 'Mark filed'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { if (!filing) setFiling(f.id, 'generated', true); f.action(); }}>Generate / View</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── Payroll Tab ───────────────────────────────────────────────────────────────
function PayrollTab({ clientId, client, employees, onRefresh, refreshEmployees, refreshTick = 0, onGoToEmployees }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  // Deep link wins, then the sub-tab the user last had open for this company —
  // refreshes and workspace-tab switches must come back to the same screen.
  const [sub, setSub] = useState(() => {
    const t = searchParams.get('tab');
    if (t === 'pay' || t === 'liabilities' || (t === 'forms' && user?.role !== 'client')) return t;
    return sessionStorage.getItem(`paySub_${clientId}`) || 'pay';
  });
  useEffect(() => { sessionStorage.setItem(`paySub_${clientId}`, sub); }, [sub, clientId]);
  // While Payroll is active this component owns ?tab= so sub-tabs deep-link.
  useEffect(() => {
    setSearchParams(prev => { prev.set('tab', sub); return prev; }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);
  // File Forms navigates to admin-only report pages — a dead end for business-owner
  // (client-ROLE) logins, so don't offer it to them. Gate on role, not the /company
  // route: accountants can open /company/:id too and must keep File Forms.
  const subTabs = [['pay','Pay Employees'],['liabilities','Pay Liabilities'],...(user?.role !== 'client' ? [['forms','File Forms']] : [])];
  return (
    <div>
      <div className="pay-subtabs" role="tablist" aria-label="Payroll sections">
        {subTabs.map(([k, label]) => <button key={k} role="tab" aria-selected={sub === k} data-tour-id={k === 'liabilities' ? 'tour-liabilities-tab' : undefined} className={`pay-subtab${sub === k ? ' active' : ''}`} onClick={() => setSub(k)}>{label}</button>)}
      </div>
      {sub === 'pay'         && <PayEmployeesTab clientId={clientId} client={client} employees={employees} onRefresh={onRefresh} refreshEmployees={refreshEmployees} refreshTick={refreshTick} onGoToEmployees={onGoToEmployees} />}
      {sub === 'liabilities' && <PayLiabilitiesTab clientId={clientId} client={client} refreshTick={refreshTick} />}
      {sub === 'forms'       && <FileFormsTab clientId={clientId} />}
    </div>
  );
}

// ── Main Workspace ────────────────────────────────────────────────────────────
const WS_TAB_KEY = 'ws_activeTab';

// ── Accountants Panel — invite additional accountants to manage this company ────
function AccountantsPanel({ clientId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  async function load() {
    if (!clientId) return;
    setLoading(true);
    try { setData(await api.getClientAccountants(clientId)); setErr(''); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  async function generate() {
    setBusy(true); setErr('');
    try { setData(await api.inviteAccountant(clientId)); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  async function cancelInvite(code) {
    try { setData(await api.cancelAccountantInvite(clientId, code)); } catch (e) { setErr(e.message); }
  }
  async function revoke(userId, name) {
    if (!window.confirm(`Remove ${name}'s access to this company? They lose access immediately.`)) return;
    try { setData(await api.revokeAccountant(clientId, userId)); } catch (e) { setErr(e.message); }
  }
  function copy(text) { navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(''), 1500); }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" /></div>;

  const owner = data?.owner;
  const linked = data?.accountants || [];
  const pending = data?.pendingInvites || [];

  const Row = ({ name, email, primary, onRemove }) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border)', gap: 14 }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{(name?.[0] || '?').toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
        {email && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{email}</div>}
      </div>
      {primary ? <span className="badge badge-neutral">Primary</span>
               : <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} onClick={onRemove}>Remove</button>}
    </div>
  );

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Accountants</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.5 }}>
        Invite one or more accountants to manage this company from their own logins.
      </p>
      {err && <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 13 }}><span>⚠</span>{err}</div>}

      <div className="card" style={{ borderLeft: '4px solid var(--accent)', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Invite an accountant</div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px', maxWidth: 560 }}>
          Generate a one-time code and send it to your accountant. They enter it under “🔗 Connect a company” on their own dashboard. Codes expire in 14 days.
        </p>
        <button className="btn btn-primary btn-sm" onClick={generate} disabled={busy}>{busy ? 'Generating…' : '+ Generate invite code'}</button>
        {pending.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map(p => (
              <div key={p.code} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--accent)', background: 'var(--accent-light)', padding: '6px 14px' }}>{p.code}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => copy(p.code)}>{copied === p.code ? 'Copied!' : 'Copy'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => cancelInvite(p.code)} style={{ color: '#dc2626' }}>Cancel</button>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>expires {p.expiresAt ? new Date(p.expiresAt).toLocaleDateString() : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>Accountants with access</div>
        {owner && <Row name={owner.username} email={owner.email} primary />}
        {linked.map(a => <Row key={a.userId} name={a.username} email={a.email} onRemove={() => revoke(a.userId, a.username)} />)}
        {linked.length === 0 && <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-muted)' }}>No additional accountants yet.</div>}
      </div>
    </div>
  );
}

// ── Users Panel (admin only) ──────────────────────────────────────────────────
function UsersPanel() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    try { setUsers(await api.getUsers()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreateError('');
    if (!newUsername.trim()) { setCreateError('Username is required'); return; }
    if (newPassword.length < 6) { setCreateError('Password must be at least 6 characters'); return; }
    setCreating(true);
    try {
      await api.createUser(newUsername.trim(), newPassword);
      setNewUsername('');
      setNewPassword('');
      await loadUsers();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(u) {
    if (!window.confirm(`Delete user "${u.username}"? All their data will be permanently removed.`)) return;
    try {
      await api.deleteUser(u.id);
      await loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner spinner-dark" /></div>;
  if (error) return <div style={{ padding: 24, color: 'var(--danger)' }}>{error}</div>;

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>User Management</h2>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>Users</div>
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Username</th>
              <th>Created</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.username}{u.id === 1 && <span style={{ marginLeft: 6, fontSize: 11, background: 'var(--accent-light)', color: 'var(--accent)', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>admin</span>}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                <td>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={u.id === 1 || u.id === currentUser?.id}
                    onClick={() => handleDelete(u)}
                    title={u.id === 1 ? 'Cannot delete admin' : u.id === currentUser?.id ? 'Cannot delete yourself' : `Delete ${u.username}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>Create User</div>
        <form onSubmit={handleCreate} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {createError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{createError}</div>}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Username</label>
              <input
                className="form-control"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                placeholder="e.g. jsmith"
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Password</label>
              <input
                className="form-control"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min. 6 characters"
                autoComplete="new-password"
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CompanyWorkspace({ clientMode = false }) {
  const { user, logout } = useAuth();
  const { id: paramId } = useParams(), location = useLocation(), navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  // In clientMode, use the param id (which equals user.clientId via routing)
  const id = paramId || (clientMode ? String(user?.clientId) : null);

  const [client, setClient]       = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [inviteUrl, setInviteUrl]   = useState('');
  const [inviting, setInviting]     = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    // ?tab= in the URL wins so tabs are bookmarkable/shareable — but only known
    // values (an unknown value would render a blank workspace body).
    const KNOWN = ['employees', 'company', 'payroll', 'accountants', 'users'];
    let t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'liabilities' || t === 'pay' || t === 'forms') t = 'payroll'; // sub-tab deep links live under Payroll
    if (t && KNOWN.includes(t)) return t;
    const fallback = location.state?.tab || sessionStorage.getItem(`${WS_TAB_KEY}_${id}`) || 'employees';
    return KNOWN.includes(fallback) ? fallback : 'employees';
  });

  useEffect(() => {
    sessionStorage.setItem(`${WS_TAB_KEY}_${id}`, activeTab);
    // Keep the URL in sync (replace, not push — tab flips shouldn't spam history).
    // While Payroll is active its sub-tabs own ?tab= ('pay' | 'liabilities' |
    // 'forms') — PayrollTab writes it, so don't clobber it with 'payroll'.
    if (activeTab === 'payroll') return;
    setSearchParams(prev => { prev.set('tab', activeTab); return prev; }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  useEffect(() => { if (id) loadAll(); }, [id]);

  // Browser-tab title: with several companies open, every tab said just "PayrollTax Pro"
  useEffect(() => {
    if (client?.businessName) document.title = `${client.businessName} · PayrollTax Pro`;
    return () => { document.title = 'PayrollTax Pro'; };
  }, [client?.businessName]);

  async function loadAll() {
    try { const [c, emps] = await Promise.all([api.getClient(id), api.getEmployees(id)]); setClient(c); setEmployees(emps); }
    catch (e) { alert(e.message); if (!clientMode) navigate('/'); }
    finally { setLoading(false); }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
      setRefreshTick(t => t + 1);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleInviteClient() {
    setInviting(true);
    try {
      const data = await api.inviteClient(id);
      setInviteUrl(data.inviteUrl);
    } catch (err) {
      alert(err.message);
    } finally {
      setInviting(false);
    }
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: clientMode ? '100vh' : '100%', padding: 60 }}><div className="spinner spinner-dark" style={{ width: 36, height: 36 }} /></div>;

  // Self-registered companies that haven't finished onboarding get redirected to the wizard
  if (clientMode && client?.selfRegistered && !client?.onboardingDone) {
    navigate('/onboarding', { replace: true });
    return null;
  }

  return (
    <div className="workspace" style={clientMode ? { height: '100vh', display: 'flex', flexDirection: 'column' } : {}}>

      {/* Client-mode top nav (replaces the admin Layout nav) */}
      {clientMode && (
        <div style={{
          height: 'var(--nav-h)', background: 'var(--accent)',
          display: 'flex', alignItems: 'center', padding: '0 24px',
          gap: 14, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.4px' }}>
            Payroll<span style={{ color: '#7ca4e0' }}>Tax</span> Pro
          </div>
          {client?.businessName && (
            <>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18 }}>|</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{client.businessName}</div>
            </>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{user?.email || user?.username}</span>
          <button onClick={logout} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '5px 14px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      )}

      <div className="workspace-header">
        <div className="workspace-title-row">
          {!clientMode && <Link to="/" className="workspace-back">← All Companies</Link>}
          <div><div className="workspace-name">{client?.businessName}</div></div>
          <span className="workspace-ein">EIN {client?.ein}</span>
          <div style={{ flex: 1 }} />
          {client?.joinCode && (
            <div
              title="Share this join code with employees so they can self-register"
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 12 }}
            >
              <span style={{ color: 'var(--text-muted)' }}>Employee code:</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em' }}>{client.joinCode}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(client.joinCode)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, padding: '0 2px' }}
                title="Copy code"
              >⧉</button>
            </div>
          )}
          {!clientMode && (
            <button
              onClick={handleInviteClient}
              disabled={inviting}
              title="Generate invite link for client portal"
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: inviting ? 'default' : 'pointer', padding: '3px 10px', color: 'var(--text-secondary)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              ✉ {inviting ? '…' : 'Invite Client'}
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh data"
            style={{ background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer', padding: '4px 6px', borderRadius: 6, color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', opacity: refreshing ? 0.5 : 1 }}
          >
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }}>↻</span>
          </button>
        </div>
        {!clientMode && inviteUrl && (
          <div style={{ padding: '8px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Client invite link:</span>
            <input
              readOnly
              value={inviteUrl}
              onFocus={e => e.target.select()}
              style={{ flex: 1, minWidth: 200, fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'monospace', background: 'var(--bg-primary)' }}
            />
            <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(inviteUrl)} style={{ fontSize: 11 }}>Copy</button>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }} onClick={() => setInviteUrl('')}>×</button>
          </div>
        )}
        <div className="ws-tabs" role="tablist" aria-label="Company sections">
          {[['employees','Employees'],['company','Company'],['payroll','Payroll'],['accountants','Accountants'],...(!clientMode && user?.username === 'admin' ? [['users','Users']] : [])].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={activeTab === k} className={`ws-tab${activeTab === k ? ' active' : ''}`} onClick={() => setActiveTab(k)} data-tour-id={k === 'payroll' ? 'tour-payroll-tab-btn' : k === 'employees' ? 'tour-employees-tab-btn' : undefined}>
              {label}
              {k === 'employees' && employees.length > 0 && <span style={{ marginLeft: 6, background: activeTab === k ? 'var(--accent)' : 'var(--bg-tertiary)', color: activeTab === k ? '#fff' : 'var(--text-muted)', borderRadius: 20, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{employees.length}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="workspace-body">
        {activeTab === 'employees' && <EmployeesTab clientId={id} employees={employees} onRefresh={handleRefresh} clientMode={clientMode} />}
        {activeTab === 'company'   && <CompanyTab client={client} onSaved={loadAll} />}
        {activeTab === 'payroll'   && <PayrollTab clientId={id} client={client} employees={employees} onRefresh={handleRefresh} refreshEmployees={loadAll} refreshTick={refreshTick} onGoToEmployees={() => setActiveTab('employees')} />}
        {activeTab === 'accountants' && <AccountantsPanel clientId={id} />}
        {activeTab === 'users'     && user?.username === 'admin' && <UsersPanel />}
      </div>
    </div>
  );
}
