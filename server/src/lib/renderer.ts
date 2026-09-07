import path from "path";
import fs from "fs";
import os from "os";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type {
  TimelineClip,
  TimelineState,
} from "../compositions-types";
import { safeFps, timelineEndFrames } from "../compositions-types";

export interface RenderJob {
  id: string;
  outputLocation: string;
  outputUrl: string;
}

const COMPOSITIONS_ENTRY = path.resolve(
  process.cwd(),
  process.env.COMPOSITIONS_ENTRY ?? "../compositions/src/index.ts",
);

// Source tree watched for bundle-cache invalidation. The bundler entry lives
// inside this directory, so "did any source file change since the last
// bundle?" is answerable by walking it once and comparing mtimes.
const COMPOSITIONS_SRC = path.dirname(COMPOSITIONS_ENTRY);

// Where the cached webpack bundle lives. Override with BUNDLE_CACHE_DIR.
const BUNDLE_DIR =
  process.env.BUNDLE_CACHE_DIR ??
  path.join(os.tmpdir(), "remotion-editor-bundle");
const BUNDLE_STAMP = path.join(BUNDLE_DIR, ".bundle-stamp");

// Set REMOTION_REBUNDLE=1 to skip the cache unconditionally (e.g. when
// debugging the bundler itself).
const FORCE_REBUNDLE = process.env.REMOTION_REBUNDLE === "1";

/**
 * bundle() is a full webpack build (5-15s). The compositions source only
 * changes when the repo changes, so we cache the output directory and
 * re-bundle only when any file under COMPOSITIONS_SRC is newer than the
 * stamp written after the last successful bundle. A single-flight promise
 * guards against concurrent renders racing to re-bundle simultaneously.
 */
let bundlePromise: Promise<string> | null = null;

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          newest = Math.max(newest, fs.statSync(full).mtimeMs);
        } catch {
          /* file vanished mid-walk - ignore */
        }
      }
    }
  };
  walk(dir);
  return newest;
}

async function bundleCacheIsFresh(): Promise<boolean> {
  if (FORCE_REBUNDLE || !fs.existsSync(BUNDLE_STAMP)) return false;
  try {
    const builtAt = Number(fs.readFileSync(BUNDLE_STAMP, "utf8"));
    if (!Number.isFinite(builtAt)) return false;
    return (await newestMtime(COMPOSITIONS_SRC)) <= builtAt;
  } catch {
    return false;
  }
}

export function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      if (await bundleCacheIsFresh()) {
        // eslint-disable-next-line no-console
        console.log(`[renderer] reusing cached bundle at ${BUNDLE_DIR}`);
        return BUNDLE_DIR;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[renderer] bundling ${COMPOSITIONS_ENTRY} -> ${BUNDLE_DIR} (cache cold or stale)`,
      );
      const started = Date.now();
      const loc = await bundle({
        entryPoint: COMPOSITIONS_ENTRY,
        // bundle() clears/overwrites an existing outDir itself.
        outDir: BUNDLE_DIR,
      });
      fs.writeFileSync(BUNDLE_STAMP, String(Date.now()));
      // eslint-disable-next-line no-console
      console.log(`[renderer] bundled in ${Date.now() - started}ms`);
      return loc;
    })().catch((err) => {
      // Allow a retry on the next request instead of caching the failure.
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}

/**
 * Wrap low-level renderer failures (offline Chromium download, missing
 * browser, corrupt media) in an actionable message instead of a bare
 * ECONNRESET / ENOENT stack. The only outbound network call made during
 * bundling/rendering is the one-time headless-Chromium download, so a
 * network-flavored error in these phases is always the browser fetch.
 */
function explainRenderError(err: unknown): Error {
  const msg = String((err as Error)?.message ?? err);
  if (/TLS|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed|network/i.test(msg)) {
    return new Error(
      "The Remotion headless-Chromium download failed (network unreachable). " +
        "Exporting needs a browser on first use; afterwards it is cached. " +
        "Reconnect to the internet and retry, or pre-install it with " +
        "`npm run ensure-browser` inside server/.",
    );
  }
  if (/browser.*(not found|executable|ENOENT)/i.test(msg)) {
    return new Error(
      "No headless browser is installed for the renderer. " +
        "Run `npm run ensure-browser` inside server/ once (requires internet once), then retry.",
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

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
  const bundleLocation = await getBundle().catch((err) => {
    throw explainRenderError(err);
  });

  // selectComposition is where the headless browser gets ensured/downloaded,
  // so its failures need the same actionable wrapping as the render itself.
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "MainComposition",
    inputProps: { timeline },
  }).catch((err: unknown) => {
    throw explainRenderError(err);
  });

  // Canonical duration: the same round(seconds * fps) math the editor
  // preview uses (shared timelineEndFrames helper), so the exported MP4
  // is never shorter than what the user saw while editing.
  const totalFrames = Math.max(
    1,
    timelineEndFrames(timeline) || Math.round(safeFps(timeline.fps) * 5),
  );

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

  // Worker concurrency: null = Remotion picks (about half the cores).
  // RENDER_CONCURRENCY=1 pins the old single-worker behavior; any positive
  // integer overrides. Invalid values fall through to null safely.
  const concurrencyEnv = Number(process.env.RENDER_CONCURRENCY ?? "");
  const concurrency =
    Number.isFinite(concurrencyEnv) && concurrencyEnv >= 1
      ? concurrencyEnv
      : null;

  if (process.env.DIAGNOSE_RENDERER === "1") {
    // eslint-disable-next-line no-console
    console.log(
      `[renderer] cwd=${process.cwd()} outputLocation=${outputLocation} ` +
        `parentDirExists=${fs.existsSync(path.dirname(outputLocation))} ` +
        `frames=${totalFrames} concurrency=${concurrency} ` +
        `chromiumOptions=${JSON.stringify(chromiumOptions)}`,
    );
  }

  try {
    await renderMedia({
      composition: {
        ...composition,
        durationInFrames: totalFrames,
        fps: safeFps(timeline.fps),
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
      concurrency,
    });
  } catch (err) {
    throw explainRenderError(err);
  }

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
