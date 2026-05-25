@echo off
setlocal
set "RUNTIME_DIR=%~dp0.."

if exist "%RUNTIME_DIR%\python\python.exe" (
  "%RUNTIME_DIR%\python\python.exe" %*
  exit /b %ERRORLEVEL%
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3 %*
  exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if not errorlevel 1 (
  python %*
  exit /b %ERRORLEVEL%
)

echo Bundled Python runtime is missing. Expected "%RUNTIME_DIR%\python\python.exe".
exit /b 9009
