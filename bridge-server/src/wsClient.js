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

// ── In-memory enrollment guard ────────────────────────────────────────────────
// Synchronous Set checked BEFORE any await so concurrent jobs for the same EIN
// within one Node.js session can't both decide to enroll at the same time.
// The file-based pending_enrollments.json handles persistence across restarts.
const _enrollingEINs = new Set();

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

// ── Payment serialization lock ────────────────────────────────────────────────
// Serializes payment jobs including their retry waits, so a retrying payment
// never interleaves with another payment job (which could put BP in a bad state).
// Enrollment checks still run freely via c2 during retry waits.
const paymentLock = new Computer2Lock();

// ── Persistent job tracking ───────────────────────────────────────────────────
// Survives crashes. Lets the bridge skip already-completed jobs if Railway
// re-sends them on reconnect, while still re-processing jobs that were
// interrupted mid-flight (status = 'in-progress' when bridge crashed).
const PENDING_JOBS_FILE = path.join(__dirname, '..', 'data', 'pending_jobs.json');

function loadPendingJobs() {
  try { return JSON.parse(fs.readFileSync(PENDING_JOBS_FILE, 'utf8')); } catch { return {}; }
}

function savePendingJobs(jobs) {
  fs.mkdirSync(path.dirname(PENDING_JOBS_FILE), { recursive: true });
  fs.writeFileSync(PENDING_JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function markJobStatus(jobId, status) {
  const jobs = loadPendingJobs();
  jobs[jobId] = { ...jobs[jobId], status, updatedAt: new Date().toISOString() };
  if (status === 'queued') jobs[jobId].createdAt = new Date().toISOString();
  if (status === 'completed') {
    // Evict entries older than 48 hours to prevent unbounded growth
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    for (const [id, e] of Object.entries(jobs)) {
      if (new Date(e.createdAt || 0).getTime() < cutoff) delete jobs[id];
    }
  }
  savePendingJobs(jobs);
}

// In-memory guard prevents double-processing within the same session (e.g.
// Railway sends a job twice before the first run finishes).
const _activeJobIds = new Set();

function isDuplicateJob(jobId) {
  const jobs = loadPendingJobs();
  // 'completed' → definitely done, skip
  if (jobs[jobId]?.status === 'completed') return true;
  // Currently being processed in this session
  if (_activeJobIds.has(jobId)) return true;
  return false;
}

// ── Pending result persistence ────────────────────────────────────────────────
// If the bridge disconnects before a result is sent, save it to disk and
// re-send on reconnect so Railway always gets a response.
const PENDING_RESULTS_FILE = path.join(__dirname, '..', 'data', 'pending_results.json');

function loadPendingResults() {
  try { return JSON.parse(fs.readFileSync(PENDING_RESULTS_FILE, 'utf8')); } catch { return []; }
}

function savePendingResult(result) {
  fs.mkdirSync(path.dirname(PENDING_RESULTS_FILE), { recursive: true });
  const list = loadPendingResults().filter(r => r.jobId !== result.jobId);
  list.push({ ...result, savedAt: new Date().toISOString() });
  fs.writeFileSync(PENDING_RESULTS_FILE, JSON.stringify(list, null, 2));
}

function clearPendingResult(jobId) {
  try {
    const list = loadPendingResults().filter(r => r.jobId !== jobId);
    fs.writeFileSync(PENDING_RESULTS_FILE, JSON.stringify(list, null, 2));
  } catch {}
}

// ── Enrollment PIN store ──────────────────────────────────────────────────────
// Persists the generated enrollment PIN so concurrent jobs waiting on the same
// EIN's enrollment can use the correct PIN for their payment files.
const ENROLLMENT_PINS_FILE = path.join(__dirname, '..', 'data', 'enrollment_pins.json');

function saveEnrollmentPin(ein, pin) {
  let pins = {};
  try { pins = JSON.parse(fs.readFileSync(ENROLLMENT_PINS_FILE, 'utf8')); } catch {}
  pins[cleanEin(ein)] = pin;
  fs.mkdirSync(path.dirname(ENROLLMENT_PINS_FILE), { recursive: true });
  fs.writeFileSync(ENROLLMENT_PINS_FILE, JSON.stringify(pins, null, 2));
}

function getStoredEnrollmentPin(ein) {
  try {
    const pins = JSON.parse(fs.readFileSync(ENROLLMENT_PINS_FILE, 'utf8'));
    return pins[cleanEin(ein)] || null;
  } catch { return null; }
}

// ── Enrollment tracking ───────────────────────────────────────────────────────

function cleanEin(ein) {
  return String(ein || '').replace(/\D/g, '');
}

function isEnrolled(ein) {
  try {
    const list = JSON.parse(fs.readFileSync(ENROLLED_JSON, 'utf8'));
    const normalized = cleanEin(ein);
    return list.some(e => cleanEin(e) === normalized);
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

function runPython(script, args, logFn, { timeout = 180000, successToken, failToken, retryToken } = {}) {
  return new Promise((resolve, reject) => {
    execFile('python', [script, ...args], { windowsHide: true, timeout },
      (err, stdout, stderr) => {
        if (stdout) stdout.split('\n').filter(Boolean).forEach((l) => logFn(l));
        if (stderr) stderr.split('\n').filter(Boolean).forEach((l) => logFn(`[stderr] ${l}`));
        if (err) return reject(new Error(`${path.basename(script)} error: ${err.message}`));
        if (stdout.includes(successToken)) return resolve(stdout);
        if (retryToken && stdout.includes(retryToken)) {
          const retryErr = new Error('IMPORT_RETRY_NEEDED');
          retryErr.stdout = stdout;
          return reject(retryErr);
        }
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
    retryToken:   'IMPORT_RETRY_NEEDED',
  }).then(() => ({ success: true, confirmation: 'BP_AUTOMATION_OK', achFilePath }));
}

const RETRY_DELAY_MS    = 10 * 1000; // 10 seconds — Error ID 88 is transient, retry quickly
const MAX_IMPORT_RETRIES = 3;

async function runPaymentWithRetry(achFilePath, logFn) {
  // paymentLock serializes the full retry sequence so no other payment job
  // can interleave with BP while we're waiting between retries.
  // c2 is re-acquired per attempt so enrollment checks can still run during waits.
  return paymentLock.run('payment', async () => {
    for (let attempt = 1; attempt <= MAX_IMPORT_RETRIES; attempt++) {
      try {
        return await c2.run('payment', () => runPaymentAutomation(achFilePath, logFn));
      } catch (err) {
        const isRetrySignal = err.message.includes('IMPORT_RETRY_NEEDED')
          || (err.stdout || '').includes('IMPORT_RETRY_NEEDED');

        if (isRetrySignal && attempt < MAX_IMPORT_RETRIES) {
          logFn(`[BP] Import error — will retry in 10 minutes (attempt ${attempt}/${MAX_IMPORT_RETRIES})`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          logFn(`[BP] Retrying import now (attempt ${attempt + 1}/${MAX_IMPORT_RETRIES})`);
          continue;
        }

        if (isRetrySignal) {
          throw new Error(`Import failed after ${MAX_IMPORT_RETRIES} retries (persistent Error ID 88 or similar). Please retry manually.`);
        }

        throw err;
      }
    }
  });
}

async function runEnrollmentWithRetry(enrollFilePath, logFn) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logFn(`[ENROLL] Launching enrollment automation for: ${enrollFilePath} (attempt ${attempt}/${MAX_RETRIES})`);
    try {
      await runPython(BP_ENROLL_SCRIPT, [enrollFilePath], logFn, {
        timeout:      120000,
        successToken: 'ENROLLMENT_COMPLETE',
        failToken:    'ENROLLMENT_FAILED',
        retryToken:   'ENROLLMENT_RETRY_NEEDED',
      });
      return; // success
    } catch (err) {
      const isRetry = err.message.includes('ENROLLMENT_RETRY_NEEDED')
        || (err.stdout || '').includes('ENROLLMENT_RETRY_NEEDED');
      if (isRetry && attempt < MAX_RETRIES) {
        logFn(`[ENROLL] Error ID 88 on import — retrying in 10s (attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      throw err;
    }
  }
}

// Returns true if EFTPS confirms the EIN is Active, false otherwise (never rejects).
function checkEnrollmentActive(ein, businessName, logFn) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    const args = [BP_ENROLL_CHECK_SCRIPT, cleanEin(ein)];
    if (businessName) args.push(businessName);
    execFile('python', args, { windowsHide: true, timeout: 120000 },
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
    if (obj.type === 'result') savePendingResult(obj);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj), (err) => {
        if (!err && obj.type === 'result') clearPendingResult(obj.jobId);
      });
    }
  }

  _resendPendingResults() {
    const results = loadPendingResults();
    if (results.length === 0) return;
    this.emit('log', `[RESUME] Re-sending ${results.length} unacknowledged result(s) from previous session`);
    for (const result of results) {
      this.emit('log', `[RESUME] Re-sending result for jobId=${result.jobId}`);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(result), (err) => {
          if (!err) clearPendingResult(result.jobId);
        });
      }
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
        this._resendPendingResults();
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

    if (isDuplicateJob(jobId)) {
      this.emit('log', `Duplicate job ${jobId} ignored — already processing or completed`);
      return;
    }

    _activeJobIds.add(jobId);
    markJobStatus(jobId, 'queued');

    this.stats.jobsReceived++;
    this.emit('log', `Job received: submissionId=${submissionId} jobId=${jobId}`);
    this.emit('jobStart', job);

    try {
      markJobStatus(jobId, 'in-progress');
      const log = (msg) => this.emit('log', msg);

      // ── SUI / TWC job — separate path from EFTPS ──────────────────────────
      if (job.jobType === 'submit_sui') {
        await c2.run('sui', () => this._runSuiJob(job, log));
        this.stats.jobsSucceeded++;
        this.emit('log', `SUI job ${submissionId} succeeded`);
        this.emit('jobComplete', { job, result: { success: true }, success: true });
        markJobStatus(jobId, 'completed');
        _activeJobIds.delete(jobId);
        this._send({ type: 'result', jobId, submissionId, success: true, message: 'SUI submitted to TWC' });
        return;
      }

      // PIN used throughout this job — generate a fresh one for new enrollments
      let effectivePin = job.pin || null;
      let generatedEnrollmentPin = null;  // set only when we generate a new PIN

      // 1. Enroll client if not already enrolled.
      // Railway DB is authoritative (job.eftpsEnrolled). Local JSON is a fallback
      // in case the Railway DB is reset or the client was enrolled on a previous machine.
      const enrollmentWasInProgress = _enrollingEINs.has(cleanEin(job.ein))
        || loadPendingEnrollments().some(e => cleanEin(e.ein) === cleanEin(job.ein));
      const alreadyEnrolled = job.eftpsEnrolled === 1 || isEnrolled(job.ein) || enrollmentWasInProgress;
      if (enrollmentWasInProgress) {
        log(`[ENROLL] EIN ${cleanEin(job.ein)} enrollment already in progress — skipping re-enrollment, will wait before payment`);
      }
      if (!alreadyEnrolled) {
        log(`EIN ${cleanEin(job.ein)} not enrolled (Railway DB + local JSON both show unenrolled) — running enrollment first`);

        // Claim the enrollment slot synchronously (before any await) so concurrent jobs
        // for this EIN in the same session see it immediately via _enrollingEINs.
        _enrollingEINs.add(cleanEin(job.ein));
        // Also write to disk so restarts can resume.
        upsertPendingEnrollment({ ein: job.ein, businessName: job.businessName || '', jobId, submissionId, achFilePath: '', clientId: job.clientId, enrollmentPin: '', attempt: 0, maxRetries: 6 });

        // Generate a fresh PIN for the enrollment file regardless of what the server sent.
        // This guarantees the PIN stored in EFTPS matches what we record back in the DB.
        generatedEnrollmentPin = generatePin();
        effectivePin = generatedEnrollmentPin;
        log(`[ENROLL] Generated enrollment PIN: ${generatedEnrollmentPin} (will be stored in client record after Active confirmation)`);
        // Store PIN on disk so concurrent jobs waiting on this enrollment can use it for payment
        saveEnrollmentPin(job.ein, generatedEnrollmentPin);
        // Update pending entry with the real PIN
        upsertPendingEnrollment({ ein: job.ein, businessName: job.businessName || '', jobId, submissionId, achFilePath: '', clientId: job.clientId, enrollmentPin: generatedEnrollmentPin, attempt: 0, maxRetries: 6 });

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

        try {
          await c2.run('enrollment', () => runEnrollmentWithRetry(enrollFilePath, log));
        } catch (enrollErr) {
          // bp_enrollment.py can produce false ENROLLMENT_FAILED when the company
          // was already in "Synchronized" state (prior enrollment or fast processing).
          // Do an immediate inquiry before giving up — if it shows Active, we're good.
          log(`[ENROLL] Enrollment script reported failure (${enrollErr.message}) — running immediate inquiry to verify actual status`);
          const isActiveAnyway = await c2.run('enroll-check', () => checkEnrollmentActive(job.ein, job.businessName || '', log));
          if (!isActiveAnyway) {
            // Clean up persistent state so the resume path doesn't keep retrying a truly failed enrollment
            _enrollingEINs.delete(cleanEin(job.ein));
            removePendingEnrollment(job.ein);
            throw enrollErr;  // re-throw — catch block at bottom handles result
          }
          log(`[ENROLL] Inquiry confirmed enrollment IS Active despite script error — continuing to payment`);
        }

        // Poll until Active — persists to disk so a restart resumes automatically
        const enrollmentActive = await this._pollEnrollmentUntilActive({
          ein:           job.ein,
          businessName:  job.businessName || '',
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
        _enrollingEINs.delete(cleanEin(job.ein));
        log(`EIN ${cleanEin(job.ein)} confirmed Active and added to enrolled_clients.json`);
      } else if (!enrollmentWasInProgress) {
        log(`EIN ${cleanEin(job.ein)} already enrolled (eftpsEnrolled=${job.eftpsEnrolled}, localJson=${isEnrolled(job.ein)}) — skipping enrollment`);
        // Sync local JSON cache if Railway says enrolled but local file doesn't know yet
        if (job.eftpsEnrolled === 1 && !isEnrolled(job.ein)) {
          markEnrolled(job.ein);
          log(`EIN ${cleanEin(job.ein)} synced to local enrolled_clients.json from Railway DB`);
        }
      }

      // If enrollment was already in progress (started by a concurrent job for the same EIN),
      // wait until it completes so we don't try to pay before the client is enrolled.
      if (enrollmentWasInProgress) {
        log(`[ENROLL] Waiting for EIN ${cleanEin(job.ein)} enrollment to complete before payment...`);
        const WAIT_POLL_MS = 30 * 1000;
        const MAX_WAIT_MS  = 95 * 60 * 1000; // slightly more than the 90-min enrollment timeout
        const waitStarted  = Date.now();
        while (!isEnrolled(job.ein) && Date.now() - waitStarted < MAX_WAIT_MS) {
          log(`[ENROLL] EIN ${cleanEin(job.ein)} still enrolling — will check again in 30s`);
          await new Promise(r => setTimeout(r, WAIT_POLL_MS));
        }
        if (!isEnrolled(job.ein)) {
          throw new Error('Enrollment did not complete within expected time — please retry this payment after enrollment confirms.');
        }
        // Use the PIN generated during enrollment so the payment ACH file is correct
        const storedPin = getStoredEnrollmentPin(job.ein);
        if (storedPin) { effectivePin = storedPin; log(`[ENROLL] Using stored enrollment PIN for payment`); }
        log(`[ENROLL] EIN ${cleanEin(job.ein)} enrolled — proceeding to payment`);
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

      // 4. Run payment automation (retries up to 3× on transient errors like Error ID 88)
      const result = await runPaymentWithRetry(achFilePath, log);

      this.stats.jobsSucceeded++;
      this.emit('log', `Job ${submissionId} succeeded — confirmation: ${result.confirmation}`);
      this.emit('jobComplete', { job, result, success: true });

      markJobStatus(jobId, 'completed');
      _activeJobIds.delete(jobId);
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

      markJobStatus(jobId, 'completed');
      _activeJobIds.delete(jobId);
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

  async _runSuiJob(job, log) {
    const TWC_SCRIPT = path.join(__dirname, '..', 'twc_automation.py');
    const dataDir    = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const jobFile = path.join(dataDir, `twc_job_${job.submissionId}.json`);
    // Write job data to disk — never log sensitive fields
    fs.writeFileSync(jobFile, JSON.stringify({
      twcUsername:  job.twcUsername,
      twcPassword:  job.twcPassword,
      quarter:      job.quarter,
      year:         job.year,
      totalAmount:  job.totalAmount,
      paymentDate:  job.paymentDate,
      employees:    job.employees,
    }));
    log(`[TWC] Job file written: ${jobFile}`);
    log(`[TWC] Q${job.quarter} ${job.year} — $${job.totalAmount} — ${(job.employees || []).length} employees`);
    try {
      await runPython(TWC_SCRIPT, [jobFile], log, {
        timeout: 180000,
        successToken: 'TWC_COMPLETE',
        failToken: 'TWC_FAILED',
      });
    } finally {
      try { fs.unlinkSync(jobFile); } catch {}
    }
  }

  async _pollEnrollmentUntilActive({ ein, businessName, jobId, submissionId, achFilePath, clientId, enrollmentPin, startAtAttempt }) {
    const log          = (msg) => this.emit('log', msg);
    const MAX_RETRIES  = 6;
    const POLL_INTERVAL = 15 * 60 * 1000;

    // Persist to disk immediately so a restart can resume from here
    upsertPendingEnrollment({ ein, businessName, jobId, submissionId, achFilePath, clientId, enrollmentPin, attempt: startAtAttempt, maxRetries: MAX_RETRIES });

    // Immediate check first (only on the first call, not when resuming mid-sequence)
    let active = false;
    if (startAtAttempt === 0) {
      log(`[ENROLL] Checking enrollment status immediately after ENROLLMENT_COMPLETE...`);
      active = await c2.run('enroll-check', () => checkEnrollmentActive(ein, businessName, log));
      if (active) log(`[ENROLL] EIN ${cleanEin(ein)} confirmed Active immediately`);
    }

    if (!active) {
      this._send({ type: 'status_update', jobId, status: 'enrollment_pending', message: 'Processing. Since this is your first payment with us, it can take 15 mins to 1 hour.' });

      for (let attempt = startAtAttempt + 1; attempt <= MAX_RETRIES; attempt++) {
        log(`[ENROLL] Waiting 15 minutes before retry ${attempt}/${MAX_RETRIES}...`);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

        // Update attempt count in persisted file before running check
        upsertPendingEnrollment({ ein, businessName, jobId, submissionId, achFilePath, clientId, enrollmentPin, attempt, maxRetries: MAX_RETRIES });

        log(`[ENROLL] Running enrollment check (retry ${attempt}/${MAX_RETRIES}) for EIN ${cleanEin(ein)}...`);
        active = await c2.run('enroll-check', () => checkEnrollmentActive(ein, businessName, log));

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
    const { ein, businessName, jobId, submissionId, achFilePath, clientId, enrollmentPin, attempt } = entry;
    const log = (msg) => this.emit('log', msg);

    log(`[RESUME] Resuming enrollment check for EIN ${cleanEin(ein)}`);

    const active = await this._pollEnrollmentUntilActive({
      ein, businessName: businessName || '', jobId, submissionId, achFilePath, clientId, enrollmentPin, startAtAttempt: attempt,
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
      const result = await runPaymentWithRetry(achFilePath, log);
      log(`[RESUME] Payment complete for EIN ${cleanEin(ein)}`);
      this._send({ type: 'result', jobId, submissionId, success: true, confirmation: result.confirmation, achFilePath: result.achFilePath, message: 'Your payment is sent!', enrollmentPin: enrollmentPin || null });
    } catch (err) {
      log(`[RESUME] Payment failed for EIN ${cleanEin(ein)}: ${err.message}`);
      this._send({ type: 'result', jobId, submissionId, success: false, error: err.message });
    }
  }
}

module.exports = BridgeClient;
