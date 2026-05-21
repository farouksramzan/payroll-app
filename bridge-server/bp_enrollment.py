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
    log('Executing step 1: click Enrollments tab')
    if not find_and_click('enrollments_tab.png', 'Enrollments tab', timeout=15):
        print('ENROLLMENT_FAILED: Enrollments tab not found', flush=True)
        sys.exit(1)
    log('Step 1 complete: Enrollments tab clicked')
    time.sleep(1)

    # Step 2 — Click Send Enrollments button
    log('Executing step 2: click Send Enrollments button')
    if not find_and_click('send_enrollments.png', 'Send Enrollments button', timeout=10):
        print('ENROLLMENT_FAILED: Send Enrollments button not found', flush=True)
        sys.exit(1)
    log('Step 2 complete: Send Enrollments button clicked')
    time.sleep(1)

    # Step 3 — Click Import button
    log('Executing step 3: click Import button')
    if not find_and_click('enroll_import.png', 'Import button', timeout=10):
        print('ENROLLMENT_FAILED: Import button not found', flush=True)
        sys.exit(1)
    log('Step 3 complete: Import button clicked — waiting 2s for File Format Selector')
    time.sleep(2)

    # Step 4 — Click Add button in File Format Selector dialog
    log('Executing step 4: click Add button in File Format Selector')
    if not find_and_click('enroll_add.png', 'Add button', timeout=10):
        print('ENROLLMENT_FAILED: Add button not found', flush=True)
        sys.exit(1)
    log('Step 4 complete: Add button clicked — waiting 2s for file browser')
    time.sleep(2)

    # Step 5 — Select all text in filename field and type filename
    filename = os.path.basename(enroll_file_path)
    log('Executing step 5: select all in filename field')
    pyautogui.hotkey('ctrl', 'a')
    log('Step 5a complete: Ctrl+A sent')
    time.sleep(0.3)
    log('Executing step 5b: type filename — ' + filename)
    pyautogui.typewrite(filename, interval=0.15)
    log('Step 5b complete: filename typed')
    time.sleep(0.3)
    log('Executing step 5c: press Enter to submit filename')
    pyautogui.press('enter')
    log('Step 5c complete: Enter pressed — waiting 4s for file browser to process')
    time.sleep(4)

    # Step 6 — Press Enter to confirm Open
    log('Executing step 6: press Enter to confirm Open')
    pyautogui.press('enter')
    log('Step 6 complete: Enter pressed — waiting 5s for dialog to appear')
    time.sleep(5)

    # Debug screenshot — shows what is on screen before looking for enroll_ok.png
    debug_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(debug_dir, exist_ok=True)
    debug_path = os.path.join(debug_dir, 'debug_after_enter.png')
    log('Executing step 6d: saving debug screenshot to ' + debug_path)
    pyautogui.screenshot(debug_path)
    log('Step 6d complete: debug screenshot saved')

    # Step 7 — Wait for dialog to fully render then click OK (first time)
    log('Executing step 7: waiting 5s for File Format Selector dialog to fully render')
    time.sleep(5)
    log('Executing step 7: click OK button (first)')
    if not find_and_click('enroll_ok.png', 'OK button (first)', timeout=10, confidence=0.6):
        print('ENROLLMENT_FAILED: First OK button not found', flush=True)
        sys.exit(1)
    log('Step 7 complete: first OK clicked — waiting 2s')
    time.sleep(2)

    # Step 8 — Click OK (second time — confirmation/summary)
    log('Executing step 8: click OK button (second — confirmation)')
    if not find_and_click('enroll_ok2.png', 'OK button (second)', timeout=10, confidence=0.6):
        print('ENROLLMENT_FAILED: Second OK button not found', flush=True)
        sys.exit(1)
    log('Step 8 complete: second OK clicked')
    time.sleep(1)

    log('All steps complete — enrollment import finished successfully')
    print('ENROLLMENT_COMPLETE', flush=True)
    sys.exit(0)


if __name__ == '__main__':
    main()
