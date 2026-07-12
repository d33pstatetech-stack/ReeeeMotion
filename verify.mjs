#!/usr/bin/env node
/**
 * verify.mjs — repo-root verification script.
 *
 * Runs typecheck + tests across all packages (client / compositions / server)
 * **in parallel** so a single `npm run verify` (or `node verify.mjs`) surfaces
 * all failures in one shot instead of one failure short-circuiting the others.
 *
 * Cross-platform: works from bash, zsh, Windows cmd.exe, and PowerShell because
 * it uses Node's `child_process.spawn` with `shell: true` (Windows resolves
 * `npm` to `npm.cmd` automatically; bash resolves it natively).
 *
 * Exits with code 1 if any task failed, 0 if all passed.
 */

import { spawn } from "node:child_process";
import process from "node:process";

const TASKS = [
  { name: "client: typecheck", cwd: "client", cmd: "npm", args: ["run", "typecheck"] },
  { name: "client: vitest", cwd: "client", cmd: "npm", args: ["run", "test"] },
  { name: "server: typecheck", cwd: "server", cmd: "npm", args: ["run", "typecheck"] },
  // NOTE: compositions is intentionally NOT typechecked standalone. The client
  // (which imports `compositions/*` via the path alias) and the server (which
  // bundles compositions at render time) cover the compositions package's
  // type surface. Without an installed `compositions/node_modules`, standalone
  // tsc would just fail on missing react/remotion typings.
];

// Optional 4th task: full end-to-end MP4 export smoke test (boots the dev
// stack, hits /api/upload + /api/render, verifies the resulting MP4). Only
// runs when the user explicitly opts in via RUN_EXPORT_SMOKE=1 because the
// deep dependency (a working Chromium for @remotion/renderer) isn't
// guaranteed on every dev machine, and the task takes minutes to complete.
const RUN_EXPORT_SMOKE = /^(1|true|yes|on)$/i.test(process.env.RUN_EXPORT_SMOKE ?? "");
if (RUN_EXPORT_SMOKE) {
  TASKS.push({
    name: "export: smoke (full end-to-end MP4)",
    cwd: ".",
    cmd: "bash",
    args: ["scripts/smoke-export.sh"],
  });
}

const PARALLEL = true; // set to false to run sequentially (debug mode)

function runTask(task) {
  return new Promise((resolve) => {
    const started = Date.now();
    console.log(`\n\u250C\u2500 [START] ${task.name} (cwd: ${task.cwd})`);
    const child = spawn(task.cmd, task.args, {
      cwd: task.cwd,
      shell: true, // resolves npm.cmd on Windows; bash handles path lookup on Unix
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    // Tee output so we can see failures live while still surfacing all results.
    child.stdout.on("data", (b) => process.stdout.write(b));
    child.stderr.on("data", (b) => process.stderr.write(b));
    child.on("close", (code) => {
      const ms = Date.now() - started;
      const verdict = code === 0 ? "\u2713 PASS" : `\u2717 FAIL (exit ${code})`;
      console.log(`\u2514\u2500 [${verdict}] ${task.name} (${ms}ms)`);
      resolve({ name: task.name, success: code === 0, ms });
    });
  });
}

async function main() {
  const t0 = Date.now();
  console.log(`verify.mjs — running ${TASKS.length} task(s) ${PARALLEL ? "in parallel" : "sequentially"}`);
  const results = PARALLEL
    ? await Promise.all(TASKS.map(runTask))
    : await (async () => {
        const out = [];
        for (const t of TASKS) out.push(await runTask(t));
        return out;
      })();
  const failures = results.filter((r) => !r.success);
  const total = Date.now() - t0;
  console.log(`\n\u2500\u2500\u2500 verify.mjs summary (${total}ms total) \u2500\u2500\u2500`);
  for (const r of results) {
    console.log(`  ${r.success ? "\u2713" : "\u2717"} ${r.name} (${r.ms}ms)`);
  }
  if (failures.length) {
    console.error(`\n\u2717 ${failures.length}/${results.length} task(s) failed: ${failures.map((f) => f.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n\u2713 all ${results.length} task(s) passed.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("verify.mjs crashed:", e);
  process.exit(2);
});
