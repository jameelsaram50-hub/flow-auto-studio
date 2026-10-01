@echo off
title Chrome Worker 3 (Easy AI Hub)
echo ==========================================================
echo   Opening Chrome Worker #3 (Easy AI Hub)
echo ==========================================================

rem 1. If Easy AI Hub app is running, tell backend to bring Worker #3 to front.
rem    This keeps it fully connected in the application backend while opening normally on desktop!
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -Method Post 'http://127.0.0.1:3001/api/focus-chrome?workerId=3' -TimeoutSec 4; if ($r.success) { exit 0 } } catch {}; exit 1"
if %errorlevel%==0 (
  echo [Success] Worker #3 Chrome is open on your desktop and connected in the app!
  ping -n 2 127.0.0.1 >nul
  exit /b 0
)

rem 2. If app is not running, launch standalone Chrome directly with Worker #3 profile
echo Easy AI Hub backend is not currently running on port 3001.
echo Launching standalone Chrome for Worker #3...
if exist "%USERPROFILE%\.easyaihub-chrome-profile-3\SingletonLock" del /f /q "%USERPROFILE%\.easyaihub-chrome-profile-3\SingletonLock" 2>nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%USERPROFILE%\.easyaihub-chrome-profile-3" --profile-directory=Default --new-window --start-maximized --no-first-run --no-default-browser-check "https://chatgpt.com/" "https://flow.google.com/"
exit /b 0
