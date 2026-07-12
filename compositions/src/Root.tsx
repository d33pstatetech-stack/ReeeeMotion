import React from "react";
import { Composition } from "remotion";
import { MainComposition } from "./compositions/MainComposition";
import type { TimelineState } from "./types";

// The composition registry. Both @remotion/player (in the browser) and
// @remotion/renderer (on the server) talk to this same React tree via
// inputProps - there is exactly ONE composition and its dimensions/duration are
// derived from the timeline supplied by the editor.

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MainComposition"
        component={MainComposition as React.FC<{ timeline: TimelineState }>}
        // These defaults are recalculated at render-time using inputProps.
        fps={30}
        width={1280}
        height={720}
        durationInFrames={30 * 5}
        // Allow any inputProps shape - we only care about `timeline`.
        schema={undefined}
      />
    </>
  );
};
