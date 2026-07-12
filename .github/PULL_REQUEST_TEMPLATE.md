# Pull Request

<!-- Replace the placeholder text below with your PR summary. -->

## What / Why

<!-- One short paragraph: what are you changing and why. Reference the
     issue this addresses (e.g. "Fixes #42"). If the PR is non-trivial,
     include a sentence on the approach. -->

## How to verify locally

<!-- Bullet list of the EXACT commands + expected outputs that prove
     the change works. The CI bot will run the same checks, but the
     contributor should run them first; reviewers should look at the
     PR's CI run for verification. -->

- [ ] `npm run verify` exits 0 (typecheck + vitest)
- [ ] `npm run test:pwsh` exits 0 (`test-pwsh.yml` smoke)
- [ ] Manual scenario A: `<your step-by-step>` produces `<your outcome>`
- [ ] Manual scenario B: (if applicable)

## Risk / rollback

<!-- One sentence on what could regress and how to roll back. If the
     PR touches the server render path, mention whether `npm run
     smoke:export` was run locally. -->

## Release-notes impact

<!-- The release-notes script keys off Conventional Commit prefixes
     (feat:, fix:, perf:, ci:, docs:, build:, refactor:, test:, chore:).
     If you don't use one of those, the script will bucket the commit
     under "Other" so it'll still appear in the next release notes --
     just on a less-informative section header. -->

| Change type | Bucket it lands under |
|---|---|
| `feat:` | Features |
| `fix:` | Bug Fixes |
| `perf:` | Performance |
| `refactor:` | Refactoring |
| `build:` | Build system |
| `ci:` | CI |
| `docs:` | Documentation |
| `test:` | Tests |
| `chore:` | Chores |
| anything else | Other |

## Checklist

- [ ] I ran `npm run verify` (CI's gate)
- [ ] I read at least one of `CONTRIBUTING.md` / `README_GUI_LAUNCHER.md` for the area I touched
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `ci:`, etc.)
- [ ] No new top-level `git add` happened accidentally (verify with `git status --short` before `git commit`)
