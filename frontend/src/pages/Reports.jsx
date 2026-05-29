import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];
const QUARTERS = [1, 2, 3, 4];
const QUARTER_LABELS = { 1: 'Q1 (Jan–Mar)', 2: 'Q2 (Apr–Jun)', 3: 'Q3 (Jul–Sep)', 4: 'Q4 (Oct–Dec)' };
const REPORT_TYPES = [
  { value: '941', label: 'Form 941',   subtitle: "Employer's Quarterly Federal Tax Return" },
  { value: '940', label: 'Form 940',   subtitle: "Employer's Annual FUTA Tax Return" },
  { value: 'twc', label: 'TWC / SUTA', subtitle: 'Texas Workforce Commission Quarterly Report' },
  { value: 'w2',  label: 'W-2',        subtitle: 'Employee Wage and Tax Statement' },
  { value: 'w3',  label: 'W-3',        subtitle: 'Transmittal of Wage and Tax Statements' },
];

// Preparer info is loaded from the server and passed as a prop to form components.
// An empty object means no preparer info has been saved — those sections are left blank.

function fmt(n) {
  const v = Number(n || 0);
  return v === 0 ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtZ(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  return `${(Number(n || 0) * 100).toFixed(5)}`;
}
function fmtAmt(n) {
  return `$${fmtZ(n)}`;
}

// ── Shared IRS form styles ────────────────────────────────────────────────────
const F = {
  doc:        { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 9, color: '#000', background: '#fff', border: '2px solid #000', marginBottom: 32, pageBreakAfter: 'always' },
  topbar:     { borderBottom: '2px solid #000', display: 'flex', alignItems: 'stretch' },
  topLeft:    { flex: 1, padding: '5px 8px', borderRight: '1px solid #000' },
  topRight:   { padding: '5px 8px', minWidth: 200 },
  formNum:    { fontSize: 18, fontWeight: 900, letterSpacing: -0.5 },
  formSub:    { fontSize: 8.5, color: '#444' },
  dept:       { fontSize: 8, color: '#666', marginTop: 1 },
  omb:        { fontSize: 8, marginTop: 2 },
  qLabel:     { fontSize: 8, fontWeight: 700, marginBottom: 3 },
  qOpt:       { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, fontSize: 8 },
  qBox:       { width: 10, height: 10, border: '1px solid #000', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, flexShrink: 0 },
  fieldLbl:   { fontSize: 7.5, color: '#555', marginBottom: 1 },
  fieldVal:   { fontSize: 10.5, fontWeight: 700, fontFamily: '"Courier New",monospace', borderBottom: '1px solid #aaa', minHeight: 13, paddingBottom: 1, marginBottom: 3 },
  partHdr:    { background: '#d0d0d0', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '2px 8px', fontWeight: 700, fontSize: 8.5 },
  note:       { padding: '2px 8px', fontSize: 7.5, color: '#555', borderBottom: '1px solid #e0e0e0', background: '#fafafa' },
  line:       { display: 'flex', borderBottom: '1px solid #e0e0e0', alignItems: 'stretch', minHeight: 18 },
  lineNum:    { width: 22, background: '#f3f3f3', borderRight: '1px solid #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, flexShrink: 0, color: '#333' },
  lineLbl:    { flex: 1, padding: '2px 6px', fontSize: 8.5, display: 'flex', alignItems: 'center' },
  lineVal:    { width: 115, borderLeft: '1px solid #aaa', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '2px 6px', fontFamily: '"Courier New",monospace', fontSize: 9.5, fontWeight: 600 },
  lineValHL:  { background: '#eef3ff', fontWeight: 800 },
  ssLine:     { display: 'flex', borderBottom: '1px solid #e0e0e0', alignItems: 'center', minHeight: 20, padding: '1px 6px 1px 0' },
  ssNum:      { width: 22, textAlign: 'center', fontSize: 8, fontWeight: 700, color: '#333', flexShrink: 0 },
  ssLbl:      { flex: 1, fontSize: 8.5, padding: '0 6px' },
  ssCol1:     { width: 95, textAlign: 'right', fontFamily: '"Courier New",monospace', fontSize: 9, paddingRight: 4 },
  ssMult:     { width: 64, textAlign: 'center', fontSize: 7.5, color: '#555' },
  ssCol2:     { width: 95, textAlign: 'right', fontFamily: '"Courier New",monospace', fontSize: 9, borderLeft: '1px solid #aaa', paddingLeft: 6, paddingRight: 4 },
  prepBlk:    { borderTop: '2px solid #000', padding: '5px 8px', background: '#f8f8f8' },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function IrsLine({ num, label, value, highlight }) {
  return (
    <div style={{ ...F.line, background: highlight ? '#eef3ff' : 'transparent' }}>
      <div style={F.lineNum}>{num}</div>
      <div style={F.lineLbl}>{label}</div>
      <div style={{ ...F.lineNum, borderLeft: '1px solid #aaa', width: 20, fontWeight: 400, fontSize: 7.5 }}>{num}</div>
      <div style={{ ...F.lineVal, ...(highlight ? F.lineValHL : {}) }}>{value}</div>
    </div>
  );
}

function SSLine({ num, label, wages, rate, tax }) {
  return (
    <div style={F.ssLine}>
      <div style={F.ssNum}>{num}</div>
      <div style={F.ssLbl}>{label}</div>
      <div style={F.ssCol1}>{wages != null && wages > 0 ? fmtZ(wages) : ''}</div>
      <div style={F.ssMult}>{rate}</div>
      <div style={F.ssCol2}>{tax != null && tax > 0 ? fmtZ(tax) : ''}</div>
    </div>
  );
}

function EntityBlock({ client, rightContent }) {
  return (
    <div style={{ borderBottom: '1px solid #000' }}>
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>Name (not your trade name)</div>
          <div style={F.fieldVal}>{client.businessName}</div>
          <div style={F.fieldLbl}>Trade name (if any)</div>
          <div style={{ ...F.fieldVal, minWidth: 280 }}>{client.tradeName || ''}</div>
        </div>
        <div style={{ padding: '4px 8px', minWidth: 210 }}>
          <div style={F.fieldLbl}>Employer identification number (EIN)</div>
          <div style={F.fieldVal}>{client.ein}</div>
          {rightContent}
        </div>
      </div>
      <div style={{ borderTop: '1px solid #ddd', padding: '3px 8px' }}>
        <div style={F.fieldLbl}>Address</div>
        <div style={{ ...F.fieldVal, maxWidth: 400 }}>{client.businessAddress || ''}</div>
      </div>
      <div style={{ borderTop: '1px solid #ddd', display: 'flex', gap: 16, padding: '3px 8px 4px' }}>
        <div style={{ flex: 3 }}>
          <div style={F.fieldLbl}>City</div>
          <div style={F.fieldVal}>{client.businessCity || ''}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={F.fieldLbl}>State</div>
          <div style={F.fieldVal}>{client.state || 'TX'}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={F.fieldLbl}>ZIP code</div>
          <div style={F.fieldVal}>{client.businessZip || ''}</div>
        </div>
      </div>
    </div>
  );
}

function DesigneeSection({ pr }) {
  const pin = (pr?.desgPin || '').split('');
  const hasInfo = pr?.desgName || pr?.desgPhone;
  return (
    <div style={{ padding: '4px 8px', fontSize: 8, borderBottom: '1px solid #ddd' }}>
      {hasInfo ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ border: '1px solid #000', padding: '0 3px', background: '#000', color: '#fff', fontSize: 7 }}>✓</span>
            <strong>Yes.</strong>
          </div>
          <div>Designee's name: <strong>{pr.desgName}</strong> &nbsp; Phone: {pr.desgPhone}</div>
          {pin.length > 0 && (
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              PIN:&nbsp;
              {pin.map((d, i) => (
                <span key={i} style={{ border: '1px solid #000', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>{d}</span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: '#aaa', fontStyle: 'italic' }}>No designee information saved — add via Preparer Info tab.</div>
      )}
    </div>
  );
}

function SignatureBlock({ pr }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '4px 8px', borderBottom: '1px solid #ddd', fontSize: 8 }}>
      <div>
        <div style={F.fieldLbl}>Sign your name here</div>
        <div style={{ borderBottom: '1px solid #000', height: 18, marginBottom: 4, fontSize: 7.5, color: '#888' }}>EF ONLY — You do not need to sign this form</div>
        <div style={F.fieldLbl}>Print your name here</div>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>{pr?.name || ''}</div>
        <div style={F.fieldLbl}>Print your title here</div>
        <div>{pr?.title || ''}</div>
      </div>
      <div>
        <div style={F.fieldLbl}>Date</div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</div>
        <div style={F.fieldLbl}>Best daytime phone</div>
        <div>{pr?.phone || ''}</div>
      </div>
    </div>
  );
}

function PreparerBlock({ pr }) {
  return (
    <div style={F.prepBlk}>
      <div style={{ fontWeight: 700, fontSize: 8.5, marginBottom: 4 }}>Paid Preparer Use Only</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 8.5 }}>
        <div>
          <div style={F.fieldLbl}>Preparer's name</div>
          <div style={{ marginBottom: 3 }}>{pr?.name || ''}</div>
          <div style={F.fieldLbl}>Preparer's signature</div>
          <div style={{ borderBottom: '1px solid #999', height: 14, marginBottom: 3 }}></div>
          <div style={F.fieldLbl}>Firm's name (or yours if self-employed)</div>
          <div style={{ marginBottom: 3 }}>{pr?.firmName || ''}</div>
          <div style={F.fieldLbl}>Address</div>
          <div>{[pr?.firmAddress, pr?.firmCity, pr?.firmState, pr?.firmZip].filter(Boolean).join(', ')}</div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
            <span style={F.qBox}></span> <span style={{ fontSize: 8 }}>Check if self-employed</span>
          </div>
          <div style={F.fieldLbl}>PTIN</div>
          <div style={{ marginBottom: 3 }}>{pr?.ptin || ''}</div>
          <div style={F.fieldLbl}>Date</div>
          <div style={{ marginBottom: 3 }}>{new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</div>
          <div style={F.fieldLbl}>EIN</div>
          <div style={{ marginBottom: 3 }}>{pr?.firmEin || ''}</div>
          <div style={F.fieldLbl}>Phone</div>
          <div>{pr?.firmPhone || ''}</div>
        </div>
      </div>
    </div>
  );
}

const Q_NAME_LABELS = {
  1: '1: January, February, March',
  2: '2: April, May, June',
  3: '3: July, August, September',
  4: '4: October, November, December',
};

// ── Form 941 ──────────────────────────────────────────────────────────────────
function Report941({ data, pr }) {
  const { client, period, lines, submissions } = data;
  const q = period.quarter;
  const line5e = (lines.line5a_ssTax || 0) + (lines.line5c_medTax || 0);

  return (
    <div style={F.doc}>
      {/* Top bar */}
      <div style={F.topbar}>
        <div style={F.topLeft}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={F.formNum}>Form 941</span>
            <span style={F.formSub}>(Rev. March 2026)</span>
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 700 }}>Employer's QUARTERLY Federal Tax Return</div>
          <div style={F.dept}>Department of the Treasury — Internal Revenue Service</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={F.omb}>950126</span>
            <span style={F.omb}>OMB No. 1545-0029</span>
          </div>
        </div>
        <div style={F.topRight}>
          <div style={F.qLabel}>Report for this Quarter of {period.year} (Check one.)</div>
          {[1,2,3,4].map((n) => (
            <div key={n} style={F.qOpt}>
              <span style={{ ...F.qBox, background: n === q ? '#000' : 'transparent', color: '#fff' }}>{n === q ? '✓' : ''}</span>
              <span>{Q_NAME_LABELS[n]}</span>
            </div>
          ))}
          <div style={{ marginTop: 4, fontSize: 7.5, color: '#555' }}>Aggregate Return Filers Only</div>
          <div style={{ fontSize: 7.5, color: '#555' }}>Type of filer (check one): Other Third Party</div>
        </div>
      </div>

      <EntityBlock client={client} rightContent={null} />

      <div style={F.note}>Read the separate instructions before you complete Form 941. Type or print within the boxes.</div>

      {/* Part 1 */}
      <div style={F.partHdr}>Part 1: Answer these questions for this quarter.</div>
      <div style={F.note}>Employers in American Samoa, Guam, the CNMI, U.S. Virgin Islands, and Puerto Rico must skip lines 2 and 3, unless you have employees subject to U.S. income tax withholding.</div>

      {/* Line 1 — employee count */}
      <div style={F.line}>
        <div style={F.lineNum}>1</div>
        <div style={F.lineLbl}>
          Number of employees who received wages, tips, or other compensation for the pay period
          including: {q === 1 ? 'Mar. 12' : q === 2 ? 'June 12' : q === 3 ? 'Sept. 12' : 'Dec. 12'}
        </div>
        <div style={{ ...F.lineNum, borderLeft: '1px solid #aaa', width: 18, fontWeight: 400, fontSize: 7.5 }}>1</div>
        <div style={{ ...F.lineVal, width: 70 }}>{lines.line1_employees || ''}</div>
      </div>

      <IrsLine num="2"  label="Wages, tips, and other compensation" value={fmt(lines.line2_wages)} />
      <IrsLine num="3"  label="Federal income tax withheld from wages, tips, and other compensation" value={fmt(lines.line3_fitWithheld)} />

      {/* Line 4 */}
      <div style={{ ...F.line, minHeight: 16 }}>
        <div style={F.lineNum}>4</div>
        <div style={F.lineLbl}>
          If no wages, tips, and other compensation are subject to social security or Medicare tax &nbsp;
          <span style={{ border: '1px solid #777', padding: '0 3px', fontSize: 7.5 }}>□</span>&nbsp;
          Check here and go to line 6.
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'flex', background: '#f0f0f0', borderBottom: '1px solid #ddd', padding: '1px 0 1px 22px', alignItems: 'center' }}>
        <div style={{ flex: 1, fontSize: 7.5, fontWeight: 700, paddingLeft: 6 }}>&nbsp;</div>
        <div style={{ width: 95, textAlign: 'center', fontSize: 7.5, fontWeight: 700 }}>Column 1</div>
        <div style={{ width: 64 }}></div>
        <div style={{ width: 95, textAlign: 'center', fontSize: 7.5, fontWeight: 700 }}>Column 2</div>
      </div>

      <SSLine num="5a" label="Taxable social security wages" wages={lines.line5a_ssWages} rate="× 0.124 =" tax={lines.line5a_ssTax} />
      <SSLine num="5b" label="Taxable social security tips" wages={null} rate="× 0.124 =" tax={null} />
      <SSLine num="5c" label="Taxable Medicare wages &amp; tips" wages={lines.line5c_medWages} rate="× 0.029 =" tax={lines.line5c_medTax} />
      <SSLine num="5d" label="Taxable wages &amp; tips subject to Additional Medicare Tax withholding" wages={null} rate="× 0.009 =" tax={null} />

      <IrsLine num="5e" label="Total social security and Medicare taxes. Add Column 2 from lines 5a, 5b, 5c, and 5d" value={fmt(line5e)} />
      <IrsLine num="5f" label="Section 3121(q) Notice and Demand — Tax due on unreported tips (see instructions)" value="" />
      <IrsLine num="6"  label="Total taxes before adjustments. Add lines 3, 5e, and 5f" value={fmt(lines.line6_totalTaxes)} highlight />
      <IrsLine num="7"  label="Current quarter's adjustment for fractions of cents" value="" />
      <IrsLine num="8"  label="Current quarter's adjustment for sick pay" value="" />
      <IrsLine num="9"  label="Current quarter's adjustments for tips and group-term life insurance" value="" />
      <IrsLine num="10" label="Total taxes after adjustments. Combine lines 6 through 9" value={fmt(lines.line6_totalTaxes)} highlight />
      <IrsLine num="11" label="Qualified small business payroll tax credit for increasing research activities. Attach Form 8974" value="" />
      <IrsLine num="12" label="Total taxes after adjustments and nonrefundable credits. Subtract line 11 from line 10" value={fmt(lines.line6_totalTaxes)} highlight />
      <IrsLine num="13" label="Total deposits for this quarter, including overpayment applied from a prior quarter and overpayments applied from Form 941-X filed in the current quarter" value={fmt(lines.line13_deposited)} />
      <IrsLine num="14" label="Balance due. If line 12 is more than line 13, enter the difference and see instructions" value={lines.line14_balanceDue > 0 ? fmt(lines.line14_balanceDue) : ''} highlight={lines.line14_balanceDue > 0} />

      <div style={F.line}>
        <div style={F.lineNum}>15a</div>
        <div style={F.lineLbl}>Overpayment. If line 13 is more than line 12, enter the difference</div>
        <div style={{ ...F.lineVal, width: 80 }}>{lines.line13_deposited > lines.line6_totalTaxes ? fmt(lines.line13_deposited - lines.line6_totalTaxes) : ''}</div>
        <div style={{ padding: '2px 6px', fontSize: 7.5, display: 'flex', alignItems: 'center', gap: 4 }}>
          15b: <span style={{ border: '1px solid #666', padding: '0 2px', fontSize: 7 }}>□</span> Apply to next return.
          <span style={{ border: '1px solid #666', padding: '0 2px', fontSize: 7 }}>□</span> Send a refund.
        </div>
      </div>

      <div style={F.note}>You MUST complete both pages of Form 941 and SIGN it. For Privacy Act and Paperwork Reduction Act Notice, see separate instructions.</div>

      {/* Part 2 */}
      <div style={F.partHdr}>Part 2: Tell us about your deposit schedule and tax liability for this quarter.</div>
      <div style={{ padding: '4px 8px', fontSize: 8, borderBottom: '1px solid #ddd' }}>
        <strong>16</strong> Check one:
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 3 }}>
          <span style={{ border: '1px solid #000', padding: '0 3px', background: '#000', color: '#fff', fontSize: 7, marginTop: 1 }}>✓</span>
          <span>Line 12 on this return is less than $2,500, or line 12 on the return for the prior quarter was less than $2,500, and you didn't incur a $100,000 next-day deposit obligation during the current quarter. Go to Part 3.</span>
        </div>
      </div>

      {/* Part 3 */}
      <div style={F.partHdr}>Part 3: Tell us about your business. If a question does NOT apply, leave it blank.</div>
      <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ddd' }}>
        <strong>17</strong> If your business has closed or you stopped paying wages . . . . . . . . . <span style={{ border: '1px solid #777', padding: '0 2px', fontSize: 7 }}>□</span> Check here; also attach a statement. Enter the final date you paid wages: ___________
      </div>
      <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ddd' }}>
        <strong>18</strong> If you're a seasonal employer and you don't have to file a return for every quarter of the year . . . <span style={{ border: '1px solid #777', padding: '0 2px', fontSize: 7 }}>□</span> Check here.
      </div>

      {/* Part 4 */}
      <div style={F.partHdr}>Part 4: May we speak with your third-party designee?</div>
      <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ddd' }}>
        Do you want to allow an employee, a paid tax preparer, or another person to discuss this return with the IRS?
      </div>
      <DesigneeSection pr={pr} />

      {/* Part 5 */}
      <div style={F.partHdr}>Part 5: Sign here. You MUST complete both pages of Form 941 and SIGN it.</div>
      <div style={F.note}>Under penalties of perjury, I declare that I have examined this return, including accompanying schedules and statements, and to the best of my knowledge and belief, it is true, correct, and complete. Declaration of preparer (other than taxpayer) is based on all information of which preparer has any knowledge.</div>
      <SignatureBlock pr={pr} />
      <PreparerBlock pr={pr} />

      {/* Supporting detail */}
      {submissions.length > 0 && (
        <div style={{ marginTop: 0, borderTop: '2px solid #000' }}>
          <div style={{ padding: '3px 8px', background: '#eee', fontSize: 8, fontWeight: 700, borderBottom: '1px solid #ccc' }}>
            Supporting Paycheck Detail — {submissions.length} check{submissions.length !== 1 ? 's' : ''} for Q{q} {period.year}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #aaa' }}>
                {['Pay Period End','Employee','Gross Wages','FIT','SS Total','Med Total','941 Deposit','EFTPS Status'].map((h) => (
                  <th key={h} style={{ padding: '3px 5px', fontSize: 7.5, fontWeight: 700, textAlign: h === 'Employee' || h === 'Pay Period End' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #ececec' }}>
                  <td style={{ padding: '3px 5px' }}>{s.payPeriodEnd}</td>
                  <td style={{ padding: '3px 5px' }}>{s.employeeName || '—'}</td>
                  {[s.grossWages, s.fitWithholding, s.ssTotal, s.medTotal, s.totalDeposit].map((v, i) => (
                    <td key={i} style={{ padding: '3px 5px', fontFamily: 'monospace', textAlign: 'right' }}>{fmtAmt(v)}</td>
                  ))}
                  <td style={{ padding: '3px 5px', textAlign: 'right' }}>
                    <span style={{
                      background: s.eftpsStatus === 'submitted' ? '#d1fae5' : s.eftpsStatus === 'pending' ? '#fef3c7' : '#f5f5f5',
                      padding: '1px 4px', borderRadius: 3, fontSize: 7, fontWeight: 700, textTransform: 'uppercase',
                    }}>{s.eftpsStatus || 'pending'}</span>
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#f0f0f0', fontWeight: 700, borderTop: '1px solid #aaa' }}>
                <td colSpan={2} style={{ padding: '3px 5px', fontSize: 7.5 }}>Total</td>
                {[
                  submissions.reduce((s,r) => s + r.grossWages, 0),
                  submissions.reduce((s,r) => s + r.fitWithholding, 0),
                  submissions.reduce((s,r) => s + r.ssTotal, 0),
                  submissions.reduce((s,r) => s + r.medTotal, 0),
                  submissions.reduce((s,r) => s + r.totalDeposit, 0),
                ].map((v, i) => (
                  <td key={i} style={{ padding: '3px 5px', fontFamily: 'monospace', textAlign: 'right' }}>{fmtAmt(v)}</td>
                ))}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Form 940 ──────────────────────────────────────────────────────────────────
function Report940({ data, pr }) {
  const { client, period, lines, byEmployee } = data;
  const excessWages = Math.max(0, (lines.line3_totalPayments || 0) - (lines.line5_futaTaxableWages || 0));

  return (
    <div style={F.doc}>
      {/* Top bar */}
      <div style={F.topbar}>
        <div style={F.topLeft}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={F.formNum}>Form 940</span>
            <span style={F.formSub}>for {period.year}: Employer's Annual Federal Unemployment (FUTA) Tax Return</span>
          </div>
          <div style={F.dept}>Department of the Treasury — Internal Revenue Service</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={F.omb}>850125</span>
            <span style={F.omb}>OMB No. 1545-0029</span>
          </div>
        </div>
        <div style={F.topRight}>
          <div style={F.qLabel}>Type of Return (Check all that apply.)</div>
          {['a. Amended','b. Successor employer',`c. No payments to employees in ${period.year}`,'d. Final: Business closed or stopped paying wages'].map((opt) => (
            <div key={opt} style={F.qOpt}><span style={F.qBox}></span><span>{opt}</span></div>
          ))}
          <div style={{ marginTop: 4, fontSize: 7.5, color: '#555' }}>Aggregate Return Filers Only</div>
          <div style={{ fontSize: 7.5, color: '#555' }}>Type of filer: Other Third Party</div>
        </div>
      </div>

      <EntityBlock client={client} rightContent={null} />

      {/* Part 1 */}
      <div style={F.partHdr}>Part 1: Tell us about your return. If any line does NOT apply, leave it blank. See instructions before completing Part 1.</div>
      <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ border: '1px solid #000', padding: '0 3px', background: '#000', color: '#fff', fontSize: 7 }}>✓</span>
        <strong>1a</strong>
        <span>If you had to pay state unemployment tax in one state only, enter the state abbreviation . . . . . . 1a</span>
        <span style={{ border: '1px solid #000', padding: '1px 8px', fontFamily: 'monospace', fontWeight: 700 }}>{client.state || 'TX'}</span>
      </div>
      <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={F.qBox}></span>
        <strong>1b</strong>
        <span>If you had to pay state unemployment tax in more than one state, you are a multi-state employer . . . 1b</span>
        <span style={{ fontSize: 7.5, color: '#888' }}>Check here. Complete Schedule A (Form 940).</span>
      </div>
      <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={F.qBox}></span>
        <strong>2</strong>
        <span>If you paid wages in a state that is subject to CREDIT REDUCTION . . . . . . . . . . . . 2</span>
        <span style={{ fontSize: 7.5, color: '#888' }}>Check here. Complete Schedule A (Form 940).</span>
      </div>

      {/* Part 2 */}
      <div style={F.partHdr}>Part 2: Determine your FUTA tax before adjustments. If any line does NOT apply, leave it blank.</div>
      <IrsLine num="3" label="Total payments to all employees" value={fmt(lines.line3_totalPayments)} />
      <div style={F.line}>
        <div style={F.lineNum}>4</div>
        <div style={F.lineLbl}>
          Payments exempt from FUTA tax
          <span style={{ fontSize: 7.5, marginLeft: 8, color: '#555' }}>Check all that apply: □ 4a Fringe benefits &nbsp; □ 4b Group-term life &nbsp; □ 4c Retirement/Pension &nbsp; □ 4d Dependent care &nbsp; □ 4e Other</span>
        </div>
        <div style={{ ...F.lineNum, borderLeft: '1px solid #aaa', width: 18, fontWeight: 400, fontSize: 7.5 }}>4</div>
        <div style={F.lineVal}></div>
      </div>
      <IrsLine num="5" label="Total of payments made to each employee in excess of $7,000" value={fmt(excessWages)} />
      <IrsLine num="6" label="Subtotal (line 4 + line 5 = line 6)" value={fmt(excessWages)} />
      <IrsLine num="7" label="Total taxable FUTA wages (line 3 – line 6 = line 7). See instructions" value={fmt(lines.line5_futaTaxableWages)} />
      <IrsLine num="8" label="FUTA tax before adjustments (line 7 × 0.006 = line 8)" value={fmt(lines.line12_netFuta)} highlight />

      {/* Part 3 */}
      <div style={F.partHdr}>Part 3: Determine your adjustments. If any line does NOT apply, leave it blank.</div>
      <IrsLine num="9"  label="If ALL of the taxable FUTA wages you paid were excluded from state unemployment tax, multiply line 7 by 0.054 (line 7 × 0.054 = line 9). Go to line 12" value="" />
      <IrsLine num="10" label="If SOME of the taxable FUTA wages you paid were excluded from state unemployment tax, OR you paid ANY state unemployment tax late, complete the worksheet in the instructions. Enter the amount from line 7 of the worksheet" value="" />
      <IrsLine num="11" label="If credit reduction applies, enter the total from Schedule A (Form 940)" value="" />

      {/* Part 4 */}
      <div style={F.partHdr}>Part 4: Determine your FUTA tax and balance due or overpayment. If any line does NOT apply, leave it blank.</div>
      <IrsLine num="12" label="Total FUTA tax after adjustments (lines 8 + 9 + 10 + 11 = line 12)" value={fmt(lines.line12_netFuta)} highlight />
      <IrsLine num="13" label="FUTA tax deposited for the year, including any overpayment applied from a prior year" value={fmt(lines.line12_netFuta)} />
      <IrsLine num="14" label="Balance due. If line 12 is more than line 13, enter the excess on line 14. • If line 14 > $500, you must deposit your tax. • If line 14 ≤ $500, you may pay with this return." value="" />
      <div style={F.line}>
        <div style={F.lineNum}>15a</div>
        <div style={F.lineLbl}>Overpayment. If line 13 is more than line 12, enter the difference</div>
        <div style={{ ...F.lineVal, width: 80 }}></div>
        <div style={{ padding: '2px 6px', fontSize: 7.5, display: 'flex', alignItems: 'center', gap: 4 }}>
          15b: <span style={{ border: '1px solid #666', padding: '0 2px', fontSize: 7 }}>□</span> Apply to next return.
          <span style={{ border: '1px solid #666', padding: '0 2px', fontSize: 7 }}>□</span> Send a refund.
        </div>
      </div>

      <div style={F.note}>You MUST complete both pages of this form and SIGN it. For Privacy Act and Paperwork Reduction Act Notice, see separate instructions.</div>

      {/* Part 5 */}
      <div style={F.partHdr}>Part 5: Report your FUTA tax liability by quarter only if line 12 is more than $500. If not, go to Part 6.</div>
      <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ddd' }}>
        <strong>16</strong> Report the amount of your FUTA tax liability for each quarter; do NOT enter the amount you deposited. If you had no liability for a quarter, leave the line blank.
      </div>
      {[['16a','1st quarter (January 1 – March 31)'],['16b','2nd quarter (April 1 – June 30)'],['16c','3rd quarter (July 1 – September 30)'],['16d','4th quarter (October 1 – December 31)']].map(([n,l]) => (
        <IrsLine key={n} num={n} label={l} value="" />
      ))}
      <IrsLine num="17" label="Total tax liability for the year (lines 16a + 16b + 16c + 16d = line 17)  Total must equal line 12." value={fmt(lines.line12_netFuta)} highlight />

      {/* Part 6 */}
      <div style={F.partHdr}>Part 6: May we speak with your third-party designee?</div>
      <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ddd' }}>
        Do you want to allow an employee, a paid tax preparer, or another person to discuss this return with the IRS? See the instructions for details.
      </div>
      <DesigneeSection pr={pr} />

      {/* Part 7 */}
      <div style={F.partHdr}>Part 7: Sign here. You MUST complete both pages of this form and SIGN it.</div>
      <div style={F.note}>Under penalties of perjury, I declare that I have examined this return and accompanying documents and, to the best of my knowledge and belief, they are true, correct, and complete.</div>
      <SignatureBlock pr={pr} />
      <PreparerBlock pr={pr} />

      {/* FUTA by employee */}
      {byEmployee.length > 0 && (
        <div style={{ borderTop: '2px solid #000' }}>
          <div style={{ padding: '3px 8px', background: '#eee', fontSize: 8, fontWeight: 700, borderBottom: '1px solid #ccc' }}>FUTA by Employee — {period.year}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #aaa' }}>
                {['Employee','Total Wages','FUTA Taxable Wages','FUTA Tax (0.6%)'].map((h) => (
                  <th key={h} style={{ padding: '3px 5px', fontSize: 7.5, textAlign: h === 'Employee' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #ececec' }}>
                  <td style={{ padding: '3px 5px' }}>{e.name}</td>
                  <td style={{ padding: '3px 5px', fontFamily: 'monospace', textAlign: 'right' }}>{fmtAmt(e.wages)}</td>
                  <td style={{ padding: '3px 5px', fontFamily: 'monospace', textAlign: 'right' }}>{fmtAmt(e.futaTaxable)}</td>
                  <td style={{ padding: '3px 5px', fontFamily: 'monospace', textAlign: 'right', fontWeight: 700 }}>{fmtAmt(e.futaTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── TWC / SUTA ────────────────────────────────────────────────────────────────
const TWC_PERIOD_END  = { 1: '03/31', 2: '06/30', 3: '09/30', 4: '12/31' };
const TWC_PENALTY_MO  = { 1: '04', 2: '07', 3: '10', 4: '01' };
const TWC_PENALTY_DAY = { 1: '30', 2: '31', 3: '31', 4: '31' };

function ReportTWC({ data, pr }) {
  const { client, period, sutaRate, lines, byEmployee } = data;
  const q = period.quarter;
  const periodEnd = `${TWC_PERIOD_END[q]}/${period.year}`;
  const penaltyYr  = q === 4 ? period.year + 1 : period.year;
  const penaltyDate = `${TWC_PENALTY_MO[q]}/${TWC_PENALTY_DAY[q]}/${penaltyYr}`;
  const wageBase   = lines.wageBase || 9000;
  const excessWages = Math.max(0, (lines.totalWages || 0) - (lines.sutaTaxableWages || 0));
  const empCount   = byEmployee.length || 1;

  const TRow = ({ label, value, bold }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 9.5, fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'monospace' }}>{value}</span>
    </div>
  );

  return (
    <div style={F.doc}>
      {/* Header */}
      <div style={{ borderBottom: '2px solid #000', padding: '6px 8px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 900 }}>Texas Unemployment Insurance - Quarterly Contribution Report</div>
        <div style={{ fontSize: 9, color: '#555', marginTop: 1 }}>Worksheet</div>
        <div style={{ fontSize: 8, color: '#888', marginTop: 1 }}>This is a record of your information to complete your Unemployment Insurance Contribution Report. Do not file the worksheet.</div>
      </div>

      {/* Company info row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #000' }}>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>FEIN No.</div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{client.ein}</div>
        </div>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>Company Legal Name</div>
          <div style={{ fontSize: 10, fontWeight: 700 }}>{client.businessName}</div>
        </div>
        <div style={{ padding: '4px 6px' }}>
          <div style={F.fieldLbl}>Period Ending</div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{periodEnd}</div>
        </div>
      </div>

      {/* Company info row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #000' }}>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>Account No.</div>
          <div style={{ fontFamily: 'monospace', fontSize: 10 }}>{client.twcAccountNumber || ''}</div>
        </div>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>Company Legal Address</div>
          <div style={{ fontSize: 9 }}>{client.businessAddress || ''}</div>
        </div>
        <div style={{ padding: '4px 6px' }}>
          <div style={F.fieldLbl}>Penalty Date</div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700 }}>{penaltyDate}</div>
        </div>
      </div>

      {/* Company info row 3 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', borderBottom: '1px solid #000' }}>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000', minWidth: 80 }}>
          <div style={F.fieldLbl}>NAICS Code</div>
          <div style={{ fontSize: 9 }}>{client.naicsCode || ''}</div>
        </div>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div><div style={F.fieldLbl}>City</div><div style={{ fontSize: 9 }}>{client.businessCity || ''}</div></div>
            <div><div style={F.fieldLbl}>State</div><div style={{ fontSize: 9 }}>{client.state || 'TX'}</div></div>
            <div><div style={F.fieldLbl}>Zip Code</div><div style={{ fontSize: 9 }}>{client.businessZip || ''}</div></div>
          </div>
        </div>
        <div style={{ padding: '4px 6px' }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div><div style={F.fieldLbl}>Company ID</div><div style={{ fontSize: 9 }}>{client.twcCompanyId || ''}</div></div>
            <div><div style={F.fieldLbl}>County Code</div><div style={{ fontSize: 9 }}>{client.twcCountyCode || ''}</div></div>
            <div><div style={F.fieldLbl}>No. of Employees Outside County</div><div style={{ fontSize: 9 }}></div></div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '2px', background: '#e8e8e8', borderBottom: '1px solid #999', fontSize: 8, fontWeight: 700 }}>
        Do Not Mail - Keep for Your Records
      </div>

      {/* Contribution calculation */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #000' }}>
        <div style={{ padding: '8px 12px', borderRight: '1px solid #000' }}>
          <TRow label="Total State Wages" value={`$${fmtZ(lines.totalWages)}`} bold />
          <TRow label="Excess Wages" value={`$${fmtZ(excessWages)}`} />
          <div style={{ borderTop: '1px solid #ccc', marginBottom: 4 }}></div>
          <TRow label={`Wage Base   $ ${wageBase.toLocaleString()}`} value="" />
          <TRow label="Taxable Wages" value={`$${fmtZ(lines.sutaTaxableWages)}`} bold />
          <TRow label="Rate" value={fmtPct(sutaRate)} />
          <div style={{ borderTop: '1px solid #000', paddingTop: 4 }}>
            <TRow label="UI Contributions" value={`$${fmtZ(lines.sutaTax)}`} bold />
          </div>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <TRow label="Overpayment (negative) / Bal Due from a previous period" value="$      0.00" />
          <div style={{ borderTop: '1px solid #000', paddingTop: 6, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700 }}>
              <span>Total Payment Due</span>
              <span style={{ fontFamily: 'monospace' }}>${fmtZ(lines.sutaTax)}</span>
            </div>
          </div>
          <div style={{ borderTop: '1px solid #ccc', paddingTop: 8 }}>
            <div style={{ fontSize: 8, color: '#555', marginBottom: 6 }}>
              Number of employees receiving pay for pay period which includes 12th day of the month
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 9.5 }}>
              {['1st Month','2nd Month','3rd Month'].map((label) => (
                <div key={label}>
                  <div style={F.fieldLbl}>{label}</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>{empCount}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '2px', background: '#e8e8e8', borderBottom: '1px solid #999', fontSize: 8, fontWeight: 700 }}>
        Do Not Mail - Keep for Your Records
      </div>

      {/* Wage Report section */}
      {byEmployee.length > 0 && (
        <>
          <div style={{ borderTop: '2px solid #000', padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #000' }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Texas Unemployment Insurance - Wage Report</div>
            <div style={{ fontSize: 9, color: '#555', marginTop: 1 }}>Worksheet</div>
            <div style={{ fontSize: 8, color: '#888', marginTop: 1 }}>This is a record of your information to complete your Unemployment Insurance Wage Report. Do not file the worksheet.</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #000' }}>
            <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
              <div style={F.fieldLbl}>Company Legal Name</div>
              <div style={{ fontSize: 10, fontWeight: 700 }}>{client.businessName}</div>
            </div>
            <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
              <div style={F.fieldLbl}>FEIN</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{client.ein}</div>
            </div>
            <div style={{ padding: '4px 6px' }}>
              <div style={F.fieldLbl}>Period Ending</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{periodEnd}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #000' }}>
            <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
              <div style={F.fieldLbl}>Company ID</div>
              <div style={{ fontSize: 9 }}>{client.twcAccountNumber || ''}</div>
            </div>
            <div style={{ padding: '4px 6px' }}>
              <div style={F.fieldLbl}>Unemployment No.</div>
              <div style={{ fontSize: 9 }}>{client.twcAccountNumber || ''}</div>
            </div>
          </div>

          <div style={{ textAlign: 'center', padding: '2px', background: '#e8e8e8', borderBottom: '1px solid #999', fontSize: 8, fontWeight: 700 }}>
            Do Not Mail - Keep for Your Records
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8.5 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #aaa' }}>
                <th style={{ padding: '4px 8px', fontSize: 8, textAlign: 'left' }}>Employee Social Security No.</th>
                <th style={{ padding: '4px 8px', fontSize: 8, textAlign: 'left' }}>Employee Name (Last, First, MI)</th>
                <th style={{ padding: '4px 8px', fontSize: 8, textAlign: 'right' }}>Total Wages</th>
                <th style={{ padding: '4px 8px', fontSize: 8, textAlign: 'right' }}>Taxable Wages</th>
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e0e0e0' }}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{e.ssn || '***-**-****'}</td>
                  <td style={{ padding: '4px 8px' }}>{e.name}</td>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace', textAlign: 'right' }}>{fmtZ(e.wages)}</td>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace', textAlign: 'right' }}>{fmtZ(e.sutaTaxable)}</td>
                </tr>
              ))}
              <tr style={{ background: '#f0f0f0', fontWeight: 700, borderTop: '1px solid #aaa' }}>
                <td colSpan={2} style={{ padding: '4px 8px', fontSize: 7.5 }}>Totals for this page</td>
                <td style={{ padding: '4px 8px', fontFamily: 'monospace', textAlign: 'right' }}>{fmtZ(lines.totalWages)}</td>
                <td style={{ padding: '4px 8px', fontFamily: 'monospace', textAlign: 'right' }}>{fmtZ(lines.sutaTaxableWages)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ textAlign: 'center', padding: '2px', background: '#e8e8e8', borderTop: '1px solid #999', fontSize: 8, fontWeight: 700 }}>
            Do Not Mail - Keep for Your Records
          </div>
        </>
      )}
    </div>
  );
}

// ── W-2 ───────────────────────────────────────────────────────────────────────
function W2Box({ num, label, value, mono }) {
  return (
    <div style={{ border: '1px solid #aaa', padding: '3px 5px', background: '#fff' }}>
      <div style={{ fontSize: 7, color: '#555' }}>{num ? `${num} ` : ''}{label}</div>
      <div style={{ fontFamily: mono !== false ? '"Courier New",monospace' : 'inherit', fontSize: 10.5, fontWeight: 700, minHeight: 14 }}>{value || ''}</div>
    </div>
  );
}

function ReportW2({ data, pr }) {
  const { client, period, w2s } = data;
  return (
    <div style={{ ...F.doc, pageBreakAfter: 'auto' }}>
      {/* Header */}
      <div style={{ borderBottom: '2px solid #000', padding: '5px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={F.formNum}>W-2</span>
          <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 8 }}>Wage and Tax Statement</span>
          <span style={{ fontSize: 9, marginLeft: 8, color: '#555' }}>Tax Year {period.year}</span>
        </div>
        <div style={{ fontSize: 8, color: '#555', textAlign: 'right' }}>
          <div>Department of the Treasury — Internal Revenue Service</div>
          <div>OMB No. 1545-0029</div>
        </div>
      </div>

      {/* Employer block */}
      <div style={{ borderBottom: '1px solid #000', padding: '5px 8px' }}>
        <div style={{ fontSize: 8.5, fontWeight: 700, marginBottom: 2 }}>c Employer's name, address, and ZIP code</div>
        <div style={{ fontSize: 10.5, fontWeight: 700 }}>{client.businessName}</div>
        {client.businessAddress && <div style={{ fontSize: 9.5 }}>{client.businessAddress}</div>}
        {client.businessCity && <div style={{ fontSize: 9.5 }}>{client.businessCity}, {client.state || 'TX'} {client.businessZip || ''}</div>}
        <div style={{ marginTop: 4, fontSize: 8.5 }}>
          <span style={{ fontWeight: 700 }}>b Employer identification number (EIN): </span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{client.ein}</span>
        </div>
      </div>

      {/* One W-2 per employee */}
      {w2s.map((w, idx) => (
        <div key={w.employeeId} style={{ borderBottom: idx < w2s.length - 1 ? '2px solid #000' : 'none' }}>
          {/* Employee info */}
          <div style={{ padding: '4px 8px', borderBottom: '1px solid #ddd', background: '#f9f9f9' }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: 8.5, fontWeight: 700 }}>a Employee's social security number: </span>
                <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{w.ssn}</span>
              </div>
              <div>
                <span style={{ fontSize: 8.5, fontWeight: 700 }}>e Employee's name: </span>
                <span style={{ fontWeight: 700 }}>{w.firstName} {w.lastName}</span>
              </div>
            </div>
            {w.address && <div style={{ fontSize: 8.5, color: '#555', marginTop: 2 }}>f {w.address}, {w.city}, {w.state} {w.zip}</div>}
          </div>

          {/* Wage boxes grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, padding: 4, background: '#ccc' }}>
            <W2Box num="1"  label="Wages, tips, other compensation" value={w.box1_wages > 0 ? fmtZ(w.box1_wages) : ''} />
            <W2Box num="2"  label="Federal income tax withheld"    value={w.box2_fitWithheld > 0 ? fmtZ(w.box2_fitWithheld) : ''} />
            <W2Box num=""   label="" value="" />
            <W2Box num="3"  label="Social security wages"          value={w.box3_ssWages > 0 ? fmtZ(w.box3_ssWages) : ''} />
            <W2Box num="4"  label="Social security tax withheld"   value={w.box4_ssTax > 0 ? fmtZ(w.box4_ssTax) : ''} />
            <W2Box num=""   label="(a) Uncollected SS on tips" value="" />
            <W2Box num="5"  label="Medicare wages and tips"        value={w.box5_medWages > 0 ? fmtZ(w.box5_medWages) : ''} />
            <W2Box num="6"  label="Medicare tax withheld"          value={w.box6_medTax > 0 ? fmtZ(w.box6_medTax) : ''} />
            <W2Box num="7"  label="Social security tips"           value="" />
            <W2Box num="8"  label="Allocated tips"                 value="" />
            <W2Box num="9"  label=""                               value="" />
            <W2Box num="10" label="Dependent care benefits"        value="" />
            <W2Box num="11" label="Nonqualified plans"             value="" />
            <W2Box num="12a" label="See instructions for box 12"   value="" />
            <div style={{ display: 'flex', gap: 1, flexDirection: 'column', background: '#ccc' }}>
              <W2Box num="13" label="Statutory employee □  Retirement plan □  Third-party sick pay □" value="" mono={false} />
              <W2Box num="14" label="Other" value="" />
            </div>
            <W2Box num="12b" label="" value="" />
            <W2Box num="12c" label="" value="" />
            <W2Box num="12d" label="" value="" />
          </div>

          {/* State boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 1, padding: '0 4px 4px', background: '#ccc' }}>
            <W2Box num="15" label="State / Employer's state ID no." value={`${client.state || 'TX'}`} />
            <W2Box num="16" label="State wages, tips, etc."         value={w.box16_stateWages > 0 ? fmtZ(w.box16_stateWages) : ''} />
            <W2Box num="17" label="State income tax"                value="" />
            <W2Box num="18" label="Local wages, tips, etc."         value="" />
            <W2Box num="19" label="Local income tax"                value="" />
          </div>
        </div>
      ))}

      {w2s.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: '#888', fontSize: 9 }}>
          No employees with completed paychecks for {period.year}.
        </div>
      )}
    </div>
  );
}

// ── W-3 ───────────────────────────────────────────────────────────────────────
function ReportW3({ data, pr }) {
  const { client, period, totals } = data;
  return (
    <div style={F.doc}>
      {/* Top bar */}
      <div style={{ borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={F.formNum}>W-3</span>
            <span style={{ fontSize: 10.5, fontWeight: 700 }}>Transmittal of Wage and Tax Statements</span>
          </div>
          <div style={F.dept}>Department of the Treasury — Internal Revenue Service</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 8 }}>
          <div>For calendar year {period.year}</div>
          <div>OMB No. 1545-0029</div>
          <div style={{ fontWeight: 700 }}>{totals.employeeCount} W-2 Form{totals.employeeCount !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Kind of payer / employer */}
      <div style={{ borderBottom: '1px solid #000', display: 'flex' }}>
        <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #000' }}>
          <div style={{ fontSize: 8, fontWeight: 700, marginBottom: 2 }}>b Kind of Payer (Check one)</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 8 }}>
            {['941 (Most common)','943','944','Household employer','Medicare govt. employer','Military'].map((o) => (
              <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ ...F.qBox, background: o === '941 (Most common)' ? '#000' : 'transparent', color: '#fff' }}>{o === '941 (Most common)' ? '✓' : ''}</span>
                <span>{o}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '4px 8px' }}>
          <div style={{ fontSize: 8, fontWeight: 700, marginBottom: 2 }}>Kind of Employer (Check one)</div>
          <div style={{ display: 'flex', gap: 10, fontSize: 8 }}>
            {['None apply','State/local non-501c','501c non-govt.','State/local 501c','Federal govt.'].map((o) => (
              <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ ...F.qBox, background: o === 'None apply' ? '#000' : 'transparent', color: '#fff' }}>{o === 'None apply' ? '✓' : ''}</span>
                <span>{o}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Employer info + boxes */}
      <div style={{ borderBottom: '1px solid #000', display: 'flex' }}>
        <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>e Employer identification number (EIN)</div>
          <div style={{ ...F.fieldVal, marginBottom: 4 }}>{client.ein}</div>
          <div style={F.fieldLbl}>f Employer's name</div>
          <div style={{ ...F.fieldVal, marginBottom: 4 }}>{client.businessName}</div>
          <div style={F.fieldLbl}>g Employer's address and ZIP code</div>
          <div style={F.fieldVal}>{[client.businessAddress, client.businessCity, client.state || 'TX', client.businessZip].filter(Boolean).join(', ')}</div>
          <div style={{ marginTop: 6, fontSize: 8 }}>
            <div style={F.fieldLbl}>Employer's contact person</div>
            <div style={{ fontWeight: 700 }}>{pr?.name || ''}</div>
          </div>
          <div style={{ marginTop: 4, fontSize: 8 }}>
            <div style={F.fieldLbl}>Employer's telephone number</div>
            <div>{pr?.phone || ''}</div>
          </div>
          <div style={{ marginTop: 4, fontSize: 8 }}>
            <div style={F.fieldLbl}>Employer's email address</div>
            <div>{pr?.email || ''}</div>
          </div>
        </div>

        {/* Totals boxes */}
        <div style={{ flex: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, padding: 4, background: '#ccc', alignContent: 'start' }}>
          <W2Box num="1"  label="Wages, tips, other compensation"      value={totals.box1_wages > 0 ? fmtZ(totals.box1_wages) : ''} />
          <W2Box num="2"  label="Federal income tax withheld"          value={totals.box2_fitWithheld > 0 ? fmtZ(totals.box2_fitWithheld) : ''} />
          <W2Box num="3"  label="Social security wages"                value={totals.box3_ssWages > 0 ? fmtZ(totals.box3_ssWages) : ''} />
          <W2Box num="4"  label="Social security tax withheld"         value={totals.box4_ssTax > 0 ? fmtZ(totals.box4_ssTax) : ''} />
          <W2Box num="5"  label="Medicare wages and tips"              value={totals.box5_medWages > 0 ? fmtZ(totals.box5_medWages) : ''} />
          <W2Box num="6"  label="Medicare tax withheld"                value={totals.box6_medTax > 0 ? fmtZ(totals.box6_medTax) : ''} />
          <W2Box num="7"  label="Social security tips"                 value="" />
          <W2Box num="8"  label="Allocated tips"                       value="" />
          <W2Box num="9"  label=""                                     value="" />
          <W2Box num="10" label="Dependent care benefits"              value="" />
          <W2Box num="11" label="Nonqualified plans"                   value="" />
          <W2Box num="12a" label="Deferred compensation"               value="" />
          <W2Box num="14" label="Income tax withheld by payer of third-party sick pay" value="" />
          <W2Box num=""   label="" value="" />
        </div>
      </div>

      {/* State row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 1, padding: '0 4px 4px', background: '#ccc' }}>
        <W2Box num="15" label="State / Employer's state ID no." value={totals.box15_state || 'TX'} />
        <W2Box num="16" label="State wages, tips, etc."         value={totals.box16_stateWages > 0 ? fmtZ(totals.box16_stateWages) : ''} />
        <W2Box num="17" label="State income tax"                value="" />
        <W2Box num=""   label="" value="" />
      </div>

      {/* Signature */}
      <div style={{ padding: '5px 8px', borderTop: '1px solid #000', fontSize: 8 }}>
        Under penalties of perjury, I declare that I have examined this return and accompanying documents and, to the best of my knowledge and belief, they are true, correct, and complete.
      </div>
      <SignatureBlock pr={pr} />
    </div>
  );
}

const PREPARER_FIELDS = [
  { key: 'name',        label: 'Preparer Name',       placeholder: 'Full name' },
  { key: 'ptin',        label: 'PTIN',                 placeholder: 'P00000000' },
  { key: 'title',       label: 'Title',                placeholder: 'CPA, EA, etc.' },
  { key: 'phone',       label: 'Preparer Phone',       placeholder: '(555) 000-0000' },
  { key: 'email',       label: 'Email',                placeholder: 'preparer@firm.com' },
  { key: 'firmName',    label: 'Firm Name',            placeholder: 'Firm or your name if self-employed' },
  { key: 'firmEin',     label: 'Firm EIN',             placeholder: '00-0000000' },
  { key: 'firmAddress', label: 'Firm Address',         placeholder: '123 Main St' },
  { key: 'firmCity',    label: 'Firm City',            placeholder: 'City' },
  { key: 'firmState',   label: 'Firm State',           placeholder: 'TX' },
  { key: 'firmZip',     label: 'Firm ZIP',             placeholder: '00000' },
  { key: 'firmPhone',   label: 'Firm Phone',           placeholder: '(555) 000-0000' },
  { key: 'desgName',    label: 'Designee Name',        placeholder: 'Third-party designee name' },
  { key: 'desgPhone',   label: 'Designee Phone',       placeholder: '(555) 000-0000' },
  { key: 'desgPin',     label: 'Designee PIN (5 digits)', placeholder: '00000' },
];

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Reports() {
  const [searchParams] = useSearchParams();
  const [clients, setClients]       = useState([]);
  const [clientId, setClientId]     = useState('');
  const [reportType, setReportType] = useState('941');
  const [year, setYear]             = useState(CURRENT_YEAR);
  const [quarter, setQuarter]       = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [activeTab, setActiveTab]   = useState('reports');

  // Preparer info
  const [preparer, setPreparer]     = useState({});
  const [prForm, setPrForm]         = useState({});
  const [prSaving, setPrSaving]     = useState(false);
  const [prSaved, setPrSaved]       = useState(false);
  const [prError, setPrError]       = useState('');

  const needsQuarter = reportType === '941' || reportType === 'twc';

  // Read URL params set by CompanyWorkspace "File Forms"
  useEffect(() => {
    const paramForm    = searchParams.get('form');
    const paramYear    = searchParams.get('year');
    const paramQuarter = searchParams.get('quarter');
    if (paramForm)    setReportType(paramForm);
    if (paramYear)    setYear(Number(paramYear));
    if (paramQuarter) setQuarter(Number(paramQuarter));
  }, []);

  useEffect(() => {
    const paramClientId = searchParams.get('clientId');
    api.getClients().then((cs) => {
      setClients(cs);
      if (paramClientId) setClientId(paramClientId);
      else if (cs.length > 0) setClientId(String(cs[0].id));
    }).catch(() => {});
    api.getPreparerInfo().then((info) => {
      setPreparer(info || {});
      setPrForm(info || {});
    }).catch(() => {});
  }, []);

  async function handleGenerate() {
    if (!clientId) { setError('Select a client first'); return; }
    setLoading(true);
    setError('');
    setData(null);
    try {
      let result;
      if (reportType === '941')      result = await api.get941(clientId, year, quarter);
      else if (reportType === '940') result = await api.get940(clientId, year);
      else if (reportType === 'twc') result = await api.getTWC(clientId, year, quarter);
      else if (reportType === 'w2')  result = await api.getW2(clientId, year);
      else if (reportType === 'w3')  result = await api.getW3(clientId, year);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePreparer(e) {
    e.preventDefault();
    setPrSaving(true);
    setPrError('');
    setPrSaved(false);
    try {
      const saved = await api.savePreparerInfo(prForm);
      setPreparer(saved);
      setPrSaved(true);
      setTimeout(() => setPrSaved(false), 3000);
    } catch (err) {
      setPrError(err.message);
    } finally {
      setPrSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>File Forms</h2>
        <p>Generate Form 941, 940, TWC, W-2, and W-3 reports, and manage your preparer information</p>
      </div>

      <div className="page-body">
        {/* Tab bar */}
        <div className="no-print" style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
          {[
            { key: 'reports', label: 'Tax Reports' },
            { key: 'preparer', label: 'Preparer Information' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 24px',
                border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                background: 'transparent',
                fontWeight: activeTab === tab.key ? 700 : 400,
                color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 14,
                marginBottom: -2,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Preparer Info Tab ── */}
        {activeTab === 'preparer' && (
          <div className="card" style={{ maxWidth: 760, padding: '24px 28px' }}>
            <h3 style={{ marginBottom: 6, fontSize: 15 }}>Preparer Information</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              This information autofills Parts 4 and 5 (designee, signature, paid preparer) across all tax forms. Leave blank if not applicable.
            </p>
            <form onSubmit={handleSavePreparer}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                {PREPARER_FIELDS.map(({ key, label, placeholder }) => (
                  <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">{label}</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder={placeholder}
                      value={prForm[key] || ''}
                      onChange={(e) => setPrForm((f) => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn btn-primary" type="submit" disabled={prSaving}>
                  {prSaving ? 'Saving…' : 'Save Preparer Info'}
                </button>
                {prSaved && <span style={{ color: 'var(--success)', fontSize: 13, fontWeight: 600 }}>Saved successfully.</span>}
                {prError && <span style={{ color: 'var(--error)', fontSize: 13 }}>{prError}</span>}
              </div>
            </form>
          </div>
        )}

        {/* ── Reports Tab ── */}
        {activeTab === 'reports' && (
          <>
            {/* Controls */}
            <div className="card" style={{ marginBottom: 24, padding: '20px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, alignItems: 'end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Client</label>
                  <select className="form-select" value={clientId} onChange={(e) => { setClientId(e.target.value); setData(null); }}>
                    <option value="">— Select a client —</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.businessName}</option>)}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Report Type</label>
                  <select className="form-select" value={reportType} onChange={(e) => { setReportType(e.target.value); setData(null); }}>
                    {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.subtitle}</option>)}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Tax Year</label>
                  <select className="form-select" value={year} onChange={(e) => { setYear(Number(e.target.value)); setData(null); }}>
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>

                {needsQuarter && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Quarter</label>
                    <select className="form-select" value={quarter} onChange={(e) => { setQuarter(Number(e.target.value)); setData(null); }}>
                      {QUARTERS.map((q) => <option key={q} value={q}>{QUARTER_LABELS[q]}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <button className="btn btn-primary" onClick={handleGenerate} disabled={loading || !clientId}>
                    {loading ? <><span className="spinner" /> Generating…</> : 'Generate Report'}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="alert alert-error" style={{ marginBottom: 20 }}>
                <span>⚠</span> {error}
              </div>
            )}

            {data && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 16 }} className="no-print">
                  <button className="btn btn-secondary" onClick={() => window.print()}>Print / Save PDF</button>
                </div>
                {data.reportType === '941' && <Report941 data={data} pr={preparer} />}
                {data.reportType === '940' && <Report940 data={data} pr={preparer} />}
                {data.reportType === 'TWC' && <ReportTWC data={data} pr={preparer} />}
                {data.reportType === 'W-2' && <ReportW2  data={data} pr={preparer} />}
                {data.reportType === 'W-3' && <ReportW3  data={data} pr={preparer} />}
              </>
            )}

            {!data && !loading && !error && (
              <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
                <p>Select a client and report type above, then click Generate Report.</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
