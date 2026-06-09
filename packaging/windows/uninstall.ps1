#Requires -Version 5.1
<#
.SYNOPSIS
  Remove ZCode from %LOCALAPPDATA%\ZCode and drop its bin directory from user PATH.

.PARAMETER InstallDir
  Install directory (default: %LOCALAPPDATA%\ZCode).
#>
param(
    [string] $InstallDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA 'ZCode'
}

$binDir = Join-Path $InstallDir 'bin'
$resolvedBin = ''
if (Test-Path -LiteralPath $binDir) {
    $resolvedBin = [System.IO.Path]::GetFullPath($binDir).ToLowerInvariant()
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -and $resolvedBin) {
    $parts = $userPath -split ';' | Where-Object {
        $p = $_.Trim()
        if (-not $p) { return $false }
        try {
            [System.IO.Path]::GetFullPath($p).ToLowerInvariant() -ne $resolvedBin
        } catch {
            $true
        }
    }
    $newPath = ($parts -join ';').Trim(';')
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "Removed from user PATH: $binDir"
}

if (Test-Path -LiteralPath $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
    Write-Host "Removed: $InstallDir"
} else {
    Write-Host "Nothing to remove at: $InstallDir"
}

Write-Host 'ZCode uninstalled. Restart your terminal to refresh PATH.'
