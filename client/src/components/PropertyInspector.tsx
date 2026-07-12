import React, { useState } from "react";
import {
  Settings2,
  Sparkles,
  ArrowRightLeft,
  Layers,
  Eye,
  EyeOff,
  Volume2,
  Type as TypeIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";
import {
  useTimelineStore,
  useSelectedClip,
  useSelectedAudioClip,
  useSelectedTextClip,
} from "../store/timelineStore";
import { Tooltip } from "./Tooltip";
import { Slider } from "./Slider";
import type { TransitionKind, TextClip } from "compositions/types";

const TRANSITION_OPTIONS: TransitionKind[] = [
  "none",
  "fade",
  "wipe",
  "slide-left",
  "slide-right",
  "flip",
];

const TRANSITION_LABEL: Record<TransitionKind, string> = {
  none: "None",
  fade: "Fade",
  wipe: "Wipe",
  "slide-left": "Slide ←",
  "slide-right": "Slide →",
  flip: "Flip",
};

const FONT_PRESETS = [
  "system-ui, -apple-system, Segoe UI, sans-serif",
  "Georgia, 'Times New Roman', serif",
  "'Courier New', monospace",
  "Impact, 'Arial Black', sans-serif",
];

const COLOR_PRESETS = [
  "#ffffff",
  "#facc15",
  "#22d3ee",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#111827",
];

const PropertyInspector: React.FC = () => {
  const videoClip = useSelectedClip();
  const audioClip = useSelectedAudioClip();
  const textClip = useSelectedTextClip();

  if (!videoClip && !audioClip && !textClip) {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-sm font-semibold">
          <Settings2 className="h-4 w-4 text-indigo-300" /> Property Inspector
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-zinc-500">
          Select a clip on the timeline
          <br />
          to edit its Remotion variables.
        </div>
        <BackgroundSection />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-sm font-semibold">
        <Settings2 className="h-4 w-4 text-indigo-300" /> Property Inspector
        <span className="ml-1 truncate font-mono text-[11px] text-zinc-400">
          {videoClip?.name ?? audioClip?.name ?? textClip?.name}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {videoClip ? <VideoClipForm clip={videoClip} /> : null}
        {audioClip ? <AudioClipForm clip={audioClip} /> : null}
        {textClip ? <TextClipForm clip={textClip} /> : null}
        <BackgroundSection />
      </div>
    </div>
  );
};

// ---------- Video / image form -----------------------------------------

type VideoClipFormProps = { clip: NonNullable<ReturnType<typeof useSelectedClip>> };
const VideoClipForm: React.FC<VideoClipFormProps> = ({ clip }) => {
  const setScale = useTimelineStore((s) => s.setScale);
  const setOpacity = useTimelineStore((s) => s.setOpacity);
  const setRotation = useTimelineStore((s) => s.setRotation);
  const setTrim = useTimelineStore((s) => s.setTrim);
  const setStart = useTimelineStore((s) => s.setStart);
  const setEntranceEnabled = useTimelineStore((s) => s.setEntranceEnabled);
  const setEntrance = useTimelineStore((s) => s.setEntrance);
  const setEntranceSpring = useTimelineStore((s) => s.setEntranceSpring);
  const setEntranceFrom = useTimelineStore((s) => s.setEntranceFrom);
  const setTransitionIn = useTimelineStore((s) => s.setTransitionIn);
  const setTransitionOut = useTimelineStore((s) => s.setTransitionOut);

  return (
    <div className="space-y-5 p-4 text-xs text-zinc-300">
      <Section icon={<Sparkles className="h-3.5 w-3.5" />} title="Timing">
        <Slider
          label="Start"
          tooltip="When this clip starts playing on the timeline (seconds)."
          min={0}
          max={300}
          step={0.1}
          value={clip.start}
          onChange={(v) => setStart(clip.id, v)}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <Slider
          label="In-point"
          tooltip="Trim the start of this clip (seconds in the source media)."
          min={0}
          max={Math.max(0, clip.trim.to - 0.1)}
          step={0.1}
          value={clip.trim.from}
          onChange={(v) => setTrim(clip.id, { from: v, to: clip.trim.to })}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <Slider
          label="Out-point"
          tooltip="Trim the end of this clip (seconds in the source media)."
          min={clip.trim.from + 0.1}
          max={600}
          step={0.1}
          value={clip.trim.to}
          onChange={(v) => setTrim(clip.id, { from: clip.trim.from, to: v })}
          format={(v) => `${v.toFixed(1)}s`}
        />
      </Section>

      <Section icon={<Layers className="h-3.5 w-3.5" />} title="Transform">
        <Slider
          label="Scale"
          tooltip="Resize this clip. 1.0 = fits the canvas perfectly. >1 zooms in."
          min={0.1}
          max={4}
          step={0.05}
          value={clip.scale}
          onChange={(v) => setScale(clip.id, v)}
          format={(v) => `${v.toFixed(2)}×`}
        />
        <Slider
          label="Opacity"
          tooltip="How transparent this clip is. 1.0 = fully opaque."
          min={0}
          max={1}
          step={0.01}
          value={clip.opacity}
          onChange={(v) => setOpacity(clip.id, v)}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Rotation"
          tooltip="Rotate the clip around its center, in degrees."
          min={-180}
          max={180}
          step={1}
          value={clip.rotation}
          onChange={(v) => setRotation(clip.id, v)}
          format={(v) => `${v.toFixed(0)}°`}
        />
      </Section>

      <Section icon={<ArrowRightLeft className="h-3.5 w-3.5" />} title="Transitions">
        <TransitionPicker
          side="in"
          value={clip.transitionIn.type}
          duration={clip.transitionIn.duration}
          onType={(t) => setTransitionIn(clip.id, { type: t })}
          onDuration={(d) => setTransitionIn(clip.id, { duration: d })}
        />
        <TransitionPicker
          side="out"
          value={clip.transitionOut.type}
          duration={clip.transitionOut.duration}
          onType={(t) => setTransitionOut(clip.id, { type: t })}
          onDuration={(d) => setTransitionOut(clip.id, { duration: d })}
        />
      </Section>

      <Section
        icon={<Sparkles className="h-3.5 w-3.5" />}
        title="Entrance Physics"
        rightAction={
          <Tooltip
            content={
              clip.entrance.enabled
                ? "Disable the Remotion spring animation on the first frame of this clip."
                : "Enable a Remotion spring() animation on the first frame of this clip."
            }
          >
            <button
              onClick={() => setEntranceEnabled(clip.id, !clip.entrance.enabled)}
              className="rounded p-1 text-zinc-300 transition-smooth hover:bg-white/10"
            >
              {clip.entrance.enabled ? (
                <Eye className="h-3.5 w-3.5 text-indigo-300" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>
        }
      >
        <Slider
          label="Mass"
          tooltip="How heavy the moving object feels in the spring. Higher = slower."
          min={0.1}
          max={5}
          step={0.1}
          value={clip.entrance.spring.mass}
          onChange={(v) => setEntranceSpring(clip.id, { mass: v })}
          format={(v) => `${v.toFixed(1)}`}
        />
        <Slider
          label="Damping"
          tooltip="How quickly the spring stops oscillating."
          min={0}
          max={50}
          step={0.5}
          value={clip.entrance.spring.damping}
          onChange={(v) => setEntranceSpring(clip.id, { damping: v })}
          format={(v) => `${v.toFixed(1)}`}
        />
        <Slider
          label="Stiffness"
          tooltip="How snappy the spring is. Higher = reaches the rest pose faster."
          min={1}
          max={400}
          step={5}
          value={clip.entrance.spring.stiffness}
          onChange={(v) => setEntranceSpring(clip.id, { stiffness: v })}
          format={(v) => `${v.toFixed(0)}`}
        />
        <Slider
          label="Duration"
          tooltip="Maximum time the entrance window can last (seconds)."
          min={0.1}
          max={3}
          step={0.1}
          value={clip.entrance.duration}
          onChange={(v) => setEntrance(clip.id, { duration: v })}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NumberField
            label="From X"
            tooltip="Initial X offset (px) the clip animates FROM on entrance."
            value={clip.entrance.from.translateX ?? 0}
            onChange={(v) => setEntranceFrom(clip.id, "translateX", v)}
          />
          <NumberField
            label="From Y"
            tooltip="Initial Y offset (px) the clip animates FROM on entrance."
            value={clip.entrance.from.translateY ?? 0}
            onChange={(v) => setEntranceFrom(clip.id, "translateY", v)}
          />
          <NumberField
            label="From Scale"
            tooltip="Initial scale the clip animates FROM on entrance (0.5 = half-size)."
            value={clip.entrance.from.scale ?? 1}
            onChange={(v) => setEntranceFrom(clip.id, "scale", v)}
          />
          <NumberField
            label="From Opacity"
            tooltip="Initial opacity (0 - 1) the clip animates FROM on entrance."
            value={clip.entrance.from.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setEntranceFrom(clip.id, "opacity", v)}
          />
        </div>
      </Section>
    </div>
  );
};

// ---------- Audio form -------------------------------------------------

type AudioClipFormProps = { clip: NonNullable<ReturnType<typeof useSelectedAudioClip>> };
const AudioClipForm: React.FC<AudioClipFormProps> = ({ clip }) => {
  const setAudioVolume = useTimelineStore((s) => s.setAudioVolume);
  const setAudioFadeIn = useTimelineStore((s) => s.setAudioFadeIn);
  const setAudioFadeOut = useTimelineStore((s) => s.setAudioFadeOut);
  const setAudioStart = useTimelineStore((s) => s.setAudioStart);
  const setAudioTrim = useTimelineStore((s) => s.setAudioTrim);

  return (
    <div className="space-y-5 p-4 text-xs text-zinc-300">
      <Section icon={<Volume2 className="h-3.5 w-3.5" />} title="Audio">
        <Slider
          label="Volume"
          tooltip="Output level. 1.0 = source natural. >1 boosts (may clip)."
          min={0}
          max={2}
          step={0.01}
          value={clip.volume}
          onChange={(v) => setAudioVolume(clip.id, v)}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Fade In"
          tooltip="Linear fade-in from silence at the start of the trim, in seconds."
          min={0}
          max={Math.max(0, (clip.trim.to - clip.trim.from))}
          step={0.05}
          value={clip.fadeIn}
          onChange={(v) => setAudioFadeIn(clip.id, v)}
          format={(v) => `${v.toFixed(2)}s`}
        />
        <Slider
          label="Fade Out"
          tooltip="Linear fade-out to silence at the end of the trim, in seconds."
          min={0}
          max={Math.max(0, (clip.trim.to - clip.trim.from))}
          step={0.05}
          value={clip.fadeOut}
          onChange={(v) => setAudioFadeOut(clip.id, v)}
          format={(v) => `${v.toFixed(2)}s`}
        />
      </Section>

      <Section icon={<Sparkles className="h-3.5 w-3.5" />} title="Timing">
        <Slider
          label="Start"
          tooltip="When this audio clip begins on the timeline (seconds)."
          min={0}
          max={300}
          step={0.1}
          value={clip.start}
          onChange={(v) => setAudioStart(clip.id, v)}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <Slider
          label="In-point"
          tooltip="Skip first N seconds of the source audio."
          min={0}
          max={Math.max(0, clip.trim.to - 0.1)}
          step={0.1}
          value={clip.trim.from}
          onChange={(v) => setAudioTrim(clip.id, { from: v, to: clip.trim.to })}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <Slider
          label="Out-point"
          tooltip="Stop source audio after N seconds from its start."
          min={clip.trim.from + 0.1}
          max={600}
          step={0.1}
          value={clip.trim.to}
          onChange={(v) => setAudioTrim(clip.id, { from: clip.trim.from, to: v })}
          format={(v) => `${v.toFixed(1)}s`}
        />
      </Section>
    </div>
  );
};

// ---------- Text form --------------------------------------------------

type TextClipFormProps = { clip: NonNullable<ReturnType<typeof useSelectedTextClip>> };
const TextClipForm: React.FC<TextClipFormProps> = ({ clip }) => {
  const setTextContent = useTimelineStore((s) => s.setTextContent);
  const setTextStyle = useTimelineStore((s) => s.setTextStyle);
  const setTextPosition = useTimelineStore((s) => s.setTextPosition);
  const setTextStart = useTimelineStore((s) => s.setTextStart);
  const setTextDuration = useTimelineStore((s) => s.setTextDuration);
  const [font, setFont] = useState(clip.fontFamily);

  return (
    <div className="space-y-5 p-4 text-xs text-zinc-300">
      <Section icon={<TypeIcon className="h-3.5 w-3.5" />} title="Text">
        <Tooltip content="The text shown on screen. Wrap with `\\n` for multi-line.">
          <label className="block">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              Content
            </div>
            <textarea
              value={clip.text}
              rows={3}
              onChange={(e) => setTextContent(clip.id, e.target.value)}
              className="w-full rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 font-mono text-xs text-zinc-100 focus:border-indigo-400 focus:outline-none"
            />
          </label>
        </Tooltip>

        <div className="grid grid-cols-1 gap-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              Font family
            </div>
            <select
              value={font}
              onChange={(e) => {
                setFont(e.target.value);
                setTextStyle(clip.id, { fontFamily: e.target.value });
              }}
              className="w-full rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs text-zinc-100"
            >
              {FONT_PRESETS.map((f) => (
                <option key={f} value={f} className="bg-ink-800">
                  {f.split(",")[0]}
                </option>
              ))}
            </select>
          </div>

          <Slider
            label="Font size"
            tooltip="Pixel font size. Bigger = takes more vertical space."
            min={16}
            max={400}
            step={2}
            value={clip.fontSize}
            onChange={(v) => setTextStyle(clip.id, { fontSize: v })}
            format={(v) => `${v.toFixed(0)}px`}
          />
          <Slider
            label="Font weight"
            tooltip="Numeric weight (100 thin - 900 black)."
            min={100}
            max={900}
            step={100}
            value={clip.fontWeight}
            onChange={(v) => setTextStyle(clip.id, { fontWeight: v })}
            format={(v) => `${v.toFixed(0)}`}
          />

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              Color
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {COLOR_PRESETS.map((c) => (
                <Tooltip key={c} content={`Set color to ${c}`}>
                  <button
                    aria-pressed={clip.color === c}
                    onClick={() => setTextStyle(clip.id, { color: c })}
                    style={{ background: c }}
                    className="swatch"
                  />
                </Tooltip>
              ))}
            </div>
            <input
              type="text"
              value={clip.color}
              onChange={(e) => setTextStyle(clip.id, { color: e.target.value })}
              className="mt-1 w-full rounded-md border border-white/10 bg-ink-800 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-indigo-400 focus:outline-none"
            />
          </div>

          <Slider
            label="Background opacity"
            tooltip="Add a translucent black pill behind the text (0 = none)."
            min={0}
            max={1}
            step={0.05}
            value={clip.backgroundOpacity}
            onChange={(v) => setTextStyle(clip.id, { backgroundOpacity: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              Alignment
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["left", "center", "right"] as const).map((a) => {
                const pressed = clip.textAlign === a;
                const Icon = a === "left" ? AlignLeft : a === "right" ? AlignRight : AlignCenter;
                return (
                  <Tooltip key={a} content={`Align ${a}.`}>
                    <button
                      onClick={() => setTextStyle(clip.id, { textAlign: a })}
                      aria-pressed={pressed}
                      className={
                        "flex items-center justify-center rounded-md border px-2 py-1.5 text-[11px] transition-smooth " +
                        (pressed
                          ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                          : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10")
                      }
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </div>
      </Section>

      <Section icon={<Sparkles className="h-3.5 w-3.5" />} title="Timing">
        <Slider
          label="Start"
          tooltip="When this text becomes visible on the timeline (seconds)."
          min={0}
          max={300}
          step={0.1}
          value={clip.start}
          onChange={(v) => setTextStart(clip.id, v)}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <Slider
          label="Duration"
          tooltip="How long the text stays on screen (seconds)."
          min={0.5}
          max={60}
          step={0.5}
          value={clip.duration}
          onChange={(v) => setTextDuration(clip.id, v)}
          format={(v) => `${v.toFixed(1)}s`}
        />
      </Section>

      <Section icon={<Layers className="h-3.5 w-3.5" />} title="Position">
        <Slider
          label="X offset"
          tooltip="Horizontal offset from canvas center (px, + right, - left)."
          min={-640}
          max={640}
          step={1}
          value={clip.x}
          onChange={(v) => setTextPosition(clip.id, v, clip.y)}
          format={(v) => `${v.toFixed(0)}px`}
        />
        <Slider
          label="Y offset"
          tooltip="Vertical offset from canvas center (px, + down, - up)."
          min={-360}
          max={360}
          step={1}
          value={clip.y}
          onChange={(v) => setTextPosition(clip.id, clip.x, v)}
          format={(v) => `${v.toFixed(0)}px`}
        />
      </Section>
    </div>
  );
};

// ---------- Shared bits ------------------------------------------------

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, title, rightAction, children }) => (
  <div className="rounded-lg bg-ink-700/60 p-3 ring-1 ring-white/5">
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-300">
        {icon}
        {title}
      </div>
      {rightAction}
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

const TransitionPicker: React.FC<{
  side: "in" | "out";
  value: TransitionKind;
  duration: number;
  onType: (t: TransitionKind) => void;
  onDuration: (d: number) => void;
}> = ({ side, value, duration, onType, onDuration }) => {
  const label = side === "in" ? "Enter from previous" : "Exit to next";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-300">
          {value === "none" ? "—" : `${duration.toFixed(1)}s`}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {TRANSITION_OPTIONS.map((opt) => {
          const pressed = value === opt;
          return (
            <Tooltip
              key={opt}
              content={
                pressed
                  ? `Currently using ${TRANSITION_LABEL[opt]}`
                  : `Use ${TRANSITION_LABEL[opt]} for this ${side === "in" ? "entrance" : "exit"}`
              }
            >
              <button
                onClick={() => onType(opt)}
                aria-pressed={pressed}
                className={
                  "rounded-md border px-2 py-1.5 text-[11px] transition-smooth " +
                  (pressed
                    ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                    : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10")
                }
              >
                {TRANSITION_LABEL[opt]}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <Slider
        label="Duration"
        tooltip="How long the transition takes (seconds)."
        min={0.1}
        max={3}
        step={0.1}
        value={duration}
        onChange={onDuration}
        format={(v) => `${v.toFixed(1)}s`}
      />
    </div>
  );
};

const NumberField: React.FC<{
  label: string;
  tooltip: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}> = ({ label, tooltip, value, onChange, min, max, step }) => (
  <Tooltip content={tooltip} side="left">
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step ?? 0.05}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="mt-1 w-full rounded-md border border-white/10 bg-ink-800 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-indigo-400 focus:outline-none"
      />
    </label>
  </Tooltip>
);

const BackgroundSection: React.FC = () => {
  const timeline = useTimelineStore((s) => s.timeline);
  const setBackgroundColor = useTimelineStore((s) => s.setBackgroundColor);
  return (
    <div className="border-t border-white/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-300">
        <Layers className="h-3.5 w-3.5" /> Canvas
      </div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
        Background colour
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {["#000000", "#0b0d12", "#1e293b", "#7c2d12", "#831843", "#fafafa"].map((c) => (
          <Tooltip key={c} content={`Set background to ${c}`}>
            <button
              aria-pressed={timeline.backgroundColor === c}
              onClick={() => setBackgroundColor(c)}
              style={{ background: c }}
              className="swatch"
            />
          </Tooltip>
        ))}
      </div>
      <div className="mt-2 text-[10px] font-mono text-zinc-500">
        fps: {timeline.fps} • canvas: {timeline.width}×{timeline.height}
      </div>
    </div>
  );
};

export default PropertyInspector;
