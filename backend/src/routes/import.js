const express = require('express');
const multer  = require('multer');
const xlsx    = require('xlsx');
const { getDb } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { encrypt } = require('../services/cryptoService');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseQbEmployeeRow(row) {
  // Split "FIRST LAST" — first word = first name, rest = last name
  const fullName = (row['Employee'] || '').trim();
  const spaceIdx = fullName.indexOf(' ');
  const firstName = spaceIdx > -1 ? fullName.slice(0, spaceIdx) : fullName;
  const lastName  = spaceIdx > -1 ? fullName.slice(spaceIdx + 1) : '';

  // QB Desktop exports SSN as "SS No." — value may be a string "XXX-XX-XXXX"
  // or a raw number 123456789 if Excel stripped the dashes.
  const ssnRaw = row['SS No.'] ?? row['SS#'] ?? row['SSN'] ?? row['Social Security Number'] ?? '';
  let ssn = '';
  if (typeof ssnRaw === 'number') {
    // Zero-pad to 9 digits, then format as XXX-XX-XXXX
    const digits = String(ssnRaw).padStart(9, '0');
    ssn = `${digits.slice(0,3)}-${digits.slice(3,5)}-${digits.slice(5)}`;
  } else {
    ssn = String(ssnRaw).trim();
  }

  // Address field in QB exports includes "STREET CITY, ST ZIP" — strip city/state/zip suffix
  let address = (row['Address'] || '').trim();
  const city  = (row['City']  || '').trim();
  const state = (row['State'] || '').trim();
  const zip   = String(row['Zip'] || '').trim();
  if (city && address.toUpperCase().includes(city.toUpperCase())) {
    const suffix = ` ${city}`.toUpperCase();
    const idx = address.toUpperCase().lastIndexOf(suffix);
    if (idx > 0) address = address.slice(0, idx).trim();
  }

  // Date of Birth is an Excel serial number — convert for display only (not stored)
  let dob = '';
  if (row['Date of Birth'] && typeof row['Date of Birth'] === 'number') {
    const d = xlsx.SSF.parse_date_code(row['Date of Birth']);
    if (d) dob = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }

  return { firstName, lastName, ssn, address, city, state, zip, dob };
}

// POST /api/import/employees/preview
// Body: multipart with field "file" (xlsx/csv) and "clientId"
router.post('/employees/preview', upload.single('file'), (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const db = getDb();
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });

    // Use second sheet if first is QuickBooks tips sheet, otherwise first sheet
    let sheetName = wb.SheetNames[0];
    if (wb.SheetNames.length > 1 && sheetName.toLowerCase().includes('quickbooks')) {
      sheetName = wb.SheetNames[1];
    }
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
    if (rows[0]) console.log('[import preview] columns:', Object.keys(rows[0]), '| SS No. sample:', rows[0]['SS No.'], typeof rows[0]['SS No.']);

    const existing = db.prepare('SELECT first_name, last_name FROM employees WHERE client_id = ?').all(clientId);
    const existingNames = new Set(existing.map(e => `${e.first_name}|${e.last_name}`.toUpperCase()));

    const preview = rows
      .map(row => parseQbEmployeeRow(row))
      .filter(r => r.firstName && r.lastName)
      .map(r => ({
        ...r,
        alreadyExists: existingNames.has(`${r.firstName}|${r.lastName}`.toUpperCase()),
      }));

    res.json({ count: preview.length, rows: preview });
  } catch (err) {
    res.status(400).json({ error: `Could not parse file: ${err.message}` });
  }
});

// POST /api/import/employees
// Body: multipart with field "file" (xlsx/csv), "clientId", optional "skipExisting"
router.post('/employees', upload.single('file'), (req, res) => {
  const { clientId, skipExisting } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(clientId, req.user.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });

    let sheetName = wb.SheetNames[0];
    if (wb.SheetNames.length > 1 && sheetName.toLowerCase().includes('quickbooks')) {
      sheetName = wb.SheetNames[1];
    }
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

    const existing = db.prepare('SELECT first_name, last_name FROM employees WHERE client_id = ?').all(clientId);
    const existingNames = new Set(existing.map(e => `${e.first_name}|${e.last_name}`.toUpperCase()));

    const insert = db.prepare(`
      INSERT INTO employees
        (client_id, first_name, last_name, ssn_encrypted, address, city, state, zip, work_state,
         filing_status, pay_type, hourly_rate, annual_salary, pay_frequency, is_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
    `);

    const insertMany = db.transaction((records) => {
      let imported = 0, skipped = 0;
      for (const r of records) {
        const key = `${r.firstName}|${r.lastName}`.toUpperCase();
        if (skipExisting === 'true' && existingNames.has(key)) { skipped++; continue; }
        const homeState = r.state || client.state || 'TX';
        insert.run(
          clientId,
          r.firstName,
          r.lastName,
          r.ssn ? encrypt(r.ssn) : null,
          r.address || null,
          r.city    || null,
          homeState,
          r.zip     || null,
          homeState,  // work_state defaults to same as home state
          'single',
          'hourly',
          0,
          0,
          client.payroll_frequency || 'biweekly',
        );
        imported++;
      }
      return { imported, skipped };
    });

    const parsed = rows
      .map(row => parseQbEmployeeRow(row))
      .filter(r => r.firstName && r.lastName);

    const result = insertMany(parsed);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  }
});

module.exports = router;
