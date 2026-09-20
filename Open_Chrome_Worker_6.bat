@echo off
title Chrome Worker 6 Login
echo Launching Chrome Worker #6 for Google Flow...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%USERPROFILE%\.turboflow-chrome-profile-6" --new-window --start-maximized "https://flow.google.com/"
exit
