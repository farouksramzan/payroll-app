; ==============================================================================
; EFTPS Bridge Watcher -- AutoHotkey v2
;
; Watches ach-out for .ach files, imports each into EFTPS Batch Provider
; using absolute screen coordinates, then moves the file to ach-processed.
;
; HOW TO UPDATE COORDINATES:
;   Right-click tray icon -> Window Spy. Maximize Batch Provider first,
;   then hover over the Import button with "Freeze" checked.
;   Read "Screen X/Y" and update BTN_IMPORT_SCREEN_X/Y below.
; ==============================================================================

#Requires AutoHotkey v2.0
#SingleInstance Force
SendMode "Event"
SetWorkingDir A_ScriptDir

; -- CONFIG -------------------------------------------------------------------

WATCH_FOLDER     := "C:\Users\mramz\OneDrive\Desktop\bridge-server\data\ach-out"
PROCESSED_FOLDER := "C:\Users\mramz\OneDrive\Desktop\bridge-server\data\ach-processed"
LOG_FILE         := "C:\Users\mramz\OneDrive\Desktop\bridge-server\logs\ahk-eftps.log"

BP_TITLE         := "EFTPS Batch Provider"   ; partial window title match

POLL_INTERVAL_MS := 3000
COOLDOWN_MS      := 5000

; Absolute screen coordinates of the Import button measured with Window Spy
; after maximizing Batch Provider. Do NOT add window offsets -- these are
; screen coordinates, not window-relative.
BTN_IMPORT_SCREEN_X := 421
BTN_IMPORT_SCREEN_Y := 970

; -- TRAY SETUP ---------------------------------------------------------------

DirCreate(WATCH_FOLDER)
DirCreate(PROCESSED_FOLDER)
DirCreate("C:\Users\mramz\OneDrive\Desktop\bridge-server\logs")

TraySetIcon("shell32.dll", 147)
A_IconTip := "EFTPS Bridge Watcher -- running"

A_TrayMenu.Delete()
A_TrayMenu.Add("EFTPS Bridge Watcher", (*) => "")
A_TrayMenu.Disable("EFTPS Bridge Watcher")
A_TrayMenu.Add()
A_TrayMenu.Add("Open Log",               MenuOpenLog)
A_TrayMenu.Add("Open Watch Folder",      MenuOpenWatch)
A_TrayMenu.Add("Open Processed Folder",  MenuOpenProcessed)
A_TrayMenu.Add()
A_TrayMenu.Add("Window Spy (calibrate)", MenuWindowSpy)
A_TrayMenu.Add()
A_TrayMenu.Add("Exit", MenuExit)
A_TrayMenu.Default := "Open Log"

; -- STATE --------------------------------------------------------------------

global seenFiles      := Map()
global lastImportTick := 0

AppLog("=== EFTPS Bridge Watcher started ===")
AppLog("Watching: " WATCH_FOLDER)

existingCount := 0
Loop Files, WATCH_FOLDER "\*.ach" {
    seenFiles[A_LoopFileFullPath] := true
    existingCount++
}
if existingCount > 0
    AppLog("Skipping " existingCount " pre-existing file(s)")

SetTimer(PollFolder, POLL_INTERVAL_MS)
Persistent

; -- FOLDER POLLER ------------------------------------------------------------

PollFolder() {
    global seenFiles, lastImportTick, WATCH_FOLDER, COOLDOWN_MS
    if A_TickCount - lastImportTick < COOLDOWN_MS
        return
    Loop Files, WATCH_FOLDER "\*.ach" {
        fp := A_LoopFileFullPath
        if seenFiles.Has(fp)
            continue
        seenFiles[fp]  := true
        lastImportTick := A_TickCount
        SetTimer(() => ProcessFile(fp), -1)
        break
    }
}

; -- FILE PROCESSOR -----------------------------------------------------------

ProcessFile(filePath) {
    global PROCESSED_FOLDER, BP_TITLE, BTN_IMPORT_SCREEN_X, BTN_IMPORT_SCREEN_Y

    SplitPath(filePath, &fileName,, &ext, &nameNoExt)
    AppLog("--------------------------------------")
    AppLog("New file: " fileName)
    AppLog("Waiting 2s for write to finish...")
    Sleep(2000)

    if !FileExist(filePath) {
        AppLog("SKIP: file disappeared -- " fileName)
        return
    }

    ; Move to ach-processed immediately so the file can never be re-detected
    destPath := PROCESSED_FOLDER "\" nameNoExt "_" FormatTime(, "yyyyMMdd_HHmmss") "." ext
    try {
        FileMove(filePath, destPath)
        AppLog("Pre-import move OK -> " destPath)
    } catch as err {
        AppLog("ERROR: Could not move file -- " err.Message)
        return
    }
    importPath := destPath

    ; === STEP 1: Locate window ===============================================
    AppLog("[STEP 1] Locating Batch Provider window...")
    if !WinExist(BP_TITLE) {
        AppLog("ERROR: No window matching [" BP_TITLE "]. Is Batch Provider running?")
        return
    }
    AppLog("  Exact title : [" WinGetTitle(BP_TITLE) "]")
    AppLog("  Class       : [" WinGetClass(BP_TITLE) "]")
    WinGetPos(&wx, &wy, &ww, &wh, BP_TITLE)
    AppLog("  Geometry    : x=" wx " y=" wy " w=" ww " h=" wh)

    ; === STEP 2: Activate, maximize, wait ====================================
    AppLog("[STEP 2] Activating and maximizing...")
    WinActivate(BP_TITLE)
    Sleep(500)
    if !WinActive(BP_TITLE) {
        AppLog("  Not active -- retrying")
        WinActivate(BP_TITLE)
        Sleep(500)
    }
    WinMaximize(BP_TITLE)
    Sleep(1000)     ; wait for maximize animation and Java Swing repaint
    AppLog("  Active window : [" WinGetTitle("A") "]")
    WinGetPos(&wx, &wy, &ww, &wh, BP_TITLE)
    AppLog("  Geometry after maximize: x=" wx " y=" wy " w=" ww " h=" wh)

    ; === STEP 3: Click Import at absolute screen coordinates =================
    AppLog("[STEP 3] Clicking Import button...")
    AppLog("  Target: x=" BTN_IMPORT_SCREEN_X " y=" BTN_IMPORT_SCREEN_Y)
    SetMouseDelay(100)
    MouseMove(BTN_IMPORT_SCREEN_X, BTN_IMPORT_SCREEN_Y, 5)
    Sleep(300)
    MouseGetPos(&mx, &my)
    AppLog("  Mouse landed at: x=" mx " y=" my)
    MouseClick("left", BTN_IMPORT_SCREEN_X, BTN_IMPORT_SCREEN_Y, 1, 5)
    AppLog("  Click sent")
    Sleep(1200)

    ; === STEP 4: File Open dialog ============================================
    AppLog("[STEP 4] Waiting for Open dialog (12s)...")
    if !WinWait("ahk_class #32770",, 12) {
        AppLog("ERROR: Open dialog did not appear within 12s")
        AppLog("  Click may have missed. Re-measure with Window Spy (maximize first)")
        AppLog("  and update BTN_IMPORT_SCREEN_X/Y in the CONFIG section.")
        return
    }
    AppLog("  Open dialog: [" WinGetTitle("ahk_class #32770") "]")
    WinActivate("ahk_class #32770")
    Sleep(500)

    try {
        ControlSetText(importPath, "Edit1", "ahk_class #32770")
        Sleep(300)
        AppLog("  Set filename: " importPath)
        ControlClick("Button1", "ahk_class #32770",, "left", 1, "NA")
        AppLog("  Clicked Open")
    } catch {
        AppLog("  ControlSetText failed -- clipboard fallback")
        A_Clipboard := importPath
        Sleep(200)
        Send("^a")
        Sleep(100)
        Send("^v")
        Sleep(400)
        Send("{Enter}")
    }
    Sleep(1500)

    ; === STEP 5: Fixed Width Field Format dialog ==============================
    AppLog("[STEP 5] Checking for format dialog...")
    if WinExist("ahk_class #32770") {
        fmtTitle := WinGetTitle("ahk_class #32770")
        fmtText  := ""
        try fmtText := WinGetText("ahk_class #32770")
        AppLog("  Format dialog: [" fmtTitle "] text=[" SubStr(Trim(fmtText), 1, 200) "]")
        WinActivate("ahk_class #32770")
        Sleep(400)
        try ControlClick("Button1", "ahk_class #32770",, "left", 1, "NA")
        Sleep(300)
        if WinExist("ahk_class #32770")
            Send("{Enter}")
        Sleep(1000)
        AppLog("  Format dialog dismissed")
    } else {
        AppLog("  No format dialog")
    }

    ; === STEP 6: Wait for result =============================================
    AppLog("[STEP 6] Waiting for result (5s)...")
    Sleep(5000)

    success := false
    if WinExist("ahk_class #32770") {
        resTitle := WinGetTitle("ahk_class #32770")
        resText  := ""
        try resText := WinGetText("ahk_class #32770")
        resText := Trim(resText)
        AppLog("  Result: [" resTitle "] text=[" SubStr(resText, 1, 300) "]")

        if InStr(resText, "success", false) or InStr(resText, "complet", false)
            or InStr(resText, "imported", false) or InStr(resText, "scheduled", false)
            success := true
        else if InStr(resText, "error", false) or InStr(resText, "fail", false)
            or InStr(resText, "invalid", false) or InStr(resText, "reject", false)
            AppLog("  ERROR: Batch Provider rejected the import")
        else
            success := true   ; unrecognised text -- treat as OK, review log

        Send("{Enter}")
        Sleep(500)
    } else {
        AppLog("  No result dialog -- assuming silent success")
        success := true
    }

    if !success {
        failedPath := PROCESSED_FOLDER "\" nameNoExt "_FAILED_" FormatTime(, "yyyyMMdd_HHmmss") "." ext
        try FileMove(destPath, failedPath)
        AppLog("  Renamed to FAILED: " failedPath)
    }

    outcome := success ? "SUCCESS" : "FAILED"
    AppLog(outcome " -- " fileName)
    A_IconTip := "EFTPS: " outcome " (" fileName ")"
}

; -- HELPERS ------------------------------------------------------------------

AppLog(msg) {
    global LOG_FILE
    FileAppend(FormatTime(, "yyyy-MM-dd HH:mm:ss") "  " msg "`n", LOG_FILE)
}

; -- TRAY MENU HANDLERS -------------------------------------------------------

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
