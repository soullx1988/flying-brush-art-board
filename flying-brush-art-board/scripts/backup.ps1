[CmdletBinding()]
param(
  [string]$DataDirectory,
  [string]$LocalAppDataBase,
  [string]$BackupDirectory
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
$resolvedBackupDirectory = if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
  Join-Path $applicationDataDirectory 'backups'
} else {
  [System.IO.Path]::GetFullPath($BackupDirectory)
}
$databasePath = Join-Path $applicationDataDirectory 'infinite-board.sqlite'

if (-not (Test-Path -LiteralPath $databasePath)) {
  throw "No local database exists at $databasePath. Start the app and create a project first."
}
$nodeExecutable = (& (Join-Path $PSScriptRoot 'ensure-node-runtime.ps1') | Select-Object -Last 1)
$nodeDirectory = Split-Path -Parent $nodeExecutable
$env:PATH = "$nodeDirectory;$env:PATH"
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
$corepackExecutable = Join-Path $nodeDirectory 'corepack.cmd'
if (-not (Test-Path -LiteralPath $corepackExecutable -PathType Leaf)) { throw 'Pinned Corepack runtime is required.' }

$env:INFINITE_BOARD_BACKUP_DATA_DIRECTORY = $applicationDataDirectory
$env:INFINITE_BOARD_BACKUP_ROOT_DIRECTORY = $resolvedBackupDirectory

Push-Location $projectRoot
try {
  $command = @('exec', 'tsx', 'scripts/backup-cli.ts', 'backup')
  & $corepackExecutable pnpm @command
  if ($LASTEXITCODE -ne 0) { throw 'Backup failed.' }
} finally {
  Remove-Item Env:INFINITE_BOARD_BACKUP_DATA_DIRECTORY -ErrorAction SilentlyContinue
  Remove-Item Env:INFINITE_BOARD_BACKUP_ROOT_DIRECTORY -ErrorAction SilentlyContinue
  Pop-Location
}
