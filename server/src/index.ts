import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { uploadRouter } from "./routes/upload";
import { renderRouter } from "./routes/render";

const PORT = Number(process.env.PORT ?? 3001);
// Bind host: 127.0.0.1 by default for predictable Windows / git-bash
// behavior; override with HOST=0.0.0.0 if you need LAN access.
const HOST = process.env.HOST ?? "127.0.0.1";
const UPLOAD_DIR = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR ?? "uploads",
);
const RENDER_DIR = path.resolve(
  process.cwd(),
  process.env.RENDER_DIR ?? "renders",
);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

// Make sure the disk folders exist before serving them.
for (const dir of [UPLOAD_DIR, RENDER_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const app = express();

app.use(
  cors({
    origin: CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  }),
);
// Request life-cycle bounds ------------------------------------------------
// Registered BEFORE express.json + multer so a wedged body-parser (e.g. a
// 20 MB JSON upload stalling mid-stream) is also covered. Mutations
// (POST/PUT/DELETE/PATCH) get a 30 s safety cap — a misbehaving multer
// wedge, frozen Remotion worker, or a network-flaky bundle() call can
// otherwise leave a request open until the client gives up, leaking fds
// + memory. Renders + uploads get the full 15-min render budget. GETs
// are intentionally NOT gated here: express.static manages long
// range-fetch / scrubbing responses on its own; capping them at 30 s
// would chop real-time video playback mid-byte.
const TIMEOUT_DEFAULT_MS = 30 * 1000;
const TIMEOUT_RENDER_MS = 15 * 60 * 1000;
app.use((req, res, next) => {
  // Skip GETs entirely — static /uploads + /renders + /api/health should
  // never hit a wall-clock deadline; express.static owns its own
  // response lifecycle for byte-range + streaming responses.
  if (req.method === "GET") return next();
  const ms =
    req.path.startsWith("/api/render") || req.path.startsWith("/api/upload")
      ? TIMEOUT_RENDER_MS
      : TIMEOUT_DEFAULT_MS;
  // Socket-level timeout via req.setTimeout. We don't ALSO call
  // res.setTimeout here because both proxy to the same underlying TCP
  // socket — one registration is enough to fire the on-timeout callback
  // once when the request stalls.
  req.setTimeout(ms, () => {
    // eslint-disable-next-line no-console
    console.error(
      `[server] request timeout ${ms}ms ${req.method} ${req.url}`,
    );
    if (!res.headersSent) {
      res.status(503).json({ error: "request timeout" });
    } else {
      res.destroy();
    }
  });
  next();
});

// Remotion renderer pipes fairly large JSON bodies — bump the limit.
app.use(express.json({ limit: "20mb" }));

// Static media and renders ----------------------------------------------
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    setHeaders: (res, filePath) => {
      // Browsers/Chromium both range-fetch these files; enable byte-range
      // for video scrubbing in the player.
      res.setHeader("Accept-Ranges", "bytes");
      // Cache aggressively - the files are content-addressed by nanoid.
      res.setHeader("Cache-Control", "public, max-age=31536000");
      // Allow CORS on the actual media file (some browsers need this when
      // the video is loaded as a cross-origin resource).
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  }),
);
app.use(
  "/renders",
  express.static(RENDER_DIR, {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
    },
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uploadDir: UPLOAD_DIR, renderDir: RENDER_DIR });
});

app.use("/api/upload", uploadRouter(UPLOAD_DIR));
app.use("/api/render", renderRouter(RENDER_DIR));

// Defensive crash handlers -----------------------------------------------
// @remotion/renderer spawns Chromium worker threads; bundle() can
// network-fetch Remotion deps. Without these a single unhandled rejection
// inside a worker would tear down the entire Node process silently,
// taking every subsequent request — including /api/health — to
// connection refused.
//
// Caveat: Node's docs warn that after `uncaughtException` the process is
// in an undefined state. We keep it alive INTENTIONALLY for local-dev
// triage so one misbehaving render doesn't take the whole stack down.
// Production should reverse this: log + `process.exit(1)` + let a
// process supervisor (systemd, pm2, `docker --restart=always`) bring
// the server back into a known-good state.
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error(
    "[server] UNCAUGHT EXCEPTION (kept alive for triage — see comment):",
    err,
  );
});
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error(
    "[server] UNHANDLED REJECTION (kept alive for triage — see comment):",
    reason,
  );
});

// Boot + lifecycle telemetry --------------------------------------------
// One-line PID log at boot so the smoke-export failure-dump can grep for
// repeated PID values across /tmp/dev-server.*.log (proves whether the
// server restarted, e.g. due to a tsx-watch parent dying or a dev.sh
// pgid-kill misfire). We also tick a 30-second memoryUsage sample so a
// future OOM-by-Chromium will show a steep rss climb just before the
// crash, and register 'beforeExit' / 'exit' listeners to surface the
// exact code if the process does choose to die.
if (process.env.DIAGNOSE_RENDERER === "1") {
  // eslint-disable-next-line no-console
  console.log(`[server] BOOT pid=${process.pid} cwd=${process.cwd()}`);
  const memTick = setInterval(() => {
    const m = process.memoryUsage();
    // eslint-disable-next-line no-console
    console.log(
      `[server] mem pid=${process.pid} rss=${(m.rss / 1024 / 1024).toFixed(1)}MB heap=${(m.heapUsed / 1024 / 1024).toFixed(1)}MB`,
    );
  }, 30_000);
  memTick.unref(); // don't keep the loop alive purely for diagnostics
  process.on("beforeExit", (code) => {
    // eslint-disable-next-line no-console
    console.error(`[server] beforeExit pid=${process.pid} code=${code}`);
  });
  process.on("exit", (code) => {
    // eslint-disable-next-line no-console
    console.error(`[server] exit pid=${process.pid} code=${code}`);
  });
}

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[server] listening on http://${HOST}:${PORT}` +
      ` (curl http://127.0.0.1:${PORT}/api/health to test)\n` +
      `[server] uploads: ${UPLOAD_DIR}\n` +
      `[server] renders: ${RENDER_DIR}\n` +
      `[server] CORS origin: ${CORS_ORIGIN}\n` +
      `[server] timeouts: default=${TIMEOUT_DEFAULT_MS}ms render=${TIMEOUT_RENDER_MS}ms`,
  );
});
