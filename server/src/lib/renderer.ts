import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { TimelineClip, TimelineState } from "../compositions-types";

export interface RenderJob {
  id: string;
  outputLocation: string;
  outputUrl: string;
}

const COMPOSITIONS_ENTRY = path.resolve(
  process.cwd(),
  process.env.COMPOSITIONS_ENTRY ?? "../compositions/src/index.ts",
);

/**
 * Bundle the Remotion project, then render the MP4.
 * Progress is streamed back via the onProgress callback (0 - 1).
 */
export async function renderVideo(
  jobId: string,
  renderDir: string,
  host: string,
  timeline: TimelineState,
  onProgress?: (p: number) => void,
): Promise<RenderJob> {
  const bundleLocation = await bundle({
    entryPoint: COMPOSITIONS_ENTRY,
  });

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "MainComposition",
    inputProps: { timeline },
  });

  // Use the longest layer (video / audio / text) as the canonical duration.
  const totalFrames = computeMaxFrame(timeline);

  const outputName = `${jobId}.mp4`;
  const outputLocation = path.join(renderDir, outputName);

  // Chromium sandbox is the silent-EOF culprit on Windows git-bash: the
  // sandbox under MSYS sometimes fails to write the output file to disk
  // even though renderMedia resolves cleanly. Setting
  // DISABLE_CHROMIUM_SANDBOX=1 opts out (only safe for non-production
  // smoke / CI -- the bundled Chromium still runs in user-space, just
  // without the OS-level sandbox wrapper).
  const chromiumOptions = {
    enableMultiProcessOnLinux: true,
    ...(process.env.DISABLE_CHROMIUM_SANDBOX === "1"
      ? { disableSandbox: true }
      : {}),
  };

  if (process.env.DIAGNOSE_RENDERER === "1") {
    // eslint-disable-next-line no-console
    console.log(
      `[renderer] cwd=${process.cwd()} outputLocation=${outputLocation} ` +
        `parentDirExists=${fs.existsSync(path.dirname(outputLocation))} ` +
        `chromiumOptions=${JSON.stringify(chromiumOptions)}`,
    );
  }

  await renderMedia({
    composition: {
      ...composition,
      durationInFrames: totalFrames,
      fps: timeline.fps,
      width: timeline.width,
      height: timeline.height,
    },
    serveUrl: bundleLocation,
    // @remotion/renderer v4 renamed `outputPath` -> `outputLocation`.
    outputLocation,
    inputProps: { timeline },
    onProgress: (payload: { progress: number }) =>
      onProgress?.(payload.progress),
    chromiumOptions,
    // @remotion/renderer v4 requires `codec` to be set explicitly (v3
    // derived H.264 from `outputLocation`'s .mp4 suffix).
    codec: "h264",
    concurrency: 1,
  });

  if (process.env.DIAGNOSE_RENDERER === "1") {
    const wrote = fs.existsSync(outputLocation);
    // eslint-disable-next-line no-console
    console.log(
      `[renderer] post-render fileExists=${wrote}` +
        (wrote ? ` size=${fs.statSync(outputLocation).size}` : ""),
    );
  }

  return {
    id: jobId,
    outputLocation,
    outputUrl: `${host}/renders/${outputName}`,
  };
}

function computeMaxFrame(timeline: TimelineState): number {
  const layerMax = (s: number) => (s <= 0 ? 0 : Math.round(s));
  const videoMax = layerMax(
    Math.max(
      0,
      ...timeline.clips.map(
        (c: TimelineClip) => c.start + (c.trim.to - c.trim.from),
      ),
    ),
  );
  const audioMax = layerMax(
    Math.max(
      0,
      ...timeline.audioClips.map(
        (c) => c.start + (c.trim.to - c.trim.from),
      ),
    ),
  );
  const textMax = layerMax(
    Math.max(
      0,
      ...timeline.textClips.map((c) => c.start + c.duration),
    ),
  );
  const total = Math.max(videoMax, audioMax, textMax);
  return total === 0 ? timeline.fps * 5 : total * timeline.fps;
}
