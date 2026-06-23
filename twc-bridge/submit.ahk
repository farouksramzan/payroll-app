; submit.ahk — TWC QuickFile full automation (app + browser)
; Args: icesaFile, resultFile, quickfileExe, twcUsername, twcPassword

#NoEnv
#SingleInstance Force
SetWorkingDir %A_ScriptDir%
SetTitleMatchMode, 2        ; partial window title matching
SendMode Input
CoordMode, Mouse, Screen
SetControlDelay, 100

; ── Arguments ─────────────────────────────────────────────────────────────────
icesaFile    := A_Args[1]
resultFile   := A_Args[2]
quickfileExe := A_Args[3]
twcUsername  := A_Args[4]
twcPassword  := A_Args[5]

if (!icesaFile || !resultFile || !twcUsername || !twcPassword) {
    FileAppend, ERROR: Missing arguments`n, %resultFile%
    ExitApp, 1
}

; ════════════════════════════════════════════════════════════════════════════════
; PART 1 — QuickFile Desktop App
; ════════════════════════════════════════════════════════════════════════════════

; Launch or bring QuickFile to front
IfWinExist, QuickFile
{
    WinActivate, QuickFile
}
Else
{
    Run, %quickfileExe%
    WinWait, QuickFile,, 30
    if ErrorLevel {
        FileAppend, ERROR: QuickFile did not open within 30s`n, %resultFile%
        ExitApp, 1
    }
    Sleep, 3000
}
WinActivate, QuickFile
Sleep, 1000

; Click "Find and Select File"
ControlClick, Find and Select File, QuickFile,, LEFT, 1
Sleep, 1500

; File open dialog — try native Windows dialog first, then Java chooser
WinWait, Open,, 8
if ErrorLevel
    WinWait, Choose a File,, 8
if ErrorLevel {
    FileAppend, ERROR: File dialog did not appear`n, %resultFile%
    ExitApp, 1
}
Sleep, 500
; Type the full path to the ICESA file
ControlSetText, Edit1, %icesaFile%
Sleep, 300
Send, {Enter}
Sleep, 3000

; Back in QuickFile — click Validate
WinActivate, QuickFile
Sleep, 500
ControlClick, Validate, QuickFile,, LEFT, 1
Sleep, 4000

; Click Continue
WinActivate, QuickFile
ControlClick, Continue, QuickFile,, LEFT, 1
Sleep, 2000

; Dialog: "Would you like to see a summary of your report?" → No
WinWait, QuickFile,, 5
WinActivate, QuickFile
ControlClick, No, QuickFile,, LEFT, 1
Sleep, 1500

; Dialog: "Two files have been created..." → OK
; Grab the .qfh file BEFORE dismissing so we know what was created
WinActivate, QuickFile
Sleep, 500

; Find the newest .qfh file in C:\QuickFile\Upload\
qfhFile := ""
newestTime := 0
Loop, C:\QuickFile\Upload\*.qfh
{
    if (A_LoopFileTimeModified > newestTime) {
        newestTime := A_LoopFileTimeModified
        qfhFile    := A_LoopFileFullPath
    }
}
if (!qfhFile) {
    FileAppend, ERROR: No .qfh file found in C:\QuickFile\Upload\`n, %resultFile%
    ExitApp, 1
}

ControlClick, OK, QuickFile,, LEFT, 1
Sleep, 1500

; Dialog: "...nightly posting cycle..." → OK
WinActivate, QuickFile
ControlClick, OK, QuickFile,, LEFT, 1
Sleep, 1500

; Dialog: "We will now open your internet browser..." → OK
WinActivate, QuickFile
ControlClick, OK, QuickFile,, LEFT, 1
Sleep, 4000   ; give Edge time to open and load the page

; ════════════════════════════════════════════════════════════════════════════════
; PART 2 — Microsoft Edge + TWC Website
; ════════════════════════════════════════════════════════════════════════════════

; Wait for Edge to open the TWC page
WinWait, twc.state.tx.us,, 30
if ErrorLevel {
    FileAppend, ERROR: Edge / TWC page did not open within 30s`n, %resultFile%
    ExitApp, 1
}
WinActivate, twc.state.tx.us
Sleep, 3000   ; wait for login page to fully render

; ── Login form ────────────────────────────────────────────────────────────────
; Click User ID field and type username
; Using Ctrl+F or tab navigation since we can't use ControlSetText on web fields

; Navigate to User ID field — try clicking it via keyboard/tab from top of page
Send, {F6}            ; focus the address bar area
Sleep, 200
Send, {Tab}           ; shift focus into page content
Sleep, 300

; Tab through to the User ID input (adjust tab count if needed)
Send, {Tab}
Sleep, 200

; Clear + type username
Send, ^a
Send, %twcUsername%
Sleep, 300

; Tab to password field
Send, {Tab}
Sleep, 200
Send, %twcPassword%
Sleep, 300

; Submit the login form
Send, {Enter}
Sleep, 6000   ; wait for page to load after login

; ── Upload page ───────────────────────────────────────────────────────────────
WinActivate, twc.state.tx.us
Sleep, 2000

; Click "Choose File" — this opens a native Windows file picker
; Tab to the Choose File button (adjust count based on actual page layout)
Send, {Tab}
Sleep, 300
Send, {Tab}
Sleep, 300
Send, {Space}         ; activate Choose File button
Sleep, 1500

; Windows file picker dialog
WinWait, Open,, 10
if ErrorLevel {
    FileAppend, ERROR: File picker did not open`n, %resultFile%
    ExitApp, 1
}
Sleep, 500
ControlSetText, Edit1, %qfhFile%
Sleep, 300
Send, {Enter}
Sleep, 2000

; Click "Send File"
WinActivate, twc.state.tx.us
Sleep, 1000
Send, {Tab}
Sleep, 200
Send, {Space}         ; click Send File button
Sleep, 6000

; ── Capture confirmation ──────────────────────────────────────────────────────
; Try to copy page text to clipboard and extract confirmation info
WinActivate, twc.state.tx.us
Sleep, 1000
Send, ^a              ; select all
Sleep, 300
Send, ^c              ; copy
Sleep, 500
pageText := Clipboard

; Write whatever we captured — bridge.js will store it as the confirmation
confirmLine := "SUBMITTED"
if (pageText != "")
    confirmLine := SubStr(pageText, 1, 500)   ; first 500 chars of page

FileDelete, %resultFile%
FileAppend, %confirmLine%, %resultFile%

ExitApp, 0
