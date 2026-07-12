// Tiny typed wrapper around the Express server. No external HTTP lib needed,
// the browser's `fetch` is fine because Vite's dev proxy makes everything
// same-origin in dev.

const BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");

export interface UploadAsset {
  id: string;
  name: string;
  filename: string;
  url: string;
  mime: string;
  /** Server tells the client what lane the file belongs on. */
  kind: "video" | "image" | "audio";
  size: number;
  pathOnDisk?: string;
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

export interface RenderResult {
  blob: Blob;
  filename: string;
}

export async function exportTimelineAsBinary(
  timeline: unknown,
  onProgress?: (p: number) => void,
): Promise<RenderResult> {
  const res = await fetch(`${BASE}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeline, mode: "binary" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "render failed");
  }
  // Total Render length comes from Content-Length if available.
  const total = Number(res.headers.get("Content-Length") ?? 0);
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        if (onProgress && total) onProgress(received / total);
      }
    }
  }
  return {
    blob: new Blob(chunks, { type: "video/mp4" }),
    filename: "remotion-export.mp4",
  };
}

export async function exportTimelineAsUrl(
  timeline: unknown,
): Promise<string> {
  const res = await fetch(`${BASE}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeline, mode: "url" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "render failed");
  }
  const json = (await res.json()) as { url: string };
  return json.url;
}
