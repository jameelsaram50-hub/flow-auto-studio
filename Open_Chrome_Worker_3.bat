@echo off
title Chrome Worker 3 Login
echo Launching Chrome Worker #3 for Google Flow...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%USERPROFILE%\.turboflow-chrome-profile-3" --new-window --start-maximized "https://flow.google.com/"
exit
