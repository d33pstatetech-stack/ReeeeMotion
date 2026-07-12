import React, { useRef, useState } from "react";
import {
  Upload,
  Image as ImageIcon,
  Film,
  Music,
  Trash2,
  Plus,
  Loader2,
  GripVertical,
  Type,
} from "lucide-react";
import { Tooltip } from "./Tooltip";
import { useTimelineStore, type AssetItem } from "../store/timelineStore";
import { uploadFiles, deleteAsset } from "../lib/api";
import {
  makeClipFromAsset,
  makeAudioClipFromAsset,
  probeVideoDuration,
  probeAudioDuration,
  bgForKind,
} from "../lib/utils";
import { DEFAULT_TEXT_CLIP } from "compositions/types";

/** Custom MIME so the Timeline can recognize internal drags (vs OS file drops). */
export const ASSET_DRAG_MIME = "application/x-remotion-asset";

/** Payload shape serialized into the custom drag MIME. */
export interface AssetItemPayload {
  id: string;
  name: string;
  url: string;
  kind: "video" | "image" | "audio";
  filename?: string;
  size?: number;
}

export const MediaBin: React.FC = () => {
  const assets = useTimelineStore((s) => s.assets);
  const addAssets = useTimelineStore((s) => s.addAssets);
  const removeAsset = useTimelineStore((s) => s.removeAsset);
  const appendClip = useTimelineStore((s) => s.appendClip);
  const appendAudioClip = useTimelineStore((s) => s.appendAudioClip);
  const appendTextClip = useTimelineStore((s) => s.appendTextClip);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(fileList: FileList | File[]) {
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadFiles(Array.from(fileList));
      await Promise.all(
        uploaded.map(async (a) => {
          if (a.kind === "video") await probeVideoDuration(a.url);
          else if (a.kind === "audio") await probeAudioDuration(a.url);
        }),
      );
      addAssets(
        uploaded.map((u) => ({
          id: u.id,
          name: u.name,
          url: u.url,
          kind: u.kind,
          filename: u.filename,
          size: u.size,
        })),
      );
    } catch (e: any) {
      setError(e?.message ?? "upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onExternalDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }

  async function onRemove(asset: { id: string; filename?: string }) {
    try {
      if (asset.filename) await deleteAsset(asset.filename);
      removeAsset(asset.id);
    } catch (e: any) {
      setError(e?.message ?? "delete failed");
    }
  }

  async function onAppend(asset: AssetItem) {
    if (asset.kind === "audio") {
      const base = makeAudioClipFromAsset(asset);
      try {
        const dur = await probeAudioDuration(asset.url);
        base.trim = { from: 0, to: dur };
      } catch {
        base.trim = { from: 0, to: 5 };
      }
      appendAudioClip(base);
      return;
    }
    // video or image -> TimelineClip
    const base = makeClipFromAsset(asset);
    if (asset.kind === "video") {
      try {
        const dur = await probeVideoDuration(asset.url);
        base.trim = { from: 0, to: dur };
      } catch {
        base.trim = { from: 0, to: 5 };
      }
    } else {
      base.trim = { from: 0, to: 5 };
    }
    appendClip(base);
  }

  function onAssetDragStart(e: React.DragEvent, asset: AssetItem) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(asset));
    e.dataTransfer.setData("text/plain", asset.name);
  }

  function onAddText() {
    appendTextClip(DEFAULT_TEXT_CLIP({ id: crypto.randomUUID() }));
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Film className="h-4 w-4 text-indigo-300" />
          Media Bin
        </div>
        <div className="flex items-center gap-1.5">
          <Tooltip content="Add a text overlay to the timeline. Edit content, font and color in the Property Inspector.">
            <button
              onClick={onAddText}
              className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500/90 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-smooth hover:bg-cyan-500"
            >
              <Type className="h-3.5 w-3.5" />
              Text
            </button>
          </Tooltip>
          <Tooltip content="Upload videos (MP4, WebM, MOV), images (PNG, JPG, WebP, GIF), or audio (MP3, WAV, M4A, OGG). max 500 MB each.">
            <button
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500/90 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-smooth hover:bg-indigo-500"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </button>
          </Tooltip>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          hidden
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* External file drop zone */}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onExternalDrop}
        className={
          "relative m-3 cursor-pointer rounded-lg border-2 border-dashed p-4 text-center text-xs transition-smooth " +
          (dragOver
            ? "border-indigo-400 bg-indigo-400/10 text-indigo-200"
            : "border-white/10 text-zinc-500 hover:border-white/20")
        }
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading…
          </div>
        ) : (
          <>
            <Upload className="mx-auto mb-1 h-5 w-5" />
            <div>
              <strong className="text-zinc-300">Drag &amp; drop</strong> files here,
              or click to choose.
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">
              Video · Image · Audio, up to 500 MB each
            </div>
          </>
        )}
      </div>

      {error ? (
        <div className="mx-3 mb-2 rounded-md bg-rose-500/10 px-2 py-1.5 text-xs text-rose-300">
          {error}
        </div>
      ) : null}

      {/* Asset list */}
      <div className="grid grid-cols-2 gap-2 overflow-y-auto p-3">
        {assets.length === 0 ? (
          <div className="col-span-2 py-6 text-center text-xs text-zinc-500">
            No media uploaded yet.
          </div>
        ) : null}
        {assets.map((a) => (
          <div
            key={a.id}
            draggable
            onDragStart={(e) => onAssetDragStart(e, a)}
            className="group cursor-grab overflow-hidden rounded-lg bg-ink-700 ring-1 ring-white/5 transition-smooth hover:ring-indigo-400/40 active:cursor-grabbing"
            style={{ background: bgForKind(a.kind) }}
          >
            {a.kind === "image" ? (
              <img
                src={a.url}
                alt={a.name}
                className="h-24 w-full object-cover"
                loading="lazy"
                draggable={false}
              />
            ) : a.kind === "video" ? (
              <video
                src={a.url}
                className="h-24 w-full object-cover"
                preload="metadata"
                draggable={false}
              />
            ) : (
              <div className="flex h-24 w-full items-center justify-center bg-gradient-to-br from-emerald-700 to-emerald-900 text-emerald-200">
                <Music className="h-8 w-8" />
              </div>
            )}
            <div className="p-2">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">
                {a.kind === "video" ? (
                  <Film className="h-3 w-3" />
                ) : a.kind === "audio" ? (
                  <Music className="h-3 w-3" />
                ) : (
                  <ImageIcon className="h-3 w-3" />
                )}
                {a.kind}
                <GripVertical className="ml-auto h-3 w-3 opacity-40" />
              </div>
              <div className="truncate text-xs text-zinc-100" title={a.name}>
                {a.name}
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <Tooltip content={`Add this ${a.kind} to the timeline.`}>
                  <button
                    className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-100 transition-smooth hover:bg-white/20"
                    onClick={() => onAppend(a)}
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </Tooltip>
                <Tooltip content="Delete this asset from the server and the Media Bin.">
                  <button
                    className="rounded p-1 text-zinc-400 transition-smooth hover:bg-rose-500/20 hover:text-rose-300"
                    onClick={() => onRemove(a)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
