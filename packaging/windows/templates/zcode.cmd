@echo off
setlocal EnableExtensions
set "ZCODE_ROOT=%~dp0.."
set "ZCODE_APP=%ZCODE_ROOT%\app"
set "ZCODE_ENTRY=%ZCODE_APP%\src\entrypoints\publicCli.js"

if not exist "%ZCODE_ENTRY%" (
  echo [ZCode] Missing entrypoint: %ZCODE_ENTRY%
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ZCode] Node.js not found. Install Node.js 22 or newer: https://nodejs.org/
  exit /b 1
)

for /f "tokens=1 delims=." %%a in ('node -p "process.versions.node" 2^>nul') do set NODE_MAJOR=%%a
if defined NODE_MAJOR if %NODE_MAJOR% LSS 22 (
  echo [ZCode] Node.js 22+ required. Current: v%NODE_MAJOR%.x
  echo Install from: https://nodejs.org/
  exit /b 1
)

node "%ZCODE_ENTRY%" %*
exit /b %ERRORLEVEL%
