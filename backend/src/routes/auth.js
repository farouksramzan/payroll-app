'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { getDb } = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function makeToken(user) {
  return jwt.sign(
    {
      id:         user.id,
      username:   user.username,
      role:       user.role       || 'admin',
      clientId:   user.client_id  || null,
      employeeId: user.employee_id || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );
}

function serializeUser(user) {
  return {
    id:           user.id,
    username:     user.username,
    email:        user.email        || null,
    role:         user.role         || 'admin',
    clientId:     user.client_id    || null,
    employeeId:   user.employee_id  || null,
    setupStep:    user.setup_step   || 0,
    setupComplete: !!user.setup_complete,
  };
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const db = getDb();
  // Allow login by username OR email
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(username.toLowerCase().trim(), username.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.password_hash) return res.status(401).json({ error: 'Account setup not complete — check your invite email' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = makeToken(user);
  res.json({ token, user: serializeUser(user) });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(serializeUser(user));
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ message: 'Password updated' });
});

// ── GET /api/auth/preparer ────────────────────────────────────────────────────
router.get('/preparer', requireAuth, (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT preparer_info FROM users WHERE id = ?').get(req.user.id);
  res.json(user?.preparer_info ? JSON.parse(user.preparer_info) : {});
});

// ── PUT /api/auth/preparer ────────────────────────────────────────────────────
router.put('/preparer', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE users SET preparer_info = ? WHERE id = ?').run(JSON.stringify(req.body), req.user.id);
  res.json(req.body);
});

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.trim().length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username.toLowerCase().trim(), hash);
  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ token: makeToken(newUser), user: serializeUser(newUser) });
});

// ── POST /api/auth/invite-client ──────────────────────────────────────────────
// Admin generates an invite link for an existing client.
// Creates a placeholder user (no password yet) and returns the invite URL.
router.post('/invite-client', requireAuth, requireAdmin, (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Check if a client user already exists for this client
  const existing = db.prepare("SELECT * FROM users WHERE client_id = ? AND role = 'client'").get(clientId);
  if (existing && existing.setup_complete) {
    return res.status(409).json({ error: 'This client already has an active account' });
  }

  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  if (existing) {
    // Refresh the invite token
    db.prepare('UPDATE users SET invite_token = ?, invite_expires_at = ? WHERE id = ?')
      .run(token, expires, existing.id);
  } else {
    // Create placeholder user
    const username = `client_${clientId}_${Date.now()}`;
    db.prepare(`
      INSERT INTO users (username, password_hash, role, client_id, invite_token, invite_expires_at)
      VALUES (?, '', 'client', ?, ?, ?)
    `).run(username, clientId, token, expires);
  }

  const inviteUrl = `${process.env.APP_URL || 'https://payroll-app-production-5dde.up.railway.app'}/invite/${token}`;
  res.json({ inviteUrl, clientName: client.business_name, expiresAt: expires });
});

// ── POST /api/auth/invite-employee ────────────────────────────────────────────
// Admin or client generates an invite for an existing employee.
router.post('/invite-employee', requireAuth, (req, res) => {
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: 'employeeId required' });

  const db = getDb();

  // Verify access: admin can invite any employee, client only their own
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  if (req.user.role === 'client' && emp.client_id !== req.user.clientId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const existing = db.prepare("SELECT * FROM users WHERE employee_id = ? AND role = 'employee'").get(employeeId);
  if (existing && existing.setup_complete) {
    return res.status(409).json({ error: 'This employee already has an active account' });
  }

  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  if (existing) {
    db.prepare('UPDATE users SET invite_token = ?, invite_expires_at = ? WHERE id = ?')
      .run(token, expires, existing.id);
  } else {
    const username = `emp_${employeeId}_${Date.now()}`;
    db.prepare(`
      INSERT INTO users (username, password_hash, role, employee_id, invite_token, invite_expires_at)
      VALUES (?, '', 'employee', ?, ?, ?)
    `).run(username, employeeId, token, expires);
  }

  const inviteUrl = `${process.env.APP_URL || 'https://payroll-app-production-5dde.up.railway.app'}/invite/${token}`;
  const name = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
  res.json({ inviteUrl, employeeName: name, expiresAt: expires });
});

// ── GET /api/auth/invite/:token ───────────────────────────────────────────────
// Validate an invite token and return info about who it's for.
router.get('/invite/:token', (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE invite_token = ?').get(req.params.token);
  if (!user) return res.status(404).json({ error: 'Invalid or expired invite link' });
  if (new Date(user.invite_expires_at) < new Date()) {
    return res.status(410).json({ error: 'This invite link has expired. Ask your accountant for a new one.' });
  }

  let name = '', clientName = '';
  if (user.role === 'client' && user.client_id) {
    const client = db.prepare('SELECT business_name FROM clients WHERE id = ?').get(user.client_id);
    name = client?.business_name || '';
    clientName = name;
  } else if (user.role === 'employee' && user.employee_id) {
    const emp = db.prepare('SELECT first_name, last_name FROM employees WHERE id = ?').get(user.employee_id);
    name = `${emp?.first_name || ''} ${emp?.last_name || ''}`.trim();
  }

  res.json({ role: user.role, name, clientName });
});

// ── POST /api/auth/accept-invite ──────────────────────────────────────────────
// Accept an invite: set email + password, activate the account.
router.post('/accept-invite', async (req, res) => {
  const { token, email, password } = req.body;
  if (!token || !email || !password) return res.status(400).json({ error: 'token, email, and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE invite_token = ?').get(token);
  if (!user) return res.status(404).json({ error: 'Invalid invite link' });
  if (new Date(user.invite_expires_at) < new Date()) {
    return res.status(410).json({ error: 'This invite link has expired' });
  }

  // Check email not already in use by another account
  const emailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.toLowerCase().trim(), user.id);
  if (emailTaken) return res.status(409).json({ error: 'An account with this email already exists' });

  const hash = await bcrypt.hash(password, 12);
  db.prepare(`
    UPDATE users SET
      email = ?, username = ?, password_hash = ?,
      invite_token = NULL, invite_expires_at = NULL,
      setup_step = 0, setup_complete = 0
    WHERE id = ?
  `).run(email.toLowerCase().trim(), email.toLowerCase().trim(), hash, user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ token: makeToken(updated), user: serializeUser(updated) });
});

// ── PATCH /api/auth/setup-step ────────────────────────────────────────────────
// Update onboarding progress for the current user.
router.patch('/setup-step', requireAuth, (req, res) => {
  const { step, complete } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET setup_step = ?, setup_complete = ? WHERE id = ?')
    .run(step ?? req.user.setupStep, complete ? 1 : 0, req.user.id);
  res.json({ setupStep: step, setupComplete: !!complete });
});

// ── Admin user management ─────────────────────────────────────────────────────
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const db    = getDb();
  const users = db.prepare('SELECT id, username, email, role, client_id, employee_id, created_at FROM users ORDER BY id').all();
  res.json(users);
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'Username is required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const hash   = await bcrypt.hash(password, 12);
  const result = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username.toLowerCase().trim(), hash);
  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(serializeUser(newUser));
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const db = getDb();
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(targetId)) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ message: 'User deleted' });
});

module.exports = router;
