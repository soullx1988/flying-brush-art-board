[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$BackupDirectory,
  [string]$DataDirectory,
  [string]$LocalAppDataBase
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not [string]::IsNullOrWhiteSpace($DataDirectory) -and -not [string]::IsNullOrWhiteSpace($LocalAppDataBase)) {
  throw 'Pass either -DataDirectory or the legacy -LocalAppDataBase parameter, not both.'
}
$applicationDataDirectory = if (-not [string]::IsNullOrWhiteSpace($DataDirectory)) {
  [System.IO.Path]::GetFullPath($DataDirectory)
} elseif (-not [string]::IsNullOrWhiteSpace($LocalAppDataBase)) {
  [System.IO.Path]::GetFullPath((Join-Path $LocalAppDataBase 'InfiniteBoard'))
} elseif (-not [string]::IsNullOrWhiteSpace($env:INFINITE_BOARD_DATA_DIR)) {
  [System.IO.Path]::GetFullPath($env:INFINITE_BOARD_DATA_DIR)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.infinite-board-data'))
}
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
$lockPath = Join-Path $applicationDataDirectory '.infinite-board.lock'
if (Test-Path -LiteralPath $lockPath) {
  try {
    $lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $lock.processId -or $null -eq $lock.port) { throw 'Lock metadata is incomplete.' }
  } catch {
    throw "The data directory has an unreadable runtime lock at $lockPath. Verify the API is stopped before removing that exact lock file."
  }
  $owner = Get-Process -Id ([int]$lock.processId) -ErrorAction SilentlyContinue
  if ($null -ne $owner) {
    throw "Stop the local API using this data directory before restoring (port $($lock.port), PID $($lock.processId))."
  }
  Remove-Item -LiteralPath $lockPath -Force
}
$apiPort = 8787
$listener = Get-NetTCPConnection -State Listen -LocalPort $apiPort -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $listener) {
  throw "Stop the local API before restoring (port $apiPort, PID $($listener.OwningProcess))."
}
$nodeExecutable = (& (Join-Path $PSScriptRoot 'ensure-node-runtime.ps1') | Select-Object -Last 1)
$nodeDirectory = Split-Path -Parent $nodeExecutable
$env:PATH = "$nodeDirectory;$env:PATH"
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
$corepackExecutable = Join-Path $nodeDirectory 'corepack.cmd'
if (-not (Test-Path -LiteralPath $corepackExecutable -PathType Leaf)) { throw 'Pinned Corepack runtime is required.' }

$env:INFINITE_BOARD_RESTORE_DATA_DIRECTORY = $applicationDataDirectory
$env:INFINITE_BOARD_RESTORE_BACKUP_DIRECTORY = $resolvedBackupDirectory

Push-Location $projectRoot
try {
  $command = @('exec', 'tsx', 'scripts/backup-cli.ts', 'restore')
  & $corepackExecutable pnpm @command
  if ($LASTEXITCODE -ne 0) { throw 'Restore failed; the automatic restore point was retained.' }
  Write-Host 'Restore completed. Restart the app and open boards from the project home.'
} finally {
  Remove-Item Env:INFINITE_BOARD_RESTORE_DATA_DIRECTORY -ErrorAction SilentlyContinue
  Remove-Item Env:INFINITE_BOARD_RESTORE_BACKUP_DIRECTORY -ErrorAction SilentlyContinue
  Pop-Location
}
