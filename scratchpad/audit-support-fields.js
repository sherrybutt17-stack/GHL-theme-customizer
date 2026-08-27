/**
 * The support-side twin of audit-fields.js.
 *
 * The theme audit exists because a column can look finished from every angle and be
 * dead: the schema has it, something reads it, and nothing can ever WRITE it. That is
 * how `brandName` and `faviconUrl` both shipped as done while being impossible to use.
 * Nothing equivalent covered the support half — which is now the larger half.
 *
 * For each column it asks three questions and prints only the ones that fail:
 *
 *   WRITE  — can any route or service put a value here? (a column nothing writes is a
 *            feature nobody can turn on)
 *   READ   — does anything consume it? (a column nothing reads is a field the UI asks
 *            an agency to fill in for no effect)
 *   UI     — is it reachable from a screen? (a column only settable by SQL is one only
 *            we can use, however well it works)
 *
 * A column can legitimately fail one of these — audit metadata is written and never
 * read, a token hash is written and never rendered — so EXPECTED lists the ones that
 * are deliberate, with the reason. Anything not on that list is a finding.
 */
const fs = require("fs");
const path = require("path");
const ROOT = "/Users/shaheerbutt/GHL theme builder";

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const readDir = (dir) =>
  fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => read(path.join(dir, f)))
    .join("\n");

/**
 * A source file containing a NUL byte is BINARY to grep, ripgrep and GitHub code
 * search — they skip it silently and report no matches, which reads as "that code
 * doesn't exist" rather than "your tool gave up". `kbIngest.ts` was in exactly this
 * state (a literal NUL used as a hash field separator, correct at runtime), so every
 * search across the module enforcing the KB's brand-safety guarantee came back empty.
 *
 * Checked here because this audit reads files directly and would otherwise be the one
 * tool that CAN see such a file — and therefore the one place the trap stays invisible.
 * Use the `\0` escape; it is the same byte at runtime and keeps the source text.
 */
function binarySourceFiles() {
  const roots = ["apps/server/src", "apps/admin-dashboard/src", "apps/support-desk/src"];
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && fs.readFileSync(path.join(ROOT, rel)).includes(0)) hits.push(rel);
    }
  };
  roots.forEach(walk);
  return hits;
}

const schema = read("apps/server/prisma/schema.prisma");
const serverRoutes = readDir("apps/server/src/routes");
const serverServices = readDir("apps/server/src/services");
const serverScripts = readDir("apps/server/src/scripts");
const dashboard = readDir("apps/admin-dashboard/src");
const desk = readDir("apps/support-desk/src");

const server = `${serverRoutes}\n${serverServices}\n${serverScripts}`;
const ui = `${dashboard}\n${desk}`;

/** Columns of a model, ignoring relations, block attributes and comments. */
function columns(model) {
  const body = schema.match(new RegExp(`model ${model} \\{([^]*?)\\n\\}`))?.[1] ?? "";
  const out = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@") || line.startsWith("/")) continue;
    const m = line.match(/^(\w+)\s+(\w+)/);
    if (!m) continue;
    const [, name, type] = m;
    // Relations are navigation, not data — a model name as the type gives it away.
    if (new RegExp(`model ${type} \\{`).test(schema)) continue;
    out.push(name);
  }
  return out;
}

/**
 * Written = it appears as an object key in something that reaches Prisma.
 *
 * `field:` is not enough — ES6 shorthand writes `{ contentHash, status }`, with no
 * colon in sight. Missing that reported `KbArticle.contentHash` as dead when it is
 * written on every ingest. Deliberately loose beyond that: a false "it is written" is
 * safer than a false alarm, because the report's whole value is that every line in it
 * is real.
 */
const written = (f) => new RegExp(`\\b${f}\\s*[,:}\\n]`).test(server);

/** Read = referenced off an object, or selected explicitly. */
const readSomewhere = (f) =>
  new RegExp(`\\.${f}\\b`).test(server) || new RegExp(`\\b${f}\\s*:\\s*true`).test(server);

const inUi = (f) => new RegExp(`\\b${f}\\b`).test(ui);
/**
 * For a FORM model the only surface that counts is the agency's own settings SCREENS —
 * not `api.ts`, and not the desk.
 *
 * The desk displays several of these (the brand banner reads `forbiddenTerms`), and
 * treating a read-only display as "reachable" is how a setting nobody can change reads as
 * settable. `api.ts` is worse: it is a type declaration, so adding one line there would
 * satisfy this check while leaving the column exactly as unreachable as before — the
 * audit would then certify the very bug it is looking for. `audit-fields.js` reads
 * `ThemeEditor.tsx` + `LookFields.tsx` for precisely this reason; this is the same list
 * for the support half.
 */
const settingsScreens = [
  "SupportSettings.tsx",
  "SupportKnowledge.tsx",
  // The locations table hosts the per-sub-account Plan input: `planTiers` is one map on
  // the agency's config but a per-sub-account FACT, so it belongs in the row beside the
  // Support toggle rather than behind a modal. A screen that really does host a control
  // has to be on this list — omitting one produces a standing false positive, and this
  // file's own history says what that costs: the reader learns to skim the report.
  //
  // Checked before adding it: of every SupportConfig column, App.tsx matches only
  // `agencyInstallId` (already EXPECTED) and `planTiers` itself, so it masks nothing.
  "App.tsx",
]
  .map((f) => read(`apps/admin-dashboard/src/${f}`))
  .join("\n");
const inSettingsUi = (f) => new RegExp(`\\b${f}\\b`).test(settingsScreens);

/**
 * Models that are a FORM, where every column is something an agency is meant to set.
 *
 * These get a STRICTER rule, and the reason is the whole point of this script. The
 * general rule below needs two failed legs, on the argument that one is usually internal
 * plumbing — true for `Conversation` and `DeskUser`, which are machinery. It is exactly
 * backwards for a settings model: `faviconUrl`, the agency-level `brandName` and
 * `slaFirstResponseMins` were each written by the server, read by the server, and
 * unreachable from any screen. That is ONE failed leg, so the two-leg rule scored every
 * one of them as healthy — this audit ran clean over the third while it was live.
 *
 * `audit-fields.js` never had this hole: it reports "API won't accept it" on its own.
 * The support twin generalised the shape and lost the asymmetry that made it work.
 */
const FORM_MODELS = new Set(["SupportConfig"]);

/**
 * Columns that fail a check ON PURPOSE. Every entry needs a reason, so this list can
 * be argued with rather than merely obeyed.
 */
const EXPECTED = {
  "SupportConfig.id": "primary key",
  "SupportConfig.agencyInstallId": "scoping key, set from the route param",
  "SupportConfig.createdAt": "timestamp",
  "SupportConfig.updatedAt": "timestamp",
  "Conversation.id": "primary key",
  "Conversation.createdAt": "timestamp",
  "Conversation.accessTokenHash": "written and matched, never rendered - that is the point",
  "Conversation.startedAt": "set by default(now())",
  "DeskUser.id": "primary key",
  "DeskUser.createdAt": "timestamp",
  "DeskUser.updatedAt": "timestamp",
  "DeskUser.passwordHash": "written and verified, never rendered - that is the point",
  "KbArticle.id": "primary key",
  "KbArticle.createdAt": "timestamp",
  "KbArticle.updatedAt": "timestamp",
  "KbArticle.searchVector": "GENERATED column, written by Postgres and queried in raw SQL",
  "KbFeed.id": "primary key",
  "KbFeed.createdAt": "timestamp",
  "KbFeed.updatedAt": "timestamp",
  "LocationInstall.id": "primary key",
};

const MODELS = ["SupportConfig", "Conversation", "DeskUser", "KbArticle", "KbFeed"];

let checked = 0;
const findings = [];
for (const model of MODELS) {
  for (const f of columns(model)) {
    checked++;
    const key = `${model}.${f}`;
    if (EXPECTED[key]) continue;
    const missing = [
      !written(f) && "nothing writes it",
      !readSomewhere(f) && "nothing reads it",
      !inUi(f) && "no UI reaches it",
    ].filter(Boolean);
    // One missing leg is often fine (internal plumbing); TWO means it is inert.
    if (missing.length >= 2) {
      findings.push({ key, missing });
    } else if (FORM_MODELS.has(model) && !inSettingsUi(f)) {
      // A settings column no agency screen can reach is the single-leg failure this
      // script exists for, and the one the general rule cannot see.
      findings.push({ key, missing: ["the agency's dashboard cannot set it"] });
    }
  }
}

const binaries = binarySourceFiles();
if (binaries.length) {
  console.log("\n  ⚠ INVISIBLE TO GREP — these source files contain a NUL byte, so every");
  console.log("    code search silently skips them. Replace the byte with a \\0 escape.");
  for (const f of binaries) console.log(`      ${f}`);
}

console.log(`\nchecked ${checked} columns across ${MODELS.length} support models\n`);
if (!findings.length) {
  console.log("  every support column is writable, read, and reachable.");
} else {
  for (const f of findings) console.log(`  ${f.key}`.padEnd(44), f.missing.join(" · "));
}
console.log();
