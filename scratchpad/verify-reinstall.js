/**
 * Uninstall, then REINSTALL — the loop every marketplace app is put through.
 *
 * "Remove it and add it again" is the first thing any support person says, so this path
 * is walked far more often than a plain install. What happened on this code:
 *
 *   1. Agency uninstalls. `removeAgency` soft-removes every sub-account
 *      (`status: "removed", enabled: false`) — correct, that is how serving stops.
 *   2. Agency reinstalls. `setSession` flips the AGENCY back to `active`, and both entry
 *      points (the OAuth handler and the INSTALL webhook) call `syncLocationsForAgency`.
 *   3. That function REFUSES to resurrect a `removed` location — deliberately, and with
 *      the reason written down: a sub-account deleted in GHL must not come back just
 *      because a sibling event triggered a re-sync.
 *
 * So the agency reinstalls and gets **zero working sub-accounts, permanently**. The
 * install redirects to onboarding, the dashboard opens, the table is empty, `/theme-css`
 * serves nothing, and no error is raised anywhere. Re-running `sync-locations` calls the
 * same function and refuses again, so there is no recovery short of hand-written SQL.
 *
 * The rule in step 3 is right for what it was written for. It just cannot tell a
 * sub-account DELETED in GHL from one soft-removed as a cascade of the agency's own
 * uninstall — which GHL still lists, and which the agency plainly expects back.
 *
 * `searchLocations` is stubbed here so the whole of `syncLocationsForAgency` runs against
 * a known list. Everything else is real: the live UNINSTALL webhook, real rows, and the
 * real reinstall path.
 *
 * Run this with `npx tsx`, not `node`: it imports TypeScript sources directly.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3210";
const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error("REFUSING: this suite posts UNINSTALL webhooks. DATABASE_URL must be localhost.");
  process.exit(1);
}

const APP_ID = (process.env.GHL_APP_CLIENT_ID ?? "").split("-")[0];
const p = new PrismaClient();
let pass = 0,
  fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    console.log(`  ok    ${n}`);
    pass++;
  } else {
    console.log(`  FAIL  ${n}`);
    if (d !== undefined) console.log(`        ${String(d).slice(0, 300)}`);
    fail++;
  }
};

const TAG = `ri${Date.now().toString(36)}`;
const COMPANY = `co_${TAG}`;
const KEEP = `loc_${TAG}_keep`; // active, and GHL still lists it
const OFF = `loc_${TAG}_off`; // active but the agency had switched it off
const GONE = `loc_${TAG}_gone`; // active, but GHL no longer lists it after the gap
const DELETED = `loc_${TAG}_del`; // already removed by a LocationDelete, before any of this

let seq = 0;
async function hook(type, extra = {}) {
  const body = { type, appId: APP_ID, webhookId: `evt_${TAG}_${++seq}`, ...extra };
  const res = await fetch(`${BASE}/webhooks/ghl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const loc = (id) => p.locationInstall.findUnique({ where: { ghlLocationId: id } });

let agencyId = null;

(async () => {
  const a = await p.agencyInstall.create({
    data: {
      ghlCompanyId: COMPANY,
      companyName: "Reinstall Test Agency",
      accessTokenEnc: "not-a-real-token",
      refreshTokenEnc: "not-a-real-token",
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      status: "active",
    },
  });
  agencyId = a.id;

  for (const [id, name, enabled] of [
    [KEEP, "Alpha Client", true],
    [OFF, "Bravo Client", false],
    [GONE, "Charlie Client", true],
  ]) {
    await p.locationInstall.create({
      data: {
        agencyInstallId: a.id,
        ghlLocationId: id,
        locationName: name,
        status: "active",
        enabled,
        installedAt: new Date(),
        activatedAt: new Date(),
      },
    });
  }
  // Deleted in GHL long before the uninstall. This one must NEVER come back — it is the
  // case the no-resurrect rule was written for, and the reason it can't simply be dropped.
  await p.locationInstall.create({
    data: {
      agencyInstallId: a.id,
      ghlLocationId: DELETED,
      locationName: "Delta Client (deleted)",
      status: "removed",
      enabled: false,
      installedAt: new Date(),
    },
  });

  console.log("\n== the agency uninstalls ==");
  const un = await hook("UNINSTALL", { companyId: COMPANY });
  check("webhook accepted", un.status === 200, JSON.stringify(un.json));
  check(
    "the agency is marked uninstalled",
    (await p.agencyInstall.findUnique({ where: { id: a.id } })).status === "uninstalled"
  );
  check(
    "every sub-account is soft-removed with it",
    (await p.locationInstall.count({ where: { agencyInstallId: a.id, status: "active" } })) === 0
  );
  check(
    "  ↳ recorded as the agency's cascade, not as a deletion",
    (await loc(KEEP)).removedReason === "agency-uninstall",
    (await loc(KEEP)).removedReason
  );
  check(
    "  ↳ and the one already deleted keeps its own reason",
    (await loc(DELETED)).removedReason !== "agency-uninstall",
    (await loc(DELETED)).removedReason
  );

  console.log("\n== they reinstall, which is where this fell over ==");
  // What `PrismaSessionStorage.setSession` does with the token exchange.
  await p.agencyInstall.update({ where: { id: a.id }, data: { status: "active" } });

  // GHL still lists the two live sub-accounts. Charlie was deleted while we were away,
  // so it is absent — the reinstall must not bring that one back either.
  /*
   * Imports the SOURCE under tsx, not `dist`. A suite that reads the built artifact is
   * asserting about whatever was there at the last `npm run build:server` — found 2026-08-26
   * when two deliberate mutations to `readiness.ts` left `verify-readiness` 34/34 green and
   * the build turned out to be a day old. Run these with `npx tsx`, not `node`.
   *
   * The `dist/assets` reads elsewhere are a different thing and stay: those deliberately
   * inspect the SHIPPED browser bundle, which is the artifact under test.
   */
  const { ghl } = require(`${ROOT}/apps/server/src/services/ghlClient.ts`);
  ghl.locations.searchLocations = async ({ skip }) =>
    Number(skip) > 0
      ? { locations: [] }
      : {
          locations: [
            { id: KEEP, name: "Alpha Client" },
            { id: OFF, name: "Bravo Client" },
          ],
        };

  const { syncLocationsForAgency } = require(`${ROOT}/apps/server/src/services/locationSync.ts`);
  await syncLocationsForAgency(a.id);

  check("the sub-account GHL still lists is serving again", (await loc(KEEP)).status === "active", JSON.stringify(await loc(KEEP)));
  check(
    "  ↳ which is the whole point: without it a reinstall brands nobody",
    (await p.locationInstall.count({ where: { agencyInstallId: a.id, status: "active" } })) === 2
  );
  check(
    "  ↳ and its removal reason is cleared, so a later re-sync reads it as normal",
    (await loc(KEEP)).removedReason === null,
    (await loc(KEEP)).removedReason
  );
  check(
    "a sub-account the agency had switched OFF is still off",
    (await loc(OFF)).status === "active" && (await loc(OFF)).enabled === false,
    JSON.stringify(await loc(OFF))
  );
  check(
    "a sub-account GHL no longer lists stays removed",
    (await loc(GONE)).status === "removed",
    JSON.stringify(await loc(GONE))
  );
  check(
    "the one DELETED before any of this stays removed — the rule still holds",
    (await loc(DELETED)).status === "removed",
    JSON.stringify(await loc(DELETED))
  );

  console.log("\n== and a plain re-sync of a LIVE agency resurrects nothing ==");
  // The case the no-resurrect rule exists for: a sibling event triggers a sync while
  // GHL's list still contains a sub-account we were told to delete.
  await p.locationInstall.update({
    where: { ghlLocationId: KEEP },
    data: { status: "removed", enabled: false, removedReason: "location-delete" },
  });
  ghl.locations.searchLocations = async ({ skip }) =>
    Number(skip) > 0 ? { locations: [] } : { locations: [{ id: KEEP, name: "Alpha Client" }, { id: OFF, name: "Bravo Client" }] };
  await syncLocationsForAgency(a.id);
  check(
    "a deleted sub-account still in GHL's list is NOT resurrected",
    (await loc(KEEP)).status === "removed",
    JSON.stringify(await loc(KEEP))
  );
  check("  ↳ but its name is still refreshed, as before", (await loc(KEEP)).locationName === "Alpha Client");

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => {
    console.error("\nERROR:", e.stack);
    fail++;
  })
  .finally(async () => {
    if (agencyId) {
      await p.locationInstall.deleteMany({ where: { agencyInstallId: agencyId } }).catch(() => {});
      await p.customMenuLinkRegistration.deleteMany({ where: { agencyInstallId: agencyId } }).catch(() => {});
      await p.webhookEvent.deleteMany({ where: { ghlEventId: { startsWith: `evt_${TAG}_` } } }).catch(() => {});
      await p.agencyInstall.deleteMany({ where: { id: agencyId } }).catch(() => {});
    }
    await p.$disconnect();
    process.exit(fail);
  });
