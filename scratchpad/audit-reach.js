/**
 * The fourth audit: code that EXISTS and nothing reaches.
 *
 * `audit-fields.js` catches a column no UI can write. `audit-support-fields.js` catches a
 * setting no screen can set. `audit-styles.js` catches markup no stylesheet paints. This
 * catches the shape they all descend from — a complete, correct mechanism with nothing
 * feeding it — which is far and away this repo's most repeated bug:
 *
 *   - the desk stored agent replies and NOTHING DELIVERED THEM (no endpoint, no poller)
 *   - the shared KB review queue could be filled and never emptied
 *   - `createCannedReply` was written, gated and scoped, with zero callers
 *   - `changePassword` likewise, while `create-desk-user` printed "use the password
 *     change flow" at operators, pointing them at a screen that did not exist
 *   - `/portal/:slug` outlived its only caller by dozens of commits and became an
 *     unauthenticated oracle for the one secret the route beside it guards
 *
 * Every one of those was found by hand, months late, and each looked finished from both
 * ends. The middle is what nobody checks.
 *
 * TWO LEGS, both matched on IDENTIFIERS rather than URLs:
 *
 *   A. an `api.ts` export no screen in that app calls  — the `createCannedReply` shape
 *   B. an exported server symbol nothing else references — the `/portal` shape
 *
 * Each splits its findings in two, because "exported and used only inside its own file"
 * is a surplus `export` keyword (tidiness) while "referenced nowhere at all" is dead code
 * (a feature nobody can reach). Collapsing them would bury the second in the first: there
 * are 20 of the former and a handful of the latter.
 *
 * WHY THERE IS NO ROUTE-PATH LEG, deliberately.
 * "A server route no client calls" is the same question and reads like the obvious third
 * leg. It was built, measured, and thrown away: URL construction here spans template
 * literals (`${API_BASE}/admin/api/${a}/locations`), plain concatenation inside the
 * generated widget (`base() + "/conversation/" + id + "/updates"`), and computed final
 * segments (`users/${id}/${enabled ? "enable" : "disable"}`). Every idiom the matcher
 * does not model reports a live route as dead — 12 findings, 10 of them false. And at a
 * granularity coarse enough to avoid that, it stops seeing the actual bugs: a dead POST
 * sitting beside a live GET on one path is exactly how `createCannedReply` hid.
 *
 * A standing false positive destroys a report — this file's own history says so, and the
 * fix for `customCssOverride` in `audit-fields.js` is the precedent. Leg A catches that
 * bug class precisely, by name, so the path version buys noise and nothing else.
 */
const fs = require("fs");
const path = require("path");
const ROOT = "/Users/shaheerbutt/GHL theme builder";
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function sources(dir, exts = /\.tsx?$/) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (exts.test(e.name)) out.push(rel);
    }
  })(dir);
  return out;
}

/** Exported value declarations. Types and interfaces are contracts, not reachable code. */
const exportsOf = (src) =>
  [...src.matchAll(/^export (?:async function|function|const|class) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);

const mentions = (name, text) => new RegExp(`\\b${name}\\b`).test(text);

/**
 * Deliberate. Every entry carries its reason, so the list can be argued with rather than
 * merely obeyed — and so nobody silences a real finding by adding a line here.
 */
const EXPECTED = {
  "ssoDecrypt.decryptUserContext":
    "kept uncalled ON PURPOSE - it is the correct implementation for a LOCATION-level " +
    "surface, the one place GHL's SSO handshake works. Its header records what the old " +
    "caller got wrong so wiring it back up cannot reintroduce it.",
  "types.HOUSE_STYLE_NOTE":
    "documentation as code - the house style for KB articles, meant to be read next to " +
    "the type it annotates, not called.",
  "brandTerms.__brandMapCacheSize":
    "test seam - the leading underscores say so. The brand map's 60s cache has bitten " +
    "three suites; a way to see its size from a harness is worth an unused export.",
};

let findings = 0;
const report = (title, rows) => {
  if (!rows.length) return;
  console.log(`\n  ${title}`);
  for (const [name, where] of rows) console.log(`    ${name.padEnd(32)} ${where}`);
};

// ---- Leg A: an api.ts export no screen calls -------------------------------------
console.log("\nLEG A — client API wrappers");
for (const app of ["admin-dashboard", "support-desk"]) {
  const dir = `apps/${app}/src`;
  const files = sources(dir);
  const apiPath = `${dir}/api.ts`;
  const api = rd(apiPath);
  const others = files.filter((f) => f !== apiPath).map(rd).join("\n");
  const dead = [];
  const local = [];
  for (const name of exportsOf(api)) {
    if (mentions(name, others)) continue;
    // Used inside api.ts itself beyond its own declaration? Then it is live plumbing
    // (`clearSession` is called by `handle()` on a 401) and only the export is surplus.
    const uses = (api.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
    (uses > 1 ? local : dead).push([name, apiPath]);
  }
  findings += dead.length;
  console.log(`  ${app}: ${exportsOf(api).length} exports`);
  report("NO SCREEN CALLS IT — a feature nobody can reach:", dead);
  report("exported but only used inside api.ts — surplus `export`:", local);
}

// ---- Leg B: an exported server symbol nothing references --------------------------
console.log("\nLEG B — server modules");
const serverFiles = sources("apps/server/src");
// Harnesses count as callers: a symbol only a live check uses is still reachable, and
// several exist precisely so a suite can drive the thing the product drives.
const harnesses = sources("scratchpad", /\.(ts|js|mjs)$/).map(rd).join("\n");
const deadB = [];
const localB = [];
for (const f of serverFiles) {
  if (/\.test\.ts$/.test(f)) continue;
  const src = rd(f);
  const names = exportsOf(src);
  if (!names.length) continue;
  const others = serverFiles.filter((o) => o !== f).map(rd).join("\n") + "\n" + harnesses;
  const mod = path.basename(f, path.extname(f));
  for (const name of names) {
    if (EXPECTED[`${mod}.${name}`]) continue;
    if (mentions(name, others)) continue;
    const uses = (src.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
    (uses > 1 ? localB : deadB).push([name, f]);
  }
}
findings += deadB.length;
console.log(`  ${serverFiles.length} files scanned · ${Object.keys(EXPECTED).length} deliberate exemptions`);
report("REFERENCED NOWHERE — dead code:", deadB);
report(`exported but only used in its own file (${localB.length}) — surplus \`export\`, code is live:`, localB);

console.log(
  findings
    ? `\n${findings} unreachable symbol(s). Each is a mechanism with nothing feeding it — wire it up or delete it.\n`
    : "\nnothing unreachable: every API wrapper has a caller and every exported symbol has a reader.\n"
);
process.exit(findings ? 1 : 0);
