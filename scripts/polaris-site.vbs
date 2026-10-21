' Starts the local site supervisor with no console window (window style 0).
' Task Scheduler runs this via wscript.exe at logon; output goes to logs/polaris-site.log.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
shell.Run "node """ & root & "\scripts\polaris-site.js""", 0, False
