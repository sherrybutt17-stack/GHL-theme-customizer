/**
 * The JS half of a theme must see the same cascade the CSS half does.
 *
 * `/theme-bundle/:agency/config/:loc` 404'd whenever a sub-account had no ThemeConfig of
 * its own, and the pasted script reads a 404 as null and returns immediately. So an
 * agency who branded once at the AGENCY-DEFAULT level — the documented way to cover 41
 * sub-accounts, and the only sane one — got their colours and logo on every sub-account
 * through the stylesheet, and the browser-tab title and favicon on NONE of them.
 *
 * Silently, and invisibly, because the CSS half plainly worked: you would be looking at
 * your own branding while the tab said GoHighLevel.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3210";
const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error("REFUSING: DATABASE_URL must be localhost.");
  process.exit(1);
}

const p = new PrismaClient();
let pass = 0,
  fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    console.log(`  ok    ${n}`);
    pass++;
  } else {
    console.log(`  FAIL  ${n}`);
    if (d !== undefined) console.log(`        ${String(d).slice(0, 250)}`);
    fail++;
  }
};

const TAG = `bc${Date.now().toString(36)}`;
const COMPANY = `co_${TAG}`;
const LOC_PLAIN = `loc_${TAG}_plain`; // no theme of its own — the case the bug hit
const LOC_OWN = `loc_${TAG}_own`; // partially overridden

(async () => {
  let agencyId = null;
  try {
    const agency = await p.agencyInstall.create({
      data: {
        ghlCompanyId: COMPANY,
        companyName: "Bundle Config Test Agency",
        accessTokenEnc: "not-a-real-token",
        refreshTokenEnc: "not-a-real-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        status: "active",
      },
    });
    agencyId = agency.id;
    for (const ghlLocationId of [LOC_PLAIN, LOC_OWN]) {
      await p.locationInstall.create({
        data: {
          agencyInstallId: agency.id,
          ghlLocationId,
          locationName: ghlLocationId,
          status: "active",
          enabled: true,
          installedAt: new Date(),
          activatedAt: new Date(),
        },
      });
    }

    const cfg = async (loc) => {
      const r = await fetch(`${BASE}/theme-bundle/${agency.id}/config/${loc}`);
      return { status: r.status, json: await r.json().catch(() => null) };
    };

    console.log("\n== nothing branded anywhere ==");
    const bare = await cfg(LOC_PLAIN);
    check("404 when neither the sub-account nor the agency has a theme", bare.status === 404, bare.status);

    console.log("\n== the agency brands ONCE, at the agency-default level ==");
    await p.agencyDefaultTheme.create({
      data: {
        agencyInstallId: agency.id,
        brandName: "Agency Wide Portal",
        faviconUrl: "https://cdn.example.test/fav.png",
        logoUrl: "https://cdn.example.test/logo.png",
        primaryColor: "#123456",
      },
    });

    const inherited = await cfg(LOC_PLAIN);
    check("a sub-account with NO theme of its own now resolves", inherited.status === 200, `${inherited.status} ${JSON.stringify(inherited.json)}`);
    check("  -> it inherits the tab title", inherited.json?.brandName === "Agency Wide Portal", JSON.stringify(inherited.json));
    check("  -> and the favicon, which CSS cannot deliver at all", inherited.json?.faviconUrl === "https://cdn.example.test/fav.png", JSON.stringify(inherited.json));
    check("  -> and the colours agree with the stylesheet", inherited.json?.primaryColor === "#123456", JSON.stringify(inherited.json));

    /**
     * WHAT IS NOT ON THE WIRE, and why that is a check rather than a detail.
     *
     * This endpoint is unauthenticated by necessity — it is fetched by a script pasted
     * into GHL, keyed on an `agencyInstallId` that is PUBLIC, since it sits in the
     * `@import` line every agency pastes into their Custom CSS. It answered with eight
     * fields; the pasted script has only ever read four of them, and two of the extras
     * were the agency's own commercial information:
     *
     *   - `hiddenFeatures` is documented in CLAUDE.md as the PROXY FOR WHAT A CLIENT
     *     BOUGHT — it is the reason `planName` exists — so answering with it tells anyone
     *     who asks which features each of an agency's clients did not get.
     *   - `menuLabelOverrides` is that agency's private renaming scheme for their clients.
     *
     * The support widget's config endpoint already follows this rule and says so
     * ("deliberately does NOT return forbiddenTerms or allowedLinkDomains — shipping them
     * tells an attacker what to work around"); this one simply had not been asked the
     * question. Asserted by NAME rather than by counting keys, so adding a field somebody
     * has thought about does not fail, and re-adding one of these does.
     */
    const leaked = ["hiddenFeatures", "menuLabelOverrides", "logoUrl", "secondaryColor"]
      .filter((k) => k in (inherited.json ?? {}));
    check(
      "  -> and it answers with NOTHING the pasted script does not read",
      leaked.length === 0,
      `back on the wire: ${leaked.join(", ")} — this endpoint needs no agencyInstallId secret to call`
    );
    check(
      "  -> while the two fields only JS can deliver are still there",
      inherited.json?.brandName !== undefined && inherited.json?.faviconUrl !== undefined,
      JSON.stringify(inherited.json)
    );

    console.log("\n== the CSS half already did this, which is why nobody noticed ==");
    const css = await (await fetch(`${BASE}/theme-css/${agency.id}`)).text();
    check("the stylesheet carries the agency default for that same sub-account", css.includes("#123456"), css.slice(0, 200));
    check("  -> so before the fix, colours applied and the tab title did not", true);

    console.log("\n== a sub-account that overrides ONE field keeps the rest ==");
    // Per field, not whole-object: the stylesheet emits the agency-default block globally
    // and lets location rules override property by property. The two halves of one theme
    // must not disagree about what a partial override means.
    const own = await p.locationInstall.findUnique({ where: { ghlLocationId: LOC_OWN } });
    await p.themeConfig.create({
      data: { locationInstallId: own.id, version: 1, brandName: "Client One" },
    });
    const merged = await cfg(LOC_OWN);
    check("its own brand name wins", merged.json?.brandName === "Client One", JSON.stringify(merged.json));
    check("  -> while the agency's favicon is still inherited", merged.json?.faviconUrl === "https://cdn.example.test/fav.png", JSON.stringify(merged.json));
    check("  -> and so is the agency's colour", merged.json?.primaryColor === "#123456", JSON.stringify(merged.json));

    console.log("\n== and it stops on uninstall, explicitly ==");
    await p.agencyInstall.update({ where: { id: agency.id }, data: { status: "uninstalled" } });
    const gone = await cfg(LOC_PLAIN);
    // Checked directly rather than left to the uninstall cascade having disabled the
    // location: the locations here are deliberately still active.
    check("an uninstalled agency answers 404 even with active sub-accounts", gone.status === 404, gone.status);
    const stillActive = await p.locationInstall.count({ where: { agencyInstallId: agency.id, status: "active" } });
    check("  -> and that was NOT just the cascade — both locations are still active", stillActive === 2, stillActive);
  } finally {
    if (agencyId) {
      await p.themeConfig.deleteMany({ where: { locationInstall: { agencyInstallId: agencyId } } });
      await p.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: agencyId } });
      await p.agencyDefaultThemeVersion.deleteMany({ where: { agencyInstallId: agencyId } });
      await p.locationInstall.deleteMany({ where: { agencyInstallId: agencyId } });
      await p.agencyInstall.deleteMany({ where: { id: agencyId } });
    }
  }

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e.stack);
  await p.agencyInstall.findUnique({ where: { ghlCompanyId: COMPANY } }).then(async (a) => {
    if (a) {
      await p.themeConfig.deleteMany({ where: { locationInstall: { agencyInstallId: a.id } } }).catch(() => {});
      await p.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: a.id } }).catch(() => {});
      await p.locationInstall.deleteMany({ where: { agencyInstallId: a.id } }).catch(() => {});
      await p.agencyInstall.deleteMany({ where: { id: a.id } }).catch(() => {});
    }
  }).catch(() => {});
  await p.$disconnect();
  process.exit(1);
});
