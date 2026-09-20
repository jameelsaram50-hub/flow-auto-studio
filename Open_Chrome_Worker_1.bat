@echo off
title Chrome Worker 1 Login
echo Launching Chrome Worker #1 for Google Flow...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%USERPROFILE%\.turboflow-chrome-profile" --new-window --start-maximized "https://flow.google.com/"
exit
