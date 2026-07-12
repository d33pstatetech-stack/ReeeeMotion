import React, { useRef, useState } from "react";
import {
  Wand2,
  Monitor,
  Undo2,
  Redo2,
  RotateCcw,
  Save,
  FolderOpen,
  AlertCircle,
  CheckCircle2,
  Share2,
  Link as LinkIcon,
  Clock3,
  X,
  History,
  HelpCircle,
} from "lucide-react";
import { Tooltip } from "./Tooltip";
import { useTimelineStore } from "../store/timelineStore";
import { useRecentProjects } from "../hooks/useRecentProjects";
import { ExportPanel } from "./ExportPanel";
import {
  safeFilename,
  downloadBlob,
  copyToClipboard,
} from "../lib/utils";
import { buildShareUrl } from "../lib/share";
import {
  PROJECT_FILE_KIND,
  type ProjectFile,
} from "compositions/types";

const SIZES: { label: string; w: number; h: number }[] = [
  { label: "720p", w: 1280, h: 720 },
  { label: "1080p", w: 1920, h: 1080 },
  { label: "Vertical 9:16", w: 1080, h: 1920 },
  { label: "Square 1:1", w: 1080, h: 1080 },
];

export const Toolbar: React.FC = () => {
  const w = useTimelineStore((s) => s.timeline.width);
  const h = useTimelineStore((s) => s.timeline.height);
  const setDimensions = useTimelineStore((s) => s.setDimensions);
  const clipCount = useTimelineStore((s) => s.timeline.clips.length);

  const canUndo = useTimelineStore((s) => s.past.length > 0);
  const canRedo = useTimelineStore((s) => s.future.length > 0);
  const undo = useTimelineStore((s) => s.undo);
  const redo = useTimelineStore((s) => s.redo);
  const resetTimeline = useTimelineStore((s) => s.resetTimeline);

  const exportProject = useTimelineStore((s) => s.exportProject);
  const importProject = useTimelineStore((s) => s.importProject);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectName, setProjectName] = useState("untitled");
  type ToastMsg = { kind: "ok" | "err"; msg: string; url?: string };
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [sharePreview, setSharePreview] = useState<string | null>(null);
  const { recents, push: pushRecent, remove: removeRecent } = useRecentProjects();
  const [recentsOpen, setRecentsOpen] = useState(false);
  const recentsRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!recentsOpen) return;
    function onDown(e: MouseEvent) {
      if (recentsRef.current && !recentsRef.current.contains(e.target as Node)) {
        setRecentsOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setRecentsOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [recentsOpen]);

  // Auto-clear toast after a few seconds.
  React.useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  function flash(msg: NonNullable<ToastMsg>) {
    setToast(msg);
  }

  function onSave() {
    const project = exportProject(projectName);
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `${safeFilename(project.name)}.remotion.json`);
    pushRecent(project.name);
    flash({ kind: "ok", msg: `Saved ${project.name}.remotion.json` });
  }

  async function onShare() {
    const state = useTimelineStore.getState();
    const { url, tooLong } = buildShareUrl(state.timeline, projectName);
    if (tooLong) {
      flash({
        kind: "err",
        msg: `Project too large for a URL. Use \u201cSave\u201d instead.`,
      });
      return;
    }
    const ok = await copyToClipboard(url);
    if (ok) {
      setSharePreview(url);
      pushRecent(projectName);
      flash({
        kind: "ok",
        msg: `Share URL copied. ${url.length.toLocaleString()} chars.`,
        url,
      });
    } else {
      flash({ kind: "err", msg: `Could not copy to clipboard.` });
    }
  }

  function onPickFile() {
    fileInputRef.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-pick of same file
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ProjectFile;
      const result = importProject(parsed);
      if (!result.ok) {
        flash({ kind: "err", msg: `Load failed: ${result.reason}` });
        return;
      }
      if (typeof parsed.name === "string") {
        setProjectName(parsed.name);
        pushRecent(parsed.name);
      }
      flash({ kind: "ok", msg: `Loaded ${parsed.name ?? file.name}` });
    } catch (err: any) {
      flash({
        kind: "err",
        msg: `Load failed: ${err?.message ?? "invalid JSON"}`,
      });
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/5 bg-ink-800/70 backdrop-blur-md px-4">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent-violet via-accent-indigo to-accent-fuchsia shadow-glow-violet">
          <Wand2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight">
            Remotion Video Editor
          </div>
          <div className="text-[11px] text-zinc-500">
            Local · Open-source · {clipCount} clips on the timeline
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Project name + recent + Save / Share / Load */}
        <Tooltip content="Project name used by Save and Share.">
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project name"
            className="h-8 w-40 rounded-md border border-white/10 bg-ink-700/60 px-2 text-xs text-zinc-100 outline-none transition-smooth duration-250 focus:border-accent-violet"
          />
        </Tooltip>
        {recents.length > 0 ? (
          <div ref={recentsRef} className="relative">
            <Tooltip content="Recent project names on this device (last 5).">
              <button
                onClick={() => setRecentsOpen((v) => !v)}
                aria-expanded={recentsOpen}
                aria-haspopup="listbox"
                className={
                  "inline-flex h-8 w-8 items-center justify-center rounded-md ring-1 transition-smooth duration-250 active:scale-95 " +
                  (recentsOpen
                    ? "bg-accent-violet/30 text-violet-100 ring-accent-violet/50"
                    : "bg-ink-700/60 text-zinc-300 ring-white/10 hover:bg-ink-600")
                }
                aria-label="Recent projects"
              >
                <History className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            {recentsOpen ? (
              <div
                role="listbox"
                className="absolute right-0 top-9 z-50 w-64 overflow-hidden rounded-xl bg-ink-700/95 shadow-2xl ring-1 ring-white/10 backdrop-blur-md animate-fade-in"
              >
                <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                  <Clock3 className="h-3 w-3" />
                  Recent projects
                </div>
                <ul className="max-h-64 overflow-y-auto p-1">
                  {recents.map((n) => {
                    const active = n === projectName;
                    return (
                      <li
                        key={n}
                        className="group flex items-center justify-between gap-1 rounded-md"
                      >
                        <button
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            setProjectName(n);
                            setRecentsOpen(false);
                          }}
                          className={
                            "flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs transition-smooth duration-250 " +
                            (active
                              ? "bg-accent-violet/20 text-violet-100"
                              : "text-zinc-200 hover:bg-white/5")
                          }
                        >
                          {n}
                        </button>
                        <Tooltip content="Remove from recent list.">
                          <button
                            onClick={() => removeRecent(n)}
                            aria-label={`Forget ${n}`}
                            className="grid h-6 w-6 place-items-center rounded text-zinc-500 opacity-0 transition-smooth duration-250 hover:bg-rose-500/20 hover:text-rose-200 group-hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Tooltip>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <Tooltip content="Download the current timeline as a `.remotion.json` file. Includes audio + text clips and clip settings.">
          <button
            onClick={onSave}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink-700/60 px-2.5 text-xs font-medium text-zinc-100 ring-1 ring-white/10 transition-smooth duration-250 hover:bg-ink-600"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
        </Tooltip>
        <Tooltip content="Copy a shareable URL of this project to your clipboard. Recipients who already have the media URLs in their project can paste the link to load the timeline.">
          <button
            onClick={onShare}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-violet/20 px-2.5 text-xs font-medium text-violet-100 ring-1 ring-accent-violet/40 transition-smooth duration-250 hover:bg-accent-violet/30"
          >
            <Share2 className="h-3.5 w-3.5" /> Share
          </button>
        </Tooltip>
        <Tooltip content="Replace the timeline with a `.remotion.json` project file from disk.">
          <button
            onClick={onPickFile}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink-700/60 px-2.5 text-xs font-medium text-zinc-100 ring-1 ring-white/10 transition-smooth duration-250 hover:bg-ink-600"
          >
            <FolderOpen className="h-3.5 w-3.5" /> Load
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={onFileChosen}
        />

        {toast ? (
          <div
            role="status"
            aria-live="polite"
            className={
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ring-1 " +
              (toast.kind === "ok"
                ? "bg-emerald-500/10 text-emerald-200 ring-emerald-400/30"
                : "bg-rose-500/10 text-rose-200 ring-rose-400/30")
            }
          >
            {toast.kind === "ok" ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <AlertCircle className="h-3 w-3" />
            )}
            <span>{toast.msg}</span>
            {toast.url ? (
              <Tooltip content={toast.url}>
                <LinkIcon className="h-3 w-3 opacity-60" />
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        <div className="mx-1 h-6 w-px bg-white/10" />

        {/* History */}
        <Tooltip content={canUndo ? "Undo the last edit (Ctrl+Z)." : "Nothing to undo yet."}>
          <button
            onClick={undo}
            disabled={!canUndo}
            className="grid h-8 w-8 place-items-center rounded-md bg-ink-700/60 text-zinc-200 ring-1 ring-white/10 transition-smooth duration-250 hover:bg-ink-600 disabled:cursor-not-allowed disabled:opacity-30 active:scale-95"
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content={canRedo ? "Redo the last undone edit (Ctrl+Y or Ctrl+Shift+Z)." : "Nothing to redo yet."}>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="grid h-8 w-8 place-items-center rounded-md bg-ink-700/60 text-zinc-200 ring-1 ring-white/10 transition-smooth duration-250 hover:bg-ink-600 disabled:cursor-not-allowed disabled:opacity-30 active:scale-95"
            aria-label="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </Tooltip>

        <div className="mx-1 h-6 w-px bg-white/10" />

        <Tooltip content="Clear every clip from the timeline and start fresh. (Undoable with Ctrl+Z.)">
          <button
            onClick={() => {
              if (clipCount === 0) return;
              if (
                confirm("Clear the entire timeline? This is undoable with Ctrl+Z.")
              ) {
                resetTimeline();
              }
            }}
            className="grid h-8 w-8 place-items-center rounded-md bg-ink-700/60 text-zinc-300 ring-1 ring-white/10 transition-smooth duration-250 hover:bg-rose-500/20 hover:text-rose-200 active:scale-95"
            aria-label="Reset timeline"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </Tooltip>

        <div className="mx-1 h-6 w-px bg-white/10" />

        {/* Canvas size */}
        <Tooltip content="Choose the resolution your final MP4 will be exported at.">
          <label className="flex items-center gap-2 rounded-md bg-ink-700/60 px-2 py-1 text-xs text-zinc-300 ring-1 ring-white/10">
            <Monitor className="h-3.5 w-3.5" />
            <span className="text-zinc-400">Canvas</span>
            <select
              value={`${w}x${h}`}
              onChange={(e) => {
                const [nw, nh] = e.target.value.split("x").map(Number);
                if (Number.isFinite(nw) && Number.isFinite(nh))
                  setDimensions(nw, nh);
              }}
              className="bg-transparent text-xs font-medium text-zinc-100 outline-none"
            >
              {SIZES.map((s) => (
                <option
                  key={s.label}
                  value={`${s.w}x${s.h}`}
                  className="bg-ink-800 text-zinc-100"
                >
                  {s.label} ({s.w}×{s.h})
                </option>
              ))}
            </select>
          </label>
        </Tooltip>

        <div className="mx-1 h-6 w-px bg-white/10" />

        {/* User guide — always-available escape hatch at the far right, opens in a new tab so the editor state is preserved */}
        <Tooltip content="Open the user guide in a new tab. Covers Quickstart, the timeline, every property, keyboard shortcuts, exporting, and a glossary of terms.">
          <a
            href="/user-guide.html"
            target="_blank"
            rel="noopener noreferrer"
            className="grid h-8 w-8 place-items-center rounded-md bg-ink-700/60 text-zinc-300 ring-1 ring-white/10 transition-smooth duration-250 hover:bg-ink-600 active:scale-95"
            aria-label="Open user guide"
          >
            <HelpCircle className="h-4 w-4" />
          </a>
        </Tooltip>

        <div className="mx-1 h-6 w-px bg-white/10" />

        <ExportPanel />
      </div>
    </header>
  );
};
