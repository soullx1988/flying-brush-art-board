@echo off
setlocal EnableExtensions
chcp 65001 >nul

if /I "%~1"=="--help" goto :help
if /I "%~2"=="--run-from-temp" goto :run_from_temp

set "TEMP_UPDATE_BAT=%TEMP%\InfiniteBoard-update-%RANDOM%-%RANDOM%.bat"
copy /Y "%~f0" "%TEMP_UPDATE_BAT%" >nul
if errorlevel 1 (
  echo ERROR: Could not create a temporary copy of the update script.
  endlocal & exit /b 1
)
call "%TEMP_UPDATE_BAT%" "%~1" --run-from-temp "%~dp0"
set "WRAPPER_EXIT=%ERRORLEVEL%"
del /Q "%TEMP_UPDATE_BAT%" >nul 2>&1
endlocal & exit /b %WRAPPER_EXIT%

:run_from_temp
cd /d "%~3"
if errorlevel 1 (
  echo ERROR: Project directory is unavailable: %~3
  endlocal & exit /b 1
)

set "DEPLOY_BRANCH=%~1"
if not defined DEPLOY_BRANCH for /f "delims=" %%B in ('git branch --show-current') do set "DEPLOY_BRANCH=%%B"
if not defined DEPLOY_BRANCH (
  echo ERROR: Detached HEAD. Pass an explicit deployment branch.
  endlocal & exit /b 1
)
set "EXIT_CODE=0"

echo ============================================================
echo Infinite Board - update and restart public machine
echo Branch: %DEPLOY_BRANCH%
echo Project: %CD%
echo ============================================================

call :require_command git.exe
if errorlevel 1 goto :failed
call :require_command node.exe
if errorlevel 1 goto :failed
call :require_command pnpm.cmd
if errorlevel 1 goto :failed
call :require_command curl.exe
if errorlevel 1 goto :failed

if not exist ".env.local" (
  echo ERROR: .env.local was not found. Refusing to update a public machine without deployment configuration.
  goto :failed
)

if not defined INFINITE_BOARD_DATA_DIR call :read_env INFINITE_BOARD_DATA_DIR
if not defined MCP_ENABLED call :read_env MCP_ENABLED
if not defined MCP_PUBLIC_URL call :read_env MCP_PUBLIC_URL
if not defined MCP_ALLOWED_HOSTS call :read_env MCP_ALLOWED_HOSTS
if not defined MCP_ALLOWED_ORIGINS call :read_env MCP_ALLOWED_ORIGINS
if defined MCP_PUBLIC_URL if "%MCP_PUBLIC_URL:~-1%"=="/" set "MCP_PUBLIC_URL=%MCP_PUBLIC_URL:~0,-1%"

if not defined INFINITE_BOARD_DATA_DIR (
  echo ERROR: INFINITE_BOARD_DATA_DIR is not configured in the environment or .env.local.
  echo The script will not guess the public machine data directory.
  goto :failed
)

echo Data directory: %INFINITE_BOARD_DATA_DIR%
if /I "%MCP_ENABLED%"=="true" (
  if not defined MCP_PUBLIC_URL (
    echo ERROR: MCP_ENABLED=true requires MCP_PUBLIC_URL.
    goto :failed
  )
  if not defined MCP_ALLOWED_HOSTS (
    echo ERROR: MCP_ENABLED=true requires MCP_ALLOWED_HOSTS.
    goto :failed
  )
  if not defined MCP_ALLOWED_ORIGINS (
    echo ERROR: MCP_ENABLED=true requires MCP_ALLOWED_ORIGINS.
    goto :failed
  )
  echo MCP: enabled; restarting the API will restart MCP.
) else (
  echo WARNING: MCP_ENABLED is not true. The Web/API services will restart, but MCP will remain disabled.
)

git diff --quiet --ignore-submodules --
if errorlevel 1 (
  echo ERROR: Tracked files have local modifications. Commit or remove them before updating.
  git status --short
  goto :failed
)
git diff --cached --quiet --ignore-submodules --
if errorlevel 1 (
  echo ERROR: The repository contains staged changes. Commit or unstage them before updating.
  git status --short
  goto :failed
)

echo.
echo [1/7] Fetching repository updates...
git fetch origin
if errorlevel 1 goto :failed

echo [2/7] Switching to %DEPLOY_BRANCH% and fast-forwarding...
git checkout "%DEPLOY_BRANCH%"
if errorlevel 1 goto :failed
git pull --ff-only origin "%DEPLOY_BRANCH%"
if errorlevel 1 goto :failed

echo [3/7] Installing locked dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 goto :failed

echo [4/7] Building the application while the current service remains online...
call pnpm build
if errorlevel 1 goto :failed

echo [5/7] Creating a consistent application backup...
set "INFINITE_BOARD_BACKUP_DATA_DIRECTORY=%INFINITE_BOARD_DATA_DIR%"
set "INFINITE_BOARD_BACKUP_ROOT_DIRECTORY=%INFINITE_BOARD_DATA_DIR%\backups"
call pnpm exec tsx scripts/backup-cli.ts backup
if errorlevel 1 (
  echo ERROR: Backup failed. The running service has not been stopped.
  goto :failed
)

echo [6/7] Stopping the start-dev API and Web windows...
call :stop_window "Infinite Board API"
call :stop_window "Infinite Board Web"
call :stop_node_on_port 8787
call :stop_node_on_port 4173
call :wait_port_closed 8787 "API"
if errorlevel 1 goto :unknown_service
call :wait_port_closed 4173 "Web"
if errorlevel 1 goto :unknown_service

echo [7/7] Starting the updated API, Web app, and MCP routes...
set "INFINITE_BOARD_NO_BROWSER=1"
call "%CD%\start-dev.bat"
if errorlevel 1 goto :restart_failed

curl.exe --fail --silent --show-error "http://127.0.0.1:8787/health" >nul
if errorlevel 1 (
  echo ERROR: Local API health check failed.
  goto :restart_failed
)
curl.exe --fail --silent --show-error "http://127.0.0.1:4173/" >nul
if errorlevel 1 (
  echo ERROR: Local Web health check failed.
  goto :restart_failed
)

if /I "%MCP_ENABLED%"=="true" (
  curl.exe --fail --silent --show-error "%MCP_PUBLIC_URL%/.well-known/oauth-protected-resource/mcp" >nul
  if errorlevel 1 (
    echo ERROR: MCP discovery health check failed at %MCP_PUBLIC_URL%.
    goto :restart_failed
  )
)

echo.
echo SUCCESS: Code updated and services restarted.
git log -1 --oneline
echo API health: http://127.0.0.1:8787/health
echo Web:        http://127.0.0.1:4173/
if /I "%MCP_ENABLED%"=="true" echo MCP:        %MCP_PUBLIC_URL%/mcp
goto :done

:unknown_service
echo.
echo ERROR: Port 4173 or 8787 is still occupied after closing the start-dev windows.
echo This machine may use NSSM, WinSW, a Windows service, a scheduled task, or Caddy.
echo Stop that deployment using its original service manager, then run this BAT again.
netstat -ano -p tcp | findstr /R /C:":4173 .*LISTENING" /C:":8787 .*LISTENING"
goto :failed

:restart_failed
echo.
echo ERROR: The updated service did not pass startup validation.
echo Review the "Infinite Board API" and "Infinite Board Web" windows. The backup is under:
echo %INFINITE_BOARD_BACKUP_ROOT_DIRECTORY%
goto :failed

:require_command
where %~1 >nul 2>&1
if errorlevel 1 (
  echo ERROR: Required command not found: %~1
  exit /b 1
)
exit /b 0

:read_env
for /f "tokens=1,* delims==" %%A in ('findstr /B /I /C:"%~1=" ".env.local"') do set "%~1=%%B"
exit /b 0

:stop_window
taskkill /FI "WINDOWTITLE eq %~1*" /T /F >nul 2>&1
exit /b 0

:stop_node_on_port
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%~1 .*LISTENING"') do (
  tasklist /FI "PID eq %%P" /FO CSV /NH | findstr /I /C:"node.exe" >nul
  if not errorlevel 1 taskkill /PID %%P /T /F >nul 2>&1
)
exit /b 0

:is_listening
netstat -ano -p tcp | findstr /R /C:":%~1 .*LISTENING" >nul
exit /b %errorlevel%

:wait_port_closed
set "WAIT_PORT=%~1"
set "WAIT_NAME=%~2"
for /L %%I in (1,1,20) do (
  call :is_listening %WAIT_PORT%
  if errorlevel 1 (
    echo %WAIT_NAME% port %WAIT_PORT% is closed.
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)
echo ERROR: %WAIT_NAME% port %WAIT_PORT% did not close within 20 seconds.
exit /b 1

:help
echo Usage: update-public-machine.bat [branch]
echo.
echo Default branch: current checked-out branch
echo Example: update-public-machine.bat master
echo.
echo This script is for the public-machine deployment started by start-dev.bat.
echo It pulls code, installs locked dependencies, builds, backs up data, restarts
echo ports 4173/8787 through the named start-dev windows, and validates API/Web/MCP.
exit /b 0

:failed
set "EXIT_CODE=1"
echo.
echo UPDATE FAILED. Existing services were left running unless step 6 had already begun.
goto :done

:done
echo.
if /I not "%INFINITE_BOARD_NO_PAUSE%"=="1" pause
endlocal & exit /b %EXIT_CODE%
