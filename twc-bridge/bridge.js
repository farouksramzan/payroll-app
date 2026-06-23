'use strict';

require('dotenv').config();
const WebSocket = require('ws');
const fs        = require('fs');
const path      = require('path');
const { execFile, spawn } = require('child_process');

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

  // Run AutoHotkey script to automate QuickFile
  let confirmation = null;
  try {
    confirmation = await runQuickFile(filePath, jobId, submissionId);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(filePath); } catch (_) {}
    throw err;
  }

  // Clean up temp file
  try { fs.unlinkSync(filePath); } catch (_) {}

  console.log(`[TWC Bridge] Job ${jobId} complete — confirmation: ${confirmation || 'none'}`);
  send({
    type:         'result',
    jobId,
    submissionId,
    success:      true,
    confirmation: confirmation || null,
  });
}

// ── QuickFile automation via AutoHotkey ───────────────────────────────────────
function runQuickFile(icesaFilePath, jobId, submissionId) {
  return new Promise((resolve, reject) => {
    // Result file: AHK script writes confirmation number here when done
    const resultFile = path.join(TEMP_DIR, `result_${jobId}.txt`);

    console.log(`[TWC Bridge] Running AHK: ${AHK_SCRIPT}`);
    console.log(`[TWC Bridge]   ICESA file: ${icesaFilePath}`);
    console.log(`[TWC Bridge]   Result file: ${resultFile}`);

    // Pass file paths as command-line arguments to the AHK script
    const proc = spawn(AHK_EXE, [AHK_SCRIPT, icesaFilePath, resultFile, QUICKFILE_EXE, TWC_USERNAME, TWC_PASSWORD], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', d => { stdout += d.toString(); });
    proc.stderr?.on('data', d => { stderr += d.toString(); });

    // Status updates while AHK is running
    const statusInterval = setInterval(() => {
      send({ type: 'status_update', jobId, submissionId, status: 'processing', message: 'QuickFile automation in progress…' });
    }, 5_000);

    const timeout = setTimeout(() => {
      proc.kill();
      clearInterval(statusInterval);
      reject(new Error('QuickFile automation timed out after 5 minutes'));
    }, 5 * 60_000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      clearInterval(statusInterval);

      if (stdout) console.log('[AHK stdout]', stdout.trim());
      if (stderr) console.error('[AHK stderr]', stderr.trim());

      if (code !== 0) {
        reject(new Error(`AutoHotkey exited with code ${code}${stderr ? ': ' + stderr.trim() : ''}`));
        return;
      }

      // Read confirmation number from result file (AHK writes it there)
      let confirmation = null;
      if (fs.existsSync(resultFile)) {
        try {
          confirmation = fs.readFileSync(resultFile, 'utf8').trim() || null;
          fs.unlinkSync(resultFile);
        } catch (_) {}
      }

      resolve(confirmation);
    });
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('=== TWC QuickFile Bridge ===');
console.log(`Server: ${SERVER_URL}`);
console.log(`QuickFile: ${QUICKFILE_EXE}`);
console.log(`AHK: ${AHK_EXE}`);
console.log(`Temp: ${TEMP_DIR}`);
connect();
