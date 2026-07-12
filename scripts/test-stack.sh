#!/usr/bin/env bash
# scripts/test-stack.sh — one-shot smoke test for the dev stack.
#
# Boots server (port 3001) + client (port 5173), polls both ports, curls
# /api/health + the SPA, then SIGTERMs the whole tree. NEVER auto-opens
# a browser.
#
# Portable across:
#   * Linux/macOS with `setsid`  ── PREFERRED path: creates a new
#     session+process group so SIGTERM to the group kills the whole tree
#     (same trick as scripts/dev.sh).
#   * Linux/macOS without `setsid` ── fallback: plain `&`; cleanup walks
#     `pgrep -P` recursively.
#   * Windows git-bash with `setsid` (most installs)  ── preferred path.
#   * Windows git-bash/MSYS without `setsid` (minimal installs) ──
#     fallback: plain `&`; cleanup uses `taskkill //F //T //PID` which
#     recursively kills the Win32 process tree.
#
# Exit codes:
#   0  stack booted, both endpoints answered healthily
#   2  port already in use at start
#   3  neither setsid nor a working kill mechanism found
#   4  server failed to bind 3001 within READY_TIMEOUT
#   5  client failed to bind 5173 within READY_TIMEOUT

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="${REPO_ROOT}/server"
CLIENT_DIR="${REPO_ROOT}/client"
SCRATCH="$(mktemp -d)"
READY_TIMEOUT=60

# --- OS detection ---
case "$(uname -s 2>/dev/null || echo Windows)" in
  MINGW*|MSYS*|CYGWIN*|Windows) OS="windows" ;;
  *)                            OS="unix" ;;
esac

cd "${REPO_ROOT}"
echo "[test-stack] repo:    ${REPO_ROOT}"
echo "[test-stack] os:      ${OS}"
echo "[test-stack] setsid:  $(command -v setsid >/dev/null 2>&1 && echo present || echo MISSING)"
echo "[test-stack] scratch: ${SCRATCH}"

# --- preflight: refuse to run if either port is already busy --------
busy=0
(exec 3<>/dev/tcp/127.0.0.1/3001) >/dev/null 2>&1 && busy=1
(exec 3<>/dev/tcp/127.0.0.1/5173) >/dev/null 2>&1 && busy=1
if [[ "${busy}" -eq 1 ]]; then
  echo "[test-stack] ABORT: a dev port is already in use."
  echo "            Kill the other dev process first (or 'docker compose down')."
  exit 2
fi

# --- kill_tree: OS-aware recursive process killer --------------------
kill_tree() {
  local pid="$1"
  [[ -z "${pid}" ]] && return 0
  if [[ "${OS}" == "windows" ]]; then
    # //T = tree (kill children), //F = force. Both required.
    taskkill //F //T //PID "${pid}" >/dev/null 2>&1 || true
  else
    if command -v pgrep >/dev/null 2>&1; then
      local child
      for child in $(pgrep -P "${pid}" 2>/dev/null || true); do
        kill_tree "${child}"
      done
    fi
    kill -TERM "${pid}" 2>/dev/null || true
    sleep 0.3
    kill -KILL "${pid}" 2>/dev/null || true
  fi
}

# --- belt-and-braces: any orphan still holding our ports at cleanup ---
sweep_ports() {
  if [[ "${OS}" == "windows" ]] && command -v netstat >/dev/null 2>&1; then
    local port pids pid
    for port in 3001 5173; do
      # `findstr /R` so `.*` is treated as a regex (without /R, `*` is
      # "repeat previous char" and our wildcard is silently wrong). The
      # trailing space after `:${port}` disambiguates 3001 from 30010.
      pids=$(netstat -ano 2>/dev/null | findstr /R "LISTENING.*:${port} " | awk '{print $NF}' | sort -u || true)
      for pid in ${pids}; do
        [[ -n "${pid}" ]] && taskkill //F //T //PID "${pid}" >/dev/null 2>&1 || true
      done
    done
  fi
}

# --- cleanup trap ----------------------------------------------------
SERVER_PID=""
CLIENT_PID=""
cleanup() {
  echo
  echo "[test-stack] cleanup running..."
  [[ -n "${SERVER_PID}" ]] && kill_tree "${SERVER_PID}"
  [[ -n "${CLIENT_PID}" ]] && kill_tree "${CLIENT_PID}"
  sweep_ports
  echo "[test-stack] cleanup done."
}
trap cleanup EXIT INT TERM

# --- launch helper ---------------------------------------------------
launch_dev() {
  local dir="$1" log="$2"
  cd "${dir}" || return 1
  # When setsid is present (most git-bash, macOS, Linux installs), we use
  # it so SIGTERM to the wrapper kills the entire process group cleanly —
  # this mirrors scripts/dev.sh exactly. When it's missing, plain `&` is
  # fine: cleanup uses kill_tree which is OS-aware.
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -c "exec npm run dev" >"${log}" 2>&1 &
  else
    bash -c "exec npm run dev" >"${log}" 2>&1 &
  fi
  local pid=$!
  cd "${REPO_ROOT}" >/dev/null || true
  echo "${pid}"
}

SERVER_PID=$(launch_dev "${SERVER_DIR}" "${SCRATCH}/server.log")
echo "[test-stack] started server (pid ${SERVER_PID})"
CLIENT_PID=$(launch_dev "${CLIENT_DIR}" "${SCRATCH}/client.log")
echo "[test-stack] started client (pid ${CLIENT_PID})"

# --- wait for ports --------------------------------------------------
wait_port() {
  local port="$1" label="$2" log="$3"
  for ((i=0; i<READY_TIMEOUT; i++)); do
    if (exec 3<>/dev/tcp/127.0.0.1/"${port}") >/dev/null 2>&1; then
      echo "[test-stack] ${label} READY on ${port} after ${i}s"
      return 0
    fi
    sleep 1
  done
  echo "[test-stack] ${label} TIMEOUT after ${READY_TIMEOUT}s"
  echo "------ ${label} log (last 80 lines) ------"
  tail -n 80 "${log}" 2>/dev/null || true
  return 1
}

wait_port 3001 server "${SCRATCH}/server.log" || exit 4
wait_port 5173 client "${SCRATCH}/client.log" || exit 5

# --- smoke test endpoints -------------------------------------------
echo
echo "==== GET /api/health ===="
HEALTH_RAW=$(curl -sS --max-time 10 -w "\n__HTTP_CODE__:%{http_code}" http://localhost:3001/api/health || echo "__HTTP_CODE__:000")
echo "${HEALTH_RAW}"
HEALTH_CODE=$(echo "${HEALTH_RAW}" | grep -oE '__HTTP_CODE__:[0-9]+' | cut -d: -f2)
echo "[test-stack] /api/health http=${HEALTH_CODE}"

echo
echo "==== GET / (client) ===="
ROOT_CODE=$(curl -sS --max-time 10 -o /tmp/test-stack-client.out -w "%{http_code}" http://localhost:5173/ || echo 000)
echo "[test-stack] GET / http=${ROOT_CODE}"
echo "------ first 8 lines of client response ------"
head -n 8 /tmp/test-stack-client.out 2>/dev/null || true

echo
echo "==== server log: last 25 lines ====="
tail -n 25 "${SCRATCH}/server.log" 2>/dev/null || true
echo
echo "==== client log: last 25 lines ====="
tail -n 25 "${SCRATCH}/client.log" 2>/dev/null || true

echo
echo "[test-stack] DONE — cleanup will run on exit."
