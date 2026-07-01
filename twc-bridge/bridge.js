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
const TEMP_DIR      = process.env.TEMP_DIR       || path.join(__dirname, 'temp');
const RECONNECT_MS  = 10_000;   // reconnect delay after disconnect
const PING_MS       = 20_000;   // client-side ping interval

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
      if (!authed) { console.warn('[TWC Bridge] Received job before auth — ignoring'); return; }
      handleJob(msg).catch(err => {
        console.error('[TWC Bridge] Unhandled job error:', err.message);
        send({
          type:         'result',
          jobId:        msg.jobId,
          submissionId: msg.submissionId,
          success:      false,
          error:        err.message,
        });
      });
      break;

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

  // Notify server we've picked it up
  send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'Bridge received job — saving ICESA file' });

  // Save ICESA content to temp file
  const filePath = path.join(TEMP_DIR, filename || `TWC_Q${quarter}_${year}.txt`);
  try {
    fs.writeFileSync(filePath, icesaContent, { encoding: 'utf8' });
    console.log(`[TWC Bridge] ICESA file saved: ${filePath}`);
  } catch (err) {
    throw new Error(`Failed to save ICESA file: ${err.message}`);
  }

  send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'Launching QuickFile…' });

  // Step 1: AHK handles the QuickFile desktop app
  // Returns { twcUrl, qfhFile }
  let ahkResult;
  try {
    ahkResult = await runQuickFileApp(filePath, jobId, submissionId);
  } catch (err) {
    // Do NOT delete the ICESA file on failure — leave it so it can be inspected or submitted manually
    console.log(`[TWC Bridge] AHK failed — ICESA file left at: ${filePath}`);
    throw err;
  }
  try { fs.unlinkSync(filePath); } catch (_) {}

  const { qfhFile } = ahkResult;
  console.log(`[TWC Bridge] AHK done — qfhFile: ${qfhFile}`);

  // Construct the TWC upload URL from known parameters
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
  console.log(`[TWC Bridge] Upload URL: ${twcUrl}`);

  // Step 2: Puppeteer handles the TWC website (login + file upload)
  send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'Logging in to TWC website…' });

  let confirmation = null;
  try {
    confirmation = await runTwcWebSubmission(twcUrl, qfhFile, jobId, submissionId);
  } catch (err) {
    throw new Error(`TWC web submission failed: ${err.message}`);
  }

  console.log(`[TWC Bridge] Job ${jobId} complete — confirmation: ${confirmation || 'none'}`);
  send({
    type:         'result',
    jobId,
    submissionId,
    success:      true,
    confirmation: confirmation || null,
  });
}

// ── Step 1: AutoHotkey — QuickFile desktop app ────────────────────────────────
// Runs the AHK script which clicks through all QuickFile dialogs,
// then captures the TWC URL and .qfh file path before Edge opens.
// Returns { twcUrl, qfhFile }
function runQuickFileApp(icesaFilePath, jobId, submissionId) {
  return new Promise((resolve, reject) => {
    const resultFile = path.join(TEMP_DIR, `ahk_result_${jobId}.txt`);

    console.log(`[TWC Bridge] Running AHK: ${AHK_SCRIPT}`);
    const proc = spawn(AHK_EXE, [AHK_SCRIPT, icesaFilePath, resultFile, QUICKFILE_EXE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
async function runTwcWebSubmission(twcUrl, qfhFile, jobId, submissionId) {
  const browser = await puppeteer.launch({
    headless: false,   // set to true once confirmed working
    defaultViewport: null,
  });

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
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('[Puppeteer] Page after submit (first 300 chars):', bodyText.substring(0, 300));

    // Extract a meaningful confirmation line
    const confirmLine = bodyText.split('\n').find(l => l.match(/confirm|success|receipt|submit/i)) || bodyText.substring(0, 200);
    return confirmLine.trim();

  } finally {
    await browser.close();
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('=== TWC QuickFile Bridge ===');
console.log(`Server: ${SERVER_URL}`);
console.log(`QuickFile: ${QUICKFILE_EXE}`);
console.log(`AHK: ${AHK_EXE}`);
console.log(`Temp: ${TEMP_DIR}`);
connect();
