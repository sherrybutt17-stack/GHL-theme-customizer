import "../services/loadEnv";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

/**
 * Does the code GIT HOLDS still build? Not the code on this disk — the code that ships.
 *
 * Render clones the repository and builds that. Your working tree is not deployed, and
 * anything written and never `git add`ed is invisible to the build in the one direction
 * nothing warns about: everything compiles here, every suite is green, and the deploy
 * fails on the first import.
 *
 * Measured on this repo the day it was written: fifteen untracked source files, and
 * ELEVEN unresolvable imports in what git held — `services/ticketSla`, `slaStatus`,
 * `businessHours`, `ticketTypes` on the server, and `NewTicket`, `ChangePassword`,
 * `queueReach`, `slaTone` in the desk. `tsc` and `vite` both fail immediately. The whole
 * ticket-automation and SLA half of the desk, plus the two npm scripts a GitHub workflow
 * calls, existed only on one laptop.
 *
 * CLAUDE.md already records the smaller version of this — thirty verification harnesses
 * written to a temp directory and never committed, leaving every "verified live" claim in
 * that document a dangling reference. Same root cause, and this is the expensive end of
 * it: there, the loss was evidence; here, it is the build.
 *
 * Deliberately needs NO database, NO network and NO build. It answers a question about the
 * repository, so it should be the cheapest thing you can run before a deploy, not the
 * slowest.
 *
 *   npm run verify-deployable --workspace @ghl-theme-builder/server
 */

const ROOT = resolve(__dirname, "..", "..", "..", "..");

/** Extensions a relative TS/TSX import may resolve through, in resolution order. */
const CANDIDATES = ["", ".ts", ".tsx", ".d.ts", ".js", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(detail.replace(/^/gm, "        "));
  }
}

function trackedFiles(): string[] | null {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function main(): void {
  const tracked = trackedFiles();
  if (!tracked) {
    // A gate that cannot run has not passed. Said plainly, and non-zero, because the one
    // place this matters is immediately before a deploy.
    console.error("\n✗ Not a git checkout — this gate cannot answer the only question it asks.");
    process.exit(1);
  }

  /**
   * `git ls-files` reports the INDEX, so a staged-but-uncommitted file counts as shipped.
   * That is the right reading: the next commit will carry it, and the failure this exists
   * to catch is a file nobody has told git about at all.
   */
  const shipped = new Set(tracked);
  console.log(`\n${shipped.size} files are known to git.\n`);

  console.log("--- every relative import in the shipped tree resolves ---------------");
  /**
   * Relative specifiers only. A bare one is a package, and whether `node_modules` has it
   * is `package.json`'s question, not this one — checking it here would need an install
   * and would report a lockfile problem as a missing file.
   */
  const sources = tracked.filter((f) => /^apps\/.+\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const broken: string[] = [];
  for (const file of sources) {
    let src: string;
    try {
      src = readFileSync(join(ROOT, file), "utf8");
    } catch {
      // Tracked but absent from the disk — the mirror failure, reported by its own check.
      continue;
    }
    for (const m of src.matchAll(/(?:\bfrom\s+|\bimport\s+|\brequire\()\s*["'](\.[^"']+)["']/g)) {
      const spec = m[1];
      const base = relative(ROOT, resolve(dirname(join(ROOT, file)), spec)).split("\\").join("/");
      if (!CANDIDATES.some((ext) => shipped.has(base + ext))) {
        broken.push(`${file}\n  -> ${spec}   (nothing in git resolves it)`);
      }
    }
  }
  check(
    `${sources.length} source files import only things git holds`,
    broken.length === 0,
    broken.length
      ? `${broken.length} unresolvable import(s) — the deploy fails on the first of these:\n${broken.join("\n")}`
      : undefined
  );

  console.log("\n--- every npm script points at a shipped file ------------------------");
  /**
   * A script whose entry point is untracked fails only where it is actually run — which
   * for `ticket-automations` and `poll-feeds` is a GitHub Actions schedule nobody is
   * watching, on a cadence measured in minutes.
   */
  const missingScripts: string[] = [];
  for (const pkg of tracked.filter((f) => /(^|\/)package\.json$/.test(f) && !f.includes("node_modules"))) {
    let json: any;
    try {
      json = JSON.parse(readFileSync(join(ROOT, pkg), "utf8"));
    } catch {
      continue;
    }
    for (const [name, cmd] of Object.entries<string>(json.scripts ?? {})) {
      for (const m of String(cmd).matchAll(/(?:tsx|node|ts-node)\s+(?:--\S+\s+)*([\w./-]+\.[cm]?[jt]sx?)/g)) {
        const p = relative(ROOT, resolve(join(ROOT, dirname(pkg)), m[1])).split("\\").join("/");
        // A build artifact is SUPPOSED to be absent from git — `start` runs `dist/index.js`,
        // which the build command produces on the deploy. Flagging it would put one
        // permanently wrong line in this report, and this file already argues that a
        // standing false positive is what teaches people to skim past the real ones.
        if (/(^|\/)(dist|build|out|\.next)\//.test(p)) continue;
        if (!shipped.has(p)) missingScripts.push(`${pkg} :: ${name} -> ${m[1]}`);
      }
    }
  }
  check(
    "no npm script runs a file that is missing from git",
    missingScripts.length === 0,
    missingScripts.join("\n")
  );

  console.log("\n--- the workflows that run them are shipped too ----------------------");
  /**
   * The scheduler lives outside the deployment on purpose — the free instance sleeps, so
   * an in-process timer stops. The cost of that decision is that nothing in the request
   * path can notice the workflow is absent: the product serves 200s and the passes simply
   * never run, which is the exact state "nothing read the clocks" describes.
   */
  const workflows = tracked.filter((f) => f.startsWith(".github/workflows/"));
  let onDisk: string[] = [];
  try {
    onDisk = execFileSync("ls", [join(ROOT, ".github", "workflows")], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    /* no workflows directory at all */
  }
  const unshippedWorkflows = onDisk.filter((f) => !workflows.includes(`.github/workflows/${f}`));
  check(
    `${workflows.length} workflow(s) shipped`,
    unshippedWorkflows.length === 0,
    unshippedWorkflows.map((f) => `.github/workflows/${f} — on this disk, absent from the deploy, so it is never scheduled`).join("\n")
  );

  console.log(`\n${"-".repeat(70)}\n  ${pass} passed, ${fail} failed`);
  console.log(
    fail
      ? "\n✗ What git holds would NOT build. `git add` the files above before deploying."
      : "\n✓ Everything the deploy needs is in git."
  );
  process.exit(fail ? 1 : 0);
}

main();
