; submit.ahk — TWC QuickFile ICESA auto-submission
; Called by bridge.js with 3 arguments:
;   %1% = full path to ICESA .txt file
;   %2% = full path to result .txt file (write confirmation number here)
;   %3% = full path to QuickFile.exe

; ── IMPORTANT: This script needs to be calibrated to your QuickFile version. ─
; Run this script manually once while watching what QuickFile does, then adjust
; the menu names, button labels, and wait times below to match your installation.

#NoEnv
#SingleInstance Force
SetWorkingDir %A_ScriptDir%
SetTitleMatchMode, 2       ; partial window title matching
SendMode Input

; ── Read arguments ──────────────────────────────────────────────────────────
icesaFile   := A_Args[1]
resultFile  := A_Args[2]
quickfilExe := A_Args[3]

if (!icesaFile || !resultFile || !quickfilExe) {
    MsgBox, Missing arguments. Usage: submit.ahk <icesa_file> <result_file> <quickfile_exe>
    ExitApp, 1
}

; ── Launch QuickFile (or bring to front if already open) ─────────────────────
IfWinExist, QuickFile
{
    WinActivate, QuickFile
}
Else
{
    Run, %quickfilExe%
    WinWait, QuickFile,, 30
    if ErrorLevel {
        FileAppend, ERROR: QuickFile did not open within 30 seconds`n, %resultFile%
        ExitApp, 1
    }
    WinActivate, QuickFile
    Sleep, 2000    ; wait for QuickFile to fully load
}

; ── TODO: Calibrate the menu/button flow below for your QuickFile version ────
; The steps below are approximate — you need to run this manually once and
; verify that each step matches what QuickFile shows on screen.
;
; Typical QuickFile 5.x ICESA import flow:
;   1. File menu → "Import Wage Data..." (or similar)
;   2. File open dialog appears → type the file path → click Open
;   3. QuickFile validates the file → shows employee count / totals
;   4. Click "Submit" or "Upload" button
;   5. QuickFile shows a confirmation screen with a confirmation number
;   6. Capture the confirmation number and write it to resultFile

; ── Step 1: Open the File menu and click "Import Wage Data" ──────────────────
; TODO: Verify the exact menu item name in your QuickFile installation
WinActivate, QuickFile
Send, !f                   ; Alt+F to open File menu
Sleep, 500
; Try clicking by menu item text — adjust text to match exactly
; Option A: send the menu shortcut key
; Send, i                  ; press 'i' for Import (if that's the shortcut)
; Option B: use menu click
; MenuSelect, QuickFile,, File, Import Wage Data...
; For now, use the menu path (adjust menu item name as needed):
MenuSelect, QuickFile,, File, Import Wage Data...
Sleep, 1000

; ── Step 2: File open dialog ─────────────────────────────────────────────────
; Wait for the Open File dialog
WinWait, Open,, 15
if ErrorLevel {
    FileAppend, ERROR: File open dialog did not appear`n, %resultFile%
    ExitApp, 1
}
WinActivate, Open
; Type the full path to the ICESA file in the filename field
ControlSetText, Edit1, %icesaFile%
Sleep, 300
ControlClick, Button1       ; click Open (first button, usually OK/Open)
Sleep, 2000

; ── Step 3: Wait for validation / review screen ──────────────────────────────
; QuickFile should show a summary/validation screen
; TODO: Adjust the window title or control to wait for
Sleep, 3000

; ── Step 4: Click Submit / Upload ────────────────────────────────────────────
; TODO: Adjust button label to match exactly what QuickFile shows
; Option A: click by button text
ControlClick, Submit        ; or "Upload", "OK", "Send", etc.
; Option B: if it's a dialog with a button:
; ControlClick, &Submit, QuickFile
Sleep, 5000

; ── Step 5: Capture confirmation number ──────────────────────────────────────
; After submission QuickFile shows a confirmation dialog.
; TODO: Read the confirmation number from the screen.
; This depends on whether it's in a text control or just displayed as text.
;
; Option A: read from a specific text control
; ControlGetText, confirmation, Static2, Confirmation
;
; Option B: use clipboard — select all text in the confirmation window, copy it
; Send, ^a
; Sleep, 200
; Send, ^c
; Sleep, 200
; confirmation := Clipboard
;
; For now, write a placeholder confirmation to the result file.
; Replace this with actual confirmation capture once you verify the UI flow.
confirmation := "SUBMITTED-" . A_Now

FileDelete, %resultFile%
FileAppend, %confirmation%, %resultFile%

; ── Done ─────────────────────────────────────────────────────────────────────
ExitApp, 0
