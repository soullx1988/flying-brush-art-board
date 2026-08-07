[CmdletBinding()]
param(
  [Alias('DataDirectory')]
  [string]$LocalAppDataBase = $env:LOCALAPPDATA,
  [string]$BackupDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedLocalAppDataBase = [System.IO.Path]::GetFullPath($LocalAppDataBase)
$applicationDataDirectory = Join-Path $resolvedLocalAppDataBase 'InfiniteBoard'
$resolvedBackupDirectory = if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
  Join-Path $applicationDataDirectory 'backups'
} else {
  [System.IO.Path]::GetFullPath($BackupDirectory)
}
$databasePath = Join-Path $applicationDataDirectory 'infinite-board.sqlite'

if (-not (Test-Path -LiteralPath $databasePath)) {
  throw "No local database exists at $databasePath. Start the app and create a project first."
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'pnpm is required.' }

$env:INFINITE_BOARD_BACKUP_DATA_DIRECTORY = $applicationDataDirectory
$env:INFINITE_BOARD_BACKUP_ROOT_DIRECTORY = $resolvedBackupDirectory

Push-Location $projectRoot
try {
  $command = @('exec', 'tsx', 'scripts/backup-cli.ts', 'backup')
  & pnpm @command
  if ($LASTEXITCODE -ne 0) { throw 'Backup failed.' }
} finally {
  Remove-Item Env:INFINITE_BOARD_BACKUP_DATA_DIRECTORY -ErrorAction SilentlyContinue
  Remove-Item Env:INFINITE_BOARD_BACKUP_ROOT_DIRECTORY -ErrorAction SilentlyContinue
  Pop-Location
}
