"""
EFTPS Batch Provider enrollment import automation using pyautogui.

Usage:
    python bp_enrollment.py <enrollment_file_path>

Exit codes:
    0  success  (prints ENROLLMENT_COMPLETE)
    1  failure  (prints ENROLLMENT_FAILED: <reason>)

Requires:
    pip install pyautogui opencv-python pillow

Screenshots needed in button_images/:
    enrollments_tab.png   — the Enrollments tab in the Batch Provider toolbar
    enroll_import.png     — the Import button on the Enrollments screen
    enroll_ok.png         — the OK/Confirm button after selecting the file
    enroll_submit.png     — the Submit button that sends enrollments to EFTPS
"""

import sys
import os
import time
import pyautogui

pyautogui.FAILSAFE = False

CONFIDENCE  = 0.8
IMAGES_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'button_images')
SYNC_WAIT   = 30  # seconds to wait after Submit for Batch Provider to sync


def log(msg):
    print('[ENROLL] ' + str(msg), flush=True)


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
        print('ENROLLMENT_FAILED: No enrollment file path provided', flush=True)
        sys.exit(1)

    enroll_file_path = os.path.abspath(sys.argv[1])
    log('Starting enrollment import')
    log('Enrollment file: ' + enroll_file_path)

    if not os.path.isfile(enroll_file_path):
        print('ENROLLMENT_FAILED: Enrollment file not found: ' + enroll_file_path, flush=True)
        sys.exit(1)

    # Step 1 — Click Enrollments tab
    log('Step 1: Clicking Enrollments tab')
    if not find_and_click('enrollments_tab.png', 'Enrollments tab', timeout=15):
        print('ENROLLMENT_FAILED: Enrollments tab not found', flush=True)
        sys.exit(1)
    time.sleep(1)

    # Step 2 — Click Import button on the Enrollments tab
    log('Step 2: Clicking Enrollment Import button')
    if not find_and_click('enroll_import.png', 'Enrollment Import button', timeout=10):
        print('ENROLLMENT_FAILED: Enrollment Import button not found', flush=True)
        sys.exit(1)
    time.sleep(2)

    # Step 3 — Type full absolute file path in the file browser and press Enter
    log('Step 3: Typing full file path: ' + enroll_file_path)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.3)
    pyautogui.typewrite(enroll_file_path, interval=0.15)
    time.sleep(0.3)
    pyautogui.press('enter')
    time.sleep(2)

    # Step 4 — Click OK to confirm import
    log('Step 4: Clicking OK')
    if not find_and_click('enroll_ok.png', 'OK button', timeout=10):
        print('ENROLLMENT_FAILED: OK button not found', flush=True)
        sys.exit(1)
    time.sleep(1.5)

    # Step 5 — Click Submit to send enrollment to EFTPS
    log('Step 5: Clicking Submit')
    if not find_and_click('enroll_submit.png', 'Submit button', timeout=10):
        print('ENROLLMENT_FAILED: Submit button not found', flush=True)
        sys.exit(1)

    # Step 6 — Wait for Batch Provider to sync with EFTPS
    log('Step 6: Waiting up to ' + str(SYNC_WAIT) + 's for Batch Provider sync...')
    time.sleep(SYNC_WAIT)

    log('Enrollment submitted successfully')
    print('ENROLLMENT_COMPLETE', flush=True)
    sys.exit(0)


if __name__ == '__main__':
    main()
