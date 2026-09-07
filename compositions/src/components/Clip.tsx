import React from "react";
import {
  AbsoluteFill,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Img,
  Video,
  interpolate,
} from "remotion";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
import type { TimelineClip } from "../types";

interface ClipProps {
  clip: TimelineClip;
  /** Injected so trim frames stay in sync with the timeline's fps. */
  fps: number;
  /**
   * Disable the entrance spring animation. Used by `WrappedClip` inside the
   * `TransitionLayer`, where the clip is re-mounted inside a fresh
   * `<Sequence>` that resets useCurrentFrame() - without this flag the
   * spring entrance would replay on top of the transition effect.
   */
  disableEntrance?: boolean;
}

/**
 * The leaf React component for a single media clip on the timeline. It:
 *   1. Renders the underlying media (Video or Img) into a fitted box.
 *   2. Applies the user-set transforms (scale, opacity, rotation) every frame.
 *   3. Adds a spring entrance if enabled.
 *
 * Cross-clip *transitions* are NOT handled here - they are layered on top of
 * this clip by `MainComposition` so we can support arbitrary `start` times
 * (real gaps on the timeline) AND a hand-rolled transition set (fade, wipe,
 * slide-left/right, flip) that mirrors the classic @remotion/transitions UX
 * without the extra dependency.
 */
export const Clip: React.FC<ClipProps> = ({ clip, fps, disableEntrance }) => {
  const frame = useCurrentFrame();
  const { fps: cfgFps } = useVideoConfig();
  const activeFps = fps ?? cfgFps;

  // -------- spring entrance --------------------------------------------
  // When `disableEntrance` is true the entrance spring is fully bypassed
  // - we always pin `entranceProgress = 1` so the clip renders exactly at
  //   its user-set scale / opacity / transform set. The visual effect of
  //   the transition layer is then the only thing the viewer sees.
  const entranceEnabled = clip.entrance.enabled && !disableEntrance;
  const entranceWindow = activeFps * clip.entrance.duration;
  const entranceProgress = entranceEnabled
    ? spring({
        frame,
        fps: activeFps,
        config: clip.entrance.spring,
        durationInFrames: entranceWindow,
      })
    : 1;

  const from = clip.entrance.from;

  const fromScale = from.scale ?? 1;
  const finalScale = entranceEnabled
    ? fromScale + (clip.scale - fromScale) * entranceProgress
    : clip.scale;

  const opacity =
    entranceEnabled && from.opacity !== undefined
      ? clamp01(interpolate(entranceProgress, [0, 1], [from.opacity, clip.opacity]))
      : clip.opacity;

  const translateX =
    entranceEnabled && from.translateX !== undefined
      ? interpolate(entranceProgress, [0, 1], [from.translateX, 0])
      : 0;

  const translateY =
    entranceEnabled && from.translateY !== undefined
      ? interpolate(entranceProgress, [0, 1], [from.translateY, 0])
      : 0;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "transparent",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          transform: `translate(${translateX}px, ${translateY}px) scale(${finalScale}) rotate(${clip.rotation}deg)`,
          opacity,
        }}
      >
        {clip.type === "image" ? (
          <Img
            src={clip.src}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <Video
            src={clip.src}
            startFrom={Math.round(clip.trim.from * activeFps)}
            endAt={Math.round(clip.trim.to * activeFps)}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            muted
          />
        )}
      </div>
    </AbsoluteFill>
  );
};
