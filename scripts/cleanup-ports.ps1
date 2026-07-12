# scripts/cleanup-ports.ps1 -- Free up the dev-stack ports by killing
# whatever processes are listening on them. Idempotent: safe to run
# when the ports are already free (no-op). PowerShell 5.1+ mirror of
# scripts/cleanup-ports.sh -- the bash + PowerShell versions emit
# identical observable behavior so either can be invoked from any
# wrapper.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File
#           scripts/cleanup-ports.ps1 [PORT...] [--sweep|-s] [--own]
#
# Default ports: 3001 5173 (Remotion editor dev-stack).
#
# Flags:
#   --sweep, -s        Also kill any orphaned node.exe whose commandline
#                      contains vite|remotion|tsx. OFF by default because
#                      that matcher is broad enough to nuke an unrelated
#                      dev session; enable it explicitly when you know
#                      those watchers are stuck. Equivalent:
#                      CLEANUP_PORTS_SWEEP=1 ... cleanup-ports.ps1
#
#   --own              Kill ONLY the PIDs written by our own
#                      scripts/dev.{sh,ps1} (which earlier wrote
#                      .dev/launch-manifest.json). Never touch listeners
#                      on the ports. Designed to be the safe-preflight
#                      step the launcher wrappers run on every start.
#
# Source-of-truth helper for the --own math is scripts/_pid-manifest.ps1.
#
# IMPORTANT: We never use the lowercase variable name `$pid` because
# PowerShell is CASE-INSENSITIVE on variables, so `$pid` resolves to
# the read-only automatic `$PID` (current process ID) and would throw
# "Cannot overwrite variable PID" on the first assignment. Local
# process-id variables / parameters are named `$targetPid` instead.

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Continue'

# Dot-source the manifest helper.
$manifestHelper = Join-Path $PSScriptRoot '_pid-manifest.ps1'
. $manifestHelper

# ---------- arg parsing ----------------------------------------------------
$ports  = New-Object System.Collections.Generic.List[int]
$sweep  = $false
$own    = $false
$rawPortArgs = @()

foreach ($a in $args) {
  switch -Regex ($a) {
    '^--sweep$'    { $sweep = $true; continue }
    '^-s$'         { $sweep = $true; continue }
    '^--own$'      { $own = $true; continue }
    '^(\d+)$'      { [void]$ports.Add([int]$Matches[1]); [void]$rawPortArgs.Add($a); continue }
    default {
      Write-Host "[cleanup-ports] unknown arg: $a" -ForegroundColor Yellow
      exit 2
    }
  }
}

# Env-var escalation (matches bash helper's CLEANUP_PORTS_SWEEP /
# ENABLE_OWN_RECOVERY patterns).
$envSweep = "$env:CLEANUP_PORTS_SWEEP"
if ($envSweep -match '^(?i:1|true|yes|on)$') { $sweep = $true }
$envOwn = "$env:ENABLE_OWN_RECOVERY"
if ($envOwn -match '^(?i:1|true|yes|on)$') { $own = $true }

# Default ports for the editor dev-stack.
if ($ports.Count -eq 0) {
  [void]$ports.Add(3001)
  [void]$ports.Add(5173)
}

# ---------- resolve repo root (for --own manifest lookup) ------------------
$ownRepoRoot = "$env:OWN_REPO_ROOT"
if ([string]::IsNullOrEmpty($ownRepoRoot)) {
  $ownRepoRoot = (Get-Location).Path
  $landmark = Join-Path $ownRepoRoot 'scripts/dev.ps1'
  if (-not (Test-Path -LiteralPath $landmark)) {
    $landmark2 = Join-Path $ownRepoRoot 'scripts/cleanup-ports.ps1'
    if (-not (Test-Path -LiteralPath $landmark2)) {
      $ownRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    }
  }
}

Write-Host "[cleanup-ports] Mode: PowerShell 5.1+ (Windows)" -ForegroundColor DarkGray
Write-Host "[cleanup-ports] Ports targeted: $($ports -join ' ')" -ForegroundColor DarkGray
Write-Host "[cleanup-ports] Sweep: $([bool]$sweep)" -ForegroundColor DarkGray
Write-Host "[cleanup-ports] Own: $([bool]$own)" -ForegroundColor DarkGray

# ---------- helper functions ----------------------------------------------
function Get-ListeningPids([int]$port) {
  try {
    # PS 5.1's Get-NetTCPConnection filters by -LocalPort and -State. Owning
    # Process is the PID we want. We exclude connections where the PID is
    # in the kernel's transient set (0..4) since those can't be killed by
    # taskkill anyway and would create spurious entries.
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($null -eq $conn) { return @() }
    $pids = $conn |
      Where-Object { $_.OwningProcess -gt 4 } |
      Select-Object -ExpandProperty OwningProcess -Unique
    return @($pids)
  } catch {
    Write-Host "[cleanup-ports] Get-NetTCPConnection failed (falling back to netstat): $_" -ForegroundColor Yellow
    $lines = & netstat -ano 2>$null
    $bag = New-Object System.Collections.Generic.HashSet[int]
    foreach ($line in $lines) {
      if ($line -match '^\s*TCP\s+\S+:' + $port + '\s+\S+\s+LISTENING\s+(\d+)\s*$') {
        [void]$bag.Add([int]$Matches[1])
      }
    }
    return @($bag)
  }
}

function Get-PidPreview([int]$targetPid) {
  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($null -eq $p) { return '' }
  $path = $p.Path
  if ([string]::IsNullOrEmpty($path)) { $path = $p.ProcessName }
  return $path
}

function Invoke-KillPidTree([int]$targetPid) {
  $preview = Get-PidPreview -targetPid $targetPid
  Write-Host "[cleanup-ports]   target: pid=$targetPid :: $preview" -ForegroundColor DarkGray
  try {
    $out = & taskkill /F /T /PID $targetPid 2>&1
    if ($out) { Write-Host ($out -join "`n") -ForegroundColor DarkGray }
  } catch {
    Write-Host "[cleanup-ports] taskkill threw for pid=$targetPid : $_" -ForegroundColor Yellow
  }
}

function Invoke-SweepOrphanNodeWatchers {
  if (-not $sweep) {
    Write-Host "[cleanup-ports] Orphan-node sweep: SKIPPED (pass --sweep or set CLEANUP_PORTS_SWEEP=1 to enable)" -ForegroundColor DarkGray
    return
  }
  Write-Host "[cleanup-ports] Orphan-node sweep ENABLED: killing node.exe whose commandline matches vite|remotion|tsx..." -ForegroundColor DarkGray
  try {
    $orphans = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        try { $_.CommandLine -match 'vite|remotion|tsx' } catch { $false }
      }
    foreach ($o in $orphans) {
      $preview = if ($o.CommandLine) {
        if ($o.CommandLine.Length -gt 120) { $o.CommandLine.Substring(0, 120) } else { $o.CommandLine }
      } else { '' }
      Write-Host "[cleanup-ports]   sweep: killing PID $($o.ProcessId) :: $preview" -ForegroundColor DarkGray
      try { Stop-Process -Id $o.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  } catch {
    Write-Host "[cleanup-ports] sweep section failed: $_" -ForegroundColor Yellow
  }
}

function Invoke-CleanupOwned {
  Write-Host "[cleanup-ports] OWN mode: reading manifest at $(Join-Path $ownRepoRoot '.dev/launch-manifest.json')" -ForegroundColor DarkGray
  $manifestPath = Join-Path $ownRepoRoot '.dev/launch-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    Write-Host "[cleanup-ports] OWN mode: no manifest -- safe no-op" -ForegroundColor DarkGray
    return
  }
  $m = Read-Manifest -ProjectRoot $ownRepoRoot
  if ($null -eq $m) {
    Write-Host "[cleanup-ports] OWN mode: manifest unreadable/stale/mismatched -- safe no-op" -ForegroundColor DarkGray
    return
  }
  Write-Host "[cleanup-ports] OWN mode: projectRoot=$($m.projectRoot) launchedAt=$($m.launchedAt)" -ForegroundColor DarkGray
  $attempts = 0
  $kills    = 0
  foreach ($triple in @(
      @{ label = 'server'; pid = $m.pidServer; pg = $m.pidServerPgid },
      @{ label = 'client'; pid = $m.pidClient; pg = $m.pidClientPgid }
    )) {
    $targetPid = [int]$triple['pid']
    $label     = [string]$triple['label']
    $pg        = $triple['pg']
    if ($targetPid -le 0) { continue }
    if (Test-PidAlive -targetPid $targetPid) {
      $pgDesc = if ($null -ne $pg) { "pgid=$pg" } else { 'pgid=<auto>' }
      Write-Host "[cleanup-ports] OWN mode: killing $label=$targetPid $pgDesc" -ForegroundColor DarkGray
      $attempts++
      Kill-Manifest-Owner -targetPid $targetPid -Pgid ([int]([int]$pg))
      if (Test-PidAlive -targetPid $targetPid) {
        Write-Host "[cleanup-ports] OWN mode: WARN $label=$targetPid still alive after Kill-Manifest-Owner" -ForegroundColor Yellow
      } else {
        $kills++
      }
    } else {
      Write-Host "[cleanup-ports] OWN mode: $label=$targetPid already dead -- skipped (PID almost certainly recycled; safer to no-op)" -ForegroundColor DarkGray
    }
  }
  Write-Host "[cleanup-ports] OWN mode: $kills/$attempts PIDs verified dead" -ForegroundColor DarkGray
  Clear-Manifest -ProjectRoot $ownRepoRoot
}

# ---------- main ---------------------------------------------------------
# --own short-circuits: do manifest-aware kill FIRST, then fall through
# to the normal port-based cleanup if --own was combined with other
# flags. Mirrors the bash helper's behavior.
if ($own) {
  Invoke-CleanupOwned
  if (-not $sweep -and ($rawPortArgs.Count -eq 0)) {
    Write-Host "[cleanup-ports] OWN mode: short-circuit done; ports not touched." -ForegroundColor DarkGray
    exit 0
  }
  Write-Host "[cleanup-ports] OWN mode: continuing with port-based cleanup as belt-and-braces" -ForegroundColor DarkGray
}

# Port-based cleanup
$allPids = New-Object System.Collections.Generic.HashSet[int]
foreach ($port in $ports) {
  foreach ($p in (Get-ListeningPids -port ([int]$port))) { [void]$allPids.Add($p) }
}

if ($allPids.Count -eq 0) {
  Write-Host "[cleanup-ports] No listeners on $($ports -join ','). Nothing to kill." -ForegroundColor DarkGray
} else {
  Write-Host "[cleanup-ports] Killing $($allPids.Count) PID(s): $(@($allPids) -join ' ')" -ForegroundColor DarkGray
  foreach ($p in $allPids) {
    Invoke-KillPidTree -targetPid ([int]$p)
  }
}

Invoke-SweepOrphanNodeWatchers

# Final verification
Start-Sleep -Seconds 2
$leftover = New-Object System.Collections.Generic.List[string]
foreach ($port in $ports) {
  $left = @(Get-ListeningPids -port ([int]$port))
  if ($left.Count -gt 0) {
    [void]$leftover.Add("${port}=$($left -join ' ')")
  }
}
if ($leftover.Count -gt 0) {
  Write-Host "[cleanup-ports] WARNING -- still bound: $($leftover -join ' ')" -ForegroundColor Yellow
  Write-Host "[cleanup-ports] Hint: re-run with --sweep to clear orphan node watchers that escaped the listener-detected set, e.g." -ForegroundColor Yellow
  Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-ports.ps1 --sweep" -ForegroundColor Yellow
  exit 1
}
Write-Host "[cleanup-ports] Ports clear." -ForegroundColor DarkGray
exit 0
