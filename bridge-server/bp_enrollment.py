"""
EFTPS Batch Provider enrollment import automation using pyautogui.

Usage:
    python bp_enrollment.py <enrollment_file_path>

Exit codes:
    0  success  (prints ENROLLMENT_COMPLETE)
    1  failure  (prints ENROLLMENT_FAILED: <reason>)

Requires:
    pip install pyautogui opencv-python pillow
"""

import sys
import os
import time
import pyautogui

pyautogui.FAILSAFE = False

CONFIDENCE = 0.8
IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'button_images')


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

    enroll_file_path = sys.argv[1]
    log('Starting enrollment import')
    log('Enrollment file: ' + enroll_file_path)

    # Step 1 — Click Enrollments tab
    log('Step 1: Clicking Enrollments tab')
    if not find_and_click('enroll_tab.png', 'Enrollments tab', timeout=15):
        print('ENROLLMENT_FAILED: Enrollments tab not found', flush=True)
        sys.exit(1)
    time.sleep(1)

    # Step 2 — Click Import button on the Enrollments tab
    log('Step 2: Clicking Enrollment Import button')
    if not find_and_click('enroll_import.png', 'Enrollment Import button', timeout=10):
        print('ENROLLMENT_FAILED: Enrollment Import button not found', flush=True)
        sys.exit(1)
    time.sleep(2)

    # Step 3 — Type enrollment filename in the file browser field and press Enter
    filename = os.path.basename(enroll_file_path)
    log('Step 3: Typing filename: ' + filename)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(filename, interval=0.15)
    time.sleep(0.2)
    pyautogui.press('enter')
    time.sleep(2)

    # Step 4 — Click OK to confirm import
    log('Step 4: Clicking OK')
    if not find_and_click('ok.png', 'OK button', timeout=10):
        print('ENROLLMENT_FAILED: OK button not found', flush=True)
        sys.exit(1)
    time.sleep(2)

    log('Enrollment import completed successfully')
    print('ENROLLMENT_COMPLETE', flush=True)
    sys.exit(0)


if __name__ == '__main__':
    main()
