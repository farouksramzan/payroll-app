const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../../data/payroll.db');
let db;

function getDb() {
  if (db) return db;

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    initSchema();
  } catch (err) {
    console.error('[DB] Schema init failed:', err.message);
    throw err;
  }

  return db;
}

function initSchema() {
  // Run each CREATE TABLE individually inside a transaction so any failure
  // is atomic and the error message identifies the exact statement.
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id                                INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id                           INTEGER NOT NULL,
        business_name                     TEXT NOT NULL,
        ein                               TEXT NOT NULL,
        bank_account_number_encrypted     TEXT,
        bank_routing_number               TEXT,
        bank_account_type                 TEXT DEFAULT 'checking',
        eftps_pin_encrypted               TEXT NOT NULL,
        eftps_internet_password_encrypted TEXT,
        eftps_enrollment_number           TEXT,
        suta_rate                         REAL DEFAULT 0.027,
        deposit_schedule                  TEXT DEFAULT 'monthly',
        contact_name                      TEXT,
        contact_email                     TEXT,
        contact_phone                     TEXT,
        created_at                        DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at                        DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS employees (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id      INTEGER NOT NULL,
        first_name     TEXT NOT NULL,
        last_name      TEXT NOT NULL,
        ssn_encrypted  TEXT,
        address        TEXT,
        city           TEXT,
        state          TEXT DEFAULT 'TX',
        zip            TEXT,
        filing_status  TEXT DEFAULT 'single',
        step2_checkbox INTEGER DEFAULT 0,
        step3_children INTEGER DEFAULT 0,
        step3_other    INTEGER DEFAULT 0,
        step4a         REAL DEFAULT 0,
        step4b         REAL DEFAULT 0,
        step4c         REAL DEFAULT 0,
        pay_type       TEXT DEFAULT 'hourly',
        hourly_rate    REAL DEFAULT 0,
        annual_salary  REAL DEFAULT 0,
        pay_frequency  TEXT DEFAULT 'biweekly',
        is_active      INTEGER DEFAULT 1,
        hire_date      TEXT,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS submissions (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id          INTEGER NOT NULL,
        employee_id        INTEGER,
        pay_period_start   TEXT NOT NULL,
        pay_period_end     TEXT NOT NULL,
        settlement_date    TEXT,
        gross_wages        REAL NOT NULL,
        filing_status      TEXT NOT NULL,
        pay_frequency      TEXT NOT NULL,
        step2_checkbox     INTEGER DEFAULT 0,
        step3_children     INTEGER DEFAULT 0,
        step3_other        INTEGER DEFAULT 0,
        step3_credits      REAL DEFAULT 0,
        step4a             REAL DEFAULT 0,
        step4b             REAL DEFAULT 0,
        step4c             REAL DEFAULT 0,
        fit_withholding    REAL NOT NULL,
        employee_ss        REAL NOT NULL,
        employee_medicare  REAL NOT NULL,
        employer_ss        REAL NOT NULL,
        employer_medicare  REAL NOT NULL,
        total_deposit      REAL NOT NULL,
        net_pay            REAL,
        tax_year           INTEGER,
        tax_quarter        INTEGER,
        eftps_status       TEXT DEFAULT 'pending',
        eftps_confirmation TEXT,
        eftps_submitted_at TEXT,
        submission_error   TEXT,
        created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id)  REFERENCES clients(id)   ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS pay_line_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL,
        pay_type      TEXT NOT NULL,
        description   TEXT,
        hours         REAL,
        rate          REAL,
        amount        REAL NOT NULL,
        FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
      )
    `);
  })();

  // Add any columns introduced after the initial schema (idempotent)
  migrate();

  // Seed default admin user on a brand-new database
  const { count } = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (count === 0) {
    const hash = bcrypt.hashSync('admin123', 12);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('[DB] Default user created → username: admin  password: admin123');
  }
}

// Adds columns to existing databases that were created before those columns
// were added to the CREATE TABLE statement above. Safe to run on fresh DBs
// because addCols() skips columns that already exist.
function migrate() {
  // clients columns added after v1
  addCols('clients', [
    { name: 'eftps_internet_password_encrypted', def: 'TEXT' },
    { name: 'eftps_enrollment_number',           def: 'TEXT' },
    { name: 'suta_rate',                         def: 'REAL DEFAULT 0.027' },
  ]);

  // submissions columns added after v1
  addCols('submissions', [
    { name: 'step2_checkbox',  def: 'INTEGER DEFAULT 0' },
    { name: 'step3_children',  def: 'INTEGER DEFAULT 0' },
    { name: 'step3_other',     def: 'INTEGER DEFAULT 0' },
    { name: 'step3_credits',   def: 'REAL DEFAULT 0' },
    { name: 'step4a',          def: 'REAL DEFAULT 0' },
    { name: 'step4b',          def: 'REAL DEFAULT 0' },
    { name: 'step4c',          def: 'REAL DEFAULT 0' },
    { name: 'employee_id',     def: 'INTEGER' },
    { name: 'net_pay',         def: 'REAL' },
    { name: 'tax_year',        def: 'INTEGER' },
    { name: 'tax_quarter',     def: 'INTEGER' },
    { name: 'settlement_date', def: 'TEXT' },
  ]);
}

function addCols(table, cols) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const { name, def } of cols) {
    if (!existing.includes(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    }
  }
}

module.exports = { getDb };
