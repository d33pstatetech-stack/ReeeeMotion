/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        ink: {
          900: "#0b0d12",
          800: "#11141b",
          700: "#181c25",
          600: "#222837",
          500: "#2d3344",
          400: "#3a4156",
          300: "#4a5168",
        },
        accent: {
          violet: "#8b5cf6",
          indigo: "#6366f1",
          fuchsia: "#d946ef",
        },
        neon: {
          emerald: "#34d399",
          cyan: "#22d3ee",
          amber: "#fbbf24",
          rose: "#fb7185",
        },
        lane: {
          video: "#6366f1",
          audio: "#10b981",
          text: "#06b6d4",
        },
      },
      backgroundImage: {
        "lane-video":
          "linear-gradient(180deg, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0.04) 100%)",
        "lane-audio":
          "linear-gradient(180deg, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0.04) 100%)",
        "lane-text":
          "linear-gradient(180deg, rgba(6,182,212,0.10) 0%, rgba(6,182,212,0.04) 100%)",
      },
      boxShadow: {
        "inner-border":
          "inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)",
        "glow-violet":
          "0 0 0 1px rgba(139,92,246,0.4), 0 0 24px -4px rgba(139,92,246,0.6)",
        "glow-emerald":
          "0 0 0 1px rgba(16,185,129,0.4), 0 0 24px -4px rgba(16,185,129,0.5)",
        "glow-cyan":
          "0 0 0 1px rgba(6,182,212,0.4), 0 0 24px -4px rgba(6,182,212,0.5)",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: {
        250: "250ms",
      },
      animation: {
        shimmer: "shimmer 2.4s linear infinite",
        "fade-in": "fadeIn 200ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
