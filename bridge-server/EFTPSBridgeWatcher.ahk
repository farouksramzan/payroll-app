; ==============================================================================
; EFTPS Bridge Watcher -- AutoHotkey v2
;
; Watches ach-out for .ach files, imports each into EFTPS Batch Provider,
; moves to ach-processed. Runs as a system-tray app.
;
; HOW TO CALIBRATE:
;   Right-click tray icon -> Window Spy. Hover over the Import button in
;   Batch Provider with "Freeze" checked. Read "Client X/Y". Update
;   BTN_IMPORT_X / BTN_IMPORT_Y below.
; ==============================================================================

#Requires AutoHotkey v2.0
#SingleInstance Force
SendMode "Event"        ; most reliable for Java Swing apps
SetWorkingDir A_ScriptDir

; -- CONFIG --------------------------------------------------------------------

WATCH_FOLDER     := "C:\Users\mramz\OneDrive\Desktop\bridge-server\data\ach-out"
PROCESSED_FOLDER := "C:\Users\mramz\OneDrive\Desktop\bridge-server\data\ach-processed"
LOG_FILE         := "C:\Users\mramz\OneDrive\Desktop\bridge-server\logs\ahk-eftps.log"

; Partial match -- adjust if your window has a different title
BP_TITLE := "EFTPS Batch Provider"

POLL_INTERVAL_MS := 3000   ; folder poll frequency
COOLDOWN_MS      := 5000   ; minimum gap between imports

; Fallback coordinate offsets from window top-left (used only when control
; enumeration cannot find Import by text). Calibrate with Window Spy.
BTN_IMPORT_X := 100
BTN_IMPORT_Y := 220

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

; Snapshot files already in the folder so we never process pre-existing files
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

        ; Mark seen NOW -- before ProcessFile runs, so re-polls can't queue it again
        seenFiles[fp] := true
        lastImportTick := A_TickCount
        SetTimer(() => ProcessFile(fp), -1)   ; -1 = one-shot, fires after this returns
        break   ; one file per poll cycle
    }
}

; -- FILE PROCESSOR -----------------------------------------------------------

ProcessFile(filePath) {
    global PROCESSED_FOLDER, BP_TITLE, BTN_IMPORT_X, BTN_IMPORT_Y

    SplitPath(filePath, &fileName,, &ext, &nameNoExt)
    AppLog("--------------------------------------")
    AppLog("New file: " fileName)
    AppLog("Waiting 2s for write to finish...")
    Sleep(2000)

    if !FileExist(filePath) {
        AppLog("SKIP: file disappeared -- " fileName)
        return
    }

    ; Move to ach-processed BEFORE touching Batch Provider.
    ; This ensures the file can never be re-detected even if the script restarts.
    destPath  := PROCESSED_FOLDER "\" nameNoExt "_" FormatTime(, "yyyyMMdd_HHmmss") "." ext
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
    exactTitle := WinGetTitle(BP_TITLE)
    winClass   := WinGetClass(BP_TITLE)
    winPID     := WinGetPID(BP_TITLE)
    AppLog("  Exact title : [" exactTitle "]")
    AppLog("  Window class: [" winClass "]")
    AppLog("  PID         : " winPID)
    WinGetPos(&wx, &wy, &ww, &wh, BP_TITLE)
    AppLog("  Geometry    : x=" wx " y=" wy " w=" ww " h=" wh)
    MouseGetPos(&mx, &my)
    AppLog("  Mouse before activate: x=" mx " y=" my)

    ; === STEP 2: Activate and wait for focus =================================
    AppLog("[STEP 2] Activating window...")
    WinActivate(BP_TITLE)
    Sleep(1000)   ; Java Swing needs ~1s to repaint focus decorations

    activeNow := WinGetTitle("A")
    AppLog("  Active window after activate: [" activeNow "]")
    if !WinActive(BP_TITLE) {
        AppLog("  WARNING: still not active -- retrying once")
        WinActivate(BP_TITLE)
        Sleep(1000)
        AppLog("  Active window (retry): [" WinGetTitle("A") "]")
    }

    ; Re-read geometry after activate (window may have un-minimised / moved)
    WinGetPos(&wx, &wy, &ww, &wh, BP_TITLE)
    AppLog("  Geometry after activate: x=" wx " y=" wy " w=" ww " h=" wh)
    MouseGetPos(&mx, &my)
    AppLog("  Mouse after activate: x=" mx " y=" my)

    ; === STEP 3: Enumerate controls ==========================================
    ; Java Swing controls are SunAwtXxx classes; standard control names usually
    ; won't work, but we log every control that has text so you can identify
    ; the Import button's class name and position for calibration.
    AppLog("[STEP 3] Enumerating controls...")
    importCtrl := ""
    importCtrlX := 0
    importCtrlY := 0
    importCtrlW := 0
    importCtrlH := 0
    try {
        ctrls := WinGetControls(BP_TITLE)
        AppLog("  Total controls: " ctrls.Length)
        for ctrl in ctrls {
            ctrlText  := ""
            ctrlClass := ""
            cx := 0 , cy := 0 , cw := 0 , ch := 0
            try ctrlText  := ControlGetText(ctrl, BP_TITLE)
            try ctrlClass := ControlGetClassNN(ctrl, BP_TITLE)
            try ControlGetPos(&cx, &cy, &cw, &ch, ctrl, BP_TITLE)
            if ctrlText != ""
                AppLog("  ctrl=[" ctrl "] class=[" ctrlClass "] text=[" ctrlText "] pos=(" cx "," cy ") size=" cw "x" ch)
            if importCtrl = "" and InStr(ctrlText, "Import", false) {
                importCtrl  := ctrl
                importCtrlX := cx
                importCtrlY := cy
                importCtrlW := cw
                importCtrlH := ch
                AppLog("  ** Import control found: [" ctrl "] at (" cx "," cy ")")
            }
        }
    } catch as err {
        AppLog("  WARN: control enumeration error -- " err.Message)
    }

    ; === STEP 4: Click Import ================================================
    AppLog("[STEP 4] Clicking Import button...")
    SetMouseDelay(100)   ; slower mouse = more reliable in Java Swing

    clickedViaControl := false
    if importCtrl != "" {
        ; Strategy A: ControlClick by handle (works for native Win32 buttons)
        AppLog("  Strategy A -- ControlClick handle [" importCtrl "]")
        try {
            ControlClick(importCtrl, BP_TITLE,, "left", 1, "NA")
            clickedViaControl := true
            AppLog("  ControlClick sent")
        } catch as err {
            AppLog("  ControlClick failed: " err.Message)
        }
        Sleep(800)
    }

    ; Check whether the file dialog already opened after Strategy A
    if WinExist("ahk_class #32770") {
        AppLog("  File dialog appeared after Strategy A -- skipping Strategy B")
    } else {
        ; Strategy B: absolute MouseClick at button centre
        if importCtrl != "" {
            ; Use the control's position relative to the window
            absX := wx + importCtrlX + (importCtrlW // 2)
            absY := wy + importCtrlY + (importCtrlH // 2)
            AppLog("  Strategy B -- MouseClick at control centre: absX=" absX " absY=" absY)
        } else {
            ; Last resort: configured offsets (calibrate BTN_IMPORT_X/Y with Window Spy)
            absX := wx + BTN_IMPORT_X
            absY := wy + BTN_IMPORT_Y
            AppLog("  Strategy B -- MouseClick at config offset: absX=" absX " absY=" absY)
            AppLog("  (if wrong, open log, find 'Geometry after activate', adjust BTN_IMPORT_X/Y)")
        }
        MouseMove(absX, absY, 5)
        Sleep(400)
        MouseGetPos(&mx, &my)
        AppLog("  Mouse after move: x=" mx " y=" my)
        MouseClick("left", absX, absY, 1, 5)
        AppLog("  MouseClick sent")
        Sleep(1200)
    }

    ; === STEP 5: File Open dialog ============================================
    AppLog("[STEP 5] Waiting for Open dialog (12s)...")
    if !WinWait("ahk_class #32770",, 12) {
        AppLog("ERROR: File Open dialog did not appear within 12s")
        AppLog("  The Import click probably missed. Check the geometry log above,")
        AppLog("  then adjust BTN_IMPORT_X/Y or use Window Spy to recalibrate.")
        return
    }
    openTitle := WinGetTitle("ahk_class #32770")
    AppLog("  Open dialog title: [" openTitle "]")
    WinActivate("ahk_class #32770")
    Sleep(500)

    ; Set file path and click Open
    try {
        ControlSetText(importPath, "Edit1", "ahk_class #32770")
        Sleep(300)
        AppLog("  Set filename field: " importPath)
        ControlClick("Button1", "ahk_class #32770",, "left", 1, "NA")
        AppLog("  Clicked Open")
    } catch {
        AppLog("  ControlSetText failed -- using clipboard fallback")
        A_Clipboard := importPath
        Sleep(200)
        Send("^a")
        Sleep(100)
        Send("^v")
        Sleep(400)
        Send("{Enter}")
    }
    Sleep(1500)

    ; === STEP 6: Fixed Width Field Format dialog ==============================
    AppLog("[STEP 6] Checking for format dialog...")
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

    ; === STEP 7: Wait for result =============================================
    AppLog("[STEP 7] Waiting for result (5s)...")
    Sleep(5000)

    success := false
    if WinExist("ahk_class #32770") {
        resTitle := WinGetTitle("ahk_class #32770")
        resText  := ""
        try resText := WinGetText("ahk_class #32770")
        resText := Trim(resText)
        AppLog("  Result dialog: [" resTitle "] text=[" SubStr(resText, 1, 300) "]")

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

    ; Rename to mark outcome
    if !success {
        failedPath := PROCESSED_FOLDER "\" nameNoExt "_FAILED_" FormatTime(, "yyyyMMdd_HHmmss") "." ext
        try FileMove(destPath, failedPath)
        AppLog("  Renamed to: " failedPath)
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
