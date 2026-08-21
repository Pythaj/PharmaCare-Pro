@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title PharmaCare Pro - Auto-Restart Service
color 0A

set RESTART_COUNT=0

cls
echo.
echo   ╔══════════════════════════════════════════════════════════════╗
echo   ║              PharmaCare Pro  v2.0                           ║
echo   ║      Premium Pharmacy Management System                     ║
echo   ║                                                            ║
echo   ║          Auto-Restart Mode Active                           ║
echo   ║   Press Q in this window to quit gracefully                 ║
echo   ╚══════════════════════════════════════════════════════════════╝
echo.

:main_loop

if %RESTART_COUNT% gtr 0 (
    echo [%time%] Restart #%RESTART_COUNT% - re-launching services...
) else (
    echo [%time%] Initial startup...
)

call :cleanup

:: ── Start Node.js server ──
echo [%time%] Starting Next.js server...

del /f .server.pid 2>nul
set NODE_PID=
for /f "delims=" %%p in ('powershell -NoProfile -Command "& { $p = Start-Process -FilePath 'node' -ArgumentList '.next/standalone/server.js' -WindowStyle Hidden -PassThru; if ($p) { Write-Output $p.Id } }"') do set NODE_PID=%%p

if not defined NODE_PID (
    echo [%time%] FAILED to start Node.js. Retrying in 2 seconds...
    timeout /t 2 /nobreak >nul
    set /a RESTART_COUNT+=1
    goto main_loop
)
echo [%time%] Node.js server started (PID: %NODE_PID%)
echo %NODE_PID% > .server.pid

:: ── Wait for port 3000 ──
echo [%time%] Waiting for port 3000...
:wait_server
timeout /t 1 /nobreak >nul
tasklist /FI "PID eq %NODE_PID%" 2>nul | findstr /I "%NODE_PID%" >nul 2>nul
if errorlevel 1 (
    echo [%time%] Node.js died during startup - restarting...
    set /a RESTART_COUNT+=1
    goto main_loop
)
netstat -ano 2>nul | findstr ":3000 " | findstr LISTENING >nul 2>nul
if errorlevel 1 goto wait_server

:: ── HTTP health check ──
echo [%time%] Verifying HTTP response...
powershell -NoProfile -Command "& { try { $r = Invoke-WebRequest 'http://localhost:3000' -UseBasicParsing -TimeoutSec 10; exit 0 } catch { exit 1 } }"
if errorlevel 1 (
    echo [%time%] Server not responding - retrying...
    timeout /t 2 /nobreak >nul
    goto wait_server
)
echo [%time%] Server ready on port 3000


:: ── Display status ──
cls
echo.
echo   ╔══════════════════════════════════════════════════════════════╗
echo   ║              PharmaCare Pro  v2.0                           ║
echo   ║      Premium Pharmacy Management System                     ║
echo   ╚══════════════════════════════════════════════════════════════╝
echo.
echo   Status:  Server running on http://localhost:3000
echo.
echo   Monitoring every 5 seconds...  Press Q to quit.
echo.

:: ── Monitor loop ──
:monitor_loop
choice /c QX /n /t 5 /d X >nul 2>nul
:: errorlevel 2 = timeout/X | errorlevel 1 = Q
if not errorlevel 2 goto shutdown

:: Check process
tasklist /FI "PID eq %NODE_PID%" 2>nul | findstr /I "%NODE_PID%" >nul 2>nul
if errorlevel 1 (
    echo [%time%] Node.js died - restarting...
    set /a RESTART_COUNT+=1
    goto restart_services
)
netstat -ano 2>nul | findstr ":3000 " | findstr LISTENING >nul 2>nul
if errorlevel 1 (
    echo [%time%] Port 3000 closed - restarting...
    set /a RESTART_COUNT+=1
    goto restart_services
)
goto monitor_loop

:restart_services
echo [%time%] Cleaning up and restarting...
call :cleanup
timeout /t 1 /nobreak >nul
cls
goto main_loop

:shutdown
echo.
echo [%time%] Shutting down services...
call :cleanup
del /f .server.pid 2>nul
echo [%time%] All services stopped. Goodbye!
timeout /t 3 /nobreak >nul
exit /b 0

:cleanup
if exist .server.pid (
    set /p OLD_PID=<.server.pid
    if defined OLD_PID taskkill /F /PID !OLD_PID! >nul 2>nul
    del /f .server.pid 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 "') do taskkill /F /PID %%a >nul 2>nul
exit /b 0
