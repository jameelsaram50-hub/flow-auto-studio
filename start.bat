@echo off
title Flow Auto Studio
cd /d "%~dp0"

echo ===================================================
echo   Starting Flow Auto Studio Desktop App
echo ===================================================

if exist "%~dp0FlowAutoStudio-win32-x64\FlowAutoStudio.exe" (
  cd /d "%~dp0FlowAutoStudio-win32-x64"
  start "" "FlowAutoStudio.exe"
  exit /b 0
)

call npx electron .
