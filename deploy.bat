@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Clover-X Personal Management - Deploy to AWS
cd /d "%~dp0"

echo.
echo   Clover-X Personal Management  ^|  deploy to an Ubuntu server (AWS EC2)
echo   ------------------------------------------------------------
echo   Uploads this folder to the server and runs setup.sh there,
echo   which installs Docker and starts everything.
echo.

where ssh >nul 2>nul || (
  echo   [x] OpenSSH client not found.
  echo       Settings ^> System ^> Optional features ^> Add "OpenSSH Client", then run again.
  pause & exit /b 1
)
where tar >nul 2>nul || ( echo   [x] tar not found ^(needs Windows 10 1803 or newer^). & pause & exit /b 1 )

rem ---- remember the last answers in deploy.local.cmd (git-ignored)
if exist deploy.local.cmd call deploy.local.cmd

set "IN_HOST="
set /p "IN_HOST=  Server public IP or hostname [%CX_HOST%]: "
if defined IN_HOST set "CX_HOST=%IN_HOST%"
if not defined CX_HOST ( echo   [x] A server address is required. & pause & exit /b 1 )

if not defined CX_USER set "CX_USER=ubuntu"
set "IN_USER="
set /p "IN_USER=  SSH user [%CX_USER%]: "
if defined IN_USER set "CX_USER=%IN_USER%"

set "IN_KEY="
set /p "IN_KEY=  Path to your .pem key (drag the file here) [%CX_KEY%]: "
if defined IN_KEY set "CX_KEY=%IN_KEY%"
set "CX_KEY=%CX_KEY:"=%"
if not exist "%CX_KEY%" ( echo   [x] Key file not found: %CX_KEY% & pause & exit /b 1 )

(
  echo set "CX_HOST=%CX_HOST%"
  echo set "CX_USER=%CX_USER%"
  echo set "CX_KEY=%CX_KEY%"
) > deploy.local.cmd

rem ---- OpenSSH refuses keys that other Windows users can read
icacls "%CX_KEY%" /inheritance:r /grant:r "%USERNAME%:R" >nul 2>nul

set "REMOTE_DIR=clover-x-share"
set "PKG=%TEMP%\clover-x-deploy.tgz"

echo.
echo   [1/3] Packing the project ^(without local data, keys or git history^)...
if exist "%PKG%" del /q "%PKG%"
tar -czf "%PKG%" --exclude=./data --exclude=./.git --exclude=./.env --exclude=./shared --exclude=./backups --exclude=./deploy.local.cmd .
if errorlevel 1 ( echo   [x] Packing failed. & pause & exit /b 1 )

echo   [2/3] Uploading to %CX_USER%@%CX_HOST% ...
scp -q -i "%CX_KEY%" -o StrictHostKeyChecking=accept-new "%PKG%" %CX_USER%@%CX_HOST%:/tmp/clover-x-deploy.tgz
if errorlevel 1 (
  echo   [x] Upload failed. Check the IP, the key file, and that the Security Group allows SSH ^(port 22^) from your IP.
  pause & exit /b 1
)
del /q "%PKG%"

echo   [3/3] Running setup on the server...
echo.
ssh -t -i "%CX_KEY%" %CX_USER%@%CX_HOST% "mkdir -p ~/%REMOTE_DIR% && tar xzf /tmp/clover-x-deploy.tgz -C ~/%REMOTE_DIR% && rm -f /tmp/clover-x-deploy.tgz && cd ~/%REMOTE_DIR% && sed -i 's/\r$//' setup.sh && chmod +x setup.sh && ./setup.sh install"

echo.
echo   Manage later with:  ssh -i "%CX_KEY%" %CX_USER%@%CX_HOST%   then   cd %REMOTE_DIR% ^&^& ./setup.sh status
echo.
pause
