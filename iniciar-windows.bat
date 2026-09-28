@echo off
chcp 65001 >nul
title V
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 iniciar.py %*
) else (
  python iniciar.py %*
)
if errorlevel 1 (
  echo.
  echo Si V no arranco porque falta Python, instalalo desde https://www.python.org/downloads/
  echo y marca la casilla "Add python.exe to PATH" durante la instalacion.
)
pause
