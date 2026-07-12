import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Play, Pause, SkipBack, Repeat, Maximize2 } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { useTimelineStore } from "../store/timelineStore";
import { formatTimecode } from "../lib/utils";
import { MainComposition } from "compositions/compositions/MainComposition";
import type { TimelineState } from "compositions/types";

export const Preview: React.FC = () => {
  const timeline = useTimelineStore((s) => s.timeline);
  const selectedClipId = useTimelineStore((s) => s.selectedClipId);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const setIsPlaying = useTimelineStore((s) => s.setIsPlaying);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const playbackRate = useTimelineStore((s) => s.playbackRate);
  const setPlaybackRate = useTimelineStore((s) => s.setPlaybackRate);
  // _scrubEpoch is the dedicated signal for "user-driven frame write";
  // playback frameupdate events never bump it, so we can use it to
  // disambiguate scrub from playback WITHOUT gating on isScrubbing
  // (which React 18 may batch to false before this effect sees it).
  const scrubEpoch = useTimelineStore((s) => s._scrubEpoch);

  const playerRef = useRef<PlayerRef>(null);

  const totalSeconds = Math.max(
    1,
    ...timeline.clips.map((c) => c.start + (c.trim.to - c.trim.from)),
    ...timeline.audioClips.map((c) => c.start + (c.trim.to - c.trim.from)),
    ...timeline.textClips.map((c) => c.start + c.duration),
  );
  const durationInFrames = Math.round(totalSeconds * timeline.fps);

  const inputProps = useMemo(() => ({ timeline }), [timeline]);

  // Two-way play state sync via the player ref. We don't rely on @remotion/
  // player's onPlay prop because the player type definition in the installed
  // version doesn't expose it - we drive play/pause from the toolbar buttons
  // and then poll the player for isPlaying() on every state change.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    if (isPlaying && !p.isPlaying()) p.play();
    if (!isPlaying && p.isPlaying()) p.pause();
  }, [isPlaying]);

  // When the selected clip changes, jump the playhead to its first frame.
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !selectedClipId) return;
    const c = timeline.clips.find((cv) => cv.id === selectedClipId);
    if (c) p.seekTo(Math.round(c.start * timeline.fps));
  }, [selectedClipId, timeline.clips, timeline.fps]);

  // Mirror scrub-driven frame writes back into the player.
  // @remotion/player v4 only fires `frameupdate` while actually
  // playing, so the player itself never bumps `_scrubEpoch`. The
  // epoch counter therefore perfectly separates "user wants the
  // playhead here" from "the playback engine moved the playhead".
  // We deliberately do NOT gate on `isScrubbing`: keyboard-scrub
  // fires beginScrub/scrubTo/endScrub in the same React 18 batch,
  // and by commit time isScrubbing is already false. Watching
  // _scrubEpoch alone closes both pointer-scrub and keyboard-scrub.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(useTimelineStore.getState().currentFrame);
  }, [scrubEpoch]);

  // Sync the user's chosen playback rate into the Remotion player.
  // @remotion/player v4 has no `playbackRate` PROP -- it's an
  // imperative method on the PlayerRef. Calling setPlaybackRate at
  // runtime preserves the current frame + play/pause state without
  // remounting and works whether the player is currently playing or
  // paused.
  //
  // TS-casting workaround: the v4 PlayerRef d.ts doesn't declare
  // setPlaybackRate even though the runtime exposes it. We widen the
  // type locally to the shape we actually use, so we still get type
  // checking for the rest of PlayerRef and just trust this one method.
  useEffect(() => {
    const p = playerRef.current as unknown as {
      setPlaybackRate?: (rate: number) => void;
    } | null;
    if (!p?.setPlaybackRate) return;
    // getState so closure drift never sends a stale value
    p.setPlaybackRate(useTimelineStore.getState().playbackRate);
  }, [playbackRate]);

  // Mirror the player's playback position into the store while it plays.
  // @remotion/player 4.x exposes the playhead as a "frameupdate" event on
  // the ref; this is the canonical way to keep our store-driven timecode
  // chip and playhead logic in sync without polling.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ frame: number }>).detail;
      if (detail && typeof detail.frame === "number") {
        setCurrentFrame(detail.frame);
      }
    };
    // @remotion/player's PlayerRef addEventListener accepts a CallbackListener
    // (a typed dispatch on the event name), not a vanilla EventListener. Cast
    // through unknown once at registration time.
    p.addEventListener?.("frameupdate", handler as unknown as (e: unknown) => void);
    return () => {
      p.removeEventListener?.("frameupdate", handler as unknown as (e: unknown) => void);
    };
  }, [setCurrentFrame]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Maximize2 className="h-4 w-4 text-indigo-300" /> Live Preview
          <span className="font-mono text-xs text-zinc-400">
            {timeline.width}×{timeline.height} • {timeline.fps} fps
          </span>
          <span className="font-mono text-[10px] text-zinc-500">
            ({timeline.clips.length} video • {timeline.audioClips.length} audio • {timeline.textClips.length} text)
          </span>
        </div>
        <Tooltip content={`Current playhead position HH:MM:SS:FF at ${timeline.fps} fps.`}>
          <div
            aria-label="Current timecode"
            className="rounded-md bg-ink-700/70 px-2.5 py-1 font-mono text-xs tabular-nums text-cyan-200 ring-1 ring-cyan-400/20 shadow-inner-border"
          >
            {formatTimecode(currentFrame / timeline.fps, timeline.fps)}
          </div>
        </Tooltip>
      </div>

      <div
        className="relative flex-1 overflow-auto p-4"
        style={{
          background:
            "repeating-conic-gradient(#11141b 0% 25%, #0b0d12 0% 50%) 0 0 / 24px 24px",
        }}
      >
        <div
          className="mx-auto overflow-hidden rounded-lg bg-black shadow-2xl ring-1 ring-white/10"
          style={{
            aspectRatio: `${timeline.width} / ${timeline.height}`,
            maxHeight: "100%",
            width: "min(100%, calc((100vh - 320px) * 1.778))",
          }}
        >
          <Player
            ref={playerRef}
            component={MainComposition as React.FC<{ timeline: TimelineState }>}
            inputProps={inputProps}
            durationInFrames={Math.max(durationInFrames, timeline.fps)}
            fps={timeline.fps}
            compositionWidth={timeline.width}
            compositionHeight={timeline.height}
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: timeline.backgroundColor,
            }}
            controls={false}
            showVolumeControls={false}
            clickToPlay={false}
          />
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-white/5 bg-ink-700/60 py-2">
        <Tooltip content="Jump back to the start of the timeline.">
          <button
            onClick={() => playerRef.current?.seekTo(0)}
            className="rounded-md p-2 text-zinc-200 transition-smooth hover:bg-white/10"
          >
            <SkipBack className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content={isPlaying ? "Pause the preview" : "Play the preview"}>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="rounded-md bg-indigo-500 p-2 text-white transition-smooth hover:bg-indigo-400"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
        </Tooltip>
        {/* Playback-speed pill group. @remotion/player v4 has no
            playbackRate PROP; we drive setPlaybackRate via the effect
            above. Audio follows Remotion's default behaviour: <1x
            plays slower (and lower-pitched); >1x plays faster (and
            higher-pitched). No pitch correction in V1. */}
        <Tooltip content="Playback speed. <1× plays slow-motion (audio pitches down). >1× plays quickly (audio pitches up). Persisted across reloads.">
          <div
            role="group"
            aria-label="Playback speed"
            className="ml-1 inline-flex items-center rounded-md bg-ink-700/60 p-0.5 ring-1 ring-white/10"
          >
            {([0.5, 1, 2] as const).map((rate) => {
              const active = playbackRate === rate;
              return (
                <button
                  key={rate}
                  onClick={() => setPlaybackRate(rate)}
                  aria-pressed={active}
                  className={
                    "rounded px-2 py-1 font-mono text-[10px] outline-none transition-smooth duration-250 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-indigo-400/70 " +
                    (active
                      ? "bg-indigo-500 text-white shadow-inner-border"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100")
                  }
                  data-testid={`speed-${rate}`}
                >
                  {rate}×
                </button>
              );
            })}
          </div>
        </Tooltip>
        <Tooltip content="Preview loops back to the start when reaching the end.">
          <button
            onClick={() => {
              playerRef.current?.seekTo(0);
              setIsPlaying(true);
            }}
            className="rounded-md p-2 text-zinc-200 transition-smooth hover:bg-white/10"
          >
            <Repeat className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};
