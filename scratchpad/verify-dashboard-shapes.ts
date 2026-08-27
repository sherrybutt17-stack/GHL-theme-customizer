/**
 * Does the wire shape match what the dashboard's TypeScript says it is?
 *
 * WHY THIS EXISTS. "Click Voice and wording and everything turns white" was
 * `SupportConfig.quickActions` — a nullable Json column served raw, while `api.ts`
 * declares `quickActions: string[]`. `ChipInput` called `.map` on null, React unmounted
 * the tree, and the whole dashboard went blank with nothing on screen saying why.
 *
 * TypeScript cannot catch this. Every response crosses the wire as `any` and is asserted
 * into its interface by `handle()`, so a declared type is a PROMISE the server makes and
 * nothing checks. `audit-fields.js` catches the opposite direction — a column the API
 * silently drops. This catches a field the API serves as the wrong SHAPE, which is worse
 * than a missing feature: it is a crash on a screen that worked yesterday.
 *
 * The check is narrow on purpose. It asserts only the fields the dashboard indexes into
 * without a guard (`.map`, `.length`, `Object.entries`) — those are the ones where null is
 * fatal rather than merely empty. Fields declared `| null` in api.ts are excluded, because
 * the components handling them already branch.
 *
 *   npx tsx scratchpad/verify-dashboard-shapes.ts
 */
import "../apps/server/src/services/loadEnv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prisma } from "../apps/server/src/services/prisma";

const BASE = process.env.BASE ?? "http://localhost:3210";
const API_TS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "admin-dashboard", "src", "api.ts");

/**
 * The field list is READ OUT OF `api.ts`, never hand-written here.
 *
 * Three times while writing this file I asserted a field the contract does not claim —
 * `presets[].hiddenFeatures` (presets are look-only by design) and `presets[].menuOrder`
 * (declared `string[] | null`, and the editor branches on it) — and each time the harness
 * reported a correct server as broken. A hand-kept copy of a contract drifts from it, and
 * a shape checker that mis-states the shape is worse than no checker: it sends you to fix
 * code that is right.
 *
 * So: parse the interfaces, and check exactly the fields declared as a NON-nullable array
 * or Record. Those are the ones a component may index into without a guard. Anything
 * declared `| null` or `?` is excluded, because the declaration itself tells the component
 * to branch — and every component that receives one does.
 */
function contractFields(iface: string, source?: string): { name: string; kind: "array" | "object" }[] {
  const src = source ?? readFileSync(API_TS, "utf8");
  const m = src.match(new RegExp(`export interface ${iface}(?:\\s+extends\\s+([^{]+))?\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`interface ${iface} not found in api.ts — this check is out of date`);
  // Inherited fields are part of the contract the component sees, so follow `extends`.
  // ThemeConfig gets hiddenFeatures/menuOrder from VisualTheme, and missing them would
  // make this check quietly weaker on the largest type in the file.
  const out: { name: string; kind: "array" | "object" }[] = m[1]
    ? m[1].split(",").flatMap((p) => contractFields(p.trim(), src))
    : [];
  /**
   * NESTING IS TRACKED, and it has to be.
   *
   * This scanned every line in the body with one regex and no idea of depth, so a field
   * inside an inline nested object was recorded as a TOP-LEVEL field of the interface.
   * `SupportStats.handoffTypes.types` therefore became a demand for `payload.types`, which
   * does not exist and never did — and the suite failed, in red, against a server that was
   * returning `{total: 2, untyped: 2, types: []}` exactly as declared.
   *
   * That is the fourth time this file has reported a correct server as broken, and the
   * header already says why it matters: a shape checker that mis-states the shape sends you
   * to fix code that is right. The other three were a hand-written field list; this one is
   * the parser, which is worse, because it will do it again to the next nested type
   * somebody adds.
   *
   * Nested fields are kept rather than dropped — they are real fields the dashboard maps
   * over — and emitted as the dotted path `collect` already understands, with `[]` inserted
   * when the enclosing literal closes as an ARRAY of objects (`}[];`), since then the rows
   * to check are its elements.
   */
  const stack: { name: string; children: { name: string; kind: "array" | "object" }[] }[] = [];
  const emit = (name: string, kind: "array" | "object") =>
    (stack.length ? stack[stack.length - 1].children : out).push({ name, kind });

  for (const line of m[2].split("\n")) {
    const open = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)(\??):\s*\{\s*$/);
    if (open) {
      // An optional or nullable container is not a promise, so nothing under it is either.
      stack.push({ name: open[2] === "?" ? "" : open[1], children: [] });
      continue;
    }
    const close = line.match(/^\s*\}(\[\])?\s*(\|\s*null\s*)?;?\s*$/);
    if (close && stack.length) {
      const frame = stack.pop()!;
      if (frame.name && !close[2]) {
        const prefix = frame.name + (close[1] ? ".[]" : "");
        for (const c of frame.children) emit(`${prefix}.${c.name}`, c.kind);
      }
      continue;
    }
    const f = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)(\??):\s*(.+?);\s*$/);
    if (!f) continue;
    const [, name, optional, type] = f;
    if (optional === "?" || /\|\s*null/.test(type)) continue;
    if (/\[\]$/.test(type)) emit(name, "array");
    else if (/^Record</.test(type)) emit(name, "object");
  }
  return out;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

/**
 * Walk a dotted path. `[]` means "every element of this array"; `$` means the response
 * body itself, because several of these endpoints return a BARE array rather than an
 * envelope — which the first version of this file got wrong and reported as five server
 * bugs. A shape check that mis-states the shape it is checking is worse than none.
 */
function collect(root: unknown, path: string): unknown[] {
  if (path === "$") return [root];
  let nodes: unknown[] = [root];
  for (const seg of path.split(".")) {
    const next: unknown[] = [];
    for (const n of nodes) {
      if (n == null) continue;
      if (seg === "[]") {
        if (Array.isArray(n)) next.push(...n);
      } else {
        next.push((n as Record<string, unknown>)[seg]);
      }
    }
    nodes = next;
  }
  return nodes;
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * `field` -> the kind the dashboard requires. "array" means something calls .map/.length
 * on it unguarded; "object" means something calls Object.entries/keys on it.
 *
 * An EMPTY array still passes — empty is the normal state and renders fine. Only null,
 * undefined and a non-array value are failures, because those are what crash.
 */
type Kind = "array" | "object";

/**
 * Check one interface's non-nullable array/Record fields against the rows the endpoint
 * actually returned. `at` locates those rows in the payload: "$" for a bare array body,
 * "config" for an envelope, "articles.[]" for a list inside one.
 */
function assertContract(label: string, payload: unknown, iface: string, at: string): void {
  const fields = contractFields(iface);
  if (fields.length === 0) {
    console.log(`  --    ${iface} declares no non-nullable array/Record fields`);
    return;
  }
  const spec: Record<string, Kind> = {};
  for (const f of fields) spec[at === "$" ? f.name : `${at}.${f.name}`] = f.kind;
  assertShape(`${label} (${iface})`, payload, spec);
}

function assertShape(label: string, payload: unknown, spec: Record<string, Kind>): void {
  for (const [path, kind] of Object.entries(spec)) {
    const found = collect(payload, path);
    if (found.length === 0) {
      // Nothing to check (e.g. no rows yet). Say so rather than passing silently — a
      // shape check over zero samples is the "passed for the wrong reason" trap.
      console.log(`  --    ${label}.${path} — no rows to check`);
      continue;
    }
    const bad = found.filter((v) => (kind === "array" ? !Array.isArray(v) : typeof v !== "object" || v === null || Array.isArray(v)));
    check(
      `${label}.${path} is ${kind} on every row (${found.length})`,
      bad.length === 0,
      `${bad.length} were ${bad.map((b) => (b === null ? "null" : typeof b)).join(", ")} — the dashboard will crash rendering this`
    );
  }
}

/**
 * THE PARSER CHECKS ITSELF FIRST.
 *
 * `contractFields` reporting the wrong shape is not a smaller failure than the server
 * returning one — it is a larger one, because it sends somebody to fix code that is right,
 * and this file's header records three occasions when a hand-kept field list did exactly
 * that. The nesting bug made it four, from the parser rather than the list.
 *
 * The `}[]` branch has no live example in `api.ts` — every array-of-objects there contains
 * only scalars — so it is exercised here against a synthetic interface instead. An
 * untested branch in a shape checker is how it mis-states a shape again.
 */
function selfTest(): void {
  console.log("--- the checker's own parser ----------------------------------------");
  const SRC = `
export interface Fixture {
  plain: string[];
  optionalArr?: string[];
  nullableArr: string[] | null;
  nested: {
    inner: string[];
    innerScalar: number;
  };
  rows: {
    perRow: string[];
  }[];
  optionalGroup?: {
    hidden: string[];
  };
  nullableGroup: {
    alsoHidden: string[];
  } | null;
  map: Record<string, string>;
}
`;
  const got = contractFields("Fixture", SRC).map((f) => `${f.name}:${f.kind}`).sort();
  const want = ["map:object", "nested.inner:array", "plain:array", "rows.[].perRow:array"].sort();
  check(
    "it reads nested and array-of-object fields at their real paths",
    JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`
  );
  check(
    "  ↳ and claims nothing about optional or nullable containers",
    !got.some((g) => /hidden/i.test(g)),
    "a field under an optional group is not a promise the server made"
  );
  console.log("");
}

async function main(): Promise<void> {
  selfTest();
  const agency = await prisma.agencyInstall.findFirst({ where: { status: "active" } });
  if (!agency) throw new Error("no active agency");
  const loc = await prisma.locationInstall.findFirst({
    where: { agencyInstallId: agency.id, status: "active" },
  });
  if (!loc) throw new Error("no active sub-account");
  const A = `/admin/api/${agency.id}`;

  console.log(`\nagency ${agency.id}\n`);

  console.log("--- the screen that broke -------------------------------------------");
  const support = await get(`${A}/support`);
  assertContract("support", support, "SupportConfig", "config");

  /**
   * The regression test proper. The bug was NOT "this agency happens to have quickActions
   * set" — it was that a stored row hands back whatever Prisma read, and the column is
   * nullable. Asserting the API returns [] while the ROW holds null is the only version of
   * this check that fails on the pre-fix code; reading the API alone would go green the
   * moment somebody saved a quick question.
   */
  const row = await prisma.supportConfig.findUnique({ where: { agencyInstallId: agency.id } });
  if (row && row.quickActions === null) {
    check(
      "a NULL quickActions column is normalised to [] before it reaches the browser",
      Array.isArray(support.config.quickActions),
      `column is null and the API returned ${JSON.stringify(support.config.quickActions)}`
    );
  } else {
    console.log("  --    quickActions is set on this agency — the null path is untested here");
  }

  console.log("\n--- every other screen ----------------------------------------------");
  const locations = await get(`${A}/locations`);
  check("locations is a bare array", Array.isArray(locations));
  assertContract("locations", locations, "LocationRow", "[]");
  assertContract("locations[].theme", locations, "ThemeConfig", "[].theme");

  const presets = await get(`${A}/presets`);
  check("presets is a bare array", Array.isArray(presets));
  assertContract("presets", presets, "ThemePreset", "[]");

  /**
   * A POSITIVE CONTROL. With no agency-authored articles, every KbArticle assertion
   * reports "no rows to check" and the suite goes green having checked nothing — the same
   * trap that made two checks in `verify-kb-review` pass for the wrong reason. So write
   * one, check its shape, and remove it.
   */
  let kb = await get(`${A}/kb`);
  let planted: string | null = null;
  if ((kb.articles ?? []).length === 0) {
    const made = await post(`${A}/kb`, {
      title: "Shape check — safe to delete",
      body: "A short article written only so the shape audit has a row to inspect. It names no vendor and carries no link.",
    });
    planted = made?.article?.id ?? made?.id ?? null;
    kb = await get(`${A}/kb`);
    check("the planted article is listed (positive control)", (kb.articles ?? []).length > 0);
  }
  assertContract("kb", kb, "KbArticle", "articles.[]");
  if (planted) {
    await fetch(`${BASE}${A}/kb/${planted}`, { method: "DELETE" });
    const after = await get(`${A}/kb`);
    check("the planted article is cleaned up", !(after.articles ?? []).some((a: any) => a.id === planted));
  }

  const feeds = await get(`${A}/kb/feeds`);
  assertContract("kb/feeds", feeds, "KbFeed", "feeds.[]");

  const stats = await get(`${A}/support/stats?days=30`);
  assertContract("support/stats", stats, "SupportStats", "$");

  const versions = await get(`${A}/locations/${loc.id}/theme/versions`);
  check("theme/versions is a bare array", Array.isArray(versions));

  const defaultVersions = await get(`${A}/default-theme/versions`);
  check("default-theme/versions is a bare array", Array.isArray(defaultVersions));

  /**
   * The dry run costs six real model calls, so it is the one screen nobody re-opens
   * casually — which makes it exactly the screen a shape bug would survive on.
   */
  console.log("\n--- dry run (real model calls) ---------------------------------------");
  const dry = await post(`${A}/support/dry-run`, { locationInstallId: loc.id });
  assertContract("dry-run", dry, "DryRunResponse", "$");
  assertContract("dry-run.results", dry, "DryRunResult", "results.[]");

  console.log(`\n${"-".repeat(68)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  });
