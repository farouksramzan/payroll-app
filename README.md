# PayrollTax Pro

Professional payroll tax management and EFTPS submission tool for accountants managing multiple clients.

## Features

- **Client Management** — Add/edit clients with EIN, EFTPS PIN (AES-256 encrypted), bank info, deposit schedule
- **Payroll Tax Calculator** — FIT withholding (2024 IRS Percentage Method), employee/employer SS & Medicare
- **EFTPS Automation** — Playwright-driven browser automation to submit federal tax deposits
- **Submission History** — Full audit log with per-client and global views, click-to-expand detail rows
- **JWT Auth** — Token-based login protecting all API routes

## Tech Stack

| Layer    | Technology                              |
|----------|-----------------------------------------|
| Frontend | React 18, React Router 6, Vite          |
| Backend  | Node.js, Express 4                      |
| Database | SQLite via better-sqlite3               |
| Automation | Playwright (Chromium)                 |
| Security | AES-256-CBC encryption, bcrypt, JWT     |

---

## Prerequisites

- **Node.js** 18+ and npm
- **Playwright browsers** (installed separately after npm install)

---

## Installation

### 1. Install root dependencies

```bash
cd "Payroll App"
npm install
```

### 2. Install backend dependencies

```bash
cd backend
npm install
npx playwright install chromium
cd ..
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

---

## Configuration

The backend ships with a development `.env`. **Before going to production**, update `backend/.env`:

```env
PORT=3001

# Change to a random 64+ character string
JWT_SECRET=your_long_random_secret_here

# Must be exactly 32 characters — used for AES-256 PIN encryption
ENCRYPTION_KEY=your_32_char_encryption_key_here

NODE_ENV=production

# Set to false only when ready to submit LIVE payments to EFTPS
EFTPS_DRY_RUN=true
```

> **Security:** Never commit `.env` to source control. The `.gitignore` already excludes it.

---

## Running the App

### Development (both servers with hot reload)

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

### Production

```bash
npm run build        # Build frontend
npm run start        # Start backend (serves API only)
```

---

## Default Login

| Username | Password  |
|----------|-----------|
| `admin`  | `admin123` |

**Change the password immediately** after first login via the API:

```bash
curl -X POST http://localhost:3001/api/auth/change-password \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"admin123","newPassword":"YourNewSecurePassword"}'
```

---

## Tax Calculation Details

Uses the **2024 IRS Percentage Method** (Publication 15-T):

| Tax | Rate | Notes |
|-----|------|-------|
| Federal Income Tax | 10–37% brackets | Based on annualized wages, filing status, and allowances |
| Employee Social Security | 6.2% | Up to $168,600 annual wage base |
| Employer Social Security | 6.2% match | |
| Employee Medicare | 1.45% | No wage base limit |
| Employer Medicare | 1.45% match | |

The total EFTPS deposit = FIT + employee SS + employee Medicare + employer SS + employer Medicare.

---

## EFTPS Automation

The Playwright script (`backend/src/services/eftpsAutomation.js`) automates:

1. Navigate to `eftps.gov`
2. Fill EIN and PIN on the login form
3. Navigate to the tax payment form
4. Enter amounts for FIT withholding, Social Security, and Medicare
5. Submit and capture the confirmation number

### Dry Run Mode (default)

By default `EFTPS_DRY_RUN=true` — the script locates and fills the login form but **does not click Submit**. Use this to verify credentials and connectivity before enabling live submissions.

### Enabling Live Submissions

Set `EFTPS_DRY_RUN=false` in `backend/.env`. The backend must have outbound internet access to `eftps.gov`.

### Troubleshooting

- Screenshots are saved to `data/screenshots/` on every run (and on error)
- If selectors break due to EFTPS site changes, update `eftpsAutomation.js` — look for `page.locator(...)` calls
- Run with `headless: false` in eftpsAutomation.js temporarily to watch the browser in real time

---

## Project Structure

```
Payroll App/
├── backend/
│   ├── server.js                   # Express app entry
│   ├── .env                        # Secrets (gitignored)
│   └── src/
│       ├── database/db.js          # SQLite init + schema
│       ├── middleware/auth.js      # JWT middleware
│       ├── routes/
│       │   ├── auth.js             # Login, change password
│       │   ├── clients.js          # Client CRUD
│       │   ├── payroll.js          # Tax calculation endpoint
│       │   └── submissions.js      # Submission CRUD + EFTPS trigger
│       └── services/
│           ├── cryptoService.js    # AES-256 encrypt/decrypt
│           ├── taxCalculator.js    # FIT + FICA calculation
│           └── eftpsAutomation.js  # Playwright EFTPS automation
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Login.jsx
│       │   ├── Dashboard.jsx       # Client overview + stats
│       │   ├── ClientForm.jsx      # Add / edit client
│       │   ├── ClientDetail.jsx    # Client info + recent history
│       │   ├── PayrollEntry.jsx    # 3-step payroll entry + submission
│       │   └── SubmissionHistory.jsx
│       ├── components/
│       │   ├── Layout.jsx          # Sidebar nav shell
│       │   ├── Modal.jsx
│       │   └── ProtectedRoute.jsx
│       ├── api/client.js           # Fetch wrapper
│       └── contexts/AuthContext.jsx
└── data/                           # Auto-created; gitignored
    ├── payroll.db
    └── screenshots/
```

---

## Security Notes

- EFTPS PINs are encrypted with AES-256-CBC before storage; the plaintext never touches the database
- Bank account numbers use the same encryption
- All API routes require a valid JWT (24h expiry)
- Rate limiting: 200 req/15 min general, 20 req/15 min on auth endpoints
- The `ENCRYPTION_KEY` must remain constant — changing it will make stored PINs unreadable
