const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username } });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ message: 'Password updated successfully' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

// GET /api/auth/preparer — return saved preparer info for this user
router.get('/preparer', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT preparer_info FROM users WHERE id = ?').get(req.user.id);
  const info = user?.preparer_info ? JSON.parse(user.preparer_info) : null;
  res.json(info || {});
});

// PUT /api/auth/preparer — save preparer info for this user
router.put('/preparer', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE users SET preparer_info = ? WHERE id = ?').run(JSON.stringify(req.body), req.user.id);
  res.json(req.body);
});

// ── Admin-only user management ────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user.id !== 1) return res.status(403).json({ error: 'Admin only' });
  next();
}

// GET /api/auth/users — list all users
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, created_at FROM users ORDER BY id').all();
  res.json(users);
});

// POST /api/auth/users — create a new user
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username.toLowerCase().trim(), hash);
  const newUser = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(newUser);
});

// DELETE /api/auth/users/:id — delete a user
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === 1) return res.status(400).json({ error: 'Cannot delete the admin account' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ message: 'User deleted' });
});

module.exports = router;
