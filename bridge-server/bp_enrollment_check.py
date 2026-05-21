"""
EFTPS Batch Provider enrollment status checker using pyautogui.

Usage:
    python bp_enrollment_check.py <ein>

Exit codes:
    0  ENROLLMENT_ACTIVE   — EIN found with Active status
    1  ENROLLMENT_PENDING  — EIN not found or status not Active

Requires:
    pip install pyautogui opencv-python pillow

Screenshots needed in button_images/:
    enrollments_tab.png        — Enrollments tab at the top of Batch Provider
    enrollment_inquiry.png     — Enrollment Inquiry button on the Enrollments screen
    enroll_sync.png            — Sync button in the Enrollment Inquiry screen
    enroll_ok.png              — OK / Close button to dismiss dialogs

Environment variables:
    BATCH_PROVIDER_MASTER_PIN       — Master PIN for Batch Provider
    BATCH_PROVIDER_MASTER_PASSWORD  — Master Password for Batch Provider
"""

import sys
import os
import time
import subprocess
import pyautogui

pyautogui.FAILSAFE = False

CONFIDENCE = 0.7
IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'button_images')

MASTER_PIN      = os.environ.get('BATCH_PROVIDER_MASTER_PIN', '')
MASTER_PASSWORD = os.environ.get('BATCH_PROVIDER_MASTER_PASSWORD', '')


def log(msg):
    print('[ENROLL CHECK] ' + str(msg), flush=True)


def img(filename):
    return os.path.join(IMAGES_DIR, filename)


def find_and_click(filename, description, timeout=10, confidence=CONFIDENCE):
    log('Looking for ' + description + '...')
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            loc = pyautogui.locateOnScreen(img(filename), confidence=confidence)
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


def get_clipboard():
    """Read clipboard text via PowerShell (Windows)."""
    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command', 'Get-Clipboard'],
            capture_output=True, text=True, timeout=10
        )
        return result.stdout
    except Exception as e:
        log('Clipboard read error: ' + str(e))
        return ''


def main():
    if len(sys.argv) < 2:
        print('ENROLLMENT_PENDING: No EIN provided', flush=True)
        sys.exit(1)

    ein = sys.argv[1].replace('-', '').strip()
    log('Checking enrollment status for EIN: ' + ein)

    if not MASTER_PIN:
        log('WARNING: BATCH_PROVIDER_MASTER_PIN not set in environment')
    if not MASTER_PASSWORD:
        log('WARNING: BATCH_PROVIDER_MASTER_PASSWORD not set in environment')

    # Step 1 — Click Enrollments tab
    log('Step 1: Clicking Enrollments tab')
    if not find_and_click('enrollments_tab.png', 'Enrollments tab', timeout=15):
        print('ENROLLMENT_PENDING: Enrollments tab not found', flush=True)
        sys.exit(1)
    time.sleep(1)

    # Step 2 — Click Enrollment Inquiry
    log('Step 2: Clicking Enrollment Inquiry')
    if not find_and_click('enrollment_inquiry.png', 'Enrollment Inquiry', timeout=10):
        print('ENROLLMENT_PENDING: Enrollment Inquiry button not found', flush=True)
        sys.exit(1)
    time.sleep(2)

    # Step 3 — Enter Master PIN if dialog appears
    if MASTER_PIN:
        log('Step 3: Entering Master PIN')
        pyautogui.hotkey('ctrl', 'a')
        time.sleep(0.2)
        pyautogui.typewrite(MASTER_PIN, interval=0.1)
        time.sleep(0.3)
        pyautogui.press('tab')
        time.sleep(0.3)

    # Step 4 — Enter Master Password
    if MASTER_PASSWORD:
        log('Step 4: Entering Master Password')
        pyautogui.hotkey('ctrl', 'a')
        time.sleep(0.2)
        pyautogui.typewrite(MASTER_PASSWORD, interval=0.1)
        time.sleep(0.3)
        pyautogui.press('enter')
        time.sleep(3)  # wait for inquiry window to load

    # Step 5 — Click Sync to refresh enrollment data from EFTPS
    log('Step 5: Clicking Sync')
    if not find_and_click('enroll_sync.png', 'Sync button', timeout=15):
        log('WARNING: Sync button not found — proceeding without sync')
    time.sleep(10)  # EFTPS sync can take several seconds

    # Step 6 — Select all rows in the enrollment list and copy to clipboard
    log('Step 6: Selecting all and copying enrollment list')
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.5)
    pyautogui.hotkey('ctrl', 'c')
    time.sleep(1)

    # Step 7 — Read clipboard and search for EIN with Active status
    log('Step 7: Reading clipboard')
    clipboard = get_clipboard()
    log('Clipboard length: ' + str(len(clipboard)) + ' chars')

    # Normalize EIN formats — strip dashes and look for "Active" near the EIN
    ein_variants = [ein, ein[:2] + '-' + ein[2:]]  # 123456789 and 12-3456789
    found_active = False

    for line in clipboard.splitlines():
        line_stripped = line.strip()
        for variant in ein_variants:
            if variant in line_stripped and 'Active' in line_stripped:
                log('Found Active enrollment for EIN ' + ein + ': ' + line_stripped)
                found_active = True
                break
        if found_active:
            break

    # Step 8 — Dismiss any open dialog
    try:
        find_and_click('enroll_ok.png', 'OK/Close button', timeout=3)
    except Exception:
        pass

    if found_active:
        log('Enrollment is Active — proceeding')
        print('ENROLLMENT_ACTIVE', flush=True)
        sys.exit(0)
    else:
        log('Enrollment not yet Active for EIN ' + ein)
        print('ENROLLMENT_PENDING', flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
