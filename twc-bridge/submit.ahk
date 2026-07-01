; submit.ahk — QuickFile desktop app automation (AHK v2)
; Maximizes QuickFile for consistent coordinates.
; Args: icesaFile, resultFile, quickfileExe

#Requires AutoHotkey v2.0
#SingleInstance Force
SetWorkingDir A_ScriptDir
SetTitleMatchMode 2
SendMode "Input"
CoordMode "Mouse", "Screen"

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

OnError(CatchAll)
CatchAll(err, *) {
    global resultFile
    try FileDelete resultFile
    FileAppend "ERROR: Unhandled exception — " . err.Message . " (at " . err.What . ")`n", resultFile
    ExitApp 1
}

; ── Launch QuickFile ───────────────────────────────────────────────────────────
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

; ── Options > Hide message prompts > OK ───────────────────────────────────────
Click 95, 30
Sleep 800
Click 144, 107
Sleep 800
Click 1066, 580
Sleep 800

; ── Find and Select File ──────────────────────────────────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 378, 210
Sleep 2000

; ── File open dialog ──────────────────────────────────────────────────────────
WinWaitActive "Open",, 8
Sleep 500
SplitPath icesaFile, &fileName
Send "^a"
Sleep 100
A_Clipboard := fileName
Sleep 300
Send "^v"
Sleep 500
Send "{Enter}"
Sleep 3000

; ── Validate ──────────────────────────────────────────────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 388, 300
Sleep 4000

; ── Continue ──────────────────────────────────────────────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 53, 571
Sleep 2000

; ── "Would you like to see a summary?" → No ──────────────────────────────────
WinActivate "QuickFile 5"
Sleep 500
Click 1052, 581
Sleep 2000

; ── Find .qfh file ────────────────────────────────────────────────────────────
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

; ── Kill Edge — bridge.js constructs the upload URL itself ───────────────────
Sleep 3000
if WinExist("ahk_exe msedge.exe")
    WinKill "ahk_exe msedge.exe"
Sleep 1000

; ── Write result: just the .qfh path (URL built by bridge.js) ────────────────
try FileDelete resultFile
FileAppend qfhFile . "`n", resultFile

ExitApp 0
