---
name: "Bug report"
about: "Something isn't working as expected. Please share steps to reproduce."
title: "[bug] "
labels: ["bug", "needs-triage"]
assignees: []
---

## What happened

<!-- One or two sentences on the symptom. Avoid diagnosis here; we
     only need the surface behavior + the steps below. -->

## Steps to reproduce

<!-- Numbered list of EXACT commands and inputs that lead to the bug.
     For UI bugs: which clip + which property + which sequence.
     For export bugs: include the timeline JSON (sanitized) or a
     reproduction MP4.
     For CI/launcher bugs: include the OS, shell, and the literal
     `npm run` invocation. -->

1.
2.
3.

## Expected behavior

<!-- What you thought should have happened, with as much precision as
     you can. "It crashed" -> "I expected the export to finish with a
     downloadable MP4; instead, I got a 500 error after 3 minutes". -->

## Actual behavior

<!-- What actually happened. Quote error messages verbatim. Include
     the last 30 lines of the relevant log (`/tmp/dev-server.*.log`
     for the server, browser console for the React UI). -->

## Environment

<!-- Hardware + OS + Node + browser version. The fastest way to fill
     this in: run `node --version && uname -a && (lsb_release -a 2>/dev/null || cat /etc/os-release | head -5)` and paste. -->

- **OS**:
- **Shell** (bash / PowerShell / pwsh version):
- **Node** (`node --version`):
- **Browser** (Chrome / Firefox / Safari + version):
- **Smoke harness result** (`npm run test:pwsh` exit code):

## Logs / screenshots / MediaBin JSON

<!-- Drag-drop images, OR paste a `######`-fenced code block. For
     timeline-state bugs, attach the saved timeline JSON. -->

## Possible cause (optional)

<!-- If you already have a hunch after reading CONTRIBUTING.md or the
     code, share it -- not required. We triage by "how reproducible
     is it" not "who diagnosed it fastest". -->
