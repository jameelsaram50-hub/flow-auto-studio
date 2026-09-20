@echo off
title Chrome Worker 5 Login
echo Launching Chrome Worker #5 for Google Flow...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%USERPROFILE%\.turboflow-chrome-profile-5" --new-window --start-maximized "https://flow.google.com/"
exit
