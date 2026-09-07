import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_TIMELINE,
  DEFAULT_AUDIO_CLIP,
  DEFAULT_TEXT_CLIP,
  PROJECT_FILE_KIND,
  PROJECT_FILE_VERSION,
  timelineEndSeconds,
  timelineEndFrames,
  type AudioClip,
  type TextClip,
  type TimelineClip,
  type TimelineState,
  type EntranceDef,
  type TransitionDef,
  type TransitionKind,
  type SpringConfig,
  type ProjectFile,
} from "compositions/types";
import {
  moveItem,
  clamp,
  makeClipFromAsset,
  makeAudioClipFromAsset,
} from "../lib/utils";

export interface AssetItem {
  id: string;
  name: string;
  url: string;
  kind: "video" | "image" | "audio";
  filename?: string;
  size?: number;
  /**
   * Natural duration of the media in seconds, probed once at upload time
   * (via a hidden <video>/<audio>) and cached so appending the asset to
   * the timeline doesn't have to re-probe the URL every time.
   */
  durationSec?: number;
}

const HISTORY_LIMIT = 50;
/**
 * Two consecutive mutations within DEBOUNCE_MS collapse into one history
 * entry. Keeps a single slider drag to roughly one undo step.
 */
const HISTORY_DEBOUNCE_MS = 250;

/**
 * One undo step. Snapshots BOTH the timeline and the media bin: removing
 * an asset cascades into dependent clips, so undo must restore both
 * together or the timeline would come back referencing a bin entry that
 * is still gone.
 */
interface HistorySnapshot {
  timeline: TimelineState;
  assets: AssetItem[];
}

interface TimelineStore {
  timeline: TimelineState;
  assets: AssetItem[];
  /** Currently selected TimelineClip id (video/image). */
  selectedClipId: string | null;
  /** Currently selected AudioClip id. */
  selectedAudioClipId: string | null;
  /** Currently selected TextClip id. */
  selectedTextClipId: string | null;
  isPlaying: boolean;
  currentFrame: number;
  /**
   * Multiplier on the @remotion/player playback rate. 0.5 = half-speed
   * (slow motion), 2 = double-speed (fast forward). Applied via
   * `PlayerRef.setPlaybackRate()` from Preview.tsx when this value
   * changes. Persisted across reloads via the partialize filter so
   * users keep their preferred pace between sessions.
   */
  playbackRate: number;

  /** Undo/redo stack (in memory only; never persisted to localStorage). */
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  /** Wall-clock timestamp of the last history snapshot (ms). */
  _lastHistoryAt: number;

  // ---------- Asset bin ----------
  addAssets: (assets: AssetItem[]) => void;
  removeAsset: (id: string) => void;

  // ---------- Video / image clips ----------
  appendClip: (clip: TimelineClip) => void;
  appendClipAt: (asset: AssetItem, startSec: number) => string;
  updateClip: (id: string, patch: Partial<TimelineClip>) => void;
  removeClip: (id: string) => void;
  moveClip: (fromIndex: number, toIndex: number) => void;
  selectClip: (id: string | null) => void;
  setStart: (id: string, start: number) => void;
  setTrim: (id: string, trim: { from: number; to: number }) => void;
  setScale: (id: string, scale: number) => void;
  setOpacity: (id: string, opacity: number) => void;
  setRotation: (id: string, rotation: number) => void;
  setEntrance: (id: string, entrance: Partial<EntranceDef>) => void;
  setEntranceSpring: (id: string, patch: Partial<SpringConfig>) => void;
  setEntranceFrom: (id: string, key: string, value: number) => void;
  setEntranceEnabled: (id: string, enabled: boolean) => void;
  setTransitionIn: (id: string, t: Partial<TransitionDef>) => void;
  setTransitionOut: (id: string, t: Partial<TransitionDef>) => void;

  // ---------- Audio clips ----------
  appendAudioClip: (clip: AudioClip) => string;
  appendAudioClipAt: (asset: AssetItem, startSec: number) => string;
  updateAudioClip: (id: string, patch: Partial<AudioClip>) => void;
  removeAudioClip: (id: string) => void;
  setAudioVolume: (id: string, volume: number) => void;
  setAudioFadeIn: (id: string, v: number) => void;
  setAudioFadeOut: (id: string, v: number) => void;
  setAudioStart: (id: string, start: number) => void;
  setAudioTrim: (id: string, trim: { from: number; to: number }) => void;
  selectAudioClip: (id: string | null) => void;

  // ---------- Text clips ----------
  appendTextClip: (clip: TextClip) => string;
  updateTextClip: (id: string, patch: Partial<TextClip>) => void;
  removeTextClip: (id: string) => void;
  setTextContent: (id: string, text: string) => void;
  setTextStyle: (id: string, patch: Partial<TextClip>) => void;
  setTextPosition: (id: string, x: number, y: number) => void;
  setTextStart: (id: string, start: number) => void;
  setTextDuration: (id: string, dur: number) => void;
  selectTextClip: (id: string | null) => void;

  // ---------- Shared timeline settings ----------
  setBackgroundColor: (color: string) => void;
  setDimensions: (w: number, h: number) => void;

  // ---------- History ----------
  recordHistory: () => void;
  beginInteraction: () => void;
  endInteraction: () => void;

  // ---------- Scrub (timeline ruler / playhead drag) ----------
  /**
   * True while the user is actively dragging the ruler or playhead. While
   * true, the Preview component mirrors `currentFrame` back into the
   * Remotion player via `seekTo`. Cleared automatically on mouseup.
   */
  isScrubbing: boolean;
  /**
   * Monotonic counter that bumps each time a scrub-driven frame change
   * is written. Preview.tsx watches `[isScrubbing, _scrubEpoch]` so it
   * can tell a user-driven scrub from a playback-driven frameupdate
   * (the latter bumps currentFrame but NOT _scrubEpoch, so no seekTo
   * feedback loop). Excluded from localStorage via the existing
   * `partialize` filter.
   */
  _scrubEpoch: number;
  /** Pause playback and arm scrub-driven seekTo in Preview. Idempotent. */
  beginScrub: () => void;
  /** Write a scrub-driven frame; bumps _scrubEpoch. Clamps to [0, max]. */
  scrubTo: (frame: number) => void;
  /** Disarm scrub-driven seekTo in Preview. Does NOT auto-resume play. */
  endScrub: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  resetTimeline: () => void;

  // ---------- Adjustment ----------
  nudgeSelectedClip: (deltaSec: number) => void;

  // ---------- Project save / load ----------
  exportProject: (name: string) => ProjectFile;
  importProject: (project: ProjectFile) => { ok: true } | { ok: false; reason: string };

  // ---------- Playback ----------
  setIsPlaying: (v: boolean) => void;
  setCurrentFrame: (f: number) => void;
  /** Set the @remotion/player playback rate. Clamped to [0.25, 4]. */
  setPlaybackRate: (rate: number) => void;
}

function pushPast(
  past: HistorySnapshot[],
  snap: HistorySnapshot,
): HistorySnapshot[] {
  const next = [...past, snap];
  if (next.length > HISTORY_LIMIT) next.shift();
  return next;
}

function pickClip(timeline: TimelineState, id: string | null): TimelineClip | undefined {
  if (!id) return undefined;
  return timeline.clips.find((c) => c.id === id);
}
function pickAudio(timeline: TimelineState, id: string | null): AudioClip | undefined {
  if (!id) return undefined;
  return timeline.audioClips.find((c) => c.id === id);
}
function pickText(timeline: TimelineState, id: string | null): TextClip | undefined {
  if (!id) return undefined;
  return timeline.textClips.find((c) => c.id === id);
}

export const useTimelineStore = create<TimelineStore>()(
  persist(
    (set, get) => {
      const recordHistory = () => {
        const s = get();
        const now = Date.now();
        if (now - s._lastHistoryAt < HISTORY_DEBOUNCE_MS) return;
        set({
          past: pushPast(s.past, { timeline: s.timeline, assets: s.assets }),
          future: [],
          _lastHistoryAt: now,
        });
      };

      const stamp = () => set({ _lastHistoryAt: Date.now() });

      return {
        timeline: DEFAULT_TIMELINE,
        assets: [],
        selectedClipId: null,
        selectedAudioClipId: null,
        selectedTextClipId: null,
        isPlaying: false,
        currentFrame: 0,
        playbackRate: 1,
        isScrubbing: false,
        _scrubEpoch: 0,
        past: [],
        future: [],
        _lastHistoryAt: 0,

        // ---------- Asset bin ----------
        addAssets: (assets) =>
          set((s) => ({ assets: [...s.assets, ...assets] })),
        // Removing an asset also removes every clip (video/image) and audio
        // clip that references its URL — otherwise the timeline keeps
        // dangling clips whose media 404s in both the preview and exports.
        // History is snapshotted IMMEDIATELY (not through the debounced
        // recordHistory): a destructive multi-target removal must always be
        // one clean Ctrl-Z step, even right after another edit.
        removeAsset: (id) => {
          const s0 = get();
          set({
            past: pushPast(s0.past, { timeline: s0.timeline, assets: s0.assets }),
            future: [],
            _lastHistoryAt: Date.now(),
          });
          set((s) => {
            const asset = s.assets.find((a) => a.id === id);
            if (!asset) return { assets: s.assets.filter((a) => a.id !== id) };
            const clips = s.timeline.clips.filter((c) => c.src !== asset.url);
            const audioClips = s.timeline.audioClips.filter(
              (c) => c.src !== asset.url,
            );
            return {
              assets: s.assets.filter((a) => a.id !== id),
              timeline: { ...s.timeline, clips, audioClips },
              selectedClipId: clips.some((c) => c.id === s.selectedClipId)
                ? s.selectedClipId
                : null,
              selectedAudioClipId: audioClips.some(
                (c) => c.id === s.selectedAudioClipId,
              )
                ? s.selectedAudioClipId
                : null,
            };
          });
        },

        // ---------- Video / image ----------
        appendClip: (clip) => {
          recordHistory();
          set((s) => {
            // Place the new clip AFTER the latest clip END on the timeline
            // (not "after the last array entry" — the array order drifts
            // from timeline order once clips are dragged around/reordered).
            let nextStart = 0;
            for (const c of s.timeline.clips) {
              const end = c.start + (c.trim.to - c.trim.from);
              if (end > nextStart) nextStart = end;
            }
            const placed: TimelineClip = { ...clip, start: nextStart };
            return {
              timeline: { ...s.timeline, clips: [...s.timeline.clips, placed] },
              selectedClipId: placed.id,
              selectedAudioClipId: null,
              selectedTextClipId: null,
            };
          });
        },

        appendClipAt: (asset, startSec) => {
          recordHistory();
          const base = makeClipFromAsset(asset);
          const id = base.id;
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: [
                ...s.timeline.clips,
                { ...base, start: Math.max(0, startSec) },
              ],
            },
            selectedClipId: id,
            selectedAudioClipId: null,
            selectedTextClipId: null,
          }));
          return id;
        },

        updateClip: (id, patch) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id ? { ...c, ...patch } : c,
              ),
            },
          }));
        },

        removeClip: (id) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.filter((c) => c.id !== id),
            },
            selectedClipId: s.selectedClipId === id ? null : s.selectedClipId,
          }));
        },

        moveClip: (fromIndex, toIndex) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: moveItem(s.timeline.clips, fromIndex, toIndex),
            },
          }));
        },

        selectClip: (id) =>
          set({
            selectedClipId: id,
            selectedAudioClipId: id ? null : get().selectedAudioClipId,
            selectedTextClipId: id ? null : get().selectedTextClipId,
          }),

        setStart: (id, start) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id ? { ...c, start: clamp(start, 0, 9999) } : c,
              ),
            },
          }));
        },
        setTrim: (id, trim) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      trim: {
                        from: clamp(trim.from, 0, c.trim.to - 0.1),
                        to: clamp(trim.to, c.trim.from + 0.1, 9999),
                      },
                    }
                  : c,
              ),
            },
          }));
        },
        setScale: (id, scale) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id ? { ...c, scale: clamp(scale, 0.1, 5) } : c,
              ),
            },
          }));
        },
        setOpacity: (id, opacity) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id ? { ...c, opacity: clamp(opacity, 0, 1) } : c,
              ),
            },
          }));
        },
        setRotation: (id, rotation) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id ? { ...c, rotation } : c,
              ),
            },
          }));
        },
        setEntrance: (id, entrance) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id
                  ? { ...c, entrance: { ...c.entrance, ...entrance } }
                  : c,
              ),
            },
          }));
        },
        setEntranceSpring: (id, patch) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      entrance: {
                        ...c.entrance,
                        spring: { ...c.entrance.spring, ...patch },
                      },
                    }
                  : c,
              ),
            },
          }));
        },
        setEntranceFrom: (id, key, value) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      entrance: {
                        ...c.entrance,
                        from: { ...c.entrance.from, [key]: value },
                      },
                    }
                  : c,
              ),
            },
          }));
        },
        setEntranceEnabled: (id, enabled) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id ? { ...c, entrance: { ...c.entrance, enabled } } : c,
              ),
            },
          }));
        },
        setTransitionIn: (id, t) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id ? { ...c, transitionIn: { ...c.transitionIn, ...t } } : c,
              ),
            },
          }));
        },
        setTransitionOut: (id, t) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                c.id === id ? { ...c, transitionOut: { ...c.transitionOut, ...t } } : c,
              ),
            },
          }));
        },

        // ---------- Audio ----------
        appendAudioClip: (clip) => {
          recordHistory();
          let id = clip.id;
          set((s) => ({
            timeline: {
              ...s.timeline,
              audioClips: [...s.timeline.audioClips, clip],
            },
            selectedAudioClipId: id,
            selectedClipId: null,
            selectedTextClipId: null,
          }));
          return id;
        },

        appendAudioClipAt: (asset, startSec) => {
          recordHistory();
          const base = makeAudioClipFromAsset(asset);
          const id = base.id;
          set((s) => ({
            timeline: {
              ...s.timeline,
              audioClips: [
                ...s.timeline.audioClips,
                { ...base, start: Math.max(0, startSec) },
              ],
            },
            selectedAudioClipId: id,
            selectedClipId: null,
            selectedTextClipId: null,
          }));
          return id;
        },

        updateAudioClip: (id, patch) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              audioClips: s.timeline.audioClips.map((c) =>
                c.id === id ? { ...c, ...patch } : c,
              ),
            },
          }));
        },

        removeAudioClip: (id) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              audioClips: s.timeline.audioClips.filter((c) => c.id !== id),
            },
            selectedAudioClipId:
              s.selectedAudioClipId === id ? null : s.selectedAudioClipId,
          }));
        },

        setAudioVolume: (id, volume) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              audioClips: s.timeline.audioClips.map((c) =>
                c.id === id ? { ...c, volume: clamp(volume, 0, 2) } : c,
              ),
            },
          }));
        },

        setAudioFadeIn: (id, v) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              audioClips: s.timeline.audioClips.map((c) =>
                c.id === id ? { ...c, fadeIn: clamp(v, 0, 10) } : c,
              ),
            },
          }));
        },
        setAudioFadeOut: (id, v) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              audioClips: s.timeline.audioClips.map((c) =>
                c.id === id ? { ...c, fadeOut: clamp(v, 0, 10) } : c,
              ),
            },
          }));
        },
        setAudioStart: (id, start) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              audioClips: s.timeline.audioClips.map((c) =>
                c.id === id ? { ...c, start: clamp(start, 0, 9999) } : c,
              ),
            },
          }));
        },
        setAudioTrim: (id, trim) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              audioClips: s.timeline.audioClips.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      trim: {
                        from: clamp(trim.from, 0, c.trim.to - 0.1),
                        to: clamp(trim.to, c.trim.from + 0.1, 9999),
                      },
                    }
                  : c,
              ),
            },
          }));
        },
        selectAudioClip: (id) =>
          set({
            selectedAudioClipId: id,
            selectedClipId: id ? null : get().selectedClipId,
            selectedTextClipId: id ? null : get().selectedTextClipId,
          }),

        // ---------- Text ----------
        appendTextClip: (clip) => {
          recordHistory();
          const id = clip.id;
          set((s) => ({
            timeline: {
              ...s.timeline,
              textClips: [...s.timeline.textClips, clip],
            },
            selectedTextClipId: id,
            selectedClipId: null,
            selectedAudioClipId: null,
          }));
          return id;
        },

        updateTextClip: (id, patch) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              textClips: s.timeline.textClips.map((c) =>
                c.id === id ? { ...c, ...patch } : c,
              ),
            },
          }));
        },

        removeTextClip: (id) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              textClips: s.timeline.textClips.filter((c) => c.id !== id),
            },
            selectedTextClipId:
              s.selectedTextClipId === id ? null : s.selectedTextClipId,
          }));
        },

        setTextContent: (id, text) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              textClips: s.timeline.textClips.map((c) =>
                c.id === id ? { ...c, text } : c,
              ),
            },
          }));
        },
        setTextStyle: (id, patch) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              textClips: s.timeline.textClips.map((c) =>
                c.id === id ? { ...c, ...patch } : c,
              ),
            },
          }));
        },
        setTextPosition: (id, x, y) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              textClips: s.timeline.textClips.map((c) =>
                c.id === id ? { ...c, x, y } : c,
              ),
            },
          }));
        },
        setTextStart: (id, start) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              textClips: s.timeline.textClips.map((c) =>
                c.id === id ? { ...c, start: clamp(start, 0, 9999) } : c,
              ),
            },
          }));
        },
        setTextDuration: (id, dur) => {
          recordHistory();
          set((s) => ({
            timeline: {
              ...s.timeline,
              textClips: s.timeline.textClips.map((c) =>
                c.id === id ? { ...c, duration: clamp(dur, 0.1, 999) } : c,
              ),
            },
          }));
        },
        selectTextClip: (id) =>
          set({
            selectedTextClipId: id,
            selectedClipId: id ? null : get().selectedClipId,
            selectedAudioClipId: id ? null : get().selectedAudioClipId,
          }),

        // ---------- Shared settings ----------
        setBackgroundColor: (color) => {
          recordHistory();
          set((s) => ({
            timeline: { ...s.timeline, backgroundColor: color },
          }));
        },
        setDimensions: (w, h) => {
          recordHistory();
          set((s) => ({ timeline: { ...s.timeline, width: w, height: h } }));
        },

        // ---------- History ----------
        recordHistory,
        beginInteraction: () => {
          const s = get();
          set({
            past: pushPast(s.past, { timeline: s.timeline, assets: s.assets }),
            future: [],
            _lastHistoryAt: Date.now(),
          });
        },
        endInteraction: () => stamp(),

        undo: () => {
          const { past, timeline, assets, selectedClipId, selectedAudioClipId, selectedTextClipId } = get();
          if (past.length === 0) return;
          const prev = past[past.length - 1];
          // Restore selections only if the selected clip still exists in prev.
          const restoreClip =
            selectedClipId && prev.timeline.clips.some((c) => c.id === selectedClipId)
              ? selectedClipId
              : null;
          const restoreAudio =
            selectedAudioClipId &&
            prev.timeline.audioClips.some((c) => c.id === selectedAudioClipId)
              ? selectedAudioClipId
              : null;
          const restoreText =
            selectedTextClipId &&
            prev.timeline.textClips.some((c) => c.id === selectedTextClipId)
              ? selectedTextClipId
              : null;
          set({
            timeline: prev.timeline,
            assets: prev.assets,
            past: past.slice(0, -1),
            future: [{ timeline, assets }, ...get().future],
            selectedClipId: restoreClip,
            selectedAudioClipId: restoreAudio,
            selectedTextClipId: restoreText,
            _lastHistoryAt: 0,
          });
        },
        redo: () => {
          const { future, timeline, assets } = get();
          if (future.length === 0) return;
          const next = future[0];
          set({
            timeline: next.timeline,
            assets: next.assets,
            past: [...get().past, { timeline, assets }],
            future: future.slice(1),
            _lastHistoryAt: 0,
          });
        },
        canUndo: () => get().past.length > 0,
        canRedo: () => get().future.length > 0,

        resetTimeline: () => {
          const s = get();
          set({
            timeline: DEFAULT_TIMELINE,
            past: pushPast(s.past, { timeline: s.timeline, assets: s.assets }),
            future: [],
            selectedClipId: null,
            selectedAudioClipId: null,
            selectedTextClipId: null,
            isPlaying: false,
            currentFrame: 0,
            _lastHistoryAt: Date.now(),
          });
        },

        // ---------- Adjustment ----------
        nudgeSelectedClip: (deltaSec) => {
          const s = get();
          // Each nudge uses the DEBOUNCED recordHistory (not
          // beginInteraction) so holding an arrow key collapses the whole
          // burst of repeats into ~one undo step instead of 50.
          if (s.selectedClipId) {
            const clip = pickClip(s.timeline, s.selectedClipId);
            if (!clip) return;
            const newStart = clamp(clip.start + deltaSec, 0, 9999);
            if (newStart !== clip.start) {
              s.recordHistory();
              s.setStart(s.selectedClipId, newStart);
            }
            return;
          }
          if (s.selectedAudioClipId) {
            const ac = pickAudio(s.timeline, s.selectedAudioClipId);
            if (!ac) return;
            const newStart = clamp(ac.start + deltaSec, 0, 9999);
            if (newStart !== ac.start) {
              s.recordHistory();
              s.setAudioStart(s.selectedAudioClipId, newStart);
            }
            return;
          }
          if (s.selectedTextClipId) {
            const tc = pickText(s.timeline, s.selectedTextClipId);
            if (!tc) return;
            const newStart = clamp(tc.start + deltaSec, 0, 9999);
            if (newStart !== tc.start) {
              s.recordHistory();
              s.setTextStart(s.selectedTextClipId, newStart);
            }
            return;
          }
        },

        // ---------- Project save / load ----------
        exportProject: (name) => {
          const s = get();
          return {
            version: PROJECT_FILE_VERSION,
            kind: PROJECT_FILE_KIND,
            name: name?.trim() || "untitled",
            savedAt: new Date().toISOString(),
            timeline: s.timeline,
          };
        },

        importProject: (project) => {
          // Validate tag + version + shape.
          if (!project || typeof project !== "object") {
            return { ok: false, reason: "not an object" };
          }
          if (project.kind !== PROJECT_FILE_KIND) {
            return { ok: false, reason: `wrong kind: ${project.kind}` };
          }
          if (typeof project.version !== "number" || project.version > PROJECT_FILE_VERSION) {
            return { ok: false, reason: `unsupported version: ${project.version}` };
          }
          const tl = project.timeline;
          if (!tl || !Array.isArray(tl.clips) || !Array.isArray(tl.audioClips) || !Array.isArray(tl.textClips)) {
            return { ok: false, reason: "missing timeline arrays" };
          }
          // Replace current timeline without recording history (whole-project load
          // is intentionally NOT undoable - it's an explicit file pick).
          set({
            timeline: {
              ...DEFAULT_TIMELINE,
              ...tl,
              clips: tl.clips,
              audioClips: tl.audioClips,
              textClips: tl.textClips,
            },
            selectedClipId: null,
            selectedAudioClipId: null,
            selectedTextClipId: null,
            isPlaying: false,
            currentFrame: 0,
            past: [],
            future: [],
            _lastHistoryAt: 0,
          });
          return { ok: true };
        },

        // ---------- Playback ----------
        setIsPlaying: (v) => set({ isPlaying: v }),
        setCurrentFrame: (f) => set({ currentFrame: f }),
        // Clamp to a safe range so a typo / pasted bad value can't stall
        // Remotion or break the player UI. Remotion's React/HTML5
        // playback pipeline tolerates this whole range without issue.
        setPlaybackRate: (rate) => {
          const clamped = Math.max(0.25, Math.min(4, Number(rate) || 1));
          set({ playbackRate: clamped });
        },

        // ---------- Scrub ----------
        // Pause first (Preview's isPlaying-effect calls player.pause()),
        // then flag scrub mode so Preview's epoch-watcher seeks. We do
        // NOT bump _scrubEpoch here; the first scrubTo() call right
        // after beginScrub() will.
        beginScrub: () => {
          set({ isPlaying: false, isScrubbing: true });
        },
        scrubTo: (frame) => {
          const tl = get().timeline;
          const maxFrames = Math.max(0, timelineEndFrames(tl));
          const clamped = Math.max(0, Math.min(maxFrames, Math.round(frame)));
          set({
            currentFrame: clamped,
            _scrubEpoch: get()._scrubEpoch + 1,
          });
        },
        endScrub: () => set({ isScrubbing: false }),
      };
    },
    {
      name: "remotion-editor-timeline",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // Persist the editing state AND the user's preferred playback
      // rate. Undo history and media-asset URLs are intentionally not
      // persisted.
      partialize: (s) => ({ timeline: s.timeline, playbackRate: s.playbackRate }),
      migrate: (rawPersisted, version) => {
        const persistedState = rawPersisted as
          | { timeline?: Partial<TimelineState> }
          | undefined;
        // v1 -> v2: ensure audioClips / textClips arrays exist on the timeline.
        if (version < 2 && persistedState?.timeline) {
          const tl = persistedState.timeline as Partial<TimelineState>;
          if (!Array.isArray(tl.audioClips)) {
            (tl as TimelineState).audioClips = [];
          }
          if (!Array.isArray(tl.textClips)) {
            (tl as TimelineState).textClips = [];
          }
        }
        return persistedState as { timeline: TimelineState };
      },
    },
  ),
);

/** Convenience selector to grab the currently selected video/image clip. */
export const useSelectedClip = () =>
  useTimelineStore((s) => {
    if (!s.selectedClipId) return null;
    return s.timeline.clips.find((c) => c.id === s.selectedClipId) ?? null;
  });

/** Convenience selector for the currently selected audio clip. */
export const useSelectedAudioClip = () =>
  useTimelineStore((s) => {
    if (!s.selectedAudioClipId) return null;
    return s.timeline.audioClips.find((c) => c.id === s.selectedAudioClipId) ?? null;
  });

/** Convenience selector for the currently selected text clip. */
export const useSelectedTextClip = () =>
  useTimelineStore((s) => {
    if (!s.selectedTextClipId) return null;
    return s.timeline.textClips.find((c) => c.id === s.selectedTextClipId) ?? null;
  });

/** Returns the total playhead duration (seconds) across all three layers. */
export function useTimelineDuration(): number {
  return useTimelineStore((s) => {
    const total = timelineEndSeconds(s.timeline);
    return total === 0 ? 1 : total;
  });
}

export const useCanUndo = () => useTimelineStore((s) => s.past.length > 0);
export const useCanRedo = () => useTimelineStore((s) => s.future.length > 0);

export type { TransitionKind };
