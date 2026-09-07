import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Scissors,
  Trash2,
  GripVertical,
  ZoomIn,
  ZoomOut,
  ChevronsLeft,
  ChevronsRight,
  Music,
  Type as TypeIcon,
  Plus,
  Film,
} from "lucide-react";
import { Tooltip } from "./Tooltip";
import {
  useTimelineStore,
  useTimelineDuration,
} from "../store/timelineStore";
import {
  formatTime,
  probeVideoDuration,
  probeAudioDuration,
  findClipKind,
  collectSnapPoints,
  snapSeconds,
  type SnapGuide,
} from "../lib/utils";
import { timelineEndFrames } from "compositions/types";
import { ASSET_DRAG_MIME, type AssetItemPayload } from "./MediaBin";

const PIXELS_PER_SECOND_DEFAULT = 80;
const TRACK_PAD_PX = 4;

type DragKind = "trim-l" | "trim-r" | "move";

function readAssetFromDataTransfer(dt: DataTransfer): AssetItemPayload | null {
  const raw = dt.getData(ASSET_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.url === "string" &&
      (parsed.kind === "video" ||
        parsed.kind === "image" ||
        parsed.kind === "audio")
    ) {
      return parsed as AssetItemPayload;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const Timeline: React.FC = () => {
  const timeline = useTimelineStore((s) => s.timeline);
  const selectedClipId = useTimelineStore((s) => s.selectedClipId);
  const selectedAudioClipId = useTimelineStore((s) => s.selectedAudioClipId);
  const selectedTextClipId = useTimelineStore((s) => s.selectedTextClipId);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const selectAudioClip = useTimelineStore((s) => s.selectAudioClip);
  const selectTextClip = useTimelineStore((s) => s.selectTextClip);
  const removeClip = useTimelineStore((s) => s.removeClip);
  const removeAudioClip = useTimelineStore((s) => s.removeAudioClip);
  const removeTextClip = useTimelineStore((s) => s.removeTextClip);
  const appendClipAt = useTimelineStore((s) => s.appendClipAt);
  const appendAudioClipAt = useTimelineStore((s) => s.appendAudioClipAt);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const updateAudioClip = useTimelineStore((s) => s.updateAudioClip);
  const appendTextClip = useTimelineStore((s) => s.appendTextClip);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  const totalSeconds = useTimelineDuration();
  const [zoom, setZoom] = useState(PIXELS_PER_SECOND_DEFAULT);
  const pxPerSec = zoom;

  const ticks = useMemo(() => {
    const arr: number[] = [];
    const total = Math.max(totalSeconds, 1);
    const step = total > 60 ? 5 : 1;
    for (let s = 0; s <= total + step; s += step) arr.push(s);
    return arr;
  }, [totalSeconds]);

  const [drop, setDrop] = useState<{ lane: "video" | "audio"; sec: number } | null>(
    null,
  );

  // ---------- drag handler (kind-aware via findClipKind) ---------------

  const pxPerSecRef = useRef(pxPerSec);
  useEffect(() => {
    pxPerSecRef.current = pxPerSec;
  }, [pxPerSec]);

  const dragRef = useRef<{
    kind: DragKind;
    clipId: string;
    clipKind: "clip" | "audio" | "text";
    startX: number;
    initialStart: number;
    initialTrim: { from: number; to: number };
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // The line drawn at the nearest magnetic point while the user drags.
  const [snapGuide, setSnapGuide] = useState<{ sec: number } | null>(null);

  const startDrag = useCallback(
    (kind: DragKind, clipId: string, e: React.MouseEvent) => {
      const tl = useTimelineStore.getState().timeline;
      const clipKind = findClipKind(tl, clipId);
      if (!clipKind) return;
      // Text clips have no trim — only moves.
      if (clipKind === "text" && kind !== "move") return;

      // Look the initial state up in the lane the clip actually lives in.
      // (Text clips were previously looked up in `clips` and silently
      // failed to drag.)
      const initial =
        clipKind === "audio"
          ? tl.audioClips.find((c) => c.id === clipId)
          : clipKind === "text"
            ? tl.textClips.find((c) => c.id === clipId)
            : tl.clips.find((c) => c.id === clipId);
      if (!initial) return;

      // Snapshot history only AFTER the drag is validated — a rejected
      // drag (e.g. trying to trim a text clip) must not push an empty
      // undo step.
      useTimelineStore.getState().beginInteraction();

      dragRef.current = {
        kind,
        clipId,
        clipKind,
        startX: e.clientX,
        initialStart: initial.start,
        // Text clips have no trim window — a zero span keeps the shared
        // drag state shape honest for the move-only case.
        initialTrim:
          "trim" in initial ? { ...initial.trim } : { from: 0, to: 0 },
      };

      const setGuideIfPresent = (g: SnapGuide | null) =>
        setSnapGuide(g ? { sec: g.sec } : null);

      const onMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const deltaSec = (ev.clientX - d.startX) / pxPerSecRef.current;
        const s = useTimelineStore.getState();
        // Snapshot of snap candidates excluding the clip being dragged.
        const points = collectSnapPoints(
          s.timeline,
          s.currentFrame,
          d.clipId,
        );
        if (d.clipKind === "audio") {
          if (d.kind === "trim-l") {
            const target = d.initialTrim.from + deltaSec;
            const snap = snapSeconds(target, points, pxPerSecRef.current);
            s.setAudioTrim(d.clipId, {
              from: Math.max(0, snap.sec),
              to: d.initialTrim.to,
            });
            setGuideIfPresent(snap.guide);
          } else if (d.kind === "trim-r") {
            const target = d.initialTrim.to + deltaSec;
            const snap = snapSeconds(target, points, pxPerSecRef.current);
            s.setAudioTrim(d.clipId, {
              from: d.initialTrim.from,
              to: Math.max(d.initialTrim.from + 0.1, snap.sec),
            });
            setGuideIfPresent(snap.guide);
          } else {
            const target = d.initialStart + deltaSec;
            const snap = snapSeconds(target, points, pxPerSecRef.current);
            s.setAudioStart(d.clipId, Math.max(0, snap.sec));
            setGuideIfPresent(snap.guide);
          }
        } else if (d.clipKind === "text") {
          const target = d.initialStart + deltaSec;
          const snap = snapSeconds(target, points, pxPerSecRef.current);
          s.setTextStart(d.clipId, Math.max(0, snap.sec));
          setGuideIfPresent(snap.guide);
        } else {
          // video/image clip
          if (d.kind === "trim-l") {
            const target = d.initialTrim.from + deltaSec;
            const snap = snapSeconds(target, points, pxPerSecRef.current);
            s.setTrim(d.clipId, {
              from: Math.max(0, snap.sec),
              to: d.initialTrim.to,
            });
            setGuideIfPresent(snap.guide);
          } else if (d.kind === "trim-r") {
            const target = d.initialTrim.to + deltaSec;
            const snap = snapSeconds(target, points, pxPerSecRef.current);
            s.setTrim(d.clipId, {
              from: d.initialTrim.from,
              to: Math.max(d.initialTrim.from + 0.1, snap.sec),
            });
            setGuideIfPresent(snap.guide);
          } else {
            const target = d.initialStart + deltaSec;
            const snap = snapSeconds(target, points, pxPerSecRef.current);
            s.setStart(d.clipId, Math.max(0, snap.sec));
            setGuideIfPresent(snap.guide);
          }
        }
      };

      const onUp = () => {
        dragRef.current = null;
        cleanupRef.current = null;
        setSnapGuide(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        useTimelineStore.getState().endInteraction();
      };

      cleanupRef.current = onUp;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [],
  );

  useEffect(() => () => cleanupRef.current?.(), []);

  // Hoist the trackRef + clientXToSeconds useCallback ABOVE the scrub
  // useCallback so the dependency array `[clientXToSeconds]` resolves
  // at component-render time (otherwise TS2448 / TS2454 complain
  // about use-before-declare). The drop-handling `function`
  // declarations below can still reference `clientXToSeconds` because
  // function declarations are hoisted in JavaScript.
  const trackRef = useRef<HTMLDivElement>(null);
  const clientXToSeconds = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(
      0,
      (clientX - rect.left - TRACK_PAD_PX) / pxPerSecRef.current,
    );
  }, []);

  // ---------- scrub handler ------------------------------------------
  // Click-and-drag on the time ruler OR the playhead handle starts a
  // scrub. The store flips isPlaying=false (Preview sees it and pauses
  // the @remotion/player) and isScrubbing=true (Preview mirrors store
  // writes back into the player via seekTo, gated by _scrubEpoch so
  // playback-driven frameupdate events never re-enter the seek path).
  // We use PointerEvents (mouse + touch + pen), guard against non-left
  // buttons (right-click menus interrupt drags otherwise), and lock
  // text-selection on the body while scrubbing so a stray drag doesn't
  // highlight arbitrary text on the page.
  const startScrub = useCallback(
    (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    document.body.style.userSelect = "none";

      const store = useTimelineStore.getState();
      const tl = store.timeline;
      // Recompute the playhead-cap from the timeline contents so we
      // clamp scrubbed frames even if the user holds currentFrame
      // stale across a structural edit. Uses the SAME shared
      // timelineEndFrames() helper as the store + the server renderer,
      // so playhead, preview and export can never disagree.
      const fps = tl.fps;
      const maxFrames = Math.max(0, timelineEndFrames(tl));

      const initialSec = clientXToSeconds(e.clientX);
      const initialFrame = Math.max(
        0,
        Math.min(maxFrames, Math.round(initialSec * fps)),
      );
      store.beginScrub();
      store.scrubTo(initialFrame);

      const onMove = (ev: PointerEvent) => {
        const sec = clientXToSeconds(ev.clientX);
        const frame = Math.max(
          0,
          Math.min(maxFrames, Math.round(sec * fps)),
        );
        useTimelineStore.getState().scrubTo(frame);
      };
      const onUp = () => {
        document.body.style.userSelect = "";
        cleanupRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        useTimelineStore.getState().endScrub();
      };
      // Reuse the existing cleanupRef so unmount-mid-scrub still
      // detaches the listeners AND restores body.userSelect.
      cleanupRef.current = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [clientXToSeconds],
  );

  // ---------- keyboard scrub handler -----------------------------------
  // Tab-focus the ruler, then nudge the playhead with the keyboard:
  // ←/→ by 1 frame, Shift+←/→ by 10 frames, Home/End jump to the
  // timeline boundaries, PageUp/PageDown nudge by 10. We call the
  // store's `scrubTo` so `_scrubEpoch` bumps and Preview.tsx's seek
  // effect fires -- the on-screen frame, the rendered canvas, and
  // the timecode chip all stay in lockstep without remounting.
  //
  // We deliberately do NOT call beginScrub + endScrub here: pressing
  // arrow keys mid-playback should gently nudge the playhead, not
  // stop playback. That's also a deliberate departure from pointer
  // scrub, which DOES pause via beginScrub (drag implies "stop and
  // let me find a time"). Pointer scrub = "stop and pick"; keyboard
  // scrub = "nudge".
  const onRulerKeyDown = useCallback((e: React.KeyboardEvent) => {
    const store = useTimelineStore.getState();
    const tl = store.timeline;
    const maxFrames = Math.max(0, timelineEndFrames(tl));
    const cur = store.currentFrame;

    let delta: number | null = null;
    let wantsPause = false;
    switch (e.code) {
      case "ArrowLeft":
        // Shift+Left = 1-second step (-fps frames). Matches NLE
        // convention for "step in seconds" rather than magic +/-10.
        delta = e.shiftKey ? -tl.fps : -1;
        break;
      case "ArrowRight":
        delta = e.shiftKey ? tl.fps : 1;
        break;
      case "PageUp":
        delta = 10;
        break;
      case "PageDown":
        delta = -10;
        break;
      case "Home":
        delta = -cur;
        wantsPause = true;
        break;
      case "End":
        delta = maxFrames - cur;
        wantsPause = true;
        break;
    }
    if (delta === null) return;
    e.preventDefault();
    if (wantsPause) {
      // Absolute jump (Home/End): pause playback so the user can
      // examine the new location without playback racing ahead. All
      // three Zustand sets run in the same React 18 batch so the
      // scrub-effect fires exactly once and the player's pause
      // takes effect on the next tick.
      store.beginScrub();
      store.scrubTo(cur + delta);
      store.endScrub();
    } else {
      // Relative step (Arrow keys): KEEP playback so users can walk
      // frame-by-frame through the timeline without losing their
      // place. scrubTo clamps internally to [0, maxFrames].
      store.scrubTo(cur + delta);
    }
  }, []);

  // ---------- drop handling (per lane) ---------------------------------

  function onLaneDragOver(
    e: React.DragEvent<HTMLDivElement>,
    lane: "video" | "audio",
  ) {
    if (!e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDrop({ lane, sec: clientXToSeconds(e.clientX) });
  }
  function onLaneDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (e.currentTarget === e.target) setDrop(null);
  }

  async function onLaneDrop(
    e: React.DragEvent<HTMLDivElement>,
    lane: "video" | "audio",
  ) {
    e.preventDefault();
    const sec = clientXToSeconds(e.clientX);
    setDrop(null);
    const asset = readAssetFromDataTransfer(e.dataTransfer);
    if (!asset) return;
    // Cached at upload time — avoids re-probing the media URL on drop.
    const cached = asset.durationSec;
    if (lane === "video") {
      if (asset.kind === "audio") return;
      const id = appendClipAt(asset, sec);
      if (asset.kind === "video") {
        const dur =
          cached && cached > 0 ? cached : await probeVideoDuration(asset.url).catch(() => NaN);
        if (Number.isFinite(dur) && dur > 0) {
          updateClip(id, { trim: { from: 0, to: dur } });
        }
      }
    } else {
      if (asset.kind !== "audio") return;
      const id = appendAudioClipAt(asset, sec);
      const dur =
        cached && cached > 0 ? cached : await probeAudioDuration(asset.url).catch(() => NaN);
      if (Number.isFinite(dur) && dur > 0) {
        updateAudioClip(id, { trim: { from: 0, to: dur } });
      }
    }
  }

  // ---------- render ---------------------------------------------------

  const playSec = currentFrame / timeline.fps;
  const trackWidth = Math.max(totalSeconds * pxPerSec + 60, 800);

  function selectByKind(
    id: string,
    kind: "clip" | "audio" | "text",
    e: React.MouseEvent,
  ) {
    e.stopPropagation();
    if (kind === "audio") selectAudioClip(id);
    else if (kind === "text") selectTextClip(id);
    else selectClip(id);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-ink-800/40 ring-1 ring-white/5 shadow-inner-border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Scissors className="h-4 w-4 text-indigo-300" /> Timeline
          <span className="font-mono text-[11px] text-zinc-400">
            {timeline.clips.length}V · {timeline.audioClips.length}A ·{" "}
            {timeline.textClips.length}T • {formatTime(totalSeconds)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content="Zoom out the timeline ruler so more of your video fits on screen.">
            <button
              onClick={() => setZoom((z) => Math.max(20, z - 20))}
              className="rounded p-1 text-zinc-300 transition-smooth duration-250 hover:bg-white/10 active:scale-95"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content="Zoom in for precise clip placement and trimming.">
            <button
              onClick={() => setZoom((z) => Math.min(400, z + 20))}
              className="rounded p-1 text-zinc-300 transition-smooth duration-250 hover:bg-white/10 active:scale-95"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </Tooltip>
          <div className="mx-1 h-5 w-px bg-white/10" />
          <Tooltip content="Drop a text clip at the playhead. Edit in Property Inspector.">
            <button
              onClick={() => {
                const pt = currentFrame / timeline.fps;
                appendTextClip({
                  id: crypto.randomUUID(),
                  name: "Text",
                  text: "Your headline",
                  start: pt,
                  duration: 3,
                  x: 0,
                  y: 0,
                  fontFamily:
                    "system-ui, -apple-system, Segoe UI, sans-serif",
                  fontSize: 64,
                  fontWeight: 700,
                  color: "#ffffff",
                  textAlign: "center",
                  backgroundOpacity: 0,
                  entrance: {
                    enabled: true,
                    spring: { mass: 0.5, damping: 14, stiffness: 140 },
                    from: {
                      scale: 0.7,
                      opacity: 0,
                      translateX: 0,
                      translateY: 30,
                    },
                    duration: 0.5,
                  },
                });
              }}
              className="inline-flex items-center gap-1 rounded-md bg-cyan-500/15 px-2 py-1 text-[11px] font-medium text-cyan-200 ring-1 ring-cyan-400/30 transition-smooth duration-250 hover:bg-cyan-500/30"
            >
              <Plus className="h-3 w-3" />
              Text
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Lanes wrapper */}
      <div className="relative flex-1 overflow-x-auto overflow-y-hidden p-3">
        <div
          ref={trackRef}
          style={{ width: trackWidth }}
          className="relative"
        >
          {/* Time ruler -- lives INSIDE trackRef so the ruler ticks
              and the lane clips share the same horizontal coordinate
              system (TRACK_PAD_PX + s * pxPerSec from trackRef.left).
              Pre-restructure the ruler was a sibling of the lanes
              wrapper and its 0s tick sat ~12px LEFT of the first clip
              -- invisible to the eye, but it meant a click on the rim
              of the ruler was miscomputed on the seconds axis. Now the
              ruler scrolls horizontally WITH the lanes (so the two
              stay aligned during zoom + scroll) and clicks anywhere
              on it start a scrub. aria role=slider so screen readers
              announce it as an editable time control. */}
          <div
            data-testid="timeline-ruler"
            role="slider"
            aria-label="Timeline ruler. Click and drag to scrub, or Tab-focus and use ←/→, Shift+arrow, Home/End, PageUp/PageDown."
            aria-valuemin={0}
            aria-valuemax={Math.round(totalSeconds * timeline.fps)}
            aria-valuenow={currentFrame}
            tabIndex={0}
            onKeyDown={onRulerKeyDown}
            onPointerDown={startScrub}
            className="relative h-7 cursor-pointer select-none border-b border-white/5 bg-ink-700/40 text-[10px] text-zinc-500 outline-none transition-smooth duration-200 focus-visible:bg-ink-700/60 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-indigo-400/70"
            style={{ touchAction: "none" }}
          >
            <div
              style={{ width: trackWidth }}
              className="relative h-full cursor-pointer select-none"
            >
              {ticks.map((s) => (
                <div
                  key={s}
                  style={{ left: TRACK_PAD_PX + s * pxPerSec }}
                  className="absolute top-0 h-full border-l border-white/5 pl-1 pt-0.5 font-mono"
                >
                  {formatTime(s)}
                </div>
              ))}
            </div>
          </div>
          {/* ---- VIDEO LANE ------------------------------------------- */}
          <LaneShell lane="video" trackWidth={trackWidth}>
            {timeline.clips.map((clip) => {
              const left = clip.start * pxPerSec;
              const width = (clip.trim.to - clip.trim.from) * pxPerSec;
              const isSelected = selectedClipId === clip.id;
              const { id, name, type: clipType, trim } = clip;
              return (
                <ClipCard
                  key={id}
                  height={112}
                  left={left}
                  width={width}
                  selected={isSelected}
                  lane="video"
                  onPointerDownBody={(e) => {
                    selectByKind(id, "clip", e);
                    useTimelineStore.getState().beginInteraction();
                    startDrag("move", id, e);
                  }}
                  label={
                    <>
                      {clipType === "image" ? (
                        <Film className="h-3 w-3 text-amber-300" />
                      ) : (
                        <Film className="h-3 w-3 text-indigo-300" />
                      )}
                      {clipType === "image" ? "Image" : "Video"}
                      <span className="ml-1 truncate font-mono normal-case text-zinc-300">
                        {name}
                      </span>
                    </>
                  }
                  trimLabel={`${formatTime(trim.from)} → ${formatTime(trim.to)} (${formatTime(trim.to - trim.from)})`}
                  onTrimLeft={(e) => {
                    e.stopPropagation();
                    startDrag("trim-l", id, e);
                  }}
                  onTrimRight={(e) => {
                    e.stopPropagation();
                    startDrag("trim-r", id, e);
                  }}
                  onDelete={(e) => {
                    e.stopPropagation();
                    removeClip(id);
                  }}
                  onDragOver={(e) => onLaneDragOver(e, "video")}
                  onDragLeave={onLaneDragLeave}
                  onDrop={(e) => onLaneDrop(e, "video")}
                />
              );
            })}
            {timeline.clips.length === 0 ? (
              <EmptyHint lane="video" />
            ) : null}
          </LaneShell>

          {/* ---- AUDIO LANE ------------------------------------------- */}
          <LaneShell lane="audio" trackWidth={trackWidth}>
            {timeline.audioClips.map((ac) => {
              const left = ac.start * pxPerSec;
              const width = (ac.trim.to - ac.trim.from) * pxPerSec;
              const isSelected = selectedAudioClipId === ac.id;
              return (
                <ClipCard
                  key={ac.id}
                  height={32}
                  left={left}
                  width={width}
                  selected={isSelected}
                  lane="audio"
                  onPointerDownBody={(e) => {
                    selectByKind(ac.id, "audio", e);
                    startDrag("move", ac.id, e);
                  }}
                  label={
                    <>
                      <Music className="h-3 w-3 text-emerald-300" />
                      <span className="truncate font-mono text-zinc-100">
                        {ac.name}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-emerald-200/70">
                        {(ac.trim.to - ac.trim.from).toFixed(1)}s
                      </span>
                    </>
                  }
                  trimLabel={null}
                  onTrimLeft={(e) => {
                    e.stopPropagation();
                    startDrag("trim-l", ac.id, e);
                  }}
                  onTrimRight={(e) => {
                    e.stopPropagation();
                    startDrag("trim-r", ac.id, e);
                  }}
                  onDelete={(e) => {
                    e.stopPropagation();
                    removeAudioClip(ac.id);
                  }}
                  onDragOver={(e) => onLaneDragOver(e, "audio")}
                  onDragLeave={onLaneDragLeave}
                  onDrop={(e) => onLaneDrop(e, "audio")}
                />
              );
            })}
            {timeline.audioClips.length === 0 ? (
              <EmptyHint lane="audio" />
            ) : null}
          </LaneShell>

          {/* ---- TEXT LANE -------------------------------------------- */}
          <LaneShell lane="text" trackWidth={trackWidth}>
            {timeline.textClips.map((tc) => {
              const left = tc.start * pxPerSec;
              const width = tc.duration * pxPerSec;
              const isSelected = selectedTextClipId === tc.id;
              return (
                <ClipCard
                  key={tc.id}
                  height={32}
                  left={left}
                  width={width}
                  selected={isSelected}
                  lane="text"
                  onPointerDownBody={(e) => {
                    selectByKind(tc.id, "text", e);
                    startDrag("move", tc.id, e);
                  }}
                  label={
                    <>
                      <TypeIcon className="h-3 w-3 text-cyan-300" />
                      <span className="truncate font-mono text-zinc-100">
                        {tc.text || tc.name}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-cyan-200/70">
                        {tc.duration.toFixed(1)}s
                      </span>
                    </>
                  }
                  trimLabel={null}
                  onTrimLeft={null}
                  onTrimRight={null}
                  onDelete={(e) => {
                    e.stopPropagation();
                    removeTextClip(tc.id);
                  }}
                />
              );
            })}
            {timeline.textClips.length === 0 ? (
              <EmptyHint lane="text" />
            ) : null}
          </LaneShell>

          {/* ---- PLAYHEAD (spans ruler + all 3 lanes) ---------------- */}
          {/* The vertical line is pointer-events-none so it doesn't
              block clipping interactions when the playhead crosses a
              clip card; users grab the playhead via the dedicated
              24-px grab handle that follows it (see below). The
              diamond glyph at the ruler's bottom edge is purely
              decorative -- click affordance comes from the handle. */}
          <div
            className="pointer-events-none absolute z-40 w-[2px] bg-gradient-to-b from-indigo-300/90 via-indigo-300 to-indigo-300/30"
            style={{
              left: playSec * pxPerSec,
              top: 0,
              height: "100%",
              boxShadow: "0 0 8px rgba(99,102,241,0.7)",
            }}
          >
            <div className="absolute -left-1.5 top-4 h-3 w-3 rotate-45 bg-indigo-300 shadow-md" />
          </div>

          {/* ---- PLAYHEAD GRAB HANDLE ------------------------------ */}
          {/* 24-px-wide invisible strip that follows the playhead x.
              pointer-events-auto + z-50 means a click within ±12 px
              of the playhead line lands on this strip and starts a
              scrub, even when the strip's geometry overlaps a clip
              card below. Outside that 24-px window the click falls
              through to the clip onMouseDown as before. The cursor
              is `ew-resize` over the strip to advertise the
              scrub gesture. */}
          <div
            data-testid="playhead-grab"
            aria-hidden
            onPointerDown={startScrub}
            style={{
              left: playSec * pxPerSec - 12,
              width: 24,
              height: "100%",
              touchAction: "none",
            }}
            className="absolute top-0 z-50 cursor-ew-resize"
          />

          {/* ---- DROP INDICATOR (spans all 3 lanes) ----------------- */}
          {drop ? (
            <div
              className="pointer-events-none absolute z-30"
              style={{
                left: TRACK_PAD_PX + drop.sec * pxPerSec,
                top: -28,
                height: `calc(100% + 28px)`,
              }}
            >
              <div className="h-full w-[2px] bg-emerald-300/80 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <div className="absolute -left-1.5 -top-1 h-3 w-3 rotate-45 bg-emerald-400" />
              <div className="absolute -left-7 -top-7 rounded-md bg-emerald-500/95 px-1.5 py-0.5 font-mono text-[10px] text-black shadow">
                {drop.sec.toFixed(1)}s
              </div>
            </div>
          ) : null}

          {/* ---- SNAP GUIDE (magnetic alignment hint) ------------- */}
          {snapGuide ? (
            <div
              className="pointer-events-none absolute z-30"
              style={{
                left: TRACK_PAD_PX + snapGuide.sec * pxPerSec,
                top: -28,
                height: `calc(100% + 28px)`,
              }}
            >
              <div className="h-full w-[1.5px] bg-cyan-300/80 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
              <div className="absolute -left-1 -top-0.5 h-2.5 w-2.5 rotate-45 bg-cyan-400" />
              <div className="absolute -left-7 -top-7 rounded-md bg-cyan-500/95 px-1.5 py-0.5 font-mono text-[10px] text-black shadow">
                snap {snapGuide.sec.toFixed(2)}s
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ----- LaneShell ---------------------------------------------------------

const LaneShell: React.FC<{
  lane: "video" | "audio" | "text";
  trackWidth: number;
  children: React.ReactNode;
}> = ({ lane, trackWidth, children }) => {
  const heights: Record<string, number> = {
    video: 136,
    audio: 40,
    text: 40,
  };
  const gradClass: Record<string, string> = {
    video: "bg-lane-video",
    audio: "bg-lane-audio",
    text: "bg-lane-text",
  };
  return (
    <div
      className={
        "relative mb-2 overflow-hidden rounded-lg ring-1 ring-white/5 " +
        gradClass[lane]
      }
      style={{ height: heights[lane], width: trackWidth }}
    >
      {children}
    </div>
  );
};

const EmptyHint: React.FC<{ lane: "video" | "audio" | "text" }> = ({
  lane,
}) => {
  const txt = {
    video: "Drop video / image · or use MediaBin → Add",
    audio: "Drop an audio file here · or use MediaBin → Add",
    text: "Click + Text above to add a text overlay",
  }[lane];
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-zinc-500">
      {txt}
    </div>
  );
};

// ----- ClipCard ----------------------------------------------------------

interface ClipCardProps {
  height: number;
  left: number;
  width: number;
  selected: boolean;
  lane: "video" | "audio" | "text";
  label: React.ReactNode;
  trimLabel: React.ReactNode;
  onPointerDownBody: (e: React.MouseEvent) => void;
  onTrimLeft: ((e: React.MouseEvent) => void) | null;
  onTrimRight: ((e: React.MouseEvent) => void) | null;
  onDelete: (e: React.MouseEvent) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
}

const ClipCard: React.FC<ClipCardProps> = ({
  height,
  left,
  width,
  selected,
  lane,
  label,
  trimLabel,
  onPointerDownBody,
  onTrimLeft,
  onTrimRight,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  const baseRing = lane === "audio"
    ? "ring-emerald-400/40"
    : lane === "text"
      ? "ring-cyan-400/40"
      : "ring-white/10";

  const selectedRing = lane === "audio"
    ? "ring-emerald-400 bg-emerald-500/30 shadow-glow-emerald"
    : lane === "text"
      ? "ring-cyan-400 bg-cyan-500/30 shadow-glow-cyan"
      : "ring-indigo-400 bg-indigo-500/30 shadow-glow-violet";

  const bgUnselected = lane === "audio"
    ? "bg-emerald-500/10 hover:bg-emerald-500/15"
    : lane === "text"
      ? "bg-cyan-500/10 hover:bg-cyan-500/15"
      : "bg-white/5 hover:bg-white/10";

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={
        "group absolute top-1 select-none overflow-hidden rounded-md ring-1 transition-smooth duration-250 " +
        (selected ? selectedRing : `${baseRing} ${bgUnselected}`)
      }
      style={{
        left: TRACK_PAD_PX + left,
        width: Math.max(width, 24),
        height: height - 8,
      }}
      data-lane={lane}
    >
      <div
        onMouseDown={onPointerDownBody}
        className={
          "flex h-full cursor-grab flex-col p-1.5 active:cursor-grabbing " +
          (height > 50 ? "justify-between" : "justify-center")
        }
      >
        <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider">
          {label}
        </div>
        {height > 50 && trimLabel ? (
          <div className="font-mono text-[11px] text-zinc-300">{trimLabel}</div>
        ) : null}
      </div>

      {onTrimLeft ? (
        <Tooltip content="Drag to trim the START of this clip (in-point).">
          <div
            onMouseDown={onTrimLeft}
            className="absolute left-0 top-0 z-20 h-full w-1.5 cursor-ew-resize bg-amber-400/40 transition-smooth duration-250 hover:bg-amber-400"
          />
        </Tooltip>
      ) : null}
      {onTrimRight ? (
        <Tooltip content="Drag to trim the END of this clip (out-point).">
          <div
            onMouseDown={onTrimRight}
            className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-ew-resize bg-amber-400/40 transition-smooth duration-250 hover:bg-amber-400"
          />
        </Tooltip>
      ) : null}

      <Tooltip content="Delete this clip from the timeline (Delete key).">
        <button
          onClick={onDelete}
          className="absolute right-1.5 top-1.5 z-20 rounded bg-black/50 p-1 text-rose-300 opacity-0 transition-smooth duration-250 group-hover:opacity-100 hover:bg-rose-500/40 hover:text-white"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </Tooltip>
    </div>
  );
};
