import "../services/loadEnv";

import { prisma } from "../services/prisma";
import { resolveBrandMap, loadBrandMap, invalidateBrandMap, GENERIC_PLATFORM_NAME } from "../services/brandTerms";
import { renderForBrand, normalizeArticle } from "../services/kbNormalize";
import { guardAnswer } from "../services/answerGuard";

/**
 * Smoke-check brand resolution against real rows: the fallback chain, label merging,
 * hidden-feature union, and cache invalidation on save.
 *
 *   npm run verify-brand-map --workspace @ghl-theme-builder/server
 */
async function main(): Promise<void> {
  const location = await prisma.locationInstall.findFirst({
    where: { status: { not: "removed" } },
    include: { agencyInstall: { select: { id: true, companyName: true } } },
  });
  if (!location) {
    console.log("No sub-accounts in this database; nothing to check.");
    return;
  }

  const agencyId = location.agencyInstall.id;
  const locId = location.ghlLocationId;
  console.log(`Using sub-account ${location.locationName ?? locId} (${locId})\n`);

  // Snapshot so the database is left exactly as found.
  const originalDefault = await prisma.agencyDefaultTheme.findUnique({ where: { agencyInstallId: agencyId } });
  const originalThemeCount = await prisma.themeConfig.count({ where: { locationInstallId: location.id } });

  const show = async (label: string) => {
    invalidateBrandMap();
    const m = await loadBrandMap(locId);
    console.log(`  ${label.padEnd(34)} brand="${m?.brandName}"  (source: ${m?.brandNameSource})`);
    return m;
  };

  // NOTE: the fallback CHAIN itself is pinned exhaustively by the pure unit tests in
  // brandTerms.test.ts (resolveBrandName). Verifying it here would mean deleting a real
  // agency's brand data to reach the lower rungs, which is not worth it. What this
  // script checks is the part unit tests cannot: that live rows resolve as expected.
  console.log("=== 1. RESOLUTION AGAINST LIVE ROWS ===");
  await prisma.themeConfig.deleteMany({ where: { locationInstallId: location.id, version: { gt: 9000 } } });
  const base = await show("as configured today");
  console.log(`    generic fallback would be "${GENERIC_PLATFORM_NAME}" (chain covered by unit tests)`);

  await prisma.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: agencyId } });
  await prisma.agencyDefaultTheme.create({ data: { agencyInstallId: agencyId, brandName: "Agency Default Brand" } });

  await prisma.themeConfig.create({
    data: {
      locationInstallId: location.id,
      version: 9001,
      brandName: "Client Portal Brand",
      menuLabelOverrides: { opportunities: "Leads", contacts: "People" },
      hiddenFeatures: ["memberships"],
    },
  });
  const lvl3 = await show("sub-account brandName set");
  console.log(`    → ${lvl3?.brandNameSource === "location" && lvl3.brandName === "Client Portal Brand" ? "PASS" : "FAIL"} (most specific wins)`);
  void base;

  console.log("\n=== 2. LABEL MERGE (location overrides agency, defaults fill the rest) ===");
  await prisma.agencyDefaultTheme.update({
    where: { agencyInstallId: agencyId },
    data: { menuLabelOverrides: { opportunities: "Agency Deals", calendars: "Bookings" } },
  });
  invalidateBrandMap();
  const merged = await loadBrandMap(locId);
  console.log(`  opportunities → "${merged?.featureLabels.opportunities}"  (expect "Leads": location wins)`);
  console.log(`  calendars     → "${merged?.featureLabels.calendars}"      (expect "Bookings": agency applies)`);
  console.log(`  reporting     → "${merged?.featureLabels.reporting}"      (expect "Reporting": GHL default)`);
  const labelsOk =
    merged?.featureLabels.opportunities === "Leads" &&
    merged?.featureLabels.calendars === "Bookings" &&
    merged?.featureLabels.reporting === "Reporting";
  console.log(`  → ${labelsOk ? "PASS" : "FAIL"}`);

  console.log("\n=== 3. HIDDEN FEATURES ARE A UNION ===");
  await prisma.agencyDefaultTheme.update({
    where: { agencyInstallId: agencyId },
    data: { hiddenFeatures: ["app-marketplace"] },
  });
  invalidateBrandMap();
  const hid = await loadBrandMap(locId);
  console.log(`  agency hides app-marketplace, sub-account hides memberships`);
  console.log(`  resolved → [${hid?.hiddenFeatures.join(", ")}]`);
  const unionOk =
    !!hid?.hiddenFeatures.includes("memberships") && !!hid?.hiddenFeatures.includes("app-marketplace");
  console.log(`  → ${unionOk ? "PASS (agency-level hiding cannot be undone by a location)" : "FAIL"}`);

  console.log("\n=== 4. CACHE INVALIDATION ===");
  invalidateBrandMap();
  const before = await resolveBrandMap(locId);
  await prisma.themeConfig.create({
    data: { locationInstallId: location.id, version: 9002, brandName: "Renamed Mid-Conversation" },
  });
  const stale = await resolveBrandMap(locId);
  console.log(`  after save, WITHOUT invalidation → "${stale?.brandName}" (stale by design: TTL cache)`);
  invalidateBrandMap(locId);
  const fresh = await resolveBrandMap(locId);
  console.log(`  after invalidateBrandMap()       → "${fresh?.brandName}"`);
  console.log(
    `  → ${before?.brandName !== fresh?.brandName && fresh?.brandName === "Renamed Mid-Conversation" ? "PASS" : "FAIL"}` +
      ` (admin.ts calls this on every theme save)`
  );

  console.log("\n=== 5. FULL PIPELINE: article → this client's words → gates ===");
  const article = normalizeArticle({
    title: "Pipelines",
    body: "In GoHighLevel, open Opportunities and check Contacts. See https://help.gohighlevel.com/x.",
    isHtml: false,
  });
  invalidateBrandMap();
  const map = (await loadBrandMap(locId))!;
  const rendered = renderForBrand(article.bodyNormalized, map.brandName, map.featureLabels);
  console.log(`  stored:   ${article.bodyNormalized}`);
  console.log(`  rendered: ${rendered}`);
  const guarded = guardAnswer(rendered);
  console.log(`  gates:    ok=${guarded.ok}  findings=${guarded.findings.length}`);
  console.log(`  → ${guarded.ok && guarded.findings.length === 0 ? "PASS (clean, branded, no links)" : "FAIL: " + JSON.stringify(guarded.findings)}`);

  console.log("\n=== RESTORE ===");
  await prisma.themeConfig.deleteMany({ where: { locationInstallId: location.id, version: { gt: 9000 } } });
  await prisma.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: agencyId } });
  if (originalDefault) {
    const { id, createdAt, updatedAt, ...rest } = originalDefault as any;
    await prisma.agencyDefaultTheme.create({ data: rest });
  }
  const finalCount = await prisma.themeConfig.count({ where: { locationInstallId: location.id } });
  console.log(`  theme versions: ${originalThemeCount} before → ${finalCount} after`);
  console.log(`  agency default restored: ${originalDefault ? "yes" : "none existed"}`);
  invalidateBrandMap();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
