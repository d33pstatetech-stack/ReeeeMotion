# start.ps1 -- PowerShell-native GUI launcher for the Remotion Video
# Editor. Run from a pwsh / powershell prompt:
#   .\start.ps1
# or right-click in Explorer -> "Run with PowerShell" (you may need to
# "Unblock" via Properties the first time, since the file originated
# from a git checkout rather than local content).
#
# This is the PowerShell-native analog of start.cmd / start.command /
# start.sh. Equivalent semantics to `bash scripts/dev.sh` except no
# bash dependency -- pure PowerShell 5.1+ (built into Windows 10+).
#
# The wrapper does two things:
#   1. Preflight: invokes scripts/cleanup-ports.ps1 --own, which reads
#      .dev/launch-manifest.json and tree-kills ONLY the PIDs it lists.
#      NEVER touches unrelated listeners on :3001 / :5173. Safe no-op
#      on a fresh checkout or after a clean exit.
#   2. Launch: invokes scripts/dev.ps1 with all the args you passed
#      to start.ps1. dev.ps1 handles port preflight, browser auto-open,
#      and the Ctrl-C cleanup trap.
#
# If dev.ps1 exits non-zero (port busy, missing npm, etc.) the console
# pauses so you can read the error before the window disappears -- the
# same behavior as start.cmd's `pause-after-error`.

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Continue'

# Brand-stamp the console window title so direct `.\start.ps1` invocation
# matches what start.cmd does via `title Remotion Video Editor -- dev stack`.
# Wrapped in try/catch because $host.UI.RawUI isn't writable in PS remoting
# / ISE hosts; degrading silently is acceptable there.
try { $host.UI.RawUI.WindowTitle = 'Remotion Video Editor -- dev stack' } catch {}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '.')).Path
Set-Location -LiteralPath $repoRoot

Write-Host ''
Write-Host '================================================'
Write-Host ' Remotion Video Editor -- local dev stack'
Write-Host '================================================'
Write-Host ''
Write-Host '  Booting Express server on :3001 and Vite client on :5173...'
Write-Host '  Browser will open at http://localhost:5173/ automatically.'
Write-Host '  Press Ctrl-C to stop the whole stack.'
Write-Host ''

# Verify powershell itself first (it is, by definition, since we're
# running -- but still emit a finding for clarity + future-proof
# against a future shell that isn't pwsh).
Write-Host '  [start.ps1] Backend: PowerShell (scripts/dev.ps1)'
Write-Host ''

# -------- Preflight: --own (kill ONLY our previous PIDs) --------
Write-Host '  [preflight] Safe port recovery (--own; only kills our previous launches)'
$cleanupScript = Join-Path $repoRoot 'scripts/cleanup-ports.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $cleanupScript --own
Write-Host ''

# -------- Launch dev stack --------
$devScript = Join-Path $repoRoot 'scripts/dev.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $devScript @args
$devExit = $LASTEXITCODE

if ($devExit -ne 0) {
  Write-Host ''
  Write-Host "[start.ps1] dev.ps1 exited with code $devExit." -ForegroundColor Yellow
  Write-Host '  Pausing so you can read the error before the window closes.' -ForegroundColor Yellow
  try { Read-Host '  Press ENTER to close this window' | Out-Null } catch {}
}

exit $devExit
