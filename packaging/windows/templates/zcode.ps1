#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$ZCodeRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ZCodeApp = Join-Path $ZCodeRoot 'app'
$Entry = Join-Path $ZCodeApp 'src\entrypoints\publicCli.js'

if (-not (Test-Path -LiteralPath $Entry)) {
    Write-Error "[ZCode] Missing entrypoint: $Entry"
    exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error '[ZCode] Node.js not found. Install Node.js 22 or newer: https://nodejs.org/'
    exit 1
}

$versionOutput = & node -p "process.versions.node" 2>$null
if ($versionOutput) {
    $major = [int]($versionOutput -split '\.')[0]
    if ($major -lt 22) {
        Write-Error "[ZCode] Node.js 22+ required (found v$versionOutput)."
        exit 1
    }
}

& node $Entry @args
exit $LASTEXITCODE
