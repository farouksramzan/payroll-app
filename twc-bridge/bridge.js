'use strict';

require('dotenv').config();
const WebSocket  = require('ws');
const fs         = require('fs');
const path       = require('path');
const { spawn }  = require('child_process');
const puppeteer  = require('puppeteer');

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL    = process.env.RAILWAY_URL;
const SECRET        = process.env.BRIDGE_TWC_SECRET;
const TWC_USERNAME  = process.env.TWC_USERNAME;
const TWC_PASSWORD  = process.env.TWC_PASSWORD;
const QUICKFILE_EXE = process.env.QUICKFILE_EXE || 'C:\\Program Files (x86)\\QuickFile\\QuickFile.exe';
const AHK_EXE       = process.env.AHK_EXE       || 'C:\\Program Files\\AutoHotkey\\AutoHotkey.exe';
const AHK_SCRIPT    = path.join(__dirname, 'submit.ahk');
const TEMP_DIR        = process.env.TEMP_DIR       || path.join(__dirname, 'temp');
const SESSION_FILE    = path.join(__dirname, 'twc-session.json');
const RECONNECT_MS    = 10_000;   // reconnect delay after disconnect
const PING_MS         = 20_000;   // client-side ping interval
const TWC_LOGIN_URL   = 'https://apps.twc.texas.gov/UITAXSERV/security/logon.do';
const TWC_HOME_URL    = 'https://apps.twc.texas.gov/UITAXSERV/postLogon.do';
const TWC_PAYMENT_URL = 'https://apps.twc.texas.gov/UITAXSERV/payments/onlinePayment.do';

if (!SERVER_URL || !SECRET) {
  console.error('[TWC Bridge] RAILWAY_URL and BRIDGE_TWC_SECRET must be set in .env');
  process.exit(1);
}
if (!TWC_USERNAME || !TWC_PASSWORD) {
  console.error('[TWC Bridge] TWC_USERNAME and TWC_PASSWORD must be set in .env');
  process.exit(1);
}

// Ensure temp dir exists
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── State ────────────────────────────────────────────────────────────────────
let ws          = null;
let pingTimer   = null;
let reconnTimer = null;
let authed      = false;

// Only one automation job runs at a time.
// kill() closes any open browser/process so the job promise rejects immediately.
let activeJob = null; // { jobId, label, kill: async () => void }

function jobLock(jobId, label, killFn) {
  activeJob = { jobId, label, kill: killFn };
}
function jobUnlock() {
  activeJob = null;
}

// ── WebSocket connection ──────────────────────────────────────────────────────
function connect() {
  const wsUrl = SERVER_URL.replace(/^http/, 'ws') + '/ws/twc-bridge';
  console.log(`[TWC Bridge] Connecting to ${wsUrl}…`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[TWC Bridge] Connected — authenticating…');
    send({ type: 'auth', secret: SECRET });

    // Client-side pings to detect dead connection
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) send({ type: 'ping' });
    }, PING_MS);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleMessage(msg);
  });

  ws.on('close', (code, reason) => {
    clearInterval(pingTimer);
    authed = false;
    console.log(`[TWC Bridge] Disconnected (${code}) — ${reason?.toString() || ''}`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[TWC Bridge] WS error:', err.message);
  });
}

function scheduleReconnect() {
  clearTimeout(reconnTimer);
  reconnTimer = setTimeout(() => connect(), RECONNECT_MS);
}

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ── Message handling ──────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'auth_ok':
      authed = true;
      console.log('[TWC Bridge] Authenticated — ready for jobs');
      break;

    case 'auth_fail':
      console.error('[TWC Bridge] Auth failed:', msg.message);
      ws.close();
      break;

    case 'submit':
    case 'twc_payment': {
      if (!authed) { console.warn('[TWC Bridge] Received job before auth — ignoring'); return; }
      if (activeJob) {
        console.warn(`[TWC Bridge] Job ${msg.jobId} rejected — bridge busy with ${activeJob.label}`);
        send({
          type:         'result',
          jobId:        msg.jobId,
          submissionId: msg.submissionId,
          paymentId:    msg.paymentId,
          success:      false,
          error:        `Bridge is busy with another job (${activeJob.label}). Kill it from the app or wait for it to finish.`,
        });
        return;
      }
      const handler = msg.type === 'twc_payment' ? handlePaymentJob : handleJob;
      handler(msg).catch(err => {
        console.error(`[TWC Bridge] Job ${msg.jobId} failed:`, err.message);
        send({
          type:         'result',
          jobId:        msg.jobId,
          submissionId: msg.submissionId,
          paymentId:    msg.paymentId,
          success:      false,
          error:        err.message,
        });
      });
      break;
    }

    case 'kill_job': {
      if (!activeJob) {
        console.log('[TWC Bridge] kill_job received but no active job');
        send({ type: 'job_killed', jobId: null });
        return;
      }
      const killedId    = activeJob.jobId;
      const killedLabel = activeJob.label;
      console.log(`[TWC Bridge] Killing job ${killedId} (${killedLabel})…`);
      activeJob.kill().catch(e => console.warn('[TWC Bridge] Kill error (ignored):', e.message));
      // jobUnlock() is called inside the job's finally block when it catches the kill error
      send({ type: 'job_killed', jobId: killedId, label: killedLabel });
      break;
    }

    case 'pong':
      break;

    default:
      console.log('[TWC Bridge] Unknown message type:', msg.type);
  }
}

// ── Job handler ───────────────────────────────────────────────────────────────
async function handleJob(job) {
  const { jobId, submissionId, filename, icesaContent, clientName, quarter, year } = job;
  console.log(`[TWC Bridge] Job ${jobId}: ${clientName} Q${quarter} ${year}`);

  let ahkProc    = null;
  let puppBrowser = null;

  jobLock(jobId, `ICESA ${clientName} Q${quarter}${year}`, async () => {
    if (ahkProc)    { try { ahkProc.kill('SIGKILL'); }    catch (_) {} }
    if (puppBrowser){ try { await puppBrowser.close(); }  catch (_) {} }
  });

  try {
    send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'Bridge received job — saving ICESA file' });

    const filePath = path.join(TEMP_DIR, filename || `TWC_Q${quarter}_${year}.txt`);
    try {
      fs.writeFileSync(filePath, icesaContent, { encoding: 'utf8' });
    } catch (err) {
      throw new Error(`Failed to save ICESA file: ${err.message}`);
    }

    send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'Launching QuickFile…' });

    let ahkResult;
    try {
      ahkResult = await runQuickFileApp(filePath, jobId, submissionId, (proc) => { ahkProc = proc; });
    } catch (err) {
      console.log(`[TWC Bridge] AHK failed — ICESA file left at: ${filePath}`);
      throw err;
    }
    ahkProc = null;
    try { fs.unlinkSync(filePath); } catch (_) {}

    const { qfhFile } = ahkResult;
    console.log(`[TWC Bridge] AHK done — qfhFile: ${qfhFile}`);

    const qfhBasename = path.basename(qfhFile);
    const ufn = qfhBasename.replace('.qfh', '.ice.gz');
    const iceGzPath = path.join('C:\\QuickFile\\Upload', ufn);
    let fileSize = 0;
    try { fileSize = fs.statSync(iceGzPath).size; } catch (_) {}
    const twcUrl = 'https://m06hostp.twc.state.tx.us/TAXWEB/qf/controller'
      + '?rfn=' + encodeURIComponent(filename)
      + '&drn=' + encodeURIComponent('C:\\QuickFile\\Upload\\')
      + '&hfn=' + encodeURIComponent(qfhBasename)
      + '&ufn=' + encodeURIComponent(ufn)
      + '&type=Report'
      + '&fs=' + fileSize
      + '&ver=05.05.0009';

    send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'Logging in to TWC website…' });

    let confirmation = null;
    try {
      confirmation = await runTwcWebSubmission(twcUrl, qfhFile, jobId, submissionId, (b) => { puppBrowser = b; });
    } catch (err) {
      throw new Error(`TWC web submission failed: ${err.message}`);
    }

    console.log(`[TWC Bridge] Job ${jobId} complete — confirmation: ${confirmation || 'none'}`);
    send({ type: 'result', jobId, submissionId, success: true, confirmation: confirmation || null });

  } finally {
    // Always clean up, even if killed
    if (ahkProc)     { try { ahkProc.kill('SIGKILL'); }    catch (_) {} }
    if (puppBrowser) { try { await puppBrowser.close(); }  catch (_) {} }
    jobUnlock();
  }
}

// ── Step 1: AutoHotkey — QuickFile desktop app ────────────────────────────────
// Runs the AHK script which clicks through all QuickFile dialogs,
// then captures the TWC URL and .qfh file path before Edge opens.
// Returns { twcUrl, qfhFile }
function runQuickFileApp(icesaFilePath, jobId, submissionId, onProc) {
  return new Promise((resolve, reject) => {
    const resultFile = path.join(TEMP_DIR, `ahk_result_${jobId}.txt`);

    console.log(`[TWC Bridge] Running AHK: ${AHK_SCRIPT}`);
    const proc = spawn(AHK_EXE, [AHK_SCRIPT, icesaFilePath, resultFile, QUICKFILE_EXE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onProc?.(proc); // let caller track it for force-kill

    let stdout = '', stderr = '';
    proc.stdout?.on('data', d => { stdout += d.toString(); });
    proc.stderr?.on('data', d => { stderr += d.toString(); });

    const statusInterval = setInterval(() => {
      send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'QuickFile app: clicking through dialogs…' });
    }, 5_000);

    const timeout = setTimeout(() => {
      proc.kill();
      clearInterval(statusInterval);
      reject(new Error('QuickFile AHK script timed out after 5 minutes'));
    }, 5 * 60_000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      clearInterval(statusInterval);
      if (stdout) console.log('[AHK stdout]', stdout.trim());
      if (stderr) console.error('[AHK stderr]', stderr.trim());

      // Read result file: line 1 = .qfh file path (URL is constructed by bridge.js)
      if (!fs.existsSync(resultFile)) {
        reject(new Error(`AHK result file not found (exit code ${code})`));
        return;
      }
      const lines = fs.readFileSync(resultFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
      try { fs.unlinkSync(resultFile); } catch (_) {}

      if (lines[0] && lines[0].startsWith('ERROR:')) {
        reject(new Error(lines[0]));
        return;
      }
      if (lines.length < 1 || !lines[0]) {
        reject(new Error(`AHK result missing qfh path: ${lines.join(' | ')}`));
        return;
      }
      resolve({ qfhFile: lines[0] });
    });
  });
}

// ── Step 2: Puppeteer — TWC website login + file upload ───────────────────────
// Navigates to the TWC QuickFile web portal, logs in, uploads the .qfh file,
// submits, and returns the confirmation text.
async function runTwcWebSubmission(twcUrl, qfhFile, jobId, submissionId, onBrowser) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });
  onBrowser?.(browser);

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30_000);

    // Navigate to the URL QuickFile generated (includes file reference params)
    console.log(`[Puppeteer] Navigating to: ${twcUrl}`);
    await page.goto(twcUrl, { waitUntil: 'networkidle2' });

    // ── Login ──────────────────────────────────────────────────────────────
    // Log all input fields on the page so we can see exact field names
    const allInputs = await page.$$eval('input', els =>
      els.map(e => ({ name: e.name, id: e.id, type: e.type, placeholder: e.placeholder }))
    );
    console.log('[Puppeteer] Page URL:', page.url());
    console.log('[Puppeteer] Input fields found:', JSON.stringify(allInputs));

    // Try multiple possible field name conventions for TWC login
    const userField = await page.$('[name=username]')
      || await page.$('[name=userid]')
      || await page.$('[name=user_id]')
      || await page.$('[name=UserID]')
      || await page.$('[name=loginId]')
      || await page.$('input[type=text]:not([type=hidden])');

    if (userField) {
      console.log('[Puppeteer] Login page detected — logging in…');
      send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'Logging in to TWC website…' });

      await userField.click({ clickCount: 3 });
      await userField.type(TWC_USERNAME, { delay: 50 });

      const passField = await page.$('[name=password]')
        || await page.$('[name=passwd]')
        || await page.$('[name=Password]')
        || await page.$('input[type=password]');

      if (passField) {
        await passField.click({ clickCount: 3 });
        await passField.type(TWC_PASSWORD, { delay: 50 });
      }

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('[type=submit]'),
      ]);
      console.log('[Puppeteer] Logged in — current URL:', page.url());
    } else {
      console.log('[Puppeteer] No login fields found — may already be logged in or on a different page');
    }

    // ── Upload page ────────────────────────────────────────────────────────
    send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'Uploading .qfh file…' });

    // Wait for the file input to appear
    await page.waitForSelector('input[type=file]', { timeout: 15_000 });

    // Set the .qfh file on the file input (bypasses the file picker dialog entirely)
    const fileInput = await page.$('input[type=file]');
    await fileInput.uploadFile(qfhFile);
    console.log(`[Puppeteer] File set: ${qfhFile}`);

    // Click "Send File" (or equivalent submit button)
    send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'Sending file to TWC…' });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }),
      page.click('[type=submit]'),
    ]);

    // ── Capture confirmation ───────────────────────────────────────────────
    const afterUrl  = page.url();
    const bodyText  = await page.evaluate(() => document.body.innerText);
    console.log('[Puppeteer] URL after submit:', afterUrl);
    console.log('[Puppeteer] Page after submit:\n' + bodyText.substring(0, 600));

    // Extract a meaningful confirmation line
    const lines       = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
    const confirmLine = lines.find(l => l.match(/confirm|success|receipt|transmit|accept/i))
      || lines.find(l => l.match(/\d{6,}/))  // any line with a long number (likely a receipt #)
      || bodyText.substring(0, 200);

    // Keep browser open 8 seconds so the user can read the confirmation page
    console.log('[Puppeteer] Waiting 8s before closing browser…');
    await new Promise(r => setTimeout(r, 8_000));

    return confirmLine.trim();

  } finally {
    await browser.close();
  }
}

// ── TWC Payment automation ────────────────────────────────────────────────────

async function handlePaymentJob(job) {
  const { jobId, paymentId, twcAccountNumber, amount, paymentDate, bankName, clientName } = job;
  console.log(`[Payment] Job ${jobId}: ${clientName} — $${amount} on ${paymentDate} (account ${twcAccountNumber})`);

  let puppBrowser = null;

  jobLock(jobId, `Payment ${clientName} $${amount}`, async () => {
    if (puppBrowser) { try { await puppBrowser.close(); } catch (_) {} }
  });

  try {
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: 'Opening browser…' });

    const { confirmationNumber, bankNameConfirmed, scheduledDate, scheduledAmount } =
      await runTwcPayment({ jobId, paymentId, twcAccountNumber, amount, paymentDate, bankName }, (b) => { puppBrowser = b; });

    send({
      type: 'result', jobId, paymentId, success: true,
      confirmationNumber, bankName: bankNameConfirmed, scheduledDate, scheduledAmount,
    });

  } finally {
    if (puppBrowser) { try { await puppBrowser.close(); } catch (_) {} }
    jobUnlock();
  }
}

// Session helpers
function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch (_) {}
  return null;
}

function saveSession(cookies) {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2)); } catch (_) {}
}

async function runTwcPayment({ jobId, paymentId, twcAccountNumber, amount, paymentDate, bankName }, onBrowser) {
  const dateMatch = paymentDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) throw new Error(`Invalid paymentDate format: ${paymentDate}`);
  const [, yyyy, mm, dd] = dateMatch;
  const monthNum = parseInt(mm, 10);

  const savedCookies = loadSession();

  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  onBrowser?.(browser);

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);

    // Auto-accept any JS confirm/alert dialogs ("Are you sure you want to proceed?")
    page.on('dialog', async dialog => {
      console.log(`[Payment] Dialog: "${dialog.message()}" — accepting`);
      await dialog.accept();
    });

    // ── Try saved session ───────────────────────────────────────────────────
    if (savedCookies) {
      console.log('[Payment] Loading saved session cookies…');
      await page.setCookie(...savedCookies);
      await page.goto(TWC_HOME_URL, { waitUntil: 'networkidle2' });

      if (page.url().includes('postLogon') || page.url().includes('UITAXSERV') && !page.url().includes('logon')) {
        console.log('[Payment] Session still valid — skipping login');
      } else {
        console.log('[Payment] Session expired — need fresh login');
        await doLogin(page, jobId, paymentId);
        saveSession(await page.cookies());
      }
    } else {
      await doLogin(page, jobId, paymentId);
      saveSession(await page.cookies());
    }

    // ── Select employer ─────────────────────────────────────────────────────
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: `Selecting employer ${twcAccountNumber}…` });

    // Make sure we're on the home page
    if (!page.url().includes('postLogon') && !page.url().includes('UITAXSERV')) {
      await page.goto(TWC_HOME_URL, { waitUntil: 'networkidle2' });
    }

    // Fill the "TWC Tax Account Number" field and click Select
    const acctField = await page.$('input[name="taxAcctNum"]')
      || await page.$('input[name="taxAccountNumber"]')
      || await page.$('input[name="accountNumber"]')
      || await page.$('input[type="text"]');
    if (!acctField) throw new Error('Could not find TWC Tax Account Number field on home page');

    await acctField.click({ clickCount: 3 });
    await acctField.type(twcAccountNumber, { delay: 40 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('input[type="submit"][value="Select"], button[type="submit"]'),
    ]);
    console.log('[Payment] Employer selected — URL:', page.url());

    // ── Navigate to Online Payment ──────────────────────────────────────────
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: 'Opening payment form…' });
    await page.goto(TWC_PAYMENT_URL, { waitUntil: 'networkidle2' });

    // Verify we landed on the payment page
    if (!page.url().includes('onlinePayment') && !page.url().includes('payment')) {
      throw new Error(`Unexpected page after navigating to payment: ${page.url()}`);
    }

    // ── Fill payment form ───────────────────────────────────────────────────
    // Bank dropdown — select if "Choose One" or blank, otherwise leave as-is
    const bankSelect = await page.$('select[name="bankId"], select[name="bank"], select[name="bankAccount"]');
    if (bankSelect) {
      const currentVal = await page.evaluate(el => el.options[el.selectedIndex]?.text || '', bankSelect);
      console.log(`[Payment] Bank dropdown current: "${currentVal}"`);

      const needsSelection = /choose one|select/i.test(currentVal) || !currentVal.trim();
      if (needsSelection && bankName) {
        // Try to select by partial text match
        const selected = await page.evaluate((el, target) => {
          for (const opt of el.options) {
            if (opt.text.toLowerCase().includes(target.toLowerCase())) {
              el.value = opt.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return opt.text;
            }
          }
          // Fall back: pick first non-empty option
          for (const opt of el.options) {
            if (opt.value && !/choose|select/i.test(opt.text)) {
              el.value = opt.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return opt.text;
            }
          }
          return null;
        }, bankSelect, bankName || '');
        console.log(`[Payment] Selected bank: "${selected}"`);
      } else if (needsSelection) {
        // No bank name hint — pick first real option
        await page.evaluate(el => {
          for (const opt of el.options) {
            if (opt.value && !/choose|select/i.test(opt.text)) {
              el.value = opt.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        }, bankSelect);
      }
    }

    // Payment date — month select
    const monthSelect = await page.$('select[name="month"], select[name="paymentMonth"]');
    if (monthSelect) {
      await page.evaluate((el, val) => {
        // Find option where value == monthNum or text starts with month abbreviation
        const months = ['', 'January','February','March','April','May','June','July','August','September','October','November','December'];
        for (const opt of el.options) {
          if (opt.value == val || opt.text.startsWith(months[parseInt(val)]?.slice(0,3))) {
            el.value = opt.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }, monthSelect, monthNum.toString());
    }

    // Day select
    const daySelect = await page.$('select[name="day"], select[name="paymentDay"]');
    if (daySelect) {
      await page.evaluate((el, val) => {
        for (const opt of el.options) {
          if (opt.value == val || opt.text == val) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); break; }
        }
      }, daySelect, parseInt(dd, 10).toString());
    }

    // Year — could be select or input
    const yearSelect = await page.$('select[name="year"], select[name="paymentYear"]');
    if (yearSelect) {
      await page.evaluate((el, val) => {
        for (const opt of el.options) {
          if (opt.value == val) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); break; }
        }
      }, yearSelect, yyyy);
    } else {
      const yearInput = await page.$('input[name="year"], input[name="paymentYear"]');
      if (yearInput) { await yearInput.click({ clickCount: 3 }); await yearInput.type(yyyy); }
    }

    // Amount
    const amountInput = await page.$('input[name="amount"], input[name="paymentAmount"], input[name="scheduledPaymentAmount"]')
      || await page.$('input[type="text"][name*="mount"]');
    if (!amountInput) throw new Error('Could not find payment amount field');
    await amountInput.click({ clickCount: 3 });
    await amountInput.type(amount.toFixed(2), { delay: 40 });

    console.log(`[Payment] Form filled — date: ${mm}/${dd}/${yyyy}, amount: $${amount.toFixed(2)}`);
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: 'Submitting payment form…' });

    // Click Next
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('input[type="submit"][value="Next"], button[value="Next"], input[value="Next"]'),
    ]);
    console.log('[Payment] After Next — URL:', page.url());

    // ── Review and Submit page ──────────────────────────────────────────────
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: 'Reviewing and submitting…' });

    // Check the authorization checkbox (required field marked with *)
    const authCheckbox = await page.$('input[type="checkbox"][name*="certif"], input[type="checkbox"][name*="auth"], input[type="checkbox"][name*="agree"]')
      || await page.$('input[type="checkbox"]');
    if (authCheckbox) {
      const checked = await page.evaluate(el => el.checked, authCheckbox);
      if (!checked) await authCheckbox.click();
      console.log('[Payment] Authorization checkbox checked');
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('input[type="submit"][value="Submit"], button[value="Submit"], input[value="Submit"]'),
    ]);
    console.log('[Payment] After Submit — URL:', page.url());

    // ── Payment Confirmation page ───────────────────────────────────────────
    let bodyText = await page.evaluate(() => document.body.innerText);

    // Some TWC flows show an interstitial after Submit that needs one more
    // "Next" click before the confirmation page appears.
    if (!/scheduled|confirmation/i.test(bodyText)) {
      const nextBtn = await page.$('input[type="submit"][value="Next"], button[value="Next"], input[value="Next"]');
      if (nextBtn) {
        console.log('[Payment] Interstitial after Submit — clicking Next…');
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
          nextBtn.click(),
        ]);
        bodyText = await page.evaluate(() => document.body.innerText);
      }
    }
    console.log('[Payment] Confirmation page:\n' + bodyText.substring(0, 800));

    if (!/scheduled|confirmation/i.test(bodyText)) {
      throw new Error(`Payment may not have completed. Page text: ${bodyText.substring(0, 300)}`);
    }

    // Extract confirmation number
    const confMatch = bodyText.match(/Confirmation\s+Number[:\s]+(\d+)/i)
      || bodyText.match(/(\d{7,10})/);
    const confirmation = confMatch ? confMatch[1] : null;

    // Extract bank name
    const bankMatch = bodyText.match(/Bank\s+Name[:\s]+([A-Z][^\n]+)/i);
    const bankConfirmed = bankMatch ? bankMatch[1].trim() : null;

    // Extract scheduled date and amount from confirmation
    const dateLineMatch = bodyText.match(/Payment\s+Date[:\s]+([^\n]+)/i);
    const amtLineMatch  = bodyText.match(/Scheduled\s+Payment\s+Amount[:\s]+([^\n]+)/i);

    console.log(`[Payment] Confirmation: ${confirmation} | Bank: ${bankConfirmed}`);

    // Save updated cookies after successful payment
    saveSession(await page.cookies());

    await new Promise(r => setTimeout(r, 4_000)); // brief pause so user can see confirmation

    return {
      confirmationNumber: confirmation,
      bankNameConfirmed:  bankConfirmed,
      scheduledDate:      dateLineMatch ? dateLineMatch[1].trim() : null,
      scheduledAmount:    amtLineMatch  ? amtLineMatch[1].trim()  : null,
    };
  } finally {
    await browser.close();
  }
}

async function doLogin(page, jobId, paymentId) {
  console.log('[Payment] Navigating to TWC login…');
  await page.goto(TWC_LOGIN_URL, { waitUntil: 'networkidle2' });

  // Fill User ID
  const userField = await page.$('input[name="userid"]')
    || await page.$('input[name="UserID"]')
    || await page.$('input[name="username"]')
    || await page.$('input[type="text"]:not([type="hidden"])');
  if (!userField) throw new Error('Could not find User ID field on TWC login page');

  await userField.click({ clickCount: 3 });
  await userField.type(TWC_USERNAME, { delay: 40 });

  const passField = await page.$('input[type="password"]');
  if (!passField) throw new Error('Could not find Password field on TWC login page');
  await passField.click({ clickCount: 3 });
  await passField.type(TWC_PASSWORD, { delay: 40 });

  // reCAPTCHA: we cannot solve it automatically — notify server and wait for user
  console.log('[Payment] Credentials filled — waiting for user to solve CAPTCHA and click Logon…');
  send({ type: 'status_update', jobId, paymentId, status: 'needs_captcha', message: 'Please solve the CAPTCHA and click Logon in the browser window on Computer 2.' });

  // Wait up to 5 minutes for the user to complete login (URL changes away from logon.do)
  await page.waitForFunction(
    () => !window.location.href.includes('logon.do'),
    { timeout: 5 * 60_000 }
  );
  console.log('[Payment] Login completed — URL:', page.url());
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('=== TWC QuickFile Bridge ===');
console.log(`Server: ${SERVER_URL}`);
console.log(`QuickFile: ${QUICKFILE_EXE}`);
console.log(`AHK: ${AHK_EXE}`);
console.log(`Temp: ${TEMP_DIR}`);
connect();
