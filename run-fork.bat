@echo off
setlocal
cd /d "%~dp0"
set "DEBUG=false"
if exist "E:\Label Studio\data\run-local-config.bat" (
  call "E:\Label Studio\data\run-local-config.bat"
) else if exist "%~dp0run-local-config.bat" call "%~dp0run-local-config.bat"
if not defined LS_PORT set "LS_PORT=8082"
if not defined LS_DATA_DIR set "LS_DATA_DIR=E:\Label Studio\data"
if not exist ".venv\Scripts\python.exe" (
  echo Missing .venv. Follow WINDOWS_RUN.md first.
  pause
  exit /b 1
)
if not exist "web\dist\apps\labelstudio\index.html" (
  echo Missing frontend build. Follow WINDOWS_RUN.md first.
  pause
  exit /b 1
)
rem Keep Django's collected manifest aligned with the current frontend build.
if exist "web\dist\apps\labelstudio\static\js\manifest.json" (
  if not exist "label_studio\core\static_build\js" mkdir "label_studio\core\static_build\js"
  copy /y "web\dist\apps\labelstudio\static\js\manifest.json" "label_studio\core\static_build\js\manifest.json" >nul
  if errorlevel 1 (
    echo Failed to refresh the frontend asset manifest.
    exit /b 1
  )
)
if exist "label_studio\core\static\js\sw.js" (
  copy /y "label_studio\core\static\js\sw.js" "label_studio\core\static_build\js\sw.js" >nul
  if errorlevel 1 (
    echo Failed to refresh the frontend service worker.
    exit /b 1
  )
)
set "LABEL_STUDIO_BASE_DATA_DIR=%LS_DATA_DIR%"
echo Starting this fork at http://localhost:%LS_PORT%
echo Data directory: "%LS_DATA_DIR%"
"%~dp0.venv\Scripts\python.exe" -m label_studio.server start --internal-host 127.0.0.1 --port %LS_PORT% --data-dir "%LS_DATA_DIR%"
if errorlevel 1 pause
