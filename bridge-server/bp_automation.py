"""
EFTPS Batch Provider import automation using pyautogui.

Usage:
    python bp_automation.py <ach_file_path>

Exit codes:
    0  success  (prints IMPORT_COMPLETE)
    1  failure  (prints IMPORT_FAILED: <reason>)

Requires:
    pip install pyautogui opencv-python pillow
"""

import sys
import os
import time
import pyautogui

pyautogui.FAILSAFE = False

CONFIDENCE  = 0.8
IMAGES_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'button_images')


def log(msg):
    print('[BP] ' + str(msg), flush=True)


def img(filename):
    return os.path.join(IMAGES_DIR, filename)


def find_and_click(filename, description, timeout=10):
    log('Looking for ' + description + '...')
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            loc = pyautogui.locateOnScreen(img(filename), confidence=CONFIDENCE)
            if loc:
                cx, cy = pyautogui.center(loc)
                log('Found ' + description + ' at (' + str(cx) + ', ' + str(cy) + ') — clicking')
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

    # Step 0 — Navigate to Payments tab
    log('Step 0: Clicking Payments tab')
    if not find_and_click('payments_tab.png', 'Payments tab', timeout=15):
        print('IMPORT_FAILED: Payments tab not found', flush=True)
        sys.exit(1)
    time.sleep(1)

    # Step 1 — Import button
    log('Step 1: Clicking Import button')
    if not find_and_click('import.png', 'Import button'):
        print('IMPORT_FAILED: Import button not found', flush=True)
        sys.exit(1)
    time.sleep(2)

    # Step 2 — Add button (File Format Selector dialog)
    log('Step 2: Clicking Add button')
    if not find_and_click('add.png', 'Add button'):
        print('IMPORT_FAILED: Add button not found', flush=True)
        sys.exit(1)
    time.sleep(2)

    # Step 3 — Type ACH file path in filename field and press Enter
    filename = os.path.basename(ach_file_path)
    log('Step 3: Typing filename: ' + filename)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(filename, interval=0.15)
    time.sleep(0.2)
    pyautogui.press('enter')
    time.sleep(2)

    # Step 4 — First OK button
    log('Step 4: Clicking OK button')
    if not find_and_click('ok.png', 'OK button'):
        print('IMPORT_FAILED: OK button not found', flush=True)
        sys.exit(1)
    time.sleep(2)

    # Step 5 — Second OK button
    log('Step 5: Clicking second OK button')
    if not find_and_click('ok2.png', 'second OK button'):
        print('IMPORT_FAILED: Second OK button not found', flush=True)
        sys.exit(1)
    time.sleep(2)

    # Step 6 — Select all unsubmitted payment checkboxes
    log('Step 6: Finding payment checkboxes')
    checkbox_region = (1600, 200, 300, 700)
    checkboxes = list(pyautogui.locateAllOnScreen(
        img('checkbox.png'), confidence=CONFIDENCE, region=checkbox_region
    ))
    if not checkboxes:
        print('IMPORT_FAILED: No payment checkboxes found', flush=True)
        sys.exit(1)
    log('Found ' + str(len(checkboxes)) + ' checkbox(es)')

    # Click first checkbox normally
    first = pyautogui.center(checkboxes[0])
    log('Clicking first checkbox at ' + str(first))
    pyautogui.click(first)
    time.sleep(0.5)

    # Shift-click every remaining checkbox
    for box in checkboxes[1:]:
        center = pyautogui.center(box)
        log('Shift-clicking checkbox at ' + str(center))
        pyautogui.keyDown('shift')
        pyautogui.click(center)
        pyautogui.keyUp('shift')
        time.sleep(0.2)
    time.sleep(0.5)

    # Step 7 — Submit button
    log('Step 7: Clicking Submit button')
    if not find_and_click('submit.png', 'Submit button'):
        print('IMPORT_FAILED: Submit button not found', flush=True)
        sys.exit(1)

    # Step 8 — PIN / Password dialog
    log('Step 8: Waiting for PIN / Password dialog (5s)...')
    time.sleep(5)

    # Save a screenshot of whatever is on screen for reference / debugging
    screenshot_path = img('pin_dialog.png')
    pyautogui.screenshot(screenshot_path)
    log('Screenshot saved to ' + screenshot_path)

    # Read credentials from environment — never hardcoded
    batch_pin      = os.environ.get('BATCH_PROVIDER_PIN', '')
    batch_password = os.environ.get('BATCH_PROVIDER_PASSWORD', '')
    if not batch_pin:
        print('IMPORT_FAILED: BATCH_PROVIDER_PIN environment variable is not set', flush=True)
        sys.exit(1)
    if not batch_password:
        print('IMPORT_FAILED: BATCH_PROVIDER_PASSWORD environment variable is not set', flush=True)
        sys.exit(1)

    # Click PIN field and type PIN
    log('Step 8a: Clicking PIN field')
    if not find_and_click('pin_field.png', 'PIN field'):
        print('IMPORT_FAILED: PIN field not found', flush=True)
        sys.exit(1)
    time.sleep(0.3)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(os.environ.get('BATCH_PROVIDER_PIN', ''), interval=0.15)
    time.sleep(0.3)

    # Click Password field and type password
    log('Step 8b: Clicking Password field')
    if not find_and_click('password_field.png', 'Password field'):
        print('IMPORT_FAILED: Password field not found', flush=True)
        sys.exit(1)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(batch_password, interval=0.15)
    time.sleep(0.3)

    # Click OK / Submit in the PIN dialog
    log('Step 8c: Clicking OK in PIN dialog')
    if not find_and_click('pin_submit.png', 'PIN dialog Submit button'):
        print('IMPORT_FAILED: PIN dialog Submit button not found', flush=True)
        sys.exit(1)

    log('Waiting for confirmation (3s)...')
    time.sleep(3)

    # Step 9 — OK button on submission confirmation dialog
    log('Step 9: Clicking submission confirmation OK')
    if not find_and_click('submit_ok.png', 'submission confirmation OK'):
        print('IMPORT_FAILED: Submission confirmation OK button not found', flush=True)
        sys.exit(1)

    log('Import completed successfully')
    print('IMPORT_COMPLETE', flush=True)
    sys.exit(0)


if __name__ == '__main__':
    main()
