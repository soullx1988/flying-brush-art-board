[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$BackupDirectory,
  [Alias('DataDirectory')]
  [string]$LocalAppDataBase = $env:LOCALAPPDATA
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedLocalAppDataBase = [System.IO.Path]::GetFullPath($LocalAppDataBase)
$applicationDataDirectory = Join-Path $resolvedLocalAppDataBase 'InfiniteBoard'
$resolvedBackupDirectory = [System.IO.Path]::GetFullPath($BackupDirectory)
$databasePath = Join-Path $applicationDataDirectory 'infinite-board.sqlite'

if (-not (Test-Path -LiteralPath (Join-Path $resolvedBackupDirectory 'database.sqlite'))) {
  throw "Backup does not contain database.sqlite: $resolvedBackupDirectory"
}
if (-not (Test-Path -LiteralPath (Join-Path $resolvedBackupDirectory 'assets'))) {
  throw "Backup does not contain an assets directory: $resolvedBackupDirectory"
}
if (-not (Test-Path -LiteralPath $databasePath)) {
  throw "No local database exists at $databasePath. Restore only replaces an existing local installation."
}
$apiPort = 8787
$listener = Get-NetTCPConnection -State Listen -LocalPort $apiPort -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $listener) {
  throw "Stop the local API before restoring (port $apiPort, PID $($listener.OwningProcess))."
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'pnpm is required.' }

$env:INFINITE_BOARD_RESTORE_DATA_DIRECTORY = $applicationDataDirectory
$env:INFINITE_BOARD_RESTORE_BACKUP_DIRECTORY = $resolvedBackupDirectory

Push-Location $projectRoot
try {
  $command = @('exec', 'tsx', 'scripts/backup-cli.ts', 'restore')
  & pnpm @command
  if ($LASTEXITCODE -ne 0) { throw 'Restore failed; the automatic restore point was retained.' }
  Write-Host 'Restore completed. Restart the app and open boards from the project home.'
} finally {
  Remove-Item Env:INFINITE_BOARD_RESTORE_DATA_DIRECTORY -ErrorAction SilentlyContinue
  Remove-Item Env:INFINITE_BOARD_RESTORE_BACKUP_DIRECTORY -ErrorAction SilentlyContinue
  Pop-Location
}
