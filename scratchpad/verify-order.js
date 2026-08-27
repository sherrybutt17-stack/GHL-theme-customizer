/** Does a drag in the editor reach the render-blocking stylesheet, and at what cost? */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { console.log(`  ok    ${n}`); pass++; } else { console.log(`  FAIL  ${n}`); if (d) console.log(`        ${String(d).slice(0,260)}`); fail++; } };
const css = async () => (await fetch(`${BASE}/theme-css/${AG}?v=${Date.now()}`)).text();
let AG;

// What the editor actually sends after a drag: every main feature, not just the moved one.
const FULL_ORDER = ["dashboard","conversations","calendars","contacts","opportunities","payments",
  "marketing","automation","sites","memberships","media","reputation","reporting","app-marketplace"];

(async () => {
  const agency = await p.agencyInstall.findFirst({ select: { id: true } });
  AG = agency.id;
  const loc = await p.locationInstall.findFirst({ where: { agencyInstallId: agency.id, status: "active" }, select: { id: true, ghlLocationId: true } });

  // Baseline is a theme row WITHOUT an order, so the delta is the ordering alone and not
  // the whole per-location block appearing for the first time.
  const t = await p.themeConfig.create({ data: { locationInstallId: loc.id, version: 9800 } });
  const before = await css();

  await p.themeConfig.update({ where: { id: t.id }, data: { menuOrder: FULL_ORDER } });
  const after = await css();

  console.log("\n== a drag reaches the stylesheet ==");
  const rules = after.match(/order: \d+ !important/g) ?? [];
  check("emits an order rule per dragged item", rules.length >= FULL_ORDER.length, `${rules.length} rules`);
  check("scoped to THIS sub-account only",
    new RegExp(`\\[class~="${loc.ghlLocationId}"\\] a\\[meta\\]`).test(after),
    after.match(/[^\n]*a\[meta\][^\n]*/)?.[0]);
  check("catch-all sends unlisted items to the back", /a\[meta\] \{ order: 999/.test(after));
  check("catch-all precedes the per-key rules", after.indexOf("a[meta] { order: 999") < after.indexOf("#sb_conversations"));
  check("first dragged item really is first", /#sb_dashboard[^}]*order: 0/.test(after));

  console.log("\n== what it costs on a render-blocking asset ==");
  const delta = after.length - before.length;
  console.log(`        ${(before.length/1024).toFixed(1)}KB -> ${(after.length/1024).toFixed(1)}KB`);
  console.log(`        +${delta}B for a fully reordered sub-account (${(delta*41/1024).toFixed(1)}KB at 41 of them)`);
  check("stays reasonable across a whole agency", delta * 41 < 120 * 1024, `${delta}B each`);

  await p.themeConfig.update({ where: { id: t.id }, data: { menuOrder: [] } });
  check("no ordering rules at all once the order is cleared", !/order: \d+ !important/.test(await css()));

  await p.themeConfig.delete({ where: { id: t.id } });
  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e.stack); await p.$disconnect(); process.exit(1); });
