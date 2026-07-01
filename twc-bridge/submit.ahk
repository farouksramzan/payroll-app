; submit.ahk — QuickFile desktop app automation
; Uses confirmed screen coordinates. After QuickFile opens Edge,
; captures the TWC URL + .qfh path, writes to result file, exits.
; Puppeteer (bridge.js) handles the browser login + file upload.
;
; Args: icesaFile, resultFile, quickfileExe

#NoEnv
#SingleInstance Force
SetWorkingDir %A_ScriptDir%
SetTitleMatchMode, 2
SendMode Input
CoordMode, Mouse, Screen
SetControlDelay, 150

; ── Arguments ──────────────────────────────────────────────────────────────────
icesaFile    := A_Args[1]
resultFile   := A_Args[2]
quickfileExe := A_Args[3]

if (!icesaFile || !resultFile) {
    ExitApp, 1
}

WriteError(msg) {
    global resultFile
    FileDelete, %resultFile%
    FileAppend, ERROR: %msg%`n, %resultFile%
    ExitApp, 1
}

; ── Launch or activate QuickFile ───────────────────────────────────────────────
IfWinExist, QuickFile
{
    WinActivate, QuickFile
    Sleep, 500
}
Else
{
    ; Click taskbar icon to bring up QuickFile
    Click, 849, 1056
    Sleep, 2000
    WinWait, QuickFile,, 30
    if ErrorLevel
    {
        ; fallback: launch directly
        Run, %quickfileExe%
        WinWait, QuickFile,, 30
        if ErrorLevel
            WriteError("QuickFile did not open within 30s")
    }
    Sleep, 2000
}
WinActivate, QuickFile
Sleep, 1000

; ── Find and Select File ───────────────────────────────────────────────────────
Click, 1113, 442
Sleep, 2000

; ── File open dialog — type path, click Open ──────────────────────────────────
WinWait, Open,, 8
if ErrorLevel
    WinWait, Choose a File,, 8
if ErrorLevel
    WriteError("File dialog did not appear")
Sleep, 500

; Click filename field and type path
Click, 969, 805
Sleep, 300
Send, ^a
Sleep, 100
Send, %icesaFile%
Sleep, 500

; Click Open
Click, 1486, 838
Sleep, 3000

; ── Validate ───────────────────────────────────────────────────────────────────
WinActivate, QuickFile
Sleep, 500
Click, 1093, 531
Sleep, 4000

; ── Continue ───────────────────────────────────────────────────────────────────
WinActivate, QuickFile
Sleep, 500
Click, 61, 582
Sleep, 2000

; ── "Would you like to see a summary?" → No ───────────────────────────────────
WinActivate, QuickFile
Sleep, 500
Click, 1051, 580
Sleep, 1500

; ── Find the .qfh file BEFORE dismissing the next dialog ──────────────────────
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
; fallback: search user's Documents folder
if (!qfhFile) {
    Loop, %USERPROFILE%\Documents\*.qfh
    {
        if (A_LoopFileTimeModified > newestTime) {
            newestTime := A_LoopFileTimeModified
            qfhFile    := A_LoopFileFullPath
        }
    }
}
if (!qfhFile)
    WriteError("No .qfh file found — check C:\QuickFile\Upload\ or Documents")

; ── "Two files have been created..." → OK ─────────────────────────────────────
WinActivate, QuickFile
Sleep, 500
Click, 1100, 605
Sleep, 1500

; ── Nightly posting notice → OK ───────────────────────────────────────────────
WinActivate, QuickFile
Sleep, 500
Click, 1109, 671
Sleep, 1500

; ── "We will now open your internet browser..." → OK ─────────────────────────
WinActivate, QuickFile
Sleep, 500
Click, 1083, 622
Sleep, 6000    ; give Edge time to open and load

; ── Capture TWC URL from Edge address bar ─────────────────────────────────────
WinWait, twc.state.tx.us,, 20
if ErrorLevel
    WriteError("Edge / TWC page did not open within 20s")
WinActivate, twc.state.tx.us
Sleep, 2000

Send, {F6}
Sleep, 500
Send, ^a
Sleep, 200
Send, ^c
Sleep, 500
twcUrl := Clipboard

; Close Edge — Puppeteer will handle login + upload
WinClose, twc.state.tx.us
Sleep, 800

; ── Write result file: line 1 = TWC URL, line 2 = .qfh path ──────────────────
FileDelete, %resultFile%
FileAppend, %twcUrl%`n, %resultFile%
FileAppend, %qfhFile%`n, %resultFile%

ExitApp, 0
