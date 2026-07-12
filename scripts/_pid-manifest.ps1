# scripts/_pid-manifest.ps1 -- shared launch-manifest helper for the
# Remotion dev-stack ownership tracking (the "--own" feature).
#
# USAGE: dot-source this file from scripts/dev.ps1 AND scripts/cleanup-ports.ps1
# Do NOT execute it standalone -- it defines functions only.
#
# This file is the PowerShell mirror of scripts/_addpidmanifest.sh.
# Both writers emit the SAME manifest schema so a bash writer's manifest
# can be read by a PowerShell reader (and vice versa) -- cross-language
# interop is required so that "scripts/dev.sh writes, scripts/cleanup-ports.ps1
# reads" works the same as "scripts/dev.ps1 writes, scripts/cleanup-ports.sh
# reads".
#
# Target compatibility: PowerShell 5.1+ (Windows PowerShell). AVOID
# syntax added after 5.1: no null-coalescing (double question-mark),
# no ternary (a ? b : c), no module-level ampersand-ampersand or
# pipe-pipe short-circuit, no -PipelineVariable, no -OutVariable.
# Use `if (...) { ... }` instead. (Documentation names the banned tokens
# in plain English above so the file itself doesn't accidentally
# contain literal banned syntax.)
#
# IMPORTANT: We never use `$pid` (any-case variant -- $pid, $Pid, $PID)
# because PowerShell variables are CASE-INSENSITIVE, so `$pid` always
# resolves to the read-only automatic `$PID` (current process ID). The
# first `$pid = ...` or `[int]$pid` parameter binding throws
# "Cannot overwrite variable Pid because it is read-only or constant".
# All PID-targeting locals + function parameters are named `$targetPid`.

Set-StrictMode -Version 1.0
# IMPORTANT: Do NOT change $ErrorActionPreference here. dev.ps1 sets it to
# 'Continue'; if we override to 'Stop', then ANY non-error logged via
# Write-Host / Write-ManifestLog during the dot-source script-load (before
# dev.ps1's --help arg check) becomes a terminating error and the wrapper
# surfaces a misleading "ParserError". Keep caller preference.

# ---------- config --------------------------------------------------------
# Default TTL is overridable per-process via MANIFEST_TTL_HOURS env var so
# the Electron launcher (which expects short-lived launches during dev)
# could pin a smaller window. Default 24 hours matches the
# "I-quit-and-came-back" workflow.
$script:ManifestTtlHours = 24
# TryParse returns $false for "" and non-numeric strings, so the explicit
# IsNullOrEmpty guard is unnecessary. End-state for all inputs:
#   unset / "" / "0" / "-5" / "abc" -> 24h default
#   "1" / "48" / "168"             -> that value
$parsed = 0
if ([int]::TryParse("$env:MANIFEST_TTL_HOURS", [ref]$parsed) -and ($parsed -gt 0)) {
  $script:ManifestTtlHours = $parsed
}
$script:ManifestRelPath = '.dev/launch-manifest.json'

function Write-ManifestLog([string]$m) {
  Write-Host "[manifest] $m" -ForegroundColor DarkGray
}

function Get-ManifestFullPath {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  return (Join-Path $ProjectRoot $script:ManifestRelPath)
}

function Get-CanonicalizedPath {
  param([Parameter(Mandatory)][string]$Path)
  # Lowercase + forward-slash + strip trailing slash. This is the
  # canonical form both bash and PowerShell writers agree on so cross-
  # language readers compare them bit-equal. PS / cmd / git-bash all
  # throw different separators and case at us; collapsing to one form
  # defends against:
  #   * bash writes "C:/Users/Foo/Proj" (forward slash, mixed case)
  #   * PS  writes "C:\users\foo\proj"  (back slash, lowercase forced)
  #   * cmd calls in with "C:\Users\Foo\Proj\" (trailing slash)
  $full = [System.IO.Path]::GetFullPath($Path)
  $canon = $full.ToLowerInvariant().Replace('\', '/').TrimEnd('/')
  return $canon
}

function Get-DateParser {
  # PS 5.1+ has reliable [DateTimeOffset]::Parse supporting ISO-8601 UTC.
  # We always succeed; mark the writer's runtime so a future schema
  # addition can fork behavior if needed.
  if ($PSVersionTable.PSVersion.Major -ge 7) { return 'ps7' }
  return 'ps5'
}

function Write-Manifest {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][int]$PidServer,
    [Parameter(Mandatory)][int]$PidClient,
    [int]$PidServerPgid = 0,
    [int]$PidClientPgid = 0
  )
  $dir = Join-Path $ProjectRoot '.dev'
  if (-not (Test-Path -LiteralPath $dir)) {
    [void](New-Item -ItemType Directory -Path $dir -Force)
  }
  $final = Get-ManifestFullPath -ProjectRoot $ProjectRoot
  $tmp = "$final.tmp"

  $launchedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $parser = Get-DateParser

  $usesPgid = ($PidServerPgid -gt 0) -or ($PidClientPgid -gt 0)
  $pidServerPgidJson = if ($usesPgid -and ($PidServerPgid -gt 0)) { "$PidServerPgid" } else { 'null' }
  $pidClientPgidJson = if ($usesPgid -and ($PidClientPgid -gt 0)) { "$PidClientPgid" } else { 'null' }

  $escRoot = (Get-CanonicalizedPath -Path $ProjectRoot).Replace('"', '\"')

  # Hand-rolled JSON. ConvertTo-Json works but its field ordering and
  # whitespace are non-deterministic between PS 5.1 and 7; a stable string
  # is friendlier for human inspection AND for the bash reader's regex
  # parser. Both writers emit the SAME field order so diffs stay readable.
  $json = '{' +
    '"projectRoot":"' + $escRoot + '",' +
    '"launchedAt":"' + $launchedAt + '",' +
    '"dateParser":"' + $parser + '",' +
    '"pidServer":' + $PidServer + ',' +
    '"pidClient":' + $PidClient + ',' +
    '"pidServerPgid":' + $pidServerPgidJson + ',' +
    '"pidClientPgid":' + $pidClientPgidJson + ',' +
    '"ttlHours":' + $script:ManifestTtlHours +
    '}'

  # UTF-8 WITHOUT BOM. Set-Content -Encoding UTF8 in PS 5.1 inserts a BOM
  # which corrupts bash `cat | sed` parsing. Use the .NET class directly
  # to guarantee no BOM. Cross-volume moves are NOT atomic; same-volume
  # .tmp -> final is atomic at the file-system level.
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tmp, $json, $utf8NoBom)

  # Atomic-ish rename. Move-Item with -Force overwrites. On NTFS in the
  # same directory, this is atomic (rename under the hood).
  try {
    Move-Item -LiteralPath $tmp -Destination $final -Force
  } catch {
    Write-ManifestLog "manifest: mv failed ($_)"
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    throw
  }
}

# Returns a hashtable with parsed manifest fields, or $null if the
# manifest is missing / unreadable / projectRoot-mismatched / stale /
# parsable but field-incomplete.
function Read-Manifest {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  $final = Get-ManifestFullPath -ProjectRoot $ProjectRoot
  if (-not (Test-Path -LiteralPath $final)) {
    Write-ManifestLog "no manifest at $final"
    return $null
  }
  try {
    $raw = [System.IO.File]::ReadAllText($final).Replace("`r`n", "`n").Replace("`r", "`n")
  } catch {
    Write-ManifestLog "manifest read failed: $_"
    return $null
  }
  if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-ManifestLog 'manifest empty'
    return $null
  }

  # Hand-rolled regex extraction. Avoids the ConvertFrom-Json parser
  # (which would lose intent on a hand-edited file) and ensures cross-
  # language compat with the bash reader's sed extraction.
  $prMatch    = [regex]::Match($raw, '"projectRoot"\s*:\s*"([^"]+)"')
  $ltMatch    = [regex]::Match($raw, '"launchedAt"\s*:\s*"([^"]+)"')
  $tsMatch    = [regex]::Match($raw, '"ttlHours"\s*:\s*([0-9]+)')
  $parserMatch = [regex]::Match($raw, '"dateParser"\s*:\s*"([^"]+)"')
  $psMatch    = [regex]::Match($raw, '"pidServer"\s*:\s*([0-9]+)')
  $pcMatch    = [regex]::Match($raw, '"pidClient"\s*:\s*([0-9]+)')
  $psPgMatch  = [regex]::Match($raw, '"pidServerPgid"\s*:\s*([0-9]+)')
  $pcPgMatch  = [regex]::Match($raw, '"pidClientPgid"\s*:\s*([0-9]+)')

  if (-not ($prMatch.Success -and $ltMatch.Success)) {
    Write-ManifestLog 'manifest: missing required fields (projectRoot or launchedAt)'
    return $null
  }
  if (-not ($psMatch.Success -and $pcMatch.Success)) {
    Write-ManifestLog 'manifest: missing pidServer/pidClient'
    return $null
  }
  $pr = $prMatch.Groups[1].Value
  $lt = $ltMatch.Groups[1].Value
  $ttl = if ($tsMatch.Success) { [int]$tsMatch.Groups[1].Value } else { $script:ManifestTtlHours }
  $parser = if ($parserMatch.Success) { $parserMatch.Groups[1].Value } else { 'legacy' }

  # DEFENSE: refuse if the writer-flagged parser is "unsupported" (would
  # have been set by bash write_manifest when both date branches failed).
  # On such a platform we cannot trust TTL math -- refuse rather than
  # risk killing a recycled PID.
  if ($parser -in @('unsupported', '')) {
    Write-ManifestLog "manifest: dateParser='$parser' -- cannot verify TTL safety; refusing"
    return $null
  }
  # 'legacy' = manifest written before dateParser field existed (mostly
  # bash writers from the v1 schema). Accept as long as launchedAt parses
  # cleanly with PS's reliable [DateTimeOffset]::Parse.

  # projectRoot comparison -- canonicalize both sides so PS / bash /
  # cmd path-style differences don't false-trigger a mismatch.
  $prCanon = Get-CanonicalizedPath -Path $pr
  $callerCanon = Get-CanonicalizedPath -Path $ProjectRoot
  if ($prCanon -ne $callerCanon) {
    Write-ManifestLog "manifest: projectRoot mismatch: file='$pr' (= '$prCanon') caller='$ProjectRoot' (= '$callerCanon') -- refusing"
    return $null
  }

  # TTL staleness
  $nowEpoch = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  try {
    $launchedEpoch = [int][DateTimeOffset]::Parse($lt).ToUnixTimeSeconds()
  } catch {
    Write-ManifestLog "manifest: cannot parse launchedAt='$lt' -- treating as stale"
    return $null
  }
  if ($launchedEpoch -le 0) {
    Write-ManifestLog 'manifest: launchedEpoch non-positive -- treating as stale'
    return $null
  }
  $age = $nowEpoch - $launchedEpoch
  $ttlSeconds = $ttl * 3600
  if ($age -gt $ttlSeconds) {
    Write-ManifestLog "manifest: stale (age=${age}s > ttl=${ttlSeconds}s); own PIDs almost certainly recycled"
    return $null
  }

  $h = @{
    projectRoot = $pr
    launchedAt  = $lt
    ttlHours    = $ttl
    dateParser  = $parser
    pidServer   = [int]$psMatch.Groups[1].Value
    pidClient   = [int]$pcMatch.Groups[1].Value
  }
  if ($psPgMatch.Success) { $h['pidServerPgid'] = [int]$psPgMatch.Groups[1].Value } else { $h['pidServerPgid'] = $null }
  if ($pcPgMatch.Success) { $h['pidClientPgid'] = [int]$pcPgMatch.Groups[1].Value } else { $h['pidClientPgid'] = $null }
  return $h
}

# Is a PID alive? PS 5.1's `Get-Process -Id $targetPid -EA SilentlyContinue`
# returns $null if the PID is gone. Wrapped in a function so the caller
# doesn't accidentally trigger case-insensitive $PID collision by writing
# `$pid = ...` locally.
function Test-PidAlive {
  param([Parameter(Mandatory)][int]$targetPid)
  if ($targetPid -le 0) { return $false }
  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  return ($null -ne $p)
}

# Tree-kill a PID. On Windows, taskkill /T walks the job-object tree
# atomically (children, grandchildren, etc. all die) -- this is the PS
# analog of bash's `kill -TERM -${pgid}` (whole process group). Best-
# effort: never raises. If the process is already gone, no-op.
function Kill-Manifest-Owner {
  param(
    [Parameter(Mandatory)][int]$targetPid,
    [int]$Pgid = 0
  )
  if (-not (Test-PidAlive -targetPid $targetPid)) { return }
  try {
    # Capture output for diagnostics but don't bubble non-zero exit codes --
    # a kill failure is best-effort and shouldn't tear the wrapper down.
    $out = & taskkill /F /T /PID $targetPid 2>&1
    # Trim last line of output for parity with bash's silent TERMINATION.
    if ($LASTEXITCODE -ne 0) {
      Write-ManifestLog "taskkill exit=$LASTEXITCODE for pid=$targetPid (best-effort, ignored)"
    }
  } catch {
    Write-ManifestLog "taskkill threw for pid=$targetPid : $_"
  }
}

function Clear-Manifest {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  $final = Get-ManifestFullPath -ProjectRoot $ProjectRoot
  if (Test-Path -LiteralPath $final) {
    Remove-Item -LiteralPath $final -Force -ErrorAction SilentlyContinue
  }
}
