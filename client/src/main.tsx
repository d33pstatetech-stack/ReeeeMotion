import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TooltipProvider, TOOLTIP_DEFAULT_DELAY_MS } from "./components/Tooltip";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={TOOLTIP_DEFAULT_DELAY_MS}>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
);
