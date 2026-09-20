@echo off
title Chrome Worker 4 Login
echo Launching Chrome Worker #4 for Google Flow...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%USERPROFILE%\.turboflow-chrome-profile-4" --new-window --start-maximized "https://flow.google.com/"
exit
