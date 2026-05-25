import sys
import os
import time
import pyautogui
import pytesseract

pyautogui.FAILSAFE = False

# Load .env from the bridge-server directory so credentials are available
# when the script is run directly from the terminal
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.isfile(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

CONFIDENCE = 0.7
IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'button_images')

MASTER_PIN      = os.environ.get('BATCH_PROVIDER_MASTER_PIN', '')
MASTER_PASSWORD = os.environ.get('BATCH_PROVIDER_MASTER_PASSWORD', '')

pytesseract.pytesseract.tesseract_cmd = os.environ.get(
    'TESSERACT_PATH', r'C:\Users\mramz\OneDrive\Desktop\tesseract.exe'
)


def log(msg):
    print('[ENROLL CHECK] ' + str(msg), flush=True)


def img(filename):
    return os.path.join(IMAGES_DIR, filename)


def maximize_bp():
    # Maximize Batch Provider window so all coordinates are deterministic
    try:
        import pygetwindow as gw
        wins = [w for w in gw.getAllWindows() if 'Batch Provider' in w.title]
        if wins:
            wins[0].maximize()
            log('Batch Provider window maximized')
            time.sleep(1)
        else:
            log('WARNING: Batch Provider window not found by title - continuing')
    except Exception as e:
        log('WARNING: Could not maximize window (' + str(e) + ') - continuing')


def find_and_click(filename, description, timeout=10, confidence=CONFIDENCE):
    log('Looking for ' + description + '...')
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            loc = pyautogui.locateOnScreen(img(filename), confidence=confidence)
            if loc:
                cx, cy = pyautogui.center(loc)
                log('Found ' + description + ' at (' + str(cx) + ', ' + str(cy) + ') - clicking')
                pyautogui.click(cx, cy)
                time.sleep(0.5)
                return True
        except Exception:
            pass
        time.sleep(0.5)
    log('ERROR: ' + description + ' not found within ' + str(timeout) + 's')
    return False


def ocr_screen_for_ein(ein, name_words=None):
    # Take a full screenshot and use OCR to find the EIN with Active status.
    # OCR often inserts spaces into numbers and splits table rows across lines,
    # so we find the EIN line then check a window of surrounding lines for Active.
    log('Taking screenshot for OCR...')
    screenshot = pyautogui.screenshot()

    # Save debug screenshot so failures can be diagnosed
    debug_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(debug_dir, exist_ok=True)
    debug_path = os.path.join(debug_dir, 'debug_enrollment_check.png')
    screenshot.save(debug_path)
    log('Debug screenshot saved to ' + debug_path)

    text = pytesseract.image_to_string(screenshot, config='--psm 6')
    log('OCR text length: ' + str(len(text)) + ' chars')

    import re
    ein_clean = ''.join(c for c in ein if c.isdigit())
    # Matches 'active', 'actve', 'actlve' — common OCR misreads
    active_re = re.compile(r'act.{0,2}v', re.IGNORECASE)
    lines = text.splitlines()

    # Find the company row by EIN digits first, then fall back to business name words.
    # OCR often reads EIN digits as letters, but company name words come through reliably.
    company_line_idx = None
    for i, line in enumerate(lines):
        if ein_clean in ''.join(c for c in line if c.isdigit()):
            company_line_idx = i
            log('Company row found by EIN on line ' + str(i) + ': ' + line.strip())
            break

    if company_line_idx is None and name_words:
        for i, line in enumerate(lines):
            line_upper = line.upper()
            for word in name_words:
                if word in line_upper:
                    company_line_idx = i
                    log('Company row found by name word "' + word + '" on line ' + str(i) + ': ' + line.strip())
                    break
            if company_line_idx is not None:
                break

    if company_line_idx is None:
        log('Company row not found by EIN or name — EIN: ' + ein_clean + ', name words: ' + str(name_words))
        log('Raw OCR (first 2000 chars): ' + text[:2000])
        return False

    # Scan up to 10 lines forward from the company row to find the Status value
    window_end = min(len(lines), company_line_idx + 10)
    window_text = ' '.join(lines[company_line_idx:window_end])
    log('Row window (lines ' + str(company_line_idx) + '-' + str(window_end) + '): ' + window_text.strip())

    if active_re.search(window_text):
        log('Active status confirmed for EIN ' + ein_clean)
        return True

    log('Company row found but Active pattern not detected in window')
    log('Raw OCR (first 2000 chars): ' + text[:2000])
    return False


def main():
    if len(sys.argv) < 2:
        print('ENROLLMENT_PENDING: No EIN provided', flush=True)
        sys.exit(1)

    ein = sys.argv[1].replace('-', '').strip()
    business_name = sys.argv[2].strip() if len(sys.argv) > 2 else ''
    name_words = [w.upper() for w in business_name.split() if len(w) >= 4]
    log('Checking enrollment status for EIN: ' + ein + ' / name words: ' + str(name_words))

    if not MASTER_PIN:
        log('WARNING: BATCH_PROVIDER_MASTER_PIN not set - sync dialog may fail')
    if not MASTER_PASSWORD:
        log('WARNING: BATCH_PROVIDER_MASTER_PASSWORD not set - sync dialog may fail')

    # Maximize BP window before any clicks so coordinates are deterministic
    maximize_bp()

    # Step 1 - Click Enrollments tab
    log('Step 1: Clicking Enrollments tab at (312, 103)')
    time.sleep(0.5)
    pyautogui.click(312, 103)
    log('Step 1 complete: Enrollments tab clicked')
    time.sleep(1)

    # Step 2 - Click Enrollment Inquiry
    log('Step 2: Clicking Enrollment Inquiry at (189, 134)')
    time.sleep(0.5)
    pyautogui.click(189, 134)
    log('Step 2 complete: Enrollment Inquiry clicked')
    time.sleep(1)

    # Step 3 - Click Sync
    log('Step 3: Clicking Sync at (1830, 964)')
    time.sleep(0.5)
    pyautogui.click(1830, 964)
    log('Step 3 complete: Sync clicked')
    time.sleep(2)

    # Step 4 - Click PIN field and type Master PIN
    log('Step 4: Clicking PIN field at (934, 472)')
    time.sleep(0.5)
    pyautogui.click(934, 472)
    log('Step 4 complete: PIN field clicked')
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(MASTER_PIN, interval=0.15)
    time.sleep(0.3)

    # Step 5 - Click Password field and type Master Password
    log('Step 5: Clicking Password field at (972, 494)')
    time.sleep(0.5)
    pyautogui.click(972, 494)
    log('Step 5 complete: Password field clicked')
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(MASTER_PASSWORD, interval=0.15)
    time.sleep(0.3)

    # Step 6 - Click Submit
    log('Step 6: Clicking Submit at (1120, 700)')
    time.sleep(0.5)
    pyautogui.click(1120, 700)
    log('Step 6 complete: Submit clicked')
    time.sleep(3)

    # Step 7 - Click OK to dismiss sync confirmation
    log('Step 7: Clicking OK at (821, 683)')
    time.sleep(0.5)
    pyautogui.click(821, 683)
    log('Step 7 complete: OK clicked')
    time.sleep(5)

    # Step 7b - Click Search to load enrollment list
    log('Step 7b: Clicking Search at (53, 337)')
    time.sleep(1)
    pyautogui.click(53, 337)
    log('Step 7b complete: Search clicked - waiting 3s for results')
    time.sleep(3)

    # Step 8 - OCR the screen and look for EIN with Active status
    log('Step 8: Running OCR to check enrollment status')
    active = ocr_screen_for_ein(ein, name_words)

    if active:
        log('Enrollment confirmed Active for EIN ' + ein)
        print('ENROLLMENT_ACTIVE', flush=True)
        sys.exit(0)
    else:
        log('Enrollment not yet Active for EIN ' + ein)
        print('ENROLLMENT_PENDING', flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
