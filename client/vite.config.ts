import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The compositions project is a sibling folder. We expose it as `compositions`
// so that imports in the editor look the same as in the renderer.
export default defineConfig({
  plugins: [react()],
  resolve: {
// Vite's resolver doesn't honor tsconfig `paths` at runtime the same way
// TSC does, AND this repo's per-package install layout leaves
// `compositions/` WITHOUT its own node_modules. We therefore mirror
// several bare imports from files in `compositions/` source into
// `client/node_modules` for the BROWSER preview ONLY.
//
// ⚠️ These aliases are browser-side only. The server-side
// @remotion/bundler resolves through `server/node_modules` (which
// transitively pulls in `remotion` and `@remotion/*` via
// @remotion/bundler + @remotion/renderer), so server-side renders do
// NOT need — and MUST NOT — run `npm install` inside `compositions/`.
// If a future maintainer does that install and expects per-package
// versions to win, they will be silently shadowed by THESE aliases
// (every `remotion` or `@remotion/transitions` import always routes
// to `client/node_modules` from the browser's point of view).
// Keep `client/package.json` and `compositions/package.json` in sync
// on `remotion` + `@remotion/transitions` versions to avoid two
// separate copies hanging around the bundle.
    alias: [
      // Editor-side `@/...` resolved against client/src.
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // `compositions/...` resolves to the sibling source folder.
      {
        find: "compositions",
        replacement: path.resolve(__dirname, "../compositions/src"),
      },
      // React JSX runtimes — composes through client's react (the only
      // actual react installation in the browser).
      {
        find: "react/jsx-runtime",
        replacement: path.resolve(__dirname, "node_modules/react/jsx-runtime"),
      },
      {
        find: "react/jsx-dev-runtime",
        replacement: path.resolve(
          __dirname,
          "node_modules/react/jsx-dev-runtime"
        ),
      },
      // Remotion: prefix-match so SUBPATH imports (`remotion/no-react`,
      // `remotion/x`, ...) also resolve through the client's copy, not
      // just the bare specifier. `$1` is empty for the bare case or
      // "/<sub>" for subpath imports, produced by the alternation in
      // the capture group.
      {
        find: /^remotion($|\/)/,
        replacement: path.resolve(__dirname, "node_modules/remotion") + "$1",
      },
      // Same treatment for `@remotion/transitions`, the only @remotion/*
      // package actually imported by compositions/ source today.
      {
        find: /^@remotion\/transitions($|\/)/,
        replacement:
          path.resolve(__dirname, "node_modules/@remotion/transitions") + "$1",
      },
    ],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Proxy both the API and the served media to the Express server so the
    // browser can resolve them as same-origin URLs. (We still ALSO talk to
    // the server via VITE_API_BASE for upload/render calls.)
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // Hot-media should be cache-busted.
        headers: { "Cache-Control": "no-cache" },
      },
      "/renders": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2020",
  },
});
