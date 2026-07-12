#!/usr/bin/env bash
# ====================================================================
#   start.command -- macOS GUI launcher for the Remotion Video Editor
#
#   Finder treats .command files as double-clickable shell scripts.
#   On first run macOS Gatekeeper may block it ("from an unidentified
#   developer"); right-click the file in Finder, choose "Open", and
#   confirm once. Subsequent double-clicks run immediately.
#
#   What this does:
#     1. Refuses to run if the cwd isn't writable (so users can't
#        double-click a copy on a read-only filesystem).
#     2. Runs `cleanup-ports.sh --own` as a preflight -- kills ONLY
#        our previous launch's recorded PIDs (saved to
#        .dev/launch-manifest.json by scripts/dev.sh), never unrelated
#        dev work.
#     3. Forwards to scripts/dev.sh which:
#        - Pre-flights ports and refuses to start if :3001 / :5173 are
#          busy (preserves the user's other dev work).
#        - Boots Express server (port 3001) + Vite client (5173) in
#          one Terminal window.
#        - Auto-opens http://localhost:5173/ in the default browser
#          via /usr/bin/open when both are reachable.
#        - Tail-logs both services; Ctrl-C kills the whole stack.
# ====================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "================================================"
echo " Remotion Video Editor -- local dev stack"
echo "================================================"
echo
echo "Booting Express server on :3001 and Vite client on :5173..."
echo "Browser will open at http://localhost:5173/ automatically."
echo "Press Ctrl-C in this window to stop the whole stack."
echo

# --own preflight: kill ONLY our previous launch's PIDs (recorded in
# .dev/launch-manifest.json by the last run of scripts/dev.sh), never
# touch unrelated dev work. Safe no-op if there's no manifest, the
# recorded PIDs already died, or the manifest's projectRoot doesn't
# match this repo (defensive against another project's launcher
# clobbering our manifest). We swallow any non-zero exit because a
# missing manifest is the most common state on a fresh checkout.
echo "[preflight] Safe port recovery (--own; only kills our previous launches)"
bash scripts/cleanup-ports.sh --own || true
echo

bash scripts/dev.sh
