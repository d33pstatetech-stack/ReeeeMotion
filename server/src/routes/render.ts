import { Router } from "express";
import { nanoid } from "nanoid";
import { renderVideo } from "../lib/renderer";
import type { TimelineState } from "../compositions-types";

export function renderRouter(renderDir: string) {
  const router = Router();

  // POST /api/render
  //   body: { timeline: TimelineState, mode?: 'url' | 'binary' }
  //   - 'url' (default): returns { url }  so the client opens the static MP4.
  //   - 'binary': streams the MP4 back as 'video/mp4' attachment.
  router.post("/", async (req, res) => {
    const timeline = req.body?.timeline as TimelineState | undefined;
    if (!timeline || !Array.isArray(timeline.clips)) {
      return res.status(400).json({ error: "timeline is required" });
    }
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
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("[render] failed", err);
      return res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  return router;
}
