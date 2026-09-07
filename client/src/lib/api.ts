// Tiny typed wrapper around the Express server. No external HTTP lib needed.
//
// BASE defaults to "" (same-origin): the Vite dev server proxies /api,
// /uploads and /renders to the Express backend, and the production nginx
// image does the same — so the SPA works without knowing where the server
// lives. Set VITE_API_BASE at BUILD time to point the built bundle at an
// absolute API origin instead (the value is inlined by Vite).
const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export interface UploadAsset {
  id: string;
  name: string;
  filename: string;
  url: string;
  mime: string;
  /** Server tells the client what lane the file belongs on. */
  kind: "video" | "image" | "audio";
  size: number;
}

export async function uploadFiles(files: File[]): Promise<UploadAsset[]> {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "upload failed");
  }
  const json = (await res.json()) as { assets: UploadAsset[] };
  return json.assets;
}

export async function deleteAsset(filename: string) {
  const res = await fetch(`${BASE}/api/upload/${filename}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("delete failed");
  return res.json();
}

// ---------- Render job flow ----------------------------------------------
//
// Rendering can take minutes, so the server runs it in the background:
//   1. POST /api/render/jobs        -> 202 { jobId }
//   2. GET  /api/render/jobs/:id    -> { status, progress, url?, error? }
//   3. GET  /api/render/jobs/:id/file -> the finished MP4 (streamed)
// The editor polls step 2 to drive the progress bar with REAL renderer
// progress, then streams step 3 through a Blob so the download works
// cross-origin (an <a download> to another origin would be ignored).

export interface RenderJobStatus {
  jobId: string;
  status: "rendering" | "done" | "error";
  /** 0..1 — the actual @remotion/renderer progress. */
  progress: number;
  url?: string;
  error?: string;
}

export async function startRenderJob(timeline: unknown): Promise<string> {
  const res = await fetch(`${BASE}/api/render/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeline }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "render failed to start");
  }
  const json = (await res.json()) as { jobId: string };
  return json.jobId;
}

export async function fetchRenderJob(jobId: string): Promise<RenderJobStatus> {
  const res = await fetch(`${BASE}/api/render/jobs/${jobId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "render job lookup failed");
  }
  return (await res.json()) as RenderJobStatus;
}

export interface RenderResult {
  blob: Blob;
  filename: string;
}

/** Fetch the finished MP4 for a completed job and hand it back as a Blob. */
export async function downloadRenderJobFile(jobId: string): Promise<RenderResult> {
  const res = await fetch(`${BASE}/api/render/jobs/${jobId}/file`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "render download failed");
  }
  const blob = await res.blob();
  return { blob, filename: "remotion-export.mp4" };
}
