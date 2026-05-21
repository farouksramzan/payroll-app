# Button Images — Capture Instructions

`bp_automation.py` and `bp_enrollment.py` use `pyautogui.locateOnScreen()` to find UI
elements by comparing these reference images against the live screen. Each image must be a
**tight, pixel-perfect crop** of the button or row exactly as it appears in
EFTPS Batch Provider on this machine.

---

## Payment automation images (`bp_automation.py`)

| Filename | What to capture | When visible |
|---|---|---|
| `btn_import.png` | The **Import** button in the main Batch Provider toolbar | Always visible on the main screen |
| `btn_add.png` | The **Add** button inside the File Format Selector dialog | After clicking Import |
| `ach_file_row.png` | One row of an ACH filename inside the file browser list | After clicking Add — shows .ach filenames |
| `btn_open.png` | The **Open** button in the file browser | After selecting a file |
| `btn_ok.png` | The **OK** button in the File Format Selector dialog | After clicking Open |
| `payment_row.png` | One row of a payment entry in the payments list | After clicking OK — the imported payment appears |
| `btn_submit.png` | The **Submit** button at the bottom right of the window | After clicking the payment row |

---

## Enrollment automation images (`bp_enrollment.py`)

| Filename | What to capture | When visible |
|---|---|---|
| `enrollments_tab.png` | The **Enrollments** tab at the top of Batch Provider | Always visible |
| `send_enrollments.png` | The **Send Enrollments** button on the Enrollments screen | After clicking the Enrollments tab |
| `enroll_import.png` | The **Import** button in the Send Enrollments dialog | After clicking Send Enrollments |
| `enroll_add.png` | The **Add** button in the file dialog | After clicking Import |
| `enroll_ok.png` | The **first OK** button — after selecting the enrollment file | After typing the file path and pressing Enter |
| `enroll_ok2.png` | The **second OK** button — confirmation/summary dialog | After clicking the first OK |

---

## How to capture each image

1. Open EFTPS Batch Provider and navigate to the screen where the button appears.
2. Use the **Snipping Tool** (Win + Shift + S) and select **Rectangular Snip**.
3. Crop *tightly* around just the button — include its border but no surrounding whitespace.
4. Save the snip as a PNG into this folder using the exact filename from the table above.

## Tips for reliable matching

- Capture at **100% display scaling** (Settings → Display → Scale = 100%).
  If the screen is scaled (e.g. 125%), pyautogui coordinates will be offset.
- Do **not** resize or compress the image after capture — save directly as PNG.
- If a button has multiple visual states (normal / hover / pressed), capture the
  **normal / idle** state.
- The script uses `confidence=0.8`, so minor rendering differences are tolerated,
  but blurry or scaled images will fail to match.

## Verifying a capture

Run this one-liner in a terminal while Batch Provider is open and the target
button is visible:

```
python -c "import pyautogui; print(pyautogui.locateOnScreen('button_images/btn_import.png', confidence=0.8))"
```

A result like `Box(left=350, top=960, width=48, height=22)` means the image was
found. `None` means the capture needs to be retaken.
