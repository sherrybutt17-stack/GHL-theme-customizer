/**
 * The favicon, all the way from the editor's field to the client's browser tab.
 *
 * Roadmap item 5 was marked DONE with neither half working: the JS bundle never read
 * theme.faviconUrl, and there was no input anywhere in the dashboard to set it (not even
 * a field on the ThemeInput type). Each half looks finished from the other's side.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { console.log(`  ok    ${n}`); pass++; } else { console.log(`  FAIL  ${n}`); if (d) console.log(`        ${String(d).slice(0,200)}`); fail++; } };
const ICON = "https://cdn.example.com/tab-icon.png";

(async () => {
  const ag = await p.agencyInstall.findFirst({ select: { id: true } });
  const loc = await p.locationInstall.findFirst({ where: { agencyInstallId: ag.id, status: "active" }, select: { id: true, ghlLocationId: true } });
  const before = await p.themeConfig.count();

  console.log("\n== a per-sub-account tab icon ==");
  const put = await fetch(`${BASE}/admin/api/${ag.id}/locations/${loc.id}/theme`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brandName: "Tab Test", logoUrl: "", faviconUrl: ICON, primaryColor: "#222222" }),
  });
  check("the save is accepted", put.status === 200, put.status);
  const stored = await p.themeConfig.findFirst({ where: { locationInstallId: loc.id }, orderBy: { version: "desc" }, select: { id: true, faviconUrl: true } });
  check("the API actually stores it", stored?.faviconUrl === ICON, JSON.stringify(stored));

  console.log("\n== it reaches the pasted JS ==");
  const cfg = await (await fetch(`${BASE}/theme-bundle/${ag.id}/config/${loc.ghlLocationId}`)).json();
  check("the config endpoint serves it", cfg.faviconUrl === ICON, JSON.stringify(cfg).slice(0, 160));
  const snippet = (await (await fetch(`${BASE}/admin/api/${ag.id}/embed`)).json()).jsSnippet;
  check("the pasted bundle reads that field", /applyFavicon\(theme\.faviconUrl\)/.test(snippet));
  check("  -> and rewrites every icon link", /link\[rel\*='icon'\]/.test(snippet));

  console.log("\n== clearing it puts GHL's icon back ==");
  await fetch(`${BASE}/admin/api/${ag.id}/locations/${loc.id}/theme`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brandName: "Tab Test", logoUrl: "", faviconUrl: null, primaryColor: "#222222" }),
  });
  const cleared = await (await fetch(`${BASE}/theme-bundle/${ag.id}/config/${loc.ghlLocationId}`)).json();
  check("cleared in the config", !cleared.faviconUrl, JSON.stringify(cleared.faviconUrl));
  check("the bundle removes only OUR links, not GHL's", /data-mosaic/.test(snippet));

  // Remove only the versions this test created.
  const made = await p.themeConfig.findMany({ where: { locationInstallId: loc.id, brandName: "Tab Test" }, select: { id: true } });
  await p.themeConfig.deleteMany({ where: { id: { in: made.map((m) => m.id) } } });
  console.log(`\ncleanup: themeConfigs ${before} -> ${await p.themeConfig.count()}`);
  console.log(`${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e.stack); await p.$disconnect(); process.exit(1); });
