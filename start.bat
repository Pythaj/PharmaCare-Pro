@echo off
title PharmaCare Pro - Pharmacy Management System
color 0A

echo ======================================================
echo    PharmaCare Pro - Pharmacy Management System
echo    Starting development server on port 8000...
echo ======================================================
echo.

cd /d "%~dp0"

REM Check if Node.js is installed
where node >nul 2>nul
if errorlevel 1 (
    color 0C
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules" (
    color 0E
    echo [INFO] Dependencies not found. Installing...
    echo.
    call npm install
    if errorlevel 1 (
        color 0C
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

REM Check if the port is already in use
netstat -an | findstr ":8000 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    color 0E
    echo [WARNING] Port 8000 is already in use.
    echo           Is the app already running? Opening browser...
    echo.
    start "" "http://localhost:8000"
    pause
    exit /b 0
)

color 0A
echo [OK] Launching PharmaCare Pro on http://localhost:8000
echo [OK] Press Ctrl+C in this window to stop the server.
echo.
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000"

call npm run dev

echo.
color 0C
echo [STOPPED] The server has stopped.
pause
