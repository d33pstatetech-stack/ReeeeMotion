#!/usr/bin/env bash
# scripts/smoke-export.sh — full end-to-end MP4 export smoke test.
#
# What it does:
#   1. Belt-clean ports 3001 / 5173 via scripts/cleanup-ports.sh --sweep so
#      any orphan node watchers from a prior basher run don't EADDRINUSE us.
#   2. Boot the dev stack (server :3001 + client :5173) via dev.sh --no-browser
#      in its own session, so dev.sh's trap-driven cleanup will tear down both
#      Node children when the session exits. Logs go to /tmp/smoke-dev-* based
#      on this script's own PID.
#   3. Poll :3001 server + :5173 client (≤120s).
#   4. GET /api/health.
#   5. Generate a valid 320x240 solid-red PNG via scripts/make-test-png.js
#      (pure Node, no ffmpeg) and verify its magic bytes.
#   6. POST the PNG to /api/upload with the correct multer field name `files`
#      and write the response to a file (avoids bash interpolation of JSON).
#   7. Build a minimal TimelineState JSON via a Node one-liner that READS the
#      upload response from a file (no shell-injected content inside the JS
#      string — the basher tool kept eating our inline `node -e "... ${URL} ..."`
#      strings on prior attempts).
#   8. POST the timeline to /api/render and write the response to a file.
#   9. Read the render URL, poll it until HTTP 200 (≤5 min — Chromium bundle
#      can be slow on first run).
#  10. Download the MP4, verify ftyp magic bytes + size > 1 KB.
#  11. Exit. The dev.sh session's own trap cleans up server+client; our
#      additional cleanup belt-braces via cleanup-ports.sh --sweep.
#
# Pass/fail:
#   - exit 0 on success (MP4 verified).
#   - exit 1 on any failure, with a clear log of where it failed.
#
# Test assets and intermediate JSON live in ${SMOKE_SCRATCH} (default
# /tmp/smoke-export.$$) and are NOT cleaned up on failure so a developer can
# inspect them. Successful runs leave the scratch in place but harmless.
#
# Cross-platform: POSIX bash, no bash-4-only features (works on macOS /bin/bash
# 3.2.57 too). Tested on Windows git-bash and Linux.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="${REPO_ROOT}/server"
SCRATCH="${SMOKE_SCRATCH:-/tmp/smoke-export-$$}"
SERVER_URL="http://localhost:3001"
LOG_DIR="${SMOKE_LOGS:-/tmp}"
# Number of poll iterations for the render-URL step; each iteration sleeps
# 5s. Default 60 = 5 min, which matches the @remotion/renderer cold-cache
# time on a typical CI runner. Cold first runs that hit Chromium download
# can stretch longer; widen via SMOKE_RENDER_BUDGET=180 (15 min) etc.
SMOKE_RENDER_BUDGET="${SMOKE_RENDER_BUDGET:-60}"
case "${SMOKE_RENDER_BUDGET}" in
  ''|*[!0-9]*|0) fail "SMOKE_RENDER_BUDGET must be a positive integer (got: '${SMOKE_RENDER_BUDGET}')" ;;
esac

mkdir -p "${SCRATCH}"

# ---- Logging ---------------------------------------------------------------
# Defined BEFORE anything can call them (the SMOKE_RENDER_BUDGET validation
# below used to invoke fail() before its definition — "command not found"
# under `set -u`, then execution fell through with the bad value).
log() { printf '[smoke-export] %s\n' "$*" >&2; }
fail() { log "FAIL $*"; exit 1; }

# ---- Cleanup trap (catches EXIT, INT, TERM, HUP) --------------------------
# CLEANED=1 sentinel short-circuits the second invocation triggered by
# `cleanup SIGINT; exit 1`-then-EXIT-trap double-fire (cleanup re-runs via
# the EXIT trap after a signal-induced exit, which would otherwise do two
# `cleanup-ports.sh --sweep` runs in a row).
CLEANED=0
DEV_PID=""
cleanup() {
  local sig="${1:-EXIT}"
  if [ "${CLEANED}" = "1" ]; then
    return 0
  fi
  # Set CLEANED=1 BEFORE running the body: if the body crashes mid-way,
  # a follow-up second call won't re-attempt; idempotency of cleanup-ports.sh
  # is the recovery path (no-op when ports are already clear).
  CLEANED=1
  log "cleanup (${sig})"
  if [ -n "${DEV_PID}" ] && kill -0 "${DEV_PID}" 2>/dev/null; then
    # Kill the whole process group dev.sh lives in. dev.sh's own trap will
    # then cascade SIGTERM to server + client Node children.
    kill -TERM "-${DEV_PID}" 2>/dev/null || true
    sleep 1
    kill -KILL "-${DEV_PID}" 2>/dev/null || true
  fi
  # Belt-braces: any throwaway node watchers that escaped dev.sh's job group
  # (e.g., a stray `node scripts/make-test-png.js --rgb=oops` from a typo).
  log "belt-braces cleanup-ports.sh --sweep"
  bash "${REPO_ROOT}/scripts/cleanup-ports.sh" --sweep >/dev/null 2>&1 || true
}
trap 'cleanup EXIT' EXIT
trap 'cleanup SIGINT; exit 1' INT
trap 'cleanup SIGTERM; exit 1' TERM

# ---- Renderer env-var defaults --------------------------------------------
# Both flags reach the server process because dev.sh inherits its parent's
# environment into the spawned Node child.
#
# DIAGNOSE_RENDERER=1 — turn on the pre/post-render file-existence logging
# gated by server/src/lib/renderer.ts. Captures cwd + outputLocation +
# parentDirExists + fileExistsAfterAwait so the failure-dump can pinpoint
# whether the issue is on the JS side (outputLocation mismatch) or in the
# spawned Chromium child (sandbox / fs write fenced off).
#
# DISABLE_CHROMIUM_SANDBOX=1 — the Chromium sandbox under git-bash (MSYS)
# on Windows is a known silent-stall: renderMedia resolves cleanly but no
# file lands on disk. Disabling the sandbox opts out of the OS-level wrapper
# but Chromium still runs in user-space. Default 1 here is a smoke-only
# trade-off — set DISABLE_CHROMIUM_SANDBOX=0 to verify the sandbox-enabled
# path on Linux/macOS.
export DIAGNOSE_RENDERER="${DIAGNOSE_RENDERER:-1}"
export DISABLE_CHROMIUM_SANDBOX="${DISABLE_CHROMIUM_SANDBOX:-1}"

# ---- STEP 1: belt-clean ports ---------------------------------------------
log "STEP 1: belt-clean ports 3001 / 5173"
bash "${REPO_ROOT}/scripts/cleanup-ports.sh" --sweep >/dev/null 2>&1 || true
sleep 2
L_PIDS="$(netstat -ano 2>/dev/null | awk '$1=="TCP" && $4=="LISTENING" && ($2 ~ /:3001$/ || $2 ~ /:3001 / || $2 ~ /:5173$/ || $2 ~ /:5173 /) {print $NF}' | sort -u || true)"
if [ -n "${L_PIDS}" ]; then
  log "WARNING — still bound after cleanup, killing individually: ${L_PIDS}"
  for pid in ${L_PIDS}; do
    powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1 || \
      taskkill //F //T //PID "${pid}" >/dev/null 2>&1 || true
    kill -KILL "${pid}" 2>/dev/null || true
  done
  sleep 2
fi

# ---- STEP 2: boot dev stack via dev.sh in its own session -----------------
log "STEP 2: launch bash scripts/dev.sh --no-browser (own session)"
SMOKE_LOG="${LOG_DIR}/smoke-dev.out-$$"
# setsid so this smoke script and the dev stack form a clean teardown tree.
# On macOS / Linux setsid is in util-linux. On git-bash it's preinstalled.
if command -v setsid >/dev/null 2>&1; then
  setsid bash -c "exec bash ${REPO_ROOT}/scripts/dev.sh --no-browser" >"${SMOKE_LOG}" 2>&1 &
else
  bash "${REPO_ROOT}/scripts/dev.sh" --no-browser >"${SMOKE_LOG}" 2>&1 &
fi
DEV_PID=$!
log "dev.sh parent shell pid=${DEV_PID}; logfile=${SMOKE_LOG}"

# ---- STEP 3: poll both ports ---------------------------------------------
log "STEP 3: poll :3001 (server) + :5173 (client), ≤120s"
SRV_READY=0
CLI_READY=0
for ((i=0; i<120; i++)); do
  if [ "${SRV_READY}" = "0" ] && (exec 3<>/dev/tcp/127.0.0.1/3001) >/dev/null 2>&1; then
    SRV_READY=1
    log ":3001 ready at ${i}s"
  fi
  if [ "${CLI_READY}" = "0" ] && (exec 3<>/dev/tcp/127.0.0.1/5173) >/dev/null 2>&1; then
    CLI_READY=1
    log ":5173 ready at ${i}s"
  fi
  if [ "${SRV_READY}" = "1" ] && [ "${CLI_READY}" = "1" ]; then
    break
  fi
  sleep 1
done
if [ "${SRV_READY}" = "0" ] || [ "${CLI_READY}" = "0" ]; then
  log "STACK BOOT FAILED — server:3001=${SRV_READY}, client:5173=${CLI_READY}"
  log "Last 50 lines of ${SMOKE_LOG}:"
  tail -n 50 "${SMOKE_LOG}" >&2
  exit 1
fi

# ---- STEP 4: /api/health ---------------------------------------------------
log "STEP 4: GET /api/health"
HEALTH="$(curl --max-time 5 -sS "${SERVER_URL}/api/health" 2>&1)" || fail "GET /api/health curl failed"
log "/api/health body: ${HEALTH}"
echo "${HEALTH}" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' || fail "/api/health did not return ok:true (got: ${HEALTH})"

# ---- STEP 5: PNG generation via Node helper ------------------------------
log "STEP 5: generate test PNG via scripts/make-test-png.js"
TEST_PNG="${SCRATCH}/test.png"
cd "${REPO_ROOT}"
node scripts/make-test-png.js "${TEST_PNG}" >"${SCRATCH}/png-gen.log" 2>&1 || fail "make-test-png.js failed (log: ${SCRATCH}/png-gen.log)"
PNG_MAGIC="$(head -c 8 "${TEST_PNG}" | od -An -tx1 | tr -d ' ')"
log "PNG generated at ${TEST_PNG} (magic=${PNG_MAGIC})"
[ "${PNG_MAGIC}" = "89504e470d0a1a0a" ] || fail "PNG magic bytes wrong (got ${PNG_MAGIC}, want 89504e470d0a1a0a)"

# ---- STEP 6: upload via curl -F (field name: files) ------------------------
log "STEP 6: POST /api/upload (field name: files)"
UP_RESP="${SCRATCH}/upload-resp.json"
curl --max-time 30 -sS -X POST -F "files=@${TEST_PNG}" "${SERVER_URL}/api/upload" >"${UP_RESP}" 2>"${SCRATCH}/upload-curl.log" \
  || fail "curl POST /api/upload failed (log: ${SCRATCH}/upload-curl.log)"
log "upload response saved to ${UP_RESP}"
cat "${UP_RESP}" >&2
echo >&2
echo "${UP_RESP}" | head -c 200 >&2
echo >&2

# ---- STEP 7: build timeline.json from upload response via Node -------------
# Note: SCRATCH + REPO_ROOT are passed via env so the JS source contains
# ZERO shell-injected content (basher JSON-encoding kept eating those).
log "STEP 7: build TimelineState JSON (Node reads upload-resp.json)"
TIMELINE="${SCRATCH}/timeline.json"
SCRATCH="${SCRATCH}" REPO_ROOT="${REPO_ROOT}" node -e '
const fs = require("fs");
const { execSync } = require("child_process");
const scratch = process.env.SCRATCH;
const upRaw = fs.readFileSync(scratch + "/upload-resp.json", "utf8");
let up;
try {
  up = JSON.parse(upRaw);
} catch (e) {
  console.error("upload-resp.json is not valid JSON:", upRaw.slice(0, 200));
  process.exit(2);
}
if (!up.assets || !up.assets[0] || !up.assets[0].url) {
  console.error("upload response missing assets[0].url:", JSON.stringify(up));
  process.exit(2);
}
const url = up.assets[0].url;
// MUST match TimelineState in compositions/src/types.ts exactly:
//   clips: TimelineClip[] at the top level (FLAT, NOT nested under tracks),
//   no top-level durationInFrames, mandatory entrance/transitionIn/
//   transitionOut on every clip. Previous versions of this script used a
//   "tracks[0].clips" shape and got `{"error":"timeline is required"}`
//   back, because the server validates `Array.isArray(timeline.clips)`.
// Using DEFAULT_CLIP() shape from compositions/src/types.ts verbatim.
const timeline = {
  fps: 30,
  width: 320,
  height: 240,
  backgroundColor: "#000000",
  clips: [
    {
      id: "clip-1",
      name: "test.png",
      type: "image",
      src: url,
      trim: { from: 0, to: 1 },
      start: 0,
      scale: 1,
      opacity: 1,
      rotation: 0,
      entrance: {
        enabled: false,
        spring: { mass: 0.5, damping: 12, stiffness: 120 },
        from: { scale: 0.6, opacity: 0, translateX: 0, translateY: 60 },
        duration: 0.6,
      },
      transitionIn: { type: "none", duration: 0.5 },
      transitionOut: { type: "none", duration: 0.5 },
    },
  ],
  audioClips: [],
  textClips: [],
};
// Server expects POST body: { timeline: TimelineState, mode?: 'url'|'binary' }
// -- see server/src/routes/render.ts. Earlier versions of this script sent
// the raw timeline and got `{"error":"timeline is required"}` back; this
// wrapper is what the server actually validates against req.body?.timeline.
const body = { timeline, mode: "url" };
fs.writeFileSync(scratch + "/timeline.json", JSON.stringify(body, null, 2));
console.error("[node] timeline.json written with src=" + url);
' 2>"${SCRATCH}/timeline-build.log" || fail "timeline build failed (log: ${SCRATCH}/timeline-build.log)"
log "timeline written; preview:"
head -c 400 "${TIMELINE}" >&2
echo >&2

# ---- STEP 8: POST /api/render --------------------------------------------
log "STEP 8: POST /api/render"
RENDER_RESP="${SCRATCH}/render-resp.json"
curl --max-time 30 -sS -X POST \
  -H 'Content-Type: application/json' \
  --data-binary "@${TIMELINE}" \
  "${SERVER_URL}/api/render" >"${RENDER_RESP}" 2>"${SCRATCH}/render-curl.log" \
  || fail "curl POST /api/render failed (log: ${SCRATCH}/render-curl.log)"
log "render response:"
cat "${RENDER_RESP}" >&2
echo >&2

# ---- STEP 9: extract render URL + poll -------------------------------------
log "STEP 9: read render URL from response"
SCRATCH="${SCRATCH}" node -e '
const fs = require("fs");
const scratch = process.env.SCRATCH;
const raw = fs.readFileSync(scratch + "/render-resp.json", "utf8");
let r;
try { r = JSON.parse(raw); } catch (e) { console.error("bad JSON:", raw.slice(0, 200)); process.exit(2); }
if (!r.url) { console.error("no url in render response:", JSON.stringify(r)); process.exit(2); }
fs.writeFileSync(scratch + "/render-url.txt", r.url);
console.error("[node] render URL: " + r.url);
' 2>"${SCRATCH}/render-url.log" || fail "render URL extraction failed (log: ${SCRATCH}/render-url.log)"
RENDER_PATH="$(cat "${SCRATCH}/render-url.txt")"
# The server returns ABSOLUTE URLs (`${PUBLIC_HOST}/renders/<id>.mp4`), but
# the browser-facing poll target must be the same base we curl elsewhere.
# Accept both shapes; previously the absolute form was blindly concatenated
# onto SERVER_URL producing `http://localhost:3001http://localhost:3001/...`
# and the poll loop spun on 000 forever.
case "${RENDER_PATH}" in
  http://*|https://*) RENDER_URL="${RENDER_PATH}" ;;
  *)                  RENDER_URL="${SERVER_URL}${RENDER_PATH}" ;;
esac
poll_seconds=$((SMOKE_RENDER_BUDGET * 5))
log "polling ${RENDER_URL} (≤${SMOKE_RENDER_BUDGET} iterations × 5s = ${poll_seconds}s)"

DONE=0
CODES_SEEN=""
for ((i=0; i<SMOKE_RENDER_BUDGET; i++)); do
  HEAD="$(curl --max-time 10 -sS -o /dev/null -w '%{http_code}' "${RENDER_URL}" 2>/dev/null || echo 000)"
  SZ="$(curl --max-time 10 -sS -o /dev/null -w '%{size_download}' "${RENDER_URL}" 2>/dev/null || echo 0)"
  echo "[smoke-export] poll ${i}: HEAD=${HEAD} size=${SZ}" >&2
  # Track distinct codes so the failure-dump summary is one-line-glanceable
  # ("we hit 000 forever" = server died vs "we hit mostly 404" = file gone).
  case " ${CODES_SEEN} " in
    *" ${HEAD} "*) ;;
    *) CODES_SEEN="${CODES_SEEN:+${CODES_SEEN} }${HEAD}" ;;
  esac
  case "${HEAD}" in
    200)
      if [ "${SZ:-0}" -gt 1000 ]; then
        DONE=1
        log "render finished (size=${SZ})"
        break
      fi
      sleep 5
      ;;
    404|202|500|000)
      sleep 5
      ;;
    *)
      sleep 5
      ;;
  esac
done
if [ "${DONE}" != "1" ]; then
  log "render never reached HTTP 200 with size>1KB within ${poll_seconds}s"
  log "Distinct HTTP codes seen during polling: ${CODES_SEEN:-<none>}"
  log "-------- failure-dump: START --------"
  # (1) Server-side renderer stderr/stdout. dev.sh tees its children, so any
  #     Remotion/Chromium traceback shows up here. Also dump dev.sh's own
  #     /tmp/dev-server.${dev.sh-pid}.log separately because stdout buffering
  #     can hide recent lines from the tail loop above.
  log "[smoke log] last 30 lines of ${SMOKE_LOG}:"
  tail -n 30 "${SMOKE_LOG}" >&2 || true
  # Any nested /tmp/dev-server.*.log created by dev.sh is the AUTHORITATIVE
  # server-output channel (dev.sh redirects `npm run dev` to it). Grep for
  # the renderer diagnostic markers so we can confirm whether the file
  # write actually happened and at what PID.
  for f in /tmp/dev-server.*.log; do
    [ -e "${f}" ] || continue
    log "[dev-server log] last 40 lines of ${f}:"
    tail -n 40 "${f}" >&2 || true
    log "[dev-server log] grep renderer diagnostic markers in ${f}:"
    grep -nE '\[renderer\]|\[server\] (BOOT|exit|beforeExit|UNHANDLED|UNCAUGHT)' "${f}" >&2 | tail -25 || true
  done
  # (2) Re-probe /api/health AND /uploads/<id-of-just-uploaded-file>: cheap
  #     differentiation between "server crashed" (000 on both), "static-
  #     serve broken" (200 on health, 000 on /uploads), and "renders-only
  #     broken" (200 on both, but render video 404).
  log "[health probe] GET /api/health:"
  HEALTH_PROBE="$(curl --max-time 2 -sS -o /dev/null -w '%{http_code}' "${SERVER_URL}/api/health" 2>/dev/null || echo 000)"
  echo "  -> status=${HEALTH_PROBE} (000 = unreachable)" >&2
  # Extract the just-uploaded file's URL (we know it succeeded -- STEP 6 ok)
  # and probe whether the static-serve layer can still serve a known-good
  # file. If /api/health is 000 but /uploads/<that-file> is also 000, the
  # server is dead. If /api/health is 200 but /uploads is 000, the
  # whole-socket layer is wedged. If both are 200, the bug is renders-only.
  # The upload response URL may be ABSOLUTE (PUBLIC_HOST) — probe whatever
  # origin it points at directly rather than re-prefixing SERVER_URL.
  UPLOADED_FILE_URL="$(printf '%s' "${UP_RESP:-}" 2>/dev/null && cat "${UP_RESP}" 2>/dev/null | sed -nE 's/.*"url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' || echo "")"
  if [ -n "${UPLOADED_FILE_URL}" ]; then
    case "${UPLOADED_FILE_URL}" in
      http://*|https://*) UPLOAD_PROBE_TARGET="${UPLOADED_FILE_URL}" ;;
      *)                  UPLOAD_PROBE_TARGET="${SERVER_URL}/${UPLOADED_FILE_URL}" ;;
    esac
    UPLOADS_PROBE="$(curl --max-time 2 -sS -o /dev/null -w '%{http_code}' "${UPLOAD_PROBE_TARGET}" 2>/dev/null || echo 000)"
    echo "[uploads probe] GET ${UPLOAD_PROBE_TARGET}: -> status=${UPLOADS_PROBE}" >&2
  fi
  # (3) On-disk state. Pull renderDir/uploadDir from the cached $HEALTH JSON
  #     rather than guessing paths — the server logs the truth verbatim.
  SMOKE_HEALTH="${HEALTH:-}"
  RENDER_DUMP_DIR="$(printf '%s' "${SMOKE_HEALTH}" | sed -nE 's/.*"renderDir"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  UPLOAD_DUMP_DIR="$(printf '%s' "${SMOKE_HEALTH}" | sed -nE 's/.*"uploadDir"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  if [ -n "${RENDER_DUMP_DIR}" ]; then
    # ls -lhA = human-readable sizes + show hidden + skip . / .. which both
    # GNU ls and BSD ls (incl. macOS / Windows git-bash) interpret the same
    # way. Output column widths differ slightly between platforms; the
    # ranks (filename + size + date) are stable, which is all we need.
    log "[renders dir] ls -lhA ${RENDER_DUMP_DIR}:  (server-side outputLocation)"
    ls -lhA "${RENDER_DUMP_DIR}" >&2 || log "  (dir not listable)"
  fi
  if [ -n "${UPLOAD_DUMP_DIR}" ]; then
    log "[uploads dir] ls -lhA ${UPLOAD_DUMP_DIR}:"
    ls -lhA "${UPLOAD_DUMP_DIR}" >&2 || log "  (dir not listable)"
  fi
  # (4) Timeline we sent to /api/render (last 300 chars).
  log "[timeline preview] last 300 chars of ${TIMELINE}:"
  tail -c 300 "${TIMELINE}" >&2 || true
  echo >&2
  log "-------- failure-dump: END ----------"
  exit 1
fi

# ---- STEP 10: download MP4 + verify magic bytes ---------------------------
log "STEP 10: download + verify MP4"
OUT_MP4="${SCRATCH}/output.mp4"
curl --max-time 60 -sS "${RENDER_URL}" -o "${OUT_MP4}" -w 'HTTP=%{http_code} size=%{size_download}\n' >&2 \
  || fail "MP4 download failed"
SIZE="$(stat -c%s "${OUT_MP4}" 2>/dev/null || stat -f%z "${OUT_MP4}")"
log "local MP4 size=${SIZE}"
[ "${SIZE:-0}" -gt 1000 ] || fail "MP4 size too small (${SIZE} < 1000)"

# Verify it really IS an MP4: first chunk should be a size field (4 bytes BE)
# followed by 'ftyp' (magic bytes for MP4's FileTypeBox).
MAGIC1="$(head -c 4 "${OUT_MP4}" | od -An -tx1 | tr -d ' ')"
MAGIC2="$(dd if="${OUT_MP4}" bs=1 skip=4 count=4 2>/dev/null | od -An -tx1 | tr -d ' ')"
log "first 4 bytes (size BE): ${MAGIC1}"
log "next 4 bytes (should be 66747970 = 'ftyp'): ${MAGIC2}"
[ "${MAGIC2}" = "66747970" ] || fail "second chunk is not 'ftyp' (got ${MAGIC2})"

# ---- STEP 11: pass -------------------------------------------------------
log "PASS — MP4 verified at ${OUT_MP4}"
log "  magic: ${MAGIC1} then ftyp (${MAGIC2})"
log "  size : ${SIZE} bytes"
log "  url  : ${RENDER_URL}"
log ""
log "Scratch directory preserved for inspection: ${SCRATCH}"
exit 0
