@echo off
setlocal
if exist "E:\Label Studio\data\run-local-config.bat" (
  call "E:\Label Studio\data\run-local-config.bat"
) else if exist "%~dp0run-local-config.bat" call "%~dp0run-local-config.bat"
if not defined LS_PORT set "LS_PORT=8082"
set "LS_CACHE_RESET_URL=http://localhost:%LS_PORT%/clear-cache/?v=%RANDOM%%RANDOM%"
rem Verify the reset page before opening the user's default browser.
powershell.exe -NoLogo -NoProfile -NonInteractive -Command "try { $response = Invoke-WebRequest -Uri $env:LS_CACHE_RESET_URL -UseBasicParsing -TimeoutSec 10; if ($response.Headers['Clear-Site-Data'] -ne '\"cache\"') { exit 1 }; exit 0 } catch { exit 1 }"
if errorlevel 1 goto unavailable
echo Opening the Label Studio browser cache reset.
echo Cached files and service workers will be cleared; projects and login data are preserved.
echo Use your usual Label Studio browser if it differs from the default: 
echo %LS_CACHE_RESET_URL%
if /i "%~1"=="--check" exit /b 0
start "" "%LS_CACHE_RESET_URL%"
exit /b %errorlevel%
:unavailable
echo Label Studio's cache reset page is unavailable on port %LS_PORT%.
echo Start run-fork.bat or run-with-sam2.bat first, then run this file again.
if /i not "%~1"=="--check" pause
exit /b 1
