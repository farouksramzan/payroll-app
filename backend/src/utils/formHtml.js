// Server-side HTML generators for IRS/TWC tax forms.
// Each function returns a complete HTML document rendered by Puppeteer.

function fmtZ(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt(n) { const v = Number(n || 0); return v === 0 ? '' : fmtZ(v); }
function fmtPct(n) { return (Number(n || 0) * 100).toFixed(5); }
function fmtAmt(n) { return `$${fmtZ(n)}`; }
function chk(on) { return `<span class="chk${on ? ' on' : ''}">${on ? '&#10003;' : ''}</span>`; }
function pin(str) {
  const d = (str || '').toString().split('').slice(0, 5);
  return [0,1,2,3,4].map(i => `<span class="pin-box">${d[i] || ''}</span>`).join('');
}

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; background: #fff; }
.page { border: 2px solid #000; margin-bottom: 24px; background: #fff; }
.page-2 { page-break-before: always; break-before: page; }
.topbar { border-bottom: 2px solid #000; display: flex; }
.top-left { flex: 1; padding: 5px 8px; border-right: 1px solid #000; }
.top-right { padding: 5px 8px; min-width: 195px; }
.form-num { font-size: 20pt; font-weight: 900; letter-spacing: -0.5px; }
.form-sub { font-size: 8.5pt; color: #333; }
.dept { font-size: 8pt; color: #555; margin-top: 1px; }
.omb { font-size: 8pt; margin-top: 2px; }
.q-label { font-size: 8pt; font-weight: 700; margin-bottom: 3px; }
.q-opt { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; font-size: 8pt; }
.chk { border: 1px solid #000; width: 10px; height: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 7pt; flex-shrink: 0; background: #fff; color: #000; }
.chk.on { background: #000; color: #fff; }
.field-lbl { font-size: 7pt; color: #444; margin-bottom: 1px; }
.field-val { font-size: 10pt; font-weight: 700; font-family: "Courier New", monospace; border-bottom: 1px solid #aaa; min-height: 13px; padding-bottom: 1px; margin-bottom: 3px; }
.part-hdr { background: #b8b8b8; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 2px 8px; font-weight: 700; font-size: 8.5pt; }
.note { padding: 2px 8px; font-size: 7.5pt; color: #444; border-bottom: 1px solid #ccc; background: #f5f5f5; }
.line { display: flex; border-bottom: 1px solid #ccc; min-height: 17px; }
.line.hl { background: #eef1ff; }
.line-num { width: 24px; background: #f0f0f0; border-right: 1px solid #ccc; display: flex; align-items: center; justify-content: center; font-size: 7.5pt; font-weight: 700; flex-shrink: 0; color: #222; }
.line-lbl { flex: 1; padding: 2px 6px; font-size: 8.5pt; display: flex; align-items: center; }
.line-val { width: 110px; border-left: 1px solid #999; display: flex; align-items: center; justify-content: flex-end; padding: 2px 6px; font-family: "Courier New", monospace; font-size: 9.5pt; font-weight: 600; }
.line-val.hl { background: #e8eeff; font-weight: 800; }
.line-ref { width: 18px; border-left: 1px solid #999; display: flex; align-items: center; justify-content: center; font-size: 7pt; color: #444; font-weight: 400; background: #f0f0f0; flex-shrink: 0; }
.ss-line { display: flex; border-bottom: 1px solid #ccc; min-height: 19px; padding: 1px 0; align-items: center; }
.ss-num { width: 24px; text-align: center; font-size: 7.5pt; font-weight: 700; color: #222; flex-shrink: 0; }
.ss-lbl { flex: 1; font-size: 8.5pt; padding: 0 6px; }
.ss-c1 { width: 90px; text-align: right; font-family: "Courier New", monospace; font-size: 9pt; padding-right: 4px; }
.ss-mult { width: 68px; text-align: center; font-size: 7.5pt; color: #444; }
.ss-c2 { width: 90px; text-align: right; font-family: "Courier New", monospace; font-size: 9pt; border-left: 1px solid #999; padding: 0 4px; }
.col-hdr { display: flex; background: #e8e8e8; border-bottom: 1px solid #ccc; padding: 2px 0 2px 24px; font-size: 7.5pt; font-weight: 700; }
.col-hdr .c1h { width: 90px; text-align: center; }
.col-hdr .cgap { width: 68px; }
.col-hdr .c2h { width: 90px; text-align: center; }
.entity { border-bottom: 1px solid #000; }
.entity-row { display: flex; }
.entity-col { flex: 1; padding: 4px 8px; border-right: 1px solid #000; }
.entity-col:last-child { border-right: none; }
.entity-addr { border-top: 1px solid #ccc; padding: 3px 8px; }
.entity-city { border-top: 1px solid #ccc; display: flex; gap: 0; padding: 3px 8px 4px; }
.mini-hdr { background: #f0f0f0; border-bottom: 1px solid #000; padding: 3px 8px; display: flex; justify-content: space-between; align-items: center; }
.sign-grid { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #ccc; }
.sign-cell { padding: 4px 8px; border-right: 1px solid #ccc; }
.sign-cell:last-child { border-right: none; }
.sig-line { border-bottom: 1px solid #000; min-height: 18px; margin-bottom: 4px; font-size: 7.5pt; color: #888; padding-top: 3px; }
.prep-block { border-top: 1px solid #000; background: #fafafa; }
.prep-header { padding: 3px 8px; font-weight: 700; font-size: 8.5pt; border-bottom: 1px solid #ccc; background: #e8e8e8; }
.prep-grid { display: grid; grid-template-columns: 1fr 1fr; }
.prep-cell { padding: 4px 8px; border-right: 1px solid #ccc; }
.prep-cell:last-child { border-right: none; }
.blank-line { border-bottom: 1px solid #ccc; min-height: 13px; margin-bottom: 3px; }
.desig-section { padding: 5px 8px; font-size: 8pt; border-bottom: 1px solid #ccc; }
.desig-row { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
.pin-box { border: 1px solid #000; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 9pt; font-weight: 700; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; }
.grid4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; }
.grid5 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr; }
.b-right { border-right: 1px solid #000; }
.b-bottom { border-bottom: 1px solid #000; }
.b-top { border-top: 1px solid #000; }
.p4 { padding: 4px 6px; }
.fw7 { font-weight: 700; }
.mono { font-family: "Courier New", monospace; }
.sm { font-size: 7.5pt; }
.xs { font-size: 7pt; color: #555; }
.center { text-align: center; }
.right { text-align: right; }
.do-not-mail { text-align: center; padding: 2px; background: #d0d0d0; border-bottom: 1px solid #999; font-size: 7.5pt; font-weight: 700; }
.w2-box { border: 1px solid #aaa; padding: 2px 4px; background: #fff; }
.w2-box .lbl { font-size: 6.5pt; color: #555; }
.w2-box .val { font-family: "Courier New", monospace; font-size: 10pt; font-weight: 700; min-height: 13px; }
.w2-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; padding: 3px; background: #ccc; }
.w2-state { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; padding: 0 3px 3px; background: #ccc; }
.w3-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; padding: 3px; background: #ccc; align-content: start; }
.w3-state { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; padding: 0 3px 3px; background: #ccc; }
.supp-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
.supp-table th, .supp-table td { padding: 3px 5px; }
.supp-table th { background: #f5f5f5; font-size: 7.5pt; font-weight: 700; border-bottom: 1px solid #aaa; }
.supp-table td { border-bottom: 1px solid #ececec; }
.supp-table .mono { font-family: monospace; text-align: right; }
.supp-hdr { padding: 4px 8px; background: #e8e8e8; font-size: 8.5pt; font-weight: 700; border-bottom: 1px solid #ccc; }
.badge { padding: 1px 4px; border-radius: 3px; font-size: 7pt; font-weight: 700; text-transform: uppercase; }
.badge-sub { background: #d1fae5; }
.badge-pend { background: #fef3c7; }
.badge-other { background: #f5f5f5; }
`;

function baseHtml(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
}

function irsLine(num, label, value, hl) {
  const hlClass = hl ? ' hl' : '';
  const valClass = hl ? ' hl' : '';
  return `<div class="line${hlClass}">
    <div class="line-num">${num}</div>
    <div class="line-lbl">${label}</div>
    <div class="line-ref">${num}</div>
    <div class="line-val${valClass}">${value || ''}</div>
  </div>`;
}

function ssLine(num, label, wages, rate, tax) {
  return `<div class="ss-line">
    <div class="ss-num">${num}</div>
    <div class="ss-lbl">${label}</div>
    <div class="ss-c1">${wages > 0 ? fmtZ(wages) : ''}</div>
    <div class="ss-mult">${rate}</div>
    <div class="ss-c2">${tax > 0 ? fmtZ(tax) : ''}</div>
  </div>`;
}

function designeeSection(pr) {
  const hasInfo  = pr && (pr.desgName || pr.desgPhone);
  const checkYes = !!hasInfo;
  const checkNo  = !hasInfo && !!(pr && pr.noDesignee);
  return `<div class="desig-section">
    <div>Do you want to allow an employee, a paid tax preparer, or another person to discuss this return with the IRS? See the instructions for details.</div>
    <div class="desig-row">
      <div style="display:flex;align-items:flex-start;gap:4px;">
        ${chk(checkYes)} <strong>Yes.</strong>
        <span style="margin-left:4px;">Designee's name and phone number
          ${hasInfo
            ? `<strong style="margin-left:4px;">${pr.desgName || ''}&nbsp;&nbsp;${pr.desgPhone || ''}</strong>`
            : `<span style="display:inline-block;border-bottom:1px solid #000;min-width:200px;min-height:11px;"></span>`}
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        <span style="font-size:7.5pt;">Select a 5-digit personal identification number (PIN)&nbsp;</span>
        ${pin(pr ? pr.desgPin : '')}
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        ${chk(checkNo)} <strong>No.</strong>
      </div>
    </div>
  </div>`;
}

function signatureBlock(pr) {
  return `<div class="sign-grid">
    <div class="sign-cell">
      <div class="field-lbl">Sign your name here</div>
      <div class="sig-line">EF ONLY—You do not need to sign this form</div>
      <div class="field-lbl">Print your name here</div>
      <div class="blank-line" style="font-weight:700;font-size:9.5pt;">${pr && pr.name ? pr.name : ''}</div>
      <div class="field-lbl">Print your title here</div>
      <div class="blank-line">${pr && pr.title ? pr.title : ''}</div>
      <div class="field-lbl">Best daytime phone</div>
      <div class="blank-line">${pr && pr.phone ? pr.phone : ''}</div>
    </div>
    <div class="sign-cell">
      <div class="field-lbl">Date</div>
      <div class="blank-line" style="font-weight:600;">${pr && pr.name ? new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}) : ''}</div>
    </div>
  </div>`;
}

function preparerBlock(pr) {
  return `<div class="prep-block">
    <div class="prep-header">Paid Preparer Use Only</div>
    <div class="prep-grid">
      <div class="prep-cell">
        <div class="field-lbl">Preparer's name</div>
        <div class="blank-line">${pr && pr.name ? pr.name : ''}</div>
        <div class="field-lbl">Preparer's signature</div>
        <div class="blank-line"></div>
        <div class="field-lbl">Firm's name (or yours if self-employed)</div>
        <div class="blank-line">${pr && pr.firmName ? pr.firmName : ''}</div>
        <div class="field-lbl">Address</div>
        <div class="blank-line">${pr && pr.firmAddress ? pr.firmAddress : ''}</div>
        <div style="display:flex;gap:8px;margin-top:3px;">
          <div style="flex:2;"><div class="field-lbl">City</div><div class="blank-line">${pr && pr.firmCity ? pr.firmCity : ''}</div></div>
          <div style="flex:1;"><div class="field-lbl">State</div><div class="blank-line">${pr && pr.firmState ? pr.firmState : ''}</div></div>
          <div style="flex:1;"><div class="field-lbl">ZIP code</div><div class="blank-line">${pr && pr.firmZip ? pr.firmZip : ''}</div></div>
        </div>
      </div>
      <div class="prep-cell">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">${chk(false)}<span class="sm">Check if you're self-employed</span></div>
        <div class="field-lbl">PTIN</div>
        <div class="blank-line">${pr && pr.ptin ? pr.ptin : ''}</div>
        <div class="field-lbl">Date</div>
        <div class="blank-line">${pr && pr.name ? new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}) : ''}</div>
        <div class="field-lbl">EIN</div>
        <div class="blank-line">${pr && pr.firmEin ? pr.firmEin : ''}</div>
        <div class="field-lbl">Phone</div>
        <div class="blank-line">${pr && pr.firmPhone ? pr.firmPhone : ''}</div>
      </div>
    </div>
  </div>`;
}

function miniHeader(client, code) {
  return `<div class="mini-hdr">
    <span style="font-weight:700;font-size:9pt;">${code}</span>
    <div style="display:flex;gap:24px;">
      <div><div class="field-lbl">Name (not your trade name)</div><div style="font-weight:700;font-size:9.5pt;">${client.businessName}</div></div>
      <div><div class="field-lbl">Employer identification number (EIN)</div><div class="mono" style="font-weight:700;font-size:9.5pt;">${client.ein}</div></div>
    </div>
  </div>`;
}

// ── Form 941 ──────────────────────────────────────────────────────────────────
function html941(data, pr) {
  const { client, period, lines, submissions } = data;
  const q = period.quarter;
  const Q_NAMES = {1:'1: January, February, March',2:'2: April, May, June',3:'3: July, August, September',4:'4: October, November, December'};
  const totalTax = lines.line6_totalTaxes || 0;
  const deposited = lines.line13_deposited || 0;
  const balDue = Math.max(0, totalTax - deposited);
  const overpmt = Math.max(0, deposited - totalTax);
  const line5e = (lines.line5a_ssTax || 0) + (lines.line5c_medTax || 0);

  const filerOpts = ['Section 3504 Agent', 'Certified Professional Employer\nOrganization (CPEO)', 'Other Third Party'];

  const page1 = `
  <div class="page">
    <div class="topbar">
      <div class="top-left">
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span class="form-num">941</span>
          <span class="form-sub">for ${period.year}: (Rev. March 2026)</span>
        </div>
        <div style="font-size:11pt;font-weight:700;margin-top:1px;">Employer's QUARTERLY Federal Tax Return</div>
        <div class="dept">Department of the Treasury — Internal Revenue Service</div>
        <div style="display:flex;justify-content:space-between;margin-top:3px;">
          <span class="omb">950126</span><span class="omb">OMB No. 1545-0029</span>
        </div>
      </div>
    </div>

    <div class="entity">
      <div class="entity-row">
        <div class="entity-col">
          <div class="field-lbl">Name (not your trade name)</div>
          <div class="field-val">${client.businessName}</div>
          <div class="field-lbl">Trade name (if any)</div>
          <div class="field-val">${client.tradeName || ''}</div>
        </div>
        <div class="entity-col" style="min-width:200px;">
          <div class="field-lbl">Employer identification number (EIN)</div>
          <div class="field-val mono" style="font-size:12pt;">${client.ein}</div>
          <div style="margin-top:6px;">
            <div class="q-label">Report for this Quarter of ${period.year} (Check one.)</div>
            ${[1,2,3,4].map(n=>`<div class="q-opt">${chk(n===q)}<span>${Q_NAMES[n]}</span></div>`).join('')}
          </div>
          <div style="margin-top:4px;border-top:1px solid #ccc;padding-top:3px;">
            <div class="xs">Aggregate Return Filers Only</div>
            <div class="xs" style="margin:1px 0;">Type of filer (check one):</div>
            ${filerOpts.map(o=>`<div class="q-opt">${chk(o==='Other Third Party')}<span style="font-size:7pt;white-space:pre-line;">${o}</span></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="entity-addr">
        <div class="field-lbl">Address</div>
        <div class="field-val" style="max-width:400px;">${client.businessAddress || ''}</div>
      </div>
      <div class="entity-city">
        <div style="flex:3;padding-right:8px;"><div class="field-lbl">City</div><div class="field-val">${client.businessCity || ''}</div></div>
        <div style="width:40px;padding-right:8px;"><div class="field-lbl">State</div><div class="field-val">${client.state || 'TX'}</div></div>
        <div style="flex:1;padding-right:8px;"><div class="field-lbl">ZIP code</div><div class="field-val">${client.businessZip || ''}</div></div>
        <div style="flex:2;padding-right:8px;"><div class="field-lbl">Foreign country name</div><div class="field-val"></div></div>
        <div style="flex:1;padding-right:8px;"><div class="field-lbl">Foreign province/county</div><div class="field-val"></div></div>
        <div style="flex:1;"><div class="field-lbl">Foreign postal code</div><div class="field-val"></div></div>
      </div>
    </div>

    <div class="note">Read the separate instructions before you complete Form 941. Type or print within the boxes.</div>

    <div class="part-hdr">Part 1:&nbsp; Answer these questions for this quarter.</div>
    <div class="note">Employers in American Samoa, Guam, the Commonwealth of the Northern Mariana Islands, the U.S. Virgin Islands, and Puerto Rico must skip lines 2 and 3, unless you have employees who are subject to U.S. income tax withholding.</div>

    <div class="line">
      <div class="line-num">1</div>
      <div class="line-lbl">Number of employees who received wages, tips, or other compensation for the pay period including: Mar. 12 (Quarter 1), June 12 (Quarter 2), Sept. 12 (Quarter 3), or Dec. 12 (Quarter 4)</div>
      <div class="line-ref">1</div>
      <div class="line-val" style="width:72px;">${lines.line1_employees || ''}</div>
    </div>
    ${irsLine('2','Wages, tips, and other compensation',fmt(lines.line2_wages))}
    ${irsLine('3','Federal income tax withheld from wages, tips, and other compensation',fmt(lines.line3_fitWithheld))}

    <div class="line" style="min-height:14px;">
      <div class="line-num">4</div>
      <div class="line-lbl">If no wages, tips, and other compensation are subject to social security or Medicare tax&nbsp;${chk(false)}&nbsp;Check here and go to line 6.</div>
    </div>

    <div class="col-hdr">
      <div style="flex:1;">&nbsp;</div>
      <div class="c1h">Column 1</div>
      <div class="cgap"></div>
      <div class="c2h">Column 2</div>
    </div>
    ${ssLine('5a','Taxable social security wages',lines.line5a_ssWages||0,'&times; 0.124 =',lines.line5a_ssTax||0)}
    ${ssLine('5b','Taxable social security tips',0,'&times; 0.124 =',0)}
    ${ssLine('5c','Taxable Medicare wages &amp; tips',lines.line5c_medWages||0,'&times; 0.029 =',lines.line5c_medTax||0)}
    ${ssLine('5d','Taxable wages &amp; tips subject to Additional Medicare Tax withholding',0,'&times; 0.009 =',0)}
    ${irsLine('5e','Total social security and Medicare taxes. Add Column 2 from lines 5a, 5b, 5c, and 5d',fmt(line5e))}
    ${irsLine('5f','Section 3121(q) Notice and Demand—Tax due on unreported tips (see instructions)','')}
    ${irsLine('6','Total taxes before adjustments. Add lines 3, 5e, and 5f',fmt(totalTax),true)}
    ${irsLine('7','Current quarter\'s adjustment for fractions of cents','')}
    ${irsLine('8','Current quarter\'s adjustment for sick pay','')}
    ${irsLine('9','Current quarter\'s adjustments for tips and group-term life insurance','')}
    ${irsLine('10','Total taxes after adjustments. Combine lines 6 through 9',fmt(totalTax),true)}
    ${irsLine('11a','Qualified small business payroll tax credit for increasing research activities. Attach Form 8974','')}
    ${irsLine('11b','Nonrefundable portion of credit for qualified sick and family leave wages from Worksheet 1','')}
    ${irsLine('11c','Reserved for future use','')}
    ${irsLine('11d','Nonrefundable portion of other credits. See instructions','')}
    ${irsLine('11e','Total nonrefundable credits. Add lines 11a, 11b, 11c, and 11d','')}
    ${irsLine('12','Total taxes after adjustments and nonrefundable credits. Subtract line 11e from line 10',fmt(totalTax),true)}
    ${irsLine('13a','Total deposits for this quarter, including overpayment applied from a prior quarter and overpayments applied from Form 941-X filed in the current quarter',fmt(deposited))}
    ${irsLine('13b','Reserved for future use','')}
    ${irsLine('13c','Refundable portion of credit for qualified sick and family leave wages from Worksheet 1','')}
    ${irsLine('13d','Reserved for future use','')}
    ${irsLine('13e','Total deposits and refundable credits. Add lines 13a, 13b, 13c, and 13d',fmt(deposited))}
    ${irsLine('13f','Total advances received from filing Form(s) 7200 for the quarter','')}
    ${irsLine('13g','Total deposits and refundable credits less advances. Subtract line 13f from line 13e',fmt(deposited))}
    ${irsLine('14','Balance due. If line 12 is more than line 13g, enter the difference and see instructions',balDue>0?fmt(balDue):'',balDue>0)}

    <div class="line">
      <div class="line-num">15</div>
      <div class="line-lbl">Overpayment. If line 13g is more than line 12, enter the difference&nbsp;&nbsp;<span class="mono fw7">${overpmt>0?fmt(overpmt):''}</span>&nbsp;&nbsp;${chk(false)} Apply to next return. &nbsp; ${chk(false)} Send a refund.</div>
    </div>

    <div class="note">&#9658; You MUST complete both pages of Form 941 and SIGN it.<br>For Privacy Act and Paperwork Reduction Act Notice, see separate instructions. &nbsp; Cat. No. 17001Z &nbsp; <strong>Form 941</strong> (Rev. 3-${period.year})</div>
  </div>`;

  const page2 = `
  <div class="page page-2">
    ${miniHeader(client, '950224')}

    <div class="part-hdr">Part 2:&nbsp; Tell us about your deposit schedule and tax liability for this quarter.</div>
    <div class="note">If you're unsure about whether you're a monthly schedule depositor or a semiweekly schedule depositor, see section 11 of Pub. 15.</div>
    <div style="padding:4px 8px;font-size:8pt;border-bottom:1px solid #ccc;">
      <strong>16</strong>&nbsp; Check one:
      <div style="margin-top:4px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:flex-start;gap:6px;">${chk(totalTax<2500)}<span>Line 12 on this return is less than $2,500 or line 12 on the return for the prior quarter was less than $2,500, and you didn't incur a $100,000 next-day deposit obligation during the current quarter. Go to Part 3.</span></div>
        <div style="display:flex;align-items:flex-start;gap:6px;">${chk(false)}<div>You were a monthly schedule depositor for the entire quarter. Enter your tax liability for each month and total liability for the quarter, then go to Part 3.
          <div style="display:flex;gap:24px;margin-top:4px;">
            ${['Month 1','Month 2','Month 3'].map(m=>`<div><div class="field-lbl">Tax liability: ${m}</div><div class="blank-line" style="min-width:80px;"></div></div>`).join('')}
            <div><div class="field-lbl">Total liability for quarter</div><div class="blank-line" style="min-width:80px;"></div></div>
          </div>
        </div></div>
        <div style="display:flex;align-items:flex-start;gap:6px;">${chk(false)}<span>You were a semiweekly schedule depositor for any part of this quarter. Complete Schedule B (Form 941) and attach it to Form 941. Go to Part 3.</span></div>
      </div>
    </div>

    <div class="part-hdr">Part 3:&nbsp; Tell us about your business. If a question does NOT apply to your business, leave it blank.</div>
    <div style="padding:4px 8px;font-size:8pt;border-bottom:1px solid #ccc;display:flex;align-items:center;gap:6px;">
      <strong>17</strong>&nbsp; If your business has closed or you stopped paying wages . . . . . . ${chk(false)}&nbsp; Check here; also attach a statement. Enter the final date you paid wages:&nbsp;<span style="border-bottom:1px solid #999;display:inline-block;min-width:90px;"></span>
    </div>
    <div style="padding:4px 8px;font-size:8pt;border-bottom:1px solid #ccc;display:flex;align-items:center;gap:6px;">
      <strong>18</strong>&nbsp; If you're a seasonal employer and you don't have to file a return for every quarter of the year . . . ${chk(false)}&nbsp; Check here.
    </div>

    <div class="part-hdr">Part 4:&nbsp; May we speak with your third-party designee?</div>
    ${designeeSection(pr)}

    <div class="part-hdr">Part 5:&nbsp; Sign here. You MUST complete both pages of Form 941 and SIGN it.</div>
    <div class="note">Under penalties of perjury, I declare that I have examined this return, including accompanying schedules and statements, and to the best of my knowledge and belief, it is true, correct, and complete.</div>
    ${signatureBlock(pr)}
    ${preparerBlock(pr)}

    <div style="padding:3px 8px;font-size:7.5pt;border-top:1px solid #ccc;text-align:right;color:#555;">
      Page 2 &nbsp;&nbsp; <strong>Form 941</strong> (Rev. 3-${period.year})
    </div>
  </div>`;

  let suppPage = '';
  if (submissions && submissions.length > 0) {
    const rows = submissions.map(s => {
      const badgeClass = s.eftpsStatus === 'submitted' ? 'badge-sub' : s.eftpsStatus === 'pending' ? 'badge-pend' : 'badge-other';
      return `<tr>
        <td>${s.payPeriodEnd}</td>
        <td>${s.employeeName || '—'}</td>
        <td class="mono">${fmtAmt(s.grossWages)}</td>
        <td class="mono">${fmtAmt(s.fitWithholding)}</td>
        <td class="mono">${fmtAmt(s.ssTotal)}</td>
        <td class="mono">${fmtAmt(s.medTotal)}</td>
        <td class="mono">${fmtAmt(s.totalDeposit)}</td>
        <td class="right"><span class="badge ${badgeClass}">${s.eftpsStatus || 'pending'}</span></td>
      </tr>`;
    }).join('');
    const totals = ['grossWages','fitWithholding','ssTotal','medTotal','totalDeposit'].map(k => fmtAmt(submissions.reduce((s,r)=>s+r[k],0)));
    suppPage = `
    <div class="page page-2">
      <div class="supp-hdr">Supporting Paycheck Detail — ${submissions.length} check${submissions.length!==1?'s':''} for Q${q} ${period.year}</div>
      <table class="supp-table">
        <thead><tr>
          <th style="text-align:left;">Pay Period End</th><th style="text-align:left;">Employee</th>
          <th class="right">Gross Wages</th><th class="right">FIT</th><th class="right">SS Total</th>
          <th class="right">Med Total</th><th class="right">941 Deposit</th><th class="right">EFTPS Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:#f0f0f0;font-weight:700;">
          <td colspan="2" style="font-size:7.5pt;">Total</td>
          ${totals.map(v=>`<td class="mono">${v}</td>`).join('')}
          <td></td>
        </tr></tfoot>
      </table>
    </div>`;
  }

  return baseHtml(page1 + page2 + suppPage);
}

// ── Form 940 ──────────────────────────────────────────────────────────────────
function html940(data, pr) {
  const { client, period, lines, byEmployee } = data;
  const netFuta = lines.line12_netFuta || 0;
  const excessWages = Math.max(0, (lines.line3_totalPayments || 0) - (lines.line5_futaTaxableWages || 0));
  const typeOpts = ['a. Amended','b. Successor employer',`c. No payments to employees in ${period.year}`,'d. Final: Business closed or stopped paying wages'];
  const filerOpts = ['Section 3504 Agent','Certified Professional Employer\nOrganization (CPEO)','Other Third Party'];

  const page1 = `
  <div class="page">
    <div class="topbar">
      <div class="top-left">
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span class="form-num">940</span>
          <span class="form-sub">for ${period.year}: Employer's Annual Federal Unemployment (FUTA) Tax Return</span>
        </div>
        <div class="dept">Department of the Treasury — Internal Revenue Service</div>
        <div style="display:flex;justify-content:space-between;margin-top:3px;">
          <span class="omb">850125</span><span class="omb">OMB No. 1545-0029</span>
        </div>
      </div>
    </div>

    <div class="entity">
      <div class="entity-row">
        <div class="entity-col">
          <div class="field-lbl">Employer identification number (EIN)</div>
          <div class="field-val mono" style="font-size:12pt;">${client.ein}</div>
          <div class="field-lbl">Name (not your trade name)</div>
          <div class="field-val">${client.businessName}</div>
          <div class="field-lbl">Trade name (if any)</div>
          <div class="field-val">${client.tradeName || ''}</div>
          <div class="field-lbl">Address</div>
          <div class="field-val">${client.businessAddress || ''}</div>
          <div style="display:flex;gap:8px;">
            <div style="flex:3;"><div class="field-lbl">City</div><div class="field-val">${client.businessCity || ''}</div></div>
            <div style="width:40px;"><div class="field-lbl">State</div><div class="field-val">${client.state || 'TX'}</div></div>
            <div style="flex:1;"><div class="field-lbl">ZIP code</div><div class="field-val">${client.businessZip || ''}</div></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:2px;">
            <div style="flex:2;"><div class="field-lbl">Foreign country name</div><div class="field-val"></div></div>
            <div style="flex:1;"><div class="field-lbl">Foreign province/county</div><div class="field-val"></div></div>
            <div style="flex:1;"><div class="field-lbl">Foreign postal code</div><div class="field-val"></div></div>
          </div>
        </div>
        <div class="entity-col" style="min-width:195px;">
          <div style="font-size:7.5pt;font-weight:700;margin-bottom:4px;">Type of Return</div>
          <div class="xs" style="margin-bottom:2px;">(Check all that apply.)</div>
          ${typeOpts.map(o=>`<div class="q-opt">${chk(false)}<span>${o}</span></div>`).join('')}
          <div style="margin-top:8px;font-size:7.5pt;font-weight:700;">Aggregate Return Filers Only</div>
          <div class="xs" style="margin:2px 0;">Type of filer (check one):</div>
          ${filerOpts.map(o=>`<div class="q-opt">${chk(o==='Other Third Party')}<span style="font-size:7pt;white-space:pre-line;">${o}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="note">Read the separate instructions before you complete this form. Please type or print within the boxes.</div>

    <div class="part-hdr">Part 1:&nbsp; Tell us about your return. If any line does NOT apply, leave it blank. See instructions before completing Part 1.</div>
    <div style="padding:3px 8px;font-size:8pt;border-bottom:1px solid #ccc;display:flex;align-items:center;gap:6px;">
      ${chk(true)}&nbsp;<strong>1a</strong>&nbsp; If you had to pay state unemployment tax in one state only, enter the state abbreviation . . . 1a&nbsp;
      <span style="border:1px solid #000;padding:1px 8px;font-family:monospace;font-weight:700;">${client.state || 'TX'}</span>
    </div>
    <div style="padding:3px 8px;font-size:8pt;border-bottom:1px solid #ccc;display:flex;align-items:center;gap:6px;">
      ${chk(false)}&nbsp;<strong>1b</strong>&nbsp; If you had to pay state unemployment tax in more than one state, you are a multi-state employer . . 1b&nbsp;<span class="xs">Check here. Complete Schedule A (Form 940).</span>
    </div>
    <div style="padding:3px 8px;font-size:8pt;border-bottom:1px solid #ccc;display:flex;align-items:center;gap:6px;">
      ${chk(false)}&nbsp;<strong>2</strong>&nbsp; If you paid wages in a state that is subject to CREDIT REDUCTION . . . . . . . . . . . . . . 2&nbsp;<span class="xs">Check here. Complete Schedule A (Form 940).</span>
    </div>

    <div class="part-hdr">Part 2:&nbsp; Determine your FUTA tax before adjustments.</div>
    ${irsLine('3','Total payments to all employees',fmt(lines.line3_totalPayments))}
    <div class="line">
      <div class="line-num">4</div>
      <div class="line-lbl">Payments exempt from FUTA tax . . . Check all that apply: ${chk(false)} 4a Fringe benefits &nbsp; ${chk(false)} 4b Group-term life &nbsp; ${chk(false)} 4c Retirement/Pension &nbsp; ${chk(false)} 4d Dependent care &nbsp; ${chk(false)} 4e Other</div>
      <div class="line-ref">4</div><div class="line-val"></div>
    </div>
    ${irsLine('5','Total of payments made to each employee in excess of $7,000',fmt(excessWages))}
    ${irsLine('6','Subtotal (line 4 + line 5 = line 6)',fmt(excessWages))}
    ${irsLine('7','Total taxable FUTA wages (line 3 – line 6 = line 7). See instructions',fmt(lines.line5_futaTaxableWages))}
    ${irsLine('8','FUTA tax before adjustments (line 7 × 0.006 = line 8)',fmt(netFuta),true)}

    <div class="part-hdr">Part 3:&nbsp; Determine your adjustments.</div>
    ${irsLine('9','If ALL of the taxable FUTA wages you paid were excluded from state unemployment tax, multiply line 7 by 0.054 (line 7 × 0.054 = line 9). Go to line 12','')}
    ${irsLine('10','If SOME of the taxable FUTA wages you paid were excluded from state unemployment tax, OR you paid ANY state unemployment tax late, complete the worksheet in the instructions. Enter the amount from line 7 of the worksheet','')}
    ${irsLine('11','If credit reduction applies, enter the total from Schedule A (Form 940)','')}

    <div class="part-hdr">Part 4:&nbsp; Determine your FUTA tax and balance due or overpayment.</div>
    ${irsLine('12','Total FUTA tax after adjustments (lines 8 + 9 + 10 + 11 = line 12)',fmt(netFuta),true)}
    ${irsLine('13','FUTA tax deposited for the year, including any overpayment applied from a prior year',fmt(netFuta))}
    ${irsLine('14','Balance due. If line 12 is more than line 13, enter the excess on line 14.','')}
    <div class="line">
      <div class="line-num">15a</div>
      <div class="line-lbl">Overpayment. If line 13 is more than line 12, enter the difference&nbsp;
        15b Check one:&nbsp;${chk(false)} Apply to next return.&nbsp;${chk(false)} Send a refund.
      </div>
    </div>
    <div style="padding:3px 8px;font-size:8pt;border-bottom:1px solid #ccc;display:flex;align-items:center;gap:8px;">
      <div><strong>15c</strong> Routing number&nbsp;<span style="border-bottom:1px solid #999;display:inline-block;min-width:120px;"></span></div>
      <div><strong>15d</strong> Type:&nbsp;${chk(false)} Checking&nbsp;${chk(false)} Savings</div>
      <div><strong>15e</strong> Account number&nbsp;<span style="border-bottom:1px solid #999;display:inline-block;min-width:150px;"></span></div>
    </div>
    <div class="note">&#9658; You MUST complete both pages of this form and SIGN it.</div>
  </div>`;

  const page2 = `
  <div class="page page-2">
    ${miniHeader(client, '850212')}

    <div class="part-hdr">Part 5:&nbsp; Report your FUTA tax liability by quarter only if line 12 is more than $500. If not, go to Part 6.</div>
    <div style="padding:4px 8px;font-size:8pt;border-bottom:1px solid #ccc;"><strong>16</strong>&nbsp; Report the amount of your FUTA tax liability for each quarter; do NOT enter the amount you deposited. If you had no liability for a quarter, leave the line blank.</div>
    ${irsLine('16a','1st quarter (January 1 – March 31)','')}
    ${irsLine('16b','2nd quarter (April 1 – June 30)','')}
    ${irsLine('16c','3rd quarter (July 1 – September 30)','')}
    ${irsLine('16d','4th quarter (October 1 – December 31)','')}
    ${irsLine('17','Total tax liability for the year (lines 16a + 16b + 16c + 16d = line 17)&nbsp; Total must equal line 12.',fmt(netFuta),true)}

    <div class="part-hdr">Part 6:&nbsp; May we speak with your third-party designee?</div>
    ${designeeSection(pr)}

    <div class="part-hdr">Part 7:&nbsp; Sign here. You MUST complete both pages of this form and SIGN it.</div>
    <div class="note">Under penalties of perjury, I declare that I have examined this return and accompanying documents and, to the best of my knowledge and belief, they are true, correct, and complete.</div>
    ${signatureBlock(pr)}
    ${preparerBlock(pr)}
    <div style="padding:3px 8px;font-size:7.5pt;border-top:1px solid #ccc;text-align:right;color:#555;">Page 2 &nbsp;&nbsp; <strong>Form 940</strong> (${period.year})</div>
  </div>`;

  let empPage = '';
  if (byEmployee && byEmployee.length > 0) {
    const rows = byEmployee.map(e => `<tr>
      <td>${e.name}</td>
      <td class="mono">${fmtAmt(e.wages)}</td>
      <td class="mono">${fmtAmt(e.futaTaxable)}</td>
      <td class="mono fw7">${fmtAmt(e.futaTax)}</td>
    </tr>`).join('');
    empPage = `
    <div class="page page-2">
      <div class="supp-hdr">FUTA Detail by Employee — ${period.year}</div>
      <table class="supp-table">
        <thead><tr>
          <th style="text-align:left;">Employee</th><th class="right">Total Wages</th>
          <th class="right">FUTA Taxable Wages</th><th class="right">FUTA Tax (0.6%)</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  return baseHtml(page1 + page2 + empPage);
}

// ── TWC / SUTA ────────────────────────────────────────────────────────────────
function htmlTWC(data, pr) {
  const { client, period, sutaRate, lines, byEmployee, emp12th } = data;
  const q = period.quarter;
  const PERIOD_END = {1:'03/31',2:'06/30',3:'09/30',4:'12/31'};
  const PENALTY_MO = {1:'04',2:'07',3:'10',4:'01'};
  const PENALTY_DAY = {1:'30',2:'31',3:'31',4:'31'};
  const periodEnd = `${PERIOD_END[q]}/${period.year}`;
  const penaltyYr = q === 4 ? period.year + 1 : period.year;
  const penaltyDate = `${PENALTY_MO[q]}/${PENALTY_DAY[q]}/${penaltyYr}`;
  const wageBase = lines.wageBase || 9000;
  const emp12thArr = emp12th && emp12th.length === 3 ? emp12th : [0, 0, 0];
  const revDate = 'REV 03/27/26 QBDT';

  // Format employee names as "LASTNAME, FIRSTNAME" uppercase
  function fmtEmpName(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].toUpperCase();
    const last = parts[parts.length - 1].toUpperCase();
    const first = parts.slice(0, parts.length - 1).join(' ').toUpperCase();
    return `${last}, ${first}`;
  }

  // Build wage table rows (page 2) — minimum 20 rows
  const dataRows = byEmployee.map(e => `
    <tr>
      <td style="font-family:'Courier New',monospace;padding:2px 6px;border-bottom:1px solid #ccc;">${e.ssn || ''}</td>
      <td style="font-family:'Courier New',monospace;padding:2px 6px;border-bottom:1px solid #ccc;">${fmtEmpName(e.name)}</td>
      <td style="font-family:'Courier New',monospace;text-align:right;padding:2px 6px;border-bottom:1px solid #ccc;border-left:1px solid #ccc;">${fmtZ(e.wages)}</td>
      <td style="font-family:'Courier New',monospace;text-align:right;padding:2px 6px;border-bottom:1px solid #ccc;border-left:1px solid #ccc;">${fmtZ(e.sutaTaxable)}</td>
    </tr>`).join('');
  const emptyRowCount = Math.max(0, 20 - byEmployee.length);
  const emptyRows = Array(emptyRowCount).fill(`
    <tr style="height:18px;">
      <td style="border-bottom:1px solid #ccc;padding:2px 6px;">&nbsp;</td>
      <td style="border-bottom:1px solid #ccc;padding:2px 6px;">&nbsp;</td>
      <td style="border-bottom:1px solid #ccc;border-left:1px solid #ccc;padding:2px 6px;">&nbsp;</td>
      <td style="border-bottom:1px solid #ccc;border-left:1px solid #ccc;padding:2px 6px;">&nbsp;</td>
    </tr>`).join('');

  // PAGE 1
  const page1 = `
  <div style="max-width:760px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;">
    <div style="text-align:center;margin-bottom:6px;">
      <div style="font-size:14pt;font-weight:700;line-height:1.3;">Texas Unemployment Insurance - Quarterly Contribution Report</div>
      <div style="font-size:14pt;font-weight:700;line-height:1.3;">Worksheet</div>
    </div>
    <div style="border:1px solid #000;text-align:center;padding:4px 8px;font-size:9pt;margin-bottom:6px;">
      This is a record of your information to complete your Unemployment Insurance Contribution Report.<br>
      Do not file the worksheet.
    </div>
    <div style="display:grid;grid-template-columns:1fr 2fr 1fr;border-bottom:1px solid #000;">
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${client.ein || ''}</div>
        <div style="font-size:7pt;">FEIN No.</div>
      </div>
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${(client.businessName || '').toUpperCase()}</div>
        <div style="font-size:7pt;">Company Legal Name</div>
      </div>
      <div style="padding:4px 6px;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${periodEnd}</div>
        <div style="font-size:7pt;">Period Ending</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 2fr 1fr;border-bottom:1px solid #000;">
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${client.suiAccountNumber || ''}</div>
        <div style="font-size:7pt;">Account No.</div>
      </div>
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${(client.businessAddress || '').toUpperCase()}</div>
        <div style="font-size:7pt;">Company Legal Address</div>
      </div>
      <div style="padding:4px 6px;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${penaltyDate}</div>
        <div style="font-size:7pt;">Penalty Date</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 2fr 1fr;border-bottom:1px solid #000;">
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${client.naicsCode || ''}</div>
        <div style="font-size:7pt;">NAICS Code</div>
      </div>
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${[(client.businessCity||'').toUpperCase(),(client.state||'TX').toUpperCase(),(client.businessZip||'')].filter(Boolean).join('  ')}</div>
        <div style="font-size:7pt;">City / State / Zip Code</div>
      </div>
      <div style="padding:4px 6px;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;"></div>
        <div style="font-size:7pt;">Company ID</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 2fr;border-bottom:1px solid #000;">
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${client.countyCode || ''}</div>
        <div style="font-size:7pt;">County Code</div>
      </div>
      <div style="padding:4px 6px;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;"></div>
        <div style="font-size:7pt;">No. of Employees Outside the County</div>
      </div>
    </div>
    <div style="text-align:center;font-size:14pt;font-weight:700;padding:8px 0;letter-spacing:1px;">DO NOT MAIL — KEEP FOR YOUR RECORDS</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #000;margin-bottom:6px;">
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;">Total State Wages</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;font-family:'Courier New',monospace;text-align:right;width:160px;">$ ${fmtZ(lines.totalWages)}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;">Excess Wages</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;font-family:'Courier New',monospace;text-align:right;"></td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;">Wage Base &nbsp; $${wageBase.toLocaleString()}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;font-family:'Courier New',monospace;text-align:right;">$ ${fmtZ(0)}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;">&nbsp;</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;"></td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;font-weight:700;">Taxable Wages</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;font-family:'Courier New',monospace;text-align:right;font-weight:700;">$ ${fmtZ(lines.sutaTaxableWages)}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;text-align:right;">${(sutaRate * 100).toFixed(5)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;"></td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;font-weight:700;">UI Contributions</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;font-family:'Courier New',monospace;text-align:right;font-weight:700;">$ ${fmtZ(lines.sutaTax)}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;">&nbsp;</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;"></td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;">Overpayment (negative) / Bal Due<br>from a previous period</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;font-family:'Courier New',monospace;text-align:right;">$</td>
      </tr>
      <tr style="height:18px;"><td style="border-bottom:1px solid #ccc;">&nbsp;</td><td style="border-bottom:1px solid #ccc;border-left:1px solid #000;"></td></tr>
      <tr style="height:18px;"><td style="border-bottom:1px solid #ccc;">&nbsp;</td><td style="border-bottom:1px solid #ccc;border-left:1px solid #000;"></td></tr>
      <tr style="height:18px;"><td style="border-bottom:1px solid #ccc;">&nbsp;</td><td style="border-bottom:1px solid #ccc;border-left:1px solid #000;"></td></tr>
      <tr>
        <td colspan="2" style="padding:10px 8px;border-bottom:1px solid #ccc;text-align:center;font-size:16pt;font-weight:700;letter-spacing:1px;">DO NOT MAIL — KEEP FOR YOUR RECORDS</td>
      </tr>
      <tr style="height:18px;"><td style="border-bottom:1px solid #ccc;">&nbsp;</td><td style="border-bottom:1px solid #ccc;border-left:1px solid #000;"></td></tr>
      <tr style="height:18px;"><td style="border-bottom:1px solid #ccc;">&nbsp;</td><td style="border-bottom:1px solid #ccc;border-left:1px solid #000;"></td></tr>
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;font-weight:700;">Total Payment Due</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ccc;border-left:1px solid #000;font-family:'Courier New',monospace;text-align:right;font-weight:700;">$ ${fmtZ(lines.sutaTax)}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:6px 8px;border-bottom:1px solid #ccc;">
          <div style="font-size:8pt;margin-bottom:4px;">Number of employees receiving pay for pay period which includes 12th day of the month</div>
          <div style="display:flex;gap:40px;">
            <div><div style="font-size:7pt;">1st Month</div><div style="font-family:'Courier New',monospace;font-weight:700;font-size:11pt;">${emp12thArr[0]}</div></div>
            <div><div style="font-size:7pt;">2nd Month</div><div style="font-family:'Courier New',monospace;font-weight:700;font-size:11pt;">${emp12thArr[1]}</div></div>
            <div><div style="font-size:7pt;">3rd Month</div><div style="font-family:'Courier New',monospace;font-weight:700;font-size:11pt;">${emp12thArr[2]}</div></div>
          </div>
        </td>
      </tr>
    </table>
    <div style="text-align:center;font-size:8pt;color:#555;margin-top:4px;">${revDate}</div>
  </div>`;

  // PAGE 2
  const page2 = `
  <div style="max-width:760px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;page-break-before:always;">
    <div style="text-align:center;margin-bottom:6px;">
      <div style="font-size:14pt;font-weight:700;line-height:1.3;">Texas Unemployment Insurance - Wage Report</div>
      <div style="font-size:14pt;font-weight:700;line-height:1.3;">Worksheet</div>
    </div>
    <div style="border:1px solid #000;text-align:center;padding:4px 8px;font-size:9pt;margin-bottom:6px;">
      This is a record of your information to complete your Unemployment Insurance Wage Report.<br>
      Do not file the worksheet.
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;border-bottom:1px solid #000;">
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${(client.businessName || '').toUpperCase()}</div>
        <div style="font-size:7pt;">Company Legal Name</div>
      </div>
      <div style="padding:4px 6px;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${client.ein || ''}</div>
        <div style="font-size:7pt;">FEIN</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid #000;">
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${periodEnd}</div>
        <div style="font-size:7pt;">Period Ending</div>
      </div>
      <div style="padding:4px 6px;border-right:1px solid #000;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;"></div>
        <div style="font-size:7pt;">Company ID</div>
      </div>
      <div style="padding:4px 6px;">
        <div style="font-family:'Courier New',monospace;font-weight:700;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px;">${client.suiAccountNumber || ''}</div>
        <div style="font-size:7pt;">Unemployment No.</div>
      </div>
    </div>
    <div style="text-align:center;font-size:14pt;font-weight:700;padding:8px 0;letter-spacing:1px;">DO NOT MAIL — KEEP FOR YOUR RECORDS</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #000;margin-bottom:6px;">
      <thead>
        <tr style="background:#f0f0f0;">
          <th style="padding:4px 6px;text-align:center;font-weight:700;font-size:8.5pt;border-bottom:1px solid #000;border-right:1px solid #ccc;">Employee Social Security No.</th>
          <th style="padding:4px 6px;text-align:center;font-weight:700;font-size:8.5pt;border-bottom:1px solid #000;border-right:1px solid #ccc;">Employee Name (Last, First, MI)</th>
          <th style="padding:4px 6px;text-align:center;font-weight:700;font-size:8.5pt;border-bottom:1px solid #000;border-right:1px solid #ccc;">Total Wages</th>
          <th style="padding:4px 6px;text-align:center;font-weight:700;font-size:8.5pt;border-bottom:1px solid #000;">Taxable Wages</th>
        </tr>
      </thead>
      <tbody>
        ${dataRows}
        ${emptyRows}
        <tr style="background:#f0f0f0;font-weight:700;">
          <td colspan="2" style="padding:4px 6px;border-top:1px solid #000;font-size:8pt;">Totals for this page</td>
          <td style="padding:4px 6px;border-top:1px solid #000;border-left:1px solid #000;font-family:'Courier New',monospace;text-align:right;">${fmtZ(lines.totalWages)}</td>
          <td style="padding:4px 6px;border-top:1px solid #000;border-left:1px solid #000;font-family:'Courier New',monospace;text-align:right;">${fmtZ(lines.sutaTaxableWages)}</td>
        </tr>
      </tbody>
    </table>
    <div style="text-align:center;font-size:14pt;font-weight:700;padding:8px 0;letter-spacing:1px;">DO NOT MAIL — KEEP FOR YOUR RECORDS</div>
    <div style="display:flex;justify-content:space-between;font-size:8pt;color:#555;margin-top:4px;">
      <span>${revDate}</span>
      <span>Page 1 of 1</span>
    </div>
  </div>`;

  return baseHtml(page1 + page2);
}

// ── W-2 ───────────────────────────────────────────────────────────────────────
function htmlW2(data, pr) {
  const { client, period, w2s } = data;

  function w2Box(num, label, value) {
    return `<div class="w2-box"><div class="lbl">${num ? `${num} ` : ''}${label}</div><div class="val">${value || ''}</div></div>`;
  }

  const employees = w2s.map((w, idx) => `
    <div style="${idx < w2s.length - 1 ? 'border-bottom:3px double #000;' : ''}">
      <div style="padding:4px 8px;border-bottom:1px solid #ccc;background:#f9f9f9;">
        <div style="display:flex;gap:20px;flex-wrap:wrap;">
          <div><span style="font-size:8pt;font-weight:700;">a Employee's social security number: </span><span class="mono fw7" style="font-size:10pt;">${w.ssn}</span></div>
          <div><span style="font-size:8pt;font-weight:700;">e Employee's name: </span><span style="font-weight:700;">${w.firstName} ${w.lastName}</span></div>
        </div>
        ${w.address ? `<div style="font-size:8pt;color:#555;margin-top:2px;">f ${w.address}${w.city?`, ${w.city}`:''}${w.state?`, ${w.state}`:''} ${w.zip||''}</div>` : ''}
      </div>
      <div class="w2-grid">
        ${w2Box('1','Wages, tips, other compensation',w.box1_wages>0?fmtZ(w.box1_wages):'')}
        ${w2Box('2','Federal income tax withheld',w.box2_fitWithheld>0?fmtZ(w.box2_fitWithheld):'')}
        ${w2Box('','','')}
        ${w2Box('3','Social security wages',w.box3_ssWages>0?fmtZ(w.box3_ssWages):'')}
        ${w2Box('4','Social security tax withheld',w.box4_ssTax>0?fmtZ(w.box4_ssTax):'')}
        ${w2Box('','(a) Uncollected SS on tips','')}
        ${w2Box('5','Medicare wages and tips',w.box5_medWages>0?fmtZ(w.box5_medWages):'')}
        ${w2Box('6','Medicare tax withheld',w.box6_medTax>0?fmtZ(w.box6_medTax):'')}
        ${w2Box('7','Social security tips','')}
        ${w2Box('8','Allocated tips','')}
        ${w2Box('9','','')}
        ${w2Box('10','Dependent care benefits','')}
        ${w2Box('11','Nonqualified plans','')}
        ${w2Box('12a','See instructions for box 12','')}
        <div style="display:flex;gap:1px;flex-direction:column;background:#ccc;">
          ${w2Box('13','Statutory employee ☐ Retirement plan ☐ Third-party sick pay ☐','')}
          ${w2Box('14','Other','')}
        </div>
        ${w2Box('12b','','')}${w2Box('12c','','')}${w2Box('12d','','')}
      </div>
      <div class="w2-state">
        ${w2Box('15','State / Employer\'s state ID no.',client.state||'TX')}
        ${w2Box('16','State wages, tips, etc.',w.box16_stateWages>0?fmtZ(w.box16_stateWages):'')}
        ${w2Box('17','State income tax','')}
        ${w2Box('18','Local wages, tips, etc.','')}
        ${w2Box('19','Local income tax','')}
      </div>
    </div>`).join('');

  const body = `
  <div class="page">
    <div style="border-bottom:2px solid #000;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="display:flex;align-items:baseline;gap:8px;"><span class="form-num">W-2</span><span style="font-size:11pt;font-weight:700;">Wage and Tax Statement</span></div>
        <div class="dept">Department of the Treasury — Internal Revenue Service</div>
        <div style="font-size:8pt;margin-top:2px;">Tax Year ${period.year} &nbsp;&nbsp; OMB No. 1545-0029</div>
      </div>
      <div style="font-size:8pt;color:#555;text-align:right;font-style:italic;">Copy A — For Social Security Administration</div>
    </div>
    <div style="border-bottom:1px solid #ccc;padding:4px 8px;">
      <div style="font-size:8pt;font-weight:700;margin-bottom:2px;">c Employer's name, address, and ZIP code</div>
      <div style="font-size:11pt;font-weight:700;">${client.businessName}</div>
      ${client.tradeName ? `<div style="font-size:9.5pt;">${client.tradeName}</div>` : ''}
      ${client.businessAddress ? `<div style="font-size:9.5pt;">${client.businessAddress}</div>` : ''}
      ${client.businessCity ? `<div style="font-size:9.5pt;">${client.businessCity}, ${client.state||'TX'} ${client.businessZip||''}</div>` : ''}
      <div style="margin-top:4px;font-size:8.5pt;"><strong>b Employer identification number (EIN): </strong><span class="mono fw7">${client.ein}</span></div>
    </div>
    ${employees}
    ${w2s.length === 0 ? `<div style="padding:24px;text-align:center;color:#888;font-size:9pt;">No employees with completed paychecks for ${period.year}.</div>` : ''}
  </div>`;

  return baseHtml(body);
}

// ── W-3 ───────────────────────────────────────────────────────────────────────
function htmlW3(data, pr) {
  const { client, period, totals } = data;

  function w2Box(num, label, value) {
    return `<div class="w2-box"><div class="lbl">${num ? `${num} ` : ''}${label}</div><div class="val">${value || ''}</div></div>`;
  }

  const payers = [['941 (Most common)',true],['943',false],['944',false],['Household employer',false],['Medicare govt. employer',false],['Military',false]];
  const employers = [['None apply',true],['State/local non-501c',false],['501c non-govt.',false],['State/local 501c',false],['Federal govt.',false]];

  const body = `
  <div class="page">
    <div style="border-bottom:2px solid #000;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="display:flex;align-items:baseline;gap:8px;"><span class="form-num" style="font-size:22pt;">W-3</span><span style="font-size:11pt;font-weight:700;">Transmittal of Wage and Tax Statements</span></div>
        <div class="dept">Department of the Treasury — Internal Revenue Service</div>
        <div style="font-size:8pt;margin-top:2px;">For calendar year ${period.year} &nbsp;&nbsp; OMB No. 1545-0029</div>
      </div>
      <div style="font-size:8pt;text-align:right;">
        <div style="font-weight:700;">${totals.employeeCount} W-2 Form${totals.employeeCount!==1?'s':''}</div>
        <div class="xs">33333</div>
      </div>
    </div>

    <div class="b-bottom" style="display:flex;">
      <div style="flex:1;padding:4px 8px;border-right:1px solid #ccc;">
        <div style="font-size:8pt;font-weight:700;margin-bottom:2px;">b Kind of Payer (Check one)</div>
        <div style="display:flex;flex-wrap:wrap;gap:2px 16px;font-size:7.5pt;">
          ${payers.map(([o,c])=>`<div style="display:flex;align-items:center;gap:3px;">${chk(c)}<span>${o}</span></div>`).join('')}
        </div>
      </div>
      <div style="padding:4px 8px;">
        <div style="font-size:8pt;font-weight:700;margin-bottom:2px;">Kind of Employer (Check one)</div>
        <div style="display:flex;flex-wrap:wrap;gap:2px 12px;font-size:7.5pt;">
          ${employers.map(([o,c])=>`<div style="display:flex;align-items:center;gap:3px;">${chk(c)}<span>${o}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="b-bottom" style="display:flex;">
      <div style="flex:1;padding:4px 8px;border-right:1px solid #ccc;">
        <div class="field-lbl">e Employer identification number (EIN)</div>
        <div class="field-val mono" style="font-size:12pt;margin-bottom:4px;">${client.ein}</div>
        <div class="field-lbl">f Employer's name</div>
        <div class="field-val" style="margin-bottom:4px;">${client.businessName}</div>
        <div class="field-lbl">g Employer's address and ZIP code</div>
        <div class="field-val">${[client.businessAddress,client.businessCity,client.state||'TX',client.businessZip].filter(Boolean).join(', ')}</div>
        <div style="margin-top:6px;"><div class="field-lbl">Employer's contact person</div><div class="blank-line fw7">${pr&&pr.name?pr.name:''}</div></div>
        <div style="margin-top:4px;"><div class="field-lbl">Employer's telephone number</div><div class="blank-line">${pr&&pr.phone?pr.phone:''}</div></div>
        <div style="margin-top:4px;"><div class="field-lbl">Employer's email address</div><div class="blank-line">${pr&&pr.email?pr.email:''}</div></div>
      </div>
      <div class="w3-grid" style="flex:2;">
        ${w2Box('1','Wages, tips, other compensation',totals.box1_wages>0?fmtZ(totals.box1_wages):'')}
        ${w2Box('2','Federal income tax withheld',totals.box2_fitWithheld>0?fmtZ(totals.box2_fitWithheld):'')}
        ${w2Box('3','Social security wages',totals.box3_ssWages>0?fmtZ(totals.box3_ssWages):'')}
        ${w2Box('4','Social security tax withheld',totals.box4_ssTax>0?fmtZ(totals.box4_ssTax):'')}
        ${w2Box('5','Medicare wages and tips',totals.box5_medWages>0?fmtZ(totals.box5_medWages):'')}
        ${w2Box('6','Medicare tax withheld',totals.box6_medTax>0?fmtZ(totals.box6_medTax):'')}
        ${w2Box('7','Social security tips','')}${w2Box('8','Allocated tips','')}
        ${w2Box('9','','')}${w2Box('10','Dependent care benefits','')}
        ${w2Box('11','Nonqualified plans','')}${w2Box('12a','Deferred compensation','')}
        ${w2Box('14','Income tax withheld by payer of third-party sick pay','')}${w2Box('','','')}
      </div>
    </div>

    <div class="w3-state">
      ${w2Box('15','State / Employer\'s state ID no.',totals.box15_state||'TX')}
      ${w2Box('16','State wages, tips, etc.',totals.box16_stateWages>0?fmtZ(totals.box16_stateWages):'')}
      ${w2Box('17','State income tax','')}${w2Box('','','')}
    </div>

    <div style="padding:4px 8px;border-top:1px solid #000;font-size:7.5pt;">Under penalties of perjury, I declare that I have examined this return and accompanying documents and, to the best of my knowledge and belief, they are true, correct, and complete.</div>
    ${signatureBlock(pr)}
  </div>`;

  return baseHtml(body);
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
function generateFormHtml(data, pr) {
  switch (data.reportType) {
    case '941': return html941(data, pr);
    case '940': return html940(data, pr);
    case 'TWC': return htmlTWC(data, pr);
    case 'W-2': return htmlW2(data, pr);
    case 'W-3': return htmlW3(data, pr);
    default: throw new Error(`Unknown report type: ${data.reportType}`);
  }
}

module.exports = { generateFormHtml };
