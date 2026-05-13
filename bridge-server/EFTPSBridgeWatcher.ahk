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

; Minimum milliseconds between imports (prevents rapid re-processing)
COOLDOWN_MS := 5000

; ── COORDINATE OFFSETS (relative to Batch Provider window top-left corner) ───
; Use Window Spy to find these. Right-click tray → Window Spy, hover over each
; element in Batch Provider with "Freeze" checked. Read "Client X/Y".

TAB_PAYMENTS_X  := 530   ; "Payments" tab in the top navigation bar
TAB_PAYMENTS_Y  := 58

SUBTAB_SEND_X   := 72    ; "Send Payments" sub-tab
SUBTAB_SEND_Y   := 100

BTN_IMPORT_X    := 100   ; "Import" button on the Send Payments screen
BTN_IMPORT_Y    := 220

; ── STARTUP ───────────────────────────────────────────────────────────────────

DirCreate(WATCH_FOLDER)
DirCreate(PROCESSED_FOLDER)
DirCreate("C:\Users\mramz\OneDrive\Desktop\bridge-server\logs")

; Tray icon setup
TraySetIcon("shell32.dll", 147)
A_IconTip := "EFTPS Bridge Watcher — running"

A_TrayMenu.Delete()
A_TrayMenu.Add("EFTPS Bridge Watcher", (*) => "")
A_TrayMenu.Disable("EFTPS Bridge Watcher")
A_TrayMenu.Add()
A_TrayMenu.Add("Open Log",              MenuOpenLog)
A_TrayMenu.Add("Open Watch Folder",     MenuOpenWatch)
A_TrayMenu.Add("Open Processed Folder", MenuOpenProcessed)
A_TrayMenu.Add()
A_TrayMenu.Add("Window Spy (calibrate)", MenuWindowSpy)
A_TrayMenu.Add()
A_TrayMenu.Add("Exit", MenuExit)
A_TrayMenu.Default := "Open Log"

; ── STATE ─────────────────────────────────────────────────────────────────────

; Files that existed when the script started — never process these.
; Also used to permanently remember every file we've ever touched so a
; restart can't cause a re-run.
global seenFiles     := Map()
global lastImportTick := 0   ; A_TickCount of the last import attempt

; Snapshot every .ach file already in the folder right now so we skip them.
AppLog("═══ EFTPS Bridge Watcher started ═══")
AppLog("Watching: " WATCH_FOLDER)
existingCount := 0
Loop Files, WATCH_FOLDER "\*.ach" {
    seenFiles[A_LoopFileFullPath] := true
    existingCount++
}
if existingCount > 0
    AppLog("Skipping " existingCount " pre-existing file(s) already in watch folder")

SetTimer(PollFolder, POLL_INTERVAL_MS)
Persistent

; ── FOLDER POLLER ─────────────────────────────────────────────────────────────

PollFolder() {
    global seenFiles, lastImportTick, WATCH_FOLDER, COOLDOWN_MS

    ; Don't start a new import until the cooldown has elapsed
    if A_TickCount - lastImportTick < COOLDOWN_MS
        return

    Loop Files, WATCH_FOLDER "\*.ach" {
        fp := A_LoopFileFullPath
        if seenFiles.Has(fp)   ; already processed or pre-existing — skip
            continue

        ; Mark seen immediately — this is the ONLY place we add to seenFiles.
        ; Doing it here (before ProcessFile runs) means a second poll firing
        ; during the Sleep(2000) in ProcessFile cannot queue the same file again.
        seenFiles[fp] := true
        lastImportTick := A_TickCount

        ; -1 = one-shot timer, fires after this call returns
        SetTimer(() => ProcessFile(fp), -1)

        ; Process one file per poll cycle — next file waits for the next poll
        break
    }
}

; ── FILE PROCESSOR ────────────────────────────────────────────────────────────

ProcessFile(filePath) {
    global PROCESSED_FOLDER, BP_TITLE
    global TAB_PAYMENTS_X, TAB_PAYMENTS_Y
    global SUBTAB_SEND_X,  SUBTAB_SEND_Y
    global BTN_IMPORT_X,   BTN_IMPORT_Y

    SplitPath(filePath, &fileName,, &ext, &nameNoExt)
    AppLog("───────────────────────────────────────")
    AppLog("New file: " fileName)
    AppLog("Waiting 2s for write to complete…")
    Sleep(2000)

    if !FileExist(filePath) {
        AppLog("SKIP: file disappeared before processing — " fileName)
        return
    }

    ; ── Move the file to ach-processed IMMEDIATELY ────────────────────────────
    ; Moving it now means it can NEVER be detected again, even if the script
    ; crashes mid-import and restarts.  We import from the processed location.
    destPath := PROCESSED_FOLDER "\" nameNoExt "_" FormatTime(, "yyyyMMdd_HHmmss") "." ext
    try {
        FileMove(filePath, destPath)
        AppLog("Moved to processed (pre-import): " destPath)
    } catch as err {
        AppLog("ERROR: Could not move file before import — " err.Message)
        return
    }

    ; From here on, importPath is the file we hand to Batch Provider
    importPath := destPath

    ; ── STEP 1: Find and activate Batch Provider ──────────────────────────────
    AppLog("Looking for Batch Provider window…")
    if !WinExist(BP_TITLE) {
        AppLog("ERROR: No window matching [" BP_TITLE "] — is Batch Provider open?")
        return
    }

    ; Log the EXACT title so the user can adjust BP_TITLE if needed
    exactTitle := WinGetTitle(BP_TITLE)
    AppLog("Found window: [" exactTitle "]")

    try {
        WinActivate(BP_TITLE)
        if !WinWaitActive(BP_TITLE,, 8) {
            AppLog("ERROR: Window did not come to foreground within 8s")
            return
        }
    } catch as err {
        AppLog("ERROR: WinActivate failed — " err.Message)
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

    ; ── STEP 4: Click Import ──────────────────────────────────────────────────
    AppLog("Clicking Import…")
    importCtrl := FindControlByText(BP_TITLE, "Import")
    if importCtrl != "" {
        ControlClick(importCtrl, BP_TITLE)
    } else {
        Click(wx + BTN_IMPORT_X, wy + BTN_IMPORT_Y)
    }
    Sleep(1200)

    ; ── STEP 5: Handle the file Open dialog ───────────────────────────────────
    AppLog("Waiting for Open dialog…")
    openDlg := "ahk_class #32770"
    if !WinWait(openDlg,, 10) {
        AppLog("ERROR: Open dialog did not appear within 10s")
        return
    }

    ; Log the dialog title too — useful for debugging Batch Provider versions
    openTitle := WinGetTitle(openDlg)
    AppLog("Open dialog title: [" openTitle "]")

    WinActivate(openDlg)
    Sleep(400)

    try {
        ControlSetText(importPath, "Edit1", openDlg)
        Sleep(300)
        ControlClick("Button1", openDlg)   ; "Open" button
    } catch {
        ; Fallback: paste the path
        A_Clipboard := importPath
        Send("^a")
        Sleep(100)
        Send("^v")
        Sleep(300)
        Send("{Enter}")
    }
    Sleep(1500)

    ; ── STEP 6: Confirm "Fixed Width Field Format" dialog ─────────────────────
    AppLog("Checking for format dialog…")
    if WinExist("ahk_class #32770") {
        fmtDlg := "ahk_class #32770"
        fmtTitle := WinGetTitle(fmtDlg)
        AppLog("Format dialog title: [" fmtTitle "]")
        dlgText := ""
        try dlgText := WinGetText(fmtDlg)
        AppLog("Format dialog text: " SubStr(Trim(dlgText), 1, 120))

        WinActivate(fmtDlg)
        Sleep(400)

        try ControlClick("Button1", fmtDlg)   ; click OK / first button
        Sleep(300)
        if WinExist(fmtDlg)
            Send("{Enter}")   ; still open — press Enter as fallback
        Sleep(1000)
    }

    ; ── STEP 7: Wait for result ───────────────────────────────────────────────
    AppLog("Waiting for result (4s)…")
    Sleep(4000)

    success := false
    if WinExist("ahk_class #32770") {
        resDlg    := "ahk_class #32770"
        resTitle  := WinGetTitle(resDlg)
        resText   := ""
        try resText := WinGetText(resDlg)
        resText := Trim(resText)
        AppLog("Result dialog [" resTitle "]: " SubStr(resText, 1, 200))

        if InStr(resText, "success", false)
            or InStr(resText, "complet", false)
            or InStr(resText, "imported", false)
            or InStr(resText, "scheduled", false) {
            success := true
        } else if InStr(resText, "error", false)
            or InStr(resText, "fail", false)
            or InStr(resText, "invalid", false)
            or InStr(resText, "reject", false) {
            AppLog("ERROR: Batch Provider rejected — " SubStr(resText, 1, 300))
        } else {
            success := true   ; unknown dialog — assume OK, manual review via log
        }

        Send("{Enter}")
        Sleep(500)
    } else {
        AppLog("No result dialog — assuming silent success")
        success := true
    }

    ; ── Rename processed file to mark outcome ─────────────────────────────────
    ; Already moved to ach-processed with a timestamp; optionally append _FAILED
    if !success {
        failedPath := PROCESSED_FOLDER "\" nameNoExt "_FAILED_" FormatTime(, "yyyyMMdd_HHmmss") "." ext
        try FileMove(destPath, failedPath)
        AppLog("Renamed to: " failedPath)
    }

    outcome := success ? "SUCCESS ✓" : "FAILED ✗"
    AppLog(outcome " — " fileName)
    A_IconTip := "EFTPS: " outcome " (" fileName ")"
}

; ── HELPERS ───────────────────────────────────────────────────────────────────

FindControlByText(winTitle, btnText) {
    try {
        for ctrl in WinGetControls(winTitle) {
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
    FileAppend(FormatTime(, "yyyy-MM-dd HH:mm:ss") "  " msg "`n", LOG_FILE)
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
    spyPath := A_ProgramFiles "\AutoHotkey\UX\WindowSpy.ahk"
    if FileExist(spyPath)
        Run(A_AhkPath ' "' spyPath '"')
    else
        MsgBox("Window Spy not found.`nLook for WindowSpy.ahk in your AutoHotkey install folder.", "EFTPS Bridge Watcher", 48)
}

MenuExit(*) {
    AppLog("Watcher stopped by user")
    ExitApp()
}
