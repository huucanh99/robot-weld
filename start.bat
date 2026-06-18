@echo off
echo Starting Robot Arm System...

start "Backend" cmd /k "cd /d %~dp0backend && node server.js"

start "Frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --host"

echo.
echo Services starting in separate windows.
echo   Backend  : http://localhost:3000
echo   Frontend : http://localhost:5173
echo.
pause
