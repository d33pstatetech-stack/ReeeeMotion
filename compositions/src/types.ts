// The single source of truth for every "thing in the editor".
// The client, the compositions and the renderer all consume this exact shape.

export type MediaKind = "video" | "image" | "audio";

export type TransitionKind = "none" | "fade" | "wipe" | "slide-left" | "slide-right" | "flip";

export interface TransitionDef {
  type: TransitionKind;
  duration: number; // seconds
}

export interface SpringConfig {
  mass: number;
  damping: number;
  stiffness: number;
}

export interface EntranceDef {
  enabled: boolean;
  spring: SpringConfig;
  // Values applied at frame 0 of the entrance window.
  from: {
    scale?: number;
    opacity?: number;
    translateX?: number; // pixels
    translateY?: number; // pixels
  };
  // How long (seconds) the entrance window lasts.
  duration: number;
}

/** A video or image clip placed on the main timeline. */
export interface TimelineClip {
  id: string;
  name: string;
  type: "video" | "image";
  /** Absolute URL the browser / Remotion can fetch - served by the Express server. */
  src: string;
  /** Trim window for the source media, in seconds. */
  trim: { from: number; to: number };
  /** Position on the timeline, in seconds. */
  start: number;
  // Visual transforms -------------------------------------------------
  scale: number; // 1 = 100 %
  opacity: number; // 0 - 1
  rotation: number; // degrees
  // Animations --------------------------------------------------------
  entrance: EntranceDef;
  transitionIn: TransitionDef;
  transitionOut: TransitionDef;
}

/**
 * Audio overlay - plays alongside the video layer. Audio clips are placed on
 * the timeline independently of video clips and are NEVER cross-faded by the
 * transition layer (transitions are visual-only).
 */
export interface AudioClip {
  id: string;
  name: string;
  src: string;
  /** Trim window in the source audio, in seconds. */
  trim: { from: number; to: number };
  /** Position on the timeline, in seconds. */
  start: number;
  /** 0 - 2 (1 = natural). Boost > 1 is allowed but may clip. */
  volume: number;
  /** Linear fade-in at the start of the trim, seconds. */
  fadeIn: number;
  /** Linear fade-out at the end of the trim, seconds. */
  fadeOut: number;
}

/**
 * Text overlay - rendered on top of the video layer at fixed canvas
 * coordinates. Supports a single entrance spring but NO cross-clip
 * transitions (text clips are atomic and rarely do transitions).
 */
export interface TextClip {
  id: string;
  name: string;
  /** Raw text content. Multi-line via `\n`. */
  text: string;
  /** Position on the timeline, in seconds. */
  start: number;
  /** Total duration on the timeline, in seconds. Ignored if 0. */
  duration: number;
  /** Pixel offset from canvas center (0,0 = perfect center). */
  x: number;
  y: number;
  /** CSS font-family string. Prefer system-safe fonts. */
  fontFamily: string;
  /** Pixel font size. */
  fontSize: number;
  /** Numeric font weight (100 - 900). */
  fontWeight: number;
  /** Text color, any CSS color. */
  color: string;
  textAlign: "left" | "center" | "right";
  /** Optional background pill behind text, 0 - 1. */
  backgroundOpacity: number;
  /** Spring entrance. Text clips always enter (no toggle exposed). */
  entrance: EntranceDef;
}

export interface TimelineState {
  fps: number;
  width: number;
  height: number;
  backgroundColor: string;
  clips: TimelineClip[];
  audioClips: AudioClip[];
  textClips: TextClip[];
}

export const DEFAULT_ENTRANCE: EntranceDef = {
  enabled: false,
  spring: { mass: 0.5, damping: 12, stiffness: 120 },
  from: { scale: 0.6, opacity: 0, translateX: 0, translateY: 60 },
  duration: 0.6,
};

export const DEFAULT_TRANSITION: TransitionDef = { type: "none", duration: 0.5 };
export const TEXT_DEFAULT_ENTRANCE: EntranceDef = {
  enabled: true,
  spring: { mass: 0.5, damping: 14, stiffness: 140 },
  from: { scale: 0.7, opacity: 0, translateX: 0, translateY: 30 },
  duration: 0.5,
};

export const DEFAULT_CLIP = (overrides: Partial<TimelineClip> = {}): TimelineClip => ({
  id: "clip",
  name: "Clip",
  type: "video",
  src: "",
  trim: { from: 0, to: 5 },
  start: 0,
  scale: 1,
  opacity: 1,
  rotation: 0,
  entrance: DEFAULT_ENTRANCE,
  transitionIn: DEFAULT_TRANSITION,
  transitionOut: DEFAULT_TRANSITION,
  ...overrides,
});

export const DEFAULT_AUDIO_CLIP = (overrides: Partial<AudioClip> = {}): AudioClip => ({
  id: "audio",
  name: "Audio",
  src: "",
  trim: { from: 0, to: 5 },
  start: 0,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  ...overrides,
});

export const DEFAULT_TEXT_CLIP = (overrides: Partial<TextClip> = {}): TextClip => ({
  id: "text",
  name: "Text",
  text: "Your headline here",
  start: 0,
  duration: 3,
  x: 0,
  y: 0,
  fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
  fontSize: 64,
  fontWeight: 700,
  color: "#ffffff",
  textAlign: "center",
  backgroundOpacity: 0,
  entrance: { ...TEXT_DEFAULT_ENTRANCE, enabled: true },
  ...overrides,
});

export const DEFAULT_TIMELINE: TimelineState = {
  fps: 30,
  width: 1280,
  height: 720,
  backgroundColor: "#000000",
  clips: [],
  audioClips: [],
  textClips: [],
};

// ---------- JSON ProjectFile (saved/loaded via Toolbar) -----------------

/** Tagged union for forward-compatible migrations. */
export interface ProjectFile {
  version: 1;
  kind: "remotion-editor-project";
  name: string;
  /** ISO-8601 timestamp. */
  savedAt: string;
  timeline: TimelineState;
}

export const PROJECT_FILE_KIND = "remotion-editor-project";
export const PROJECT_FILE_VERSION = 1;
