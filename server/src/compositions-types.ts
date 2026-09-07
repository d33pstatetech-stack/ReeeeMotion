/**
 * Re-export of the shared compositions package surface.
 *
 * Lives inside `server/src/` so it sits under `rootDir: "src"` in
 * `server/tsconfig.json`. Without this re-export, server files would have
 * to import `../../compositions/src/types` directly, which trips TS6059
 * (file is not under rootDir) and breaks `tsc`'s build output structure
 * (the `dist/<basename>` layout relied on by `npm run build && npm start`).
 *
 * This is a full (value + type) re-export, not `export type *`: types.ts is
 * a dependency-free module (pure interfaces, constants and the shared
 * timeline-duration helpers), so pulling its runtime values into the server
 * bundle is safe AND required — `renderer.ts` uses `timelineEndFrames()`
 * from it so server renders match the client preview frame-for-frame.
 */
export * from "../../compositions/src/types";
