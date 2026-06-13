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
# Pixel offset from the left edge of the "New" word to the checkbox in the same row.
# Negative because the checkbox column is to the LEFT of the Status column.
CHECKBOX_OFFSET_X = -357

pytesseract.pytesseract.tesseract_cmd = os.environ.get(
    'TESSERACT_PATH', r'C:\Users\mramz\OneDrive\Desktop\tesseract.exe'
)


def log(msg):
    print('[ENROLL] ' + str(msg), flush=True)


def img(filename):
    return os.path.join(IMAGES_DIR, filename)


BP_ERROR_OK_X = int(os.environ.get('BP_ERROR_OK_X', '805'))
BP_ERROR_OK_Y = int(os.environ.get('BP_ERROR_OK_Y', '684'))


def _is_file_format_selector_open():
    """Return True if the File Format Selector dialog is still on screen (error state)."""
    try:
        import win32gui
        found = [0]
        def _cb(hwnd, _):
            try:
                if win32gui.IsWindowVisible(hwnd) and 'File Format' in win32gui.GetWindowText(hwnd):
                    found[0] = hwnd
            except Exception:
                pass
        win32gui.EnumWindows(_cb, None)
        return found[0] != 0
    except Exception:
        pass
    try:
        import pygetwindow as gw
        return any('File Format' in w.title for w in gw.getAllWindows())
    except Exception:
        return False


def _dismiss_file_format_selector():
    """Dismiss Error ID 88 dialog via BM_CLICK on OK button, falling back to coordinate click."""
    log('Dismissing File Format Selector error dialog...')
    BM_CLICK = 0x00F5
    try:
        import win32gui
        found = [0]
        def _cb(hwnd, _):
            try:
                if win32gui.IsWindowVisible(hwnd) and 'File Format' in win32gui.GetWindowText(hwnd):
                    found[0] = hwnd
            except Exception:
                pass
        win32gui.EnumWindows(_cb, None)
        hwnd = found[0]
        if hwnd:
            ok_handles = []
            def _child_cb(h, _):
                try:
                    cls = win32gui.GetClassName(h)
                    txt = win32gui.GetWindowText(h).strip().lstrip('&').lower()
                    if cls == 'Button' and txt == 'ok':
                        ok_handles.append(h)
                except Exception:
                    pass
            win32gui.EnumChildWindows(hwnd, _child_cb, None)
            if ok_handles:
                log('Sending BM_CLICK to OK button hwnd=' + str(ok_handles[0]))
                win32gui.PostMessage(ok_handles[0], BM_CLICK, 0, 0)
                time.sleep(1.0)
                if not _is_file_format_selector_open():
                    log('Dialog closed via BM_CLICK')
                    return
    except Exception as e:
        log('win32gui dismiss failed: ' + str(e))

    # Fallback: coordinate click
    for attempt in range(4):
        log('Clicking error OK at (' + str(BP_ERROR_OK_X) + ', ' + str(BP_ERROR_OK_Y) + ') attempt ' + str(attempt + 1))
        pyautogui.moveTo(BP_ERROR_OK_X, BP_ERROR_OK_Y, duration=0.15)
        time.sleep(0.1)
        pyautogui.click(BP_ERROR_OK_X, BP_ERROR_OK_Y)
        time.sleep(0.6)
        if not _is_file_format_selector_open():
            log('Dialog closed after coordinate click')
            return
    pyautogui.press('enter')
    time.sleep(0.5)


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


def find_new_rows():
    # OCR the screen and return (checkbox_x, center_y) for every row whose
    # status column reads New. Uses psm 11 (sparse text) which works better
    # for table layouts than psm 6 (uniform block).
    log('OCR scan: looking for New status rows...')
    screenshot = pyautogui.screenshot()
    data = pytesseract.image_to_data(
        screenshot, config='--psm 11', output_type=pytesseract.Output.DICT
    )
    # Log all non-empty words OCR found so we can diagnose misreads
    all_words = [t for t in data['text'] if t.strip()]
    log('OCR words found: ' + str(all_words))
    rows = []
    for i, text in enumerate(data['text']):
        if text.strip() in ('New', 'NEW', 'new'):
            new_x    = data['left'][i]
            center_y = data['top'][i] + data['height'][i] // 2
            chk_x    = new_x + CHECKBOX_OFFSET_X
            # Deduplicate rows within 10 pixels of each other
            if not any(abs(center_y - r[1]) < 10 for r in rows):
                rows.append((chk_x, center_y))
                log('Found New row at y=' + str(center_y) + ' -> checkbox at x=' + str(chk_x))
    return rows, all_words


def ein_already_synchronized(ein, all_words):
    # Return True if EFTPS has already processed this EIN's enrollment
    # (status shows "Synchronized" near the EIN digits in the OCR word list).
    # This happens when the company was previously enrolled or when EFTPS
    # processes the import so quickly that status jumps straight to Synchronized
    # before our OCR scan runs.
    ein_digits = ''.join(c for c in ein if c.isdigit())
    # Build a flat string of all OCR words to check for proximity
    text_blob = ' '.join(all_words)
    # Check: EIN digits appear on screen AND "Synchronized" appears
    ein_found = any(ein_digits in ''.join(c for c in w if c.isdigit()) for w in all_words)
    sync_found = any(w.lower().startswith('sync') for w in all_words)
    if ein_found and sync_found:
        log('EIN ' + ein_digits + ' found with Synchronized status — already enrolled in EFTPS')
        return True
    # Also handle OCR reading "Synchronized" as a substring
    if ein_found and 'synchronized' in text_blob.lower():
        log('EIN ' + ein_digits + ' found with Synchronized text — already enrolled in EFTPS')
        return True
    return False


def main():
    if len(sys.argv) < 2:
        print('ENROLLMENT_FAILED: No enrollment file path provided', flush=True)
        sys.exit(1)

    enroll_file_path = os.path.abspath(sys.argv[1])
    log('Starting enrollment import')
    log('Enrollment file: ' + enroll_file_path)

    if not os.path.isfile(enroll_file_path):
        print('ENROLLMENT_FAILED: Enrollment file not found: ' + enroll_file_path, flush=True)
        sys.exit(1)

    # Maximize BP window before any clicks so coordinates are deterministic
    maximize_bp()

    # Step 1 - Click Enrollments tab
    log('Executing step 1: click Enrollments tab at (312, 103)')
    time.sleep(0.5)
    pyautogui.click(312, 103)
    log('Step 1 complete: Enrollments tab clicked')
    time.sleep(1)

    # Step 2 - Click Send Enrollments button
    log('Executing step 2: click Send Enrollments button at (73, 131)')
    time.sleep(0.5)
    pyautogui.click(73, 131)
    log('Step 2 complete: Send Enrollments button clicked')
    time.sleep(1)

    # Step 3 - Click Import button
    log('Executing step 3: click Import button at (373, 968)')
    time.sleep(0.5)
    pyautogui.click(373, 968)
    log('Step 3 complete: Import button clicked - waiting 2s for File Format Selector')
    time.sleep(2)

    # Step 4 - Click Add button in File Format Selector dialog
    log('Executing step 4: click Add button at (793, 484)')
    time.sleep(0.5)
    pyautogui.click(793, 484)
    log('Step 4 complete: Add button clicked - waiting 2s for file browser')
    time.sleep(2)

    # Step 5 - Type filename and press Enter to submit file browser
    filename = os.path.basename(enroll_file_path)
    log('Executing step 5a: Ctrl+A in filename field')
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    log('Executing step 5b: type filename - ' + filename)
    pyautogui.typewrite(filename, interval=0.15)
    time.sleep(0.2)
    log('Executing step 5c: press Enter to close file browser')
    pyautogui.press('enter')
    log('Step 5c complete: Enter pressed - waiting 2s')
    time.sleep(2)

    # Step 5d - Save debug screenshot before clicking OK
    debug_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(debug_dir, exist_ok=True)
    debug_path = os.path.join(debug_dir, 'debug_after_enter.png')
    pyautogui.screenshot(debug_path)
    log('Step 5d complete: debug screenshot saved to ' + debug_path)

    # Step 6 - Click first OK button in File Format Selector
    log('Executing step 6: click OK button (first) at (1129, 641)')
    time.sleep(0.5)
    pyautogui.click(1129, 641)
    log('Step 6 complete: first OK clicked - waiting 2s')
    time.sleep(2)

    # Step 7 - Click second OK button (triggers actual import)
    log('Executing step 7: click OK button (second) at (806, 634)')
    time.sleep(2)
    pyautogui.click(806, 634)
    log('Step 7 complete: second OK clicked - waiting for import to process')
    time.sleep(6)

    # Check for Error ID 88 — if File Format Selector is still open, the import was rejected
    if _is_file_format_selector_open():
        log('ERROR: File Format Selector still open after import — Error ID 88 detected')
        _dismiss_file_format_selector()
        print('ENROLLMENT_RETRY_NEEDED', flush=True)
        sys.exit(0)

    log('File Format Selector closed — import accepted, waiting for list to update')
    time.sleep(2)

    # Step 8 - OCR scan to find all New status rows and click their checkboxes
    # Save debug screenshot so we can verify what is on screen when OCR runs
    debug_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(debug_dir, exist_ok=True)
    ocr_debug_path = os.path.join(debug_dir, 'debug_before_ocr.png')
    pyautogui.screenshot(ocr_debug_path)
    log('Executing step 8: debug screenshot saved to ' + ocr_debug_path)

    # Extract EIN from the enrollment filename so we can check for it in the OCR output
    import re as _re
    ein_match = _re.search(r'ENROLL_(\d+)_', os.path.basename(enroll_file_path))
    target_ein = ein_match.group(1) if ein_match else ''

    new_rows, all_words = find_new_rows()
    if not new_rows:
        # Check whether EFTPS has already processed this EIN as Synchronized.
        # This happens when a previous enrollment attempt succeeded, or when the
        # EFTPS import is so fast that the status jumps from New → Synchronized
        # before our OCR scan fires.  In either case the company IS enrolled.
        if target_ein and ein_already_synchronized(target_ein, all_words):
            log('No New rows found but EIN ' + target_ein + ' shows Synchronized — treating as ENROLLMENT_COMPLETE')
            print('ENROLLMENT_COMPLETE', flush=True)
            sys.exit(0)
        print('ENROLLMENT_FAILED: No New status rows found in Send Enrollments list', flush=True)
        sys.exit(1)
    log('Step 8: found ' + str(len(new_rows)) + ' New row(s) - clicking checkboxes')
    for i, (chk_x, cy) in enumerate(new_rows):
        log('Step 8: clicking checkbox ' + str(i + 1) + ' at (' + str(chk_x) + ', ' + str(cy) + ')')
        pyautogui.click(chk_x, cy)
        time.sleep(0.3)
    log('Step 8 complete: all New checkboxes clicked')
    time.sleep(0.5)

    # Step 9 - Click Submit
    log('Executing step 9: click Submit button at (1852, 969)')
    time.sleep(0.5)
    pyautogui.click(1852, 969)
    log('Step 9 complete: Submit clicked - waiting 2s for PIN dialog')
    time.sleep(2)

    # Step 10 - Click PIN field and type PIN (image recognition - modal dialog)
    log('Executing step 10: click PIN field')
    if not find_and_click('pin_field.png', 'PIN field', timeout=10):
        print('ENROLLMENT_FAILED: PIN field not found', flush=True)
        sys.exit(1)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    master_pin = os.environ.get('BATCH_PROVIDER_MASTER_PIN', '')
    log('Executing step 10a: typing PIN (' + str(len(master_pin)) + ' chars)')
    pyautogui.typewrite(master_pin, interval=0.15)
    log('Step 10 complete: PIN entered')
    time.sleep(0.3)

    # Step 11 - Click Password field and type password (image recognition - modal dialog)
    log('Executing step 11: click Password field')
    if not find_and_click('password_field.png', 'Password field', timeout=10):
        print('ENROLLMENT_FAILED: Password field not found', flush=True)
        sys.exit(1)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    master_password = os.environ.get('BATCH_PROVIDER_MASTER_PASSWORD', '')
    log('Executing step 11a: typing password (' + str(len(master_password)) + ' chars)')
    pyautogui.typewrite(master_password, interval=0.15)
    log('Step 11 complete: password entered')
    time.sleep(0.3)

    # Step 12 - Click PIN submit at fixed coordinates
    log('Executing step 12: click PIN submit button at (1124, 630)')
    time.sleep(0.5)
    pyautogui.click(1124, 630)
    log('Step 12 complete: PIN submit clicked - waiting 2s')
    time.sleep(2)

    # Step 13 - Click submit OK (image recognition - confirmation dialog)
    log('Executing step 13: click submit OK button')
    if not find_and_click('submit_ok.png', 'Submit OK button', timeout=10):
        print('ENROLLMENT_FAILED: Submit OK button not found', flush=True)
        sys.exit(1)
    log('Step 13 complete: submit OK clicked')
    time.sleep(1)

    log('All steps complete - enrollment submitted successfully')
    print('ENROLLMENT_COMPLETE', flush=True)
    sys.exit(0)


if __name__ == '__main__':
    main()
