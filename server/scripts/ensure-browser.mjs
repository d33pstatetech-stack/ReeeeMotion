#!/usr/bin/env node
/**
 * ensure-browser.mjs — pre-download the headless Chromium that
 * @remotion/renderer needs, so the FIRST export doesn't silently require an
 * internet connection (the project is advertised as fully local).
 *
 * Where this runs:
 *   - `npm run ensure-browser` (manual, any machine)
 *   - server `postinstall` (pre-warms dev machines; SKIPPED when CI=1 so CI
 *     typecheck runs stay fast — set REMOTION_ENSURE_BROWSER_FORCE=1 to force)
 *   - Dockerfile.server build stage (REMOTION_ENSURE_BROWSER_FORCE=1 +
 *     REMOTION_ENSURE_BROWSER_STRICT=1: a build without a browser is a bug)
 *
 * Exit codes: 0 = browser present (or non-strict failure), 1 = strict failure.
 */
import { ensureBrowser } from "@remotion/renderer";

const FORCE = process.env.REMOTION_ENSURE_BROWSER_FORCE === "1";
const STRICT = process.env.REMOTION_ENSURE_BROWSER_STRICT === "1";
const IN_CI = process.env.CI === "true" || process.env.CI === "1";
// Hard watchdog so a hung download can never hang `npm install` forever.
const TIMEOUT_MS =
  Number(process.env.REMOTION_ENSURE_BROWSER_TIMEOUT_SEC ?? "600") * 1000;

if (IN_CI && !FORCE) {
  console.log(
    "[ensure-browser] CI detected — skipping headless-browser download " +
      "(set REMOTION_ENSURE_BROWSER_FORCE=1 to force).",
  );
  process.exit(0);
}

// NOTE: @remotion/renderer's downloader sometimes lets its internal download
// promise reject WITHOUT awaiting it — the rejection surfaces as a process-
// level unhandled rejection (observed with ECONNRESET against remotion.media)
// and would crash this script before the try/catch below ever runs. Route
// both process-level channels into the same graceful-failure path.
let settled = false;
function failSoft(phase, err) {
  if (settled) return;
  settled = true;
  console.warn(
    `[ensure-browser] could not download the headless browser (${phase}):`,
    err?.message ?? err,
  );
  console.warn(
    "[ensure-browser] Exporting will fail until it is available. Retry with internet access, or run `npm run ensure-browser` again.",
  );
  process.exit(STRICT ? 1 : 0);
}

process.on("unhandledRejection", (err) => failSoft("unhandled rejection", err));
process.on("uncaughtException", (err) => failSoft("uncaught exception", err));
const watchdog = setTimeout(
  () => failSoft("timeout", new Error(`download exceeded ${TIMEOUT_MS / 1000}s`)),
  TIMEOUT_MS,
);
watchdog.unref();

try {
  const browser = await ensureBrowser();
  settled = true;
  clearTimeout(watchdog);
  console.log(
    `[ensure-browser] headless browser ready: ${browser?.executablePath ?? "ok"}`,
  );
  process.exit(0);
} catch (err) {
  clearTimeout(watchdog);
  failSoft("download error", err);
}
