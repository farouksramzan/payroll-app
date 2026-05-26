'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const EventEmitter = require('events');

const BRIDGE_PATH          = '/ws/bridge';
const AUTH_TIMEOUT_MS      = 15_000;        // close if no auth frame within 15s
const SERVER_PING_MS       = 25_000;        // server → bridge ping every 25s (keeps Railway proxy alive)
const RECONNECT_GRACE_MS   = 5 * 60_000;   // 5-minute window for bridge to reconnect before failing pending jobs

class BridgeManager extends EventEmitter {
  constructor() {
    super();
    this._ws              = null;
    this._wss             = null;
    this._pingTimer       = null;
    this._disconnectTimer = null;  // fires after RECONNECT_GRACE_MS if bridge doesn't reconnect
    this._pending         = new Map(); // jobId → { resolve?, reject?, onResult?, timeout, async }
    this._jobPayloads     = new Map(); // jobId → full payload (for re-sending to a reconnected bridge)
    this._jobSeq          = 0;
    this._jobStatuses     = new Map(); // jobId → { status, message, updatedAt, confirmation? }
  }

  attach(httpServer) {
    this._wss = new WebSocketServer({ noServer: true });
    this._wss.on('connection', (ws, req) => this._onConnection(ws, req));

    httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== BRIDGE_PATH) {
        socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }
      this._wss.handleUpgrade(req, socket, head, (ws) => {
        this._wss.emit('connection', ws, req);
      });
    });

    console.log(`[Bridge WS] Listening on ${BRIDGE_PATH}`);
    return this._wss;
  }

  _onConnection(ws, req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[Bridge WS] Connection from ${ip}`);

    // Drop stale connection
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      console.log('[Bridge WS] Replacing previous connection');
      this._ws.close(1001, 'Replaced');
    }

    ws.isAlive      = true;
    ws.bridgeAuthed = false;   // distinct property name, avoids any shadowing

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => this._onMessage(ws, raw));

    ws.on('close', (code, reason) => {
      console.log(`[Bridge WS] Closed (${code}) — ${reason?.toString() || 'no reason'}`);
      if (this._ws === ws) {
        this._ws = null;
        clearInterval(this._pingTimer);
        this._pingTimer = null;
        this.emit('disconnected');

        if (this._pending.size > 0) {
          console.log(`[Bridge WS] ${this._pending.size} pending job(s) — waiting ${RECONNECT_GRACE_MS / 1000}s for bridge to reconnect before failing them`);
          clearTimeout(this._disconnectTimer);
          this._disconnectTimer = setTimeout(
            () => this._failPendingJobs('Bridge disconnected and did not reconnect within 5 minutes'),
            RECONNECT_GRACE_MS,
          );
        }
      }
    });

    ws.on('error', (err) => {
      console.error(`[Bridge WS] Socket error: ${err.message}`);
    });

    // Close if auth not received within AUTH_TIMEOUT_MS
    const authTimer = setTimeout(() => {
      if (!ws.bridgeAuthed) {
        console.log('[Bridge WS] Auth timeout — closing');
        ws.terminate();
      }
    }, AUTH_TIMEOUT_MS);
    ws.once('close', () => clearTimeout(authTimer));
  }

  _onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!ws.bridgeAuthed) {
      if (msg.type !== 'auth') { ws.terminate(); return; }

      // Read secret at call-time so Railway env vars are always current
      const secret = process.env.BRIDGE_SECRET || '';
      if (!secret) {
        console.error('[Bridge WS] BRIDGE_SECRET env var is not set — rejecting auth');
        ws.send(JSON.stringify({ type: 'auth_fail', message: 'BRIDGE_SECRET not configured on server' }));
        ws.terminate();
        return;
      }
      if (msg.secret !== secret) {
        console.warn('[Bridge WS] Auth rejected — wrong secret');
        ws.send(JSON.stringify({ type: 'auth_fail', message: 'Invalid secret' }));
        ws.terminate();
        return;
      }

      ws.bridgeAuthed = true;
      this._ws = ws;
      ws.send(JSON.stringify({ type: 'auth_ok' }));
      console.log('[Bridge WS] Authenticated — bridge is live');

      // Cancel the disconnect grace timer — bridge came back in time
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
      default:              console.log(`[Bridge WS] Unknown type: ${msg.type}`);
    }
  }

  // Server-initiated pings keep Railway's reverse-proxy from dropping idle connections.
  // Uses ws-level ping frames (not application-level messages) so they work even
  // when the bridge is idle between submissions.
  _startServerPings() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      const ws = this._ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        clearInterval(this._pingTimer);
        return;
      }
      if (!ws.isAlive) {
        console.warn('[Bridge WS] Pong not received — terminating stale connection');
        ws.terminate();
        return;
      }
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
    console.log(`[Bridge WS] Status update for job ${msg.jobId}: ${msg.status} — ${msg.message}`);
  }

  _resendPendingJobs() {
    if (this._pending.size === 0) return;
    console.log(`[Bridge WS] Re-sending ${this._pending.size} pending job(s) to reconnected bridge`);
    for (const [jobId] of this._pending) {
      const payload = this._jobPayloads.get(jobId);
      if (payload && this._ws?.readyState === WebSocket.OPEN) {
        console.log(`[Bridge WS] Re-sending job ${jobId}`);
        this._ws.send(JSON.stringify(payload));
      }
    }
  }

  _failPendingJobs(reason) {
    console.log(`[Bridge WS] Failing ${this._pending.size} pending job(s): ${reason}`);
    for (const [jobId, p] of this._pending) {
      clearTimeout(p.timeout);
      this._jobPayloads.delete(jobId);
      this._jobStatuses.set(jobId, {
        status:    'failed',
        message:   reason,
        updatedAt: new Date().toISOString(),
      });
      if (p.async) {
        p.onResult?.(false, { error: reason });
      } else {
        p.reject(new Error(reason));
      }
    }
    this._pending.clear();
  }

  _handleResult(msg) {
    const p = this._pending.get(msg.jobId);
    if (!p) {
      // Late result — bridge finished a job after we already timed it out or failed it.
      // Update the status store so the polling endpoint shows the real outcome.
      console.log(`[Bridge WS] Late result for job ${msg.jobId} (${msg.success ? 'success' : 'failed'}) — updating status store`);
      this._jobStatuses.set(msg.jobId, {
        status:       msg.success ? 'completed' : 'failed',
        message:      msg.success ? 'Payment completed (late result)' : (msg.error || 'Bridge processing failed'),
        confirmation: msg.confirmation || null,
        updatedAt:    new Date().toISOString(),
      });
      this.emit('lateResult', msg);
      return;
    }
    clearTimeout(p.timeout);
    this._pending.delete(msg.jobId);
    this._jobPayloads.delete(msg.jobId);

    if (p.async) {
      // Async/fire-and-forget job — call result callback and update status store
      this._jobStatuses.set(msg.jobId, {
        status:       msg.success ? 'completed' : 'failed',
        message:      msg.success ? 'Your payment is sent!' : (msg.error || 'Bridge processing failed'),
        confirmation: msg.confirmation || null,
        updatedAt:    new Date().toISOString(),
      });
      p.onResult?.(msg.success, msg);
    } else {
      // Sync/promise-based job
      if (msg.success) p.resolve(msg);
      else p.reject(new Error(msg.error || 'Bridge processing failed'));
    }
  }

  getJobStatus(jobId) {
    return this._jobStatuses.get(jobId) || null;
  }

  // Fire-and-forget variant — returns jobId immediately, calls onResult when complete.
  // Use for jobs that may take a long time (e.g. first enrollment + payment).
  queueJob(job, onResult, timeoutMs = 6 * 60 * 60 * 1000) {
    if (!this.isConnected) {
      throw new Error('ACH Bridge is not connected. Start the bridge service on Computer 2.');
    }
    const jobId  = `job_${Date.now()}_${++this._jobSeq}`;
    const payload = { type: 'submit', jobId, ...job };

    this._jobStatuses.set(jobId, {
      status:    'processing',
      message:   'Bridge job queued',
      updatedAt: new Date().toISOString(),
    });

    const timeout = setTimeout(() => {
      this._jobStatuses.set(jobId, {
        status:    'failed',
        message:   `Timed out after ${Math.round(timeoutMs / 3_600_000)}h`,
        updatedAt: new Date().toISOString(),
      });
      this._pending.delete(jobId);
      this._jobPayloads.delete(jobId);
      onResult?.(false, { error: 'Bridge job timed out' });
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

  sendJob(job, timeoutMs = 180_000) {
    if (!this.isConnected) {
      return Promise.reject(new Error('ACH Bridge is not connected. Start the bridge service on Computer 2.'));
    }
    const jobId   = `job_${Date.now()}_${++this._jobSeq}`;
    const payload = { type: 'submit', jobId, ...job };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(jobId);
        this._jobPayloads.delete(jobId);
        reject(new Error(`Bridge job timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this._jobPayloads.set(jobId, payload);
      this._pending.set(jobId, { resolve, reject, timeout });
      this._ws.send(JSON.stringify(payload));
    });
  }
}

module.exports = new BridgeManager();
