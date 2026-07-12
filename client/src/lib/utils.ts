import type { TimelineClip, AudioClip } from "compositions/types";
import { DEFAULT_AUDIO_CLIP } from "compositions/types";
import type { AssetItem } from "../store/timelineStore"; // type-only — erased at compile time, no runtime cycle

/** "MM:SS" formatter for short durations (timeline UI). */
export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * Promote uploaded File metadata -> a brand-new TimelineClip.
 * Accepts an AssetItem (full discriminated union); only video/image are
 * valid; throws if given an audio asset.
 */
export function makeClipFromAsset(asset: AssetItem): TimelineClip {
  if (asset.kind !== "video" && asset.kind !== "image") {
    throw new Error(`makeClipFromAsset: unsupported kind "${asset.kind}" (use makeAudioClipFromAsset for audio)`);
  }
  if (asset.kind === "video") {
    return {
      id: crypto.randomUUID(),
      name: asset.name,
      type: "video",
      src: asset.url,
      trim: { from: 0, to: 5 },
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
    };
  }
  return {
    id: crypto.randomUUID(),
    name: asset.name,
    type: "image",
    src: asset.url,
    trim: { from: 0, to: 5 },
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
  };
}

/**
 * Build a brand-new AudioClip from an uploaded asset (mimetype audio/*).
 * Accepts an AssetItem; only `kind === "audio"` is valid; throws otherwise.
 * Caller is responsible for trimming duration later (probe in the client).
 */
export function makeAudioClipFromAsset(asset: AssetItem): AudioClip {
  if (asset.kind !== "audio") {
    throw new Error(`makeAudioClipFromAsset: unsupported kind "${asset.kind}" (use makeClipFromAsset for video/image)`);
  }
  return DEFAULT_AUDIO_CLIP({
    id: crypto.randomUUID(),
    name: asset.name,
    src: asset.url,
  });
}

/** Walks an array and inserts/moves an item to a new index. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/** Returns the natural duration of a media URL using a hidden <video>. */
export function probeVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.onloadedmetadata = () => resolve(v.duration || 5);
    v.onerror = () => resolve(5);
  });
}

/** Returns the natural duration of an audio URL using a hidden <audio>. */
export function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.src = url;
    a.onloadedmetadata = () => resolve(a.duration || 5);
    a.onerror = () => resolve(5);
  });
}

/** Returns true for common image extensions. */
export function isImageFilename(name: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

/** Returns true for common video extensions. */
export function isVideoFilename(name: string) {
  return /\.(mp4|webm|mov|m4v)$/i.test(name);
}

/** Clamp helper. */
export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Pick a CSS background that hints at the asset type. */
export function bgForKind(kind: "video" | "image" | "audio") {
  if (kind === "image")
    return "linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)";
  if (kind === "audio")
    return "linear-gradient(135deg, #064e3b 0%, #042f2e 100%)";
  return "linear-gradient(135deg, #0f766e 0%, #14532d 100%)";
}

/** Trigger a browser download for a Blob with a chosen filename. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  // Modern browsers dispatch a download from a detached <a>.click() —
  // no need to mount the element into the DOM (which also dodges a class
  // of test brittleness around jsdom Node type-checking).
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Defer revocation so the browser has time to start the download stream.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Find which clip array an id belongs to. Returns 'clip' for video/image,
 * 'audio' for AudioClip, 'text' for TextClip, or null if not found.
 */
export function findClipKind(
  timeline: { clips: Array<{ id: string }>; audioClips: Array<{ id: string }>; textClips: Array<{ id: string }> },
  id: string,
): "clip" | "audio" | "text" | null {
  if (timeline.clips.some((c) => c.id === id)) return "clip";
  if (timeline.audioClips.some((c) => c.id === id)) return "audio";
  if (timeline.textClips.some((c) => c.id === id)) return "text";
  return null;
}

/** Copy a string to the clipboard. Falls back to execCommand if Clipboard
 *  API is unavailable (e.g. insecure context). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  } catch {
    return false;
  }
}

/** Sanitize a string so it can be safely used as a filename. */
export function safeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return cleaned || "untitled";
}

// ---------- Timecode HH:MM:SS:FF ---------------------------------------

/**
 * Format a seconds value as a broadcast-style timecode.
 * Uses floor-frame math so 0.95s @ 30fps is 00:00:00:28 (not 00:00:00:29):
 * the displayed frame is always the one currently being shown by Remotion,
 * never the next one. 1.0s @ 30fps is 00:00:01:00.
 */
export function formatTimecode(seconds: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps) || 30);
  const totalFrames = Math.max(0, Math.floor(seconds * safeFps));
  const f = totalFrames % safeFps;
  const totalSec = Math.floor(totalFrames / safeFps);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

// ---------- Magnetic snapping -------------------------------------------

export type SnapSource = "zero" | "playhead" | "clip";

export interface SnapGuide {
  sec: number;
  source: SnapSource;
}

/** Pixels-threshold below which we treat the dragged item as magnetized. */
export const SNAP_THRESHOLD_PX = 10;

/**
 * Collect every position a clip could magnetize to while dragging: the
 * timeline start (0), the playhead, and the start/end of every other clip
 * (across all three lanes — cross-lane snap is rarely surprising for users).
 */
export function collectSnapPoints(
  timeline: { clips: Array<{ id: string; start: number; trim: { from: number; to: number } }> } & {
    audioClips: Array<{ id: string; start: number; trim: { from: number; to: number } }>;
  } & {
    textClips: Array<{ id: string; start: number; duration: number }>;
  } & { fps: number },
  currentFrame: number,
  excludeClipId?: string,
): SnapGuide[] {
  // Dedupe by `sec` so the timeline-zero source and a playhead-at-frame-0
  // don't both push 0. Source priority: zero > playhead > clip (so the
  // snap-guide UI labels the zero-second origin correctly).
  const bySec = new Map<number, SnapGuide>();
  const add = (g: SnapGuide) => {
    const cur = bySec.get(g.sec);
    if (!cur || sourcePriority(g.source) > sourcePriority(cur.source)) {
      bySec.set(g.sec, g);
    }
  };
  add({ sec: 0, source: "zero" });
  add({ sec: currentFrame / timeline.fps, source: "playhead" });
  const pushOne = (id: string, start: number, end: number) => {
    if (id === excludeClipId || end <= start) return;
    add({ sec: start, source: "clip" });
    add({ sec: end, source: "clip" });
  };
  for (const c of timeline.clips) {
    pushOne(c.id, c.start, c.start + (c.trim.to - c.trim.from));
  }
  for (const a of timeline.audioClips) {
    pushOne(a.id, a.start, a.start + (a.trim.to - a.trim.from));
  }
  for (const t of timeline.textClips) {
    pushOne(t.id, t.start, t.start + t.duration);
  }
  return Array.from(bySec.values()).sort((a, b) => a.sec - b.sec);
}

function sourcePriority(s: SnapSource): number {
  return s === "zero" ? 3 : s === "playhead" ? 2 : 1;
}

/**
 * Snap `target` seconds to the nearest candidate within `thresholdPx`.
 * Returns the original value if nothing is close enough.
 */
export function snapSeconds(
  target: number,
  candidates: SnapGuide[],
  pxPerSec: number,
  thresholdPx: number = SNAP_THRESHOLD_PX,
): { sec: number; guide: SnapGuide | null } {
  const thresholdSec = thresholdPx / Math.max(1, pxPerSec);
  // Allowance for floating-point representation noise (e.g. target 5.013 at
  // a threshold of 0.0125 should still register as a near-miss for 5).
  const EPS = 1e-9;
  let best: { guide: SnapGuide; diff: number } | null = null;
  for (const c of candidates) {
    const diff = Math.abs(c.sec - target);
    if (diff <= thresholdSec + EPS && (!best || diff < best.diff)) {
      best = { guide: c, diff };
    }
  }
  return best ? { sec: best.guide.sec, guide: best.guide } : { sec: target, guide: null };
}
