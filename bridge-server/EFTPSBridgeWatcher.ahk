; ==============================================================================
; EFTPS Bridge Watcher -- AutoHotkey v2
;
; Watches ach-out for .ach files, imports each into EFTPS Batch Provider
; via Java Access Bridge (MSAA/IAccessible), then moves to ach-processed.
;
; ONE-TIME SETUP (Computer 2 only):
;   1. Enable Java Access Bridge so Java UI is exposed to Windows accessibility:
;        jabswitch -enable
;      Run that in PowerShell (no admin needed). Then restart Batch Provider.
;      jabswitch is in C:\Program Files\Java\jre<version>\bin\ or on PATH.
;
;   2. Download Acc.ahk (v2) -- the IAccessible wrapper for AHK v2:
;        https://github.com/Descolada/Acc-v2/blob/main/Lib/Acc.ahk
;      Save Acc.ahk in the SAME FOLDER as this script.
;
;   3. Double-click EFTPSBridgeWatcher.ahk to start. Tray icon appears.
;
; HOW IT WORKS:
;   jabswitch bridges Java Swing's accessibility tree into Windows MSAA.
;   Acc.ahk lets AHK walk that tree and invoke buttons by their text label
;   ("Import") without needing pixel coordinates at all.
;   Coordinate click is kept as a fallback in case JAB is not active.
; ==============================================================================

#Requires AutoHotkey v2.0
#SingleInstance Force
SendMode "Event"        ; most reliable for Java Swing
SetWorkingDir A_ScriptDir

; Acc.ahk must be in the same folder as this script (see setup above)
#Include Acc.ahk

; -- CONFIG -------------------------------------------------------------------

WATCH_FOLDER     := "C:\Users\mramz\OneDrive\Desktop\bridge-server\data\ach-out"
PROCESSED_FOLDER := "C:\Users\mramz\OneDrive\Desktop\bridge-server\data\ach-processed"
LOG_FILE         := "C:\Users\mramz\OneDrive\Desktop\bridge-server\logs\ahk-eftps.log"

BP_TITLE         := "EFTPS Batch Provider"   ; partial window title match

POLL_INTERVAL_MS := 3000
COOLDOWN_MS      := 5000

; Coordinate fallback (used only if JAB/Acc cannot find the Import button).
; Calibrate with Window Spy if the fallback ever triggers.
BTN_IMPORT_X     := 100
BTN_IMPORT_Y     := 220

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

; Snapshot pre-existing files so they are never processed
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
        seenFiles[fp]  := true          ; mark before queuing -- re-polls can't re-add
        lastImportTick := A_TickCount
        SetTimer(() => ProcessFile(fp), -1)   ; one-shot, fires after this returns
        break                           ; one file per poll cycle
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
    ; File is gone from ach-out immediately -- can never be re-detected.
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
    hWnd := WinExist(BP_TITLE)
    AppLog("  Exact title : [" WinGetTitle(BP_TITLE) "]")
    AppLog("  Class       : [" WinGetClass(BP_TITLE) "]")
    AppLog("  PID/hWnd    : " WinGetPID(BP_TITLE) " / " hWnd)
    WinGetPos(&wx, &wy, &ww, &wh, BP_TITLE)
    AppLog("  Geometry    : x=" wx " y=" wy " w=" ww " h=" wh)

    ; === STEP 2: Activate and wait for focus =================================
    AppLog("[STEP 2] Activating window...")
    WinActivate(BP_TITLE)
    Sleep(1000)     ; Java Swing needs ~1s to repaint focus decorations
    if !WinActive(BP_TITLE) {
        AppLog("  Not active yet -- retrying")
        WinActivate(BP_TITLE)
        Sleep(1000)
    }
    AppLog("  Active window: [" WinGetTitle("A") "]")
    WinGetPos(&wx, &wy, &ww, &wh, BP_TITLE)
    AppLog("  Geometry after activate: x=" wx " y=" wy " w=" ww " h=" wh)

    ; === STEP 3: Walk JAB accessibility tree =================================
    ; jabswitch -enable bridges Java Swing -> Windows MSAA (IAccessible).
    ; Acc.ahk lets us walk that tree and find buttons by their text label.
    AppLog("[STEP 3] Walking Java accessibility tree via Acc (JAB)...")
    importEl := 0
    jabWorking := false
    try {
        oRoot := Acc.ObjectFromWindow(hWnd)
        ; Log the top-level accessible name and role so we can confirm JAB is active
        AppLog("  Root accessible name : [" oRoot.Name "]")
        AppLog("  Root accessible role : [" oRoot.RoleText "]")

        ; Walk the full tree and log every element that has a name -- this lets
        ; you see exactly what Batch Provider exposes through accessibility.
        AppLog("  --- Accessible elements with names ---")
        LogAccTree(oRoot, 0)
        AppLog("  --- End of tree ---")

        ; Find the Import push-button by name
        importEl := oRoot.FindFirst(IsImportButton)
        if importEl {
            jabWorking := true
            AppLog("  JAB FOUND: name=[" importEl.Name "] role=[" importEl.RoleText "]")
        } else {
            AppLog("  JAB: no element named 'Import' with role 'push button' found")
            AppLog("  Hint: check the tree dump above for the actual button name")
        }
    } catch as err {
        AppLog("  JAB/Acc error: " err.Message)
        AppLog("  Is Java Access Bridge enabled? Run: jabswitch -enable  then restart Batch Provider")
    }

    ; === STEP 4: Click Import ================================================
    AppLog("[STEP 4] Clicking Import...")
    SetMouseDelay(100)
    clicked := false

    ; Strategy A: JAB DoDefaultAction -- no coordinates needed
    if importEl {
        AppLog("  Strategy A -- JAB DoDefaultAction on Import button")
        try {
            importEl.DoDefaultAction()
            AppLog("  DoDefaultAction() sent")
            clicked := true
        } catch as err {
            AppLog("  DoDefaultAction failed: " err.Message)
            ; Try using the element's location to mouse-click it
            try {
                loc := importEl.Location   ; {x, y, w, h} in screen coordinates
                AppLog("  Element screen location: x=" loc.x " y=" loc.y " w=" loc.w " h=" loc.h)
                cx := loc.x + (loc.w // 2)
                cy := loc.y + (loc.h // 2)
                AppLog("  Strategy A2 -- MouseClick at element centre: x=" cx " y=" cy)
                MouseClick("left", cx, cy, 1, 5)
                clicked := true
            } catch as err2 {
                AppLog("  Element location click also failed: " err2.Message)
            }
        }
        Sleep(800)
    }

    ; Strategy B: coordinate fallback (only if JAB did not click)
    if !clicked or !WinExist("ahk_class #32770") {
        if clicked
            AppLog("  (JAB clicked but no dialog -- trying coordinate fallback too)")
        absX := wx + BTN_IMPORT_X
        absY := wy + BTN_IMPORT_Y
        AppLog("  Strategy B -- MouseClick at config offset: absX=" absX " absY=" absY)
        AppLog("  (if wrong, adjust BTN_IMPORT_X/Y using Window Spy)")
        MouseMove(absX, absY, 5)
        Sleep(300)
        MouseGetPos(&mx, &my)
        AppLog("  Mouse landed at: x=" mx " y=" my)
        MouseClick("left", absX, absY, 1, 5)
        Sleep(1200)
    }

    ; === STEP 5: File Open dialog ============================================
    AppLog("[STEP 5] Waiting for Open dialog (12s)...")
    if !WinWait("ahk_class #32770",, 12) {
        AppLog("ERROR: Open dialog did not appear within 12s")
        AppLog("  Import click missed. Check geometry log above and adjust BTN_IMPORT_X/Y.")
        return
    }
    openTitle := WinGetTitle("ahk_class #32770")
    AppLog("  Open dialog: [" openTitle "]")
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
        AppLog("  Result: [" resTitle "] text=[" SubStr(resText, 1, 300) "]")

        if InStr(resText, "success", false) or InStr(resText, "complet", false)
            or InStr(resText, "imported", false) or InStr(resText, "scheduled", false)
            success := true
        else if InStr(resText, "error", false) or InStr(resText, "fail", false)
            or InStr(resText, "invalid", false) or InStr(resText, "reject", false)
            AppLog("  ERROR: Batch Provider rejected the import")
        else
            success := true   ; unrecognised -- treat as OK, review log

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

; -- JAB HELPERS --------------------------------------------------------------

; Predicate for FindFirst: push button whose name contains "Import"
IsImportButton(el) {
    try return InStr(el.Name, "Import", false) && el.RoleText = "push button"
    return false
}

; Recursively log every accessible element that has a non-empty name.
; Indent level makes the tree structure readable in the log.
LogAccTree(el, depth) {
    if depth > 8   ; cap depth to avoid runaway recursion in large UIs
        return
    try {
        nm   := el.Name
        role := el.RoleText
        if nm != ""
            AppLog("  " StrRepeat("  ", depth) "[" role "] " nm)
    }
    try {
        childCount := el.ChildCount
        Loop childCount {
            try LogAccTree(el.GetChild(A_Index), depth + 1)
        }
    }
}

StrRepeat(s, n) {
    out := ""
    Loop n
        out .= s
    return out
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
