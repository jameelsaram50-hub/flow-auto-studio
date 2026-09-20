@echo off
title Chrome Worker 7 Login
echo Launching Chrome Worker #7 for Google Flow...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%USERPROFILE%\.turboflow-chrome-profile-7" --new-window --start-maximized "https://flow.google.com/"
exit
