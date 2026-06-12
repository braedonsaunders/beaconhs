@echo off
setlocal

cd /d "%~dp0..\.."
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-launcher.ps1"
set "BEACONHS_LAUNCHER_EXIT=%ERRORLEVEL%"

echo.
if not "%BEACONHS_NO_PAUSE%"=="1" pause
exit /b %BEACONHS_LAUNCHER_EXIT%
