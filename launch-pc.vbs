Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Find the batch file relative to this VBS script
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
BatFile = FSO.BuildPath(ScriptDir, "start.bat")

WshShell.Run Chr(34) & BatFile & Chr(34), 0, False
