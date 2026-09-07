import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface TooltipProps {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
  className?: string;
}

/**
 * A tooltip trigger + content pair. The app-level <TooltipPrimitive.Provider>
 * (with the shared delayDuration) is mounted ONCE in main.tsx — mounting a
 * Provider per tooltip (the old shape) created a Radix context + scope for
 * every single Tooltip instance in the tree for no benefit.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  side = "bottom",
  children,
  className,
}) => {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={
            "z-50 max-w-xs rounded-md border border-white/10 bg-ink-700 px-2.5 py-1.5 text-xs leading-snug text-zinc-100 shadow-lg " +
            (className ?? "")
          }
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-ink-700" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
};

/** Mount once, near the React root. */
export const TooltipProvider = TooltipPrimitive.Provider;
export const TOOLTIP_DEFAULT_DELAY_MS = 250;
