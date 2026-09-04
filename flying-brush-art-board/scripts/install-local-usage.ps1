[CmdletBinding()]
param(
  [string]$TaskName = 'AI_Trading_InfiniteBoard',
  [string]$ShortcutName = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ShortcutName)) {
  # Windows PowerShell 5.1 can read UTF-8 files without BOM using a legacy
  # code page, so build the Chinese shortcut name from Unicode code points.
  $shortcutStem = (0x6253, 0x5F00, 0x77ED, 0x7EBF, 0x4EA4, 0x6613, 0x753B, 0x677F |
    ForEach-Object { [char]$_ }) -join ''
  $ShortcutName = "$shortcutStem.lnk"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot 'start-local.ps1'
$powershell = (Get-Command powershell.exe).Source
$actionArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -NoBrowser"
$action = New-ScheduledTaskAction -Execute $powershell -Argument $actionArguments -WorkingDirectory $projectRoot
$triggers = @(
  New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  New-ScheduledTaskTrigger -Daily -At '08:45'
)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited
Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description 'Keeps the local shortline trading Infinite Board available at 127.0.0.1:4173.' `
  -Force | Out-Null

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop $ShortcutName
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Open the local shortline trading Infinite Board.'
$shortcut.Save()

Start-ScheduledTask -TaskName $TaskName
Write-Output "Task=$TaskName"
Write-Output "Shortcut=$shortcutPath"
Write-Output 'Url=http://127.0.0.1:4173'
