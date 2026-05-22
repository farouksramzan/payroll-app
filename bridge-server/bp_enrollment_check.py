"""
EFTPS Batch Provider enrollment status checker using pyautogui + pytesseract OCR.

Usage:
    python bp_enrollment_check.py <ein>

Exit codes:
    0  ENROLLMENT_ACTIVE   — EIN found with Active status in the inquiry list
    1  ENROLLMENT_PENDING  — EIN not found, not Active, or an error occurred

Requires:
    pip install pyautogui opencv-python pillow pytesseract

Environment variables:
    BATCH_PROVIDER_MASTER_PIN       — Master PIN for Batch Provider sync dialog
    BATCH_PROVIDER_MASTER_PASSWORD  — Master Password for Batch Provider sync dialog
    TESSERACT_PATH                  — Full path to tesseract.exe
                                      e.g. C:\\Users\\mramz\\OneDrive\\Desktop\\tesseract.exe

Screenshots needed in button_images/:
    enrollments_tab.png     — Enrollments tab at the top of Batch Provider
    enrollment_inquiry.png  — Enrollment Inquiry button on the Enrollments screen
    enroll_sync.png         — Sync button in the Enrollment Inquiry screen
    enroll_sync_pin.png     — PIN input field in the sync credentials dialog
    enroll_sync_password.png — Password input field in the sync credentials dialog
    enroll_sync_submit.png  — Submit button in the sync credentials dialog
    enroll_sync_ok.png      — OK button after sync completes
"""

import sys
import os
import time
import pyautogui
import pytesseract
from PIL import Image

pyautogui.FAILSAFE = False

CONFIDENCE  = 0.7
IMAGES_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'button_images')

MASTER_PIN      = os.environ.get('BATCH_PROVIDER_MASTER_PIN', '')
MASTER_PASSWORD = os.environ.get('BATCH_PROVIDER_MASTER_PASSWORD', '')
TESSERACT_PATH  = os.environ.get('TESSERACT_PATH', 'tesseract')

# Point pytesseract at the correct tesseract binary
pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH


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


def ocr_screen_for_ein(ein):
    """Take a full screenshot and use OCR to find the EIN with Active status."""
    log('Taking screenshot for OCR...')
    screenshot = pyautogui.screenshot()
    text = pytesseract.image_to_string(screenshot, config='--psm 6')
    log('OCR text length: ' + str(len(text)) + ' chars')

    # Also check with common OCR misreads of dashes
    ein_clean   = ein.replace('-', '').strip()
    ein_dashed  = ein_clean[:2] + '-' + ein_clean[2:]   # 12-3456789
    ein_variants = [ein_clean, ein_dashed]

    for line in text.splitlines():
        line_stripped = line.strip()
        for variant in ein_variants:
            if variant in line_stripped and 'Active' in line_stripped:
                log('Found Active enrollment for EIN ' + ein_clean + ': ' + line_stripped)
                return True

    log('EIN ' + ein_clean + ' not found as Active in OCR output')
    log('Raw OCR (first 2000 chars): ' + text[:2000])
    return False


def main():
    if len(sys.argv) < 2:
        print('ENROLLMENT_PENDING: No EIN provided', flush=True)
        sys.exit(1)

    ein = sys.argv[1].replace('-', '').strip()
    log('Checking enrollment status for EIN: ' + ein)

    if not MASTER_PIN:
        log('WARNING: BATCH_PROVIDER_MASTER_PIN not set — sync dialog may fail')
    if not MASTER_PASSWORD:
        log('WARNING: BATCH_PROVIDER_MASTER_PASSWORD not set — sync dialog may fail')

    # ── Step 1: Click Enrollments tab ────────────────────────────────────────
    log('Step 1: Clicking Enrollments tab at (312, 103)')
    time.sleep(0.5)
    pyautogui.click(312, 103)
    log('Step 1 complete: Enrollments tab clicked')
    time.sleep(1)

    # ── Step 2: Click Enrollment Inquiry ─────────────────────────────────────
    log('Step 2: Clicking Enrollment Inquiry at (189, 134)')
    time.sleep(0.5)
    pyautogui.click(189, 134)
    log('Step 2 complete: Enrollment Inquiry clicked')
    time.sleep(1)

    # ── Step 3: Click Sync ───────────────────────────────────────────────────
    log('Step 3: Clicking Sync at (1830, 964)')
    time.sleep(0.5)
    pyautogui.click(1830, 964)
    log('Step 3 complete: Sync clicked')
    time.sleep(2)  # wait for PIN/Password dialog to appear

    # ── Step 4: Click PIN field and type Master PIN ───────────────────────────
    log('Step 4: Clicking PIN field at (934, 472)')
    time.sleep(0.5)
    pyautogui.click(934, 472)
    log('Step 4 complete: PIN field clicked')
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(MASTER_PIN, interval=0.15)
    time.sleep(0.3)

    # ── Step 5: Click Password field and type Master Password ─────────────────
    log('Step 5: Clicking Password field at (972, 494)')
    time.sleep(0.5)
    pyautogui.click(972, 494)
    log('Step 5 complete: Password field clicked')
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(0.2)
    pyautogui.typewrite(MASTER_PASSWORD, interval=0.15)
    time.sleep(0.3)

    # ── Step 6: Click Submit ──────────────────────────────────────────────────
    log('Step 6: Clicking Submit at (1844, 959)')
    time.sleep(0.5)
    pyautogui.click(1844, 959)
    log('Step 6 complete: Submit clicked')
    time.sleep(3)  # wait for sync to complete

    # ── Step 7: Click OK to dismiss confirmation ──────────────────────────────
    log('Step 7: Clicking OK at (821, 683)')
    time.sleep(0.5)
    pyautogui.click(821, 683)
    log('Step 7 complete: OK clicked')
    time.sleep(5)  # wait for enrollment list to fully load

    # ── Step 8: OCR the screen and look for EIN with Active status ────────────
    log('Step 8: Running OCR to check enrollment status')
    active = ocr_screen_for_ein(ein)

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
