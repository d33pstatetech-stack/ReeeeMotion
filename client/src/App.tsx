import React, { useEffect, useState } from "react";
import {
  Keyboard,
  X,
  Sparkles,
  Share2,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import { Tooltip } from "./components/Tooltip";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { Toolbar } from "./components/Toolbar";
import { MediaBin } from "./components/MediaBin";
import { Timeline } from "./components/Timeline";
import PropertyInspector from "./components/PropertyInspector";
import { Preview } from "./components/Preview";
import { readSharedProjectFromLocation } from "./lib/share";
import { useTimelineStore } from "./store/timelineStore";

const SHORTCUTS: Array<{ keys: string[]; desc: string; group: string }> = [
  { group: "Playback", keys: ["Space"], desc: "Play / pause preview" },
  { group: "Playback", keys: ["0.5× / 1× / 2×"], desc: "Slow-motion / normal / fast-forward. Persists across reloads." },
  { group: "Timeline", keys: ["Click ruler"], desc: "Jump the playhead. Drag to scrub through the timeline." },
  { group: "Timeline", keys: ["Tab"], desc: "Focus the timeline ruler for keyboard scrubbing." },
  { group: "Timeline", keys: ["←", "→"], desc: "On focused ruler: nudge playhead by 1 frame." },
  { group: "Timeline", keys: ["Shift", "←/→"], desc: "On focused ruler: nudge playhead by 10 frames." },
  { group: "Timeline", keys: ["Home", "End"], desc: "On focused ruler: jump playhead to start / end of timeline." },
  { group: "Timeline", keys: ["Delete"], desc: "Remove selected clip" },
  { group: "Timeline", keys: ["←", "→"], desc: "Nudge selected clip start by 0.1s" },
  { group: "Timeline", keys: ["Shift", "←/→"], desc: "Nudge selected clip start by 1s" },
  { group: "History", keys: ["Ctrl/⌘", "Z"], desc: "Undo the last edit (a slider drag = one undo step)" },
  { group: "History", keys: ["Ctrl/⌘", "Y"], desc: "Redo" },
  { group: "History", keys: ["Ctrl/⌘", "Shift", "Z"], desc: "Redo (alternate)" },
  { group: "Editing", keys: ["Drag", "→", "drop"], desc: "Drag a MediaBin asset onto any lane to insert" },
  { group: "Editing", keys: ["+", "Text"], desc: "Click +Text in Timeline header to add a text overlay" },
  { group: "Share", keys: ["Share"], desc: "Copy a shareable URL of the current timeline to your clipboard" },
];

const TIMELINE_ROW_PX = 332;

export const App: React.FC = () => {
  // Mount global keyboard shortcuts once.
  useKeyboardShortcuts();

  const importProject = useTimelineStore((s) => s.importProject);

  const [helpOpen, setHelpOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [pendingShared, setPendingShared] = useState<null | {
    name: string;
    pull: () => void;
  }>(null);

  // Auto-show the welcome card once on first launch so first-time users get
  // a guided on-ramp. The bottom-left keyboard button still toggles the
  // lightweight `helpOpen` modal for power users.
  useEffect(() => {
    if (!hasOpened && !localStorage.getItem("remotion-editor-help-seen")) {
      setWelcomeOpen(true);
      setHasOpened(true);
      try {
        localStorage.setItem("remotion-editor-help-seen", "1");
      } catch {
        /* ignore */
      }
    }
  }, [hasOpened]);

  // Bootstrap from a shared URL: read once on mount, decide auto-apply vs
  // banner (don't clobber an existing localStorage timeline silently).
  useEffect(() => {
    let shared: ReturnType<typeof readSharedProjectFromLocation>;
    try {
      shared = readSharedProjectFromLocation();
    } catch (err) {
      console.warn("Bad share payload:", err);
      return;
    }
    if (!shared) return;
    // Use live store state (already rehydrated by Zustand persist on creation)
    const tl = useTimelineStore.getState().timeline;
    const isEmpty =
      tl.clips.length === 0 &&
      tl.audioClips.length === 0 &&
      tl.textClips.length === 0;
    const stripHash = () => {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    };
    if (isEmpty) {
      importProject(shared);
      stripHash();
    } else {
      // Show a banner so the user can decide.
      setPendingShared({
        name: shared.name ?? "shared project",
        pull: () => {
          importProject(shared!);
          stripHash();
          setPendingShared(null);
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid h-screen grid-rows-[auto_1fr] bg-ink-900 text-zinc-100">
      {/* Soft radial accent over the whole shell */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 20% -10%, rgba(139,92,246,0.10), transparent 40%), radial-gradient(circle at 90% 110%, rgba(34,211,238,0.08), transparent 50%)",
        }}
      />

      <Toolbar />
      <main className="relative z-10 grid min-h-0 grid-cols-[300px_minmax(0,1fr)_320px] gap-3 p-3">
        <MediaBin />

        <div
          className="grid min-h-0 grid-rows-[1fr_332px] gap-3"
        >
          <Preview />
          <Timeline />
        </div>

        <PropertyInspector />
      </main>

      {/* Shared-project banner (top of viewport, only if a hash payload was
          found AND we already have a localStorage timeline). */}
      {pendingShared ? (
        <div className="fixed left-1/2 top-14 z-50 -translate-x-1/2 animate-fade-in">
          <div className="flex items-center gap-3 rounded-full bg-accent-violet/15 px-4 py-2 text-xs text-violet-100 shadow-glow-violet ring-1 ring-accent-violet/40 backdrop-blur-md">
            <Share2 className="h-4 w-4" />
            <span>Someone shared <strong>{pendingShared.name}</strong> with you.</span>
            <button
              onClick={pendingShared.pull}
              className="ml-2 rounded-md bg-accent-violet/40 px-2 py-1 text-[11px] font-medium text-white transition-smooth duration-250 hover:bg-accent-violet/60"
            >
              Open shared
            </button>
            <button
              onClick={() => {
                history.replaceState(
                  null,
                  "",
                  window.location.pathname + window.location.search,
                );
                setPendingShared(null);
              }}
              className="rounded-md bg-white/5 px-2 py-1 text-[11px] font-medium text-zinc-300 transition-smooth duration-250 hover:bg-white/10"
            >
              Keep mine
            </button>
          </div>
        </div>
      ) : null}

      {/* Floating help badge */}
      <Tooltip content="Keyboard shortcuts and editing tips.">
        <button
          onClick={() => setHelpOpen(true)}
          className="fixed bottom-4 left-4 z-40 grid h-9 w-9 place-items-center rounded-full bg-ink-700/60 text-zinc-200 ring-1 ring-white/10 shadow-glow-violet backdrop-blur-md transition-smooth duration-250 hover:scale-105 hover:bg-ink-600 active:scale-95"
          aria-label="Open keyboard shortcuts"
        >
          <Keyboard className="h-4 w-4" />
        </button>
      </Tooltip>

      {helpOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-md animate-fade-in"
          onClick={() => setHelpOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[480px] max-w-[92vw] overflow-hidden rounded-2xl bg-ink-700/80 p-0 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
          >
            {/* Header band */}
            <div className="relative bg-gradient-to-br from-accent-violet/30 via-ink-700 to-ink-700 px-6 py-5 ring-1 ring-white/5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-300" />
                  <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
                </div>
                <button
                  onClick={() => setHelpOpen(false)}
                  className="grid h-7 w-7 place-items-center rounded text-zinc-400 transition-smooth duration-250 hover:bg-white/10 hover:text-zinc-100"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[11px] text-zinc-300">
                Everything you can do without touching the mouse.
              </p>
            </div>
            {/* Body */}
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              <ul className="space-y-3 text-xs text-zinc-300">
                {Array.from(new Set(SHORTCUTS.map((s) => s.group))).map((g) => (
                  <li key={g}>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      {g}
                    </div>
                    <ul className="space-y-1.5">
                      {SHORTCUTS.filter((s) => s.group === g).map((s, i) => (
                        <li
                          key={`${g}-${i}`}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="text-zinc-200">{s.desc}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            {s.keys.map((k, j) => (
                              <kbd
                                key={`${k}-${j}`}
                                className="rounded-md bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-zinc-100 ring-1 ring-white/10"
                              >
                                {k}
                              </kbd>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <div className="mt-4 rounded-md bg-accent-violet/15 px-3 py-2 text-[11px] text-violet-100 ring-1 ring-accent-violet/30">
                💡 Use <strong>Share</strong> in the toolbar to copy a
                shareable URL of the current timeline.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* First-run welcome card — surfaces the user guide CTA + the four-step
          loop + a compressed shortcut list. Mutually exclusive with the
          keyboard-shortcuts modal above (gated by `welcomeOpen`). Anchors a
          primary outbound link to /user-guide.html rather than re-inventing
          the deep doc in-app, so the editor's local timeline state stays
          untouched when the user switches tabs to read. */}
      {welcomeOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-md animate-fade-in"
          onClick={() => setWelcomeOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[540px] max-w-[92vw] overflow-hidden rounded-2xl bg-ink-700/80 p-0 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
          >
            {/* Welcome band — punchier gradient than the shortcuts modal so
                first-time users register "this is special / on-ramp." */}
            <div className="relative bg-gradient-to-br from-accent-violet/40 via-accent-indigo/30 to-ink-700 px-6 py-5 ring-1 ring-white/5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-200" />
                  <h2 className="text-base font-semibold text-zinc-50">
                    Welcome to the Remotion Video Editor
                  </h2>
                </div>
                <button
                  onClick={() => setWelcomeOpen(false)}
                  className="grid h-7 w-7 place-items-center rounded text-zinc-400 transition-smooth duration-250 hover:bg-white/10 hover:text-zinc-100"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[11px] text-zinc-200/90">
                Build a video in four short steps. No coding required.
              </p>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {/* Primary CTA — opens the deep user guide in a new tab so the
                  editor's local timeline state is preserved. */}
              <a
                href="/user-guide.html"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl bg-accent-violet/25 px-4 py-3 ring-1 ring-accent-violet/40 transition-smooth duration-250 hover:bg-accent-violet/35 active:scale-[0.99]"
              >
                <BookOpen className="h-5 w-5 shrink-0 text-violet-100" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-violet-50">
                    Read the full user guide
                  </div>
                  <div className="mt-0.5 text-[11px] text-violet-100/85">
                    Quickstart, every property, keyboard shortcuts, exporting,
                    and a glossary of terms.
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-violet-100 transition-smooth duration-250 group-hover:translate-x-0.5" />
              </a>

              {/* Four-step loop — mirrors §1 of the user guide so the
                  language stays consistent between the in-app prompt and the
                  deep doc. */}
              <ol className="mt-4 space-y-1.5 text-xs text-zinc-200">
                <li>
                  <span className="mr-1.5 text-zinc-500">1.</span>
                  <strong className="text-zinc-100">Upload</strong> your media
                  in the left panel.
                </li>
                <li>
                  <span className="mr-1.5 text-zinc-500">2.</span>
                  <strong className="text-zinc-100">Arrange</strong> clips by
                  dragging them onto the timeline.
                </li>
                <li>
                  <span className="mr-1.5 text-zinc-500">3.</span>
                  <strong className="text-zinc-100">Tweak</strong> clip
                  properties in the right inspector.
                </li>
                <li>
                  <span className="mr-1.5 text-zinc-500">4.</span>
                  <strong className="text-zinc-100">Export</strong> an MP4 from
                  the top-right corner.
                </li>
              </ol>

              <div className="my-4 h-px bg-white/5" />

              {/* Compressed keyboard shortcuts — uses the same source array
                  as the power-user modal, but a flatter presentation so the
                  welcome card stays readable at 540px. */}
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Keyboard shortcuts
              </div>
              <ul className="space-y-1.5 text-[11px] text-zinc-300">
                {SHORTCUTS.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{s.desc}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k, j) => (
                        <kbd
                          key={`${k}-${j}`}
                          className="rounded-md bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-zinc-100 ring-1 ring-white/10"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 rounded-md bg-ink-800/60 px-3 py-2 text-[11px] text-zinc-300 ring-1 ring-white/5">
                💬 You can always reopen the <strong>shortcuts dialog</strong>{" "}
                from the bottom-left button, and the{" "}
                <strong>user guide</strong> from the <strong>?</strong> button
                in the toolbar.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
