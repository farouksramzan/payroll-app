; ══════════════════════════════════════════════════════════════════════════════
; EFTPS Bridge Watcher — AutoHotkey v2
;
; Watches the ach-out folder for .ach files written by the bridge server,
; imports each one into EFTPS Batch Provider automatically, then moves it
; to ach-processed.
;
; HOW TO CALIBRATE:
;   Run the script, right-click the tray icon → "Window Spy".
;   Hover over each button/tab in Batch Provider while "Freeze" is checked.
;   Update the coordinate constants in the CONFIG section below.
; ══════════════════════════════════════════════════════════════════════════════

#Requires AutoHotkey v2.0
#SingleInstance Force
SendMode "Event"          ; most compatible with Java Swing apps
SetWorkingDir A_ScriptDir

; ── CONFIG ────────────────────────────────────────────────────────────────────

WATCH_FOLDER     := "C:\Users\mramz\OneDrive\Desktop\bridge-server\data\ach-out"
PROCESSED_FOLDER := "C:\Users\mramz\OneDrive\Desktop\bridge-server\data\ach-processed"
LOG_FILE         := "C:\Users\mramz\OneDrive\Desktop\bridge-server\logs\ahk-eftps.log"

; Partial window title — enough to uniquely identify Batch Provider
BP_TITLE := "EFTPS Batch Provider"

; How often to check the watch folder (milliseconds)
POLL_INTERVAL_MS := 3000

; ── COORDINATE OFFSETS (relative to Batch Provider window top-left corner) ───
; Use Window Spy to find these. Right-click tray → Window Spy, hover over each
; element in Batch Provider with "Freeze" checked. Read "Client X/Y".

; "Payments" tab in the top navigation bar
TAB_PAYMENTS_X  := 530
TAB_PAYMENTS_Y  := 58

; "Send Payments" sub-tab (shown after clicking the Payments tab)
SUBTAB_SEND_X   := 72
SUBTAB_SEND_Y   := 100

; "Import" button on the Send Payments screen
BTN_IMPORT_X    := 100
BTN_IMPORT_Y    := 220

; ── STARTUP ───────────────────────────────────────────────────────────────────

DirCreate(WATCH_FOLDER)
DirCreate(PROCESSED_FOLDER)
DirCreate("C:\Users\mramz\OneDrive\Desktop\bridge-server\logs")

; Tray icon setup
TraySetIcon("shell32.dll", 147)   ; green-ish icon; change to any shell32 index
A_IconTip := "EFTPS Bridge Watcher — running"

A_TrayMenu.Delete()
A_TrayMenu.Add("EFTPS Bridge Watcher", (*) => "")
A_TrayMenu.Disable("EFTPS Bridge Watcher")
A_TrayMenu.Add()
A_TrayMenu.Add("Open Log",           MenuOpenLog)
A_TrayMenu.Add("Open Watch Folder",  MenuOpenWatch)
A_TrayMenu.Add("Open Processed Folder", MenuOpenProcessed)
A_TrayMenu.Add()
A_TrayMenu.Add("Window Spy (calibrate)", MenuWindowSpy)
A_TrayMenu.Add()
A_TrayMenu.Add("Exit",               MenuExit)
A_TrayMenu.Default := "Open Log"

SetTimer(PollFolder, POLL_INTERVAL_MS)
AppLog("═══ EFTPS Bridge Watcher started ═══")
AppLog("Watching: " WATCH_FOLDER)

Persistent   ; keep script alive with no hotkeys

; ── FOLDER POLLER ─────────────────────────────────────────────────────────────

global inFlight := Map()   ; tracks files currently being processed

PollFolder() {
    global inFlight, WATCH_FOLDER
    Loop Files, WATCH_FOLDER "\*.ach" {
        fp := A_LoopFileFullPath
        if !inFlight.Has(fp) {
            inFlight[fp] := true
            ; -1 = one-shot timer, runs once after the current thread yields
            SetTimer(() => ProcessFile(fp), -1)
        }
    }
}

; ── FILE PROCESSOR ────────────────────────────────────────────────────────────

ProcessFile(filePath) {
    global inFlight, PROCESSED_FOLDER, BP_TITLE
    global TAB_PAYMENTS_X, TAB_PAYMENTS_Y
    global SUBTAB_SEND_X,  SUBTAB_SEND_Y
    global BTN_IMPORT_X,   BTN_IMPORT_Y

    SplitPath(filePath, &fileName)
    AppLog("───────────────────────────────────────")
    AppLog("Detected:  " fileName)
    AppLog("Waiting 2s for write to complete…")
    Sleep(2000)

    ; Confirm file still exists after the wait
    if !FileExist(filePath) {
        AppLog("SKIP: file disappeared — " fileName)
        inFlight.Delete(filePath)
        return
    }

    ; ── STEP 1: Activate Batch Provider ──────────────────────────────────────
    AppLog("Activating EFTPS Batch Provider…")
    if !WinExist(BP_TITLE) {
        AppLog("ERROR: Batch Provider window not found. Is it open?")
        inFlight.Delete(filePath)
        return
    }

    try {
        WinActivate(BP_TITLE)
        if !WinWaitActive(BP_TITLE,, 8) {
            AppLog("ERROR: Batch Provider did not come to foreground")
            inFlight.Delete(filePath)
            return
        }
    } catch as err {
        AppLog("ERROR: WinActivate failed — " err.Message)
        inFlight.Delete(filePath)
        return
    }
    Sleep(700)

    ; ── STEP 2: Click the Payments tab ───────────────────────────────────────
    AppLog("Clicking Payments tab…")
    WinGetPos(&wx, &wy,, , BP_TITLE)
    Click(wx + TAB_PAYMENTS_X, wy + TAB_PAYMENTS_Y)
    Sleep(800)

    ; ── STEP 3: Click the Send Payments sub-tab ───────────────────────────────
    AppLog("Clicking Send Payments sub-tab…")
    Click(wx + SUBTAB_SEND_X, wy + SUBTAB_SEND_Y)
    Sleep(600)

    ; ── STEP 4: Click the Import button ──────────────────────────────────────
    AppLog("Clicking Import…")
    ; Try to find the button by its text first (works if controls are standard Win32)
    importCtrl := FindControlByText(BP_TITLE, "Import")
    if importCtrl != "" {
        ControlClick(importCtrl, BP_TITLE)
    } else {
        ; Fallback: click at calibrated coordinates
        Click(wx + BTN_IMPORT_X, wy + BTN_IMPORT_Y)
    }
    Sleep(1200)

    ; ── STEP 5: Handle the Windows file Open dialog ───────────────────────────
    AppLog("Waiting for file dialog…")
    openDlg := "ahk_class #32770"

    ; Batch Provider may title it "Open", "Import", or similar — match by class
    if !WinWait(openDlg,, 10) {
        AppLog("ERROR: File Open dialog did not appear within 10s")
        inFlight.Delete(filePath)
        return
    }

    WinActivate(openDlg)
    Sleep(400)

    ; Type the full path into the filename field and click Open
    ; Edit1 is the filename field in a standard Windows Open dialog
    try {
        ControlSetText(filePath, "Edit1", openDlg)
        Sleep(300)
        ; "Button1" is the Open/OK button in a standard dialog
        ControlClick("Button1", openDlg)
    } catch {
        ; Fallback: paste into active field and press Enter
        A_Clipboard := filePath
        Send("^a")
        Sleep(100)
        Send("^v")
        Sleep(300)
        Send("{Enter}")
    }
    Sleep(1500)

    ; ── STEP 6: Confirm "Fixed Width Field Format" dialog (if it appears) ─────
    ; Some Batch Provider versions prompt for the file format.
    AppLog("Checking for format confirmation dialog…")
    if WinExist("ahk_class #32770") {
        formatDlg := "ahk_class #32770"
        WinActivate(formatDlg)
        Sleep(400)
        dlgText := ""
        try dlgText := WinGetText(formatDlg)

        if InStr(dlgText, "Fixed", false) or InStr(dlgText, "Width", false) or InStr(dlgText, "Format", false) {
            AppLog("Format dialog found — confirming Fixed Width…")
            ; Select the "Fixed Width" radio if visible, then click OK
            try ControlClick("Button1", formatDlg)  ; first button = OK in most layouts
            Sleep(300)
            if WinExist(formatDlg) {
                ; If dialog still open, just press Enter
                Send("{Enter}")
            }
        } else {
            ; Some other dialog appeared — press Enter to accept default
            Send("{Enter}")
        }
        Sleep(1000)
    }

    ; ── STEP 7: Wait for Batch Provider to process the file ───────────────────
    AppLog("Waiting for import result…")
    Sleep(4000)

    ; Check if a result dialog appeared
    success := false
    if WinExist("ahk_class #32770") {
        resultDlg := "ahk_class #32770"
        WinActivate(resultDlg)
        resultText := ""
        try resultText := WinGetText(resultDlg)
        resultText := Trim(resultText)

        if InStr(resultText, "success", false)
            or InStr(resultText, "complet", false)
            or InStr(resultText, "imported", false)
            or InStr(resultText, "scheduled", false) {
            AppLog("SUCCESS: Import confirmed — " SubStr(resultText, 1, 120))
            success := true
        } else if InStr(resultText, "error", false)
            or InStr(resultText, "fail", false)
            or InStr(resultText, "invalid", false)
            or InStr(resultText, "reject", false) {
            AppLog("ERROR: Batch Provider rejected import — " SubStr(resultText, 1, 300))
        } else {
            ; Unknown dialog text — log it and treat as success (manual review)
            AppLog("INFO: Result dialog: " SubStr(resultText, 1, 200))
            success := true
        }

        Send("{Enter}")   ; dismiss the result dialog
        Sleep(500)
    } else {
        ; No dialog — import may have silently succeeded (status updated in grid)
        AppLog("SUCCESS: No result dialog — import likely accepted")
        success := true
    }

    ; ── STEP 8: Move file to processed folder ────────────────────────────────
    SplitPath(fileName,, , &ext, &nameNoExt)
    destName := success
        ? nameNoExt "_" FormatTime(, "yyyyMMdd_HHmmss") "." ext
        : nameNoExt "_FAILED_" FormatTime(, "yyyyMMdd_HHmmss") "." ext
    destPath := PROCESSED_FOLDER "\" destName

    try {
        FileMove(filePath, destPath)
        AppLog("Moved to: " destPath)
    } catch as err {
        AppLog("WARN: Could not move file — " err.Message)
    }

    AppLog(success ? "Done ✓" : "Done (with errors — check log)")
    A_IconTip := success
        ? "EFTPS: last import OK (" fileName ")"
        : "EFTPS: last import FAILED (" fileName ")"

    inFlight.Delete(filePath)
}

; ── HELPERS ───────────────────────────────────────────────────────────────────

; Scan window controls for one whose text matches btnText.
; Returns the control hwnd string on match, "" if not found.
FindControlByText(winTitle, btnText) {
    try {
        ctrls := WinGetControls(winTitle)
        for ctrl in ctrls {
            try {
                if InStr(ControlGetText(ctrl, winTitle), btnText, false)
                    return ctrl
            }
        }
    }
    return ""
}

AppLog(msg) {
    global LOG_FILE
    line := FormatTime(, "yyyy-MM-dd HH:mm:ss") "  " msg
    FileAppend(line "`n", LOG_FILE)
}

; ── TRAY MENU HANDLERS ────────────────────────────────────────────────────────

MenuOpenLog(*) {
    global LOG_FILE
    if FileExist(LOG_FILE)
        Run('notepad.exe "' LOG_FILE '"')
    else
        MsgBox("No log entries yet.", "EFTPS Bridge Watcher", 64)
}

MenuOpenWatch(*) {
    global WATCH_FOLDER
    Run('explorer.exe "' WATCH_FOLDER '"')
}

MenuOpenProcessed(*) {
    global PROCESSED_FOLDER
    Run('explorer.exe "' PROCESSED_FOLDER '"')
}

MenuWindowSpy(*) {
    ; Launch AHK's built-in Window Spy to help with coordinate calibration
    spyPath := A_AhkPath "\..\WindowSpy.ahk"
    if FileExist(spyPath)
        Run(A_AhkPath ' "' spyPath '"')
    else {
        ; AHK v2 installer puts it here
        spyPath := A_ProgramFiles "\AutoHotkey\UX\WindowSpy.ahk"
        if FileExist(spyPath)
            Run(A_AhkPath ' "' spyPath '"')
        else
            MsgBox("Window Spy not found.`nLook for WindowSpy.ahk in your AutoHotkey install folder.", "EFTPS Bridge Watcher", 48)
    }
}

MenuExit(*) {
    AppLog("Watcher stopped by user")
    ExitApp()
}
