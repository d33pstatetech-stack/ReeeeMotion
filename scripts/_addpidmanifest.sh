#!/usr/bin/env bash
# scripts/_addpidmanifest.sh — shared PID-manifest helper for dev-stack
#                              ownership tracking (the "--own" feature).
#
# USAGE: source this file from scripts/dev.sh AND scripts/cleanup-ports.sh.
# Do NOT execute it standalone -- it exports functions only.
#
# BACKGROUND
# scripts/dev.sh writes a small JSON manifest at .dev/launch-manifest.json
# inside the repo root AFTER it launches server + client. The manifest
# records the PIDs (and pgids, on POSIX) of the processes started so that
# a subsequent launch can recognize "this is OUR stack, not someone
# else's editor listening on 3001" and clean it up safely without killing
# unrelated dev work.
#
# The manifest path is intentionally inside the repo root rather than in
# $TMPDIR/$LOCALAPPDATA so that:
#   * the wrapper scripts (start.cmd / start.command / start.sh) can
#     locate it without a separate lookup dance
#   * when the project is moved between machines the manifest becomes
#     stale automatically (REPO_ROOT mismatch)
#   * a projectRoot field provides a defense-in-depth check against
#     accidental cross-project kills (if you manage to find a manifest
#     in another directory by mistake, projectRoot mismatch = abort)
#
# Exports:
#   write_manifest <project_root> <pid_server> <pid_client> [pidServerPgid] [pidClientPgid]
#     Atomic write. mv from a .tmp sibling prevents a partial-read race
#     against an already-running wrapper. The manifest contains ONLY the
#     PIDs we started -- nothing more, so a leaked manifest is useless
#     without the binary control over those PIDs.
#
#   read_manifest <project_root>
#     Emits a single line of "PID:<n>[:PGID:<n>] PID:<n>[:PGID:<n>]"
#     plus stderr lines "projectRoot=<abs>" and "launchedAt=<iso>".
#     Returns 0 on success, 1 if no manifest / unreadable / projectRoot
#     mismatch. POSIX `echo`-driven so this works on macOS /bin/bash 3.2
#     (no mapfile / no associative arrays needed).
#
#   kill_manifest_owner <pid> [pgid]
#     Best-effort tree-kill. On Windows git-bash: taskkill //F //T //PID.
#     On POSIX: TERM the PID (and descendants from s16-trees), sleep 1,
#     KILL survivors. SILENT on "process already gone" -- never fatal.
#     Returns 0 either way.
#
#   clear_manifest <project_root>
#     Removes the manifest. No-op if missing.
#
# CONSTANTS
#   MANIFEST_PATH   -- "${REPO_ROOT}/.dev/launch-manifest.json"
#   MANIFEST_TTL_HOURS -- 24. Older than this = stale (PID has almost
#     certainly been recycled by the OS); we skip with a warning rather
#     than risk killing an unrelated process. Tunable via env var.
#
# WHY A 24-HOUR TTL
# PIDs on Linux are recycled after the maximum pid + 1 wrap (default
# 32768 on 32-bit-era kernels, 4 million on modern kernels). In
# practice a non-restarted machine won't recycle within hours; a
# restarted machine is clean anyway. So 24h is a generous safety
# margin without making the wrapper useless for "I quit yesterday and
# now I'm back" workflows. If the user signs off for a month and
# comes back, --own will safely no-op.
#
# CROSS-PLATFORM
# Tested on Windows git-bash (MINGW64) and macOS /bin/bash 3.2.57. No
# bash-4-only features: parameter-expansion (`${var,,}`) avoided, while-
# read loops instead of mapfile, printf %s for line-stable printing.

# ---------- config --------------------------------------------------------
# Default TTL is overridable per-call via MANIFEST_TTL_HOURS env, so the
# Electron launcher (which expects short-lived launches during dev)
# could pin a smaller window. Default 24 hours matches the
# "I-quit-and-came-back" workflow the user described.
: "${MANIFEST_TTL_HOURS:=24}"

# Detect platform once. .sh files are POSIX; on Windows git-bash uname
# reports MINGW* / MSYS* / CYGWIN*. We treat any of those as Windows.
IS_WINDOWS=0
case "$(uname -s 2>/dev/null || echo WindowsNT)" in
  MINGW*|MSYS*|CYGWIN*|WindowsNT) IS_WINDOWS=1 ;;
esac

_ms_log() { printf '[manifest] %s\n' "$*" >&2; }

# ---------- write_manifest ------------------------------------------------
# Atomic: write to .tmp, fsync if possible (bash can't easily fsync
# without a separate tool but the rename is the critical part), move
# into place. A concurrent reader sees either the OLD file or the NEW
# file -- never a half-written one.
write_manifest() {
  local project_root="$1" pid_server="$2" pid_client="$3"
  local pid_server_pgid="${4:-}" pid_client_pgid="${5:-}"

  # mkdir -p idempotent. .dev/ is intentionally repo-local so the
  # .gitignore at repo root can safely exclude *.dev-manifest.json.
  mkdir -p "${project_root}/.dev"
  local tmp="${project_root}/.dev/launch-manifest.json.tmp"
  local final="${project_root}/.dev/launch-manifest.json"

  # Stable, human-readable, single-line JSON. ISO-8601 UTC for launchedAt.
  # No JSON library required -- the fields we emit are all simple types
  # (integers + strings) and we double-quote every string value with
  # printf's %q semantics (a backslash-escape) so paths containing
  # spaces or apostrophes round-trip safely.
  local now launched_at esc_root esc_pid_s esc_pid_c parser
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u)"
  launched_at="${now}"
  esc_root="$(printf '%s' "${project_root}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  esc_pid_s="${pid_server}"
  esc_pid_c="${pid_client}"
  # Record which date parser we used so read_manifest can detect a TOMBSTONE
  # case where marshaling-time parsing failed (e.g., musl/Alpine without
  # GNU `date -d` AND without BSD `date -j -f`). Without this fingerprint,
  # a degenerate platform would always pass the staleness check and could
  # accidentally kill an unrelated process whose PID was recycled.
  if date -u -d "${launched_at}" +%s >/dev/null 2>&1; then parser="gnu"
  elif date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "${launched_at}" +%s >/dev/null 2>&1; then parser="bsd"
  else parser="unsupported"
  fi

  {
    printf '{'
    printf '"projectRoot":"%s",' "${esc_root}"
    printf '"launchedAt":"%s",' "${launched_at}"
    printf '"dateParser":"%s",' "${parser}"
    printf '"pidServer":%s,' "${esc_pid_s}"
    printf '"pidClient":%s,' "${esc_pid_c}"
    # POSIX-only fields. Empty strings on Windows so the field is still
    # there (stable schema) but PowerShell doesn't try to use it.
    if [ "${IS_WINDOWS}" = "1" ]; then
      printf '"pidServerPgid":null,'
      printf '"pidClientPgid":null,'
    else
      printf '"pidServerPgid":%s,' "${pid_server_pgid:-null}"
      printf '"pidClientPgid":%s,' "${pid_client_pgid:-null}"
    fi
    # TTL echoed so a diagnostic dump shows the policy in effect at the
    # time the manifest was written (helpful when MANIFEST_TTL_HOURS was
    # overridden per-launch).
    printf '"ttlHours":%s' "${MANIFEST_TTL_HOURS}"
    printf '}\n'
  } > "${tmp}"

  # mv is atomic on POSIX + NTFS in the same directory.
  mv "${tmp}" "${final}"
}

# ---------- read_manifest -------------------------------------------------
# Returns 0 if a fresh, project-matching manifest is available and emits
# one parser-friendly line on stdout:
#   "PID:<n>[:PGID:<n>] PID:<n>[:PGID:<n>]\n"
# so the caller can `read -ra tokens` without re-invoking sed.
# Returns 1 if:
#   * manifest missing
#   * projectRoot mismatch (defensive: caller found someone else's manifest)
#   * launchedAt older than MANIFEST_TTL_HOURS (PID almost certainly recycled)
#   * JSON malformed (defensive)
# On stdout: ONE line of "PID:<n>[:PGID:<n>] ..." tokens
# On stderr: "projectRoot=<abs>" and "launchedAt=<iso>" so callers can
#            surface the manifest's own record back to the user.
read_manifest() {
  local project_root="$1"
  local final="${project_root}/.dev/launch-manifest.json"
  if [ ! -f "${final}" ]; then
    _ms_log "no manifest at ${final}"
    return 1
  fi

  # Hand-rolled grep-of-key-value extraction. Avoids the jq dependency
  # so this works on bare macOS /bin/bash 3.2 without extra installs.
  local raw="" line pr lt ts ttl
  raw="$(cat "${final}" 2>/dev/null || true)"
  if [ -z "${raw}" ]; then
    _ms_log "manifest empty at ${final}"
    return 1
  fi

  pr="$(printf '%s' "${raw}" | sed -nE 's/.*"projectRoot"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  lt="$(printf '%s' "${raw}" | sed -nE 's/.*"launchedAt"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  ts="$(printf '%s' "${raw}" | sed -nE 's/.*"ttlHours"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')"

  # Defensive: projectRoot must match (after the same path-canonicalization
  # the caller used -- so dev.sh and cleanup-ports.sh agree on what "the
  # repo root" means). On Windows, paths use backslashes sometimes; for
  # match purposes we lowercase + flip backslashes to forward slashes.
  local pr_norm caller_norm
  pr_norm="${pr}"
  caller_norm="${project_root}"
  if [ "${IS_WINDOWS}" = "1" ]; then
    pr_norm="$(printf '%s' "${pr_norm}" | tr 'A-Z' 'a-z' | tr '\\' '/')"
    caller_norm="$(printf '%s' "${caller_norm}" | tr 'A-Z' 'a-z' | tr '\\' '/')"
  fi
  # Strip trailing slash for normalization.
  pr_norm="${pr_norm%/}"
  caller_norm="${caller_norm%/}"
  if [ "${pr_norm}" != "${caller_norm}" ]; then
    _ms_log "manifest projectRoot mismatch: file='${pr}' caller='${project_root}' -- refusing (likely a different repo's manifest)"
    return 1
  fi

  # TTL sanity. The default 24-hour policy is encoded into the manifest at
  # write-time so this read doesn't silently disagree with the format in
  # the file. If ttlHours is missing (very old manifests from previous
  # --own generations), fall back to the current env MANIFEST_TTL_HOURS.
  ttl="${ts:-${MANIFEST_TTL_HOURS}}"

  # DEFENSE: refuse if the writer was on a platform whose date marshaling
  # we couldn't parse (e.g., busybox without -d AND without -j -f). On
  # such a platform the writer-side fingerprint would be "unsupported",
  # and we cannot compute a trustworthy age -- assume the PIDs are
  # recycled and skip. Prevents the silent false-positive where both
  # date branches fail and `now_epoch == launched_epoch` → age=0.
  local parser
  parser="$(printf '%s' "${raw}" | sed -nE 's/.*"dateParser"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  if [ "${parser}" = "unsupported" ]; then
    _ms_log "manifest written on a platform whose date marshaling we don't recognize ('${lt}') -- skipping (cannot verify TTL safety)"
    return 1
  fi

  # Compute age in seconds. If date marshaling fails for the launchedAt
  # value, treat the manifest as STALE rather than fresh -- this is the
  # conservative default: refuse rather than risk killing a recycled PID.
  local now_epoch launched_epoch age_seconds
  now_epoch="$(date -u +%s 2>/dev/null || echo 0)"
  launched_epoch="$(date -u -d "${lt}" +%s 2>/dev/null || \
                    date -j -f '%Y-%m-%dT%H:%M:%SZ' "${lt}" +%s 2>/dev/null || \
                    echo "-1")"
  if [ "${launched_epoch}" = "-1" ] || [ "${launched_epoch}" -le 0 ]; then
    _ms_log "cannot parse launchedAt='${lt}' on this platform; treating manifest as STALE"
    return 1
  fi
  age_seconds=$((now_epoch - launched_epoch))
  local ttl_seconds=$((ttl * 3600))
  if [ "${age_seconds}" -gt "${ttl_seconds}" ]; then
    _ms_log "manifest is stale (age=${age_seconds}s > ttl=${ttl_seconds}s); skipping -- own PIDs almost certainly recycled"
    return 1
  fi

  # Extract the two PID : PGID token pairs and emit them on one stdout
  # line. Caller can `read -ra tokens` then iterate.
  local pid_s pid_c pgs pgc
  pid_s="$(printf '%s' "${raw}" | sed -nE 's/.*"pidServer"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')"
  pid_c="$(printf '%s' "${raw}" | sed -nE 's/.*"pidClient"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')"
  pgs="$(printf '%s' "${raw}" | sed -nE 's/.*"pidServerPgid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')"
  pgc="$(printf '%s' "${raw}" | sed -nE 's/.*"pidClientPgid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')"

  if [ -z "${pid_s}" ] || [ -z "${pid_c}" ]; then
    _ms_log "manifest missing pidServer/pidClient (likely hand-edited)"
    return 1
  fi

  echo "projectRoot=${pr}" >&2
  echo "launchedAt=${lt}" >&2

  local line_ps="" line_pc=""
  line_ps="PID:${pid_s}"
  if [ -n "${pgs}" ]; then line_ps="${line_ps}:PGID:${pgs}"; fi
  line_pc="PID:${pid_c}"
  if [ -n "${pgc}" ]; then line_pc="${line_pc}:PGID:${pgc}"; fi
  printf '%s %s\n' "${line_ps}" "${line_pc}"
  return 0
}

# ---------- kill_manifest_owner -------------------------------------------
# Tree-kill a specific PID. Silently no-op if the process is already gone
# (we checked it via kill -0 / tasklist before getting here in the caller).
# NEVER raises -- if any signal fails we swallow it; the caller walks the
# list and reports what was attempted, not what failed bit-perfect.
kill_manifest_owner() {
  local pid="$1" pgid="${2:-}"
  if [ "${IS_WINDOWS}" = "1" ]; then
    taskkill //F //T //PID "${pid}" >/dev/null 2>&1 || true
    return 0
  fi
  # POSIX: TERM the root, then TERM each descendant (so a misbehaving
  # leaf doesn't block the cascade), sleep 1, KILL survivors.
  # Negative-pid-kill works only if our PID IS the process-group leader.
  # dev.sh invokes via setsid so on POSIX the parent IS the leader. If
  # we're invoked from outside (e.g., --own with a manifest pgid but the
  # recycle happened), negative-pid is safest because it ignores an
  # unrelated alias-PID. Use the recorded pgid when available.
  local target="-${pid}"
  if [ -n "${pgid}" ]; then target="-${pgid}"; fi
  kill -TERM "${target}" 2>/dev/null || true

  # Belt-and-braces descendant walk -- catches grandchildren of the
  # leader if the leader didn't forward SIGTERM to them. Sourced from
  # _pid-tree-walk.sh if available.
  if declare -f collect_descendants >/dev/null 2>&1; then
    local -a descendants=()
    while read -r d; do
      [ -n "${d}" ] && descendants+=("${d}")
    done < <(collect_descendants "${pid}" 2>/dev/null || true)
    for d in "${descendants[@]:-}"; do
      [ -n "${d}" ] && kill -TERM "${d}" 2>/dev/null || true
    done
  fi

  sleep 1
  # Escalate. KILL the recorded target (group if pgid known, else just
  # the PID) + each descendant individually so any not-yet-dead leaves
  # die too.
  if [ -n "${pgid}" ]; then
    kill -KILL "-${pgid}" 2>/dev/null || true
  else
    kill -KILL "${pid}" 2>/dev/null || true
  fi
  if declare -f collect_descendants >/dev/null 2>&1; then
    local -a descendants2=()
    while read -r d; do
      [ -n "${d}" ] && descendants2+=("${d}")
    done < <(collect_descendants "${pid}" 2>/dev/null || true)
    for d in "${descendants2[@]:-}"; do
      [ -n "${d}" ] && kill -KILL "${d}" 2>/dev/null || true
    done
  fi
  return 0
}

# ---------- clear_manifest ------------------------------------------------
# Removes the manifest at clean exit. Idempotent.
clear_manifest() {
  local project_root="$1"
  rm -f "${project_root}/.dev/launch-manifest.json" 2>/dev/null || true
}
