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

function fmt(n) {
  const v = Number(n || 0);
  return v === 0 ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtZ(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) { return `${(Number(n || 0) * 100).toFixed(5)}`; }
function fmtAmt(n) { return `$${fmtZ(n)}`; }

// ── Shared IRS form styles ─────────────────────────────────────────────────────
const F = {
  page:     { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 9, color: '#000', background: '#fff', border: '2px solid #000', marginBottom: 24 },
  topbar:   { borderBottom: '2px solid #000', display: 'flex', alignItems: 'stretch' },
  topLeft:  { flex: 1, padding: '5px 8px', borderRight: '1px solid #000' },
  topRight: { padding: '5px 8px', minWidth: 195 },
  formNum:  { fontSize: 20, fontWeight: 900, letterSpacing: -0.5 },
  formSub:  { fontSize: 8.5, color: '#333' },
  dept:     { fontSize: 8, color: '#555', marginTop: 1 },
  omb:      { fontSize: 8, marginTop: 2 },
  qLabel:   { fontSize: 8, fontWeight: 700, marginBottom: 3 },
  qOpt:     { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, fontSize: 8 },
  qBox:     { width: 10, height: 10, border: '1px solid #000', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, flexShrink: 0 },
  fieldLbl: { fontSize: 7, color: '#444', marginBottom: 1 },
  fieldVal: { fontSize: 10, fontWeight: 700, fontFamily: '"Courier New",monospace', borderBottom: '1px solid #aaa', minHeight: 13, paddingBottom: 1, marginBottom: 3 },
  partHdr:  { background: '#b8b8b8', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '2px 8px', fontWeight: 700, fontSize: 8.5, pageBreakAfter: 'avoid' },
  note:     { padding: '2px 8px', fontSize: 7.5, color: '#444', borderBottom: '1px solid #ccc', background: '#f5f5f5' },
  line:     { display: 'flex', borderBottom: '1px solid #ccc', alignItems: 'stretch', minHeight: 17 },
  lineNum:  { width: 24, background: '#f0f0f0', borderRight: '1px solid #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7.5, fontWeight: 700, flexShrink: 0, color: '#222' },
  lineLbl:  { flex: 1, padding: '2px 6px', fontSize: 8.5, display: 'flex', alignItems: 'center' },
  lineVal:  { width: 110, borderLeft: '1px solid #999', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '2px 6px', fontFamily: '"Courier New",monospace', fontSize: 9.5, fontWeight: 600 },
  lineValHL:{ background: '#e8eeff', fontWeight: 800 },
  ssLine:   { display: 'flex', borderBottom: '1px solid #ccc', alignItems: 'center', minHeight: 19, padding: '1px 0' },
  ssNum:    { width: 24, textAlign: 'center', fontSize: 7.5, fontWeight: 700, color: '#222', flexShrink: 0 },
  ssLbl:    { flex: 1, fontSize: 8.5, padding: '0 6px' },
  ssCol1:   { width: 90, textAlign: 'right', fontFamily: '"Courier New",monospace', fontSize: 9, paddingRight: 4 },
  ssMult:   { width: 68, textAlign: 'center', fontSize: 7.5, color: '#444' },
  ssCol2:   { width: 90, textAlign: 'right', fontFamily: '"Courier New",monospace', fontSize: 9, borderLeft: '1px solid #999', paddingLeft: 6, paddingRight: 4 },
};

// Tiny checkbox (■ or □)
function Chk({ checked }) {
  return (
    <span style={{ border: '1px solid #000', width: 10, height: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, flexShrink: 0, background: checked ? '#000' : '#fff', color: '#fff', marginTop: 1 }}>
      {checked ? '✓' : ''}
    </span>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function IrsLine({ num, label, value, highlight, wide }) {
  return (
    <div style={{ ...F.line, background: highlight ? '#eef1ff' : 'transparent' }}>
      <div style={F.lineNum}>{num}</div>
      <div style={F.lineLbl}>{label}</div>
      <div style={{ ...F.lineNum, borderLeft: '1px solid #999', width: wide ? 20 : 18, fontWeight: 400, fontSize: 7, color: '#444' }}>{num}</div>
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

function EntityBlock940({ client }) {
  return (
    <div style={{ borderBottom: '1px solid #000' }}>
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>Employer identification number (EIN)</div>
          <div style={{ ...F.fieldVal, fontFamily: '"Courier New",monospace', fontSize: 12 }}>{client.ein}</div>
          <div style={F.fieldLbl}>Name (not your trade name)</div>
          <div style={F.fieldVal}>{client.businessName}</div>
          <div style={F.fieldLbl}>Trade name (if any)</div>
          <div style={F.fieldVal}>{client.tradeName || ''}</div>
          <div style={F.fieldLbl}>Address</div>
          <div style={F.fieldVal}>{client.businessAddress || ''}</div>
          <div style={{ display: 'flex', gap: 8 }}>
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
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <div style={{ flex: 2 }}>
              <div style={F.fieldLbl}>Foreign country name</div>
              <div style={F.fieldVal}></div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={F.fieldLbl}>Foreign province/county</div>
              <div style={F.fieldVal}></div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={F.fieldLbl}>Foreign postal code</div>
              <div style={F.fieldVal}></div>
            </div>
          </div>
        </div>
        <div style={{ padding: '4px 8px', minWidth: 195 }}>
          <div style={{ fontSize: 7.5, fontWeight: 700, marginBottom: 4 }}>Type of Return</div>
          <div style={{ fontSize: 7.5, marginBottom: 2 }}>(Check all that apply.)</div>
          {[
            'a. Amended',
            'b. Successor employer',
            `c. No payments to employees in ${client.year || ''}`,
            'd. Final: Business closed or stopped paying wages',
          ].map((opt) => (
            <div key={opt} style={F.qOpt}><Chk checked={false} /><span>{opt}</span></div>
          ))}
          <div style={{ marginTop: 8, fontSize: 7.5, fontWeight: 700 }}>Aggregate Return Filers Only</div>
          <div style={{ fontSize: 7, marginTop: 2, marginBottom: 2 }}>Type of filer (check one):</div>
          {['Section 3504 Agent', 'Certified Professional Employer\nOrganization (CPEO)', 'Other Third Party'].map((o) => (
            <div key={o} style={F.qOpt}><Chk checked={o === 'Other Third Party'} /><span style={{ whiteSpace: 'pre-line' }}>{o}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Entity941({ client, quarter, year }) {
  const Q_LABELS = {
    1: '1: January, February, March',
    2: '2: April, May, June',
    3: '3: July, August, September',
    4: '4: October, November, December',
  };
  return (
    <div style={{ borderBottom: '1px solid #000' }}>
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>Name (not your trade name)</div>
          <div style={F.fieldVal}>{client.businessName}</div>
          <div style={F.fieldLbl}>Trade name (if any)</div>
          <div style={F.fieldVal}>{client.tradeName || ''}</div>
        </div>
        <div style={{ padding: '4px 8px', borderRight: '1px solid #000', minWidth: 175 }}>
          <div style={F.fieldLbl}>Employer identification number (EIN)</div>
          <div style={{ ...F.fieldVal, fontFamily: '"Courier New",monospace', fontSize: 12 }}>{client.ein}</div>
          <div style={{ marginTop: 6 }}>
            <div style={F.fieldLbl}>Report for this Quarter of {year} (Check one.)</div>
            {[1, 2, 3, 4].map((n) => (
              <div key={n} style={F.qOpt}>
                <Chk checked={n === quarter} />
                <span>{Q_LABELS[n]}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 4, borderTop: '1px solid #ccc', paddingTop: 3 }}>
            <div style={{ fontSize: 7, color: '#444', marginBottom: 2 }}>Aggregate Return Filers Only</div>
            <div style={{ fontSize: 7, color: '#444', marginBottom: 1 }}>Type of filer (check one):</div>
            {['Section 3504 Agent', 'Certified Professional Employer\nOrganization (CPEO)', 'Other Third Party'].map((o) => (
              <div key={o} style={F.qOpt}><Chk checked={o === 'Other Third Party'} /><span style={{ fontSize: 7, whiteSpace: 'pre-line' }}>{o}</span></div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid #ccc', padding: '3px 8px' }}>
        <div style={F.fieldLbl}>Address</div>
        <div style={{ ...F.fieldVal, maxWidth: 400 }}>{client.businessAddress || ''}</div>
      </div>
      <div style={{ borderTop: '1px solid #ccc', display: 'flex', gap: 0, padding: '3px 8px 4px' }}>
        <div style={{ flex: 3, paddingRight: 8 }}>
          <div style={F.fieldLbl}>City</div>
          <div style={F.fieldVal}>{client.businessCity || ''}</div>
        </div>
        <div style={{ width: 40, paddingRight: 8 }}>
          <div style={F.fieldLbl}>State</div>
          <div style={F.fieldVal}>{client.state || 'TX'}</div>
        </div>
        <div style={{ flex: 1, paddingRight: 8 }}>
          <div style={F.fieldLbl}>ZIP code</div>
          <div style={F.fieldVal}>{client.businessZip || ''}</div>
        </div>
        <div style={{ flex: 2, paddingRight: 8 }}>
          <div style={F.fieldLbl}>Foreign country name</div>
          <div style={F.fieldVal}></div>
        </div>
        <div style={{ flex: 1, paddingRight: 8 }}>
          <div style={F.fieldLbl}>Foreign province/county</div>
          <div style={F.fieldVal}></div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={F.fieldLbl}>Foreign postal code</div>
          <div style={F.fieldVal}></div>
        </div>
      </div>
    </div>
  );
}

function MiniHeader941({ client, pageCode }) {
  return (
    <div style={{ background: '#f0f0f0', borderBottom: '1px solid #000', padding: '3px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 8 }}>
      <span style={{ fontWeight: 700, fontSize: 9 }}>{pageCode}</span>
      <div style={{ display: 'flex', gap: 24 }}>
        <div>
          <div style={F.fieldLbl}>Name (not your trade name)</div>
          <div style={{ fontWeight: 700, fontSize: 9.5 }}>{client.businessName}</div>
        </div>
        <div>
          <div style={F.fieldLbl}>Employer identification number (EIN)</div>
          <div style={{ fontFamily: '"Courier New",monospace', fontWeight: 700, fontSize: 9.5 }}>{client.ein}</div>
        </div>
      </div>
    </div>
  );
}

function DesigneeSection({ pr }) {
  const hasInfo  = pr?.desgName || pr?.desgPhone;
  const checkYes = !!hasInfo;
  const checkNo  = !hasInfo && !!pr?.noDesignee;
  const pin = (pr?.desgPin || '').toString().split('').slice(0, 5);
  return (
    <div style={{ padding: '5px 8px', fontSize: 8, borderBottom: '1px solid #ccc' }}>
      <div style={{ marginBottom: 4 }}>
        Do you want to allow an employee, a paid tax preparer, or another person to discuss this return with the IRS? See the instructions for details.
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 320 }}>
          <Chk checked={checkYes} />
          <div>
            <strong>Yes.</strong>
            {hasInfo ? (
              <span style={{ marginLeft: 4 }}>
                Designee's name and phone number &nbsp;
                <strong>{pr.desgName}</strong> &nbsp;
                <strong>{pr.desgPhone}</strong>
              </span>
            ) : (
              <span style={{ marginLeft: 4 }}>
                Designee's name and phone number &nbsp;
                <span style={{ borderBottom: '1px solid #000', display: 'inline-block', minWidth: 200, minHeight: 11 }}></span>
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 7.5 }}>Select a 5-digit personal identification number (PIN) to use when talking to the IRS.</div>
          <div style={{ display: 'flex', gap: 2 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} style={{ border: '1px solid #000', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
                {pin[i] || ''}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Chk checked={checkNo} />
          <strong>No.</strong>
        </div>
      </div>
    </div>
  );
}

function SignatureBlock({ pr }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderBottom: '1px solid #ccc', fontSize: 8 }}>
      <div style={{ padding: '4px 8px', borderRight: '1px solid #ccc' }}>
        <div style={F.fieldLbl}>Sign your name here</div>
        <div style={{ borderBottom: '1px solid #000', height: 18, marginBottom: 4, fontSize: 7.5, color: '#888', paddingTop: 4 }}>EF ONLY—You do not need to sign this form</div>
        <div style={F.fieldLbl}>Print your name here</div>
        <div style={{ fontWeight: 700, fontSize: 9.5, borderBottom: '1px solid #ccc', minHeight: 14, marginBottom: 3 }}>{pr?.name || ''}</div>
        <div style={F.fieldLbl}>Print your title here</div>
        <div style={{ borderBottom: '1px solid #ccc', minHeight: 14, marginBottom: 3 }}>{pr?.title || ''}</div>
        <div style={F.fieldLbl}>Best daytime phone</div>
        <div style={{ borderBottom: '1px solid #ccc', minHeight: 14 }}>{pr?.phone || ''}</div>
      </div>
      <div style={{ padding: '4px 8px' }}>
        <div style={F.fieldLbl}>Date</div>
        <div style={{ fontWeight: 600, borderBottom: '1px solid #ccc', minHeight: 14, marginBottom: 4 }}>
          {pr?.name ? new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : ''}
        </div>
      </div>
    </div>
  );
}

function PreparerBlock({ pr }) {
  const addr = [pr?.firmAddress, pr?.firmCity, pr?.firmState, pr?.firmZip].filter(Boolean).join(', ');
  return (
    <div style={{ borderTop: '1px solid #000', fontSize: 8, background: '#fafafa' }}>
      <div style={{ padding: '3px 8px', fontWeight: 700, fontSize: 8.5, borderBottom: '1px solid #ccc', background: '#e8e8e8' }}>
        Paid Preparer Use Only
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        <div style={{ padding: '4px 8px', borderRight: '1px solid #ccc' }}>
          <div style={F.fieldLbl}>Preparer's name</div>
          <div style={{ borderBottom: '1px solid #ccc', minHeight: 13, marginBottom: 3 }}>{pr?.name || ''}</div>
          <div style={F.fieldLbl}>Preparer's signature</div>
          <div style={{ borderBottom: '1px solid #ccc', minHeight: 13, marginBottom: 3 }}></div>
          <div style={F.fieldLbl}>Firm's name (or yours if self-employed)</div>
          <div style={{ borderBottom: '1px solid #ccc', minHeight: 13, marginBottom: 3 }}>{pr?.firmName || ''}</div>
          <div style={F.fieldLbl}>Address</div>
          <div style={{ borderBottom: '1px solid #ccc', minHeight: 13 }}>{pr?.firmAddress || ''}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
            <div style={{ flex: 2 }}>
              <div style={F.fieldLbl}>City</div>
              <div style={{ borderBottom: '1px solid #ccc', minHeight: 13 }}>{pr?.firmCity || ''}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={F.fieldLbl}>State</div>
              <div style={{ borderBottom: '1px solid #ccc', minHeight: 13 }}>{pr?.firmState || ''}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={F.fieldLbl}>ZIP code</div>
              <div style={{ borderBottom: '1px solid #ccc', minHeight: 13 }}>{pr?.firmZip || ''}</div>
            </div>
          </div>
        </div>
        <div style={{ padding: '4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
            <Chk checked={false} /> <span style={{ fontSize: 7.5 }}>Check if you're self-employed</span>
          </div>
          <div style={F.fieldLbl}>PTIN</div>
          <div style={{ borderBottom: '1px solid #ccc', minHeight: 13, marginBottom: 3 }}>{pr?.ptin || ''}</div>
          <div style={F.fieldLbl}>Date</div>
          <div style={{ borderBottom: '1px solid #ccc', minHeight: 13, marginBottom: 3 }}>
            {pr?.name ? new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : ''}
          </div>
          <div style={F.fieldLbl}>EIN</div>
          <div style={{ borderBottom: '1px solid #ccc', minHeight: 13, marginBottom: 3 }}>{pr?.firmEin || ''}</div>
          <div style={F.fieldLbl}>Phone</div>
          <div style={{ borderBottom: '1px solid #ccc', minHeight: 13 }}>{pr?.firmPhone || ''}</div>
        </div>
      </div>
    </div>
  );
}

// ── Form 941 ──────────────────────────────────────────────────────────────────
function Report941({ data, pr }) {
  const { client, period, lines, submissions } = data;
  const q = period.quarter;
  const line5e = (lines.line5a_ssTax || 0) + (lines.line5c_medTax || 0);
  const totalTax = lines.line6_totalTaxes || 0;
  const deposited = lines.line13_deposited || 0;
  const balDue = Math.max(0, totalTax - deposited);
  const overpmt = Math.max(0, deposited - totalTax);

  return (
    <>
      {/* ═══ PAGE 1 ═══════════════════════════════════════════════════════════ */}
      <div style={F.page} className="irs-page">
        {/* Top bar */}
        <div style={F.topbar}>
          <div style={F.topLeft}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={F.formNum}>941</span>
              <span style={F.formSub}>for {period.year}: (Rev. March 2026)</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 1 }}>Employer's QUARTERLY Federal Tax Return</div>
            <div style={F.dept}>Department of the Treasury — Internal Revenue Service</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              <span style={F.omb}>950126</span>
              <span style={F.omb}>OMB No. 1545-0029</span>
            </div>
          </div>
        </div>

        <Entity941 client={client} quarter={q} year={period.year} />

        <div style={F.note}>
          Read the separate instructions before you complete Form 941. Type or print within the boxes.
        </div>

        {/* Part 1 */}
        <div style={F.partHdr}>Part 1:&nbsp; Answer these questions for this quarter. Employers in American Samoa, Guam, the Commonwealth of the Northern Mariana Islands, the U.S. Virgin Islands, and Puerto Rico must skip lines 2 and 3, unless you have employees who are subject to U.S. income tax withholding.</div>

        {/* Line 1 */}
        <div style={F.line}>
          <div style={F.lineNum}>1</div>
          <div style={F.lineLbl}>
            Number of employees who received wages, tips, or other compensation for the pay period
            including: Mar. 12 (Quarter 1), June 12 (Quarter 2), Sept. 12 (Quarter 3), or Dec. 12 (Quarter 4)
          </div>
          <div style={{ ...F.lineNum, borderLeft: '1px solid #999', width: 18, fontWeight: 400, fontSize: 7, color: '#444' }}>1</div>
          <div style={{ ...F.lineVal, width: 72 }}>{lines.line1_employees || ''}</div>
        </div>

        <IrsLine num="2"  label="Wages, tips, and other compensation" value={fmt(lines.line2_wages)} />
        <IrsLine num="3"  label="Federal income tax withheld from wages, tips, and other compensation" value={fmt(lines.line3_fitWithheld)} />

        {/* Line 4 checkbox */}
        <div style={{ ...F.line, minHeight: 14 }}>
          <div style={F.lineNum}>4</div>
          <div style={{ ...F.lineLbl, gap: 6 }}>
            If no wages, tips, and other compensation are subject to social security or Medicare tax&nbsp;
            <Chk checked={false} />
            &nbsp;Check here and go to line 6.
          </div>
        </div>

        {/* SS/Medicare column headers */}
        <div style={{ display: 'flex', background: '#e8e8e8', borderBottom: '1px solid #ccc', padding: '2px 0 2px 24px', alignItems: 'center', fontSize: 7.5, fontWeight: 700 }}>
          <div style={{ flex: 1, paddingLeft: 6 }}>&nbsp;</div>
          <div style={{ width: 90, textAlign: 'center' }}>Column 1</div>
          <div style={{ width: 68 }}></div>
          <div style={{ width: 90, textAlign: 'center' }}>Column 2</div>
        </div>

        <SSLine num="5a" label="Taxable social security wages" wages={lines.line5a_ssWages} rate="× 0.124 =" tax={lines.line5a_ssTax} />
        <SSLine num="5b" label="Taxable social security tips" wages={null} rate="× 0.124 =" tax={null} />
        <SSLine num="5c" label="Taxable Medicare wages & tips" wages={lines.line5c_medWages} rate="× 0.029 =" tax={lines.line5c_medTax} />
        <SSLine num="5d" label="Taxable wages & tips subject to Additional Medicare Tax withholding" wages={null} rate="× 0.009 =" tax={null} />

        <IrsLine num="5e" label="Total social security and Medicare taxes. Add Column 2 from lines 5a, 5b, 5c, and 5d" value={fmt(line5e)} />
        <IrsLine num="5f" label="Section 3121(q) Notice and Demand—Tax due on unreported tips (see instructions)" value="" />
        <IrsLine num="6"  label="Total taxes before adjustments. Add lines 3, 5e, and 5f" value={fmt(totalTax)} highlight />
        <IrsLine num="7"  label="Current quarter's adjustment for fractions of cents" value="" />
        <IrsLine num="8"  label="Current quarter's adjustment for sick pay" value="" />
        <IrsLine num="9"  label="Current quarter's adjustments for tips and group-term life insurance" value="" />
        <IrsLine num="10" label="Total taxes after adjustments. Combine lines 6 through 9" value={fmt(totalTax)} highlight />
        <IrsLine num="11a" label="Qualified small business payroll tax credit for increasing research activities. Attach Form 8974" value="" />
        <IrsLine num="11b" label="Nonrefundable portion of credit for qualified sick and family leave wages from Worksheet 1" value="" />
        <IrsLine num="11c" label="Reserved for future use" value="" />
        <IrsLine num="11d" label="Nonrefundable portion of other credits. See instructions" value="" />
        <IrsLine num="11e" label="Total nonrefundable credits. Add lines 11a, 11b, 11c, and 11d" value="" />
        <IrsLine num="12" label="Total taxes after adjustments and nonrefundable credits. Subtract line 11e from line 10" value={fmt(totalTax)} highlight />
        <IrsLine num="13a" label="Total deposits for this quarter, including overpayment applied from a prior quarter and overpayments applied from Form 941-X filed in the current quarter" value={fmt(deposited)} />
        <IrsLine num="13b" label="Reserved for future use" value="" />
        <IrsLine num="13c" label="Refundable portion of credit for qualified sick and family leave wages from Worksheet 1" value="" />
        <IrsLine num="13d" label="Reserved for future use" value="" />
        <IrsLine num="13e" label="Total deposits and refundable credits. Add lines 13a, 13b, 13c, and 13d" value={fmt(deposited)} />
        <IrsLine num="13f" label="Total advances received from filing Form(s) 7200 for the quarter" value="" />
        <IrsLine num="13g" label="Total deposits and refundable credits less advances. Subtract line 13f from line 13e" value={fmt(deposited)} />
        <IrsLine num="14" label="Balance due. If line 12 is more than line 13g, enter the difference and see instructions" value={balDue > 0 ? fmt(balDue) : ''} highlight={balDue > 0} />

        <div style={F.line}>
          <div style={F.lineNum}>15</div>
          <div style={F.lineLbl}>
            Overpayment. If line 13g is more than line 12, enter the difference&nbsp;&nbsp;
            <span style={{ fontFamily: '"Courier New",monospace', fontWeight: 700 }}>{overpmt > 0 ? fmt(overpmt) : ''}</span>
            &nbsp;&nbsp;
            <Chk checked={false} /> Apply to next return. &nbsp; <Chk checked={false} /> Send a refund.
          </div>
        </div>

        <div style={F.note}>
          ▶ You MUST complete both pages of Form 941 and SIGN it.<br />
          For Privacy Act and Paperwork Reduction Act Notice, see separate instructions. &nbsp;&nbsp;&nbsp; Cat. No. 17001Z &nbsp;&nbsp;&nbsp; <strong>Form 941</strong> (Rev. 3-{period.year})
        </div>
      </div>

      {/* ═══ PAGE 2 ═══════════════════════════════════════════════════════════ */}
      <div style={F.page} className="irs-page irs-page-2">
        <MiniHeader941 client={client} pageCode="950224" />

        {/* Part 2 */}
        <div style={F.partHdr}>Part 2:&nbsp; Tell us about your deposit schedule and tax liability for this quarter.</div>
        <div style={{ padding: '4px 8px', fontSize: 8, borderBottom: '1px solid #ccc' }}>
          If you're unsure about whether you're a monthly schedule depositor or a semiweekly schedule depositor, see section 11 of Pub. 15.
        </div>
        <div style={{ padding: '4px 8px', fontSize: 8, borderBottom: '1px solid #ccc' }}>
          <strong>16</strong>&nbsp; Check one:
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <Chk checked={totalTax < 2500} />
              <span>Line 12 on this return is less than $2,500 or line 12 on the return for the prior quarter was less than $2,500, and you didn't incur a $100,000 next-day deposit obligation during the current quarter. If line 12 for the prior quarter was less than $2,500 but line 12 on this return is $100,000 or more, you must provide a record of your federal tax liability. If you're a monthly schedule depositor, complete the deposit schedule below; if you're a semiweekly schedule depositor, attach Schedule B (Form 941). Go to Part 3.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <Chk checked={false} />
              <div>
                <span>You were a monthly schedule depositor for the entire quarter. Enter your tax liability for each month and total liability for the quarter, then go to Part 3.</span>
                <div style={{ display: 'flex', gap: 24, marginTop: 4, fontSize: 8 }}>
                  {['Month 1', 'Month 2', 'Month 3'].map((m) => (
                    <div key={m}>
                      <div style={F.fieldLbl}>Tax liability: {m}</div>
                      <div style={{ borderBottom: '1px solid #999', minWidth: 80, minHeight: 13 }}></div>
                    </div>
                  ))}
                  <div>
                    <div style={F.fieldLbl}>Total liability for quarter</div>
                    <div style={{ borderBottom: '1px solid #999', minWidth: 80, minHeight: 13 }}></div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <Chk checked={false} />
              <span>You were a semiweekly schedule depositor for any part of this quarter. Complete Schedule B (Form 941), Report of Tax Liability for Semiweekly Schedule Depositors, and attach it to Form 941. Go to Part 3.</span>
            </div>
          </div>
        </div>

        {/* Part 3 */}
        <div style={F.partHdr}>Part 3:&nbsp; Tell us about your business. If a question does NOT apply to your business, leave it blank.</div>
        <div style={{ padding: '4px 8px', fontSize: 8, borderBottom: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong>17</strong>&nbsp;
          If your business has closed or you stopped paying wages&nbsp;.&nbsp;.&nbsp;.&nbsp;.&nbsp;.&nbsp;.&nbsp;.&nbsp;.&nbsp;.&nbsp;.&nbsp;.
          &nbsp;<Chk checked={false} />&nbsp; Check here;&nbsp;
          also attach a statement to your return. See instructions.&nbsp; Enter the final date you paid wages: &nbsp;
          <span style={{ borderBottom: '1px solid #999', display: 'inline-block', minWidth: 90 }}></span>
        </div>
        <div style={{ padding: '4px 8px', fontSize: 8, borderBottom: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong>18</strong>&nbsp;
          If you're a seasonal employer and you don't have to file a return for every quarter of the year&nbsp;.&nbsp;.&nbsp;.&nbsp;
          &nbsp;<Chk checked={false} />&nbsp; Check here.
        </div>
        <div style={{ padding: '4px 8px', fontSize: 8, borderBottom: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong>19</strong>&nbsp;
          Qualified health plan expenses allocable to qualified sick leave wages&nbsp;.&nbsp;.&nbsp;.&nbsp;.&nbsp;.&nbsp;
          <strong>19</strong>&nbsp;
          <span style={{ borderBottom: '1px solid #999', display: 'inline-block', minWidth: 80 }}></span>
          &nbsp;&nbsp;&nbsp;
          <strong>20</strong>&nbsp;
          Qualified health plan expenses allocable to qualified family leave wages&nbsp;.&nbsp;<strong>20</strong>&nbsp;
          <span style={{ borderBottom: '1px solid #999', display: 'inline-block', minWidth: 80 }}></span>
        </div>

        {/* Part 4 */}
        <div style={F.partHdr}>Part 4:&nbsp; May we speak with your third-party designee?</div>
        <DesigneeSection pr={pr} />

        {/* Part 5 */}
        <div style={F.partHdr}>Part 5:&nbsp; Sign here. You MUST complete both pages of Form 941 and SIGN it.</div>
        <div style={F.note}>
          Under penalties of perjury, I declare that I have examined this return, including accompanying schedules and statements, and to the best of my knowledge and belief, it is true, correct, and complete. Declaration of preparer (other than taxpayer) is based on all information of which preparer has any knowledge.
        </div>
        <SignatureBlock pr={pr} />
        <PreparerBlock pr={pr} />

        <div style={{ padding: '3px 8px', fontSize: 7.5, borderTop: '1px solid #ccc', textAlign: 'right', color: '#555' }}>
          Page 2 &nbsp;&nbsp;&nbsp; <strong>Form 941</strong> (Rev. 3-{period.year})
        </div>
      </div>

      {/* ═══ Supporting detail ════════════════════════════════════════════════ */}
      {submissions.length > 0 && (
        <div style={{ ...F.page }} className="irs-page irs-page-2">
          <div style={{ padding: '4px 8px', background: '#e8e8e8', fontSize: 8.5, fontWeight: 700, borderBottom: '1px solid #ccc' }}>
            Supporting Paycheck Detail — {submissions.length} check{submissions.length !== 1 ? 's' : ''} for Q{q} {period.year}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #aaa' }}>
                {['Pay Period End', 'Employee', 'Gross Wages', 'FIT', 'SS Total', 'Med Total', '941 Deposit', 'EFTPS Status'].map((h) => (
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
                    <span style={{ background: s.eftpsStatus === 'submitted' ? '#d1fae5' : s.eftpsStatus === 'pending' ? '#fef3c7' : '#f5f5f5', padding: '1px 4px', borderRadius: 3, fontSize: 7, fontWeight: 700, textTransform: 'uppercase' }}>
                      {s.eftpsStatus || 'pending'}
                    </span>
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#f0f0f0', fontWeight: 700, borderTop: '1px solid #aaa' }}>
                <td colSpan={2} style={{ padding: '3px 5px', fontSize: 7.5 }}>Total</td>
                {[
                  submissions.reduce((s, r) => s + r.grossWages, 0),
                  submissions.reduce((s, r) => s + r.fitWithholding, 0),
                  submissions.reduce((s, r) => s + r.ssTotal, 0),
                  submissions.reduce((s, r) => s + r.medTotal, 0),
                  submissions.reduce((s, r) => s + r.totalDeposit, 0),
                ].map((v, i) => (
                  <td key={i} style={{ padding: '3px 5px', fontFamily: 'monospace', textAlign: 'right' }}>{fmtAmt(v)}</td>
                ))}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Form 940 ──────────────────────────────────────────────────────────────────
function Report940({ data, pr }) {
  const { client, period, lines, byEmployee } = data;
  const excessWages = Math.max(0, (lines.line3_totalPayments || 0) - (lines.line5_futaTaxableWages || 0));
  const netFuta = lines.line12_netFuta || 0;

  return (
    <>
      {/* ═══ PAGE 1 ═══════════════════════════════════════════════════════════ */}
      <div style={F.page} className="irs-page">
        <div style={F.topbar}>
          <div style={F.topLeft}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={F.formNum}>940</span>
              <span style={F.formSub}>for {period.year}: Employer's Annual Federal Unemployment (FUTA) Tax Return</span>
            </div>
            <div style={F.dept}>Department of the Treasury — Internal Revenue Service</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              <span style={F.omb}>850125</span>
              <span style={F.omb}>OMB No. 1545-0029</span>
            </div>
          </div>
        </div>

        <EntityBlock940 client={{ ...client, year: period.year }} />

        <div style={F.note}>Read the separate instructions before you complete this form. Please type or print within the boxes.</div>

        {/* Part 1 */}
        <div style={F.partHdr}>Part 1:&nbsp; Tell us about your return. If any line does NOT apply, leave it blank. See instructions before completing Part 1.</div>
        <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Chk checked />&nbsp;
          <strong>1a</strong>&nbsp; If you had to pay state unemployment tax in one state only, enter the state abbreviation . . . . . . . . . . 1a &nbsp;
          <span style={{ border: '1px solid #000', padding: '1px 8px', fontFamily: '"Courier New",monospace', fontWeight: 700 }}>{client.state || 'TX'}</span>
        </div>
        <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Chk checked={false} />&nbsp;
          <strong>1b</strong>&nbsp; If you had to pay state unemployment tax in more than one state, you are a multi-state employer . . . . . . 1b &nbsp;
          <span style={{ fontSize: 7.5, color: '#555' }}>Check here. Complete Schedule A (Form 940).</span>
        </div>
        <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Chk checked={false} />&nbsp;
          <strong>2</strong>&nbsp; If you paid wages in a state that is subject to CREDIT REDUCTION . . . . . . . . . . . . . . . . . . . 2 &nbsp;
          <span style={{ fontSize: 7.5, color: '#555' }}>Check here. Complete Schedule A (Form 940).</span>
        </div>

        {/* Part 2 */}
        <div style={F.partHdr}>Part 2:&nbsp; Determine your FUTA tax before adjustments. If any line does NOT apply, leave it blank.</div>
        <IrsLine num="3" label="Total payments to all employees" value={fmt(lines.line3_totalPayments)} />
        <div style={F.line}>
          <div style={F.lineNum}>4</div>
          <div style={F.lineLbl}>
            Payments exempt from FUTA tax . . . Check all that apply:&nbsp;
            <Chk checked={false} /> 4a Fringe benefits &nbsp;
            <Chk checked={false} /> 4b Group-term life insurance &nbsp;
            <Chk checked={false} /> 4c Retirement/Pension &nbsp;
            <Chk checked={false} /> 4d Dependent care &nbsp;
            <Chk checked={false} /> 4e Other
          </div>
          <div style={{ ...F.lineNum, borderLeft: '1px solid #999', width: 18, fontWeight: 400, fontSize: 7, color: '#444' }}>4</div>
          <div style={F.lineVal}></div>
        </div>
        <IrsLine num="5" label="Total of payments made to each employee in excess of $7,000" value={fmt(excessWages)} />
        <IrsLine num="6" label="Subtotal (line 4 + line 5 = line 6)" value={fmt(excessWages)} />
        <IrsLine num="7" label="Total taxable FUTA wages (line 3 – line 6 = line 7). See instructions" value={fmt(lines.line5_futaTaxableWages)} />
        <IrsLine num="8" label="FUTA tax before adjustments (line 7 × 0.006 = line 8)" value={fmt(netFuta)} highlight />

        {/* Part 3 */}
        <div style={F.partHdr}>Part 3:&nbsp; Determine your adjustments. If any line does NOT apply, leave it blank.</div>
        <IrsLine num="9"  label="If ALL of the taxable FUTA wages you paid were excluded from state unemployment tax, multiply line 7 by 0.054 (line 7 × 0.054 = line 9). Go to line 12" value="" />
        <IrsLine num="10" label="If SOME of the taxable FUTA wages you paid were excluded from state unemployment tax, OR you paid ANY state unemployment tax late (after the due date for filing Form 940), complete the worksheet in the instructions. Enter the amount from line 7 of the worksheet" value="" />
        <IrsLine num="11" label="If credit reduction applies, enter the total from Schedule A (Form 940)" value="" />

        {/* Part 4 */}
        <div style={F.partHdr}>Part 4:&nbsp; Determine your FUTA tax and balance due or overpayment. If any line does NOT apply, leave it blank.</div>
        <IrsLine num="12" label="Total FUTA tax after adjustments (lines 8 + 9 + 10 + 11 = line 12)" value={fmt(netFuta)} highlight />
        <IrsLine num="13" label="FUTA tax deposited for the year, including any overpayment applied from a prior year" value={fmt(netFuta)} />
        <IrsLine num="14" label="Balance due. If line 12 is more than line 13, enter the excess on line 14. • If line 14 is more than $500, you must deposit your tax. • If line 14 is $500 or less, you may pay with this return. See instructions" value="" />

        <div style={F.line}>
          <div style={F.lineNum}>15a</div>
          <div style={F.lineLbl}>
            Overpayment. If line 13 is more than line 12, enter the difference
            <span style={{ fontFamily: '"Courier New",monospace', marginLeft: 8 }}></span>
            &nbsp;&nbsp; 15b Check one: &nbsp;
            <Chk checked={false} /> Apply to next return. &nbsp;
            <Chk checked={false} /> Send a refund.
          </div>
        </div>
        <div style={{ padding: '3px 8px', fontSize: 8, borderBottom: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div>
            <strong>15c</strong> Routing number &nbsp;
            <span style={{ borderBottom: '1px solid #999', display: 'inline-block', minWidth: 120 }}></span>
          </div>
          <div>
            <strong>15d</strong> Type: &nbsp; <Chk checked={false} /> Checking &nbsp; <Chk checked={false} /> Savings
          </div>
          <div>
            <strong>15e</strong> Account number &nbsp;
            <span style={{ borderBottom: '1px solid #999', display: 'inline-block', minWidth: 150 }}></span>
          </div>
        </div>

        <div style={F.note}>
          ▶ You MUST complete both pages of this form and SIGN it.<br />
          For Privacy Act and Paperwork Reduction Act Notice, see separate instructions. &nbsp;&nbsp;&nbsp; <strong>Form 940</strong> ({period.year})
        </div>
      </div>

      {/* ═══ PAGE 2 ═══════════════════════════════════════════════════════════ */}
      <div style={F.page} className="irs-page irs-page-2">
        <MiniHeader941 client={client} pageCode="850212" />

        {/* Part 5 */}
        <div style={F.partHdr}>Part 5:&nbsp; Report your FUTA tax liability by quarter only if line 12 is more than $500. If not, go to Part 6.</div>
        <div style={{ padding: '4px 8px', fontSize: 8, borderBottom: '1px solid #ccc' }}>
          <strong>16</strong>&nbsp; Report the amount of your FUTA tax liability for each quarter; do NOT enter the amount you deposited. If you had no liability for a quarter, leave the line blank.
        </div>
        <IrsLine num="16a" label="1st quarter (January 1 – March 31)" value="" />
        <IrsLine num="16b" label="2nd quarter (April 1 – June 30)" value="" />
        <IrsLine num="16c" label="3rd quarter (July 1 – September 30)" value="" />
        <IrsLine num="16d" label="4th quarter (October 1 – December 31)" value="" />
        <IrsLine num="17" label="Total tax liability for the year (lines 16a + 16b + 16c + 16d = line 17)  Total must equal line 12." value={fmt(netFuta)} highlight />

        {/* Part 6 */}
        <div style={F.partHdr}>Part 6:&nbsp; May we speak with your third-party designee?</div>
        <DesigneeSection pr={pr} />

        {/* Part 7 */}
        <div style={F.partHdr}>Part 7:&nbsp; Sign here. You MUST complete both pages of this form and SIGN it.</div>
        <div style={F.note}>
          Under penalties of perjury, I declare that I have examined this return and accompanying documents and, to the best of my knowledge and belief, they are true, correct, and complete, and that no part of any payment made to a state unemployment fund claimed as a credit was, or is to be, deducted from the payments made to employees. Declaration of preparer (other than taxpayer) is based on all information of which preparer has any knowledge.
        </div>
        <SignatureBlock pr={pr} />
        <PreparerBlock pr={pr} />

        <div style={{ padding: '3px 8px', fontSize: 7.5, borderTop: '1px solid #ccc', textAlign: 'right', color: '#555' }}>
          Page 2 &nbsp;&nbsp;&nbsp; <strong>Form 940</strong> ({period.year})
        </div>
      </div>

      {/* FUTA by employee */}
      {byEmployee.length > 0 && (
        <div style={{ ...F.page }} className="irs-page irs-page-2">
          <div style={{ padding: '4px 8px', background: '#e8e8e8', fontSize: 8.5, fontWeight: 700, borderBottom: '1px solid #ccc' }}>
            FUTA Detail by Employee — {period.year}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #aaa' }}>
                {['Employee', 'Total Wages', 'FUTA Taxable Wages', 'FUTA Tax (0.6%)'].map((h) => (
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
    </>
  );
}

// ── TWC / SUTA ────────────────────────────────────────────────────────────────
const TWC_PERIOD_END  = { 1: '03/31', 2: '06/30', 3: '09/30', 4: '12/31' };
const TWC_PENALTY_MO  = { 1: '04', 2: '07', 3: '10', 4: '01' };
const TWC_PENALTY_DAY = { 1: '30', 2: '31', 3: '31', 4: '31' };

function ReportTWC({ data, pr }) {
  const { client, period, sutaRate, lines, byEmployee } = data;
  const q = period.quarter;
  const periodEnd   = `${TWC_PERIOD_END[q]}/${period.year}`;
  const penaltyYr   = q === 4 ? period.year + 1 : period.year;
  const penaltyDate = `${TWC_PENALTY_MO[q]}/${TWC_PENALTY_DAY[q]}/${penaltyYr}`;
  const wageBase    = lines.wageBase || 9000;
  const excessWages = Math.max(0, (lines.totalWages || 0) - (lines.sutaTaxableWages || 0));
  const empCount    = byEmployee.length || 1;

  const Row = ({ label, value, bold }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 9.5, fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span style={{ fontFamily: '"Courier New",monospace' }}>{value}</span>
    </div>
  );

  return (
    <div style={F.page} className="irs-page">
      {/* Header */}
      <div style={{ borderBottom: '2px solid #000', padding: '5px 8px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 900 }}>Texas Unemployment Insurance — Quarterly Contribution Report</div>
        <div style={{ fontSize: 9, color: '#555', marginTop: 1 }}>Worksheet</div>
        <div style={{ fontSize: 7.5, color: '#777', marginTop: 1 }}>This is a record of your information to complete your Unemployment Insurance Contribution Report. Do not file the worksheet.</div>
      </div>

      {/* Row 1: FEIN | Company | Period */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', borderBottom: '1px solid #000' }}>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>FEIN No.</div>
          <div style={{ fontFamily: '"Courier New",monospace', fontSize: 11, fontWeight: 700 }}>{client.ein}</div>
        </div>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>Company Legal Name</div>
          <div style={{ fontSize: 10.5, fontWeight: 700 }}>{client.businessName}</div>
        </div>
        <div style={{ padding: '4px 6px' }}>
          <div style={F.fieldLbl}>Period Ending</div>
          <div style={{ fontFamily: '"Courier New",monospace', fontSize: 11, fontWeight: 700 }}>{periodEnd}</div>
        </div>
      </div>

      {/* Row 2: Account | Address | Penalty */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', borderBottom: '1px solid #000' }}>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>Account No.</div>
          <div style={{ fontSize: 9.5 }}>{client.twcAccountNumber || ''}</div>
        </div>
        <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
          <div style={F.fieldLbl}>Company Legal Address</div>
          <div style={{ fontSize: 9 }}>{client.businessAddress || ''}</div>
        </div>
        <div style={{ padding: '4px 6px' }}>
          <div style={F.fieldLbl}>Penalty Date</div>
          <div style={{ fontFamily: '"Courier New",monospace', fontSize: 10.5, fontWeight: 700 }}>{penaltyDate}</div>
        </div>
      </div>

      {/* Row 3: NAICS | City/State/ZIP | IDs */}
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

      <div style={{ textAlign: 'center', padding: '2px', background: '#d0d0d0', borderBottom: '1px solid #999', fontSize: 7.5, fontWeight: 700 }}>Do Not Mail — Keep for Your Records</div>

      {/* Calculation block */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #000' }}>
        <div style={{ padding: '8px 12px', borderRight: '1px solid #000' }}>
          <Row label="Total State Wages" value={`$${fmtZ(lines.totalWages)}`} bold />
          <Row label="Excess Wages" value={`$${fmtZ(excessWages)}`} />
          <div style={{ borderTop: '1px solid #ccc', marginBottom: 4, marginTop: 2 }}></div>
          <Row label={`Wage Base   $${wageBase.toLocaleString()}`} value="" />
          <Row label="Taxable Wages" value={`$${fmtZ(lines.sutaTaxableWages)}`} bold />
          <Row label="Rate" value={fmtPct(sutaRate)} />
          <div style={{ borderTop: '1px solid #000', paddingTop: 4, marginTop: 2 }}>
            <Row label="UI Contributions" value={`$${fmtZ(lines.sutaTax)}`} bold />
          </div>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <Row label="Overpayment (negative) / Bal Due from a previous period" value="$      0.00" />
          <div style={{ borderTop: '1px solid #000', paddingTop: 6, marginBottom: 14, marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
              <span>Total Payment Due</span>
              <span style={{ fontFamily: '"Courier New",monospace' }}>${fmtZ(lines.sutaTax)}</span>
            </div>
          </div>
          <div style={{ borderTop: '1px solid #ccc', paddingTop: 8 }}>
            <div style={{ fontSize: 8, color: '#555', marginBottom: 6 }}>
              Number of employees receiving pay for pay period which includes 12th day of the month
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 9.5 }}>
              {['1st Month', '2nd Month', '3rd Month'].map((label) => (
                <div key={label}>
                  <div style={F.fieldLbl}>{label}</div>
                  <div style={{ fontFamily: '"Courier New",monospace', fontWeight: 700 }}>{empCount}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '2px', background: '#d0d0d0', borderBottom: '1px solid #999', fontSize: 7.5, fontWeight: 700 }}>Do Not Mail — Keep for Your Records</div>

      {/* Wage Report */}
      {byEmployee.length > 0 && (
        <>
          <div style={{ borderTop: '2px solid #000', padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid #000' }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Texas Unemployment Insurance — Wage Report</div>
            <div style={{ fontSize: 9, color: '#555', marginTop: 1 }}>Worksheet</div>
            <div style={{ fontSize: 7.5, color: '#777', marginTop: 1 }}>This is a record of your information to complete your Unemployment Insurance Wage Report. Do not file the worksheet.</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', borderBottom: '1px solid #000' }}>
            <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
              <div style={F.fieldLbl}>Company Legal Name</div>
              <div style={{ fontSize: 10.5, fontWeight: 700 }}>{client.businessName}</div>
            </div>
            <div style={{ padding: '4px 6px', borderRight: '1px solid #000' }}>
              <div style={F.fieldLbl}>FEIN</div>
              <div style={{ fontFamily: '"Courier New",monospace', fontSize: 11, fontWeight: 700 }}>{client.ein}</div>
            </div>
            <div style={{ padding: '4px 6px' }}>
              <div style={F.fieldLbl}>Period Ending</div>
              <div style={{ fontFamily: '"Courier New",monospace', fontSize: 11, fontWeight: 700 }}>{periodEnd}</div>
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

          <div style={{ textAlign: 'center', padding: '2px', background: '#d0d0d0', borderBottom: '1px solid #999', fontSize: 7.5, fontWeight: 700 }}>Do Not Mail — Keep for Your Records</div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8.5 }}>
            <thead>
              <tr style={{ background: '#f0f0f0', borderBottom: '1px solid #aaa' }}>
                <th style={{ padding: '4px 8px', fontSize: 8, textAlign: 'left' }}>Employee Social Security No.</th>
                <th style={{ padding: '4px 8px', fontSize: 8, textAlign: 'left' }}>Employee Name (Last, First, MI)</th>
                <th style={{ padding: '4px 8px', fontSize: 8, textAlign: 'right' }}>Total Wages</th>
                <th style={{ padding: '4px 8px', fontSize: 8, textAlign: 'right' }}>Taxable Wages</th>
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e0e0e0' }}>
                  <td style={{ padding: '4px 8px', fontFamily: '"Courier New",monospace' }}>{e.ssn || '***-**-****'}</td>
                  <td style={{ padding: '4px 8px' }}>{e.name}</td>
                  <td style={{ padding: '4px 8px', fontFamily: '"Courier New",monospace', textAlign: 'right' }}>{fmtZ(e.wages)}</td>
                  <td style={{ padding: '4px 8px', fontFamily: '"Courier New",monospace', textAlign: 'right' }}>{fmtZ(e.sutaTaxable)}</td>
                </tr>
              ))}
              <tr style={{ background: '#f0f0f0', fontWeight: 700, borderTop: '1px solid #aaa' }}>
                <td colSpan={2} style={{ padding: '4px 8px', fontSize: 7.5 }}>Totals for this page</td>
                <td style={{ padding: '4px 8px', fontFamily: '"Courier New",monospace', textAlign: 'right' }}>{fmtZ(lines.totalWages)}</td>
                <td style={{ padding: '4px 8px', fontFamily: '"Courier New",monospace', textAlign: 'right' }}>{fmtZ(lines.sutaTaxableWages)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ textAlign: 'center', padding: '2px', background: '#d0d0d0', borderTop: '1px solid #999', fontSize: 7.5, fontWeight: 700 }}>Do Not Mail — Keep for Your Records</div>
        </>
      )}
    </div>
  );
}

// ── W-2 ───────────────────────────────────────────────────────────────────────
function W2Box({ num, label, value, span }) {
  return (
    <div style={{ border: '1px solid #aaa', padding: '2px 4px', background: '#fff', gridColumn: span ? `span ${span}` : undefined }}>
      <div style={{ fontSize: 6.5, color: '#555' }}>{num ? `${num} ` : ''}{label}</div>
      <div style={{ fontFamily: '"Courier New",monospace', fontSize: 10, fontWeight: 700, minHeight: 13 }}>{value || ''}</div>
    </div>
  );
}

function ReportW2({ data, pr }) {
  const { client, period, w2s } = data;
  return (
    <div style={{ ...F.page }} className="irs-page">
      {/* Header */}
      <div style={{ borderBottom: '2px solid #000', padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={F.formNum}>W-2</span>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Wage and Tax Statement</span>
          </div>
          <div style={F.dept}>Department of the Treasury — Internal Revenue Service</div>
          <div style={{ fontSize: 8, marginTop: 2 }}>Tax Year {period.year} &nbsp;&nbsp; OMB No. 1545-0029</div>
        </div>
        <div style={{ fontSize: 8, color: '#555', textAlign: 'right', fontStyle: 'italic' }}>
          Copy A — For Social Security Administration
        </div>
      </div>

      {/* Employer block */}
      <div style={{ borderBottom: '1px solid #ccc', padding: '4px 8px' }}>
        <div style={{ fontSize: 8, fontWeight: 700, marginBottom: 2 }}>c Employer's name, address, and ZIP code</div>
        <div style={{ fontSize: 11, fontWeight: 700 }}>{client.businessName}</div>
        {client.tradeName && <div style={{ fontSize: 9.5 }}>{client.tradeName}</div>}
        {client.businessAddress && <div style={{ fontSize: 9.5 }}>{client.businessAddress}</div>}
        {client.businessCity && <div style={{ fontSize: 9.5 }}>{client.businessCity}, {client.state || 'TX'} {client.businessZip || ''}</div>}
        <div style={{ marginTop: 4, fontSize: 8.5 }}>
          <strong>b Employer identification number (EIN): </strong>
          <span style={{ fontFamily: '"Courier New",monospace', fontWeight: 700 }}>{client.ein}</span>
        </div>
      </div>

      {w2s.map((w, idx) => (
        <div key={w.employeeId} style={{ borderBottom: idx < w2s.length - 1 ? '3px double #000' : 'none' }}>
          {/* Employee */}
          <div style={{ padding: '4px 8px', borderBottom: '1px solid #ccc', background: '#f9f9f9' }}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: 8, fontWeight: 700 }}>a Employee's social security number: </span>
                <span style={{ fontFamily: '"Courier New",monospace', fontWeight: 700, fontSize: 10 }}>{w.ssn}</span>
              </div>
              <div>
                <span style={{ fontSize: 8, fontWeight: 700 }}>e Employee's name: </span>
                <span style={{ fontWeight: 700 }}>{w.firstName} {w.lastName}</span>
              </div>
            </div>
            {w.address && (
              <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>
                f {w.address}{w.city ? `, ${w.city}` : ''}{w.state ? `, ${w.state}` : ''} {w.zip || ''}
              </div>
            )}
          </div>

          {/* Wage boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, padding: 3, background: '#ccc' }}>
            <W2Box num="1"  label="Wages, tips, other compensation"  value={w.box1_wages > 0 ? fmtZ(w.box1_wages) : ''} />
            <W2Box num="2"  label="Federal income tax withheld"       value={w.box2_fitWithheld > 0 ? fmtZ(w.box2_fitWithheld) : ''} />
            <W2Box num=""   label="" value="" />
            <W2Box num="3"  label="Social security wages"             value={w.box3_ssWages > 0 ? fmtZ(w.box3_ssWages) : ''} />
            <W2Box num="4"  label="Social security tax withheld"      value={w.box4_ssTax > 0 ? fmtZ(w.box4_ssTax) : ''} />
            <W2Box num=""   label="(a) Uncollected SS on tips" value="" />
            <W2Box num="5"  label="Medicare wages and tips"           value={w.box5_medWages > 0 ? fmtZ(w.box5_medWages) : ''} />
            <W2Box num="6"  label="Medicare tax withheld"             value={w.box6_medTax > 0 ? fmtZ(w.box6_medTax) : ''} />
            <W2Box num="7"  label="Social security tips"              value="" />
            <W2Box num="8"  label="Allocated tips"                    value="" />
            <W2Box num="9"  label=""                                  value="" />
            <W2Box num="10" label="Dependent care benefits"           value="" />
            <W2Box num="11" label="Nonqualified plans"                value="" />
            <W2Box num="12a" label="See instructions for box 12"      value="" />
            <div style={{ display: 'flex', gap: 1, flexDirection: 'column', background: '#ccc' }}>
              <W2Box num="13" label="Statutory employee □  Retirement plan □  Third-party sick pay □" value="" />
              <W2Box num="14" label="Other" value="" />
            </div>
            <W2Box num="12b" label="" value="" />
            <W2Box num="12c" label="" value="" />
            <W2Box num="12d" label="" value="" />
          </div>

          {/* State boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, padding: '0 3px 3px', background: '#ccc' }}>
            <W2Box num="15" label="State / Employer's state ID no." value={client.state || 'TX'} />
            <W2Box num="16" label="State wages, tips, etc."          value={w.box16_stateWages > 0 ? fmtZ(w.box16_stateWages) : ''} />
            <W2Box num="17" label="State income tax"                 value="" />
            <W2Box num="18" label="Local wages, tips, etc."          value="" />
            <W2Box num="19" label="Local income tax"                 value="" />
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
    <div style={F.page} className="irs-page">
      {/* Header */}
      <div style={{ borderBottom: '2px solid #000', padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...F.formNum, fontSize: 22 }}>W-3</span>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Transmittal of Wage and Tax Statements</span>
          </div>
          <div style={F.dept}>Department of the Treasury — Internal Revenue Service</div>
          <div style={{ fontSize: 8, marginTop: 2 }}>For calendar year {period.year} &nbsp;&nbsp; OMB No. 1545-0029</div>
        </div>
        <div style={{ fontSize: 8, textAlign: 'right' }}>
          <div style={{ fontWeight: 700 }}>{totals.employeeCount} W-2 Form{totals.employeeCount !== 1 ? 's' : ''}</div>
          <div style={{ fontSize: 7, color: '#555' }}>33333</div>
        </div>
      </div>

      {/* Kind of payer/employer */}
      <div style={{ borderBottom: '1px solid #000', display: 'flex' }}>
        <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
          <div style={{ fontSize: 8, fontWeight: 700, marginBottom: 2 }}>b Kind of Payer (Check one)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 16px', fontSize: 7.5 }}>
            {[['941 (Most common)', true], ['943', false], ['944', false], ['Household employer', false], ['Medicare govt. employer', false], ['Military', false]].map(([o, chk]) => (
              <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Chk checked={chk} /><span>{o}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '4px 8px' }}>
          <div style={{ fontSize: 8, fontWeight: 700, marginBottom: 2 }}>Kind of Employer (Check one)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 7.5 }}>
            {[['None apply', true], ['State/local non-501c', false], ['501c non-govt.', false], ['State/local 501c', false], ['Federal govt.', false]].map(([o, chk]) => (
              <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Chk checked={chk} /><span>{o}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Employer info + boxes */}
      <div style={{ borderBottom: '1px solid #000', display: 'flex' }}>
        <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
          <div style={F.fieldLbl}>e Employer identification number (EIN)</div>
          <div style={{ ...F.fieldVal, fontFamily: '"Courier New",monospace', fontSize: 12, marginBottom: 4 }}>{client.ein}</div>
          <div style={F.fieldLbl}>f Employer's name</div>
          <div style={{ ...F.fieldVal, marginBottom: 4 }}>{client.businessName}</div>
          <div style={F.fieldLbl}>g Employer's address and ZIP code</div>
          <div style={F.fieldVal}>{[client.businessAddress, client.businessCity, client.state || 'TX', client.businessZip].filter(Boolean).join(', ')}</div>
          <div style={{ marginTop: 6 }}>
            <div style={F.fieldLbl}>Employer's contact person</div>
            <div style={{ fontWeight: 700, borderBottom: '1px solid #ccc', minHeight: 13 }}>{pr?.name || ''}</div>
          </div>
          <div style={{ marginTop: 4 }}>
            <div style={F.fieldLbl}>Employer's telephone number</div>
            <div style={{ borderBottom: '1px solid #ccc', minHeight: 13 }}>{pr?.phone || ''}</div>
          </div>
          <div style={{ marginTop: 4 }}>
            <div style={F.fieldLbl}>Employer's email address</div>
            <div style={{ borderBottom: '1px solid #ccc', minHeight: 13 }}>{pr?.email || ''}</div>
          </div>
        </div>

        {/* Totals boxes */}
        <div style={{ flex: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, padding: 3, background: '#ccc', alignContent: 'start' }}>
          <W2Box num="1"   label="Wages, tips, other compensation"     value={totals.box1_wages > 0 ? fmtZ(totals.box1_wages) : ''} />
          <W2Box num="2"   label="Federal income tax withheld"         value={totals.box2_fitWithheld > 0 ? fmtZ(totals.box2_fitWithheld) : ''} />
          <W2Box num="3"   label="Social security wages"               value={totals.box3_ssWages > 0 ? fmtZ(totals.box3_ssWages) : ''} />
          <W2Box num="4"   label="Social security tax withheld"        value={totals.box4_ssTax > 0 ? fmtZ(totals.box4_ssTax) : ''} />
          <W2Box num="5"   label="Medicare wages and tips"             value={totals.box5_medWages > 0 ? fmtZ(totals.box5_medWages) : ''} />
          <W2Box num="6"   label="Medicare tax withheld"               value={totals.box6_medTax > 0 ? fmtZ(totals.box6_medTax) : ''} />
          <W2Box num="7"   label="Social security tips"                value="" />
          <W2Box num="8"   label="Allocated tips"                      value="" />
          <W2Box num="9"   label=""                                    value="" />
          <W2Box num="10"  label="Dependent care benefits"             value="" />
          <W2Box num="11"  label="Nonqualified plans"                  value="" />
          <W2Box num="12a" label="Deferred compensation"               value="" />
          <W2Box num="14"  label="Income tax withheld by payer of third-party sick pay" value="" />
          <W2Box num=""    label="" value="" />
        </div>
      </div>

      {/* State row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, padding: '0 3px 3px', background: '#ccc' }}>
        <W2Box num="15" label="State / Employer's state ID no." value={totals.box15_state || 'TX'} />
        <W2Box num="16" label="State wages, tips, etc."         value={totals.box16_stateWages > 0 ? fmtZ(totals.box16_stateWages) : ''} />
        <W2Box num="17" label="State income tax"                value="" />
        <W2Box num=""   label="" value="" />
      </div>

      {/* Signature */}
      <div style={{ padding: '4px 8px', borderTop: '1px solid #000', fontSize: 7.5 }}>
        Under penalties of perjury, I declare that I have examined this return and accompanying documents and, to the best of my knowledge and belief, they are true, correct, and complete.
      </div>
      <SignatureBlock pr={pr} />
    </div>
  );
}

// ── Preparer Info Form ─────────────────────────────────────────────────────────
const PREPARER_FIELDS = [
  { key: 'name',        label: 'Preparer Name',            placeholder: 'Full name' },
  { key: 'ptin',        label: 'PTIN',                     placeholder: 'P00000000' },
  { key: 'title',       label: 'Title',                    placeholder: 'CPA, EA, R. Agent, etc.' },
  { key: 'phone',       label: 'Preparer Phone',           placeholder: '(555) 000-0000' },
  { key: 'email',       label: 'Email',                    placeholder: 'preparer@firm.com' },
  { key: 'firmName',    label: 'Firm Name',                placeholder: 'Firm or your name if self-employed' },
  { key: 'firmEin',     label: 'Firm EIN',                 placeholder: '00-0000000' },
  { key: 'firmAddress', label: 'Firm Address',             placeholder: '123 Main St' },
  { key: 'firmCity',    label: 'Firm City',                placeholder: 'City' },
  { key: 'firmState',   label: 'Firm State',               placeholder: 'TX' },
  { key: 'firmZip',     label: 'Firm ZIP',                 placeholder: '00000' },
  { key: 'firmPhone',   label: 'Firm Phone',               placeholder: '(555) 000-0000' },
  { key: 'desgName',    label: 'Designee Name',            placeholder: 'Third-party designee name' },
  { key: 'desgPhone',   label: 'Designee Phone',           placeholder: '(555) 000-0000' },
  { key: 'desgPin',     label: 'Designee PIN (5 digits)',  placeholder: '00000' },
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

  const [preparer, setPreparer] = useState({});
  const [prForm, setPrForm]     = useState({});
  const [prSaving, setPrSaving] = useState(false);
  const [prSaved, setPrSaved]   = useState(false);
  const [prError, setPrError]   = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError]     = useState('');
  const [twcBridgeConnected, setTwcBridgeConnected] = useState(false);
  const [twcSubmitting, setTwcSubmitting]           = useState(false);
  const [twcSubmission, setTwcSubmission]           = useState(null); // { id, status, confirmationNumber, error }

  const needsQuarter = reportType === '941' || reportType === 'twc';

  // Poll TWC bridge connection status when on TWC tab
  useEffect(() => {
    if (reportType !== 'twc') return;
    let cancelled = false;
    const check = () => api.getTwcBridgeStatus().then(r => { if (!cancelled) setTwcBridgeConnected(r.connected); }).catch(() => {});
    check();
    const t = setInterval(check, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [reportType]);

  // Poll submission status while processing
  useEffect(() => {
    if (!twcSubmission || twcSubmission.status === 'completed' || twcSubmission.status === 'failed') return;
    let cancelled = false;
    const poll = () => api.getTwcSubmission(twcSubmission.id).then(s => {
      if (!cancelled) setTwcSubmission(s);
    }).catch(() => {});
    const t = setInterval(poll, 3_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [twcSubmission]);

  useEffect(() => {
    const paramForm    = searchParams.get('form');
    const paramYear    = searchParams.get('year');
    const paramQuarter = searchParams.get('quarter');
    const paramTab     = searchParams.get('tab');
    if (paramForm)    setReportType(paramForm);
    if (paramYear)    setYear(Number(paramYear));
    if (paramQuarter) setQuarter(Number(paramQuarter));
    if (paramTab)     setActiveTab(paramTab);
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
    setLoading(true); setError(''); setData(null);
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
    setPrSaving(true); setPrError(''); setPrSaved(false);
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
          {[{ key: 'reports', label: 'Tax Reports' }, { key: 'preparer', label: 'Preparer Information' }].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 24px', border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'transparent',
                fontWeight: activeTab === tab.key ? 700 : 400,
                color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: 14, marginBottom: -2,
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
              Saved info autofills Parts 4 and 5 (designee, signature, paid preparer) across all tax forms. Leave blank if not applicable.
            </p>
            <form onSubmit={handleSavePreparer}>
              <div style={{ marginBottom: 20, padding: '12px 16px', background: 'var(--bg-subtle, #f8f8f8)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!!prForm.noDesignee}
                    onChange={(e) => setPrForm((f) => ({ ...f, noDesignee: e.target.checked }))}
                    style={{ width: 16, height: 16 }}
                  />
                  <span>I do not have a third-party designee — mark <strong>No</strong> in Part 4 of all forms</span>
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                {PREPARER_FIELDS.map(({ key, label, placeholder }) => (
                  <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">{label}</label>
                    <input
                      className="form-input" type="text" placeholder={placeholder}
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
            <div className="card no-print" style={{ marginBottom: 24, padding: '20px 24px' }}>
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
              <div className="alert alert-error no-print" style={{ marginBottom: 20 }}>
                <span>⚠</span> {error}
              </div>
            )}

            {data && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 16 }} className="no-print">
                  {pdfError && <span style={{ fontSize: 12, color: 'var(--error)' }}>{pdfError}</span>}
                  {data.reportType === 'TWC' && (
                    <>
                      <button
                        className="btn btn-secondary"
                        disabled={pdfLoading}
                        title="Download ICESA-format file for import into TWC QuickFile"
                        onClick={async () => {
                          setPdfError('');
                          setPdfLoading(true);
                          try {
                            await api.downloadTWCIcesa(clientId, year, quarter);
                          } catch (e) {
                            setPdfError(e.message);
                          } finally {
                            setPdfLoading(false);
                          }
                        }}
                      >
                        {pdfLoading ? 'Generating…' : '↓ QuickFile (ICESA)'}
                      </button>
                      <button
                        className="btn btn-primary"
                        disabled={twcSubmitting || !twcBridgeConnected}
                        title={twcBridgeConnected ? 'Send ICESA file to Computer 2 and auto-submit via QuickFile' : 'TWC Bridge is not connected — start the bridge on Computer 2'}
                        onClick={async () => {
                          setTwcSubmitting(true);
                          setTwcSubmission(null);
                          setPdfError('');
                          try {
                            const sub = await api.createTwcSubmission(clientId, quarter, year);
                            setTwcSubmission(sub);
                          } catch (e) {
                            setPdfError(e.message);
                          } finally {
                            setTwcSubmitting(false);
                          }
                        }}
                      >
                        {twcSubmitting ? <><span className="spinner" style={{ width: 14, height: 14, marginRight: 6 }} />Submitting…</> : twcBridgeConnected ? '⚡ Submit via Bridge' : '⚡ Bridge Offline'}
                      </button>
                    </>
                  )}
                  <button
                    className="btn btn-secondary"
                    disabled={pdfLoading}
                    onClick={async () => {
                      setPdfError('');
                      setPdfLoading(true);
                      try {
                        const formMap = { '941': '941', '940': '940', twc: 'TWC', w2: 'W-2', w3: 'W-3' };
                        const needsQ = reportType === '941' || reportType === 'twc';
                        await api.downloadReportPdf(formMap[reportType], clientId, year, needsQ ? quarter : undefined);
                      } catch (e) {
                        setPdfError(e.message);
                      } finally {
                        setPdfLoading(false);
                      }
                    }}
                  >
                    {pdfLoading ? 'Generating…' : 'Download PDF'}
                  </button>
                </div>
                {twcSubmission && (
                  <div className={`alert ${twcSubmission.status === 'completed' ? 'alert-success' : twcSubmission.status === 'failed' ? 'alert-error' : 'alert-info'} no-print`} style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                    {twcSubmission.status === 'pending' && <><span className="spinner spinner-dark" style={{ width: 16, height: 16 }} /><span>Waiting for TWC Bridge to pick up job…</span></>}
                    {twcSubmission.status === 'processing' && <><span className="spinner spinner-dark" style={{ width: 16, height: 16 }} /><span>Bridge is submitting to QuickFile…</span></>}
                    {twcSubmission.status === 'completed' && <><span>✓</span><span>Submitted successfully! {twcSubmission.confirmationNumber ? <><strong>Confirmation:</strong> {twcSubmission.confirmationNumber}</> : ''}</span></>}
                    {twcSubmission.status === 'failed' && <><span>⚠</span><span>Submission failed: {twcSubmission.error || 'Unknown error'}</span></>}
                  </div>
                )}
                {data.reportType === '941' && <Report941 data={data} pr={preparer} />}
                {data.reportType === '940' && <Report940 data={data} pr={preparer} />}
                {data.reportType === 'TWC' && <ReportTWC data={data} pr={preparer} />}
                {(data.reportType === 'W-2' || data.reportType === 'W-3') && (
                  <div className="no-print" style={{ background: '#fffbe6', border: '1px solid #f0c040', borderRadius: 6, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#7a5800' }}>
                    <strong>Note:</strong> This PDF is for <strong>employee copies (B, C, 2) and employer records only</strong>. W-2 Copy A and W-3 filed with the SSA must be submitted electronically via{' '}
                    <strong>SSA Business Services Online (BSO)</strong>, or printed on official preprinted red-ink forms. Printing this document and mailing it to the SSA is not permitted and may result in penalties.
                  </div>
                )}
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
