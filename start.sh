#!/usr/bin/env bash
# ====================================================================
#   start.sh -- POSIX / Linux / WSL launcher for the Remotion
#                Video Editor
#
#   Same behavior as start.command (macOS) and start.cmd (Windows),
#   but invoked from a terminal instead of a GUI double-click. Run
#   this when you want to boot the dev stack from the command line on
#   Linux, in WSL, or in a non-windowed environment where you can
#   still Ctrl-C out.
#
#     ./start.sh                # from the repo root
#     bash start.sh             # also fine
#
#   The actual boot logic lives in scripts/dev.sh -- this file is a
#   thin wrapper so users only have to remember one filename.
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
# match this repo. Swallow any non-zero exit; a missing manifest is
# the most common state on a fresh checkout.
echo "[preflight] Safe port recovery (--own; only kills our previous launches)"
bash scripts/cleanup-ports.sh --own || true
echo

bash scripts/dev.sh
