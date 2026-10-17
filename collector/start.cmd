@echo off
cd /d "%~dp0"
if exist node.exe (
  node.exe server.mjs
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Please install Node.js 22 or later, then run start.cmd again.
    pause
    exit /b 1
  )
  node server.mjs
)
pause
