import sys
import os
import time
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


def log(msg):
    print('[BP] ' + str(msg), flush=True)


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

    # Step 1 - Import button
    log('Step 1: Clicking Import button at (386, 966)')
    time.sleep(0.5)
    pyautogui.click(386, 966)
    log('Step 1 complete: Import button clicked')
    time.sleep(2)

    # Step 2 - Add button in File Format Selector dialog
    log('Step 2: Clicking Add button at (833, 482)')
    time.sleep(0.5)
    pyautogui.click(833, 482)
    log('Step 2 complete: Add button clicked')
    time.sleep(2)

    # Step 3 - Type ACH filename and press Enter
    filename = os.path.basename(ach_file_path)
    log('Step 3: Typing filename: ' + filename)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(filename, interval=0.15)
    time.sleep(0.2)
    pyautogui.press('enter')
    time.sleep(2)

    # Step 4 - First OK button (confirms file selection in the dialog)
    log('Step 4: Clicking OK button at (1111, 639)')
    time.sleep(0.5)
    pyautogui.click(1111, 639)
    log('Step 4 complete: OK button clicked')
    time.sleep(2)

    # Step 5 - Second OK button (triggers the actual import)
    log('Step 5: Clicking second OK button at (798, 629)')
    time.sleep(0.5)
    pyautogui.click(798, 629)
    log('Step 5 complete: second OK button clicked')

    # Wait for the import to either succeed or fail (progress bar runs during this time)
    time.sleep(4)

    # Check if File Format Selector is still open — if it is, the import errored out.
    # We press Enter to dismiss OK regardless of where the button moved on screen
    # (an error banner shifts it down, so we never use coordinates here).
    if is_file_format_selector_open():
        log('File Format Selector still open after import — error detected')
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

    log('Waiting for confirmation (3s)...')
    time.sleep(3)

    # Step 9 - Click submission confirmation OK (image recognition - modal dialog)
    log('Step 9: Clicking submission confirmation OK')
    if not find_and_click('submit_ok.png', 'submission confirmation OK'):
        print('IMPORT_FAILED: Submission confirmation OK button not found', flush=True)
        sys.exit(1)

    log('Import completed successfully')
    print('IMPORT_COMPLETE', flush=True)
    sys.exit(0)


if __name__ == '__main__':
    main()
