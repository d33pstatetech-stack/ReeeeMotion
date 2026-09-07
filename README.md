# Remotion Video Editor (Local)

[![CI verify](https://github.com/d33pstatetech-stack/ReeeeMotion/actions/workflows/verify.yml/badge.svg)](https://github.com/d33pstatetech-stack/ReeeeMotion/actions/workflows/verify.yml)
[![CI test-pwsh](https://github.com/d33pstatetech-stack/ReeeeMotion/actions/workflows/test-pwsh.yml/badge.svg)](https://github.com/d33pstatetech-stack/ReeeeMotion/actions/workflows/test-pwsh.yml)
[![License: Apache-2.0](https://img.shields.io/github/license/d33pstatetech-stack/ReeeeMotion)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/d33pstatetech-stack/ReeeeMotion)](https://github.com/d33pstatetech-stack/ReeeeMotion/releases/latest)
[![GitHub topics](https://img.shields.io/github/repo-topics/d33pstatetech-stack/ReeeeMotion)](https://github.com/d33pstatetech-stack/ReeeeMotion)

A fully local, free, and open-source web-based video editor. Drag clips and
images onto a timeline, tweak Remotion variables (scale, opacity, rotation,
transitions, spring entrances), and export the final video as MP4 – all from a
React + Vite frontend that talks to a Node.js + Express backend which uses
**Remotion's bundler + renderer** to produce the final video headlessly.

```
ReeeeMotion/
├── client/         React + Vite + TypeScript + Tailwind UI (port 5173)
├── server/         Node + Express + multer + @remotion/renderer (port 3001)
├── compositions/   Pure Remotion project consumed by both client & server
├── verify.mjs      Cross-package parallel verifier (typecheck + vitest)
├── docker-compose.yml   Two-service stack (server + nginx-served client)
├── Dockerfile.server    Multi-stage build → runtime with compositions/ + Chromium baked in
├── Dockerfile.client    Multi-stage build → nginx:alpine serving Vite SPA
├── client/public/user-guide.html  Single-page user guide (Quickstart + Glossary) — served at /user-guide.html
└── .github/workflows/verify.yml  CI: runs `npm run verify` on every push + PR
```

## Quick start (one-time setup)

```bash
# from the project root
npm install -g npm         # ensure npm >= 10 (workspaces ok)
```

Then install each package:

```bash
cd compositions && npm install
cd ../server && npm install
cd ../client && npm install
```

> **First export = one-time browser download.** The server's headless
> Chromium (used by `@remotion/renderer`) is fetched automatically by a
> `postinstall` hook in `server/` (~150 MB, cached). If the machine doing
> the exporting is offline, pre-install the browser on a connected machine
> or run `cd server && npm run ensure-browser` once while online — exports
> fail with a clear error rather than a TLS stack trace when it's missing.

> We intentionally keep the three packages **separate** (no workspaces) so each
> one chooses its own dev/build commands and to keep the Remotion composition
> fully decoupled from the React UI code, exactly as the Remotion team
> recommends when you have a custom editor.

## Run (two terminals)

```bash
# Terminal 1 - the Express + Remotion backend
cd server
npm run dev

# Terminal 2 - the React + Vite UI
cd client
npm run dev
```

Open **http://localhost:5173**.

### Alternative: one-terminal stack (`scripts/dev.sh`)

If you'd rather run both processes in a single terminal, the repo ships
`scripts/dev.sh` (and an `npm run dev:all` shortcut at the repo root). It
boots server + client, prints a URL table (with real log paths), tails both
logs, and tears the whole stack down atomically on Ctrl-C. Cleanup prefers
`setsid` (util-linux — preinstalled on every Linux distribution and in
git-bash), which gives a session-leader-based atomic-cleanup guarantee.
**macOS does not ship `setsid`**; on Darwin the script automatically uses
the relaxed-cleanup fallback (and still works out of the box). On other
`setsid`-less environments (Docker Alpine, minimal CI runners, containers
without util-linux), opt into the same fallback explicitly:

```bash
# Trade-off: cleanup walks each PID tree via pgrep/taskkill instead of
# killing a session+process group atomically; an occasional grandchild
# watcher can linger if a child doesn't forward SIGTERM.
ALLOW_NO_SETSID=1 npm run dev:all
```

The script also keeps the two ports clean — if `:3001` or `:5173` is already
busy when you start, it refuses to launch and tells you how to free them,
rather than letting Vite crash with a confusing `strictPort` error.

### One-click GUI launchers (no terminal needed)

For users who would rather double-click an icon than run from a terminal,
the project ships platform-native launchers that auto-detect the best
available shell:

| OS | File | How to launch |
|---|---|---|
| Windows | `start.cmd` (or `start.ps1`) | Double-click in Explorer. `start.cmd` auto-detects `bash` (Git for Windows) first and falls back to PowerShell — so a Windows user without Git-Bash still gets a working launcher out of the box. |
| macOS   | `start.command`        | Double-click in Finder. First time, macOS Gatekeeper will block it (right-click → Open → confirm); subsequent double-clicks run immediately. |
| Linux   | `bash start.sh`        | From a terminal: `bash start.sh` (or `./start.sh` after `chmod +x start.sh`). |

For the deep-dive — including the `--own` manifest preflight (cross-language
JSON-compatible with PowerShell), process cleanup via `setsid` + Windows
job-object tree, full PowerShell-native invocation notes
(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev.ps1`),
and a troubleshooting table covering the most common launch failures —
see **[`README_GUI_LAUNCHER.md`](README_GUI_LAUNCHER.md)**.

A lightweight zero-dep smoke test for the new PowerShell launchers is
wired in via `.github/workflows/test-pwsh.yml` and runs alongside the
existing [`verify.yml`](.github/workflows/verify.yml) on every push + PR
to `main`. Locally it is `npm run test:pwsh`.

### Smoke-testing the export pipeline (`npm run smoke:export`)

For a full end-to-end MP4 check that doesn't require opening the editor,
the repo ships `scripts/smoke-export.sh`. It boots the stack via
`scripts/dev.sh --no-browser`, polls both ports, uploads a synthetic PNG,
builds a v4-shaped TimelineState that matches `compositions/src/types.ts`
verbatim, `POST`s it to `/api/render`, polls the resulting static URL, and
verifies the MP4 magic bytes. If any step fails, the failure branch dumps
the last 30 lines of the dev.sh log, a fresh `/api/health` probe, the
`server/renders/` + `server/uploads/` directory listings, and the timeline
preview — enough to triage without rerunning with extra logging.

```bash
# Default (setsid present)
npm run smoke:export

# setsid-less machines (Docker Alpine, minimal CI, etc.)
ALLOW_NO_SETSID=1 npm run smoke:export

# Cold first runs (Chromium bundle download)
ALLOW_NO_SETSID=1 SMOKE_RENDER_BUDGET=180 npm run smoke:export
```

`SMOKE_RENDER_BUDGET` is the polling iteration count (each iteration sleeps
5 s, so 60 ≈ 5 min, 180 ≈ 15 min). The server side has matching
15-min request timeouts on `/api/render` + `/api/upload` and unhandled-
rejection safety nets so a Remotion worker crash surfaces as a clear 500
instead of taking down the whole process.

## Verify (one-shot cross-package check)

The repo ships a small Node script (`verify.mjs`) that fans out the typecheck
+ Vitest tasks across all three packages **in parallel** and exits non-zero
if any task fails:

```bash
# from the repo root
npm run verify
# or, sequentially for debugging:
npm run verify:seq
```

What it runs:

| task                      | location   | command             |
| ------------------------- | ---------- | ------------------- |
| `client: typecheck`       | `client/`  | `tsc --noEmit`      |
| `client: vitest`          | `client/`  | `vitest run`        |
| `server: typecheck`       | `server/`  | `tsc --noEmit`      |
| `compositions: typecheck` | skipped    | (typechecked transitively via client + server) |

The monorepo intentionally skips standalone typechecking of `compositions/`
because it has no `node_modules` of its own — it's typechecked transitively
through the client (path alias) and server (re-export file). If you ever do
need a standalone build for the composition (e.g. to run `npx remotion
studio`), do `cd compositions && npm install && npm run build` first.

## Docker / docker-compose

The repo ships two multi-stage Dockerfiles + a two-service compose file:

```bash
docker compose up --build      # builds + starts server (3001) + client (5173)
open http://localhost:5173/
```

How it works:

- **`Dockerfile.server`** — multi-stage build → minimal `node:20-bookworm-slim`
  runtime that copies the compiled `dist/`, prunes dev deps, and copies the
  `compositions/src/` tree in (the server bundles it at runtime via
  `@remotion/bundler`).
- **`Dockerfile.client`** — multi-stage build → tiny `nginx:1.27-alpine` image
  serving the Vite SPA. `docker/nginx.client.conf` proxies `/api/*` to the
  `server` service on the compose network so the SPA never exposes
  `:3001` externally.
- **`docker-compose.yml`** — two services (`server`, `client`), named volumes
  for `uploads/` + `renders/` so MP4s and media persist between restarts.

> **Dev mode:** if you want to iterate on code without rebuilding images,
> run `npm run dev` per terminal as in the Quick Start section above — the
> Docker setup targets production-style deployments.

## How it works

1. You drop a file on the **Media Bin**. The browser `POST`s it to
   `/api/upload` (multer, disk: `server/uploads/`). The server answers with a
   public URL such as `http://localhost:3001/uploads/abc123.mp4`.
2. Drag the asset onto the **Timeline**. A clip entry is appended to the
   timeline JSON (the **single source of truth**).
3. Select a clip → tweak it in the **Property Inspector** (scale, opacity,
   rotation, transitions, spring physics).
4. The **Preview** is a `<Player>` from `@remotion/player`. It renders the
   `MainComposition` from the `compositions/` package, fed with the live
   timeline JSON as `inputProps`. Changes are reflected frame-perfectly.
5. Click **Export**. The client starts a background render job
   (`POST /api/render/jobs`) and polls its real progress
   (`GET /api/render/jobs/:id`), streaming the finished MP4 from
   (`GET /api/render/jobs/:id/file`). The server:
   1. uses `@remotion/bundler` to bundle `compositions/` (cached — a
      re-bundle only happens when the compositions source changes),
   2. uses `@remotion/renderer` to render the MP4 (`server/renders/<id>.mp4`),
   3. hands the file back as a download.

   The legacy synchronous `POST /api/render` (same body, plus
   `mode: "url" | "binary"`) is kept for scripts — it's what
   `npm run smoke:export` exercises.

   Housekeeping: files in `server/renders/` are TTL-swept after 24 h and
   `server/uploads/` after 7 days (tune or disable with
   `RENDER_TTL_HOURS` / `UPLOAD_TTL_HOURS`; `0` disables a bucket).

## User guide

The app ships a self-contained, single-page user guide for content creators:

- **`client/public/user-guide.html`** is served by Vite's static asset pipeline at **`http://localhost:5173/user-guide.html`** (and at the same path when running the production nginx stack).
- It opens with a sticky table-of-contents, a four-step **Quickstart** (Upload → Drag → Tweak → Export), then per-feature sections (Timeline, Media Bin, Preview, Property Inspector, Keyboard shortcuts, Exporting, Troubleshooting), and closes with a categorized **Glossary** covering video, AI, image-generation, and content-creation jargon.
- You can also launch it from inside the editor: the toolbar's **?** button opens it in a new tab without disturbing the current timeline.

## Continuous Integration

`.github/workflows/verify.yml` runs `npm run verify` on every push and PR to
`main`. Each per-package `node_modules` is cached separately (no workspaces).
Push to `main` cancels any in-flight runs on the same branch via a
`concurrency` group.

`.github/workflows/test-pwsh.yml` runs the zero-dep PowerShell-launcher
smoke harness (`scripts/test-pwsh.ps1`) on every push + PR — 40+ asserts
covering `_pid-manifest.ps1` roundtrips, `cleanup-ports.ps1` arg parsing,
`dev.ps1` exit codes, and the cross-language manifest format. Required CI
checks for merging into `main` are `verify` + `test-pwsh`.

`.github/workflows/verify-docker.yml` runs the full `docker compose`
build + boot + curl + teardown cycle on a weekly cron (cycles Monday
06:00 UTC) or via manual dispatch. Catches layer-cache / COPY-context /
nginx-proxy drift that shows up only with a real container stack.

`.github/workflows/release-draft.yml` auto-generates a Markdown
`RELEASE_NOTES.md` artifact on every `v*` tag push (Conventional Commits
sectioning included).

## Contributing

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for repo layout, dev
workflow, Conventional-Commits spec, tag-driven release flow, and the
SHA-pinning convention we use for GitHub Actions.

Issue templates live at `.github/ISSUE_TEMPLATE/{bug,feature}.md`;
PR template at `.github/PULL_REQUEST_TEMPLATE.md`. Auto-assigned owners
are in **[CODEOWNERS](./CODEOWNERS)** (currently the
`@d33pstatetech-stack` org). Dependency updates — both `npm` and
`github-actions` — are auto-PR'd weekly by Dependabot (config in
`.github/dependabot.yml`).

## License

Licensed under the **Apache License, Version 2.0** — see
**[LICENSE](./LICENSE)** for the full text + NOTICE + patent-grant clause.
