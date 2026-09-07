import { useEffect } from "react";
import { useTimelineStore } from "../store/timelineStore";

/**
 * Skip shortcuts when the user is typing in a real text input. Radix Slider
 * thumbs are <span role="slider">, NOT <input>, so we WANT shortcuts to
 * fire while the user is dragging.
 */
function isTextEditableEl(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * True when a Radix Dialog (or any modal-ish overlay) is currently open.
 * Inside a dialog we don't want Space to toggle the preview, arrows to
 * nudge clips, etc.
 */
function isInsideOpenDialog(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[role="dialog"][data-state="open"]')) return true;
  if (target.closest('[role="alertdialog"][data-state="open"]')) return true;
  return false;
}

/**
 * Install global keyboard shortcuts for the editor. Mount this once at the
 * App level. Shortcuts:
 *
 * - Space               toggle preview play/pause
 * - Delete / Backspace  remove the currently selected clip
 * - Arrow Left/Right    nudge selected clip start by 0.1s
 * - Shift + Arrow       nudge by 1s
 * - Ctrl/Cmd + Z        undo
 * - Ctrl/Cmd + Y        redo
 * - Ctrl/Cmd + Shift+Z  redo
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't intercept while typing or inside an open modal dialog.
      if (isTextEditableEl(e.target)) return;
      if (isInsideOpenDialog(e.target)) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const store = useTimelineStore.getState();

      // Undo / Redo --------------------------------------------------
      if (ctrl && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        store.undo();
        return;
      }
      if (
        ctrl &&
        ((e.shiftKey && (e.key === "z" || e.key === "Z")) ||
          (e.key === "y" || e.key === "Y"))
      ) {
        e.preventDefault();
        store.redo();
        return;
      }

      // Bail for any other modifier combo - we're done with shortcuts.
      if (ctrl || e.altKey) return;

      // Play / pause -------------------------------------------------
      if (e.code === "Space") {
        e.preventDefault();
        store.setIsPlaying(!store.isPlaying);
        return;
      }

      // Remove selected clip (video/image, audio, or text — whichever of
      // the three exclusive selections is currently active) -------------
      if (e.code === "Delete" || e.code === "Backspace") {
        if (
          !store.selectedClipId &&
          !store.selectedAudioClipId &&
          !store.selectedTextClipId
        ) {
          return;
        }
        e.preventDefault();
        if (store.selectedClipId) {
          store.removeClip(store.selectedClipId);
        } else if (store.selectedAudioClipId) {
          store.removeAudioClip(store.selectedAudioClipId);
        } else if (store.selectedTextClipId) {
          store.removeTextClip(store.selectedTextClipId);
        }
        return;
      }

      // Nudge start of selected clip --------------------------------
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        if (!store.selectedClipId) return;
        // Defer to the timeline ruler's own onKeyDown handler when the
        // ruler has keyboard focus; otherwise we'd both nudge the
        // selected clip AND scrub at the same time. The ruler uses
        // tabIndex=0 + a `data-testid` anchor we can match here.
        const tgt = e.target as HTMLElement | null;
        if (
          tgt &&
          typeof tgt.closest === "function" &&
          tgt.closest('[data-testid="timeline-ruler"]')
        ) {
          return;
        }
        e.preventDefault();
        const big = e.shiftKey ? 1 : 0.1;
        const sign = e.code === "ArrowRight" ? 1 : -1;
        store.nudgeSelectedClip(sign * big);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
