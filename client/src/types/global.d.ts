// Module shims for runtime packages whose `.d.ts`'s live in adjacent
// @types/* packages or that ship without bundled declarations.
//
// react/jsx-runtime & react/jsx-dev-runtime: types come from
// `@types/react/index.d.ts` but TS can't follow because the specifier says
// "react/jsx-runtime" (sub-path) which is physically served by the `react`
// package itself, not `@types/react`. Vite uses `jsx-dev-runtime` in dev
// (vitest / vite dev) and `jsx-runtime` in production builds; both need
// the same shim so that smoke tests touching the compositions package
// resolve correctly.
declare module "react/jsx-runtime";
declare module "react/jsx-dev-runtime";
