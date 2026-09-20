$w = New-Object -ComObject WScript.Shell
$target = (Resolve-Path "FlowAutoStudio-win32-x64\FlowAutoStudio.exe").Path
$workDir = (Resolve-Path "FlowAutoStudio-win32-x64").Path

# Project root shortcut
$link1 = Join-Path (Get-Location) "FlowAutoStudio.lnk"
$s1 = $w.CreateShortcut($link1)
$s1.TargetPath = $target
$s1.WorkingDirectory = $workDir
$s1.Description = "Flow Auto Studio AI Automation App"
$s1.Save()

Write-Host "Created shortcut: $link1"
