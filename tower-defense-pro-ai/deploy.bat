@echo off

cd /d "C:\Users\mark\tower-defense-pro-ai\tower-defense-pro-ai"

echo =========================
echo Building project...
echo =========================
call npm run build

echo Build finished with exit code: %ERRORLEVEL%
if %ERRORLEVEL% NEQ 0 (
    echo Build failed. Aborting deploy.
    pause
    exit /b %ERRORLEVEL%
)

set SOURCE=dist
set DEST=C:\inetpub\wwwroot\tower-defense

echo =========================
echo Stopping IIS...
echo =========================
iisreset /stop

echo =========================
echo Cleaning destination...
echo =========================
if exist "%DEST%" (
    rmdir /S /Q "%DEST%"
)

mkdir "%DEST%"

echo =========================
echo Copying files...
echo =========================
robocopy "%SOURCE%" "%DEST%" /E

echo Robocopy exit code: %ERRORLEVEL%

if %ERRORLEVEL% GEQ 8 (
    echo Robocopy failed!
    echo Starting IIS back...
    iisreset /start
    pause
    exit /b %ERRORLEVEL%
)

echo =========================
echo Starting IIS...
echo =========================
iisreset /start

echo =========================
echo Deploy completed successfully!
echo =========================

pause