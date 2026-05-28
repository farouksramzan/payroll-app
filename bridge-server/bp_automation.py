import sys
import os
import time
import subprocess
import pyautogui

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

CONFIDENCE = 0.8
IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'button_images')

# ── Coordinate overrides via .env ─────────────────────────────────────────────
# If BP's layout shifts (different resolution/DPI/monitor), update these in .env
# rather than touching the script.
BP_SEND_PAYMENTS_X       = int(os.environ.get('BP_SEND_PAYMENTS_X',       '51'))
BP_SEND_PAYMENTS_Y       = int(os.environ.get('BP_SEND_PAYMENTS_Y',       '133'))
BP_IMPORT_X              = int(os.environ.get('BP_IMPORT_X',              '386'))
BP_IMPORT_Y              = int(os.environ.get('BP_IMPORT_Y',              '966'))
BP_ADD_X                 = int(os.environ.get('BP_ADD_X',                 '833'))
BP_ADD_Y                 = int(os.environ.get('BP_ADD_Y',                 '482'))
BP_OK1_X                 = int(os.environ.get('BP_OK1_X',                 '1111'))
BP_OK1_Y                 = int(os.environ.get('BP_OK1_Y',                 '639'))
BP_OK2_X                 = int(os.environ.get('BP_OK2_X',                 '798'))
BP_OK2_Y                 = int(os.environ.get('BP_OK2_Y',                 '629'))
# ── Recovery flow coordinates (set in .env) ───────────────────────────────────
BP_ENROLLMENTS_X         = int(os.environ.get('BP_ENROLLMENTS_X',         '316'))
BP_ENROLLMENTS_Y         = int(os.environ.get('BP_ENROLLMENTS_Y',         '100'))
BP_ENROLLMENT_INQUIRY_X  = int(os.environ.get('BP_ENROLLMENT_INQUIRY_X',  '165'))
BP_ENROLLMENT_INQUIRY_Y  = int(os.environ.get('BP_ENROLLMENT_INQUIRY_Y',  '129'))
BP_SYNC_X                = int(os.environ.get('BP_SYNC_X',                '1848'))
BP_SYNC_Y                = int(os.environ.get('BP_SYNC_Y',                '964'))
BP_CANCEL_X              = int(os.environ.get('BP_CANCEL_X',              '787'))
BP_CANCEL_Y              = int(os.environ.get('BP_CANCEL_Y',              '630'))
BP_EDIT_X                = int(os.environ.get('BP_EDIT_X',                '214'))
BP_EDIT_Y                = int(os.environ.get('BP_EDIT_Y',                '963'))
BP_SAVE_X                = int(os.environ.get('BP_SAVE_X',                '1149'))
BP_SAVE_Y                = int(os.environ.get('BP_SAVE_Y',                '753'))


def log(msg):
    print('[BP] ' + str(msg), flush=True)


def img(filename):
    return os.path.join(IMAGES_DIR, filename)


def maximize_bp():
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


def is_file_format_selector_open():
    """Return True if the File Format Selector dialog is still on screen."""
    try:
        import pygetwindow as gw
        return any('File Format Selector' in w.title for w in gw.getAllWindows())
    except Exception:
        return False


def dismiss_file_format_selector():
    """
    Dismiss the File Format Selector dialog by pressing Enter.
    Works regardless of where the OK button is on screen — Enter always
    activates the focused/default button in a Windows dialog, so no
    coordinates are needed even when an error banner shifts the button down.
    """
    try:
        import pygetwindow as gw
        wins = [w for w in gw.getAllWindows() if 'File Format Selector' in w.title]
        if wins:
            wins[0].activate()
            time.sleep(0.3)
    except Exception as e:
        log('Could not activate File Format Selector: ' + str(e))
    pyautogui.press('enter')
    time.sleep(0.8)


def find_and_click(filename, description, timeout=10):
    log('Looking for ' + description + '...')
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            loc = pyautogui.locateOnScreen(img(filename), confidence=CONFIDENCE)
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


def paste_text(text):
    """
    Paste text via the Windows clipboard — handles special characters that
    pyautogui.typewrite() silently drops (non-ASCII, symbols, etc.).
    Falls back to typewrite if clipboard write fails.
    """
    try:
        proc = subprocess.Popen(['clip'], stdin=subprocess.PIPE, shell=True)
        proc.communicate(input=text.encode('utf-16-le'))
        time.sleep(0.15)
        pyautogui.hotkey('ctrl', 'a')
        time.sleep(0.1)
        pyautogui.hotkey('ctrl', 'v')
        time.sleep(0.2)
    except Exception as e:
        log('Clipboard paste failed (' + str(e) + ') — falling back to typewrite')
        pyautogui.hotkey('ctrl', 'a')
        time.sleep(0.1)
        pyautogui.typewrite(text, interval=0.15)


def find_word_on_screen(word):
    """
    Use tesseract OCR to locate a word on screen.
    Returns (cx, cy) center of the first match, or None if not found.
    """
    try:
        import pytesseract
        from PIL import Image
        tesseract_path = os.environ.get('TESSERACT_PATH', '')
        if tesseract_path:
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
        screenshot = pyautogui.screenshot()
        data = pytesseract.image_to_data(screenshot, output_type=pytesseract.Output.DICT)
        word_lower = word.lower()
        for i, text in enumerate(data['text']):
            if word_lower in text.lower() and int(data['conf'][i]) > 40:
                x = data['left'][i] + data['width'][i] // 2
                y = data['top'][i] + data['height'][i] // 2
                log('OCR found "' + word + '" at (' + str(x) + ', ' + str(y) + ')')
                return (x, y)
    except Exception as e:
        log('OCR find_word_on_screen failed: ' + str(e))
    return None


def get_window_count():
    """Return the number of visible titled windows (fast — no image capture)."""
    try:
        import pygetwindow as gw
        return len([w for w in gw.getAllWindows() if w.title.strip()])
    except Exception:
        return -1


def is_incomplete_error():
    """
    Return True if BP is showing the incomplete payment / override required error.
    Uses OCR to read the actual screen text — the error appears inside the BP
    window, not as a separate titled dialog, so window-title checks don't work.
    """
    for phrase in ('Incomplete', 'unsuccessful', 'requires an override'):
        if find_word_on_screen(phrase):
            return True
    return False


def handle_incomplete_payment_recovery():
    """
    Recovery when BP reports: 'At least one payment selected for submission
    was unsuccessful or requires an override.'
    Flow: dismiss error → Enrollments → Enrollment Inquiry → Sync →
          Payments → Send Payments → select incomplete → Edit → Save → Override
    Returns True on success, False on unrecoverable failure.
    """
    log('Recovery: Starting override/incomplete-payment flow')

    # Step R0 — Click Cancel to dismiss the error dialog.
    # Cancel is always at (787, 630). If no dialog is showing this click is harmless.
    log('Recovery R0: Clicking Cancel at (' + str(BP_CANCEL_X) + ', ' + str(BP_CANCEL_Y) + ')')
    pyautogui.click(BP_CANCEL_X, BP_CANCEL_Y)
    time.sleep(1.5)

    # R1 — Enrollments tab (coordinate click — no image search to avoid hangs)
    log('Recovery R1: Clicking Enrollments tab at (' + str(BP_ENROLLMENTS_X) + ', ' + str(BP_ENROLLMENTS_Y) + ')')
    pyautogui.click(BP_ENROLLMENTS_X, BP_ENROLLMENTS_Y)
    time.sleep(1)

    # R2 — Enrollment Inquiry
    log('Recovery R2: Clicking Enrollment Inquiry at (' + str(BP_ENROLLMENT_INQUIRY_X) + ', ' + str(BP_ENROLLMENT_INQUIRY_Y) + ')')
    pyautogui.click(BP_ENROLLMENT_INQUIRY_X, BP_ENROLLMENT_INQUIRY_Y)
    time.sleep(1)

    # R3 — Sync (then enter Master PIN + Password + Submit + OK, same as bp_enrollment_check)
    log('Recovery R3: Clicking Sync at (' + str(BP_SYNC_X) + ', ' + str(BP_SYNC_Y) + ')')
    pyautogui.click(BP_SYNC_X, BP_SYNC_Y)
    time.sleep(2)

    master_pin      = os.environ.get('BATCH_PROVIDER_MASTER_PIN', '')
    master_password = os.environ.get('BATCH_PROVIDER_MASTER_PASSWORD', '')

    log('Recovery R3a: Clicking PIN field at (934, 472)')
    pyautogui.click(934, 472)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(master_pin, interval=0.15)
    time.sleep(0.3)

    log('Recovery R3b: Clicking Password field at (972, 494)')
    pyautogui.click(972, 494)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(master_password, interval=0.15)
    time.sleep(0.3)

    log('Recovery R3c: Clicking Submit at (1120, 700)')
    pyautogui.click(1120, 700)
    time.sleep(3)

    log('Recovery R3d: Clicking OK at (821, 683)')
    pyautogui.click(821, 683)
    log('Recovery R3: Sync complete')
    time.sleep(5)

    # R4 — Back to Payments tab (image recognition — same image used in Step 0 which works)
    log('Recovery R4: Clicking Payments tab')
    if not find_and_click('payments_tab.png', 'Payments tab', timeout=15):
        log('Recovery R4: ERROR — Payments tab not found after Sync')
        return False
    time.sleep(1)

    # R5 — Send Payments sub-tab
    log('Recovery R5: Clicking Send Payments sub-tab')
    pyautogui.click(BP_SEND_PAYMENTS_X, BP_SEND_PAYMENTS_Y)
    time.sleep(1.5)

    # R6 — Select all incomplete payment checkboxes (reuse same region as main flow).
    # If no checkboxes are found the payment already succeeded — exit cleanly.
    log('Recovery R6: Looking for incomplete payment checkboxes')
    checkbox_region = (1600, 200, 300, 700)
    checkboxes = list(pyautogui.locateAllOnScreen(
        img('checkbox.png'), confidence=CONFIDENCE, region=checkbox_region
    ))
    if not checkboxes:
        log('Recovery R6: No incomplete checkboxes found — cannot locate payment to override')
        return False

    log('Recovery R6: Found ' + str(len(checkboxes)) + ' checkbox(es)')
    first = pyautogui.center(checkboxes[0])
    pyautogui.click(first)
    time.sleep(0.5)
    for box in checkboxes[1:]:
        center = pyautogui.center(box)
        pyautogui.keyDown('shift')
        pyautogui.click(center)
        pyautogui.keyUp('shift')
        time.sleep(0.2)
    time.sleep(0.5)

    # R7 — Edit
    log('Recovery R7: Clicking Edit at (' + str(BP_EDIT_X) + ', ' + str(BP_EDIT_Y) + ')')
    pyautogui.click(BP_EDIT_X, BP_EDIT_Y)
    time.sleep(1.5)

    # R8 — Save
    log('Recovery R8: Clicking Save at (' + str(BP_SAVE_X) + ', ' + str(BP_SAVE_Y) + ')')
    pyautogui.click(BP_SAVE_X, BP_SAVE_Y)
    time.sleep(1.5)

    # R9 — Override
    log('Recovery R9: Clicking Override at (720, 521)')
    pyautogui.click(720, 521)
    time.sleep(1)

    # R10 — OK after Override
    log('Recovery R10: Clicking OK at (1169, 581)')
    pyautogui.click(1169, 581)
    time.sleep(1)

    # R11 — Re-select payment checkboxes (same as Step 6 in main flow)
    log('Recovery R11: Selecting payment checkboxes')
    checkbox_region = (1600, 200, 300, 700)
    checkboxes = list(pyautogui.locateAllOnScreen(
        img('checkbox.png'), confidence=CONFIDENCE, region=checkbox_region
    ))
    if not checkboxes:
        log('Recovery R11: No checkboxes found after override — treating as success')
        return True
    log('Recovery R11: Found ' + str(len(checkboxes)) + ' checkbox(es)')
    first = pyautogui.center(checkboxes[0])
    pyautogui.click(first)
    time.sleep(0.5)
    for box in checkboxes[1:]:
        center = pyautogui.center(box)
        pyautogui.keyDown('shift')
        pyautogui.click(center)
        pyautogui.keyUp('shift')
        time.sleep(0.2)
    time.sleep(0.5)

    # R12 — Submit (same as Step 7)
    log('Recovery R12: Clicking Submit button')
    if not find_and_click('submit.png', 'Submit button'):
        log('Recovery R12: ERROR — Submit button not found after override')
        return False

    # R13 — PIN/Password dialog (same as Steps 8–8c)
    log('Recovery R13: Waiting for PIN/Password dialog (5s)...')
    time.sleep(5)

    batch_pin      = os.environ.get('BATCH_PROVIDER_PIN', '')
    batch_password = os.environ.get('BATCH_PROVIDER_PASSWORD', '')

    log('Recovery R13a: Clicking PIN field')
    if not find_and_click('pin_field.png', 'PIN field'):
        log('Recovery R13a: ERROR — PIN field not found')
        return False
    time.sleep(0.3)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(batch_pin, interval=0.15)
    time.sleep(0.3)

    log('Recovery R13b: Clicking Password field')
    if not find_and_click('password_field.png', 'Password field'):
        log('Recovery R13b: ERROR — Password field not found')
        return False
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(batch_password, interval=0.15)
    time.sleep(0.3)

    log('Recovery R13c: Clicking PIN dialog Submit')
    if not find_and_click('pin_submit.png', 'PIN dialog Submit button'):
        log('Recovery R13c: ERROR — PIN dialog Submit not found')
        return False

    log('Recovery R13d: Waiting 3s then clicking OK at (790, 629)')
    time.sleep(3)
    pyautogui.click(790, 629)

    log('Recovery: Override and resubmission complete')
    time.sleep(3)
    return True


def wait_for_import(max_wait=30):
    """
    Poll until the File Format Selector dialog closes (success) or the
    max wait is exceeded (error). Returns True on success, False on timeout.
    """
    log('Waiting for import to complete (up to ' + str(max_wait) + 's)...')
    elapsed = 0
    while elapsed < max_wait:
        time.sleep(0.5)
        elapsed += 0.5
        if not is_file_format_selector_open():
            log('Import dialog closed after ' + str(round(elapsed, 1)) + 's — import succeeded')
            return True
    log('Import dialog still open after ' + str(max_wait) + 's — error detected')
    return False


def main():
    if len(sys.argv) < 2:
        print('IMPORT_FAILED: No ACH file path provided', flush=True)
        sys.exit(1)

    ach_file_path = sys.argv[1]
    log('Starting Batch Provider import')
    log('ACH file: ' + ach_file_path)

    # Maximize BP window before any clicks so coordinates are deterministic
    maximize_bp()

    # Step 0 - Navigate to Payments tab (image recognition - tab position can vary)
    log('Step 0: Clicking Payments tab')
    if not find_and_click('payments_tab.png', 'Payments tab', timeout=15):
        print('IMPORT_FAILED: Payments tab not found', flush=True)
        sys.exit(1)
    time.sleep(1)

    # Step 0a - Click Send Payments sub-tab
    log('Step 0a: Clicking Send Payments tab at (' + str(BP_SEND_PAYMENTS_X) + ', ' + str(BP_SEND_PAYMENTS_Y) + ')')
    pyautogui.click(BP_SEND_PAYMENTS_X, BP_SEND_PAYMENTS_Y)
    log('Step 0a complete: Send Payments tab clicked')
    time.sleep(1)

    # Step 1 - Import button
    log('Step 1: Clicking Import button at (' + str(BP_IMPORT_X) + ', ' + str(BP_IMPORT_Y) + ')')
    time.sleep(0.5)
    pyautogui.click(BP_IMPORT_X, BP_IMPORT_Y)
    log('Step 1 complete: Import button clicked')
    time.sleep(2)

    # Step 2 - Add button in File Format Selector dialog
    log('Step 2: Clicking Add button at (' + str(BP_ADD_X) + ', ' + str(BP_ADD_Y) + ')')
    time.sleep(0.5)
    pyautogui.click(BP_ADD_X, BP_ADD_Y)
    log('Step 2 complete: Add button clicked')
    time.sleep(2)

    # Step 3 - Type ACH filename character by character (clipboard paste triggers BP error)
    filename = os.path.basename(ach_file_path)
    log('Step 3: Typing filename: ' + filename)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.1)
    pyautogui.typewrite(filename, interval=0.05)
    time.sleep(0.2)
    pyautogui.press('enter')
    time.sleep(2)

    # Step 4 - First OK button (confirms file selection in the dialog)
    log('Step 4: Clicking OK button at (' + str(BP_OK1_X) + ', ' + str(BP_OK1_Y) + ')')
    time.sleep(0.5)
    pyautogui.click(BP_OK1_X, BP_OK1_Y)
    log('Step 4 complete: OK button clicked')
    time.sleep(2)

    # Step 5 - Second OK button (triggers the actual import)
    log('Step 5: Clicking second OK button at (' + str(BP_OK2_X) + ', ' + str(BP_OK2_Y) + ')')
    time.sleep(0.5)
    pyautogui.click(BP_OK2_X, BP_OK2_Y)
    log('Step 5 complete: second OK button clicked')

    # Poll until the import dialog closes (success) or times out (error).
    # On success the File Format Selector closes automatically.
    # On error (e.g. Error ID 88) it stays open with an error banner.
    if not wait_for_import(max_wait=30):
        log('Dismissing dialog with Enter key (coordinate-free)')
        dismiss_file_format_selector()
        log('Dialog dismissed — signaling retry in 10 minutes')
        print('IMPORT_RETRY_NEEDED', flush=True)
        sys.exit(0)

    # Step 6 - Select all unsubmitted payment checkboxes (image recognition - rows vary)
    log('Step 6: Finding payment checkboxes')
    checkbox_region = (1600, 200, 300, 700)
    checkboxes = list(pyautogui.locateAllOnScreen(
        img('checkbox.png'), confidence=CONFIDENCE, region=checkbox_region
    ))
    if not checkboxes:
        print('IMPORT_FAILED: No payment checkboxes found', flush=True)
        sys.exit(1)
    log('Found ' + str(len(checkboxes)) + ' checkbox(es)')

    first = pyautogui.center(checkboxes[0])
    log('Clicking first checkbox at ' + str(first))
    pyautogui.click(first)
    time.sleep(0.5)

    for box in checkboxes[1:]:
        center = pyautogui.center(box)
        log('Shift-clicking checkbox at ' + str(center))
        pyautogui.keyDown('shift')
        pyautogui.click(center)
        pyautogui.keyUp('shift')
        time.sleep(0.2)
    time.sleep(0.5)

    # Step 7 - Submit button (image recognition - button position can vary)
    log('Step 7: Clicking Submit button')
    windows_before_submit = get_window_count()
    log('Step 7: Window count before submit = ' + str(windows_before_submit))
    if not find_and_click('submit.png', 'Submit button'):
        print('IMPORT_FAILED: Submit button not found', flush=True)
        sys.exit(1)

    # Step 8 - Wait for PIN/Password dialog
    log('Step 8: Waiting for PIN/Password dialog (5s)...')
    time.sleep(5)

    screenshot_path = img('pin_dialog.png')
    pyautogui.screenshot(screenshot_path)
    log('Debug screenshot saved to ' + screenshot_path)

    batch_pin      = os.environ.get('BATCH_PROVIDER_PIN', '')
    batch_password = os.environ.get('BATCH_PROVIDER_PASSWORD', '')
    if not batch_pin:
        print('IMPORT_FAILED: BATCH_PROVIDER_PIN environment variable is not set', flush=True)
        sys.exit(1)
    if not batch_password:
        print('IMPORT_FAILED: BATCH_PROVIDER_PASSWORD environment variable is not set', flush=True)
        sys.exit(1)

    # Step 8a - Click PIN field and type PIN (image recognition - modal dialog)
    log('Step 8a: Clicking PIN field')
    if not find_and_click('pin_field.png', 'PIN field'):
        print('IMPORT_FAILED: PIN field not found', flush=True)
        sys.exit(1)
    time.sleep(0.3)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(batch_pin, interval=0.15)
    time.sleep(0.3)

    # Step 8b - Click Password field and type password (image recognition - modal dialog)
    log('Step 8b: Clicking Password field')
    if not find_and_click('password_field.png', 'Password field'):
        print('IMPORT_FAILED: Password field not found', flush=True)
        sys.exit(1)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(batch_password, interval=0.15)
    time.sleep(0.3)

    # Step 8c - Click PIN submit (image recognition - modal dialog)
    log('Step 8c: Clicking OK in PIN dialog')
    if not find_and_click('pin_submit.png', 'PIN dialog Submit button'):
        print('IMPORT_FAILED: PIN dialog Submit button not found', flush=True)
        sys.exit(1)

    # Step 8d - Click OK to confirm submission (always required after PIN submit)
    log('Step 8d: Waiting 3s then clicking OK at (790, 629)')
    time.sleep(3)
    pyautogui.click(790, 629)
    log('Step 8d complete: OK clicked')

    log('Waiting for BP to process (5s)...')
    time.sleep(5)

    # Step 9 - Detect success vs error using window count (no image search = no hang).
    # If BP opened a new dialog after PIN submit, it's the incomplete-payment error.
    # If no new dialog appeared, the payment succeeded — press Enter to dismiss
    # any success confirmation and exit.
    windows_after_submit = get_window_count()
    log('Step 9: Window count after submit = ' + str(windows_after_submit))

    error_detected = (
        windows_before_submit >= 0 and
        windows_after_submit >= 0 and
        windows_after_submit > windows_before_submit
    )

    if not error_detected:
        log('Step 9: No new dialog — payment submitted successfully')
        print('IMPORT_COMPLETE', flush=True)
        sys.exit(0)

    log('Step 9: New dialog detected — incomplete/override error — entering recovery flow')
    if handle_incomplete_payment_recovery():
        log('Recovery complete — payment overridden and resubmitted')
        print('IMPORT_COMPLETE', flush=True)
        sys.exit(0)
    else:
        print('IMPORT_FAILED: Override/recovery flow failed — manual intervention needed', flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
