import React from "react";
import { Audio, interpolate, useCurrentFrame, staticFile } from "remotion";
import type { AudioClip } from "../types";

/**
 * Renders an AudioClip with optional interactive volume fades. The
 * `<Audio>` component will play the source between `startFrom` and
 * `endAt` (seconds-in-source, multiplied by fps), and we override the
 * `volume` per-frame to apply fadeIn/fadeOut ramps scaled to the trim.
 *
 * We don't render anything visually - audio is silent output by design.
 */
export const AudioClipComp: React.FC<{ clip: AudioClip; fps: number }> = ({
  clip,
  fps,
}) => {
  const localFrame = useCurrentFrame();
  const totalFrames = Math.round((clip.trim.to - clip.trim.from) * fps);
  const fadeInFrames = clip.fadeIn > 0 ? Math.round(clip.fadeIn * fps) : 0;
  const fadeOutFrames = clip.fadeOut > 0 ? Math.round(clip.fadeOut * fps) : 0;

  // Compute the volume multiplier for THIS frame relative to the Sequence
  // start. The Sequence is mounted at clip.start*fps with length
  // (trim.to - trim.from)*fps, so localFrame=0 == first audible sample.
  let volume = clip.volume;
  if (fadeInFrames > 0 && localFrame < fadeInFrames) {
    volume *= interpolate(localFrame, [0, fadeInFrames], [0, 1], {
      extrapolateRight: "clamp",
    });
  }
  if (fadeOutFrames > 0 && localFrame > totalFrames - fadeOutFrames) {
    volume *= interpolate(
      localFrame,
      [totalFrames - fadeOutFrames, totalFrames],
      [1, 0],
      { extrapolateLeft: "clamp" },
    );
  }

  return (
    <Audio
      src={clip.src}
      startFrom={Math.round(clip.trim.from * fps)}
      endAt={Math.round(clip.trim.to * fps)}
      volume={volume}
    />
  );
};
