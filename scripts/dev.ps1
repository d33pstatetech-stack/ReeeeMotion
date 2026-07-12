# scripts/dev.ps1 -- Run the Remotion editor stack (server + client) in
# one terminal. Pure PowerShell 5.1+ -- no bash, no extra deps (no
# `concurrently`, no Node shim).
#
# What it does:
#   1. Pre-flight: refuses to start if either port (3001, 5173) is busy,
#      because Vite uses `strictPort: true` and we'd just bounce.
#   2. Spawns `npm run dev` in `server/` and `client/` directories via
#      Start-Process, capturing each immediate child PID + log path.
#   3. Polls both ports until they answer (30s timeout each).
#   4. Prints a URL table (server + client + where uploads land) and
#      opens the client in the default browser via Start-Process.
#   5. On Ctrl-C, taskkill /F /T /PID <npmPid> walks each npm child's
#      job-object tree atomically so the whole stack dies together.
#
# Cross-platform:
#   * Windows PowerShell 5.1+ -- primary target. Get-NetTCPConnection
#     + Start-Process + Get-CimInstance + taskkill are all here.
#   * Windows PowerShell 7+ (pwsh) -- same code, no changes needed.
#   * macOS / Linux pwsh -- not officially supported; the bash script
#     handles those platforms. If you're on Linux pwsh and reading this,
#     the Get-NetTCPConnection + Start-Process calls will fail and the
#     wrapper will surface a friendly error -- our bash version is what
#     you want.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1
#   npm run dev:posts       # via the root package.json script
#   powershell ... scripts/dev.ps1 --no-browser   # skip the auto-open

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Continue'

# Brand-stamp the console window title so a direct
# `powershell -File scripts\dev.ps1` invocation matches what start.cmd does
# via `title Remotion Video Editor -- dev stack`. Wrapped in try/catch
# because $host.UI.RawUI isn't writable in PS remoting / ISE; silent
# degrade is acceptable there.
try { $host.UI.RawUI.WindowTitle = 'Remotion Video Editor -- dev stack' } catch {}

# Dot-source the manifest helper (write/read/kill/clear of
# .dev/launch-manifest.json). Same file both bash and PowerShell
# write/read, so cross-language --own from cleanup-ports.{sh,ps1}
# works against either kind of manifest writer.
. (Join-Path $PSScriptRoot '_pid-manifest.ps1')

# ---------- 1. Args ----------------------------------------------------------
$openBrowser = $true
foreach ($a in $args) {
  switch ($a) {
    '--no-browser' { $openBrowser = $false }
    '-h' {
      Write-Host ''
      Write-Host 'Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1 [--no-browser]'
      Write-Host ''
      Write-Host 'Runs the Remotion editor server (port 3001) and client (port 5173) in one'
      Write-Host 'terminal. Ctrl-C stops both processes (taskkill /F /T walks the whole'
      Write-Host "job-object tree atomically = equivalent to bash's setsid cleanup)."
      Write-Host ''
      Write-Host '  --no-browser   Do not auto-open the client in a browser.'
      Write-Host '  -h, --help     Print this message.'
      exit 0
    }
    '--help' {
      Write-Host ''
      Write-Host 'Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1 [--no-browser]'
      Write-Host ''
      Write-Host 'Runs the Remotion editor server (port 3001) and client (port 5173) in one'
      Write-Host 'terminal. Ctrl-C stops both processes (taskkill /F /T walks the whole'
      Write-Host "job-object tree atomically = equivalent to bash's setsid cleanup)."
      exit 0
    }
    default {
      Write-Host "Unknown arg: $a" -ForegroundColor Yellow
      exit 2
    }
  }
}

# ---------- 2. Resolve repo root + paths ------------------------------------
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$serverDir = Join-Path $repoRoot 'server'
$clientDir = Join-Path $repoRoot 'client'
$serverPort = 3001
$clientPort = 5173
$startupTimeoutSec = 30

Write-Host ''
Write-Host '================================================'
Write-Host ' Remotion Video Editor -- local dev stack'
Write-Host '================================================'
Write-Host ''
Write-Host "  Booting Express server on :$serverPort and Vite client on :$clientPort..."
Write-Host "  Browser will open at http://localhost:$clientPort/ automatically."
Write-Host '  Press Ctrl-C to stop the whole stack.'
Write-Host ''

# ---------- 3. Port preflight -----------------------------------------------
# Quick TCP-probe to 127.0.0.1:<port>. Mirrors bash's /dev/tcp test.
function Test-PortOpenLocal([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    $hit = $iar.AsyncWaitHandle.WaitOne(500)
    if ($hit) {
      try { $client.EndConnect($iar) } catch {}
      return $true
    }
    return $false
  } catch {
    return $false
  } finally {
    try { $client.Close() } catch {}
  }
}

function Write-PortInUseError([int]$port) {
  Write-Host ''
  Write-Host "ERROR: port $port is already in use." -ForegroundColor Red
  Write-Host ''
  Write-Host "Refusing to start so Vite's strictPort doesn't fail with a confusing stack." -ForegroundColor Red
  Write-Host 'Likely culprits:' -ForegroundColor Red
  Write-Host "  * Another \`npm run dev\` is running in another terminal or service." -ForegroundColor Red
  Write-Host "  * A previous stack was orphaned (Ctrl-C didn't fully shut down)." -ForegroundColor Red
  Write-Host ''
  Write-Host "To free $port on Windows (PowerShell):" -ForegroundColor Red
  Write-Host "  Get-NetTCPConnection -LocalPort $port -State Listen | ForEach-Object { Stop-Process -Id `$_.OwningProcess -Force }" -ForegroundColor Red
  Write-Host ''
}

if (Test-PortOpenLocal -port $serverPort) {
  Write-PortInUseError -port $serverPort
  exit 3
}
if (Test-PortOpenLocal -port $clientPort) {
  Write-PortInUseError -port $clientPort
  exit 3
}

# ---------- 4. Locate npm ----------------------------------------------------
$npmExePath = $null
$npmCmd = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if ($null -ne $npmCmd) { $npmExePath = $npmCmd.Source }
if ([string]::IsNullOrEmpty($npmExePath)) {
  $npmCmd = Get-Command 'npm' -ErrorAction SilentlyContinue
  if ($null -ne $npmCmd) { $npmExePath = $npmCmd.Source }
}
if ([string]::IsNullOrEmpty($npmExePath)) {
  Write-Host ''
  Write-Host "ERROR: 'npm' is not on your PATH." -ForegroundColor Red
  Write-Host 'Install Node.js from https://nodejs.org/ and re-run.' -ForegroundColor Red
  exit 7
}

# ---------- 5. Cleanup tracking ---------------------------------------------
# Capture each immediate child PID (the `npm.cmd` / `node.exe` running
# `npm run dev`) so cleanup() can taskkill /F /T the whole job-object
# tree (npm + tsx + vite) atomically. Equivalent to bash's
# `kill -TERM -${pgid}` for process-group kill.
$script:ServerPid = 0
$script:ClientPid = 0
$script:ServerLogPath = ''
$script:ClientLogPath = ''
$script:Exited = $false
$script:TailJobs = @()

function Invoke-Cleanup {
  param([string]$sig = 'EXIT')
  if ($script:Exited) { return }
  $script:Exited = $true
  Write-Host ''
  Write-Host "[dev.ps1] Caught $sig, stopping stack..." -ForegroundColor DarkGray
  # On clean EXIT (Ctrl-C + tree-kill completed normally) clear the
  # manifest so the NEXT launch sees a "fresh" state. On non-EXIT
  # signals we leave it in place so a follow-up --own pass can recover
  # orphans that our tree-kill missed; mirrors the bash script's
  # EXIT-only clear policy.
  if ($sig -eq 'EXIT') {
    Clear-Manifest -ProjectRoot $repoRoot
  }
  foreach ($name in @('ServerPid','ClientPid')) {
    $v = Get-Variable -Name "script:$name" -ValueOnly -ErrorAction SilentlyContinue
    if ($v -gt 0) {
      try {
        Write-Host "[dev.ps1] taskkill /F /T /PID $v" -ForegroundColor DarkGray
        & taskkill /F /T /PID $v 2>&1 | Out-Null
      } catch {}
    }
  }
  Write-Host '[dev.ps1] Cleaned up. Bye.'
}

function Stop-AllTailers {
  foreach ($j in $script:TailJobs) {
    if ($null -eq $j) { continue }
    try { Stop-Job -Job $j -ErrorAction SilentlyContinue | Out-Null } catch {}
    try { Remove-Job -Job $j -Force -ErrorAction SilentlyContinue | Out-Null } catch {}
  }
}

# Spawn a single npm child (server or client). The PID captured is the
# IMMEDIATE child of powershell.exe (`npm.cmd`/`npm.exe`), whose
# children (`node.exe` running tsx + vite) will be reaped by
# taskkill /F /T during cleanup. Output is redirected to per-child
# log files in %TEMP% (parity with bash's `/tmp/dev-*.log` path).
function Start-DevChild {
  param(
    [Parameter(Mandatory)][string]$WorkDir,
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][int]$Port
  )
  $logName = "remotion-dev-$Label-$PID.log"
  $logPath = Join-Path $env:TEMP $logName
  if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath -Force }

  # Start-Process quirk this works around: PowerShell rejects `Start-Process`
  # with `InvalidOperationException: ... 'RedirectStandardOutput' and
  # 'RedirectStandardError' are same ...` whenever both stdout and stderr
  # point at the same file. There is no native PowerShell analogue to
  # bash's `> $log 2>&1` -- so we detour through
  # `cmd.exe /c "<npm> run dev > $log 2>&1"`. `cmd.exe`'s own shell parser
  # merges the streams BEFORE Start-Process's redirection layer is
  # involved, satisfying the constraint trivially (we don't pass any
  # -RedirectStandard* parameters here at all).
  #
  # Captured PID is `cmd.exe`'s, not `npm.cmd`'s, but cleanup still works
  # because `taskkill /F /T /PID $ServerPid` walks the WHOLE job-object
  # tree (cmd.exe -> npm.cmd -> node.exe -> tsx/vite children) atomically.
  # Same reasoning the bash twin relies on with `kill -TERM -${pgid}` on
  # the session-leader.
  #
  # Same merged-log-file semantic as the bash twin: both stdout and
  # stderr land in $logPath, so `tail -f $env:TEMP/remotion-dev-*.log`
  # from another terminal or the in-loop Start-LogTailer tailer both
  # surface every line. PowerShell's auto-quoting of the embedded quoted
  # paths in $cmdLine is harmless: cmd.exe's tokenizer strips the outer
  # quotes after reconstructing argv.
  #
  # Note on file existence: $logPath is removed at function entry above
  # the Start-Process call so cmd.exe's `>` truncation is a clean open
  # (`> file` truncates). PS-side auto-quoting of paths with spaces
  # (e.g. `C:\Program Files\nodejs\npm.cmd`) is handled correctly because
  # the embedded `"` in $cmdLine becomes `\"` at the CreateProcess
  # layer, which cmd.exe unescapes back to `"` during parsing.
  $cmdLine = "`"$npmExePath`" run dev > `"$logPath`" 2>&1"
  $proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', $cmdLine `
    -WorkingDirectory $WorkDir `
    -PassThru
  Write-Host "[dev.ps1] Starting $Label (port $Port) pid=$($proc.Id) in $WorkDir ..."
  return @{ pid = $proc.Id; logPath = $logPath; label = $Label; port = $Port }
}

function Wait-ForPort {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][string]$LogPath,
    [Parameter(Mandatory)][int]$ChildPid
  )
  for ($i = 0; $i -lt $startupTimeoutSec; $i++) {
    if (Test-PortOpenLocal -port $Port) {
      Write-Host "[dev.ps1] $Label ready (port $Port, pid $ChildPid) after $($i)s." -ForegroundColor DarkGray
      return $true
    }
    Start-Sleep -Seconds 1
  }
  Write-Host ''
  Write-Host "ERROR: $Label did not bind port $Port within $($startupTimeoutSec)s." -ForegroundColor Red
  Write-Host "Last 30 lines of ${LogPath}:" -ForegroundColor Red
  if (Test-Path -LiteralPath $LogPath) {
    Get-Content -LiteralPath $LogPath -Tail 30 -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Host $_ -ForegroundColor Red }
  }
  return $false
}

# Per-child log tailer running in a Start-Job so the main thread stays
# free for the liveness loop and Ctrl-C response. Each tailer prefixes
# its lines with "[Label]" so the user can tell server vs client output
# apart when both are interleaved in one console window.
function Start-LogTailer {
  param(
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][string]$LogPath
  )
  $job = Start-Job -Name "tail-$Label" -ScriptBlock {
    param($label, $logPath)
    try {
      $waitedMs = 0
      while ((-not (Test-Path -LiteralPath $logPath)) -and ($waitedMs -lt 10000)) {
        Start-Sleep -Milliseconds 250
        $waitedMs += 250
      }
      if (-not (Test-Path -LiteralPath $logPath)) { return }
      $lastLen = 0
      while ($true) {
        try {
          $cur = $null
          if (Test-Path -LiteralPath $logPath) {
            $cur = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue
          }
          if ($null -ne $cur) {
            if ($cur.Length -gt $lastLen) {
              $tail = $cur.Substring($lastLen)
              $lastLen = $cur.Length
              foreach ($line in ($tail -split "`n")) {
                $clean = $line.TrimEnd("`r")
                if ([string]::IsNullOrEmpty($clean)) { continue }
                Write-Host "[$label] $clean"
              }
            }
          }
        } catch {}
        Start-Sleep -Milliseconds 400
      }
    } catch {
      Write-Host "[$label] tailer error: $_" -ForegroundColor Yellow
    }
  } -ArgumentList $Label, $LogPath
  return $job
}

# Wrap EVERYTHING in try/finally. In PS 5.1, a Ctrl-C during a long-
# running script triggers a pipeline-stop unwind that runs the finally
# block -- that's how SIGINT -> cleanup() works without a manual
# trap handler. (PS 5.1 doesn't reliably dispatch CTRL_C_EVENT to a
# running script; the try/finally pattern is the canonical workaround.)
try {
  Set-Location -LiteralPath $serverDir
  $serverInfo = Start-DevChild -WorkDir $serverDir -Label 'server' -Port $serverPort
  $script:ServerPid = $serverInfo.pid
  $script:ServerLogPath = $serverInfo.logPath

  Set-Location -LiteralPath $clientDir
  $clientInfo = Start-DevChild -WorkDir $clientDir -Label 'client' -Port $clientPort
  $script:ClientPid = $clientInfo.pid
  $script:ClientLogPath = $clientInfo.logPath

  Set-Location -LiteralPath $repoRoot

  # ---------- 6. Record manifest --------------------------------------------
  # Atomics the bash writer does, in PS form. Same schema = cross-language
  # --own readers (cleanup-ports.sh + cleanup-ports.ps1) both work.
  Write-Manifest -ProjectRoot $repoRoot -PidServer $script:ServerPid -PidClient $script:ClientPid

  # ---------- 7. Wait for both ports to answer ------------------------------
  $readyServer = Wait-ForPort -Port $serverPort -Label 'server' -LogPath $script:ServerLogPath -ChildPid $script:ServerPid
  if (-not $readyServer) {
    throw "server failed to bind"
  }
  $readyClient = Wait-ForPort -Port $clientPort -Label 'client' -LogPath $script:ClientLogPath -ChildPid $script:ClientPid
  if (-not $readyClient) {
    throw "client failed to bind"
  }

  # ---------- 8. Print URL table + optional browser open --------------------
  Write-Host ''
  Write-Host '+--------------------------------------------------------------+'
  Write-Host '|  Remotion editor -- local dev stack is UP                    |'
  Write-Host '+--------------------------------------------------------------+'
  Write-Host "|  Client UI  ->  http://localhost:$clientPort/"
  $apiReady = "ready"
  Write-Host "|  API (up.)  ->  http://localhost:$serverPort/api/health    -- $apiReady"
  Write-Host "|  Server PID ->  $($script:ServerPid.ToString().PadRight(11))Client PID -> $($script:ClientPid.ToString().PadRight(11))|"
  Write-Host "|  Logs       ->  $($script:ServerLogPath.PadRight(55))|"
  Write-Host "|               $($script:ClientLogPath.PadRight(55))|"
  Write-Host '|  Stop       ->  Ctrl-C (kills the whole stack)'
  Write-Host '+--------------------------------------------------------------+'
  Write-Host ''

  if ($openBrowser) {
    $url = "http://localhost:$clientPort/"
    try {
      Start-Process -FilePath $url -ErrorAction SilentlyContinue
    } catch {
      Write-Host "[dev.ps1] Start-Process failed: $_. Open $url manually." -ForegroundColor Yellow
    }
  }

  # ---------- 9. Start per-log tailers in background jobs -------------------
  $script:TailJobs += Start-LogTailer -Label 'server' -LogPath $script:ServerLogPath
  $script:TailJobs += Start-LogTailer -Label 'client' -LogPath $script:ClientLogPath

  # ---------- 10. Hold the console open + liveness loop ---------------------
  # The loop wakes every 3s, checks if EITHER child has died unexpectedly,
  # and throws to enter the cleanup path. Normal exit is via Ctrl-C
  # (Ctrl-C unwinds the try/finally layered around this loop).
  Write-Host '[dev.ps1] Tailing both logs in this terminal. Ctrl-C to quit.'
  while ($true) {
    foreach ($name in @('ServerPid','ClientPid')) {
      $p = Get-Variable -Name "script:$name" -ValueOnly -ErrorAction SilentlyContinue
      if (($p -gt 0) -and (-not (Test-PidAlive -targetPid ([int]$p)))) {
        Write-Host "[dev.ps1] Child pid $p exited unexpectedly; tearing down." -ForegroundColor Red
        throw "Child exited unexpectedly: $name pid $p"
      }
    }
    Start-Sleep -Seconds 3
  }
} finally {
  Stop-AllTailers
  Invoke-Cleanup -sig 'EXIT'
}
