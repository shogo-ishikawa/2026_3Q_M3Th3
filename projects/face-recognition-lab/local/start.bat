@echo off
setlocal
cd /d "%~dp0"
title FACEGATE Local
if not exist ".venv\Scripts\python.exe" goto setup
if not exist ".venv\setup_ok.txt" goto setup
fc /b "requirements.txt" ".venv\setup_ok.txt" >nul 2>&1
if errorlevel 1 goto update
goto launch

:setup
set "FACEGATE_PY="
for /f "delims=" %%i in ('py -3.12 -c "import sys;print(sys.executable)" 2^>nul') do set "FACEGATE_PY=%%i"
if not defined FACEGATE_PY for /f "delims=" %%i in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do set "FACEGATE_PY=%%i"
if not defined FACEGATE_PY for /f "delims=" %%i in ('python -c "import sys;print(sys.executable)" 2^>nul') do set "FACEGATE_PY=%%i"
if not defined FACEGATE_PY goto no_python
"%FACEGATE_PY%" -c "import sys;sys.exit(0 if (3,10) <= sys.version_info[:2] < (3,14) else 1)"
if errorlevel 1 goto no_python
echo Creating the FACEGATE environment. Please keep this window open.
"%FACEGATE_PY%" -m venv .venv
if errorlevel 1 goto fail

:update
echo Installing Python packages. This can take several minutes.
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check --timeout 60 --retries 3 --prefer-binary -r requirements.txt
if errorlevel 1 goto fail
copy /y "requirements.txt" ".venv\setup_ok.txt" >nul

:launch
echo Starting FACEGATE. Close the app window to finish.
".venv\Scripts\python.exe" "%~dp0main.py"
if errorlevel 1 goto fail
exit /b 0

:no_python
echo Install Python 3.12 for Windows from https://www.python.org/downloads/windows/
echo Select "Add python.exe to PATH", then run start.bat again.
echo See README.md for the Japanese instructions.
echo FACEGATE does not install Python or accept agreements automatically.
pause
exit /b 1

:fail
echo FACEGATE could not start. Read the error above and README.md.
echo No data has been uploaded by this launcher.
pause
exit /b 1
