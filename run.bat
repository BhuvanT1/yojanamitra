@echo off
REM ===========================================================================
REM  YojanaMitra - one-click setup and launch (Windows)
REM
REM  Creates a virtual environment, installs dependencies, builds the data
REM  files, runs the tests, and starts the web app. Safe to run more than once:
REM  it reuses the environment and skips work that is already done.
REM ===========================================================================

setlocal
cd /d "%~dp0"
title YojanaMitra

echo.
echo  ==========================================================
echo   YojanaMitra - setup and launch
echo  ==========================================================
echo.

REM --- locate a usable Python -----------------------------------------------
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo  [X] Python was not found on your PATH.
  echo      Install Python 3.10 or newer from https://python.org
  echo      or open this from an Anaconda Prompt.
  echo.
  pause
  exit /b 1
)

for /f "tokens=2" %%v in ('%PY% --version 2^>^&1') do set "PYVER=%%v"
echo  [1/5] Using Python %PYVER%

REM --- virtual environment ---------------------------------------------------
if not exist ".venv\Scripts\python.exe" (
  echo  [2/5] Creating virtual environment...
  %PY% -m venv .venv
  if errorlevel 1 goto :failed
) else (
  echo  [2/5] Virtual environment already exists - reusing it
)
set "VPY=.venv\Scripts\python.exe"

REM --- dependencies ----------------------------------------------------------
echo  [3/5] Installing dependencies (first run takes a minute)...
"%VPY%" -m pip install --upgrade pip --quiet
"%VPY%" -m pip install -r requirements.txt --quiet
if errorlevel 1 goto :failed

REM --- data ------------------------------------------------------------------
echo  [4/5] Building the scheme corpus and gold set...
"%VPY%" scripts\build_corpus.py
if errorlevel 1 goto :failed
"%VPY%" scripts\build_gold_set.py
if errorlevel 1 goto :failed

REM --- tests -----------------------------------------------------------------
echo  [5/5] Running the test suite...
"%VPY%" -m pytest -q
if errorlevel 1 (
  echo.
  echo  [!] Some tests failed. The app may still run, but something is off.
  echo.
  pause
)

echo.
echo  ==========================================================
echo   Starting the web app.
echo   It opens in your browser at  http://localhost:8501
echo   Press Ctrl+C in this window to stop it.
echo  ==========================================================
echo.

"%VPY%" -m streamlit run app.py
goto :eof

:failed
echo.
echo  [X] Setup failed at the step above. The message just before this
echo      line usually says why.
echo.
pause
exit /b 1
