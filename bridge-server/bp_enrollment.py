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
    enrollments_tab.png   — Enrollments tab at the top of Batch Provider
    send_enrollments.png  — Send Enrollments button on the Enrollments screen
    enroll_import.png     — Import button in the Send Enrollments dialog
    enroll_add.png        — Add button in the File Format Selector dialog
    enroll_open.png       — Open button in the file browser
    enroll_ok.png         — First OK button (after file is loaded)
    enroll_ok2.png        — Second OK button (confirmation/summary)
"""

import sys
import os
import time
import pyautogui

pyautogui.FAILSAFE = False

CONFIDENCE = 0.7
IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'button_images')


def log(msg):
    print('[ENROLL] ' + str(msg), flush=True)


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

    # Step 2 — Click Send Enrollments button
    log('Step 2: Clicking Send Enrollments button')
    if not find_and_click('send_enrollments.png', 'Send Enrollments button', timeout=10):
        print('ENROLLMENT_FAILED: Send Enrollments button not found', flush=True)
        sys.exit(1)
    time.sleep(1)

    # Step 3 — Click Import button
    log('Step 3: Clicking Import button')
    if not find_and_click('enroll_import.png', 'Import button', timeout=10):
        print('ENROLLMENT_FAILED: Import button not found', flush=True)
        sys.exit(1)
    time.sleep(2)  # wait for File Format Selector dialog

    # Step 4 — Click Add button in File Format Selector dialog
    log('Step 4: Clicking Add button')
    if not find_and_click('enroll_add.png', 'Add button', timeout=10):
        print('ENROLLMENT_FAILED: Add button not found', flush=True)
        sys.exit(1)
    time.sleep(2)  # wait for file browser to open

    # Step 5 — Type filename in the file browser and press Enter to open
    filename = os.path.basename(enroll_file_path)
    log('Step 5: Typing filename: ' + filename)
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.3)
    pyautogui.typewrite(filename, interval=0.15)
    time.sleep(0.3)
    pyautogui.press('enter')
    time.sleep(4)

    # Step 6 — Press Enter again to confirm Open (more reliable than image search)
    log('Step 6: Pressing Enter to open file')
    pyautogui.press('enter')
    time.sleep(5)

    # Debug screenshot — shows what is on screen before looking for enroll_ok.png
    debug_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(debug_dir, exist_ok=True)
    debug_path = os.path.join(debug_dir, 'debug_after_enter.png')
    pyautogui.screenshot(debug_path)
    log('Debug screenshot saved to ' + debug_path)

    # Step 7 — Click OK (first time)
    log('Step 7: Clicking OK (first)')
    if not find_and_click('enroll_ok.png', 'OK button (first)', timeout=10):
        print('ENROLLMENT_FAILED: First OK button not found', flush=True)
        sys.exit(1)
    time.sleep(2)

    # Step 8 — Click OK (second time — confirmation)
    log('Step 8: Clicking OK (second)')
    if not find_and_click('enroll_ok2.png', 'OK button (second)', timeout=10):
        print('ENROLLMENT_FAILED: Second OK button not found', flush=True)
        sys.exit(1)
    time.sleep(1)

    log('Enrollment import completed successfully')
    print('ENROLLMENT_COMPLETE', flush=True)
    sys.exit(0)


if __name__ == '__main__':
    main()
