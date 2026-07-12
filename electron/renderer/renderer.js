// =============================================================================
//   electron/renderer/renderer.js -- UI logic for the dev-stack launcher.
//
//   Subscribes to launcherAPI.onLog / onStatus from preload.js. State is held
//   in the DOM (data-status) rather than mirroring to a JS object -- keeps
//   the renderer pure-mapping and zero-state-management.
//
//   No third-party deps. CSP-safe (no innerHTML on user-controlled data).
// =============================================================================

(function main() {
  const $ = (id) => document.getElementById(id);

  const log = $('log');
  const startBtn = $('start-btn');
  const stopBtn = $('stop-btn');
  const openBtn = $('open-btn');
  const clearLogBtn = $('clear-log-btn');
  const statusPill = $('status');
  const statusLabel = $('status-label');
  const footerLine = $('footer-line');

  // --- log append -------------------------------------------------------
  // log.textContent += text is O(n^2) at scale -- the browser re-parses
  // the entire <pre> on every chunk, which stutters under verbose npm
  // output. We batch via DocumentFragment + requestAnimationFrame so the
  // thread yields between paint and DOM mutation. Up to ~120 chunks per
  // rAF -- imperceptible, halves hitches in practice.
  const FRAME_BUDGET = 120;
  let pendingBuffer = '';
  let pendingCount  = 0;
  let totalLines    = 0;        // running rough line count for the cap
  let rafScheduled  = false;

  function flushPending() {
    if (pendingCount === 0) { rafScheduled = false; return; }
    log.appendChild(document.createTextNode(pendingBuffer));
    pendingBuffer = '';
    pendingCount  = 0;
    totalLines   += 1;
    // Cap at 5000 lines. Drop the first half in one slice instead of
    // line-by-line; recompute the cap from the actual remaining length.
    if (totalLines > 5000) {
      const all = log.textContent.split('\n');
      log.textContent = all.slice(Math.floor(all.length / 2)).join('\n');
      totalLines = log.textContent.split('\n').length;
    }
    log.scrollTop = log.scrollHeight;
    rafScheduled = false;
  }
  function scheduleFlush() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(flushPending);
  }
  function appendLog(text) {
    pendingBuffer += text;
    pendingCount  += 1;
    if (pendingCount >= FRAME_BUDGET) flushPending();
    else scheduleFlush();
  }

  // --- status pill state machine ----------------------------------------
  function setStatus(kind, label) {
    statusPill.dataset.status = kind;
    statusPill.classList.remove('grey', 'up', 'down', 'amber', 'error', 'starting');
    statusPill.classList.add(kind);
    statusLabel.textContent = label;
  }
  // CSS rules key off [data-status] so the styling is declarative.

  // --- wiring ------------------------------------------------------------
  startBtn.addEventListener('click', async () => {
    log.textContent = '';
    // Force-flush so the cleared log renders before we re-fill it.
    totalLines = 0;
    pendingBuffer = '';
    pendingCount = 0;
    setStatus('starting', 'starting…');
    startBtn.disabled = true;
    footerLine.textContent = 'Launching bash scripts/dev.sh...';
    try {
      const result = await window.launcherAPI.start();
      if (!result?.ok) {
        setStatus('error', result?.reason || 'launch failed');
        startBtn.disabled = false;
        footerLine.textContent = 'Launch failed: ' + (result?.reason || 'unknown');
      }
    } catch (err) {
      setStatus('error', 'launch error');
      startBtn.disabled = false;
      footerLine.textContent = 'IPC error: ' + String(err?.message ?? err);
    }
  });

  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    setStatus('amber', 'stopping…');
    footerLine.textContent = 'Sending SIGTERM to bash child...';
    try { await window.launcherAPI.stop(); }
    catch (err) { footerLine.textContent = 'IPC error: ' + String(err?.message ?? err); }
  });

  openBtn.addEventListener('click', () => { window.launcherAPI.open(); });

  clearLogBtn.addEventListener('click', () => {
    // Force-flush any in-flight batch first so we don't churn the DOM
    // if a flushPending is queued via requestAnimationFrame -- the
    // already-queued flush would otherwise drop a half-cleared state
    // back into the textarea on the next paint. Calling flushPending()
    // with pendingBuffer already empty is a no-op.
    flushPending();
    log.textContent = '';
    totalLines = 0;
    pendingBuffer = '';
    pendingCount = 0;
    rafScheduled = false;
  });

  // --- subscriptions ----------------------------------------------------
  window.launcherAPI.onLog((msg) => {
    if (!msg) return;
    if (typeof msg.chunk === 'string') appendLog(msg.chunk);
    else if (typeof msg.line === 'string') appendLog(msg.line);
  });

  window.launcherAPI.onStatus((msg) => {
    if (!msg || !msg.status) return;
    const kind = msg.status;
    if (kind === 'up') {
      setStatus('up', 'running');
      stopBtn.disabled = false;
      openBtn.disabled = false;
      startBtn.disabled = true;
      footerLine.textContent = 'Both ports bound (3001 + 5173). Open browser is safe.';
    } else if (kind === 'down') {
      setStatus('down', `exited (${msg.exitCode ?? 0})`);
      startBtn.disabled = false;
      stopBtn.disabled = true;
      openBtn.disabled = true;
      footerLine.textContent = `dev.sh exited. Exit code ${msg.exitCode ?? 0}. Click Start to relaunch.`;
    } else if (kind === 'error') {
      setStatus('error', msg.reason || 'error');
      startBtn.disabled = false;
      stopBtn.disabled = true;
      openBtn.disabled = true;
      footerLine.textContent = 'Error: ' + (msg.reason || 'see logs above');
    } else if (kind === 'starting') {
      setStatus('starting', 'starting…');
      stopBtn.disabled = false;
      footerLine.textContent = 'Waiting for ports 3001 + 5173 to bind (≤90s)...';
    }
  });

  // Initial paint.
  setStatus('grey', 'idle');
  footerLine.textContent = 'Ready. Click Start to launch the dev stack.';
})();
