const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const p = new PrismaClient();
const BASE = "http://localhost:3210";
(async () => {
  const ag = await p.agencyInstall.findFirst({ select: { id: true } });
  const loc = await p.locationInstall.findFirst({ where: { agencyInstallId: ag.id, status: "active" }, select: { id: true, ghlLocationId: true } });

  // Give the agency a distinctive default so inheritance is visible.
  const def = await p.agencyDefaultTheme.upsert({
    where: { agencyInstallId: ag.id },
    update: { primaryColor: "#0a7d55" },
    create: { agencyInstallId: ag.id, primaryColor: "#0a7d55" },
  });

  const css1 = await (await fetch(`${BASE}/theme-css/${ag.id}?v=${Date.now()}`)).text();
  console.log("A newly-synced sub-account, NO ThemeConfig row:");
  console.log("   agency default emitted globally? ", /#sidebar-v2, \.hl_sidebar \{ background: #0a7d55/.test(css1));
  console.log("   any location-specific block?     ", new RegExp(`class~="${loc.ghlLocationId}"`).test(css1));

  // Now the thing "auto-theme on create" would do: give it its own (empty) row.
  const t = await p.themeConfig.create({ data: { locationInstallId: loc.id, version: 9850 } });
  const css2 = await (await fetch(`${BASE}/theme-css/${ag.id}?v=${Date.now()}`)).text();
  const block = css2.split("\n").filter((l) => l.includes(loc.ghlLocationId) && l.includes("background:"))[0];
  console.log("\nSame sub-account WITH an empty ThemeConfig row:");
  console.log("   its own block now says: ", (block ?? "(none)").slice(0, 150));
  console.log("   inherits the agency green?", /#0a7d55/.test(block ?? ""));
  console.log("   falls back to stock indigo?", /#4f46e5/.test(block ?? ""));

  await p.themeConfig.delete({ where: { id: t.id } });
  await p.agencyDefaultTheme.delete({ where: { agencyInstallId: ag.id } }).catch(() => {});
  await p.$disconnect();
})();
