#Requires -Version 5.1
<#
.SYNOPSIS
  Build a Windows portable ZIP for ZCode public CLI.

.DESCRIPTION
  Produces dist/zcode-<version>-win-x64-portable.zip with:
    app/   - production npm install of ZCode/
    bin/   - zcode.cmd / zcode.ps1 launchers
    VERSION, LICENSE, README-PORTABLE.txt

.PARAMETER Version
  Override version string (default: read from ZCode/package.json).

.PARAMETER OutputDir
  Output directory for the ZIP (default: repo dist/).

.PARAMETER SkipNpmInstall
  Skip npm ci --omit=dev (use when node_modules is already prepared).

.EXAMPLE
  .\packaging\windows\build-portable.ps1
#>
param(
    [string] $Version = '',
    [string] $OutputDir = '',
    [switch] $SkipNpmInstall
)

$ErrorActionPreference = 'Stop'

$PackagingRoot = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $PackagingRoot '..\..')).Path
$ZCodeDir = Join-Path $RepoRoot 'ZCode'

if (-not (Test-Path -LiteralPath (Join-Path $ZCodeDir 'package.json'))) {
    throw "ZCode package.json not found at $ZCodeDir"
}

$packageJson = Get-Content -LiteralPath (Join-Path $ZCodeDir 'package.json') -Raw | ConvertFrom-Json
if (-not $Version) {
    $Version = $packageJson.version
}
if (-not $Version) {
    $Version = '0.0.0'
}

if (-not $OutputDir) {
    $OutputDir = Join-Path $RepoRoot 'dist'
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$artifactBase = "zcode-$Version-win-x64-portable"
$stagingRoot = Join-Path $env:TEMP "zcode-build-$([Guid]::NewGuid().ToString('N'))"
$artifactDir = Join-Path $stagingRoot $artifactBase
$appDir = Join-Path $artifactDir 'app'
$binDir = Join-Path $artifactDir 'bin'

try {
    Write-Host "==> ZCode Windows portable build v$Version"
    Write-Host "    Staging: $artifactDir"

    if (-not $SkipNpmInstall) {
        Write-Host '==> npm ci --omit=dev (ZCode/)'
        Push-Location $ZCodeDir
        try {
            if (Test-Path -LiteralPath (Join-Path $ZCodeDir 'package-lock.json')) {
                & npm ci --omit=dev
            } else {
                & npm install --omit=dev
            }
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed with exit code $LASTEXITCODE"
            }
        } finally {
            Pop-Location
        }
    }

    New-Item -ItemType Directory -Force -Path $appDir, $binDir | Out-Null

    Write-Host '==> Copy application files'
    $copyItems = @(
        @{ Source = 'src'; Dest = 'src' },
        @{ Source = 'package.json'; Dest = 'package.json' },
        @{ Source = 'package-lock.json'; Dest = 'package-lock.json' }
    )
    foreach ($item in $copyItems) {
        $src = Join-Path $ZCodeDir $item.Source
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $appDir $item.Dest) -Recurse -Force
        }
    }

    $nodeModules = Join-Path $ZCodeDir 'node_modules'
    if (-not (Test-Path -LiteralPath $nodeModules)) {
        throw 'node_modules missing. Run without -SkipNpmInstall or npm install first.'
    }
    Copy-Item -LiteralPath $nodeModules -Destination (Join-Path $appDir 'node_modules') -Recurse -Force

    Write-Host '==> Install launchers'
    Copy-Item -LiteralPath (Join-Path $PackagingRoot 'templates\zcode.cmd') -Destination (Join-Path $binDir 'zcode.cmd') -Force
    Copy-Item -LiteralPath (Join-Path $PackagingRoot 'templates\zcode.ps1') -Destination (Join-Path $binDir 'zcode.ps1') -Force

    Set-Content -LiteralPath (Join-Path $artifactDir 'VERSION') -Value $Version -Encoding ASCII

    $licenseSrc = Join-Path $RepoRoot 'LICENSE'
    if (Test-Path -LiteralPath $licenseSrc) {
        Copy-Item -LiteralPath $licenseSrc -Destination (Join-Path $artifactDir 'LICENSE') -Force
    }

    $readmePortable = @"
ZCode CLI Agent — Windows portable package ($Version)

Requirements:
  - Node.js 22 or newer (https://nodejs.org/)
  - Windows 10/11

Quick start (portable, no PATH change):
  bin\zcode.cmd --help
  bin\zcode.cmd doctor --json

Install to user profile (adds PATH):
  powershell -ExecutionPolicy Bypass -File install.ps1 -SourcePath .

Full REPL (development): requires Bun — see docs/guides/local-development.md
"@
    Set-Content -LiteralPath (Join-Path $artifactDir 'README-PORTABLE.txt') -Value $readmePortable.TrimEnd() -Encoding utf8

    Copy-Item -LiteralPath (Join-Path $PackagingRoot 'install.ps1') -Destination (Join-Path $artifactDir 'install.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PackagingRoot 'uninstall.ps1') -Destination (Join-Path $artifactDir 'uninstall.ps1') -Force

    Write-Host '==> Smoke test (bin\zcode.cmd --help)'
    Push-Location $artifactDir
    try {
        $helpOut = & (Join-Path $binDir 'zcode.cmd') --help 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            throw "Smoke test failed: zcode.cmd --help exited $LASTEXITCODE`n$helpOut"
        }
        if ($helpOut -notlike '*ZCode*') {
            throw "Smoke test failed: unexpected --help output`n$helpOut"
        }
    } finally {
        Pop-Location
    }

    $zipPath = Join-Path $OutputDir "$artifactBase.zip"
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    Write-Host "==> Create archive: $zipPath"
    Compress-Archive -LiteralPath $artifactDir -DestinationPath $zipPath -CompressionLevel Optimal -Force

    $sizeMb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
    Write-Host ''
    Write-Host "Done: $zipPath ($sizeMb MB)"
    Write-Host "Install: Expand-Archive then run install.ps1, or:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File packaging\windows\install.ps1 -ZipPath `"$zipPath`""
} finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
