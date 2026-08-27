/**
 * "Restore" has to restore everything, and it silently did not.
 *
 * There is no per-location restore ROUTE: the History tab loads an old version back into the
 * form and Save writes a new one, which is a good design — history stays append-only and a
 * restore is itself an auditable version. It also means `loadVersion` and the save payload
 * are TWO LISTS OF THE SAME FIELDS, forty lines apart, and any field on one and not the other
 * is silently not restored.
 *
 * `faviconUrl` was on the save list and not the load list. So restoring version 12 gave you
 * version 12's colours, brand name, logo, renames, hidden features, menu order, custom CSS
 * and banner — and TODAY's favicon, written over the top on save. A favicon set in an older
 * version was unreachable from history, which is the only place it could have come back
 * from. Third time this file records that exact column: it shipped with neither half built,
 * then with the API silently dropping it, and now with history unable to return it.
 *
 * Driven in a real browser against a THROWAWAY agency — the dashboard is per-agency, so the
 * fixtures need one of their own rather than 30 more versions on somebody's real client.
 *
 *   npx tsx scratchpad/verify-history-restore.ts
 */
import "../apps/server/src/services/loadEnv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3210";
const DASH = process.env.DASH_BASE ?? "http://localhost:5173";
const p = new PrismaClient();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`); }
}

/* ------------------------------------------------------------------ browser */
async function pageTarget(): Promise<any> {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const found = (list as any[]).find((t) => t.type === "page");
  if (found) return found;
  return await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
}
let ws: WebSocket;
let msgId = 0;
const pending = new Map<number, (m: any) => void>();
async function connect(): Promise<void> {
  const page = await pageTarget();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r as any));
  ws.onmessage = (e: any) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  };
}
const send = (method: string, params: any = {}) =>
  new Promise<any>((res, rej) => {
    const n = ++msgId;
    pending.set(n, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HELP = 'const byText=(s,re)=>[...document.querySelectorAll(s)].find(e=>re.test((e.textContent||"").trim()));';
async function ev(body: string): Promise<any> {
  const r = await send("Runtime.evaluate", { expression: "(()=>{" + HELP + body + "})()", returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
}

/* ------------------------------------------------------------------ fixtures */
const STAMP = Date.now();
const made = { agencyId: "" };
async function teardown(): Promise<void> {
  if (!made.agencyId) return;
  await p.agencyDefaultThemeVersion.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.themeConfig.deleteMany({ where: { locationInstall: { agencyInstallId: made.agencyId } } });
  await p.locationInstall.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.agencyInstall.deleteMany({ where: { id: made.agencyId } });
  made.agencyId = "";
  console.log("\ncleanup: throwaway agency removed");
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig as any, () => { teardown().finally(() => process.exit(130)); });
}

const OLD = {
  brandName: "Harbour Suite",
  primaryColor: "#0f766e",
  faviconUrl: "https://example.com/old-" + STAMP + ".ico",
  alertMessage: "The old banner",
  customCss: ".old { color: red }",
  sidebarImageUrl: "https://example.com/old-side.png",
  hideUpgrade: true,
  hiddenFeatures: ["memberships"],
  menuLabelOverrides: { opportunities: "Deals" },
  menuOrder: ["contacts", "calendars"],
};
const NEW = {
  brandName: "Beta Hub",
  primaryColor: "#7c3aed",
  faviconUrl: "https://example.com/new-" + STAMP + ".ico",
  alertMessage: "The new banner",
  customCss: ".new { color: blue }",
  sidebarImageUrl: "https://example.com/new-side.png",
  hideUpgrade: false,
  hiddenFeatures: ["payments"],
  menuLabelOverrides: { contacts: "People" },
  menuOrder: ["calendars", "contacts"],
};

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(BASE + "/admin/api/" + made.agencyId + path, {
    method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(method + " " + path + " -> " + r.status + " " + (await r.text()).slice(0, 200));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function main(): Promise<void> {
  await connect();

  /* ---------------------------------------------------------- the structural half */
  console.log("\n== every field Save WRITES, the History tab must be able to load ==");
  /**
   * The two lists are in one file forty lines apart, and nothing connected them. This reads
   * the save payload's keys out of the source and requires each to be read from the version
   * row inside `loadVersion` — so the NEXT field cannot be forgotten the same way.
   */
  const src = readFileSync(join(__dirname, "..", "apps", "admin-dashboard", "src", "ThemeEditor.tsx"), "utf8");
  const loadBody = src.slice(src.indexOf("function loadVersion("), src.indexOf("function mainFeaturesInOrder("));
  const payload = src.slice(src.indexOf("await onSave({"), src.indexOf("} catch (e) {", src.indexOf("await onSave({")));
  const keys = [...payload.matchAll(/^\s{8}(\w+)[,:]/gm)].map((m) => m[1]);
  check("the save payload was found and parsed", keys.length > 15, keys.join(","));

  /**
   * Covered by `lookFrom(v)`, which loadVersion calls with the version row.
   *
   * READ OUT OF `LookFields.tsx`, not hand-listed. It WAS hand-listed, and the copy drifted
   * the first time a field was added to `Look` — the content-area colours went into the save
   * payload and into `lookFrom`, and this list did not, so the suite reported a working
   * restore as broken and sent me to fix code that was already right. That is the same
   * hand-kept-copy-of-a-contract failure `verify-dashboard-shapes` records three times over,
   * arriving inside the harness written to catch it.
   */
  const lookSrc = readFileSync(join(__dirname, "..", "apps", "admin-dashboard", "src", "LookFields.tsx"), "utf8");
  const lookBody = lookSrc.match(/export interface Look \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const LOOK = new Set([...lookBody.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]));
  // A positive control: an empty or mis-parsed set would exempt NOTHING and the check
  // below would fail loudly — but a set that swallowed the whole file would exempt
  // everything and pass having checked nothing.
  check(
    "the Look interface was parsed, not guessed",
    LOOK.size >= 10 && LOOK.size <= 40 && LOOK.has("primaryColor") && !LOOK.has("brandName"),
    `${LOOK.size} fields: ${[...LOOK].join(",")}`
  );

  const EXEMPT = new Set(["secondaryColor"]);
  const ALIAS: Record<string, string> = { customCss: "customCssOverride" };
  const missing = keys.filter(
    (k) =>
      !LOOK.has(k) && !EXEMPT.has(k) && !k.startsWith("login") &&
      !loadBody.includes("v." + (ALIAS[k] ?? k))
  );
  check(
    `all ${keys.length} saved fields are restorable`,
    missing.length === 0,
    "loadVersion never reads: " + missing.join(", ") + " — restoring an old version keeps TODAY's value for these and writes it over the top on save"
  );
  check("…and the Look fields come from the version too", loadBody.includes("lookFrom(v)"));

  /* ---------------------------------------------------------- the live half */
  const agency = await p.agencyInstall.create({
    data: {
      ghlCompanyId: "history-" + STAMP,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "History Restore Probe",
    },
  });
  made.agencyId = agency.id;
  const loc = await p.locationInstall.create({
    data: {
      agencyInstallId: agency.id, ghlLocationId: "history-" + STAMP,
      status: "active", enabled: true, locationName: "Zeta Client",
    },
  });
  await api("PUT", "/locations/" + loc.id + "/theme", OLD);
  await api("PUT", "/locations/" + loc.id + "/theme", NEW);
  const versions = await p.themeConfig.findMany({ where: { locationInstallId: loc.id }, orderBy: { version: "desc" } });
  check("two versions exist to choose between", versions.length === 2, versions.length);

  console.log("\n== loading the older version puts ITS values in the form ==");
  await send("Page.navigate", { url: DASH + "/" + made.agencyId });
  await sleep(3500);
  const rows = await ev('return document.querySelectorAll("tbody tr").length');
  if (rows === 0) throw new Error("the dashboard rendered zero sub-accounts — is the API up?");

  const opened = await ev(`
    const b = byText("tbody tr button", /^Edit$/);
    if (!b) return false; b.click(); return true;
  `);
  check("the editor opens", opened === true);
  await sleep(1200);
  const onHistory = await ev(`
    const t = byText(".modal-lg button", /^History$/i);
    if (!t) return false; t.click(); return true;
  `);
  check("the History tab opens", onHistory === true);
  await sleep(1200);

  const listed = await ev('return document.querySelectorAll(".version-row").length');
  check("both versions are listed", listed === 2, listed);

  // The second row is the OLDER version; the first is "View current".
  await ev(`
    const rows = [...document.querySelectorAll(".version-row")];
    const b = rows[1] && [...rows[1].querySelectorAll("button")].find(x => /View/.test(x.textContent||""));
    if (b) b.click();
    return !!b;
  `);
  await sleep(900);

  /**
   * The banner lives on the Advanced tab and `loadVersion` lands on Branding, so the second
   * control needs a tab switch to be readable — which also proves the loaded values survive
   * one, rather than only existing on the tab that happened to be open.
   */
  await ev(`const t = byText(".modal-lg button", /^Advanced$/i); if (t) t.click(); return !!t;`);
  await sleep(500);
  const alertVal = await ev(`
    const f = [...document.querySelectorAll(".modal-lg .field")].find(d => /account alert banner/i.test((d.querySelector("label")||{}).textContent||""));
    return f ? ((f.querySelector("input,textarea")||{}).value ?? null) : null;
  `);
  await ev(`const t = byText(".modal-lg button", /^Branding/i); if (t) t.click(); return !!t;`);
  await sleep(500);

  const form = await ev(`
    const val = (sel) => { const e = document.querySelector(sel); return e ? e.value : null; };
    const byLabel = (re) => {
      const f = [...document.querySelectorAll(".modal-lg .field")].find(d => re.test((d.querySelector("label")||{}).textContent||""));
      return f ? (f.querySelector("input,textarea")||{}).value ?? null : null;
    };
    return {
      brandName: byLabel(/brand name/i),
      favicon: byLabel(/tab icon|favicon/i),

      previewing: (document.querySelector(".version-banner, .modal-lg .warn, .modal-lg .amber") || {}).textContent || null,
    };
  `);
  console.log("        form after loading the old version:", JSON.stringify(form));
  check("the brand name is the old one", form.brandName === OLD.brandName, form.brandName);
  /**
   * A second control, on a different tab from the favicon, so "the form reloaded at all" and
   * "this particular field reloaded" cannot be confused — the shape that let the favicon
   * hide behind everything else looking right.
   */
  check("the banner is the old one", alertVal === OLD.alertMessage, alertVal);
  check(
    "the FAVICON is the old one",
    form.favicon === OLD.faviconUrl,
    "the form shows " + JSON.stringify(form.favicon) + ", not " + JSON.stringify(OLD.faviconUrl) +
      " — saving now would write today's favicon over the version being restored"
  );

  /* ------------------------------------------------ the OTHER history list */
  /**
   * There are TWO history lists in that one file, and they had different ideas of what a
   * version with no colours looks like. This one is the agency default — the row CLAUDE.md
   * calls the largest blast radius in the product, since it styles every sub-account at
   * once — and it had never been rendered with data: this database holds ZERO
   * `AgencyDefaultThemeVersion` rows.
   *
   * The cases below are what real rows look like. Measured on the newest per-location
   * versions here: every one carries a brand name and NOT ONE carries a colour, so "no
   * colours" is not an edge case, it is the ordinary row.
   */
  console.log("\n== the agency-default history says the same things about a look ==");
  const CASES = [
    { reason: "nothing set", snapshot: { brandName: "No Colours" }, swatches: 0 },
    { reason: "primary only", snapshot: { brandName: "One Colour", primaryColor: "#0f766e" }, swatches: 1 },
    { reason: "all three", snapshot: { brandName: "Three Colours", primaryColor: "#0f766e", accentColor: "#14b8a6", topBarColor: "#1e293b" }, swatches: 3 },
    // A CLEARED field is stored as "" by the editor. `??` let it through and produced
    // `linear-gradient(135deg, , )` — invalid, so the parser drops it and the row shows an
    // unexplained blank box rather than saying nothing.
    { reason: "cleared", snapshot: { brandName: "Cleared", primaryColor: "", accentColor: "" }, swatches: 0 },
  ];
  for (const [i, c] of CASES.entries()) {
    await p.agencyDefaultThemeVersion.create({
      data: {
        agencyInstallId: made.agencyId,
        reason: c.reason,
        snapshot: c.snapshot as any,
        createdAt: new Date(Date.now() - (CASES.length - i) * 60_000),
      },
    });
  }
  const defaultRows = await api("GET", "/default-theme/versions");
  check("the endpoint lists them", Array.isArray(defaultRows) && defaultRows.length === CASES.length, JSON.stringify(defaultRows?.length));
  check(
    "…and carries the THIRD colour, so one renderer can serve both lists",
    defaultRows.some((r: any) => r.topBarColor === "#1e293b"),
    JSON.stringify(defaultRows.map((r: any) => r.topBarColor))
  );

  // Close the editor and open the AGENCY DEFAULT one, which is where this list lives.
  await ev(`const c = byText(".modal-lg .modal-footer button, .modal-lg button", /^(cancel|close)$/i); if (c) c.click(); return !!c;`);
  await sleep(700);
  await ev(`const d = [...document.querySelectorAll("button")].find(b => /discard/i.test(b.textContent||"")); if (d) d.click(); return !!d;`);
  await sleep(900);
  const openedDefault = await ev(`const b = byText("button", /agency default/i); if (!b) return false; b.click(); return true;`);
  check("the agency-default editor opens", openedDefault === true);
  await sleep(1800);
  const onHistory2 = await ev(`const t = byText(".modal-lg button", /^History$/i); if (!t) return false; t.click(); return true;`);
  check("its History tab opens", onHistory2 === true);
  await sleep(1200);

  const read = await ev(`
    return [...document.querySelectorAll(".version-row")].map(r => ({
      title: ((r.querySelector(".version-title")||{}).textContent||"").trim(),
      date: ((r.querySelector(".version-date")||{}).textContent||"").trim(),
      swatches: [...r.querySelectorAll(".version-swatch")].map(sw => getComputedStyle(sw).backgroundColor),
      images: [...r.querySelectorAll(".version-swatch")].map(sw => getComputedStyle(sw).backgroundImage),
    }));
  `);
  console.log("        agency-default rows:", JSON.stringify(read, null, 1));
  check("every planted version is listed", read.length === CASES.length, read.length);

  for (const c of CASES) {
    const row = read.find((r: any) => r.date.includes(c.reason));
    check(
      `"${c.reason}" shows ${c.swatches} swatch(es)`,
      !!row && row.swatches.length === c.swatches,
      row ? `${row.swatches.length}: ${JSON.stringify(row.swatches)}` : "row not found"
    );
    if (row && c.swatches === 0) {
      // The two ways this went wrong: an invented grey, and an invalid gradient that the
      // parser drops leaving an unexplained empty box. Neither can happen if nothing renders.
      check(`  -> and nothing grey is invented for it`, row.images.every((i: string) => i === "none"), JSON.stringify(row.images));
    }
  }

  /* the structural half: one renderer, not two */
  const editorSrc = readFileSync(join(__dirname, "..", "apps", "admin-dashboard", "src", "ThemeEditor.tsx"), "utf8");
  const code = editorSrc.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check(
    "only ONE place renders a version swatch",
    (code.match(/className="version-swatch"/g) ?? []).length === 1,
    (code.match(/className="version-swatch"/g) ?? []).length + " places"
  );
  check("…and no placeholder colour is left in the file", !/#cbd5e1/i.test(code), code.match(/.{0,60}#cbd5e1/i)?.[0]);
  check("…and both lists read it", (code.match(/<VersionSwatches/g) ?? []).length === 2, (code.match(/<VersionSwatches/g) ?? []).length);

  console.log("\n" + "-".repeat(70) + "\n  " + pass + " passed, " + fail + " failed");
}

main()
  .catch((e) => { console.error("\nERROR:", e); fail++; })
  .finally(async () => {
    await teardown(); await p.$disconnect();
    try { ws?.close(); } catch {}
    process.exit(fail ? 1 : 0);
  });
