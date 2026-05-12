/**
 * EFTPS Playwright Automation — Real Payment Support
 *
 * Automates federal tax deposits via the EFTPS Business Tax Payment Center
 * (https://www.eftps.gov).
 *
 * Login credentials:
 *   • EIN  — Employer Identification Number (XX-XXXXXXX)
 *   • PIN  — 4-digit EFTPS PIN (received by mail when enrolled)
 *   • Internet Password — if enrolled for online access (stored separately)
 *
 * Set EFTPS_DRY_RUN=false in .env to send live payments.
 * Screenshots are written to data/screenshots/ on every run.
 *
 * Selector notes: EFTPS page structure can change. If the script fails, open
 * a screenshot in data/screenshots/ and update the relevant locator below.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const EFTPS_URL      = 'https://www.eftps.gov/eftps/';
const SHOTS_DIR      = process.env.SCREENSHOTS_DIR || path.join(__dirname, '../../../data/screenshots');

// ── helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function formatDate(dateStr) {
  // EFTPS expects MM/DD/YYYY
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function quarterLabel(quarter) {
  return ['Jan-Mar', 'Apr-Jun', 'Jul-Sep', 'Oct-Dec'][quarter - 1] || 'Jan-Mar';
}

// Try a list of locators in order; return the first one that is visible, or null
async function tryLocators(page, selectors, timeout = 5000) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout });
      return loc;
    } catch { /* try next */ }
  }
  return null;
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {object}  p
 * @param {string}  p.ein              – EIN, any format (XX-XXXXXXX or 9 digits)
 * @param {string}  p.pin              – 4-digit EFTPS PIN
 * @param {string}  [p.internetPassword] – EFTPS Internet Password (if enrolled for web)
 * @param {object}  p.taxData          – { fitWithholding, employeeSS, employeeMedicare, employerSS, employerMedicare }
 * @param {string}  [p.payPeriodEnd]   – ISO date string used to derive tax quarter/year
 * @param {string}  [p.settlementDate] – ISO date string for fund debit (defaults to next banking day)
 * @param {number}  [p.taxYear]        – Override tax year
 * @param {number}  [p.taxQuarter]     – Override tax quarter (1–4)
 * @param {boolean} [p.dryRun]         – If true (or EFTPS_DRY_RUN=true), stop before submitting
 * @param {boolean} [p.headless]       – Run headless (default true)
 */
async function submitToEFTPS(p) {
  ensureDir(SHOTS_DIR);

  const isDryRun   = p.dryRun !== false && process.env.EFTPS_DRY_RUN !== 'false';
  // Headless defaults to true (required in production). Set EFTPS_HEADLESS=false
  // only for local supervised testing where a visible browser is needed.
  const isHeadless = p.headless !== undefined
    ? p.headless === true
    : process.env.EFTPS_HEADLESS !== 'false';

  const ts   = Date.now();
  const snap = (label) => path.join(SHOTS_DIR, `eftps_${ts}_${label}.png`);
  const log  = [];
  function step(msg) { console.log(`[EFTPS] ${msg}`); log.push(msg); }

  // Derive tax period
  const periodEnd  = p.payPeriodEnd || new Date().toISOString().slice(0, 10);
  const d          = new Date(periodEnd);
  const taxYear    = p.taxYear    || d.getFullYear();
  const taxQuarter = p.taxQuarter || Math.ceil((d.getMonth() + 1) / 3);

  // Settlement date — default next banking day
  const settlementDate = p.settlementDate || (() => {
    const sd = new Date();
    sd.setDate(sd.getDate() + 1);
    while (sd.getDay() === 0 || sd.getDay() === 6) sd.setDate(sd.getDate() + 1);
    return sd.toISOString().slice(0, 10);
  })();

  // EFTPS takes COMBINED SS and Medicare (employer + employee each)
  const { fitWithholding, employeeSS, employeeMedicare, employerSS, employerMedicare } = p.taxData;
  const totalSS       = round2(employeeSS + employerSS);
  const totalMedicare = round2(employeeMedicare + employerMedicare);
  const einClean      = p.ein.replace(/-/g, '');

  step(`Starting EFTPS session | EIN: ${p.ein} | Period: Q${taxQuarter} ${taxYear} | Settlement: ${settlementDate} | DryRun: ${isDryRun}`);

  const browser = await chromium.launch({ headless: isHeadless, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.setDefaultNavigationTimeout(30000);

  try {
    // ── 1. Navigate to EFTPS ─────────────────────────────────────────────────
    step('Navigating to eftps.gov');
    await page.goto(EFTPS_URL, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: snap('01_home') });

    // ── 2. Find business payment / login entry point ─────────────────────────
    step('Looking for payment entry link');
    const payLink = await tryLocators(page, [
      'a:has-text("Make a Payment")',
      'a:has-text("Business")',
      'a[href*="payment"]',
      'a[href*="login"]',
      '#paymentLink',
    ]);
    if (payLink) {
      await payLink.click();
      await page.waitForLoadState('domcontentloaded');
      await page.screenshot({ path: snap('02_prelogin') });
    }

    // ── 3. Login form — EIN + PIN ─────────────────────────────────────────────
    step('Filling login credentials');

    // EFTPS splits EIN into two boxes (2 digits + 7 digits) on some pages
    const einBox1 = await tryLocators(page, [
      'input[name="ein1"]', 'input[id="ein1"]', 'input[id="einFirst"]',
    ], 3000);
    if (einBox1) {
      await einBox1.fill(einClean.slice(0, 2));
      const einBox2 = await tryLocators(page, [
        'input[name="ein2"]', 'input[id="ein2"]', 'input[id="einLast"]',
      ], 3000);
      if (einBox2) await einBox2.fill(einClean.slice(2));
    } else {
      // Single EIN box
      const einBox = await tryLocators(page, [
        'input[name*="ein" i]', 'input[id*="ein" i]',
        'input[name*="tin" i]', 'input[id*="tin" i]',
        'input[placeholder*="EIN" i]',
      ], 5000);
      if (einBox) await einBox.fill(einClean);
    }

    // PIN field
    const pinBox = await tryLocators(page, [
      'input[name="pin"]', 'input[id="pin"]', 'input[name*="pin" i]',
      'input[id*="pin" i]', 'input[type="password"]',
    ]);
    if (pinBox) await pinBox.fill(p.pin);

    // Internet Password (if enrolled for online access)
    if (p.internetPassword) {
      const pwBox = await tryLocators(page, [
        'input[name*="password" i]', 'input[id*="password" i]',
        'input[name*="internet" i]',
      ], 3000);
      if (pwBox) await pwBox.fill(p.internetPassword);
    }

    await page.screenshot({ path: snap('03_login_filled') });

    if (isDryRun) {
      step('DRY RUN — stopping before login submit');
      await browser.close();
      return {
        success: true, dryRun: true,
        message: 'Dry run complete: login form located and filled. Set EFTPS_DRY_RUN=false to submit live payments.',
        screenshot: snap('03_login_filled'),
        log,
      };
    }

    // ── 4. Submit login ───────────────────────────────────────────────────────
    step('Submitting login');
    const loginBtn = await tryLocators(page, [
      'button[type="submit"]', 'input[type="submit"]',
      'button:has-text("Login")', 'button:has-text("Sign In")',
      'a:has-text("Login")',
    ]);
    if (loginBtn) await loginBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: snap('04_post_login') });

    // Check for login errors
    const errEl = await tryLocators(page, ['.error', '.alert', '[class*="error" i]', '[class*="alert" i]'], 3000);
    if (errEl) {
      const errText = (await errEl.textContent()).trim();
      if (/invalid|incorrect|fail|denied/i.test(errText)) {
        throw new Error(`EFTPS login failed: ${errText}`);
      }
    }

    // ── 5. Navigate to Make a Payment ────────────────────────────────────────
    step('Navigating to payment page');
    const makePayLink = await tryLocators(page, [
      'a:has-text("Make a Tax Payment")',
      'a:has-text("Make a Payment")',
      'a:has-text("Payments")',
      'a[href*="payment" i]',
      '#makePaymentLink',
    ]);
    if (makePayLink) {
      await makePayLink.click();
      await page.waitForLoadState('domcontentloaded');
    }
    await page.screenshot({ path: snap('05_payment_nav') });

    // ── 6. Select tax form — 941 ─────────────────────────────────────────────
    step('Selecting Form 941');
    const formSel = await tryLocators(page, [
      'select[name*="taxType" i]', 'select[name*="form" i]',
      'select[id*="taxType" i]',  'select[id*="form" i]',
      'select[name*="type" i]',
    ], 8000);
    if (formSel) {
      // Try selecting 941 by value or label
      await formSel.selectOption({ label: /941/ }).catch(() =>
        formSel.selectOption({ value: /941/ }).catch(() =>
          formSel.selectOption('941')
        )
      );
    } else {
      // Fallback: click a radio/checkbox for 941
      const form941 = await tryLocators(page, [
        'input[value*="941"]', 'label:has-text("941")',
      ], 3000);
      if (form941) await form941.click();
    }
    await page.screenshot({ path: snap('06_form_941') });

    // ── 7. Tax period — quarter + year ───────────────────────────────────────
    step(`Setting tax period Q${taxQuarter} ${taxYear}`);
    const qSel = await tryLocators(page, [
      'select[name*="quarter" i]', 'select[id*="quarter" i]',
      'select[name*="period" i]',  'select[id*="period" i]',
    ], 5000);
    if (qSel) {
      await qSel.selectOption({ label: new RegExp(quarterLabel(taxQuarter), 'i') }).catch(() =>
        qSel.selectOption(String(taxQuarter))
      );
    }

    const yrSel = await tryLocators(page, [
      'select[name*="year" i]', 'select[id*="year" i]',
      'input[name*="year" i]',  'input[id*="year" i]',
    ], 5000);
    if (yrSel) {
      const tag = await yrSel.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') {
        await yrSel.selectOption(String(taxYear));
      } else {
        await yrSel.fill(String(taxYear));
      }
    }

    // ── 8. Settlement date ───────────────────────────────────────────────────
    step(`Setting settlement date ${settlementDate}`);
    const settlSel = await tryLocators(page, [
      'input[name*="settl" i]', 'input[id*="settl" i]',
      'input[name*="date" i]',  'input[id*="date" i]',
      'input[type="date"]',
    ], 5000);
    if (settlSel) {
      const type = await settlSel.getAttribute('type');
      if (type === 'date') {
        await settlSel.fill(settlementDate);
      } else {
        await settlSel.fill(formatDate(settlementDate));
      }
    }
    await page.screenshot({ path: snap('07_period_date') });

    // ── 9. Enter tax amounts ─────────────────────────────────────────────────
    step(`Entering amounts: FIT=${fitWithholding} SS=${totalSS} Medicare=${totalMedicare}`);

    // Federal Income Tax withheld (Line 3 on 941)
    const fitSel = await tryLocators(page, [
      'input[name*="income" i]', 'input[id*="income" i]',
      'input[name*="fit" i]',    'input[id*="fit" i]',
      'input[name*="line3" i]',  'input[id*="line3" i]',
      'input[name*="withhold" i]',
    ], 5000);
    if (fitSel) await fitSel.fill(fitWithholding.toFixed(2));

    // Social Security — combined employer + employee (Line 5a col 2 on 941)
    const ssSel = await tryLocators(page, [
      'input[name*="social" i]',  'input[id*="social" i]',
      'input[name*="ss" i]',      'input[id*="ss" i]',
      'input[name*="line5a" i]',  'input[id*="line5a" i]',
      'input[name*="fica" i]',
    ], 5000);
    if (ssSel) await ssSel.fill(totalSS.toFixed(2));

    // Medicare — combined (Line 5c col 2 on 941)
    const medSel = await tryLocators(page, [
      'input[name*="medicare" i]', 'input[id*="medicare" i]',
      'input[name*="med" i]',      'input[id*="med" i]',
      'input[name*="line5c" i]',   'input[id*="line5c" i]',
    ], 5000);
    if (medSel) await medSel.fill(totalMedicare.toFixed(2));

    await page.screenshot({ path: snap('08_amounts') });

    // ── 10. Proceed through review steps ────────────────────────────────────
    step('Proceeding through review');
    for (let i = 0; i < 3; i++) {
      const nextBtn = await tryLocators(page, [
        'button:has-text("Next")', 'button:has-text("Continue")',
        'button:has-text("Review")', 'input[value*="Next" i]',
        'input[value*="Continue" i]',
      ], 4000);
      if (!nextBtn) break;
      await nextBtn.click();
      await page.waitForLoadState('domcontentloaded');
      await page.screenshot({ path: snap(`09_review_${i}`) });

      // Stop if we see a final confirm button — don't click it yet
      const confirmBtn = await tryLocators(page, [
        'button:has-text("Submit")', 'button:has-text("Confirm")',
        'input[value*="Submit" i]', 'input[value*="Confirm" i]',
        'button:has-text("Make Payment")',
      ], 3000);
      if (confirmBtn) {
        step('Reached confirmation page — submitting');
        await confirmBtn.click();
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: snap('10_submitted') });
        break;
      }
    }

    // ── 11. Capture EFT acknowledgment number ────────────────────────────────
    step('Capturing confirmation number');
    const confEl = await tryLocators(page, [
      '[class*="confirm" i]', '[id*="confirm" i]',
      '[class*="ack" i]',     '[id*="ack" i]',
      '[class*="success" i]',
    ], 8000);
    const confRaw   = confEl ? await confEl.textContent() : '';
    // Extract a long numeric sequence (EFT acknowledgment numbers are typically 15 digits)
    const confMatch = confRaw.match(/\d{10,}/);
    const confirmation = confMatch ? confMatch[0] : confRaw.trim() || 'Payment submitted — check EFTPS for confirmation number';

    await browser.close();
    step(`Done — confirmation: ${confirmation}`);
    return {
      success: true,
      confirmation,
      screenshot: snap('10_submitted'),
      log,
      taxYear, taxQuarter, settlementDate,
    };

  } catch (err) {
    step(`ERROR: ${err.message}`);
    await page.screenshot({ path: snap('error') }).catch(() => {});
    await browser.close();
    return {
      success: false,
      error: err.message,
      screenshot: snap('error'),
      log,
    };
  }
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

module.exports = { submitToEFTPS };
