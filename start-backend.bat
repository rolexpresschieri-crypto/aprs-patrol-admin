@echo off
title APRS Patrol Admin
cd /d "%~dp0"

echo.
echo  APRS Patrol Admin (Next.js)
echo  -----------------------------
echo  Cartella: %CD%
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo ERRORE: npm non trovato. Installa Node.js da https://nodejs.org e riprova.
  pause
  exit /b 1
)

echo Libero la porta 3000 se occupata da un vecchio "next dev"...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000"') do (
  echo   Chiudo PID %%a sulla porta 3000
  taskkill /F /PID %%a >nul 2>&1
)

echo Chiudo eventuali altri Node.js ancora agganciati a questa cartella progetto...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-project-node.ps1"

echo Attendo il rilascio dei file da parte di Windows...
timeout /t 2 /nobreak >nul

echo Pulisco solo cache legacy ^(su Windows: la cache attiva e' la cartella next-cache nel progetto^)...
node "%~dp0scripts\clear-next-cache.cjs"
if exist ".next" (
  echo Tentativo aggiuntivo rmdir su .next in repo...
  rmdir /s /q ".next" 2>nul
)
if exist ".next" (
  echo AVVISO: .next nella repo ancora presente ^(bloccata^) - ignorabile: Next usa la cartella next-cache
  timeout /t 2 /nobreak >nul
)

echo.
echo  Browser:  http://localhost:3000
echo  Dev: Webpack (evita bug Turbopack / global-error su Windows)
echo  NON avviare due volte questo script: una sola finestra = un solo server.
echo  Arresto:  Ctrl+C
echo.

call npm run dev

echo.
echo -------------------------------------------
echo Il server e' stato chiuso.
echo Se hai visto "Another next dev server", chiudi l'altra finestra nera o rilancia questo .bat.
echo -------------------------------------------
pause
