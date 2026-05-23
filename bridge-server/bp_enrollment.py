import sys
import os
import time
import pyautogui
import pytesseract

pyautogui.FAILSAFE = False

CONFIDENCE = 0.7
IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'button_images')
CHECKBOX_X = 906  # x-coordinate of the checkbox column in Send Enrollments list

pytesseract.pytesseract.tesseract_cmd = os.environ.get(
    'TESSERACT_PATH', r'C:\Users\mramz\OneDrive\Desktop\tesseract.exe'
)


def log(msg):
    print('[ENROLL] ' + str(msg), flush=True)


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


def find_new_row_ys():
    # OCR the screen and return center-y for every row whose status column reads New
    log('OCR scan: looking for New status rows...')
    screenshot = pyautogui.screenshot()
    data = pytesseract.image_to_data(
        screenshot, config='--psm 6', output_type=pytesseract.Output.DICT
    )
    ys = []
    for i, text in enumerate(data['text']):
        if text.strip() in ('New', 'NEW', 'new'):
            center_y = data['top'][i] + data['height'][i] // 2
            # Deduplicate rows that are within 10 pixels of each other
            if not any(abs(center_y - y) < 10 for y in ys):
                ys.append(center_y)
                log('Found New row at y=' + str(center_y))
    return ys


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

    # Step 7 - Click second OK button (confirmation/summary)
    log('Executing step 7: click OK button (second) at (806, 634)')
    time.sleep(2)
    pyautogui.click(806, 634)
    log('Step 7 complete: second OK clicked - waiting 2s')
    time.sleep(2)

    # Step 8 - OCR scan to find all New status rows and click their checkboxes
    # The checkbox column is always at x=CHECKBOX_X regardless of how many rows exist
    log('Executing step 8: OCR scan for New enrollment rows')
    new_ys = find_new_row_ys()
    if not new_ys:
        print('ENROLLMENT_FAILED: No New status rows found in Send Enrollments list', flush=True)
        sys.exit(1)
    log('Step 8: found ' + str(len(new_ys)) + ' New row(s) - clicking checkboxes')
    for i, cy in enumerate(new_ys):
        log('Step 8: clicking checkbox ' + str(i + 1) + ' at (' + str(CHECKBOX_X) + ', ' + str(cy) + ')')
        pyautogui.click(CHECKBOX_X, cy)
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
