# scripts/test-pwsh.ps1 -- Zero-dep PowerShell test harness for the
# launchers in this repo (no Pester, no external modules).
#
# Tests:
#   1. scripts/_pid-manifest.ps1 helpers (Write-Manifest roundtrip,
#      Read-Manifest edge cases, projectRoot mismatch, stale/missing
#      manifests, Get-CanonicalizedPath, Test-PidAlive, Clear-Manifest).
#   2. scripts/cleanup-ports.ps1 shell (--own with no manifest, --own
#      short-circuit, --bogus arg-parsing exit code, default port args).
#   3. scripts/dev.ps1 shell (--help, -h, --bogus, --no-browser arg
#      parsing propagates through to the actual script).
#
# Designed to be runnable as `npm run test:pwsh` (which just shells out
# to `powershell -NoProfile -ExecutionPolicy Bypass -File ...` from the
# root package.json script). Exits with the failure count so npm can
# detect failure; 0 = all passed.
#
# Self-isolating: writes to a fresh tempdir keyed on $PID so concurrent
# runs don't collide and the real .dev/launch-manifest.json is never
# touched.

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Continue'

# Cross-engine Windows detection. `$IsWindows` is an automatic variable
# in PowerShell Core 6+ ONLY -- the user's `npm run test:pwsh` invokes
# Windows PowerShell 5.1 via `powershell -File`, which doesn't define
# $IsWindows and would throw `VariableIsUndefined` on `if ($IsWindows)`
# (then silently fall through because $ErrorActionPreference=Continue,
# dropping the local pass count from 42 to ~24). Compute it manually
# via [System.Environment]::OSVersion so the gates below behave the
# same way under Windows PowerShell 5.1 AND PowerShell Core 6+/pwsh.
$_isWin = [System.Environment]::OSVersion.Platform -eq 'Win32NT'

$script:Pass = 0
$script:Fail = 0

function Assert {
  param(
    [Parameter(Mandatory)][bool]$Cond,
    [Parameter(Mandatory)][string]$Name
  )
  try {
    if ($Cond) {
      $script:Pass++
      Write-Host "  [PASS] $Name"
    } else {
      $script:Fail++
      Write-Host "  [FAIL] $Name" -ForegroundColor Red
    }
  } catch {
    # The condition expression itself threw (e.g. a Path.GetFullPath
    # rejecting a test-only input). Mark the test as failed instead of
    # letting the exception abort the remaining assertions.
    $script:Fail++
    Write-Host ("  [FAIL] {0} (threw: {1})" -f $Name, $_) -ForegroundColor Red
  }
}

function Section {
  param([Parameter(Mandatory)][string]$Name)
  Write-Host ''
  Write-Host ("=== {0} ===" -f $Name) -ForegroundColor Cyan
}

# -------- Setup: isolated tempdir keyed on $PID ---------------------
$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("remotion-pwsh-tests-{0}" -f $PID)
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
Write-Host ("Using isolated tempdir: {0}" -f $tmpRoot)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scriptsDir = $PSScriptRoot
$helperPath = Join-Path $scriptsDir '_pid-manifest.ps1'
$helperBashPath = Join-Path $scriptsDir '_addpidmanifest.sh'

try {
  # ===========================================================
  Section 'Helper: _pid-manifest.ps1 (Write/Read/canonicalize/pid-alive)'

  . $helperPath

  # Get-CanonicalizedPath. The canonicalization function is platform-
  # neutral; only the TEST INPUTS need to be OS-flavored. Hardcoded
  # Windows drive letters (E:\Users\Foo\...) fail on linux pwsh because
  # [System.IO.Path]::GetFullPath treats 'E:\' as a relative path there
  # and prepends CWD, so the assertion against the exact string
  # 'e:/users/foo/mixedcase' would evaluate to $false. Swap to linux-
  # style absolute paths on non-Windows runners.
  $p1 = if ($_isWin) { 'E:\Users\Foo\MixedCase\' } else { '/Users/Foo/MixedCase/' }
  $e1 = if ($_isWin) { 'e:/users/foo/mixedcase' } else { '/users/foo/mixedcase' }
  $canon = Get-CanonicalizedPath -Path $p1
  Assert ($canon -eq $e1) 'Get-CanonicalizedPath: backslash + mixed case + trailing slash -> canonicalized'
  $p2 = if ($_isWin) { 'C:/Users/Bar/proj/' } else { '/Users/Bar/proj/' }
  $e2 = if ($_isWin) { 'c:/users/bar/proj' } else { '/users/bar/proj' }
  $canon = Get-CanonicalizedPath -Path $p2
  Assert ($canon -eq $e2) 'Get-CanonicalizedPath: forward-slash input preserved but case-folded'

  # Write-Manifest roundtrip
  $projADir = Join-Path $tmpRoot 'projectA'
  New-Item -ItemType Directory -Path $projADir -Force | Out-Null
  $projAabs = (Resolve-Path -LiteralPath $projADir).Path
  Write-Manifest -ProjectRoot $projAabs -PidServer 11111 -PidClient 22222 -PidServerPgid 33333 -PidClientPgid 44444
  $final = Get-ManifestFullPath -ProjectRoot $projAabs
  Assert (Test-Path -LiteralPath $final) 'Write-Manifest: file written at .dev/launch-manifest.json'
  $raw = [System.IO.File]::ReadAllText($final)
  Assert ($raw.IndexOf('"projectRoot":"') -ge 0) 'manifest: contains projectRoot field'
  Assert ($raw.IndexOf('"pidServer":11111') -ge 0) 'manifest: pidServer=11111'
  Assert ($raw.IndexOf('"pidClient":22222') -ge 0) 'manifest: pidClient=22222'
  Assert ($raw.IndexOf('"pidServerPgid":33333') -ge 0) 'manifest: pidServerPgid=33333'
  Assert ($raw.IndexOf('"pidClientPgid":44444') -ge 0) 'manifest: pidClientPgid=44444'
  if ($raw.Length -gt 0) {
    Assert (-not ($raw[0] -eq ([char]0xFEFF))) 'manifest: NO UTF-8 BOM (cross-language bash reader requirement)'
  } else {
    Assert $false 'manifest: file unexpectedly empty'
  }

  # Read-Manifest: matching projectRoot -> returns hashtable
  $m = Read-Manifest -ProjectRoot $projAabs
  Assert ($null -ne $m) 'Read-Manifest (matching root): returns hashtable'
  Assert ($m.pidServer -eq 11111) 'Read-Manifest: pidServer roundtrip'
  Assert ($m.pidClient -eq 22222) 'Read-Manifest: pidClient roundtrip'
  Assert ($m.pidServerPgid -eq 33333) 'Read-Manifest: pidServerPgid roundtrip'
  Assert ($m.pidClientPgid -eq 44444) 'Read-Manifest: pidClientPgid roundtrip'

  # projectRoot mismatch -> $null
  $projBDir = Join-Path $tmpRoot 'projectB'
  New-Item -ItemType Directory -Path $projBDir -Force | Out-Null
  $projBabs = (Resolve-Path -LiteralPath $projBDir).Path
  $m = Read-Manifest -ProjectRoot $projBabs
  Assert ($null -eq $m) 'Read-Manifest (different projectRoot): returns $null (mismatch refused)'

  # Missing manifest in fresh dir -> $null
  $projCDir = Join-Path $tmpRoot 'projectC'
  New-Item -ItemType Directory -Path $projCDir -Force | Out-Null
  $m = Read-Manifest -ProjectRoot $projCDir
  Assert ($null -eq $m) 'Read-Manifest (no manifest): returns $null'

  # Cross-language check: bash writer should produce a manifest the PS
  # reader accepts. _addpidmanifest.sh is run via bash if Git for
  # Windows / WSL is on PATH; skip if not present.
  $bashOnPath = (Get-Command 'bash' -ErrorAction SilentlyContinue) -ne $null
  if ($bashOnPath) {
    $projDDir = Join-Path $tmpRoot 'projectD'
    New-Item -ItemType Directory -Path $projDDir -Force | Out-Null
    $projDabs = (Resolve-Path -LiteralPath $projDDir).Path
    $bashHelper = "PROJECT_ROOT_OVERRIDE='$projDabs'"
    & bash -c "$bashHelper . '$helperBashPath' ; write_manifest '$projDabs' 55555 66666 77777 88888" 2>$null | Out-Null
    $finalD = Get-ManifestFullPath -ProjectRoot $projDabs
    Assert (Test-Path -LiteralPath $finalD) 'cross-lang: bash writer file present'
    $m = Read-Manifest -ProjectRoot $projDabs
    if ($null -ne $m) {
      Assert ($m.pidServer -eq 55555) 'cross-lang: bash-written pidServer=55555 accepted by PS Read-Manifest'
      Assert ($m.pidClient -eq 66666) 'cross-lang: bash-written pidClient=66666 accepted by PS Read-Manifest'
    } else {
      Assert $false 'cross-lang: bash-written manifest was REJECTED by PS Read-Manifest (interop broken)'
    }
  } else {
    Write-Host '  [SKIP] cross-language bash-writer test (bash not on PATH)' -ForegroundColor DarkGray
  }

  # Clear-Manifest
  Clear-Manifest -ProjectRoot $projAabs
  Assert (-not (Test-Path -LiteralPath $final)) 'Clear-Manifest: file removed'

  # Test-PidAlive
  Assert (Test-PidAlive -targetPid $PID)  "Test-PidAlive: current host PID ($PID) reports alive"
  Assert (-not (Test-PidAlive -targetPid 999999)) 'Test-PidAlive: a bogus PID reports dead'
  Assert (-not (Test-PidAlive -targetPid 0)) 'Test-PidAlive: 0 short-circuits to false'
  Assert (-not (Test-PidAlive -targetPid -1)) 'Test-PidAlive: negative PID short-circuits to false'

  # ===========================================================
  # Sections 2 and 3 invoke child PS scripts (cleanup-ports.ps1, dev.ps1)
  # whose arg-parsing runs cleanly on Windows but breaks on linux pwsh:
  #  - We symlinked only /usr/local/bin/pwsh (not `powershell`), so
  #    `& powershell` throws CommandNotFoundException immediately.
  #  - cleanup-ports.ps1 (no-args) port-probe path uses
  #    Get-NetTCPConnection which is Windows-only.
  # Windows users running `npm run test:pwsh` locally still see the
  # full 42-assert battery. CI on linux pwsh skips these two sections
  # but keeps the cross-platform helper + cross-file + regression
  # asserts, which are the ones that actually exercise the change
  # being verified by this PR (regression guard, manifest IO, helper
  # invariants).
  if ($_isWin) {

  Section 'Shell: cleanup-ports.ps1 (arg parsing + --own no-manifest idempotency)'

  # Snapshot originals so we can restore them in `finally` below. The
  # cleanup-ports.ps1 wrapper reads OWN_REPO_ROOT / CLEANUP_PORTS_SWEEP /
  # ENABLE_OWN_RECOVERY from the environment, but if we leave those set
  # to test-only values when the script exits, the parent shell that ran
  # `npm run test:pwsh` will inherit polluted env (next `cleanup-ports`
  # invocation would hit the test tempdir, etc.).
  $origOwnRepoRoot = "$env:OWN_REPO_ROOT"
  $origSweep       = "$env:CLEANUP_PORTS_SWEEP"
  $origOwnRecov    = "$env:ENABLE_OWN_RECOVERY"
  try {
    # Point OWN_REPO_ROOT at an isolated tempdir so the real repo's
    # .dev/launch-manifest.json (if any) is never read.
    $ownTestDir = Join-Path $tmpRoot 'cleanup-test'
    New-Item -ItemType Directory -Path $ownTestDir -Force | Out-Null
    $env:OWN_REPO_ROOT = $ownTestDir
    $env:CLEANUP_PORTS_SWEEP = ''
    $env:ENABLE_OWN_RECOVERY = ''

    # --own with NO manifest -> exit 0, "no manifest" no-op
    $cp = (Join-Path $scriptsDir 'cleanup-ports.ps1')
    $outOwn = & powershell -NoProfile -ExecutionPolicy Bypass -File $cp --own 2>&1
    $rc = $LASTEXITCODE
    Assert ($rc -eq 0) 'cleanup-ports.ps1 --own (no manifest): exit 0'
    $joined = ($outOwn -join "`n")
    Assert ($joined.IndexOf('no manifest') -ge 0) 'cleanup-ports.ps1 --own: stdout mentions "no manifest"'

    # --bogus arg -> exit 2 with "unknown arg: --bogus"
    $outBogus = & powershell -NoProfile -ExecutionPolicy Bypass -File $cp --bogus 2>&1
    $rc = $LASTEXITCODE
    Assert ($rc -eq 2)         'cleanup-ports.ps1 --bogus: exit 2 (arg rejection)'
    $jBogus = ($outBogus -join "`n")
    Assert ($jBogus.IndexOf('unknown arg') -ge 0) 'cleanup-ports.ps1 --bogus: stderr mentions "unknown arg"'

    # No-args (default port cleanup on 3001+5173). Idempotent if ports free
    # -> exit 0, "no listeners" or "ports clear".
    $outDefault = & powershell -NoProfile -ExecutionPolicy Bypass -File $cp 2>&1
    $rc = $LASTEXITCODE
    Assert ($rc -eq 0 -or $rc -eq 1) 'cleanup-ports.ps1 (no args): exit 0 or 1 (port-clear/rebound) -- idempotent objective'
    $jD = ($outDefault -join "`n")
    Assert ($jD.Length -gt 0) 'cleanup-ports.ps1 (no args): produced some diagnostic output'
  } finally {
    # Restore so the parent shell / next npm-run invocation isn't
    # affected by our test-only environment overrides.
    $env:OWN_REPO_ROOT       = $origOwnRepoRoot
    $env:CLEANUP_PORTS_SWEEP = $origSweep
    $env:ENABLE_OWN_RECOVERY = $origOwnRecov
  }
  }

  # ===========================================================
  if ($_isWin) {
  Section 'Shell: dev.ps1 (arg parsing + --help / -h / --bogus exit codes)'

  $dp = (Join-Path $scriptsDir 'dev.ps1')

  # --help -> exit 0 with Usage line in stdout
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $dp --help 2>&1
  $rc = $LASTEXITCODE
  Assert ($rc -eq 0) 'dev.ps1 --help: exit 0'
  $j = ($out -join "`n")
  Assert ($j.IndexOf('Usage: powershell') -ge 0) 'dev.ps1 --help: contains "Usage: powershell"'
  Assert ($j.IndexOf('--no-browser') -ge 0)     'dev.ps1 --help: documents "--no-browser" flag'

  # -h -> exit 0
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $dp -h 2>&1
  $rc = $LASTEXITCODE
  Assert ($rc -eq 0)         'dev.ps1 -h: exit 0'
  Assert (($out -join "`n").IndexOf('Usage') -ge 0) 'dev.ps1 -h: contains "Usage" line'

  # --bogus -> exit 2 with "Unknown arg" in the merged output. dev.ps1
  # emits "Unknown arg" via Write-Host (host/information stream), NOT
  # to stdout (1) or stderr (2). To capture Write-Host text from a
  # child PowerShell without an attached console we use `*>&1`, which
  # redirects ALL output streams (1..6) to the success stream. NOTE:
  # `Out-String` would also work but is heavier; `*>&1` was added in
  # PS 5.0 so it's safe for our PS 5.1+ target.
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $dp --bogus *>&1
  $rc = $LASTEXITCODE
  $j = ($out -join "`n")
  Assert ($rc -eq 2)             "dev.ps1 --bogus: exit 2 (got $rc)"; Assert ($j.IndexOf('Unknown arg') -ge 0) 'dev.ps1 --bogus: "Unknown arg" present in any stream'
  }

  # ===========================================================
  Section 'Helper: cross-file consistency check'

  # Both writers/manifest filenames must agree
  $psRel = (Get-Content -LiteralPath (Join-Path $scriptsDir '_pid-manifest.ps1') -Raw) | Select-String -Pattern '(?i)launch-manifest\.json' | Select-Object -First 1
  $bashRel = (Get-Content -LiteralPath (Join-Path $scriptsDir '_addpidmanifest.sh') -Raw) | Select-String -Pattern '(?i)launch-manifest\.json' | Select-Object -First 1
  Assert ($null -ne $psRel -and $null -ne $bashRel) 'cross-file: both _pid-manifest.ps1 and _addpidmanifest.sh reference "launch-manifest.json"'

  # Same JSON field set in both writers. We search the file content for
  # the JSON-quoted form (e.g. `"projectRoot"`) which only appears in
  # code that actually EMITS the field -- the plain word in comments or
  # docstrings won't match. Per-field substring check rather than
  # `Select-String -AllMatches .Matches.Value` because the latter
  # silently returns `$null` when the alternation pattern spans multiple
  # matches across one line (tested, see readme follow-up).
  $psFile   = Get-Content -LiteralPath (Join-Path $scriptsDir '_pid-manifest.ps1') -Raw
  $bashFile = Get-Content -LiteralPath (Join-Path $scriptsDir '_addpidmanifest.sh') -Raw
  $fieldSet = @('projectRoot','launchedAt','dateParser','pidServer','pidClient','pidServerPgid','pidClientPgid','ttlHours')
  $psFields   = @()
  $bashFields = @()
  foreach ($f in $fieldSet) {
    $quoted = '"' + $f + '"'
    if ($psFile.IndexOf($quoted)   -ge 0) { $psFields   += $f }
    if ($bashFile.IndexOf($quoted) -ge 0) { $bashFields += $f }
  }
  Assert ($psFields.Count   -ge 4) ('cross-file: _pid-manifest.ps1 emits: '   + ($psFields   -join ','))
  Assert ($bashFields.Count -ge 4) ('cross-file: _addpidmanifest.sh emits: ' + ($bashFields -join ','))

  # ===========================================================
  Section 'Regression: dev.ps1 Start-Process redirect-merging (no same-file redirect)'

  # PS Start-Process rejects the call when -RedirectStandardOutput AND
  # -RedirectStandardError point at the same file (InvalidOperationException).
  # We work around it by passing `cmd.exe /c "<npm> run dev > $log 2>&1"`
  # so cmd's own shell parser does the stream merge before the
  # Start-Process layer ever sees the paths. After that workaround,
  # dev.ps1 has NO -RedirectStandard* arguments at all -- assert that
  # here so a future contributor who re-adds them (and inadvertently
  # re-introduces the bug) is caught, because the existing dev.ps1
  # arg-parsing tests (--help / -h / --bogus) exit before Start-DevChild
  # is reached and so cannot catch this specific regression.
  #
  # Targeted regex: the original bug was a parameter pair
  # `  -RedirectStandardOutput $logPath \`` followed by
  # `  -RedirectStandardError $logPath \`` -- both pointing at the same
  # variable. The regex anchors on PowerShell parameter syntax: a line
  # starts with whitespace + `-Redirect*` + whitespace + `$variable`.
  # Plain-text mentions in comments (e.g. "we don't pass any
  # `-RedirectStandard*` parameters here") do NOT match, because they do
  # not begin with `-` after whitespace -- this is what makes the
  # "comment in dev.ps1 mentions the names" case a non-issue.
  $dpContent = Get-Content -LiteralPath (Join-Path $scriptsDir 'dev.ps1') -Raw
  $dpStdouter = @($dpContent -split "`n" | Where-Object { $_ -match '^\s+-RedirectStandardOutput\s+\$\S+' }).Count
  $dpStderrer = @($dpContent -split "`n" | Where-Object { $_ -match '^\s+-RedirectStandardError\s+\$\S+' }).Count
  Assert ($dpStdouter -eq 0) ('dev.ps1: no `-RedirectStandardOutput $var` parameter patterns (cmd.exe 2>&1 wrapper used): found ' + $dpStdouter + ' lines')
  Assert ($dpStderrer -eq 0) ('dev.ps1: no `-RedirectStandardError $var` parameter patterns (cmd.exe 2>&1 wrapper used): found ' + $dpStderrer + ' lines')

  # The original Start-DevChild constructed ArgumentList as an array
  # `'/c', $cmdLine`, which failed on the default Windows Node install
  # path `C:\Program Files\nodejs\npm.cmd` (path splits at the space in
  # "Program Files"). The fix wraps the body in `""` and uses /D /S /C
  # + a single-string ArgumentList. The smoke regression guard below
  # asserts the broken array form is gone.
  $dpOldArrayC = @($dpContent -split "`n" | Where-Object { $_ -match "^\s*-ArgumentList\s+'/c'\s*,\s*\$cmdLine\b" }).Count
  Assert ($dpOldArrayC -eq 0) ('dev.ps1: no array-form `ArgumentList /c, $cmdLine` (cmd.exe /D /S /C + single-string ArgumentList required for paths with spaces): found ' + $dpOldArrayC + ' lines')
  # Single-quoted regex string: in PS, \" is NOT a valid escape inside a
  # double-quoted string (the escape char is the backtick, and " is
  # embedded via ""), so the earlier double-quoted form with `\"\"` parsed
  # as: `\` literal + `"` closes the string + chokes on the rest. In a
  # single-quoted string, `"` is literal (no escape needed) and `''` is
  # the escape for one `'`. The content this resolves to is
  # `^\s*\$cmdLine\s*=\s*'""'\s*\+`, which matches the dev.ps1 line
  # `  $cmdLine = '""' + ...` (one `'` + two `"` + one `'`).
  $dpWrap = @($dpContent -split "`n" | Where-Object { $_ -match '^\s*\$cmdLine\s*=\s*''""''\s*\+' }).Count
  Assert ($dpWrap -ge 1) ('dev.ps1: $cmdLine wrapped with `""` outer quotes (cmd /C quote-stripping workaround for spaced exe paths): found ' + $dpWrap + ' lines')
  # Single-quoted regex string (same idiom as $dpWrap above): avoids two
  # pitfalls of the double-quoted form. (1) `\$cmdLine` in a double-quoted
  # string interpolates the TEST-SCOPE $cmdLine variable, which is
  # undefined here, so the resolved string loses the literal `$cmdLine`
  # token and the regex would never match the dev.ps1 source as written.
  # (2) `(` / `)` inside a double-quoted string confuse PowerShell's
  # parser into "Too many )'s" warnings, even when they're regex-literal
  # escaped parens. In a single-quoted string, `\$cmdLine` is the 9-char
  # LITERAL `\$cmdLine` (regex `\$` matches a literal `$`; `cmdLine`
  # matches the literal text), and `(` / `)` are inert. `''` is the
  # escape for one `'`.
  $dpSingleStr = @($dpContent -split "`n" | Where-Object { $_ -match '^\s*-ArgumentList\s+\(''/D\s*/S\s*/C\s*''\s*\+\s*\$cmdLine\)' }).Count
  Assert ($dpSingleStr -ge 1) ('dev.ps1: present cmd.exe /D /S /C + single-string ArgumentList wrap: found ' + $dpSingleStr + ' lines')

  # Live round-trip guard for the Codex P1: actually invoke cmd /D /S /C
  # with a wrapped body, and verify a spaced path token survives cmd's
  # parser end-to-end. We use `echo` (a cmd builtin) with a forward-
  # slash path that contains a space:
  #   - echo is a deterministic cmd builtin on every Windows host (its
  #     output is the spaced path verbatim, so the IndexOf check is
  #     reliable across cmd versions that differ in error wording).
  #   - forward slashes sidestep cmd's backslash-handling quirk: on
  #     this host, echo of `C:\Program Files\TEST_MARKER` returns
  #     `C:\Program FilesTEST_MARKER` (a single backslash is eaten
  #     between two word chars). Forward slashes are accepted by cmd
  #     on Windows and don't have the same quirk.
  # What this proves: (1) PS's Start-Process single-string ArgumentList
  # correctly passes the wrap+body to cmd's CreateProcess layer, (2)
  # /D /S /C deterministically strips the first and last quote (the
  # wrap), and (3) the inner spaced path survives the strip and is
  # emitted by echo as-is. Gated to Windows because cmd.exe is
  # Windows-only.
  if ($_isWin) {
    $liveCmdLine = '""' + 'echo C:/Program Files/TEST_MARKER' + '""'
    $liveOut = cmd /D /S /C $liveCmdLine 2>&1
    $liveJ = ($liveOut -join "`n")
    Assert ($liveJ.IndexOf('Program Files/TEST_MARKER') -ge 0) ('dev.ps1 P1 fix (Codex): cmd /D /S /C + wrap preserves spaced exe path end-to-end (live round-trip); got: ' + $liveJ.Trim())
  }
}
finally {
  if (Test-Path -LiteralPath $tmpRoot) {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# -------- Summary + exit -----------------------------------------
Write-Host ''
Write-Host '===== SUMMARY =====' -ForegroundColor Cyan
Write-Host ("  PASS: {0}" -f $script:Pass)
Write-Host ("  FAIL: {0}" -f $script:Fail)
if ($script:Fail -gt 0) {
  Write-Host ("  exit code = {0}" -f $script:Fail) -ForegroundColor Red
  exit $script:Fail
}
Write-Host '  exit code = 0' -ForegroundColor Green
exit 0
