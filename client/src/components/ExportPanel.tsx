import React, { useEffect, useRef, useState } from "react";
import { Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { useTimelineStore } from "../store/timelineStore";
import {
  startRenderJob,
  fetchRenderJob,
  downloadRenderJobFile,
} from "../lib/api";

const POLL_INTERVAL_MS = 1000;

export const ExportPanel: React.FC = () => {
  const timeline = useTimelineStore((s) => s.timeline);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  // Abort polling if the component unmounts mid-render.
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    };
  }, []);

  async function onExport() {
    setError(null);
    setBusy(true);
    setProgress(0);
    try {
      // 1. Kick off the background render; the server replies immediately
      //    with a job id so we can poll REAL renderer progress (the
      //    previous UX pinned the bar at 0% for the entire render).
      const jobId = await startRenderJob(timeline);
      // 2. Poll until done/error.
      await new Promise<void>((resolve, reject) => {
        pollTimer.current = window.setInterval(() => {
          fetchRenderJob(jobId)
            .then((job) => {
              if (job.status === "error") {
                reject(new Error(job.error ?? "render failed"));
                return;
              }
              setProgress(job.progress);
              if (job.status === "done") {
                setLastUrl(job.url ?? null);
                resolve();
              }
            })
            .catch(reject);
        }, POLL_INTERVAL_MS);
      });
      // 3. Stream the finished MP4 through a Blob so the browser download
      //    works regardless of which origin serves the file.
      const result = await downloadRenderJobFile(jobId);
      const url = URL.createObjectURL(result.blob);
      // Auto-trigger download for convenience.
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke the object URL once the download has had a moment to start.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "export failed");
    } finally {
      if (pollTimer.current !== null) {
        window.clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {lastUrl ? (
        <Tooltip content="Open the most recently exported MP4 in a new tab.">
          <a
            href={lastUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-smooth hover:bg-emerald-500/20"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Last render
          </a>
        </Tooltip>
      ) : null}

      {busy ? (
        <div className="flex items-center gap-2 rounded-md bg-ink-700 px-3 py-1.5 text-xs text-zinc-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Rendering…
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
            <div
              className={
                "h-full rounded-full " +
                (progress === null ? "indeterminate w-1/2" : "bg-indigo-400")
              }
              style={progress !== null ? { width: `${Math.round(progress * 100)}%` } : undefined}
            />
          </div>
          {progress !== null ? (
            <span className="font-mono">{Math.round(progress * 100)}%</span>
          ) : null}
        </div>
      ) : (
        <Tooltip content="Render the timeline to an MP4 using @remotion/renderer on the server, then download.">
          <button
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-smooth hover:bg-indigo-400"
          >
            <Download className="h-4 w-4" /> Export MP4
          </button>
        </Tooltip>
      )}

      {error ? (
        <div className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      ) : null}
    </div>
  );
};
