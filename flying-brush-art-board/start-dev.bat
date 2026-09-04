@echo off
setlocal
cd /d "%~dp0"

rem Keep one lifecycle implementation so port checks, data-directory choice,
rem clean-clone builds, health probes and failure cleanup cannot drift apart.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
exit /b %ERRORLEVEL%
