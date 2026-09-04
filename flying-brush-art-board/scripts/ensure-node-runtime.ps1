[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeVersion = '22.23.2'
$archiveName = "node-v$runtimeVersion-win-x64.zip"
$expectedSha256 = '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime'))
$runtimeDirectory = Join-Path $runtimeRoot "node-v$runtimeVersion-win-x64"
$nodeExecutable = Join-Path $runtimeDirectory 'node.exe'

function Assert-ExpectedNode([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  try {
    return ((& $Path --version).Trim()) -eq "v$runtimeVersion"
  } catch {
    return $false
  }
}

function Enable-PinnedPnpm([string]$Directory) {
  $corepackExecutable = Join-Path $Directory 'corepack.cmd'
  $pnpmExecutable = Join-Path $Directory 'pnpm.cmd'
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  & $corepackExecutable enable --install-directory $Directory pnpm
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create the pinned pnpm launcher.' }
  $pnpmVersion = (& $pnpmExecutable --version).Trim()
  if ($pnpmVersion -ne '11.9.0') {
    throw "Pinned pnpm version mismatch: expected 11.9.0, got $pnpmVersion."
  }
}

if (Assert-ExpectedNode $nodeExecutable) {
  Enable-PinnedPnpm $runtimeDirectory
  Write-Output $nodeExecutable
  exit 0
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$archivePath = Join-Path $runtimeRoot $archiveName
$archiveReady = $false
if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
  $archiveReady = ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()) -eq $expectedSha256
}
if (-not $archiveReady) {
  $downloadPath = Join-Path $runtimeRoot "$archiveName.download-$PID"
  Write-Host "Downloading the pinned Node.js v$runtimeVersion runtime..."
  Invoke-WebRequest `
    -Uri "https://nodejs.org/download/release/v$runtimeVersion/$archiveName" `
    -OutFile $downloadPath `
    -UseBasicParsing `
    -TimeoutSec 180
  $actualSha256 = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "Pinned Node.js archive hash mismatch: expected $expectedSha256, got $actualSha256."
  }
  Move-Item -LiteralPath $downloadPath -Destination $archivePath -Force
}

$extractRoot = Join-Path $runtimeRoot ".extract-$PID-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $extractRoot | Out-Null
$tar = (Get-Command tar.exe -ErrorAction Stop).Source
& $tar -xf $archivePath -C $extractRoot
if ($LASTEXITCODE -ne 0) {
  throw "Node.js runtime extraction failed with exit code $LASTEXITCODE."
}
$extractedDirectory = Join-Path $extractRoot "node-v$runtimeVersion-win-x64"
$extractedNode = Join-Path $extractedDirectory 'node.exe'
if (-not (Assert-ExpectedNode $extractedNode)) {
  throw 'The extracted Node.js runtime failed version verification.'
}
if (Test-Path -LiteralPath $runtimeDirectory) {
  throw "Unexpected invalid runtime directory already exists: $runtimeDirectory"
}
Move-Item -LiteralPath $extractedDirectory -Destination $runtimeDirectory
if ([System.IO.Path]::GetFullPath($extractRoot).StartsWith($runtimeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  Remove-Item -LiteralPath $extractRoot -Recurse -Force
}
Enable-PinnedPnpm $runtimeDirectory
Write-Output $nodeExecutable
