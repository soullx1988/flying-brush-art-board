@echo off
setlocal
cd /d "%~dp0"

if not defined INFINITE_BOARD_DATA_DIR set "INFINITE_BOARD_DATA_DIR=%CD%\.infinite-board-data"
echo Development data directory: %INFINITE_BOARD_DATA_DIR%

echo Building workspace packages...
call pnpm -r --filter "./packages/**" --workspace-concurrency=1 --if-present build
if errorlevel 1 (
  echo ERROR: Workspace package build failed. The development servers were not started.
  exit /b 1
)

call :is_listening 8787
if errorlevel 1 (
  echo Starting local API on http://127.0.0.1:8787
  start "Infinite Board API" /D "%CD%" cmd /k "set \"INFINITE_BOARD_DATA_DIR=%INFINITE_BOARD_DATA_DIR%\"&& pnpm --filter @infinite-board/local-api dev"
) else (
  echo Local API is already running on port 8787.
)

call :wait_port 8787 "Local API"
if errorlevel 1 goto :startup_failed

call :is_listening 4173
if errorlevel 1 (
  echo Starting web app on http://0.0.0.0:4173 ^(LAN access enabled^)
  start "Infinite Board Web" /D "%CD%" cmd /k "pnpm --filter @infinite-board/web dev"
) else (
  echo Web app is already running on port 4173.
)

call :wait_port 4173 "Web app"
if errorlevel 1 goto :startup_failed

start "" http://127.0.0.1:4173/
exit /b 0

:is_listening
netstat -ano -p tcp | findstr /R /C:":%~1 .*LISTENING" >nul
exit /b %errorlevel%

:wait_port
set "port=%~1"
set "service_name=%~2"
for /L %%I in (1,1,60) do (
  call :is_listening %port%
  if not errorlevel 1 (
    echo %service_name% is ready on port %port%.
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)
echo ERROR: %service_name% did not start on port %port% within 60 seconds.
exit /b 1

:startup_failed
echo Startup failed. Check the Infinite Board API and Web windows for details.
exit /b 1
