#!/usr/bin/env bash
# scripts/dev.sh — run the Remotion editor stack (server + client) in one
# terminal. Pure bash, no extra deps (no `concurrently`, no Node shim).
#
# What it does:
#   1. Pre-flight: refuses to start if either port (3001, 5173) is busy,
#      because `vite` uses `strictPort: true` and we'd just bounce.
#   2. Backgrounds `npm run dev` in `server/` and `client/` directories.
#   3. Polls both ports until they answer (30s timeout each).
#   4. Prints a URL table (server + client + where uploads land) and
#      opens the client in a browser (xdg-open / open / cmd.exe).
#   5. On Ctrl-C, kills the entire process group so both Node children
#      die cleanly without leaking orphaned tsx / vite watchers.
#
# Cross-platform:
#   * macOS / Linux  — native bash, xdg-open/open for the browser.
#   * Windows git-bash — bash 4+, opens via `cmd.exe /c start ""`.
#   * WSL            — treated as Linux, browser uses xdg-open which
#     forwards to the Windows host best-effort.
#
# `setsid` is strongly preferred (it gives each child its own
# session+process group, so SIGTERM to "-${pid}" kills the whole tree
# atomically). If your environment lacks setsid (e.g., Docker / minimal
# CI runners / some Mac setups), you can opt into a relaxed-cleanup
# fallback:
#
#     export ALLOW_NO_SETSID=1
#     bash scripts/dev.sh --no-browser
#
# Trade-off: with the fallback, children stay in the parent's process
# group. Cleanup walks each PID tree recursively via pgrep (POSIX) or
# via taskkill /T (Windows git-bash). A child that doesn't forward
# SIGTERM to its grandchildren may leave an orphaned watcher; the
# SIGKILL follow-up after a 3-second sleep catches most cases but isn't
# atomic.
#
# Usage:
#   bash scripts/dev.sh           # from the repo root
#   npm run dev:all               # via the root package.json script
#   bash scripts/dev.sh --no-browser   # skip the auto-open

set -euo pipefail

# Source shared breadth-first PID-tree walker (used by kill_tree_fallback's
# POSIX branch below when USE_SETSID=0). Defined in scripts/_pid-tree-walk.sh
# so kill_pid_tree in scripts/cleanup-ports.sh can source the same helper
# instead of duplicating the walker.
. "$(dirname "${BASH_SOURCE[0]}")/_pid-tree-walk.sh" || {
  echo "[dev.sh] FATAL: cannot source _pid-tree-walk.sh -- install/git-pull fix needed" >&2
  exit 99
}
# Source the launch-manifest helper (used by --own in cleanup-ports.sh).
# Both this script and cleanup-ports.sh write/read the same file at
# .dev/launch-manifest.json so a subsequent launch can recognize its own
# previous PIDs and clean ONLY those -- never unrelated dev work. See
# scripts/_addpidmanifest.sh for the schema + TTL policy.
. "$(dirname "${BASH_SOURCE[0]}")/_addpidmanifest.sh" || {
  echo "[dev.sh] FATAL: cannot source _addpidmanifest.sh -- install/git-pull fix needed" >&2
  exit 99
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="${REPO_ROOT}/server"
CLIENT_DIR="${REPO_ROOT}/client"
SERVER_PORT=3001
CLIENT_PORT=5173
STARTUP_TIMEOUT_SEC=30
OPEN_BROWSER=1

for arg in "$@"; do
  case "${arg}" in
    --no-browser) OPEN_BROWSER=0 ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/dev.sh [--no-browser]

Runs the Remotion editor server (port 3001) and client (port 5173) in one
terminal. Ctrl-C cleanly stops both processes.

  --no-browser   Don't auto-open the client in a browser
  -h, --help     Print this message

Environment variables:
  ALLOW_NO_SETSID=1  Opt into a setsid-less cleanup fallback. Useful on Docker
                     images, minimal CI runners, or any environment without
                     util-linux. Trade-off: cleanup walks each PID tree via
                     pgrep (POSIX) or taskkill /T (Windows git-bash) with a
                     3s SIGTERM-then-SIGKILL cascade rather than killing the
                     whole process group atomically. A misbehaving child that
                     doesn't forward SIGTERM to its grandchildren could leave
                     an orphaned watcher. Default: refuse to start if setsid
                     isn't installed (preserves the atomic-cleanup guarantee).
EOF
      exit 0
      ;;
    *) echo "Unknown arg: ${arg}" >&2; exit 2 ;;
  esac
done

# ---------- 1. Port preflight -----------------------------------------------
port_in_use() {
  local port="$1"
  # bash /dev/tcp is a bash-ism; works in git-bash, macOS bash, Linux bash.
  # Returns 0 if the port is open (i.e., something is listening).
  (exec 3<>"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1
}

for port in "${SERVER_PORT}" "${CLIENT_PORT}"; do
  if port_in_use "${port}"; then
    cat >&2 <<EOF
ERROR: port ${port} is already in use.

Refusing to start so vite's strictPort doesn't fail with a confusing stack.
Likely culprits:
  * Another \`npm run dev\` is running in another terminal.
  * The verify-docker compose stack is still up (\`docker compose down\`).

To free ${port} on macOS/Linux:
  lsof -ti:${port} | xargs kill -9

To free ${port} on Windows (git-bash):
  netstat -ano | findstr :${port}
  taskkill /PID <PID> /F
EOF
    exit 3
  fi
done

# ---------- 2. Mode detection: setsid (preferred) or fallback ---------------
# We PREFER `setsid` so each dev child becomes the leader of its own
# session+process group. The cleanup trap then uses `kill -TERM -${pid}`
# to kill the whole group (npm + tsx/vite children) atomically.
# util-linux ships with setsid on every Linux, every macOS, and git-bash
# on Windows most of the time.
#
# If setsid is missing, the script refuses to start by default — silent
# degradation would leave zombie watchers on Ctrl-C. Operators who accept
# that trade-off explicitly (e.g., Docker / minimal CI runners, automation
# environments that lack util-linux) can opt into the relaxed-cleanup
# fallback by exporting ALLOW_NO_SETSID=1. The fallback walks each PID
# tree recursively via pgrep (POSIX) or via taskkill /T (Windows git-bash).
# Cleanup is a bit slower (3s sleep vs 1s) and a misbehaving child could
# leave a grandchild orphaned if it doesn't forward SIGTERM.
USE_SETSID=1
if ! command -v setsid >/dev/null 2>&1; then
  if [[ "${ALLOW_NO_SETSID:-0}" != "1" ]]; then
    cat >&2 <<'EOF'
ERROR: `setsid` is not installed.

This script uses process groups to shut down the entire stack atomically
(SIGTERM to the group kills npm + tsx + vite together). Without `setsid`,
Ctrl-C would leave orphaned watchers.

Install setsid:
  * Debian/Ubuntu:  sudo apt install util-linux   (usually already present)
  * RHEL/Fedora:    sudo dnf install util-linux
  * Alpine:         sudo apk add util-linux
  * macOS:          preinstalled via util-linux (or `brew install util-linux`)
  * git-bash/MSYS2: preinstalled

OR opt into the relaxed-cleanup fallback by exporting ALLOW_NO_SETSID=1.
Trade-off: cleanup walks the PID tree instead of using process groups;
orphaned grandchildren may persist if a child doesn't forward SIGTERM.
EOF
    exit 6
  fi
  USE_SETSID=0
  echo "[dev.sh] NOTICE: setsid missing; ALLOW_NO_SETSID=1 accepted — using fallback cleanup (PID-tree walk)." >&2
fi

# ---------- 3. Cleanup trap ------------------------------------------------
# Send SIGTERM to each child's *process group* (negative PID) so npm and
# every grandchild it spawned die together. EXIT covers normal exits;
# SIGINT/SIGTERM/SIGHUP cover Ctrl-C, `kill`, and shell hang-up.
#
# When USE_SETSID=1 (preferred), each child is a session+group leader
# (setsid-created), so the negative-PID form kills the whole tree
# atomically. When USE_SETSID=0 (ALLOW_NO_SETSID=1 fallback), children
# share the parent's pgid, so we can't use negative-PID. Instead,
# kill_tree_fallback() walks each PID's descendant set breadth-first via
# pgrep (POSIX) or taskkill /T (Windows git-bash), TERM each, sleep 3s
# (longer than the 1s used in the process-group path because signal
# delivery is async + the leader may not forward SIGTERM), then KILL
# survivors.

# USE_SETSID is read at cleanup() CALL time (not at function-definition
# time), so a maintainer can flip it mid-session and cleanup() picks
# up the new value on its next call. Race? None -- launch_in_group()
# runs once at script start (before any trap arm), cleanup() fires only
# from the INT/TERM/HUP/EXIT traps below.

# Tree-kill a single PID. Uses collect_descendants() (sourced from
# scripts/_pid-tree-walk.sh above) for the POSIX branch's PID-tree walk.
# Windows git-bash: taskkill /T walks the
# Windows job-object tree atomically (no setsid needed). We deliberately
# do NOT silence taskkill stderr: a failed taskkill during cleanup is a
# useful diagnostic signal ("didn't clean up everything"), so the user
# sees it. POSIX: TERM leaves-first (so a leaf that doesn't forward kill
# signals doesn't block us), TERM root, sleep 3s for graceful cleanup,
# then SIGKILL anyone who survived.
kill_tree_fallback() {
  local pid="$1"
  case "$(uname -s 2>/dev/null || echo WindowsNT)" in
    MINGW*|MSYS*|CYGWIN*|WindowsNT)
      taskkill //F //T //PID "${pid}" || true
      ;;
    *)
      local -a descendants=()
      while read -r d; do
        [[ -n "${d}" ]] && descendants+=("${d}")
      done < <(collect_descendants "${pid}" 2>/dev/null || true)
      for d in "${descendants[@]:-}"; do
        [[ -n "${d}" ]] && kill -TERM "${d}" 2>/dev/null || true
      done
      kill -TERM "${pid}" 2>/dev/null || true
      sleep 3
      for d in "${descendants[@]:-}"; do
        [[ -n "${d}" ]] && kill -KILL "${d}" 2>/dev/null || true
      done
      kill -KILL "${pid}" 2>/dev/null || true
      ;;
  esac
}

PIDS=()
cleanup() {
  local sig="${1:-EXIT}"
  echo
  echo "[dev.sh] Caught ${sig}, stopping stack..."
  # Clear the launch manifest on clean exit so a subsequent launch isn't
  # confused into "recovering" PIDs that already died (we just killed them).
  # On non-EXIT signals we LEAVE the manifest in place -- the next
  # preflight's --own pass is exactly what we want for the "process-group
  # kill went sideways and a grandchild escaped" case.
  if [[ "${sig}" = "EXIT" ]]; then
    clear_manifest "${REPO_ROOT}" 2>/dev/null || true
  fi
  if [[ "${USE_SETSID}" = "1" ]]; then
    # Atomic process-group kill: whole npm+tsx+vite tree gets SIGTERM in
    # one shot via the negative-PID form (only valid because each child
    # was setsid'd into its own session+group).
    for pid in "${PIDS[@]:-}"; do
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
        kill -TERM "-${pid}" 2>/dev/null || true
      fi
    done
    # Give children a moment to flush, then SIGKILL any survivors.
    sleep 1
    for pid in "${PIDS[@]:-}"; do
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
        kill -KILL "-${pid}" 2>/dev/null || true
      fi
    done
  else
    # Fallback: per-pid tree walk via kill_tree_fallback. Slower (3s
    # sleep) and a non-forwarding child could leave a grandchild, but
    # the SIGKILL escalation catches most cases.
    for pid in "${PIDS[@]:-}"; do
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
        kill_tree_fallback "${pid}"
      fi
    done
  fi
  echo "[dev.sh] Cleaned up. Bye."
}
trap 'cleanup SIGINT'  INT
trap 'cleanup SIGTERM' TERM
trap 'cleanup SIGHUP'  HUP
trap 'cleanup EXIT'    EXIT

# ---------- 4. Launch server + client in their process groups --------------
# USE_SETSID=1 (preferred): each child becomes the leader of its own
# session+process group via setsid; cleanup uses process-group kill.
# USE_SETSID=0 (fallback): plain background; cleanup walks each PID
# tree because children share the parent's pgid.
launch_in_group() {
  local cmd="$1"
  if [[ "${USE_SETSID}" = "1" ]]; then
    setsid bash -c "${cmd}" &
  else
    bash -c "${cmd}" &
  fi
}

cd "${SERVER_DIR}"
echo "[dev.sh] Starting server (port ${SERVER_PORT}) in ${SERVER_DIR} ..."
launch_in_group "npm run dev" >/tmp/dev-server.${$}.log 2>&1
SERVER_PID=$!
PIDS+=("${SERVER_PID}")

cd "${CLIENT_DIR}"
echo "[dev.sh] Starting client (port ${CLIENT_PORT}) in ${CLIENT_DIR} ..."
launch_in_group "npm run dev" >/tmp/dev-client.${$}.log 2>&1
CLIENT_PID=$!
PIDS+=("${CLIENT_PID}")

cd "${REPO_ROOT}"

# ---------- 4b. Record ownership in the launch manifest -------------------
# Writes .dev/launch-manifest.json atomically so the next invocation of
# cleanup-ports.sh --own (called by the wrappers at preflight) can
# recognize these exact PIDs and tree-kill ONLY them -- never unrelated
# dev work. On POSIX where USE_SETSID=1, we record the PGID too (setsid
# made each child its own session+group leader, so negative-PID kill is
# safe and atomic). On Windows we record the PID only -- taskkill //F //T
# walks the process tree atomically. `wait_for_port` below will abort
# with cleanup SIGTERM + exit 4 if a child fails to bind; the cleanup
# trap handles manifest-clearing on success and manifest-preservation
# on crash (so a follow-up launch can recover).
SERVER_PGID=""
CLIENT_PGID=""
if [[ "${USE_SETSID}" = "1" ]]; then
  SERVER_PGID="$(ps -o pgid= "${SERVER_PID}" 2>/dev/null | tr -d ' ' || echo "")"
  CLIENT_PGID="$(ps -o pgid= "${CLIENT_PID}" 2>/dev/null | tr -d ' ' || echo "")"
fi
write_manifest "${REPO_ROOT}" "${SERVER_PID}" "${CLIENT_PID}" "${SERVER_PGID}" "${CLIENT_PGID}"

# ---------- 5. Wait for both ports to answer -------------------------------
wait_for_port() {
  local port="$1"
  local label="$2"
  for ((i=0; i<STARTUP_TIMEOUT_SEC; i++)); do
    if port_in_use "${port}"; then
      echo "[dev.sh] ${label} ready (port ${port}, pid ${PIDS[-1]}) after ${i}s."
      return 0
    fi
    sleep 1
  done
  echo "" >&2
  echo "ERROR: ${label} did not bind port ${port} within ${STARTUP_TIMEOUT_SEC}s." >&2
  echo "Last 30 lines of /tmp/dev-${label}.log:" >&2
  tail -n 30 "/tmp/dev-${label}.\$$.log" 2>/dev/null || true
  return 1
}

wait_for_port "${SERVER_PORT}" "server" || { cleanup SIGTERM; exit 4; }
wait_for_port "${CLIENT_PORT}" "client" || { cleanup SIGTERM; exit 4; }

# ---------- 6. Print URL table + optional browser open ---------------------
cat <<EOF

┌──────────────────────────────────────────────────────────────┐
│  Remotion editor — local dev stack is UP                     │
├──────────────────────────────────────────────────────────────┤
│  Client UI  →  http://localhost:${CLIENT_PORT}/
│  API (up.)  →  http://localhost:${SERVER_PORT}/api/health    ⎯ ready
│  Server PID →  ${SERVER_PID}    Client PID →  ${CLIENT_PID}
│  Logs       →  /tmp/dev-server.\$\$.log
│              /tmp/dev-client.\$\$.log
│  Stop       →  Ctrl-C (kills the whole stack)
└──────────────────────────────────────────────────────────────┘

EOF

if (( OPEN_BROWSER )); then
  url="http://localhost:${CLIENT_PORT}/"
  case "$(uname -s 2>/dev/null || echo Windows)" in
    Darwin)  open "${url}" >/dev/null 2>&1 || echo "[dev.sh] open failed, navigate manually" ;;
    Linux)   xdg-open "${url}" >/dev/null 2>&1 || echo "[dev.sh] xdg-open failed, navigate manually" ;;
    Windows|MINGW*|MSYS*|CYGWIN*)
      cmd.exe /c start "" "${url}" >/dev/null 2>&1 || echo "[dev.sh] start failed, navigate manually" ;;
    *)       echo "[dev.sh] unknown OS ($(uname -s)); not auto-opening browser" ;;
  esac
fi

# ---------- 7. Wait forever; the trap handles cleanup ----------------------
echo "[dev.sh] Tailing both logs in this terminal. Ctrl-C to quit."
tail -F /tmp/dev-server.\$\$.log /tmp/dev-client.\$\$.log 2>/dev/null &
wait -n 2>/dev/null || true

# Hold the script open until either child exits unexpectedly.
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      echo "[dev.sh] Child pid ${pid} exited unexpectedly; tearing down." >&2
      cleanup SIGTERM
      exit 5
    fi
  done
  sleep 3
done
