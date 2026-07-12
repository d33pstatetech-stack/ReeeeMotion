# Remotion Video Editor — GUI launcher

Three small "double-click to run" wrappers at the repo root so a user
who's never opened a terminal can boot the whole editor + open it in
their browser.

| OS / shell | File | What to do |
|---|---|---|
| **Windows** (bash available — Git for Windows) | `start.cmd` | Double-click in Explorer. A console window opens, the dev stack boots, and your default browser navigates to <http://localhost:5173/>. |
| **Windows** (PowerShell only — no bash) | `start.ps1` | Right-click in Explorer → **Run with PowerShell** (first time: Properties → Unblock). Same UX as `start.cmd`, no Git-for-Windows dependency. |
| **Windows** (auto-detect — either backend works) | `start.cmd` | Auto-detects bash first (preferred) and PowerShell second. If Git for Windows is uninstalled, .cmd transparently falls back to PowerShell. |
| **macOS** | `start.command` | Double-click in Finder. The first time macOS Gatekeeper will block it ("from an unidentified developer") — right-click → **Open** → confirm. Subsequent double-clicks run immediately. |
| **Linux / WSL / from a terminal** | `bash start.sh` | Run from the repo root: `bash start.sh` (or `./start.sh` after `chmod +x start.sh`). |
| **All OS, GUI-mode** | `npm run electron:start` then `npm run electron:dist` | Optional graphical launcher with embedded log, brand icon, and click-to-open browser. |

All four forward to `scripts/dev.sh` via a thin shell layer, which:

1. **Safe preflight (`--own`)** — reads `.dev/launch-manifest.json`
   (written by the previous launch of `scripts/dev.sh`) and
   tree-kills ONLY the PIDs it lists. NEVER touches listeners on the
   ports. Five-state outcome table:

   | Manifest state | Behavior |
   |---|---|
   | Manifest missing | No-op — this is the expected state on a fresh checkout. |
   | PIDs already dead | No-op — TTL (24h by default) catches false positives from PID recycling. |
   | PIDs alive, projectRoot matches | Tree-kill only our stack. |
   | projectRoot mismatch | Refuse — defensive against another project's manifest living in a sibling folder. |
   | Combined with `--sweep` or explicit ports | Run --own first, then fall through to belt-clean. |

2. **Port preflight** — refuses to start if `:3001` or `:5173` is
   bound by an unrelated process. The error message tells you exactly
   how to free the port. (The `--own` check above is the
   belt-and-braces that runs FIRST and is silent on success.)
3. **Boot** — `npm run dev` in `server/` (Express on `:3001` via
   `tsx watch`) and `client/` (Vite on `:5173`). Each child gets its
   own session+process group so Ctrl-C closes the whole tree atomically.
4. **Wait** — polls both ports via bash `/dev/tcp` until they answer
   (30-second timeout each), then prints a URL table:
   ```
   ┌──────────────────────────────────────────────────────────────┐
   │  Remotion editor -- local dev stack is UP                     │
   ├──────────────────────────────────────────────────────────────┤
   │  Client UI  →  http://localhost:5173/
   │  API (up.)  →  http://localhost:3001/api/health
   │  Stop       →  Ctrl-C (kills the whole stack)
   └──────────────────────────────────────────────────────────────┘
   ```
5. **Open the browser** — `open` on macOS, `xdg-open` on Linux,
   `cmd.exe /c start ""` on Windows. (Pass `--no-browser` to
   `scripts/dev.sh` directly to skip this.)
6. **Tail logs + trap Ctrl-C** — both `dev-server.*.log` and
   `dev-client.*.log` are tailed in the same console window so you
   can see what each side is doing. Ctrl-C kills child + grandchildren
   via process-group kill (or PID-tree walk if `setsid` is missing).

When `scripts/dev.sh` exits cleanly (Ctrl-C, browser stop, or
deliberate kill), it DELETES the launch manifest so the next launch's
`--own` is a clean no-op. If dev.sh crashed unexpectedly, the manifest
stays in place — that's exactly what `--own` is for.

## Stopping the stack

- Press **Ctrl-C** in the console window the wrapper opened (or
  click "Stop stack" in the Electron launcher).
- Or from another terminal: `bash scripts/cleanup-ports.sh --sweep`.

## Adding a custom launcher icon

The wrappers render as default OS icons today. To brand them:

```bash
# Once-off: install Pillow for icon rasterization.
pip install Pillow

# Regenerate platform icon files from scripts/icons/logo.svg (SVG → PNG → ICO/ICNS).
python3 scripts/icons/build-icons.py
```

This writes:

| File | Purpose | Install step |
|---|---|---|
| `scripts/icons/remotion-editor.ico` | Windows multi-resolution .ico (16/32/48/64/128/256) | Right-click `start.cmd` → Send to → Desktop (create shortcut) → right-click the shortcut → Properties → Change Icon → Browse → `scripts/icons/remotion-editor.ico` |
| `scripts/icons/remotion-editor.icns` | macOS multi-resolution .icns (128/256/512/1024) | Open `start.command` in Finder, Get Info, drag `remotion-editor.icns` onto the icon in the top-left |
| `scripts/icons/remotion-editor.png` | Linux AppIcon (256×256) | Drop into `~/.local/share/icons/hicolor/256x256/apps/` (or your DE's icon theme) |
| `scripts/icons/remotion-editor.desktop` | Linux .desktop launcher | Copy to `~/.local/share/applications/` |

For the bundled Electron installer, the same icon assets are referenced
by `electron-builder.yml` so the installer's branded icon matches
everywhere.

## Forward + backward compatibility of the `--own` manifest schema

Older `.dev/launch-manifest.json` files written before the `dateParser`
field existed are still accepted by `--own`: `read_manifest` defaults
an empty extracted parser to a non-`unsupported` value, so the
staleness check still runs against `launchedAt` (the same field that's
been there since v1) and the 24-hour TTL still applies. If you want to
_force_ recovery of an unknown-shape manifest, delete
`.dev/launch-manifest.json` and re-launch — `--own` will treat the
missing file as a clean no-op.

## Optional: install the packaged Electron launcher

If you want a real GUI window instead of a console tab:

```bash
# 1. Build a local AppImage / NSIS installer / dmg.
npm run electron:dist

# 2. Install it (cross-platform installer output is in ./dist-electron/).
#    • Windows: dist-electron/Remotion Editor Setup 0.1.0.exe
#    • macOS:   dist-electron/Remotion Editor-0.1.0.dmg
#    • Linux:   dist-electron/Remotion Editor-0.1.0.AppImage
```

The Electron launcher has:

- A brand-iconed window with title bar.
- An embedded log panel that tails `dev-server.*.log` and
  `dev-client.*.log` in real time.
- A green status pill while both ports are bound, amber during boot,
  grey when stopped.
- "Open browser" button that calls `shell.openExternal` (forwarded to
  your default browser via the OS — no separate browser-instance
  spawning).
- "Stop stack" button that sends SIGINT to the same bash child that
  `dev.sh` started, so its existing cleanup trap closes everything.
  Critical: the cleanup trap in `scripts/dev.sh` already handles SIGINT
  on every platform, so we don't re-implement teardown logic in
  Electron — we just nudge the existing clean path.

Build artifacts (`dist-electron/`) are gitignored. Cross-platform
builds work natively on each OS (Wine for Windows builds on macOS /
Linux is unsupported in this V1 — run Windows builds on Windows).

### Code-signing (optional)

This V1 ships unsigned. For production distribution, set these
environment variables before `npm run electron:dist`:

- **Windows:** `CSC_LINK` (path to .pfx), `CSC_KEY_PASSWORD`,
  `WINDOWS_CERTIFICATE_PASSWORD`. electron-builder automatically
  signs the NSIS installer with the provided cert.
- **macOS:** `CSC_LINK`, `CSC_KEY_PASSWORD`, plus
  `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID` for the macOS
  notarization step. Without these, macOS will refuse to launch the
  app after the first download.
- **Linux:** AppImage is unsigned by convention; .deb packages can
  use `DEB_SIGN_PRIVATE_KEY`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Windows: `bash is not on your PATH` | Git for Windows isn't installed | `start.cmd` auto-detects and falls back to `scripts\dev.ps1` (PowerShell, built-in Windows 10+). To use bash anyway, install from [git-scm.com](https://git-scm.com/). |
| Windows PowerShell: `cannot be loaded because running scripts is disabled` | Default execution policy on locked-down machine | Pass `-ExecutionPolicy Bypass` (the wrapper already does), or run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` |
| Windows PowerShell: `Get-NetTCPConnection is not recognized` | PowerShell is missing the NetTCPIP module (very rare on default Win10+) | `Install-WindowsFeature -Name NetTCPIP` (admin), or use the bash fallback |
| `port 3001 is already in use` | Another `npm run dev` is running on the same port | Find it (Activity Monitor / Task Manager) and stop, or run `bash scripts/cleanup-ports.sh --sweep` |
| `--own` logs `pid=N already dead -- skipped` | Previous launch crashed; its PIDs were recycled by the OS | Safe — the wrapper will continue to launch normally |
| `--own` logs `manifest projectRoot mismatch` | Another project's dev.sh clobbered our manifest (rare) | Delete `.dev/launch-manifest.json` and re-launch |
| `ERROR: setsid is not installed` | Container / minimal Linux without `util-linux` | `apt install util-linux` (Debian/Ubuntu) or `dnf install util-linux` (RHEL). Or `export ALLOW_NO_SETSID=1 && bash start.sh` to opt into a slow-but-safe PID-tree cleanup fallback |
| Browser doesn't open | Headless / no desktop session | Open <http://localhost:5173/> manually — everything else still works |
| Electron launcher: `Cannot find module 'electron'` | electron deps not installed | Run `npm install` first; electron + electron-builder are devDependencies |
| Electron installer build fails on a non-native OS | electron-builder can't cross-compile binaries | Run `npm run electron:dist` on the OS that matches the target |

## Why three wrappers + an Electron app, not just one

The three shell wrappers are **5-10 lines each** and reuse the
hand-tested `scripts/dev.sh` so we keep a single source of truth for
boot logic. They work without running `npm install` (no Electron
dependency, no 200 MB node_modules churn). The Electron launcher is
optional — drop it on a desktop once and forget about the wrappers.If you only ever launch from a terminal, ignore both wrappers and just run `bash scripts/dev.sh` (POSIX) or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1` (Windows PowerShell). If you only ever use a launcher, you can still grab a terminal with `bash start.sh` for diagnostic dumps.

## PowerShell-native invocation (no bash needed)

Each bash script ships with a PowerShell twin so Windows users without Git for Windows can run the full stack from `powershell.exe` 5.1+ — that ships with Windows 10+ by default.

| bash | PowerShell |
|---|---|
| `bash scripts/cleanup-ports.sh [--own\|--sweep] [PORT...]` | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-ports.ps1 [--own\|--sweep] [PORT...]` |
| `bash scripts/cleanup-ports.sh --own` (safe preflight) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-ports.ps1 --own` |
| `bash scripts/dev.sh [--no-browser]` | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1 [--no-browser]` |
| `bash start.sh` | `.\start.ps1` from a pwsh prompt, or right-click in Explorer → "Run with PowerShell" |
| `bash start.cmd` (Explorer double-click) | Same — `start.cmd` auto-detects: bash → PowerShell fallback. |

If you prefer to run from a `pwsh` or Windows Terminal PowerShell tab:

```powershell
Set-Location E:\path\to\remotion
.\start.ps1                        # full boot, browser opens
.\start.ps1 -NoBrowser             # equivalent of bash start.sh --no-browser
```

Notes:

- The PowerShell scripts dot-source `scripts/_pid-manifest.ps1` (the
  PowerShell twin of `_addpidmanifest.sh`) and write the same
  `.dev/launch-manifest.json` schema. A manifest written by bash and
  read by PowerShell (or vice versa) works — `--own` is
  cross-language safe by design.
- Process cleanup uses `taskkill /F /T /PID <npmPid>` which walks the
  Windows job-object tree atomically. This is the PowerShell analog
  of bash's `setsid` + `kill -TERM -${pgid}` for process-group kill;
  no grandchildren are left orphaned on Ctrl-C.
- PowerShell 5.1+ is supported; pwsh 7+ works too (we don't restrict)
  but isn't required. macOS / Linux users should keep using `bash
  scripts/dev.sh` from `start.command` / `start.sh` — the PowerShell
  scripts are Windows-targeted.
- The shared `_pid-manifest.ps1` uses `[System.IO.File]::WriteAllText`
  with `UTF8Encoding($false)` to avoid the BOM that `Set-Content
  -Encoding UTF8` inserts in PS 5.1 (which would corrupt `bash`'s
  `cat`/`sed` interop).

## Verifying the PowerShell launchers

The `.ps1` launchers ship with a zero-dep test harness:
[`scripts/test-pwsh.ps1`](scripts/test-pwsh.ps1). It dot-sources the
manifest helper, exercises `Write-Manifest` → `Read-Manifest` →
`Get-CanonicalizedPath` → `Test-PidAlive` roundtrips, cross-language
checks (a bash-written `.dev/launch-manifest.json` must be readable
by the PS reader and vice versa, when `bash` is on PATH), and asserts
exit codes for the `cleanup-ports.ps1` / `dev.ps1` arg-parsing paths.
No Pester / no external modules. Run from the repo root:

```powershell
npm run test:pwsh        # exit 0 = all pass; nonzero = N failures
# or directly:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-pwsh.ps1
```

The harness writes to a fresh `%TEMP%\remotion-pwsh-tests-<PID>` dir
so it never touches the real `.dev/launch-manifest.json` and two
concurrent runs can’t clobber each other.

## Execution-policy shortcut

If PowerShell's execution policy blocks running unsigned `.ps1`
scripts (the default on locked-down machines):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
# or, one-time, to relax just for your account:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

`RemoteSigned -Scope CurrentUser` lets you run local unsigned scripts
while still requiring remote/network scripts to be signed. `Bypass`
is a per-invocation flag that does the same without touching the
machine's policy.

## Cross-platform chmod reminder

On Windows git-bash checkout of macOS/Linux files: the executable bit
isn't preserved across `git checkout`. If you commit `start.command` /
`start.sh` and want them to stay executable for the next person, run:

```bash
git update-index --chmod=+x start.command start.sh
```

Or `chmod +x start.command start.sh && git add start.command start.sh`.
