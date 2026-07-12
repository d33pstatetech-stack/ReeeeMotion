#!/usr/bin/env bash
# Free up the dev-stack ports by killing whatever processes are listening on them.
# Idempotent: safe to run when the ports are already free (no-op).
#
# Usage:  bash scripts/cleanup-ports.sh [PORT...] [--sweep|-s]
#
# Default ports: 3001 5173 (Remotion editor dev-stack).
#
# Flags:
#   --sweep, -s        Also kill any orphaned node.exe whose commandline contains
#                      vite|remotion|tsx. OFF by default because that matcher is
#                      broad enough to nuke an unrelated dev session; enable it
#                      explicitly when you know those watchers are stuck.
#                      Equivalent: CLEANUP_PORTS_SWEEP=1 bash scripts/cleanup-ports.sh
#
# Detects Windows git-bash (netstat -ano + taskkill /T) vs Unix (ss / lsof / fuser
# + cascade kill through recursively-collected child PIDs).
#
# Portability: POSIX bash only — no bash-4-only features are used, so this works
# on macOS /bin/bash 3.2.57 as well as Linux and git-bash.

set -u

# Source the shared breadth-first PID-tree walker (used by kill_pid_tree
# below). Defined separately so kill_tree_fallback in scripts/dev.sh can
# also source it -- DRY across callers.
. "$(dirname "${BASH_SOURCE[0]}")/_pid-tree-walk.sh" || {
  log "[cleanup-ports] FATAL: cannot source _pid-tree-walk.sh -- install/git-pull fix needed" >&2
  exit 99
}
# Source the launch-manifest helper so --own can read the manifest that
# scripts/dev.sh wrote on its own launch. Shared schema lives in
# _addpidmanifest.sh so this script and dev.sh can't disagree about it.
. "$(dirname "${BASH_SOURCE[0]}")/_addpidmanifest.sh" || {
  log "[cleanup-ports] FATAL: cannot source _addpidmanifest.sh -- install/git-pull fix needed" >&2
  exit 99
}

# --- arg parsing: strip --sweep and --own from the arg list, keep the
# rest as ports. OWN=1 means "kill ONLY the PIDs written by our own
# scripts/dev.sh (from .dev/launch-manifest.json); never touch listeners
# on the ports". This protects unrelated dev work -- the calling
# wrappers can preflight cleanup without ever risking collateral damage.
# ---
PORTS_RAW=""
SWEEP=0
OWN=0
for arg in "$@"; do
  case "$arg" in
    --sweep|-s) SWEEP=1 ;;
    --own)      OWN=1 ;;
    *) PORTS_RAW="${PORTS_RAW} ${arg}" ;;
  esac
done
# Lowercase via POSIX `tr` so this works under macOS /bin/bash 3.2 (which
# predates the bash-4 ``${var,,}`` parameter expansion).
if [ -n "${CLEANUP_PORTS_SWEEP:-}" ]; then
  case "$(printf '%s' "${CLEANUP_PORTS_SWEEP:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) SWEEP=1 ;;
  esac
fi
# Same env-var pattern for --own: ENABLE_OWN_RECOVERY=1 enables it.
# Default 0 because --own requires that scripts/dev.sh was the last thing
# to write the manifest; if the wrapper is invoked from another repo whose
# dev.sh clobbered it, projectRoot mismatch in read_manifest returns 1
# and --own is a safe no-op anyway. The env-var hook is left in for
# automation scripts that want to force it.
if [ -n "${ENABLE_OWN_RECOVERY:-}" ]; then
  case "$(printf '%s' "${ENABLE_OWN_RECOVERY:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) OWN=1 ;;
  esac
fi
PORTS="${PORTS_RAW:-3001 5173}"

# Resolve the repo root for --own's manifest lookup. The wrappers
# (start.cmd / start.command / start.sh) all `cd` to the repo root
# before invoking us, so PWD is reliable cross-platform. If CWD is
# somehow elsewhere, fall back to the file's directory.
if [ -z "${OWN_REPO_ROOT:-}" ]; then
  OWN_REPO_ROOT="${PWD}"
  # Sanity check: are we at the repo root? Look for scripts/dev.sh as a
  # landmark so we don't accidentally point at an unrelated pwd.
  if [ ! -f "${OWN_REPO_ROOT}/scripts/dev.sh" ]; then
    OWN_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd 2>/dev/null || echo "${OWN_REPO_ROOT}")"
  fi
fi

IS_WINDOWS=0
case "$(uname -s 2>/dev/null || echo WindowsNT)" in
  MINGW*|MSYS*|CYGWIN*|WindowsNT) IS_WINDOWS=1 ;;
esac

log() { printf '[cleanup-ports] %s\n' "$*" >&2; }

is_listening_pid() {
  local port="$1"
  if [ "$IS_WINDOWS" = "1" ]; then
    # netstat -ano columns: Proto Local-Address Foreign-Address State PID.
    # Without the TCP+LISTENING filter we'd also match UDP rows and TCP
    # ESTABLISHED/TIME_WAIT connections — killing processes that merely
    # have the port in some unrelated state.
    netstat -ano \
      | awk -v p=":${port}" \
          '$1 == "TCP" && $4 == "LISTENING" && ($2 ~ p"$" || $2 ~ p" ") {print $NF}' \
      | sort -u
  else
    if command -v ss >/dev/null 2>&1; then
      ss -ltnp "sport = :${port}" 2>/dev/null \
        | awk '/LISTEN/ {match($0, /pid=([0-9]+)/, m); if (m[1]) print m[1]}' \
        | sort -u
    elif command -v lsof >/dev/null 2>&1; then
      lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | sort -u
    else
      # fuser output is "<port>/tcp:  PID [PID ...]" — PIDs are fields 2..NF.
      fuser -n tcp "${port}" 2>/dev/null \
        | awk '{for (i=2; i<=NF; i++) print $i}' \
        | sort -u
    fi
  fi
}

kill_pid_tree() {
  local pid="$1"
  # Preview what we're about to kill (best-effort). Lets the user see if
  # the script is targeting their editor vs a hung dev server.
  if command -v ps >/dev/null 2>&1; then
    # -o args= gives the full commandline (vs comm= which is just the
    # executable basename). Strip the leading pid field via awk's sub() so
    # the printf gets the WHOLE remaining line as a single string
    # (otherwise awk's whitespace-splitting on $2 would truncate at the
    # first space and we'd just see `node` again). The `%.80s` truncates
    # only if the commandline actually overflows 80 chars.
    ps -p "${pid}" -o pid=,args= 2>/dev/null | head -1 | awk '{args=$0; sub(/^[0-9]+[[:space:]]+/, "", args); printf("[cleanup-ports]   target: pid=%s args=%.80s\n", $1, args)}' >&2 || true
  fi
  if [ "$IS_WINDOWS" = "1" ]; then
    # No head-truncation here: kill failures are the diagnostic the user
    # actually wanted (process not found / access denied / etc).
    taskkill //F //T //PID "${pid}" 2>&1 >&2
    return 0
  fi
  # Snapshot the full descendant set BEFORE any kill so reaping on TERM
  # can't shrink our list. Cascade leaves-first → parent (TERM), wait,
  # then SIGKILL anyone who survived.
  local -a descendants=()
  while read -r d; do
    [ -n "${d}" ] && descendants+=("${d}")
  done < <(collect_descendants "${pid}" 2>/dev/null || true)

  for d in "${descendants[@]:-}"; do
    [ -n "${d}" ] && kill -TERM "${d}" 2>/dev/null || true
  done
  kill -TERM "${pid}" 2>/dev/null || true
  sleep 1
  for d in "${descendants[@]:-}"; do
    [ -n "${d}" ] && kill -KILL "${d}" 2>/dev/null || true
  done
  kill -KILL "${pid}" 2>/dev/null || true
}

sweep_orphan_node_watchers() {
  if [ "${SWEEP}" != "1" ]; then
    log "Orphan-node sweep: SKIPPED (pass --sweep or set CLEANUP_PORTS_SWEEP=1 to enable)"
    return 0
  fi
  if [ "${IS_WINDOWS}" != "1" ]; then
    log "Orphan-node sweep: only Windows supported (this script is running on Unix; skipping)"
    return 0
  fi
  log "Orphan-node sweep ENABLED: listing node.exe processes whose commandline mentions vite|remotion|tsx..."
  powershell -NoProfile -Command \
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue | Where-Object { try { \$_.CommandLine -match 'vite|remotion|tsx' } catch { \$false } } | ForEach-Object { \$cl = if (\$_.CommandLine) { \$_.CommandLine.Substring(0, [Math]::Min(120, \$_.CommandLine.Length)) } else { '' }; Write-Host ('  -> killing PID ' + \$_.ProcessId + ' :: ' + \$cl); Stop-Process -Id \$_.ProcessId -Force }" \
    2>&1 >&2 || true
}

# Portable PID-alive check. POSIX truth is `kill -0 N`; on Windows
# git-bash we use `tasklist //FI "PID eq N"` because MSYS's `kill -0`
# is conservative about cross-process checks. We return 0 if alive,
# 1 if not. Used by --own BEFORE killing (defense against PID recycle)
# and AFTER (best-effort confirmation).
pid_alive() {
  local pid="$1"
  if [ "${IS_WINDOWS}" = "1" ]; then
    # tasklist //FI "PID eq N" output:
    #   INFO: No tasks are running...   (negative; not alive)
    #   Image Name   PID   ...           (positive; alive)
    # The second column is the PID (right-aligned in a width-7 field
    # followed by spaces). We grep for ${pid} preceded by whitespace
    # boundaries so 12 doesn't match 1234.
    tasklist //FI "PID eq ${pid}" 2>/dev/null | grep -qE "(^|[[:space:]])${pid}([[:space:]]|$)" && return 0 || return 1
  fi
  kill -0 "${pid}" 2>/dev/null
}

cleanup_owned_processes() {
  # --own path. Reads .dev/launch-manifest.json and tree-kills ONLY the
  # PIDs it lists. NEVER touches listeners on the ports -- if the manifest
  # was hand-deleted or expired, this exits 0 with a warning and the
  # caller proceeds to the normal port-based cleanup if it was also asked.
  log "OWN mode: reading manifest at ${OWN_REPO_ROOT}/.dev/launch-manifest.json"
  # Capture stderr (projectRoot + launchedAt) into a temp file so we can
  # surface the manifest's own metadata separately from the parsed tokens.
  local ms_err ms_raw ms_pr ms_lt
  ms_err="$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/cleanup-stderr.$$")"
  local ms_tokens
  ms_tokens="$(read_manifest "${OWN_REPO_ROOT}" 2>"${ms_err}" || true)"
  ms_pr="$(sed -nE 's/^projectRoot=(.*)$/\1/p' "${ms_err}" 2>/dev/null | head -1 || true)"
  ms_lt="$(sed -nE 's/^launchedAt=(.*)$/\1/p' "${ms_err}" 2>/dev/null | head -1 || true)"
  rm -f "${ms_err}" 2>/dev/null || true

  if [ -z "${ms_tokens}" ]; then
    log "OWN mode: no usable manifest (missing / mismatched projectRoot / expired) -- safe no-op"
    return 0
  fi
  log "OWN mode: manifest recorded projectRoot=${ms_pr} launchedAt=${ms_lt}"

  # Re-read the manifest JSON and extract (label, pid, pgid) triples
  # directly. Hand-rolled grep avoids the jq dependency. Whether each
  # PGID field is present distinguishes "POSIX launch with setsid" from
  # "Windows launch"; on Windows we pass empty pgid and the kill helper
  # uses taskkill //F //T //PID instead.
  local ms_raw=""
  ms_raw="$(cat "${OWN_REPO_ROOT}/.dev/launch-manifest.json" 2>/dev/null || echo "")"
  local m_pid_s m_pid_c m_pg_s m_pg_c
  m_pid_s="$(printf '%s' "${ms_raw}" | sed -nE 's/.*"pidServer"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')"
  m_pid_c="$(printf '%s' "${ms_raw}" | sed -nE 's/.*"pidClient"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')"
  m_pg_s="$(printf '%s' "${ms_raw}" | sed -nE 's/.*"pidServerPgid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')"
  m_pg_c="$(printf '%s' "${ms_raw}" | sed -nE 's/.*"pidClientPgid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')"

  local attempts=0 kills=0 label pid pg
  for triple in "server:${m_pid_s}:${m_pg_s}" "client:${m_pid_c}:${m_pg_c}"; do
    label="$(printf '%s' "${triple}" | cut -d: -f1)"
    pid="$(printf '%s' "${triple}" | cut -d: -f2)"
    pg="$(printf '%s' "${triple}"  | cut -d: -f3)"
    [ -n "${pid}" ] || continue
    if pid_alive "${pid}"; then
      log "OWN mode: killing ${label}=${pid} pgid=${pg:-<auto>}; projectRoot=${ms_pr}"
      attempts=$((attempts + 1))
      kill_manifest_owner "${pid}" "${pg:-}"
      # Best-effort confirmation. If still alive we'd log it.
      if pid_alive "${pid}"; then
        log "OWN mode: WARN ${label}=${pid} still alive after kill_manifest_owner"
      else
        kills=$((kills + 1))
      fi
    else
      log "OWN mode: ${label}=${pid} already dead -- skipped (PID almost certainly recycled; safer to no-op)"
    fi
  done

  log "OWN mode: ${kills}/${attempts} PIDs verified dead"
  # Clear the manifest now that we've used it. Subsequent --own calls
  # will see "no manifest" (clean, expected) instead of "stale manifest"
  # (confusing). TTL still protects us during the gap.
  clear_manifest "${OWN_REPO_ROOT}" 2>/dev/null || true
  return 0
}

main() {
  log "Windows mode: ${IS_WINDOWS}"
  log "Ports targeted:${PORTS}"
  log "Orphan-node sweep: $([ "${SWEEP}" = "1" ] && echo ENABLED || echo disabled)"
  log "OWN mode: $([ "${OWN}" = "1" ] && echo ENABLED || echo disabled)"

  # --own short-circuits: do manifest-aware kill FIRST, then fall through
  # to the normal port-based cleanup if --own was combined with other
  # flags. Most callers pass ONLY --own (the wrapper preflight path);
  # in that case we exit 0 after --own regardless of port state because
  # the wrappers want a quiet yes/no, not a hard error.
  if [ "${OWN}" = "1" ]; then
    cleanup_owned_processes
    # If --own was the only flag, return a friendly exit; if it was
    # combined with --sweep or explicit port args, fall through to the
    # belt-clean path below.
    if [ "${SWEEP}" != "1" ] && [ "${PORTS_RAW:-}" = "" ]; then
      log "OWN mode: short-circuit done; ports not touched."
      return 0
    fi
    log "OWN mode: continuing with port-based cleanup as belt-and-braces"
  fi

  local -a pids=()
  for port in ${PORTS}; do
    while read -r pid; do
      [ -n "${pid}" ] && pids+=("${pid}")
    done < <(is_listening_pid "${port}")
  done

  # De-dupe (each per-port call already sort -u'd but ports can overlap).
  # POSIX while-read instead of `mapfile -t` so this works on bash 3.2.
  if [ "${#pids[@]}" -gt 0 ]; then
    local -a unique=()
    while read -r p; do
      [ -n "${p}" ] && unique+=("${p}")
    done < <(printf '%s\n' "${pids[@]}" | sort -u)
    pids=("${unique[@]}")
  fi

  if [ "${#pids[@]}" -eq 0 ]; then
    log "No listeners on $(echo ${PORTS} | tr ' ' ',' | sed 's/,$//'). Nothing to kill."
  else
    log "Killing ${#pids[@]} PID(s): ${pids[*]}"
    for pid in "${pids[@]}"; do
      kill_pid_tree "${pid}"
    done
  fi

  sweep_orphan_node_watchers

  # Final verification: anything left?
  sleep 2
  local leftover=""
  for port in ${PORTS}; do
    left="$(is_listening_pid "${port}" | tr '\n' ' ')"
    [ -n "${left}" ] && leftover="${leftover}:${port}=${left} "
  done
  if [ -n "${leftover}" ]; then
    log "WARNING — still bound: ${leftover}"
    log "Hint: re-run with --sweep (or CLEANUP_PORTS_SWEEP=1) to clear orphaned node watchers that escaped the listener-detected set, e.g. npm run cleanup:ports -- --sweep"
    exit 1
  fi
  log "Ports clear."
  exit 0
}

main "$@"
