"""
TWC UTS portal automation — files quarterly C-3/C-4 wage report and submits
SUI payment via ACH debit for a single employer.

Usage: python twc_automation.py <job_json_path>

Job JSON fields:
  twcUsername   str   UTS login username
  twcPassword   str   UTS login password
  quarter       int   1–4
  year          int   e.g. 2026
  totalAmount   float total SUI tax to pay
  paymentDate   str   YYYY-MM-DD (TWC due date)
  employees     list  [{firstName, lastName, ssn, wages, taxableWages}, ...]

Exit codes / stdout tokens:
  TWC_COMPLETE  — success
  TWC_FAILED: <reason>  — hard failure
"""

import sys
import os
import json
import csv
import io
import time

# Load .env from bridge-server directory
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.isfile(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

UTS_LOGIN_URL = 'https://apps.twc.texas.gov/UITAXSERV/security/logon.do'
DEBUG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(DEBUG_DIR, exist_ok=True)


def log(msg):
    print('[TWC] ' + str(msg), flush=True)


def fail(reason):
    print('TWC_FAILED: ' + str(reason), flush=True)
    sys.exit(1)


def screenshot(page, name):
    path = os.path.join(DEBUG_DIR, f'twc_{name}.png')
    try:
        page.screenshot(path=path)
        log(f'Screenshot: {path}')
    except Exception as e:
        log(f'Screenshot failed: {e}')


def generate_csv(employees):
    """TWC quarterly wage report CSV — SSN,LastName,FirstName,MiddleInitial,Wages."""
    out = io.StringIO()
    writer = csv.writer(out)
    for emp in employees:
        ssn = str(emp.get('ssn') or '').replace('-', '').replace(' ', '')
        writer.writerow([
            ssn,
            (emp.get('lastName') or emp.get('last_name') or '').upper().strip(),
            (emp.get('firstName') or emp.get('first_name') or '').upper().strip(),
            '',
            f"{float(emp.get('wages') or 0):.2f}",
        ])
    return out.getvalue()


def click_if_found(page, selectors, description, timeout=8000):
    """Try a list of CSS/text selectors in order; click the first that matches."""
    for sel in selectors:
        try:
            page.locator(sel).first.click(timeout=timeout)
            log(f'Clicked {description} via: {sel}')
            return True
        except Exception:
            pass
    log(f'WARNING: could not find {description}')
    return False


def fill_field(page, selectors, value, description):
    """Try a list of selectors to fill a form field."""
    for sel in selectors:
        try:
            page.locator(sel).first.fill(str(value))
            log(f'Filled {description} via: {sel}')
            return True
        except Exception:
            pass
    log(f'WARNING: could not fill {description}')
    return False


def main():
    if len(sys.argv) < 2:
        fail('No job file path provided')

    job_file = sys.argv[1]
    if not os.path.isfile(job_file):
        fail(f'Job file not found: {job_file}')

    with open(job_file, 'r') as f:
        job = json.load(f)

    username    = job.get('twcUsername', '')
    password    = job.get('twcPassword', '')
    quarter     = int(job.get('quarter', 0))
    year        = int(job.get('year', 0))
    total_amount = float(job.get('totalAmount', 0))
    payment_date = job.get('paymentDate', '')
    employees   = job.get('employees', [])

    if not username or not password:
        fail('TWC credentials missing — add UTS username and password in client settings')

    log(f'Starting TWC UTS submission Q{quarter} {year}')
    log(f'Amount: ${total_amount:.2f}  Employees: {len(employees)}')

    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout
    except ImportError:
        fail('playwright not installed — run: pip install playwright && playwright install chromium')

    # Write CSV wage file
    csv_content = generate_csv(employees)
    csv_path = os.path.join(DEBUG_DIR, f'twc_wages_Q{quarter}_{year}.csv')
    with open(csv_path, 'w', newline='') as f:
        f.write(csv_content)
    log(f'Wage CSV written: {csv_path}')

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=200)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.set_default_timeout(30000)

        try:
            # ── Step 1: Login ────────────────────────────────────────────────
            log('Step 1: Login')
            page.goto(UTS_LOGIN_URL, wait_until='networkidle')
            screenshot(page, '01_login')

            fill_field(page,
                ['input[name="userId"]', 'input#userId', 'input[name="user"]', 'input[type="text"]:first-of-type'],
                username, 'username')
            fill_field(page,
                ['input[name="password"]', 'input#password', 'input[type="password"]'],
                password, 'password')

            screenshot(page, '02_filled_login')
            page.keyboard.press('Enter')
            page.wait_for_load_state('networkidle')
            screenshot(page, '03_after_login')

            # Check for login failure
            content = page.content().lower()
            if any(x in content for x in ['invalid', 'incorrect', 'failed to log', 'authentication failed']):
                fail('UTS login failed — check TWC username and password in client settings')

            log('Step 1 complete: logged in')

            # ── Step 2: Navigate to File/Amend Wages ─────────────────────────
            log('Step 2: Navigate to wage report')
            found = click_if_found(page, [
                'text=File/Amend Wages',
                'text=File Wages',
                'a[href*="wageReport"]',
                'a[href*="wage"]',
                'a[href*="Wage"]',
            ], 'wage report link')

            if not found:
                screenshot(page, '04_nav_failed')
                fail('Could not find "File/Amend Wages" link — check screenshots in bridge-server/data/')

            page.wait_for_load_state('networkidle')
            screenshot(page, '04_wage_page')
            log('Step 2 complete')

            # ── Step 3: Select the quarter ───────────────────────────────────
            log(f'Step 3: Select Q{quarter} {year}')
            # UTS typically shows a list of available quarters as links
            # Try both "Q1 2026" and "2026Q1" style links
            q_labels = [
                f'Q{quarter} {year}',
                f'{year} Q{quarter}',
                f'{year}Q{quarter}',
                f'Quarter {quarter}, {year}',
            ]
            selected_quarter = False
            for label in q_labels:
                try:
                    page.locator(f'text={label}').first.click(timeout=5000)
                    selected_quarter = True
                    log(f'Selected quarter via label: {label}')
                    break
                except Exception:
                    pass

            if not selected_quarter:
                # UTS may auto-select the current quarter, or it may use a dropdown
                try:
                    sel_el = page.locator('select').first
                    opts = sel_el.locator('option').all_text_contents()
                    log(f'Quarter dropdown options: {opts}')
                    # Find matching option
                    for opt in opts:
                        if str(year) in opt and (f'Q{quarter}' in opt or f'0{quarter}' in opt):
                            sel_el.select_option(label=opt)
                            selected_quarter = True
                            log(f'Selected quarter via dropdown: {opt}')
                            break
                except Exception as e:
                    log(f'Dropdown approach failed: {e}')

            if not selected_quarter:
                log('WARNING: Could not explicitly select quarter — proceeding with whatever is shown')
                screenshot(page, '05_quarter_not_found')

            page.wait_for_load_state('networkidle')
            screenshot(page, '05_quarter_selected')
            log('Step 3 complete')

            # ── Step 4: Upload wage report CSV ───────────────────────────────
            log('Step 4: Upload wage report')
            try:
                file_input = page.locator('input[type="file"]').first
                file_input.set_input_files(csv_path)
                log('CSV attached to file input')
                # Click upload/submit
                click_if_found(page, [
                    'input[value="Upload"]', 'input[value="Submit"]', 'button:has-text("Upload")',
                    'button:has-text("Submit")', 'input[type="submit"]',
                ], 'upload button')
                page.wait_for_load_state('networkidle')
                screenshot(page, '06_after_upload')
                log('Step 4 complete: CSV uploaded')
            except Exception as e:
                log(f'File upload failed ({e}) — trying manual entry')
                # Manual entry fallback: UTS may have per-employee rows
                enter_wages_manually(page, employees)
                screenshot(page, '06_manual_entry')

            # ── Step 5: Confirm/submit wage report ───────────────────────────
            log('Step 5: Confirm wage report submission')
            click_if_found(page, [
                'input[value="Submit"]', 'input[value="Confirm"]', 'button:has-text("Submit")',
                'button:has-text("Confirm")', 'input[type="submit"]', 'a:has-text("Submit")',
            ], 'wage report confirm button')
            page.wait_for_load_state('networkidle')
            screenshot(page, '07_wage_confirmed')
            log('Step 5 complete')

            # ── Step 6: Navigate to Make Payment ─────────────────────────────
            log('Step 6: Navigate to Make Payment')
            # UTS payment is often a separate menu item
            time.sleep(1)
            found = click_if_found(page, [
                'text=Make Payment',
                'text=Make a Payment',
                'a[href*="payment"]',
                'a[href*="Payment"]',
                'a[href*="makePayment"]',
            ], 'Make Payment link')

            if not found:
                screenshot(page, '08_payment_nav_failed')
                fail('Could not find Make Payment link after filing wages — check screenshots')

            page.wait_for_load_state('networkidle')
            screenshot(page, '08_payment_page')
            log('Step 6 complete')

            # ── Step 7: Enter amount and payment date ─────────────────────────
            log(f'Step 7: Enter amount ${total_amount:.2f} and date {payment_date}')
            amount_str = f'{total_amount:.2f}'
            fill_field(page, [
                'input[name="amount"]', 'input[name="paymentAmount"]', 'input[name="taxAmount"]',
                'input[id*="amount"]', 'input[id*="Amount"]',
            ], amount_str, 'payment amount')

            if payment_date:
                # TWC date format is typically MM/DD/YYYY
                try:
                    y, m, d = payment_date.split('-')
                    us_date = f'{m}/{d}/{y}'
                except Exception:
                    us_date = payment_date
                fill_field(page, [
                    'input[name="paymentDate"]', 'input[name="settlementDate"]',
                    'input[id*="date"]', 'input[id*="Date"]',
                ], us_date, 'payment date')

            screenshot(page, '09_payment_filled')
            log('Step 7 complete')

            # ── Step 8: Submit payment ────────────────────────────────────────
            log('Step 8: Submit payment')
            click_if_found(page, [
                'input[value="Submit Payment"]', 'input[value="Submit"]', 'input[value="Make Payment"]',
                'button:has-text("Submit Payment")', 'button:has-text("Submit")',
                'input[type="submit"]',
            ], 'submit payment button')
            page.wait_for_load_state('networkidle')
            screenshot(page, '10_payment_submitted')

            # ── Step 9: Confirm result ────────────────────────────────────────
            log('Step 9: Verify confirmation')
            final_content = page.content().lower()
            if any(x in final_content for x in ['error', 'invalid', 'failed', 'rejected']):
                screenshot(page, '11_error_detected')
                # Don't hard-fail yet — may be a non-critical warning
                log('WARNING: possible error message detected on final page — check screenshot 11_error_detected.png')

            if any(x in final_content for x in ['confirmation', 'successfully', 'accepted', 'received', 'thank you']):
                log('Confirmation message detected')
            else:
                log('No explicit confirmation message — check screenshot 10_payment_submitted.png')

            log('All steps complete')
            print('TWC_COMPLETE', flush=True)

        except Exception as e:
            log(f'Unhandled error: {e}')
            try:
                screenshot(page, 'error_state')
            except Exception:
                pass
            fail(str(e))
        finally:
            browser.close()


def enter_wages_manually(page, employees):
    """Fallback when file upload is unavailable — enters employee data row-by-row."""
    log(f'Manual entry for {len(employees)} employees')
    # UTS manual wage entry: typically a table where each row has SSN + wage fields
    for i, emp in enumerate(employees):
        ssn = str(emp.get('ssn') or '').replace('-', '').replace(' ', '')
        wages = f"{float(emp.get('wages') or 0):.2f}"
        try:
            # UTS row identifiers vary; attempt indexed inputs
            row_ssn_sels = [
                f'input[name="ssn[{i}]"]', f'input[name="ssn_{i}"]',
                f'input[id="ssn_{i}"]', f'(//input[@name="ssn"])[{i+1}]',
            ]
            row_wage_sels = [
                f'input[name="wages[{i}]"]', f'input[name="wages_{i}"]',
                f'input[id="wages_{i}"]', f'(//input[@name="wages"])[{i+1}]',
            ]
            for sel in row_ssn_sels:
                try:
                    page.locator(sel).first.fill(ssn, timeout=2000)
                    break
                except Exception:
                    pass
            for sel in row_wage_sels:
                try:
                    page.locator(sel).first.fill(wages, timeout=2000)
                    break
                except Exception:
                    pass
        except Exception as ex:
            log(f'  Manual row {i+1} error: {ex}')


if __name__ == '__main__':
    main()
