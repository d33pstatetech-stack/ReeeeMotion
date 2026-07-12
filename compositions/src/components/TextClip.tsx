import React from "react";
import {
  AbsoluteFill,
  spring,
  useCurrentFrame,
  interpolate,
} from "remotion";
import type { TextClip } from "../types";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Renders a single TextClip on top of the video layer. The text element is
 * absolutely positioned at canvas center, with optional (x, y) pixel offset.
 * The entrance spring animates scale + opacity + small translate; everything
 * else uses the user-set values verbatim.
 */
export const TextClipComp: React.FC<{
  clip: TextClip;
  fps: number;
  width: number;
  height: number;
}> = ({ clip, fps, width, height }) => {
  const frame = useCurrentFrame();
  const entranceEnabled = clip.entrance.enabled;
  const entranceWindow = fps * clip.entrance.duration;
  const entranceProgress = entranceEnabled
    ? spring({
        frame,
        fps,
        config: clip.entrance.spring,
        durationInFrames: Math.max(1, entranceWindow),
      })
    : 1;

  const from = clip.entrance.from;
  const fromOpacity = from.opacity ?? 0;
  const opacity = entranceEnabled
    ? clamp01(
        interpolate(entranceProgress, [0, 1], [fromOpacity, 1]),
      )
    : 1;
  const fromScale = from.scale ?? 0.7;
  const scale = entranceEnabled
    ? fromScale + (1 - fromScale) * entranceProgress
    : 1;
  const tx = (from.translateX ?? 0) * (1 - entranceProgress);
  const ty = (from.translateY ?? 0) * (1 - entranceProgress);

  // Center the text element with transform: translate(-50%, -50%) THEN
  // add the user-set x/y offset plus the entrance translate. We stack
  // via inner+outer divs so the -50%/50% centering stays intact.
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(calc(-50% + ${clip.x + tx}px), calc(-50% + ${clip.y + ty}px)) scale(${scale})`,
          opacity,
          fontFamily: clip.fontFamily,
          fontSize: clip.fontSize,
          fontWeight: clip.fontWeight,
          color: clip.color,
          textAlign: clip.textAlign,
          whiteSpace: "pre-wrap",
          padding: clip.backgroundOpacity > 0 ? "0.2em 0.4em" : "0",
          backgroundColor:
            clip.backgroundOpacity > 0
              ? `rgba(0, 0, 0, ${clip.backgroundOpacity})`
              : "transparent",
          borderRadius: clip.backgroundOpacity > 0 ? 8 : 0,
          maxWidth: Math.floor(width * 0.9),
        }}
      >
        {clip.text}
      </div>
    </AbsoluteFill>
  );
};
