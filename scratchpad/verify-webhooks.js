/**
 * The GHL app lifecycle — install, uninstall, sub-account churn — end to end.
 *
 * This is the last production path with no live coverage, and it turned out to contain
 * the bug this suite now guards: the route's switch handled `UninstallCompany` and
 * `UninstallLocation`, names that appear nowhere but our own file. GHL's own SDK
 * switches on the bare string "UNINSTALL", so a real uninstall fell through to
 * `default:` and did nothing — while the audit row said `processed` and the response
 * said `success: true`.
 *
 * What made it survive review is that it LOOKED like it worked: the SDK middleware calls
 * sessionStorage.deleteSession, and our PrismaSessionStorage happens to flip the agency
 * to `uninstalled` there. So the status change happened by side effect and everything
 * only the route does — deleting the Custom Menu Link from the agency's GHL nav,
 * soft-removing the sub-accounts — did not. And that side effect only fires on the
 * signature-VERIFIED path, so with no public key configured nothing happened at all.
 *
 * Everything below runs against a throwaway agency created by this script. It refuses to
 * run against a non-localhost database: an UNINSTALL against real data un-brands a real
 * agency, which is precisely the blast radius being tested.
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

// The SDK middleware compares body.appId against CLIENT_ID.split("-")[0] and skips
// processing on a mismatch, so a webhook with the wrong appId never reaches our route.
// Derived, never printed.
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

const TAG = `wh${Date.now().toString(36)}`;
const COMPANY = `co_${TAG}`;
const LOC_A = `loc_${TAG}_a`;
const LOC_B = `loc_${TAG}_b`;

let seq = 0;
async function hook(type, extra = {}) {
  // A distinct webhookId per delivery unless the caller pins one — that field is the
  // idempotency key, so redelivery is modelled by REUSING it.
  const body = { type, appId: APP_ID, webhookId: `evt_${TAG}_${++seq}`, ...extra };
  const res = await fetch(`${BASE}/webhooks/ghl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null), webhookId: body.webhookId };
}

const agency = () => p.agencyInstall.findUnique({ where: { ghlCompanyId: COMPANY } });
const loc = (id) => p.locationInstall.findUnique({ where: { ghlLocationId: id } });

async function seed() {
  const a = await p.agencyInstall.create({
    data: {
      ghlCompanyId: COMPANY,
      companyName: "Webhook Test Agency",
      // Deliberately NOT a real encrypted token. deleteMenuLinkForAgency decrypts inside
      // its try/catch, so this exercises the realistic uninstall case: GHL has already
      // revoked us and the remote delete cannot succeed. Our own row must still go.
      accessTokenEnc: "not-a-real-token",
      refreshTokenEnc: "not-a-real-token",
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      status: "active",
    },
  });
  for (const [ghlLocationId, locationName] of [
    [LOC_A, "Alpha Client"],
    [LOC_B, "Beta Client"],
  ]) {
    await p.locationInstall.create({
      data: {
        agencyInstallId: a.id,
        ghlLocationId,
        locationName,
        status: "active",
        enabled: true,
        installedAt: new Date(),
        activatedAt: new Date(),
      },
    });
  }
  await p.customMenuLinkRegistration.create({
    data: {
      agencyInstallId: a.id,
      ghlMenuLinkId: `menu_${TAG}`,
      slug: `slug-${TAG}`,
      url: `https://example.test/admin-embed/${a.id}?k=slug-${TAG}`,
      targetLocationIds: [],
    },
  });
  // A theme, so /theme-css has something real to stop serving.
  await p.themeConfig.create({
    data: {
      locationInstallId: (await loc(LOC_A)).id,
      version: 1,
      primaryColor: "#bada55",
    },
  });
  return a;
}

async function cleanup(agencyId) {
  if (!agencyId) return;
  await p.themeConfig.deleteMany({ where: { locationInstall: { agencyInstallId: agencyId } } });
  await p.customMenuLinkRegistration.deleteMany({ where: { agencyInstallId: agencyId } });
  await p.locationInstall.deleteMany({ where: { agencyInstallId: agencyId } });
  await p.webhookEvent.deleteMany({ where: { ghlEventId: { startsWith: `evt_${TAG}_` } } });
  await p.agencyInstall.deleteMany({ where: { id: agencyId } });
}

(async () => {
  if (!APP_ID) throw new Error("GHL_APP_CLIENT_ID is not set — the SDK would skip every webhook");
  const a = await seed();

  try {
    console.log("\n== the app is live: the stylesheet is real ==");
    const before = await fetch(`${BASE}/theme-css/${a.id}`);
    const beforeCss = await before.text();
    check("theme-css serves the agency's stylesheet", before.status === 200 && beforeCss.includes("#bada55"), `${before.status} / ${beforeCss.slice(0, 120)}`);

    console.log("\n== a sub-account is deleted in GHL ==");
    // No companyId, so nothing tries to re-sync against the real GHL API.
    const del = await hook("LocationDelete", { locationId: LOC_B });
    check("webhook accepted", del.status === 200 && del.json?.success === true, JSON.stringify(del.json));
    check("that sub-account is soft-removed", (await loc(LOC_B))?.status === "removed");
    check("  -> and disabled, so no theme is emitted for it", (await loc(LOC_B))?.enabled === false);
    check("its SIBLING is untouched", (await loc(LOC_A))?.status === "active");

    console.log("\n== UNINSTALL carrying a locationId is a SUB-ACCOUNT removal ==");
    // Both ids present, which is what GHL sends for a location-level uninstall. locationId
    // must win — otherwise one sub-account leaving un-brands the entire agency.
    const unLoc = await hook("UNINSTALL", { companyId: COMPANY, locationId: LOC_A });
    check("webhook accepted", unLoc.status === 200, JSON.stringify(unLoc.json));
    check("the named sub-account is removed", (await loc(LOC_A))?.status === "removed");
    check("the AGENCY is still installed — locationId outranks companyId", (await agency())?.status === "active", (await agency())?.status);
    check("  -> so its Custom Menu Link survives", (await p.customMenuLinkRegistration.count({ where: { agencyInstallId: a.id } })) === 1);

    console.log("\n== UNINSTALL with only a companyId is the WHOLE agency ==");
    // Put a location back so the cascade has something to act on.
    await p.locationInstall.update({ where: { ghlLocationId: LOC_A }, data: { status: "active", enabled: true } });
    const unCo = await hook("UNINSTALL", { companyId: COMPANY });
    check("webhook accepted", unCo.status === 200, JSON.stringify(unCo.json));

    const after = await agency();
    check("the agency is marked uninstalled", after?.status === "uninstalled", after?.status);
    check(
      "the Custom Menu Link registration is gone",
      (await p.customMenuLinkRegistration.count({ where: { agencyInstallId: a.id } })) === 0
    );
    // Was an unconditional `true`, i.e. a check that could not fail. What makes the one
    // above meaningful is that the stored token is NOT decryptable — the realistic case,
    // where GHL revoked us before telling us — so assert that rather than assert nothing.
    let decryptable = true;
    try {
      /*
       * Imports the SOURCE under tsx, not `dist`. A suite that reads the built artifact is
       * asserting about whatever was there at the last `npm run build:server` — found 2026-08-26
       * when two deliberate mutations to `readiness.ts` left `verify-readiness` 34/34 green and
       * the build turned out to be a day old. Run these with `npx tsx`, not `node`.
       *
       * The `dist/assets` reads elsewhere are a different thing and stay: those deliberately
       * inspect the SHIPPED browser bundle, which is the artifact under test.
       */
      require(`${ROOT}/apps/server/src/services/tokenCrypto.ts`).decryptToken(after.accessTokenEnc);
    } catch {
      decryptable = false;
    }
    check("  -> even though the stored token could not be decrypted", !decryptable);
    const locs = await p.locationInstall.findMany({ where: { agencyInstallId: a.id } });
    check(
      "every sub-account is soft-removed",
      locs.length === 2 && locs.every((l) => l.status === "removed"),
      JSON.stringify(locs.map((l) => [l.status, l.enabled]))
    );
    check(
      "  -> the live one is stamped as the agency's cascade, so a reinstall brings it back",
      (await loc(LOC_A))?.removedReason === "agency-uninstall",
      (await loc(LOC_A))?.removedReason
    );
    check(
      "  -> and the one already DELETED keeps its own reason, so it never comes back",
      // The distinction the column exists for. The cascade must not overwrite a removal
      // that had a different cause, or a reinstall would resurrect a deleted sub-account.
      (await loc(LOC_B))?.removedReason === "location-delete",
      (await loc(LOC_B))?.removedReason
    );
    check(
      "  -> the agency's own enable/disable toggle is left alone, not clobbered",
      // `enabled` is their per-sub-account switch in the dashboard. Overwriting a user
      // setting as a side effect of an uninstall destroys a choice we cannot restore;
      // nothing serves off a `removed` row regardless.
      (await loc(LOC_A))?.enabled === true,
      (await loc(LOC_A))?.enabled
    );

    console.log("\n== and the branding actually stops ==");
    const post = await fetch(`${BASE}/theme-css/${a.id}`);
    const postCss = await post.text();
    check("theme-css no longer emits the theme", !postCss.includes("#bada55"), postCss.slice(0, 120));
    check("  -> it says the install was removed", postCss.includes("removed"), postCss.slice(0, 120));
    check("  -> as a 200, not an error the browser retries", post.status === 200, post.status);

    console.log("\n== an INSTALL for an uninstalled agency does not silently revive it ==");
    const re = await hook("INSTALL", { companyId: COMPANY });
    check("webhook accepted", re.status === 200, JSON.stringify(re.json));
    check("the agency stays uninstalled until real OAuth runs", (await agency())?.status === "uninstalled");

    console.log("\n== idempotency: GHL retries deliveries ==");
    const pinned = `evt_${TAG}_dup`;
    const post1 = await fetch(`${BASE}/webhooks/ghl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "LocationDelete", appId: APP_ID, webhookId: pinned, locationId: LOC_B }),
    });
    const post2 = await fetch(`${BASE}/webhooks/ghl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "LocationDelete", appId: APP_ID, webhookId: pinned, locationId: LOC_B }),
    });
    const j2 = await post2.json();
    check("the first delivery is processed", post1.status === 200);
    check("the redelivery is deduped, not re-run", j2?.deduped === true, JSON.stringify(j2));
    check(
      "exactly one audit row exists for that event id",
      (await p.webhookEvent.count({ where: { ghlEventId: pinned } })) === 1
    );
    const row = await p.webhookEvent.findUnique({ where: { ghlEventId: pinned } });
    check("and it is recorded as processed", row?.status === "processed", row?.status);
    await p.webhookEvent.deleteMany({ where: { ghlEventId: pinned } });

    console.log("\n== an event we don't handle is accepted and ignored ==");
    const noop = await hook("ContactCreate", {
      companyId: COMPANY,
      contactId: "x",
      email: "jane@aclient.example",
      phone: "+15551234567",
      firstName: "Jane",
    });
    check("unknown event types don't error", noop.status === 200 && noop.json?.success === true, JSON.stringify(noop.json));
    check("  -> and are still audited", (await p.webhookEvent.count({ where: { ghlEventId: noop.webhookId } })) === 1);

    // The endpoint is ONE URL and GHL decides what to send it. Auditing every delivery in
    // full meant subscribing the app to contact events would quietly accumulate the
    // agency's own clients' personal data in our database, forever, in service of nothing.
    const audited = await p.webhookEvent.findUnique({ where: { ghlEventId: noop.webhookId } });
    const stored = JSON.stringify(audited?.payload ?? {});
    check("  -> but NOT the client's personal data", !/jane@aclient|15551234567|Jane/.test(stored), stored.slice(0, 200));
    check("  -> the SHAPE is kept, so an ignored event is still visible", /"keys"/.test(stored) && /email/.test(stored), stored.slice(0, 200));

    console.log("\n== an event we DO handle keeps its whole body ==");
    // The payload is what you need when a handler fails, so it must survive for exactly
    // the events that have a handler to fail.
    const kept = await p.webhookEvent.findUnique({ where: { ghlEventId: unCo.webhookId } });
    check("the uninstall's body is stored in full", JSON.stringify(kept?.payload ?? {}).includes(COMPANY), JSON.stringify(kept?.payload).slice(0, 150));

    console.log("\n== the audit table is pruned, not grown forever ==");
    // From dist, so this needs `npm run build:server` first — say so rather than failing
    // with a bare module-not-found three checks from the end of a long suite.
    const { pruneWebhookEvents } = await import(
      `${ROOT}/apps/server/src/services/webhookEvents.ts`
    ).catch(() => {
      throw new Error("run `npm run build:server` first — this check imports the built prune");
    });
    const old = `evt_${TAG}_old`;
    const oldFail = `evt_${TAG}_oldfail`;
    const recent = `evt_${TAG}_recent`;
    const longAgo = new Date(Date.now() - 400 * 86_400_000);
    await p.webhookEvent.createMany({
      data: [
        { ghlEventId: old, eventType: "INSTALL", payload: {}, status: "processed", receivedAt: longAgo },
        { ghlEventId: oldFail, eventType: "INSTALL", payload: {}, status: "failed", receivedAt: new Date(Date.now() - 60 * 86_400_000) },
        { ghlEventId: recent, eventType: "INSTALL", payload: {}, status: "processed", receivedAt: new Date() },
      ],
    });
    await pruneWebhookEvents();
    check("an aged-out processed event is deleted", (await p.webhookEvent.count({ where: { ghlEventId: old } })) === 0);
    check("a recent one is kept — GHL may still retry it", (await p.webhookEvent.count({ where: { ghlEventId: recent } })) === 1);
    check(
      "a FAILED event outlives it — that row is the evidence",
      (await p.webhookEvent.count({ where: { ghlEventId: oldFail } })) === 1
    );
    await p.webhookEvent.deleteMany({ where: { ghlEventId: { in: [old, oldFail, recent] } } });

    console.log("\n== a webhook for an agency we've never seen is a no-op ==");
    const stranger = await hook("UNINSTALL", { companyId: `co_absent_${TAG}` });
    check("no row is created for an unknown company", stranger.status === 200 && !(await p.agencyInstall.findUnique({ where: { ghlCompanyId: `co_absent_${TAG}` } })));

    console.log("\n== the legacy names still work (kept as aliases) ==");
    await p.agencyInstall.update({ where: { id: a.id }, data: { status: "active" } });
    await p.locationInstall.updateMany({ where: { agencyInstallId: a.id }, data: { status: "active", enabled: true } });
    await hook("UninstallLocation", { locationId: LOC_B });
    check("UninstallLocation removes just that sub-account", (await loc(LOC_B))?.status === "removed" && (await loc(LOC_A))?.status === "active");
    await hook("UninstallCompany", { companyId: COMPANY });
    check("UninstallCompany uninstalls the agency", (await agency())?.status === "uninstalled");
  } finally {
    await cleanup(a?.id);
  }

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e.stack);
  await p.agencyInstall
    .findUnique({ where: { ghlCompanyId: COMPANY } })
    .then((a) => cleanup(a?.id))
    .catch(() => {});
  await p.$disconnect();
  process.exit(1);
});
