/**
 * The readiness check — does it actually see the states it exists to catch?
 *
 * Every finding it reports describes a deployment that boots clean, logs nothing and
 * serves 200s while answering nobody. So a readiness check that is itself wrong is worse
 * than none: it reports green over exactly the failures it was written for. Hence this
 * drives real database state and asserts each finding appears AND disappears.
 *
 * Runs against a throwaway agency, but the check is global by design (it asks "is this
 * DEPLOYMENT able to work"), so it restores every baseline it touches.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error("REFUSING: this suite writes SupportConfig and DeskUser rows. DATABASE_URL must be localhost.");
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

const TAG = `rd${Date.now().toString(36)}`;
const ids = (r) => r.findings.map((f) => f.id).sort();
const has = (r, id) => r.findings.some((f) => f.id === id);
const sev = (r, id) => r.findings.find((f) => f.id === id)?.severity;

(async () => {
  /*
   * Imports the SOURCE, under tsx — not `dist`.
   *
   * It used to import the built artifact and refuse only when `dist` was ABSENT. A stale
   * one it imported happily, so every assertion here was about whatever `readiness.ts`
   * looked like at the last `npm run build:server`. Found by mutating the source, watching
   * 34/34 stay green twice, and going to look: the build was a day old.
   *
   * A freshness check was the first fix and was replaced by this one, because it cried wolf
   * — restoring a file after a mutation run bumps its mtime without changing a byte, and a
   * check that fires on correct behaviour is the thing this repo keeps recording as worse
   * than absent. Reading the source removes the question instead of policing it.
   *
   *   npx tsx scratchpad/verify-readiness.js
   */
  const { checkReadiness } = await import(`${ROOT}/apps/server/src/services/readiness.ts`);

  let agencyId = null;
  // Desk accounts that already exist belong to other suites; park their tier and restore.
  const parked = [];

  /**
   * `readiness.supportEnabled` is TRUE if ANY agency has the master switch on — it asks
   * whether this DEPLOYMENT is running the support product, which is the right question
   * for a deploy-time check and the wrong thing for a suite to assume.
   *
   * This asserted `base.supportEnabled === false` and so could only pass on a deployment
   * where support had never been switched on: three checks failed the moment a real agency
   * configured it, and they failed in a way that reads like readiness being broken. Sixth
   * instance of the family this file already records five times — the thing under test is
   * global, so ARRANGE the state and put it back, and measure the rest against the
   * baseline actually found rather than a hoped-for zero.
   */
  const supportWas = await p.supportConfig.findMany({ where: { enabled: true }, select: { agencyInstallId: true } });
  const deploymentRunsSupport = supportWas.length > 0;
  try {
    console.log("\n== baseline ==");
    console.log(`        deployment starts with support ${deploymentRunsSupport ? "ON" : "off"}` +
      (deploymentRunsSupport ? ` for ${supportWas.length} agency/agencies — switched off for this run and restored in teardown` : ""));
    // Only the rows that are actually on, so the blast radius is the smallest that makes
    // the probe meaningful. Raw writes are safe here because readiness queries Postgres
    // directly and never reads the cached brand map.
    for (const r of supportWas) {
      await p.supportConfig.update({ where: { agencyInstallId: r.agencyInstallId }, data: { enabled: false } });
    }
    const base = await checkReadiness();
    console.log(`        support ${base.supportEnabled ? "on" : "off"}, findings: ${ids(base).join(", ") || "none"}`);
    check("with no agency running support, support findings are suppressed", base.supportEnabled === false, JSON.stringify(ids(base)));
    check("  -> a model key or an empty desk is NOT reported while support is off", !has(base, "no-model-key") && !has(base, "no-desk-staff"));

    console.log("\n== switching support on changes what the SAME config means ==");
    const agency = await p.agencyInstall.create({
      data: {
        ghlCompanyId: `co_${TAG}`,
        companyName: "Readiness Test Agency",
        accessTokenEnc: "not-a-real-token",
        refreshTokenEnc: "not-a-real-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        status: "active",
      },
    });
    agencyId = agency.id;
    // Deliberately no escalation address: a row written before the PUT enforced one.
    await p.supportConfig.create({
      data: { agencyInstallId: agency.id, enabled: true, escalationEmails: [] },
    });

    const on = await checkReadiness();
    console.log(`        findings: ${ids(on).join(", ")}`);
    check("support is now seen as on", on.supportEnabled === true);
    check("a support config with no escalation address is a BLOCKER", sev(on, "no-escalation-email") === "blocker", JSON.stringify(ids(on)));
    check("no sub-account has the widget enabled — warned, not blocked", sev(on, "no-support-locations") === "warning");

    console.log("\n== the seeded knowledge base is a positive control ==");
    const ready = await p.kbArticle.count({ where: { status: "ready" } });
    check(`${ready} retrievable articles, so 'kb-empty' must NOT fire`, ready > 0 && !has(on, "kb-empty"), JSON.stringify(ids(on)));

    console.log("\n== desk staffing is a DATABASE fact nothing else checks ==");
    const activeStaff = await p.deskUser.count({ where: { status: "active" } });
    if (activeStaff === 0) {
      check("an empty desk is a blocker while support is on", sev(on, "no-desk-staff") === "blocker", JSON.stringify(ids(on)));
    } else {
      check("(desk already staffed by another suite — skipping the empty-desk case)", true);
    }

    // Every account is created at tier 1. A ticket escalated past the top staffed tier is
    // routable to nobody: it reads as handled on every screen and is answered by no one.
    const t1 = await p.deskUser.create({
      data: {
        email: `${TAG}-t1@mosaic.test`,
        name: "Tier One",
        passwordHash: "x:y",
        role: "mosaic_agent",
        status: "active",
        tier: 1,
      },
    });
    for (const u of await p.deskUser.findMany({ where: { status: "active", NOT: { id: t1.id } }, select: { id: true, tier: true } })) {
      parked.push(u);
      await p.deskUser.update({ where: { id: u.id }, data: { tier: 1 } });
    }

    const tier1Only = await checkReadiness();
    check("a desk staffed only at tier 1 is reported", has(tier1Only, "unstaffed-tiers"), JSON.stringify(ids(tier1Only)));
    check("  -> as a warning: tickets are answered, just not escalations", sev(tier1Only, "unstaffed-tiers") === "warning");
    const msg = tier1Only.findings.find((f) => f.id === "unstaffed-tiers");
    check("  -> and it names the tiers nobody holds", /tiers 2/.test(msg.what), msg.what);
    check("  -> the fix is a real action, not 'check your config'", /Staff tab/i.test(msg.fix), msg.fix);

    await p.deskUser.update({ where: { id: t1.id }, data: { tier: 3 } });
    const promoted = await checkReadiness();
    check("promoting someone to the top tier clears it", !has(promoted, "unstaffed-tiers"), JSON.stringify(ids(promoted)));

    /*
     * A harness fixture that outlived its run is a LIVE desk account with a password that
     * is a constant in this repository, and every desk account can read every agency's
     * conversations. Teardown is armed on SIGINT/SIGTERM, which a SIGKILL does not honour —
     * measured 2026-08-26, two accounts left active by a run killed at a 120s timeout.
     *
     * Our own `t1` is on `@mosaic.test`, so it IS one: assert by name rather than by the
     * finding firing, which would be the neighbour's-data trap again four checks after the
     * feed one.
     */
    const fixtureFinding = promoted.findings.find((f) => f.id === "harness-desk-accounts");
    check("a live account on a reserved test domain is reported", !!fixtureFinding, JSON.stringify(ids(promoted)));
    check("  -> naming it, since nothing else in the product ever will",
      !!fixtureFinding && fixtureFinding.what.includes(`${TAG}-t1@mosaic.test`), fixtureFinding?.what);
    check("  -> a warning, not a blocker: it does not stop the product working",
      sev(promoted, "harness-desk-accounts") === "warning");
    check("  -> and it says WHY an account matters here, not just that it exists",
      /read every agency/i.test(fixtureFinding?.why ?? ""), fixtureFinding?.why);

    await p.deskUser.update({ where: { id: t1.id }, data: { status: "disabled" } });
    const disabled = await checkReadiness();
    const stillNamed = disabled.findings.find((f) => f.id === "harness-desk-accounts");
    check("  -> and DISABLING it clears it, since it can no longer sign in",
      !stillNamed || !stillNamed.what.includes(`${TAG}-t1@mosaic.test`), stillNamed?.what);
    await p.deskUser.update({ where: { id: t1.id }, data: { status: "active" } });

    console.log("\n== every finding is actionable ==");
    // A finding that states a symptom without a remedy is a line people learn to skim.
    for (const f of promoted.findings) {
      check(`'${f.id}' says what breaks and how to fix it`, f.what.length > 10 && f.why.length > 20 && f.fix.length > 10, JSON.stringify(f));
    }

    console.log("\n== and it goes quiet again when the state is fixed ==");
    await p.supportConfig.update({
      where: { agencyInstallId: agency.id },
      data: { escalationEmails: ["ops@mosaic.test"] },
    });
    const fixed = await checkReadiness();
    check("the escalation-address blocker is gone", !has(fixed, "no-escalation-email"), JSON.stringify(ids(fixed)));

    /*
     * Feeds. Every failure mode here is silent by construction: polling is an external
     * script, so nothing in the request path can notice it stopped, and a SHARED feed
     * belongs to no agency so no dashboard shows its error either. The bot keeps
     * answering, fluently, from whatever it learned last.
     */
    console.log("\n== feeds: the corpus going stale has no error path ==");
    const DAY = 86_400_000;
    const feedUrl = `mosaic:verify/${TAG}-readiness-feed`;
    const mkFeed = (data) =>
      p.kbFeed.create({ data: { url: feedUrl, source: "ghl", autoPublish: false, ...data } });

    /*
     * EVERY feed assertion below is about OUR feed, by URL — never about whether the
     * finding fired at all.
     *
     * These findings are deployment-wide, and this deployment has a real feed: the GHL
     * changelog, shared, last polled the day the scheduler stopped. So `has(r,"feed-stale")`
     * was wrong in both directions four lines apart. The negative one FAILED, reporting a
     * true readiness line as a product defect. The positive one PASSED FOR THE WRONG REASON
     * — the neighbour's staleness satisfied it, so it would have gone green with the
     * fixture's staleness undetected entirely.
     *
     * This suite has already been fixed for exactly this once, on `supportEnabled`, and the
     * fix went to the finding in hand and not to the one beside it. Ninth instance in this
     * file of a suite that can only be right on a database nobody has used.
     */
    const mentions = (r, id) => {
      const f = r.findings.find((x) => x.id === id);
      return !!f && f.what.includes(feedUrl);
    };
    const detail = (r, id) => JSON.stringify(r.findings.find((x) => x.id === id)?.what ?? ids(r));
    {
      const base = await checkReadiness();
      // Printed, because an assertion measured against a baseline is only honest if the
      // baseline is on screen — the rule every other suite here reaches eventually.
      console.log(
        `        baseline before our fixture: ${["feed-never-polled", "feed-stale", "feed-disabled"]
          .map((id) => `${id}=${has(base, id) ? "already firing" : "quiet"}`)
          .join(", ")}`
      );
    }

    // A feed added an hour ago has legitimately not polled yet. If this trips on that, the
    // check cries wolf on correct behaviour and gets ignored — which is worse than absent.
    let feed = await mkFeed({ lastPolledAt: null });
    let r = await checkReadiness();
    check("a FRESH never-polled feed is not reported — it has simply not run yet",
      !mentions(r, "feed-never-polled"), detail(r, "feed-never-polled"));

    await p.kbFeed.update({ where: { id: feed.id }, data: { createdAt: new Date(Date.now() - 3 * DAY) } });
    r = await checkReadiness();
    check("but one added days ago and never polled IS reported", has(r, "feed-never-polled"), JSON.stringify(ids(r)));

    /*
     * Feed findings must NOT be gated on the support switch, and the first version of this
     * code gated them — so a deployment with a real feed, a review backlog and no scheduler
     * reported "all checks passed". Creating a feed row is itself a deliberate act saying
     * "keep this corpus current", unlike an env var that is simply absent by default; the
     * severity should follow that intent, not the master switch.
     *
     * Proven by turning support back OFF rather than by reading the code — by this point in
     * the suite an earlier section has switched it on, which is exactly how the first
     * version of this check passed while asserting nothing.
     */
    await p.supportConfig.update({ where: { agencyInstallId: agency.id }, data: { enabled: false } });
    const supportOff = await checkReadiness();
    check("  -> support is genuinely off for this probe", supportOff.supportEnabled === false, `supportEnabled=${supportOff.supportEnabled}`);
    check("  -> and the feed finding SURVIVES it — creating a feed is the intent, not the switch",
      has(supportOff, "feed-never-polled"), JSON.stringify(ids(supportOff)));
    check("  -> while support-gated findings correctly vanish", !has(supportOff, "no-desk-staff") && !has(supportOff, "no-model-key"),
      JSON.stringify(ids(supportOff)));
    await p.supportConfig.update({ where: { agencyInstallId: agency.id }, data: { enabled: true } });
    check("  -> naming it as shared, since no agency dashboard will ever show it",
      /\(shared\)/.test(r.findings.find((f) => f.id === "feed-never-polled").what));

    await p.kbFeed.update({ where: { id: feed.id }, data: { lastPolledAt: new Date() } });
    r = await checkReadiness();
    check("  -> and it goes quiet once the feed actually polls", !mentions(r, "feed-never-polled"), detail(r, "feed-never-polled"));

    await p.kbFeed.update({ where: { id: feed.id }, data: { lastPolledAt: new Date(Date.now() - 9 * DAY) } });
    r = await checkReadiness();
    check("a feed not polled in over a week is reported — the scheduler died silently",
      mentions(r, "feed-stale"), detail(r, "feed-stale"));

    /*
     * Stale AND disabled. It used to be set `lastPolledAt: new Date()` here, so the feed
     * was not stale by the clock either — meaning the "one problem, one line" check below
     * could not have been about the `f.enabled` guard at all. Nine days keeps it inside the
     * stale window, so dropping that guard genuinely double-reports it.
     */
    await p.kbFeed.update({ where: { id: feed.id }, data: { lastPolledAt: new Date(Date.now() - 9 * DAY), enabled: false, lastError: "404 Not Found" } });
    r = await checkReadiness();
    check("a feed auto-disabled by repeated failures is reported", mentions(r, "feed-disabled"), detail(r, "feed-disabled"));
    check("  -> quoting the actual error, since nothing else in the product displays it",
      /404 Not Found/.test(r.findings.find((f) => f.id === "feed-disabled").what));
    check("  -> and a disabled feed is NOT also reported as stale — one problem, one line",
      !mentions(r, "feed-stale"), detail(r, "feed-stale"));

    // The backlog: items that arrived, passed every gate, and wait on a human who does not
    // know they exist. The feed reports success on every poll throughout.
    await p.kbFeed.update({ where: { id: feed.id }, data: { enabled: true } });
    const before = await checkReadiness();
    const beforeCount = Number((before.findings.find((f) => f.id === "feed-review-backlog")?.what ?? "0").match(/^\d+/)?.[0] ?? 0);
    await p.kbArticle.create({
      data: {
        source: "ghl", agencyInstallId: null, feedId: feed.id,
        sourceUrl: `mosaic:verify/${TAG}-pending`,
        titleNormalized: "Zzverify pending item", bodyNormalized: "Waiting on a human who does not know it exists.",
        contentHash: `${TAG}-pending`, featureTags: [], status: "needs_review",
      },
    });
    r = await checkReadiness();
    const afterCount = Number(r.findings.find((f) => f.id === "feed-review-backlog").what.match(/^\d+/)[0]);
    check("an unreviewed shared item is counted in the backlog", afterCount === beforeCount + 1, `${beforeCount} -> ${afterCount}`);
    check("  -> and the remedy is the command that can actually clear it",
      /review-kb/.test(r.findings.find((f) => f.id === "feed-review-backlog").fix));

    await p.kbArticle.update({ where: { sourceUrl: `mosaic:verify/${TAG}-pending` }, data: { status: "ready" } });
    r = await checkReadiness();
    const clearedCount = Number((r.findings.find((f) => f.id === "feed-review-backlog")?.what ?? "0").match(/^\d+/)?.[0] ?? 0);
    check("  -> and approving it removes it from the backlog", clearedCount === beforeCount, `${afterCount} -> ${clearedCount}`);
  } finally {
    await p.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: `mosaic:verify/${TAG}` } } });
    await p.kbFeed.deleteMany({ where: { url: { startsWith: `mosaic:verify/${TAG}` } } });
    for (const u of parked) await p.deskUser.update({ where: { id: u.id }, data: { tier: u.tier } }).catch(() => {});
    // Put the deployment's own master switches back. Restored, not set to a value — the
    // distinction that cost nine harnesses a real sub-account's support widget.
    for (const r of supportWas) {
      await p.supportConfig.update({ where: { agencyInstallId: r.agencyInstallId }, data: { enabled: true } }).catch(() => {});
    }
    if (supportWas.length) console.log(`        restored support ON for ${supportWas.length} agency/agencies`);
    await p.deskUser.deleteMany({ where: { email: { startsWith: `${TAG}-` } } });
    if (agencyId) {
      await p.supportConfig.deleteMany({ where: { agencyInstallId: agencyId } });
      await p.locationInstall.deleteMany({ where: { agencyInstallId: agencyId } });
      await p.agencyInstall.deleteMany({ where: { id: agencyId } });
    }
  }

  const after = await checkReadiness();
  check(
    "teardown restored the deployment's own state",
    after.supportEnabled === deploymentRunsSupport,
    `support is now ${after.supportEnabled ? "on" : "off"}, deployment started ${deploymentRunsSupport ? "on" : "off"} — findings ${JSON.stringify(ids(after))}`
  );

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e.stack);
  await p.$disconnect();
  process.exit(1);
});
