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
const { generateEnrollmentFile }     = require('./enrollmentGenerator');
const { saveACHFile, WATCHED_FOLDER } = require('./batchProvider');

const BP_SCRIPT               = path.join(__dirname, '..', 'bp_automation.py');
const BP_ENROLL_SCRIPT        = path.join(__dirname, '..', 'bp_enrollment.py');
const BP_ENROLL_CHECK_SCRIPT  = path.join(__dirname, '..', 'bp_enrollment_check.py');
const ENROLLED_JSON           = path.join(__dirname, '..', 'enrolled_clients.json');
const ENROLL_FOLDER      = path.join(__dirname, '..', 'data', 'enrollments-out');

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

      // 1. Enroll client if not already enrolled
      if (!isEnrolled(job.ein)) {
        log(`EIN ${cleanEin(job.ein)} not in enrolled_clients.json — running enrollment first`);

        const enrollContent = generateEnrollmentFile({
          ein:           job.ein,
          pin:           job.pin,
          businessName:  job.businessName,
          routingNumber: job.routingNumber,
          accountNumber: job.accountNumber,
          accountType:   job.accountType || 'checking',
        });
        const enrollFilePath = saveEnrollmentFile(enrollContent, job.ein);
        log(`Enrollment file saved: ${enrollFilePath}`);

        await runEnrollmentAutomation(enrollFilePath, log);

        markEnrolled(job.ein);
        log(`EIN ${cleanEin(job.ein)} added to enrolled_clients.json`);
        log('Waiting 5s before polling EFTPS for Active enrollment status...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Notify web app that we are waiting for EFTPS to activate the enrollment
        this._send({
          type:    'status_update',
          jobId,
          status:  'enrollment_pending',
          message: 'Processing. Since this is your first payment with us, it can take 15 mins to 1 hour.',
        });

        // Poll up to 10 times, every 30 minutes, until EFTPS shows Active
        const MAX_RETRIES    = 10;
        const POLL_INTERVAL  = 30 * 60 * 1000; // 30 min
        let enrollmentActive = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          log(`[ENROLL] Waiting 30 minutes before enrollment status check (attempt ${attempt}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

          log(`[ENROLL] Running enrollment status check for EIN ${cleanEin(job.ein)}...`);
          enrollmentActive = await checkEnrollmentActive(job.ein, log);

          if (enrollmentActive) {
            log(`[ENROLL] EIN ${cleanEin(job.ein)} confirmed Active — proceeding with payment`);
            break;
          }

          log(`[ENROLL] Enrollment not yet Active (attempt ${attempt}/${MAX_RETRIES})`);
          this._send({
            type:    'status_update',
            jobId,
            status:  'enrollment_pending',
            message: `Enrollment pending — checking again in 30 minutes (attempt ${attempt}/${MAX_RETRIES}).`,
          });
        }

        if (!enrollmentActive) {
          throw new Error('Enrollment could not be confirmed after 10 attempts. Please contact support.');
        }
      } else {
        log(`EIN ${cleanEin(job.ein)} already enrolled — skipping enrollment`);
      }

      // 2. Generate Batch Provider payment record
      const achContent = generateBatchProviderFile({
        ein:            job.ein,
        pin:            job.pin,
        taxYear:        job.taxYear,
        taxQuarter:     job.taxQuarter,
        settlementDate: job.settlementDate,
        taxData:        job.taxData,
        taxTypeCode:    job.taxTypeCode || '94105',
        sequenceNumber: job.sequenceNumber || 1,
      });

      // 3. Save payment ACH file to disk
      const achFilePath = saveACHFile(achContent, submissionId);
      log(`ACH file saved: ${achFilePath}`);

      // 4. Run payment automation (bp_automation.py clicks Payments tab as step 0)
      const result = await runPaymentAutomation(achFilePath, log);

      this.stats.jobsSucceeded++;
      this.emit('log', `Job ${submissionId} succeeded — confirmation: ${result.confirmation}`);
      this.emit('jobComplete', { job, result, success: true });

      this._send({
        type:         'result',
        jobId,
        submissionId,
        success:      true,
        confirmation: result.confirmation,
        achFilePath:  result.achFilePath,
        warning:      result.warning || null,
        message:      'Your payment is sent!',
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
}

module.exports = BridgeClient;
