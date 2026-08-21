@echo off
setlocal enabledelayedexpansion
title PharmaCare Pro - Stopping Services
cd /d "%~dp0"
color 0C
cls
echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║                                                      ║
echo   ║              Stopping All Services...                 ║
echo   ║                                                      ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:: Kill Next.js by PID file
if exist .server.pid (
    set /p NODE_PID=<.server.pid
    if defined NODE_PID taskkill /F /PID !NODE_PID! >nul 2>nul
    del .server.pid 2>nul
)

:: Kill any process on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do (
    taskkill /F /PID %%a >nul 2>nul
)

:: Kill any remaining node.exe instances from this project
taskkill /F /IM node.exe >nul 2>nul

echo   ✓ All services stopped successfully.
echo.
ping -n 4 127.0.0.1 >nul
