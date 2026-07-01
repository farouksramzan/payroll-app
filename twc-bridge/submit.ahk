; submit.ahk — QuickFile desktop app automation (AHK v2)
; Maximizes QuickFile for consistent coordinates. After QuickFile opens Edge,
; captures the TWC URL + .qfh path, writes to result file, exits.
; Puppeteer (bridge.js) handles the browser login + file upload.
;
; Args: icesaFile, resultFile, quickfileExe

#Requires AutoHotkey v2.0
#SingleInstance Force
SetWorkingDir A_ScriptDir
SetTitleMatchMode 2
SendMode "Input"
CoordMode "Mouse", "Screen"

; ── Arguments ──────────────────────────────────────────────────────────────────
icesaFile    := A_Args[1]
resultFile   := A_Args[2]
quickfileExe := A_Args[3]

if (!icesaFile || !resultFile)
    ExitApp 1

WriteError(msg) {
    global resultFile
    try FileDelete resultFile
    FileAppend "ERROR: " . msg . "`n", resultFile
    ExitApp 1
}

; Catch any unhandled AHK runtime exception and write it to result file
OnError(CatchAll)
CatchAll(err, *) {
    global resultFile
    try FileDelete resultFile
    FileAppend "ERROR: Unhandled exception — " . err.Message . " (at " . err.What . ")`n", resultFile
    return true
}

; ── Launch or activate QuickFile ───────────────────────────────────────────────
if !WinExist("QuickFile 5") {
    Run quickfileExe
    if !WinWait("QuickFile 5",, 30)
        WriteError("QuickFile did not open within 30s")
    Sleep 3000
}
WinActivate "QuickFile 5"
WinWaitActive "QuickFile 5",, 10
WinMaximize "QuickFile 5"
Sleep 2000

; ── Find and Select File ───────────────────────────────────────────────────────
Click 378, 210
Sleep 2000

; ── File open dialog — keyboard only (filename field is focused by default) ────
if !WinWait("Open",, 8)
    if !WinWait("Choose a File",, 8)
        WriteError("File open dialog did not appear")
WinWaitActive "Open",, 5
Sleep 500

; Extract just the filename — paste into dialog, press Enter
SplitPath icesaFile, &fileName
Send "^a"
Sleep 100
A_Clipboard := fileName
Sleep 300
Send "^v"
Sleep 500
Send "{Enter}"
Sleep 3000

; ── Validate ───────────────────────────────────────────────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 388, 300
Sleep 4000

; ── Continue ───────────────────────────────────────────────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 53, 571
Sleep 2000

; ── "Would you like to see a summary?" → No ───────────────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 1052, 581
Sleep 1500

; ── Find the .qfh file BEFORE dismissing next dialog ─────────────────────────
Sleep 500
qfhFile    := ""
newestTime := 0
Loop Files "C:\QuickFile\Upload\*.qfh" {
    if (A_LoopFileTimeModified > newestTime) {
        newestTime := A_LoopFileTimeModified
        qfhFile    := A_LoopFileFullPath
    }
}
if (!qfhFile)
    WriteError("No .qfh file found in C:\QuickFile\Upload\")

; ── "Two files have been created..." → OK ─────────────────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 1106, 607
Sleep 1500

; ── Nightly posting notice → OK ───────────────────────────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 1112, 671
Sleep 1500

; ── "We will now open your internet browser..." → OK ─────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 1085, 622
Sleep 6000

; ── Capture TWC URL from Edge address bar ─────────────────────────────────────
if !WinWait("twc.state.tx.us",, 20)
    WriteError("Edge / TWC page did not open within 20s")
WinActivate "twc.state.tx.us"
Sleep 2000

Send "{F6}"
Sleep 500
Send "^a"
Sleep 200
Send "^c"
Sleep 500
twcUrl := A_Clipboard

WinClose "twc.state.tx.us"
Sleep 800

; ── Write result: line 1 = TWC URL, line 2 = .qfh path ───────────────────────
try FileDelete resultFile
FileAppend twcUrl . "`n", resultFile
FileAppend qfhFile . "`n", resultFile

ExitApp 0
