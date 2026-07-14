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
    { name: 'twc_username',                      def: 'TEXT' },
    { name: 'twc_password_encrypted',            def: 'TEXT' },
    { name: 'sui_rate_q1',                       def: 'REAL' },
    { name: 'sui_rate_q2',                       def: 'REAL' },
    { name: 'sui_rate_q3',                       def: 'REAL' },
    { name: 'sui_rate_q4',                       def: 'REAL' },
    { name: 'sui_account_number',                def: 'TEXT' },
  ]);
  addCols('employees', [
    { name: 'middle_name', def: 'TEXT' },
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

  // TWC/SUI county code for ICESA filing
  addCols('clients', [
    { name: 'county_code', def: 'TEXT' },
  ]);

  // SUI independent status tracking
  addCols('paystubs', [
    { name: 'status_sui',            def: "TEXT DEFAULT 'pending'" },
    { name: 'eftps_settlement_date', def: 'TEXT' },
  ]);
  // Sync status_sui for paystubs that were already submitted before the column existed
  db.exec("UPDATE paystubs SET status_sui = 'submitted' WHERE status = 'submitted' AND status_sui = 'pending'");

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

  // Bank name for check printing (e.g. "BANK OF AMERICA")
  addCols('clients', [
    { name: 'bank_name', def: 'TEXT' },
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

  // Direct deposit / Moov ACH fields on employees
  addCols('employees', [
    { name: 'bank_routing_number',           def: 'TEXT' },
    { name: 'bank_account_number_encrypted', def: 'TEXT' },
    { name: 'bank_account_type',             def: "TEXT DEFAULT 'checking'" },
    { name: 'bank_account_last4',            def: 'TEXT' },
    { name: 'bank_account_status',           def: "TEXT DEFAULT 'none'" },
    { name: 'moov_account_id',               def: 'TEXT' },
    { name: 'moov_bank_account_id',          def: 'TEXT' },
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

  // Fix paystubs erroneously imported with status='completed' — 'completed' is not
  // a valid 941 status (valid: pending, processing, submitted, failed). These were
  // set by an early version of the QB paycheck import. Reset to 'pending' so they
  // appear in Pay Liabilities.
  const fixedImportStatus = db.prepare(
    "UPDATE paystubs SET status = 'pending' WHERE status = 'completed'"
  ).run();
  if (fixedImportStatus.changes > 0)
    console.log(`[DB] Fixed ${fixedImportStatus.changes} paystub(s) with invalid status='completed' → 'pending'`);

  // reported_tips — display-only tip amount stored separately; taxes are already
  // computed from gross (which includes tips). Does not trigger recalculation.
  addCols('paystubs', [
    { name: 'reported_tips', def: 'REAL DEFAULT 0' },
  ]);

  // Backfill reported_tips from existing paystub_line_items for checks that were
  // imported before the column existed (they have line items but reported_tips = 0).
  db.exec(`
    UPDATE paystubs
    SET reported_tips = (
      SELECT COALESCE(SUM(amount), 0)
      FROM paystub_line_items
      WHERE paystub_id = paystubs.id AND pay_type = 'tips'
    )
    WHERE (reported_tips IS NULL OR reported_tips = 0)
      AND EXISTS (
        SELECT 1 FROM paystub_line_items
        WHERE paystub_id = paystubs.id AND pay_type = 'tips'
      )
  `);

  // preparer_info — per-user tax preparer details for autofilling forms
  addCols('users', [
    { name: 'preparer_info',      def: 'TEXT' },
    { name: 'role',               def: "TEXT NOT NULL DEFAULT 'admin'" },
    { name: 'client_id',          def: 'INTEGER' },
    { name: 'employee_id',        def: 'INTEGER' },
    { name: 'email',              def: 'TEXT' },
    { name: 'invite_token',       def: 'TEXT' },
    { name: 'invite_expires_at',  def: 'DATETIME' },
    { name: 'setup_step',         def: 'INTEGER DEFAULT 0' },
    { name: 'setup_complete',     def: 'INTEGER DEFAULT 0' },
  ]);

  // w4_submitted — 1 once the employee has explicitly saved their W-4 via the portal
  // onboarding_done — 1 once the employee completes the initial setup wizard
  addCols('employees', [
    { name: 'w4_submitted',    def: 'INTEGER DEFAULT 0' },
    { name: 'onboarding_done', def: 'INTEGER DEFAULT 0' },
  ]);

  // join_code — short code employees enter to self-register under a company
  // self_registered — 1 if the company signed up via the self-service form
  // onboarding_done — 1 once the company completes the onboarding wizard
  addCols('clients', [
    { name: 'join_code',        def: 'TEXT' },
    { name: 'self_registered',  def: 'INTEGER DEFAULT 0' },
    { name: 'onboarding_done',  def: 'INTEGER DEFAULT 0' },
  ]);

  // Backfill join codes for existing clients that don't have one
  const cryptoMod = require('crypto');
  const joinCodeChars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const clientsNeedingCode = db.prepare("SELECT id FROM clients WHERE join_code IS NULL OR join_code = ''").all();
  for (const c of clientsNeedingCode) {
    let code, attempts = 0;
    do {
      const bytes = cryptoMod.randomBytes(6);
      code = '';
      for (let i = 0; i < 6; i++) code += joinCodeChars[bytes[i] % joinCodeChars.length];
      attempts++;
    } while (db.prepare('SELECT id FROM clients WHERE join_code = ?').get(code) && attempts < 100);
    db.prepare('UPDATE clients SET join_code = ? WHERE id = ?').run(code, c.id);
  }
  if (clientsNeedingCode.length > 0)
    console.log(`[DB] Generated join codes for ${clientsNeedingCode.length} client(s)`);

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

  // twc_submissions — TWC QuickFile bridge submission jobs
  db.exec(`
    CREATE TABLE IF NOT EXISTS twc_submissions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL,
      client_id           INTEGER NOT NULL,
      quarter             INTEGER NOT NULL,
      year                INTEGER NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      icesa_content       TEXT,
      filename            TEXT,
      confirmation_number TEXT,
      error               TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `);

  // twc_payments — TWC SUI online payment jobs
  db.exec(`
    CREATE TABLE IF NOT EXISTS twc_payments (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL,
      client_id           INTEGER NOT NULL,
      twc_account_number  TEXT NOT NULL,
      amount              REAL NOT NULL,
      payment_date        TEXT NOT NULL,
      bank_name           TEXT,
      status              TEXT NOT NULL DEFAULT 'pending',
      confirmation_number TEXT,
      bank_name_confirmed TEXT,
      error               TEXT,
      job_id              TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `);

  // ── client_accountants — additional accountants a client has granted access to.
  // The primary owner is still clients.user_id; rows here grant extra admin users
  // access to the same company from their own logins (many accountants ↔ 1 company).
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_accountants (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id   INTEGER NOT NULL,
      user_id     INTEGER NOT NULL,
      invited_by  INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(client_id, user_id),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
    )
  `);

  // ── accountant_invites — one-time codes a client generates to invite an
  // accountant. Redeeming one creates a client_accountants grant. Codes expire.
  db.exec(`
    CREATE TABLE IF NOT EXISTS accountant_invites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id   INTEGER NOT NULL,
      code        TEXT UNIQUE NOT NULL,
      created_by  INTEGER,
      expires_at  TEXT,
      used_at     TEXT,
      used_by     INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `);

  // ── accountant_bulk_invites — one code that grants a redeeming accountant access
  // to ALL companies the inviting accountant can manage (instead of one code per
  // company). mode='snapshot' grants the companies that exist at redeem time;
  // mode='sync' also records an accountant_sync_links row so companies the inviter
  // adds later are shared automatically.
  db.exec(`
    CREATE TABLE IF NOT EXISTS accountant_bulk_invites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT UNIQUE NOT NULL,
      created_by  INTEGER NOT NULL,
      mode        TEXT NOT NULL DEFAULT 'snapshot',
      expires_at  TEXT,
      used_at     TEXT,
      used_by     INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ── accountant_sync_links — a standing "share everything" relationship created by
  // redeeming a mode='sync' bulk invite. Whenever source_user_id adds a new company,
  // target_user_id is automatically granted access to it (see propagateSyncForSource).
  db.exec(`
    CREATE TABLE IF NOT EXISTS accountant_sync_links (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      source_user_id INTEGER NOT NULL,
      target_user_id INTEGER NOT NULL,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_user_id, target_user_id),
      FOREIGN KEY (source_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ── Global: link unlinked paystubs to employees by fuzzy first+last name ─────
  // Runs on every startup; idempotent (only touches rows where employee_id IS NULL).
  // Fixes imported paychecks that had middle initials in QB names (e.g. "SHADI D AHVAZI").
  try {
    const allClients2 = db.prepare('SELECT id FROM clients').all();
    let totalLinked = 0;
    for (const c of allClients2) {
      const empList = db.prepare('SELECT id, first_name, last_name FROM employees WHERE client_id=?').all(c.id);
      for (const e of empList) {
        const fn = e.first_name.toUpperCase();
        const ln = e.last_name.toUpperCase();
        const { changes } = db.prepare(
          `UPDATE paystubs SET employee_id=? WHERE client_id=? AND employee_id IS NULL AND UPPER(employee_name) LIKE ? AND UPPER(employee_name) LIKE ?`
        ).run(e.id, c.id, `%${fn}%`, `%${ln}%`);
        totalLinked += changes;
      }
    }
    // Reset submitted → pending for any client (imported with wrong liability status)
    const { changes: resetChanges } = db.prepare(`UPDATE paystubs SET status='pending', status_940='pending' WHERE status='submitted' AND check_status NOT IN ('voided')`).run();
    if (totalLinked > 0) console.log(`[DB] startup: linked ${totalLinked} unlinked paystub(s) to employees`);
    if (resetChanges > 0) console.log(`[DB] startup: reset ${resetChanges} submitted→pending liability status(es)`);
  } catch (e) {
    console.error('[DB] startup employee link failed:', e.message);
  }

  // ── Recalculate net_pay from stored tax components — idempotent ─────────────
  // Fixes checks where net_pay was stored with an old/incorrect FIT value.
  // Safe to leave permanently: only updates rows where the calculation disagrees.
  try {
    const round2 = n => Math.round(n * 100) / 100;
    const allStubs = db.prepare(`
      SELECT id, gross_wages, fit_withholding, employee_ss, employee_medicare,
             additional_medicare, state_income_tax, deduction, garnishment, reimbursement, net_pay
      FROM paystubs
      WHERE check_status NOT IN ('voided','draft') AND net_pay > 0
    `).all();
    let fixed = 0;
    for (const s of allStubs) {
      const expected = round2(
        s.gross_wages
        - s.fit_withholding
        - s.employee_ss
        - s.employee_medicare
        - s.additional_medicare
        - s.state_income_tax
        - (s.deduction    || 0)
        - (s.garnishment  || 0)
        + (s.reimbursement || 0)
      );
      if (Math.abs(expected - s.net_pay) >= 0.01) {
        db.prepare('UPDATE paystubs SET net_pay=? WHERE id=?').run(expected, s.id);
        fixed++;
      }
    }
    if (fixed > 0) console.log(`[DB] net_pay recalc: fixed ${fixed} paystub(s)`);
  } catch (e) {
    console.error('[DB] net_pay recalc failed:', e.message);
  }

  // ── One-time PIN fixes — run once, idempotent via eftps_enrolled check ───────
  try {
    const { encrypt } = require('../services/cryptoService');
    // Balaji 24 — EIN 331912942, PIN 1404
    const balaji = db.prepare("SELECT id FROM clients WHERE REPLACE(REPLACE(ein,'-',''),' ','') = '331912942' AND (eftps_enrolled IS NULL OR eftps_enrolled = 0) AND (batch_provider_pin_encrypted IS NULL OR batch_provider_pin_encrypted = '')").get();
    if (balaji) {
      db.prepare('UPDATE clients SET batch_provider_pin_encrypted = ?, eftps_enrolled = 1 WHERE id = ?')
        .run(encrypt('1404'), balaji.id);
      console.log('[DB] Balaji 24 PIN set to 1404, marked eftps_enrolled=1');
    }
  } catch (e) {
    console.error('[DB] One-time PIN migration failed:', e.message);
  }
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
