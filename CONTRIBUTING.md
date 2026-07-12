# Contributing

Thanks for hacking on the Remotion editor! This guide captures everything you need to land a PR or cut a release without spelunking through 4 separate docs.

## Repo layout

```
remotion/
├── client/         React + Vite + TS UI (port 5173)
├── server/         Express + @remotion/renderer (port 3001)
├── compositions/   Pure Remotion project consumed by both client & server
├── scripts/         Pure-Node helpers (release-notes.mjs, etc.)
├── verify.mjs       Cross-package parallel verifier
├── docker-compose.yml  Two-service production stack
├── .github/workflows/  CI: verify (always), verify-docker (manual / weekly), release-draft (tag push)
├── client/public/     Static assets served by Vite (e.g. user-guide.html)
└── docs/ (here)      This file.
```

The three packages are intentionally **separate** — no npm workspaces. Each one gets to choose its own dev/build commands and the Remotion composition stays decoupled from the React UI, per the Remotion team's guidance.

## First-time setup

```bash
cd compositions && npm install
cd ../server && npm install
cd ../client && npm install
```

Requires Node ≥ 20 for every package. (Remotion's `--no-fs`-style compilation is sensitive to older V8.)

## Day-to-day dev

Two terminals:

```bash
# Terminal 1 — server (tsc watching when files change)
cd server && npm run dev       # http://localhost:3001

# Terminal 2 — UI (Vite HMR)
cd client && npm run dev       # http://localhost:5173
```

The shell script `scripts/dev.sh` runs both in one terminal — Ctrl-C tears both down.

## Verify before pushing

```bash
# from the repo root
npm run verify         # parallel: client typecheck + client vitest + server typecheck
```

This is what CI runs. **No PR should be opened without a local green `npm run verify`.**

## Conventional Commits (for the release-notes script to do real work)

The release-notes script in `scripts/release-notes.mjs` parses commits via the spec at <https://www.conventionalcommits.org/>. To get useful sectioning in `RELEASE_NOTES.md`:

| Prefix          | Maps to section in changelog      |
| --------------- | --------------------------------- |
| `feat:`         | Features                          |
| `fix:`          | Bug Fixes                         |
| `perf:`         | Performance                       |
| `refactor:`     | Refactoring                       |
| `build:`        | Build system                      |
| `ci:`           | CI                                |
| `docs:`         | Documentation                     |
| `test:`         | Tests                             |
| `chore:`        | Chores                            |

Optional scopes are parsed from the parenthetical: `feat(ci): add verify-docker workflow`. Scope is informational only — the script infers the package by which path the commit touched (`git log -- <path>`), so you don't need `feat(client):` for client changes.

### Breaking changes

Two ways to flag breaking changes; both work:

1. Suffix the type with `!`: `feat(timeline)!: remove TimelineState.fps field`.
2. Add a `BREAKING CHANGE:` line anywhere in the commit body.

Breaking-change commits surface as a dedicated `⚠️ BREAKING CHANGES` section at the top of the release notes.

## Cutting a release

The release flow is tag-driven and automated. To publish a new version:

1. Pick the next semver tag (currently `v0.1.x` → `v0.2.0` for the first bump).
2. Push the tag: `git tag v0.2.0 && git push origin v0.2.0` (or via the GitHub UI the same way).
3. The `release-draft` workflow runs and uploads `RELEASE_NOTES.md` as a workflow artifact. Download it and paste it into the GitHub Release body before clicking Publish.
4. (Optional) Run the `verify-docker` workflow from the Actions tab once after the merge to confirm the production stack still boots cleanly end-to-end.

### First-ever-tag caveat

There is one open edge case worth knowing about: if this is the very first tag in the repo's history, `release-notes.mjs --since ""` falls back to `listTags()[0]`, which at the moment of the tag push IS the just-pushed tag (`NEW_TAG`), so the resulting range is `NEW_TAG..NEW_TAG` (empty). The workflow catches this and exits 0 with a 1-line header; the release notes will be empty for that one release. Workaround: tag an initial placeholder (`v0.0.0` with a single "chore: initial commit" message) before the first real tag so `listTags()` has an entry smaller than the live tag.

## CI workflow triggers

| Workflow         | Trigger                                          | What it does                                       |
| ---------------- | ------------------------------------------------ | -------------------------------------------------- |
| `verify`         | push to main, PR to main                         | `npm run verify` (typecheck + vitest in parallel) |
| `verify-docker`  | `workflow_dispatch` (manual) + weekly cron      | Build both Docker images, boot the compose stack, curl `/api/health` and `/`, tear down. Useful for catching COPY context / layer cache / nginx proxy drift. |
| `release-draft`  | Tag push matching `v*`                            | Generate + upload `RELEASE_NOTES.md` as a workflow artifact.

Per-package `node_modules` are cached separately in CI via `actions/cache@v4` and regenerated by `hashFiles('client/package.json')` etc., so an unrelated edit to one package doesn't bust the other two caches. In-flight runs on the same branch cancel each other (`concurrency.verify-${{ github.ref }}`) so a fix pushed 30 seconds into a flaky run doesn't waste 5 minutes.

## Smoke targets (path-alias invariants)

`client/src/test/compositions-smoke.test.ts` exercises the `compositions/*` path alias at Vite-runtime. If a future Vite / TS upgrade breaks the alias, this test fails before any UI work is shipped. Two it-blocks: import resolves + `compositions/types` is shape-valid (NOT value-valid — adjusting `DEFAULT_TIMELINE.fps` to 24 to support slow-motion presets won't break this test, by design).

## The compositions/ package is typechecked transitively

`compositions/` has no `node_modules` of its own — it's not built standalone. Its types are pulled in transitively:

- by the **client** through the `compositions/*` path alias (in `client/tsconfig.json` + mirrored to `vite.config.ts` / `vitest.config.ts` for runtime resolution).
- by the **server** through the type-only re-export at `server/src/compositions-types.ts`, which keeps the file under `server/src` so it doesn't fight `rootDir`.

If you ever need to typecheck compositions alone (`npx remotion studio`, e.g.), `cd compositions && npm install && npm run build` first. This is documented in `compositions/tsconfig.json`'s `_note`.

## When in doubt

- The verify script reads `verify.mjs` directly — read that for what it actually runs.
- `docker compose config --quiet` is the cheapest "is my YAML valid?" smoke; faster than `docker compose up`.
- The release-notes script has a `--help` flag.
- End-user documentation lives at **`client/public/user-guide.html`** — that's the single source of truth for creators. Edit it when a feature's UX changes; the editor's in-app tooltips are intentionally lighter than the guide.
