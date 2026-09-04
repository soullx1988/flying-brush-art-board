[CmdletBinding()]
param(
  [int]$WebPort = 4173,
  [string]$DataDirectory,
  [string]$LocalAppDataBase,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. Install it and restart this script."
  }
}

function Assert-PortAvailable([int]$Port) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $listener) {
    throw "Port $Port is already listening (PID $($listener.OwningProcess)). Stop that process or choose a different port."
  }
}

function Test-ExistingLocalApp([int]$WebPort, [int]$BackendPort) {
  $apiListener = Get-NetTCPConnection -State Listen -LocalPort $BackendPort -ErrorAction SilentlyContinue | Select-Object -First 1
  $webListener = Get-NetTCPConnection -State Listen -LocalPort $WebPort -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $apiListener -and $null -eq $webListener) { return $false }
  if ($null -eq $apiListener -or $null -eq $webListener) {
    throw "Only one local app port is listening. API PID: $($apiListener.OwningProcess); Web PID: $($webListener.OwningProcess)."
  }
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/health" -TimeoutSec 2
    $web = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 2
  } catch {
    throw "Ports $WebPort/$BackendPort are occupied by an unhealthy or unrelated process."
  }
  if ($health.status -ne 'ok' -or $health.database -ne 'ok' -or $web.StatusCode -ne 200) {
    throw "Ports $WebPort/$BackendPort are not serving the healthy Infinite Board app."
  }
  return $true
}

function Stop-ProcessTree([System.Diagnostics.Process]$Process) {
  if ($null -eq $Process -or $Process.HasExited) { return }
  & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
}

$apiPort = 8787
if (Test-ExistingLocalApp -WebPort $WebPort -BackendPort $apiPort) {
  Write-Host "Infinite Board is already healthy: http://127.0.0.1:$WebPort"
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$WebPort" }
  exit 0
}
Assert-PortAvailable $apiPort
Assert-PortAvailable $WebPort

$nodeExecutable = (& (Join-Path $PSScriptRoot 'ensure-node-runtime.ps1') | Select-Object -Last 1)
if ([string]::IsNullOrWhiteSpace($nodeExecutable)) {
  throw 'Pinned Node.js runtime resolution returned no executable.'
}
$nodeDirectory = Split-Path -Parent $nodeExecutable
$env:PATH = "$nodeDirectory;$env:PATH"
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
$corepackExecutable = Join-Path $nodeDirectory 'corepack.cmd'
if (-not (Test-Path -LiteralPath $corepackExecutable -PathType Leaf)) {
  throw "Corepack is missing from the pinned Node.js runtime: $corepackExecutable"
}

$nodeVersion = [version](((& $nodeExecutable --version).Trim()).TrimStart('v'))
if ($nodeVersion.Major -ne 22 -or $nodeVersion.Minor -lt 13) {
  throw "Node >=22.13 and <23 is required; found $nodeVersion."
}

$pnpmVersion = ((& $corepackExecutable pnpm --version).Trim())
if ($pnpmVersion -ne '11.9.0') {
  throw "pnpm 11.9.0 is required; found $pnpmVersion."
}

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
New-Item -ItemType Directory -Force -Path $applicationDataDirectory | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $applicationDataDirectory 'assets') | Out-Null
$previousDataDirectory = $env:INFINITE_BOARD_DATA_DIR
$previousMcpPublicUrl = $env:MCP_PUBLIC_URL
$previousMcpAllowedHosts = $env:MCP_ALLOWED_HOSTS
$previousMcpAllowedOrigins = $env:MCP_ALLOWED_ORIGINS

Push-Location $projectRoot
try {
  if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
    & $corepackExecutable pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  }

  # Workspace package exports point at dist/*, which is intentionally not
  # committed. A clean clone must build them before migration or API startup.
  & $corepackExecutable pnpm -r --filter './packages/**' --workspace-concurrency=1 --if-present build
  if ($LASTEXITCODE -ne 0) { throw 'Workspace package build failed; the local API was not started.' }

  # Run recorded SQLite migrations before the API process is allowed to start.
  $env:INFINITE_BOARD_DATA_DIR = $applicationDataDirectory
  if ($env:MCP_ENABLED -eq 'true') {
    $env:MCP_PUBLIC_URL = "http://127.0.0.1:$WebPort"
    $env:MCP_ALLOWED_HOSTS = '127.0.0.1,localhost'
    $env:MCP_ALLOWED_ORIGINS = "http://127.0.0.1:$WebPort"
  }
  $migrationArguments = @('exec', 'tsx', 'scripts/migrate-local.ts')
  & $corepackExecutable pnpm @migrationArguments
  if ($LASTEXITCODE -ne 0) { throw 'SQLite migration failed; the local API was not started.' }

  $apiArguments = @('--filter', '@infinite-board/local-api', 'dev')
  $apiProcessArguments = @('pnpm') + $apiArguments
  $apiProcess = Start-Process -FilePath $corepackExecutable -ArgumentList $apiProcessArguments -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
  try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/health" -TimeoutSec 1
        if ($health.status -eq 'ok' -and $health.database -eq 'ok') {
          $ready = $true
          break
        }
      } catch {}
      Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'The local API did not become healthy; its startup migration may have failed.' }

    $webArguments = @('--filter', '@infinite-board/web', 'dev', '--', '--port', "$WebPort")
    $webProcessArguments = @('pnpm') + $webArguments
    $webProcess = Start-Process -FilePath $corepackExecutable -ArgumentList $webProcessArguments -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
    $webReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -eq 200 -and $response.Content -match '<div id="root"></div>') {
          $webReady = $true
          break
        }
      } catch {}
      Start-Sleep -Milliseconds 500
    }
    if (-not $webReady) { throw 'The web app did not become ready.' }
    Write-Host "Local API: http://127.0.0.1:$apiPort/health"
    Write-Host "Web app:   http://127.0.0.1:$WebPort"
    Write-Host "Data:      $applicationDataDirectory"
    if ($env:MCP_ENABLED -eq 'true') {
      Write-Host "MCP v2:    http://127.0.0.1:$WebPort/mcp (OAuth 2.1)"
    }
    Write-Host "API PID:   $($apiProcess.Id); Web PID: $($webProcess.Id)"
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$WebPort" }
  } catch {
    Stop-ProcessTree $webProcess
    Stop-ProcessTree $apiProcess
    throw
  }
} finally {
  if ($null -eq $previousDataDirectory) {
    Remove-Item Env:INFINITE_BOARD_DATA_DIR -ErrorAction SilentlyContinue
  } else {
    $env:INFINITE_BOARD_DATA_DIR = $previousDataDirectory
  }
  if ($null -eq $previousMcpPublicUrl) { Remove-Item Env:MCP_PUBLIC_URL -ErrorAction SilentlyContinue } else { $env:MCP_PUBLIC_URL = $previousMcpPublicUrl }
  if ($null -eq $previousMcpAllowedHosts) { Remove-Item Env:MCP_ALLOWED_HOSTS -ErrorAction SilentlyContinue } else { $env:MCP_ALLOWED_HOSTS = $previousMcpAllowedHosts }
  if ($null -eq $previousMcpAllowedOrigins) { Remove-Item Env:MCP_ALLOWED_ORIGINS -ErrorAction SilentlyContinue } else { $env:MCP_ALLOWED_ORIGINS = $previousMcpAllowedOrigins }
  Pop-Location
}
