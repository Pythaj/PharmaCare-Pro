$desktop = [Environment]::GetFolderPath("Desktop")
$projectDir = "D:\PROJECTS BUILD\RAW FILES\PHARMACY MANAGEMENT SYSTEM APP"
$wsh = New-Object -ComObject WScript.Shell

# Main launcher shortcut
$shortcut = $wsh.CreateShortcut("$desktop\PharmaCare Pro.lnk")
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = """$projectDir\launch-pc.vbs"""
$shortcut.WorkingDirectory = $projectDir
$shortcut.Description = "PharmaCare Pro - Premium Pharmacy Management System"
$shortcut.IconLocation = "C:\Windows\System32\imageres.dll, 179"
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Host "Shortcut created: $desktop\PharmaCare Pro.lnk"
