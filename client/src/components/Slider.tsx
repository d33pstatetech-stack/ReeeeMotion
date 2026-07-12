import React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Tooltip } from "./Tooltip";

interface SliderProps {
  label: string;
  tooltip: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

/**
 * A labelled, tooltip'd Radix Slider that’s reusable everywhere in the
 * Property Inspector. Renders label on the left, value on the right.
 */
export const Slider: React.FC<SliderProps> = ({
  label,
  tooltip,
  min,
  max,
  step,
  value,
  onChange,
  format,
}) => {
  const formatted = format ? format(value) : value.toFixed(2);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-200">{formatted}</span>
      </div>
      <Tooltip content={tooltip} side="left">
        <SliderPrimitive.Root
          className="relative flex h-5 w-full touch-none select-none items-center"
          min={min}
          max={max}
          step={step}
          value={[value]}
          onValueChange={([v]) => onChange(v ?? min)}
        >
          <SliderPrimitive.Track className="relative h-1.5 grow rounded-full bg-white/10">
            <SliderPrimitive.Range className="absolute h-full rounded-full bg-indigo-500" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            className="block h-4 w-4 rounded-full border border-indigo-300 bg-white shadow-md transition-smooth hover:scale-110 focus:scale-110"
            aria-label={label}
          />
        </SliderPrimitive.Root>
      </Tooltip>
    </div>
  );
};
