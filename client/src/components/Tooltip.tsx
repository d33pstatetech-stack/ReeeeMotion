import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface TooltipProps {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
  children: React.ReactNode;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  side = "bottom",
  delayDuration = 250,
  children,
  className,
}) => {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
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
    </TooltipPrimitive.Provider>
  );
};
