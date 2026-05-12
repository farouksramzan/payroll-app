/**
 * Railway-side WebSocket bridge manager.
 *
 * Uses noServer mode + manual upgrade handling so the WebSocket handshake
 * is intercepted at the http.Server level — before Express can touch the
 * request. This is required when sitting behind a reverse proxy (Railway,
 * nginx) that may not set Connection: Upgrade reliably.
 */

'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const EventEmitter = require('events');

const BRIDGE_PATH = '/ws/bridge';
const SECRET      = process.env.BRIDGE_SECRET || '';

class BridgeManager extends EventEmitter {
  constructor() {
    super();
    this._ws      = null;
    this._wss     = null;
    this._pending = new Map(); // jobId → { resolve, reject, timeout }
    this._jobSeq  = 0;
  }

  /**
   * Attach to an existing http.Server.
   * Must be called before httpServer.listen().
   */
  attach(httpServer) {
    // noServer: true — we drive the upgrade ourselves
    this._wss = new WebSocketServer({ noServer: true });
    this._wss.on('connection', (ws, req) => this._onConnection(ws, req));

    httpServer.on('upgrade', (req, socket, head) => {
      // Only handle requests to our bridge path
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

    console.log(`[Bridge WS] Upgrade handler registered for ${BRIDGE_PATH}`);
    return this._wss;
  }

  _onConnection(ws, req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[Bridge WS] Connection from ${ip}`);

    // Single-client model — drop stale connection
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      console.log('[Bridge WS] Replacing previous bridge connection');
      this._ws.close(1001, 'Replaced by new connection');
    }

    ws.authenticated = false;

    ws.on('message', (raw) => this._onMessage(ws, raw));

    ws.on('close', (code, reason) => {
      const why = reason?.toString() || 'no reason';
      console.log(`[Bridge WS] Disconnected (${code}) — ${why}`);
      if (this._ws === ws) {
        this._ws = null;
        this.emit('disconnected');
        for (const [, p] of this._pending) {
          clearTimeout(p.timeout);
          p.reject(new Error('Bridge disconnected before job result arrived'));
        }
        this._pending.clear();
      }
    });

    ws.on('error', (err) => {
      console.error(`[Bridge WS] Socket error: ${err.message}`);
    });

    // Kick off auth timeout — close if no auth within 10s
    const authTimer = setTimeout(() => {
      if (!ws.authenticated) {
        console.log('[Bridge WS] Auth timeout — closing unauthenticated connection');
        ws.close(1008, 'Auth timeout');
      }
    }, 10_000);
    ws.once('close', () => clearTimeout(authTimer));
  }

  _onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!ws.authenticated) {
      if (msg.type !== 'auth') {
        ws.close(1008, 'Authenticate first');
        return;
      }
      if (!SECRET) {
        ws.send(JSON.stringify({ type: 'auth_fail', message: 'BRIDGE_SECRET not configured on server' }));
        ws.close(1008, 'Auth failed');
        return;
      }
      if (msg.secret !== SECRET) {
        ws.send(JSON.stringify({ type: 'auth_fail', message: 'Invalid secret' }));
        ws.close(1008, 'Auth failed');
        return;
      }
      ws.authenticated = true;
      this._ws = ws;
      ws.send(JSON.stringify({ type: 'auth_ok' }));
      console.log('[Bridge WS] Authenticated — bridge is live');
      this.emit('connected');
      return;
    }

    switch (msg.type) {
      case 'result':
        this._handleResult(msg);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      default:
        console.log(`[Bridge WS] Unknown message type: ${msg.type}`);
    }
  }

  _handleResult(msg) {
    const p = this._pending.get(msg.jobId);
    if (!p) return;
    clearTimeout(p.timeout);
    this._pending.delete(msg.jobId);
    if (msg.success) {
      p.resolve(msg);
    } else {
      p.reject(new Error(msg.error || 'Bridge processing failed'));
    }
  }

  get isConnected() {
    return this._ws?.readyState === WebSocket.OPEN && this._ws.authenticated === true;
  }

  /**
   * Send a submission job to the bridge and wait for the result.
   * @param {object} job
   * @param {number} [timeoutMs=180000]
   * @returns {Promise<object>}
   */
  sendJob(job, timeoutMs = 180_000) {
    if (!this.isConnected) {
      return Promise.reject(new Error('ACH Bridge is not connected. Start the bridge service on Computer 2.'));
    }

    const jobId   = `job_${Date.now()}_${++this._jobSeq}`;
    const payload = { type: 'submit', jobId, ...job };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(jobId);
        reject(new Error(`Bridge job timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      this._pending.set(jobId, { resolve, reject, timeout });
      this._ws.send(JSON.stringify(payload));
    });
  }
}

module.exports = new BridgeManager();
