@echo off
title Chrome Worker 2 Login
echo Launching Chrome Worker #2 for Google Flow...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%USERPROFILE%\.turboflow-chrome-profile-2" --new-window --start-maximized "https://flow.google.com/"
exit
