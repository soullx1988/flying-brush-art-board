[CmdletBinding()]
param(
  [int]$WebPort = 5173,
  [Alias('DataDirectory')]
  [string]$LocalAppDataBase = $env:LOCALAPPDATA,
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

Assert-Command 'node'
Assert-Command 'pnpm'
$apiPort = 8787
Assert-PortAvailable $apiPort
Assert-PortAvailable $WebPort

$nodeVersion = [version](((& node --version).Trim()).TrimStart('v'))
if ($nodeVersion.Major -ne 22 -or $nodeVersion.Minor -lt 13) {
  throw "Node >=22.13 and <23 is required; found $nodeVersion."
}

$pnpmVersion = ((& pnpm --version).Trim())
if ($pnpmVersion -ne '11.9.0') {
  throw "pnpm 11.9.0 is required; found $pnpmVersion."
}

$resolvedLocalAppDataBase = [System.IO.Path]::GetFullPath($LocalAppDataBase)
$applicationDataDirectory = Join-Path $resolvedLocalAppDataBase 'InfiniteBoard'
New-Item -ItemType Directory -Force -Path $applicationDataDirectory | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $applicationDataDirectory 'assets') | Out-Null
$previousLocalAppData = $env:LOCALAPPDATA
$previousMcpPublicUrl = $env:MCP_PUBLIC_URL
$previousMcpAllowedHosts = $env:MCP_ALLOWED_HOSTS
$previousMcpAllowedOrigins = $env:MCP_ALLOWED_ORIGINS

Push-Location $projectRoot
try {
  if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  }

  # Run recorded SQLite migrations before the API process is allowed to start.
  $env:LOCALAPPDATA = $resolvedLocalAppDataBase
  if ($env:MCP_ENABLED -eq 'true') {
    $env:MCP_PUBLIC_URL = "http://127.0.0.1:$WebPort"
    $env:MCP_ALLOWED_HOSTS = '127.0.0.1,localhost'
    $env:MCP_ALLOWED_ORIGINS = "http://127.0.0.1:$WebPort"
  }
  $migrationArguments = @('exec', 'tsx', 'scripts/migrate-local.ts')
  & pnpm @migrationArguments
  if ($LASTEXITCODE -ne 0) { throw 'SQLite migration failed; the local API was not started.' }

  $apiArguments = @('--filter', '@infinite-board/local-api', 'dev')
  $apiProcess = Start-Process -FilePath 'pnpm.cmd' -ArgumentList $apiArguments -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
  try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/health" -TimeoutSec 1
        if ($health.status -eq 'ok' -and $health.database -eq 'ok') {
          $ready = $true
          break
        }
      } catch {
        Start-Sleep -Milliseconds 500
      }
    }
    if (-not $ready) { throw 'The local API did not become healthy; its startup migration may have failed.' }

    $webArguments = @('--filter', '@infinite-board/web', 'dev', '--', '--port', "$WebPort")
    $webProcess = Start-Process -FilePath 'pnpm.cmd' -ArgumentList $webArguments -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
    Write-Host "Local API: http://127.0.0.1:$apiPort/health"
    Write-Host "Web app:   http://127.0.0.1:$WebPort"
    Write-Host "Data:      $applicationDataDirectory"
    if ($env:MCP_ENABLED -eq 'true') {
      Write-Host "MCP v2:    http://127.0.0.1:$WebPort/mcp (OAuth 2.1)"
    }
    Write-Host "API PID:   $($apiProcess.Id); Web PID: $($webProcess.Id)"
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$WebPort" }
  } catch {
    if (-not $apiProcess.HasExited) { Stop-Process -Id $apiProcess.Id -Force }
    throw
  }
} finally {
  if ($null -eq $previousLocalAppData) {
    Remove-Item Env:LOCALAPPDATA -ErrorAction SilentlyContinue
  } else {
    $env:LOCALAPPDATA = $previousLocalAppData
  }
  if ($null -eq $previousMcpPublicUrl) { Remove-Item Env:MCP_PUBLIC_URL -ErrorAction SilentlyContinue } else { $env:MCP_PUBLIC_URL = $previousMcpPublicUrl }
  if ($null -eq $previousMcpAllowedHosts) { Remove-Item Env:MCP_ALLOWED_HOSTS -ErrorAction SilentlyContinue } else { $env:MCP_ALLOWED_HOSTS = $previousMcpAllowedHosts }
  if ($null -eq $previousMcpAllowedOrigins) { Remove-Item Env:MCP_ALLOWED_ORIGINS -ErrorAction SilentlyContinue } else { $env:MCP_ALLOWED_ORIGINS = $previousMcpAllowedOrigins }
  Pop-Location
}
