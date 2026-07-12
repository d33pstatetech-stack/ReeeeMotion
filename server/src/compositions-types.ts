/**
 * Type-only re-export of the shared compositions package types.
 *
 * Lives inside `server/src/` so it sits under `rootDir: "src"` in
 * `server/tsconfig.json`. Without this re-export, server files would have
 * to import `../../compositions/src/types` directly, which trips TS6059
 * (file is not under rootDir) and breaks `tsc`'s build output structure
 * (the `dist/<basename>` layout relied on by `npm run build && npm start`).
 *
 * `export type *` ensures no runtime imports leak into the server bundle.
 */
export type * from "../../compositions/src/types";
