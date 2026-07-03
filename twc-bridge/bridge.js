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
// Keep-alive: ping an authenticated TWC page on this interval so the server-side
// session never idles out. Must be shorter than TWC's idle timeout (~15-20 min).
const KEEPALIVE_MS    = 8 * 60_000;
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
      // Establish + keep the TWC session warm so we rarely hit the login CAPTCHA.
      bootstrapSession();
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
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: 'Using kept-warm TWC session…' });

    const { confirmationNumber, bankNameConfirmed, scheduledDate, scheduledAmount } =
      await runTwcPayment({ jobId, paymentId, twcAccountNumber, amount, paymentDate, bankName }, (b) => { puppBrowser = b; });

    send({
      type: 'result', jobId, paymentId, success: true,
      confirmationNumber, bankName: bankNameConfirmed, scheduledDate, scheduledAmount,
    });

  } finally {
    // Do NOT close the browser here — it's the persistent session we keep warm.
    // (The kill handler above still closes it to abort a stuck job.)
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

// ── Persistent TWC session ("stay logged in") ─────────────────────────────────
// The reCAPTCHA lives ONLY on the login page. If we log in once and keep the
// session alive, the bridge stops returning to the login page, so the checkbox
// is never triggered on subsequent payments. A keep-alive timer pings an
// authenticated page within TWC's idle window so the session never times out.
// The single interactive CAPTCHA solve happens once at startup (or on the rare
// occasion the session is truly lost), and can be done remotely.
let sessionBrowser   = null;   // long-lived Puppeteer browser
let sessionPage      = null;   // its logged-in page
let keepAliveTimer   = null;
let sessionLoggingIn = false;  // guard so keep-alive skips while a login is underway
let sessionBootstrapped = false;
let sessionOpChain   = Promise.resolve(); // serializes all session page access

// Run fn with exclusive access to the session page. This prevents any two flows
// (bootstrap login, a payment, the keep-alive ping) from navigating the page at
// the same time — critical while a human is mid-CAPTCHA, so their solve isn't
// wiped by a concurrent navigation.
function runExclusive(fn) {
  const next = sessionOpChain.then(fn, fn);
  sessionOpChain = next.then(() => {}, () => {});
  return next;
}

// Logged in = on a UITAXSERV page that is NOT the login page. Matched precisely
// and case-insensitively so "postLogon.do" (the post-login home) isn't mistaken
// for the "/security/logon.do" login page.
function isLoggedIn(page) {
  const url = page.url();
  return /UITAXSERV/i.test(url) && !/\/security\/logon\.do/i.test(url);
}

// Lazily launch (or reuse) the persistent, visible browser. Visible so a human
// can solve the CAPTCHA on the rare occasion a fresh login is needed.
async function getSessionPage() {
  if (sessionBrowser && sessionPage && !sessionPage.isClosed()) return sessionPage;
  sessionBrowser = await puppeteer.launch({ headless: false, defaultViewport: null });
  sessionBrowser.on('disconnected', () => { sessionBrowser = null; sessionPage = null; });
  sessionPage = await sessionBrowser.newPage();
  sessionPage.setDefaultTimeout(60_000);
  // Auto-accept JS confirm/alert dialogs ("Are you sure you want to proceed?")
  sessionPage.on('dialog', async dialog => {
    console.log(`[Session] Dialog: "${dialog.message()}" — accepting`);
    try { await dialog.accept(); } catch (_) {}
  });
  const savedCookies = loadSession();
  if (savedCookies) { try { await sessionPage.setCookie(...savedCookies); } catch (_) {} }
  return sessionPage;
}

// Return a logged-in page. allowLogin=false (keep-alive) only refreshes an
// existing session and returns null if it dropped; allowLogin=true (a payment,
// or startup) performs the one interactive CAPTCHA login if needed.
async function ensureLoggedIn({ allowLogin, jobId = 'session', paymentId = null }) {
  // Serialize: no other flow may touch the page until this one finishes. A login
  // holds the lock for its full duration (including the human CAPTCHA solve), so
  // the keep-alive ping and any payment queue behind it instead of navigating
  // the page away mid-solve.
  return runExclusive(async () => {
    const page = await getSessionPage();
    await page.goto(TWC_HOME_URL, { waitUntil: 'networkidle2' });
    if (isLoggedIn(page)) {
      console.log('[Session] Already logged in — session valid.');
      saveSession(await page.cookies());
      return page;
    }
    if (!allowLogin) return null;               // session dropped; caller decides
    sessionLoggingIn = true;
    try {
      await doLogin(page, jobId, paymentId);
      saveSession(await page.cookies());
    } finally {
      sessionLoggingIn = false;
    }
    return page;
  });
}

function startSessionKeepAlive() {
  if (keepAliveTimer) return;                   // idempotent across reconnects
  keepAliveTimer = setInterval(async () => {
    if (activeJob || sessionLoggingIn) return;  // don't disturb an in-flight job/login
    try {
      const page = await ensureLoggedIn({ allowLogin: false });
      if (page) {
        console.log('[Session] Keep-alive OK — session warm');
      } else {
        // Session expired. Proactively re-establish so the rare CAPTCHA solve can
        // be done now/remotely instead of blocking the next payment.
        console.log('[Session] Keep-alive found session expired — re-establishing…');
        send({ type: 'session_status', status: 'expired', message: 'TWC session expired — solve the CAPTCHA on Computer 2 to restore auto-pay.' });
        await ensureLoggedIn({ allowLogin: true }).catch(e => console.warn('[Session] Re-login skipped:', e.message));
      }
    } catch (e) {
      console.warn('[Session] Keep-alive error (ignored):', e.message);
    }
  }, KEEPALIVE_MS);
  console.log(`[Session] Keep-alive started (every ${Math.round(KEEPALIVE_MS / 60000)} min)`);
}

// Establish the session once at startup so the single CAPTCHA solve happens up
// front, then keep it warm indefinitely. Safe to call on every (re)connect.
async function bootstrapSession() {
  startSessionKeepAlive();                       // idempotent
  if (sessionBootstrapped || sessionLoggingIn) return;
  sessionBootstrapped = true;
  try {
    send({ type: 'session_status', status: 'connecting', message: 'Establishing TWC session…' });
    await ensureLoggedIn({ allowLogin: true });
    send({ type: 'session_status', status: 'ready', message: 'TWC session established and kept warm.' });
    console.log('[Session] Established — keep-alive will maintain it.');
  } catch (e) {
    sessionBootstrapped = false;                 // allow retry on next connect / keep-alive
    console.warn('[Session] Bootstrap login skipped:', e.message);
  }
}

// Diagnostic: capture the real page so we can build correct selectors. Logs a
// full inventory of form controls + links, and saves a screenshot and HTML to
// TEMP_DIR. Everything is best-effort and never throws.
async function dumpPage(page, label) {
  const stamp = Date.now();
  try {
    console.log(`[Dump:${label}] URL: ${page.url()}`);
    const controls = await page.evaluate(() => {
      const visible = el => !!(el.offsetParent !== null || el.getClientRects().length);
      const out = [];
      document.querySelectorAll('input, select, textarea, button, a[href]').forEach(el => {
        const d = { tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '', id: el.id || '', vis: visible(el) };
        if (el.tagName === 'SELECT') d.options = [...el.options].map(o => (o.text || '').trim()).slice(0, 40);
        else if (el.tagName === 'BUTTON' || el.tagName === 'A') d.text = (el.innerText || el.value || '').trim().slice(0, 60);
        else d.value = (el.value || '').slice(0, 40);
        out.push(d);
      });
      return out;
    });
    controls.forEach(c => {
      const extra = c.options ? `opts=${JSON.stringify(c.options)}`
        : c.text !== undefined ? `text="${c.text}"`
        : `val="${c.value || ''}"`;
      console.log(`[Dump:${label}]  ${c.tag}${c.type ? `[${c.type}]` : ''} name="${c.name}" id="${c.id}" vis=${c.vis} ${extra}`);
    });
    await page.screenshot({ path: path.join(TEMP_DIR, `twc-${label}-${stamp}.png`), fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    if (html) { try { fs.writeFileSync(path.join(TEMP_DIR, `twc-${label}-${stamp}.html`), html); } catch (_) {} }
    console.log(`[Dump:${label}] Saved screenshot + HTML to ${TEMP_DIR}\\twc-${label}-${stamp}.{png,html}`);
  } catch (e) {
    console.warn(`[Dump:${label}] failed: ${e.message}`);
  }
}

async function runTwcPayment({ jobId, paymentId, twcAccountNumber, amount, paymentDate, bankName }, onBrowser) {
  const dateMatch = paymentDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) throw new Error(`Invalid paymentDate format: ${paymentDate}`);
  const [, yyyy, mm, dd] = dateMatch;
  const monthNum = parseInt(mm, 10);

  // Reuse the persistent, kept-warm session so we don't return to the login page
  // (and its reCAPTCHA). Logs in only if the session has genuinely dropped.
  const page = await ensureLoggedIn({ allowLogin: true, jobId, paymentId });
  onBrowser?.(sessionBrowser);

  try {
    // ── Select employer ─────────────────────────────────────────────────────
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: `Selecting employer ${twcAccountNumber}…` });

    // Make sure we're on the home page
    if (!page.url().includes('postLogon') && !page.url().includes('UITAXSERV')) {
      await page.goto(TWC_HOME_URL, { waitUntil: 'networkidle2' });
    }

    // Fill the "TWC Tax Account Number" field and click Select. Real field name
    // from DOM: input[name="twcTaxAccountNumber"]; button: input[name="method:select"].
    const acctField = await page.$('input[name="twcTaxAccountNumber"]')
      || await page.$('input[name="taxAcctNum"]')
      || await page.$('input[type="text"]');
    if (!acctField) throw new Error('Could not find TWC Tax Account Number field on home page');

    await acctField.click({ clickCount: 3 });
    await acctField.type(twcAccountNumber, { delay: 40 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('input[name="method:select"], input[type="submit"][value="Select"]'),
    ]);
    console.log('[Payment] Employer selected — URL:', page.url());
    // Capture the post-select page so we can see the real "Payments" menu links.
    await dumpPage(page, 'after-employer-select');

    // ── Navigate to Online Payment ──────────────────────────────────────────
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: 'Opening payment form…' });
    await page.goto(TWC_PAYMENT_URL, { waitUntil: 'networkidle2' });

    // Capture whatever the payment URL actually lands on (form, or a menu page).
    await dumpPage(page, 'payment-page');

    // Verify we landed on the payment page
    if (!page.url().includes('onlinePayment') && !page.url().includes('payment')) {
      throw new Error(`Unexpected page after navigating to payment: ${page.url()}`);
    }

    // ── Fill payment form (real TWC field names from DOM inspection) ──────────
    // Bank: select[name="bankSequenceId"]. Options are "Choose One" plus the
    // enrolled bank account(s). Pick the requested bank, else the only real one.
    const bankSelect = await page.$('select[name="bankSequenceId"]');
    if (!bankSelect) throw new Error('Could not find the bank dropdown (select[name="bankSequenceId"])');
    const bankPicked = await page.evaluate((el, target) => {
      const isPlaceholder = t => /choose one/i.test(t) || !t.trim();
      const opts = [...el.options];
      let choice = null;
      if (target) choice = opts.find(o => !isPlaceholder(o.text) && o.text.toLowerCase().includes(String(target).toLowerCase()));
      if (!choice) choice = opts.find(o => o.value && !isPlaceholder(o.text));
      if (!choice) return null;
      el.value = choice.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return choice.text;
    }, bankSelect, bankName || '');
    if (!bankPicked) throw new Error('No selectable bank account in the TWC bank dropdown');
    console.log(`[Payment] Bank selected: "${bankPicked}"`);

    // Date: month & year are HIDDEN inputs pre-set by TWC to the open payment
    // window; only the DAY is user-selectable (select[name="paymentDay"]).
    const twcWindow = await page.evaluate(() => ({
      month: document.querySelector('input[name="paymentMonth"]')?.value || '',
      year:  document.querySelector('input[name="paymentYear"]')?.value  || '',
    }));
    console.log(`[Payment] TWC payment window: ${twcWindow.month}/${twcWindow.year} (requested ${mm}/${yyyy})`);
    if (twcWindow.month && twcWindow.month !== mm) {
      throw new Error(`TWC's open payment window is month ${twcWindow.month}, but ${mm} was requested. Choose a date within the open window.`);
    }
    if (twcWindow.year && twcWindow.year !== yyyy) {
      throw new Error(`TWC's open payment window is year ${twcWindow.year}, but ${yyyy} was requested.`);
    }

    const daySelect = await page.$('select[name="paymentDay"]');
    if (!daySelect) throw new Error('Could not find the payment day dropdown (select[name="paymentDay"])');
    const daySet = await page.evaluate((el, padded, num) => {
      const opt = [...el.options].find(o => o.value === padded || o.value === num || o.text.trim() === padded || o.text.trim() === num);
      if (!opt) return null;
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return opt.text.trim();
    }, daySelect, dd, String(parseInt(dd, 10)));
    if (!daySet) throw new Error(`Requested day ${dd} is not selectable — TWC's payment window may not include it (earliest is usually the next business day).`);
    console.log(`[Payment] Day selected: ${daySet}`);

    // Amount: input[name="paymentAmount"] (visible text field, PRE-FILLED "0.00").
    // Must clear the existing value first, or typing appends → "0.001.00".
    const amountInput = await page.$('input[name="paymentAmount"]');
    if (!amountInput) throw new Error('Could not find the payment amount field (input[name="paymentAmount"])');
    const wantAmount = amount.toFixed(2);

    async function setAmount() {
      await amountInput.click({ clickCount: 3 });
      // Hard-clear regardless of whether select-all took, then type fresh.
      await amountInput.evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await amountInput.focus();
      await amountInput.type(wantAmount, { delay: 40 });
      return page.evaluate(el => el.value, amountInput);
    }

    let amountEntered = await setAmount();
    if (amountEntered !== wantAmount) {
      console.warn(`[Payment] Amount field read "${amountEntered}" — retrying with select-all…`);
      await amountInput.evaluate(el => el.select());
      await amountInput.type(wantAmount, { delay: 40 });
      amountEntered = await page.evaluate(el => el.value, amountInput);
    }
    console.log(`[Payment] Amount entered: "${amountEntered}" (requested ${wantAmount})`);
    // Never submit a wrong amount — bail clearly if the field didn't take exactly.
    if (amountEntered !== wantAmount) {
      await dumpPage(page, 'amount-mismatch');
      throw new Error(`Payment amount field shows "${amountEntered}" but ${wantAmount} was requested — aborting before submit.`);
    }

    console.log(`[Payment] Form filled — date: ${mm}/${dd}/${yyyy}, amount: $${amount.toFixed(2)}`);
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: 'Submitting payment form…' });

    // Click Next: input[name="method:submit"][value="Next"].
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('input[name="method:submit"]'),
    ]);
    console.log('[Payment] After Next — URL:', page.url());
    // Capture the review/confirm page so we can wire its exact controls.
    await dumpPage(page, 'after-next');

    // ── Review and Submit page ──────────────────────────────────────────────
    send({ type: 'status_update', jobId, paymentId, status: 'processing', message: 'Reviewing and submitting…' });

    // Certification checkbox — required ("I certify that I am authorized to submit
    // an ACH payment…"). Check it with a real click, verify, and fall back to the
    // label click then a programmatic check. Never submit uncertified.
    const authCheckbox = await page.$('input[type="checkbox"]');
    if (authCheckbox) {
      let isChecked = await page.evaluate(el => el.checked, authCheckbox);
      if (!isChecked) { try { await authCheckbox.click(); } catch (_) {} isChecked = await page.evaluate(el => el.checked, authCheckbox); }
      if (!isChecked) {
        await page.evaluate(el => {
          const lbl = el.id && document.querySelector(`label[for="${el.id}"]`);
          if (lbl) lbl.click();
          if (!el.checked) {
            el.checked = true;
            el.dispatchEvent(new Event('click',  { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, authCheckbox);
        isChecked = await page.evaluate(el => el.checked, authCheckbox);
      }
      console.log(`[Payment] Certification checkbox checked: ${isChecked}`);
      if (!isChecked) {
        await dumpPage(page, 'checkbox-fail');
        throw new Error('Could not check the ACH certification checkbox — aborting before submit.');
      }
    }

    // Confirm/Submit. TWC uses input[name="method:submit"] consistently for the
    // forward action; fall back to explicit Submit/Confirm/Yes values. If none is
    // found we capture the page and stop rather than clicking blindly.
    const submitBtn = await page.$('input[name="method:submit"]')
      || await page.$('input[type="submit"][value="Submit"], input[type="submit"][value="Confirm"], input[type="submit"][value="Yes"]');
    if (!submitBtn) {
      await dumpPage(page, 'review-no-submit');
      throw new Error('Could not find the Submit/Confirm button on the review page (captured review-no-submit dump).');
    }
    const submitVal = await page.evaluate(el => el.value || el.innerText || '', submitBtn);
    console.log(`[Payment] Clicking confirm button: "${submitVal}"`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      submitBtn.click(),
    ]);
    console.log('[Payment] After Submit — URL:', page.url());
    await dumpPage(page, 'after-submit');

    // ── Payment Confirmation page ───────────────────────────────────────────
    // Success signals — precise, so the "Scheduled Payments" NAV MENU link (present
    // on every page) can't false-positive. Look for a real confirmation number or
    // explicit success phrasing.
    const isConfirmed = (txt) => {
      const num = (txt.match(/Confirmation\s*(?:Number|No\.?|#)\s*[:#]?\s*([0-9]{4,})/i) || [])[1] || null;
      const scheduled = /\b(?:has been|was|is|successfully)\s+(?:scheduled|submitted|accepted|processed)\b/i.test(txt)
        || /\bpayment\s+(?:confirmation|scheduled|submitted|accepted)\b/i.test(txt);
      return { num, ok: !!num || scheduled };
    };

    let bodyText = await page.evaluate(() => document.body.innerText);
    let verdict  = isConfirmed(bodyText);

    // Some TWC flows show an interstitial after Submit that needs one more
    // "Next" click before the confirmation page appears.
    if (!verdict.ok) {
      const nextBtn = await page.$('input[name="method:submit"][value="Next"], input[type="submit"][value="Next"], input[value="Next"]');
      if (nextBtn) {
        console.log('[Payment] Interstitial after Submit — clicking Next…');
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
          nextBtn.click(),
        ]);
        await dumpPage(page, 'after-interstitial');
        bodyText = await page.evaluate(() => document.body.innerText);
        verdict  = isConfirmed(bodyText);
      }
    }
    console.log('[Payment] Post-submit page text:\n' + bodyText.substring(0, 800));

    if (!verdict.ok) {
      // Not a confirmation page — the submit was likely rejected (e.g. required
      // field). Capture it and report the on-page message instead of a false OK.
      await dumpPage(page, 'no-confirmation');
      const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 400);
      throw new Error(`Payment did not reach a confirmation page — likely rejected on the review page. Page said: ${snippet}`);
    }

    const confirmation = verdict.num;

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
  } catch (err) {
    // Capture the exact page state at the point of failure so we can build
    // correct selectors from real data instead of guesses.
    console.error('[Payment] Failed:', err.message);
    await dumpPage(page, 'payment-error');
    throw err;
  } finally {
    // Keep the session warm for the next payment — do NOT close the browser.
    // Return to the home screen so the page is clean for the next job / keep-alive.
    try { await page.goto(TWC_HOME_URL, { waitUntil: 'networkidle2' }); } catch (_) {}
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

  // Confirm the fields actually received the values (helps diagnose "clicked
  // Logon, nothing happened" — an empty form silently fails to submit).
  const filledUserLen = await page.evaluate(el => (el.value || '').length, userField);
  const filledPassLen = await page.evaluate(el => (el.value || '').length, passField);
  console.log(`[Session] Credentials filled — user chars: ${filledUserLen}, pass chars: ${filledPassLen}. Login URL: ${page.url()}`);
  if (filledUserLen === 0 || filledPassLen === 0) {
    console.warn('[Session] WARNING: a credential field is empty — check TWC_USERNAME/TWC_PASSWORD in .env and the login field selectors.');
  }

  // reCAPTCHA: we cannot solve it automatically — notify server and wait for user.
  // The human solves the checkbox AND clicks Logon; we only wait for the result.
  console.log('[Session] Waiting for human to solve CAPTCHA and click Logon (up to 5 min)…');
  send({ type: 'status_update', jobId, paymentId, status: 'needs_captcha', message: 'Solve the CAPTCHA and click Logon in the browser window on Computer 2.' });

  // Consider login done when we leave the /security/logon.do page (precise,
  // case-insensitive). waitForNavigation is more reliable than polling location.
  try {
    await page.waitForFunction(
      () => !/\/security\/logon\.do/i.test(window.location.href),
      { polling: 500, timeout: 5 * 60_000 }
    );
  } catch (e) {
    console.warn(`[Session] Still on the login page after 5 min — URL: ${page.url()}. Login was not completed.`);
    throw new Error('Login not completed: still on the TWC login page after 5 minutes. Solve the CAPTCHA and click Logon within the time window.');
  }
  // Give the post-login page a moment to settle.
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 15_000 }).catch(() => {});
  console.log('[Session] Login completed — landed on:', page.url());
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('=== TWC QuickFile Bridge ===');
console.log(`Server: ${SERVER_URL}`);
console.log(`QuickFile: ${QUICKFILE_EXE}`);
console.log(`AHK: ${AHK_EXE}`);
console.log(`Temp: ${TEMP_DIR}`);
connect();
