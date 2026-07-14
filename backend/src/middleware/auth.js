'use strict';

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireClient(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!['admin', 'client'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  next();
}

function requireEmployee(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!['admin', 'client', 'employee'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  next();
}

function canAccessClient(db, clientId, user) {
  const id = parseInt(clientId, 10);
  if (isNaN(id)) return null;
  if (user.role === 'admin') {
    // Accessible if this admin is the primary owner OR was granted access as an
    // additional accountant (client_accountants). Returns the full client row.
    return db.prepare(`
      SELECT * FROM clients
      WHERE id = ?
        AND (user_id = ? OR id IN (SELECT client_id FROM client_accountants WHERE user_id = ?))
    `).get(id, user.id, user.id) || null;
  }
  if (user.role === 'client') {
    if (user.clientId !== id) return null;
    return db.prepare('SELECT * FROM clients WHERE id = ?').get(id) || null;
  }
  return null;
}

// SQL fragment (+ params) for "clients this admin can access" — primary owner OR
// granted as an additional accountant. `col` is the client-id column to match
// (e.g. 'id' or 'client_id'). Use for list / IN(...) queries where a single-row
// canAccessClient check doesn't fit.
function accessibleClientsCond(col, userId) {
  return {
    sql: `(${col} IN (SELECT id FROM clients WHERE user_id = ?) OR ${col} IN (SELECT client_id FROM client_accountants WHERE user_id = ?))`,
    params: [userId, userId],
  };
}

module.exports = { requireAuth, requireAdmin, requireClient, requireEmployee, canAccessClient, accessibleClientsCond };
