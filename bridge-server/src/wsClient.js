/**
 * WebSocket client — connects to the Railway app and processes submission jobs.
 *
 * Protocol:
 *   Bridge → Railway  { type:'auth', secret }                   on connect
 *   Railway → Bridge  { type:'auth_ok' }                        success
 *   Railway → Bridge  { type:'auth_fail', message }             bad secret → close
 *   Railway → Bridge  { type:'submit', jobId, submissionId, …}  payment job
 *   Bridge → Railway  { type:'result', jobId, submissionId, success, confirmation, … }
 *   Bridge → Railway  { type:'ping' }                           heartbeat every 30s
 *   Railway → Bridge  { type:'pong' }
 */

'use strict';

const WebSocket = require('ws');
const EventEmitter = require('events');
const { execFile }                   = require('child_process');
const fs                             = require('fs');
const path                           = require('path');
const { generateBatchProviderFile }  = require('./achGenerator');
const { generateEnrollmentFile, generatePin } = require('./enrollmentGenerator');
const { saveACHFile, WATCHED_FOLDER } = require('./batchProvider');

const BP_SCRIPT               = path.join(__dirname, '..', 'bp_automation.py');
const BP_ENROLL_SCRIPT        = path.join(__dirname, '..', 'bp_enrollment.py');
const BP_ENROLL_CHECK_SCRIPT  = path.join(__dirname, '..', 'bp_enrollment_check.py');
const ENROLLED_JSON           = path.join(__dirname, '..', 'enrolled_clients.json');
const ENROLL_FOLDER           = path.join(__dirname, '..', 'data', 'enrollments-out');
const PENDING_FILE            = path.join(__dirname, '..', 'data', 'pending_enrollments.json');

// ── Pending enrollment persistence ───────────────────────────────────────────
// Survives Ctrl+C, crashes, and reboots. Bridge resumes all pending enrollment
// check loops automatically on reconnect.

function loadPendingEnrollments() {
  try { return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); } catch { return []; }
}

function upsertPendingEnrollment(entry) {
  const list = loadPendingEnrollments().filter(e => cleanEin(e.ein) !== cleanEin(entry.ein));
  list.push({ ...entry, updatedAt: new Date().toISOString() });
  fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true });
  fs.writeFileSync(PENDING_FILE, JSON.stringify(list, null, 2));
}

function removePendingEnrollment(ein) {
  const list = loadPendingEnrollments().filter(e => cleanEin(e.ein) !== cleanEin(ein));
  fs.writeFileSync(PENDING_FILE, JSON.stringify(list, null, 2));
}

// ── Computer 2 lock ───────────────────────────────────────────────────────────
// Only one Python automation script can run on Computer 2 at a time.
// Jobs acquire this lock only while their script is executing — NOT during
// the 15-minute enrollment polling waits — so payment jobs for already-enrolled
// clients can run freely while new enrollments are waiting between checks.
class Computer2Lock {
  constructor() { this._chain = Promise.resolve(); }
  run(label, fn) {
    const next = this._chain.then(() => fn());
    this._chain = next.catch(() => {});
    return next;
  }
}
const c2 = new Computer2Lock();

// ── Enrollment tracking ───────────────────────────────────────────────────────

function cleanEin(ein) {
  return String(ein || '').replace(/\D/g, '');
}

function isEnrolled(ein) {
  try {
    const list = JSON.parse(fs.readFileSync(ENROLLED_JSON, 'utf8'));
    return list.includes(cleanEin(ein));
  } catch {
    return false;
  }
}

function markEnrolled(ein) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(ENROLLED_JSON, 'utf8')); } catch {}
  const normalized = cleanEin(ein);
  if (!list.includes(normalized)) {
    list.push(normalized);
    fs.writeFileSync(ENROLLED_JSON, JSON.stringify(list, null, 2));
  }
}

function saveEnrollmentFile(enrollContent, ein) {
  fs.mkdirSync(ENROLL_FOLDER, { recursive: true });
  const filename = `ENROLL_${cleanEin(ein)}_${Date.now()}.ach`;
  const filepath = path.join(ENROLL_FOLDER, filename);
  fs.writeFileSync(filepath, enrollContent, { encoding: 'ascii' });
  return filepath;
}

// ── Python automation runners ─────────────────────────────────────────────────

function runPython(script, args, logFn, { timeout = 180000, successToken, failToken } = {}) {
  return new Promise((resolve, reject) => {
    execFile('python', [script, ...args], { windowsHide: true, timeout },
      (err, stdout, stderr) => {
        if (stdout) stdout.split('\n').filter(Boolean).forEach((l) => logFn(l));
        if (stderr) stderr.split('\n').filter(Boolean).forEach((l) => logFn(`[stderr] ${l}`));
        if (err) return reject(new Error(`${path.basename(script)} error: ${err.message}`));
        if (stdout.includes(successToken)) return resolve(stdout);
        const reason = stdout.match(new RegExp(failToken + ':\\s*(.+)'))?.[1] || 'Unknown — check bridge logs';
        reject(new Error(reason));
      }
    );
  });
}

function runPaymentAutomation(achFilePath, logFn) {
  logFn(`[BP] Launching payment automation for: ${achFilePath}`);
  return runPython(BP_SCRIPT, [achFilePath], logFn, {
    successToken: 'IMPORT_COMPLETE',
    failToken:    'IMPORT_FAILED',
  }).then(() => ({ success: true, confirmation: 'BP_AUTOMATION_OK', achFilePath }));
}

function runEnrollmentAutomation(enrollFilePath, logFn) {
  logFn(`[ENROLL] Launching enrollment automation for: ${enrollFilePath}`);
  return runPython(BP_ENROLL_SCRIPT, [enrollFilePath], logFn, {
    timeout:      120000,
    successToken: 'ENROLLMENT_COMPLETE',
    failToken:    'ENROLLMENT_FAILED',
  });
}

// Returns true if EFTPS confirms the EIN is Active, false otherwise (never rejects).
function checkEnrollmentActive(ein, logFn) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile('python', [BP_ENROLL_CHECK_SCRIPT, cleanEin(ein)], { windowsHide: true, timeout: 120000 },
      (err, stdout, stderr) => {
        if (stdout) stdout.split('\n').filter(Boolean).forEach(l => logFn(l));
        if (stderr) stderr.split('\n').filter(Boolean).forEach(l => logFn(`[stderr] ${l}`));
        if (err) logFn(`[ENROLL CHECK] Script error: ${err.message}`);
        resolve(!!(stdout && stdout.includes('ENROLLMENT_ACTIVE')));
      }
    );
  });
}

const RAILWAY_URL      = process.env.RAILWAY_WS_URL || '';
const SECRET           = process.env.WEBSOCKET_SECRET || '';
const RECONNECT_DELAY  = parseInt(process.env.WS_RECONNECT_MS || '10000');  // 10s
const PING_INTERVAL    = 30000;  // 30s heartbeat

class BridgeClient extends EventEmitter {
  constructor() {
    super();
    this.ws            = null;
    this.authenticated = false;
    this.reconnectTimer = null;
    this.pingTimer      = null;
    this.intentionalClose = false;
    this.stats = {
      connectedAt:     null,
      disconnectedAt:  null,
      reconnectCount:  0,
      jobsReceived:    0,
      jobsSucceeded:   0,
      jobsFailed:      0,
    };
  }

  start() {
    if (!RAILWAY_URL) {
      this.emit('error', new Error('RAILWAY_WS_URL is not set in .env'));
      return;
    }
    this._connect();
  }

  stop() {
    this.intentionalClose = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    if (this.ws) this.ws.close(1000, 'Bridge shutting down');
  }

  get status() {
    if (!this.ws) return 'disconnected';
    if (this.ws.readyState === WebSocket.CONNECTING) return 'connecting';
    if (this.ws.readyState === WebSocket.OPEN && this.authenticated) return 'connected';
    if (this.ws.readyState === WebSocket.OPEN) return 'authenticating';
    return 'disconnected';
  }

  _connect() {
    if (this.intentionalClose) return;
    this.emit('log', `Connecting to ${RAILWAY_URL} …`);

    const ws = new WebSocket(RAILWAY_URL, {
      headers: { 'X-Bridge-Client': 'payroll-tax-pro' },
    });

    ws.on('open', () => {
      this.emit('log', 'WebSocket open — sending auth');
      ws.send(JSON.stringify({ type: 'auth', secret: SECRET }));
    });

    ws.on('message', (raw) => this._onMessage(raw));

    ws.on('close', (code, reason) => {
      clearInterval(this.pingTimer);
      this.authenticated = false;
      this.stats.disconnectedAt = new Date().toISOString();
      this.emit('statusChange', 'disconnected');
      this.emit('log', `Connection closed (${code}) — ${reason || 'no reason'}`);
      if (!this.intentionalClose) this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.emit('log', `WebSocket error: ${err.message}`);
      this.emit('error', err);
    });

    this.ws = ws;
  }

  _scheduleReconnect() {
    this.stats.reconnectCount++;
    this.emit('log', `Reconnecting in ${RECONNECT_DELAY / 1000}s (attempt ${this.stats.reconnectCount})…`);
    this.reconnectTimer = setTimeout(() => this._connect(), RECONNECT_DELAY);
  }

  _startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, PING_INTERVAL);
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'auth_ok':
        this.authenticated = true;
        this.stats.connectedAt = new Date().toISOString();
        this.emit('statusChange', 'connected');
        this.emit('log', 'Authenticated — bridge is live');
        this._startPing();
        this._resumePendingEnrollments();
        break;

      case 'auth_fail':
        this.emit('log', `Auth rejected: ${msg.message}. Check WEBSOCKET_SECRET.`);
        this.ws.close(1008, 'Auth failed');
        break;

      case 'submit':
        this._handleJob(msg);
        break;

      case 'pong':
        // heartbeat acknowledged — connection alive
        break;

      default:
        this.emit('log', `Unknown message type: ${msg.type}`);
    }
  }

  async _handleJob(job) {
    const { jobId, submissionId } = job;
    this.stats.jobsReceived++;
    this.emit('log', `Job received: submissionId=${submissionId} jobId=${jobId}`);
    this.emit('jobStart', job);

    try {
      const log = (msg) => this.emit('log', msg);

      // PIN used throughout this job — generate a fresh one for new enrollments
      let effectivePin = job.pin || null;
      let generatedEnrollmentPin = null;  // set only when we generate a new PIN

      // 1. Enroll client if not already enrolled.
      // Railway DB is authoritative (job.eftpsEnrolled). Local JSON is a fallback
      // in case the Railway DB is reset or the client was enrolled on a previous machine.
      const alreadyEnrolled = job.eftpsEnrolled === 1 || isEnrolled(job.ein);
      if (!alreadyEnrolled) {
        log(`EIN ${cleanEin(job.ein)} not enrolled (Railway DB + local JSON both show unenrolled) — running enrollment first`);

        // Generate a fresh PIN for the enrollment file regardless of what the server sent.
        // This guarantees the PIN stored in EFTPS matches what we record back in the DB.
        generatedEnrollmentPin = generatePin();
        effectivePin = generatedEnrollmentPin;
        log(`[ENROLL] Generated enrollment PIN: ${generatedEnrollmentPin} (will be stored in client record after Active confirmation)`);

        const enrollContent = generateEnrollmentFile({
          ein:           job.ein,
          pin:           effectivePin,
          businessName:  job.businessName,
          routingNumber: job.routingNumber,
          accountNumber: job.accountNumber,
          accountType:   job.accountType || 'checking',
        });
        const enrollFilePath = saveEnrollmentFile(enrollContent, job.ein);
        log(`Enrollment file saved: ${enrollFilePath}`);

        // Generate and save the payment ACH file now while we have the PIN,
        // so it is ready on disk before we wait for enrollment to go Active.
        const achContentEarly = generateBatchProviderFile({
          ein:            job.ein,
          pin:            effectivePin,
          taxYear:        job.taxYear,
          taxQuarter:     job.taxQuarter,
          settlementDate: job.settlementDate,
          taxData:        job.taxData,
          taxTypeCode:    job.taxTypeCode || '94105',
          sequenceNumber: job.sequenceNumber || 1,
        });
        const achFilePathEarly = saveACHFile(achContentEarly, submissionId);
        log(`Payment ACH file saved early: ${achFilePathEarly}`);

        await c2.run('enrollment', () => runEnrollmentAutomation(enrollFilePath, log));

        // Poll until Active — persists to disk so a restart resumes automatically
        const enrollmentActive = await this._pollEnrollmentUntilActive({
          ein:           job.ein,
          jobId,
          submissionId,
          achFilePath:   achFilePathEarly,
          clientId:      job.clientId,
          enrollmentPin: generatedEnrollmentPin,
          startAtAttempt: 0,
        });

        if (!enrollmentActive) {
          throw new Error('Enrollment could not be confirmed after 1.5 hours. Please contact support.');
        }

        markEnrolled(job.ein);
        removePendingEnrollment(job.ein);
        log(`EIN ${cleanEin(job.ein)} confirmed Active and added to enrolled_clients.json`);
      } else {
        log(`EIN ${cleanEin(job.ein)} already enrolled (eftpsEnrolled=${job.eftpsEnrolled}, localJson=${isEnrolled(job.ein)}) — skipping enrollment`);
        // Sync local JSON cache if Railway says enrolled but local file doesn't know yet
        if (job.eftpsEnrolled === 1 && !isEnrolled(job.ein)) {
          markEnrolled(job.ein);
          log(`EIN ${cleanEin(job.ein)} synced to local enrolled_clients.json from Railway DB`);
        }
      }

      // 2. Generate and save payment ACH file (reuse early-saved file if enrollment just ran)
      let achFilePath;
      if (typeof achFilePathEarly !== 'undefined') {
        achFilePath = achFilePathEarly;
        log(`Reusing payment ACH file saved before enrollment wait: ${achFilePath}`);
      } else {
        const achContent = generateBatchProviderFile({
          ein:            job.ein,
          pin:            effectivePin,
          taxYear:        job.taxYear,
          taxQuarter:     job.taxQuarter,
          settlementDate: job.settlementDate,
          taxData:        job.taxData,
          taxTypeCode:    job.taxTypeCode || '94105',
          sequenceNumber: job.sequenceNumber || 1,
        });
        achFilePath = saveACHFile(achContent, submissionId);
        log(`ACH file saved: ${achFilePath}`);
      }

      // 4. Run payment automation (bp_automation.py clicks Payments tab as step 0)
      const result = await c2.run('payment', () => runPaymentAutomation(achFilePath, log));

      this.stats.jobsSucceeded++;
      this.emit('log', `Job ${submissionId} succeeded — confirmation: ${result.confirmation}`);
      this.emit('jobComplete', { job, result, success: true });

      this._send({
        type:            'result',
        jobId,
        submissionId,
        success:         true,
        confirmation:    result.confirmation,
        achFilePath:     result.achFilePath,
        warning:         result.warning || null,
        message:         'Your payment is sent!',
        // Include generated PIN so Railway can persist it in the client record
        enrollmentPin:   generatedEnrollmentPin || null,
      });

    } catch (err) {
      this.stats.jobsFailed++;
      this.emit('log', `Job ${submissionId} FAILED: ${err.message}`);
      this.emit('jobComplete', { job, error: err.message, success: false });

      const isEnrollmentError = err.message.includes('Enrollment could not be confirmed');
      this._send({
        type:         'result',
        jobId,
        submissionId,
        success:      false,
        error:        isEnrollmentError
                        ? 'Enrollment could not be confirmed. Please contact support.'
                        : err.message,
        message:      isEnrollmentError
                        ? 'Enrollment could not be confirmed. Please contact support.'
                        : 'Bridge processing failed',
      });
    }
  }

  // ── Enrollment polling — shared by new jobs and resumed jobs ─────────────────

  async _pollEnrollmentUntilActive({ ein, jobId, submissionId, achFilePath, clientId, enrollmentPin, startAtAttempt }) {
    const log          = (msg) => this.emit('log', msg);
    const MAX_RETRIES  = 6;
    const POLL_INTERVAL = 15 * 60 * 1000;

    // Persist to disk immediately so a restart can resume from here
    upsertPendingEnrollment({ ein, jobId, submissionId, achFilePath, clientId, enrollmentPin, attempt: startAtAttempt, maxRetries: MAX_RETRIES });

    // Immediate check first (only on the first call, not when resuming mid-sequence)
    let active = false;
    if (startAtAttempt === 0) {
      log(`[ENROLL] Checking enrollment status immediately after ENROLLMENT_COMPLETE...`);
      active = await c2.run('enroll-check', () => checkEnrollmentActive(ein, log));
      if (active) log(`[ENROLL] EIN ${cleanEin(ein)} confirmed Active immediately`);
    }

    if (!active) {
      this._send({ type: 'status_update', jobId, status: 'enrollment_pending', message: 'Processing. Since this is your first payment with us, it can take 15 mins to 1 hour.' });

      for (let attempt = startAtAttempt + 1; attempt <= MAX_RETRIES; attempt++) {
        log(`[ENROLL] Waiting 15 minutes before retry ${attempt}/${MAX_RETRIES}...`);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

        // Update attempt count in persisted file before running check
        upsertPendingEnrollment({ ein, jobId, submissionId, achFilePath, clientId, enrollmentPin, attempt, maxRetries: MAX_RETRIES });

        log(`[ENROLL] Running enrollment check (retry ${attempt}/${MAX_RETRIES}) for EIN ${cleanEin(ein)}...`);
        active = await c2.run('enroll-check', () => checkEnrollmentActive(ein, log));

        if (active) {
          log(`[ENROLL] EIN ${cleanEin(ein)} confirmed Active on retry ${attempt}`);
          break;
        }

        log(`[ENROLL] Still not Active after retry ${attempt}/${MAX_RETRIES}`);
        this._send({ type: 'status_update', jobId, status: 'enrollment_pending', message: `Enrollment pending — checking again in 15 minutes (attempt ${attempt}/${MAX_RETRIES}).` });
      }
    }

    return active;
  }

  // ── Resume pending enrollments on reconnect ───────────────────────────────────

  _resumePendingEnrollments() {
    const pending = loadPendingEnrollments();
    if (pending.length === 0) return;
    this.emit('log', `[RESUME] Found ${pending.length} pending enrollment(s) — resuming...`);
    for (const entry of pending) {
      this.emit('log', `[RESUME] Resuming EIN ${cleanEin(entry.ein)} from attempt ${entry.attempt}/${entry.maxRetries}`);
      this._runResumedEnrollment(entry).catch((err) => {
        this.emit('log', `[RESUME] Error for EIN ${cleanEin(entry.ein)}: ${err.message}`);
      });
    }
  }

  async _runResumedEnrollment(entry) {
    const { ein, jobId, submissionId, achFilePath, clientId, enrollmentPin, attempt } = entry;
    const log = (msg) => this.emit('log', msg);

    log(`[RESUME] Resuming enrollment check for EIN ${cleanEin(ein)}`);

    const active = await this._pollEnrollmentUntilActive({
      ein, jobId, submissionId, achFilePath, clientId, enrollmentPin, startAtAttempt: attempt,
    });

    if (!active) {
      removePendingEnrollment(ein);
      this._send({ type: 'result', jobId, submissionId, success: false, error: 'Enrollment could not be confirmed after 1.5 hours. Please contact support.' });
      return;
    }

    markEnrolled(ein);
    removePendingEnrollment(ein);
    log(`[RESUME] EIN ${cleanEin(ein)} Active — running payment automation`);

    if (!fs.existsSync(achFilePath)) {
      log(`[RESUME] ACH file not found: ${achFilePath} — cannot complete payment`);
      this._send({ type: 'result', jobId, submissionId, success: false, error: 'ACH file missing after resume. Please resubmit payment.' });
      return;
    }

    try {
      const result = await c2.run('payment', () => runPaymentAutomation(achFilePath, log));
      log(`[RESUME] Payment complete for EIN ${cleanEin(ein)}`);
      this._send({ type: 'result', jobId, submissionId, success: true, confirmation: result.confirmation, achFilePath: result.achFilePath, message: 'Your payment is sent!', enrollmentPin: enrollmentPin || null });
    } catch (err) {
      log(`[RESUME] Payment failed for EIN ${cleanEin(ein)}: ${err.message}`);
      this._send({ type: 'result', jobId, submissionId, success: false, error: err.message });
    }
  }
}

module.exports = BridgeClient;
