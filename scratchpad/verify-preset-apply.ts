/**
 * Applying a preset — the one action in this product that rewrites MANY clients' themes at
 * once, and the only one with two implementations.
 *
 *   the editor  (one sub-account)  `applyPreset` in ThemeEditor.tsx
 *   the toolbar (many)             POST /admin/api/:agency/presets/:id/apply
 *
 * Two definitions of one fact is this repo's most repeated bug, and here the two carry
 * comments that CONTRADICT each other about the same field — the server's says menu order
 * is "structural, not part of a color preset", the editor's says "presets can carry a saved
 * sidebar order; apply it if present".
 *
 * Fixtures are a throwaway agency of its own: this writes theme versions, and CLAUDE.md
 * records `verify-desk` leaving a real sub-account at version 30 by doing exactly that.
 *
 *   npx tsx scratchpad/verify-preset-apply.ts
 */
import "../apps/server/src/services/loadEnv";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3210";
const p = new PrismaClient();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`); }
}

const made = { agencyId: "" };
async function teardown(): Promise<void> {
  if (!made.agencyId) return;
  await p.themeConfig.deleteMany({ where: { locationInstall: { agencyInstallId: made.agencyId } } });
  await p.themePreset.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.locationInstall.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.agencyInstall.deleteMany({ where: { id: made.agencyId } });
  made.agencyId = "";
  console.log("\ncleanup: throwaway agency removed");
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig as any, () => { teardown().finally(() => process.exit(130)); });
}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(BASE + "/admin/api/" + made.agencyId + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(method + " " + path + " -> " + r.status + " " + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

/** The theme a real client has: their identity, their policy, their banner, their order. */
const CLIENT_THEME = {
  brandName: "Harbour Suite",
  logoUrl: "data:image/png;base64,iVBORw0KGgo=",
  faviconUrl: "https://example.com/f.ico",
  primaryColor: "#0f766e",
  accentColor: "#14b8a6",
  alertMessage: "Scheduled maintenance this Saturday",
  alertColor: "#b45309",
  // The PUT reads `customCss`; the COLUMN is `customCssOverride`. The alias is documented
  // (`audit-fields.js` knows about it) and a harness that sends the column name stores
  // nothing, then reports the bulk apply for losing what was never there.
  customCss: ".hl_nav { letter-spacing: .02em }",
  hiddenFeatures: ["memberships"],
  menuLabelOverrides: { opportunities: "Deals" },
  menuOrder: ["contacts", "conversations", "calendars"],
  hideUpgrade: true,
  sidebarImageUrl: "https://example.com/s.png",
};

async function main(): Promise<void> {
  const agency = await p.agencyInstall.create({
    data: {
      ghlCompanyId: "presetcheck-" + Date.now(),
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "Preset Apply Probe",
    },
  });
  made.agencyId = agency.id;
  const loc = await p.locationInstall.create({
    data: {
      agencyInstallId: agency.id,
      ghlLocationId: "presetcheck-" + Date.now(),
      status: "active", enabled: true, locationName: "Client A",
    },
  });

  await api("PUT", "/locations/" + loc.id + "/theme", CLIENT_THEME);
  const before = await p.themeConfig.findFirst({
    where: { locationInstallId: loc.id }, orderBy: { version: "desc" },
  });
  check("the client's theme stored", before?.alertMessage === CLIENT_THEME.alertMessage, before?.alertMessage);
  check("…including their custom CSS", before?.customCssOverride === CLIENT_THEME.customCss, before?.customCssOverride);
  check("…including their menu order", JSON.stringify(before?.menuOrder) === JSON.stringify(CLIENT_THEME.menuOrder), JSON.stringify(before?.menuOrder));

  /**
   * A preset saved from a sub-account that was never reordered. The editor sends
   * `{...look, menuOrder}` unconditionally, so this is the ORDINARY preset — the one an
   * agency makes by opening any client, picking colours, and pressing "Save as preset".
   */
  const plain = await api("POST", "/presets", {
    name: "House Colours", primaryColor: "#4f46e5", accentColor: "#f59e0b", menuOrder: [],
  });
  console.log("\n== a preset saved with no menu order ==");
  check(
    "does not claim to carry one",
    plain.menuOrder === null || (Array.isArray(plain.menuOrder) && plain.menuOrder.length === 0),
    JSON.stringify(plain.menuOrder)
  );
  check(
    "…and an EMPTY order is not stored as an instruction to clear",
    plain.menuOrder === null,
    "stored " + JSON.stringify(plain.menuOrder) + " — the editor reads any array as 'apply this', so [] wipes the sub-account's own order"
  );

  console.log("\n== applying it in BULK keeps what the client owns ==");
  await api("POST", "/presets/" + plain.id + "/apply", { locationInstallIds: [loc.id] });
  const after = await p.themeConfig.findFirst({
    where: { locationInstallId: loc.id }, orderBy: { version: "desc" },
  });
  for (const [label, key] of [
    ["their brand name", "brandName"],
    ["their logo", "logoUrl"],
    ["their favicon", "faviconUrl"],

    ["their sidebar image", "sidebarImageUrl"],
    ["their announcement banner", "alertMessage"],
    ["…and its colour", "alertColor"],
  ] as [string, keyof typeof CLIENT_THEME][]) {
    check(
      "keeps " + label,
      (after as any)?.[key] === (CLIENT_THEME as any)[key],
      "was " + JSON.stringify((CLIENT_THEME as any)[key]) + ", now " + JSON.stringify((after as any)?.[key])
    );
  }
  check("keeps their custom CSS", after?.customCssOverride === CLIENT_THEME.customCss, JSON.stringify(after?.customCssOverride));
  check("keeps their hidden features", JSON.stringify(after?.hiddenFeatures) === JSON.stringify(CLIENT_THEME.hiddenFeatures), JSON.stringify(after?.hiddenFeatures));
  check("keeps their renamed labels", JSON.stringify(after?.menuLabelOverrides) === JSON.stringify(CLIENT_THEME.menuLabelOverrides), JSON.stringify(after?.menuLabelOverrides));
  check("keeps their menu order", JSON.stringify(after?.menuOrder) === JSON.stringify(CLIENT_THEME.menuOrder), JSON.stringify(after?.menuOrder));
  check("overlays the preset's colours", after?.primaryColor === "#4f46e5", after?.primaryColor);

  console.log("\n== a preset that really DOES carry an order ==");
  /**
   * The two paths must agree. Whichever answer is right, "the editor reorders and the
   * toolbar does not" cannot be — an agency cannot see both screens at once, and the
   * toolbar is the door they use for forty-one clients.
   */
  const ordered = await api("POST", "/presets", {
    name: "Ordered", primaryColor: "#111111", menuOrder: ["calendars", "contacts"],
  });
  check("stores the order it was given", JSON.stringify(ordered.menuOrder) === JSON.stringify(["calendars", "contacts"]), JSON.stringify(ordered.menuOrder));
  await api("POST", "/presets/" + ordered.id + "/apply", { locationInstallIds: [loc.id] });
  const after2 = await p.themeConfig.findFirst({
    where: { locationInstallId: loc.id }, orderBy: { version: "desc" },
  });
  check(
    "bulk apply honours it, exactly as the editor does",
    JSON.stringify(after2?.menuOrder) === JSON.stringify(["calendars", "contacts"]),
    "the toolbar left the order at " + JSON.stringify(after2?.menuOrder) + " while the editor would have set it"
  );
  check("and still keeps the banner", after2?.alertMessage === CLIENT_THEME.alertMessage, after2?.alertMessage);

  console.log("\n== a preset ALREADY holding an empty order, written before the fix ==");
  /**
   * There is no backfill and there should not be: the rows are harmless once both readers
   * agree that an empty array is not an order. Planted directly, because that is the shape
   * every preset saved until now is in.
   */
  const legacy = await p.themePreset.create({
    data: { agencyInstallId: made.agencyId, name: "Legacy", primaryColor: "#222222", menuOrder: [] },
  });
  await api("POST", "/presets/" + legacy.id + "/apply", { locationInstallIds: [loc.id] });
  const after3 = await p.themeConfig.findFirst({
    where: { locationInstallId: loc.id }, orderBy: { version: "desc" },
  });
  check(
    "an old preset's empty order does not wipe the sub-account's",
    JSON.stringify(after3?.menuOrder) === JSON.stringify(["calendars", "contacts"]),
    JSON.stringify(after3?.menuOrder)
  );
  check("and the banner is still there", after3?.alertMessage === CLIENT_THEME.alertMessage, after3?.alertMessage);

  console.log("\n== Reset deletes the HISTORY too, and now says so ==");
  /**
   * `AgencyDefaultThemeVersion` exists because the agency default "had the smallest safety
   * net, while a single sub-account's theme has a full History tab". The sub-account's own
   * Reset button deletes that net: `themeConfig.deleteMany` takes every version, not the
   * current one. Measured on the dev database, two real sub-accounts were carrying 30 and
   * 28 versions behind a confirm reading only "its custom theme will be removed".
   *
   * Not changed — a blank version is NOT the same as no version (the stylesheet would then
   * paint the default primary instead of letting the sub-account inherit the agency
   * default), so the delete is right and the DIALOG was the thing that was wrong.
   */
  const listBefore = await api("GET", "/locations");
  const row = listBefore.find((l: any) => l.id === loc.id);
  const realVersions = await p.themeConfig.count({ where: { locationInstallId: loc.id } });
  check("the listing reports how much history a sub-account has", row?.themeVersions === realVersions, `${row?.themeVersions} vs ${realVersions}`);
  check("…and there is more than one, so the dialog has something to warn about", realVersions > 1, realVersions);
  const reset = await api("DELETE", "/locations/" + loc.id + "/theme");
  check("reset reports what it removed", reset?.versionsDeleted === realVersions, JSON.stringify(reset));
  check("every version really is gone", (await p.themeConfig.count({ where: { locationInstallId: loc.id } })) === 0);
  const listAfter = await api("GET", "/locations");
  check("and the listing agrees", listAfter.find((l: any) => l.id === loc.id)?.themeVersions === 0);

  // Put a theme back so the checks below still have one to work on.
  await api("PUT", "/locations/" + loc.id + "/theme", CLIENT_THEME);

  console.log("\n== a PARTIAL save does not clear what it never mentioned ==");
  /**
   * The theme PUT already carried client-owned fields forward for any key the body OMITS,
   * "so a partial PATCH from some other client can't silently null out the logo, hidden
   * features, labels, or order" — and the banner was not on that list either, for the same
   * reason it was missing from the preset route: it is the newest thing on the model and
   * neither list was rechecked when it arrived.
   */
  await api("PUT", "/locations/" + loc.id + "/theme", { primaryColor: "#654321" });
  const partial = await p.themeConfig.findFirst({
    where: { locationInstallId: loc.id }, orderBy: { version: "desc" },
  });
  check("a save that omits the banner keeps it", partial?.alertMessage === CLIENT_THEME.alertMessage, partial?.alertMessage);
  check("…and its colour", partial?.alertColor === CLIENT_THEME.alertColor, partial?.alertColor);
  check("while the field it DID send is applied", partial?.primaryColor === "#654321", partial?.primaryColor);
  check("and an explicit empty string still clears it", 
    (await (async () => {
      await api("PUT", "/locations/" + loc.id + "/theme", { primaryColor: "#654321", alertMessage: "" });
      const r = await p.themeConfig.findFirst({ where: { locationInstallId: loc.id }, orderBy: { version: "desc" } });
      return r?.alertMessage;
    })()) === null
  );

  console.log("\n== …and the editor's half agrees, in its own source ==");
  /**
   * `ThemeEditor.applyPreset` only sets local state, so nothing here can drive it — and the
   * `slaTone` precedent's limit applies: this proves the CONDITION, not the pixels. Worth
   * having anyway, because the whole defect was the two halves reading the same field by
   * different rules, and the server can no longer STORE an empty order but the presets
   * written before today still hold one.
   */
  {
    const src = readFileSync(join(__dirname, "..", "apps", "admin-dashboard", "src", "ThemeEditor.tsx"), "utf8");
    const line = src.split("\n").find((l) => l.includes("setMenuOrder(p.menuOrder"));
    check(
      "the editor requires a NON-EMPTY order before applying one",
      !!line && /\.length > 0/.test(line),
      line?.trim()
    );
    const app = readFileSync(join(__dirname, "..", "apps", "admin-dashboard", "src", "App.tsx"), "utf8");
    check(
      "and the toolbar names the reorder before the click",
      /sets the sidebar order/.test(app)
    );
    check(
      "and the Reset dialog names the history it destroys",
      /saved versions/.test(app) && /cannot be undone/.test(app)
    );
  }

  console.log("\n" + "-".repeat(70) + "\n  " + pass + " passed, " + fail + " failed");
}

main()
  .catch((e) => { console.error("\nERROR:", e); fail++; })
  .finally(async () => { await teardown(); await p.$disconnect(); process.exit(fail ? 1 : 0); });
