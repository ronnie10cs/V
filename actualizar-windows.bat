@echo off
chcp 65001 >nul
title Actualizar V
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 iniciar.py actualizar
) else (
  python iniciar.py actualizar
)
echo.
echo Cierra esta ventana y abre V con iniciar-windows.bat
pause
