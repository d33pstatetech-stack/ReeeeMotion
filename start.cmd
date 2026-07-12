@echo off
rem ===================================================================
rem   start.cmd -- Windows GUI launcher (auto-detects bash vs PowerShell)
rem
rem   Order of preference:
rem     1. bash   (Git for Windows)     -> scripts\dev.sh
rem     2. powershell (built-in Win10+) -> scripts\dev.ps1
rem
rem   Why auto-detect rather than split into two files: many users
rem   have Git for Windows bash but on locked-down boxes it may be
rem   uninstalled, so the .cmd fallback to PowerShell means the user
rem   never gets a "bash missing" surprise if they double-clicked
rem   start.cmd from a teammate's zip extract. Pick the bash path
rem   when available because it sets up process groups via setsid for
rem   atomic Ctrl-C cleanup; PowerShell uses taskkill /F /T which is
rem   equally atomic on the Windows job-object tree.
rem ===================================================================
setlocal
cd /d "%~dp0"
title Remotion Video Editor -- dev stack

echo.
echo ================================================
echo  Remotion Video Editor -- local dev stack
echo ================================================
echo.
echo  Booting Express server on :3001 and Vite client on :5173...
echo  Browser will open at http://localhost:5173/ automatically.
echo  Press Ctrl-C to stop the whole stack.
echo.
echo  Detecting launch backend...
echo.

rem ---- Preferred: bash (Git for Windows) ----------------------------
where bash >nul 2>nul && (
  echo   [start.cmd] Backend: bash (scripts\dev.sh) -- preferred
  echo.
  echo   [preflight] Safe port recovery (--own; only kills our previous launches)
  bash scripts\cleanup-ports.sh --own
  echo.
  bash scripts\dev.sh %*
  if errorlevel 1 pause
  goto :end
)

rem ---- Fallback: PowerShell 5.1+ ships on all modern Windows ---------
where powershell >nul 2>nul && (
  echo   [start.cmd] Backend: PowerShell (scripts\dev.ps1)
  echo                 (bash not detected -- falling back to PowerShell)
  echo.
  echo   [preflight] Safe port recovery (--own; only kills our previous launches)
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cleanup-ports.ps1" --own
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev.ps1" %*
  if errorlevel 1 pause
  goto :end
)

rem ---- No compatible backend ----------------------------------------
echo.
echo  ERROR: Neither bash nor PowerShell is on your PATH.
echo.
echo  Install one of:
echo    1. bash -- Git for Windows: https://git-scm.com/
echo    2. PowerShell 5.0+ -- ships with Windows 10+ (try `where powershell`)
echo.
pause
exit /b 1

:end
endlocal
