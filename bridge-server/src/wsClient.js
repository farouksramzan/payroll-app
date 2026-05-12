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
const { generateACH } = require('./achGenerator');
const { submitACH }   = require('./batchProvider');

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
      // 1. Generate ACH CCD+ file
      const achContent = generateACH({
        ein:               job.ein,
        businessName:      job.businessName,
        bankRoutingNumber: job.bankRoutingNumber,
        bankAccountNumber: job.bankAccountNumber,
        bankAccountType:   job.bankAccountType,
        settlementDate:    job.settlementDate,
        taxYear:           job.taxYear,
        taxQuarter:        job.taxQuarter,
        taxData:           job.taxData,
      });

      // 2. Submit via Batch Provider
      const result = await submitACH(achContent, submissionId);

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
        message:      'ACH file generated and submitted to Batch Provider',
      });

    } catch (err) {
      this.stats.jobsFailed++;
      this.emit('log', `Job ${submissionId} FAILED: ${err.message}`);
      this.emit('jobComplete', { job, error: err.message, success: false });

      this._send({
        type:         'result',
        jobId,
        submissionId,
        success:      false,
        error:        err.message,
        message:      'Bridge processing failed',
      });
    }
  }
}

module.exports = BridgeClient;
