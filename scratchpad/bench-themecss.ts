/**
 * How big and how slow is the render-blocking stylesheet at real agency scale?
 *
 * This is the highest-stakes surface in the product: every GHL page load blocks on an
 * `@import` of it, so its size is added to the agency's whole UI and its generation
 * time sits inside a 2.5s wall-clock timeout. CLAUDE.md carries ESTIMATES for this
 * (logos are 29–152KB, base64 adds 33%, 41 sub-accounts...) — estimates that have never
 * been checked against the generator.
 *
 * Two numbers matter and they fail differently:
 *   SIZE — paid by every page load of every user of every sub-account, forever.
 *   TIME — if generation approaches DB_TIMEOUT_MS the route abandons it and serves the
 *          last-known-good cache, so the failure is a theme that silently stops
 *          updating rather than an error anybody sees.
 */
import "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/loadEnv";
import { prisma } from "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/prisma";
import { generateThemeCssBundle } from "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/themeCssBundle";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing: DATABASE_URL is not local. This script creates and deletes rows.");
  process.exit(1);
}

const SUBS = Number(process.argv[2] ?? 41);
const LOGO_KB = Number(process.argv[3] ?? 40);
const TIMEOUT_MS = Number(process.env.THEME_CSS_TIMEOUT_MS ?? 2500);

/**
 * A base64 data URI of roughly the requested size, like a real uploaded logo.
 *
 * RANDOM bytes, not a repeated character, and the difference decides the headline
 * number. A run of identical bytes gzips to nothing, so the first version of this
 * bench reported a 1.4MB stylesheet as "34 KB over the wire" — a reassuring figure
 * describing a file nobody will ever serve. A real logo is WebP or PNG: already
 * compressed, so its base64 is high-entropy and gzip can only claw back the ~33%
 * base64 overhead, not the image itself.
 */
function fakeLogo(kb: number): string {
  const binary = randomBytes(Math.round(kb * 1024));
  return `data:image/webp;base64,${binary.toString("base64")}`;
}

const made = { agencyId: "", locationIds: [] as string[] };

(async () => {
  const agency = await prisma.agencyInstall.create({
    data: {
      ghlCompanyId: `bench-themecss-${Date.now()}`,
      accessTokenEnc: "x",
      refreshTokenEnc: "x",
      tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "Bench Agency",
    },
  });
  made.agencyId = agency.id;

  console.log(`\nbuilding ${SUBS} sub-accounts, each with a ~${LOGO_KB}KB logo…`);
  for (let i = 0; i < SUBS; i++) {
    const loc = await prisma.locationInstall.create({
      data: {
        agencyInstallId: agency.id,
        ghlLocationId: `bench-loc-${Date.now()}-${i}`,
        status: "active",
        // Required by the generator: it selects status=active AND enabled=true.
        // Omitting it produced a 0 KB "no themes configured" bundle that the bench
        // happily reported as a performance result.
        enabled: true,
        locationName: `Client ${i}`,
      },
    });
    made.locationIds.push(loc.id);
    await prisma.themeConfig.create({
      data: {
        locationInstallId: loc.id,
        version: 1,
        brandName: `Client ${i} Portal`,
        logoUrl: fakeLogo(LOGO_KB),
        primaryColor: "#123456",
        accentColor: "#abcdef",
        sidebarTextColor: "#ffffff",
        topBarColor: "#101820",
        buttonColor: "#2b6cb0",
        scrollbarColor: "#334155",
        fontFamily: "Inter, sans-serif",
        cornerRadius: 8,
        gradientEnabled: true,
        gradientColor: "#654321",
        gradientAngle: 135,
        hiddenFeatures: ["memberships", "payments"],
        menuLabelOverrides: { opportunities: "Leads", contacts: "People" },
        menuOrder: ["dashboard", "conversations", "calendars", "contacts", "opportunities"],
      },
    });
  }

  // Warm, then measure — the first call pays Prisma's query-plan and connection costs.
  const warm = await generateThemeCssBundle(agency.id);
  if (/No themes configured/.test(warm) || Buffer.byteLength(warm) < 1000) {
    throw new Error(`the generator produced nothing to measure (${Buffer.byteLength(warm)} bytes): ${warm.slice(0, 120)}`);
  }
  const runs: number[] = [];
  let css = "";
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    css = await generateThemeCssBundle(agency.id);
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  const bytes = Buffer.byteLength(css, "utf8");

  // What the browser actually pulls: Express compresses this response.
  const gzipped = gzipSync(Buffer.from(css)).length;

  console.log(`\n  sub-accounts            ${SUBS}`);
  console.log(`  stylesheet              ${(bytes / 1024).toFixed(0)} KB raw · ${(gzipped / 1024).toFixed(0)} KB gzipped`);
  console.log(`  per sub-account         ${(bytes / SUBS / 1024).toFixed(1)} KB`);
  console.log(`  generation              ${median.toFixed(0)} ms median (${runs[0].toFixed(0)}–${runs[runs.length - 1].toFixed(0)})`);
  console.log(`  timeout budget          ${TIMEOUT_MS} ms — using ${((median / TIMEOUT_MS) * 100).toFixed(0)}% of it`);

  const rules = (css.match(/\{/g) ?? []).length;
  console.log(`  rules                   ~${rules}`);

  if (median > TIMEOUT_MS * 0.5) {
    console.log(`\n  ⚠ generation is over half the wall-clock budget. Past it the route serves`);
    console.log(`    the last-known-good cache instead, so the theme silently stops updating.`);
  }
  console.log();
})()
  .catch((e) => console.error("\nERROR:", e.stack))
  .finally(async () => {
    if (made.agencyId) {
      await prisma.themeConfig.deleteMany({ where: { locationInstallId: { in: made.locationIds } } }).catch(() => {});
      await prisma.locationInstall.deleteMany({ where: { agencyInstallId: made.agencyId } }).catch(() => {});
      await prisma.agencyInstall.delete({ where: { id: made.agencyId } }).catch(() => {});
    }
    console.log(`cleanup: agencies=${await prisma.agencyInstall.count()} locations=${await prisma.locationInstall.count()}`);
    await prisma.$disconnect();
  });
