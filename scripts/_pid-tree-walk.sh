#!/usr/bin/env bash
# scripts/_pid-tree-walk.sh - shared PID-tree breadth-first walker.
#
# Used by both scripts/cleanup-ports.sh (kill_tree_fallback's POSIX branch)
# and scripts/dev.sh (kill_tree_fallback's POSIX branch, USE_SETSID=0 mode).
# Source this file from a caller -- do not execute it standalone. Defining
# the walker as a function keeps callers in `set -u` / `set -e` mode without
# surprise; violations surface as early script.exit failures when sourcing.
#
# Exports one function:
#   collect_descendants <root-pid>
#     Emits one descendant PID per line on stdout, breadth-first via pgrep -P.
#     Linux + macOS process trees are acyclic (each PID has exactly one
#     parent), so the frontier always converges. Caller is responsible for
#     any `kill -0 <pid>` existence checks before invocing this.

collect_descendants() {
  local root="$1" frontier="${root}" next="" f c
  while [[ -n "${frontier}" ]]; do
    next=""
    for f in ${frontier}; do
      while read -r c; do
        [[ -n "${c}" ]] || continue
        echo "${c}"
        next="${next} ${c}"
      done < <(pgrep -P "${f}" 2>/dev/null || true)
    done
    frontier="${next# }"
  done
}
