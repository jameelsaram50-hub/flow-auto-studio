@echo off
title Easy AI Hub Image Studio
cd /d "%~dp0"

echo ===================================================
echo   Starting Easy AI Hub Image Studio
echo ===================================================

:: Kill any lingering ghost instances to free the single-instance lock
echo Clearing any stuck processes...
taskkill /F /IM FlowAutoStudio.exe /T >nul 2>&1
taskkill /F /IM electron.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul

if exist "%~dp0FlowAutoStudio-win32-x64\FlowAutoStudio.exe" (
  node "%~dp0scripts\sync_packaged.js" >nul 2>&1
  cd /d "%~dp0FlowAutoStudio-win32-x64"
  start "" "FlowAutoStudio.exe"
  exit /b 0
)

call npx electron .
