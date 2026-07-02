'use strict';

/**
 * bridgeTwc.js
 * WebSocket manager for the TWC QuickFile bridge (Computer 2, second bridge).
 * Mirrors the pattern of bridge.js but is TWC-specific and simpler.
 *
 * Path:   /ws/twc-bridge
 * Secret: BRIDGE_TWC_SECRET env var
 */

const { WebSocketServer, WebSocket } = require('ws');
const EventEmitter = require('events');

const BRIDGE_PATH       = '/ws/twc-bridge';
const AUTH_TIMEOUT_MS   = 15_000;
const SERVER_PING_MS    = 25_000;
const RECONNECT_GRACE_MS = 5 * 60_000;

class BridgeTwcManager extends EventEmitter {
  constructor() {
    super();
    this._ws             = null;
    this._wss            = null;
    this._pingTimer      = null;
    this._disconnectTimer = null;
    this._pending        = new Map(); // jobId → { resolve?, reject?, onResult?, timeout, async }
    this._jobPayloads    = new Map(); // jobId → payload (for re-send on reconnect)
    this._jobStatuses    = new Map(); // jobId → { status, message, confirmation, updatedAt }
    this._jobSeq         = 0;
  }

  attach(httpServer) {
    this._wss = new WebSocketServer({ noServer: true });
    this._wss.on('connection', (ws, req) => this._onConnection(ws, req));

    httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== BRIDGE_PATH) return; // handled by other upgrade listeners
      this._wss.handleUpgrade(req, socket, head, (ws) => {
        this._wss.emit('connection', ws, req);
      });
    });

    console.log(`[TWC Bridge WS] Listening on ${BRIDGE_PATH}`);
    return this._wss;
  }

  _onConnection(ws, req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[TWC Bridge WS] Connection from ${ip}`);

    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      console.log('[TWC Bridge WS] Replacing previous connection');
      this._ws.close(1001, 'Replaced');
    }

    ws.isAlive      = true;
    ws.bridgeAuthed = false;

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => this._onMessage(ws, raw));
    ws.on('close', (code, reason) => {
      console.log(`[TWC Bridge WS] Closed (${code}) — ${reason?.toString() || 'no reason'}`);
      if (this._ws === ws) {
        this._ws = null;
        clearInterval(this._pingTimer);
        this._pingTimer = null;
        this.emit('disconnected');

        if (this._pending.size > 0) {
          clearTimeout(this._disconnectTimer);
          this._disconnectTimer = setTimeout(
            () => this._failPendingJobs('TWC Bridge disconnected and did not reconnect within 5 minutes'),
            RECONNECT_GRACE_MS,
          );
        }
      }
    });
    ws.on('error', (err) => console.error(`[TWC Bridge WS] Socket error: ${err.message}`));

    const authTimer = setTimeout(() => {
      if (!ws.bridgeAuthed) { console.log('[TWC Bridge WS] Auth timeout'); ws.terminate(); }
    }, AUTH_TIMEOUT_MS);
    ws.once('close', () => clearTimeout(authTimer));
  }

  _onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!ws.bridgeAuthed) {
      if (msg.type !== 'auth') { ws.terminate(); return; }
      const secret = process.env.BRIDGE_TWC_SECRET || '';
      if (!secret) {
        ws.send(JSON.stringify({ type: 'auth_fail', message: 'BRIDGE_TWC_SECRET not configured on server' }));
        ws.terminate(); return;
      }
      if (msg.secret !== secret) {
        ws.send(JSON.stringify({ type: 'auth_fail', message: 'Invalid secret' }));
        ws.terminate(); return;
      }
      ws.bridgeAuthed = true;
      this._ws = ws;
      ws.send(JSON.stringify({ type: 'auth_ok' }));
      console.log('[TWC Bridge WS] Authenticated — TWC bridge is live');

      clearTimeout(this._disconnectTimer);
      this._disconnectTimer = null;
      this.emit('connected');
      this._startServerPings();
      this._resendPendingJobs();
      return;
    }

    switch (msg.type) {
      case 'result':        this._handleResult(msg);       break;
      case 'status_update': this._handleStatusUpdate(msg); break;
      case 'ping':          ws.send(JSON.stringify({ type: 'pong' })); break;
      case 'pong':          ws.isAlive = true;             break;
      default: console.log(`[TWC Bridge WS] Unknown type: ${msg.type}`);
    }
  }

  _startServerPings() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      const ws = this._ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) { clearInterval(this._pingTimer); return; }
      if (!ws.isAlive) { console.warn('[TWC Bridge WS] Pong not received — terminating'); ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    }, SERVER_PING_MS);
  }

  _handleStatusUpdate(msg) {
    if (msg.jobId) {
      this._jobStatuses.set(msg.jobId, {
        status:    msg.status  || 'processing',
        message:   msg.message || '',
        updatedAt: new Date().toISOString(),
      });
    }
    this.emit('statusUpdate', msg);
    console.log(`[TWC Bridge WS] Status update job ${msg.jobId}: ${msg.status} — ${msg.message}`);

    // Persist to DB if a submissionId is attached
    if (msg.submissionId) {
      try {
        const { getDb } = require('../database/db');
        getDb().prepare(`UPDATE twc_submissions SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(msg.status === 'processing' ? 'processing' : msg.status, msg.submissionId);
      } catch (e) {
        console.error('[TWC Bridge WS] DB status update failed:', e.message);
      }
    }
  }

  _handleResult(msg) {
    const p = this._pending.get(msg.jobId);

    // Always persist result to DB
    if (msg.submissionId) {
      try {
        const { getDb } = require('../database/db');
        getDb().prepare(`
          UPDATE twc_submissions
          SET status=?, confirmation_number=?, error=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).run(
          msg.success ? 'completed' : 'failed',
          msg.confirmation || null,
          msg.error        || null,
          msg.submissionId,
        );
      } catch (e) {
        console.error('[TWC Bridge WS] DB result update failed:', e.message);
      }
    }

    if (!p) {
      console.log(`[TWC Bridge WS] Late result for job ${msg.jobId} (${msg.success ? 'success' : 'failed'})`);
      this._jobStatuses.set(msg.jobId, {
        status:       msg.success ? 'completed' : 'failed',
        message:      msg.success ? 'Submitted successfully' : (msg.error || 'Failed'),
        confirmation: msg.confirmation || null,
        updatedAt:    new Date().toISOString(),
      });
      return;
    }

    clearTimeout(p.timeout);
    this._pending.delete(msg.jobId);
    this._jobPayloads.delete(msg.jobId);

    this._jobStatuses.set(msg.jobId, {
      status:       msg.success ? 'completed' : 'failed',
      message:      msg.success ? 'Submitted successfully' : (msg.error || 'Failed'),
      confirmation: msg.confirmation || null,
      updatedAt:    new Date().toISOString(),
    });

    if (p.async) {
      p.onResult?.(msg.success, msg);
    } else {
      if (msg.success) p.resolve(msg);
      else p.reject(new Error(msg.error || 'TWC bridge processing failed'));
    }
  }

  _resendPendingJobs() {
    if (this._pending.size === 0) return;
    // Fail stale jobs instead of re-sending — QuickFile automation is not idempotent.
    // User must manually retry from the UI.
    console.log(`[TWC Bridge WS] Failing ${this._pending.size} stale job(s) from previous session`);
    this._failPendingJobs('Bridge reconnected — previous job was interrupted. Please resubmit.');
  }

  _failPendingJobs(reason) {
    for (const [jobId, p] of this._pending) {
      clearTimeout(p.timeout);
      this._jobPayloads.delete(jobId);
      this._jobStatuses.set(jobId, { status: 'failed', message: reason, updatedAt: new Date().toISOString() });
      if (p.async) p.onResult?.(false, { error: reason });
      else p.reject(new Error(reason));
    }
    this._pending.clear();
  }

  getJobStatus(jobId) {
    return this._jobStatuses.get(jobId) || null;
  }

  /**
   * Queue a job and call onResult when complete (fire-and-forget, non-blocking).
   * Returns jobId immediately.
   */
  queueJob(job, onResult, timeoutMs = 10 * 60 * 1000) {
    if (!this.isConnected) throw new Error('TWC Bridge is not connected. Start the TWC bridge on Computer 2.');
    const jobId   = `twc_${Date.now()}_${++this._jobSeq}`;
    // job.type overrides default 'submit' (e.g. 'twc_payment')
    const payload = { type: 'submit', ...job, jobId };

    this._jobStatuses.set(jobId, { status: 'processing', message: 'Job queued', updatedAt: new Date().toISOString() });

    const timeout = setTimeout(() => {
      this._jobStatuses.set(jobId, { status: 'failed', message: 'Timed out', updatedAt: new Date().toISOString() });
      this._pending.delete(jobId);
      this._jobPayloads.delete(jobId);

      // Mark DB row failed too
      if (job.submissionId) {
        try {
          const { getDb } = require('../database/db');
          getDb().prepare(`UPDATE twc_submissions SET status='failed', error='Timed out', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(job.submissionId);
        } catch (_) {}
      }
      onResult?.(false, { error: 'TWC bridge job timed out' });
    }, timeoutMs);

    this._jobPayloads.set(jobId, payload);
    this._pending.set(jobId, { onResult, timeout, async: true });
    this._ws.send(JSON.stringify(payload));
    return jobId;
  }

  get isConnected() {
    return (
      this._ws !== null &&
      this._ws.readyState === WebSocket.OPEN &&
      this._ws.bridgeAuthed === true
    );
  }
}

module.exports = new BridgeTwcManager();
