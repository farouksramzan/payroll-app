"""
EFTPS Batch Provider import automation — SikuliX Jython script.

Run with:
    java -jar sikulixapi-2.0.5-windows.jar -r sikulix_automation.py --args <ach_file_path>

SikuliX places everything after --args into sys.argv:
    sys.argv[0] = script path
    sys.argv[1] = ach_file_path

Exit codes:
    0  success  (prints IMPORT_COMPLETE)
    1  failure  (prints IMPORT_FAILED: <reason>)
"""

import sys
import os

from sikuli import Screen, Pattern, Key, KeyModifier, FindFailed  # SikuliX Jython API


# ── Config ────────────────────────────────────────────────────────────────────

_script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
IMAGES_DIR  = os.path.join(_script_dir, 'button_images')
SIMILARITY  = 0.8
TIMEOUT     = 15  # seconds to wait for each element


# ── Helpers ───────────────────────────────────────────────────────────────────

def log(msg):
    print('[SIKULIX] ' + str(msg))
    sys.stdout.flush()

def pat(filename):
    """Return a SikuliX Pattern with the configured similarity threshold."""
    return Pattern(os.path.join(IMAGES_DIR, filename)).similar(SIMILARITY)

def find_and_click(s, filename, description):
    """Wait for pattern to appear on screen then click it. Raises FindFailed on timeout."""
    log('Looking for ' + description + '...')
    s.click(pat(filename))
    log('Clicked ' + description)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print('IMPORT_FAILED: No ACH file path provided as --args argument')
        sys.exit(1)

    ach_file_path = sys.argv[1]
    log('Starting Batch Provider import automation')
    log('ACH file: ' + ach_file_path)

    s = Screen()
    s.setAutoWaitTimeout(TIMEOUT)

    try:
        # Step 1 — Import button
        log('Step 1: Import button')
        find_and_click(s, 'import.png', 'Import button')
        wait(1.0)

        # Step 2 — Add button (File Format Selector dialog)
        log('Step 2: Add button')
        find_and_click(s, 'add.png', 'Add button')
        wait(1.0)

        # Step 3 — Type ACH file path in the filename field and press Enter
        log('Step 3: Typing file path into filename field')
        type('a', KeyModifier.CTRL)   # select any existing text
        wait(0.2)
        type(ach_file_path)            # type the full path (SikuliX maps chars to keystrokes)
        type(Key.ENTER)
        wait(0.5)

        # Step 4 — Open button (may have already closed on Enter; skip gracefully)
        log('Step 4: Open button')
        try:
            find_and_click(s, 'open.png', 'Open button')
        except FindFailed:
            log('Open button not found — dialog already closed by Enter (OK)')
        wait(1.0)

        # Step 5 — OK button (File Format Selector)
        log('Step 5: OK button')
        find_and_click(s, 'ok.png', 'OK button')
        wait(2.0)

        # Step 6 — Select the imported payment row with Tab then Enter
        log('Step 6: Selecting payment row (Tab + Enter)')
        type(Key.TAB)
        wait(0.3)
        type(Key.ENTER)
        wait(0.5)

        # Step 7 — Submit button
        log('Step 7: Submit button')
        find_and_click(s, 'submit.png', 'Submit button')
        wait(1.0)

    except FindFailed as e:
        print('IMPORT_FAILED: Element not found — ' + str(e))
        sys.exit(1)
    except Exception as e:
        print('IMPORT_FAILED: Unexpected error — ' + str(e))
        sys.exit(1)

    log('All steps completed successfully')
    print('IMPORT_COMPLETE')
    sys.exit(0)


main()
