; submit.ahk — QuickFile desktop app automation ONLY
; After QuickFile opens Edge, this script captures the URL + .qfh path,
; writes them to the result file, and exits. Puppeteer handles the rest.
;
; Args: icesaFile, resultFile, quickfileExe

#NoEnv
#SingleInstance Force
SetWorkingDir %A_ScriptDir%
SetTitleMatchMode, 2
SendMode Input
CoordMode, Mouse, Screen
SetControlDelay, 150

; ── Arguments ─────────────────────────────────────────────────────────────────
icesaFile    := A_Args[1]
resultFile   := A_Args[2]
quickfileExe := A_Args[3]

if (!icesaFile || !resultFile) {
    ExitApp, 1
}

; ── Helper: write error and exit ──────────────────────────────────────────────
WriteError(msg) {
    global resultFile
    FileDelete, %resultFile%
    FileAppend, ERROR: %msg%`n, %resultFile%
    ExitApp, 1
}

; ════════════════════════════════════════════════════════════════════════════════
; Launch or activate QuickFile
; ════════════════════════════════════════════════════════════════════════════════
IfWinExist, QuickFile
{
    WinActivate, QuickFile
}
Else
{
    Run, %quickfileExe%
    WinWait, QuickFile,, 30
    if ErrorLevel
        WriteError("QuickFile did not open within 30s")
    Sleep, 3000
}
WinActivate, QuickFile
Sleep, 1000

; ── Click "Find and Select File" ─────────────────────────────────────────────
ControlClick, Find and Select File, QuickFile,, LEFT, 1
Sleep, 1500

; ── File open dialog ─────────────────────────────────────────────────────────
WinWait, Open,, 8
if ErrorLevel
    WinWait, Choose a File,, 8
if ErrorLevel
    WriteError("File dialog did not appear")
Sleep, 500
ControlSetText, Edit1, %icesaFile%
Sleep, 300
Send, {Enter}
Sleep, 3000

; ── Back in QuickFile: Validate ───────────────────────────────────────────────
WinActivate, QuickFile
Sleep, 500
ControlClick, Validate, QuickFile,, LEFT, 1
Sleep, 4000

; ── Continue ─────────────────────────────────────────────────────────────────
WinActivate, QuickFile
ControlClick, Continue, QuickFile,, LEFT, 1
Sleep, 2000

; ── "Would you like to see a summary?" → No ──────────────────────────────────
WinActivate, QuickFile
Sleep, 500
ControlClick, No, QuickFile,, LEFT, 1
Sleep, 1500

; ── Find the .qfh file BEFORE dismissing the next dialog ─────────────────────
Sleep, 500
qfhFile := ""
newestTime := 0
Loop, C:\QuickFile\Upload\*.qfh
{
    if (A_LoopFileTimeModified > newestTime) {
        newestTime := A_LoopFileTimeModified
        qfhFile    := A_LoopFileFullPath
    }
}
if (!qfhFile)
    WriteError("No .qfh file found in C:\QuickFile\Upload\")

; ── "Two files have been created..." → OK ────────────────────────────────────
WinActivate, QuickFile
ControlClick, OK, QuickFile,, LEFT, 1
Sleep, 1500

; ── Nightly posting notice → OK ──────────────────────────────────────────────
WinActivate, QuickFile
ControlClick, OK, QuickFile,, LEFT, 1
Sleep, 1500

; ── "We will now open your internet browser..." → OK ─────────────────────────
WinActivate, QuickFile
ControlClick, OK, QuickFile,, LEFT, 1
Sleep, 5000   ; give Edge time to open

; ── Capture the URL from Edge's address bar ───────────────────────────────────
WinWait, twc.state.tx.us,, 20
if ErrorLevel
    WriteError("Edge / TWC page did not open")
WinActivate, twc.state.tx.us
Sleep, 2000

; Focus the address bar, select all, copy
Send, {F6}
Sleep, 400
Send, ^a
Sleep, 200
Send, ^c
Sleep, 400
twcUrl := Clipboard

; Close Edge — Puppeteer will handle it from here
WinClose, twc.state.tx.us
Sleep, 500

; ── Write result: line 1 = TWC URL, line 2 = .qfh file path ──────────────────
FileDelete, %resultFile%
FileAppend, %twcUrl%`n, %resultFile%
FileAppend, %qfhFile%`n, %resultFile%

ExitApp, 0
