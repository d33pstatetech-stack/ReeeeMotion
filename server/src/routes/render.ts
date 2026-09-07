import { Router } from "express";
import fs from "fs";
import { nanoid } from "nanoid";
import { renderVideo } from "../lib/renderer";
import type { TimelineState } from "../compositions-types";

/** Lifecycle of a background render job. */
type JobStatus = "rendering" | "done" | "error";

interface RenderJobRecord {
  id: string;
  status: JobStatus;
  /** 0..1 renderer progress, updated from renderMedia's onProgress. */
  progress: number;
  outputLocation?: string;
  outputUrl?: string;
  error?: string;
  createdAt: number;
}

/** Finished jobs are reaped so the map cannot grow without bound. */
const JOB_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Validate + normalize a TimelineState coming off the wire. Lenient about
 * missing overlay arrays (defaulted to []) so simple API callers that only
 * have `clips` still work, but strict about the fields the renderer
 * would otherwise crash on (fps/width/height must be positive numbers and
 * clips must be an array). Returns either the normalized timeline or an
 * error message.
 */
export function normalizeTimelineInput(
  input: unknown,
): { ok: true; timeline: TimelineState } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "timeline is required" };
  }
  const tl = input as Partial<TimelineState>;
  if (!Array.isArray(tl.clips)) {
    return { ok: false, error: "timeline.clips must be an array" };
  }
  const fps = Number(tl.fps);
  const width = Number(tl.width);
  const height = Number(tl.height);
  if (!Number.isFinite(fps) || fps <= 0) {
    return { ok: false, error: "timeline.fps must be a positive number" };
  }
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return { ok: false, error: "timeline.width and timeline.height must be positive numbers" };
  }
  return {
    ok: true,
    timeline: {
      fps,
      width,
      height,
      backgroundColor: typeof tl.backgroundColor === "string" ? tl.backgroundColor : "#000000",
      clips: tl.clips,
      audioClips: Array.isArray(tl.audioClips) ? tl.audioClips : [],
      textClips: Array.isArray(tl.textClips) ? tl.textClips : [],
    },
  };
}

export function renderRouter(renderDir: string) {
  const router = Router();
  /** In-memory job registry. Bounded by reaping on every new job. */
  const jobs = new Map<string, RenderJobRecord>();

  function reapOldJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
    }
  }

  function startRenderJob(timeline: TimelineState): RenderJobRecord {
    reapOldJobs();
    const jobId = nanoid(10);
    const job: RenderJobRecord = {
      id: jobId,
      status: "rendering",
      progress: 0,
      createdAt: Date.now(),
    };
    jobs.set(jobId, job);

    const host =
      process.env.PUBLIC_HOST ?? `http://localhost:${process.env.PORT ?? 3001}`;

    // Fire-and-forget on purpose: the HTTP response returns immediately and
    // progress is polled via GET /jobs/:id. The catch() below records every
    // failure on the job record, so no unhandled rejection can escape here.
    renderVideo(jobId, renderDir, host, timeline, (p) => {
      job.progress = Math.max(0, Math.min(1, p));
    })
      .then((result) => {
        job.status = "done";
        job.progress = 1;
        job.outputLocation = result.outputLocation;
        job.outputUrl = result.outputUrl;
        // eslint-disable-next-line no-console
        console.log(`[render] job ${jobId} done -> ${result.outputUrl}`);
      })
      .catch((err: unknown) => {
        job.status = "error";
        job.error = String((err as Error)?.message ?? err);
        // eslint-disable-next-line no-console
        console.error(`[render] job ${jobId} failed`, err);
      });

    return job;
  }

  // POST /api/render/jobs
  //   body: { timeline: TimelineState }
  //   -> 202 { jobId } and the render continues in the background.
  //   Poll GET /api/render/jobs/:id for progress, then GET .../file.
  router.post("/jobs", (req, res) => {
    const parsed = normalizeTimelineInput(req.body?.timeline);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const job = startRenderJob(parsed.timeline);
    return res.status(202).json({ jobId: job.id, status: job.status });
  });

  // GET /api/render/jobs/:id -> { status, progress, url?, error? }
  router.get("/jobs/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "unknown job id" });
    return res.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      url: job.outputUrl,
      error: job.error,
      createdAt: job.createdAt,
    });
  });

  // GET /api/render/jobs/:id/file -> streams the finished MP4.
  router.get("/jobs/:id/file", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "unknown job id" });
    if (job.status === "error") {
      return res.status(500).json({ error: job.error ?? "render failed" });
    }
    if (job.status !== "done" || !job.outputLocation) {
      return res.status(409).json({ error: "render still in progress" });
    }
    if (!fs.existsSync(job.outputLocation)) {
      return res.status(410).json({ error: "render output no longer on disk" });
    }
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="remotion-export.mp4"`,
    );
    return res.sendFile(job.outputLocation);
  });

  // POST /api/render
  //   body: { timeline: TimelineState, mode?: 'url' | 'binary' }
  //   - 'url' (default): returns { url }  so the client opens the static MP4.
  //   - 'binary': streams the MP4 back as 'video/mp4' attachment.
  //   Synchronous (blocks until the render finishes) — kept for the smoke
  //   harness and API compat; the editor UI itself uses the /jobs flow.
  router.post("/", async (req, res) => {
    const parsed = normalizeTimelineInput(req.body?.timeline);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const timeline = parsed.timeline;
    const host =
      process.env.PUBLIC_HOST ?? `http://localhost:${process.env.PORT ?? 3001}`;
    const mode: "url" | "binary" = req.body?.mode ?? "url";
    const jobId = nanoid(10);

    try {
      const result = await renderVideo(jobId, renderDir, host, timeline);
      if (mode === "binary") {
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="remotion-export.mp4"`,
        );
        // Renderer v4 returns `outputLocation` (was `outputPath` in v3).
        return res.sendFile(result.outputLocation);
      }
      return res.json({ ok: true, jobId, url: result.outputUrl });
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[render] failed", err);
      const message = String((err as Error)?.message ?? err);
      return res.status(500).json({ error: message });
    }
  });

  return router;
}
