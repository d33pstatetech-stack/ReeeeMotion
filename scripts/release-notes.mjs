// scripts/release-notes.mjs — pure-Node conventional-commits release-notes helper.
//
// No deps. Walks git log via child_process, parses Conventional Commit
// subjects (^type(scope)!?: subject), and groups commits by package based
// on which files they touched (path-based, not title-prefix — paths are
// ground truth). Surfaces `!` / `BREAKING CHANGE:` footer entries in a
// dedicated top section.
//
// Usage:
//   node scripts/release-notes.mjs                                  # default: previous tag → HEAD, TTY
//   node scripts/release-notes.mjs --md                             # markdown
//   node scripts/release-notes.mjs --since v0.1.0 --until v0.2.0     # custom range
//   node scripts/release-notes.mjs --help
//
// Output is deterministic; exit code is 0 even on empty commit ranges so
// it can be wired into CI without a dedicated "no changes" gate.

import { spawnSync } from "node:child_process";
import process from "node:process";
import { parseArgs } from "node:util";

const TYPES = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance",
  refactor: "Refactoring",
  build: "Build system",
  ci: "CI",
  docs: "Documentation",
  test: "Tests",
  chore: "Chores",
};
const CC_REGEX = /^([a-z]+)(\([^)]+\))?!?: (.*)$/;
const PACKAGES = ["client", "server", "compositions", "root"];

function exec(cmd, args) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  if (res.error) throw res.error;
  return (res.stdout ?? "").trim();
}

function listTags() {
  const out = exec("git", ["tag", "--sort=-v:refname"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function parseCommits(rawRange) {
  const raw = exec("git", [
    "log",
    rawRange,
    "--format=%H%x00%s%x00%b%x1e",
  ]);
  if (!raw) return [];
  return raw
    .split("\x1e")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [sha, subject, body] = c.split("\x00");
      return { sha, subject, body: body ?? "" };
    });
}

function shasTouching(path, range) {
  const raw = exec("git", ["log", range, "--format=%H", "--", path]);
  if (!raw) return new Set();
  return new Set(raw.split("\n"));
}

function classify(commit) {
  const m = commit.subject.match(CC_REGEX);
  const isBreaking =
    commit.subject.includes("!:") ||
    commit.body.includes("BREAKING CHANGE:");
  let type = "chore";
  let desc = commit.subject;
  let scope = null;
  if (m) {
    type = m[1];
    scope = m[2] ? m[2].slice(1, -1) : null;
    desc = m[3];
  }
  return { ...commit, type, desc, scope, isBreaking };
}

function render(structure, opts) {
  const isMd = !!opts.md;
  const h1 = isMd ? "# " : "";
  const h2 = isMd ? "## " : "";
  const h3 = isMd ? "### " : "";
  const out = [];
  const sinceStr = opts.since || "Beginning";
  out.push(`${h1}Release Notes (${sinceStr} \u2192 ${opts.until})`);
  out.push("");

  if (structure.breaking.length) {
    out.push(`${h2}\u26A0\uFE0F BREAKING CHANGES`);
    for (const c of structure.breaking) {
      out.push(`- \`${c.sha.slice(0, 7)}\` ${c.desc}`);
    }
    out.push("");
  }

  for (const pkg of PACKAGES) {
    const bucket = structure.packages[pkg];
    const lines = [];
    for (const t of Object.keys(TYPES)) {
      const arr = bucket[t] ?? [];
      if (!arr.length) continue;
      lines.push(`${h3}${TYPES[t]}`);
      for (const c of arr) {
        lines.push(`- \`${c.sha.slice(0, 7)}\` ${c.desc}`);
      }
    }
    if (!lines.length) continue;
    out.push(`${h2}${pkg.toUpperCase()}`);
    out.push(...lines);
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}

function main() {
  const { values } = parseArgs({
    options: {
      since: { type: "string" },
      until: { type: "string", default: "HEAD" },
      md: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(
      [
        "Usage: node scripts/release-notes.mjs [--since <tag>] [--until <ref>] [--md]",
        "",
        "Options:",
        "  --since <tag>   start of commit range (default: latest semver-ish tag)",
        "  --until <ref>   end of commit range (default: HEAD)",
        "  --md            emit markdown instead of plain text",
        "  --help          this message",
      ].join("\n") + "\n",
    );
    process.exit(0);
  }

  const since = values.since ?? listTags()[0] ?? "";
  const range = since ? `${since}..${values.until}` : values.until;
  const commits = parseCommits(range);

  // Per-package SHA sets for path-based scope inference.
  const scopes = {
    client: shasTouching("client", range),
    server: shasTouching("server", range),
    compositions: shasTouching("compositions", range),
  };

  const structure = { breaking: [], packages: {} };
  for (const pkg of PACKAGES) {
    structure.packages[pkg] = {};
    for (const t of Object.keys(TYPES)) {
      structure.packages[pkg][t] = [];
    }
  }

  for (const raw of commits) {
    const c = classify(raw);
    if (c.isBreaking) structure.breaking.push(c);

    let matchedPkg = false;
    const alpha = ["client", "server", "compositions"]; // order of path-check priority
    for (const pkg of alpha) {
      if (scopes[pkg].has(c.sha)) {
        matchedPkg = true;
        if (TYPES[c.type]) structure.packages[pkg][c.type].push(c);
      }
    }
    if (!matchedPkg && TYPES[c.type]) {
      structure.packages.root[c.type].push(c);
    }
  }

  process.stdout.write(render(structure, { since, until: values.until, md: values.md }));
}

try {
  main();
} catch (err) {
  process.stderr.write(`release-notes: ${err.message ?? err}\n`);
  process.exit(1);
}
