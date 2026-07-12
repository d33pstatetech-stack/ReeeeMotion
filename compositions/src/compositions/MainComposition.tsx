import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from "remotion";

import { Clip } from "../components/Clip";
import { AudioClipComp } from "../components/AudioClip";
import { TextClipComp } from "../components/TextClip";
import type {
  TimelineClip,
  TimelineState,
  TransitionKind,
} from "../types";

interface MainProps {
  timeline: TimelineState;
}

/**
 * Three parallel layers, painted bottom-up:
 *   1. Video / image clips with cross-clip visual transitions (the `clips`
 *      array, sorted by start).
 *   2. Text overlays painted on top (the `textClips` array).
 *   3. Audio clips plumbed into Remotion's audio mixer (`audioClips`). They
 *      render silently but contribute to the FFmpeg audio track on export.
 *
 * Text and audio are NOT sorted into the video `clips` array because that
 * would interleave them with video crossfade transitions, which is wrong
 * (you can't visually crossfade text against a video, and audio shouldn't
 * visually crossfade at all).
 */
export const MainComposition: React.FC<MainProps> = ({ timeline }) => {
  const { fps, width, height, backgroundColor, clips, audioClips, textClips } =
    timeline;

  if (
    clips.length === 0 &&
    audioClips.length === 0 &&
    textClips.length === 0
  ) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor,
          justifyContent: "center",
          alignItems: "center",
          color: "#9ca3af",
          fontFamily: "system-ui",
          fontSize: 32,
        }}
      >
        🎬 Drop clips from the Media Bin to start your project
      </AbsoluteFill>
    );
  }

  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const sortedAudio = [...audioClips].sort((a, b) => a.start - b.start);
  const sortedText = [...textClips].sort((a, b) => a.start - b.start);

  // Build cross-clip visual transitions between adjacent video clips.
  const transitions: Array<{
    kind: TransitionKind;
    durationFrames: number;
    atFrame: number;
    fromId: string;
    toId: string;
    hasOverlap: boolean;
  }> = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const aEnd = a.start + (a.trim.to - a.trim.from);
    const bStart = b.start;

    const kind: TransitionKind =
      a.transitionOut.type !== "none"
        ? a.transitionOut.type
        : b.transitionIn.type;
    if (kind === "none") continue;

    const durSec =
      a.transitionOut.type !== "none"
        ? a.transitionOut.duration
        : b.transitionIn.duration;
    const requestedFrames = Math.round(durSec * fps);
    const overlapFrames = Math.round((aEnd - bStart) * fps);
    const hasOverlap = overlapFrames > 0;
    const clampedFrames = hasOverlap
      ? Math.min(requestedFrames, overlapFrames)
      : requestedFrames;
    transitions.push({
      kind,
      durationFrames: Math.max(1, clampedFrames),
      atFrame: Math.round(bStart * fps),
      fromId: a.id,
      toId: b.id,
      hasOverlap,
    });
  }

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {/* Video / image clips with cross-clip transitions */}
      {sorted.map((clip: TimelineClip) => (
        <Sequence
          key={clip.id}
          from={Math.round(clip.start * fps)}
          durationInFrames={Math.max(
            1,
            Math.round((clip.trim.to - clip.trim.from) * fps),
          )}
          name={clip.name}
        >
          <Clip clip={clip} fps={fps} />
        </Sequence>
      ))}

      {transitions.map((t, i) => (
        <Sequence
          key={`t-${t.fromId}-${t.toId}-${i}`}
          from={t.atFrame}
          durationInFrames={t.durationFrames}
        >
          <TransitionLayer
            kind={t.kind}
            fps={fps}
            width={width}
            height={height}
            from={sorted.find((c) => c.id === t.fromId)!}
            to={sorted.find((c) => c.id === t.toId)!}
            durationFrames={t.durationFrames}
            zeroAvailableOverlap={!t.hasOverlap}
          />
        </Sequence>
      ))}

      {/* Text overlays on top of everything */}
      {sortedText.map((tc) => (
        <Sequence
          key={`text-${tc.id}`}
          from={Math.round(tc.start * fps)}
          durationInFrames={Math.max(1, Math.round(tc.duration * fps))}
          name={tc.name}
        >
          <TextClipComp clip={tc} fps={fps} width={width} height={height} />
        </Sequence>
      ))}

      {/* Audio clips - rendered silently, contribute to audio track */}
      {sortedAudio.map((ac) => (
        <Sequence
          key={`audio-${ac.id}`}
          from={Math.round(ac.start * fps)}
          durationInFrames={Math.max(
            1,
            Math.round((ac.trim.to - ac.trim.from) * fps),
          )}
          name={ac.name}
        >
          <AudioClipComp clip={ac} fps={fps} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// ----- TransitionLayer (unchanged) -----------------------------------

const TransitionLayer: React.FC<{
  kind: TransitionKind;
  fps: number;
  width: number;
  height: number;
  from: TimelineClip;
  to: TimelineClip;
  durationFrames: number;
  zeroAvailableOverlap: boolean;
}> = ({ kind, width, from, to, fps, durationFrames, zeroAvailableOverlap }) => {
  const frame = useCurrentFrame();
  const t = Math.min(1, Math.max(0, frame / durationFrames));
  const eased = easeInOutCubic(t);

  if (zeroAvailableOverlap) {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <WrappedClip clip={to} fps={fps} opacity={eased} />
      </AbsoluteFill>
    );
  }

  if (kind === "fade") {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <WrappedClip clip={to} fps={fps} opacity={eased} />
        <WrappedClip clip={from} fps={fps} opacity={1 - eased} />
      </AbsoluteFill>
    );
  }

  if (kind === "slide-left") {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <WrappedClip clip={from} fps={fps} translateX={-eased * width} />
        <WrappedClip clip={to} fps={fps} translateX={(1 - eased) * width} />
      </AbsoluteFill>
    );
  }

  if (kind === "slide-right") {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <WrappedClip clip={from} fps={fps} translateX={eased * width} />
        <WrappedClip clip={to} fps={fps} translateX={-(1 - eased) * width} />
      </AbsoluteFill>
    );
  }

  if (kind === "wipe") {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <WrappedClip clip={from} fps={fps} />
        <WrappedClip
          clip={to}
          fps={fps}
          clipPath={`inset(0 ${(1 - eased) * 100}% 0 0)`}
        />
      </AbsoluteFill>
    );
  }

  if (kind === "flip") {
    const rotate = interpolate(eased, [0, 1], [90, 0]);
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#000",
          transformOrigin: "center center",
          perspective: 1200,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `rotateY(${rotate}deg)`,
            backfaceVisibility: "hidden",
          }}
        >
          <WrappedClip clip={to} fps={fps} />
        </div>
      </AbsoluteFill>
    );
  }

  return null;
};

const WrappedClip: React.FC<{
  clip: TimelineClip;
  fps: number;
  translateX?: number;
  opacity?: number;
  clipPath?: string;
}> = ({ clip, fps, translateX, opacity, clipPath }) => {
  return (
    <AbsoluteFill
      style={{
        transform: translateX ? `translateX(${translateX}px)` : undefined,
        opacity,
        clipPath,
      }}
    >
      <Clip clip={clip} fps={fps} disableEntrance />
    </AbsoluteFill>
  );
};

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
