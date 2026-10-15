' Launches the daily research job with no console window (window style 0).
' Task Scheduler runs this via wscript.exe; output goes to data/pulse/logs.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
shell.Run "node """ & root & "\scripts\pulse-daily.js""", 0, True
