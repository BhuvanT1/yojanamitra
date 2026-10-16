@echo off
REM ===========================================================================
REM  YojanaMitra - start the REST API (Windows)
REM  Run run.bat at least once first, so the environment exists.
REM ===========================================================================

setlocal
cd /d "%~dp0"
title YojanaMitra API

if not exist ".venv\Scripts\python.exe" (
  echo  [X] No environment yet. Run run.bat first.
  echo.
  pause
  exit /b 1
)

echo.
echo  ==========================================================
echo   API docs      http://localhost:8000/docs
echo   Health check  http://localhost:8000/health
echo   Press Ctrl+C to stop.
echo  ==========================================================
echo.

.venv\Scripts\python.exe -m uvicorn yojanamitra.api:app --reload --port 8000
