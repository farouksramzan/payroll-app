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
        state                             TEXT DEFAULT 'TX',
        bank_account_number_encrypted     TEXT,
        bank_routing_number               TEXT,
        bank_account_type                 TEXT DEFAULT 'checking',
        batch_provider_pin_encrypted      TEXT NOT NULL,
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
        work_state     TEXT,
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
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id            INTEGER NOT NULL,
        employee_id          INTEGER,
        pay_period_start     TEXT NOT NULL,
        pay_period_end       TEXT NOT NULL,
        settlement_date      TEXT,
        gross_wages          REAL NOT NULL,
        filing_status        TEXT NOT NULL,
        pay_frequency        TEXT NOT NULL,
        step2_checkbox       INTEGER DEFAULT 0,
        step3_children       INTEGER DEFAULT 0,
        step3_other          INTEGER DEFAULT 0,
        step3_credits        REAL DEFAULT 0,
        step4a               REAL DEFAULT 0,
        step4b               REAL DEFAULT 0,
        step4c               REAL DEFAULT 0,
        fit_withholding      REAL NOT NULL,
        employee_ss          REAL NOT NULL,
        employee_medicare    REAL NOT NULL,
        employer_ss          REAL NOT NULL,
        employer_medicare    REAL NOT NULL,
        state_income_tax     REAL DEFAULT 0,
        futa_tax             REAL DEFAULT 0,
        suta_tax             REAL DEFAULT 0,
        work_state           TEXT,
        ytd_wages_before     REAL DEFAULT 0,
        total_deposit        REAL NOT NULL,
        net_pay              REAL,
        tax_year             INTEGER,
        tax_quarter          INTEGER,
        eftps_status         TEXT DEFAULT 'pending',
        eftps_confirmation   TEXT,
        eftps_submitted_at   TEXT,
        submission_error     TEXT,
        created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id)   REFERENCES clients(id)   ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS employee_ytd_wages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id     INTEGER NOT NULL,
        tax_year        INTEGER NOT NULL,
        ytd_gross       REAL DEFAULT 0,
        ytd_ss_wages    REAL DEFAULT 0,
        ytd_futa_wages  REAL DEFAULT 0,
        ytd_suta_wages  REAL DEFAULT 0,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, tax_year),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS paystubs (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id           INTEGER NOT NULL,
        employee_id         INTEGER,
        employee_name       TEXT,
        pay_period_start    TEXT NOT NULL,
        pay_period_end      TEXT NOT NULL,
        settlement_date     TEXT,
        pay_frequency       TEXT NOT NULL,
        filing_status       TEXT DEFAULT 'single',
        step2_checkbox      INTEGER DEFAULT 0,
        step3_credits       REAL DEFAULT 0,
        work_state          TEXT,
        gross_wages         REAL NOT NULL,
        fit_withholding     REAL DEFAULT 0,
        employee_ss         REAL DEFAULT 0,
        employee_medicare   REAL DEFAULT 0,
        additional_medicare REAL DEFAULT 0,
        employer_ss         REAL DEFAULT 0,
        employer_medicare   REAL DEFAULT 0,
        state_income_tax    REAL DEFAULT 0,
        futa_tax            REAL DEFAULT 0,
        suta_tax            REAL DEFAULT 0,
        total_deposit       REAL NOT NULL,
        net_pay             REAL DEFAULT 0,
        ytd_wages_before    REAL DEFAULT 0,
        tax_year            INTEGER,
        tax_quarter         INTEGER,
        status              TEXT DEFAULT 'pending',
        submitted_at        TEXT,
        eftps_confirmation  TEXT,
        submission_error    TEXT,
        notes               TEXT,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id)   REFERENCES clients(id)   ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS paystub_line_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        paystub_id  INTEGER NOT NULL,
        pay_type    TEXT NOT NULL,
        description TEXT,
        hours       REAL,
        rate        REAL,
        amount      REAL NOT NULL,
        FOREIGN KEY (paystub_id) REFERENCES paystubs(id) ON DELETE CASCADE
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
    { name: 'state',                             def: "TEXT DEFAULT 'TX'" },
  ]);

  // Rename eftps_pin_encrypted → batch_provider_pin_encrypted on existing databases
  const clientCols = db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name);
  if (clientCols.includes('eftps_pin_encrypted') && !clientCols.includes('batch_provider_pin_encrypted')) {
    db.exec('ALTER TABLE clients RENAME COLUMN eftps_pin_encrypted TO batch_provider_pin_encrypted');
  }

  // submissions columns added after v1
  addCols('submissions', [
    { name: 'step2_checkbox',    def: 'INTEGER DEFAULT 0' },
    { name: 'step3_children',    def: 'INTEGER DEFAULT 0' },
    { name: 'step3_other',       def: 'INTEGER DEFAULT 0' },
    { name: 'step3_credits',     def: 'REAL DEFAULT 0' },
    { name: 'step4a',            def: 'REAL DEFAULT 0' },
    { name: 'step4b',            def: 'REAL DEFAULT 0' },
    { name: 'step4c',            def: 'REAL DEFAULT 0' },
    { name: 'employee_id',       def: 'INTEGER' },
    { name: 'net_pay',           def: 'REAL' },
    { name: 'tax_year',          def: 'INTEGER' },
    { name: 'tax_quarter',       def: 'INTEGER' },
    { name: 'settlement_date',   def: 'TEXT' },
    { name: 'state_income_tax',  def: 'REAL DEFAULT 0' },
    { name: 'futa_tax',          def: 'REAL DEFAULT 0' },
    { name: 'suta_tax',          def: 'REAL DEFAULT 0' },
    { name: 'work_state',        def: 'TEXT' },
    { name: 'ytd_wages_before',  def: 'REAL DEFAULT 0' },
  ]);

  // employees columns added after v1
  addCols('employees', [
    { name: 'work_state', def: 'TEXT' },
  ]);

  // paystubs 940 tracking columns (status / eftps_confirmation track 941)
  addCols('paystubs', [
    { name: 'status_940',             def: "TEXT DEFAULT 'pending'" },
    { name: 'eftps_940_confirmation', def: 'TEXT' },
    { name: 'eftps_940_submitted_at', def: 'TEXT' },
  ]);

  // payroll schedule + sequential check numbers on clients
  addCols('clients', [
    { name: 'payroll_frequency',  def: "TEXT DEFAULT 'biweekly'" },
    { name: 'next_payroll_date',  def: 'TEXT' },
    { name: 'next_check_number',  def: 'INTEGER DEFAULT 1001' },
    { name: 'business_address',   def: 'TEXT' },
    { name: 'business_city',      def: 'TEXT' },
    { name: 'business_zip',       def: 'TEXT' },
  ]);

  // SUI independent status tracking
  addCols('paystubs', [
    { name: 'status_sui',           def: "TEXT DEFAULT 'pending'" },
    { name: 'eftps_settlement_date', def: 'TEXT' },
  ]);

  // check number + payroll run grouping + payment details on paystubs
  addCols('paystubs', [
    { name: 'check_number',    def: 'INTEGER' },
    { name: 'payroll_run_id',  def: 'TEXT' },
    { name: 'payment_method',  def: "TEXT DEFAULT 'pending'" },
    { name: 'regular_hours',   def: 'REAL' },
    { name: 'overtime_hours',  def: 'REAL' },
    { name: 'regular_pay',     def: 'REAL' },
    { name: 'overtime_pay',    def: 'REAL' },
    { name: 'bonus',           def: 'REAL DEFAULT 0' },
    { name: 'commission',      def: 'REAL DEFAULT 0' },
    { name: 'reimbursement',   def: 'REAL DEFAULT 0' },
    { name: 'deduction',       def: 'REAL DEFAULT 0' },
    { name: 'garnishment',     def: 'REAL DEFAULT 0' },
  ]);

  // first pay period anchor dates on employees
  addCols('employees', [
    { name: 'first_pay_period_start', def: 'TEXT' },
    { name: 'first_pay_period_end',   def: 'TEXT' },
  ]);

  // check lifecycle status + IRS settlement due date on paystubs
  addCols('paystubs', [
    { name: 'check_status',       def: "TEXT DEFAULT 'draft'" },
    { name: 'settlement_due_date',def: 'TEXT' },
    { name: 'voided_at',          def: 'TEXT' },
    { name: 'void_reason',        def: 'TEXT' },
  ]);

  // notification preferences on clients
  addCols('clients', [
    { name: 'notification_email', def: 'TEXT' },
    { name: 'notification_phone', def: 'TEXT' },
  ]);

  // EFTPS enrollment status — set to 1 once EFTPS confirms Active
  addCols('clients', [
    { name: 'eftps_enrolled', def: 'INTEGER DEFAULT 0' },
  ]);

  // paystub_credits — negative entries for voided checks
  db.exec(`
    CREATE TABLE IF NOT EXISTS paystub_credits (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id            INTEGER NOT NULL,
      employee_id          INTEGER,
      employee_name        TEXT,
      reference_stub_id    INTEGER,
      gross_credit         REAL DEFAULT 0,
      fit_credit           REAL DEFAULT 0,
      employee_ss_credit   REAL DEFAULT 0,
      employee_medicare_credit REAL DEFAULT 0,
      employer_ss_credit   REAL DEFAULT 0,
      employer_medicare_credit REAL DEFAULT 0,
      state_tax_credit     REAL DEFAULT 0,
      futa_credit          REAL DEFAULT 0,
      suta_credit          REAL DEFAULT 0,
      total_941_credit     REAL DEFAULT 0,
      total_940_credit     REAL DEFAULT 0,
      applied              INTEGER DEFAULT 0,
      applied_run_id       TEXT,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id)  REFERENCES clients(id)  ON DELETE CASCADE,
      FOREIGN KEY (employee_id)REFERENCES employees(id) ON DELETE SET NULL
    )
  `);

  // pay_groups — user-defined pay schedule groups
  db.exec(`
    CREATE TABLE IF NOT EXISTS pay_groups (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id             INTEGER NOT NULL,
      name                  TEXT NOT NULL,
      frequency             TEXT NOT NULL DEFAULT 'biweekly',
      first_pay_period_start TEXT,
      first_pay_period_end   TEXT,
      pay_date              TEXT,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `);

  addCols('pay_groups', [
    { name: 'pay_date',    def: 'TEXT' },
    { name: 'deleted_at', def: 'TEXT' },
  ]);

  addCols('employees', [
    { name: 'pay_group_id', def: 'INTEGER' },
  ]);

  addCols('paystubs', [
    { name: 'pay_group_id', def: 'INTEGER' },
  ]);

  // bridge job tracking — persists across page reloads
  addCols('paystubs', [
    { name: 'bridge_job_id',  def: 'TEXT' },
    { name: 'bridge_status',  def: 'TEXT' },
  ]);

  // Clean up orphaned draft paystubs that were never issued.
  // These accumulate when payroll runs fail mid-flight or employees are deleted.
  // Only draft records are removed — printed/deposited history is always preserved.
  const orphanByEmployee = db.prepare(`
    DELETE FROM paystubs
    WHERE check_status = 'draft'
      AND employee_id IS NOT NULL
      AND employee_id NOT IN (SELECT id FROM employees)
  `).run();
  if (orphanByEmployee.changes > 0)
    console.log(`[DB] Cleaned up ${orphanByEmployee.changes} orphaned draft paystub(s) with no matching employee`);

  const orphanByPayGroup = db.prepare(`
    DELETE FROM paystubs
    WHERE check_status = 'draft'
      AND pay_group_id IS NOT NULL
      AND pay_group_id NOT IN (SELECT id FROM pay_groups)
  `).run();
  if (orphanByPayGroup.changes > 0)
    console.log(`[DB] Cleaned up ${orphanByPayGroup.changes} orphaned draft paystub(s) with no matching pay group`);

  // notification_log — tracks sent notifications to avoid duplicates
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id      INTEGER NOT NULL,
      liability_type TEXT NOT NULL,
      due_date       TEXT NOT NULL,
      notif_type     TEXT NOT NULL,
      channel        TEXT NOT NULL,
      amount         REAL,
      success        INTEGER DEFAULT 1,
      sent_date      TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `);
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
