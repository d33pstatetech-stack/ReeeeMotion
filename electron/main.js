// =============================================================================
//   electron/main.js -- main process for the Remotion Editor dev-stack launcher
//
//   Goals (V1, deliberately minimal):
//     * Spawn `bash scripts/dev.sh --no-browser` from the repo root.
//     * Pipe stdout/stderr to the renderer over IPC ("launcher:log" channel).
//     * Expose `launcher:start` / `launcher:stop` / `launcher:open` IPC handlers.
//     * On quit, kill the child so dev.sh's existing cleanup trap closes the
//       whole process group (npm + tsx + vite). We do NOT re-implement teardown --
//       the bash script already does it correctly cross-platform.
//
//   Cross-platform bash discovery:
//     * Windows: prefer %ProgramFiles%\Git\bin\bash.exe; fall back to `where bash`.
//     * macOS / Linux: /bin/bash.
//
//   NOT in scope for V1: terminal-emulator embedding (we use a plain <pre>),
//   code-signing, auto-update, splash screens. All omitted intentionally --
//   the user can add them later without rewriting this file's structure.
// =============================================================================

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Resolve repo root + bash binary.
// ---------------------------------------------------------------------------
const REPO_ROOT = path.join(__dirname, '..');
const ICON_DIR = path.join(REPO_ROOT, 'scripts', 'icons', 'out');
const ICON_PATH = path.join(ICON_DIR, 'remotion-editor-256.png');

function findBash() {
  if (process.platform === 'win32') {
    // Git for Windows installs to %ProgramFiles%\Git\bin\bash.exe by
    // default. Some users keep it under %LOCALAPPDATA%\Programs\Git\...
    // (Microsoft Store variant); the synchronous `where bash` catches
    // both because Git's installer emits the bash.exe into a directory
    // that's already on PATH.
    const where = spawnSync('where', ['bash'], { encoding: 'utf8' });
    if (where.status === 0) {
      const first = where.stdout
        .split(/\r?\n/)
        .map((p) => p.trim())
        .find((p) => /bash\.exe$/i.test(p) && fs.existsSync(p));
      if (first) return first;
    }
    // Last-resort: try the canonical install path.
    const fallback = path.join(
      process.env['ProgramFiles'] || 'C:\\Program Files',
      'Git', 'bin', 'bash.exe',
    );
    if (fs.existsSync(fallback)) return fallback;
    throw new Error('bash not found on Windows. Install Git for Windows.');
  }
  // POSIX -- /bin/bash is canonical on Linux + macOS.
  return '/bin/bash';
}

// Resolve BASH now but defer the friendly-error dialog surfacing to
// createWindow(). Doing the dialog call here would race app.ready and not
// work reliably across electron builds. We capture the message and surface
// it when the window is up.
let BASH;
let bashErrorMessage = null;
try {
  BASH = findBash();
} catch (e) {
  BASH = null;
  bashErrorMessage = e.message;
  // eslint-disable-next-line no-console
  console.error('[electron]', e.message);
}

// ---------------------------------------------------------------------------
// IPC + window.
// ---------------------------------------------------------------------------
let win = null;
let devProc = null;            // Node ChildProcess handle.
// Idempotency flag for gracefulKill() across the three lifecycle paths
// (window.on('closed') + before-quit + window-all-closed). Without this we
// saw up to 3 taskkill calls per session end in earlier iterations. Reset
// to false in devProc.on('exit') so a stack restart within the same
// Electron session can teardown normally on its own close.
let killedAlready = false;
let healthTimer = null;        // Startup polling interval.

function createWindow() {
  win = new BrowserWindow({
    width: 1024,
    height: 740,
    minWidth: 720,
    minHeight: 480,
    title: 'Remotion Editor — dev stack',
    backgroundColor: '#0f172a',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Don't auto-open DevTools; users can force it with `?devtools=1`.
  if (process.argv.includes('?devtools=1')
      || process.env.REMOTION_EDITOR_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Surface the bash-not-found error as a friendly modal AFTER the app is
  // ready (so dialog.showErrorBox works). Without this the user would see
  // Electron's stock crash modal instead of "Install Git for Windows".
  if (bashErrorMessage) {
    dialog.showErrorBox('Bash not found', bashErrorMessage);
  }

  // Stop the dev stack when the main window closes, so the child doesn't
  // outlive the GUI. Before-quit covers the case where the user quits via
  // Cmd-Q (macOS) or Alt-F4 without closing the window first.
  win.on('closed', () => {
    win = null;
    gracefulKill();
  });
}

// ---------------------------------------------------------------------------
// Dev-stack lifecycle.
// ---------------------------------------------------------------------------
function startDevStack() {
  if (!BASH) {
    return { ok: false, reason: bashErrorMessage || 'bash binary unavailable' };
  }
  if (devProc) {
    return { ok: false, reason: 'already running' };
  }
  appendLog('[electron] launching bash scripts/dev.sh --no-browser...\n');
  // setsid-less fallback by default since Electron already coordinates
  // teardown via SIGTERM/kill; the existing trap in dev.sh handles the
  // rest. Users can set ALLOW_NO_SETSID=0 to enforce atomic cleanup.
  const env = { ...process.env, ALLOW_NO_SETSID: process.env.ALLOW_NO_SETSID || '1' };
  devProc = spawn(BASH, ['scripts/dev.sh', '--no-browser'], {
    cwd: REPO_ROOT,
    env,
    windowsHide: true,           // Hide the bash console on Windows.
  });

  devProc.stdout.on('data', (chunk) => appendLog(chunk.toString('utf8')));
  devProc.stderr.on('data', (chunk) => appendLog(chunk.toString('utf8')));
  devProc.on('exit', (code, signal) => {
    appendLog(`\n[electron] dev.sh exited (code=${code}, signal=${signal ?? 'none'})\n`);
    devProc = null;
    // Allow a future stack restart in this session to teardown normally.
    killedAlready = false;
    sendStatus({ status: 'down', exitCode: code ?? 0 });
    stopPolling();
  });
  devProc.on('error', (err) => {
    appendLog(`\n[electron] failed to launch dev.sh: ${err.message}\n`);
    sendStatus({ status: 'error', reason: err.message });
    devProc = null;
    stopPolling();
  });

  sendStatus({ status: 'starting' });
  startPolling();
  return { ok: true };
}

function gracefulKill() {
  if (killedAlready) return;
  if (!devProc) return;
  killedAlready = true;
  if (process.platform === 'win32') {
    // Windows: SIGTERM doesn't propagate cleanly through Node's
    // child_process to a spawned shell; use taskkill //F //T which walks
    // the process tree atomically. dev.sh's own trap won't fire on //F,
    // but it doesn't need to -- the tree IS already going down.
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(devProc.pid)], { windowsHide: true });
    } catch (_) { /* devProc may already be gone */ }
  } else {
    // POSIX: SIGTERM to the bash process group. dev.sh's INT/TERM trap
    // catches it and cascade-kills npm + tsx + vite.
    try { devProc.kill('SIGTERM'); } catch (_) { /* gone */ }
  }
  stopPolling();
}

function startPolling() {
  let seconds = 0;
  healthTimer = setInterval(() => {
    seconds += 1;
    if (seconds > 90) {
      stopPolling();
      sendStatus({ status: 'error', reason: 'startup timeout (90s)' });
      return;
    }
    Promise.all([
      probe('http://localhost:3001/api/health'),
      probe('http://localhost:5173/'),
    ]).then(([server, client]) => {
      if (server && client) {
        stopPolling();
        sendStatus({ status: 'up' });
      }
    }).catch(() => { /* ignore probe failures -- the dev proc will surface them */ });
  }, 1000);
}
function stopPolling() {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function appendLog(text) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('launcher:log', { chunk: text });
  }
}
function sendStatus(msg) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('launcher:status', msg);
  }
}

// ---------------------------------------------------------------------------
// IPC handlers.
// ---------------------------------------------------------------------------
ipcMain.handle('launcher:start', () => {
  try { return startDevStack(); }
  catch (e) { return { ok: false, reason: String(e?.message ?? e) }; }
});
ipcMain.handle('launcher:stop', () => { gracefulKill(); return { ok: true }; });
ipcMain.handle('launcher:open', () => {
  shell.openExternal('http://localhost:5173/').catch(() => {});
  return { ok: true };
});

// ---------------------------------------------------------------------------
// App lifecycle hooks.
// ---------------------------------------------------------------------------
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  gracefulKill();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { gracefulKill(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
