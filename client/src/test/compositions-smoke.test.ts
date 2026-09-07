/**
 * Smoke test for the client tsconfig `compositions/*` path alias.
 *
 * Why this test is intentionally minimal:
 *
 * The alias maps `compositions/*` → `../compositions/src/*` so client code
 * (Preview.tsx, share.ts, utils.ts, etc.) can pull the shared types AND the
 * runtime composition without each being a separate npm dep. If a future
 * Vite / TypeScript upgrade, alias config tweak, or rename in
 * `compositions/` ever breaks the resolution, every consumer of the alias
 * breaks too — and breakage is silent at TS-time if Vite refuses to load
 * the chain (sometimes it's loud at runtime with a confusing stack).
 *
 * However: the FULL runtime composition (`MainComposition.tsx`) imports
 * `remotion`, `react/jsx-dev-runtime`, and other packages — and the
 * `compositions/` directory has no `node_modules/` of its own. Vite's
 * runtime resolver cannot satisfy those transitive imports for files
 * living under `compositions/src/` without an explicit alias or symlink
 * to a directory that has those packages installed.
 *
 * So this smoke test focuses on the smallest assertion that still
 * exercises the path alias end-to-end: import the shared TYPES module
 * (`compositions/types.ts`), which has zero transitive dependencies, and
 * assert the most-used exports exist with the expected SHAPE — never the
 * expected VALUES (which would couple this smoke to the literal product
 * defaults and fail for the wrong reason if someone bumps DEFAULT_TIMELINE
 * to fps=24 to support slow-motion presets). The runtime
 * `compositions/compositions/MainComposition` resolution is covered
 * separately by the dev-server smoke test (see README) where Vite's full
 * dev pipeline runs and the user actually drags clips on the timeline.
 */
import { describe, it, expect } from "vitest";
import {
  PROJECT_FILE_KIND,
  PROJECT_FILE_VERSION,
  DEFAULT_TIMELINE,
  DEFAULT_CLIP,
  DEFAULT_AUDIO_CLIP,
  DEFAULT_TEXT_CLIP,
  safeFps,
  timelineEndSeconds,
  timelineEndFrames,
  type TimelineState,
} from "compositions/types";

describe("compositions path alias (types-only smoke)", () => {
  it("resolves compositions/types through the client tsconfig paths alias", () => {
    // The module loaded successfully if any of its named exports are
    // defined and exported as values.
    expect(PROJECT_FILE_KIND).toBe("remotion-editor-project");
    expect(PROJECT_FILE_VERSION).toBe(1);
    expect(DEFAULT_TIMELINE).toBeDefined();
    expect(typeof DEFAULT_TIMELINE).toBe("object");
    // The factory helpers must be callable functions.
    expect(typeof DEFAULT_CLIP).toBe("function");
    expect(typeof DEFAULT_AUDIO_CLIP).toBe("function");
    expect(typeof DEFAULT_TEXT_CLIP).toBe("function");
  });

  it("DEFAULT_TIMELINE is structurally a TimelineState (shape-only)", () => {
    // Shape-only assertions so a future change to DEFAULT_TIMELINE's
    // literal values (e.g. fps=24 for slow-motion) doesn't fail this
    // smoke for the wrong reason.
    const s = DEFAULT_TIMELINE;
    expect(typeof s.fps).toBe("number");
    expect(s.fps).toBeGreaterThan(0);
    expect(typeof s.width).toBe("number");
    expect(s.width).toBeGreaterThan(0);
    expect(typeof s.height).toBe("number");
    expect(s.height).toBeGreaterThan(0);
    expect(typeof s.backgroundColor).toBe("string");
    expect(s.backgroundColor.length).toBeGreaterThan(0);
    expect(Array.isArray(s.clips)).toBe(true);
    expect(Array.isArray(s.audioClips)).toBe(true);
    expect(Array.isArray(s.textClips)).toBe(true);
  });
});

describe("shared timeline duration math (preview == export)", () => {
  const tl = (over: Partial<TimelineState>): TimelineState => ({
    ...DEFAULT_TIMELINE,
    ...over,
  });

  it("safeFps falls back to 30 for garbage fps", () => {
    expect(safeFps(30)).toBe(30);
    expect(safeFps(0)).toBe(30);
    expect(safeFps(-5)).toBe(30);
    expect(safeFps(NaN)).toBe(30);
  });

  it("timelineEndSeconds/ Frames: round(seconds*fps), NOT round(seconds)*fps", () => {
    // A clip ending at 5.37s @30fps must be 161 frames (5.37*30=161.1),
    // NOT 150 (round(5.37)=5 -> 5*30) — the old server bug truncated
    // every export by up to half a second.
    const t = tl({
      clips: [
        {
          ...DEFAULT_CLIP(),
          start: 0,
          trim: { from: 0, to: 5.37 },
        },
      ],
      audioClips: [],
      textClips: [],
    });
    expect(timelineEndSeconds(t)).toBeCloseTo(5.37, 5);
    expect(timelineEndFrames(t)).toBe(161);
  });

  it("picks the max end across all three layers", () => {
    // DEFAULT_CLIP = 5s, DEFAULT_AUDIO_CLIP = 5s, DEFAULT_TEXT_CLIP = 3s;
    // with these placements the audio layer ends last at 2 + 10 = 12s.
    const t = tl({
      clips: [{ ...DEFAULT_CLIP(), start: 0, trim: { from: 0, to: 3 } }],
      audioClips: [{ ...DEFAULT_AUDIO_CLIP(), start: 2, trim: { from: 0, to: 10 } }],
      textClips: [{ ...DEFAULT_TEXT_CLIP(), start: 4, duration: 3 }],
    });
    expect(timelineEndSeconds(t)).toBe(12);
    expect(timelineEndFrames(t)).toBe(360);
  });

  it("empty timeline ends at 0", () => {
    expect(timelineEndSeconds(DEFAULT_TIMELINE)).toBe(0);
    expect(timelineEndFrames(DEFAULT_TIMELINE)).toBe(0);
  });
});
