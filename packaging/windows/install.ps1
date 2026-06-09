#Requires -Version 5.1
<#
.SYNOPSIS
  Install ZCode to %LOCALAPPDATA%\ZCode and add bin to the user PATH.

.PARAMETER ZipPath
  Path to zcode-*-win-x64-portable.zip from build-portable.ps1 or GitHub Release.

.PARAMETER SourcePath
  Path to an already-extracted portable folder (contains app/ and bin/).

.PARAMETER InstallDir
  Override install directory (default: %LOCALAPPDATA%\ZCode).

.EXAMPLE
  .\install.ps1 -ZipPath .\dist\zcode-0.1.0-win-x64-portable.zip

.EXAMPLE
  # From inside extracted portable folder:
  .\install.ps1 -SourcePath .
#>
param(
    [string] $ZipPath = '',
    [string] $SourcePath = '',
    [string] $InstallDir = ''
)

$ErrorActionPreference = 'Stop'

function Test-NodeReady {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw 'Node.js not found. Install Node.js 22+ from https://nodejs.org/ then re-run install.'
    }
    $ver = & node -p 'process.versions.node' 2>$null
    if ($ver) {
        $major = [int]($ver -split '\.')[0]
        if ($major -lt 22) {
            throw "Node.js 22+ required (found v$ver)."
        }
    }
}

function Add-UserPathEntry {
    param([string] $Directory)
    $resolved = [System.IO.Path]::GetFullPath($Directory)
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) {
        $userPath = ''
    }
    $parts = $userPath -split ';' | Where-Object { $_ -and $_.Trim() -ne '' }
    $exists = $parts | Where-Object {
        try {
            [System.IO.Path]::GetFullPath($_).ToLowerInvariant() -eq $resolved.ToLowerInvariant()
        } catch {
            $false
        }
    }
    if ($exists) {
        Write-Host "PATH already contains: $resolved"
        return
    }
    $newPath = if ($userPath.Trim()) { "$resolved;$userPath" } else { $resolved }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = "$resolved;$env:Path"
    Write-Host "Added to user PATH: $resolved"
    Write-Host 'Restart the terminal (or log off/on) if zcode is not found immediately.'
}

function Resolve-PortableRoot {
    param([string] $Path)
    $full = (Resolve-Path -LiteralPath $Path).Path
    if (Test-Path -LiteralPath (Join-Path $full 'app\src\entrypoints\publicCli.js')) {
        return $full
    }
    $children = Get-ChildItem -LiteralPath $full -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'app\src\entrypoints\publicCli.js') }
    if ($children.Count -eq 1) {
        return $children[0].FullName
    }
    throw "Could not find portable layout (app/ + bin/) under: $Path"
}

Test-NodeReady

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA 'ZCode'
}

$stagingExtract = $null
try {
    if ($ZipPath) {
        if (-not (Test-Path -LiteralPath $ZipPath)) {
            throw "ZIP not found: $ZipPath"
        }
        $stagingExtract = Join-Path $env:TEMP "zcode-install-$([Guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Force -Path $stagingExtract | Out-Null
        Write-Host "==> Extract: $ZipPath"
        Expand-Archive -LiteralPath $ZipPath -DestinationPath $stagingExtract -Force
        $SourcePath = $stagingExtract
    }

    if (-not $SourcePath) {
        throw 'Specify -ZipPath or -SourcePath.'
    }

    $portableRoot = Resolve-PortableRoot -Path $SourcePath
    Write-Host "==> Install to: $InstallDir"

    if (Test-Path -LiteralPath $InstallDir) {
        Write-Host '==> Remove previous installation'
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    Copy-Item -LiteralPath (Join-Path $portableRoot 'app') -Destination (Join-Path $InstallDir 'app') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $portableRoot 'bin') -Destination (Join-Path $InstallDir 'bin') -Recurse -Force

    foreach ($extra in @('VERSION', 'LICENSE', 'README-PORTABLE.txt')) {
        $src = Join-Path $portableRoot $extra
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $InstallDir $extra) -Force
        }
    }

    Add-UserPathEntry -Directory (Join-Path $InstallDir 'bin')

    Write-Host '==> Verify: zcode --version'
    $zcodeCmd = Join-Path $InstallDir 'bin\zcode.cmd'
    & $zcodeCmd --version | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Verification failed: zcode --version exited $LASTEXITCODE"
    }

    Write-Host ''
    Write-Host 'ZCode installed successfully.'
    Write-Host "  Location: $InstallDir"
    Write-Host '  Command:  zcode --help'
    Write-Host '  Version:  zcode --version'
} finally {
    if ($stagingExtract -and (Test-Path -LiteralPath $stagingExtract)) {
        Remove-Item -LiteralPath $stagingExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
}
